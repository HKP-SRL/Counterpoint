import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { ClaudeCliRunner, parseStreamJson } from '../../src/agent/runner.ts';
import {
  budgetTokens,
  CalibrationError,
  calibrateWindow,
  formatBudget,
  formatTokens,
  knownWindow,
  learnFromResult,
  normalizeClaudeVersion,
  sessionFailure,
} from '../../src/build/windows.ts';
import { openStore, type Store, upsertHost } from '../../src/core/store/db.ts';
import { getAgentSession, openAgentSessions } from '../../src/core/store/sessions.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = resolve(HERE, '..', 'helpers', 'fake-claude.mjs');
chmodSync(FAKE, 0o755);

afterAll(() => {
  removeScratchDirs();
});

function store(): Store {
  const db = openStore(makeScratchDir('cp-win'));
  upsertHost(db, {
    id: 'cena',
    root: '/x',
    gitCommonDir: '/x/.git',
    baseBranch: 'master',
    adapter: 'openspec',
  });
  return db;
}

describe('budget as tokens', () => {
  it.each([
    [40, 1_000_000, '40% of 1M = 400k tokens'],
    [50, 200_000, '50% of 200k = 100k tokens'],
    [35, 1_000_000, '35% of 1M = 350k tokens'],
  ])('%d%% of %d reads %s', (percent, window, text) => {
    expect(formatBudget(percent, window)).toBe(text);
  });

  it('formats token counts', () => {
    expect(formatTokens(1_500_000)).toBe('1.5M');
    expect(formatTokens(123_456)).toBe('123k');
    expect(formatTokens(999)).toBe('999');
  });

  it('refuses a budget outside 0-100%', () => {
    expect(() => budgetTokens(0, 1000)).toThrow(RangeError);
    expect(() => budgetTokens(101, 1000)).toThrow(RangeError);
    expect(budgetTokens(40, 1_000_000)).toBe(400_000);
  });
});

describe('learning windows', () => {
  it('learns from a real result under the resolved id and the requested alias', () => {
    const db = store();
    const events = parseStreamJson(
      readFileSync(join(HERE, '..', 'fixtures', 'stream-json', 'streaming-inject.jsonl'), 'utf8'),
    );
    const result = events.find((event) => event.type === 'result');
    if (result === undefined) throw new Error('fixture has no result');
    const window = learnFromResult(db, {
      requested: 'haiku',
      resolved: 'claude-haiku-5-5',
      claudeVersion: '2.1.322',
      result,
    });
    expect(window).toBe(1_000_000);
    expect(knownWindow(db, 'haiku', '2.1.322')).toBe(1_000_000);
    expect(knownWindow(db, 'claude-haiku-5-5', '2.1.322')).toBe(1_000_000);
    // Another claude version knows nothing yet.
    expect(knownWindow(db, 'haiku', '2.1.323')).toBeNull();
  });

  it('learns nothing from a result without windows', () => {
    const db = store();
    expect(
      learnFromResult(db, {
        requested: 'haiku',
        resolved: null,
        claudeVersion: '2.1.322',
        result: { type: 'result', subtype: 'success' },
      }),
    ).toBeNull();
    expect(knownWindow(db, 'haiku', '2.1.322')).toBeNull();
  });

  it('normalizes the version string', () => {
    expect(normalizeClaudeVersion('2.1.322 (Claude Code)\n')).toBe('2.1.322');
  });
});

describe('calibration session (fake claude)', () => {
  it('learns the window and records the session', async () => {
    const db = store();
    const dir = makeScratchDir('cp-cal');
    const window = await calibrateWindow({
      runner: new ClaudeCliRunner({ binary: FAKE }),
      db,
      hostId: 'cena',
      model: 'fake',
      claudeVersion: '9.9.9',
      cwd: dir,
      rawLogPath: join(dir, 'raw.jsonl'),
      processTag: 'cal-0123456789',
    });
    expect(window).toBe(200_000);
    expect(knownWindow(db, 'fake', '9.9.9')).toBe(200_000);
    expect(knownWindow(db, 'fake-model', '9.9.9')).toBe(200_000);
    expect(openAgentSessions(db)).toEqual([]);
    const session = getAgentSession(db, 1);
    expect(session).toMatchObject({ kind: 'calibration', endReason: 'finished' });
    expect(session?.pid).toBeGreaterThan(0);
    expect(session?.peakContextTokens).toBeGreaterThan(0);
  });

  it('fails when the session reports no window', async () => {
    const db = store();
    const dir = makeScratchDir('cp-cal');
    await expect(
      calibrateWindow({
        runner: new ClaudeCliRunner({ binary: '/usr/bin/true' }),
        db,
        hostId: 'cena',
        model: 'fake',
        claudeVersion: '9.9.9',
        cwd: dir,
        rawLogPath: join(dir, 'raw.jsonl'),
        processTag: 'cal-0123456789',
      }),
    ).rejects.toThrow(CalibrationError);
    expect(getAgentSession(db, 1)?.endReason).toBe('no-window');
  });

  // Seen live on claude 2.1.322 when the daemon dropped USER: an instant error result, no window.
  it("names claude's own error when the session fails (not logged in)", async () => {
    const db = store();
    const dir = makeScratchDir('cp-cal');
    const binary = join(dir, 'logged-out-claude.sh');
    const result = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'Not logged in · Please run /login',
      modelUsage: {},
    });
    writeFileSync(binary, `#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '${result}'\n`, {
      mode: 0o755,
    });
    await expect(
      calibrateWindow({
        runner: new ClaudeCliRunner({ binary }),
        db,
        hostId: 'cena',
        model: 'opus',
        claudeVersion: '9.9.9',
        cwd: dir,
        rawLogPath: join(dir, 'raw.jsonl'),
        processTag: 'cal-0123456789',
      }),
    ).rejects.toThrow('The calibration session for opus failed: Not logged in · Please run /login');
    expect(getAgentSession(db, 1)?.endReason).toBe('no-window');
  });

  // Calibration runs after every claude update; an API hiccup then must not end the run.
  it.each([
    ['overloaded', { kind: 'transient' }],
    ['rate_limit', { kind: 'usage-limit' }],
    ['authentication_failed', { kind: 'stop', cause: 'auth' }],
  ])(
    'says how the session ended when it fails (%s), so the run can wait or retry',
    async (error, outcome) => {
      const db = store();
      const dir = makeScratchDir('cp-cal');
      const binary = join(dir, 'failing-claude.sh');
      const lines = [
        JSON.stringify({ type: 'assistant', error, message: { id: 'm' } }),
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: true,
          result: error === 'rate_limit' ? 'Claude usage limit reached · resets 3am' : 'API Error',
        }),
      ];
      writeFileSync(
        binary,
        `#!/bin/sh\ncat >/dev/null\n${lines.map((line) => `printf '%s\\n' '${line}'`).join('\n')}\n`,
        { mode: 0o755 },
      );
      const failed = await calibrateWindow({
        runner: new ClaudeCliRunner({ binary }),
        db,
        hostId: 'cena',
        model: 'opus',
        claudeVersion: '9.9.9',
        cwd: dir,
        rawLogPath: join(dir, 'raw.jsonl'),
        processTag: 'cal-0123456789',
      }).catch((e: unknown) => e);
      expect(failed).toBeInstanceOf(CalibrationError);
      expect((failed as CalibrationError).outcome).toMatchObject(outcome);
    },
  );
});

describe('sessionFailure', () => {
  it('is null for a result that is not an error', () => {
    expect(sessionFailure(null)).toBeNull();
    expect(sessionFailure({ type: 'result', subtype: 'success', result: 'OK' })).toBeNull();
  });

  it('keeps one short line of the error text', () => {
    expect(
      sessionFailure({
        type: 'result',
        is_error: true,
        result: 'Not logged in\n· Please run /login',
      }),
    ).toBe('Not logged in · Please run /login');
    expect(sessionFailure({ type: 'result', is_error: true })).toBe(
      'claude reported an error and no message.',
    );
    expect(
      sessionFailure({ type: 'result', is_error: true, result: 'x'.repeat(500) }),
    ).toHaveLength(200);
  });
});

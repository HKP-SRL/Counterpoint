// The owner's accepted-risk commands: `accept-risk gh-keychain` and `revoke-risk`, driven
// as functions with an injected TTY flag and typed answers, against scratch homes only. Nothing
// here touches the owner's real Counterpoint home, Keychain or keys. A source scan keeps the
// record's writer and revoker inside src/cli/risk.ts.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { acceptRiskCommand, revokeRiskCommand } from '../../src/cli/risk.ts';
import { readAcceptedRisks, writeAcceptedRisk } from '../../src/core/security/accepted-risks.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

afterAll(() => removeScratchDirs());

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOW = new Date('2026-11-10T09:30:00.000Z');
const REASON_QUESTION = 'Why do you accept it? (one line, shown wherever the risk is shown): ';
const CONFIRM_QUESTION = 'Record this accepted risk? [y/N] ';

interface Captured {
  out: string[];
  err: string[];
  questions: string[];
}

/** Terminal options answering each question in turn; `null` means no question may be asked. */
function io(answers: string[] | null, isTTY = true) {
  const captured: Captured = { out: [], err: [], questions: [] };
  const queue = [...(answers ?? [])];
  return {
    captured,
    options: {
      isTTY,
      confirm: async (question: string) => {
        captured.questions.push(question);
        const answer = queue.shift();
        if (answers === null || answer === undefined) throw new Error('unexpected question');
        return answer;
      },
      out: (line: string) => captured.out.push(line),
      err: (line: string) => captured.err.push(line),
      now: () => NOW,
    },
  };
}

const recordFile = (home: string) => join(home, 'trust', 'accepted-risks.json');

describe('acceptRiskCommand', () => {
  it('refuses any other risk id with exit 2 and writes nothing', async () => {
    const home = makeScratchDir('rhome');
    const { captured, options } = io(null);
    expect(await acceptRiskCommand(home, 'ssh', options)).toBe(2);
    expect(captured.err).toEqual(['Only gh-keychain can be accepted. Nothing saved.']);
    expect(captured.questions).toEqual([]);
    expect(existsSync(recordFile(home))).toBe(false);
  });

  it('refuses without a terminal with exit 1 and writes nothing', async () => {
    const home = makeScratchDir('rhome');
    const { captured, options } = io(null, false);
    expect(await acceptRiskCommand(home, 'gh-keychain', options)).toBe(1);
    expect(captured.err).toEqual([
      'counterpoint accept-risk needs a terminal so you can confirm it. Nothing saved.',
    ]);
    expect(captured.questions).toEqual([]);
    expect(existsSync(recordFile(home))).toBe(false);
  });

  it.each([
    ['an empty reason', ''],
    ['a blank reason', '   '],
    ['a control-character reason', 'fine\u0007bell'],
    ['a reason with a line separator', 'one two'],
    ['a 301-character reason', 'x'.repeat(301)],
  ])('refuses %s with exit 1 and writes nothing', async (_name, reason) => {
    const home = makeScratchDir('rhome');
    const { captured, options } = io([reason, 'y']);
    expect(await acceptRiskCommand(home, 'gh-keychain', options)).toBe(1);
    expect(captured.err).toEqual([
      'A one-line reason of up to 300 characters is needed. Nothing saved.',
    ]);
    expect(captured.questions).toEqual([REASON_QUESTION]);
    expect(existsSync(recordFile(home))).toBe(false);
  });

  it('saves nothing unless the owner answers y', async () => {
    const home = makeScratchDir('rhome');
    const { captured, options } = io(['the gh keyring entry', 'n']);
    expect(await acceptRiskCommand(home, 'gh-keychain', options)).toBe(1);
    expect(captured.questions).toEqual([REASON_QUESTION, CONFIRM_QUESTION]);
    expect(captured.out.at(-1)).toBe('Nothing saved.');
    expect(existsSync(recordFile(home))).toBe(false);
  });

  it('prints what is accepted, then records the typed reason and the date after y', async () => {
    const home = makeScratchDir('rhome');
    const { captured, options } = io(['  the gh keyring entry is an accepted residual  ', 'y']);
    expect(await acceptRiskCommand(home, 'gh-keychain', options)).toBe(0);
    expect(captured.out.slice(0, 3)).toEqual([
      'Accept this risk: gh credentials (Keychain lookup only)',
      "A sandboxed agent's shell can read items in your macOS Keychain, so gh credentials kept there are reachable by agents.",
      'Doctor still fails if any other probe target, or any gh config file, is reachable.',
    ]);
    expect(captured.questions).toEqual([REASON_QUESTION, CONFIRM_QUESTION]);
    expect(captured.out.at(-1)).toBe(
      'Accepted risk gh-keychain recorded on 2026-11-10. counterpoint doctor and the console show it on every check. Withdraw it with: counterpoint revoke-risk gh-keychain',
    );
    expect(readAcceptedRisks(home)).toEqual({
      ok: true,
      risks: [
        {
          id: 'gh-keychain',
          target: 'gh',
          subStep: 'keychain',
          reason: 'the gh keyring entry is an accepted residual',
          recordedAt: NOW.toISOString(),
        },
      ],
    });
    expect(statSync(recordFile(home)).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, 'trust')).mode & 0o777).toBe(0o700);
  });

  it('accepts a 300-character reason', async () => {
    const home = makeScratchDir('rhome');
    const { options } = io(['x'.repeat(300), 'y']);
    expect(await acceptRiskCommand(home, 'gh-keychain', options)).toBe(0);
  });

  it('shows an existing entry, then replaces it', async () => {
    const home = makeScratchDir('rhome');
    writeAcceptedRisk(home, {
      reason: 'first reason',
      now: () => new Date('2026-11-01T08:00:00.000Z'),
    });
    const { captured, options } = io(['second reason', 'y']);
    expect(await acceptRiskCommand(home, 'gh-keychain', options)).toBe(0);
    expect(captured.out).toContain('Currently recorded on 2026-11-01: first reason');
    const read = readAcceptedRisks(home);
    expect(read.ok && read.risks.map((risk) => [risk.reason, risk.recordedAt])).toEqual([
      ['second reason', NOW.toISOString()],
    ]);
  });
});

describe('revokeRiskCommand', () => {
  function capture() {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      options: { out: (line: string) => out.push(line), err: (line: string) => err.push(line) },
    };
  }

  it('refuses any other risk id with exit 2', () => {
    const home = makeScratchDir('rhome');
    const { err, options } = capture();
    expect(revokeRiskCommand(home, 'outside-workdir', options)).toBe(2);
    expect(err).toEqual(['Only gh-keychain can be revoked.']);
  });

  it('withdraws a recorded risk, then says none is recorded; both exit 0', () => {
    const home = makeScratchDir('rhome');
    writeAcceptedRisk(home, { reason: 'the gh keyring entry', now: () => NOW });
    const first = capture();
    expect(revokeRiskCommand(home, 'gh-keychain', first.options)).toBe(0);
    expect(first.out).toEqual([
      'Accepted risk gh-keychain withdrawn. From now on doctor fails while gh credentials are reachable.',
    ]);
    expect(existsSync(recordFile(home))).toBe(false);
    expect(readAcceptedRisks(home)).toEqual({ ok: true, risks: [] });

    const second = capture();
    expect(revokeRiskCommand(home, 'gh-keychain', second.options)).toBe(0);
    expect(second.out).toEqual(['No accepted risk gh-keychain is recorded.']);
  });
});

// --- Source scan: only the terminal command writes or revokes the record ----------------------

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

describe('the accepted-risk record source scan', () => {
  const src = join(REPO_ROOT, 'src');
  const files = sourceFiles(src).map((path) => ({
    rel: relative(REPO_ROOT, path),
    text: readFileSync(path, 'utf8'),
  }));
  const DEFINITIONS = 'src/core/security/accepted-risks.ts';
  const COMMAND = 'src/cli/risk.ts';

  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.map((file) => file.rel)).toEqual(expect.arrayContaining([DEFINITIONS, COMMAND]));
  });

  it('names the writer and the revoker only in the definitions and the terminal command', () => {
    const offenders = files
      .filter((file) => file.rel !== DEFINITIONS && file.rel !== COMMAND)
      .filter((file) => /\b(writeAcceptedRisk|revokeAcceptedRisk)\b/.test(file.text))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
    const command = files.find((file) => file.rel === COMMAND)?.text ?? '';
    expect(command).toMatch(/\bwriteAcceptedRisk\b/);
    expect(command).toMatch(/\brevokeAcceptedRisk\b/);
  });

  it('builds the record file name only in the definitions', () => {
    const offenders = files
      .filter((file) => file.rel !== DEFINITIONS)
      .filter((file) => /accepted-risks\.json/.test(file.text))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('keeps the accepted-risk module out of the probe evaluator', () => {
    const evaluator = files.find((file) => file.rel === 'src/agent/probe-evaluator.ts')?.text;
    expect(evaluator).toBeDefined();
    const specifiers = [
      ...(evaluator ?? '').matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g),
      ...(evaluator ?? '').matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((match) => match[1] as string);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((specifier) => specifier.endsWith('accepted-risks.ts'))).toEqual([]);
  });
});

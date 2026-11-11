// `counterpoint run`, `run stop`, `run status` over a recorded control socket.
import { afterAll, describe, expect, it } from 'vitest';
import type { RunView } from '../../src/build/orchestrator.ts';
import { formatRunView, parseUntil, runStartCommand, runStatusCommand } from '../../src/cli/run.ts';
import { openStore, upsertHost } from '../../src/core/store/db.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

afterAll(removeScratchDirs);

function home(): string {
  const dir = makeScratchDir('cli-run');
  const db = openStore(dir);
  upsertHost(db, {
    id: 'cena',
    root: '/x/cena',
    gitCommonDir: '/x/cena/.git',
    baseBranch: 'master',
    adapter: 'openspec',
  });
  db.close();
  return dir;
}

describe('parseUntil', () => {
  const now = new Date(2026, 10, 11, 22, 30);
  it('reads HH:MM as the next time the clock shows it', () => {
    expect(new Date(parseUntil('06:00', now) as number)).toEqual(new Date(2026, 10, 12, 6, 0));
    expect(new Date(parseUntil('23:15', now) as number)).toEqual(new Date(2026, 10, 11, 23, 15));
  });
  it('reads an ISO time, refuses anything else', () => {
    expect(parseUntil('2026-11-12T06:00:00Z', now)).toBe(Date.parse('2026-11-12T06:00:00Z'));
    expect(parseUntil('soon', now)).toBeNull();
  });
});

describe('counterpoint run', () => {
  it('asks the daemon to start, with the stop time and budget, and prints its refusal', async () => {
    const sent: unknown[] = [];
    const out: string[] = [];
    const err: string[] = [];
    const code = await runStartCommand(
      home(),
      'cena',
      { model: 'opus', budget: '35', until: '06:00', changes: 'a-thing, b-thing' },
      {
        out: (l) => out.push(l),
        err: (l) => err.push(l),
        now: () => new Date(2026, 10, 11, 22, 30),
        request: async (_home, _method, _path, body) => {
          sent.push(body);
          return { status: 409, body: { error: 'Not on the runway now: b-thing.' } };
        },
      },
    );
    expect(code).toBe(1);
    expect(sent).toEqual([
      {
        hostId: 'cena',
        changes: ['a-thing', 'b-thing'],
        until: new Date(2026, 10, 12, 6, 0).toISOString(),
        model: 'opus',
        budgetPercent: 35,
      },
    ]);
    expect(err).toEqual(['The run did not start: Not on the runway now: b-thing.']);
  });

  it('needs a model and a sane budget', async () => {
    const err: string[] = [];
    const h = home();
    expect(await runStartCommand(h, 'cena', {}, { err: (l) => err.push(l) })).toBe(2);
    expect(
      await runStartCommand(
        h,
        'cena',
        { model: 'opus', budget: '95' },
        { err: (l) => err.push(l) },
      ),
    ).toBe(2);
    expect(err[0]).toMatch(/--model/);
    expect(err[1]).toMatch(/10 to 90/);
  });

  it('prints the run status', async () => {
    const view = {
      id: 'r1',
      hostId: 'cena',
      state: 'ended',
      settings: { model: 'opus', budgetPercent: 40 },
      stopAt: null,
      startedAt: 0,
      endedAt: 1,
      endReason: 'finished',
      endDetail: null,
      reportPath: null,
      budgetLabel: '40% of 1M = 400k tokens',
      changes: [
        {
          change: 'a-thing',
          state: 'green',
          reason: null,
          attempts: 0,
          prUrl: 'https://github.com/x/y/pull/7',
        },
        {
          change: 'b-thing',
          state: 'parked',
          reason: 'Gate "unit" failed 3 times.',
          attempts: 3,
          prUrl: null,
        },
      ],
      now: null,
      hold: null,
    } as unknown as RunView;
    const out: string[] = [];
    await runStatusCommand(home(), 'cena', {
      out: (l) => out.push(l),
      request: async () => ({ status: 200, body: { run: view } }),
    });
    expect(out).toEqual(formatRunView(view));
    expect(out[2]).toContain('budget 40% of 1M = 400k tokens');
    expect(out.slice(-2)).toEqual([
      '  green    a-thing  https://github.com/x/y/pull/7',
      '  parked   b-thing  3 failed attempts; Gate "unit" failed 3 times.',
    ]);
  });
});

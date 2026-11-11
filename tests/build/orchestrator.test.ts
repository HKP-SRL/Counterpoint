// The build orchestrator over a real OpenSpec host, real worktrees and the real store, with the
// builder sessions and gate rounds played by fakes (no claude, no srt).
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createOpenSpecAdapter } from '../../src/adapters/openspec/index.ts';
import type { AgentRunner } from '../../src/agent/runner.ts';
import type {
  BuilderSession,
  BuilderSessionResult,
  startBuilderSession,
} from '../../src/build/builder-session.ts';
import type { GateRound, runGateRound } from '../../src/build/gates.ts';
import { type DoctorGate, Governor, type SessionOutcome } from '../../src/build/governor.ts';
import {
  Orchestrator,
  type OrchestratorOptions,
  type RunHost,
} from '../../src/build/orchestrator.ts';
import { HANDOFF_FILE } from '../../src/build/prompt.ts';
import { recoverRuns } from '../../src/build/recovery.ts';
import { snapshotIntegrity, writeBaseline } from '../../src/core/approvals/integrity.ts';
import { createGitFileReader } from '../../src/core/git/reader.ts';
import { runGit } from '../../src/core/git/run.ts';
import { runNeedsYou } from '../../src/core/runway/run-items.ts';
import type { ApprovalState, Runway } from '../../src/core/runway/runway.ts';
import { openStore, upsertHost } from '../../src/core/store/db.ts';
import {
  activeRun,
  getRun,
  insertRun,
  insertRunChange,
  latestRun,
  listGateResults,
  listRunChanges,
  updateRunChange,
} from '../../src/core/store/runs.ts';
import { insertAgentSession, openAgentSessions } from '../../src/core/store/sessions.ts';
import { materializeOpenSpecHost } from '../helpers/fixture-repo.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

const cleanup: string[] = [];
afterAll(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
  removeScratchDirs();
});

const VERSION = '2.1.322 (Claude Code)';
const proposal = (title: string) => `# ${title}\n\n## Why\n\nBecause.\n`;
const tasks = '# Tasks\n\n- [ ] 1.1 Do it\n- [ ] 1.2 Test it\n';

async function host() {
  const repo = await materializeOpenSpecHost({
    'openspec/config.yaml': 'schema: spec-driven\n',
    'openspec/changes/b-thing/.openspec.yaml': 'schema: spec-driven\nx-depends-on: [a-thing]\n',
    'openspec/changes/b-thing/proposal.md': proposal('B thing'),
    'openspec/changes/b-thing/tasks.md': tasks,
    'openspec/changes/a-thing/.openspec.yaml': 'schema: spec-driven\n',
    'openspec/changes/a-thing/proposal.md': proposal('A thing'),
    'openspec/changes/a-thing/tasks.md': tasks,
    '.counterpoint/config.yaml': 'gates:\n  - { name: unit, command: [pnpm, test] }\nattempts: 2\n',
    '.gitignore': 'node_modules\n',
    'src/app.ts': 'export {}\n',
  });
  cleanup.push(`${repo.root}-worktrees`);
  const home = makeScratchDir('cp-orch');
  const db = openStore(home);
  const row = {
    id: 'cena',
    root: repo.root,
    gitCommonDir: join(repo.root, '.git'),
    baseBranch: 'master',
    adapter: 'openspec',
  };
  upsertHost(db, row);
  writeBaseline(
    home,
    'cena',
    await snapshotIntegrity(row.gitCommonDir, {
      project: { root: repo.root, baseBranch: 'master' },
    }),
  );
  const runtime: RunHost = {
    host: row,
    reader: createGitFileReader(repo.root),
    adapter: createOpenSpecAdapter(),
  };
  return { repo, home, db, runtime };
}

function onRunway(base: string, change: string): ApprovalState {
  return {
    state: 'on-runway',
    commit: `${change.charCodeAt(0).toString(16).padStart(2, '0').repeat(20)}`,
    tip: base,
    signedAt: '2026-11-11T10:00:00Z',
    statement: { base: { branch: 'master', commit: base } },
  } as unknown as ApprovalState;
}

function runwayOf(base: string, changes: string[]): Runway {
  return {
    tip: base,
    count: changes.length,
    taskCount: 2 * changes.length,
    onRunway: changes.map((changeId) => ({
      changeId,
      title: changeId,
      taskCount: 2,
      commit: 'x',
      signedAt: '',
    })),
    changed: [],
    invalid: [],
  };
}

const OK: SessionOutcome = { kind: 'ok' };

/** A builder session that writes a file and a handoff, then ends as told. */
function fakeSessions(
  plan: (
    n: number,
    cwd: string,
  ) => {
    reason?: BuilderSessionResult['reason'];
    outcome?: SessionOutcome;
    wait?: boolean;
  } = () => ({}),
) {
  const prompts: string[] = [];
  let n = 0;
  const start: typeof startBuilderSession = async (input) => {
    n += 1;
    prompts.push(input.prompt);
    const step = plan(n, input.cwd);
    writeFileSync(join(input.cwd, 'src', `session-${n}.ts`), `export const n = ${n};\n`);
    writeFileSync(join(input.cwd, HANDOFF_FILE), `Session ${n} handoff.\n`);
    let wrap: ((value: undefined) => void) | null = null;
    const wrapped = new Promise<void>((resolve) => {
      wrap = resolve;
    });
    const session: BuilderSession = {
      wrapUp: () => wrap?.(undefined),
      done: (async () => {
        if (step.wait === true) await wrapped;
        return {
          reason: step.wait === true ? 'stop-handoff' : (step.reason ?? 'finished'),
          peakTokens: 1000,
          outcome: step.outcome ?? OK,
          end: {
            exitCode: 0,
            signal: null,
            timedOut: false,
            killed: false,
            result: null,
            stderr: '',
          },
        };
      })(),
    };
    return session;
  };
  return { start, prompts, count: () => n };
}

function gates(outcomes: Array<GateRound['kind']>) {
  const calls: number[] = [];
  const round: typeof runGateRound = async (input) => {
    calls.push(input.attempt);
    const kind = outcomes.shift() ?? 'pass';
    if (kind === 'fail') {
      return {
        kind,
        entries: [],
        failure: {
          gate: 'unit',
          attempt: input.attempt,
          reason: 'exit code 1',
          tail: 'FAIL menu.test.ts',
        },
      };
    }
    if (kind === 'blocked') return { kind, entries: [], detail: 'blocked' };
    return { kind, entries: [] } as GateRound;
  };
  return { round, calls };
}

const runner: AgentRunner = {
  run: async () => {
    throw new Error('no plain runs');
  },
  version: async () => VERSION,
};

function orchestrator(
  ctx: Awaited<ReturnType<typeof host>>,
  over: Partial<OrchestratorOptions> & {
    states?: (change: string, n: number) => ApprovalState;
    gate?: DoctorGate;
  },
) {
  const events: Record<string, unknown>[] = [];
  const delivered: string[] = [];
  const doctorGate = over.gate ?? (() => ({ ok: true }) as const);
  let stateCalls = 0;
  const o = new Orchestrator({
    home: ctx.home,
    db: ctx.db,
    host: (id) => (id === 'cena' ? ctx.runtime : null),
    approvals: {
      runway: async () => runwayOf(ctx.repo.commit, ['b-thing', 'a-thing']),
      state: async (_runtime, change) => {
        stateCalls += 1;
        return over.states?.(change, stateCalls) ?? onRunway(ctx.repo.commit, change);
      },
    },
    governor: new Governor({ db: ctx.db, doctorGate }),
    doctorGate,
    runnerFactory: () => runner,
    setInstalledVersion: () => {},
    runDoctor: async () => ({ passed: true, detail: 'ok' }),
    consolePort: 4170,
    publish: (_host, payload) => events.push(payload),
    deliver: async (c) => {
      delivered.push(c.change.id);
      return { prUrl: `https://github.com/x/y/pull/${delivered.length}`, previewUrl: null };
    },
    calibrateWindow: async () => 1_000_000,
    sleep: async () => {},
    ...over,
  });
  return { o, events, delivered };
}

const SETTINGS = { changes: null, stopAt: null, model: 'opus', budgetPercent: 40 };

describe('starting a run', () => {
  it('refuses bad settings, an unknown host, off-runway changes, a failing doctor and a second run', async () => {
    const ctx = await host();
    const { o } = orchestrator(ctx, {
      startBuilderSession: fakeSessions((_, __) => ({ wait: true })).start,
      runGateRound: gates([]).round,
    });
    expect(await o.start('cena', { ...SETTINGS, budgetPercent: 5 })).toMatchObject({
      ok: false,
      status: 422,
    });
    expect(await o.start('nope', SETTINGS)).toMatchObject({ ok: false, status: 404 });
    expect(await o.start('cena', { ...SETTINGS, changes: ['c-thing'] })).toMatchObject({
      ok: false,
      status: 409,
      error: expect.stringMatching(/Not on the runway now: c-thing/),
    });
    expect(await o.start('cena', { ...SETTINGS, stopAt: Date.now() - 1000 })).toMatchObject({
      ok: false,
      status: 422,
    });

    const failing = orchestrator(ctx, {
      gate: () => ({ ok: false, reason: 'The last doctor run for cena did not pass.' }),
    });
    expect(await failing.o.start('cena', SETTINGS)).toEqual({
      ok: false,
      status: 409,
      error: 'The last doctor run for cena did not pass.',
    });

    const first = await o.start('cena', SETTINGS);
    expect(first.ok).toBe(true);
    expect(await o.start('cena', SETTINGS)).toMatchObject({ ok: false, status: 409 });
    o.stop('cena');
    await o.idle();
  });
});

describe('a run', () => {
  it('builds every runway change in build order, commits each session on its branch, and ends finished', async () => {
    const ctx = await host();
    const sessions = fakeSessions();
    const g = gates(['pass', 'pass']);
    const { o, delivered } = orchestrator(ctx, {
      startBuilderSession: sessions.start,
      runGateRound: g.round,
    });
    const started = await o.start('cena', SETTINGS);
    if (!started.ok) throw new Error(started.error);
    await o.idle();

    const run = getRun(ctx.db, started.runId);
    expect(run).toMatchObject({ state: 'ended', endReason: 'finished' });
    // a-thing first: b-thing depends on it.
    expect(listRunChanges(ctx.db, started.runId).map((c) => [c.change, c.state, c.branch])).toEqual(
      [
        ['a-thing', 'green', 'cp/a-thing'],
        ['b-thing', 'green', 'cp/b-thing'],
      ],
    );
    expect(delivered).toEqual(['a-thing', 'b-thing']);
    const log = await runGit(ctx.repo.root, ['log', '--format=%s', 'cp/a-thing']);
    expect(log.stdout.split('\n')[0]).toBe('cp: a-thing session 1');
    // The handoff left the worktree for the run folder.
    const worktree = listRunChanges(ctx.db, started.runId)[0]?.worktree as string;
    expect(existsSync(join(worktree, HANDOFF_FILE))).toBe(false);
    const view = o.view('cena');
    expect(view?.changes.map((c) => c.prUrl)).toEqual([
      'https://github.com/x/y/pull/1',
      'https://github.com/x/y/pull/2',
    ]);
    expect(view?.budgetLabel).toBe('40% of 1M = 400k tokens');
  });

  it('gives a failing gate back to the next session, parks at the attempt limit, and moves on', async () => {
    const ctx = await host();
    const sessions = fakeSessions();
    const g = gates(['fail', 'fail', 'pass']);
    const { o } = orchestrator(ctx, { startBuilderSession: sessions.start, runGateRound: g.round });
    const started = await o.start('cena', SETTINGS);
    if (!started.ok) throw new Error(started.error);
    await o.idle();
    expect(g.calls).toEqual([1, 2, 1]);
    expect(sessions.prompts[1]).toContain('The gate "unit" failed on attempt 1 (exit code 1)');
    expect(
      listRunChanges(ctx.db, started.runId).map((c) => [c.change, c.state, c.attempts]),
    ).toEqual([
      ['a-thing', 'parked', 2],
      ['b-thing', 'green', 0],
    ]);
    const items = runNeedsYou(ctx.db, 'cena');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'parked',
      changeId: 'a-thing',
      reason: expect.stringMatching(/Gate "unit" failed 2 times/),
    });
  });

  it('stops the run on an authentication error and says so in Needs You', async () => {
    const ctx = await host();
    const sessions = fakeSessions(() => ({
      reason: 'error',
      outcome: { kind: 'stop', cause: 'auth', detail: 'Invalid API key' },
    }));
    const { o } = orchestrator(ctx, {
      startBuilderSession: sessions.start,
      runGateRound: gates([]).round,
    });
    const started = await o.start('cena', SETTINGS);
    if (!started.ok) throw new Error(started.error);
    await o.idle();
    expect(getRun(ctx.db, started.runId)).toMatchObject({
      endReason: 'error',
      endDetail: expect.stringMatching(/not signed in/),
    });
    expect(listRunChanges(ctx.db, started.runId).map((c) => c.state)).toEqual([
      'stopped',
      'stopped',
    ]);
    expect(runNeedsYou(ctx.db, 'cena')[0]).toMatchObject({ kind: 'run-stopped' });
    // The session's work was still committed.
    const log = await runGit(ctx.repo.root, ['log', '--format=%s', '-1', 'cp/a-thing']);
    expect(log.stdout.trim()).toBe('cp: a-thing session 1');
  });

  it('runs a session again after a usage limit, counting nothing, and backs off on API errors', async () => {
    const ctx = await host();
    const sessions = fakeSessions((n) =>
      n === 1
        ? { reason: 'error', outcome: { kind: 'usage-limit', resetsAt: null, detail: 'limit' } }
        : n === 2
          ? { reason: 'error', outcome: { kind: 'transient', detail: 'overloaded' } }
          : {},
    );
    const slept: number[] = [];
    const { o } = orchestrator(ctx, {
      startBuilderSession: sessions.start,
      runGateRound: gates([]).round,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    const started = await o.start('cena', { ...SETTINGS, changes: ['a-thing'] });
    if (!started.ok) throw new Error(started.error);
    await o.idle();
    expect(sessions.count()).toBe(3);
    expect(slept).toEqual([60_000]);
    expect(listRunChanges(ctx.db, started.runId)[0]).toMatchObject({ state: 'green', attempts: 0 });
  });

  it('stops at a clean point: the session hands off, the rest is recorded as not built', async () => {
    const ctx = await host();
    const sessions = fakeSessions(() => ({ wait: true }));
    const { o } = orchestrator(ctx, {
      startBuilderSession: sessions.start,
      runGateRound: gates([]).round,
    });
    const started = await o.start('cena', SETTINGS);
    if (!started.ok) throw new Error(started.error);
    while (sessions.count() === 0) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(o.stop('cena')).toBe(true);
    await o.idle();
    expect(getRun(ctx.db, started.runId)).toMatchObject({ endReason: 'stopped' });
    const changes = listRunChanges(ctx.db, started.runId);
    expect(changes.map((c) => c.state)).toEqual(['stopped', 'stopped']);
    expect(changes[0]?.reason).toMatch(/clean point/);
    expect(changes[1]?.reason).toMatch(/Not built/);
    const log = await runGit(ctx.repo.root, ['log', '--format=%s', '-1', 'cp/a-thing']);
    expect(log.stdout.trim()).toBe('cp: a-thing session 1');
  });

  it('stops building a change whose approval changed, and goes on with the next', async () => {
    const ctx = await host();
    const sessions = fakeSessions((n) => (n === 1 ? { reason: 'budget-handoff' } : {}));
    const { o } = orchestrator(ctx, {
      startBuilderSession: sessions.start,
      runGateRound: gates([]).round,
      states: (change, n) =>
        change === 'a-thing' && n >= 3
          ? ({ state: 'changed' } as unknown as ApprovalState)
          : onRunway(ctx.repo.commit, change),
    });
    const started = await o.start('cena', SETTINGS);
    if (!started.ok) throw new Error(started.error);
    await o.idle();
    const changes = listRunChanges(ctx.db, started.runId);
    expect(changes[0]).toMatchObject({
      change: 'a-thing',
      state: 'skipped',
      reason: expect.stringMatching(/approved version changed/),
    });
    expect(changes[1]).toMatchObject({ change: 'b-thing', state: 'green' });
  });

  it('runs doctor itself when only the claude version changed, and goes on when it passes', async () => {
    const ctx = await host();
    let checked = false;
    const gate: DoctorGate = () =>
      checked ? { ok: true } : { ok: false, reason: 'claude version changed', rerun: true };
    let doctorRuns = 0;
    const { o } = orchestrator(ctx, {
      gate,
      startBuilderSession: fakeSessions().start,
      runGateRound: gates([]).round,
      runDoctor: async () => {
        doctorRuns += 1;
        checked = true;
        return { passed: true, detail: 'Boxed in.' };
      },
    });
    const started = await o.start('cena', { ...SETTINGS, changes: ['a-thing'] });
    if (!started.ok) throw new Error(started.error);
    await o.idle();
    expect(doctorRuns).toBe(1);
    expect(getRun(ctx.db, started.runId)?.endReason).toBe('finished');

    const ctx2 = await host();
    const refused = orchestrator(ctx2, {
      gate: () => ({ ok: false, reason: 'claude version changed', rerun: true }),
      runDoctor: async () => ({ passed: false, detail: 'gh credentials reachable' }),
    });
    const second = await refused.o.start('cena', SETTINGS);
    if (!second.ok) throw new Error(second.error);
    await refused.o.idle();
    expect(getRun(ctx2.db, second.runId)).toMatchObject({
      endReason: 'refused',
      endDetail: expect.stringMatching(/doctor did not pass on the new version/),
    });
  });
});

describe('crash recovery', () => {
  it('ends what a killed daemon left, commits the interrupted session and resumes the run', async () => {
    const ctx = await host();
    // A run cut off mid-build: a worktree with uncommitted work and a session with no end.
    const sessions = fakeSessions(() => ({ wait: true }));
    const first = orchestrator(ctx, {
      startBuilderSession: sessions.start,
      runGateRound: gates([]).round,
    });
    const started = await first.o.start('cena', { ...SETTINGS, changes: ['a-thing'] });
    if (!started.ok) throw new Error(started.error);
    while (sessions.count() === 0) await new Promise((resolve) => setTimeout(resolve, 20));
    // Simulate the crash: the store says building, a session row has no end, files are dirty.
    const change = listRunChanges(ctx.db, started.runId)[0];
    if (change?.worktree == null) throw new Error('no worktree');
    const sessionId = insertAgentSession(ctx.db, {
      hostId: 'cena',
      runChangeId: change.id,
      kind: 'builder',
      number: 2,
      model: 'opus',
      claudeVersion: VERSION,
      processTag: 'deadbeefdeadbeefdeadbeefdeadbeef',
      rawLogPath: join(ctx.home, 'x.jsonl'),
    });
    expect(sessionId).toBeGreaterThan(0);
    writeFileSync(join(change.worktree, 'src', 'half-done.ts'), 'export const half = 1;\n');

    // A fresh daemon's view of the same store (the first orchestrator never ended its run there).
    const db2 = openStore(ctx.home);
    db2
      .prepare("UPDATE runs SET state = 'running', ended_at = NULL, end_reason = NULL WHERE id = ?")
      .run(started.runId);
    const swept: string[] = [];
    const report = await recoverRuns({
      home: ctx.home,
      db: db2,
      host: () => ctx.runtime,
      sweep: async (_name, tag) => {
        swept.push(tag);
        return { found: [], error: null };
      },
    });
    expect(report.runId).toBe(started.runId);
    expect(swept).toContain('deadbeefdeadbeefdeadbeefdeadbeef');
    expect(openAgentSessions(db2).filter((s) => s.id === sessionId)).toEqual([]);
    const log = await runGit(change.worktree, ['log', '--format=%s', '-1']);
    expect(log.stdout.trim()).toMatch(/^cp: a-thing session \d+ \(interrupted\)$/);
    first.o.stop();
    await first.o.idle();
  });

  it('resumes a run from the store and ends one whose stop time passed', async () => {
    const ctx = await host();
    insertRun(ctx.db, {
      id: 'old-run',
      hostId: 'cena',
      settings: { ...SETTINGS, changes: ['a-thing'], claudeVersion: VERSION },
      stopAt: Date.now() - 1000,
    });
    insertRunChange(ctx.db, { runId: 'old-run', change: 'a-thing', position: 0 });
    const { o } = orchestrator(ctx, {
      startBuilderSession: fakeSessions().start,
      runGateRound: gates([]).round,
    });
    o.resume('old-run');
    expect(getRun(ctx.db, 'old-run')).toMatchObject({ state: 'ended', endReason: 'stop-time' });

    insertRun(ctx.db, {
      id: 'go-on',
      hostId: 'cena',
      settings: { ...SETTINGS, changes: ['a-thing'], claudeVersion: VERSION },
      stopAt: null,
    });
    const id = insertRunChange(ctx.db, { runId: 'go-on', change: 'a-thing', position: 0 });
    updateRunChange(ctx.db, id, { state: 'queued' });
    expect(activeRun(ctx.db)?.id).toBe('go-on');
    o.resume('go-on');
    await o.idle();
    expect(latestRun(ctx.db, 'cena')).toMatchObject({ id: 'go-on', endReason: 'finished' });
    expect(listGateResults(ctx.db, id)).toEqual([]);
    expect(readFileSync(join(ctx.repo.root, '.gitignore'), 'utf8')).toBe('node_modules\n');
  });
});

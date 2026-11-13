// The build orchestrator over a real OpenSpec host, real worktrees and the real store, with the
// builder sessions and gate rounds played by fakes (no claude), and the owner's approvals in the
// store.
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createOpenSpecAdapter } from '../../src/adapters/openspec/index.ts';
import type { AgentRunner } from '../../src/agent/runner.ts';
import type {
  BuilderSession,
  BuilderSessionResult,
  startBuilderSession,
} from '../../src/build/builder-session.ts';
import type { GateRound, runGateRound } from '../../src/build/gates.ts';
import { Governor, type SessionOutcome } from '../../src/build/governor.ts';
import { DEFAULT_HOST_SETTINGS, writeHostSettings } from '../../src/build/host-settings.ts';
import {
  Orchestrator,
  type OrchestratorOptions,
  type RunHost,
} from '../../src/build/orchestrator.ts';
import { BLOCKED_FILE, HANDOFF_FILE } from '../../src/build/prompt.ts';
import { recoverRuns } from '../../src/build/recovery.ts';
import { missingRunTools } from '../../src/build/tools.ts';
import { createGitFileReader } from '../../src/core/git/reader.ts';
import { runGit } from '../../src/core/git/run.ts';
import { runNeedsYou } from '../../src/core/runway/run-items.ts';
import { approveChange, withdrawApproval } from '../../src/core/store/approvals.ts';
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
import { createApprovalViews } from '../../src/server/approval-views.ts';
import { commitChange, materializeOpenSpecHost } from '../helpers/fixture-repo.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

const cleanup: string[] = [];
afterAll(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
  removeScratchDirs();
});

const VERSION = '2.1.322 (Claude Code)';
const proposal = (title: string) => `# ${title}\n\n## Why\n\nBecause.\n`;
const tasks = '# Tasks\n\n- [ ] 1.1 Do it\n- [ ] 1.2 Test it\n';

async function host(extra: Record<string, string> = {}, approved = ['a-thing', 'b-thing']) {
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
    ...extra,
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
  // The owner approved the changes.
  for (const change of approved) {
    approveChange(db, { hostId: 'cena', change, baseCommit: repo.commit });
  }
  const runtime: RunHost = {
    host: row,
    reader: createGitFileReader(repo.root),
    adapter: createOpenSpecAdapter(),
  };
  return { repo, home, db, runtime };
}

const OK: SessionOutcome = { kind: 'ok' };

/** Ticks every task of the worktree's change (the worktree folder is named for the change). */
function tickAll(cwd: string): void {
  const path = join(cwd, 'openspec', 'changes', basename(cwd), 'tasks.md');
  writeFileSync(path, readFileSync(path, 'utf8').replaceAll('- [ ]', '- [x]'));
}

/**
 * A builder session that writes a file and a handoff, then ends as told. A session that finishes
 * has done its change's tasks unless `tick: false`; `idle` writes no code; `blocked` leaves a note.
 */
function fakeSessions(
  plan: (
    n: number,
    cwd: string,
  ) => {
    reason?: BuilderSessionResult['reason'];
    outcome?: SessionOutcome;
    wait?: boolean;
    tick?: boolean;
    idle?: boolean;
    blocked?: string;
  } = () => ({}),
) {
  const prompts: string[] = [];
  let n = 0;
  const start: typeof startBuilderSession = async (input) => {
    n += 1;
    prompts.push(input.prompt);
    const step = plan(n, input.cwd);
    const reason = step.wait === true ? 'stop-handoff' : (step.reason ?? 'finished');
    if (step.idle !== true) {
      writeFileSync(join(input.cwd, 'src', `session-${n}.ts`), `export const n = ${n};\n`);
    }
    if (step.tick ?? reason === 'finished') tickAll(input.cwd);
    if (step.blocked !== undefined) writeFileSync(join(input.cwd, BLOCKED_FILE), step.blocked);
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
          reason,
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
  over: Partial<OrchestratorOptions> = {},
) {
  const events: Record<string, unknown>[] = [];
  const delivered: string[] = [];
  const o = new Orchestrator({
    home: ctx.home,
    db: ctx.db,
    host: (id) => (id === 'cena' ? ctx.runtime : null),
    approvals: createApprovalViews({ store: ctx.db }),
    governor: new Governor({ db: ctx.db }),
    runnerFactory: () => runner,
    consolePort: 4170,
    publish: (_host, payload) => events.push(payload),
    deliver: async (c) => {
      delivered.push(c.change.id);
      return { prUrl: `https://github.com/x/y/pull/${delivered.length}`, previewUrl: null };
    },
    calibrateWindow: async () => 1_000_000,
    sleep: async () => {},
    ownerEnv: async () => ({ env: OWNER_ENV, fallback: null }),
    missingRunTools: () => [],
    ...over,
  });
  return { o, events, delivered };
}

const SETTINGS = { changes: null, stopAt: null, model: 'opus', budgetPercent: 40 };
/** b-thing without its dependency on a-thing: a park of a-thing does not hold it back. */
const INDEPENDENT = { 'openspec/changes/b-thing/.openspec.yaml': 'schema: spec-driven\n' };
/** The owner's login environment, as the run reads it at its start. */
const OWNER_ENV = { PATH: process.env.PATH ?? '', HOME: '/Users/owner', GH_TOKEN: 'gho_owner' };

describe('starting a run', () => {
  it('refuses bad settings, an unknown host, off-runway changes and a second run', async () => {
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

  it("builds with the project's saved settings, recorded with the run; the CLI may override effort", async () => {
    const ctx = await host();
    writeHostSettings(ctx.db, 'cena', {
      model: 'sonnet',
      effort: 'max',
      budgetPercent: 30,
      maxTurns: 300,
      maxBudgetUsd: 30,
      sessionsPerAttempt: 2,
    });
    const inputs: Array<Parameters<typeof startBuilderSession>[0]> = [];
    // Every session hands off at the budget, so only the sessions-per-attempt limit ends the
    // attempt; the tasks are done by then, so the gates run.
    const sessions = fakeSessions(() => ({ reason: 'budget-handoff', tick: true }));
    const g = gates(['pass']);
    const { o } = orchestrator(ctx, {
      startBuilderSession: async (input) => {
        inputs.push(input);
        return sessions.start(input);
      },
      runGateRound: g.round,
    });
    const started = await o.start('cena', { changes: ['a-thing'], stopAt: null });
    if (!started.ok) throw new Error(started.error);
    await o.idle();

    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({
      model: 'sonnet',
      effort: 'max',
      budgetPercent: 30,
      maxTurns: 300,
      maxBudgetUsd: 30,
    });
    expect(g.calls).toEqual([1]);
    expect(o.view('cena')?.settings).toMatchObject({ model: 'sonnet', effort: 'max' });

    // A setting saved later applies to the next run only; a CLI flag overrides for one run.
    writeHostSettings(ctx.db, 'cena', { ...DEFAULT_HOST_SETTINGS, effort: 'low' });
    expect(getRun(ctx.db, started.runId)?.settings).toMatchObject({ effort: 'max' });
    const next = await o.start('cena', { changes: ['a-thing'], stopAt: null, effort: 'medium' });
    if (!next.ok) throw new Error(next.error);
    await o.idle();
    expect(inputs.at(-1)).toMatchObject({ model: 'opus', effort: 'medium', maxTurns: 400 });
  });

  it('starts a fresh session when one stops with tasks still open, and builds once none is left', async () => {
    const ctx = await host();
    const sessions = fakeSessions((n) => (n === 1 ? { tick: false } : {}));
    const g = gates(['pass']);
    const { o, delivered } = orchestrator(ctx, {
      startBuilderSession: sessions.start,
      runGateRound: g.round,
    });
    const started = await o.start('cena', { ...SETTINGS, changes: ['a-thing'] });
    if (!started.ok) throw new Error(started.error);
    await o.idle();
    expect(sessions.count()).toBe(2);
    expect(sessions.prompts[1]).toContain('Session 1 handoff.');
    // The gates from the host config at the approved base are named in the prompt.
    expect(sessions.prompts[0]).toContain('On every attempt: unit (`pnpm test`).');
    expect(g.calls).toEqual([1]);
    expect(delivered).toEqual(['a-thing']);
    expect(listRunChanges(ctx.db, started.runId)[0]).toMatchObject({ state: 'green' });
  });

  it('parks a change whose tasks left wait on the owner: no gates, no PR', async () => {
    const ctx = await host();
    const sessions = fakeSessions(() => ({
      tick: false,
      blocked:
        '- 1.1 waits on the Owner: step that creates the Supabase project; 1.2 waits on it\n',
    }));
    const g = gates([]);
    const { o, delivered } = orchestrator(ctx, {
      startBuilderSession: sessions.start,
      runGateRound: g.round,
    });
    const started = await o.start('cena', { ...SETTINGS, changes: ['a-thing'] });
    if (!started.ok) throw new Error(started.error);
    await o.idle();
    expect(sessions.count()).toBe(1);
    expect(g.calls).toEqual([]);
    expect(delivered).toEqual([]);
    const change = listRunChanges(ctx.db, started.runId)[0];
    expect(change?.state).toBe('parked');
    expect(change?.reason).toBe(
      'Not built: 2 build tasks are still open and wait on you:\n- 1.1 waits on the Owner: step that creates the Supabase project; 1.2 waits on it\nThe branch cp/a-thing keeps the work so far.',
    );
    // The note left the worktree for the run folder; the work so far is committed.
    expect(existsSync(join(change?.worktree as string, BLOCKED_FILE))).toBe(false);
    const log = await runGit(ctx.repo.root, ['log', '--format=%s', '-1', 'cp/a-thing']);
    expect(log.stdout.trim()).toBe('cp: a-thing session 1');
    const items = runNeedsYou(ctx.db, 'cena');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'parked',
      changeId: 'a-thing',
      attempts: [],
      action: expect.stringMatching(/^Provide what the reason above names/),
    });
    expect(getRun(ctx.db, started.runId)).toMatchObject({ endReason: 'finished' });
  });

  it('parks a change when a session stops with tasks open and makes no progress', async () => {
    const ctx = await host();
    const sessions = fakeSessions((n) => (n === 1 ? { tick: false } : { tick: false, idle: true }));
    const g = gates([]);
    const { o } = orchestrator(ctx, { startBuilderSession: sessions.start, runGateRound: g.round });
    const started = await o.start('cena', { ...SETTINGS, changes: ['a-thing'] });
    if (!started.ok) throw new Error(started.error);
    await o.idle();
    expect(sessions.count()).toBe(2);
    expect(g.calls).toEqual([]);
    expect(listRunChanges(ctx.db, started.runId)[0]).toMatchObject({
      state: 'parked',
      reason: expect.stringMatching(
        /^Not built: The builder stopped with 2 build tasks still open and made no progress in session 2 \(next: 1\.1 Do it\)\. Its handoff says why\. The branch cp\/a-thing keeps the work so far\.$/,
      ),
    });
  });

  it("parks a change with tasks still open when the attempt's sessions are used up", async () => {
    const ctx = await host();
    writeHostSettings(ctx.db, 'cena', { ...DEFAULT_HOST_SETTINGS, sessionsPerAttempt: 2 });
    const sessions = fakeSessions(() => ({ reason: 'budget-handoff' }));
    const g = gates([]);
    const { o } = orchestrator(ctx, { startBuilderSession: sessions.start, runGateRound: g.round });
    const started = await o.start('cena', { ...SETTINGS, changes: ['a-thing'] });
    if (!started.ok) throw new Error(started.error);
    await o.idle();
    expect(sessions.count()).toBe(2);
    expect(g.calls).toEqual([]);
    expect(listRunChanges(ctx.db, started.runId)[0]).toMatchObject({
      state: 'parked',
      reason: expect.stringMatching(
        /^Not built: 2 build tasks are still open after 2 sessions, this attempt's limit \(next: 1\.1 Do it\)/,
      ),
    });
  });

  it('parks a green change whose delivery fails, with the reason, and goes on with the next', async () => {
    const ctx = await host(INDEPENDENT);
    const hosts: string[] = [];
    const { o } = orchestrator(ctx, {
      startBuilderSession: fakeSessions().start,
      runGateRound: gates(['pass', 'pass']).round,
      deliver: async (c) => {
        hosts.push(c.host.root);
        if (c.change.id === 'a-thing')
          throw new Error(
            'Pushing cp/a-thing failed: git push failed (exit 128): Permission denied (publickey)',
          );
        return { prUrl: 'https://github.com/x/y/pull/9', previewUrl: null };
      },
    });
    const started = await o.start('cena', { changes: null, stopAt: null });
    if (!started.ok) throw new Error(started.error);
    await o.idle();
    expect(hosts).toEqual([ctx.repo.root, ctx.repo.root]);
    const [a, b] = listRunChanges(ctx.db, started.runId);
    expect(a).toMatchObject({ change: 'a-thing', state: 'parked', prUrl: null });
    expect(a?.reason).toBe(
      'Every gate passed, but delivery failed: Pushing cp/a-thing failed: git push failed (exit 128): Permission denied (publickey). The branch cp/a-thing keeps the work.',
    );
    expect(b).toMatchObject({
      change: 'b-thing',
      state: 'green',
      prUrl: 'https://github.com/x/y/pull/9',
    });
  });

  it("records the host's preview deploy found in the background, before the run ends", async () => {
    const ctx = await host();
    const { o, events } = orchestrator(ctx, {
      startBuilderSession: fakeSessions().start,
      runGateRound: gates(['pass']).round,
      deliver: async () => ({
        prUrl: 'https://github.com/x/y/pull/1',
        previewUrl: null,
        previewLater: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return 'https://cena-a.vercel.app/';
        },
      }),
    });
    const started = await o.start('cena', { changes: ['a-thing'], stopAt: null });
    if (!started.ok) throw new Error(started.error);
    await o.idle();
    expect(listRunChanges(ctx.db, started.runId)[0]).toMatchObject({
      state: 'green',
      previewUrl: 'https://cena-a.vercel.app/',
    });
    const order = events.map((e) => (e.preview === true ? 'preview' : e.state)).filter(Boolean);
    expect(order.indexOf('preview')).toBeLessThan(order.indexOf('ended'));
  });

  it('ends a preview lookup at once when the owner stops the run', async () => {
    const ctx = await host();
    let aborted = false;
    let release: () => void = () => {};
    const { o } = orchestrator(ctx, {
      startBuilderSession: fakeSessions((n) => (n === 2 ? { wait: true } : {})).start,
      runGateRound: gates(['pass', 'pass']).round,
      deliver: async () => ({
        prUrl: 'https://github.com/x/y/pull/1',
        previewUrl: null,
        previewLater: (signal) =>
          new Promise((resolve) => {
            release = () => resolve(null);
            signal.addEventListener('abort', () => {
              aborted = true;
              resolve(null);
            });
          }),
      }),
    });
    const started = await o.start('cena', { changes: null, stopAt: null });
    if (!started.ok) throw new Error(started.error);
    // b-thing's session waits; a-thing is green with its lookup pending.
    for (let i = 0; i < 100 && listRunChanges(ctx.db, started.runId)[0]?.state !== 'green'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    o.stop('cena');
    await o.idle();
    release();
    expect(aborted).toBe(true);
    expect(getRun(ctx.db, started.runId)).toMatchObject({ state: 'ended', endReason: 'stopped' });
  });

  it('gives a failing gate back to the next session, parks at the attempt limit, and moves on', async () => {
    const ctx = await host(INDEPENDENT);
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

  // Seen live: the daemon's PATH predated the owner's Supabase install, and three builder
  // sessions were spent on a gate whose service could never start.
  it('stops before any session when a service program cannot be run, and says how to fix it', async () => {
    const ctx = await host();
    const sessions = fakeSessions();
    const g = gates([]);
    const { o } = orchestrator(ctx, {
      startBuilderSession: sessions.start,
      runGateRound: g.round,
      missingServicePrograms: () => [{ service: 'supabase', step: 'start', program: 'supabase' }],
    });
    const started = await o.start('cena', SETTINGS);
    if (!started.ok) throw new Error(started.error);
    await o.idle();
    expect(sessions.count()).toBe(0);
    expect(g.calls).toEqual([]);
    expect(getRun(ctx.db, started.runId)).toMatchObject({
      endReason: 'error',
      endDetail: expect.stringMatching(/needs "supabase", which is not on your login shell's PATH/),
    });
    // The changes are fine: they did not build, they are not parked.
    expect(listRunChanges(ctx.db, started.runId).map((c) => [c.state, c.attempts])).toEqual([
      ['stopped', 0],
      ['stopped', 0],
    ]);
    expect(runNeedsYou(ctx.db, 'cena')[0]).toMatchObject({ kind: 'run-stopped' });
  });

  it('parks on an ask-first question and shows it in Needs You with its options', async () => {
    const ctx = await host();
    const sessions = fakeSessions(() => ({
      tick: false,
      blocked: [
        '## Question',
        'Task: 1.1 Do it',
        'Question: The migration drops a table on the hosted database. Run it now?',
        'Options:',
        '1. Run it against the hosted database now',
        '2. Leave it for you to run after the merge',
        'Recommended: 2',
        'Waiting: 1.2',
        '',
      ].join('\n'),
    }));
    const { o, delivered } = orchestrator(ctx, {
      startBuilderSession: sessions.start,
      runGateRound: gates([]).round,
    });
    const started = await o.start('cena', { ...SETTINGS, changes: ['a-thing'] });
    if (!started.ok) throw new Error(started.error);
    await o.idle();
    expect(delivered).toEqual([]);
    const change = listRunChanges(ctx.db, started.runId)[0];
    expect(change?.state).toBe('parked');
    expect(change?.reason).toMatch(/wait on your answer to a question/);
    const [item] = runNeedsYou(ctx.db, 'cena');
    expect(item).toMatchObject({
      kind: 'parked',
      changeId: 'a-thing',
      questions: [
        {
          task: '1.1 Do it',
          text: 'The migration drops a table on the hosted database. Run it now?',
          options: [
            'Run it against the hosted database now',
            'Leave it for you to run after the merge',
          ],
          recommended: 1,
          waiting: ['1.2'],
        },
      ],
      action: expect.stringMatching(/^Pick an option/),
    });
  });

  it("ends before any session when gh is not on the owner's PATH, and names it in Needs You", async () => {
    const ctx = await host();
    const bin = makeScratchDir('cp-bin');
    for (const program of ['claude', 'git']) {
      writeFileSync(join(bin, program), '#!/bin/sh\n');
      chmodSync(join(bin, program), 0o755);
    }
    const sessions = fakeSessions();
    let calibrations = 0;
    const { o } = orchestrator(ctx, {
      ownerEnv: async () => ({ env: { PATH: bin }, fallback: null }),
      missingRunTools,
      startBuilderSession: sessions.start,
      runGateRound: gates([]).round,
      calibrateWindow: async () => {
        calibrations += 1;
        return 1_000_000;
      },
    });
    const started = await o.start('cena', SETTINGS);
    if (!started.ok) throw new Error(started.error);
    await o.idle();
    expect(sessions.count()).toBe(0);
    expect(calibrations).toBe(0);
    expect(getRun(ctx.db, started.runId)).toMatchObject({
      endReason: 'error',
      endDetail: expect.stringMatching(
        /^The run needs "gh", which is not on your login shell's PATH/,
      ),
    });
    // No change parked or charged: the machine's problem, not theirs.
    expect(listRunChanges(ctx.db, started.runId).map((c) => [c.state, c.attempts])).toEqual([
      ['stopped', 0],
      ['stopped', 0],
    ]);
    expect(runNeedsYou(ctx.db, 'cena')).toMatchObject([
      { kind: 'run-stopped', reason: expect.stringContaining('"gh"') },
    ]);
  });

  it('ends before any session when the host config cannot be read', async () => {
    const ctx = await host({ '.counterpoint/config.yaml': 'gates: [\n' });
    const sessions = fakeSessions();
    const { o } = orchestrator(ctx, {
      startBuilderSession: sessions.start,
      runGateRound: gates([]).round,
    });
    const started = await o.start('cena', SETTINGS);
    if (!started.ok) throw new Error(started.error);
    await o.idle();
    expect(sessions.count()).toBe(0);
    expect(getRun(ctx.db, started.runId)).toMatchObject({
      endReason: 'error',
      endDetail: expect.stringMatching(/^The host config cannot be read/),
    });
  });

  it('goes on after a park: builds the two others and skips the one that depends on it', async () => {
    const extra: Record<string, string> = {};
    for (const id of ['c-thing', 'd-thing']) {
      extra[`openspec/changes/${id}/.openspec.yaml`] = 'schema: spec-driven\n';
      extra[`openspec/changes/${id}/proposal.md`] = proposal(id);
      extra[`openspec/changes/${id}/tasks.md`] = tasks;
    }
    const ctx = await host(extra, ['a-thing', 'b-thing', 'c-thing', 'd-thing']);
    // a-thing's builder waits on the owner; every other change builds.
    const sessions = fakeSessions((_, cwd) =>
      basename(cwd) === 'a-thing'
        ? { tick: false, blocked: '- 1.1 waits on an Owner: step\n' }
        : {},
    );
    const { o, delivered } = orchestrator(ctx, {
      startBuilderSession: sessions.start,
      runGateRound: gates([]).round,
    });
    const started = await o.start('cena', SETTINGS);
    if (!started.ok) throw new Error(started.error);
    await o.idle();
    const states = Object.fromEntries(
      listRunChanges(ctx.db, started.runId).map((c) => [c.change, [c.state, c.reason]]),
    );
    expect(states['a-thing']?.[0]).toBe('parked');
    expect(states['b-thing']).toEqual([
      'skipped',
      'Waits on a-thing, which did not get built in this run.',
    ]);
    expect(states['c-thing']?.[0]).toBe('green');
    expect(states['d-thing']?.[0]).toBe('green');
    expect([...delivered].sort()).toEqual(['c-thing', 'd-thing']);
    expect(getRun(ctx.db, started.runId)).toMatchObject({ endReason: 'finished' });
  });

  it('parks a change Counterpoint fails on, and goes on with the next', async () => {
    const ctx = await host();
    const { o } = orchestrator(ctx, {
      startBuilderSession: fakeSessions().start,
      runGateRound: gates([]).round,
      prepareWorktree: async (input) => {
        if (input.change === 'a-thing') throw new Error('disk full');
        const { prepareWorktree } = await import('../../src/build/worktrees.ts');
        return prepareWorktree(input);
      },
    });
    const started = await o.start('cena', SETTINGS);
    if (!started.ok) throw new Error(started.error);
    await o.idle();
    expect(listRunChanges(ctx.db, started.runId).map((c) => [c.change, c.state])).toEqual([
      ['a-thing', 'parked'],
      ['b-thing', 'skipped'],
    ]);
    expect(listRunChanges(ctx.db, started.runId)[0]?.reason).toMatch(/disk full/);
    expect(getRun(ctx.db, started.runId)).toMatchObject({ endReason: 'finished' });
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

  it('builds a change whose plan was revised after approval, from the base-branch tip', async () => {
    const ctx = await host();
    const revised = await commitChange(
      ctx.repo.root,
      'openspec/changes/a-thing/tasks.md',
      '# Tasks\n\n- [ ] 1.1 Do it\n- [ ] 1.2 Test it\n- [ ] 1.3 Revised\n',
    );
    const sessions = fakeSessions();
    const { o } = orchestrator(ctx, {
      startBuilderSession: sessions.start,
      runGateRound: gates([]).round,
    });
    const started = await o.start('cena', { ...SETTINGS, changes: ['a-thing'] });
    if (!started.ok) throw new Error(started.error);
    await o.idle();
    expect(listRunChanges(ctx.db, started.runId)[0]).toMatchObject({
      state: 'green',
      baseCommit: revised,
    });
    expect(sessions.prompts[0]).toBeDefined();
  });

  it('stops building a withdrawn change at its next handoff, keeps its branch, and goes on', async () => {
    const ctx = await host();
    // Session 1 of a-thing hands off at the budget; the owner withdraws it meanwhile.
    const sessions = fakeSessions((n) => {
      if (n === 1) {
        withdrawApproval(ctx.db, 'cena', 'a-thing');
        return { reason: 'budget-handoff' };
      }
      return {};
    });
    const { o } = orchestrator(ctx, {
      startBuilderSession: sessions.start,
      runGateRound: gates([]).round,
    });
    const started = await o.start('cena', SETTINGS);
    if (!started.ok) throw new Error(started.error);
    await o.idle();
    const changes = listRunChanges(ctx.db, started.runId);
    expect(changes[0]).toMatchObject({
      change: 'a-thing',
      state: 'skipped',
      reason: expect.stringMatching(/approval was withdrawn.*cp\/a-thing keeps the work/),
    });
    expect(changes[1]).toMatchObject({ change: 'b-thing', state: 'green' });
    // Session 1's work stays on the branch.
    const log = await runGit(ctx.repo.root, ['log', '--format=%s', 'cp/a-thing']);
    expect(log.stdout.split('\n')[0]).toBe('cp: a-thing session 1');
  });

  it('does not start a change withdrawn before its turn', async () => {
    const ctx = await host();
    const sessions = fakeSessions((n) => {
      if (n === 1) withdrawApproval(ctx.db, 'cena', 'b-thing');
      return {};
    });
    const { o } = orchestrator(ctx, {
      startBuilderSession: sessions.start,
      runGateRound: gates([]).round,
    });
    const started = await o.start('cena', SETTINGS);
    if (!started.ok) throw new Error(started.error);
    await o.idle();
    expect(listRunChanges(ctx.db, started.runId).map((c) => [c.change, c.state])).toEqual([
      ['a-thing', 'green'],
      ['b-thing', 'skipped'],
    ]);
    expect(sessions.count()).toBe(1);
  });
});

describe("the owner's environment", () => {
  it('reads it once at run start and gives it to every session, gate, service and delivery', async () => {
    const ctx = await host();
    const envs: Array<[string, unknown]> = [];
    const sessions = fakeSessions();
    const g = gates(['pass', 'pass']);
    let reads = 0;
    const { o } = orchestrator(ctx, {
      ownerEnv: async () => {
        reads += 1;
        return { env: OWNER_ENV, fallback: null };
      },
      runnerFactory: (env) => {
        envs.push(['runner', env]);
        return runner;
      },
      startBuilderSession: async (input) => {
        envs.push(['session', input.env]);
        return sessions.start(input);
      },
      runGateRound: async (input) => {
        envs.push(['gates', input.parentEnv]);
        return g.round(input);
      },
      missingServicePrograms: (_config, env) => {
        envs.push(['services', env]);
        return [];
      },
      deliver: async (c) => {
        envs.push(['deliver', c.env]);
        return { prUrl: null, previewUrl: null };
      },
    });
    const started = await o.start('cena', SETTINGS);
    if (!started.ok) throw new Error(started.error);
    await o.idle();
    expect(reads).toBe(1);
    expect(new Set(envs.map(([what]) => what))).toEqual(
      new Set(['runner', 'session', 'gates', 'services', 'deliver']),
    );
    for (const [, env] of envs) expect(env).toEqual(OWNER_ENV);
    expect(runNeedsYou(ctx.db, 'cena').filter((item) => item.kind === 'notice')).toEqual([]);
  });

  it("goes on with the daemon's environment when the login shell hangs, and says so in Needs You", async () => {
    const ctx = await host();
    const { o } = orchestrator(ctx, {
      ownerEnv: async () => ({
        env: { PATH: process.env.PATH ?? '' },
        fallback:
          "Your login shell's environment could not be read (it did not finish within 10 seconds), so this run used the environment Counterpoint was started with.",
      }),
      startBuilderSession: fakeSessions().start,
      runGateRound: gates(['pass', 'pass']).round,
    });
    const started = await o.start('cena', SETTINGS);
    if (!started.ok) throw new Error(started.error);
    await o.idle();
    expect(getRun(ctx.db, started.runId)).toMatchObject({ endReason: 'finished' });
    const notes = runNeedsYou(ctx.db, 'cena').filter((item) => item.kind === 'notice');
    expect(notes).toHaveLength(1);
    expect(notes[0]?.reason).toMatch(/did not finish within 10 seconds/);
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

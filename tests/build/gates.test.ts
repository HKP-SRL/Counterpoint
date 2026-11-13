// Gates around the runner: the tag sweep, the shared test lock, host services, gate rounds with
// retries and parking, and the protected-path check.
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  blocksMerge,
  isTestPath,
  measureTestShare,
  parseNameStatus,
  parseNumstat,
  planningEdits,
} from '../../src/build/branch-diff.ts';
import type { GateRunResult } from '../../src/build/gate-runner.ts';
import { afterGateRound, changedFiles, gateCommand, runGateRound } from '../../src/build/gates.ts';
import { taggedFromListings } from '../../src/build/process-sweep.ts';
import {
  createServiceSession,
  describeMissingPrograms,
  missingServicePrograms,
  parseEnvLines,
  runServiceCommand,
  type ServiceCommandRunner,
  type ServiceSession,
  writeWorktreeFile,
} from '../../src/build/services.ts';
import { acquireTestLock, TEST_LOCK_HELD_ENV, TestLockTimeout } from '../../src/build/test-lock.ts';
import {
  EMPTY_HOST_CONFIG,
  type HostConfig,
  parseHostConfig,
} from '../../src/core/host/host-config.ts';
import { openStore, type Store, upsertHost } from '../../src/core/store/db.ts';
import {
  getRunChange,
  insertRun,
  insertRunChange,
  listGateResults,
} from '../../src/core/store/runs.ts';
import {
  gitIn,
  initScratchRepo,
  makeScratchDir,
  removeScratchDirs,
  writeFileIn,
} from '../helpers/scratch.ts';

afterAll(() => {
  removeScratchDirs();
});

// --- the tag sweep ------------------------------------------------------------------------------

describe('taggedFromListings', () => {
  const TAG = 'aaaabbbbccccdddd';
  const args = [
    '  101 node vitest run',
    '  102 grep CP_GATE_RUN=aaaabbbbccccdddd',
    '  103 next dev',
    '  104 sleep 30',
    '  105 node other',
  ].join('\n');
  const withEnv = [
    '  101 node vitest run PATH=/bin CP_GATE_RUN=aaaabbbbccccdddd HOME=/h',
    '  102 grep CP_GATE_RUN=aaaabbbbccccdddd PATH=/bin',
    '  103 next dev CP_GATE_RUN=aaaabbbbccccdddd',
    '  104 sleep 30 CP_GATE_RUN=aaaabbbbccccdddX',
    '  105 node other XCP_GATE_RUN=aaaabbbbccccdddd',
  ].join('\n');

  it('matches the tag in the environment only, as a whole variable', () => {
    expect(taggedFromListings(args, withEnv, 'CP_GATE_RUN', TAG)).toEqual([
      { pid: 101, command: 'node vitest run' },
      { pid: 103, command: 'next dev' },
    ]);
  });

  it('skips excluded pids and refuses a malformed tag or name', () => {
    expect(
      taggedFromListings(args, withEnv, 'CP_GATE_RUN', TAG, new Set([101])).map((p) => p.pid),
    ).toEqual([103]);
    expect(() => taggedFromListings(args, withEnv, 'CP_GATE_RUN', 'x y')).toThrow();
    expect(() => taggedFromListings(args, withEnv, 'cp gate', TAG)).toThrow();
  });
});

// --- the test lock ------------------------------------------------------------------------------

describe('the shared test lock', () => {
  it('is held by one holder at a time, notes the holder, and marks the gate environment', async () => {
    const file = join(makeScratchDir('cp-lock'), 'test.lock');
    const held = await acquireTestLock({ file, waitMs: 5000, note: 'gate unit for a' });
    expect(held.env).toEqual({ [TEST_LOCK_HELD_ENV]: String(process.pid) });
    expect(readFileSync(`${file}.holder`, 'utf8')).toContain('gate unit for a');
    let told = '';
    await expect(
      acquireTestLock({ file, waitMs: 1500, note: 'second', onWait: (h) => (told = h) }),
    ).rejects.toBeInstanceOf(TestLockTimeout);
    expect(told).toContain('gate unit for a');
    held.release();
    expect(existsSync(`${file}.holder`)).toBe(false);
    const again = await acquireTestLock({ file, waitMs: 1000, note: 'third' });
    again.release();
  });

  it('stops waiting when the run stops', async () => {
    const file = join(makeScratchDir('cp-lock'), 'test.lock');
    const held = await acquireTestLock({ file, waitMs: 5000, note: 'first' });
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('run stopped')), 300);
    await expect(
      acquireTestLock({ file, waitMs: 60_000, note: 'second', signal: controller.signal }),
    ).rejects.toThrow('run stopped');
    held.release();
  });

  it('is released by the kernel when its holder dies', async () => {
    const file = join(makeScratchDir('cp-lock'), 'test.lock');
    const holder = spawn(
      process.execPath,
      [
        '-e',
        `const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(${JSON.stringify(file)}); db.exec('BEGIN EXCLUSIVE'); console.log('held'); setInterval(() => {}, 1000);`,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    await new Promise<void>((resolve) => holder.stdout?.once('data', () => resolve()));
    await expect(acquireTestLock({ file, waitMs: 1200, note: 'x' })).rejects.toBeInstanceOf(
      TestLockTimeout,
    );
    holder.kill('SIGKILL');
    await new Promise((resolve) => holder.once('exit', resolve));
    const held = await acquireTestLock({ file, waitMs: 5000, note: 'after the crash' });
    held.release();
  });
});

// --- host services ------------------------------------------------------------------------------

const SUPABASE_CONFIG = parseHostConfig({
  gates: [
    { name: 'unit', command: ['pnpm', 'vitest', 'run'], services: ['supabase'], testLock: true },
    { name: 'lint', command: ['pnpm', 'lint'] },
  ],
  services: {
    supabase: {
      start: ['supabase', 'start'],
      reset: ['supabase', 'db', 'reset'],
      env: {
        command: ['supabase', 'status', '-o', 'env'],
        map: { NEXT_PUBLIC_SUPABASE_URL: 'API_URL', SUPABASE_KEY: 'ANON_KEY' },
        file: '.env.local',
      },
    },
  },
});

function fakeServices(
  calls: string[],
  status = 'API_URL="http://127.0.0.1:54321"\nANON_KEY="eyJ.a b"\n',
  failOn?: string,
): ServiceCommandRunner {
  return async ({ argv, cwd, env }) => {
    calls.push(`${argv.join(' ')} @${cwd === '' ? '?' : 'wt'} ci=${env.CI}`);
    const failed = failOn !== undefined && argv.join(' ') === failOn;
    return {
      exitCode: failed ? 1 : 0,
      timedOut: false,
      stopped: false,
      stdout: argv.includes('status') ? status : '',
      output: failed ? 'migration 0042 failed: syntax error' : '',
    };
  };
}

describe('host services', () => {
  it('parses KEY=value lines, quoted or not', () => {
    const values = parseEnvLines('API_URL="http://x:1"\nexport B=\'two\'\nC=plain\nnot a line\n');
    expect(Object.fromEntries(values)).toEqual({ API_URL: 'http://x:1', B: 'two', C: 'plain' });
  });

  it('starts once per session, resets before every gate, maps the env and writes the file', async () => {
    const worktree = makeScratchDir('cp-svc');
    const calls: string[] = [];
    const session = createServiceSession({
      config: SUPABASE_CONFIG,
      worktree,
      parentEnv: { PATH: '/bin', COUNTERPOINT_HOME: '/x', NODE_OPTIONS: '--x' },
      run: fakeServices(calls),
    });
    const unit = SUPABASE_CONFIG.gates[0];
    if (unit === undefined) throw new Error('no gate');
    const first = await session.prepare(unit, join(worktree, '..', 'logs'));
    expect(first).toEqual({
      ok: true,
      env: { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_KEY: 'eyJ.a b' },
    });
    expect(readFileSync(join(worktree, '.env.local'), 'utf8')).toBe(
      'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_KEY="eyJ.a b"\n',
    );
    session.cleanup();
    expect(existsSync(join(worktree, '.env.local'))).toBe(false);
    await session.prepare(unit, join(worktree, '..', 'logs'));
    session.cleanup();
    expect(calls).toEqual([
      'supabase start @wt ci=1',
      'supabase db reset @wt ci=1',
      'supabase status -o env @wt ci=1',
      'supabase db reset @wt ci=1',
      'supabase status -o env @wt ci=1',
    ]);
  });

  it('passes the service environment without Counterpoint variables or NODE_OPTIONS', async () => {
    const worktree = makeScratchDir('cp-svc');
    let seen: Record<string, string> = {};
    const session = createServiceSession({
      config: SUPABASE_CONFIG,
      worktree,
      parentEnv: {
        PATH: '/bin',
        DOCKER_HOST: 'unix:///d',
        COUNTERPOINT_HOME: '/x',
        NODE_OPTIONS: '-r x',
      },
      run: async (input) => {
        seen = input.env;
        return {
          exitCode: 0,
          timedOut: false,
          stopped: false,
          stdout: 'API_URL=a\nANON_KEY=b\n',
          output: '',
        };
      },
    });
    await session.prepare(SUPABASE_CONFIG.gates[0] as never, worktree);
    session.cleanup();
    expect(seen).toEqual({
      PATH: '/bin',
      DOCKER_HOST: 'unix:///d',
      CI: '1',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    });
  });

  it('fails with the step, the service output, and no env when a step fails', async () => {
    const worktree = makeScratchDir('cp-svc');
    const session = createServiceSession({
      config: SUPABASE_CONFIG,
      worktree,
      run: fakeServices([], undefined, 'supabase db reset'),
    });
    const prep = await session.prepare(SUPABASE_CONFIG.gates[0] as never, worktree);
    expect(prep).toEqual({
      ok: false,
      service: 'supabase',
      step: 'reset',
      detail: 'service supabase reset exited 1',
      tail: 'migration 0042 failed: syntax error',
    });
  });

  it('reports a program that could not be started as not started, apart from a failing one', async () => {
    const worktree = makeScratchDir('cp-svc');
    const config = parseHostConfig({
      gates: [{ name: 'unit', command: ['vitest'], services: ['db'] }],
      services: { db: { start: ['cp-no-such-program-0123', 'start'] } },
    });
    const session = createServiceSession({ config, worktree, run: runServiceCommand });
    const prep = await session.prepare(config.gates[0] as never, worktree);
    expect(prep).toMatchObject({
      ok: false,
      service: 'db',
      step: 'start',
      notStarted: true,
      detail: expect.stringMatching(
        /the db service's start program could not be run \(spawn cp-no-such-program-0123 ENOENT\)/,
      ),
    });
    expect(readFileSync(join(worktree, 'service-db-start.log'), 'utf8')).toMatch(/ENOENT/);
  });

  // A start that leaves its service running with the output still open (a database daemon) used
  // to hold the gate forever: the command had exited, but `close` never came.
  it('ends a service command when it exits, though what it started keeps the output open', async () => {
    const dir = makeScratchDir('cp-svc');
    const script = [
      "const { spawn } = require('node:child_process');",
      "const db = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {",
      "  detached: true, stdio: ['ignore', 'inherit', 'inherit'] });",
      'db.unref();',
      "console.log('db ' + db.pid);",
    ].join('\n');
    const started = Date.now();
    const result = await runServiceCommand({
      argv: [process.execPath, '-e', script],
      cwd: dir,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      timeoutMs: 30_000,
      logPath: join(dir, 'service-db-start.log'),
      drainMs: 300,
    });
    const db = Number(/db (\d+)/.exec(result.output)?.[1]);
    try {
      expect(result).toMatchObject({ exitCode: 0, timedOut: false, stopped: false });
      expect(Date.now() - started).toBeLessThan(10_000);
      // A service is meant to stay up: what the start left running is not killed.
      expect(() => process.kill(db, 0)).not.toThrow();
    } finally {
      process.kill(db, 'SIGKILL');
    }
  }, 30_000);

  it('ends a service command at once when the run stops after its timeout', async () => {
    const dir = makeScratchDir('cp-svc');
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 1500);
    const started = Date.now();
    // It ignores SIGTERM; the SIGKILL after its timeout is 5 s away.
    const result = await runServiceCommand({
      argv: [
        process.execPath,
        '-e',
        "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
      ],
      cwd: dir,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      timeoutMs: 500,
      logPath: join(dir, 'service-db-start.log'),
      signal: controller.signal,
      drainMs: 300,
    });
    expect(result).toMatchObject({ timedOut: true, stopped: true });
    expect(Date.now() - started).toBeLessThan(4000);
  }, 30_000);

  it('finds every service program a gate needs on PATH before a build, and names what is missing', () => {
    const bin = makeScratchDir('cp-bin');
    writeFileSync(join(bin, 'supabase'), '#!/bin/sh\n', { mode: 0o755 });
    const env = { PATH: `/nonexistent-cp:${bin}` };
    expect(missingServicePrograms(SUPABASE_CONFIG, env)).toEqual([]);

    // The terminal that started Counterpoint had an older PATH, without the CLI.
    const missing = missingServicePrograms(SUPABASE_CONFIG, { PATH: '/nonexistent-cp' });
    expect(missing).toEqual([
      { service: 'supabase', step: 'start', program: 'supabase' },
      { service: 'supabase', step: 'reset', program: 'supabase' },
      { service: 'supabase', step: 'env', program: 'supabase' },
    ]);
    expect(describeMissingPrograms(missing)).toBe(
      'The supabase service needs "supabase", which is not on your login shell\'s PATH. ' +
        "Install it or add it to your shell's PATH (in a new terminal, " +
        '"command -v supabase" should print a path), then start a new run. No restart is needed.',
    );

    // A file that is there but not executable is not runnable either.
    chmodSync(join(bin, 'supabase'), 0o644);
    expect(missingServicePrograms(SUPABASE_CONFIG, env)).toHaveLength(3);
  });

  it('checks absolute programs as files, leaves worktree paths to run time, and skips unused services', () => {
    const bin = makeScratchDir('cp-bin');
    const config = parseHostConfig({
      gates: [{ name: 'unit', command: ['vitest'], services: ['a', 'b'] }],
      services: {
        a: { start: [join(bin, 'missing'), 'up'] },
        b: { start: ['./bin/local', 'up'] },
        unused: { start: ['cp-no-such-program-0123'] },
      },
    });
    const missing = missingServicePrograms(config, { PATH: '' });
    expect(missing).toEqual([{ service: 'a', step: 'start', program: join(bin, 'missing') }]);
    expect(describeMissingPrograms(missing)).toBe(
      `The a service needs "${join(bin, 'missing')}", which is not an executable file.`,
    );
  });

  it('fails when the env command does not print a mapped variable', async () => {
    const worktree = makeScratchDir('cp-svc');
    const session = createServiceSession({
      config: SUPABASE_CONFIG,
      worktree,
      run: fakeServices([], 'API_URL=x\n'),
    });
    const prep = await session.prepare(SUPABASE_CONFIG.gates[0] as never, worktree);
    expect(prep).toMatchObject({
      ok: false,
      step: 'env',
      detail: expect.stringMatching(/ANON_KEY/),
    });
  });

  it('puts back a file that was there, and never writes through a link or outside the worktree', () => {
    const root = makeScratchDir('cp-svc');
    const worktree = join(root, 'wt');
    mkdirSync(worktree);
    writeFileSync(join(worktree, '.env.local'), 'OLD=1\n');
    const written = writeWorktreeFile(worktree, '.env.local', 'NEW=1\n');
    expect(readFileSync(join(worktree, '.env.local'), 'utf8')).toBe('NEW=1\n');
    expect(written.before?.toString()).toBe('OLD=1\n');

    const victim = join(root, 'owner-file');
    writeFileSync(victim, 'mine\n');
    symlinkSync(victim, join(worktree, '.env.test'));
    expect(() => writeWorktreeFile(worktree, '.env.test', 'X=1\n')).toThrow(/regular file/);
    symlinkSync(root, join(worktree, 'up'));
    expect(() => writeWorktreeFile(worktree, 'up/.env', 'X=1\n')).toThrow(/outside the worktree/);
    expect(readFileSync(victim, 'utf8')).toBe('mine\n');
    expect(existsSync(join(root, '.env'))).toBe(false);
  });

  it('restores the earlier file on cleanup', async () => {
    const worktree = makeScratchDir('cp-svc');
    writeFileSync(join(worktree, '.env.local'), 'OLD=1\n');
    const session = createServiceSession({
      config: SUPABASE_CONFIG,
      worktree,
      run: fakeServices([]),
    });
    await session.prepare(SUPABASE_CONFIG.gates[0] as never, worktree);
    expect(readFileSync(join(worktree, '.env.local'), 'utf8')).toContain('SUPABASE_KEY');
    session.cleanup();
    expect(readFileSync(join(worktree, '.env.local'), 'utf8')).toBe('OLD=1\n');
  });
});

// --- gate rounds, retries and parking -----------------------------------------------------------

function storeWithChange(): { db: Store; runChangeId: number; home: string } {
  const home = makeScratchDir('cp-round');
  const db = openStore(home);
  upsertHost(db, {
    id: 'cena',
    root: '/x',
    gitCommonDir: '/x/.git',
    baseBranch: 'master',
    adapter: 'openspec',
  });
  insertRun(db, { id: 'run-1', hostId: 'cena', settings: {}, stopAt: null });
  const runChangeId = insertRunChange(db, { runId: 'run-1', change: 'qr-menu', position: 0 });
  return { db, runChangeId, home };
}

const NO_SERVICES: ServiceSession = {
  prepare: async () => ({ ok: true, env: {} }),
  cleanup: () => {},
};

function result(over: Partial<GateRunResult> = {}): GateRunResult {
  return {
    verdict: 'pass',
    reason: null,
    exitCode: 0,
    signal: null,
    tail: '',
    survivors: [],
    durationMs: 5,
    processTag: 'x',
    testCount: null,
    ...over,
  };
}

function round(
  config: HostConfig,
  outcomes: Record<string, Partial<GateRunResult>>,
  extra: Partial<Parameters<typeof runGateRound>[0]> = {},
) {
  const { db, runChangeId, home } = storeWithChange();
  const ran: string[] = [];
  const commands: string[][] = [];
  const envs: Record<string, string>[] = [];
  const input = {
    db,
    runChangeId,
    change: 'qr-menu',
    attempt: 1,
    config,
    worktree: home,
    baseCommit: 'a'.repeat(40),
    changeDir: join(home, 'runs', 'run-1', 'qr-menu'),
    services: NO_SERVICES,
    changedFiles: async () => [],
    runGate: async (gate: Parameters<NonNullable<typeof extra.runGate>>[0]) => {
      ran.push(gate.gate.name);
      commands.push([...(gate.command ?? gate.gate.command)]);
      envs.push({ ...(gate.env ?? {}) });
      gate.onStart?.(9999);
      return result(outcomes[gate.gate.name] ?? {});
    },
    ...extra,
  };
  return { db, runChangeId, ran, commands, envs, input };
}

const TWO_GATES = parseHostConfig({
  gates: [
    { name: 'unit', command: ['pnpm', 'test'], testLock: true },
    { name: 'lint', command: ['pnpm', 'lint'] },
  ],
  attempts: 3,
});

describe('gate rounds', () => {
  it('runs every gate in order and records each; all passing is green', async () => {
    const r = round(
      TWO_GATES,
      {},
      {
        acquireTestLock: async () => ({
          env: { [TEST_LOCK_HELD_ENV]: '1' },
          waitedMs: 0,
          release() {},
        }),
      },
    );
    const out = await runGateRound(r.input);
    expect(out.kind).toBe('pass');
    expect(r.ran).toEqual(['unit', 'lint']);
    // The test lock's marker reaches only the gate that took it.
    expect(r.envs).toEqual([{ [TEST_LOCK_HELD_ENV]: '1' }, {}]);
    const rows = listGateResults(r.db, r.runChangeId);
    expect(rows.map((row) => [row.gate, row.attempt, row.verdict, row.pid])).toEqual([
      ['unit', 1, 'pass', 9999],
      ['lint', 1, 'pass', 9999],
    ]);
    expect(rows[0]?.logPath).toMatch(/runs\/run-1\/qr-menu\/gates\/1\/unit\.log$/);
    expect(afterGateRound(r.db, r.runChangeId, out, 3)).toEqual({ next: 'green' });
  });

  it('stops at the first failure and gives its last lines back to the builder', async () => {
    const r = round(
      TWO_GATES,
      {
        unit: { verdict: 'fail', reason: 'exit-code', exitCode: 1, tail: 'FAIL menu.test.ts' },
      },
      { acquireTestLock: async () => ({ env: {}, waitedMs: 0, release() {} }) },
    );
    const out = await runGateRound(r.input);
    expect(r.ran).toEqual(['unit']);
    expect(out).toMatchObject({
      kind: 'fail',
      failure: { gate: 'unit', attempt: 1, reason: 'exit code 1', tail: 'FAIL menu.test.ts' },
    });
    // The gate after the failure is recorded as not run.
    expect(listGateResults(r.db, r.runChangeId).map((row) => [row.gate, row.verdict])).toEqual([
      ['unit', 'fail'],
      ['lint', 'not-run'],
    ]);
    const next = afterGateRound(r.db, r.runChangeId, out, 3);
    expect(next).toEqual({
      next: 'retry',
      attempts: 1,
      feedback: { gate: 'unit', attempt: 1, reason: 'exit code 1', tail: 'FAIL menu.test.ts' },
    });
    expect(getRunChange(r.db, r.runChangeId)?.state).toBe('queued');
  });

  it('parks the change at the host attempts limit, with the failing gate', async () => {
    const config = { ...TWO_GATES, attempts: 2 };
    const r = round(
      config,
      { lint: { verdict: 'fail', reason: 'timeout', tail: '...' } },
      {
        acquireTestLock: async () => ({ env: {}, waitedMs: 0, release() {} }),
      },
    );
    const first = await runGateRound(r.input);
    expect(afterGateRound(r.db, r.runChangeId, first, 2)).toMatchObject({
      next: 'retry',
      attempts: 1,
    });
    const second = await runGateRound({ ...r.input, attempt: 2 });
    expect(afterGateRound(r.db, r.runChangeId, second, 2)).toEqual({
      next: 'park',
      attempts: 2,
      reason: 'Gate "lint" failed 2 times (last: timed out).',
    });
    const change = getRunChange(r.db, r.runChangeId);
    expect(change).toMatchObject({ state: 'parked', attempts: 2 });
    expect(
      listGateResults(r.db, r.runChangeId).map((row) => [row.attempt, row.gate, row.reason]),
    ).toEqual([
      [1, 'unit', null],
      [1, 'lint', 'timeout'],
      [2, 'unit', null],
      [2, 'lint', 'timeout'],
    ]);
  });

  it('counts nothing when the run stopped', async () => {
    const r = round(
      TWO_GATES,
      { unit: { verdict: 'fail', reason: 'stopped' } },
      {
        acquireTestLock: async () => ({ env: {}, waitedMs: 0, release() {} }),
      },
    );
    const out = await runGateRound(r.input);
    expect(out.kind).toBe('stopped');
    expect(afterGateRound(r.db, r.runChangeId, out, 3)).toEqual({ next: 'stopped' });
    expect(getRunChange(r.db, r.runChangeId)?.attempts).toBe(0);
  });

  it('parks at once, spending no attempt, when the test lock stays held', async () => {
    const r = round(
      TWO_GATES,
      {},
      {
        acquireTestLock: async () => {
          throw new TestLockTimeout(180, 'pid 1: another loop');
        },
      },
    );
    const out = await runGateRound(r.input);
    expect(r.ran).toEqual([]);
    expect(out.kind).toBe('blocked');
    const next = afterGateRound(r.db, r.runChangeId, out, 3);
    expect(next).toMatchObject({ next: 'park', attempts: 0 });
    expect(getRunChange(r.db, r.runChangeId)?.reason).toMatch(/test lock stayed held/);
    expect(listGateResults(r.db, r.runChangeId)[0]).toMatchObject({
      verdict: 'fail',
      reason: 'test-lock',
    });
  });

  it('fails the gate with the service output when a service step fails, and cleans up', async () => {
    let cleaned = 0;
    const r = round(
      TWO_GATES,
      {},
      {
        acquireTestLock: async () => ({ env: {}, waitedMs: 0, release() {} }),
        services: {
          prepare: async () => ({
            ok: false,
            service: 'supabase',
            step: 'reset',
            detail: 'service supabase reset exited 1',
            tail: 'migration failed',
          }),
          cleanup: () => {
            cleaned += 1;
          },
        },
      },
    );
    const out = await runGateRound(r.input);
    expect(r.ran).toEqual([]);
    expect(out).toMatchObject({
      kind: 'fail',
      failure: {
        gate: 'unit',
        reason: 'a service it needs failed',
        tail: 'service supabase reset exited 1\nmigration failed',
      },
    });
    expect(cleaned).toBe(1);
  });

  it('parks at once, spending no attempt, when a service program cannot be started', async () => {
    const r = round(
      TWO_GATES,
      {},
      {
        acquireTestLock: async () => ({ env: {}, waitedMs: 0, release() {} }),
        services: {
          prepare: async () => ({
            ok: false,
            service: 'supabase',
            step: 'start',
            detail: "the supabase service's start program could not be run (spawn supabase ENOENT)",
            tail: '',
            notStarted: true,
          }),
          cleanup: () => {},
        },
      },
    );
    const out = await runGateRound(r.input);
    expect(r.ran).toEqual([]);
    expect(out.kind).toBe('blocked');
    const next = afterGateRound(r.db, r.runChangeId, out, 3);
    expect(next).toMatchObject({ next: 'park', attempts: 0 });
    expect(getRunChange(r.db, r.runChangeId)?.reason).toMatch(
      /Gates could not run: .*spawn supabase ENOENT/,
    );
  });

  const TIERS = parseHostConfig({
    gates: [
      { name: 'suite', command: ['pnpm', 'vitest', 'run'], when: 'final' },
      { name: 'types', command: ['pnpm', 'tsc'] },
      { name: 'lint', command: ['pnpm', 'lint'] },
      { name: 'build', command: ['pnpm', 'build'], when: 'final' },
    ],
  });

  it('runs the every-attempt gates first and the final gates once they all pass', async () => {
    const r = round(TIERS, {});
    expect((await runGateRound(r.input)).kind).toBe('pass');
    expect(r.ran).toEqual(['types', 'lint', 'suite', 'build']);
  });

  it('does not run a final gate when an every-attempt gate fails', async () => {
    const r = round(TIERS, { lint: { verdict: 'fail', reason: 'exit-code', exitCode: 1 } });
    const out = await runGateRound(r.input);
    expect(out).toMatchObject({ kind: 'fail', failure: { gate: 'lint' } });
    expect(r.ran).toEqual(['types', 'lint']);
    expect(listGateResults(r.db, r.runChangeId).map((row) => [row.gate, row.verdict])).toEqual([
      ['types', 'pass'],
      ['lint', 'fail'],
      ['suite', 'not-run'],
      ['build', 'not-run'],
    ]);
  });

  it('counts a failing final gate as a failed attempt, and runs every tier again next time', async () => {
    const r = round(TIERS, { suite: { verdict: 'fail', reason: 'exit-code', exitCode: 1 } });
    const first = await runGateRound(r.input);
    expect(first).toMatchObject({ kind: 'fail', failure: { gate: 'suite' } });
    expect(afterGateRound(r.db, r.runChangeId, first, 3)).toMatchObject({
      next: 'retry',
      attempts: 1,
    });
    await runGateRound({ ...r.input, attempt: 2 });
    expect(r.ran).toEqual(['types', 'lint', 'suite', 'types', 'lint', 'suite']);
  });

  const CHANGED = parseHostConfig({
    gates: [
      { name: 'related', command: ['vitest', 'related', '--run', '{changed}'] },
      { name: 'ts-only', command: ['eslint', '{changed}'], paths: ['**/*.ts'] },
      { name: 'styles', command: ['stylelint', '{changed}'], paths: ['**/*.css'] },
    ],
  });

  it('expands {changed} to the changed files, one argument each, narrowed by paths', async () => {
    const r = round(CHANGED, {}, { changedFiles: async () => ['src/menu.ts', 'src/cart.ts'] });
    expect((await runGateRound(r.input)).kind).toBe('pass');
    expect(r.commands).toEqual([
      ['vitest', 'related', '--run', 'src/menu.ts', 'src/cart.ts'],
      ['eslint', 'src/menu.ts', 'src/cart.ts'],
    ]);
    // Nothing matched the stylesheet gate: it is skipped, neither passed nor failed.
    expect(listGateResults(r.db, r.runChangeId).map((row) => [row.gate, row.verdict])).toEqual([
      ['related', 'pass'],
      ['ts-only', 'pass'],
      ['styles', 'skipped'],
    ]);
  });

  it('skips a gate whose patterns match nothing the change touched, and stays green', async () => {
    const r = round(CHANGED, {}, { changedFiles: async () => ['app/theme.css'] });
    expect((await runGateRound(r.input)).kind).toBe('pass');
    expect(r.commands).toEqual([
      ['vitest', 'related', '--run', 'app/theme.css'],
      ['stylelint', 'app/theme.css'],
    ]);
    expect(
      listGateResults(r.db, r.runChangeId).find((row) => row.gate === 'ts-only')?.verdict,
    ).toBe('skipped');
  });

  it('lists the added and modified files since the base, not the deleted ones', async () => {
    const repo = makeScratchDir('cp-changed');
    await initScratchRepo(repo);
    writeFileIn(repo, 'src/old.ts', 'old\n');
    writeFileIn(repo, 'src/gone.ts', 'gone\n');
    await gitIn(repo, ['add', '-A']);
    await gitIn(repo, ['commit', '-q', '-m', 'base']);
    const base = (await gitIn(repo, ['rev-parse', 'HEAD'])).trim();
    writeFileIn(repo, 'src/old.ts', 'changed\n');
    writeFileIn(repo, 'src/new file.ts', 'new\n');
    await gitIn(repo, ['rm', '-q', 'src/gone.ts']);
    await gitIn(repo, ['add', '-A']);
    await gitIn(repo, ['commit', '-q', '-m', 'build']);
    expect((await changedFiles(repo, base)).sort()).toEqual(['src/new file.ts', 'src/old.ts']);
    const related = CHANGED.gates[0];
    if (related === undefined) throw new Error('no gate');
    expect(gateCommand(related, [])).toBeNull();
    expect(gateCommand({ ...related, command: ['pnpm', 'lint'] }, [])).toEqual(['pnpm', 'lint']);
  });

  it('a host with no gates is green with nothing run', async () => {
    const r = round(EMPTY_HOST_CONFIG as HostConfig, {});
    expect(await runGateRound(r.input)).toEqual({ kind: 'pass', entries: [] });
  });
});

// --- the branch diff -----------------------------------------------------------------------------

describe('the branch diff', () => {
  it('recognises test files by naming convention only', () => {
    for (const path of [
      'a.test.ts',
      'src/x/menu.spec.tsx',
      'src/__tests__/a.ts',
      'tests/e2e/a.ts',
      'e2e/x.ts',
      'lib/test/h.ts',
    ]) {
      expect(isTestPath(path), path).toBe(true);
    }
    for (const path of ['src/testing.ts', 'src/latest/a.ts', 'contest/x.ts']) {
      expect(isTestPath(path), path).toBe(false);
    }
  });

  it('parses name-status and numstat output with odd paths', () => {
    expect(parseNameStatus('M\0a b.ts\0D\0x\ny.ts\0A\0new.ts\0')).toEqual([
      { status: 'modified', path: 'a b.ts' },
      { status: 'deleted', path: 'x\ny.ts' },
      { status: 'added', path: 'new.ts' },
    ]);
    expect(parseNumstat('3\t1\ta b.ts\0-\t-\tlogo.png\0')).toEqual([
      { added: 3, path: 'a b.ts' },
      { added: 0, path: 'logo.png' },
    ]);
  });

  async function built() {
    const repo = makeScratchDir('cp-diff');
    await initScratchRepo(repo);
    writeFileIn(repo, 'src/menu.test.ts', 'old\n');
    writeFileIn(repo, 'src/old.spec.ts', 'gone\n');
    writeFileIn(repo, 'src/menu.ts', 'a\n');
    await gitIn(repo, ['add', '-A']);
    await gitIn(repo, ['commit', '-q', '-m', 'base']);
    const base = (await gitIn(repo, ['rev-parse', 'HEAD'])).trim();
    const lines = (n: number, what: string) =>
      Array.from({ length: n }, (_, i) => `${what} ${i}`)
        .join('\n')
        .concat('\n');
    writeFileIn(repo, 'src/menu.ts', lines(10, 'code'));
    writeFileIn(repo, 'src/menu.test.ts', 'old\nmore\nmore\n');
    writeFileIn(repo, 'src/new.test.ts', lines(4, 'test'));
    writeFileIn(repo, 'pnpm-lock.yaml', lines(100, 'lock'));
    writeFileIn(repo, 'openspec/changes/a/tasks.md', lines(5, '- [x]'));
    await gitIn(repo, ['rm', '-q', 'src/old.spec.ts']);
    await gitIn(repo, ['add', '-A']);
    await gitIn(repo, ['commit', '-q', '-m', 'build']);
    const tip = (await gitIn(repo, ['rev-parse', 'HEAD'])).trim();
    return { repo, base, tip, isPlanningPath: (path: string) => path.startsWith('openspec/') };
  }

  it('measures the test share, leaving out lock and planning files, and names edited tests', async () => {
    const b = await built();
    // src/menu.ts: 10 added (the old line is replaced); menu.test.ts: 2; new.test.ts: 4.
    expect(await measureTestShare(b)).toEqual({
      testLines: 6,
      addedLines: 16,
      percent: 38,
      editedTests: [
        { path: 'src/menu.test.ts', status: 'modified' },
        { path: 'src/old.spec.ts', status: 'deleted' },
      ],
    });
  });

  it('flags a planning file on the branch, which keeps the PR from being offered for merge', async () => {
    const b = await built();
    const flags = await planningEdits(b);
    expect(flags).toEqual([{ kind: 'planning-edit', path: 'openspec/changes/a/tasks.md' }]);
    expect(blocksMerge(flags)).toBe(true);
    expect(blocksMerge([])).toBe(false);
    // A flag an earlier version stored still blocks.
    expect(
      blocksMerge([{ kind: 'protected-path', path: 'openspec/x', category: 'planning' } as never]),
    ).toBe(true);
    await expect(planningEdits({ ...b, base: '--output=/tmp/x' })).rejects.toThrow(/commit ids/);
  });
});

// Gates around the runner: the tag sweep, the shared test lock, host services, gate rounds with
// retries and parking, and the protected-path check.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { GateRunResult } from '../../src/build/gate-runner.ts';
import { afterGateRound, runGateRound } from '../../src/build/gates.ts';
import { taggedFromListings } from '../../src/build/process-sweep.ts';
import {
  blocksMerge,
  checkProtectedPaths,
  isTestPath,
  parseNameStatus,
  protectedCategories,
} from '../../src/build/protected-paths.ts';
import {
  createServiceSession,
  parseEnvLines,
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
  const envs: Record<string, string>[] = [];
  const input = {
    db,
    runChangeId,
    change: 'qr-menu',
    attempt: 1,
    config,
    worktree: home,
    changeDir: join(home, 'runs', 'run-1', 'qr-menu'),
    protectedPaths: {
      homeDir: '/h',
      counterpointHome: '/h/cp',
      signingKeyDir: '/h/k',
      ghConfigDir: '/h/gh',
      hostGitDir: '/x/.git',
    },
    consolePort: 4170,
    services: NO_SERVICES,
    runGate: async (gate: Parameters<NonNullable<typeof extra.runGate>>[0]) => {
      ran.push(gate.gate.name);
      envs.push({ ...(gate.env ?? {}) });
      gate.onStart?.(9999);
      return result(outcomes[gate.gate.name] ?? {});
    },
    ...extra,
  };
  return { db, runChangeId, ran, envs, input };
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

  it('a host with no gates is green with nothing run', async () => {
    const r = round(EMPTY_HOST_CONFIG as HostConfig, {});
    expect(await runGateRound(r.input)).toEqual({ kind: 'pass', entries: [] });
  });
});

// --- protected paths ----------------------------------------------------------------------------

describe('protected paths', () => {
  const rules = {
    isPlanningPath: (path: string) => path.startsWith('openspec/'),
    hostGlobs: ['src/core/security/**', 'supabase/config.toml'],
  };

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

  it('flags edited tests but not new ones, gate config, .counterpoint, .claude, planning and host globs', () => {
    expect(protectedCategories('src/a.test.ts', 'modified', rules)).toEqual(['test']);
    expect(protectedCategories('src/a.test.ts', 'deleted', rules)).toEqual(['test']);
    expect(protectedCategories('src/a.test.ts', 'added', rules)).toEqual([]);
    expect(protectedCategories('.counterpoint/config.yaml', 'modified', rules)).toEqual([
      'gate-config',
    ]);
    expect(protectedCategories('.counterpoint/approvals/a.json', 'added', rules)).toEqual([
      'counterpoint',
    ]);
    expect(protectedCategories('.claude/settings.json', 'modified', rules)).toEqual([
      'agent-settings',
    ]);
    expect(protectedCategories('openspec/changes/a/tasks.md', 'modified', rules)).toEqual([
      'planning',
    ]);
    expect(protectedCategories('src/core/security/guard.ts', 'added', rules)).toEqual([
      'host-listed',
    ]);
    expect(protectedCategories('supabase/config.toml', 'modified', rules)).toEqual(['host-listed']);
    expect(protectedCategories('src/app/page.tsx', 'modified', rules)).toEqual([]);
  });

  it('parses name-status output with odd paths', () => {
    expect(parseNameStatus('M\0a b.ts\0D\0x\ny.ts\0A\0new.ts\0')).toEqual([
      { status: 'modified', path: 'a b.ts' },
      { status: 'deleted', path: 'x\ny.ts' },
      { status: 'added', path: 'new.ts' },
    ]);
  });

  it('diffs the branch against its base commit, judged by the base config', async () => {
    const repo = makeScratchDir('cp-prot');
    await initScratchRepo(repo);
    writeFileIn(repo, 'src/menu.test.ts', 'old\n');
    writeFileIn(repo, 'src/menu.ts', 'a\n');
    writeFileIn(repo, '.counterpoint/config.yaml', 'protected: [src/core/security/**]\n');
    await gitIn(repo, ['add', '-A']);
    await gitIn(repo, ['commit', '-q', '-m', 'base']);
    const base = (await gitIn(repo, ['rev-parse', 'HEAD'])).trim();
    writeFileIn(repo, 'src/menu.test.ts', 'weakened\n');
    writeFileIn(repo, 'src/new.test.ts', 'new\n');
    writeFileIn(repo, 'src/menu.ts', 'b\n');
    writeFileIn(repo, 'src/core/security/guard.ts', 'x\n');
    writeFileIn(repo, '.counterpoint/config.yaml', 'protected: []\n');
    await gitIn(repo, ['add', '-A']);
    await gitIn(repo, ['commit', '-q', '-m', 'build']);
    const tip = (await gitIn(repo, ['rev-parse', 'HEAD'])).trim();
    const flags = await checkProtectedPaths({
      repo,
      base,
      tip,
      isPlanningPath: () => false,
      hostGlobs: ['src/core/security/**'],
    });
    expect(flags.map((f) => [f.path, f.category, f.status])).toEqual([
      ['.counterpoint/config.yaml', 'gate-config', 'modified'],
      ['src/core/security/guard.ts', 'host-listed', 'added'],
      ['src/menu.test.ts', 'test', 'modified'],
    ]);
    expect(blocksMerge(flags)).toBe(false);
    expect(
      blocksMerge([
        {
          kind: 'protected-path',
          path: 'openspec/x',
          category: 'planning',
          status: 'modified',
        } as never,
      ]),
    ).toBe(true);
    await expect(
      checkProtectedPaths({
        repo,
        base: '--output=/tmp/x',
        tip,
        isPlanningPath: () => false,
        hostGlobs: [],
      }),
    ).rejects.toThrow(/commit ids/);
  });
});

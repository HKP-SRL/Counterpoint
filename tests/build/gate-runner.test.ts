// The gate runner under the real gate sandbox (srt, macOS), plus its pure helpers.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  GATE_TAG_ENV,
  gateEnv,
  lastLines,
  lastTestCount,
  runGate,
  stripTerminal,
} from '../../src/build/gate-runner.ts';
import type { sweepTagged } from '../../src/build/process-sweep.ts';
import type { GateConfig } from '../../src/core/host/host-config.ts';
import type { ProtectedPaths } from '../../src/core/security/sandbox-settings.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

afterAll(() => {
  removeScratchDirs();
});

function gate(command: string[], extra: Partial<GateConfig> = {}): GateConfig {
  return {
    name: 'unit',
    command,
    timeout: 30_000,
    testLock: false,
    ports: [],
    services: [],
    ...extra,
  };
}

function setup(): {
  root: string;
  worktree: string;
  protectedPaths: Omit<ProtectedPaths, 'workdir'>;
} {
  const root = makeScratchDir('cp-gate');
  const home = join(root, 'home');
  for (const dir of ['.ssh', '.config/gh', 'cp-home', 'key'])
    mkdirSync(join(home, dir), { recursive: true });
  const worktree = join(root, 'wt');
  mkdirSync(worktree);
  return {
    root,
    worktree,
    protectedPaths: {
      homeDir: home,
      counterpointHome: join(home, 'cp-home'),
      signingKeyDir: join(home, 'key'),
      ghConfigDir: join(home, '.config/gh'),
      hostGitDir: join(root, 'host', '.git'),
    },
  };
}

/** A sweep that finds nothing (ps cannot read environments inside every test sandbox). */
const noSweep: typeof sweepTagged = async () => ({ found: [], error: null });

async function run(
  command: string[],
  extra: Partial<GateConfig> = {},
  options: Partial<Parameters<typeof runGate>[0]> = {},
  s: ReturnType<typeof setup> = setup(),
) {
  const logPath = join(s.root, 'logs', 'unit.log');
  const result = await runGate({
    gate: gate(command, extra),
    worktree: s.worktree,
    scratchDir: join(s.root, 'scratch'),
    logPath,
    protectedPaths: s.protectedPaths,
    consolePort: 4170,
    parentEnv: { PATH: process.env.PATH, HOME: s.protectedPaths.homeDir, GH_TOKEN: 'gho_secret' },
    killGraceMs: 500,
    sweep: noSweep,
    ...options,
  });
  return { ...s, logPath, result };
}

describe('gate output helpers', () => {
  it('strips colors, cursor moves, OSC links and stray control characters', () => {
    expect(
      stripTerminal(
        '\u001b[32m✓\u001b[0m ok\r\n\u001b]8;;http://x\u0007link\u001b]8;;\u0007\u0008!',
      ),
    ).toBe('✓ ok\nlink!');
  });

  it('keeps the last lines', () => {
    expect(lastLines('a\nb\nc\n\n', 2)).toBe('b\nc');
  });

  it('reads the last test count the pattern matches', () => {
    const out = 'Tests  3 passed (3)\n...\nTests  12 passed (12)\n';
    expect(lastTestCount('Tests\\s+(\\d+) passed', out)).toBe(12);
    expect(lastTestCount('Tests\\s+(\\d+) passed', 'nothing')).toBeNull();
  });

  it('builds the environment from the allow-list, CI markers, extras and the tag last', () => {
    const env = gateEnv(
      { PATH: '/bin', HOME: '/h', GH_TOKEN: 't', SSH_AUTH_SOCK: '/s', ANTHROPIC_API_KEY: 'k' },
      { API_URL: 'http://127.0.0.1:54321', [GATE_TAG_ENV]: 'spoofed' },
      'tag123456',
    );
    expect(env).toEqual({
      PATH: '/bin',
      HOME: '/h',
      CI: '1',
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      API_URL: 'http://127.0.0.1:54321',
      [GATE_TAG_ENV]: 'tag123456',
    });
  });
});

describe.skipIf(process.platform !== 'darwin')('runGate (live srt)', () => {
  it('passes on exit 0, logs the output and keeps a stripped tail', async () => {
    const { result, logPath } = await run(['/bin/sh', '-c', 'printf "\\033[32mok\\033[0m\\n"']);
    expect(result.verdict).toBe('pass');
    expect(result.reason).toBeNull();
    expect(result.exitCode).toBe(0);
    expect(result.tail).toBe('ok');
    expect(readFileSync(logPath, 'utf8')).toContain('ok');
  }, 30_000);

  it('fails a non-zero exit with reason exit-code and the last lines', async () => {
    const { result } = await run(['/bin/sh', '-c', 'echo one; echo two >&2; exit 3']);
    expect(result).toMatchObject({ verdict: 'fail', reason: 'exit-code', exitCode: 3 });
    expect(result.tail).toBe('one\ntwo');
  }, 30_000);

  it('fails a command killed by a signal (srt alone would exit 0)', async () => {
    const { result } = await run(['/bin/sh', '-c', 'kill -TERM $$']);
    expect(result).toMatchObject({ verdict: 'fail', reason: 'signal', signal: 'SIGTERM' });
  }, 30_000);

  it('applies the zero-test guard', async () => {
    const pattern = { testCount: 'Tests\\s+(\\d+) passed' };
    const zero = await run(['/bin/echo', 'Tests  0 passed'], pattern);
    expect(zero.result).toMatchObject({ verdict: 'fail', reason: 'zero-tests', testCount: 0 });
    const none = await run(['/bin/echo', 'No test files found'], pattern);
    expect(none.result).toMatchObject({ verdict: 'fail', reason: 'no-test-count' });
    const some = await run(['/bin/echo', 'Tests  4 passed'], pattern);
    expect(some.result).toMatchObject({ verdict: 'pass', testCount: 4 });
  }, 60_000);

  it('times out, killing the whole process group (a backgrounded child too)', async () => {
    const s = setup();
    const marker = join(s.worktree, 'late');
    const control = join(s.worktree, 'early');
    const { result } = await run(
      ['/bin/sh', '-c', `touch '${control}'; (sleep 3; touch '${marker}') & sleep 30`],
      { timeout: 1500 },
      {},
      s,
    );
    expect(result).toMatchObject({ verdict: 'fail', reason: 'timeout' });
    // The gate could write there (control), and its backgrounded child died with the group.
    expect(existsSync(control)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(existsSync(marker)).toBe(false);
  }, 30_000);

  it('stops when the run stops', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 1000);
    const { result } = await run(['/bin/sleep', '30'], {}, { signal: controller.signal });
    expect(result).toMatchObject({ verdict: 'fail', reason: 'stopped' });
    expect(result.durationMs).toBeLessThan(15_000);
  }, 30_000);

  it('runs with the reduced environment, its tag, CI=1 and its own temp dir', async () => {
    const { result, root } = await run([
      '/bin/sh',
      '-c',
      `echo "tag=$${GATE_TAG_ENV} ci=$CI gh=\${GH_TOKEN:-none} tmp=$TMPDIR proxy=$NODE_USE_ENV_PROXY"`,
    ]);
    expect(result.verdict).toBe('pass');
    expect(result.tail).toBe(
      `tag=${result.processTag} ci=1 gh=none tmp=${join(root, 'scratch', 'tmp')} proxy=1`,
    );
  }, 30_000);

  it('writes the worktree but nothing outside it, and reads no protected path', async () => {
    const s = setup();
    writeFileSync(join(s.protectedPaths.signingKeyDir, 'key'), 'cp-secret-value\n');
    const outside = join(s.root, 'outside');
    const result = await runGate({
      gate: gate([
        '/bin/sh',
        '-c',
        `touch inside; touch '${outside}'; cat '${join(s.protectedPaths.signingKeyDir, 'key')}'; true`,
      ]),
      worktree: s.worktree,
      scratchDir: join(s.root, 'scratch'),
      logPath: join(s.root, 'logs', 'unit.log'),
      protectedPaths: s.protectedPaths,
      consolePort: 4170,
      sweep: noSweep,
    });
    expect(result.verdict).toBe('pass');
    expect(existsSync(join(s.worktree, 'inside'))).toBe(true);
    expect(existsSync(outside)).toBe(false);
    expect(result.tail).not.toContain('cp-secret-value');
  }, 30_000);

  it('records what the tag sweep found and ended', async () => {
    const sweep: typeof sweepTagged = async (name, tag) => {
      expect(name).toBe(GATE_TAG_ENV);
      expect(tag).toMatch(/^[0-9a-f]{32}$/);
      return { found: [{ pid: 4242, command: 'next dev' }], error: null };
    };
    const { result, logPath } = await run(['/usr/bin/true'], {}, { sweep });
    expect(result.survivors).toEqual([{ pid: 4242, command: 'next dev' }]);
    expect(readFileSync(logPath, 'utf8')).toContain('left the gate');
  }, 30_000);
});

describe.skipIf(process.platform !== 'darwin')('the tag sweep (live ps)', () => {
  it('ends a tagged process that left its group, and only that one', async (ctx) => {
    const { spawn } = await import('node:child_process');
    const { findTagged, sweepTagged } = await import('../../src/build/process-sweep.ts');
    const tag = 'f00dfeedf00dfeedf00dfeedf00dfeed';
    // A node process: macOS hides the environment of Apple platform binaries (/bin/sleep, /bin/sh)
    // from ps, so the sweep can only find tagged processes that are not system binaries.
    const spawnSleeper = (value: string) =>
      spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
        detached: true,
        stdio: 'ignore',
        env: { PATH: '/usr/bin:/bin', [GATE_TAG_ENV]: value },
      });
    const tagged = spawnSleeper(tag);
    const other = spawnSleeper('0000000000000000000000000000beef');
    try {
      let found = await findTagged(GATE_TAG_ENV, tag);
      for (let i = 0; i < 20 && found.length === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        found = await findTagged(GATE_TAG_ENV, tag);
      }
      // Some sandboxed shells cannot read other processes' environments at all.
      if (found.length === 0) ctx.skip();
      expect(found.map((p) => p.pid)).toEqual([tagged.pid]);
      const swept = await sweepTagged(GATE_TAG_ENV, tag, { graceMs: 500 });
      expect(swept.found.map((p) => p.pid)).toEqual([tagged.pid]);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(tagged.exitCode !== null || tagged.signalCode !== null).toBe(true);
      expect(other.exitCode === null && other.signalCode === null).toBe(true);
    } finally {
      tagged.kill('SIGKILL');
      other.kill('SIGKILL');
    }
  }, 30_000);
});

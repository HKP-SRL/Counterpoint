import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterAll, describe, expect, it } from 'vitest';
import {
  runWorktreeGitProbe,
  stepOutcome,
  sweepWorktreeProbe,
  worktreeProbeCommand,
} from '../../src/agent/probe-worktree.ts';
import type {
  AgentRun,
  AgentRunner,
  AgentRunRequest,
  StreamEvent,
} from '../../src/agent/runner.ts';
import { buildGateSandboxSettings, gateArgv } from '../../src/build/gate-sandbox.ts';
import { runGit } from '../../src/core/git/run.ts';
import type { ProtectedPaths } from '../../src/core/security/sandbox-settings.ts';
import { runGateSandboxProbe } from '../../src/doctor/gate-sandbox-probe.ts';
import {
  commitAll,
  initScratchRepo,
  makeScratchDir,
  removeScratchDirs,
  writeFileIn,
} from '../helpers/scratch.ts';

afterAll(() => {
  removeScratchDirs();
});

const NONCE = '0123456789abcdef0123456789abcdef';

function scratchPaths(): Omit<ProtectedPaths, 'workdir'> & { root: string } {
  const root = makeScratchDir('cp-rows');
  const home = join(root, 'home');
  for (const dir of ['.ssh', '.config/gh', 'cp-home', 'key'])
    mkdirSync(join(home, dir), { recursive: true });
  return {
    root,
    homeDir: home,
    counterpointHome: join(home, 'cp-home'),
    signingKeyDir: join(home, 'key'),
    ghConfigDir: join(home, '.config/gh'),
    hostGitDir: join(root, 'host', '.git'),
  };
}

async function scratchHost(root: string): Promise<string> {
  const host = join(root, 'host');
  mkdirSync(host, { recursive: true });
  await initScratchRepo(host);
  writeFileIn(host, 'README.md', 'hi\n');
  await commitAll(host);
  return host;
}

describe('gate sandbox profile', () => {
  const paths = {
    homeDir: '/Users/x',
    counterpointHome: '/Users/x/cp',
    signingKeyDir: '/Users/x/key',
    ghConfigDir: '/Users/x/.config/gh',
    hostGitDir: '/repo/.git',
  };

  it('writes only the worktree and its temp dir, never .git or .claude there', () => {
    const settings = buildGateSandboxSettings({
      protectedPaths: paths,
      workdir: '/wt/change',
      tmpDir: '/wt/tmp',
      ports: [54321, 54321],
      consolePort: 4170,
    });
    expect(settings.filesystem.allowWrite).toEqual(['/wt/change', '/wt/tmp']);
    expect(settings.filesystem.denyWrite).toEqual([
      '/wt/change/.git',
      '/wt/change/.claude',
      '/repo/.git',
    ]);
    expect(settings.filesystem.denyRead).toEqual(
      expect.arrayContaining([
        '/Users/x/key',
        '/Users/x/.ssh',
        '/Users/x/.config/gh',
        '/Users/x/cp',
      ]),
    );
    expect(settings.network.allowedDomains).toEqual(['127.0.0.1:54321']);
    expect(settings.network.allowLocalBinding).toBe(false);
  });

  it('refuses the console port and invalid ports', () => {
    const base = { protectedPaths: paths, workdir: '/wt', tmpDir: '/tmp2', consolePort: 4170 };
    expect(() => buildGateSandboxSettings({ ...base, ports: [4170] })).toThrow(/console port/);
    expect(() => buildGateSandboxSettings({ ...base, ports: [0] })).toThrow(/Invalid gate port/);
  });

  it('runs the command through srt with the proxy forced, as an argument array', () => {
    const argv = gateArgv('/s.json', ['pnpm', 'test', '--', "it's"]);
    expect(argv.slice(2, 5)).toEqual(['--settings', '/s.json', '--']);
    expect(argv.slice(5, 11)).toEqual([
      '/usr/bin/env',
      '-u',
      'NO_PROXY',
      '-u',
      'no_proxy',
      'NODE_USE_ENV_PROXY=1',
    ]);
    // The signal-safe wrapper: srt itself exits 0 when its command dies from a signal.
    expect(argv.slice(11, 15)).toEqual([
      '/bin/sh',
      '-c',
      'code=0; "$@" || code=$?; exit "$code"',
      'cp-gate',
    ]);
    expect(argv.slice(15)).toEqual(['pnpm', 'test', '--', "it's"]);
  });

  it('sets variables inside the sandbox, after srt, and refuses bad names', () => {
    const argv = gateArgv('/s.json', ['true'], { TMPDIR: '/gate/tmp' });
    expect(argv.slice(11, 12)).toEqual(['TMPDIR=/gate/tmp']);
    expect(argv.at(-1)).toBe('true');
    expect(() => gateArgv('/s.json', ['true'], { 'A=B': 'x' })).toThrow(/Invalid variable/);
  });
});

describe.skipIf(process.platform !== 'darwin')('gate-sandbox row (live srt)', () => {
  it('is Blocked: no protected read, no outside write, no unlisted port; controls reached', async () => {
    const paths = scratchPaths();
    const row = await runGateSandboxProbe({
      protectedPaths: paths,
      consolePort: 4170,
      tmpRoot: paths.root,
      nonce: NONCE,
    });
    expect(row.result, row.evidence).toBe('blocked');
    expect(row.trusted).toBe(true);
    expect(row.steps.map((s) => [s.operation, s.treatment, s.control])).toEqual([
      ['cat', 'denied-os', 'reached'],
      ['touch', 'denied-os', 'reached'],
      ['connect', 'denied-os', 'reached'],
    ]);
    // Nothing left behind.
    expect(existsSync(join(paths.homeDir, `.cp-outside-${NONCE}`))).toBe(false);
    expect(readdirSync(paths.counterpointHome)).toEqual([]);
  }, 60_000);

  it('plants one canary per directory when two targets share one (signing key in ~/.ssh)', async () => {
    const paths = scratchPaths();
    const shared = { ...paths, signingKeyDir: join(paths.homeDir, '.ssh') };
    const row = await runGateSandboxProbe({
      protectedPaths: shared,
      consolePort: 4170,
      tmpRoot: paths.root,
      nonce: NONCE,
    });
    expect(row.result, row.evidence).toBe('blocked');
    expect(readdirSync(join(paths.homeDir, '.ssh'))).toEqual([]);
  }, 60_000);
});

describe('worktree git-access row', () => {
  const command = worktreeProbeCommand(NONCE);

  function events(text: string | null, cmd = command): StreamEvent[] {
    const out: StreamEvent[] = [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', id: 't1', input: { command: cmd } }],
        },
      },
    ];
    if (text !== null) {
      out.push({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: text }] },
      });
    }
    return out;
  }

  it('reads the exit marker only from the exact command it asked for', () => {
    expect(stepOutcome(events('fatal: cannot lock ref\ncp-exit=128'), command)).toBe(128);
    expect(stepOutcome(events('cp-exit=0'), command)).toBe(0);
    expect(
      stepOutcome(events('cp-exit=0', 'git update-ref refs/heads/x HEAD; echo cp-exit=0'), command),
    ).toBeNull();
    expect(stepOutcome(events(null), command)).toBeNull();
  });

  /** Runs the probe command for real where `run` says so; otherwise reports a refusal. */
  function fakeRunner(run: (cwd: string) => 'real' | 'refused' | 'nothing'): AgentRunner {
    return {
      async run(request: AgentRunRequest): Promise<AgentRun> {
        const mode = run(request.cwd);
        let text: string | null = null;
        if (mode === 'real') {
          const result = await execa('/bin/sh', ['-c', command], {
            cwd: request.cwd,
            reject: false,
          });
          text = result.stdout;
        } else if (mode === 'refused') {
          text = 'fatal: cannot lock ref: Operation not permitted\ncp-exit=128';
        }
        const evs = events(text);
        return { events: evs, raw: '', stderr: '', exitCode: 0, timedOut: false, result: null };
      },
    };
  }

  const isControl = (cwd: string) => cwd.includes('mirror-cp-probe-wt-');

  it('is Blocked when the host worktree refuses and the mirror control succeeds, leaving nothing', async () => {
    const paths = scratchPaths();
    const host = await scratchHost(paths.root);
    const row = await runWorktreeGitProbe({
      runner: fakeRunner((cwd) => (isControl(cwd) ? 'real' : 'refused')),
      protectedPaths: paths,
      hostRoot: host,
      nonce: NONCE,
      logDir: join(paths.root, 'logs'),
      tmpRoot: paths.root,
    });
    expect(row.result, row.evidence).toBe('blocked');
    expect(row.steps[0]).toMatchObject({
      operation: 'update-ref',
      treatment: 'denied-os',
      control: 'reached',
    });
    const worktrees = await runGit(host, ['worktree', 'list', '--porcelain']);
    expect(worktrees.stdout).not.toContain('cp-probe-wt-');
  });

  it('is Reachable when a ref appears in the host, and removes it', async () => {
    const paths = scratchPaths();
    const host = await scratchHost(paths.root);
    const row = await runWorktreeGitProbe({
      runner: fakeRunner(() => 'real'),
      protectedPaths: paths,
      hostRoot: host,
      nonce: NONCE,
      logDir: join(paths.root, 'logs'),
      tmpRoot: paths.root,
    });
    expect(row.result).toBe('reachable');
    expect(row.leaks).toEqual(['leftover']);
    const refs = await runGit(host, ['for-each-ref', 'refs/heads/cp-probe-*']);
    expect(refs.stdout).toBe('');
  });

  it('is Not checked when the command did not run, or the control failed too', async () => {
    const paths = scratchPaths();
    const host = await scratchHost(paths.root);
    const base = {
      protectedPaths: paths,
      hostRoot: host,
      nonce: NONCE,
      logDir: join(paths.root, 'logs'),
      tmpRoot: paths.root,
    };
    expect(
      (await runWorktreeGitProbe({ ...base, runner: fakeRunner(() => 'nothing') })).result,
    ).toBe('not-checked');
    expect(
      (await runWorktreeGitProbe({ ...base, runner: fakeRunner(() => 'refused') })).result,
    ).toBe('not-checked');
  });

  it('sweeps worktrees and refs a killed run left in the host', async () => {
    const paths = scratchPaths();
    const host = await scratchHost(paths.root);
    const left = join(paths.root, `cp-probe-wt-${NONCE}`);
    await runGit(host, ['worktree', 'add', '--detach', '--no-checkout', left, 'HEAD']);
    await runGit(host, ['update-ref', `refs/heads/cp-probe-${NONCE}`, 'HEAD']);
    await runGit(host, ['update-ref', 'refs/heads/cp-probe-not-a-nonce', 'HEAD']);
    const removed = await sweepWorktreeProbe(host);
    expect(removed).toEqual([`cp-probe-wt-${NONCE}`, `refs/heads/cp-probe-${NONCE}`]);
    const refs = await runGit(host, [
      'for-each-ref',
      '--format=%(refname)',
      'refs/heads/cp-probe-*',
    ]);
    expect(refs.stdout.trim()).toBe('refs/heads/cp-probe-not-a-nonce');
  });
});

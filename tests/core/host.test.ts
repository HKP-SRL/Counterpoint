import { chmodSync, existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { execa } from 'execa';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { cleanGitEnv, GitError, gitBinary, runGit } from '../../src/core/git/run.ts';
import {
  HomeMissingError,
  homePaths,
  hostDir,
  readConfig,
  requireHome,
  resolveHome,
} from '../../src/core/host/home.ts';
import {
  detectBaseBranch,
  type HostRecord,
  type HostRegistryStore,
  registerHost,
} from '../../src/core/host/registry.ts';
import {
  approvalItemId,
  assertHostId,
  assertPhaseId,
  HOST_ID_RE,
  hostIdFromName,
  InvalidIdError,
  isHostId,
  isPhaseId,
  PHASE_ID_RE,
  PROBE_CANARY_RE,
  PROBE_GIT_ARTIFACT_RE,
  PROBE_NONCE_RE,
} from '../../src/core/ids.ts';
import {
  commitAll,
  gitIn,
  initScratchRepo,
  makeScratchDir,
  removeScratchDirs,
  writeFileIn,
} from '../helpers/scratch.ts';

afterAll(() => {
  removeScratchDirs();
});

const HEX32 = '0123456789abcdef0123456789abcdef';

// ---------------------------------------------------------------------------------------------
// ids
// ---------------------------------------------------------------------------------------------

describe('HOST_ID_RE', () => {
  it.each([
    ['cena', true],
    ['cena-2', true],
    ['a', true],
    ['0cena', true],
    ['a'.repeat(32), true],
    ['-x', false],
    ['Cena', false],
    ['../x', false],
    ['a'.repeat(33), false],
    ['', false],
    ['cena_2', false],
    ['cena 2', false],
    ['cena\n', false],
  ])('%j -> %s', (value, ok) => {
    expect(HOST_ID_RE.test(value)).toBe(ok);
    expect(isHostId(value)).toBe(ok);
  });
});

describe('PHASE_ID_RE', () => {
  it.each([
    ['02', true],
    ['01.1', true],
    ['10.12', true],
    ['99', true],
    ['2', false],
    ['002', false],
    ['02.', false],
    ['1.1', false],
    ['02.1.1', false],
    ['02\n', false],
    ['../02', false],
  ])('%j -> %s', (value, ok) => {
    expect(PHASE_ID_RE.test(value)).toBe(ok);
    expect(isPhaseId(value)).toBe(ok);
  });
});

describe('id assertions', () => {
  it('assertHostId returns a valid id', () => {
    expect(assertHostId('cena')).toBe('cena');
  });

  it('assertPhaseId returns a valid id', () => {
    expect(assertPhaseId('01.1')).toBe('01.1');
  });

  it.each([['../x'], ['Cena'], [42], [undefined]])('assertHostId rejects %j', (value) => {
    expect(() => assertHostId(value)).toThrow(InvalidIdError);
  });

  it.each([['2'], ['1.1'], [null]])('assertPhaseId rejects %j', (value) => {
    expect(() => assertPhaseId(value)).toThrow(InvalidIdError);
  });

  it('echoes at most 40 characters of a rejected input', () => {
    const input = `${'x'.repeat(100)}TAIL`;
    let error: unknown;
    try {
      assertHostId(input);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(InvalidIdError);
    const message = (error as Error).message;
    expect(message).toContain('x'.repeat(40));
    expect(message).not.toContain('x'.repeat(41));
    expect(message).not.toContain('TAIL');
  });

  it('approvalItemId prefixes a validated phase id', () => {
    expect(approvalItemId('02')).toBe('phase-02');
    expect(approvalItemId('01.1')).toBe('phase-01.1');
    expect(() => approvalItemId('2')).toThrow(InvalidIdError);
  });
});

describe('hostIdFromName', () => {
  it.each([
    ['Cena', 'cena'],
    ['My Repo!!', 'my-repo'],
    ['--weird__name--', 'weird-name'],
    ['a'.repeat(50), 'a'.repeat(32)],
  ])('%j -> %j', (name, id) => {
    expect(hostIdFromName(name)).toBe(id);
  });

  it.each([[''], ['---'], ['Ünïcödé'], ['日本語'], [`${'a'.repeat(31)}-b`]])(
    'always yields a valid host id for %j',
    (name) => {
      expect(HOST_ID_RE.test(hostIdFromName(name))).toBe(true);
    },
  );
});

describe('sandbox-probe artifact names', () => {
  it.each([
    [HEX32, true],
    [HEX32.slice(1), false],
    [HEX32.toUpperCase(), false],
    [`${HEX32}0`, false],
  ])('PROBE_NONCE_RE %j -> %s', (value, ok) => {
    expect(PROBE_NONCE_RE.test(value)).toBe(ok);
  });

  it.each([
    [`.cp-canary-${HEX32}`, true],
    [`.cp-canary-${HEX32.slice(1)}`, false],
    [`.cp-canary-${HEX32.toUpperCase()}`, false],
    [`cp-canary-${HEX32}`, false],
    [`.cp-canary-${HEX32}x`, false],
  ])('PROBE_CANARY_RE %j -> %s', (value, ok) => {
    expect(PROBE_CANARY_RE.test(value)).toBe(ok);
  });

  it.each([
    [`cp-${HEX32}`, true],
    [`cp-${HEX32}-w`, true],
    ['pre-commit', false],
    ['cp-x', false],
    ['exclude', false],
    [`cp-${HEX32}-x`, false],
    [`cp-${HEX32.toUpperCase()}`, false],
  ])('PROBE_GIT_ARTIFACT_RE %j -> %s', (value, ok) => {
    expect(PROBE_GIT_ARTIFACT_RE.test(value)).toBe(ok);
  });
});

// ---------------------------------------------------------------------------------------------
// home
// ---------------------------------------------------------------------------------------------

describe('resolveHome', () => {
  it('uses COUNTERPOINT_HOME when set', () => {
    expect(
      resolveHome({ COUNTERPOINT_HOME: '/Volumes/Dock/cp-home', HOME: '/Users/x' }, 'darwin'),
    ).toBe('/Volumes/Dock/cp-home');
  });

  it('defaults to Application Support on macOS', () => {
    expect(resolveHome({ HOME: '/Users/x' }, 'darwin')).toBe(
      '/Users/x/Library/Application Support/Counterpoint',
    );
  });

  it('uses XDG_DATA_HOME on Linux', () => {
    expect(resolveHome({ HOME: '/home/x', XDG_DATA_HOME: '/data/xdg' }, 'linux')).toBe(
      '/data/xdg/counterpoint',
    );
  });

  it('falls back to ~/.local/share on Linux', () => {
    expect(resolveHome({ HOME: '/home/x' }, 'linux')).toBe('/home/x/.local/share/counterpoint');
  });

  it('ignores an empty COUNTERPOINT_HOME', () => {
    expect(resolveHome({ COUNTERPOINT_HOME: '', HOME: '/Users/x' }, 'darwin')).toBe(
      '/Users/x/Library/Application Support/Counterpoint',
    );
  });
});

describe('requireHome', () => {
  it('refuses a missing COUNTERPOINT_HOME and creates nothing', () => {
    const scratch = makeScratchDir('hm');
    const missing = join(scratch, 'gone', 'Counterpoint');
    expect(() => requireHome({ COUNTERPOINT_HOME: missing })).toThrow(HomeMissingError);
    expect(() => requireHome({ COUNTERPOINT_HOME: missing })).toThrow(
      `Counterpoint home "${missing}" does not exist. If it is on the Dock volume, is it mounted? Nothing was created.`,
    );
    expect(existsSync(missing)).toBe(false);
    expect(existsSync(join(scratch, 'gone'))).toBe(false);
  });

  it('refuses a missing platform default home and creates nothing', () => {
    const fakeUserHome = makeScratchDir('hd');
    const expected = join(fakeUserHome, 'Library', 'Application Support', 'Counterpoint');
    expect(() => requireHome({ HOME: fakeUserHome }, 'darwin')).toThrow(
      `Counterpoint home "${expected}" does not exist. If it is on the Dock volume, is it mounted? Nothing was created.`,
    );
    expect(existsSync(join(fakeUserHome, 'Library'))).toBe(false);
  });

  it('carries the refused path on the error', () => {
    const scratch = makeScratchDir('hp');
    const missing = join(scratch, 'nope');
    try {
      requireHome({ COUNTERPOINT_HOME: missing });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HomeMissingError);
      expect((error as HomeMissingError).path).toBe(missing);
    }
  });

  it('returns an existing home', () => {
    const home = makeScratchDir('ho');
    expect(requireHome({ COUNTERPOINT_HOME: home })).toBe(home);
  });
});

describe('homePaths and hostDir', () => {
  it('lays out every state path under the home', () => {
    const home = '/Volumes/Dock/cp';
    const paths = homePaths(home);
    expect(paths).toEqual({
      home,
      stateDb: '/Volumes/Dock/cp/state.db',
      runDir: '/Volumes/Dock/cp/run',
      lockDb: '/Volumes/Dock/cp/run/daemon.lock.db',
      socket: '/Volumes/Dock/cp/run/daemon.sock',
      daemonJson: '/Volumes/Dock/cp/run/daemon.json',
      startResult: '/Volumes/Dock/cp/run/start-result.json',
      token: '/Volumes/Dock/cp/token',
      logsDir: '/Volumes/Dock/cp/logs',
      daemonLog: '/Volumes/Dock/cp/logs/daemon.log',
      trustDir: '/Volumes/Dock/cp/trust',
      hostsDir: '/Volumes/Dock/cp/hosts',
      tmpDir: '/Volumes/Dock/cp/tmp',
    });
    for (const value of Object.values(paths)) expect(isAbsolute(value)).toBe(true);
  });

  it('rejects a home whose control socket path exceeds 103 bytes', () => {
    const home = `/Volumes/Dock/${'h'.repeat(80)}`;
    expect(() => homePaths(home)).toThrow(`${home}/run/daemon.sock`);
  });

  it('accepts a socket path of exactly 103 bytes', () => {
    const suffix = '/run/daemon.sock';
    const home = `/${'h'.repeat(103 - suffix.length - 1)}`;
    expect(Buffer.byteLength(`${home}${suffix}`)).toBe(103);
    expect(homePaths(home).socket).toBe(`${home}${suffix}`);
  });

  it('hostDir validates the host id', () => {
    expect(hostDir('/Volumes/Dock/cp', 'cena')).toBe('/Volumes/Dock/cp/hosts/cena');
    expect(() => hostDir('/Volumes/Dock/cp', '../x')).toThrow(InvalidIdError);
  });
});

describe('readConfig', () => {
  it('defaults to port 4170 when config.json is absent', () => {
    const home = makeScratchDir('rc');
    expect(readConfig(home)).toEqual({ port: 4170 });
  });

  it('returns the configured port', () => {
    const home = makeScratchDir('rc');
    writeFileIn(home, 'config.json', JSON.stringify({ port: 5123 }));
    expect(readConfig(home).port).toBe(5123);
  });

  it('defaults the port when the file omits it', () => {
    const home = makeScratchDir('rc');
    writeFileIn(home, 'config.json', '{}');
    expect(readConfig(home).port).toBe(4170);
  });

  it.each([
    ['{"port": 70000}'],
    ['{"port": -1}'],
    ['{"port": 41.5}'],
    ['{"port": "4170"}'],
    ['{ not json'],
  ])('names the file when config.json is invalid: %s', (content) => {
    const home = makeScratchDir('rc');
    const file = writeFileIn(home, 'config.json', content);
    expect(() => readConfig(home)).toThrow(file);
  });
});

// ---------------------------------------------------------------------------------------------
// clean-environment git runner
// ---------------------------------------------------------------------------------------------

/** An executable shell script that touches `marker` when run. */
function plantMarkerScript(file: string, marker: string): void {
  writeFileSync(file, `#!/bin/sh\ntouch '${marker}'\nexit 0\n`);
  chmodSync(file, 0o755);
}

describe('cleanGitEnv and gitBinary', () => {
  it('passes only the allow-listed parent variables plus the hardening variables', () => {
    const env = cleanGitEnv({
      PATH: '/usr/bin',
      HOME: '/Users/x',
      LANG: 'en_US.UTF-8',
      TMPDIR: '/tmp/x',
      GIT_DIR: '/evil',
      GIT_CONFIG_COUNT: '1',
      SSH_AUTH_SOCK: '/tmp/agent',
      COUNTERPOINT_HOME: '/Volumes/Dock/cp',
    });
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/x',
      LANG: 'en_US.UTF-8',
      TMPDIR: '/tmp/x',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
    });
  });

  it('resolves git to an absolute real path', () => {
    const bin = gitBinary();
    expect(isAbsolute(bin)).toBe(true);
    expect(realpathSync(bin)).toBe(bin);
  });
});

describe('runGit', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
  });

  it('never runs a core.fsmonitor command planted in the repo', async () => {
    const repo = await initScratchRepo(makeScratchDir('fs'));
    writeFileIn(repo, 'a.txt', 'one\n');
    await commitAll(repo);
    const marker = join(makeScratchDir('mk'), 'fsmonitor-ran');
    const script = join(repo, '.git', 'fsmonitor-trap.sh');
    plantMarkerScript(script, marker);
    await gitIn(repo, ['config', 'core.fsmonitor', script]);
    writeFileIn(repo, 'a.txt', 'two\n');

    await runGit(repo, ['status', '--porcelain=v1']);
    await runGit(repo, ['update-index', '--refresh'], { allowExitCodes: [0, 1] });
    expect(existsSync(marker)).toBe(false);

    // Control: the trap is real — plain git (repo config honoured) does execute it.
    await execa('git', ['status', '--porcelain=v1'], {
      cwd: repo,
      env: { PATH: process.env.PATH ?? '', HOME: repo, GIT_CONFIG_NOSYSTEM: '1' },
      extendEnv: false,
      reject: false,
    });
    expect(existsSync(marker)).toBe(true);
  });

  it('never runs a reference-transaction hook planted in the repo', async () => {
    const repo = await initScratchRepo(makeScratchDir('rt'));
    await commitAll(repo);
    const marker = join(makeScratchDir('mk'), 'hook-ran');
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
    plantMarkerScript(join(repo, '.git', 'hooks', 'reference-transaction'), marker);

    await runGit(repo, ['update-ref', 'refs/heads/cp-test', 'HEAD']);
    expect(existsSync(marker)).toBe(false);
    const sha = (await runGit(repo, ['rev-parse', 'refs/heads/cp-test'])).stdout.trim();
    expect(sha).toMatch(/^[0-9a-f]{40}$/);

    // Control: plain git runs the hook.
    await execa('git', ['update-ref', 'refs/heads/cp-control', 'HEAD'], {
      cwd: repo,
      env: { PATH: process.env.PATH ?? '', HOME: repo, GIT_CONFIG_NOSYSTEM: '1' },
      extendEnv: false,
    });
    expect(existsSync(marker)).toBe(true);
  });

  it("ignores the user's global git config and git config injected through the environment", async () => {
    const repo = await initScratchRepo(makeScratchDir('gc'));
    const fakeUserHome = makeScratchDir('gu');
    writeFileIn(fakeUserHome, '.gitconfig', '[cptest]\n\tmarker = global\n');
    writeFileIn(fakeUserHome, '.config/git/config', '[cptest]\n\txdg = global\n');
    process.env.HOME = fakeUserHome;
    process.env.XDG_CONFIG_HOME = join(fakeUserHome, '.config');
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'cptest.env';
    process.env.GIT_CONFIG_VALUE_0 = 'injected';

    // Control: plain git with this environment does see all three.
    const plain = await execa('git', ['config', '--get-regexp', '^cptest\\.'], {
      cwd: repo,
      reject: false,
    });
    expect(plain.stdout).toContain('cptest.marker global');
    expect(plain.stdout).toContain('cptest.env injected');

    const result = await runGit(repo, ['config', '--get-regexp', '^cptest\\.'], {
      allowExitCodes: [0, 1],
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
  });

  it('returns raw bytes with encoding buffer and passes stdin input', async () => {
    const repo = await initScratchRepo(makeScratchDir('bf'));
    const bytes = new Uint8Array([0x00, 0xff, 0x0a, 0x41]);
    const oid = (
      await runGit(repo, ['hash-object', '-w', '--stdin'], { input: bytes })
    ).stdout.trim();
    const blob = await runGit(repo, ['cat-file', 'blob', oid], { encoding: 'buffer' });
    expect(blob.stdout).toBeInstanceOf(Uint8Array);
    expect(Array.from(blob.stdout)).toEqual(Array.from(bytes));
  });

  it('throws GitError with the exit code and a stderr tail on failure', async () => {
    const repo = await initScratchRepo(makeScratchDir('er'));
    const failure = runGit(repo, ['rev-parse', 'does-not-exist']);
    await expect(failure).rejects.toBeInstanceOf(GitError);
    await expect(failure).rejects.toMatchObject({ exitCode: 128 });
    const error = (await failure.then(
      () => undefined,
      (caught: unknown) => caught,
    )) as GitError;
    expect(error.stderrTail.length).toBeLessThanOrEqual(20);
    expect(error.stderrTail.join('\n')).toContain('does-not-exist');
  });

  it('accepts listed non-zero exit codes', async () => {
    const repo = await initScratchRepo(makeScratchDir('ok'));
    const result = await runGit(repo, ['rev-parse', '--verify', '--quiet', 'refs/heads/nope'], {
      allowExitCodes: [0, 1],
    });
    expect(result.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// host registry
// ---------------------------------------------------------------------------------------------

function fakeStore(initial: HostRecord[] = []): HostRegistryStore & { hosts: HostRecord[] } {
  const hosts = [...initial];
  return {
    hosts,
    listHosts: () => [...hosts],
    upsertHost: (host) => {
      const index = hosts.findIndex((existing) => existing.id === host.id);
      if (index >= 0) hosts[index] = host;
      else hosts.push(host);
    },
  };
}

const detectGsd = async () => 'gsd';
const detectNone = () => 'none';

async function repoWithBranch(prefix: string, branch: string): Promise<string> {
  const repo = await initScratchRepo(makeScratchDir(prefix), { branch });
  writeFileIn(repo, 'README.md', '# scratch\n');
  await commitAll(repo);
  return repo;
}

describe('detectBaseBranch', () => {
  it('returns master when only master exists', async () => {
    const repo = await repoWithBranch('bm', 'master');
    expect(await detectBaseBranch(repo)).toBe('master');
  });

  it('prefers main over master', async () => {
    const repo = await repoWithBranch('bb', 'master');
    await gitIn(repo, ['branch', 'main']);
    expect(await detectBaseBranch(repo)).toBe('main');
  });

  it('follows refs/remotes/origin/HEAD', async () => {
    const repo = await repoWithBranch('bo', 'master');
    await gitIn(repo, ['branch', 'trunk']);
    await gitIn(repo, ['update-ref', 'refs/remotes/origin/trunk', 'HEAD']);
    await gitIn(repo, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk']);
    expect(await detectBaseBranch(repo)).toBe('trunk');
  });

  it('returns null when nothing matches', async () => {
    const repo = await repoWithBranch('bn', 'develop');
    expect(await detectBaseBranch(repo)).toBeNull();
  });
});

describe('registerHost', () => {
  it('registers a repo with only master', async () => {
    const repo = await repoWithBranch('rm', 'master');
    const store = fakeStore();
    const host = await registerHost(store, { cwd: repo, detectFramework: detectGsd });
    expect(host).toEqual({
      id: hostIdFromName(basename(repo)),
      root: realpathSync(repo),
      gitCommonDir: realpathSync(join(repo, '.git')),
      baseBranch: 'master',
      adapter: 'gsd',
    });
    expect(store.hosts).toEqual([host]);
  });

  it('uses origin/HEAD pointing at origin/main', async () => {
    const repo = await repoWithBranch('ro', 'master');
    await gitIn(repo, ['branch', 'main']);
    await gitIn(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    await gitIn(repo, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    const host = await registerHost(fakeStore(), { cwd: repo, detectFramework: detectGsd });
    expect(host.baseBranch).toBe('main');
  });

  it('resolves the repo root from a subdirectory', async () => {
    const repo = await repoWithBranch('rs', 'main');
    mkdirSync(join(repo, 'deep', 'er'), { recursive: true });
    const host = await registerHost(fakeStore(), {
      cwd: join(repo, 'deep', 'er'),
      detectFramework: detectGsd,
    });
    expect(host.root).toBe(realpathSync(repo));
  });

  it('accepts an explicit base branch that exists', async () => {
    const repo = await repoWithBranch('re', 'master');
    await gitIn(repo, ['branch', 'release']);
    const host = await registerHost(fakeStore(), {
      cwd: repo,
      base: 'release',
      detectFramework: detectGsd,
    });
    expect(host.baseBranch).toBe('release');
  });

  it.each([['nope'], ['master~1'], ['-x'], ['HEAD']])(
    'refuses an explicit base %j that is not an existing branch',
    async (base) => {
      const repo = await repoWithBranch('rx', 'master');
      const store = fakeStore();
      await expect(
        registerHost(store, { cwd: repo, base, detectFramework: detectGsd }),
      ).rejects.toThrow(
        `Couldn't find ${basename(repo)}'s base branch. Run counterpoint again with --base <branch>.`,
      );
      expect(store.hosts).toEqual([]);
    },
  );

  it('refuses when no base branch can be detected', async () => {
    const repo = await repoWithBranch('rd', 'develop');
    await expect(
      registerHost(fakeStore(), { cwd: repo, detectFramework: detectGsd }),
    ).rejects.toThrow(`Couldn't find ${basename(repo)}'s base branch.`);
  });

  it('refuses a directory that is not inside a git repository', async () => {
    // Scratch dirs sit inside this checkout, so use the filesystem root (read-only use).
    const dir = '/';
    await expect(
      registerHost(fakeStore(), { cwd: dir, detectFramework: detectGsd }),
    ).rejects.toThrow('is not inside a git repository');
  });

  it('stores whatever framework id the injected detector returns', async () => {
    const repo = await repoWithBranch('rf', 'main');
    const calls: Array<[string, string]> = [];
    const gsd = await registerHost(fakeStore(), {
      cwd: repo,
      detectFramework: async (root, baseBranch) => {
        calls.push([root, baseBranch]);
        return 'gsd';
      },
    });
    expect(gsd.adapter).toBe('gsd');
    expect(calls).toEqual([[realpathSync(repo), 'main']]);
    const none = await registerHost(fakeStore(), { cwd: repo, detectFramework: detectNone });
    expect(none.adapter).toBe('none');
  });

  it.each([[''], ['GSD'], ['../gsd'], ['a'.repeat(33)], ['gsd\n']])(
    'refuses a detector result %j that fails the framework id pattern',
    async (bad) => {
      const repo = await repoWithBranch('ri', 'main');
      const store = fakeStore();
      await expect(registerHost(store, { cwd: repo, detectFramework: () => bad })).rejects.toThrow(
        /framework id/i,
      );
      expect(store.hosts).toEqual([]);
    },
  );

  it('reuses the existing id for the same root', async () => {
    const repo = await repoWithBranch('ru', 'main');
    const store = fakeStore([
      {
        id: 'kept-id',
        root: realpathSync(repo),
        gitCommonDir: realpathSync(join(repo, '.git')),
        baseBranch: 'main',
        adapter: 'none',
      },
    ]);
    const host = await registerHost(store, { cwd: repo, detectFramework: detectGsd });
    expect(host.id).toBe('kept-id');
    expect(host.adapter).toBe('gsd');
    expect(store.hosts).toHaveLength(1);
  });

  it('suffixes -2, then -3, when the derived id belongs to another root', async () => {
    const repo = await repoWithBranch('rc', 'main');
    const derived = hostIdFromName(basename(repo));
    const other = (id: string): HostRecord => ({
      id,
      root: `/elsewhere/${id}`,
      gitCommonDir: `/elsewhere/${id}/.git`,
      baseBranch: 'main',
      adapter: 'none',
    });
    const store = fakeStore([other(derived)]);
    expect((await registerHost(store, { cwd: repo, detectFramework: detectGsd })).id).toBe(
      `${derived}-2`,
    );
    const store3 = fakeStore([other(derived), other(`${derived}-2`)]);
    expect((await registerHost(store3, { cwd: repo, detectFramework: detectGsd })).id).toBe(
      `${derived}-3`,
    );
  });
});

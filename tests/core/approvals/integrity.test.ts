// Integrity snapshot (APPR-04): only the execution-capable git surface is captured — risky
// `.git/config` keys plus hashes of real hooks, `.git/info/*` and config.worktree — and compared
// against the owner's baseline. Churn and sandbox-probe artifacts are ignored; nothing runs.
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  checkIntegrity,
  compareIntegrity,
  INTEGRITY_REFUSAL,
  RISKY_CONFIG_KEYS,
  readBaseline,
  snapshotIntegrity,
  writeBaseline,
} from '../../../src/core/approvals/integrity.ts';
import { gitIn, makeScratchDir, removeScratchDirs, writeFileIn } from '../../helpers/scratch.ts';

afterAll(removeScratchDirs);

const PROBE_NAME = `cp-${'0123456789abcdef'.repeat(2)}`;

/** A bare `git init` (no test identity), so the local config holds no risky keys. */
async function freshRepo(): Promise<{ dir: string; gitDir: string; home: string; host: { id: string; gitCommonDir: string } }> {
  const dir = makeScratchDir('irepo');
  await gitIn(dir, ['-c', 'init.defaultBranch=master', 'init', '-q']);
  const gitDir = join(dir, '.git');
  const home = makeScratchDir('ihome');
  return { dir, gitDir, home, host: { id: 'cena', gitCommonDir: gitDir } };
}

async function baselined() {
  const repo = await freshRepo();
  writeBaseline(repo.home, repo.host.id, await snapshotIntegrity(repo.gitDir));
  return repo;
}

describe('snapshotIntegrity', () => {
  it('captures no risky config and no hooks on a fresh repo, only the info/exclude hash', async () => {
    const { gitDir } = await freshRepo();
    const snapshot = await snapshotIntegrity(gitDir);
    expect(snapshot.schema).toBe('counterpoint/integrity/v1');
    expect(snapshot.config).toEqual({});
    expect(snapshot.hooks).toEqual({});
    expect(Object.keys(snapshot.info)).toEqual(['exclude']);
    expect(snapshot.info.exclude).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(snapshot.configWorktree).toBeNull();
  });

  it('lists a Cena-like signing setup (user.signingkey, gpg.format) in the baseline', async () => {
    const { dir, gitDir } = await freshRepo();
    await gitIn(dir, ['config', 'user.signingkey', '/Users/owner/.ssh/cena_owner.pub']);
    await gitIn(dir, ['config', 'gpg.format', 'ssh']);
    await gitIn(dir, ['config', 'branch.master.remote', 'origin']);
    const snapshot = await snapshotIntegrity(gitDir);
    expect(snapshot.config).toEqual({
      'gpg.format': ['ssh'],
      'user.signingkey': ['/Users/owner/.ssh/cena_owner.pub'],
    });
  });

  it('reads config without following includes and executes nothing', async () => {
    const { dir, gitDir } = await freshRepo();
    const marker = join(dir, 'ran');
    const script = writeFileIn(dir, 'trap.sh', `#!/bin/sh\ntouch '${marker}'\nexit 1\n`);
    chmodSync(script, 0o755);
    const included = writeFileIn(dir, 'extra.config', '[alias]\n\tevil = !touch x\n');
    await gitIn(dir, ['config', 'include.path', included]);
    await gitIn(dir, ['config', 'core.fsmonitor', script]);
    const hook = writeFileIn(dir, '.git/hooks/post-checkout', `#!/bin/sh\n'${script}'\n`);
    chmodSync(hook, 0o755);

    const snapshot = await snapshotIntegrity(gitDir);
    expect(snapshot.config['include.path']).toEqual([included]);
    expect(snapshot.config['alias.evil']).toBeUndefined();
    expect(snapshot.hooks['post-checkout']).toMatch(/^sha256:/);
    expect(existsSync(marker)).toBe(false);
  });

  it('records a symlinked hook by its target without following it', async () => {
    const { gitDir } = await freshRepo();
    const { symlinkSync } = await import('node:fs');
    symlinkSync('/bin/echo', join(gitDir, 'hooks', 'pre-push'));
    const snapshot = await snapshotIntegrity(gitDir);
    expect(snapshot.hooks['pre-push']).toBe('symlink:/bin/echo');
  });
});

describe('checkIntegrity', () => {
  it('is no-baseline before the owner trusts the host, then ok after writeBaseline', async () => {
    const repo = await freshRepo();
    expect(await checkIntegrity(repo.home, repo.host)).toEqual({ state: 'no-baseline' });
    writeBaseline(repo.home, repo.host.id, await snapshotIntegrity(repo.gitDir));
    expect(readBaseline(repo.home, repo.host.id)?.schema).toBe('counterpoint/integrity/v1');
    expect(await checkIntegrity(repo.home, repo.host)).toEqual({ state: 'ok' });
  });

  it('reports a new core.fsmonitor as changed', async () => {
    const repo = await baselined();
    await gitIn(repo.dir, ['config', 'core.fsmonitor', '/tmp/fsmonitor-hook']);
    const result = await checkIntegrity(repo.home, repo.host);
    expect(result.state).toBe('changed');
    if (result.state !== 'changed') return;
    expect(result.changes).toEqual([
      { area: 'config', name: 'core.fsmonitor', before: null, after: '/tmp/fsmonitor-hook' },
    ]);
  });

  it.each([
    ['core.hooksPath', 'core.hookspath', '/tmp/hooks'],
    ['alias.x', 'alias.x', '!sh -c id'],
    ['include.path', 'include.path', '/tmp/inc'],
    ['filter.lfs.smudge', 'filter.lfs.smudge', 'git-lfs smudge %f'],
    ['gpg.ssh.program', 'gpg.ssh.program', '/tmp/keygen'],
    ['includeIf.gitdir:~/x.path', 'includeif.gitdir:~/x.path', '/tmp/inc'],
    ['credential.helper', 'credential.helper', '!sh -c id'],
    ['diff.foo.textconv', 'diff.foo.textconv', 'cat'],
  ])('reports a new %s as changed', async (key, listed, value) => {
    const repo = await baselined();
    await gitIn(repo.dir, ['config', key, value]);
    const result = await checkIntegrity(repo.home, repo.host);
    expect(result).toEqual({
      state: 'changed',
      changes: [{ area: 'config', name: listed, before: null, after: value }],
    });
  });

  it('reports a changed remote.origin.url with before and after', async () => {
    const repo = await freshRepo();
    await gitIn(repo.dir, ['remote', 'add', 'origin', 'git@github.com:owner/cena.git']);
    writeBaseline(repo.home, repo.host.id, await snapshotIntegrity(repo.gitDir));
    await gitIn(repo.dir, ['remote', 'set-url', 'origin', 'git@evil.example:x.git']);
    const result = await checkIntegrity(repo.home, repo.host);
    expect(result).toEqual({
      state: 'changed',
      changes: [
        {
          area: 'config',
          name: 'remote.origin.url',
          before: 'git@github.com:owner/cena.git',
          after: 'git@evil.example:x.git',
        },
      ],
    });
  });

  it('reports a new non-sample hook, a changed info/exclude and a new config.worktree', async () => {
    const repo = await baselined();
    writeFileSync(join(repo.gitDir, 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n');
    writeFileSync(join(repo.gitDir, 'info', 'exclude'), '*.secret\n');
    writeFileSync(join(repo.gitDir, 'config.worktree'), '[core]\n\tsshCommand = evil\n');
    const result = await checkIntegrity(repo.home, repo.host);
    expect(result.state).toBe('changed');
    if (result.state !== 'changed') return;
    const names = result.changes.map((c) => `${c.area}:${c.name}`).sort();
    expect(names).toEqual(['config.worktree:config.worktree', 'hooks:pre-commit', 'info:exclude']);
    const hook = result.changes.find((c) => c.name === 'pre-commit');
    expect(hook?.before).toBeNull();
    expect(hook?.after).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('ignores branch tracking churn and edited .sample hooks', async () => {
    const repo = await baselined();
    await gitIn(repo.dir, ['config', 'branch.master.remote', 'origin']);
    await gitIn(repo.dir, ['config', 'branch.master.merge', 'refs/heads/master']);
    writeFileSync(join(repo.gitDir, 'hooks', 'pre-commit.sample'), '#!/bin/sh\necho changed\n');
    expect(await checkIntegrity(repo.home, repo.host)).toEqual({ state: 'ok' });
  });

  it('ignores sandbox-probe artifact names in hooks/ and info/', async () => {
    const repo = await baselined();
    writeFileSync(join(repo.gitDir, 'hooks', PROBE_NAME), 'probe\n');
    writeFileSync(join(repo.gitDir, 'hooks', `${PROBE_NAME}-w`), 'probe\n');
    writeFileSync(join(repo.gitDir, 'info', PROBE_NAME), 'probe\n');
    expect(await checkIntegrity(repo.home, repo.host)).toEqual({ state: 'ok' });
    writeFileSync(join(repo.gitDir, 'hooks', `${PROBE_NAME}x`), 'not a probe name\n');
    expect((await checkIntegrity(repo.home, repo.host)).state).toBe('changed');
  });
});

describe('compareIntegrity and copy', () => {
  it('returns ok for identical snapshots', async () => {
    const { gitDir } = await freshRepo();
    const a = await snapshotIntegrity(gitDir);
    expect(compareIntegrity(a, structuredClone(a))).toEqual({ ok: true });
  });

  it('covers the execution-capable key families', () => {
    for (const key of ['core.fsmonitor', 'core.hookspath', 'includeif.*', 'gpg.*', 'remote.*.url']) {
      expect(RISKY_CONFIG_KEYS).toContain(key);
    }
  });

  it('exports the UI-SPEC refusal sentence', () => {
    expect(INTEGRITY_REFUSAL('cena')).toBe(
      "Signing would be refused: cena's .git/config (or hooks) changed since Counterpoint last checked. Review the change in cena, then prepare the approval again.",
    );
  });
});

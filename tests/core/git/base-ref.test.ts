// The base-ref resolver and the narrow fetch over real repositories: a bare remote, the owner's
// clone of it, and a repository with no remote.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { fetchBaseBranch } from '../../../src/core/git/base-fetch.ts';
import { createBaseResolver, resolveBase } from '../../../src/core/git/base-ref.ts';
import { materializeFixtureRepo } from '../../helpers/fixture-repo.ts';
import {
  commitAll,
  gitIn,
  makeScratchDir,
  removeScratchDirs,
  writeFileIn,
} from '../../helpers/scratch.ts';

afterAll(() => {
  removeScratchDirs();
});

/** A bare remote with one commit on master, and the owner's clone of it. */
async function cloned() {
  const upstream = await materializeFixtureRepo('synthetic');
  const dir = makeScratchDir('remote');
  const remote = join(dir, 'remote.git');
  await gitIn(dir, ['clone', '-q', '--bare', upstream.root, remote]);
  const owner = join(makeScratchDir('owner'), 'clone');
  await gitIn(dir, ['clone', '-q', remote, owner]);
  await gitIn(owner, ['config', 'user.name', 'Owner']);
  await gitIn(owner, ['config', 'user.email', 'owner@counterpoint.invalid']);
  await gitIn(owner, ['config', 'commit.gpgsign', 'false']);
  return { upstream, remote, owner, first: upstream.commit };
}

/** Pushes a new commit to the bare remote from another clone; returns it. */
async function pushToRemote(remote: string, file: string): Promise<string> {
  const other = join(makeScratchDir('other'), 'clone');
  await gitIn(makeScratchDir('x'), ['clone', '-q', remote, other]);
  await gitIn(other, ['config', 'user.name', 'Someone']);
  await gitIn(other, ['config', 'user.email', 'someone@counterpoint.invalid']);
  writeFileIn(other, file, 'merged on GitHub\n');
  const commit = await commitAll(other, `add ${file}`);
  await gitIn(other, ['push', '-q', 'origin', 'master']);
  return commit;
}

const rev = async (repo: string, ref: string) => (await gitIn(repo, ['rev-parse', ref])).trim();

describe('the base-ref resolver', () => {
  it('reads the remote-tracking branch of a clone, not its unpushed local commits', async () => {
    const { owner, first } = await cloned();
    writeFileIn(owner, 'local.txt', 'not pushed\n');
    const local = await commitAll(owner, 'unpushed');

    const base = await resolveBase(owner, 'master');
    expect(base).toEqual({
      ref: 'refs/remotes/origin/master',
      label: 'origin/master',
      remote: 'origin',
      localOnly: false,
      tip: first,
    });
    expect(base.tip).not.toBe(local);
    expect(await createBaseResolver(owner, 'master').tip()).toBe(first);
  });

  it('follows the remote the base branch tracks', async () => {
    const { owner, first } = await cloned();
    await gitIn(owner, ['remote', 'rename', 'origin', 'upstream']);
    expect(await resolveBase(owner, 'master')).toMatchObject({
      ref: 'refs/remotes/upstream/master',
      label: 'upstream/master',
      tip: first,
    });
  });

  it('reads the local base branch of a repository with no remote, marked local only', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    expect(await resolveBase(repo.root, 'master')).toEqual({
      ref: 'refs/heads/master',
      label: 'master',
      remote: null,
      localOnly: true,
      tip: repo.commit,
    });
  });

  it('reads the local branch while the remote has not been fetched yet', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await gitIn(repo.root, ['remote', 'add', 'origin', '/nowhere/remote.git']);
    expect(await resolveBase(repo.root, 'master')).toMatchObject({
      ref: 'refs/heads/master',
      remote: 'origin',
      localOnly: true,
      tip: repo.commit,
    });
  });
});

describe('the base fetch', () => {
  it("moves only the remote-tracking branch: the owner's branch, HEAD, index, files and FETCH_HEAD stay", async () => {
    const { owner, remote } = await cloned();
    // The owner mid-edit: an unpushed commit on master, a staged edit, an unstaged edit and an
    // untracked file.
    writeFileIn(owner, 'unpushed.txt', 'mine\n');
    const unpushed = await commitAll(owner, 'unpushed');
    writeFileIn(owner, 'staged.txt', 'staged\n');
    await gitIn(owner, ['add', 'staged.txt']);
    writeFileIn(owner, 'openspec/config.yaml', 'edited, not staged\n');
    writeFileIn(owner, 'untracked.txt', 'untracked\n');
    writeFileSync(join(owner, '.git', 'FETCH_HEAD'), 'sentinel\n');
    const merged = await pushToRemote(remote, 'merged.txt');

    const before = {
      master: await rev(owner, 'refs/heads/master'),
      head: (await gitIn(owner, ['symbolic-ref', 'HEAD'])).trim(),
      index: readFileSync(join(owner, '.git', 'index')),
      status: await gitIn(owner, ['status', '--porcelain=v1', '--untracked-files=all']),
      config: readFileSync(join(owner, 'openspec', 'config.yaml'), 'utf8'),
    };
    expect(before.master).toBe(unpushed);

    await fetchBaseBranch({ repo: owner, baseBranch: 'master', remote: 'origin', env: {} });

    expect(await rev(owner, 'refs/remotes/origin/master')).toBe(merged);
    expect(await rev(owner, 'refs/heads/master')).toBe(before.master);
    expect((await gitIn(owner, ['symbolic-ref', 'HEAD'])).trim()).toBe(before.head);
    expect(readFileSync(join(owner, '.git', 'index'))).toEqual(before.index);
    expect(readFileSync(join(owner, 'openspec', 'config.yaml'), 'utf8')).toBe(before.config);
    expect(existsSync(join(owner, 'merged.txt'))).toBe(false);
    expect(readFileSync(join(owner, '.git', 'FETCH_HEAD'), 'utf8')).toBe('sentinel\n');
    expect(await gitIn(owner, ['status', '--porcelain=v1', '--untracked-files=all'])).toBe(
      before.status,
    );
    expect(await resolveBase(owner, 'master')).toMatchObject({ tip: merged, localOnly: false });
  });

  it('fails with the reason when the remote cannot be reached, and moves nothing', async () => {
    const { owner, first } = await cloned();
    await gitIn(owner, ['remote', 'set-url', 'origin', join(owner, 'missing.git')]);
    await expect(
      fetchBaseBranch({ repo: owner, baseBranch: 'master', remote: 'origin', env: {} }),
    ).rejects.toThrow(/missing\.git' does not appear to be a git repository/);
    expect(await rev(owner, 'refs/remotes/origin/master')).toBe(first);
  });
});

import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  branchFor,
  prepareWorktree,
  releaseWorktree,
  worktreePathFor,
} from '../../src/build/worktrees.ts';
import { runGit } from '../../src/core/git/run.ts';
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

async function setup() {
  const scratch = makeScratchDir('cp-wt');
  const root = join(scratch, 'host');
  mkdirSync(root);
  await initScratchRepo(root);
  writeFileIn(root, 'README.md', 'hi\n');
  await commitAll(root);
  const home = join(scratch, 'home');
  mkdirSync(home);
  const base = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const branch = (await runGit(root, ['symbolic-ref', '--short', 'HEAD'])).stdout.trim();
  const host = {
    id: 'cena',
    root: realpathSync(root),
    gitCommonDir: join(realpathSync(root), '.git'),
    baseBranch: branch,
  };
  const input = { host, change: 'add-menu', baseCommit: base, runId: 'run-1' };
  return { scratch, root: host.root, home, host, base, input };
}

describe('prepareWorktree', () => {
  it('makes cp/<change> from the base commit in a sibling folder, locked, and reuses it on resume', async () => {
    const { root, host, base, input } = await setup();
    const first = await prepareWorktree(input);
    expect(first).toEqual({
      path: worktreePathFor(root, 'add-menu'),
      branch: 'cp/add-menu',
      created: true,
      clone: { cloned: [], missing: [], present: [] },
    });
    expect(first.path).toBe(join(`${root}-worktrees`, 'add-menu'));
    expect((await runGit(first.path, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(base);
    const list = (await runGit(root, ['worktree', 'list', '--porcelain'])).stdout;
    expect(list).toContain(`worktree ${first.path}`);
    expect(list).toMatch(/locked counterpoint run run-1/);

    const again = await prepareWorktree(input);
    expect(again).toEqual({ ...first, created: false });

    await releaseWorktree(host, first.path);
    expect((await runGit(root, ['worktree', 'list', '--porcelain'])).stdout).not.toMatch(/locked/);
    expect(branchFor('x')).toBe('cp/x');
  });

  it("clones the host config's worktree.clone folders from the owner's checkout", async () => {
    const { root, input } = await setup();
    writeFileIn(root, '.gitignore', 'node_modules\n');
    await commitAll(root);
    const base = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    writeFileIn(root, 'node_modules/zod/index.js', 'export {}\n');
    const made = await prepareWorktree({ ...input, baseCommit: base, clone: ['node_modules'] });
    expect(made.clone.cloned).toEqual(['node_modules']);
    expect(existsSync(join(made.path, 'node_modules/zod/index.js'))).toBe(true);
    // Never part of a commit: the worktree's git ignores it.
    expect((await runGit(made.path, ['status', '--porcelain'])).stdout).toBe('');
  });

  it('refuses an existing branch that does not contain the base, and bad input', async () => {
    const { root, input } = await setup();
    await runGit(root, ['checkout', '-q', '--orphan', 'cp/add-menu']);
    writeFileIn(root, 'other.txt', 'x\n');
    await commitAll(root);
    await runGit(root, ['checkout', '-q', '-f', input.host.baseBranch]);
    await expect(prepareWorktree(input)).rejects.toMatchObject({ reason: 'branch' });
    await expect(prepareWorktree({ ...input, change: '../x' })).rejects.toMatchObject({
      reason: 'invalid',
    });
    await expect(prepareWorktree({ ...input, baseCommit: 'HEAD' })).rejects.toMatchObject({
      reason: 'invalid',
    });
  });
});

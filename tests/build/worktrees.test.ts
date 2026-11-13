import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  branchFor,
  finishMerge,
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
      continued: false,
      merged: null,
      backup: null,
    });
    expect(first.path).toBe(join(`${root}-worktrees`, 'add-menu'));
    expect((await runGit(first.path, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(base);
    const list = (await runGit(root, ['worktree', 'list', '--porcelain'])).stdout;
    expect(list).toContain(`worktree ${first.path}`);
    expect(list).toMatch(/locked counterpoint run run-1/);

    const again = await prepareWorktree(input);
    expect(again).toEqual({ ...first, created: false, continued: true });

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

  it('refuses a branch the base cannot be merged into, and bad input', async () => {
    const { root, input } = await setup();
    await runGit(root, ['checkout', '-q', '--orphan', 'cp/add-menu']);
    writeFileIn(root, 'other.txt', 'x\n');
    await commitAll(root);
    await runGit(root, ['checkout', '-q', '-f', input.host.baseBranch]);
    await expect(prepareWorktree(input)).rejects.toMatchObject({
      reason: 'branch',
      message: expect.stringMatching(/Merging the base into cp\/add-menu failed/),
    });
    await expect(prepareWorktree({ ...input, change: '../x' })).rejects.toMatchObject({
      reason: 'invalid',
    });
    await expect(prepareWorktree({ ...input, baseCommit: 'HEAD' })).rejects.toMatchObject({
      reason: 'invalid',
    });
  });
});

const OWNER = async () => ({ name: 'Alex Owner', email: 'alex@example.com' });
const isPlanningPath = (path: string) => path.startsWith('openspec/');

/** A build branch with one session's work, then the base moves on with `onBase`. */
async function movedBase(onBase: Record<string, string>, onBranch: Record<string, string> = {}) {
  const ctx = await setup();
  writeFileIn(ctx.root, 'openspec/changes/add-menu/tasks.md', '- [ ] 1.1 One\n- [ ] 1.2 Two\n');
  writeFileIn(ctx.root, 'src/menu.ts', 'export const menu = 1;\n');
  const base = await commitAll(ctx.root, 'plan');
  const input = { ...ctx.input, baseCommit: base, identity: OWNER, isPlanningPath };
  const first = await prepareWorktree(input);
  for (const [path, content] of Object.entries({ 'src/new.ts': 'export {}\n', ...onBranch })) {
    writeFileIn(first.path, path, content);
  }
  await commitAll(first.path, 'cp: add-menu session 1');
  await releaseWorktree(ctx.host, first.path);
  for (const [path, content] of Object.entries(onBase)) writeFileIn(ctx.root, path, content);
  const moved = await commitAll(ctx.root, 'merged elsewhere');
  return { ...ctx, input: { ...input, baseCommit: moved, runId: 'run-2' }, first, moved };
}

describe('a branch the base has moved past', () => {
  it('merges the base into it as the owner, dropping uncommitted ticks the base brings in', async () => {
    const { input, first, moved } = await movedBase({
      'openspec/changes/add-menu/tasks.md': '- [ ] 1.1 One\n- [x] 1.2 Two\n',
      'src/other.ts': 'export const other = 1;\n',
    });
    // The ticks a session kept uncommitted in the task list.
    writeFileIn(first.path, 'openspec/changes/add-menu/tasks.md', '- [x] 1.1 One\n- [ ] 1.2 Two\n');
    const again = await prepareWorktree(input);
    expect(again).toMatchObject({ continued: true, created: false, backup: null });
    expect(again.merged).toEqual({
      commit: expect.stringMatching(/^[0-9a-f]{40}$/),
      conflicts: [],
    });
    const head = await runGit(again.path, ['log', '-1', '--format=%an <%ae>%n%s%n%b']);
    expect(head.stdout).toContain('Alex Owner <alex@example.com>');
    expect(head.stdout).toContain(`cp: add-menu merge base ${moved.slice(0, 12)}`);
    expect(head.stdout).toContain('Counterpoint-Run: run-2');
    await runGit(again.path, ['merge-base', '--is-ancestor', moved, 'HEAD']);
    expect(existsSync(join(again.path, 'src/new.ts'))).toBe(true);
    expect((await runGit(again.path, ['status', '--porcelain'])).stdout).toBe('');
  });

  it("takes the base's planning files and leaves a code conflict for a session to resolve", async () => {
    const { input, moved } = await movedBase(
      {
        'openspec/changes/add-menu/tasks.md': '- [ ] 1.1 One (owner reworded)\n- [ ] 1.2 Two\n',
        'src/menu.ts': 'export const menu = 2;\n',
      },
      {
        'openspec/changes/add-menu/tasks.md': '- [x] 1.1 One\n- [ ] 1.2 Two\n',
        'src/menu.ts': 'export const menu = 3;\n',
      },
    );
    const again = await prepareWorktree(input);
    expect(again.merged).toEqual({ commit: null, conflicts: ['src/menu.ts'] });
    expect(readFileSync(join(again.path, 'openspec/changes/add-menu/tasks.md'), 'utf8')).toBe(
      '- [ ] 1.1 One (owner reworded)\n- [ ] 1.2 Two\n',
    );
    const finish = {
      worktree: again.path,
      change: 'add-menu',
      baseCommit: moved,
      runId: 'run-2',
      conflicts: ['src/menu.ts'],
      isPlanningPath,
      identity: OWNER,
    };
    // Markers left: nothing is committed.
    expect(await finishMerge(finish)).toEqual({ commit: null, left: ['src/menu.ts'] });
    // The session resolves it (and ticks a task, which stays uncommitted).
    writeFileIn(again.path, 'src/menu.ts', 'export const menu = 4;\n');
    writeFileIn(
      again.path,
      'openspec/changes/add-menu/tasks.md',
      '- [ ] 1.1 One (owner reworded)\n- [x] 1.2 Two\n',
    );
    const done = await finishMerge(finish);
    expect(done.commit).toMatch(/^[0-9a-f]{40}$/);
    await runGit(again.path, ['merge-base', '--is-ancestor', moved, 'HEAD']);
    expect((await runGit(again.path, ['show', 'HEAD:src/menu.ts'])).stdout).toBe(
      'export const menu = 4;\n',
    );
    expect(
      (await runGit(again.path, ['show', 'HEAD:openspec/changes/add-menu/tasks.md'])).stdout,
    ).toBe('- [ ] 1.1 One (owner reworded)\n- [ ] 1.2 Two\n');
    expect((await runGit(again.path, ['status', '--porcelain'])).stdout).toBe(
      ' M openspec/changes/add-menu/tasks.md\n',
    );
  });

  it('starts fresh from the base when asked, keeping the old branch as a backup', async () => {
    const { root, input, first, moved } = await movedBase({ 'src/other.ts': 'export {}\n' });
    const old = (await runGit(root, ['rev-parse', 'cp/add-menu'])).stdout.trim();
    const now = Date.UTC(2026, 10, 13, 9, 36);
    const again = await prepareWorktree({ ...input, fresh: true, now });
    expect(again).toMatchObject({
      path: first.path,
      created: true,
      continued: false,
      merged: null,
      backup: 'cp-backup/add-menu-20261113-0936',
    });
    expect(
      (await runGit(root, ['rev-parse', 'cp-backup/add-menu-20261113-0936'])).stdout.trim(),
    ).toBe(old);
    expect((await runGit(again.path, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(moved);
    expect(existsSync(join(again.path, 'src/new.ts'))).toBe(false);
    // A second fresh start the same minute gets its own backup name.
    const third = await prepareWorktree({ ...input, fresh: true, now, runId: 'run-3' });
    expect(third.backup).toBe('cp-backup/add-menu-20261113-0936-2');
  });
});

describe('a worktree folder deleted by hand', () => {
  it('is pruned and made again on the existing branch', async () => {
    const { input } = await setup();
    const first = await prepareWorktree(input);
    writeFileIn(first.path, 'src/kept.ts', 'export {}\n');
    await commitAll(first.path, 'work');
    // Still locked by its run, then deleted.
    rmSync(first.path, { recursive: true, force: true });
    const again = await prepareWorktree({ ...input, runId: 'run-2' });
    expect(again).toMatchObject({ path: first.path, created: true, continued: true });
    expect(existsSync(join(again.path, 'src/kept.ts'))).toBe(true);
  });
});

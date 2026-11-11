import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  branchFor,
  prepareWorktree,
  releaseWorktree,
  WorktreeRefusal,
  worktreePathFor,
} from '../../src/build/worktrees.ts';
import { snapshotIntegrity, writeBaseline } from '../../src/core/approvals/integrity.ts';
import { runGit } from '../../src/core/git/run.ts';
import { buildAgentSandboxSettings } from '../../src/core/security/sandbox-settings.ts';
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
  const accept = async () =>
    writeBaseline(
      home,
      host.id,
      await snapshotIntegrity(host.gitCommonDir, {
        project: { root: host.root, baseBranch: branch },
      }),
    );
  await accept();
  const userHome = join(scratch, 'user');
  mkdirSync(userHome);
  const launchSettings = buildAgentSandboxSettings({
    homeDir: userHome,
    counterpointHome: home,
    signingKeyDir: join(userHome, 'key'),
    ghConfigDir: join(userHome, 'gh'),
    hostGitDir: host.gitCommonDir,
  }).settings;
  const input = {
    home,
    host,
    change: 'add-menu',
    baseCommit: base,
    runId: 'run-1',
    launchSettings,
    homeDir: userHome,
  };
  return { scratch, root: host.root, home, host, base, input, accept };
}

describe('prepareWorktree', () => {
  it('makes cp/<change> from the base commit in a sibling folder, locked, and reuses it on resume', async () => {
    const { root, host, base, input } = await setup();
    const first = await prepareWorktree(input);
    expect(first).toEqual({
      path: worktreePathFor(root, 'add-menu'),
      branch: 'cp/add-menu',
      created: true,
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

  it('refuses when the integrity baseline does not hold', async () => {
    const { root, input } = await setup();
    await runGit(root, ['config', 'core.pager', 'less']);
    await expect(prepareWorktree(input)).rejects.toMatchObject({ reason: 'integrity' });
    expect(existsSync(worktreePathFor(root, 'add-menu'))).toBe(false);
  });

  it('refuses a base commit whose project settings widen the sandbox', async () => {
    const { root, input, accept } = await setup();
    writeFileIn(
      root,
      '.claude/settings.json',
      JSON.stringify({ sandbox: { filesystem: { allowWrite: ['~'] } } }),
    );
    await commitAll(root);
    await accept();
    const base = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await expect(prepareWorktree({ ...input, baseCommit: base })).rejects.toThrow(/allowWrite/);
  });

  it('refuses a base commit whose project hooks are not in the baseline', async () => {
    const { root, input } = await setup();
    writeFileIn(root, '.claude/settings.json', JSON.stringify({ hooks: { Stop: [] } }));
    await commitAll(root);
    const base = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    // The baseline was taken before the hook landed; the tip moved, so the integrity check sees it.
    await expect(prepareWorktree({ ...input, baseCommit: base })).rejects.toBeInstanceOf(
      WorktreeRefusal,
    );
  });

  it('refuses a base commit whose .claude folder differs from the baseline, naming the files', async () => {
    const { root, input, accept } = await setup();
    writeFileIn(root, '.claude/skills/apply/SKILL.md', '---\nname: apply\n---\n');
    await commitAll(root);
    await accept();
    const trusted = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    // The approval's base is an older commit whose skill differs from what the owner trusted at the
    // tip (the integrity check at the tip passes, the folder at the base does not).
    const older = { ...input, baseCommit: input.baseCommit, change: 'older-base' };
    await expect(prepareWorktree(older)).rejects.toThrow(
      /\.claude folder .* \(\.claude\/skills\/apply\/SKILL\.md\)/,
    );
    const ok = await prepareWorktree({ ...input, baseCommit: trusted, change: 'at-tip' });
    expect(ok.created).toBe(true);
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

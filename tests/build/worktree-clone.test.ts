// Folders cloned from the owner's checkout into a new worktree (worktree.clone).
import { existsSync, mkdirSync, readFileSync, readlinkSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CloneRefusal, cloneIntoWorktree, escapingLink } from '../../src/build/worktree-clone.ts';
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

/** A host checkout with an installed, git-ignored node_modules in pnpm's shape, and a worktree. */
async function setup() {
  const scratch = makeScratchDir('cp-clone');
  const host = join(scratch, 'host');
  const worktree = join(scratch, 'wt');
  for (const dir of [host, worktree]) {
    mkdirSync(dir);
    await initScratchRepo(dir);
    writeFileIn(dir, '.gitignore', 'node_modules\n');
    await commitAll(dir);
  }
  writeFileIn(host, 'node_modules/.pnpm/zod@4/node_modules/zod/index.js', 'export {}\n');
  symlinkSync('.pnpm/zod@4/node_modules/zod', join(host, 'node_modules', 'zod'));
  mkdirSync(join(host, 'node_modules', '.bin'));
  symlinkSync('../zod/index.js', join(host, 'node_modules', '.bin', 'zod'));
  return { scratch, host, worktree };
}

describe('cloneIntoWorktree', () => {
  it("copies an ignored folder from the owner's checkout with its relative links intact", async () => {
    const { host, worktree } = await setup();
    const result = await cloneIntoWorktree({
      hostRoot: host,
      worktree,
      paths: ['node_modules', 'vendor'],
    });
    expect(result).toEqual({ cloned: ['node_modules'], missing: ['vendor'], present: [] });
    expect(readFileSync(join(worktree, 'node_modules/zod/index.js'), 'utf8')).toBe('export {}\n');
    expect(readlinkSync(join(worktree, 'node_modules/zod'))).toBe('.pnpm/zod@4/node_modules/zod');
    // A second call (a resumed run) leaves what is there.
    const again = await cloneIntoWorktree({ hostRoot: host, worktree, paths: ['node_modules'] });
    expect(again.present).toEqual(['node_modules']);
  });

  it('refuses a folder git does not ignore, which a session commit would add', async () => {
    const { host, worktree } = await setup();
    writeFileIn(host, 'vendor/a.js', 'x\n');
    await expect(
      cloneIntoWorktree({ hostRoot: host, worktree, paths: ['vendor'] }),
    ).rejects.toThrow(/not ignored by git/);
    expect(existsSync(join(worktree, 'vendor'))).toBe(false);
  });

  it('refuses, and leaves nothing, when a link in the folder leads outside it', async () => {
    const { scratch, host, worktree } = await setup();
    symlinkSync(join(scratch, 'host'), join(host, 'node_modules', 'checkout'));
    await expect(
      cloneIntoWorktree({ hostRoot: host, worktree, paths: ['node_modules'] }),
    ).rejects.toThrow(/link that leads outside it \(checkout ->/);
    expect(existsSync(join(worktree, 'node_modules'))).toBe(false);
    expect(escapingLink(join(host, 'node_modules'))).toMatch(/^checkout -> /);
  });

  it('refuses a source that is a link, and git or agent folders', async () => {
    const { scratch, host, worktree } = await setup();
    mkdirSync(join(scratch, 'elsewhere'));
    symlinkSync(join(scratch, 'elsewhere'), join(host, 'deps'));
    writeFileIn(worktree, '.gitignore', 'node_modules\ndeps\n');
    await expect(cloneIntoWorktree({ hostRoot: host, worktree, paths: ['deps'] })).rejects.toThrow(
      /not a plain folder/,
    );
    for (const path of ['.claude', '.git/hooks', '../x']) {
      await expect(
        cloneIntoWorktree({ hostRoot: host, worktree, paths: [path] }),
      ).rejects.toBeInstanceOf(CloneRefusal);
    }
  });
});

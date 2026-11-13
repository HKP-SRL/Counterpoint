// The owner's git identity for session commits: read as the owner's own `git commit` would (repo
// config, then global), refusing values that could smuggle anything into a commit header.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ownerIdentity } from '../../../src/core/git/run.ts';
import {
  gitIn,
  initScratchRepo,
  makeScratchDir,
  removeScratchDirs,
} from '../../helpers/scratch.ts';

afterAll(() => {
  removeScratchDirs();
});

/** A scratch HOME whose ~/.gitconfig holds `body`, and a repo with no identity of its own. */
async function setup(globalConfig: string) {
  const home = makeScratchDir('cp-ident-home');
  writeFileSync(join(home, '.gitconfig'), globalConfig);
  const repo = await initScratchRepo(makeScratchDir('cp-ident-repo'));
  await gitIn(repo, ['config', '--unset', 'user.name']);
  await gitIn(repo, ['config', '--unset', 'user.email']);
  const env = { PATH: process.env.PATH, HOME: home, LANG: 'C', TMPDIR: process.env.TMPDIR };
  return { repo, env };
}

describe('ownerIdentity', () => {
  it("reads the owner's global identity, which the hardened runner ignores", async () => {
    const { repo, env } = await setup('[user]\n\tname = Ada Owner\n\temail = ada@example.com\n');
    expect(await ownerIdentity(repo, env)).toEqual({ name: 'Ada Owner', email: 'ada@example.com' });
  });

  it("prefers the repository's own identity, as git commit does", async () => {
    const { repo, env } = await setup('[user]\n\tname = Ada Owner\n\temail = ada@example.com\n');
    await gitIn(repo, ['config', 'user.email', 'ada@work.example']);
    expect(await ownerIdentity(repo, env)).toEqual({
      name: 'Ada Owner',
      email: 'ada@work.example',
    });
  });

  it('is null when a value is missing or could forge a header', async () => {
    const missing = await setup('[user]\n\tname = Ada Owner\n');
    expect(await ownerIdentity(missing.repo, missing.env)).toBeNull();
    const forged = await setup('[user]\n\tname = Ada <evil@x>\n\temail = ada@example.com\n');
    expect(await ownerIdentity(forged.repo, forged.env)).toBeNull();
    const notEmail = await setup('[user]\n\tname = Ada\n\temail = ada at example\n');
    expect(await ownerIdentity(notEmail.repo, notEmail.env)).toBeNull();
  });
});

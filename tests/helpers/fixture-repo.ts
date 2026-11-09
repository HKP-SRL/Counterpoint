// Materializes a planning fixture from tests/fixtures/gsd/{name} into a scratch git repository so
// tests read it the way the adapter does in production: from a commit, never the working tree.
import { cpSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitAll, initScratchRepo, makeScratchDir, writeFileIn } from './scratch.ts';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'gsd');

export interface FixtureRepo {
  root: string;
  commit: string;
}

/** Copies the fixture into a fresh scratch repo and commits it on `branch` (default `master`). */
export async function materializeFixtureRepo(
  name: string,
  options: { branch?: string } = {},
): Promise<FixtureRepo> {
  const root = makeScratchDir(`fx-${name.slice(0, 12)}`);
  await initScratchRepo(root, { branch: options.branch ?? 'master' });
  cpSync(join(FIXTURES, name), root, { recursive: true });
  const commit = await commitAll(root, `fixture ${name}`);
  return { root, commit };
}

/** Writes (or, with null, deletes) one file and commits. Returns the new commit sha. */
export async function commitChange(
  root: string,
  relPath: string,
  content: string | Uint8Array | null,
): Promise<string> {
  if (content === null) {
    rmSync(join(root, relPath), { force: true });
  } else {
    writeFileIn(root, relPath, content);
  }
  return commitAll(root, `change ${relPath}`);
}

/** Commits a symbolic link at `relPath` pointing at `target`. Returns the new commit sha. */
export async function commitSymlink(root: string, relPath: string, target: string): Promise<string> {
  const link = join(root, relPath);
  mkdirSync(dirname(link), { recursive: true });
  rmSync(link, { force: true });
  symlinkSync(target, link);
  return commitAll(root, `symlink ${relPath}`);
}

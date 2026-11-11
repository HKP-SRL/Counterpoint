// Folders cloned from the owner's checkout into a new worktree (owner decision 2026-11-11: the host
// config's `worktree.clone`, for example `node_modules`).
//
// A fresh worktree has no installed dependencies, and nothing in a run may install them: gates and
// builders have no internet, and an install outside the sandbox would run package scripts the
// builder could have changed. So the host can name folders that are copied from the owner's own
// checkout when a worktree is made, as an APFS copy-on-write clone (`cp -c`, seconds and almost no
// disk; a plain copy where cloning is not supported). A symlink to the checkout was tried and
// rejected: Turbopack refuses a `node_modules` that points outside the project, and a link would
// let anything that writes through it reach the owner's checkout.
//
// Rules, each checked here:
// - only folders the worktree's git ignores (`git check-ignore`), so a session commit never adds
//   them; never `.git`, `.claude` or `.counterpoint` (the host config schema refuses those too);
// - the source is a real folder inside the owner's checkout, not a link;
// - the target does not exist yet, and its parent resolves inside the worktree;
// - after copying, every symlink in the clone must resolve inside the clone. Package managers link
//   relatively within the folder; a link that leads out (into the owner's checkout, say) would let
//   a write through it land outside the worktree, so such a clone is removed and refused.
// The dependencies are the owner's installed ones, not necessarily the approved base's lockfile; a
// change that adds a dependency cannot install it, so its gates fail and it parks.
import { execFile } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  opendirSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { runGit } from '../core/git/run.ts';

const CP = '/bin/cp';
const CP_TIMEOUT_MS = 20 * 60 * 1000;
const FORBIDDEN = ['.git', '.claude', '.counterpoint'];

export class CloneRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloneRefusal';
  }
}

export interface CloneResult {
  cloned: string[];
  /** Listed folders the owner's checkout does not have (nothing to clone). */
  missing: string[];
  /** Listed folders the worktree already has (a resumed run). */
  present: string[];
}

function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

function cp(args: readonly string[]): Promise<string | null> {
  return new Promise((done) => {
    execFile(
      CP,
      [...args],
      { timeout: CP_TIMEOUT_MS, env: { PATH: '/usr/bin:/bin' } },
      (error, _stdout, stderr) => done(error ? String(stderr).trim() || error.message : null),
    );
  });
}

/** The first symlink under `root` that resolves outside it, or null. */
export function escapingLink(root: string): string | null {
  const walk = (dir: string): string | null => {
    const handle = opendirSync(dir);
    try {
      for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
        const path = join(dir, entry.name);
        if (entry.isSymbolicLink()) {
          let target: string;
          try {
            target = realpathSync(path);
          } catch {
            // Dangling: judge where it points.
            target = resolve(dirname(path), readlinkSync(path));
          }
          if (!inside(root, target))
            return `${path.slice(root.length + 1)} -> ${readlinkSync(path)}`;
        } else if (entry.isDirectory()) {
          const found = walk(path);
          if (found !== null) return found;
        }
      }
      return null;
    } finally {
      handle.closeSync();
    }
  };
  return walk(root);
}

/** Clones each listed folder from the owner's checkout into the worktree (see the rules above). */
export async function cloneIntoWorktree(input: {
  hostRoot: string;
  worktree: string;
  paths: readonly string[];
}): Promise<CloneResult> {
  const hostRoot = realpathSync(input.hostRoot);
  const worktree = realpathSync(input.worktree);
  const result: CloneResult = { cloned: [], missing: [], present: [] };
  for (const path of input.paths) {
    const first = path.split('/')[0] ?? '';
    if (
      path === '' ||
      path.startsWith('/') ||
      path.split('/').includes('..') ||
      FORBIDDEN.includes(first)
    ) {
      throw new CloneRefusal(`worktree.clone: ${path} may not be cloned.`);
    }
    const target = join(worktree, path);
    if (lstatSync(target, { throwIfNoEntry: false }) !== undefined) {
      result.present.push(path);
      continue;
    }
    const source = join(hostRoot, path);
    const stat = lstatSync(source, { throwIfNoEntry: false });
    if (stat === undefined) {
      result.missing.push(path);
      continue;
    }
    if (!stat.isDirectory() || !inside(hostRoot, realpathSync(source))) {
      throw new CloneRefusal(`worktree.clone: ${path} in your checkout is not a plain folder.`);
    }
    const ignored = await runGit(worktree, ['check-ignore', '-q', '--', path], {
      allowExitCodes: [0, 1],
    });
    if (ignored.exitCode !== 0) {
      throw new CloneRefusal(
        `worktree.clone: ${path} is not ignored by git in the worktree, so a session commit would add it.`,
      );
    }
    mkdirSync(dirname(target), { recursive: true });
    if (!inside(worktree, realpathSync(dirname(target)))) {
      throw new CloneRefusal(`worktree.clone: ${path} would land outside the worktree.`);
    }
    // -P: copy symlinks as symlinks. -c: APFS clone; fall back to a plain copy.
    let failure = await cp(['-c', '-R', '-P', source, target]);
    if (failure !== null) {
      rmSync(target, { recursive: true, force: true });
      failure = await cp(['-R', '-P', source, target]);
    }
    if (failure !== null || !existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
      throw new CloneRefusal(
        `worktree.clone: copying ${path} failed: ${failure ?? 'no copy made'}`,
      );
    }
    const leak = escapingLink(realpathSync(target));
    if (leak !== null) {
      rmSync(target, { recursive: true, force: true });
      throw new CloneRefusal(
        `worktree.clone: ${path} holds a link that leads outside it (${leak}), so it was not cloned.`,
      );
    }
    result.cloned.push(path);
  }
  return result;
}

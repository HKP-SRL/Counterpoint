// Worktrees for builds (build-runs: One worktree and branch per change).
//
// Each change builds on its own branch `cp/<change>`, made from the base commit its build started
// from (the base-branch tip then), in its own linked worktree at `<repo>-worktrees/<change>`, a
// sibling of the host repository and never inside it or the owner's checkout. The worktree is
// locked while a run holds it, so a `git worktree prune` elsewhere cannot drop it. Every git call
// goes through the hardened runner (hooks, fsmonitor and pagers off, global config ignored).
//
// After it is made, the folders the host config lists under `worktree.clone` (such as
// `node_modules`) are copied in from the owner's checkout as copy-on-write clones
// (worktree-clone.ts): still the fastest way to get dependencies.
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { runGit } from '../core/git/run.ts';
import { isChangeId } from '../core/ids.ts';
import { CloneRefusal, type CloneResult, cloneIntoWorktree } from './worktree-clone.ts';

const COMMIT_RE = /^[0-9a-f]{40}$/;

export interface WorktreeHost {
  id: string;
  root: string;
  gitCommonDir: string;
  baseBranch: string;
}

export class WorktreeRefusal extends Error {
  readonly reason: 'branch' | 'invalid' | 'clone';

  constructor(reason: WorktreeRefusal['reason'], message: string) {
    super(message);
    this.name = 'WorktreeRefusal';
    this.reason = reason;
  }
}

export function branchFor(change: string): string {
  return `cp/${change}`;
}

/** `<parent>/<repo>-worktrees/<change>` for the repository at `hostRoot`. */
export function worktreePathFor(hostRoot: string, change: string): string {
  const root = realpathSync(hostRoot);
  return join(dirname(root), `${basename(root)}-worktrees`, change);
}

export interface PreparedWorktree {
  path: string;
  branch: string;
  /** False when an existing worktree for the branch was reused (a resumed run). */
  created: boolean;
  /** What the host config's `worktree.clone` copied in (worktree-clone.ts). */
  clone: CloneResult;
}

async function branchExists(root: string, branch: string): Promise<boolean> {
  const { exitCode } = await runGit(
    root,
    ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
    {
      allowExitCodes: [0, 1],
    },
  );
  return exitCode === 0;
}

/** Worktree paths registered in the host, by branch ref. */
async function worktreesByBranch(root: string): Promise<Map<string, string>> {
  const { stdout } = await runGit(root, ['worktree', 'list', '--porcelain', '-z']);
  const map = new Map<string, string>();
  let path: string | null = null;
  for (const field of stdout.split('\0')) {
    if (field.startsWith('worktree ')) path = field.slice('worktree '.length);
    else if (field.startsWith('branch ') && path !== null)
      map.set(field.slice('branch '.length), path);
    else if (field === '') path = null;
  }
  return map;
}

/**
 * Makes (or, on a resumed run, reuses) the change's worktree and locks it for `runId`. A branch
 * `cp/<change>` that exists must contain `baseCommit`; one that does not is made from it.
 */
export async function prepareWorktree(input: {
  host: WorktreeHost;
  change: string;
  baseCommit: string;
  runId: string;
  /** The host config's `worktree.clone`, read at the base commit. */
  clone?: readonly string[];
}): Promise<PreparedWorktree> {
  const { host, change, baseCommit } = input;
  if (!isChangeId(change)) throw new WorktreeRefusal('invalid', 'Invalid change name.');
  if (!COMMIT_RE.test(baseCommit)) throw new WorktreeRefusal('invalid', 'Invalid base commit.');
  if (!/^[A-Za-z0-9-]{1,64}$/.test(input.runId))
    throw new WorktreeRefusal('invalid', 'Invalid run id.');

  const branch = branchFor(change);
  const ref = `refs/heads/${branch}`;
  const path = worktreePathFor(host.root, change);
  let created = false;
  if (await branchExists(host.root, branch)) {
    const contains = await runGit(host.root, ['merge-base', '--is-ancestor', baseCommit, ref], {
      allowExitCodes: [0, 1],
    });
    if (contains.exitCode !== 0) {
      throw new WorktreeRefusal(
        'branch',
        `${branch} exists but does not contain the base commit ${baseCommit.slice(0, 12)}. Merge the base branch into it or delete it, then build again.`,
      );
    }
    const registered = (await worktreesByBranch(host.root)).get(ref);
    if (registered === undefined) {
      mkdirSync(dirname(path), { recursive: true });
      await runGit(host.root, ['worktree', 'add', path, branch], { timeoutMs: 300_000 });
      created = true;
    } else if (registered !== path && realpathSync(registered) !== path) {
      throw new WorktreeRefusal('branch', `${branch} is checked out elsewhere (${registered}).`);
    }
  } else {
    if (existsSync(path))
      throw new WorktreeRefusal('branch', `${path} exists but is not this change's worktree.`);
    mkdirSync(dirname(path), { recursive: true });
    await runGit(host.root, ['worktree', 'add', '-b', branch, path, baseCommit], {
      timeoutMs: 300_000,
    });
    created = true;
  }
  // Locked while the run holds it; a second lock by the same run is fine.
  await runGit(
    host.root,
    ['worktree', 'lock', '--reason', `counterpoint run ${input.runId}`, path],
    {
      allowExitCodes: [0, 128],
    },
  );
  let clone: CloneResult = { cloned: [], missing: [], present: [] };
  try {
    clone = await cloneIntoWorktree({
      hostRoot: host.root,
      worktree: path,
      paths: input.clone ?? [],
    });
  } catch (error) {
    if (error instanceof CloneRefusal) throw new WorktreeRefusal('clone', error.message);
    throw error;
  }
  return { path, branch, created, clone };
}

/** Unlocks the change's worktree (the run no longer holds it). The worktree stays for review. */
export async function releaseWorktree(host: WorktreeHost, path: string): Promise<void> {
  await runGit(host.root, ['worktree', 'unlock', path], { allowExitCodes: [0, 128] });
}

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
//
// A branch that exists already is built on again. When the base has moved past it (merged PRs
// move it all the time), the base is merged into the branch in its worktree, committed as the
// owner. Planning files that conflict take the base's version (builds never write planning
// files); a conflict in anything else is left in the worktree for a builder session to resolve
// (`finishMerge` then commits it). When the change's last PR was closed or merged, the caller asks
// for a fresh start instead: the old branch is kept as `cp-backup/<change>-<yyyymmdd-hhmm>` and the
// branch is made again from the base. A worktree folder deleted by hand is pruned and made again.
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { type GitIdentity, ownerIdentity, runGit } from '../core/git/run.ts';
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
  /** The branch existed before and is built on again (not made from the base now). */
  continued: boolean;
  /** Set when the base was merged into the existing branch. */
  merged: BaseMerge | null;
  /** The old branch's new name, when the change started fresh from the base. */
  backup: string | null;
}

export interface BaseMerge {
  /** The merge commit, or null while conflicts wait for a session (the merge is in progress). */
  commit: string | null;
  /** Paths that still conflict; empty once the merge is committed. */
  conflicts: string[];
}

/**
 * Commits made here carry the owner's git identity, like session commits (session-commit.ts);
 * Counterpoint's own when git config has none. Never signed.
 */
const FALLBACK_IDENTITY: GitIdentity = { name: 'Counterpoint', email: 'counterpoint@localhost' };

type IdentityLookup = (worktree: string) => Promise<GitIdentity | null>;

async function identityArgs(
  worktree: string,
  lookup: IdentityLookup = ownerIdentity,
): Promise<string[]> {
  const identity = (await lookup(worktree)) ?? FALLBACK_IDENTITY;
  return [
    '-c',
    `user.name=${identity.name}`,
    '-c',
    `user.email=${identity.email}`,
    '-c',
    'commit.gpgsign=false',
  ];
}

function nulList(stdout: string): string[] {
  return stdout.split('\0').filter((path) => path !== '');
}

/** `cp-backup/<change>-<yyyymmdd-hhmm>`, with `-2`, `-3`... when that name is taken. */
async function backupName(root: string, change: string, now: number): Promise<string> {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  for (let n = 1; ; n += 1) {
    const name = `cp-backup/${change}-${stamp}${n === 1 ? '' : `-${n}`}`;
    if (!(await branchExists(root, name))) return name;
  }
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
 * The worktree registered for `ref`, or undefined. One whose folder is gone (deleted by hand) is
 * unlocked and pruned, so it can be added again.
 */
async function registeredWorktree(root: string, ref: string): Promise<string | undefined> {
  const registered = (await worktreesByBranch(root)).get(ref);
  if (registered === undefined || existsSync(registered)) return registered;
  await runGit(root, ['worktree', 'unlock', registered], { allowExitCodes: [0, 128] });
  await runGit(root, ['worktree', 'prune']);
  return (await worktreesByBranch(root)).get(ref);
}

function isOurs(registered: string, path: string): boolean {
  return registered === path || realpathSync(registered) === path;
}

function mergeMessage(change: string, baseCommit: string): string {
  return `cp: ${change} merge base ${baseCommit.slice(0, 12)}`;
}

/**
 * Merges `baseCommit` into the branch checked out at `worktree`, as the owner. Uncommitted edits
 * to files the merge brings in (the task list's ticks, recorded in the store) are dropped first.
 * Conflicting planning files take the base's version; other conflicts are left in progress.
 */
async function mergeBase(input: {
  worktree: string;
  change: string;
  baseCommit: string;
  runId: string;
  isPlanningPath: (path: string) => boolean;
  identity?: IdentityLookup;
}): Promise<BaseMerge> {
  const { worktree, baseCommit } = input;
  const common = await runGit(worktree, ['merge-base', 'HEAD', baseCommit], {
    allowExitCodes: [0, 1],
  });
  if (common.exitCode !== 0) {
    throw new WorktreeRefusal(
      'branch',
      `Merging the base into ${branchFor(input.change)} failed: it shares no history with the base. Delete the branch, then build again.`,
    );
  }
  const from = common.stdout.trim();
  const incoming = new Set(
    nulList(
      (await runGit(worktree, ['diff', '--name-only', '-z', '--no-renames', from, baseCommit]))
        .stdout,
    ),
  );
  const dirty = nulList((await runGit(worktree, ['diff', '--name-only', '-z', 'HEAD'])).stdout);
  const drop = dirty.filter((path) => incoming.has(path));
  if (drop.length > 0) await runGit(worktree, ['checkout', '-q', 'HEAD', '--', ...drop]);

  const identity = await identityArgs(worktree, input.identity);
  const message = mergeMessage(input.change, baseCommit);
  const trailer = `Counterpoint-Run: ${input.runId}`;
  const merged = await runGit(
    worktree,
    [...identity, 'merge', '--no-ff', '--no-edit', '-m', message, '-m', trailer, baseCommit],
    { allowExitCodes: [0, 1, 2, 128], timeoutMs: 300_000 },
  );
  const inProgress =
    (
      await runGit(worktree, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], {
        allowExitCodes: [0, 1],
      })
    ).exitCode === 0;
  if (merged.exitCode === 0 && !inProgress) {
    return { commit: (await runGit(worktree, ['rev-parse', 'HEAD'])).stdout.trim(), conflicts: [] };
  }
  if (!inProgress) {
    const why =
      merged.stderr.trim().split('\n').at(-1) ?? `git merge exited with code ${merged.exitCode}`;
    throw new WorktreeRefusal(
      'branch',
      `Merging the base into ${branchFor(input.change)} failed: ${why}`,
    );
  }
  const conflicts = nulList(
    (await runGit(worktree, ['diff', '--name-only', '-z', '--diff-filter=U'])).stdout,
  );
  const left: string[] = [];
  for (const path of conflicts) {
    if (!input.isPlanningPath(path)) {
      left.push(path);
      continue;
    }
    const onBase = await runGit(worktree, ['cat-file', '-e', `${baseCommit}:${path}`], {
      allowExitCodes: [0, 1, 128],
    });
    if (onBase.exitCode === 0) await runGit(worktree, ['checkout', '-q', baseCommit, '--', path]);
    else await runGit(worktree, ['rm', '-q', '-f', '--', path]);
  }
  if (left.length > 0) return { commit: null, conflicts: left };
  await runGit(
    worktree,
    [...identity, 'commit', '-q', '--no-verify', '-m', message, '-m', trailer],
    {
      timeoutMs: 120_000,
    },
  );
  return { commit: (await runGit(worktree, ['rev-parse', 'HEAD'])).stdout.trim(), conflicts: [] };
}

/** A conflict marker git leaves at the start of a line. */
const MARKER_RE = /^(<{7}|>{7})( |$)/m;

/**
 * Commits a base merge whose conflicts a builder session resolved. Refused (nothing committed)
 * while a conflicted file still holds conflict markers. Planning files and `.claude/` are left as
 * the merge made them: an edit the session made to one stays uncommitted (the next session's
 * commit puts it back), as do the task list's ticks.
 */
export async function finishMerge(input: {
  worktree: string;
  change: string;
  baseCommit: string;
  runId: string;
  conflicts: readonly string[];
  isPlanningPath: (path: string) => boolean;
  identity?: IdentityLookup;
}): Promise<{ commit: string; left: [] } | { commit: null; left: string[] }> {
  const { worktree } = input;
  const left = input.conflicts.filter((path) => {
    try {
      return MARKER_RE.test(readFileSync(join(worktree, path), 'utf8'));
    } catch {
      return false; // deleted: resolved by removing it
    }
  });
  if (left.length > 0) return { commit: null, left };
  const status = (
    await runGit(worktree, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--no-renames',
    ])
  ).stdout;
  const paths = status
    .split('\0')
    .filter((entry) => entry.length >= 4)
    .map((entry) => entry.slice(3))
    .filter(
      (path) => !input.isPlanningPath(path) && path !== '.claude' && !path.startsWith('.claude/'),
    );
  if (paths.length > 0) {
    await runGit(worktree, ['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], {
      input: `${paths.join('\0')}\0`,
    });
  }
  const identity = await identityArgs(worktree, input.identity);
  await runGit(
    worktree,
    [
      ...identity,
      'commit',
      '-q',
      '--no-verify',
      '-m',
      mergeMessage(input.change, input.baseCommit),
      '-m',
      `Counterpoint-Run: ${input.runId}`,
    ],
    { timeoutMs: 120_000 },
  );
  return { commit: (await runGit(worktree, ['rev-parse', 'HEAD'])).stdout.trim(), left: [] };
}

/**
 * Makes (or reuses) the change's worktree and locks it for `runId`. A branch `cp/<change>` that
 * does not exist is made from `baseCommit`. One that exists is built on again, with the base merged
 * in when it lacks `baseCommit`, unless `fresh` asks to keep it as a backup and start again.
 */
export async function prepareWorktree(input: {
  host: WorktreeHost;
  change: string;
  baseCommit: string;
  runId: string;
  /** The host config's `worktree.clone`, read at the base commit. */
  clone?: readonly string[];
  /** Start again from the base: an existing branch is kept as `cp-backup/<change>-<stamp>`. */
  fresh?: boolean;
  /** The host's planning files: a merge conflict in one takes the base's version. */
  isPlanningPath?: (path: string) => boolean;
  /** Seams for tests. */
  now?: number;
  identity?: IdentityLookup;
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
  let continued = false;
  let merged: BaseMerge | null = null;
  let backup: string | null = null;
  if (input.fresh === true && (await branchExists(host.root, branch))) {
    const registered = await registeredWorktree(host.root, ref);
    if (registered !== undefined && !isOurs(registered, path)) {
      throw new WorktreeRefusal('branch', `${branch} is checked out elsewhere (${registered}).`);
    }
    if (registered !== undefined) {
      await runGit(host.root, ['worktree', 'unlock', registered], { allowExitCodes: [0, 128] });
      await runGit(host.root, ['worktree', 'remove', '--force', registered], {
        timeoutMs: 300_000,
      });
    }
    backup = await backupName(host.root, change, input.now ?? Date.now());
    await runGit(host.root, ['branch', '-m', branch, backup]);
  }
  if (await branchExists(host.root, branch)) {
    continued = true;
    const registered = await registeredWorktree(host.root, ref);
    if (registered === undefined) {
      if (existsSync(path))
        throw new WorktreeRefusal('branch', `${path} exists but is not this change's worktree.`);
      mkdirSync(dirname(path), { recursive: true });
      await runGit(host.root, ['worktree', 'add', path, branch], { timeoutMs: 300_000 });
      created = true;
    } else if (!isOurs(registered, path)) {
      throw new WorktreeRefusal('branch', `${branch} is checked out elsewhere (${registered}).`);
    }
    const contains = await runGit(host.root, ['merge-base', '--is-ancestor', baseCommit, ref], {
      allowExitCodes: [0, 1],
    });
    if (contains.exitCode !== 0) {
      // A merge an earlier try left half done starts again.
      await runGit(path, ['merge', '--abort'], { allowExitCodes: [0, 128] });
      merged = await mergeBase({
        worktree: path,
        change,
        baseCommit,
        runId: input.runId,
        isPlanningPath: input.isPlanningPath ?? (() => false),
        ...(input.identity === undefined ? {} : { identity: input.identity }),
      });
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
  return { path, branch, created, clone, continued, merged, backup };
}

/** Unlocks the change's worktree (the run no longer holds it). The worktree stays for review. */
export async function releaseWorktree(host: WorktreeHost, path: string): Promise<void> {
  await runGit(host.root, ['worktree', 'unlock', path], { allowExitCodes: [0, 128] });
}

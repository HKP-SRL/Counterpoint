// Git plumbing wrappers for the approval mechanics (APPR-01).
//
// Everything goes through runGit (absolute git, allow-listed environment, hooks and fsmonitor
// disabled). On top of that, every call here also:
// - ignores replace refs and grafts (`--no-replace-objects`, GIT_GRAFT_FILE=/dev/null), so a
//   ref under refs/replace/ cannot substitute a commit the verifier looks at;
// - ignores the commit-graph cache (`core.commitGraph=false`), so parents and root trees always
//   come from the content-addressed commit objects themselves;
// - pins `log.follow=false` so a repository setting cannot change which commit `log` reports.
//
// Tree entry names are carried as latin1 strings so non-UTF-8 file names survive an
// `ls-tree` → `mktree` round trip byte for byte.
import { GitError, type GitResult, type RunGitOptions, runGit } from './run.ts';

const PLUMBING_ARGS = [
  '-c',
  'core.commitGraph=false',
  '-c',
  'log.follow=false',
  '--no-replace-objects',
] as const;

const PLUMBING_ENV = { GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: '/dev/null' } as const;

const SHA_RE = /^[0-9a-f]{40}$/;

function git(
  root: string,
  args: readonly string[],
  opts: RunGitOptions & { encoding: 'buffer' },
): Promise<GitResult<Uint8Array>>;
function git(
  root: string,
  args: readonly string[],
  opts?: RunGitOptions & { encoding?: 'utf8' },
): Promise<GitResult<string>>;
function git(
  root: string,
  args: readonly string[],
  opts: RunGitOptions = {},
): Promise<GitResult<string | Uint8Array>> {
  const merged = { ...opts, env: { ...opts.env, ...PLUMBING_ENV } };
  if (opts.encoding === 'buffer') {
    return runGit(root, [...PLUMBING_ARGS, ...args], { ...merged, encoding: 'buffer' });
  }
  return runGit(root, [...PLUMBING_ARGS, ...args], { ...merged, encoding: 'utf8' });
}

function oneSha(stdout: string, what: string): string {
  const sha = stdout.trim();
  if (!SHA_RE.test(sha)) throw new Error(`git returned an unexpected ${what}: ${sha.slice(0, 60)}`);
  return sha;
}

/** Resolves `rev` to a full object id; throws GitError when it does not exist. */
export async function revParse(root: string, rev: string): Promise<string> {
  const { stdout } = await git(root, ['rev-parse', '--verify', '--end-of-options', rev]);
  return oneSha(stdout, 'object id');
}

/** Like revParse, but returns null when `rev` does not resolve. */
export async function revParseMaybe(root: string, rev: string): Promise<string | null> {
  const { stdout, exitCode } = await git(
    root,
    ['rev-parse', '--verify', '--quiet', '--end-of-options', rev],
    { allowExitCodes: [0, 1, 128] },
  );
  return exitCode === 0 ? oneSha(stdout, 'object id') : null;
}

/** Writes `bytes` as a blob exactly as given (no filters, no end-of-line conversion). */
export async function hashObjectBlob(root: string, bytes: Uint8Array): Promise<string> {
  const { stdout } = await git(
    root,
    ['hash-object', '-t', 'blob', '-w', '--no-filters', '--stdin'],
    {
      input: bytes,
    },
  );
  return oneSha(stdout, 'blob id');
}

export interface TreeEntry {
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  /** The entry name as a latin1 string (byte-preserving). */
  name: string;
}

/** Lists the top level of a tree (or a commit's root tree). */
export async function lsTree(root: string, treeish: string): Promise<TreeEntry[]> {
  const { stdout } = await git(root, ['ls-tree', '-z', '--full-tree', treeish], {
    encoding: 'buffer',
  });
  const text = Buffer.from(stdout).toString('latin1');
  const entries: TreeEntry[] = [];
  for (const record of text.split('\0')) {
    if (record === '') continue;
    const match = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40})\t([\s\S]+)$/.exec(record);
    if (!match) throw new Error(`Unexpected ls-tree record: ${record.slice(0, 80)}`);
    entries.push({
      mode: match[1] as string,
      type: match[2] as TreeEntry['type'],
      sha: match[3] as string,
      name: match[4] as string,
    });
  }
  return entries;
}

/** Creates a tree object from `entries` (git normalises the order). */
export async function mktree(root: string, entries: readonly TreeEntry[]): Promise<string> {
  for (const entry of entries) {
    if (entry.name === '' || /[/\0]/.test(entry.name)) {
      throw new Error('Tree entry names must be non-empty and contain no "/" or NUL.');
    }
  }
  const input = Buffer.from(
    entries.map((e) => `${e.mode} ${e.type} ${e.sha}\t${e.name}\0`).join(''),
    'latin1',
  );
  const { stdout } = await git(root, ['mktree', '-z'], { input });
  return oneSha(stdout, 'tree id');
}

export interface CommitIdent {
  name: string;
  email: string;
  /** Git date (`<unix seconds> <+hhmm>`); defaults to now in UTC. */
  date?: string;
}

/** Creates an unsigned commit object. Repository signing settings are overridden (--no-gpg-sign). */
export async function commitTree(
  root: string,
  options: { tree: string; parent?: string | null; message: string; ident: CommitIdent },
): Promise<string> {
  const { tree, parent, ident } = options;
  for (const value of [ident.name, ident.email]) {
    if (value === '' || /[<>\n\r\0]/.test(value)) throw new Error('Invalid commit identity.');
  }
  const date = ident.date ?? `${Math.floor(Date.now() / 1000)} +0000`;
  if (!/^\d{1,12} [+-]\d{4}$/.test(date)) throw new Error('Invalid commit date.');
  const message = options.message.endsWith('\n') ? options.message : `${options.message}\n`;
  const args = ['commit-tree', '--no-gpg-sign', tree];
  if (parent) args.push('-p', parent);
  const { stdout } = await git(root, args, {
    input: message,
    env: {
      GIT_AUTHOR_NAME: ident.name,
      GIT_AUTHOR_EMAIL: ident.email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: ident.name,
      GIT_COMMITTER_EMAIL: ident.email,
      GIT_COMMITTER_DATE: date,
    },
  });
  return oneSha(stdout, 'commit id');
}

/** The raw bytes of a commit object. */
export async function catFileCommit(root: string, sha: string): Promise<Uint8Array> {
  const { stdout } = await git(root, ['cat-file', 'commit', sha], { encoding: 'buffer' });
  return stdout;
}

/** Writes raw commit bytes as a commit object (git validates the format). */
export async function hashObjectCommit(root: string, bytes: Uint8Array): Promise<string> {
  const { stdout } = await git(root, ['hash-object', '-t', 'commit', '-w', '--stdin'], {
    input: bytes,
  });
  return oneSha(stdout, 'commit id');
}

export type CasResult = { ok: true } | { ok: false; reason: 'base-moved' };

/** Compare-and-swap ref update: moves `ref` to `newSha` only if it still points at `oldSha`. */
export async function updateRefCas(
  root: string,
  ref: string,
  newSha: string,
  oldSha: string,
  reason: string,
): Promise<CasResult> {
  try {
    await git(root, ['update-ref', '-m', reason, ref, newSha, oldSha]);
    return { ok: true };
  } catch (error) {
    if (error instanceof GitError && error.stderrTail.some((l) => /but expected/.test(l))) {
      return { ok: false, reason: 'base-moved' };
    }
    throw error;
  }
}

export interface WorktreeInfo {
  path: string;
  head: string | null;
  /** Full ref name (`refs/heads/main`), or null when detached or bare. */
  branch: string | null;
  bare: boolean;
  prunable: boolean;
}

/** Every worktree of the repository (`worktree list --porcelain -z`). */
export async function worktreeList(root: string): Promise<WorktreeInfo[]> {
  const { stdout } = await git(root, ['worktree', 'list', '--porcelain', '-z']);
  const list: WorktreeInfo[] = [];
  let current: WorktreeInfo | null = null;
  for (const field of stdout.split('\0')) {
    if (field === '') {
      if (current) list.push(current);
      current = null;
      continue;
    }
    if (field.startsWith('worktree ')) {
      if (current) list.push(current);
      current = { path: field.slice(9), head: null, branch: null, bare: false, prunable: false };
    } else if (current) {
      if (field.startsWith('HEAD ')) current.head = field.slice(5);
      else if (field.startsWith('branch ')) current.branch = field.slice(7);
      else if (field === 'bare') current.bare = true;
      else if (field === 'prunable' || field.startsWith('prunable ')) current.prunable = true;
    }
  }
  if (current) list.push(current);
  return list;
}

/** Puts `blob` at `path` in this worktree's index (no working-tree change). */
export async function updateIndexCacheinfo(
  worktree: string,
  blob: string,
  path: string,
): Promise<void> {
  await git(worktree, ['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`]);
}

/** Writes one path from this worktree's index to its working tree (and refreshes its stat info). */
export async function checkoutIndexFile(worktree: string, path: string): Promise<void> {
  await git(worktree, ['checkout-index', '-f', '-u', '--', path]);
}

/** Porcelain status of one path, including untracked and ignored files. Empty string = clean. */
export async function statusOfPath(worktree: string, path: string): Promise<string> {
  const { stdout } = await git(worktree, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--ignored=matching',
    '--',
    path,
  ]);
  return stdout;
}

/** The `filter` attribute that applies to `path` in this worktree (`unspecified` when none). */
export async function filterAttribute(worktree: string, path: string): Promise<string> {
  const { stdout } = await git(worktree, ['check-attr', '-z', 'filter', '--', path]);
  const parts = stdout.split('\0');
  return parts[2] ?? 'unspecified';
}

/** The last commit on the first-parent chain from `tip` that touched `path`, or null. */
export async function logFirstParentLast(
  root: string,
  tip: string,
  path: string,
): Promise<string | null> {
  const { stdout } = await git(root, [
    'log',
    '-1',
    '--first-parent',
    '--no-renames',
    '--format=%H',
    '--end-of-options',
    tip,
    '--',
    path,
  ]);
  const sha = stdout.trim();
  return sha === '' ? null : oneSha(sha, 'commit id');
}

export interface NameStatus {
  status: string;
  path: string;
}

/**
 * Name-status of a commit against its parent (`diff-tree -r --root`), or of `from` → `to` when
 * both are given. Renames are never detected, so a move shows as a delete plus an add.
 */
export async function diffTreeNameStatus(
  root: string,
  commit: string,
  against?: string,
): Promise<NameStatus[]> {
  const args = ['diff-tree', '--no-commit-id', '--name-status', '-r', '--no-renames', '-z'];
  if (against === undefined) args.push('--root', commit);
  else args.push(against, commit);
  const { stdout } = await git(root, args, { encoding: 'buffer' });
  const fields = Buffer.from(stdout).toString('latin1').split('\0');
  const result: NameStatus[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const status = fields[i] as string;
    const path = fields[i + 1] as string;
    if (status === '') break;
    result.push({ status, path });
  }
  return result;
}

/** The parents of a commit, in order. */
export async function commitParents(root: string, commit: string): Promise<string[]> {
  const { stdout } = await git(root, ['rev-list', '--parents', '-n', '1', commit, '--']);
  const [, ...parents] = stdout.trim().split(' ');
  return parents.filter((p) => p !== '');
}

/** The bytes of `path` at `commit`, or null when the path is absent or not a regular blob. */
export async function catBlob(
  root: string,
  commit: string,
  path: string,
): Promise<Uint8Array | null> {
  const blob = await revParseMaybe(root, `${commit}:${path}`);
  if (blob === null) return null;
  const { stdout: type } = await git(root, ['cat-file', '-t', blob]);
  if (type.trim() !== 'blob') return null;
  const { stdout } = await git(root, ['cat-file', 'blob', blob], { encoding: 'buffer' });
  return stdout;
}

/** The committer date of a commit as an ISO 8601 string. */
export async function commitDate(root: string, commit: string): Promise<string> {
  const { stdout } = await git(root, ['log', '-1', '--no-walk', '--format=%cI', commit, '--']);
  return stdout.trim();
}

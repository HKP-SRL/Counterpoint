// Plumbing-level writes to a host's base branch without a checkout of Counterpoint's own
// (planning-writes: Single serialized write path): build a tree with one path replaced, and check
// that placing a file in the owner's checkouts of the branch cannot overwrite anything of theirs.
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import {
  filterAttribute,
  lsTree,
  mktree,
  statusOfPath,
  type TreeEntry,
  worktreeList,
} from './plumbing.ts';

/** Base branch names accepted for writes (no leading dash, no `..`, no `//`). */
export const BRANCH_RE = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}(?<![/.])$/;

/** Why a file cannot be placed in one of the owner's checkouts. */
export type CheckoutRefusal = {
  ok: false;
  reason: 'occupied' | 'unsafe-path';
  detail?: string;
};

/** The tree `treeSha` with the file at `segments` replaced by `entry`; returns the new tree. */
export async function replacePath(
  root: string,
  treeSha: string | null,
  segments: readonly string[],
  entry: Omit<TreeEntry, 'name'>,
): Promise<string> {
  const [head, ...rest] = segments;
  if (head === undefined || head === '' || head === '.' || head === '..') {
    throw new Error('Invalid path segment.');
  }
  const entries = treeSha === null ? [] : await lsTree(root, treeSha);
  const existing = entries.find((e) => e.name === head);
  const others = entries.filter((e) => e.name !== head);
  if (rest.length === 0) {
    if (existing && !(existing.type === 'blob' && /^1006[0-7]{2}$/.test(existing.mode))) {
      throw new Error(`"${head}" exists in the base tree and is not a regular file.`);
    }
    return mktree(root, [...others, { ...entry, name: head }]);
  }
  if (existing && existing.type !== 'tree') {
    throw new Error(`"${head}" exists in the base tree and is not a directory.`);
  }
  const child = await replacePath(root, existing?.sha ?? null, rest, entry);
  return mktree(root, [...others, { mode: '040000', type: 'tree', sha: child, name: head }]);
}

/**
 * Finds every checkout of `baseRef` and makes sure placing a file there cannot
 * overwrite anything of the owner's: the path must be absent or tracked and unmodified, with no
 * symlink on the way, and no content filter (which could run a program) may apply to it.
 */
export async function checkCheckouts(
  root: string,
  baseRef: string,
  itemPath: string,
): Promise<{ ok: true; worktrees: string[] } | CheckoutRefusal> {
  const all = await worktreeList(root);
  const worktrees = all
    .filter((w) => !w.bare && !w.prunable && w.branch === baseRef)
    .map((w) => w.path);
  const segments = itemPath.split('/');
  for (const worktree of worktrees) {
    let current = worktree;
    for (const [index, segment] of segments.entries()) {
      current = join(current, segment);
      const stat = lstatSync(current, { throwIfNoEntry: false });
      if (stat === undefined) break;
      const last = index === segments.length - 1;
      if (last ? !stat.isFile() : !stat.isDirectory()) {
        return { ok: false, reason: 'occupied', detail: `${current} is in the way.` };
      }
    }
    const filter = await filterAttribute(worktree, itemPath);
    if (filter !== 'unspecified' && filter !== 'unset') {
      return {
        ok: false,
        reason: 'unsafe-path',
        detail: `A "filter" attribute applies to ${itemPath} in ${worktree}.`,
      };
    }
    const status = await statusOfPath(worktree, itemPath);
    if (status !== '') {
      return {
        ok: false,
        reason: 'occupied',
        detail: `${itemPath} has uncommitted changes or untracked content in ${worktree}.`,
      };
    }
  }
  return { ok: true, worktrees };
}

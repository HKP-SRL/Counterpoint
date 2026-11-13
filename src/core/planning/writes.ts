// Planning writes, the git side (planning-writes: Single serialized write path; owner-inbox D-11).
//
// A write is a list of edits (core/store/planning-writes.ts): a tick made again on whatever base
// it lands on, or a file's text before and after. Here they become files at a base commit, and
// the files one commit as the owner on that base, built with plumbing only (no checkout, no index
// of Counterpoint's own, no ref moved). The lane (build/planning-lane.ts) pushes that commit to its
// own branch and lands it through a small PR.
//
// A host with no remote has nowhere to open a PR, so its writes land on the local base branch as
// before: the branch moves by compare-and-swap, the written files are placed in the owner's
// checkouts of the branch, and a write whose path is occupied there (uncommitted edits, something
// in the way, a content filter) is refused before any ref moves. Those writes hold the home's
// planning-write lock while they land: SQLite's exclusive lock on one file, polled, so the daemon
// never blocks while it waits and a crash can never leave it held.
//
// A write may only touch the host's planning files (the adapter decides), never `.git/`,
// `.counterpoint/` or `.claude/`. An owner-step result the owner landed from its diff (a `code`
// write) may touch any file of the repository, `.counterpoint/` included, but never `.git/` or
// `.claude/`.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  type CommitIdent,
  catBlob,
  checkoutIndexFile,
  commitTree,
  hashObjectBlob,
  revParse,
  updateIndexCacheinfo,
  updateRefCas,
} from '../git/plumbing.ts';
import { ownerIdentity } from '../git/run.ts';
import { BRANCH_RE, checkCheckouts, replacePath } from '../git/tree-write.ts';
import type { PlanningEdit } from '../store/planning-writes.ts';

const SQLITE_BUSY = 5;
const LOCK_POLL_MS = 250;
const LOCK_WAIT_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const MAX_EDITS = 64;
const MAX_FILE_BYTES = 1024 * 1024;
/**
 * Planning writes are authored as the owner, like session commits (Counterpoint acts as the
 * owner). Counterpoint's own identity remains only as the fallback when git config names no owner.
 */
const COUNTERPOINT_IDENT: CommitIdent = { name: 'Counterpoint', email: 'counterpoint@localhost' };

export class PlanningWriteLockTimeout extends Error {
  constructor() {
    super('Another planning write held the lock for 2 minutes.');
    this.name = 'PlanningWriteLockTimeout';
  }
}

/** The home's planning-write lock file. */
export function planningWriteLockFile(home: string): string {
  return join(home, 'run', 'planning-writes.lock');
}

/** Runs `fn` while holding the home's planning-write lock (machine-wide, across processes). */
export async function withPlanningWriteLock<T>(
  home: string,
  fn: () => Promise<T>,
  options: { waitMs?: number } = {},
): Promise<T> {
  const file = planningWriteLockFile(home);
  mkdirSync(join(home, 'run'), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file, { timeout: 0 });
  try {
    const started = Date.now();
    for (;;) {
      try {
        db.exec('BEGIN EXCLUSIVE');
        break;
      } catch (error) {
        if ((error as { errcode?: number }).errcode !== SQLITE_BUSY) throw error;
      }
      if (Date.now() - started >= (options.waitMs ?? LOCK_WAIT_MS)) {
        throw new PlanningWriteLockTimeout();
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
    return await fn();
  } finally {
    db.close();
  }
}

export interface PlanningFile {
  /** Repository-relative path, `/`-separated. */
  path: string;
  content: string;
}

export interface PlanningWrite {
  /** The commit message (first line is the subject). */
  message: string;
  edits: readonly PlanningEdit[];
}

export interface PlanningHost {
  id: string;
  root: string;
  baseBranch: string;
}

/** What a write needs from the host's framework adapter. */
export interface PlanningRules {
  /** True for a path that belongs to the host's planning. */
  isPlanningPath: (path: string) => boolean;
  /** The task list with `task` ticked, unchanged when done, null when it has no such task. */
  tickTask: (tasks: string, task: string) => string | null;
  /** An owner-step result the owner landed: `.counterpoint/` paths are allowed too. */
  code?: boolean;
}

export type ComposeResult =
  | { ok: true; files: PlanningFile[] }
  | { ok: false; reason: 'invalid' | 'not-planning' | 'conflict'; detail: string };

function checkPath(path: string, code: boolean): string | null {
  if (path === '' || path.length > 400) return 'An empty or overlong path.';
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) {
    return `${path} is not a repository-relative path.`;
  }
  const segments = path.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    return `${path} is not a normalized path.`;
  }
  const top = segments[0]?.toLowerCase();
  if (top === '.git' || top === '.claude') {
    return code
      ? `${path} is under ${top}/, which Counterpoint never writes.`
      : `${path} is not a planning file.`;
  }
  if (top === '.counterpoint' && !code) return `${path} is not a planning file.`;
  return null;
}

/**
 * Why a write cannot be stored at all (a bad message, path or size), or null. `code`: an owner-step
 * result the owner landed from its diff, which may also touch `.counterpoint/`.
 */
export function checkWrite(
  write: PlanningWrite,
  isPlanningPath: (path: string) => boolean,
  options: { code?: boolean } = {},
): { reason: 'invalid' | 'not-planning'; detail: string } | null {
  const subject = write.message.split('\n')[0]?.trim() ?? '';
  if (subject === '' || write.message.length > 10_000 || write.message.includes('\0')) {
    return { reason: 'invalid', detail: 'A planning write needs a commit message.' };
  }
  if (write.edits.length === 0 || write.edits.length > MAX_EDITS) {
    return { reason: 'invalid', detail: `A planning write holds 1 to ${MAX_EDITS} edits.` };
  }
  for (const edit of write.edits) {
    const problem = checkPath(edit.path, options.code === true);
    if (problem !== null) return { reason: 'not-planning', detail: problem };
    if (!isPlanningPath(edit.path)) {
      return { reason: 'not-planning', detail: `${edit.path} is not a planning file.` };
    }
    if (edit.kind === 'text' && Buffer.byteLength(edit.after) > MAX_FILE_BYTES) {
      return { reason: 'invalid', detail: `${edit.path} is larger than 1 MiB.` };
    }
  }
  return null;
}

/**
 * The files a write's edits produce on `commit`, in the order first edited. A tick is made on the
 * file as it is there; a text edit applies only where the file is still as it was.
 */
export async function composeWrite(
  root: string,
  commit: string,
  write: PlanningWrite,
  rules: PlanningRules,
): Promise<ComposeResult> {
  const refused = checkWrite(write, rules.isPlanningPath, { code: rules.code === true });
  if (refused !== null) return { ok: false, ...refused };
  const files = new Map<string, string | null>();
  const read = async (path: string): Promise<string | null> => {
    if (files.has(path)) return files.get(path) ?? null;
    const bytes = await catBlob(root, commit, path);
    return bytes === null ? null : new TextDecoder().decode(bytes);
  };
  for (const edit of write.edits) {
    const current = await read(edit.path);
    if (edit.kind === 'tick') {
      if (current === null) {
        return { ok: false, reason: 'conflict', detail: `${edit.path} is no longer there.` };
      }
      const ticked = rules.tickTask(current, edit.task);
      if (ticked === null) {
        return {
          ok: false,
          reason: 'conflict',
          detail: `"${edit.task.slice(0, 80)}" is no longer in ${edit.path}.`,
        };
      }
      files.set(edit.path, ticked);
    } else if (edit.kind === 'ticks') {
      // A build's ticks after its PR merged: what is gone is dropped, not a conflict.
      if (current === null) continue;
      let list = current;
      for (const task of edit.tasks) list = rules.tickTask(list, task) ?? list;
      files.set(edit.path, list);
    } else {
      if (current !== edit.before) {
        return { ok: false, reason: 'conflict', detail: `${edit.path} changed since.` };
      }
      files.set(edit.path, edit.after);
    }
  }
  return {
    ok: true,
    files: [...files].map(([path, content]) => ({ path, content: content ?? '' })),
  };
}

/** The tree of `base` with `files` in it, and the blob of each file. */
async function treeWith(
  root: string,
  base: string,
  files: readonly PlanningFile[],
): Promise<{ tree: string; baseTree: string; blobs: Map<string, string> }> {
  const baseTree = await revParse(root, `${base}^{tree}`);
  let tree = baseTree;
  const blobs = new Map<string, string>();
  for (const file of files) {
    const blob = await hashObjectBlob(root, new TextEncoder().encode(file.content));
    blobs.set(file.path, blob);
    tree = await replacePath(root, tree, file.path.split('/'), {
      mode: '100644',
      type: 'blob',
      sha: blob,
    });
  }
  return { tree, baseTree, blobs };
}

async function identity(root: string, ident?: CommitIdent): Promise<CommitIdent> {
  return ident ?? (await ownerIdentity(root)) ?? COUNTERPOINT_IDENT;
}

/**
 * One commit of `files` on `base`, as the owner. Moves no ref. `changed` is false (and no commit
 * is made) when the files are already so on `base`.
 */
export async function commitOnBase(
  root: string,
  base: string,
  files: readonly PlanningFile[],
  message: string,
  ident?: CommitIdent,
): Promise<{ changed: false } | { changed: true; commit: string }> {
  const { tree, baseTree } = await treeWith(root, base, files);
  if (tree === baseTree) return { changed: false };
  const commit = await commitTree(root, {
    tree,
    parent: base,
    message,
    ident: await identity(root, ident),
  });
  return { changed: true, commit };
}

export type LocalWriteResult =
  | {
      ok: true;
      /** The new base tip, or the old one when the write changed nothing. */
      commit: string;
      changed: boolean;
      /** Checkouts of the base branch the files were placed in. */
      placedIn: string[];
    }
  | {
      ok: false;
      reason: 'invalid' | 'not-planning' | 'conflict' | 'occupied' | 'unsafe-path' | 'base-moved';
      detail: string;
    };

/**
 * Lands a write on the local base branch of a host with no remote (build-from-remote-base D-5):
 * one commit, the branch moved by compare-and-swap, the files placed in the owner's checkouts of
 * the branch. Made again on the new tip when the branch moved meanwhile, up to three times.
 */
export async function landLocally(
  home: string,
  host: PlanningHost,
  write: PlanningWrite,
  rules: PlanningRules,
  ident?: CommitIdent,
): Promise<LocalWriteResult> {
  if (!BRANCH_RE.test(host.baseBranch)) {
    return { ok: false, reason: 'invalid', detail: 'Invalid base branch name.' };
  }
  return withPlanningWriteLock(home, async () => {
    const baseRef = `refs/heads/${host.baseBranch}`;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const tip = await revParse(host.root, `${baseRef}^{commit}`);
      const composed = await composeWrite(host.root, tip, write, rules);
      if (!composed.ok) return composed;
      let built: Awaited<ReturnType<typeof treeWith>>;
      try {
        built = await treeWith(host.root, tip, composed.files);
      } catch (error) {
        return { ok: false, reason: 'occupied', detail: (error as Error).message };
      }
      if (built.tree === built.baseTree) {
        return { ok: true, commit: tip, changed: false, placedIn: [] };
      }

      const worktrees = new Set<string>();
      for (const path of built.blobs.keys()) {
        const checked = await checkCheckouts(host.root, baseRef, path);
        if (!checked.ok) {
          return {
            ok: false,
            reason: checked.reason,
            detail: checked.detail ?? `${path} cannot be placed in your checkout.`,
          };
        }
        for (const worktree of checked.worktrees) worktrees.add(worktree);
      }

      const commit = await commitTree(host.root, {
        tree: built.tree,
        parent: tip,
        message: write.message,
        ident: await identity(host.root, ident),
      });
      const subject = write.message.split('\n')[0]?.trim() ?? '';
      const cas = await updateRefCas(host.root, baseRef, commit, tip, `counterpoint: ${subject}`);
      if (!cas.ok) continue;

      const placedIn: string[] = [];
      for (const worktree of worktrees) {
        try {
          for (const [path, blob] of built.blobs) {
            await updateIndexCacheinfo(worktree, blob, path);
            await checkoutIndexFile(worktree, path);
          }
          placedIn.push(worktree);
        } catch {
          // The commit landed; this checkout shows the files as changed until the owner syncs.
        }
      }
      return { ok: true, commit, changed: true, placedIn };
    }
    return {
      ok: false,
      reason: 'base-moved',
      detail: `${host.baseBranch} kept moving; the write was not landed after ${MAX_ATTEMPTS} tries.`,
    };
  });
}

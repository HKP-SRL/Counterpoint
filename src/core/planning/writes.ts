// The single serialized path for writes to a host's planning files (planning-writes: Single
// serialized write path).
//
// Every write lands as its own commit on the host's local base branch, built with plumbing only
// (no checkout and no index of Counterpoint's own), and the branch moves by
// compare-and-swap. Where the owner has the base branch checked out, the written files are placed
// in that checkout too, and a write whose path is occupied there (uncommitted edits, something in
// the way, a content filter) is refused before any ref moves. Nothing is pushed.
//
// One at a time, across processes: writes queue in the daemon, and each one holds the home's
// planning-write lock while it lands. The
// lock is SQLite's exclusive lock on one file, polled, so the daemon never blocks while it waits
// and a crash can never leave it held. When the base moved between building and landing (the
// owner committed meanwhile) the write is rebuilt on the new tip, up to three times.
//
// A write may only touch the host's planning files (the adapter decides), never `.counterpoint/`
// or `.claude/`.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  type CommitIdent,
  checkoutIndexFile,
  commitTree,
  hashObjectBlob,
  revParse,
  updateIndexCacheinfo,
  updateRefCas,
} from '../git/plumbing.ts';
import { ownerIdentity } from '../git/run.ts';
import { BRANCH_RE, checkCheckouts, replacePath } from '../git/tree-write.ts';

const SQLITE_BUSY = 5;
const LOCK_POLL_MS = 250;
const LOCK_WAIT_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const MAX_FILES = 64;
const MAX_FILE_BYTES = 1024 * 1024;
/**
 * Planning writes are authored as the owner, like session commits (owner decision 2026-11-11:
 * Counterpoint acts as the owner). A write at the tip of the base branch would otherwise block a
 * preview host that refuses commits it cannot match to an account. Counterpoint's own identity
 * remains only as the fallback when git config names no owner.
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
  content: string | Uint8Array;
}

export interface PlanningWrite {
  /** The commit message (first line is the subject). */
  message: string;
  files: readonly PlanningFile[];
}

export interface PlanningHost {
  id: string;
  root: string;
  baseBranch: string;
}

export type PlanningWriteResult =
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
      reason: 'invalid' | 'not-planning' | 'occupied' | 'unsafe-path' | 'base-moved';
      detail: string;
    };

function checkPath(path: string): string | null {
  if (path === '' || path.length > 400) return 'An empty or overlong path.';
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) {
    return `${path} is not a repository-relative path.`;
  }
  const segments = path.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    return `${path} is not a normalized path.`;
  }
  const top = segments[0]?.toLowerCase();
  if (top === '.git' || top === '.counterpoint' || top === '.claude') {
    return `${path} is not a planning file.`;
  }
  return null;
}

export interface PlanningWritesOptions {
  home: string;
  /** True for a path that belongs to the host's planning (the host's adapter decides). */
  isPlanningPath: (hostId: string, path: string) => boolean;
  ident?: CommitIdent;
}

/** The daemon's planning-write queue: one write at a time, each its own commit. */
export class PlanningWrites {
  readonly #o: PlanningWritesOptions;
  #tail: Promise<unknown> = Promise.resolve();

  constructor(options: PlanningWritesOptions) {
    this.#o = options;
  }

  /** Queues a write; resolves once it landed (or was refused). */
  write(host: PlanningHost, write: PlanningWrite): Promise<PlanningWriteResult> {
    const next = this.#tail.then(() =>
      withPlanningWriteLock(this.#o.home, () => this.#land(host, write)),
    );
    this.#tail = next.catch(() => undefined);
    return next;
  }

  async #land(host: PlanningHost, write: PlanningWrite): Promise<PlanningWriteResult> {
    if (!BRANCH_RE.test(host.baseBranch)) {
      return { ok: false, reason: 'invalid', detail: 'Invalid base branch name.' };
    }
    const subject = write.message.split('\n')[0]?.trim() ?? '';
    if (subject === '' || write.message.length > 10_000 || write.message.includes('\0')) {
      return { ok: false, reason: 'invalid', detail: 'A planning write needs a commit message.' };
    }
    if (write.files.length === 0 || write.files.length > MAX_FILES) {
      return {
        ok: false,
        reason: 'invalid',
        detail: `A planning write holds 1 to ${MAX_FILES} files.`,
      };
    }
    const seen = new Set<string>();
    for (const file of write.files) {
      const problem = checkPath(file.path);
      if (problem !== null) return { ok: false, reason: 'not-planning', detail: problem };
      if (!this.#o.isPlanningPath(host.id, file.path)) {
        return {
          ok: false,
          reason: 'not-planning',
          detail: `${file.path} is not a planning file.`,
        };
      }
      if (seen.has(file.path)) {
        return { ok: false, reason: 'invalid', detail: `${file.path} is written twice.` };
      }
      seen.add(file.path);
      const size =
        typeof file.content === 'string' ? Buffer.byteLength(file.content) : file.content.length;
      if (size > MAX_FILE_BYTES) {
        return { ok: false, reason: 'invalid', detail: `${file.path} is larger than 1 MiB.` };
      }
    }

    const baseRef = `refs/heads/${host.baseBranch}`;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const tip = await revParse(host.root, `${baseRef}^{commit}`);
      const baseTree = await revParse(host.root, `${tip}^{tree}`);
      let tree = baseTree;
      const blobs = new Map<string, string>();
      for (const file of write.files) {
        const bytes =
          typeof file.content === 'string' ? new TextEncoder().encode(file.content) : file.content;
        const blob = await hashObjectBlob(host.root, bytes);
        blobs.set(file.path, blob);
        try {
          tree = await replacePath(host.root, tree, file.path.split('/'), {
            mode: '100644',
            type: 'blob',
            sha: blob,
          });
        } catch (error) {
          return { ok: false, reason: 'occupied', detail: (error as Error).message };
        }
      }
      if (tree === baseTree) return { ok: true, commit: tip, changed: false, placedIn: [] };

      const worktrees = new Set<string>();
      for (const path of blobs.keys()) {
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
        tree,
        parent: tip,
        message: write.message,
        ident: this.#o.ident ?? (await ownerIdentity(host.root)) ?? COUNTERPOINT_IDENT,
      });
      const cas = await updateRefCas(host.root, baseRef, commit, tip, `counterpoint: ${subject}`);
      if (!cas.ok) continue;

      const placedIn: string[] = [];
      for (const worktree of worktrees) {
        try {
          for (const [path, blob] of blobs) {
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
  }
}

// The machine-wide test lock (gates: Shared test lock).
//
// It is the owner's existing lock, shared with the `speckit-auto` tooling so old and new loops
// never run tests at the same time: SQLite's exclusive lock on one file (default
// `~/.cache/speckit-auto/test.lock`, or `SPECKIT_TEST_LOCK_FILE`). The kernel drops the lock when
// the holder exits, so a crash can never leave it stale. The holder writes a one-line note next to
// it (`<file>.holder`) so a waiter can say who holds it, and marks the gate's environment with
// `SPECKIT_TEST_LOCK_HELD`, so a test run that takes the same lock itself (as the owner's Vitest
// setup does) does not wait for its own gate.
//
// The daemon holds the lock on its own connection for exactly one gate (with that gate's service
// reset). One run at a time per machine, one gate at a time within it, so the daemon never waits
// on itself.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const TEST_LOCK_HELD_ENV = 'SPECKIT_TEST_LOCK_HELD';
const SQLITE_BUSY = 5;
const POLL_MS = 1000;

export function defaultTestLockFile(env: NodeJS.ProcessEnv = process.env): string {
  return env.SPECKIT_TEST_LOCK_FILE ?? join(homedir(), '.cache', 'speckit-auto', 'test.lock');
}

export interface HeldTestLock {
  /** Set in the gate's environment while the lock is held. */
  env: Record<string, string>;
  /** Milliseconds spent waiting for it. */
  waitedMs: number;
  release(): void;
}

export class TestLockTimeout extends Error {
  constructor(minutes: number, holder: string) {
    super(`The test lock stayed held for ${minutes} minutes (by ${holder}).`);
    this.name = 'TestLockTimeout';
  }
}

function tryLock(db: DatabaseSync): boolean {
  try {
    db.exec('BEGIN EXCLUSIVE');
    return true;
  } catch (error) {
    if ((error as { errcode?: number }).errcode === SQLITE_BUSY) return false;
    throw error;
  }
}

export function lockHolder(file: string): string {
  try {
    return readFileSync(`${file}.holder`, 'utf8').trim() || 'another test run';
  } catch {
    return 'another test run';
  }
}

/**
 * Waits for the lock (polling once a second) and returns it held. Rejects with the signal's
 * reason when `signal` aborts (a run stopping), or with TestLockTimeout after `waitMs`.
 */
export async function acquireTestLock(options: {
  file?: string;
  waitMs: number;
  /** Who holds it, for the holder note (e.g. `counterpoint gate unit for change x`). */
  note: string;
  signal?: AbortSignal;
  onWait?: (holder: string) => void;
}): Promise<HeldTestLock> {
  const file = options.file ?? defaultTestLockFile();
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file, { timeout: 0 });
  const started = Date.now();
  let told = false;
  try {
    while (!tryLock(db)) {
      if (!told) options.onWait?.(lockHolder(file));
      told = true;
      options.signal?.throwIfAborted();
      if (Date.now() - started >= options.waitMs) {
        throw new TestLockTimeout(Math.round(options.waitMs / 60_000), lockHolder(file));
      }
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(options.signal?.reason);
        };
        const timer = setTimeout(() => {
          options.signal?.removeEventListener('abort', onAbort);
          resolve();
        }, POLL_MS);
        options.signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
  } catch (error) {
    db.close();
    throw error;
  }
  const holderFile = `${file}.holder`;
  writeFileSync(
    holderFile,
    `pid ${process.pid}: ${options.note.replace(/\s+/g, ' ').slice(0, 200)}, since ${new Date().toTimeString().slice(0, 8)}\n`,
  );
  let released = false;
  return {
    env: { [TEST_LOCK_HELD_ENV]: String(process.pid) },
    waitedMs: Date.now() - started,
    release() {
      if (released) return;
      released = true;
      rmSync(holderFile, { force: true });
      db.close();
    },
  };
}

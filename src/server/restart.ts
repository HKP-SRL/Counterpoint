// Self-restart into a new install (owner-inbox D-10; daemon-lifecycle: Restart into a new install).
//
// The daemon watches its installed package: the version in package.json and the files it was
// started from (a reinstall of the same version writes new files). A change seen twice in a row
// (the install has finished) is a new install. With no run and no owner-step session going, the
// daemon restarts into it at once; during one, a card asks: "Restart after this run"
// (recommended, and what happens if nobody answers) or "Restart now" (the run's current session is
// cut short and crash recovery resumes the run on the new install).
//
// The handover: the old daemon writes the SHA-256 of a random nonce to `run/handover.json` (0600)
// and starts its successor with the owner's login environment and the nonce in
// COUNTERPOINT_HANDOVER. Once the new install has loaded, the successor asks the old daemon over
// the control channel to hand over; only then does the old daemon stop. A successor that never
// asks (a broken install) leaves the old daemon running. The successor takes the lock once it is
// free, and only a start whose nonce matches the file keeps the console sessions; every other
// start (a crash, a manual start) still signs every browser out.
import { spawn } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeFileAtomic0600 } from '../core/fs/atomic.ts';
import type { HomePaths } from '../core/host/home.ts';
import type { CardRow, NewCard } from '../core/store/cards.ts';
import type { Store } from '../core/store/db.ts';
import type { CardDesk } from './cards.ts';

export const HANDOVER_ENV = 'COUNTERPOINT_HANDOVER';
export const HANDOVER_RE = /^[0-9a-f]{64}$/;
const HANDOVER_TTL_MS = 2 * 60_000;
const POLL_MS = 5_000;
const HANDOVER_TIMEOUT_MS = 60_000;

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const handoverFile = (paths: HomePaths) => join(paths.runDir, 'handover.json');

/** The installed version, or '0.0.0' when package.json cannot be read. */
export function installedVersion(root: string): string {
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * What identifies the install the daemon runs from: the version, and package.json, the entry
 * file and its folder as files (a reinstall makes new ones). Null while any of them is missing
 * (an install in progress).
 */
export function installStamp(root: string, entry: string): string | null {
  try {
    const parts = [installedVersion(root)];
    for (const path of [join(root, 'package.json'), entry, dirname(entry)]) {
      const stat = statSync(path);
      parts.push(`${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`);
    }
    return parts.join('|');
  } catch {
    return null;
  }
}

/** The old daemon's side: records the nonce's hash for its successor. */
export function writeHandover(paths: HomePaths, nonce: string, now: number = Date.now()): void {
  writeFileAtomic0600(
    handoverFile(paths),
    `${JSON.stringify({ hash: sha256(nonce), expiresAt: now + HANDOVER_TTL_MS })}\n`,
  );
}

export function clearHandover(paths: HomePaths): void {
  rmSync(handoverFile(paths), { force: true });
}

/**
 * The successor's side, once it holds the lock: true only when `nonce` matches the recorded
 * handover and it has not expired. The record is removed either way, so it works once.
 */
export function takeHandover(
  paths: HomePaths,
  nonce: string | undefined,
  now: number = Date.now(),
): boolean {
  let record: { hash?: unknown; expiresAt?: unknown } | undefined;
  try {
    record = JSON.parse(readFileSync(handoverFile(paths), 'utf8')) as typeof record;
  } catch {
    record = undefined;
  }
  clearHandover(paths);
  if (nonce === undefined || !HANDOVER_RE.test(nonce) || record === undefined) return false;
  if (typeof record.hash !== 'string' || typeof record.expiresAt !== 'number') return false;
  if (record.expiresAt <= now) return false;
  const expected = Buffer.from(record.hash, 'utf8');
  const presented = Buffer.from(sha256(nonce), 'utf8');
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

/** Restart cards a previous daemon left open: the daemon now running is the newest install. */
export function resolveRestartCards(store: Store, desk: CardDesk, outcome: string): void {
  const rows = store
    .prepare(
      `SELECT id, host_id FROM cards WHERE kind = 'restart' AND state IN ('open', 'deferred')`,
    )
    .all();
  for (const row of rows) {
    desk.resolve({ id: String(row.id), hostId: null }, outcome);
  }
}

/** Starts the successor daemon: `exited` settles if it exits, `kill` ends it. */
export type SpawnSuccessor = (
  nonce: string,
) => Promise<{ exited: Promise<void>; kill: () => void }>;

export interface SelfRestartOptions {
  desk: CardDesk;
  paths: HomePaths;
  /** The install's stamp now (installStamp). */
  stamp: () => string | null;
  /** The installed version, for the card and the log. */
  version: () => string;
  /** True while a run or an owner-step session is going. */
  busy: () => boolean;
  spawnSuccessor: SpawnSuccessor;
  /** Stops this daemon (after the successor asked to take over). */
  stop: (reason: string) => Promise<void>;
  log?: (event: string, fields?: Record<string, unknown>) => void;
  pollMs?: number;
  handoverTimeoutMs?: number;
}

export function restartCard(key: string, version: string): NewCard {
  return {
    hostId: null,
    key,
    kind: 'restart',
    source: 'machine',
    question: `Counterpoint ${version} is installed. Restart into it?`,
    why: 'A run is building. Restarting now cuts its current session short.',
    options: [
      {
        label: 'Restart after this run',
        consequence: 'Counterpoint restarts on its own when the run ends.',
        action: { type: 'restart-into-install', when: 'after-run' },
      },
      {
        label: 'Restart now',
        consequence: 'The current session stops; the run picks up again on the new install.',
        action: { type: 'restart-into-install', when: 'now' },
      },
    ],
    recommended: 0,
    reversible: true,
    blocking: false,
  };
}

export class SelfRestart {
  readonly #o: SelfRestartOptions;
  readonly #initial: string | null;
  #seen: string | null = null;
  #failed: string | null = null;
  #card: CardRow | undefined;
  #pending: { nonce: string; accept: () => void } | undefined;
  #restarting = false;
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(options: SelfRestartOptions) {
    this.#o = options;
    this.#initial = options.stamp();
  }

  start(): void {
    this.#timer = setInterval(() => void this.check(), this.#o.pollMs ?? POLL_MS);
    this.#timer.unref?.();
  }

  stop(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /** The installed stamp when it differs from the one this daemon runs, settled, else null. */
  #newInstall(): string | null {
    const stamp = this.#o.stamp();
    if (stamp === null || this.#initial === null || stamp === this.#initial) {
      this.#seen = null;
      return null;
    }
    const settled = this.#seen === stamp;
    this.#seen = stamp;
    return settled && stamp !== this.#failed ? stamp : null;
  }

  /** One look at the install (every few seconds). */
  async check(): Promise<void> {
    if (this.#restarting) return;
    const stamp = this.#newInstall();
    if (stamp === null) return;
    if (!this.#o.busy()) {
      await this.#handOver(stamp);
      return;
    }
    if (this.#card === undefined) {
      const key = `restart:${sha256(stamp).slice(0, 16)}`;
      this.#card = this.#o.desk.raise(restartCard(key, this.#o.version()));
    }
  }

  /** The restart card's options (the `restart-into-install` action). */
  async request(when: 'after-run' | 'now'): Promise<string> {
    const stamp = this.#o.stamp();
    if (stamp === null || stamp === this.#initial) return 'Already running the installed version.';
    if (when === 'after-run' && this.#o.busy()) return 'Restarting once this run ends.';
    setImmediate(() => void this.#handOver(stamp));
    return 'Restarting now.';
  }

  /** The control channel's handover call: true when it names the pending handover. */
  accept(nonce: string): boolean {
    const pending = this.#pending;
    if (pending === undefined || !HANDOVER_RE.test(nonce)) return false;
    const a = Buffer.from(sha256(nonce), 'utf8');
    const b = Buffer.from(sha256(pending.nonce), 'utf8');
    if (!timingSafeEqual(a, b)) return false;
    // Stop only after the answer has gone out.
    setImmediate(pending.accept);
    return true;
  }

  async #handOver(stamp: string): Promise<void> {
    if (this.#restarting) return;
    this.#restarting = true;
    const log = this.#o.log ?? (() => {});
    const nonce = randomBytes(32).toString('hex');
    let accepted = false;
    try {
      writeHandover(this.#o.paths, nonce);
      const asked = new Promise<boolean>((resolve) => {
        this.#pending = { nonce, accept: () => resolve(true) };
        setTimeout(
          () => resolve(false),
          this.#o.handoverTimeoutMs ?? HANDOVER_TIMEOUT_MS,
        ).unref?.();
      });
      log('restart-handover', { version: this.#o.version() });
      const child = await this.#o.spawnSuccessor(nonce);
      accepted = await Promise.race([asked, child.exited.then(() => false)]);
      if (!accepted) child.kill();
    } catch (error) {
      log('restart-failed', { message: (error as Error).message });
    } finally {
      this.#pending = undefined;
    }
    if (!accepted) {
      clearHandover(this.#o.paths);
      this.#failed = stamp;
      this.#restarting = false;
      log('restart-failed', { reason: 'the new install did not take over' });
      this.#o.desk.doneForYou(
        null,
        "Couldn't restart into the new install, so the one before keeps running. The daemon log says why.",
      );
      return;
    }
    const card = this.#card === undefined ? undefined : this.#o.desk.get(this.#card.id);
    if (card?.state === 'answered') this.#o.desk.outcome(card, 'Restarted into the new install.');
    else if (card !== undefined) this.#o.desk.resolve(card, 'Restarted into the new install.');
    this.stop();
    await this.#o.stop('restart');
  }
}

/** Starts `entry __daemon` as the successor, logging to the daemon log. */
export function successorSpawner(input: {
  paths: HomePaths;
  entry: string;
  port: number;
  env: () => Promise<Record<string, string>>;
}): SpawnSuccessor {
  return async (nonce) => {
    const env = {
      ...(await input.env()),
      // The successor serves this same home, whatever the login shell exports.
      COUNTERPOINT_HOME: input.paths.home,
      [HANDOVER_ENV]: nonce,
    };
    mkdirSync(input.paths.logsDir, { recursive: true, mode: 0o700 });
    const logFd = openSync(input.paths.daemonLog, 'a', 0o600);
    let exited: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      exited = resolve;
    });
    try {
      const child = spawn(
        process.execPath,
        [
          input.entry,
          '__daemon',
          '--port',
          String(input.port),
          '--instance',
          randomBytes(16).toString('hex'),
        ],
        { detached: true, stdio: ['ignore', logFd, logFd], env, cwd: input.paths.home },
      );
      child.once('exit', () => exited());
      child.once('error', () => exited());
      child.unref();
      return {
        exited: done,
        kill: () => {
          try {
            child.kill('SIGTERM');
          } catch {
            // already gone
          }
        },
      };
    } finally {
      closeSync(logFd);
    }
  };
}

// The daemon's SQLite store (node:sqlite). The daemon is the only writer; CLI readers open it
// read-only. Schema changes go through numbered migrations keyed by `PRAGMA user_version`.
//
// This store holds hosts, sign-in material (hashed), the event outbox, the owner's approvals and
// the build lane's runs.
import { join, resolve } from 'node:path';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import type { HostRecord, HostRegistryStore } from '../host/registry.ts';

export type Store = DatabaseSync;

/** A registered host as stored. */
export interface HostRow extends HostRecord {
  createdAt: number;
}

const MIGRATIONS: readonly string[] = [
  // 1: the first tables (hosts, sign-in, events).
  `
  CREATE TABLE hosts (
    id TEXT PRIMARY KEY,
    root TEXT NOT NULL UNIQUE,
    git_common_dir TEXT NOT NULL,
    base_branch TEXT NOT NULL,
    adapter TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE login_codes (
    code_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  ) STRICT;
  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    host_id TEXT,
    family TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;
  `,
  // 2: the build lane (first-unattended-run). Runs, the changes in each run, agent sessions,
  // gate results, learned model windows and the governor's persisted pause. JSON columns hold
  // small structured values (run settings, flags, task ticks, usage); logs and handoffs are files.
  `
  CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL REFERENCES hosts(id),
    state TEXT NOT NULL CHECK (state IN ('running', 'stopping', 'ended')),
    settings TEXT NOT NULL,
    stop_at INTEGER,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    end_reason TEXT CHECK (end_reason IN ('finished', 'stopped', 'stop-time', 'error', 'refused')),
    end_detail TEXT,
    report_path TEXT,
    CHECK ((state = 'ended') = (ended_at IS NOT NULL AND end_reason IS NOT NULL))
  ) STRICT;
  -- One run at a time per machine.
  CREATE UNIQUE INDEX runs_one_active ON runs((1)) WHERE state <> 'ended';

  CREATE TABLE run_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs(id),
    change TEXT NOT NULL,
    position INTEGER NOT NULL,
    state TEXT NOT NULL
      CHECK (state IN ('queued', 'building', 'green', 'parked', 'skipped', 'stopped')),
    reason TEXT,
    approval_commit TEXT,
    base_commit TEXT,
    branch TEXT,
    worktree TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    pr_url TEXT,
    preview_url TEXT,
    flags TEXT NOT NULL DEFAULT '[]',
    task_ticks TEXT NOT NULL DEFAULT '[]',
    handoff_path TEXT,
    started_at INTEGER,
    ended_at INTEGER,
    UNIQUE (run_id, change),
    UNIQUE (run_id, position)
  ) STRICT;

  CREATE TABLE agent_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host_id TEXT NOT NULL REFERENCES hosts(id),
    run_change_id INTEGER REFERENCES run_changes(id),
    kind TEXT NOT NULL CHECK (kind IN ('builder', 'calibration')),
    number INTEGER NOT NULL,
    model TEXT NOT NULL,
    claude_version TEXT,
    pid INTEGER,
    process_tag TEXT NOT NULL,
    raw_log_path TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    end_reason TEXT,
    peak_context_tokens INTEGER,
    usage TEXT,
    CHECK (kind = 'calibration' OR run_change_id IS NOT NULL)
  ) STRICT;
  CREATE INDEX agent_sessions_open ON agent_sessions(ended_at) WHERE ended_at IS NULL;

  CREATE TABLE gate_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_change_id INTEGER NOT NULL REFERENCES run_changes(id),
    attempt INTEGER NOT NULL,
    gate TEXT NOT NULL,
    verdict TEXT CHECK (verdict IN ('pass', 'fail')),
    reason TEXT,
    exit_code INTEGER,
    signal TEXT,
    pid INTEGER,
    process_tag TEXT NOT NULL,
    log_path TEXT NOT NULL,
    tail TEXT,
    survivors TEXT NOT NULL DEFAULT '[]',
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    duration_ms INTEGER,
    UNIQUE (run_change_id, attempt, gate),
    CHECK ((verdict IS NULL) = (ended_at IS NULL)),
    CHECK (verdict IS NOT 'fail' OR reason IS NOT NULL)
  ) STRICT;

  CREATE TABLE model_windows (
    model TEXT NOT NULL,
    claude_version TEXT NOT NULL,
    window_tokens INTEGER NOT NULL CHECK (window_tokens > 0),
    learned_at INTEGER NOT NULL,
    PRIMARY KEY (model, claude_version)
  ) STRICT;

  -- A single row: the machine-wide pause and the last utilization seen per limit window.
  CREATE TABLE governor (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    paused_until INTEGER,
    pause_reason TEXT,
    utilization TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL
  ) STRICT;
  INSERT INTO governor (id, paused_until, pause_reason, utilization, updated_at)
    VALUES (1, NULL, NULL, '{}', 0);
  `,
  // 3: each project's run settings (build-runs: Run settings page), saved from the console.
  `
  CREATE TABLE host_settings (
    host_id TEXT PRIMARY KEY REFERENCES hosts(id),
    settings TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;
  `,
  // 4: notes a run leaves for the owner while it goes on (run-as-owner: the login shell could not
  // be read, so the run used the daemon's environment).
  `
  ALTER TABLE runs ADD COLUMN notices TEXT NOT NULL DEFAULT '[]';
  `,
  // 5: one-click approvals (approvals: Approve in one click; design D-4). One row per host and
  // change: when the owner approved it and the base-branch commit it was given at. Hosts
  // registered before this version get their earlier approval files carried over once, at the
  // next daemon start (approvals: Earlier approvals carry over).
  `
  CREATE TABLE approvals (
    host_id TEXT NOT NULL REFERENCES hosts(id),
    change TEXT NOT NULL,
    approved_at INTEGER NOT NULL,
    base_commit TEXT,
    carried_over INTEGER NOT NULL DEFAULT 0 CHECK (carried_over IN (0, 1)),
    PRIMARY KEY (host_id, change)
  ) STRICT;
  CREATE TABLE approval_carryover (
    host_id TEXT PRIMARY KEY REFERENCES hosts(id),
    done_at INTEGER
  ) STRICT;
  INSERT INTO approval_carryover (host_id, done_at) SELECT id, NULL FROM hosts;
  `,
  // 6: what a change's build left for the owner: the builder's ask-first questions (needs-you:
  // Builder questions in Needs You) and the change's test share (gates: Test budget).
  `
  ALTER TABLE run_changes ADD COLUMN questions TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE run_changes ADD COLUMN test_share TEXT;
  `,
  // 7: two more gate outcomes (gates: Gates can take only the changed files; Fast gates every
  // attempt, final gates once): `skipped` (no matching file changed) and `not-run` (an earlier
  // gate of the attempt failed). SQLite cannot change a CHECK, so the table is rebuilt; nothing
  // references it.
  `
  CREATE TABLE gate_results_v7 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_change_id INTEGER NOT NULL REFERENCES run_changes(id),
    attempt INTEGER NOT NULL,
    gate TEXT NOT NULL,
    verdict TEXT CHECK (verdict IN ('pass', 'fail', 'skipped', 'not-run')),
    reason TEXT,
    exit_code INTEGER,
    signal TEXT,
    pid INTEGER,
    process_tag TEXT NOT NULL,
    log_path TEXT NOT NULL,
    tail TEXT,
    survivors TEXT NOT NULL DEFAULT '[]',
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    duration_ms INTEGER,
    UNIQUE (run_change_id, attempt, gate),
    CHECK ((verdict IS NULL) = (ended_at IS NULL)),
    CHECK (verdict IS NOT 'fail' OR reason IS NOT NULL)
  ) STRICT;
  INSERT INTO gate_results_v7 SELECT * FROM gate_results;
  DROP TABLE gate_results;
  ALTER TABLE gate_results_v7 RENAME TO gate_results;
  `,
];

/** Path of the state database under a home. */
export function stateDbPath(home: string): string {
  return join(resolve(home), 'state.db');
}

function userVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get();
  const value = row?.user_version;
  return typeof value === 'number' ? value : 0;
}

/** The schema version this Counterpoint migrates a store to. */
export const STORE_VERSION = MIGRATIONS.length;

function migrate(db: DatabaseSync, upTo: number = MIGRATIONS.length): void {
  const current = userVersion(db);
  if (current > MIGRATIONS.length) {
    throw new Error(
      `The Counterpoint store is at schema version ${current}, newer than this version of Counterpoint supports (${MIGRATIONS.length}).`,
    );
  }
  for (let version = current; version < Math.min(upTo, MIGRATIONS.length); version += 1) {
    const sql = MIGRATIONS[version];
    if (sql === undefined) break;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

/**
 * Opens (creating if needed) the read-write store and applies pending migrations. Daemon only.
 * `upTo` stops at an earlier schema version (tests of a migration).
 */
export function openStore(home: string, options: { upTo?: number } = {}): Store {
  const db = new DatabaseSync(stateDbPath(home));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db, options.upTo);
  return db;
}

/** Opens the existing store read-only (CLI readers). Throws if the store does not exist. */
export function openStoreReadOnly(home: string): Store {
  const db = new DatabaseSync(stateDbPath(home), { readOnly: true });
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

function text(row: Record<string, SQLOutputValue>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Store row has no text column ${key}.`);
  return value;
}

function integer(row: Record<string, SQLOutputValue>, key: string): number {
  const value = row[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  throw new Error(`Store row has no integer column ${key}.`);
}

function toHost(row: Record<string, SQLOutputValue>): HostRow {
  return {
    id: text(row, 'id'),
    root: text(row, 'root'),
    gitCommonDir: text(row, 'git_common_dir'),
    baseBranch: text(row, 'base_branch'),
    adapter: text(row, 'adapter'),
    createdAt: integer(row, 'created_at'),
  };
}

const HOST_COLUMNS = 'id, root, git_common_dir, base_branch, adapter, created_at';

export function listHosts(db: Store): HostRow[] {
  return db.prepare(`SELECT ${HOST_COLUMNS} FROM hosts ORDER BY created_at, id`).all().map(toHost);
}

export function getHost(db: Store, id: string): HostRow | undefined {
  const row = db.prepare(`SELECT ${HOST_COLUMNS} FROM hosts WHERE id = ?`).get(id);
  return row === undefined ? undefined : toHost(row);
}

/** Inserts a host or updates it in place; `created_at` is kept on update. */
export function upsertHost(db: Store, host: HostRecord, now: number = Date.now()): void {
  db.prepare(
    `INSERT INTO hosts (id, root, git_common_dir, base_branch, adapter, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       root = excluded.root,
       git_common_dir = excluded.git_common_dir,
       base_branch = excluded.base_branch,
       adapter = excluded.adapter`,
  ).run(host.id, host.root, host.gitCommonDir, host.baseBranch, host.adapter, now);
}

/** The store as the host registry sees it. */
export function hostRegistryStore(db: Store): HostRegistryStore {
  return {
    listHosts: () => listHosts(db),
    upsertHost: (host) => upsertHost(db, host),
  };
}

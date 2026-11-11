// The daemon's SQLite store (node:sqlite). The daemon is the only writer; CLI readers open it
// read-only. Schema changes go through numbered migrations keyed by `PRAGMA user_version`.
//
// Approvals are never stored here as authority: they are derived from git at read time. This
// store holds hosts, sign-in material (hashed) and the event outbox.
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

function migrate(db: DatabaseSync): void {
  const current = userVersion(db);
  if (current > MIGRATIONS.length) {
    throw new Error(
      `The Counterpoint store is at schema version ${current}, newer than this version of Counterpoint supports (${MIGRATIONS.length}).`,
    );
  }
  for (let version = current; version < MIGRATIONS.length; version += 1) {
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

/** Opens (creating if needed) the read-write store and applies pending migrations. Daemon only. */
export function openStore(home: string): Store {
  const db = new DatabaseSync(stateDbPath(home));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
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

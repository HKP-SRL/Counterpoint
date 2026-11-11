// Runs, the changes in each run, and their gate results in the store (migration 2).
//
// This module holds only what the build lane writes and reads row by row. A gate result is
// recorded with its pid (its process group) and its process tag before the gate does any work, so
// crash recovery at the next daemon start can end it and everything it started.
import type { SQLOutputValue } from 'node:sqlite';
import type { Store } from './db.ts';

export type RunChangeState = 'queued' | 'building' | 'green' | 'parked' | 'skipped' | 'stopped';

/** Something the owner should see on a change (in the PR body, the run report, Needs You). */
export interface RunChangeFlag {
  kind: string;
  /** A repository-relative path, when the flag is about one. */
  path?: string;
  detail?: string;
}

export interface RunChangeRow {
  id: number;
  runId: string;
  change: string;
  position: number;
  state: RunChangeState;
  reason: string | null;
  baseCommit: string | null;
  branch: string | null;
  worktree: string | null;
  attempts: number;
  flags: RunChangeFlag[];
  startedAt: number | null;
  endedAt: number | null;
}

export type GateVerdict = 'pass' | 'fail';

/** Why a gate failed. Each is distinct, so the owner and the builder see what happened. */
export type GateFailReason =
  | 'exit-code'
  | 'signal'
  | 'timeout'
  | 'stopped'
  | 'zero-tests'
  | 'no-test-count'
  | 'service'
  | 'spawn'
  | 'test-lock';

export interface GateSurvivor {
  pid: number;
  command: string;
}

export interface GateResultRow {
  id: number;
  runChangeId: number;
  attempt: number;
  gate: string;
  verdict: GateVerdict | null;
  reason: GateFailReason | null;
  exitCode: number | null;
  signal: string | null;
  pid: number | null;
  processTag: string;
  logPath: string;
  tail: string | null;
  survivors: GateSurvivor[];
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
}

function num(value: SQLOutputValue | undefined): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return null;
}

function str(value: SQLOutputValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function json<T>(value: SQLOutputValue | undefined, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// --- runs ------------------------------------------------------------------------------------

export interface NewRun {
  id: string;
  hostId: string;
  settings: unknown;
  stopAt: number | null;
}

export function insertRun(db: Store, run: NewRun, now: number = Date.now()): void {
  db.prepare(
    `INSERT INTO runs (id, host_id, state, settings, stop_at, started_at)
     VALUES (?, ?, 'running', ?, ?, ?)`,
  ).run(run.id, run.hostId, JSON.stringify(run.settings), run.stopAt, now);
}

// --- run changes -----------------------------------------------------------------------------

function toRunChange(row: Record<string, SQLOutputValue>): RunChangeRow {
  return {
    id: num(row.id) ?? 0,
    runId: str(row.run_id) ?? '',
    change: str(row.change) ?? '',
    position: num(row.position) ?? 0,
    state: str(row.state) as RunChangeState,
    reason: str(row.reason),
    baseCommit: str(row.base_commit),
    branch: str(row.branch),
    worktree: str(row.worktree),
    attempts: num(row.attempts) ?? 0,
    flags: json<RunChangeFlag[]>(row.flags, []),
    startedAt: num(row.started_at),
    endedAt: num(row.ended_at),
  };
}

export function insertRunChange(
  db: Store,
  input: { runId: string; change: string; position: number },
): number {
  const result = db
    .prepare(`INSERT INTO run_changes (run_id, change, position, state) VALUES (?, ?, ?, 'queued')`)
    .run(input.runId, input.change, input.position);
  return Number(result.lastInsertRowid);
}

export function getRunChange(db: Store, id: number): RunChangeRow | undefined {
  const row = db.prepare('SELECT * FROM run_changes WHERE id = ?').get(id);
  return row === undefined ? undefined : toRunChange(row);
}

/** Counts one more failed gate round on the change; returns the new count. */
export function recordFailedAttempt(db: Store, id: number): number {
  const row = db
    .prepare('UPDATE run_changes SET attempts = attempts + 1 WHERE id = ? RETURNING attempts')
    .get(id);
  return num(row?.attempts) ?? 0;
}

/** Parks the change with its reason (gates: Bounded retries then parking). */
export function parkRunChange(db: Store, id: number, reason: string, now = Date.now()): void {
  db.prepare(`UPDATE run_changes SET state = 'parked', reason = ?, ended_at = ? WHERE id = ?`).run(
    reason,
    now,
    id,
  );
}

/** Adds flags to the change, keeping each distinct flag once, in order. */
export function addRunChangeFlags(db: Store, id: number, flags: readonly RunChangeFlag[]): void {
  if (flags.length === 0) return;
  const current = getRunChange(db, id);
  if (current === undefined) throw new Error(`No run change ${id}.`);
  const seen = new Set(current.flags.map((flag) => JSON.stringify(flag)));
  const merged = [...current.flags];
  for (const flag of flags) {
    const key = JSON.stringify(flag);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(flag);
  }
  db.prepare('UPDATE run_changes SET flags = ? WHERE id = ?').run(JSON.stringify(merged), id);
}

// --- gate results ----------------------------------------------------------------------------

function toGateResult(row: Record<string, SQLOutputValue>): GateResultRow {
  return {
    id: num(row.id) ?? 0,
    runChangeId: num(row.run_change_id) ?? 0,
    attempt: num(row.attempt) ?? 0,
    gate: str(row.gate) ?? '',
    verdict: str(row.verdict) as GateVerdict | null,
    reason: str(row.reason) as GateFailReason | null,
    exitCode: num(row.exit_code),
    signal: str(row.signal),
    pid: num(row.pid),
    processTag: str(row.process_tag) ?? '',
    logPath: str(row.log_path) ?? '',
    tail: str(row.tail),
    survivors: json<GateSurvivor[]>(row.survivors, []),
    startedAt: num(row.started_at) ?? 0,
    endedAt: num(row.ended_at),
    durationMs: num(row.duration_ms),
  };
}

/** Records a gate about to start; returns its id. The pid is set once the process exists. */
export function insertGateResult(
  db: Store,
  input: {
    runChangeId: number;
    attempt: number;
    gate: string;
    processTag: string;
    logPath: string;
  },
  now: number = Date.now(),
): number {
  const result = db
    .prepare(
      `INSERT INTO gate_results (run_change_id, attempt, gate, process_tag, log_path, started_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(input.runChangeId, input.attempt, input.gate, input.processTag, input.logPath, now);
  return Number(result.lastInsertRowid);
}

export function setGatePid(db: Store, id: number, pid: number): void {
  db.prepare('UPDATE gate_results SET pid = ? WHERE id = ?').run(pid, id);
}

export interface GateEnd {
  verdict: GateVerdict;
  reason: GateFailReason | null;
  exitCode: number | null;
  signal: string | null;
  tail: string;
  survivors: readonly GateSurvivor[];
  durationMs: number;
}

export function finishGateResult(db: Store, id: number, end: GateEnd, now = Date.now()): void {
  if (end.verdict === 'fail' && end.reason === null)
    throw new Error('A failed gate needs a reason.');
  db.prepare(
    `UPDATE gate_results
       SET verdict = ?, reason = ?, exit_code = ?, signal = ?, tail = ?, survivors = ?,
           ended_at = ?, duration_ms = ?
     WHERE id = ? AND ended_at IS NULL`,
  ).run(
    end.verdict,
    end.reason,
    end.exitCode,
    end.signal,
    end.tail,
    JSON.stringify(end.survivors),
    now,
    end.durationMs,
    id,
  );
}

export function getGateResult(db: Store, id: number): GateResultRow | undefined {
  const row = db.prepare('SELECT * FROM gate_results WHERE id = ?').get(id);
  return row === undefined ? undefined : toGateResult(row);
}

/** Every gate result of a change, by attempt then start. */
export function listGateResults(db: Store, runChangeId: number): GateResultRow[] {
  return db
    .prepare('SELECT * FROM gate_results WHERE run_change_id = ? ORDER BY attempt, id')
    .all(runChangeId)
    .map(toGateResult);
}

/** Gates with no end recorded (crash recovery). */
export function openGateResults(db: Store): GateResultRow[] {
  return db
    .prepare('SELECT * FROM gate_results WHERE ended_at IS NULL ORDER BY id')
    .all()
    .map(toGateResult);
}

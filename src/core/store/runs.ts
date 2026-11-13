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

/** A question the builder asked before doing something it cannot undo (build/questions.ts). */
export interface ChangeQuestion {
  task: string | null;
  text: string;
  options: string[];
  recommended: number | null;
  waiting: string[];
}

/** How much of a built change is tests (build/branch-diff.ts), with the budget it was held to. */
export interface StoredTestShare {
  percent: number;
  testLines: number;
  addedLines: number;
  /** The host's `tests.budget` at the build's base commit. */
  budget: number;
  editedTests: Array<{ path: string; status: string }>;
}

export interface RunChangeRow {
  id: number;
  runId: string;
  change: string;
  position: number;
  state: RunChangeState;
  reason: string | null;
  approvalCommit: string | null;
  baseCommit: string | null;
  branch: string | null;
  worktree: string | null;
  attempts: number;
  prUrl: string | null;
  previewUrl: string | null;
  flags: RunChangeFlag[];
  handoffPath: string | null;
  startedAt: number | null;
  endedAt: number | null;
  /** The builder's ask-first questions, when the change parked on them. */
  questions: ChangeQuestion[];
  /** The test share of a built change, or null. */
  testShare: StoredTestShare | null;
  /** How the base was fetched when the build started; null when nothing was fetched. */
  baseFetch: BaseFetchNote | null;
}

/**
 * The fetch at a change's build start: the base it built from (`origin/master`), when that was
 * fetched (null when no fetch has succeeded since Counterpoint started) and the error, when the
 * fetch failed.
 */
export interface BaseFetchNote {
  base: string;
  fetchedAt: number | null;
  error: string | null;
}

/**
 * `skipped`: the gate's changed-file list was empty, so it had nothing to check. `not-run`: an
 * earlier gate of the attempt failed, so this one never started.
 */
export type GateVerdict = 'pass' | 'fail' | 'skipped' | 'not-run';

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

export type RunState = 'running' | 'stopping' | 'ended';
export type RunEndReason = 'finished' | 'stopped' | 'stop-time' | 'error' | 'refused';

export interface RunRow {
  id: string;
  hostId: string;
  state: RunState;
  settings: unknown;
  stopAt: number | null;
  startedAt: number;
  endedAt: number | null;
  endReason: RunEndReason | null;
  endDetail: string | null;
  reportPath: string | null;
  /** Notes the run left for the owner while it went on (Needs You shows them). */
  notices: string[];
}

function toRun(row: Record<string, SQLOutputValue>): RunRow {
  return {
    id: str(row.id) ?? '',
    hostId: str(row.host_id) ?? '',
    state: str(row.state) as RunState,
    settings: json<unknown>(row.settings, {}),
    stopAt: num(row.stop_at),
    startedAt: num(row.started_at) ?? 0,
    endedAt: num(row.ended_at),
    endReason: str(row.end_reason) as RunEndReason | null,
    endDetail: str(row.end_detail),
    reportPath: str(row.report_path),
    notices: json<string[]>(row.notices, []).filter((note) => typeof note === 'string'),
  };
}

export function getRun(db: Store, id: string): RunRow | undefined {
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
  return row === undefined ? undefined : toRun(row);
}

/** The run that has not ended (one at a time per machine), or undefined. */
export function activeRun(db: Store): RunRow | undefined {
  const row = db
    .prepare("SELECT * FROM runs WHERE state <> 'ended' ORDER BY started_at DESC")
    .get();
  return row === undefined ? undefined : toRun(row);
}

/** The host's most recent run, ended or not. */
export function latestRun(db: Store, hostId: string): RunRow | undefined {
  const row = db
    .prepare('SELECT * FROM runs WHERE host_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1')
    .get(hostId);
  return row === undefined ? undefined : toRun(row);
}

/** The host's latest run that has a report. */
export function latestReportedRun(db: Store, hostId: string): RunRow | undefined {
  const row = db
    .prepare(
      'SELECT * FROM runs WHERE host_id = ? AND report_path IS NOT NULL ORDER BY started_at DESC LIMIT 1',
    )
    .get(hostId);
  return row === undefined ? undefined : toRun(row);
}

export function setRunStopping(db: Store, id: string): void {
  db.prepare("UPDATE runs SET state = 'stopping' WHERE id = ? AND state = 'running'").run(id);
}

export function endRun(
  db: Store,
  id: string,
  end: { reason: RunEndReason; detail?: string | null },
  now: number = Date.now(),
): void {
  db.prepare(
    `UPDATE runs SET state = 'ended', ended_at = ?, end_reason = ?, end_detail = ?
     WHERE id = ? AND state <> 'ended'`,
  ).run(now, end.reason, end.detail?.slice(0, 2000) ?? null, id);
}

/** Adds a note for the owner to the run (once per text). */
export function addRunNotice(db: Store, id: string, notice: string): void {
  const row = db.prepare('SELECT notices FROM runs WHERE id = ?').get(id);
  if (row === undefined) return;
  const notices = json<string[]>(row.notices, []);
  if (notices.includes(notice)) return;
  db.prepare('UPDATE runs SET notices = ? WHERE id = ?').run(
    JSON.stringify([...notices, notice]),
    id,
  );
}

export function setRunReportPath(db: Store, id: string, path: string): void {
  db.prepare('UPDATE runs SET report_path = ? WHERE id = ?').run(path, id);
}

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
    approvalCommit: str(row.approval_commit),
    baseCommit: str(row.base_commit),
    branch: str(row.branch),
    worktree: str(row.worktree),
    attempts: num(row.attempts) ?? 0,
    prUrl: str(row.pr_url),
    previewUrl: str(row.preview_url),
    flags: json<RunChangeFlag[]>(row.flags, []),
    handoffPath: str(row.handoff_path),
    startedAt: num(row.started_at),
    endedAt: num(row.ended_at),
    questions: json<ChangeQuestion[]>(row.questions, []),
    testShare: json<StoredTestShare | null>(row.test_share, null),
    baseFetch: json<BaseFetchNote | null>(row.base_fetch, null),
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

export function listRunChanges(db: Store, runId: string): RunChangeRow[] {
  return db
    .prepare('SELECT * FROM run_changes WHERE run_id = ? ORDER BY position')
    .all(runId)
    .map(toRunChange);
}

/** The host's latest run entry for `change` that has a worktree (newest run first), if any. */
export function latestBuiltRunChange(
  db: Store,
  hostId: string,
  change: string,
): RunChangeRow | undefined {
  const row = db
    .prepare(
      `SELECT rc.* FROM run_changes rc JOIN runs r ON r.id = rc.run_id
       WHERE r.host_id = ? AND rc.change = ? AND rc.worktree IS NOT NULL AND rc.base_commit IS NOT NULL
       ORDER BY r.started_at DESC, rc.id DESC LIMIT 1`,
    )
    .get(hostId, change);
  return row === undefined ? undefined : toRunChange(row);
}

export interface RunChangeUpdate {
  state?: RunChangeState;
  reason?: string | null;
  approvalCommit?: string | null;
  baseCommit?: string | null;
  branch?: string | null;
  worktree?: string | null;
  prUrl?: string | null;
  previewUrl?: string | null;
  taskTicks?: string[];
  handoffPath?: string | null;
  startedAt?: number | null;
  endedAt?: number | null;
  questions?: ChangeQuestion[];
  testShare?: StoredTestShare | null;
  baseFetch?: BaseFetchNote | null;
}

const UPDATE_COLUMNS: Readonly<Record<keyof RunChangeUpdate, string>> = {
  state: 'state',
  reason: 'reason',
  approvalCommit: 'approval_commit',
  baseCommit: 'base_commit',
  branch: 'branch',
  worktree: 'worktree',
  prUrl: 'pr_url',
  previewUrl: 'preview_url',
  taskTicks: 'task_ticks',
  handoffPath: 'handoff_path',
  startedAt: 'started_at',
  endedAt: 'ended_at',
  questions: 'questions',
  testShare: 'test_share',
  baseFetch: 'base_fetch',
};

export function updateRunChange(db: Store, id: number, update: RunChangeUpdate): void {
  const sets: string[] = [];
  const values: Array<string | number | null> = [];
  for (const [key, column] of Object.entries(UPDATE_COLUMNS) as Array<
    [keyof RunChangeUpdate, string]
  >) {
    if (!(key in update)) continue;
    const value = update[key];
    sets.push(`${column} = ?`);
    values.push(
      Array.isArray(value) || (typeof value === 'object' && value !== null)
        ? JSON.stringify(value)
        : ((value as string | number | null | undefined) ?? null),
    );
  }
  if (sets.length === 0) return;
  db.prepare(`UPDATE run_changes SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
}

/** The change's recorded task ticks (cumulative, by text). */
export function runChangeTicks(db: Store, id: number): string[] {
  const row = db.prepare('SELECT task_ticks, handoff_path FROM run_changes WHERE id = ?').get(id);
  return json<string[]>(row?.task_ticks, []);
}

export function runChangeHandoffPath(db: Store, id: number): string | null {
  const row = db.prepare('SELECT handoff_path FROM run_changes WHERE id = ?').get(id);
  return str(row?.handoff_path);
}

/** How many builder sessions the change has had (the next session's number is this + 1). */
export function builderSessionCount(db: Store, runChangeId: number): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM agent_sessions WHERE run_change_id = ? AND kind = 'builder'",
    )
    .get(runChangeId);
  return num(row?.n) ?? 0;
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

// The state of a change's PR (runway: A merged build PR means built). Only each change's latest
// PR counts: a later build of the same change opens or updates a newer one.

export type PullRequestState = 'open' | 'merged' | 'closed';

export interface LatestPullRequest {
  /** The run change row that holds the PR. */
  id: number;
  change: string;
  prUrl: string;
  prState: PullRequestState | null;
}

/** Each change's latest PR on a host (the newest run change row with a PR URL). */
export function latestPullRequests(db: Store, hostId: string): LatestPullRequest[] {
  const rows = db
    .prepare(
      `SELECT rc.id, rc.change, rc.pr_url, rc.pr_state
         FROM run_changes rc JOIN runs r ON r.id = rc.run_id
        WHERE r.host_id = ? AND rc.pr_url IS NOT NULL
          AND rc.id = (SELECT MAX(rc2.id) FROM run_changes rc2 JOIN runs r2 ON r2.id = rc2.run_id
                        WHERE r2.host_id = r.host_id AND rc2.change = rc.change
                          AND rc2.pr_url IS NOT NULL)
        ORDER BY rc.id`,
    )
    .all(hostId);
  return rows.map((row) => {
    const state = row.pr_state;
    return {
      id: Number(row.id),
      change: String(row.change),
      prUrl: String(row.pr_url),
      prState: state === 'open' || state === 'merged' || state === 'closed' ? state : null,
    };
  });
}

/** Records the PR state `gh` reported for a run change row. */
export function setPullRequestState(db: Store, id: number, state: PullRequestState): void {
  db.prepare('UPDATE run_changes SET pr_state = ? WHERE id = ?').run(state, id);
}

/** The changes on a host whose latest PR merged: built, whatever their task list says. */
export function mergedChanges(db: Store, hostId: string): Set<string> {
  return new Set(
    latestPullRequests(db, hostId)
      .filter((pr) => pr.prState === 'merged')
      .map((pr) => pr.change),
  );
}

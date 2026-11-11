// Agent sessions and learned model windows in the store (migration 2).
//
// Every agent session the build lane starts is recorded with its pid (its process group) and its
// process tag before it does any work, so crash recovery at the next daemon start can end it and
// everything it started. Model windows are learned per (model, claude version) from the `result`
// events sessions print; nothing assumes a window size.
import type { SQLOutputValue } from 'node:sqlite';
import type { Store } from './db.ts';

export type AgentSessionKind = 'builder' | 'calibration';

export interface NewAgentSession {
  hostId: string;
  runChangeId: number | null;
  kind: AgentSessionKind;
  number: number;
  model: string;
  claudeVersion: string | null;
  processTag: string;
  rawLogPath: string;
}

export interface AgentSessionRow extends NewAgentSession {
  id: number;
  pid: number | null;
  startedAt: number;
  endedAt: number | null;
  endReason: string | null;
  peakContextTokens: number | null;
  usage: unknown;
}

function num(value: SQLOutputValue | undefined): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return null;
}

function str(value: SQLOutputValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function toSession(row: Record<string, SQLOutputValue>): AgentSessionRow {
  return {
    id: num(row.id) ?? 0,
    hostId: str(row.host_id) ?? '',
    runChangeId: num(row.run_change_id),
    kind: str(row.kind) as AgentSessionKind,
    number: num(row.number) ?? 0,
    model: str(row.model) ?? '',
    claudeVersion: str(row.claude_version),
    processTag: str(row.process_tag) ?? '',
    rawLogPath: str(row.raw_log_path) ?? '',
    pid: num(row.pid),
    startedAt: num(row.started_at) ?? 0,
    endedAt: num(row.ended_at),
    endReason: str(row.end_reason),
    peakContextTokens: num(row.peak_context_tokens),
    usage: row.usage === null || row.usage === undefined ? null : JSON.parse(String(row.usage)),
  };
}

/** Records a session about to start; returns its id. The pid is set once the process exists. */
export function insertAgentSession(
  db: Store,
  session: NewAgentSession,
  now: number = Date.now(),
): number {
  const result = db
    .prepare(
      `INSERT INTO agent_sessions
         (host_id, run_change_id, kind, number, model, claude_version, process_tag, raw_log_path, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      session.hostId,
      session.runChangeId,
      session.kind,
      session.number,
      session.model,
      session.claudeVersion,
      session.processTag,
      session.rawLogPath,
      now,
    );
  return Number(result.lastInsertRowid);
}

export function setAgentSessionPid(db: Store, id: number, pid: number): void {
  db.prepare('UPDATE agent_sessions SET pid = ? WHERE id = ?').run(pid, id);
}

export function endAgentSession(
  db: Store,
  id: number,
  end: { reason: string; peakContextTokens: number | null; usage?: unknown },
  now: number = Date.now(),
): void {
  db.prepare(
    `UPDATE agent_sessions SET ended_at = ?, end_reason = ?, peak_context_tokens = ?, usage = ?
     WHERE id = ? AND ended_at IS NULL`,
  ).run(
    now,
    end.reason,
    end.peakContextTokens,
    end.usage === undefined ? null : JSON.stringify(end.usage),
    id,
  );
}

/** Sessions with no end recorded (crash recovery). */
export function openAgentSessions(db: Store): AgentSessionRow[] {
  return db
    .prepare('SELECT * FROM agent_sessions WHERE ended_at IS NULL ORDER BY id')
    .all()
    .map(toSession);
}

export function getAgentSession(db: Store, id: number): AgentSessionRow | undefined {
  const row = db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(id);
  return row === undefined ? undefined : toSession(row);
}

/** The learned window of `model` on `claudeVersion`, or null when none is known yet. */
export function getModelWindow(db: Store, model: string, claudeVersion: string): number | null {
  const row = db
    .prepare('SELECT window_tokens FROM model_windows WHERE model = ? AND claude_version = ?')
    .get(model, claudeVersion);
  return num(row?.window_tokens);
}

/** Records (or replaces) a learned window. */
export function recordModelWindow(
  db: Store,
  model: string,
  claudeVersion: string,
  windowTokens: number,
  now: number = Date.now(),
): void {
  if (!Number.isInteger(windowTokens) || windowTokens <= 0) {
    throw new Error('A model window must be a positive integer.');
  }
  db.prepare(
    `INSERT INTO model_windows (model, claude_version, window_tokens, learned_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(model, claude_version) DO UPDATE SET
       window_tokens = excluded.window_tokens, learned_at = excluded.learned_at`,
  ).run(model, claudeVersion, windowTokens, now);
}

// The owner's approvals in the store (approvals; design D-4, migration 5). One row per host and
// change. An approval is the owner saying "build this": it stays when the change's plan or the
// host's gate config is revised, and ends only when the owner withdraws it or the change is built.
import type { SQLOutputValue } from 'node:sqlite';
import type { Store } from './db.ts';

export interface ApprovalRow {
  hostId: string;
  change: string;
  /** Epoch ms. */
  approvedAt: number;
  /** The base-branch commit the approval was given at, when it was known. */
  baseCommit: string | null;
  /** Recorded from an approval file of an earlier version (carry-over), not a click. */
  carriedOver: boolean;
}

function toRow(row: Record<string, SQLOutputValue>): ApprovalRow {
  const at = row.approved_at;
  return {
    hostId: String(row.host_id),
    change: String(row.change),
    approvedAt: typeof at === 'bigint' ? Number(at) : Number(at ?? 0),
    baseCommit: typeof row.base_commit === 'string' ? row.base_commit : null,
    carriedOver: Number(row.carried_over ?? 0) === 1,
  };
}

/** Records an approval. False when the change was already approved (the first one stays). */
export function approveChange(
  db: Store,
  approval: { hostId: string; change: string; baseCommit: string | null; carriedOver?: boolean },
  now: number = Date.now(),
): boolean {
  const result = db
    .prepare(
      `INSERT INTO approvals (host_id, change, approved_at, base_commit, carried_over)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT (host_id, change) DO NOTHING`,
    )
    .run(
      approval.hostId,
      approval.change,
      now,
      approval.baseCommit,
      approval.carriedOver === true ? 1 : 0,
    );
  return Number(result.changes) > 0;
}

/** Ends an approval. False when the change was not approved. */
export function withdrawApproval(db: Store, hostId: string, change: string): boolean {
  const result = db
    .prepare('DELETE FROM approvals WHERE host_id = ? AND change = ?')
    .run(hostId, change);
  return Number(result.changes) > 0;
}

export function getApproval(db: Store, hostId: string, change: string): ApprovalRow | undefined {
  const row = db
    .prepare('SELECT * FROM approvals WHERE host_id = ? AND change = ?')
    .get(hostId, change);
  return row === undefined ? undefined : toRow(row);
}

/** The host's approvals, oldest first. */
export function listApprovals(db: Store, hostId: string): ApprovalRow[] {
  return db
    .prepare('SELECT * FROM approvals WHERE host_id = ? ORDER BY approved_at, change')
    .all(hostId)
    .map(toRow);
}

/** Hosts whose earlier approval files are still to be carried over. */
export function pendingCarryOver(db: Store): string[] {
  return db
    .prepare('SELECT host_id FROM approval_carryover WHERE done_at IS NULL ORDER BY host_id')
    .all()
    .map((row) => String(row.host_id));
}

/** Marks a host's carry-over done: approval files in its repository no longer count. */
export function finishCarryOver(db: Store, hostId: string, now: number = Date.now()): void {
  db.prepare('UPDATE approval_carryover SET done_at = ? WHERE host_id = ?').run(now, hostId);
}

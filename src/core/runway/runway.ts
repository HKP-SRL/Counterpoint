// The runway (runway: Runway is the approved work not yet built; approvals: Approval stays with
// the change; design D-4).
//
// An approval is a row in Counterpoint's store: the owner clicked Approve. It belongs to the
// change, not to a version of its files, so revising the plan or the gate config afterwards keeps
// it. The runway is derived at read time from the approvals and the planning snapshot at the
// base-branch tip: the approved changes that are readable and not built, in build order. An
// approved change that is built (archived, or every task checked) has nothing left to run: its
// approval has ended.
import type { ChangeFacts } from '../framework/port.ts';
import type { ApprovalRow } from '../store/approvals.ts';
import { isBuilt } from './status.ts';

/** Why an approved change is not on the runway now (or that it is not approved). */
export type OffRunwayReason = 'not-approved' | 'built' | 'unreadable' | 'missing';

export type ApprovalState =
  | { state: 'on-runway'; approvedAt: number; baseCommit: string | null }
  | { state: 'off-runway'; reason: OffRunwayReason };

export interface RunwayEntry {
  changeId: string;
  title: string | null;
  taskCount: number;
  /** Epoch ms. */
  approvedAt: number;
}

export interface Runway {
  tip: string | null;
  /** Approved changes that are readable and not built. */
  count: number;
  /** Tasks across those changes. */
  taskCount: number;
  /** In build order (the snapshot's order: dependencies first). */
  onRunway: RunwayEntry[];
}

/** The state of one change's approval against the changes at the tip (null: unknown tip). */
export function approvalStateOf(
  approval: ApprovalRow | undefined,
  change: ChangeFacts | null | undefined,
): ApprovalState {
  if (approval === undefined) return { state: 'off-runway', reason: 'not-approved' };
  if (change === undefined || change === null) return { state: 'off-runway', reason: 'missing' };
  if (change.unreadable !== null) return { state: 'off-runway', reason: 'unreadable' };
  if (isBuilt(change)) return { state: 'off-runway', reason: 'built' };
  return { state: 'on-runway', approvedAt: approval.approvedAt, baseCommit: approval.baseCommit };
}

/** The runway: the approved changes that are readable and not built, in the snapshot's order. */
export function computeRunway(
  approvals: readonly ApprovalRow[],
  changes: readonly ChangeFacts[] | null,
  tip: string | null,
): Runway {
  const runway: Runway = { tip, count: 0, taskCount: 0, onRunway: [] };
  if (changes === null) return runway;
  const approved = new Map(approvals.map((row) => [row.change, row]));
  for (const change of changes) {
    if (change.archived) continue;
    const state = approvalStateOf(approved.get(change.id), change);
    if (state.state !== 'on-runway') continue;
    runway.onRunway.push({
      changeId: change.id,
      title: change.title,
      taskCount: change.tasks.total,
      approvedAt: state.approvedAt,
    });
    runway.count += 1;
    runway.taskCount += change.tasks.total;
  }
  return runway;
}

/** Approved changes that are built at the tip: their approvals have ended. */
export function endedApprovals(
  approvals: readonly ApprovalRow[],
  changes: readonly ChangeFacts[],
): string[] {
  const active = new Map(
    changes.filter((change) => !change.archived).map((change) => [change.id, change]),
  );
  const archived = new Set(changes.filter((change) => change.archived).map((c) => c.id));
  return approvals
    .filter((row) => {
      const change = active.get(row.change);
      if (change !== undefined) return change.unreadable === null && isBuilt(change);
      return archived.has(row.change);
    })
    .map((row) => row.change);
}

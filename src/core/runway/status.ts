// Change status and owner steps, derived from adapter facts only (framework-agnostic: this module
// knows the port types, never a framework's files).
//
// Precedence (openspec-host-adapter design decision 5): unreadable > built (archived, or every
// task done) > overlay (on-runway / changed, from verified approvals) > ready (a proposal and at
// least one task) > not-planned. A built change is never offered for approval.
import type { ChangeFacts } from '../framework/port.ts';

export type ChangeStatus =
  | 'unreadable'
  | 'built'
  | 'on-runway'
  | 'changed'
  | 'ready'
  | 'not-planned';
export type NotReadyReason = 'no-proposal' | 'no-tasks';
export type StatusOverlay = 'on-runway' | 'changed';

export interface DerivedStatus {
  status: ChangeStatus;
  /** Set only for `not-planned`. */
  notReadyReason: NotReadyReason | null;
}

type StatusFacts = Pick<ChangeFacts, 'unreadable' | 'archived' | 'artifacts' | 'tasks'>;

/** True for a change with nothing left to build: archived, or every task done. */
export function isBuilt(change: Pick<ChangeFacts, 'archived' | 'tasks'>): boolean {
  return change.archived || (change.tasks.total > 0 && change.tasks.done >= change.tasks.total);
}

export function deriveChangeStatus(
  change: StatusFacts,
  overlay?: StatusOverlay | null,
): DerivedStatus {
  if (change.unreadable !== null) return { status: 'unreadable', notReadyReason: null };
  if (isBuilt(change)) return { status: 'built', notReadyReason: null };
  if (overlay) return { status: overlay, notReadyReason: null };
  if (!change.artifacts.proposal) return { status: 'not-planned', notReadyReason: 'no-proposal' };
  if (change.tasks.total === 0) return { status: 'not-planned', notReadyReason: 'no-tasks' };
  return { status: 'ready', notReadyReason: null };
}

/** The steps only the owner can do (unchecked `Owner:` tasks), in task order, without repeats. */
export function ownerSteps(change: Pick<ChangeFacts, 'tasks'>): string[] {
  return [...new Set(change.tasks.ownerSteps)];
}

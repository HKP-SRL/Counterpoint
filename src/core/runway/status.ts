// Change status and owner steps, derived from adapter facts only (framework-agnostic: this module
// knows the port types, never a framework's files).
//
// Precedence (host-planning: Change statuses): unreadable > built (archived, every task done, or
// its latest build PR merged: `merged`, a fact Counterpoint adds, not the adapter) > owner-steps
// (every task done but owner steps: nothing left to build) > on-runway (the owner approved it) >
// ready (a proposal and at least one task) > not-planned. A built change, and one with only owner
// steps left, is never offered for approval.
import type { ChangeFacts } from '../framework/port.ts';

export type ChangeStatus =
  | 'unreadable'
  | 'built'
  | 'owner-steps'
  | 'on-runway'
  | 'ready'
  | 'not-planned';
export type NotReadyReason = 'no-proposal' | 'no-tasks';
export type StatusOverlay = 'on-runway';

export interface DerivedStatus {
  status: ChangeStatus;
  /** Set only for `not-planned`. */
  notReadyReason: NotReadyReason | null;
}

/** A build PR can merge before its ticks reach the base, so a merged build PR is a fact of its own. */
export interface MergedFact {
  /** The change's latest build PR merged (runway: A merged build PR means built). */
  merged?: boolean;
}

type StatusFacts = Pick<ChangeFacts, 'unreadable' | 'archived' | 'artifacts' | 'tasks'> &
  MergedFact;
type BuildFacts = Pick<ChangeFacts, 'archived' | 'tasks'> & MergedFact;

/** True for a change with nothing left to build: archived, every task done, or its PR merged. */
export function isBuilt(change: BuildFacts): boolean {
  return (
    change.archived ||
    change.merged === true ||
    (change.tasks.total > 0 && change.tasks.done >= change.tasks.total)
  );
}

/** How many open tasks are not owner steps: what a build would do. */
export function openBuildTasks(change: Pick<ChangeFacts, 'tasks'>): number {
  const { total, done, ownerSteps } = change.tasks;
  return Math.max(0, total - done - ownerSteps.length);
}

/**
 * True for a planned, unbuilt change whose only open tasks are owner steps: every build task is
 * checked (built outside Counterpoint, say), so a build would have nothing to do. A change with no
 * proposal stays Not ready.
 */
export function onlyOwnerSteps(change: BuildFacts & Pick<ChangeFacts, 'artifacts'>): boolean {
  return (
    change.artifacts.proposal &&
    !isBuilt(change) &&
    change.tasks.ownerSteps.length > 0 &&
    openBuildTasks(change) === 0
  );
}

/** Nothing for a build to do: built, or only owner steps left. */
export function nothingToBuild(change: BuildFacts & Pick<ChangeFacts, 'artifacts'>): boolean {
  return isBuilt(change) || onlyOwnerSteps(change);
}

/** The changes with the `merged` fact set from the ids of changes whose latest PR merged. */
export function withMerged<T extends ChangeFacts>(
  changes: readonly T[],
  merged: ReadonlySet<string>,
): (T & MergedFact)[] {
  return changes.map((change) =>
    !change.archived && merged.has(change.id) ? { ...change, merged: true } : change,
  );
}

export function deriveChangeStatus(
  change: StatusFacts,
  overlay?: StatusOverlay | null,
): DerivedStatus {
  if (change.unreadable !== null) return { status: 'unreadable', notReadyReason: null };
  if (isBuilt(change)) return { status: 'built', notReadyReason: null };
  if (onlyOwnerSteps(change)) return { status: 'owner-steps', notReadyReason: null };
  if (overlay) return { status: overlay, notReadyReason: null };
  if (!change.artifacts.proposal) return { status: 'not-planned', notReadyReason: 'no-proposal' };
  if (change.tasks.total === 0) return { status: 'not-planned', notReadyReason: 'no-tasks' };
  return { status: 'ready', notReadyReason: null };
}

/** The steps only the owner can do (unchecked `Owner:` tasks), in task order, without repeats. */
export function ownerSteps(change: Pick<ChangeFacts, 'tasks'>): string[] {
  return [...new Set(change.tasks.ownerSteps)];
}

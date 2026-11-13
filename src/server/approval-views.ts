// Approvals and the runway for the console, the watcher and the orchestrator (approvals; runway:
// Runway is the approved work not yet built; Where each runway change stands).
//
// Approvals live in Counterpoint's store; whether an approved change is on the runway is derived
// at read time from the planning snapshot at the base-branch tip (src/core/runway/runway.ts). An
// approval ends when its change is built, or has only owner steps left: reading the runway drops
// those rows.
//
// The board adds where each change stands in the build lane (src/core/runway/lane.ts): building,
// parked, on hold, PR open or closed, or waiting on a dependency that is not built; and whether it
// can build now. A merged build PR makes its change built only while it covers every build task
// open at the tip (src/core/runway/merged.ts).
//
// Approve takes effect at once, with no terminal step: it is allowed only on a Ready to approve
// change (readable, not built, a proposal and at least one task, not approved yet) at the tip now,
// and records that tip as the commit it was given at. Withdraw takes a change off the runway.
import type {
  ChangeFacts,
  ChangeSnapshot,
  FrameworkAdapter,
  GitFileReader,
} from '../core/framework/port.ts';
import { findChange } from '../core/framework/port.ts';
import {
  type BuildStage,
  buildStage,
  canBuildNow,
  unbuiltDependencies,
} from '../core/runway/lane.ts';
import { mergeCovers } from '../core/runway/merged.ts';
import {
  type ApprovalState,
  approvalStateOf,
  computeRunway,
  endedApprovals,
  type Runway,
} from '../core/runway/runway.ts';
import {
  type ChangeStatus,
  deriveChangeStatus,
  type MergedFact,
  type NotReadyReason,
  withMerged,
} from '../core/runway/status.ts';
import {
  type ApprovalRow,
  approveChange,
  getApproval,
  listApprovals,
  withdrawApproval,
} from '../core/store/approvals.ts';
import type { NewCard } from '../core/store/cards.ts';
import {
  latestBuilds,
  openIrreversibleQuestions,
  parkDecisions,
  retryParked,
} from '../core/store/change-lane.ts';
import type { Store } from '../core/store/db.ts';
import {
  latestPullRequests,
  mergedChanges,
  type PullRequestState,
  runChangeTicks,
} from '../core/store/runs.ts';
import type { HostView } from './hosts.ts';

/** What the views need of a host: its runtime (the console's) or the orchestrator's view of it. */
export interface ApprovalHost {
  host: { id: string; baseBranch: string };
  reader: GitFileReader;
  adapter: FrameworkAdapter | null;
  /** The base commit now, through the base-ref resolver. */
  tip(): Promise<string | null>;
  /** The host runtime's cached view at the tip, when there is one. */
  view?: () => Promise<HostView>;
}

export type ApproveResult =
  | { ok: true; approved: boolean }
  | { ok: false; status: 404 | 409; error: string };

/** One active change as the console shows it: status, approval and build-lane stage. */
export interface BoardEntry {
  status: ChangeStatus;
  notReadyReason: NotReadyReason | null;
  approval: ApprovalState;
  /** Where it stands in the build lane; for a change that is not approved, only `waits`. */
  stage: BuildStage | null;
  /** On the runway and nothing stands in its way: Run builds it. */
  canBuild: boolean;
  /** Why it shows Built: archived, every task checked, or its build PR merged. */
  builtBy: 'archived' | 'tasks' | 'merged' | null;
  /** Its latest build PR, if it has one. */
  pr: { url: string; state: PullRequestState | null } | null;
  /** Its dependencies that are not built yet. */
  waitsOn: string[];
}

export interface Board {
  tip: string | null;
  /** The changes at the tip with `merged` set where a merged build PR makes them built. */
  changes: (ChangeFacts & MergedFact)[] | null;
  /** By change id, active changes only. */
  entries: Map<string, BoardEntry>;
}

export interface ApprovalViews {
  /** Every active change's status, approval and stage at the tip now. */
  board(runtime: ApprovalHost): Promise<Board>;
  /** The approval state of every change at the tip now, by change id. */
  states(runtime: ApprovalHost): Promise<Map<string, ApprovalState>>;
  /** The state of one change's approval at the tip now, with its stage while on the runway. */
  state(runtime: ApprovalHost, changeId: string): Promise<ApprovalState>;
  /** The runway at the tip now. */
  runway(runtime: ApprovalHost): Promise<Runway>;
  /** Approves a Ready to approve change. */
  approve(runtime: ApprovalHost, changeId: string): Promise<ApproveResult>;
  /** Approves every Ready to approve change; returns the ones it approved. */
  approveAll(runtime: ApprovalHost): Promise<string[]>;
  /** Takes a change off the runway. False when it was not approved. */
  withdraw(runtime: ApprovalHost, changeId: string): boolean;
  /**
   * Retries a parked or held change: the next run builds it, and its next session gets the
   * failure. False when its latest build is not parked.
   */
  retry(runtime: ApprovalHost, changeId: string): Promise<boolean>;
  /**
   * The changes a merged build PR makes built, whatever their tasks: those whose latest PR merged,
   * less those the last read found it no longer covers.
   */
  merged(hostId: string): ReadonlySet<string>;
}

/**
 * The card for an approval that ended because its change is gone from the base branch (renamed or
 * removed): the owner is told once, and a later change of that name needs a click again.
 */
export function endedApprovalCard(hostId: string, approval: ApprovalRow): NewCard {
  return {
    hostId,
    key: `approval-ended:${approval.change}:${approval.approvedAt}`,
    kind: 'approval-ended',
    source: 'change',
    change: approval.change,
    question: `${approval.change} is no longer in the plan, so its approval ended.`,
    why: 'It was renamed or removed on the base branch. A renamed change needs Approve again under its new name.',
    options: [
      { label: 'Got it', consequence: 'Nothing else changes.' },
      {
        label: 'I will approve its new name',
        consequence: 'Open Changes and click Approve on the renamed change.',
      },
    ],
    recommended: 0,
    reversible: true,
    blocking: false,
  };
}

export interface ApprovalViewsOptions {
  store: Store;
  /** Told of each approval ended because its change is gone from the base branch. */
  onMissing?: (hostId: string, approval: ApprovalRow) => void;
  /**
   * The changes whose design drafts hold the build (design-drafts D-12). They stay on the runway
   * and may be picked (the run then skips them with the hold card), but they cannot build now.
   */
  draftsHeld?: (hostId: string) => ReadonlySet<string>;
}

export function createApprovalViews(options: ApprovalViewsOptions): ApprovalViews {
  const db = options.store;
  /** Whether a merged PR row still covers its change at a tip (`${row}:${tip}`). */
  const covers = new Map<string, boolean>();
  /** The changes whose merged build PR no longer covers them, per host, as of the last read. */
  const uncovered = new Map<string, ReadonlySet<string>>();

  /** The changes a merged build PR makes built at `tip`. */
  const mergedAt = async (
    runtime: ApprovalHost,
    tip: string,
    changes: readonly ChangeFacts[],
  ): Promise<Set<string>> => {
    const merged = new Set<string>();
    const notCovered = new Set<string>();
    for (const pr of latestPullRequests(db, runtime.host.id)) {
      if (pr.prState !== 'merged') continue;
      const change = findChange(changes, pr.change);
      if (change === undefined || change.archived) continue;
      const key = `${pr.id}:${tip}`;
      let covered = covers.get(key);
      if (covered === undefined) {
        covered =
          runtime.adapter === null ||
          (await mergeCovers({
            reader: runtime.reader,
            adapter: runtime.adapter,
            tip,
            change,
            build: { baseCommit: pr.baseCommit, ticks: runChangeTicks(db, pr.id) },
          }));
        if (covers.size > 1000) covers.clear();
        covers.set(key, covered);
      }
      if (covered) merged.add(pr.change);
      else notCovered.add(pr.change);
    }
    uncovered.set(runtime.host.id, notCovered);
    return merged;
  };

  /** The changes at the tip now, with the ones a merged build PR makes built marked. */
  const current = async (
    runtime: ApprovalHost,
  ): Promise<{
    tip: string | null;
    changes: (ChangeFacts & MergedFact)[] | null;
    /** The planning root itself read: a change missing from it is really gone. */
    whole: boolean;
  }> => {
    let tip: string | null;
    let snapshot: ChangeSnapshot | null;
    if (runtime.view !== undefined) {
      const view = await runtime.view();
      tip = view.tip;
      snapshot = view.snapshot;
    } else {
      tip = await runtime.tip();
      snapshot =
        tip === null || runtime.adapter === null
          ? null
          : await runtime.adapter.snapshot(runtime.reader, tip);
    }
    if (tip === null || snapshot === null) return { tip, changes: null, whole: false };
    const { changes } = snapshot;
    return {
      tip,
      changes: withMerged(changes, await mergedAt(runtime, tip, changes)),
      whole: snapshot.unreadable === null,
    };
  };

  /**
   * The host's approvals, with those of built changes ended first, and those of changes gone from a
   * whole snapshot (renamed or removed) ended and told.
   */
  const approvalsAt = (hostId: string, changes: readonly ChangeFacts[] | null, whole: boolean) => {
    if (changes !== null) {
      for (const change of endedApprovals(listApprovals(db, hostId), changes)) {
        withdrawApproval(db, hostId, change);
      }
      if (whole) {
        const known = new Set(changes.map((change) => change.id));
        for (const row of listApprovals(db, hostId)) {
          if (known.has(row.change) || !withdrawApproval(db, hostId, row.change)) continue;
          try {
            options.onMissing?.(hostId, row);
          } catch {
            // the approval has ended either way; a lost card changes nothing else
          }
        }
      }
    }
    return listApprovals(db, hostId);
  };

  const boardOf = async (runtime: ApprovalHost): Promise<Board> => {
    const hostId = runtime.host.id;
    const { tip, changes, whole } = await current(runtime);
    const approvals = new Map(approvalsAt(hostId, changes, whole).map((row) => [row.change, row]));
    const entries = new Map<string, BoardEntry>();
    if (changes === null) return { tip, changes, entries };
    const builds = latestBuilds(db, hostId);
    const prs = new Map(latestPullRequests(db, hostId).map((pr) => [pr.change, pr]));
    const decisions = parkDecisions(db, hostId);
    const questions = openIrreversibleQuestions(db, hostId);
    const heldByDrafts = options.draftsHeld?.(hostId) ?? new Set<string>();
    for (const change of changes) {
      if (change.archived) continue;
      const approval = approvalStateOf(approvals.get(change.id), change);
      const onRunway = approval.state === 'on-runway';
      const { status, notReadyReason } = deriveChangeStatus(change, onRunway ? 'on-runway' : null);
      const pr = prs.get(change.id);
      let stage: BuildStage | null = null;
      const waitsOn =
        status === 'on-runway' || status === 'ready' ? unbuiltDependencies(change, changes) : [];
      if (status === 'on-runway' || status === 'ready') {
        stage = onRunway
          ? buildStage({
              latest: builds.get(change.id),
              pr: pr === undefined ? undefined : { prUrl: pr.prUrl, prState: pr.prState },
              decision: decisions.get(change.id),
              questions: questions.get(change.id),
              waitsOn,
            })
          : waitsOn.length > 0
            ? { kind: 'waits', on: waitsOn }
            : null;
      }
      entries.set(change.id, {
        status,
        notReadyReason,
        approval,
        stage,
        canBuild: onRunway && canBuildNow(stage) && !heldByDrafts.has(change.id),
        builtBy: status !== 'built' ? null : change.merged === true ? 'merged' : 'tasks',
        pr: pr === undefined ? null : { url: pr.prUrl, state: pr.prState },
        waitsOn,
      });
    }
    return { tip, changes, entries };
  };

  const readyNow = (change: ChangeFacts | null | undefined, hostId: string): string | null => {
    if (change === undefined || change === null) return 'not-found';
    const approved = getApproval(db, hostId, change.id) !== undefined;
    const { status } = deriveChangeStatus(change, approved ? 'on-runway' : null);
    if (status === 'ready') return null;
    return status;
  };

  const views: ApprovalViews = {
    board: boardOf,

    async states(runtime) {
      const { entries } = await boardOf(runtime);
      return new Map([...entries].map(([id, entry]) => [id, entry.approval]));
    },

    async state(runtime, changeId) {
      const { changes, entries } = await boardOf(runtime);
      const entry = entries.get(changeId);
      if (entry !== undefined) {
        if (entry.approval.state !== 'on-runway') return entry.approval;
        return { ...entry.approval, stage: entry.stage, waitsOn: entry.waitsOn };
      }
      const change = changes === null ? null : findChange(changes, changeId);
      return approvalStateOf(getApproval(db, runtime.host.id, changeId), change);
    },

    async runway(runtime) {
      const { tip, changes, entries } = await boardOf(runtime);
      const heldByDrafts = options.draftsHeld?.(runtime.host.id) ?? new Set<string>();
      return computeRunway(
        listApprovals(db, runtime.host.id),
        changes,
        tip,
        (id) => entries.get(id)?.stage ?? null,
        (id) => heldByDrafts.has(id),
      );
    },

    async approve(runtime, changeId) {
      const { tip, changes } = await current(runtime);
      const change = changes === null ? undefined : findChange(changes, changeId);
      if (change === undefined || change === null) {
        return { ok: false, status: 404, error: `There is no change ${changeId}.` };
      }
      if (getApproval(db, runtime.host.id, changeId) !== undefined) {
        return { ok: true, approved: false };
      }
      const why = readyNow(change, runtime.host.id);
      if (why !== null) {
        return {
          ok: false,
          status: 409,
          error:
            why === 'built'
              ? `${changeId} is already built.`
              : why === 'owner-steps'
                ? `${changeId} has only owner steps left: there is nothing to build.`
                : why === 'unreadable'
                  ? `${changeId}'s planning files cannot be read.`
                  : `${changeId} is not ready to approve: it needs a proposal and at least one task.`,
        };
      }
      return {
        ok: true,
        approved: approveChange(db, { hostId: runtime.host.id, change: changeId, baseCommit: tip }),
      };
    },

    async approveAll(runtime) {
      const { tip, changes } = await current(runtime);
      const approved: string[] = [];
      for (const change of changes ?? []) {
        if (change.archived || readyNow(change, runtime.host.id) !== null) continue;
        if (approveChange(db, { hostId: runtime.host.id, change: change.id, baseCommit: tip })) {
          approved.push(change.id);
        }
      }
      return approved;
    },

    withdraw(runtime, changeId) {
      return withdrawApproval(db, runtime.host.id, changeId);
    },

    async retry(runtime, changeId) {
      const latest = latestBuilds(db, runtime.host.id).get(changeId);
      return retryParked(db, {
        hostId: runtime.host.id,
        change: changeId,
        note: `This change parked in an earlier run: ${latest?.reason ?? 'no reason was recorded.'}`,
      });
    },

    merged(hostId) {
      const skip = uncovered.get(hostId) ?? new Set<string>();
      return new Set([...mergedChanges(db, hostId)].filter((change) => !skip.has(change)));
    },
  };
  return views;
}

// Approvals and the runway for the console, the watcher and the orchestrator (approvals; runway:
// Runway is the approved work not yet built).
//
// Approvals live in Counterpoint's store; whether an approved change is on the runway is derived
// at read time from the planning snapshot at the base-branch tip (src/core/runway/runway.ts). An
// approval ends when its change is built: reading the runway drops those rows.
//
// Approve takes effect at once, with no terminal step: it is allowed only on a Ready to approve
// change (readable, not built, a proposal and at least one task, not approved yet) at the tip now,
// and records that tip as the commit it was given at. Withdraw takes a change off the runway.
import type { ChangeFacts, FrameworkAdapter, GitFileReader } from '../core/framework/port.ts';
import { findChange } from '../core/framework/port.ts';
import {
  type ApprovalState,
  approvalStateOf,
  computeRunway,
  endedApprovals,
  type Runway,
} from '../core/runway/runway.ts';
import { deriveChangeStatus } from '../core/runway/status.ts';
import {
  approveChange,
  getApproval,
  listApprovals,
  withdrawApproval,
} from '../core/store/approvals.ts';
import type { Store } from '../core/store/db.ts';
import type { HostView } from './hosts.ts';

/** What the views need of a host: its runtime (the console's) or the orchestrator's view of it. */
export interface ApprovalHost {
  host: { id: string; baseBranch: string };
  reader: GitFileReader;
  adapter: FrameworkAdapter | null;
  /** The host runtime's cached view at the tip, when there is one. */
  view?: () => Promise<HostView>;
}

export type ApproveResult =
  | { ok: true; approved: boolean }
  | { ok: false; status: 404 | 409; error: string };

export interface ApprovalViews {
  /** The approval state of every change at the tip now, by change id. */
  states(runtime: ApprovalHost): Promise<Map<string, ApprovalState>>;
  /** The state of one change's approval at the tip now. */
  state(runtime: ApprovalHost, changeId: string): Promise<ApprovalState>;
  /** The runway at the tip now. */
  runway(runtime: ApprovalHost): Promise<Runway>;
  /** Approves a Ready to approve change. */
  approve(runtime: ApprovalHost, changeId: string): Promise<ApproveResult>;
  /** Approves every Ready to approve change; returns the ones it approved. */
  approveAll(runtime: ApprovalHost): Promise<string[]>;
  /** Takes a change off the runway. False when it was not approved. */
  withdraw(runtime: ApprovalHost, changeId: string): boolean;
}

async function current(
  runtime: ApprovalHost,
): Promise<{ tip: string | null; changes: ChangeFacts[] | null }> {
  if (runtime.view !== undefined) {
    const view = await runtime.view();
    return { tip: view.tip, changes: view.snapshot?.changes ?? null };
  }
  const tip = await runtime.reader.resolve(`refs/heads/${runtime.host.baseBranch}`);
  if (tip === null || runtime.adapter === null) return { tip, changes: null };
  return { tip, changes: (await runtime.adapter.snapshot(runtime.reader, tip)).changes };
}

export function createApprovalViews(options: { store: Store }): ApprovalViews {
  const db = options.store;

  /** The host's approvals, with those of built changes ended first. */
  const approvalsAt = (hostId: string, changes: readonly ChangeFacts[] | null) => {
    if (changes !== null) {
      for (const change of endedApprovals(listApprovals(db, hostId), changes)) {
        withdrawApproval(db, hostId, change);
      }
    }
    return listApprovals(db, hostId);
  };

  const readyNow = (change: ChangeFacts | null | undefined, hostId: string): string | null => {
    if (change === undefined || change === null) return 'not-found';
    const approved = getApproval(db, hostId, change.id) !== undefined;
    const { status } = deriveChangeStatus(change, approved ? 'on-runway' : null);
    if (status === 'ready') return null;
    return status;
  };

  const views: ApprovalViews = {
    async states(runtime) {
      const { changes } = await current(runtime);
      const approvals = new Map(
        approvalsAt(runtime.host.id, changes).map((row) => [row.change, row]),
      );
      const states = new Map<string, ApprovalState>();
      for (const change of changes ?? []) {
        if (change.archived) continue;
        states.set(change.id, approvalStateOf(approvals.get(change.id), change));
      }
      return states;
    },

    async state(runtime, changeId) {
      const { changes } = await current(runtime);
      const approvals = approvalsAt(runtime.host.id, changes);
      const change = changes === null ? null : findChange(changes, changeId);
      return approvalStateOf(
        approvals.find((row) => row.change === changeId),
        change,
      );
    },

    async runway(runtime) {
      const { tip, changes } = await current(runtime);
      return computeRunway(approvalsAt(runtime.host.id, changes), changes, tip);
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
  };
  return views;
}

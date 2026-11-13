// GET /api/hosts/:hostId/changes and /api/hosts/:hostId/changes/:changeId (host-planning: Change
// statuses; Change detail).
//
// Facts come from the host's framework adapter at the base branch tip (through the host runtime),
// already in build order (dependencies first, then archived changes newest first); status and owner
// steps are derived here by core (src/core/runway/status.ts). Ids are checked against the strict id
// rules before any lookup (no path or option injection).
//
// The tip is the base as the resolver reads it: the remote base as last fetched, or the local
// branch of a host with no remote. `base` says which, when it was fetched, the latest fetch's error
// and how many local commits are not on the remote (host-planning: Base branch read from the
// remote).
//
// Approvals come from Counterpoint's store (src/server/approval-views.ts): a change the owner
// approved shows On runway while it is readable and not built.
import { basename } from 'node:path';
import type { Hono } from 'hono';
import { type ChangeFacts, findChange } from '../../core/framework/port.ts';
import type { BaseFetchState } from '../../core/git/base-fetch.ts';
import { HOST_ID_RE, isChangeId } from '../../core/ids.ts';
import type { ApprovalState } from '../../core/runway/runway.ts';
import { deriveChangeStatus, ownerSteps } from '../../core/runway/status.ts';
import type { ApprovalViews } from '../approval-views.ts';
import type { HostRuntime, HostRuntimes, HostView } from '../hosts.ts';

export interface ChangeRoutesOptions {
  runtimes: HostRuntimes;
  /** Approval views; without them no approval is shown and no overlay applied. */
  approvals?: ApprovalViews;
  /** The base fetcher's state for a host; without it nothing is said about fetching. */
  baseFetch?: (hostId: string) => BaseFetchState | null;
  /** Changes whose design drafts were started, and which screens still wait (design-drafts D-12). */
  draftHolds?: (hostId: string) => ReadonlyMap<string, DraftHold>;
}

/** A change's design drafts as listings show them. */
export interface DraftHold {
  held: boolean;
  waiting: string[];
}

/** Which base the view was read from, and how its fetch went. */
function baseFacts(view: HostView, fetched: BaseFetchState | null) {
  return {
    ref: view.base.label,
    remote: view.base.remote,
    localOnly: view.base.localOnly,
    fetchedAt: fetched?.fetchedAt ?? null,
    error: fetched?.error ?? null,
    failedAt: fetched?.failedAt ?? null,
    localAhead: view.base.localOnly ? 0 : (fetched?.localAhead ?? 0),
  };
}

/** Approval states by change id; an empty map when they cannot be computed. */
async function approvalStates(
  approvals: ApprovalViews | undefined,
  runtime: HostRuntime,
): Promise<Map<string, ApprovalState>> {
  if (approvals === undefined) return new Map();
  try {
    return await approvals.states(runtime);
  } catch {
    return new Map();
  }
}

function changeRow(
  change: ChangeFacts,
  approval: ApprovalState | undefined,
  merged: ReadonlySet<string>,
  hold: DraftHold | undefined,
) {
  // An archived change is done; an approval of the same name belongs to the active one, if any.
  const own = change.archived ? undefined : approval;
  const onRunway = own?.state === 'on-runway' ? own : null;
  const { status, notReadyReason } = deriveChangeStatus(
    { ...change, merged: !change.archived && merged.has(change.id) },
    onRunway === null ? null : 'on-runway',
  );
  return {
    id: change.id,
    title: change.title,
    archived: change.archived,
    archivedOn: change.archivedOn,
    created: change.created,
    dependsOn: change.dependsOn,
    status,
    notReadyReason,
    artifacts: change.artifacts,
    tasks: { total: change.tasks.total, done: change.tasks.done },
    ownerStepCount: ownerSteps(change).length,
    unreadable: change.unreadable,
    approval: onRunway === null ? null : { state: 'on-runway', approvedAt: onRunway.approvedAt },
    // Waiting for sign-off (D-12): drafts were started and a screen is not signed off and landed.
    drafts: change.archived || hold === undefined ? null : hold,
  };
}

export function mountChangeRoutes(app: Hono, options: ChangeRoutesOptions): void {
  const { runtimes, approvals } = options;
  const fetchState = (hostId: string) => options.baseFetch?.(hostId) ?? null;
  const holds = (hostId: string) => options.draftHolds?.(hostId) ?? new Map<string, DraftHold>();

  app.get('/api/hosts/:hostId/changes', async (c) => {
    const hostId = c.req.param('hostId');
    if (!HOST_ID_RE.test(hostId)) return c.json({ error: 'invalid host id' }, 400);
    const runtime = runtimes.get(hostId);
    if (runtime === null) return c.json({ error: 'not found' }, 404);

    const view = await runtime.view();
    const changes = view.snapshot?.changes ?? [];
    const states = await approvalStates(approvals, runtime);
    const merged = approvals?.merged(runtime.host.id) ?? new Set<string>();
    return c.json({
      hostId,
      hostName: basename(runtime.host.root),
      baseBranch: runtime.host.baseBranch,
      tip: view.tip,
      base: baseFacts(view, fetchState(hostId)),
      unreadable: view.snapshot?.unreadable ?? null,
      changes: changes.map((change) =>
        changeRow(change, states.get(change.id), merged, holds(hostId).get(change.id)),
      ),
    });
  });

  app.get('/api/hosts/:hostId/changes/:changeId', async (c) => {
    const hostId = c.req.param('hostId');
    const changeId = c.req.param('changeId');
    if (!HOST_ID_RE.test(hostId)) return c.json({ error: 'invalid host id' }, 400);
    if (!isChangeId(changeId)) return c.json({ error: 'invalid change id' }, 400);
    const runtime = runtimes.get(hostId);
    if (runtime === null) return c.json({ error: 'not found' }, 404);

    const view = await runtime.view();
    const change = view.snapshot ? findChange(view.snapshot.changes, changeId) : undefined;
    if (change === undefined || view.tip === null || runtime.adapter === null) {
      return c.json({ error: 'not found' }, 404);
    }
    const states = await approvalStates(approvals, runtime);
    const merged = approvals?.merged(runtime.host.id) ?? new Set<string>();
    return c.json({
      hostId,
      hostName: basename(runtime.host.root),
      baseBranch: runtime.host.baseBranch,
      tip: view.tip,
      ...changeRow(change, states.get(change.id), merged, holds(hostId).get(change.id)),
      why: change.why,
      ownerSteps: ownerSteps(change),
    });
  });
}

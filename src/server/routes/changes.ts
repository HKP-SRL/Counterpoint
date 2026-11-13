// GET /api/hosts/:hostId/changes and /api/hosts/:hostId/changes/:changeId (host-planning: Change
// statuses; Change detail).
//
// Facts come from the host's framework adapter at the base branch tip (through the host runtime),
// already in build order (dependencies first, then archived changes newest first); status and owner
// steps are derived here by core (src/core/runway/status.ts). Ids are checked against the strict id
// rules before any lookup (no path or option injection).
//
// Approvals come from Counterpoint's store (src/server/approval-views.ts): a change the owner
// approved shows On runway while it is readable and not built.
import { basename } from 'node:path';
import type { Hono } from 'hono';
import { type ChangeFacts, findChange } from '../../core/framework/port.ts';
import { HOST_ID_RE, isChangeId } from '../../core/ids.ts';
import type { ApprovalState } from '../../core/runway/runway.ts';
import { deriveChangeStatus, ownerSteps } from '../../core/runway/status.ts';
import type { ApprovalViews } from '../approval-views.ts';
import type { HostRuntime, HostRuntimes } from '../hosts.ts';

export interface ChangeRoutesOptions {
  runtimes: HostRuntimes;
  /** Approval views; without them no approval is shown and no overlay applied. */
  approvals?: ApprovalViews;
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

function changeRow(change: ChangeFacts, approval: ApprovalState | undefined) {
  // An archived change is done; an approval of the same name belongs to the active one, if any.
  const own = change.archived ? undefined : approval;
  const onRunway = own?.state === 'on-runway' ? own : null;
  const { status, notReadyReason } = deriveChangeStatus(
    change,
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
  };
}

export function mountChangeRoutes(app: Hono, options: ChangeRoutesOptions): void {
  const { runtimes, approvals } = options;

  app.get('/api/hosts/:hostId/changes', async (c) => {
    const hostId = c.req.param('hostId');
    if (!HOST_ID_RE.test(hostId)) return c.json({ error: 'invalid host id' }, 400);
    const runtime = runtimes.get(hostId);
    if (runtime === null) return c.json({ error: 'not found' }, 404);

    const view = await runtime.view();
    const changes = view.snapshot?.changes ?? [];
    const states = await approvalStates(approvals, runtime);
    return c.json({
      hostId,
      hostName: basename(runtime.host.root),
      baseBranch: runtime.host.baseBranch,
      tip: view.tip,
      unreadable: view.snapshot?.unreadable ?? null,
      changes: changes.map((change) => changeRow(change, states.get(change.id))),
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
    return c.json({
      hostId,
      hostName: basename(runtime.host.root),
      baseBranch: runtime.host.baseBranch,
      tip: view.tip,
      ...changeRow(change, states.get(change.id)),
      why: change.why,
      ownerSteps: ownerSteps(change),
    });
  });
}

// GET /api/hosts/:hostId/changes and /api/hosts/:hostId/changes/:changeId (host-planning: Change
// detail).
//
// Facts come from the host's framework adapter at the base branch tip (through the host runtime),
// already in build order (dependencies first, then archived changes newest first); status and owner
// steps are derived here by core (src/core/runway/status.ts). Ids are checked against the strict id
// rules before any lookup (no path or option injection). Input bytes never leave the server: only
// their `sha256:` digests do.
//
// Approval overlay (host-planning: Change statuses): each row's approval state comes from the
// approval views (verified from git at the base tip, src/server/approval-views.ts). `on-runway` /
// `changed` become the status overlay; an `invalid` approval keeps the base status and is reported
// as invalid with its reason (fail closed). No stored row ever decides a status.
//
// Approved rows also carry `uncommittedEdits` (runway: Uncommitted edits do not change the
// runway): true when the owner's checkout has
// uncommitted edits that change one of the change's inputs. It is a soft hint only.
import { basename } from 'node:path';
import type { Hono } from 'hono';
import { sha256Digest } from '../../core/approvals/digest.ts';
import { type ChangeFacts, ChangeNotFoundError, findChange } from '../../core/framework/port.ts';
import { UnsafeTreeEntryError } from '../../core/git/reader.ts';
import { HOST_ID_RE, isChangeId } from '../../core/ids.ts';
import { uncommittedEditsHint } from '../../core/runway/needs-you.ts';
import type { ApprovalState } from '../../core/runway/runway.ts';
import { deriveChangeStatus, ownerSteps } from '../../core/runway/status.ts';
import type { ApprovalViews } from '../approval-views.ts';
import type { HostRuntime, HostRuntimes } from '../hosts.ts';

export interface ChangeRoutesOptions {
  runtimes: HostRuntimes;
  /** Approval views; without them no approval is shown and no overlay applied. */
  approvals?: ApprovalViews;
}

type ApprovalFacts =
  | { state: 'on-runway' | 'changed'; signedAt: string; commit: string }
  | { state: 'invalid'; reason: string };

function approvalFacts(state: ApprovalState | undefined): ApprovalFacts | null {
  if (state === undefined) return null;
  switch (state.state) {
    case 'on-runway':
    case 'changed':
      return { state: state.state, signedAt: state.signedAt, commit: state.commit };
    case 'invalid':
      return { state: 'invalid', reason: state.reason };
    case 'none':
      return null;
  }
}

/** Approval states at `tip` by change id; an empty map when they cannot be computed. */
async function approvalStates(
  approvals: ApprovalViews | undefined,
  runtime: HostRuntime,
  tip: string | null,
): Promise<Map<string, ApprovalState>> {
  if (approvals === undefined || tip === null) return new Map();
  try {
    return await approvals.states(runtime, tip);
  } catch {
    return new Map();
  }
}

const INPUTS_UNREADABLE = "Couldn't read this change's files.";

/**
 * Approved changes (on the runway or changed) whose files have uncommitted edits in the owner's
 * checkout that change an input (a soft hint only). The approval itself is unaffected; a failed
 * check simply shows no hint.
 */
async function uncommittedEdits(
  runtime: HostRuntime,
  states: Map<string, ApprovalState>,
): Promise<Set<string>> {
  const flagged = new Set<string>();
  const { adapter } = runtime;
  if (adapter === null) return flagged;
  for (const [changeId, state] of states) {
    if (state.state !== 'on-runway' && state.state !== 'changed') continue;
    const edited = await uncommittedEditsHint({
      root: runtime.host.root,
      reader: runtime.reader,
      adapter,
      changeId,
    }).catch(() => false);
    if (edited) flagged.add(changeId);
  }
  return flagged;
}

function changeRow(
  change: ChangeFacts,
  approval: ApprovalState | undefined,
  edited: ReadonlySet<string> = new Set(),
) {
  // An archived change is done; an approval of the same name belongs to the active one, if any.
  const own = change.archived ? undefined : approval;
  const overlay = own?.state === 'on-runway' || own?.state === 'changed' ? own.state : null;
  const { status, notReadyReason } = deriveChangeStatus(change, overlay);
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
    approval: approvalFacts(own),
    uncommittedEdits: overlay !== null && edited.has(change.id),
  };
}

function inputsErrorText(error: unknown): string {
  if (error instanceof UnsafeTreeEntryError || error instanceof ChangeNotFoundError) {
    return error.message;
  }
  return INPUTS_UNREADABLE;
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
    const states = await approvalStates(approvals, runtime, view.tip);
    const edited = await uncommittedEdits(runtime, states);
    return c.json({
      hostId,
      hostName: basename(runtime.host.root),
      baseBranch: runtime.host.baseBranch,
      tip: view.tip,
      unreadable: view.snapshot?.unreadable ?? null,
      changes: changes.map((change) => changeRow(change, states.get(change.id), edited)),
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

    const states = await approvalStates(approvals, runtime, view.tip);
    const own = states.get(change.id);
    const onlyChange = new Map<string, ApprovalState>(
      own === undefined || change.archived ? [] : [[change.id, own]],
    );
    let inputs: {
      path: string;
      label: string;
      kind: string;
      normalization: string | null;
      digest: string;
    }[] = [];
    let inputsError: string | undefined;
    try {
      const raw = await runtime.adapter.approvalInputs(runtime.reader, view.tip, changeId);
      inputs = raw
        .map((input) => ({
          path: input.path,
          label: input.label,
          kind: input.kind,
          normalization: input.normalization,
          digest: sha256Digest(input.bytes),
        }))
        // Byte order of the path, as the approval statement lists them.
        .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
    } catch (error) {
      inputsError = inputsErrorText(error);
    }

    return c.json({
      hostId,
      hostName: basename(runtime.host.root),
      baseBranch: runtime.host.baseBranch,
      tip: view.tip,
      ...changeRow(change, own, await uncommittedEdits(runtime, onlyChange)),
      why: change.why,
      ownerSteps: ownerSteps(change),
      inputs,
      ...(inputsError === undefined ? {} : { inputsError }),
    });
  });
}

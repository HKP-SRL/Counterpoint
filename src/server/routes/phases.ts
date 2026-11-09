// GET /api/hosts/:hostId/phases and /api/hosts/:hostId/phases/:phaseId (ADPT-01, D-01, D-02).
//
// Facts come from the host's framework adapter at the base branch tip (through the host runtime);
// status and prerequisites are derived here by core (src/core/runway/status.ts). Ids are checked
// against the strict id rules before any lookup (T-01-41). Input bytes never leave the server:
// only their `sha256:` digests do.
//
// Approval overlay (APPR-02): each row's approval state comes from the approval views (verified
// from git at the base tip, src/server/approval-views.ts). `on-runway` / `changed` become the
// status overlay; an `invalid` approval keeps the base status and is reported as invalid with its
// reason (fail closed). No stored row ever decides a status.
//
// Approved rows also carry `uncommittedEdits` (D-03): true when the owner's checkout has
// uncommitted edits that change one of the phase's inputs. It is a soft hint only.
import { basename } from 'node:path';
import type { Hono } from 'hono';
import { sha256Digest } from '../../core/approvals/digest.ts';
import {
  comparePhaseNumbers,
  type PhaseFacts,
  PhaseNotFoundError,
} from '../../core/framework/port.ts';
import { UnsafeTreeEntryError } from '../../core/git/reader.ts';
import { HOST_ID_RE, PHASE_ID_RE } from '../../core/ids.ts';
import { uncommittedEditsHint } from '../../core/runway/needs-you.ts';
import type { ApprovalState } from '../../core/runway/runway.ts';
import { derivePhaseStatus, phasePrerequisites } from '../../core/runway/status.ts';
import type { ApprovalViews } from '../approval-views.ts';
import type { HostRuntime, HostRuntimes } from '../hosts.ts';

export interface PhaseRoutesOptions {
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

/** Approval states at `tip` by phase id; an empty map when they cannot be computed. */
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

const INPUTS_UNREADABLE = "Couldn't read this phase's inputs.";

/**
 * Approved phases (on the runway or changed) whose files have uncommitted edits in the owner's
 * checkout that change an input (D-03 soft hint). The approval itself is unaffected; a failed
 * check simply shows no hint.
 */
async function uncommittedEdits(
  runtime: HostRuntime,
  states: Map<string, ApprovalState>,
): Promise<Set<string>> {
  const flagged = new Set<string>();
  const { adapter } = runtime;
  if (adapter === null) return flagged;
  for (const [phaseId, state] of states) {
    if (state.state !== 'on-runway' && state.state !== 'changed') continue;
    const edited = await uncommittedEditsHint({
      root: runtime.host.root,
      reader: runtime.reader,
      adapter,
      phaseId,
    }).catch(() => false);
    if (edited) flagged.add(phaseId);
  }
  return flagged;
}

function phaseRow(
  phase: PhaseFacts,
  approval: ApprovalState | undefined,
  edited: ReadonlySet<string> = new Set(),
) {
  const overlay =
    approval?.state === 'on-runway' || approval?.state === 'changed' ? approval.state : null;
  const { status, notReadyReason } = derivePhaseStatus(phase, overlay);
  const prerequisites = phasePrerequisites(phase);
  return {
    id: phase.id,
    number: phase.number,
    name: phase.name,
    status,
    notReadyReason,
    planCount: prerequisites.total,
    nonAutonomousCount: prerequisites.nonAutonomous,
    userSetup: prerequisites.userSetup.map((item) => ({ service: item.service, why: item.why })),
    unreadable: phase.unreadable,
    approval: approvalFacts(approval),
    uncommittedEdits: overlay !== null && edited.has(phase.id),
  };
}

function inputsErrorText(error: unknown): string {
  if (error instanceof UnsafeTreeEntryError || error instanceof PhaseNotFoundError) {
    return error.message;
  }
  return INPUTS_UNREADABLE;
}

export function mountPhaseRoutes(app: Hono, options: PhaseRoutesOptions): void {
  const { runtimes, approvals } = options;

  app.get('/api/hosts/:hostId/phases', async (c) => {
    const hostId = c.req.param('hostId');
    if (!HOST_ID_RE.test(hostId)) return c.json({ error: 'invalid host id' }, 400);
    const runtime = runtimes.get(hostId);
    if (runtime === null) return c.json({ error: 'not found' }, 404);

    const view = await runtime.view();
    const phases = [...(view.snapshot?.phases ?? [])].sort((a, b) =>
      comparePhaseNumbers(a.number, b.number),
    );
    const states = await approvalStates(approvals, runtime, view.tip);
    const edited = await uncommittedEdits(runtime, states);
    return c.json({
      hostId,
      hostName: basename(runtime.host.root),
      baseBranch: runtime.host.baseBranch,
      tip: view.tip,
      unreadable: view.snapshot?.unreadable ?? null,
      phases: phases.map((phase) => phaseRow(phase, states.get(phase.id), edited)),
    });
  });

  app.get('/api/hosts/:hostId/phases/:phaseId', async (c) => {
    const hostId = c.req.param('hostId');
    const phaseId = c.req.param('phaseId');
    if (!HOST_ID_RE.test(hostId)) return c.json({ error: 'invalid host id' }, 400);
    if (!PHASE_ID_RE.test(phaseId)) return c.json({ error: 'invalid phase id' }, 400);
    const runtime = runtimes.get(hostId);
    if (runtime === null) return c.json({ error: 'not found' }, 404);

    const view = await runtime.view();
    const phase = view.snapshot?.phases.find((candidate) => candidate.id === phaseId);
    if (phase === undefined || view.tip === null || runtime.adapter === null) {
      return c.json({ error: 'not found' }, 404);
    }

    const states = await approvalStates(approvals, runtime, view.tip);
    const own = states.get(phase.id);
    const onlyPhase = new Map<string, ApprovalState>(own === undefined ? [] : [[phase.id, own]]);
    let inputs: {
      path: string;
      label: string;
      kind: string;
      normalization: string | null;
      digest: string;
    }[] = [];
    let inputsError: string | undefined;
    try {
      const raw = await runtime.adapter.approvalInputs(runtime.reader, view.tip, phaseId);
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
      ...phaseRow(phase, states.get(phase.id), await uncommittedEdits(runtime, onlyPhase)),
      goal: phase.goal,
      dependsOn: phase.dependsOn,
      requirements: phase.requirements,
      plans: phase.plans.map((plan) => ({
        id: plan.id,
        wave: plan.wave,
        objective: plan.objective,
        autonomous: plan.autonomous,
        filesCount: plan.filesModified.length,
      })),
      inputs,
      ...(inputsError === undefined ? {} : { inputsError }),
    });
  });
}

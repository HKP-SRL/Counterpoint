// GET /api/hosts/:hostId/phases and /api/hosts/:hostId/phases/:phaseId (ADPT-01, D-01, D-02).
//
// Facts come from the host's framework adapter at the base branch tip (through the host runtime);
// status and prerequisites are derived here by core (src/core/runway/status.ts). Ids are checked
// against the strict id rules before any lookup (T-01-41). Input bytes never leave the server:
// only their `sha256:` digests do.
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
import { derivePhaseStatus, phasePrerequisites } from '../../core/runway/status.ts';
import type { HostRuntimes } from '../hosts.ts';

export interface PhaseRoutesOptions {
  runtimes: HostRuntimes;
}

const INPUTS_UNREADABLE = "Couldn't read this phase's inputs.";

function phaseRow(phase: PhaseFacts) {
  const { status, notReadyReason } = derivePhaseStatus(phase);
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
  };
}

function inputsErrorText(error: unknown): string {
  if (error instanceof UnsafeTreeEntryError || error instanceof PhaseNotFoundError) {
    return error.message;
  }
  return INPUTS_UNREADABLE;
}

export function mountPhaseRoutes(app: Hono, options: PhaseRoutesOptions): void {
  const { runtimes } = options;

  app.get('/api/hosts/:hostId/phases', async (c) => {
    const hostId = c.req.param('hostId');
    if (!HOST_ID_RE.test(hostId)) return c.json({ error: 'invalid host id' }, 400);
    const runtime = runtimes.get(hostId);
    if (runtime === null) return c.json({ error: 'not found' }, 404);

    const view = await runtime.view();
    const phases = [...(view.snapshot?.phases ?? [])].sort((a, b) =>
      comparePhaseNumbers(a.number, b.number),
    );
    return c.json({
      hostId,
      hostName: basename(runtime.host.root),
      baseBranch: runtime.host.baseBranch,
      tip: view.tip,
      unreadable: view.snapshot?.unreadable ?? null,
      phases: phases.map(phaseRow),
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
      ...phaseRow(phase),
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

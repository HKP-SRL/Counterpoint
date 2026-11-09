// Approval preparation: recompute the statement at the base tip and say exactly what a signature
// would bind (RESEARCH Pattern 4, recompute-and-print).
//
// The tip is the LOCAL `refs/heads/{base}` (D-03): the owner pushes when ready. The phase must be
// Ready to approve (D-01: context and at least one plan, not built, readable). Inputs come from
// the framework adapter the caller passes in (core never names an adapter), the gates slot from
// the host config at the same tip. Nothing here writes anything; the same tip always gives
// byte-identical statement bytes.
import {
  type FrameworkAdapter,
  type GitFileReader,
  PhaseNotFoundError,
} from '../framework/port.ts';
import { UnsafeTreeEntryError } from '../git/reader.ts';
import { approvalItemId, assertHostId, assertPhaseId } from '../ids.ts';
import {
  derivePhaseStatus,
  type PhasePrerequisites,
  phasePrerequisites,
} from '../runway/status.ts';
import { BRANCH_RE } from './commit.ts';
import { GatesConfigError, gatesDigest } from './gates.ts';
import {
  type ApprovalStatement,
  approvalPath,
  buildStatement,
  serializeStatement,
  statementFingerprint,
} from './statement.ts';

export type PrepareRefusal =
  | { ok: false; reason: 'no-base' | 'not-found' | 'built' }
  | { ok: false; reason: 'not-ready'; notReadyReason: 'no-context' | 'no-plans' }
  | { ok: false; reason: 'unreadable'; file: string; detail: string }
  | { ok: false; reason: 'gates-config'; detail: string };

export interface PreparedInput {
  path: string;
  label: string;
  kind: string;
  digest: string;
  normalization: string | null;
}

export interface PreparedApproval {
  ok: true;
  statement: ApprovalStatement;
  /** The exact file bytes that will be committed and signed. */
  bytes: Uint8Array;
  /** First 12 hex of sha256(canonical statement). */
  fingerprint: string;
  /** `phase-{NN}`. */
  itemId: string;
  /** `.counterpoint/approvals/phase-{NN}.json`. */
  itemPath: string;
  tip: string;
  phase: { id: string; name: string; planCount: number };
  prerequisites: PhasePrerequisites;
  /** Inputs in statement order, with their display labels. */
  inputs: PreparedInput[];
}

export async function prepareApproval(options: {
  hostId: string;
  baseBranch: string;
  phaseId: string;
  reader: GitFileReader;
  adapter: FrameworkAdapter;
}): Promise<PreparedApproval | PrepareRefusal> {
  const hostId = assertHostId(options.hostId);
  const phaseId = assertPhaseId(options.phaseId);
  const { reader, adapter, baseBranch } = options;
  if (!BRANCH_RE.test(baseBranch)) return { ok: false, reason: 'no-base' };

  const tip = await reader.resolve(`refs/heads/${baseBranch}`);
  if (tip === null) return { ok: false, reason: 'no-base' };

  const snapshot = await adapter.snapshot(reader, tip);
  const phase = snapshot.phases.find((p) => p.id === phaseId);
  if (!phase) {
    if (snapshot.unreadable !== null) {
      return {
        ok: false,
        reason: 'unreadable',
        file: snapshot.unreadable.file,
        detail: snapshot.unreadable.reason,
      };
    }
    return { ok: false, reason: 'not-found' };
  }

  const status = derivePhaseStatus(phase);
  if (status.status === 'unreadable' && phase.unreadable !== null) {
    return {
      ok: false,
      reason: 'unreadable',
      file: phase.unreadable.file,
      detail: phase.unreadable.reason,
    };
  }
  if (status.status === 'built') return { ok: false, reason: 'built' };
  if (status.status === 'not-planned') {
    return {
      ok: false,
      reason: 'not-ready',
      notReadyReason: status.notReadyReason ?? 'no-context',
    };
  }

  let inputs: Awaited<ReturnType<FrameworkAdapter['approvalInputs']>>;
  try {
    inputs = await adapter.approvalInputs(reader, tip, phaseId);
  } catch (error) {
    if (error instanceof PhaseNotFoundError) return { ok: false, reason: 'not-found' };
    if (error instanceof UnsafeTreeEntryError) {
      return { ok: false, reason: 'unreadable', file: error.path, detail: error.message };
    }
    throw error;
  }

  let gates: Awaited<ReturnType<typeof gatesDigest>>;
  try {
    gates = await gatesDigest(reader, tip);
  } catch (error) {
    if (error instanceof GatesConfigError || error instanceof UnsafeTreeEntryError) {
      return { ok: false, reason: 'gates-config', detail: error.message };
    }
    throw error;
  }

  const statement = buildStatement({ hostId, phaseId, baseBranch, tip, inputs, gates });
  const byPath = new Map(inputs.map((input) => [input.path, input]));
  return {
    ok: true,
    statement,
    bytes: new TextEncoder().encode(serializeStatement(statement)),
    fingerprint: statementFingerprint(statement),
    itemId: approvalItemId(phaseId),
    itemPath: approvalPath(phaseId),
    tip,
    phase: { id: phase.id, name: phase.name, planCount: phase.plans.length },
    prerequisites: phasePrerequisites(phase),
    inputs: statement.inputs.files.map((file) => {
      const source = byPath.get(file.path);
      return {
        path: file.path,
        label: source?.label ?? file.path,
        kind: file.kind,
        digest: file.digest,
        normalization: file.normalization ?? null,
      };
    }),
  };
}

// Approval preparation: recompute the statement at the base tip and say exactly what a signature
// would bind (signed-approvals: Console prepares, terminal signs): recompute, then print.
//
// The tip is the LOCAL `refs/heads/{base}` (host-planning: Committed content only): the owner
// pushes when ready. The change must be Ready to approve (openspec-host-adapter design decision 5:
// a proposal and at least one task, not built, readable). Inputs come from the framework adapter
// the caller passes in (core never names an adapter), the gates slot from the host config at the
// same tip. Nothing here writes anything; the same tip always gives byte-identical statement bytes.
import {
  ChangeNotFoundError,
  type FrameworkAdapter,
  findChange,
  type GitFileReader,
} from '../framework/port.ts';
import { UnsafeTreeEntryError } from '../git/reader.ts';
import { approvalItemId, assertChangeId, assertHostId } from '../ids.ts';
import { deriveChangeStatus, type NotReadyReason, ownerSteps } from '../runway/status.ts';
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
  | { ok: false; reason: 'not-ready'; notReadyReason: NotReadyReason }
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
  /** The change id (openspec-host-adapter design decision 1). */
  itemId: string;
  /** `.counterpoint/approvals/{change}.json`. */
  itemPath: string;
  tip: string;
  change: { id: string; title: string; taskCount: number };
  /** Unchecked `Owner:` tasks, shown before signing; they never block approval. */
  ownerSteps: string[];
  /** Inputs in statement order, with their display labels. */
  inputs: PreparedInput[];
}

export async function prepareApproval(options: {
  hostId: string;
  baseBranch: string;
  changeId: string;
  reader: GitFileReader;
  adapter: FrameworkAdapter;
}): Promise<PreparedApproval | PrepareRefusal> {
  const hostId = assertHostId(options.hostId);
  const changeId = assertChangeId(options.changeId);
  const { reader, adapter, baseBranch } = options;
  if (!BRANCH_RE.test(baseBranch)) return { ok: false, reason: 'no-base' };

  const tip = await reader.resolve(`refs/heads/${baseBranch}`);
  if (tip === null) return { ok: false, reason: 'no-base' };

  const snapshot = await adapter.snapshot(reader, tip);
  const change = findChange(snapshot.changes, changeId);
  if (!change) {
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

  const status = deriveChangeStatus(change);
  if (status.status === 'unreadable' && change.unreadable !== null) {
    return {
      ok: false,
      reason: 'unreadable',
      file: change.unreadable.file,
      detail: change.unreadable.reason,
    };
  }
  if (status.status === 'built') return { ok: false, reason: 'built' };
  if (status.status === 'not-planned') {
    return {
      ok: false,
      reason: 'not-ready',
      notReadyReason: status.notReadyReason ?? 'no-proposal',
    };
  }

  let inputs: Awaited<ReturnType<FrameworkAdapter['approvalInputs']>>;
  try {
    inputs = await adapter.approvalInputs(reader, tip, changeId);
  } catch (error) {
    if (error instanceof ChangeNotFoundError) return { ok: false, reason: 'not-found' };
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

  const statement = buildStatement({ hostId, changeId, baseBranch, tip, inputs, gates });
  const byPath = new Map(inputs.map((input) => [input.path, input]));
  return {
    ok: true,
    statement,
    bytes: new TextEncoder().encode(serializeStatement(statement)),
    fingerprint: statementFingerprint(statement),
    itemId: approvalItemId(changeId),
    itemPath: approvalPath(changeId),
    tip,
    change: { id: change.id, title: change.title, taskCount: change.tasks.total },
    ownerSteps: ownerSteps(change),
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

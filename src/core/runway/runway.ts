// Approval state and the runway (MISN-01), recomputed from git every time and never stored as a
// flag (RESEARCH verification algorithm, step 5 on top of verifyApprovalCommit's steps 1-4).
//
// An approval is `on-runway` only when its signed commit verifies against the trusted key, its
// statement parses with the strict schema and names this host and this phase, every signed input
// digest equals the digest recomputed at the base tip (no input modified, added or removed), and
// the gate-config slot equals the one recomputed at the tip. Anything else is `changed` (the
// signature is fine but what it covers moved on) or `invalid` (the signature or statement cannot
// be trusted). Reverting an edit returns an item to the runway with no re-sign, because nothing
// here remembers the earlier verdict. Without a trusted key every approval is `invalid`.
//
// The runway is the on-runway approvals of phases that are not built: approved work ahead of the
// builder.
import { GatesConfigError, gatesDigest } from '../approvals/gates.ts';
import {
  APPROVALS_DIR,
  ApprovalStatement,
  type GatesSlot,
  type StatementFile,
  statementFiles,
} from '../approvals/statement.ts';
import type { Trust } from '../approvals/trust-store.ts';
import { type InvalidApprovalReason, verifyApprovalCommit } from '../approvals/verify.ts';
import {
  type ApprovalInput,
  type FrameworkAdapter,
  type GitFileReader,
  PhaseNotFoundError,
} from '../framework/port.ts';
import { approvalItemId, assertHostId, assertPhaseId, isPhaseId } from '../ids.ts';
import { derivePhaseStatus } from './status.ts';

export interface InputChange {
  path: string;
  kind: string;
  change: 'modified' | 'added' | 'removed';
  /** The digest in the signed statement; null for an input added after signing. */
  signedDigest: string | null;
  /** The digest at the base tip now; null for an input removed after signing. */
  nowDigest: string | null;
}

export interface GatesChange {
  /** `unreadable`: the gate config at the tip cannot be parsed (fails closed: off the runway). */
  change: 'added' | 'modified' | 'removed' | 'unreadable';
  signedDigest: string | null;
  nowDigest: string | null;
}

export type ApprovalInvalidReason =
  | InvalidApprovalReason
  | 'no-trusted-key'
  | 'bad-statement'
  | 'host-mismatch'
  | 'item-mismatch';

interface SignedFacts {
  commit: string;
  tip: string;
  signedAt: string;
  statement: ApprovalStatement;
}

export type ApprovalState =
  | { state: 'none'; tip: string | null }
  | { state: 'invalid'; reason: ApprovalInvalidReason; detail?: string; commit?: string }
  | ({ state: 'on-runway' } & SignedFacts)
  | ({
      state: 'changed';
      changes: InputChange[];
      gatesChange: GatesChange | null;
    } & SignedFacts);

function comparePathBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * Compares a signed statement with the inputs and gate slot recomputed now. Changes are sorted
 * by path bytes; `gatesChange` is null when the gate slot is unchanged.
 */
export function compareInputs(
  statement: ApprovalStatement,
  currentInputs: readonly Pick<ApprovalInput, 'path' | 'kind' | 'normalization' | 'bytes'>[],
  currentGates: GatesSlot | 'unreadable',
): { changes: InputChange[]; gatesChange: GatesChange | null } {
  const now = new Map<string, StatementFile>(statementFiles(currentInputs).map((f) => [f.path, f]));
  const signed = new Map<string, StatementFile>(statement.inputs.files.map((f) => [f.path, f]));
  const changes: InputChange[] = [];

  for (const [path, was] of signed) {
    const is = now.get(path);
    if (is === undefined) {
      changes.push({
        path,
        kind: was.kind,
        change: 'removed',
        signedDigest: was.digest,
        nowDigest: null,
      });
    } else if (
      is.digest !== was.digest ||
      is.normalization !== was.normalization ||
      is.kind !== was.kind
    ) {
      changes.push({
        path,
        kind: is.kind,
        change: 'modified',
        signedDigest: was.digest,
        nowDigest: is.digest,
      });
    }
  }
  for (const [path, is] of now) {
    if (!signed.has(path)) {
      changes.push({
        path,
        kind: is.kind,
        change: 'added',
        signedDigest: null,
        nowDigest: is.digest,
      });
    }
  }
  changes.sort((a, b) => comparePathBytes(a.path, b.path));

  const was = statement.gates;
  let gatesChange: GatesChange | null = null;
  if (currentGates === 'unreadable') {
    gatesChange = { change: 'unreadable', signedDigest: was.digest, nowDigest: null };
  } else if (was.state === 'absent' && currentGates.state === 'present') {
    gatesChange = { change: 'added', signedDigest: null, nowDigest: currentGates.digest };
  } else if (was.state === 'present' && currentGates.state === 'absent') {
    gatesChange = { change: 'removed', signedDigest: was.digest, nowDigest: null };
  } else if (
    was.state === 'present' &&
    currentGates.state === 'present' &&
    was.digest !== currentGates.digest
  ) {
    gatesChange = { change: 'modified', signedDigest: was.digest, nowDigest: currentGates.digest };
  }
  return { changes, gatesChange };
}

export interface RunwayOptions {
  hostId: string;
  root: string;
  baseBranch: string;
  reader: GitFileReader;
  adapter: FrameworkAdapter;
  /** The trusted key; null when none is trusted (every approval is then invalid). */
  trust: Pick<Trust, 'allowedSignersPath' | 'fingerprint'> | null;
  /** A private scratch directory for signature files during verification. */
  tmpDir: string;
}

function parseStatement(bytes: Uint8Array): ApprovalStatement | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed = ApprovalStatement.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function currentInputs(
  adapter: FrameworkAdapter,
  reader: GitFileReader,
  tip: string,
  phaseId: string,
): Promise<ApprovalInput[]> {
  try {
    return await adapter.approvalInputs(reader, tip, phaseId);
  } catch (error) {
    // The phase is gone from the planning truth: every signed input counts as removed.
    if (error instanceof PhaseNotFoundError) return [];
    throw error;
  }
}

async function currentGates(reader: GitFileReader, tip: string): Promise<GatesSlot | 'unreadable'> {
  try {
    return await gatesDigest(reader, tip);
  } catch (error) {
    if (error instanceof GatesConfigError) return 'unreadable';
    throw error;
  }
}

/** The state of the approval of `phaseId` at the base tip, recomputed from git. */
export async function approvalState(
  options: RunwayOptions & { phaseId: string },
): Promise<ApprovalState> {
  const hostId = assertHostId(options.hostId);
  const phaseId = assertPhaseId(options.phaseId);
  const itemId = approvalItemId(phaseId);
  const { reader, adapter } = options;

  try {
    if (options.trust === null) {
      const tip = await reader.resolve(`refs/heads/${options.baseBranch}`);
      if (tip === null) return { state: 'none', tip: null };
      const present = await reader.read(tip, `${APPROVALS_DIR}/${itemId}.json`).then(
        (bytes) => bytes !== null,
        () => true,
      );
      return present
        ? { state: 'invalid', reason: 'no-trusted-key', detail: 'No approval key is trusted yet.' }
        : { state: 'none', tip };
    }

    const verified = await verifyApprovalCommit({
      root: options.root,
      baseBranch: options.baseBranch,
      itemId,
      trust: options.trust,
      tmpDir: options.tmpDir,
    });
    if (verified.state !== 'signed') return verified;

    const statement = parseStatement(verified.bytes);
    if (statement === null) {
      return { state: 'invalid', reason: 'bad-statement', commit: verified.commit };
    }
    if (statement.host !== hostId) {
      return { state: 'invalid', reason: 'host-mismatch', commit: verified.commit };
    }
    if (statement.item.id !== phaseId) {
      return { state: 'invalid', reason: 'item-mismatch', commit: verified.commit };
    }

    const facts: SignedFacts = {
      commit: verified.commit,
      tip: verified.tip,
      signedAt: verified.signedAt,
      statement,
    };
    const { changes, gatesChange } = compareInputs(
      statement,
      await currentInputs(adapter, reader, verified.tip, phaseId),
      await currentGates(reader, verified.tip),
    );
    if (changes.length === 0 && gatesChange === null) return { state: 'on-runway', ...facts };
    return { state: 'changed', changes, gatesChange, ...facts };
  } catch (error) {
    // Fail closed: anything unexpected is invalid, never on the runway.
    return { state: 'invalid', reason: 'error', detail: (error as Error).message };
  }
}

export interface RunwayEntry {
  phaseId: string;
  name: string | null;
  planCount: number;
  commit: string;
  signedAt: string;
}

export interface Runway {
  tip: string | null;
  /** On-runway phases that are not built. */
  count: number;
  /** Plans across those phases. */
  planCount: number;
  onRunway: RunwayEntry[];
  changed: (RunwayEntry & { changes: InputChange[]; gatesChange: GatesChange | null })[];
  invalid: { phaseId: string; reason: ApprovalInvalidReason; detail?: string }[];
}

const APPROVAL_FILE_RE = /^phase-(.+)\.json$/;

/** Every approval file at the base tip, evaluated; the runway is the on-runway, not-built ones. */
export async function computeRunway(options: RunwayOptions): Promise<Runway> {
  const { reader, adapter } = options;
  const empty: Runway = {
    tip: null,
    count: 0,
    planCount: 0,
    onRunway: [],
    changed: [],
    invalid: [],
  };
  const tip = await reader.resolve(`refs/heads/${options.baseBranch}`);
  if (tip === null) return empty;

  const phaseIds = (await reader.list(tip, APPROVALS_DIR))
    .filter((entry) => entry.type === 'blob')
    .map((entry) => APPROVAL_FILE_RE.exec(entry.name)?.[1])
    .filter((id): id is string => id !== undefined && isPhaseId(id));
  if (phaseIds.length === 0) return { ...empty, tip };

  const snapshot = await adapter.snapshot(reader, tip);
  const runway: Runway = { ...empty, tip };
  for (const phaseId of phaseIds) {
    const phase = snapshot.phases.find((p) => p.id === phaseId) ?? null;
    const state = await approvalState({ ...options, phaseId });
    const entry = (s: SignedFacts): RunwayEntry => ({
      phaseId,
      name: phase?.name ?? null,
      planCount: phase?.plans.length ?? 0,
      commit: s.commit,
      signedAt: s.signedAt,
    });
    switch (state.state) {
      case 'none':
        break;
      case 'invalid':
        runway.invalid.push({
          phaseId,
          reason: state.reason,
          ...(state.detail === undefined ? {} : { detail: state.detail }),
        });
        break;
      case 'changed':
        runway.changed.push({
          ...entry(state),
          changes: state.changes,
          gatesChange: state.gatesChange,
        });
        break;
      case 'on-runway': {
        // Built phases have nothing left to run: an approval of one is not runway.
        if (phase !== null && derivePhaseStatus(phase).status === 'built') break;
        const e = entry(state);
        runway.onRunway.push(e);
        runway.count += 1;
        runway.planCount += e.planCount;
        break;
      }
    }
  }
  return runway;
}

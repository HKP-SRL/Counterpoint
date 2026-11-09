// Approval preparation (stub for the RED step).
import type { FrameworkAdapter, GitFileReader } from '../framework/port.ts';
import type { PhasePrerequisites } from '../runway/status.ts';
import type { ApprovalStatement } from './statement.ts';

export type PrepareRefusal =
  | { ok: false; reason: 'no-base' | 'not-found' | 'built' }
  | { ok: false; reason: 'not-ready'; notReadyReason: 'no-context' | 'no-plans' }
  | { ok: false; reason: 'unreadable'; file: string; detail: string };
export interface PreparedApproval {
  ok: true;
  statement: ApprovalStatement;
  bytes: Uint8Array;
  fingerprint: string;
  itemId: string;
  itemPath: string;
  tip: string;
  phase: { id: string; name: string; planCount: number };
  prerequisites: PhasePrerequisites;
  inputs: {
    path: string;
    label: string;
    kind: string;
    digest: string;
    normalization: string | null;
  }[];
}
export async function prepareApproval(_options: {
  hostId: string;
  baseBranch: string;
  phaseId: string;
  reader: GitFileReader;
  adapter: FrameworkAdapter;
}): Promise<PreparedApproval | PrepareRefusal> {
  return { ok: false, reason: 'not-found' };
}

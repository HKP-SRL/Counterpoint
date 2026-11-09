// Approval state and runway (stub for the RED step).
import type { Trust } from '../approvals/trust-store.ts';
import type { ApprovalStatement, GatesSlot } from '../approvals/statement.ts';
import type { ApprovalInput, FrameworkAdapter, GitFileReader } from '../framework/port.ts';

export interface InputChange {
  path: string;
  kind: string;
  change: 'modified' | 'added' | 'removed';
  signedDigest: string | null;
  nowDigest: string | null;
}
export interface GatesChange {
  change: 'added' | 'modified' | 'removed' | 'unreadable';
  signedDigest: string | null;
  nowDigest: string | null;
}
export type ApprovalState =
  | { state: 'none'; tip: string }
  | { state: 'invalid'; reason: string; detail?: string; commit?: string }
  | {
      state: 'on-runway';
      commit: string;
      tip: string;
      signedAt: string;
      statement: ApprovalStatement;
    }
  | {
      state: 'changed';
      commit: string;
      tip: string;
      signedAt: string;
      statement: ApprovalStatement;
      changes: InputChange[];
      gatesChange: GatesChange | null;
    };
export function compareInputs(
  _statement: ApprovalStatement,
  _inputs: readonly ApprovalInput[],
  _gates: GatesSlot | 'unreadable',
): { changes: InputChange[]; gatesChange: GatesChange | null } {
  return { changes: [], gatesChange: null };
}
interface Options {
  hostId: string;
  root: string;
  baseBranch: string;
  reader: GitFileReader;
  adapter: FrameworkAdapter;
  trust: Pick<Trust, 'allowedSignersPath' | 'fingerprint'> | null;
  tmpDir: string;
}
export async function approvalState(
  _options: Options & { phaseId: string },
): Promise<ApprovalState> {
  return { state: 'none', tip: '' };
}
export async function computeRunway(_options: Options): Promise<{
  count: number;
  planCount: number;
  onRunway: { phaseId: string }[];
  changed: { phaseId: string }[];
  invalid: { phaseId: string; reason: string }[];
}> {
  return { count: -1, planCount: 0, onRunway: [], changed: [], invalid: [] };
}

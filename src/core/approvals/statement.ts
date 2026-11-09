// Approval statement (stub for the RED step).
import { z } from 'zod';
import type { ApprovalInput } from '../framework/port.ts';

export const APPROVAL_SCHEMA = 'counterpoint/approval/v1';
export const ApprovalStatement = z.any();
export type ApprovalStatement = {
  schema: string;
  kind: string;
  host: string;
  item: { type: string; id: string };
  base: { branch: string; commit: string };
  inputs: {
    algorithm: string;
    files: { path: string; kind: string; digest: string; normalization?: string }[];
    combined: string;
  };
  draft: { state: string; digest: null };
  gates: { state: string; digest: string | null };
};
export function buildStatement(_options: {
  hostId: string;
  phaseId: string;
  baseBranch: string;
  tip: string;
  inputs: readonly ApprovalInput[];
  gates: { state: 'absent'; digest: null } | { state: 'present'; digest: string };
}): ApprovalStatement {
  return {
    schema: '',
    kind: '',
    host: '',
    item: { type: '', id: '' },
    base: { branch: '', commit: '' },
    inputs: { algorithm: '', files: [], combined: '' },
    draft: { state: '', digest: null },
    gates: { state: '', digest: null },
  };
}
export function serializeStatement(_s: ApprovalStatement): string {
  return '';
}
export function statementFingerprint(_s: ApprovalStatement): string {
  return '';
}

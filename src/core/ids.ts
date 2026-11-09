// RED stub: replaced in GREEN.
const NEVER = /(?!)/;
export const HOST_ID_RE = NEVER;
export const PHASE_ID_RE = NEVER;
export const PROBE_NONCE_RE = NEVER;
export const PROBE_CANARY_RE = NEVER;
export const PROBE_GIT_ARTIFACT_RE = NEVER;
export class InvalidIdError extends Error {}
export function isHostId(_value: unknown): boolean {
  return false;
}
export function isPhaseId(_value: unknown): boolean {
  return false;
}
export function assertHostId(_value: unknown): string {
  throw new Error('not implemented');
}
export function assertPhaseId(_value: unknown): string {
  throw new Error('not implemented');
}
export function approvalItemId(_phaseId: string): string {
  throw new Error('not implemented');
}
export function hostIdFromName(_name: string): string {
  return '';
}

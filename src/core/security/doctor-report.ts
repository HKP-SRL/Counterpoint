// STUB (RED): replaced in the GREEN commit.
import { z } from 'zod';
export const PROBE_TARGET_IDS = [
  'signing-key',
  'ssh',
  'gh',
  'state',
  'git-config',
  'git-hooks',
  'git-info',
] as const;
export const DoctorReport = z.any();
export type DoctorReport = z.infer<typeof DoctorReport>;
export function reportVerdict(_report: DoctorReport): 'pass' | 'fail' {
  return 'pass';
}
export function isReportStale(_report: DoctorReport, _now: Date): boolean {
  return false;
}

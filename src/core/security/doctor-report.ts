// The doctor report: schema `counterpoint/doctor/v1`, written by `counterpoint doctor` and
// rendered by the Trust page (UI-SPEC "Trust"). The verdict is `pass` only when every check
// passes and every one of the seven probe targets is `blocked`; anything missing, failed,
// reachable or not checked is a fail (never a silent pass).
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

export const ProbeTargetId = z.enum(PROBE_TARGET_IDS);
export type ProbeTargetId = z.infer<typeof ProbeTargetId>;

/** Trust-page row labels (UI-SPEC). `{host}` is replaced with the host's display name. */
export const PROBE_TARGET_LABELS: Readonly<Record<ProbeTargetId, string>> = {
  'signing-key': 'Signing key',
  ssh: '~/.ssh',
  gh: 'gh credentials',
  state: 'Counterpoint state',
  'git-config': '{host} .git/config',
  'git-hooks': '.git/hooks',
  'git-info': '.git/info',
};

export function probeTargetLabel(id: ProbeTargetId, hostName: string): string {
  return PROBE_TARGET_LABELS[id].replace('{host}', hostName);
}

export const CheckResult = z.enum(['pass', 'fail', 'not-checked']);
export type CheckResult = z.infer<typeof CheckResult>;

export const Check = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  result: CheckResult,
  detail: z.string(),
  fix: z.string().optional(),
});
export type Check = z.infer<typeof Check>;

export const ProbeResult = z.enum(['blocked', 'reachable', 'not-checked']);
export type ProbeResult = z.infer<typeof ProbeResult>;

export const ProbeTarget = z.object({
  id: ProbeTargetId,
  label: z.string().min(1),
  mode: z.enum(['read', 'write']),
  result: ProbeResult,
  evidence: z.string(),
});
export type ProbeTarget = z.infer<typeof ProbeTarget>;

export const DOCTOR_SCHEMA = 'counterpoint/doctor/v1';

export const DoctorReport = z.object({
  schema: z.literal(DOCTOR_SCHEMA),
  hostId: z.string().min(1),
  checkedAt: z.iso.datetime(),
  claudeVersion: z.string().nullable(),
  matcherVersion: z.string().min(1),
  tools: z.array(Check),
  signingKey: z.array(Check),
  integrity: Check,
  probe: z.array(ProbeTarget),
});
export type DoctorReport = z.infer<typeof DoctorReport>;

export type Verdict = 'pass' | 'fail';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function reportVerdict(report: DoctorReport): Verdict {
  const checks = [...report.tools, ...report.signingKey, report.integrity];
  if (report.tools.length === 0 || report.signingKey.length === 0) return 'fail';
  if (checks.some((check) => check.result !== 'pass')) return 'fail';
  for (const id of PROBE_TARGET_IDS) {
    const rows = report.probe.filter((row) => row.id === id);
    if (rows.length === 0 || rows.some((row) => row.result !== 'blocked')) return 'fail';
  }
  return 'pass';
}

/** True when the report is more than 24 hours old (UI-SPEC "Doctor stale"). */
export function isReportStale(report: DoctorReport, now: Date): boolean {
  return now.getTime() - Date.parse(report.checkedAt) > STALE_AFTER_MS;
}

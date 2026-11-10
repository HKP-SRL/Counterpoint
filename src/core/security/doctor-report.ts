// The doctor report: schema `counterpoint/doctor/v1`, written by `counterpoint doctor` and
// rendered by the Trust page (UI-SPEC "Trust"). The verdict is `pass` only when every check (the
// Sandbox isolation settings check included) passes and every one of the nine probe targets is
// `blocked`; anything missing, failed, reachable or not checked is a fail (never a silent pass).
//
// `outside-workdir` (01-17) was added to schema v1 as an additive row: a report written before it
// still parses, and its verdict is `fail` because that row is missing. The classifier revision
// that produced a report is recorded in `matcherVersion`, not in the schema id.
//
// `sandboxIsolation` (01-25) is an additive v1 field: the Sandbox isolation settings check
// (replacement 2 for the scrub opt-out, src/core/security/sandbox-isolation.ts). A report written
// before it still parses, and its verdict is `fail`, because the check is required to pass.
//
// `credential-env` (01-26, replacement 3 for the scrub opt-out) is an additive v1 row, like
// `outside-workdir`: a report without it still parses, and its verdict is `fail`. A row's optional
// `exceptions` field records an owner exception the row applied (`sandbox-proxy-login`, STATE.md
// [Owner] 2026-11-10), so a row that needed one is never a silent pass.
import { z } from 'zod';

export const PROBE_TARGET_IDS = [
  'signing-key',
  'ssh',
  'gh',
  'state',
  'git-config',
  'git-hooks',
  'git-info',
  'outside-workdir',
  'credential-env',
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
  'outside-workdir': 'Files outside the working folder',
  'credential-env': 'Credentials in the shell environment',
};

export function probeTargetLabel(id: ProbeTargetId, hostName: string): string {
  return PROBE_TARGET_LABELS[id].replace('{host}', hostName);
}

const WRITE_TARGETS: ReadonlySet<ProbeTargetId> = new Set([
  'git-config',
  'git-hooks',
  'git-info',
  'outside-workdir',
]);

/** Whether a probe target tests reading a protected location or writing one. */
export function probeTargetMode(id: ProbeTargetId): 'read' | 'write' {
  return WRITE_TARGETS.has(id) ? 'write' : 'read';
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

/** An owner exception a probe row applied (01-26): named, reasoned and dated. */
export const ProbeException = z.strictObject({
  id: z.literal('sandbox-proxy-login'),
  reason: z.string().min(1),
  recordedAt: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
  names: z.array(z.string().min(1)).min(1),
});
export type ProbeException = z.infer<typeof ProbeException>;

export const ProbeTarget = z.object({
  id: ProbeTargetId,
  label: z.string().min(1),
  mode: z.enum(['read', 'write']),
  result: ProbeResult,
  evidence: z.string(),
  /** Additive (01-26): the owner exceptions this row applied; only credential-env carries one. */
  exceptions: z.array(ProbeException).optional(),
});
export type ProbeTarget = z.infer<typeof ProbeTarget>;

export const SandboxIsolationSource = z.object({
  kind: z.enum([
    'launch',
    'user',
    'server-managed-cache',
    'managed-file',
    'managed-drop-in',
    'managed-preferences',
  ]),
  label: z.string(),
  path: z.string().nullable(),
  state: z.enum(['absent', 'read', 'unreadable']),
  /** The failing key names only, never a value. */
  findings: z.array(z.string()),
});
export type SandboxIsolationSource = z.infer<typeof SandboxIsolationSource>;

/** The Sandbox isolation settings check, with every settings source it read. */
export const SandboxIsolationCheck = Check.extend({
  id: z.literal('sandbox-isolation'),
  sources: z.array(SandboxIsolationSource),
});
export type SandboxIsolationCheck = z.infer<typeof SandboxIsolationCheck>;

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
  /** Additive (01-25). Missing reads as not passing. */
  sandboxIsolation: SandboxIsolationCheck.optional(),
});
export type DoctorReport = z.infer<typeof DoctorReport>;

export type Verdict = 'pass' | 'fail';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function reportVerdict(report: DoctorReport): Verdict {
  const checks = [...report.tools, ...report.signingKey, report.integrity];
  if (report.tools.length === 0 || report.signingKey.length === 0) return 'fail';
  if (checks.some((check) => check.result !== 'pass')) return 'fail';
  if (report.sandboxIsolation === undefined || report.sandboxIsolation.result !== 'pass') {
    return 'fail';
  }
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

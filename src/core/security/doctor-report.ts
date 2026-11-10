// The doctor report: schema `counterpoint/doctor/v1`, written by `counterpoint doctor` and
// rendered by the Trust page (UI-SPEC "Trust"). The verdict is `pass` only when every check (the
// Sandbox isolation settings and Agent permission mode checks included) passes and every one of
// the nine probe targets is `blocked`; anything missing, failed, reachable or not checked is a
// fail (never a silent pass).
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
//
// `agentMode` (01-22) is an additive v1 field: the Agent permission mode check, the permission
// mode the probe's agent session really ran in, read from claude's own init events and stderr
// (never from the argv). A report written before it still parses, and its verdict is `fail`,
// because the check is required to pass. Core receives the expected mode as a parameter, so it
// imports nothing from `src/agent/`.
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

/** The Agent permission mode check (01-22): the mode Counterpoint launched with and what ran. */
export const AgentModeCheck = Check.extend({
  id: z.literal('agent-mode'),
  expected: z.string().min(1),
  effective: z.string().nullable(),
});
export type AgentModeCheck = z.infer<typeof AgentModeCheck>;

const AGENT_MODE_LABEL = 'Agent permission mode';
const NOTICE_MAX = 300;

/** Control characters (C0, DEL, C1, U+2028, U+2029) become spaces; trimmed; at most 300 chars. */
function sanitiseNotice(text: string): string {
  let result = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const control =
      code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
    result += control ? ' ' : ch;
  }
  return [...result.trim()].slice(0, NOTICE_MAX).join('');
}

/**
 * Judges the probe's agent session mode (01-22). `modes` holds one entry per init event of every
 * attempt (null when the event carried no mode), or is `null` when the probe did not run. Passes
 * only when every attempt reported `expected` and claude printed no permission-mode notice.
 */
export function judgeAgentMode(input: {
  expected: string;
  modes: ReadonlyArray<string | null> | null;
  notices: readonly string[];
}): AgentModeCheck {
  const { expected, modes } = input;
  const base = { id: 'agent-mode' as const, label: AGENT_MODE_LABEL, expected };
  const fix = `Counterpoint launches agent sessions with --permission-mode ${expected}. Check that auto mode is available to your claude (claude --version; no disableAutoMode in your Claude Code settings), then run "counterpoint doctor" again.`;
  if (modes === null) {
    return {
      ...base,
      result: 'not-checked',
      effective: null,
      detail: 'The probe could not run, so the agent permission mode was not seen.',
    };
  }
  // Every notice counts, even one that sanitises to nothing (fail closed).
  const notices = input.notices.map(sanitiseNotice);
  const said = notices[0] === undefined ? '' : ` claude said: "${notices[0]}"`;
  if (modes.length === 0) {
    return {
      ...base,
      result: 'fail',
      effective: null,
      detail: "The probe's agent session did not report its permission mode.",
      fix,
    };
  }
  const other = modes.find((mode) => mode !== expected);
  if (other !== undefined) {
    const effective = other;
    return {
      ...base,
      result: 'fail',
      effective,
      detail: `The probe's agent session ran in ${effective ?? 'an unknown'} mode, not ${expected}.${said}`,
      fix,
    };
  }
  if (notices[0] !== undefined) {
    return {
      ...base,
      result: 'fail',
      effective: expected,
      detail: `claude reported a permission mode change: "${notices[0]}".`,
      fix,
    };
  }
  return {
    ...base,
    result: 'pass',
    effective: expected,
    detail: `The probe's agent session ran in ${expected} mode.`,
  };
}

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
  /** Additive (01-22). Missing reads as not passing. */
  agentMode: AgentModeCheck.optional(),
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
  if (report.agentMode === undefined || report.agentMode.result !== 'pass') return 'fail';
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

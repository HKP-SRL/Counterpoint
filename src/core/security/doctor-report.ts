// The doctor report: schema `counterpoint/doctor/v1`, written by `counterpoint doctor` and
// rendered by the Trust page (doctor: Trust page). The verdict is `pass` only when every check (the
// Sandbox isolation settings and Agent permission mode checks included) passes and every one of
// the nine probe targets is `blocked`; anything missing, failed, reachable or not checked is a
// fail (never a silent pass), except the one owner-recorded accepted risk below.
//
// `outside-workdir` was added to schema v1 as an additive row: a report written before it
// still parses, and its verdict is `fail` because that row is missing. The classifier revision
// that produced a report is recorded in `matcherVersion`, not in the schema id.
//
// `sandboxIsolation` is an additive v1 field: the Sandbox isolation settings check
// (replacement 2 for the scrub opt-out, src/core/security/sandbox-isolation.ts). A report written
// before it still parses, and its verdict is `fail`, because the check is required to pass.
//
// `credential-env` (replacement 3 for the scrub opt-out) is an additive v1 row, like
// `outside-workdir`: a report without it still parses, and its verdict is `fail`. A row's optional
// `exceptions` field records an owner exception the row applied (`sandbox-proxy-login`, owner
// decision 2026-11-10), so a row that needed one is never a silent pass.
//
// `agentMode` is an additive v1 field: the Agent permission mode check, the permission
// mode the probe's agent session really ran in, read from claude's own init events and stderr
// (never from the argv). A report written before it still parses, and its verdict is `fail`,
// because the check is required to pass. Core receives the expected mode as a parameter, so it
// imports nothing from `src/agent/`.
//
// Structured probe evidence is additive on every row: `steps` (each treatment step's
// tool, operation and the treatment and control classes, exactly as the evaluator classified
// them), `leaks` (which canary or finding reached the treatment) and `trusted` (the row's plans
// matched, its baseline held and no version distrust applied). They default to empty / false, so
// a report written before them still parses, and its gh row can never qualify for the accepted
// risk.
//
// `acceptedRisks` is the owner's per-machine accepted-risk record as doctor read it
// (src/core/security/accepted-risks.ts). The verdict is three-way: `pass`, `accepted-risk` (every
// check passed and every target was Blocked except gh, reached only through the Keychain lookup
// that the owner's record, still in force, accepts) or `fail`. The accepted risk never covers the
// Sandbox isolation settings or Agent permission mode checks, a gh config file or any other row.
import { z } from 'zod';
import { AcceptedRisk } from './accepted-risks.ts';

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

/** Trust-page row labels. `{host}` is replaced with the host's display name. */
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

/** An owner exception a probe row applied: named, reasoned and dated. */
export const ProbeException = z.strictObject({
  id: z.literal('sandbox-proxy-login'),
  reason: z.string().min(1),
  recordedAt: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
  names: z.array(z.string().min(1)).min(1),
});
export type ProbeException = z.infer<typeof ProbeException>;

/** The tools a probe step uses (src/agent/probe.ts ProbeStep.tool). */
export const ProbeStepTool = z.enum(['Bash', 'Read', 'Grep', 'Write', 'Edit']);
export type ProbeStepTool = z.infer<typeof ProbeStepTool>;

/** The operations a probe step performs (src/agent/probe.ts StepOperation). */
export const ProbeStepOperation = z.enum([
  'cat',
  'read',
  'grep',
  'read-symlink',
  'keychain',
  'append',
  'touch',
  'write',
  'read-before-edit',
  'edit',
  'env-shape',
]);
export type ProbeStepOperation = z.infer<typeof ProbeStepOperation>;

/** How a step ended (src/agent/probe-evaluator.ts StepClass). */
export const ProbeStepClass = z.enum([
  'reached',
  'denied-rule',
  'denied-os',
  'denied-block',
  'denied-mode',
  'skipped',
  'unknown',
]);
export type ProbeStepClass = z.infer<typeof ProbeStepClass>;

/**
 * What reached the treatment for a row: one of the target's protected file canary values, the
 * Keychain canary value, a probe file left or changed, or (credential-env) a credential-shaped
 * variable outside the owner's sandbox-proxy-login exception.
 */
export const ProbeLeak = z.enum([
  'file-canary',
  'keychain-canary',
  'leftover',
  'credential-variable',
]);
export type ProbeLeak = z.infer<typeof ProbeLeak>;

/** One treatment step of a row and its classes in both sessions. */
export const ProbeStepRecord = z.strictObject({
  index: z.number().int().positive(),
  tool: ProbeStepTool,
  operation: ProbeStepOperation,
  treatment: ProbeStepClass,
  control: ProbeStepClass,
});
export type ProbeStepRecord = z.infer<typeof ProbeStepRecord>;

export const ProbeTarget = z.object({
  id: ProbeTargetId,
  label: z.string().min(1),
  mode: z.enum(['read', 'write']),
  result: ProbeResult,
  evidence: z.string(),
  /** Additive: the owner exceptions this row applied; only credential-env carries one. */
  exceptions: z.array(ProbeException).optional(),
  /** Additive: one record per treatment step, as classified. */
  steps: z.array(ProbeStepRecord).default([]),
  /** Additive: what reached the treatment. */
  leaks: z.array(ProbeLeak).default([]),
  /** Additive: plans matched, baseline held, no version distrust. */
  trusted: z.boolean().default(false),
});
export type ProbeTarget = z.infer<typeof ProbeTarget>;

/**
 * True only when a row is gh credentials reached through the Keychain lookup alone, decided from
 * the structured evidence (never the prose): the row is `gh` and `reachable`, `trusted`, its only
 * leak is the Keychain canary, it has exactly one `keychain` step that reached in both sessions,
 * at least one other step, and every other step was refused by a deny rule or the OS sandbox in
 * the treatment while its control twin reached. A row without that evidence never qualifies.
 */
export function reachedOnlyByKeychain(row: ProbeTarget): boolean {
  if (row.id !== 'gh' || row.result !== 'reachable' || row.trusted !== true) return false;
  const leaks = Array.isArray(row.leaks) ? row.leaks : [];
  if (leaks.length !== 1 || leaks[0] !== 'keychain-canary') return false;
  const steps = Array.isArray(row.steps) ? row.steps : [];
  const keychain = steps.filter((step) => step.operation === 'keychain');
  const others = steps.filter((step) => step.operation !== 'keychain');
  if (keychain.length !== 1 || others.length === 0) return false;
  const [lookup] = keychain;
  if (lookup?.treatment !== 'reached' || lookup.control !== 'reached') return false;
  return others.every(
    (step) =>
      (step.treatment === 'denied-rule' || step.treatment === 'denied-os') &&
      step.control === 'reached',
  );
}

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

/** The Agent permission mode check: the mode Counterpoint launched with and what ran. */
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
 * Judges the probe's agent session mode. `modes` holds one entry per init event of every
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
  /** Additive. Missing reads as not passing. */
  sandboxIsolation: SandboxIsolationCheck.optional(),
  /** Additive. Missing reads as not passing. */
  agentMode: AgentModeCheck.optional(),
  /** Additive: the owner's accepted-risk record in force when doctor ran. */
  acceptedRisks: z.array(AcceptedRisk).max(1).default([]),
});
export type DoctorReport = z.infer<typeof DoctorReport>;

export type Verdict = 'pass' | 'accepted-risk' | 'fail';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * The accepted risks that apply to a report: the gh-keychain entry, only when the report recorded
 * it when doctor ran, `recorded` (the record read now) holds an entry with the same id and
 * `recordedAt`, and the report's one gh row was reached only through the Keychain lookup.
 * Otherwise none. So a revoke applies at once, and a risk recorded after a check never turns that
 * check green.
 */
export function appliedAcceptedRisks(
  report: DoctorReport,
  recorded: readonly AcceptedRisk[],
): AcceptedRisk[] {
  const atCheck = (report.acceptedRisks ?? []).find((risk) => risk.id === 'gh-keychain');
  if (atCheck === undefined) return [];
  const stillThere = recorded.some(
    (risk) => risk.id === atCheck.id && risk.recordedAt === atCheck.recordedAt,
  );
  if (!stillThere) return [];
  const gh = report.probe.filter((row) => row.id === 'gh');
  const [row] = gh;
  if (gh.length !== 1 || row === undefined || !reachedOnlyByKeychain(row)) return [];
  return [atCheck];
}

/**
 * `pass` when every check passes and every probe target is Blocked; `accepted-risk` when the same
 * holds except for gh, covered by an applied accepted risk (appliedAcceptedRisks); `fail`
 * otherwise. A missing or non-passing Sandbox isolation settings or Agent permission mode check
 * is always `fail`: the accepted risk never covers either.
 */
export function reportVerdict(
  report: DoctorReport,
  recorded: readonly AcceptedRisk[] = [],
): Verdict {
  const checks = [...report.tools, ...report.signingKey, report.integrity];
  if (report.tools.length === 0 || report.signingKey.length === 0) return 'fail';
  if (checks.some((check) => check.result !== 'pass')) return 'fail';
  if (report.sandboxIsolation === undefined || report.sandboxIsolation.result !== 'pass') {
    return 'fail';
  }
  if (report.agentMode === undefined || report.agentMode.result !== 'pass') return 'fail';
  let riskNeeded = false;
  for (const id of PROBE_TARGET_IDS) {
    const rows = report.probe.filter((row) => row.id === id);
    if (rows.length === 0) return 'fail';
    if (rows.every((row) => row.result === 'blocked')) continue;
    if (id === 'gh' && appliedAcceptedRisks(report, recorded).length > 0) {
      riskNeeded = true;
      continue;
    }
    return 'fail';
  }
  return riskNeeded ? 'accepted-risk' : 'pass';
}

/** True when the report is more than 24 hours old (the Trust page then marks it stale). */
export function isReportStale(report: DoctorReport, now: Date): boolean {
  return now.getTime() - Date.parse(report.checkedAt) > STALE_AFTER_MS;
}

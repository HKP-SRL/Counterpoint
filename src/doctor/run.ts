// `counterpoint doctor` (FOUND-03, FOUND-04): tools, signing-key hygiene, the host's integrity
// baseline and the live sandbox probe, written as one `counterpoint/doctor/v1` report.
//
// The probe runs against the owner's real protected directories (the trusted key's folder,
// ~/.ssh, gh's config, the Counterpoint home) and the host's real git common dir, through the
// same settings builder the runner uses, with canaries only (01-04/01-05). A probe failure is a
// hard doctor fail and nothing else: the console and approvals keep working (CONTEXT
// discretion; Phase 2 refuses to spawn builders while it fails).
//
// The Sandbox isolation settings check (01-25, replacement 2 for the scrub opt-out): doctor reads
// every settings source an agent session loads (the launch settings, the user file, the
// server-managed cache and the managed sources; src/doctor/settings-sources.ts) and fails when any
// of them turns sandbox isolation off (src/core/security/sandbox-isolation.ts). While that check
// does not pass, no probe row counts as Blocked: each measured Blocked row is stored Not checked.
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { runSandboxProbe } from '../agent/probe.ts';
import { MATCHER_CLAUDE_VERSION, MATCHER_REVISION } from '../agent/probe-evaluator.ts';
import { ClaudeCliRunner } from '../agent/runner.ts';
import { checkIntegrity, INTEGRITY_REFUSAL } from '../core/approvals/integrity.ts';
import { readTrust, type TrustResult } from '../core/approvals/trust-store.ts';
import { homePaths, hostDir } from '../core/host/home.ts';
import { PROBE_OUTSIDE_DIR_RE } from '../core/ids.ts';
import {
  type Check,
  DOCTOR_SCHEMA,
  DoctorReport,
  PROBE_TARGET_IDS,
  type ProbeTarget,
  type ProbeTargetId,
  probeTargetLabel,
  probeTargetMode,
  reportVerdict,
  type SandboxIsolationCheck,
} from '../core/security/doctor-report.ts';
import {
  judgeSandboxIsolation,
  type SettingsSourceRead,
} from '../core/security/sandbox-isolation.ts';
import {
  buildAgentSandboxSettings,
  type ProtectedPaths,
  resolveAbsolute,
} from '../core/security/sandbox-settings.ts';
import {
  defaultSettingsSourceLocations,
  readSettingsSources,
  type SettingsSourceLocations,
} from './settings-sources.ts';
import { checkSigningKey } from './signing-key.ts';
import { checkTools } from './tools.ts';

/** What doctor needs from a probe run. */
export interface ProbeSummary {
  targets: ProbeTarget[];
  claudeVersion: string | null;
  /** Artifacts of an earlier killed probe that this run removed before starting. */
  staleLeftovers: readonly string[];
}

export type DoctorProbe = (input: {
  protectedPaths: ProtectedPaths;
  logDir: string;
}) => Promise<ProbeSummary>;

/** The live probe: two headless claude sessions through the production sandbox settings. */
export const liveSandboxProbe: DoctorProbe = async ({ protectedPaths, logDir }) => {
  const runner = new ClaudeCliRunner();
  const outcome = await runSandboxProbe({ protectedPaths, runner, logDir });
  return {
    targets: outcome.targets,
    claudeVersion: outcome.claudeVersion,
    staleLeftovers: outcome.staleLeftovers,
  };
};

export interface DoctorHost {
  id: string;
  root: string;
  gitCommonDir: string;
}

export interface RunDoctorInput {
  home: string;
  host: DoctorHost;
  probe?: DoctorProbe;
  tools?: () => Promise<Check[]>;
  keyChecks?: (trust: TrustResult) => Promise<Check[]>;
  now?: () => Date;
  /** The user's home directory (defaults to os.homedir()). */
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Where the settings sources live (defaults to defaultSettingsSourceLocations(homeDir)). */
  settingsLocations?: SettingsSourceLocations;
}

export interface DoctorRun {
  report: DoctorReport;
  reportPath: string;
  logDir: string;
}

/** gh's configuration directory, resolved the way gh does. */
export function ghConfigDir(env: NodeJS.ProcessEnv, homeDir: string): string {
  const explicit = env.GH_CONFIG_DIR;
  if (explicit !== undefined && isAbsolute(explicit)) return explicit;
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg !== undefined && isAbsolute(xdg)) return join(xdg, 'gh');
  return join(homeDir, '.config', 'gh');
}

async function integrityRow(home: string, host: DoctorHost, hostName: string): Promise<Check> {
  const id = 'integrity';
  const label = `${hostName} .git/config and hooks match your baseline`;
  try {
    const state = await checkIntegrity(home, host);
    if (state.state === 'ok') {
      return { id, label, result: 'pass', detail: 'No change since the baseline you accepted.' };
    }
    if (state.state === 'no-baseline') {
      return {
        id,
        label,
        result: 'fail',
        detail: 'No baseline has been accepted for this project yet.',
        fix: `Run "counterpoint trust ${host.id}" and review the list.`,
      };
    }
    const names = state.changes.map((change) => `${change.area} ${change.name}`).join(', ');
    return {
      id,
      label,
      result: 'fail',
      detail: `${INTEGRITY_REFUSAL(hostName)} Changed: ${names}.`,
      fix: `Review the change in ${hostName}, then run "counterpoint trust ${host.id}" to accept it.`,
    };
  } catch (error) {
    return {
      id,
      label,
      result: 'fail',
      detail: (error as Error).message,
      fix: `Run "counterpoint trust ${host.id}" and review the list.`,
    };
  }
}

function isInside(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

/** True when `path` lies in an outside-workdir canary directory directly under the home. */
function inOutsideDir(path: string, homeDir: string): boolean {
  const homes = new Set([homeDir]);
  try {
    homes.add(resolveAbsolute(homeDir, 'homeDir'));
  } catch {
    // a relative home names nothing
  }
  for (const home of homes) {
    const rel = relative(home, path);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) continue;
    if (PROBE_OUTSIDE_DIR_RE.test(rel.split('/')[0] ?? '')) return true;
  }
  return false;
}

/** Which probe target a stale artifact path belongs to (by the directory it was found in). */
function targetOfPath(path: string, protectedPaths: ProtectedPaths): ProbeTargetId | null {
  if (inOutsideDir(path, protectedPaths.homeDir)) return 'outside-workdir';
  // Without a workdir the builder emits no grants; only its target paths are used here.
  const { readTargets, writeTargets } = buildAgentSandboxSettings(protectedPaths);
  for (const target of [...writeTargets, ...readTargets]) {
    if (isInside(path, target.path)) return target.id;
  }
  return null;
}

function notCheckedTargets(hostName: string, evidence: string): ProbeTarget[] {
  return PROBE_TARGET_IDS.map((id) => ({
    id,
    label: probeTargetLabel(id, hostName),
    mode: probeTargetMode(id),
    result: 'not-checked',
    evidence,
  }));
}

const NOT_COUNTED =
  'Not counted as Blocked while the Sandbox isolation settings check does not pass. Measured: ';

/**
 * The Sandbox isolation settings check over the launch settings this run's sessions use and every
 * settings file source. Never throws: a launch profile that cannot be built is an unreadable source.
 */
async function sandboxIsolationCheck(
  protectedPaths: ProtectedPaths,
  locations: SettingsSourceLocations,
  homeDir: string,
): Promise<SandboxIsolationCheck> {
  let launchSettings: unknown;
  try {
    launchSettings = buildAgentSandboxSettings(protectedPaths).settings;
  } catch (error) {
    const launch: SettingsSourceRead = {
      kind: 'launch',
      label: 'launch settings',
      path: null,
      state: 'unreadable',
      problem: `could not be built (${(error as Error).message})`,
    };
    return judgeSandboxIsolation([launch], homeDir);
  }
  return judgeSandboxIsolation(await readSettingsSources({ launchSettings, locations }), homeDir);
}

/** Writes `hosts/{id}/doctor.json` (dir 0700, file 0600, atomic rename). */
export function writeDoctorReport(home: string, report: DoctorReport): string {
  const dir = hostDir(home, report.hostId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = join(dir, 'doctor.json');
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(DoctorReport.parse(report), null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  return file;
}

/** Runs every doctor check for one host and writes the report. */
export async function runDoctor(input: RunDoctorInput): Promise<DoctorRun> {
  const { home, host } = input;
  const env = input.env ?? process.env;
  const homeDir = input.homeDir ?? homedir();
  const now = input.now ?? (() => new Date());
  const hostName = basename(host.root);
  const checkedAt = now().toISOString();
  const logDir = join(homePaths(home).logsDir, 'doctor', checkedAt.replace(/[:.]/g, '-'));

  const trust = readTrust(home);
  const tools = await (input.tools ?? (() => checkTools()))();
  const signingKey = await (
    input.keyChecks ?? ((t: TrustResult) => checkSigningKey({ trust: t, env, homeDir }))
  )(trust);
  const integrity = await integrityRow(home, host, hostName);

  // Without a trusted key there is no key folder to probe: a path that does not exist makes the
  // probe skip that target, and its row reads Not checked.
  const protectedPaths: ProtectedPaths = {
    homeDir,
    counterpointHome: home,
    signingKeyDir: trust.ok
      ? dirname(trust.privateKeyPath)
      : join(homePaths(home).trustDir, 'no-trusted-key'),
    ghConfigDir: ghConfigDir(env, homeDir),
    hostGitDir: host.gitCommonDir,
  };

  // Computed whether or not the probe runs: it is a property of the configuration.
  const sandboxIsolation = await sandboxIsolationCheck(
    protectedPaths,
    input.settingsLocations ?? defaultSettingsSourceLocations(homeDir),
    homeDir,
  );

  let probe: ProbeTarget[];
  let claudeVersion: string | null = null;
  try {
    const summary = await (input.probe ?? liveSandboxProbe)({ protectedPaths, logDir });
    claudeVersion = summary.claudeVersion;
    const stale = new Map<ProbeTargetId, string[]>();
    for (const path of summary.staleLeftovers) {
      const id = targetOfPath(path, protectedPaths);
      if (id !== null) stale.set(id, [...(stale.get(id) ?? []), basename(path)]);
    }
    probe = PROBE_TARGET_IDS.map((id): ProbeTarget => {
      const row = summary.targets.find((t) => t.id === id);
      if (row === undefined) {
        return {
          id,
          label: probeTargetLabel(id, hostName),
          mode: probeTargetMode(id),
          result: 'not-checked',
          evidence: 'The probe returned no result for this target.',
        };
      }
      const swept = stale.get(id);
      return {
        ...row,
        label: probeTargetLabel(id, hostName),
        evidence:
          swept === undefined
            ? row.evidence
            : `${row.evidence}; removed leftovers of an earlier interrupted probe: ${swept.join(', ')}`,
      };
    });
  } catch (error) {
    probe = notCheckedTargets(hostName, `The probe could not run: ${(error as Error).message}`);
  }
  if (!trust.ok) {
    probe = probe.map((row) =>
      row.id === 'signing-key'
        ? {
            ...row,
            result: 'not-checked',
            evidence: 'No trusted signing key yet, so its folder was not probed.',
          }
        : row,
    );
  }
  // The probe side of replacement 2 (owner, 2026-11-10: "doctor/probe fail"). A Blocked row is
  // evidence of confinement only while isolation holds. The measured rows cannot enforce that on
  // their own: with isolation off a step can still read Blocked when a deny rule refuses it, and
  // keys such as excludedCommands or a managed allowUnsandboxedCommands leave the probe's own
  // commands untouched. So while the check does not pass, no row counts as Blocked; Reachable
  // rows stay as measured, because they are real exposure.
  if (sandboxIsolation.result !== 'pass') {
    probe = probe.map((row) =>
      row.result === 'blocked'
        ? { ...row, result: 'not-checked', evidence: `${NOT_COUNTED}${row.evidence}` }
        : row,
    );
  }

  const report = DoctorReport.parse({
    schema: DOCTOR_SCHEMA,
    hostId: host.id,
    checkedAt,
    claudeVersion,
    // The classifier revision rides in this string; the report schema stays v1.
    matcherVersion: `${MATCHER_CLAUDE_VERSION}+r${MATCHER_REVISION}`,
    tools,
    signingKey,
    integrity,
    probe,
    sandboxIsolation,
  });
  const reportPath = writeDoctorReport(home, report);
  return { report, reportPath, logDir };
}

// --- output -------------------------------------------------------------------------------------

const CHECK_WORD = { pass: 'PASS', fail: 'FAIL', 'not-checked': 'NOT CHECKED' } as const;
const PROBE_WORD = {
  blocked: 'BLOCKED',
  reachable: 'REACHABLE',
  'not-checked': 'NOT CHECKED',
} as const;
const WORD_WIDTH = 'NOT CHECKED'.length;
/** The isolation line of a report written before 01-25 (`NOT CHECKED` fills the word column). */
const ISOLATION_NOT_RECORDED =
  '  NOT CHECKED  Sandbox isolation settings: not recorded in this report';

function line(word: string, label: string, detail: string): string {
  return `  ${word.padEnd(WORD_WIDTH)}  ${label}${detail === '' ? '' : `: ${detail}`}`;
}

function checkLines(check: Check): string[] {
  const lines = [line(CHECK_WORD[check.result], check.label, check.detail)];
  if (check.result !== 'pass' && check.fix !== undefined) {
    lines.push(`  ${' '.repeat(WORD_WIDTH)}  Fix: ${check.fix}`);
  }
  return lines;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The verdict line, in the UI-SPEC words. */
export function doctorVerdict(report: DoctorReport): string {
  if (reportVerdict(report) === 'pass') return 'Agents are boxed in';
  const reachable = report.probe.filter((row) => row.result === 'reachable').length;
  if (reachable > 0) {
    return `Agent sandbox is not confining sessions: ${reachable} ${plural(reachable, 'target was', 'targets were')} reachable.`;
  }
  const checks = [...report.tools, ...report.signingKey, report.integrity];
  const isolationFailed =
    report.sandboxIsolation === undefined || report.sandboxIsolation.result !== 'pass';
  const failedChecks =
    checks.filter((check) => check.result !== 'pass').length + (isolationFailed ? 1 : 0);
  const failedTargets = PROBE_TARGET_IDS.filter((id) => {
    const rows = report.probe.filter((row) => row.id === id);
    return rows.length === 0 || rows.some((row) => row.result !== 'blocked');
  }).length;
  const n = failedChecks + failedTargets;
  return `${n} ${plural(n, 'check', 'checks')} did not pass.`;
}

/**
 * The UI-SPEC CLI contract: groups `Tools`, `Signing key`, `Sandbox probe`; one line per check
 * (`PASS` / `FAIL` / `NOT CHECKED`, probe rows `BLOCKED` / `REACHABLE` / `NOT CHECKED`), an
 * indented `Fix:` line under a failure, then the verdict. The `Sandbox probe` group starts with
 * the Sandbox isolation settings check; a report from before 01-25 shows it as `NOT CHECKED ...
 * not recorded in this report`.
 */
export function formatDoctorReport(report: DoctorReport): string[] {
  const lines: string[] = ['Tools'];
  for (const check of report.tools) lines.push(...checkLines(check));
  lines.push('Signing key');
  for (const check of [...report.signingKey, report.integrity]) lines.push(...checkLines(check));
  lines.push('Sandbox probe');
  if (report.sandboxIsolation === undefined) {
    lines.push(ISOLATION_NOT_RECORDED);
  } else {
    lines.push(...checkLines(report.sandboxIsolation));
  }
  for (const row of report.probe) lines.push(line(PROBE_WORD[row.result], row.label, row.evidence));
  lines.push('');
  lines.push(doctorVerdict(report));
  if (report.probe.some((row) => row.result === 'reachable')) {
    lines.push('Approvals still work, but builds will refuse to start until this passes.');
  }
  return lines;
}

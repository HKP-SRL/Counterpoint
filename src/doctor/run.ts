// `counterpoint doctor` (FOUND-03, FOUND-04): tools, signing-key hygiene, the host's integrity
// baseline and the live sandbox probe, written as one `counterpoint/doctor/v1` report.
//
// The probe runs against the owner's real protected directories (the trusted key's folder,
// ~/.ssh, gh's config, the Counterpoint home) and the host's real git common dir, through the
// same settings builder the runner uses, with canaries only (01-04/01-05). A probe failure is a
// hard doctor fail and nothing else: the console and approvals keep working (CONTEXT
// discretion; Phase 2 refuses to spawn builders while it fails).
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { runSandboxProbe } from '../agent/probe.ts';
import { MATCHER_CLAUDE_VERSION } from '../agent/probe-evaluator.ts';
import { ClaudeCliRunner } from '../agent/runner.ts';
import { checkIntegrity, INTEGRITY_REFUSAL } from '../core/approvals/integrity.ts';
import { readTrust, type TrustResult } from '../core/approvals/trust-store.ts';
import { homePaths, hostDir } from '../core/host/home.ts';
import {
  type Check,
  DOCTOR_SCHEMA,
  DoctorReport,
  PROBE_TARGET_IDS,
  type ProbeTarget,
  type ProbeTargetId,
  probeTargetLabel,
  reportVerdict,
} from '../core/security/doctor-report.ts';
import {
  buildAgentSandboxSettings,
  type ProtectedPaths,
} from '../core/security/sandbox-settings.ts';
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

/** Which probe target a stale artifact path belongs to (by the directory it was found in). */
function targetOfPath(path: string, protectedPaths: ProtectedPaths): ProbeTargetId | null {
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
    mode: ['git-config', 'git-hooks', 'git-info'].includes(id) ? 'write' : 'read',
    result: 'not-checked',
    evidence,
  }));
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
          mode: ['git-config', 'git-hooks', 'git-info'].includes(id) ? 'write' : 'read',
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

  const report = DoctorReport.parse({
    schema: DOCTOR_SCHEMA,
    hostId: host.id,
    checkedAt,
    claudeVersion,
    matcherVersion: MATCHER_CLAUDE_VERSION,
    tools,
    signingKey,
    integrity,
    probe,
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
  const failedChecks = checks.filter((check) => check.result !== 'pass').length;
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
 * indented `Fix:` line under a failure, then the verdict.
 */
export function formatDoctorReport(report: DoctorReport): string[] {
  const lines: string[] = ['Tools'];
  for (const check of report.tools) lines.push(...checkLines(check));
  lines.push('Signing key');
  for (const check of [...report.signingKey, report.integrity]) lines.push(...checkLines(check));
  lines.push('Sandbox probe');
  for (const row of report.probe) lines.push(line(PROBE_WORD[row.result], row.label, row.evidence));
  lines.push('');
  lines.push(doctorVerdict(report));
  if (report.probe.some((row) => row.result === 'reachable')) {
    lines.push('Approvals still work, but builds will refuse to start until this passes.');
  }
  return lines;
}

// `counterpoint doctor [host]`: picks the host, runs every check (src/doctor/run.ts), prints the
// grouped report, writes hosts/{id}/doctor.json and nudges a running daemon so the console's
// Trust page refreshes. Exit 0 only when every check passes, the Sandbox isolation settings
// check included, or when the only exception is the owner's accepted risk gh-keychain,
// which covers a gh row reached through the Keychain lookup alone.
import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { readPause } from '../build/governor.ts';
import type { TrustResult } from '../core/approvals/trust-store.ts';
import type { Check } from '../core/security/doctor-report.ts';
import { reportVerdict } from '../core/security/doctor-report.ts';
import { listHosts, openStoreReadOnly, stateDbPath } from '../core/store/db.ts';
import { type DoctorProbe, formatDoctorReport, runDoctor } from '../doctor/run.ts';
import type { SettingsSourceLocations } from '../doctor/settings-sources.ts';
import { controlRequest, isDaemonRunning } from './control-client.ts';
import { type HostLookup, lookupHost, printable } from './trust.ts';

const NO_PROJECT = 'No project registered yet. Run counterpoint inside it first.';

function isInside(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

/**
 * The host a command applies to: the explicit id (validated), else the registered host whose
 * root contains `cwd` (the deepest one), else the only registered host.
 */
export function resolveHostForCommand(
  home: string,
  explicitId: string | undefined,
  cwd: string,
  command = 'doctor',
): HostLookup {
  if (explicitId !== undefined) return lookupHost(home, explicitId);
  if (statSync(stateDbPath(home), { throwIfNoEntry: false }) === undefined) {
    return { ok: false, code: 2, message: NO_PROJECT };
  }
  const store = openStoreReadOnly(home);
  let hosts: ReturnType<typeof listHosts>;
  try {
    hosts = listHosts(store);
  } finally {
    store.close();
  }
  if (hosts.length === 0) return { ok: false, code: 2, message: NO_PROJECT };
  let here = resolve(cwd);
  try {
    here = realpathSync(here);
  } catch {
    // keep the resolved path
  }
  const containing = hosts
    .filter((host) => isInside(here, host.root))
    .sort((a, b) => b.root.length - a.root.length)[0];
  if (containing !== undefined) return { ok: true, host: containing };
  if (hosts.length === 1) return { ok: true, host: hosts[0] as (typeof hosts)[number] };
  return {
    ok: false,
    code: 2,
    message: `Name the project: counterpoint ${command} <host>. Registered: ${hosts.map((h) => h.id).join(', ')}.`,
  };
}

export interface DoctorNotice {
  hostId: string;
  family: 'doctor';
}

/** Tells a running daemon that a new report exists; does nothing when none is running. */
export async function notifyDaemon(home: string, body: DoctorNotice): Promise<void> {
  if ((await isDaemonRunning(home)) === null) return;
  await controlRequest(home, 'POST', '/control/notify', body);
}

export interface DoctorCommandOptions {
  cwd?: string;
  out?: (line: string) => void;
  err?: (line: string) => void;
  probe?: DoctorProbe;
  tools?: () => Promise<Check[]>;
  keyChecks?: (trust: TrustResult) => Promise<Check[]>;
  notify?: (home: string, body: DoctorNotice) => Promise<void>;
  now?: () => Date;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Where the settings sources live; tests always pass scratch locations. */
  settingsLocations?: SettingsSourceLocations;
}

/**
 * The governor's pause, read from the store (build-runs: Single governor in front of every spawn).
 * The CLI's probe runs in its own process, so it reads the daemon's persisted pause; a store from
 * before the build lane, or none at all, has no pause.
 */
function currentPause(home: string, now: number): { until: number; reason: string } | null {
  if (statSync(stateDbPath(home), { throwIfNoEntry: false }) === undefined) return null;
  let store: ReturnType<typeof openStoreReadOnly> | undefined;
  try {
    store = openStoreReadOnly(home);
    return readPause(store, now);
  } catch {
    return null;
  } finally {
    store?.close();
  }
}

/** Runs doctor for one host. Returns the exit code: 0 only when every check passes. */
export async function doctorCommand(
  home: string,
  hostArg: string | undefined,
  options: DoctorCommandOptions = {},
): Promise<number> {
  const out = options.out ?? console.log;
  const err = options.err ?? console.error;
  const found = resolveHostForCommand(home, hostArg, options.cwd ?? process.cwd());
  if (!found.ok) {
    err(found.message);
    return found.code;
  }
  const { host } = found;
  const pause = currentPause(home, (options.now ?? (() => new Date()))().getTime());
  if (pause !== null) {
    err(
      `Agent work is paused until ${new Date(pause.until).toLocaleString()} (${printable(pause.reason)}). Doctor's probe starts agent sessions, so it waits for the pause too. Run it again after that time.`,
    );
    return 1;
  }
  out(
    `Checking ${host.id}. The sandbox probe runs two short claude sessions (haiku); this takes about a minute.`,
  );
  const { report, reportPath, recordedRisks, acceptedRisksProblem } = await runDoctor({
    home,
    host,
    ...(options.probe === undefined ? {} : { probe: options.probe }),
    ...(options.tools === undefined ? {} : { tools: options.tools }),
    ...(options.keyChecks === undefined ? {} : { keyChecks: options.keyChecks }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.settingsLocations === undefined
      ? {}
      : { settingsLocations: options.settingsLocations }),
  });
  out('');
  if (acceptedRisksProblem !== null) {
    out(
      `Couldn't read your accepted-risk record (${printable(acceptedRisksProblem)}); it was ignored.`,
    );
    out('');
  }
  for (const line of formatDoctorReport(report, recordedRisks)) out(line);
  out('');
  out(`Report: ${reportPath}`);

  const body: DoctorNotice = { hostId: host.id, family: 'doctor' as const };
  try {
    await (options.notify ?? notifyDaemon)(home, body);
  } catch {
    // The console picks the report up on its next load; a missed nudge changes nothing.
  }
  // `accepted-risk` passes: every check passed and gh was reached only through the Keychain
  // lookup the owner's record, still in force, accepts.
  return reportVerdict(report, recordedRisks) === 'fail' ? 1 : 0;
}

// `counterpoint doctor [host]`: picks the host, runs every check (src/doctor/run.ts), prints the
// grouped report, writes hosts/{id}/doctor.json and nudges a running daemon so the console's
// Trust page refreshes. Exit 0 only when every check passes.
import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TrustResult } from '../core/approvals/trust-store.ts';
import type { Check } from '../core/security/doctor-report.ts';
import { reportVerdict } from '../core/security/doctor-report.ts';
import { listHosts, openStoreReadOnly, stateDbPath } from '../core/store/db.ts';
import { type DoctorProbe, formatDoctorReport, runDoctor } from '../doctor/run.ts';
import { controlRequest, isDaemonRunning } from './control-client.ts';
import { type HostLookup, lookupHost } from './trust.ts';

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
  out(
    `Checking ${host.id}. The sandbox probe runs two short claude sessions (haiku); this takes about a minute.`,
  );
  const { report, reportPath } = await runDoctor({
    home,
    host,
    ...(options.probe === undefined ? {} : { probe: options.probe }),
    ...(options.tools === undefined ? {} : { tools: options.tools }),
    ...(options.keyChecks === undefined ? {} : { keyChecks: options.keyChecks }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
    ...(options.env === undefined ? {} : { env: options.env }),
  });
  out('');
  for (const line of formatDoctorReport(report)) out(line);
  out('');
  out(`Report: ${reportPath}`);

  const body: DoctorNotice = { hostId: host.id, family: 'doctor' as const };
  try {
    await (options.notify ?? notifyDaemon)(home, body);
  } catch {
    // The console picks the report up on its next load; a missed nudge changes nothing.
  }
  return reportVerdict(report) === 'pass' ? 0 : 1;
}

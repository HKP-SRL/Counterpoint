// `counterpoint run`, `run stop`, `run status` (build-runs: Start and stop a run from the console;
// the CLI offers the same through the control socket, whose token agents cannot read).
//
//   counterpoint run [host] [--model <m>] [--effort <level>] [--budget <percent>] [--until HH:MM]
//                    [--changes a,b]
// Model, effort and budget default to the project's saved settings (the console's Settings page);
// a flag overrides them for this run only.
//   counterpoint run stop [host]
//   counterpoint run status [host]
//
// The daemon decides everything: it refuses a run when a chosen change is not on the runway, and
// it builds; the CLI only asks and prints.
import { EFFORT_LEVELS } from '../agent/claude-argv.ts';
import { readSmallFile } from '../build/deliver.ts';
import type { RunView } from '../build/orchestrator.ts';
import { openStoreReadOnly } from '../core/store/db.ts';
import { latestReportedRun } from '../core/store/runs.ts';
import { controlRequest, DaemonUnreachableError } from './control-client.ts';
import { printable, resolveHostForCommand } from './hosts.ts';

const START_TIMEOUT_MS = 120_000;
const NOT_RUNNING = 'Counterpoint is not running. Start it with: counterpoint';

export interface RunCommandOptions {
  cwd?: string;
  out?: (line: string) => void;
  err?: (line: string) => void;
  now?: () => Date;
  request?: typeof controlRequest;
}

/** `HH:MM` → the next time the clock shows it (today or tomorrow); an ISO time as given. */
export function parseUntil(value: string, now: Date): number | null {
  const clock = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (clock !== null) {
    const at = new Date(now);
    at.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
    if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
    return at.getTime();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function errorOf(body: unknown): string {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === 'string' ? printable(error) : 'the daemon refused the request';
}

async function send(
  options: RunCommandOptions,
  ...args: Parameters<typeof controlRequest>
): Promise<{ status: number; body: unknown } | null> {
  try {
    return await (options.request ?? controlRequest)(...args);
  } catch (error) {
    if (error instanceof DaemonUnreachableError) {
      (options.err ?? console.error)(NOT_RUNNING);
      return null;
    }
    throw error;
  }
}

export async function runStartCommand(
  home: string,
  hostArg: string | undefined,
  flags: { model?: string; effort?: string; budget?: string; until?: string; changes?: string },
  options: RunCommandOptions = {},
): Promise<number> {
  const err = options.err ?? console.error;
  const out = options.out ?? console.log;
  const found = resolveHostForCommand(home, hostArg, options.cwd ?? process.cwd(), 'run');
  if (!found.ok) {
    err(found.message);
    return found.code;
  }
  if (flags.model === '') {
    err('Name the model: --model <model> (for example opus), or leave the flag out.');
    return 2;
  }
  if (flags.effort !== undefined && !(EFFORT_LEVELS as readonly string[]).includes(flags.effort)) {
    err(`The effort is one of ${EFFORT_LEVELS.join(', ')}.`);
    return 2;
  }
  const budget = flags.budget === undefined ? undefined : Number(flags.budget);
  if (budget !== undefined && (!Number.isInteger(budget) || budget < 10 || budget > 90)) {
    err('The budget is a whole percentage of the context window, from 10 to 90.');
    return 2;
  }
  let until: string | null = null;
  if (flags.until !== undefined) {
    const at = parseUntil(flags.until, (options.now ?? (() => new Date()))());
    if (at === null) {
      err('The stop time is HH:MM (or an ISO date and time).');
      return 2;
    }
    until = new Date(at).toISOString();
  }
  const changes =
    flags.changes === undefined
      ? null
      : flags.changes
          .split(',')
          .map((c) => c.trim())
          .filter((c) => c !== '');
  const response = await send(
    options,
    home,
    'POST',
    '/control/run',
    {
      hostId: found.host.id,
      changes,
      until,
      ...(flags.model === undefined ? {} : { model: flags.model }),
      ...(flags.effort === undefined ? {} : { effort: flags.effort }),
      ...(budget === undefined ? {} : { budgetPercent: budget }),
    },
    { timeoutMs: START_TIMEOUT_MS },
  );
  if (response === null) return 1;
  if (response.status !== 202) {
    err(`The run did not start: ${errorOf(response.body)}`);
    return 1;
  }
  const runId = (response.body as { runId?: unknown }).runId;
  out(
    `Run ${String(runId)} started for ${found.host.id}. Follow it in the console, or: counterpoint run status`,
  );
  return 0;
}

export async function runStopCommand(
  home: string,
  hostArg: string | undefined,
  options: RunCommandOptions = {},
): Promise<number> {
  const err = options.err ?? console.error;
  const found = resolveHostForCommand(home, hostArg, options.cwd ?? process.cwd(), 'run stop');
  if (!found.ok) {
    err(found.message);
    return found.code;
  }
  const response = await send(options, home, 'POST', '/control/run/stop', {
    hostId: found.host.id,
  });
  if (response === null) return 1;
  if (response.status !== 202) {
    err(errorOf(response.body));
    return 1;
  }
  (options.out ?? console.log)(
    'The run stops at its next clean point: the current session finishes its task and hands off.',
  );
  return 0;
}

function time(ms: number | null): string {
  return ms === null ? '-' : new Date(ms).toLocaleString();
}

export function formatRunView(run: RunView): string[] {
  const lines = [
    `Run ${run.id}: ${run.state}${run.endReason === null ? '' : ` (${run.endReason})`}`,
    `  started ${time(run.startedAt)}${run.stopAt === null ? '' : `, stops by ${time(run.stopAt)}`}${run.endedAt === null ? '' : `, ended ${time(run.endedAt)}`}`,
    `  model ${printable(run.settings.model)}, effort ${printable(run.settings.effort)}, budget ${run.budgetLabel ?? `${run.settings.budgetPercent}% of the window`}`,
  ];
  if (run.endDetail !== null) lines.push(`  ${printable(run.endDetail)}`);
  if (run.hold !== null) {
    lines.push(`  paused until ${time(run.hold.until)}: ${printable(run.hold.reason)}`);
  }
  if (run.now !== null) {
    const n = run.now;
    const what = [
      n.phase,
      n.change === null ? null : n.change,
      n.session === undefined ? null : `session ${n.session}`,
      n.gate === undefined ? null : `gate ${n.gate}`,
      n.tokens === undefined ? null : `${Math.round(n.tokens / 1000)}k tokens`,
      n.detail === undefined ? null : printable(n.detail),
    ].filter((part) => part !== null);
    lines.push(`  now: ${what.join(', ')}`);
  }
  for (const change of run.changes) {
    const extra = [
      change.attempts > 0
        ? `${change.attempts} failed attempt${change.attempts === 1 ? '' : 's'}`
        : null,
      change.prUrl,
      change.reason === null ? null : printable(change.reason),
    ].filter((part) => part !== null);
    lines.push(
      `  ${change.state.padEnd(8)} ${change.change}${extra.length > 0 ? `  ${extra.join('; ')}` : ''}`,
    );
  }
  return lines;
}

export async function runStatusCommand(
  home: string,
  hostArg: string | undefined,
  options: RunCommandOptions = {},
): Promise<number> {
  const err = options.err ?? console.error;
  const out = options.out ?? console.log;
  const found = resolveHostForCommand(home, hostArg, options.cwd ?? process.cwd(), 'run status');
  if (!found.ok) {
    err(found.message);
    return found.code;
  }
  const response = await send(
    options,
    home,
    'GET',
    `/control/run?hostId=${encodeURIComponent(found.host.id)}`,
  );
  if (response === null) return 1;
  const run = (response.body as { run?: RunView | null }).run ?? null;
  if (run === null) {
    out(`No run yet for ${found.host.id}.`);
    return 0;
  }
  for (const line of formatRunView(run)) out(line);
  return 0;
}

/**
 * `counterpoint run report [host]`: prints the latest run's report (run-report: Report at the end
 * of every run). It reads the store read-only and the report file, so it works with Counterpoint
 * stopped too.
 */
export function runReportCommand(
  home: string,
  hostArg: string | undefined,
  options: RunCommandOptions = {},
): number {
  const err = options.err ?? console.error;
  const out = options.out ?? console.log;
  const found = resolveHostForCommand(home, hostArg, options.cwd ?? process.cwd(), 'run report');
  if (!found.ok) {
    err(found.message);
    return found.code;
  }
  const db = openStoreReadOnly(home);
  let path: string | null;
  try {
    path = latestReportedRun(db, found.host.id)?.reportPath ?? null;
  } finally {
    db.close();
  }
  if (path === null) {
    out(`No run report yet for ${found.host.id}.`);
    return 0;
  }
  const text = readSmallFile(path);
  if (text === null) {
    err(`The report at ${path} could not be read.`);
    return 1;
  }
  for (const line of text.trimEnd().split('\n')) out(printable(line));
  return 0;
}

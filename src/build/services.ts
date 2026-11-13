// Host services before gates (gates: owner decision on spike 3.4; design "Gates").
//
// Some gates need a local service: Cena's tests need the Supabase stack, which runs in Docker. The
// gate runner starts and resets such a service itself, with fixed commands from the host config
// read at the build's base commit (never from the worktree) and the run's environment (the
// owner's), before each gate that names it:
// - `start` once per run (it is expected to be idempotent, as `supabase start` is);
// - `reset` before every gate that needs the service, under the test lock the gate holds;
// - `env`: run the command, read its `KEY=value` lines, rename them by `map`, pass them into the
//   gate's environment, and, with `file`, write them into the worktree while the gate runs.
//
// The commands run from the worktree, so a reset applies the change's own migrations: testing them
// is the point. They are the owner's approved commands, run with the owner's environment (Docker
// needs it); they must not run worktree code (a package script, for instance). That is the
// config's rule, stated where it is drafted, since only the owner can approve the config.
//
// The env file is written without following links and only inside the worktree: the builder could
// plant a link at that path to a file of the owner's. An existing file there is put back afterwards.
//
// A service program that cannot be run at all (not on PATH, not executable) is the machine's
// problem, never the change's: the orchestrator checks every program before a change builds
// (missingServicePrograms), and a program that cannot start mid-run is reported as `notStarted`,
// which parks the change without giving the failure to the builder. A program that runs and fails
// (a migration the change broke, for instance) goes back to the builder like any gate failure.
import { spawn } from 'node:child_process';
import {
  accessSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join, sep } from 'node:path';
import { killGroup } from '../agent/runner.ts';
import type { GateConfig, HostConfig, ServiceConfig } from '../core/host/host-config.ts';
import { DEFAULT_DRAIN_MS, watchChildEnd } from './child-end.ts';
import { lastLines, stripTerminal } from './gate-runner.ts';

const KEEP_BYTES = 256 * 1024;
const KILL_GRACE_MS = 5000;
const GIVE_UP_EXTRA_MS = 1000;
const MAX_ENV_FILE_BYTES = 1024 * 1024;

export type ServiceStep = 'start' | 'reset' | 'env';

export type ServicePrep =
  | { ok: true; env: Record<string, string> }
  | {
      ok: false;
      service: string;
      step: ServiceStep;
      detail: string;
      tail: string;
      /** True when the step's program could not be started at all: nothing the change did. */
      notStarted?: boolean;
    };

export interface ServiceCommandResult {
  exitCode: number | null;
  timedOut: boolean;
  stopped: boolean;
  /** stdout alone (the env step reads it). */
  stdout: string;
  /** stdout and stderr together, as they arrived. */
  output: string;
  /** Why the program could not be started (`spawn supabase ENOENT`); absent when it ran. */
  spawnError?: string;
}

export type ServiceCommandRunner = (input: {
  argv: readonly string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  logPath: string;
  signal?: AbortSignal;
  /** How long the output may stay open after the command exits (child-end.ts). */
  drainMs?: number;
}) => Promise<ServiceCommandResult>;

/** The owner's environment for service commands, minus Counterpoint's own and Node's options. */
export function serviceEnv(parentEnv: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parentEnv)) {
    if (typeof value !== 'string') continue;
    if (key.startsWith('COUNTERPOINT_') || key.startsWith('CP_') || key === 'NODE_OPTIONS')
      continue;
    env[key] = value;
  }
  return { ...env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' };
}

/** A service program the gates need that cannot be run from here. */
export interface MissingServiceProgram {
  service: string;
  step: ServiceStep;
  program: string;
}

/** True when `path` is an executable regular file. */
function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** True when `program` can be run: a bare name found on `path`, or an executable absolute path. */
export function canRun(program: string, path: string): boolean {
  if (isAbsolute(program)) return isExecutableFile(program);
  // A relative path names a file in the worktree, which does not exist yet: judged when it runs.
  if (program.includes('/')) return true;
  return path
    .split(delimiter)
    .some((dir) => dir !== '' && isAbsolute(dir) && isExecutableFile(join(dir, program)));
}

/**
 * Every program of every service a gate names (start, reset, env) that cannot be run with the
 * PATH services get: the run's (the owner's login shell's). Checked before a change builds, so a
 * missing program stops the run before any session is spent.
 */
export function missingServicePrograms(
  config: HostConfig,
  parentEnv: NodeJS.ProcessEnv = process.env,
): MissingServiceProgram[] {
  const path = serviceEnv(parentEnv).PATH ?? '';
  const names = new Set(config.gates.flatMap((gate) => gate.services));
  const missing: MissingServiceProgram[] = [];
  for (const service of names) {
    const commands = config.services[service];
    if (commands === undefined) continue;
    const steps: [ServiceStep, readonly string[] | undefined][] = [
      ['start', commands.start],
      ['reset', commands.reset],
      ['env', commands.env?.command],
    ];
    for (const [step, argv] of steps) {
      const program = argv?.[0];
      if (program !== undefined && !canRun(program, path)) {
        missing.push({ service, step, program });
      }
    }
  }
  return missing;
}

/** The run's stop reason for missing service programs: what is missing and how to fix it. */
export function describeMissingPrograms(missing: readonly MissingServiceProgram[]): string {
  const programs = [...new Set(missing.map((entry) => entry.program))];
  const services = [...new Set(missing.map((entry) => entry.service))];
  const which = programs.map((program) => `"${program}"`).join(', ');
  const needs = `The ${services.join(', ')} ${services.length === 1 ? 'service needs' : 'services need'} ${which}`;
  const absolute = programs.every((program) => isAbsolute(program));
  if (absolute)
    return `${needs}, which ${programs.length === 1 ? 'is' : 'are'} not an executable file.`;
  const check = programs
    .filter((program) => !isAbsolute(program))
    .map((program) => `"command -v ${program}"`)
    .join(' and ');
  return (
    `${needs}, which ${programs.length === 1 ? 'is' : 'are'} not on your login shell's PATH. Install ` +
    `${programs.length === 1 ? 'it' : 'them'} or add ${programs.length === 1 ? 'it' : 'them'} to ` +
    `your shell's PATH (in a new terminal, ${check} should print a path), then start a new run. ` +
    'No restart is needed.'
  );
}

/**
 * Runs one service command detached, in its own process group, with its output logged. It ends
 * when the command exits (its output gets a short drain time, child-end.ts): a start that leaves
 * its service running with the output still open cannot keep the gate waiting. A Stop ends it at
 * once, even one already ending on its timeout.
 */
export const runServiceCommand: ServiceCommandRunner = async (input) => {
  mkdirSync(dirname(input.logPath), { recursive: true, mode: 0o700 });
  const log = openSync(input.logPath, 'a', 0o600);
  writeSync(log, `$ ${input.argv.join(' ')}\n`);
  let stdout = '';
  let output = '';
  let timedOut = false;
  let stopped = false;
  let spawnError: string | undefined;
  let logClosed = false;
  const drainMs = input.drainMs ?? DEFAULT_DRAIN_MS;
  const child = spawn(input.argv[0] as string, input.argv.slice(1), {
    cwd: input.cwd,
    env: input.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const pid = child.pid;
  const watch = watchChildEnd(child, drainMs);
  const timers: ReturnType<typeof setTimeout>[] = [];
  const terminate = (grace: number) => {
    if (pid === undefined) return;
    if (grace > 0) {
      killGroup(pid, 'SIGTERM');
      timers.push(setTimeout(() => killGroup(pid, 'SIGKILL'), grace));
    } else killGroup(pid, 'SIGKILL');
    timers.push(setTimeout(() => watch.giveUp(), grace + drainMs + GIVE_UP_EXTRA_MS));
  };
  const end = (why: 'timeout' | 'stopped') => {
    if (pid === undefined || stopped) return;
    if (why === 'timeout') {
      if (timedOut) return;
      timedOut = true;
      terminate(KILL_GRACE_MS);
      return;
    }
    stopped = true;
    terminate(timedOut ? 0 : KILL_GRACE_MS);
  };
  timers.push(setTimeout(() => end('timeout'), input.timeoutMs));
  const onAbort = () => end('stopped');
  if (input.signal?.aborted) queueMicrotask(onAbort);
  else input.signal?.addEventListener('abort', onAbort, { once: true });
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    if (logClosed) return;
    writeSync(log, chunk);
    stdout = (stdout + chunk).slice(-KEEP_BYTES);
    output = (output + chunk).slice(-KEEP_BYTES);
  });
  child.stderr?.on('data', (chunk: string) => {
    if (logClosed) return;
    writeSync(log, chunk);
    output = (output + chunk).slice(-KEEP_BYTES);
  });
  child.on('error', (error) => {
    output += `\n${error.message}\n`;
    if (pid === undefined) {
      // Not started, so nothing else writes the log: say why there before closing it.
      if (!logClosed) writeSync(log, `${error.message}\n`);
      spawnError = error.message;
      watch.giveUp();
    }
  });
  const ended = await watch.ended;
  for (const timer of timers) clearTimeout(timer);
  input.signal?.removeEventListener('abort', onAbort);
  // A service is meant to stay up after its start: what it left running is not killed here.
  logClosed = true;
  closeSync(log);
  return {
    exitCode: ended.exitCode,
    timedOut,
    stopped,
    stdout,
    output,
    ...(spawnError === undefined ? {} : { spawnError }),
  };
};

/** `KEY=value` lines (values optionally in single or double quotes), as `supabase status -o env` prints. */
export function parseEnvLines(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(raw);
    if (!match) continue;
    let value = (match[2] ?? '').trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value) as string;
      } catch {
        value = value.slice(1, -1);
      }
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    values.set(match[1] as string, value);
  }
  return values;
}

/** One `.env` line; a value with anything unusual is double-quoted. */
function envLine(name: string, value: string): string {
  return /^[A-Za-z0-9_./:@+=,-]*$/.test(value)
    ? `${name}=${value}`
    : `${name}=${JSON.stringify(value)}`;
}

function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

/** A file written into the worktree for a gate, and what was there before. */
interface WrittenFile {
  path: string;
  /** The real folder it was written in. */
  parent: string;
  before: Buffer | null;
}

/**
 * Writes `content` at `relative` inside the worktree without following a link, keeping what was
 * there. Throws when the path leaves the worktree or holds anything but a small regular file.
 */
export function writeWorktreeFile(
  worktree: string,
  relative: string,
  content: string,
): WrittenFile {
  const root = realpathSync(worktree);
  const target = join(root, relative);
  let parent: string;
  try {
    parent = realpathSync(dirname(target));
  } catch {
    throw new Error(`${relative}: its folder does not exist in the worktree.`);
  }
  if (!inside(root, parent)) throw new Error(`${relative} is outside the worktree.`);
  const path = join(parent, basename(target));
  let before: Buffer | null = null;
  let existing: ReturnType<typeof lstatSync> | null = null;
  try {
    existing = lstatSync(path);
  } catch {
    existing = null;
  }
  if (existing !== null) {
    if (!existing.isFile() || existing.size > MAX_ENV_FILE_BYTES) {
      throw new Error(`${relative} exists and is not a small regular file.`);
    }
    before = readFileSync(path);
    unlinkSync(path);
  }
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    if (!fstatSync(fd).isFile()) throw new Error(`${relative} is not a regular file.`);
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
  return { path, parent, before };
}

/**
 * Removes the file and puts back what was there. The gate ran in between, so its folder is
 * re-resolved first: a folder swapped for a link is left alone rather than written through.
 */
function restoreWorktreeFile(file: WrittenFile): void {
  let parent: string | null;
  try {
    parent = realpathSync(dirname(file.path));
  } catch {
    parent = null;
  }
  if (parent !== file.parent) return;
  try {
    unlinkSync(file.path);
  } catch {
    // already gone
  }
  if (file.before !== null) writeFileSync(file.path, file.before, { mode: 0o600, flag: 'wx' });
}

export interface ServiceSession {
  /** Starts, resets and reads the environment of every service `gate` names, in order. */
  prepare(gate: GateConfig, logDir: string, signal?: AbortSignal): Promise<ServicePrep>;
  /** Removes the env files written for the last gate and puts back what was there. */
  cleanup(): void;
}

/**
 * The services of one run in one worktree. `start` runs once per service for the session's life;
 * create one session per run and change.
 */
export function createServiceSession(input: {
  config: HostConfig;
  worktree: string;
  parentEnv?: NodeJS.ProcessEnv;
  run?: ServiceCommandRunner;
}): ServiceSession {
  const run = input.run ?? runServiceCommand;
  const env = serviceEnv(input.parentEnv ?? process.env);
  const started = new Set<string>();
  let written: WrittenFile[] = [];

  const step = async (
    name: string,
    which: ServiceStep,
    argv: readonly string[],
    service: ServiceConfig,
    logDir: string,
    signal?: AbortSignal,
  ): Promise<ServiceCommandResult | Extract<ServicePrep, { ok: false }>> => {
    const result = await run({
      argv,
      cwd: input.worktree,
      env,
      timeoutMs: service.timeout,
      logPath: join(logDir, `service-${name}-${which}.log`),
      signal,
    });
    if (result.exitCode === 0 && !result.timedOut && !result.stopped) return result;
    if (result.spawnError !== undefined && !result.stopped) {
      return {
        ok: false,
        service: name,
        step: which,
        detail: `the ${name} service's ${which} program could not be run (${result.spawnError})`,
        tail: '',
        notStarted: true,
      };
    }
    const detail = result.stopped
      ? 'stopped'
      : result.timedOut
        ? `timed out after ${Math.round(service.timeout / 1000)} s`
        : `exited ${result.exitCode ?? 'abnormally'}`;
    return {
      ok: false,
      service: name,
      step: which,
      detail: `service ${name} ${which} ${detail}`,
      tail: lastLines(stripTerminal(result.output)),
    };
  };

  return {
    async prepare(gate, logDir, signal) {
      const out: Record<string, string> = {};
      for (const name of gate.services) {
        const service = input.config.services[name];
        if (service === undefined) {
          return {
            ok: false,
            service: name,
            step: 'start',
            detail: `unknown service ${name}`,
            tail: '',
          };
        }
        if (!started.has(name)) {
          const result = await step(name, 'start', service.start, service, logDir, signal);
          if ('ok' in result) return result;
          started.add(name);
        }
        if (service.reset !== undefined) {
          const result = await step(name, 'reset', service.reset, service, logDir, signal);
          if ('ok' in result) return result;
        }
        if (service.env !== undefined) {
          const result = await step(name, 'env', service.env.command, service, logDir, signal);
          if ('ok' in result) return result;
          const values = parseEnvLines(result.stdout);
          const missing: string[] = [];
          const lines: string[] = [];
          for (const [target, source] of Object.entries(service.env.map)) {
            const value = values.get(source);
            if (value === undefined) {
              missing.push(source);
              continue;
            }
            out[target] = value;
            lines.push(envLine(target, value));
          }
          if (missing.length > 0) {
            return {
              ok: false,
              service: name,
              step: 'env',
              detail: `service ${name} env did not print ${missing.join(', ')}`,
              tail: '',
            };
          }
          if (service.env.file !== undefined) {
            try {
              written.push(
                writeWorktreeFile(input.worktree, service.env.file, `${lines.join('\n')}\n`),
              );
            } catch (error) {
              return {
                ok: false,
                service: name,
                step: 'env',
                detail: `service ${name} env file: ${(error as Error).message}`,
                tail: '',
              };
            }
          }
        }
      }
      return { ok: true, env: out };
    },
    cleanup() {
      for (const file of written.reverse()) restoreWorktreeFile(file);
      written = [];
    },
  };
}

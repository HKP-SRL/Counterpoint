// The owner's environment for a run (owner-identity: The owner's login environment, read at each
// run start; design D-2).
//
// At the start of every run Counterpoint asks the owner's own login shell for its environment and
// uses it, whole, for that run's sessions, gates and services, so a tool the owner installed and
// put on their PATH after Counterpoint started is found without a restart. The shell runs as
// `$SHELL -l -i -c '...'` (interactive, since the owner's PATH usually lives in `~/.zshrc`), from
// `$HOME`, with stdin closed, no terminal, `TERM=dumb` and a 10-second limit, in its own process
// group so a hanging startup file is ended with everything it started. It starts from the daemon's
// environment with the system PATH a fresh terminal window gets, so what the owner's startup files
// add is what counts. stderr is ignored, and a marker separates the environment from anything a
// startup file prints.
//
// Left out: Counterpoint's own variables (`COUNTERPOINT_*` and the `CP_*` process tags) and the
// probe shell's own state (`PWD`, `OLDPWD`, `SHLVL`, `_`), which describe that shell, not the
// owner. If the shell cannot be read, the run uses the daemon's environment and says why.
import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';

/** How long the owner's login shell may take to print its environment. */
export const LOGIN_SHELL_TIMEOUT_MS = 10_000;
/** The PATH a fresh terminal window starts from before the owner's startup files run. */
export const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

const MARKER = '__COUNTERPOINT_ENV__';
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SHELL_STATE = new Set(['PWD', 'OLDPWD', 'SHLVL', '_']);
const MAX_OUTPUT = 4 * 1024 * 1024;

export interface OwnerEnv {
  env: Record<string, string>;
  /** Null when the login shell was read; otherwise why the daemon's environment is used. */
  fallback: string | null;
}

/** True for a variable that is Counterpoint's own, not the owner's. */
export function isCounterpointVariable(name: string): boolean {
  return name.startsWith('COUNTERPOINT_') || name.startsWith('CP_');
}

/** `env` without Counterpoint's own variables (and without unset values). */
export function withoutCounterpoint(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== 'string' || isCounterpointVariable(name)) continue;
    out[name] = value;
  }
  return out;
}

/** Parses `env -0` output after the marker: `NAME=value` entries separated by NUL. */
export function parseEnvOutput(output: string): Record<string, string> | null {
  const at = output.indexOf(`${MARKER}\0`);
  const body = at < 0 ? output : output.slice(at + MARKER.length + 1);
  const env: Record<string, string> = {};
  let count = 0;
  for (const entry of body.split('\0')) {
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    const name = entry.slice(0, eq);
    if (!NAME_RE.test(name)) continue;
    env[name] = entry.slice(eq + 1);
    count += 1;
  }
  return count === 0 ? null : env;
}

export interface ReadOwnerEnvOptions {
  /** The daemon's environment: the base for the shell, and the fallback. */
  daemonEnv?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/**
 * The owner's environment, read from their login shell now. Never throws: a shell that cannot be
 * read gives the daemon's environment and the reason.
 */
export async function readOwnerEnv(options: ReadOwnerEnvOptions = {}): Promise<OwnerEnv> {
  const daemon = options.daemonEnv ?? process.env;
  const fallback = (why: string): OwnerEnv => ({
    env: withoutCounterpoint(daemon),
    fallback: `Your login shell's environment could not be read (${why}), so this run used the environment Counterpoint was started with.`,
  });
  const shell = daemon.SHELL;
  const home = daemon.HOME;
  if (shell === undefined || !isAbsolute(shell)) return fallback('SHELL is not set');
  if (home === undefined || !isAbsolute(home)) return fallback('HOME is not set');
  const timeoutMs = options.timeoutMs ?? LOGIN_SHELL_TIMEOUT_MS;

  const base = { ...withoutCounterpoint(daemon), PATH: SYSTEM_PATH, TERM: 'dumb' };
  const script = `printf '%s\\0' ${MARKER}; command env -0`;
  const outcome = await new Promise<{ output: string; problem: string | null; exit: string }>(
    (resolve) => {
      let output = '';
      let settled = false;
      let exit = 'it printed no environment';
      const finish = (problem: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ output, problem, exit });
      };
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(shell, ['-l', '-i', '-c', script], {
          cwd: home,
          env: base,
          stdio: ['ignore', 'pipe', 'ignore'],
          detached: true,
        });
      } catch (error) {
        resolve({ output: '', problem: (error as Error).message, exit });
        return;
      }
      const killAll = () => {
        if (child.pid === undefined) return;
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // already gone
        }
      };
      const timer = setTimeout(() => {
        killAll();
        const seconds = Math.max(1, Math.round(timeoutMs / 1000));
        finish(`it did not finish within ${seconds} second${seconds === 1 ? '' : 's'}`);
      }, timeoutMs);
      timer.unref();
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        if (output.length < MAX_OUTPUT) output += chunk;
      });
      child.on('error', (error) => finish(error.message));
      child.on('close', (code, signal) => {
        // Anything the startup files left running in the shell's group goes with it.
        killAll();
        if (code !== 0) {
          exit = signal !== null ? `it was ended by ${signal}` : `it exited with code ${code}`;
        }
        finish(null);
      });
    },
  );
  if (outcome.problem !== null) return fallback(outcome.problem);
  // A startup file may fail and still let `env` print: what was printed after the marker counts.
  const parsed = outcome.output.includes(`${MARKER}\0`) ? parseEnvOutput(outcome.output) : null;
  if (parsed === null) return fallback(outcome.exit);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (isCounterpointVariable(name) || SHELL_STATE.has(name)) continue;
    env[name] = value;
  }
  return { env, fallback: null };
}

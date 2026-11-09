// The `counterpoint` command. The default action starts (or attaches to) the one background
// daemon and registers the current repository; `stop` stops the daemon. The CLI re-enters itself
// as the daemon through the hidden `__daemon` command, so the daemon runs the same code.
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { Command, InvalidArgumentError } from 'commander';
import { runGit } from '../core/git/run.ts';
import {
  ConfigError,
  HomeMissingError,
  type HomePaths,
  homePaths,
  readConfig,
  requireHome,
  SocketPathTooLongError,
} from '../core/host/home.ts';
import { packageRoot } from '../server/app.ts';
import { controlRequest, isDaemonRunning } from './control-client.ts';

const START_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 10_000;
const KILL_GRACE_MS = 5_000;
const POLL_MS = 100;
const SQLITE_BUSY = 5;

/** Parent variables the daemon may inherit. */
const DAEMON_ENV_ALLOW_LIST = ['PATH', 'HOME', 'LANG', 'TMPDIR', 'COUNTERPOINT_HOME'] as const;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const consoleUrl = (port: number) => `http://127.0.0.1:${port}/`;

class CliExit extends Error {
  readonly code: number;

  constructor(code: number, message?: string) {
    super(message ?? '');
    this.code = code;
  }
}

function parsePort(value: string): number {
  if (!/^\d{1,5}$/.test(value) || Number(value) > 65535) {
    throw new InvalidArgumentError('Use a port number from 0 to 65535.');
  }
  return Number(value);
}

function packageVersion(): string {
  try {
    const manifest = JSON.parse(readFileSync(`${packageRoot()}/package.json`, 'utf8')) as {
      version?: unknown;
    };
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Resolves the home and its paths; a missing home is refused and nothing is created (D-08). */
function homeOrExit(): { home: string; paths: HomePaths } {
  try {
    const home = requireHome();
    return { home, paths: homePaths(home) };
  } catch (error) {
    if (
      error instanceof HomeMissingError ||
      error instanceof SocketPathTooLongError ||
      error instanceof ConfigError
    ) {
      throw new CliExit(2, error.message);
    }
    throw error;
  }
}

/** True while some process holds the daemon's single-instance lock. */
function lockHeld(paths: HomePaths): boolean {
  if (!existsSync(paths.lockDb)) return false;
  const db = new DatabaseSync(paths.lockDb, { timeout: 0 });
  try {
    db.exec('BEGIN EXCLUSIVE');
    db.exec('ROLLBACK');
    return false;
  } catch (error) {
    if ((error as { errcode?: number }).errcode === SQLITE_BUSY) return true;
    throw error;
  } finally {
    db.close();
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

async function insideGitRepo(cwd: string): Promise<boolean> {
  try {
    const result = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], {
      allowExitCodes: [0, 128],
    });
    return result.exitCode === 0 && result.stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/** Registers the repository containing the cwd, if any. Returns an error message on refusal. */
async function registerCwd(home: string, base: string | undefined): Promise<string | null> {
  const cwd = process.cwd();
  if (!(await insideGitRepo(cwd))) return null;
  const res = await controlRequest(home, 'POST', '/control/hosts', {
    cwd,
    ...(base === undefined ? {} : { base }),
  });
  if (res.status === 200) return null;
  const body = res.body as { error?: unknown } | null;
  return typeof body?.error === 'string'
    ? body.error
    : `Couldn't register this repository (status ${res.status}).`;
}

function spawnDaemon(paths: HomePaths, port: number): { exited: () => boolean } {
  mkdirSync(paths.logsDir, { recursive: true, mode: 0o700 });
  rmSync(paths.startResult, { force: true });
  const logFd = openSync(paths.daemonLog, 'a', 0o600);
  const env: Record<string, string> = {};
  for (const key of DAEMON_ENV_ALLOW_LIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  let exited = false;
  try {
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), '__daemon', '--port', String(port)],
      { detached: true, stdio: ['ignore', logFd, logFd], env, cwd: paths.home },
    );
    child.once('exit', () => {
      exited = true;
    });
    child.once('error', () => {
      exited = true;
    });
    child.unref();
  } finally {
    closeSync(logFd);
  }
  return { exited: () => exited };
}

interface StartOptions {
  port?: number;
  base?: string;
  open: boolean;
}

async function start(options: StartOptions): Promise<void> {
  const { home, paths } = homeOrExit();

  const running = await isDaemonRunning(home);
  if (running !== null) {
    console.log(`Counterpoint is already running at ${consoleUrl(running.port)}`);
    const refusal = await registerCwd(home, options.base);
    if (refusal !== null) throw new CliExit(1, refusal);
    return;
  }

  let port: number;
  try {
    port = options.port ?? readConfig(home).port;
  } catch (error) {
    if (error instanceof ConfigError) throw new CliExit(2, error.message);
    throw error;
  }

  const child = spawnDaemon(paths, port);
  const deadline = Date.now() + START_TIMEOUT_MS;
  let status = null;
  while (Date.now() < deadline) {
    status = await isDaemonRunning(home);
    if (status !== null) break;
    if (child.exited()) {
      const result = readJson(paths.startResult) as { error?: unknown; port?: unknown } | undefined;
      if (result?.error === 'port-in-use') {
        throw new CliExit(
          1,
          `Port ${port} is already in use. Free it, or choose a different port in the Counterpoint config.`,
        );
      }
      // Another daemon may have won the lock a moment earlier; give its socket one more look.
      status = await isDaemonRunning(home);
      if (status !== null) break;
      throw new CliExit(1, `Counterpoint did not start. See the log: ${paths.daemonLog}`);
    }
    await sleep(POLL_MS);
  }
  if (status === null) {
    throw new CliExit(1, `Counterpoint did not start in time. See the log: ${paths.daemonLog}`);
  }

  const refusal = await registerCwd(home, options.base);
  console.log(`Counterpoint is running at ${consoleUrl(status.port)}`);
  // Sign-in link and opening the browser (options.open) arrive with the sign-in flow.
  if (refusal !== null) throw new CliExit(1, refusal);
}

function pidFromDaemonJson(paths: HomePaths): { pid?: number; port?: number } {
  const info = readJson(paths.daemonJson) as { pid?: unknown; port?: unknown } | undefined;
  return {
    ...(typeof info?.pid === 'number' && Number.isInteger(info.pid) && info.pid > 1
      ? { pid: info.pid }
      : {}),
    ...(typeof info?.port === 'number' ? { port: info.port } : {}),
  };
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  ms: number,
): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(POLL_MS);
  }
  return predicate();
}

/** Socket dead but lock held: signal the pid recorded in daemon.json, SIGKILL after a grace. */
async function stopByPid(paths: HomePaths): Promise<number | undefined> {
  const { pid, port } = pidFromDaemonJson(paths);
  if (pid === undefined) {
    throw new CliExit(
      1,
      `Counterpoint's daemon holds its lock but doesn't answer, and ${paths.daemonJson} has no pid.`,
    );
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // already gone
  }
  if (!(await waitUntil(() => !lockHeld(paths), KILL_GRACE_MS))) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
    await waitUntil(() => !lockHeld(paths), KILL_GRACE_MS);
  }
  rmSync(paths.socket, { force: true });
  rmSync(paths.daemonJson, { force: true });
  return port;
}

async function stop(): Promise<void> {
  const { home, paths } = homeOrExit();
  const status = await isDaemonRunning(home);

  if (status !== null) {
    await controlRequest(home, 'POST', '/control/stop');
    const gone = await waitUntil(
      async () => !existsSync(paths.socket) && !lockHeld(paths),
      STOP_TIMEOUT_MS,
    );
    if (!gone) await stopByPid(paths);
    console.log(`Counterpoint stopped. The console at ${consoleUrl(status.port)} is closed.`);
    return;
  }

  if (!lockHeld(paths)) {
    console.log('Counterpoint is not running.');
    return;
  }

  const port = await stopByPid(paths);
  console.log(
    port === undefined
      ? 'Counterpoint stopped.'
      : `Counterpoint stopped. The console at ${consoleUrl(port)} is closed.`,
  );
}

async function daemon(options: { port?: number }): Promise<void> {
  const { home } = homeOrExit();
  const port = options.port ?? readConfig(home).port;
  const { runDaemon } = await import('../server/daemon.ts');
  await runDaemon({ home, port });
}

export function buildProgram(): Command {
  const program = new Command('counterpoint');
  program
    .description('Local mission control for autonomous spec-driven development with Claude Code')
    .version(packageVersion())
    .enablePositionalOptions()
    .option('--port <n>', 'port for the console (default: from the Counterpoint config)', parsePort)
    .option('--base <branch>', "this repository's base branch (default: detected)")
    .option('--no-open', "don't open the console in a browser")
    .action((options: StartOptions) => start(options));

  program
    .command('stop')
    .description('stop the background daemon')
    .action(() => stop());

  program
    .command('__daemon', { hidden: true })
    .option('--port <n>', 'port for the console', parsePort)
    .action((options: { port?: number }) => daemon(options));

  return program;
}

async function main(argv: readonly string[]): Promise<void> {
  try {
    await buildProgram().parseAsync([...argv]);
  } catch (error) {
    if (error instanceof CliExit) {
      if (error.message !== '') console.error(error.message);
      process.exit(error.code);
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  // The daemon keeps running on its own; every other command is done.
  if (argv[2] !== '__daemon') process.exit(0);
}

await main(process.argv);

// The `counterpoint` command. The default action starts (or attaches to) the one background
// daemon, registers the current repository and prints a one-time sign-in link; `open` prints a
// fresh link; `status` lists hosts; `init` creates the home; `stop` stops the daemon. The CLI
// re-enters itself as the daemon through the hidden `__daemon` command, so the daemon runs the
// same code.
import { spawn } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { Command, InvalidArgumentError } from 'commander';
import { execa } from 'execa';
import { runGit } from '../core/git/run.ts';
import {
  ConfigError,
  HomeMissingError,
  type HomePaths,
  homePaths,
  readConfig,
  requireHome,
  resolveHome,
  SocketPathTooLongError,
} from '../core/host/home.ts';
import { packageRoot } from '../server/app.ts';
import { approveCommand } from './approve.ts';
import { controlRequest, isDaemonRunning } from './control-client.ts';
import { doctorCommand } from './doctor.ts';
import {
  initKeyCommand,
  type TrustCommandOptions,
  trustHostCommand,
  trustKeyCommand,
} from './trust.ts';

const START_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 10_000;
const KILL_GRACE_MS = 5_000;
const POLL_MS = 100;
const SQLITE_BUSY = 5;

/** Parent variables the daemon may inherit. */
const DAEMON_ENV_ALLOW_LIST = ['PATH', 'HOME', 'LANG', 'TMPDIR', 'COUNTERPOINT_HOME'] as const;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const consoleUrl = (port: number) => `http://127.0.0.1:${port}/`;

/** The only shape of sign-in link the CLI prints or hands to a browser opener. */
const LOGIN_URL_RE = /^http:\/\/127\.0\.0\.1:\d{1,5}\/login\?code=[A-Za-z0-9_-]{43}$/;

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
    await printSignInLink(home, options.open);
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
  await printSignInLink(home, options.open);
  if (refusal !== null) throw new CliExit(1, refusal);
}

/** Asks the daemon (over the token-protected socket) for a fresh one-time sign-in link. */
async function mintSignInLink(home: string): Promise<string> {
  const res = await controlRequest(home, 'POST', '/control/login-code');
  const url = (res.body as { url?: unknown } | null)?.url;
  if (res.status !== 200 || typeof url !== 'string' || !LOGIN_URL_RE.test(url)) {
    throw new CliExit(1, "Counterpoint's daemon didn't return a sign-in link.");
  }
  return url;
}

/** Opens a validated sign-in link in the default browser (argument array, never a shell). */
async function openInBrowser(url: string): Promise<void> {
  const opener =
    process.platform === 'darwin'
      ? '/usr/bin/open'
      : process.platform === 'linux'
        ? 'xdg-open'
        : undefined;
  if (opener === undefined || !LOGIN_URL_RE.test(url)) return;
  const result = await execa(opener, [url], { stdio: 'ignore', reject: false, timeout: 10_000 });
  if (result.exitCode !== 0) {
    console.error("Couldn't open a browser. Open the sign-in link above yourself.");
  }
}

async function printSignInLink(home: string, open: boolean): Promise<void> {
  const url = await mintSignInLink(home);
  console.log(`Sign-in link (works once): ${url}`);
  if (open) await openInBrowser(url);
}

async function openCommand(options: { open: boolean }): Promise<void> {
  const { home } = homeOrExit();
  if ((await isDaemonRunning(home)) === null) {
    throw new CliExit(1, 'Counterpoint is not running. Start it with "counterpoint".');
  }
  await printSignInLink(home, options.open);
}

interface StatusHost {
  id: string;
  runway?: unknown;
  needsYou?: unknown;
}

function isStatusHost(value: unknown): value is StatusHost {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string'
  );
}

/** `{host}  running on 127.0.0.1:{port}` per host; runway and needs-you once the daemon has them. */
async function status(): Promise<void> {
  const { home } = homeOrExit();
  const running = await isDaemonRunning(home);
  if (running === null) {
    console.log('not running');
    return;
  }
  const hosts = running.hosts.filter(isStatusHost);
  if (hosts.length === 0) {
    console.log(`running on 127.0.0.1:${running.port}, no repositories registered yet`);
    return;
  }
  for (const host of hosts) {
    let line = `${host.id}  running on 127.0.0.1:${running.port}`;
    if (typeof host.runway === 'number') line += `  runway ${host.runway}`;
    if (typeof host.needsYou === 'number') line += `  needs you ${host.needsYou}`;
    console.log(line);
  }
}

/** Creates the home (only the final directory, mode 0700). Its parent must already exist (D-08). */
function init(): void {
  const home = resolveHome();
  try {
    homePaths(home);
  } catch (error) {
    if (error instanceof SocketPathTooLongError) throw new CliExit(2, error.message);
    throw error;
  }
  const existing = statSync(home, { throwIfNoEntry: false });
  if (existing !== undefined) {
    if (!existing.isDirectory()) {
      throw new CliExit(2, `"${home}" exists and is not a folder. Nothing was created.`);
    }
    console.log(`Counterpoint home is ready at "${home}".`);
    return;
  }
  const parent = dirname(home);
  if (statSync(parent, { throwIfNoEntry: false })?.isDirectory() !== true) {
    throw new CliExit(2, `The parent folder "${parent}" does not exist. Nothing was created.`);
  }
  try {
    mkdirSync(home, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  chmodSync(home, 0o700);
  console.log(`Created the Counterpoint home at "${home}".`);
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

/** Owner confirmation at the terminal: both stdin and stdout must be a TTY. */
function terminalPrompt(): TrustCommandOptions {
  return {
    isTTY: process.stdin.isTTY === true && process.stdout.isTTY === true,
    confirm: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
  };
}

/** Turns a command's exit code into the CLI's exit (0 returns normally). */
function exitWith(code: number): void {
  if (code !== 0) throw new CliExit(code);
}

async function trustKey(pub: string): Promise<void> {
  const { home } = homeOrExit();
  exitWith(await trustKeyCommand(home, pub, terminalPrompt()));
}

async function trustHost(hostId: string): Promise<void> {
  const { home } = homeOrExit();
  exitWith(await trustHostCommand(home, hostId, terminalPrompt()));
}

async function doctor(hostId: string | undefined): Promise<void> {
  const { home } = homeOrExit();
  exitWith(await doctorCommand(home, hostId));
}

async function approve(hostId: string, phaseId: string): Promise<void> {
  const { home } = homeOrExit();
  exitWith(
    await approveCommand({
      home,
      hostId,
      phaseId,
      isTTY: process.stdin.isTTY === true && process.stdout.isTTY === true,
    }),
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
    .command('open')
    .description('print (and open) a fresh one-time sign-in link for the console')
    .option('--no-open', "print the link but don't open a browser")
    .action((options: { open: boolean }) => openCommand(options));

  program
    .command('status')
    .description('show whether the daemon runs and which repositories it serves')
    .action(() => status());

  program
    .command('init')
    .description('create the Counterpoint home folder (its parent folder must exist)')
    .action(() => init());

  program
    .command('stop')
    .description('stop the background daemon')
    .action(() => stop());

  program
    .command('doctor')
    .description('check tools, the approval key and the agent sandbox (live probe) for a project')
    .argument('[host]', 'the registered project id (default: the project you are in)')
    .action((hostId: string | undefined) => doctor(hostId));

  program
    .command('init-key')
    .description('print how to create the dedicated, passphrase-protected approval key')
    .action(() => initKeyCommand());

  program
    .command('trust-key')
    .description('trust a public key for signing approvals (asks you to confirm)')
    .argument('<pub>', 'the public key file, for example ~/.ssh/counterpoint_approval.pub')
    .action((pub: string) => trustKey(pub));

  program
    .command('trust')
    .description("review a project's .git config and hooks and accept them as the baseline")
    .argument('<host>', 'the registered project id')
    .action((hostId: string) => trustHost(hostId));

  program
    .command('approve')
    .description(
      'sign a planned phase into the runway with your approval key (asks for its passphrase)',
    )
    .argument('<host>', 'the registered project id')
    .argument('<phase>', 'the phase id, for example 02 or 01.1')
    .action((hostId: string, phaseId: string) => approve(hostId, phaseId));

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

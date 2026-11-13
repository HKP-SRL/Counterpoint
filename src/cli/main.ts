// The `counterpoint` command. The default action starts (or attaches to) the one background
// daemon, registers the current repository and prints a one-time sign-in link; `open` prints a
// fresh link; `status` lists hosts; `init` creates the home; `stop` stops the daemon; `run`
// starts, stops and reports build runs (the console offers the same). The CLI re-enters itself as
// the daemon through the hidden `__daemon` command, so the daemon runs the same code. Approving is
// a click in the console.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname } from 'node:path';
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
  tightenHome,
} from '../core/host/home.ts';
import { packageRoot } from '../server/app.ts';
import { controlRequest, isDaemonRunning } from './control-client.ts';
import { INSTANCE_RE, isRecordedDaemon } from './daemon-process.ts';
import type { AskTransport } from './mcp-ask.ts';
import { runReportCommand, runStartCommand, runStatusCommand, runStopCommand } from './run.ts';

const START_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 10_000;
/** How long `stop` waits for a run to reach its clean point (a session finishing its task). */
const RUN_STOP_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const KILL_GRACE_MS = 5_000;
const POLL_MS = 100;
const SQLITE_BUSY = 5;

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

/** Resolves the home and its paths; a missing home is refused and nothing is created. */
function homeOrExit(): { home: string; paths: HomePaths } {
  try {
    const home = requireHome();
    const paths = homePaths(home);
    const notice = tightenHome(home);
    if (notice !== null) console.error(notice);
    return { home, paths };
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
  // The daemon acts as the owner: it gets the whole environment of the terminal that started it.
  // Each run reads the owner's login shell again, so a later PATH change needs no restart.
  const env = { ...process.env };
  let exited = false;
  try {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(import.meta.url),
        '__daemon',
        '--port',
        String(port),
        '--instance',
        randomBytes(16).toString('hex'),
      ],
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

/** Where xdg-open is looked for on Linux: absolute paths only, never a PATH lookup (IN-03). */
const XDG_OPEN_PATHS = ['/usr/bin/xdg-open', '/usr/local/bin/xdg-open', '/bin/xdg-open'] as const;

/** The absolute path of the system's browser opener, or undefined when there is none. */
function browserOpener(): string | undefined {
  if (process.platform === 'darwin') return '/usr/bin/open';
  if (process.platform !== 'linux') return undefined;
  return XDG_OPEN_PATHS.find((path) => {
    try {
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Opens a validated sign-in link in the default browser (argument array, never a shell).
 *
 * Accepted risk (IN-03, owner decision 2026-11-11): the one-time code is in the opener's argv for
 * the moment `open` runs, so a process running as the owner could read it with `ps`. The code
 * works once and expires; whoever uses it first gets a console session, the owner's own sign-in
 * then fails visibly, and a console session can never sign approvals (that needs the owner's key
 * and passphrase at a terminal).
 */
async function openInBrowser(url: string): Promise<void> {
  const opener = browserOpener();
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

/** Creates the home (only the final directory, mode 0700). Its parent must already exist. */
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
    const notice = tightenHome(home);
    if (notice !== null) console.error(notice);
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

function pidFromDaemonJson(paths: HomePaths): { pid?: number; port?: number; instance?: string } {
  const info = readJson(paths.daemonJson) as
    | { pid?: unknown; port?: unknown; instance?: unknown }
    | undefined;
  return {
    ...(typeof info?.pid === 'number' && Number.isInteger(info.pid) && info.pid > 1
      ? { pid: info.pid }
      : {}),
    ...(typeof info?.port === 'number' ? { port: info.port } : {}),
    ...(typeof info?.instance === 'string' && INSTANCE_RE.test(info.instance)
      ? { instance: info.instance }
      : {}),
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

/**
 * Socket dead but lock held: signal the pid recorded in daemon.json, SIGKILL after a grace, once
 * that pid is confirmed to be the recorded daemon.
 */
async function stopByPid(paths: HomePaths): Promise<number | undefined> {
  const { pid, port, instance } = pidFromDaemonJson(paths);
  if (pid === undefined) {
    throw new CliExit(
      1,
      `Counterpoint's daemon holds its lock but doesn't answer, and ${paths.daemonJson} has no pid.`,
    );
  }
  // Signal only a process confirmed to be the daemon this record describes (WR-08).
  if (instance === undefined || !(await isRecordedDaemon(pid, instance))) {
    throw new CliExit(
      1,
      `Counterpoint's daemon holds its lock but doesn't answer, and process ${pid} from ${paths.daemonJson} could not be confirmed as that daemon, so it was not signalled. Find the daemon with "ps -ax | grep __daemon" and stop it yourself.`,
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
    const answer = await controlRequest(home, 'POST', '/control/stop');
    // A run first stops at its next clean point (its session finishes the task it is on), which
    // can take a while; the daemon exits after it. Wait for it rather than signalling it.
    const withRun = (answer.body as { run?: unknown } | null)?.run === true;
    if (withRun) {
      console.log(
        'A run is going: it stops at its next clean point first, then Counterpoint stops.',
      );
      await waitUntil(async () => !existsSync(paths.socket), RUN_STOP_TIMEOUT_MS);
    }
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

/** Turns a command's exit code into the CLI's exit (0 returns normally). */
function exitWith(code: number): void {
  if (code !== 0) throw new CliExit(code);
}

async function runStart(
  hostId: string | undefined,
  flags: { model?: string; budget?: string; until?: string; changes?: string },
): Promise<void> {
  const { home } = homeOrExit();
  exitWith(await runStartCommand(home, hostId, flags));
}

async function runStop(hostId: string | undefined): Promise<void> {
  const { home } = homeOrExit();
  exitWith(await runStopCommand(home, hostId));
}

async function runStatus(hostId: string | undefined): Promise<void> {
  const { home } = homeOrExit();
  exitWith(await runStatusCommand(home, hostId));
}

function runReport(hostId: string | undefined): void {
  const { home } = homeOrExit();
  exitWith(runReportCommand(home, hostId));
}

/**
 * `counterpoint mcp ask`: the ask tool's stdio MCP server (owner-inbox D-5). A builder session gets
 * its capability in COUNTERPOINT_ASK_CAPABILITY. An interactive session has none: it opens its own
 * with the setup key from the owner-only file in the home (written by the setup card). Only
 * protocol messages go to stdout.
 */
async function mcpAsk(): Promise<void> {
  const { home } = homeOrExit();
  const capability = process.env.COUNTERPOINT_ASK_CAPABILITY ?? '';
  delete process.env.COUNTERPOINT_ASK_CAPABILITY;
  const { askKeyPath } = await import('../core/store/ask.ts');
  let key = '';
  if (capability === '') {
    try {
      key = readFileSync(askKeyPath(home), 'utf8').trim();
    } catch {
      // not set up
    }
    if (key === '') {
      throw new CliExit(
        2,
        "Not set up: answer the ask tool's setup card in Counterpoint's Needs You.",
      );
    }
  }
  const { createAskMcp, serveAskMcp, sessionTransport } = await import('./mcp-ask.ts');
  const withCapability =
    (bearer: string): AskTransport =>
    (method, path, body, options) =>
      controlRequest(home, method, path, body, { ...options, bearer });
  const transport =
    capability !== ''
      ? withCapability(capability)
      : sessionTransport(
          () =>
            controlRequest(
              home,
              'POST',
              '/control/ask/session',
              { cwd: process.cwd() },
              { bearer: key },
            ),
          withCapability,
        );
  await serveAskMcp(process.stdin, process.stdout, (notify) =>
    createAskMcp({ version: packageVersion(), notify, transport }),
  );
}

async function daemon(options: { port?: number; instance?: string }): Promise<void> {
  const { home } = homeOrExit();
  const port = options.port ?? readConfig(home).port;
  // A planned self-restart (owner-inbox D-10) passes its nonce here; no child process gets it.
  const handover = process.env.COUNTERPOINT_HANDOVER;
  delete process.env.COUNTERPOINT_HANDOVER;
  // Loading the daemon first proves this install runs before the previous daemon is asked to stop.
  const { runDaemon } = await import('../server/daemon.ts');
  const instance =
    options.instance !== undefined && INSTANCE_RE.test(options.instance)
      ? options.instance
      : undefined;
  let planned: string | undefined;
  if (handover !== undefined && /^[0-9a-f]{64}$/.test(handover)) {
    // Ask the running daemon to hand over. An answer cut short by its stopping still counts: the
    // lock and the handover record decide what happens next.
    const answer = await controlRequest(home, 'POST', '/control/handover', {
      nonce: handover,
    }).catch(() => null);
    if (answer !== null && answer.status !== 202) {
      console.log(JSON.stringify({ event: 'handover-refused', status: answer.status }));
      process.exit(1);
    }
    planned = handover;
  }
  await runDaemon({
    home,
    port,
    ...(instance === undefined ? {} : { instance }),
    ...(planned === undefined ? {} : { handover: planned }),
  });
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

  const run = program
    .command('run')
    .description('start a build run of approved changes (the console offers the same)')
    .argument('[host]', 'the registered project id (default: the project you are in)')
    .option('--model <model>', "the model builders use (default: the project's settings)")
    .option('--effort <level>', "low, medium, high, xhigh or max (default: the project's settings)")
    .option(
      '--budget <percent>',
      "context budget, % of the model window (default: the project's settings)",
    )
    .option('--until <HH:MM>', 'stop time: no new session starts after it')
    .option('--changes <a,b>', 'the runway changes to build (default: all of them)')
    .action(
      (
        hostId: string | undefined,
        flags: {
          model?: string;
          effort?: string;
          budget?: string;
          until?: string;
          changes?: string;
        },
      ) => runStart(hostId, flags),
    );
  run
    .command('stop')
    .description('stop the run at its next clean point')
    .argument('[host]', 'the registered project id')
    .action((hostId: string | undefined) => runStop(hostId));
  run
    .command('report')
    .description("print the project's latest run report")
    .argument('[host]', 'the registered project id')
    .action((hostId: string | undefined) => runReport(hostId));
  run
    .command('status')
    .description("show the project's current or last run")
    .argument('[host]', 'the registered project id')
    .action((hostId: string | undefined) => runStatus(hostId));

  program
    .command('mcp')
    .description('MCP servers for Claude Code sessions')
    .command('ask')
    .description("the ask tool: a session's questions become cards in Needs You")
    .action(() => mcpAsk());

  program
    .command('__daemon', { hidden: true })
    .option('--port <n>', 'port for the console', parsePort)
    .option('--instance <id>', 'the random id of this start')
    .action((options: { port?: number; instance?: string }) => daemon(options));

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

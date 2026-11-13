// The Counterpoint home (daemon-lifecycle: Home must exist before start): where the store, token,
// logs and run folders live. Earlier versions kept `trust/` and each host's `doctor.json` and
// `integrity.json` here; they are left on disk and no longer read.
//
// Resolution: COUNTERPOINT_HOME, else the platform default. A missing home is refused and never
// created here; only `counterpoint init` creates it, so state can never silently land on the
// internal disk when the Dock volume is not mounted.
import { chmodSync, lstatSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { assertHostId } from '../ids.ts';

export const DEFAULT_PORT = 4170;

/** macOS `sun_path` holds 104 bytes including the terminating NUL. */
const MAX_SOCKET_PATH_BYTES = 103;

export class HomeMissingError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(
      `Counterpoint home "${path}" does not exist. If it is on the Dock volume, is it mounted? Nothing was created.`,
    );
    this.name = 'HomeMissingError';
    this.path = path;
  }
}

export class SocketPathTooLongError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(
      `Control socket path "${path}" is ${Buffer.byteLength(path)} bytes; the limit is ${MAX_SOCKET_PATH_BYTES}. Choose a shorter Counterpoint home.`,
    );
    this.name = 'SocketPathTooLongError';
    this.path = path;
  }
}

export class ConfigError extends Error {
  readonly file: string;

  constructor(file: string, reason: string) {
    super(`Counterpoint config "${file}" is invalid: ${reason}`);
    this.name = 'ConfigError';
    this.file = file;
  }
}

/** Resolves the configured home path without touching the filesystem. */
export function resolveHome(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const explicit = env.COUNTERPOINT_HOME;
  if (explicit !== undefined && explicit !== '') return resolve(explicit);

  const userHome = env.HOME !== undefined && env.HOME !== '' ? env.HOME : homedir();
  if (platform === 'darwin') {
    return join(userHome, 'Library', 'Application Support', 'Counterpoint');
  }
  const xdg = env.XDG_DATA_HOME;
  if (xdg !== undefined && isAbsolute(xdg)) return join(xdg, 'counterpoint');
  return join(userHome, '.local', 'share', 'counterpoint');
}

/** Returns the home if it exists as a directory; otherwise throws HomeMissingError. Stat only. */
export function requireHome(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const home = resolveHome(env, platform);
  const stat = statSync(home, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isDirectory()) throw new HomeMissingError(home);
  return home;
}

export interface HomePaths {
  home: string;
  stateDb: string;
  runDir: string;
  lockDb: string;
  socket: string;
  daemonJson: string;
  startResult: string;
  token: string;
  logsDir: string;
  daemonLog: string;
  hostsDir: string;
  tmpDir: string;
}

/** Absolute paths of everything under the home. Rejects a control socket path over 103 bytes. */
export function homePaths(home: string): HomePaths {
  const root = resolve(home);
  const runDir = join(root, 'run');
  const logsDir = join(root, 'logs');
  const socket = join(runDir, 'daemon.sock');
  if (Buffer.byteLength(socket) > MAX_SOCKET_PATH_BYTES) throw new SocketPathTooLongError(socket);
  return {
    home: root,
    stateDb: join(root, 'state.db'),
    runDir,
    lockDb: join(runDir, 'daemon.lock.db'),
    socket,
    daemonJson: join(runDir, 'daemon.json'),
    startResult: join(runDir, 'start-result.json'),
    token: join(root, 'token'),
    logsDir,
    daemonLog: join(logsDir, 'daemon.log'),
    hostsDir: join(root, 'hosts'),
    tmpDir: join(root, 'tmp'),
  };
}

/** The per-host directory under the home; the id is validated before it touches a path. */
export function hostDir(home: string, hostId: string): string {
  return join(resolve(home), 'hosts', assertHostId(hostId));
}

const ConfigSchema = z.object({
  port: z.number().int().min(0).max(65535).optional(),
});

export interface CounterpointConfig {
  port: number;
}

/** Reads the optional `config.json` in the home. Absent file → defaults. */
export function readConfig(home: string): CounterpointConfig {
  const file = join(resolve(home), 'config.json');
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { port: DEFAULT_PORT };
    throw new ConfigError(file, (error as Error).message);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(file, (error as Error).message);
  }

  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw new ConfigError(file, `${where}${issue?.message ?? 'unexpected value'}`);
  }
  return { port: parsed.data.port ?? DEFAULT_PORT };
}

/**
 * Keeps the Counterpoint home private (IN-04): a home this user owns that group or others can
 * reach is set to 0700. Returns a one-line notice when it tightened the home, a warning when the
 * home is not this user's (it is left alone), and null when it was already private.
 */
export function tightenHome(home: string, uid: number = process.getuid?.() ?? -1): string | null {
  const stat = lstatSync(home, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isDirectory()) return null;
  if ((stat.mode & 0o077) === 0) return null;
  if (stat.uid !== uid) {
    return `Warning: the Counterpoint home "${home}" belongs to another user and others can reach it. Use a home you own.`;
  }
  chmodSync(home, 0o700);
  return `The Counterpoint home "${home}" was open to other users; it is now private (0700).`;
}

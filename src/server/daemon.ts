// The background daemon (D-05, D-06): one per machine, serving every registered host.
//
// Boot order: single-instance lock → token → console HTTP on 127.0.0.1 → control socket. The
// socket comes up last, so "the socket answers" means the daemon is fully up; liveness is never
// decided by a pid file. Crash-only: the kernel drops the SQLite lock on any death.
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import type { Server } from 'node:http';
import { connect } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { createAdaptorServer, serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { detectFramework } from '../compose.ts';
import { type HomePaths, homePaths } from '../core/host/home.ts';
import { clearAllSessions, deleteStaleLoginCodes } from '../core/security/login.ts';
import { openStore, type Store } from '../core/store/db.ts';
import { createApp, resolveUiDir } from './app.ts';
import { createControlApp, hashToken } from './control.ts';

const SQLITE_BUSY = 5;

export interface DaemonOptions {
  home: string;
  /** Port for the console; 0 binds an ephemeral port (tests). */
  port: number;
}

export interface DaemonInfo {
  pid: number;
  port: number;
  startedAt: string;
}

export interface StartResult {
  error: 'port-in-use';
  port: number;
}

// Kept at module level: the lock ends if the connection is garbage collected.
let lockConnection: DatabaseSync | undefined;

function log(event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), event, ...fields })}\n`);
}

/** Holds `BEGIN EXCLUSIVE` on the lock database. Returns false if another daemon holds it. */
function acquireLock(paths: HomePaths): boolean {
  const db = new DatabaseSync(paths.lockDb, { timeout: 0 });
  try {
    db.exec('BEGIN EXCLUSIVE');
  } catch (error) {
    db.close();
    if ((error as { errcode?: number }).errcode === SQLITE_BUSY) return false;
    throw error;
  }
  lockConnection = db;
  return true;
}

function releaseLock(): void {
  if (lockConnection === undefined) return;
  try {
    lockConnection.exec('ROLLBACK');
  } catch {
    // nothing to roll back
  }
  lockConnection.close();
  lockConnection = undefined;
}

/** Creates the 0600 token file if absent and returns its SHA-256. The token is never logged. */
function loadTokenHash(paths: HomePaths): Buffer {
  if (!existsSync(paths.token)) {
    try {
      const fd = openSync(paths.token, 'wx', 0o600);
      try {
        writeSync(fd, `${randomBytes(32).toString('hex')}\n`);
      } finally {
        closeSync(fd);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  chmodSync(paths.token, 0o600);
  return hashToken(readFileSync(paths.token, 'utf8').trim());
}

/** True when something accepts connections on the Unix socket. */
export function socketAnswers(socketPath: string, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(socketPath);
    const done = (answered: boolean) => {
      socket.destroy();
      resolve(answered);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function listenOnSocket(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(socketPath);
  });
}

function closeServer(server: Server | undefined): Promise<void> {
  if (server === undefined || !server.listening) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

export async function runDaemon(options: DaemonOptions): Promise<void> {
  // Everything the daemon creates is private to the owner.
  process.umask(0o077);
  const paths = homePaths(options.home);
  mkdirSync(paths.runDir, { recursive: true, mode: 0o700 });
  chmodSync(paths.runDir, 0o700);
  mkdirSync(paths.logsDir, { recursive: true, mode: 0o700 });

  if (!acquireLock(paths)) {
    log('already-running');
    console.log('Counterpoint is already running.');
    process.exit(0);
  }

  rmSync(paths.startResult, { force: true });
  const tokenHash = loadTokenHash(paths);

  if (existsSync(paths.socket)) {
    if (await socketAnswers(paths.socket)) {
      // We hold the lock, so nothing legitimate should answer here.
      log('socket-in-use', { socket: paths.socket });
      releaseLock();
      process.exit(1);
    }
    rmSync(paths.socket, { force: true });
    log('stale-socket-removed');
  }

  const store: Store = openStore(options.home);
  // Crash-only reconcile: a (re)started daemon signs every browser out and drops stale codes.
  clearAllSessions(store);
  deleteStaleLoginCodes(store);

  // Console HTTP. The app is created once the real port is known (port 0 → ephemeral); no
  // request can arrive before `listening`.
  let app: Hono | undefined;
  const http = serve({
    fetch: (request, env) => {
      if (app === undefined) return new Response('starting', { status: 503 });
      return app.fetch(request, env);
    },
    port: options.port,
    hostname: '127.0.0.1',
  }) as Server;

  // serve() has already called listen(); wait for the outcome.
  const bound = await new Promise<number>((resolve, reject) => {
    const onListening = () => {
      http.off('error', onError);
      const address = http.address();
      if (address !== null && typeof address === 'object') resolve(address.port);
      else reject(new Error('The console server has no address.'));
    };
    const onError = (error: Error) => {
      http.off('listening', onListening);
      reject(error);
    };
    if (http.listening) {
      onListening();
      return;
    }
    http.once('listening', onListening);
    http.once('error', onError);
  }).catch((error: NodeJS.ErrnoException): never => {
    if (error.code === 'EADDRINUSE') {
      const result: StartResult = { error: 'port-in-use', port: options.port };
      writeFileSync(paths.startResult, `${JSON.stringify(result)}\n`, { mode: 0o600 });
      log('port-in-use', { port: options.port });
    } else {
      log('http-listen-failed', { code: error.code ?? null, message: error.message });
    }
    store.close();
    releaseLock();
    process.exit(1);
  });

  app = createApp({ store, port: bound, uiDir: resolveUiDir() });

  let stopping = false;
  let control: Server | undefined;

  const stop = async (reason: string) => {
    if (stopping) return;
    stopping = true;
    log('stopping', { reason });
    await Promise.all([closeServer(control), closeServer(http)]);
    rmSync(paths.socket, { force: true });
    rmSync(paths.daemonJson, { force: true });
    store.close();
    releaseLock();
    log('stopped');
    process.exit(0);
  };

  const controlApp = createControlApp({
    store,
    tokenHash,
    port: bound,
    onStop: () => void stop('control'),
    detectFramework,
  });
  control = createAdaptorServer({ fetch: controlApp.fetch }) as Server;
  await listenOnSocket(control, paths.socket);
  chmodSync(paths.socket, 0o600);

  const info: DaemonInfo = { pid: process.pid, port: bound, startedAt: new Date().toISOString() };
  writeFileSync(paths.daemonJson, `${JSON.stringify(info)}\n`, { mode: 0o600 });

  process.once('SIGTERM', () => void stop('SIGTERM'));
  process.once('SIGINT', () => void stop('SIGINT'));
  log('started', { pid: process.pid, port: bound });
}

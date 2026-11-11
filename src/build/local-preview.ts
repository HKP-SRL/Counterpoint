// Local previews, on demand (pull-requests: Preview link; owner decision 2026-11-11: a local
// preview starts when the owner opens it, never overnight).
//
// For a host without preview deploys, a green change's PR links to a console page. From there
// the owner starts the host config's preview command (read at the change's approved base) in the
// change's worktree, on a free loopback port from 4174 up, and stops it again. Nothing is kept
// across a daemon restart: the page simply offers Start again.
//
// The preview runs builder-written code, so it runs like a gate: under srt with the gate profile
// (writes only the worktree and a temp dir, reads nothing protected, network only to the
// config's listed ports), detached in its own process group, tagged for the sweep. The one
// difference is local binding, which a server needs. Claude Code's docs and a live check
// (2026-11-11, srt 0.0.82) agree that binding also lets the process connect to any loopback port,
// the console's included; the console still demands the owner's session cookie and Origin, and a
// preview only runs while the owner has it started. Starting a build of the change stops its
// preview first.
import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  realpathSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { connect, createServer } from 'node:net';
import { join } from 'node:path';
import { killGroup } from '../agent/runner.ts';
import { hostDir } from '../core/host/home.ts';
import { HostConfigError, readHostConfig } from '../core/host/host-config.ts';
import { HOST_ID_RE, isChangeId } from '../core/ids.ts';
import type { Store } from '../core/store/db.ts';
import { latestBuiltRunChange } from '../core/store/runs.ts';
import { protectedPathsFor } from '../doctor/run.ts';
import { GATE_TAG_ENV, gateEnv, lastLines, newGateTag, stripTerminal } from './gate-runner.ts';
import { buildGateSandboxSettings, gateArgv } from './gate-sandbox.ts';
import type { RunHost } from './orchestrator.ts';
import { sweepTagged } from './process-sweep.ts';
import { worktreePathFor } from './worktrees.ts';

export const FIRST_PREVIEW_PORT = 4174;
const PORT_SPAN = 200;
const READY_TIMEOUT_MS = 3 * 60 * 1000;
const READY_POLL_MS = 500;
const KILL_GRACE_MS = 5000;
const KEEP_BYTES = 64 * 1024;

export type PreviewState = 'stopped' | 'starting' | 'running' | 'exited';

export interface PreviewStatus {
  hostId: string;
  change: string;
  state: PreviewState;
  /** The preview's address while starting or running. */
  url: string | null;
  port: number | null;
  startedAt: number | null;
  /** Why it is not running (exited, could not start), in plain words. */
  reason: string | null;
  /** The last lines of its output. */
  tail: string;
}

export type PreviewStart =
  | { ok: true; status: PreviewStatus }
  | { ok: false; status: 404 | 409 | 422; error: string };

interface Running {
  status: PreviewStatus;
  pid: number | undefined;
  tag: string;
  kept: string;
  stopping: boolean;
  scratch: string;
}

export interface LocalPreviewOptions {
  home: string;
  db: Store;
  host: (hostId: string) => RunHost | null;
  consolePort: number;
  /** Tells open consoles a preview changed (ids only). */
  publish: (hostId: string, payload: Record<string, unknown>) => void;
  /** Seams for tests. */
  isPortFree?: (port: number) => Promise<boolean>;
  isListening?: (port: number) => Promise<boolean>;
  argv?: (
    settingsPath: string,
    command: readonly string[],
    env: Record<string, string>,
  ) => string[];
  readyTimeoutMs?: number;
  now?: () => number;
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1');
    const done = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

const key = (hostId: string, change: string) => `${hostId}\0${change}`;

export class LocalPreviews {
  readonly #o: LocalPreviewOptions;
  readonly #running = new Map<string, Running>();
  readonly #now: () => number;

  constructor(options: LocalPreviewOptions) {
    this.#o = options;
    this.#now = options.now ?? Date.now;
  }

  status(hostId: string, change: string): PreviewStatus {
    return (
      this.#running.get(key(hostId, change))?.status ?? {
        hostId,
        change,
        state: 'stopped',
        url: null,
        port: null,
        startedAt: null,
        reason: null,
        tail: '',
      }
    );
  }

  #publish(status: PreviewStatus): void {
    try {
      this.#o.publish(status.hostId, { preview: status.change, state: status.state });
    } catch {
      // the console refetches
    }
  }

  async #freePort(config: { ports: readonly number[] }): Promise<number | null> {
    const taken = new Set<number>([this.#o.consolePort, ...config.ports]);
    for (const running of this.#running.values()) {
      if (running.status.port !== null) taken.add(running.status.port);
    }
    for (let port = FIRST_PREVIEW_PORT; port < FIRST_PREVIEW_PORT + PORT_SPAN; port += 1) {
      if (taken.has(port)) continue;
      if (await (this.#o.isPortFree ?? portFree)(port)) return port;
    }
    return null;
  }

  async start(hostId: string, change: string): Promise<PreviewStart> {
    if (!HOST_ID_RE.test(hostId) || !isChangeId(change)) {
      return { ok: false, status: 404, error: 'Unknown project or change.' };
    }
    const existing = this.#running.get(key(hostId, change));
    if (
      existing !== undefined &&
      (existing.status.state === 'starting' || existing.status.state === 'running')
    ) {
      return { ok: true, status: existing.status };
    }
    const runtime = this.#o.host(hostId);
    if (runtime === null) return { ok: false, status: 404, error: `Unknown project ${hostId}.` };
    const built = latestBuiltRunChange(this.#o.db, hostId, change);
    if (built === undefined || built.worktree === null || built.baseCommit === null) {
      return {
        ok: false,
        status: 404,
        error: `${change} has not been built yet, so there is nothing to preview.`,
      };
    }
    if (built.state === 'building') {
      return {
        ok: false,
        status: 409,
        error: `${change} is being built right now. Preview it once the run has moved on.`,
      };
    }
    // The stored path is only a hint: the preview runs in the change's own worktree or nowhere.
    let worktree: string;
    try {
      worktree = worktreePathFor(runtime.host.root, change);
      if (!existsSync(worktree) || realpathSync(worktree) !== realpathSync(built.worktree))
        throw new Error();
    } catch {
      return {
        ok: false,
        status: 409,
        error: `${change}'s worktree is gone. Build the change again to preview it.`,
      };
    }
    let preview: { command: string[]; ports: number[] } | null;
    try {
      preview = (await readHostConfig(runtime.reader, built.baseCommit)).preview;
    } catch (error) {
      const message = error instanceof HostConfigError ? error.message : (error as Error).message;
      return {
        ok: false,
        status: 422,
        error: `The host config at the approved base could not be read: ${message}`,
      };
    }
    if (preview === null) {
      return {
        ok: false,
        status: 422,
        error: "The host's Counterpoint config names no preview command.",
      };
    }
    const port = await this.#freePort(preview);
    if (port === null)
      return { ok: false, status: 409, error: 'No free loopback port for a preview.' };

    const scratch = join(hostDir(this.#o.home, hostId), 'previews', change);
    rmSync(scratch, { recursive: true, force: true });
    const tmpDir = join(scratch, 'tmp');
    mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
    const settings = buildGateSandboxSettings({
      protectedPaths: protectedPathsFor({ home: this.#o.home, host: runtime.host }),
      workdir: worktree,
      tmpDir,
      ports: preview.ports,
      consolePort: this.#o.consolePort,
    });
    const settingsPath = join(scratch, 'preview-settings.json');
    writeFileSync(
      settingsPath,
      JSON.stringify({ ...settings, network: { ...settings.network, allowLocalBinding: true } }),
      { mode: 0o600, flag: 'wx' },
    );
    const command = preview.command.map((arg) => arg.replaceAll('{port}', String(port)));
    const tag = newGateTag();
    const argv = (this.#o.argv ?? gateArgv)(settingsPath, command, {
      TMPDIR: tmpDir,
      PORT: String(port),
    });
    const log = openSync(join(scratch, 'preview.log'), 'a', 0o600);
    const status: PreviewStatus = {
      hostId,
      change,
      state: 'starting',
      url: `http://127.0.0.1:${port}/`,
      port,
      startedAt: this.#now(),
      reason: null,
      tail: '',
    };
    const running: Running = { status, pid: undefined, tag, kept: '', stopping: false, scratch };
    this.#running.set(key(hostId, change), running);

    const keep = (chunk: string) => {
      writeSync(log, chunk);
      running.kept = (running.kept + chunk).slice(-KEEP_BYTES);
    };
    const child = spawn(argv[0] as string, argv.slice(1), {
      cwd: worktree,
      env: gateEnv(process.env, {}, tag),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    running.pid = child.pid;
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    let exited = false;
    const onExit = (reason: string) => {
      if (exited) return;
      exited = true;
      closeSync(log);
      if (running.pid !== undefined) killGroup(running.pid, 'SIGKILL');
      void sweepTagged(GATE_TAG_ENV, tag, { graceMs: 1000 });
      if (this.#running.get(key(hostId, change)) !== running) return;
      const tail = lastLines(stripTerminal(running.kept), 30);
      // A reason set by stop() (the port never opened) wins over the exit itself.
      running.status = running.stopping
        ? {
            ...running.status,
            state: 'stopped',
            url: null,
            port: null,
            startedAt: null,
            reason: null,
            tail,
          }
        : {
            ...running.status,
            state: 'exited',
            url: null,
            port: null,
            reason: running.status.reason ?? reason,
            tail,
          };
      this.#publish(running.status);
    };
    child.on('error', (error) => onExit(`The preview could not start: ${error.message}`));
    child.on('close', (code, signal) =>
      onExit(
        signal !== null
          ? `The preview stopped (${signal}).`
          : `The preview exited with code ${code ?? '?'}.`,
      ),
    );
    this.#publish(status);
    void this.#waitReady(running, port);
    return { ok: true, status };
  }

  async #waitReady(running: Running, port: number): Promise<void> {
    const deadline = this.#now() + (this.#o.readyTimeoutMs ?? READY_TIMEOUT_MS);
    while (running.status.state === 'starting') {
      if (await (this.#o.isListening ?? listening)(port)) {
        if (running.status.state !== 'starting') return;
        running.status = { ...running.status, state: 'running' };
        this.#publish(running.status);
        return;
      }
      if (this.#now() >= deadline) {
        this.stop(
          running.status.hostId,
          running.status.change,
          'The preview did not open its port within 3 minutes.',
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
    }
  }

  /** Stops the change's preview (its whole process group, then the tag sweep). */
  stop(hostId: string, change: string, reason?: string): boolean {
    const running = this.#running.get(key(hostId, change));
    if (
      running === undefined ||
      (running.status.state !== 'starting' && running.status.state !== 'running')
    ) {
      return false;
    }
    running.stopping = reason === undefined;
    if (reason !== undefined) running.status = { ...running.status, reason };
    const pid = running.pid;
    if (pid !== undefined) {
      killGroup(pid, 'SIGTERM');
      setTimeout(() => killGroup(pid, 'SIGKILL'), KILL_GRACE_MS).unref();
    }
    return true;
  }

  /** Stops every preview and waits for them to exit (daemon shutdown). */
  async stopAll(): Promise<void> {
    const waits: Promise<void>[] = [];
    for (const running of this.#running.values()) {
      if (this.stop(running.status.hostId, running.status.change)) {
        waits.push(
          new Promise((resolve) => {
            const check = () =>
              running.status.state === 'starting' || running.status.state === 'running'
                ? setTimeout(check, 100)
                : resolve();
            check();
          }),
        );
      }
    }
    await Promise.race([
      Promise.all(waits),
      new Promise((resolve) => setTimeout(resolve, KILL_GRACE_MS + 1000)),
    ]);
  }
}

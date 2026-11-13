// The AgentRunner port and its `claude -p` stream-json implementation.
//
// Counterpoint drives the owner's own `claude` binary (non-`--bare`, so the subscription login
// and user settings work). Everything else about the session comes from the argv built by
// buildClaudeArgv. The process gets the run's environment, the owner's own (sessionEnv; owner-
// identity: Sessions run as the owner), stdin is ignored (claude otherwise waits 3 s for stdin),
// and the raw stream is appended to a log file so a verdict can always be traced back to what the
// session actually printed.
//
// Builders use the streaming mode instead (`start`): stdin carries stream-json user messages and
// control requests, events are delivered as they arrive, and the session runs in its own process
// group tagged with `CP_AGENT_RUN=<tag>`, so a stop, a timeout or crash recovery can end it and
// everything it started.
//
// When any session ends (builder, calibration, owner step), what is left of its group is killed and
// the owner's processes are swept for its tag (process-sweep.ts): a database or dev server the
// session started in a group of its own would otherwise keep a port or the machine-wide test lock,
// and every later gate would wait on it (first-unattended-run design 3.3). The session counts as
// ended when claude exits, even if such a process still holds its output (child-end.ts).
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  accessSync,
  appendFileSync,
  closeSync,
  constants,
  mkdirSync,
  openSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { execa } from 'execa';
import { DEFAULT_DRAIN_MS, watchChildEnd } from '../build/child-end.ts';
import { withoutCounterpoint } from '../build/owner-env.ts';
import { sweepTagged, type TaggedProcess } from '../build/process-sweep.ts';

/** A stream-json event as printed by claude (`system`, `assistant`, `user`, `result`, ...). */
export interface KnownStreamEvent {
  readonly type: string;
  readonly subtype?: string;
  readonly [key: string]: unknown;
}

/** A line that was not a JSON object with a string `type`. Kept verbatim, never dropped. */
export interface UnknownStreamEvent {
  readonly type: 'unknown';
  readonly raw: string;
}

export type StreamEvent = KnownStreamEvent | UnknownStreamEvent;

export interface AgentRunRequest {
  /** Arguments after the binary (from buildClaudeArgv). */
  argv: readonly string[];
  /** The session's working directory. */
  cwd: string;
  /** The run's environment (the owner's). Defaults to the daemon's own. */
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  /** The raw stdout stream is appended here (created 0600 if missing). */
  rawLogPath: string;
}

export interface AgentRun {
  events: StreamEvent[];
  /** The raw stdout text, exactly as received. */
  raw: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  /** The last `result` event, if the session produced one. */
  result: StreamEvent | null;
}

export interface AgentRunner {
  run(request: AgentRunRequest): Promise<AgentRun>;
  /** Starts a streaming session (builders). Optional so test doubles can omit it. */
  start?(request: AgentSessionRequest): Promise<AgentSession>;
  /** The agent CLI's version string, or null when it cannot be read. */
  version?(): Promise<string | null>;
}

/** The environment variable that tags every process of one agent session (crash sweep). */
export const AGENT_TAG_ENV = 'CP_AGENT_RUN';
const PROCESS_TAG_RE = /^[A-Za-z0-9_-]{8,64}$/;

export interface AgentSessionRequest {
  /** Arguments after the binary, from buildClaudeArgv with `streamInput: true`. */
  argv: readonly string[];
  cwd: string;
  /** The run's environment (the owner's). Defaults to the daemon's own. */
  env?: NodeJS.ProcessEnv;
  /** Hard limit for the whole session; the process group is killed when it passes. */
  timeoutMs: number;
  /** The raw stdout stream is appended here as it arrives (created 0600 if missing). */
  rawLogPath: string;
  /** Set as `CP_AGENT_RUN` in the session's environment; inherited by its children. */
  processTag: string;
  /** Called for every event, in order, as it arrives. Exceptions are swallowed. */
  onEvent?: (event: StreamEvent) => void;
}

export interface AgentSessionEnd {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  /** True when the orchestrator killed the process group (forced end or timeout). */
  killed: boolean;
  /** The last `result` event, if any. */
  result: StreamEvent | null;
  /** At most the last 64 KiB of stderr. */
  stderr: string;
  /** Processes carrying the session's tag that outlived it, found and ended by the sweep. */
  survivors?: TaggedProcess[];
  /** Why the sweep could not look, when it could not. */
  sweepError?: string | null;
}

/** A live `claude -p --input-format stream-json` session. */
export interface AgentSession {
  /** The session's pid, which is also its process group id (spawned detached). */
  readonly pid: number;
  readonly processTag: string;
  /** Sends one user message. Throws once input is closed. */
  send(text: string): void;
  /** Asks claude to abort the current turn; resolves true when it confirms within the timeout. */
  interrupt(timeoutMs?: number): Promise<boolean>;
  /** Closes input: the current turn runs to its end, then the process exits. */
  endInput(): void;
  /** Kills the whole process group: SIGTERM, then SIGKILL after `graceMs`. */
  kill(graceMs?: number): void;
  readonly done: Promise<AgentSessionEnd>;
}

const STDERR_KEEP = 64 * 1024;
/** After a kill's SIGKILL and the drain time, how much longer a session may take to end. */
const GIVE_UP_EXTRA_MS = 1000;

/**
 * The environment a session runs with: the run's (the owner's whole environment, without
 * Counterpoint's own variables), with Claude Code's subprocess scrub opted out. On claude 2.1.321
 * the scrub forced `--permission-mode auto` down to `default` in every session (seen live,
 * 2026-11-10), so sessions never ran in the auto mode the owner chose.
 */
export function sessionEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return { ...withoutCounterpoint(env), CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '0' };
}

/** Signals a whole process group; a group that is already gone is fine. */
export function killGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch {
    // ESRCH: already gone
  }
}

function startSession(
  binary: string,
  request: AgentSessionRequest,
  sweep: typeof sweepTagged,
): AgentSession {
  if (!PROCESS_TAG_RE.test(request.processTag)) throw new Error('Invalid process tag.');
  mkdirSync(dirname(request.rawLogPath), { recursive: true, mode: 0o700 });
  const log = openSync(request.rawLogPath, 'a', 0o600);
  const env = { ...sessionEnv(request.env), [AGENT_TAG_ENV]: request.processTag };
  const child = spawn(binary, [...request.argv], {
    cwd: request.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });
  if (child.pid === undefined) {
    closeSync(log);
    throw new Error('The agent session could not be started.');
  }
  const pid = child.pid;
  const watch = watchChildEnd(child, DEFAULT_DRAIN_MS);
  let logClosed = false;
  let inputOpen = true;
  let killed = false;
  let timedOut = false;
  let result: StreamEvent | null = null;
  let stderr = '';
  let pending = '';
  const waiters = new Map<string, (ok: boolean) => void>();

  const emit = (event: StreamEvent): void => {
    if (event.type === 'result') result = event;
    if (event.type === 'control_response') {
      const response = (event as KnownStreamEvent).response as
        | { request_id?: unknown; subtype?: unknown }
        | undefined;
      const id = typeof response?.request_id === 'string' ? response.request_id : null;
      const waiter = id === null ? undefined : waiters.get(id);
      if (id !== null && waiter !== undefined) {
        waiters.delete(id);
        waiter(response?.subtype === 'success');
      }
    }
    try {
      request.onEvent?.(event);
    } catch {
      // an observer must not break the stream
    }
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    if (logClosed) return;
    writeSync(log, chunk);
    pending += chunk;
    let at = pending.indexOf('\n');
    while (at >= 0) {
      const line = pending.slice(0, at);
      pending = pending.slice(at + 1);
      if (line.trim() !== '') emit(parseLine(line));
      at = pending.indexOf('\n');
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_KEEP);
  });
  // A write after claude exits raises EPIPE on stdin; the exit itself is reported by `done`.
  child.stdin.on('error', () => {
    inputOpen = false;
  });

  const kill = (graceMs = 5000): void => {
    killed = true;
    inputOpen = false;
    killGroup(pid, 'SIGTERM');
    setTimeout(() => killGroup(pid, 'SIGKILL'), graceMs).unref();
    // A process that does not die cannot hold the run: the session ends a little later anyway.
    setTimeout(() => watch.giveUp(), graceMs + DEFAULT_DRAIN_MS + GIVE_UP_EXTRA_MS).unref();
  };
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, request.timeoutMs);
  timer.unref();

  const done = watch.ended.then(async ({ exitCode, signal }): Promise<AgentSessionEnd> => {
    clearTimeout(timer);
    if (pending.trim() !== '') emit(parseLine(pending));
    pending = '';
    logClosed = true;
    closeSync(log);
    for (const waiter of waiters.values()) waiter(false);
    waiters.clear();
    inputOpen = false;
    // Children that outlived claude in its group (a backgrounded command) go with it; then the
    // tag sweep for what left the group.
    killGroup(pid, 'SIGKILL');
    const swept = await sweep(AGENT_TAG_ENV, request.processTag, { graceMs: 1000 });
    return {
      exitCode,
      signal,
      timedOut,
      killed,
      result,
      stderr,
      survivors: swept.found,
      sweepError: swept.error,
    };
  });

  const write = (message: object): void => {
    if (!inputOpen) throw new Error('The session no longer takes input.');
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  return {
    pid,
    processTag: request.processTag,
    send(text: string) {
      if (typeof text !== 'string' || text.trim() === '') throw new Error('Empty message.');
      write({ type: 'user', message: { role: 'user', content: text } });
    },
    interrupt(timeoutMs = 10_000) {
      const id = `cp-${randomBytes(6).toString('hex')}`;
      return new Promise<boolean>((resolveInterrupt) => {
        const timer_ = setTimeout(() => {
          waiters.delete(id);
          resolveInterrupt(false);
        }, timeoutMs);
        timer_.unref();
        waiters.set(id, (ok) => {
          clearTimeout(timer_);
          resolveInterrupt(ok);
        });
        try {
          write({ type: 'control_request', request_id: id, request: { subtype: 'interrupt' } });
        } catch {
          waiters.delete(id);
          clearTimeout(timer_);
          resolveInterrupt(false);
        }
      });
    },
    endInput() {
      if (!inputOpen) return;
      inputOpen = false;
      child.stdin.end();
    },
    kill,
    done,
  };
}

/** Parses stream-json text: one event per non-empty line. */
export function parseStreamJson(text: string): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    events.push(parseLine(line));
  }
  return events;
}

function parseLine(line: string): StreamEvent {
  try {
    const value: unknown = JSON.parse(line);
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof (value as { type?: unknown }).type === 'string'
    ) {
      return value as KnownStreamEvent;
    }
  } catch {
    // fall through
  }
  return { type: 'unknown', raw: line };
}

/** A stderr line that speaks about the permission mode or auto mode. */
const MODE_NOTICE_RE = /permission mode|auto mode/i;

/**
 * The permission modes a session really ran in, as claude itself reports them: one entry
 * per `system/init` event, in order (a retried session has two), holding its `permissionMode`
 * when that is a string and `null` otherwise. `notices` are the trimmed, non-empty stderr lines
 * that mention the permission mode or auto mode (claude 2.1.321 printed `⚠ Permission mode forced
 * to default …` when it overrode the requested mode). Read from structured data only: never from
 * the argv the session was launched with, nor from the model's prose.
 */
export function sessionModeEvidence(run: { events: readonly StreamEvent[]; stderr: string }): {
  modes: Array<string | null>;
  notices: string[];
} {
  const modes: Array<string | null> = [];
  for (const event of run.events) {
    const known = event as KnownStreamEvent;
    if (known.type !== 'system' || known.subtype !== 'init') continue;
    const mode = known.permissionMode;
    modes.push(typeof mode === 'string' ? mode : null);
  }
  const notices = run.stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && MODE_NOTICE_RE.test(line));
  return { modes, notices };
}

/** The absolute real path of the `claude` binary on PATH. */
export function resolveClaudeBinary(parentEnv: NodeJS.ProcessEnv = process.env): string {
  for (const dir of (parentEnv.PATH ?? '').split(delimiter)) {
    if (dir === '' || !isAbsolute(dir)) continue;
    const candidate = join(dir, 'claude');
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {
      // not here; keep looking
    }
  }
  throw new Error('claude was not found on PATH.');
}

/** `claude --version`, trimmed; null when it cannot be run. */
export async function claudeVersion(
  binary?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  try {
    const result = await execa(binary ?? resolveClaudeBinary(env), ['--version'], {
      env: sessionEnv(env),
      extendEnv: false,
      stdin: 'ignore',
      timeout: 15_000,
      reject: false,
    });
    const out = String(result.stdout ?? '').trim();
    return result.exitCode === 0 && out !== '' ? out : null;
  } catch {
    return null;
  }
}

export class ClaudeCliRunner implements AgentRunner {
  readonly binary: string;
  /** The environment sessions get when a request names none (the run's). */
  readonly #env: NodeJS.ProcessEnv;
  readonly #sweep: typeof sweepTagged;

  constructor(
    options: { binary?: string; env?: NodeJS.ProcessEnv; sweep?: typeof sweepTagged } = {},
  ) {
    this.#env = options.env ?? process.env;
    this.#sweep = options.sweep ?? sweepTagged;
    // Resolved once, from the run's PATH, to an absolute real path.
    this.binary = options.binary ?? resolveClaudeBinary(this.#env);
    if (!isAbsolute(this.binary)) throw new Error('The claude binary path must be absolute.');
  }

  async run(request: AgentRunRequest): Promise<AgentRun> {
    mkdirSync(dirname(request.rawLogPath), { recursive: true, mode: 0o700 });
    // Tagged like a streaming session, so what it started is swept when it ends.
    const tag = randomBytes(16).toString('hex');
    const result = await execa(this.binary, [...request.argv], {
      cwd: request.cwd,
      env: { ...sessionEnv(request.env ?? this.#env), [AGENT_TAG_ENV]: tag },
      extendEnv: false,
      stdin: 'ignore',
      timeout: request.timeoutMs,
      cleanup: true,
      reject: false,
      stripFinalNewline: false,
      encoding: 'utf8',
    });
    await this.#sweep(AGENT_TAG_ENV, tag, { graceMs: 1000 });
    const raw = String(result.stdout ?? '');
    appendFileSync(request.rawLogPath, raw, { mode: 0o600 });
    const events = parseStreamJson(raw);
    const result_ = [...events].reverse().find((event) => event.type === 'result') ?? null;
    return {
      events,
      raw,
      stderr: String(result.stderr ?? ''),
      exitCode: result.exitCode ?? null,
      timedOut: result.timedOut === true,
      result: result_,
    };
  }

  async start(request: AgentSessionRequest): Promise<AgentSession> {
    return startSession(this.binary, { ...request, env: request.env ?? this.#env }, this.#sweep);
  }

  version(): Promise<string | null> {
    return claudeVersion(this.binary, this.#env);
  }
}

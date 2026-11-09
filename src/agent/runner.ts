// The AgentRunner port and its `claude -p` stream-json implementation.
//
// Counterpoint drives the owner's own `claude` binary (non-`--bare`, so the subscription login
// and user settings work). Everything else about the session comes from the argv built by
// buildClaudeArgv. The process gets an allow-listed environment (agentEnv), stdin is ignored
// (RESEARCH Pitfall 9: claude otherwise waits 3 s for stdin), and the raw stream is appended to a
// log file so a verdict can always be traced back to what the session actually printed.
import { accessSync, appendFileSync, constants, mkdirSync, realpathSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { execa } from 'execa';
import { agentEnv } from '../core/security/agent-env.ts';

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
  /** Parent environment; reduced through agentEnv before spawning. Defaults to process.env. */
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
  /** The agent CLI's version string, or null when it cannot be read. */
  version?(): Promise<string | null>;
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
export async function claudeVersion(binary?: string): Promise<string | null> {
  try {
    const result = await execa(binary ?? resolveClaudeBinary(), ['--version'], {
      env: agentEnv(process.env),
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

  constructor(options: { binary?: string } = {}) {
    // Resolved once, to an absolute real path, so a later PATH change cannot swap the binary.
    this.binary = options.binary ?? resolveClaudeBinary();
    if (!isAbsolute(this.binary)) throw new Error('The claude binary path must be absolute.');
  }

  async run(request: AgentRunRequest): Promise<AgentRun> {
    mkdirSync(dirname(request.rawLogPath), { recursive: true, mode: 0o700 });
    const result = await execa(this.binary, [...request.argv], {
      cwd: request.cwd,
      env: agentEnv(request.env ?? process.env),
      extendEnv: false,
      stdin: 'ignore',
      timeout: request.timeoutMs,
      cleanup: true,
      reject: false,
      stripFinalNewline: false,
      encoding: 'utf8',
    });
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

  version(): Promise<string | null> {
    return claudeVersion(this.binary);
  }
}

// Model windows and the context budget (build-runs: Fresh sessions with context-budget handoff).
//
// The window is learned, never assumed: every `result` a session prints carries
// `modelUsage[model].contextWindow` (spike 3.1), and every finished session teaches the store the
// window of its model on that claude version. Before a model's window is known, a calibration
// session (one turn, one short reply) provides it. The requested model is often an alias
// (`haiku`), while results name the resolved id (`claude-haiku-5-5`); both are recorded, so the
// run settings can look the alias up.

import { buildClaudeArgv } from '../agent/claude-argv.ts';
import type { AgentRunner, StreamEvent } from '../agent/runner.ts';
import { ContextMeter, initModel, resultWindows } from '../agent/usage.ts';
import type { AgentSettings } from '../core/security/sandbox-settings.ts';
import type { Store } from '../core/store/db.ts';
import {
  endAgentSession,
  getModelWindow,
  insertAgentSession,
  recordModelWindow,
  setAgentSessionPid,
} from '../core/store/sessions.ts';

/** `2.1.322 (Claude Code)` → `2.1.322`. */
export function normalizeClaudeVersion(version: string): string {
  return version.trim().split(/\s+/)[0] ?? version.trim();
}

/**
 * Learns windows from one `result` event: each model it names under its own id, and the
 * requested model (an alias or id) under the session's resolved model's window. Returns the
 * session model's window, or null when the result names none.
 */
export function learnFromResult(
  db: Store,
  input: { requested: string; resolved: string | null; claudeVersion: string; result: StreamEvent },
  now: number = Date.now(),
): number | null {
  const windows = resultWindows(input.result);
  if (windows.size === 0) return null;
  for (const [model, window] of windows)
    recordModelWindow(db, model, input.claudeVersion, window, now);
  let window: number | undefined;
  if (input.resolved !== null) window = windows.get(input.resolved);
  if (window === undefined && windows.size === 1) window = [...windows.values()][0];
  if (window === undefined) return null;
  recordModelWindow(db, input.requested, input.claudeVersion, window, now);
  return window;
}

/** The learned window for a requested model on a claude version, or null. */
export function knownWindow(db: Store, model: string, claudeVersion: string): number | null {
  return getModelWindow(db, model, claudeVersion);
}

export interface CalibrateInput {
  runner: AgentRunner;
  db: Store;
  hostId: string;
  model: string;
  claudeVersion: string;
  settings: AgentSettings;
  allowedTools: readonly string[];
  cwd: string;
  rawLogPath: string;
  processTag: string;
  timeoutMs?: number;
}

export class CalibrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalibrationError';
  }
}

/**
 * Runs one short session to learn `model`'s window, records the session and the window, and
 * returns the window. Uses the one agent launch profile, like every other session.
 */
export async function calibrateWindow(input: CalibrateInput): Promise<number> {
  const { runner, db } = input;
  if (runner.start === undefined) throw new CalibrationError('The runner cannot stream.');
  const argv = buildClaudeArgv({
    settings: input.settings,
    model: input.model,
    maxTurns: 1,
    maxBudgetUsd: 0.5,
    allowedTools: input.allowedTools,
    streamInput: true,
  });
  const sessionId = insertAgentSession(db, {
    hostId: input.hostId,
    runChangeId: null,
    kind: 'calibration',
    number: 1,
    model: input.model,
    claudeVersion: input.claudeVersion,
    processTag: input.processTag,
    rawLogPath: input.rawLogPath,
  });
  const meter = new ContextMeter();
  let resolved: string | null = null;
  const session = await runner.start({
    argv,
    cwd: input.cwd,
    timeoutMs: input.timeoutMs ?? 120_000,
    rawLogPath: input.rawLogPath,
    processTag: input.processTag,
    onEvent: (event) => {
      meter.observe(event);
      resolved ??= initModel(event);
    },
  });
  setAgentSessionPid(db, sessionId, session.pid);
  session.send('Reply with the single word OK. Use no tools.');
  session.endInput();
  const end = await session.done;
  const window =
    end.result === null
      ? null
      : learnFromResult(db, {
          requested: input.model,
          resolved,
          claudeVersion: input.claudeVersion,
          result: end.result,
        });
  endAgentSession(db, sessionId, {
    reason: window === null ? (end.timedOut ? 'timeout' : 'no-window') : 'finished',
    peakContextTokens: meter.peak,
  });
  if (window === null) {
    const failure = sessionFailure(end.result);
    throw new CalibrationError(
      failure !== null
        ? `The calibration session for ${input.model} failed: ${failure}`
        : `The calibration session for ${input.model} reported no context window${end.timedOut ? ' (timed out)' : ''}.`,
    );
  }
  return window;
}

/**
 * What `claude` said when a session ended in an error (`is_error` on its result), such as
 * `Not logged in · Please run /login`; null for a session that did not fail. The text is the
 * session's own, cut to one short line, so the run's stop reason names the real cause.
 */
export function sessionFailure(result: StreamEvent | null): string | null {
  if (result === null || result.type !== 'result') return null;
  const fields = result as { readonly [key: string]: unknown };
  if (fields.is_error !== true) return null;
  const text = typeof fields.result === 'string' ? fields.result.replace(/\s+/g, ' ').trim() : '';
  if (text === '') return 'claude reported an error and no message.';
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/** The token budget for `percent` of `windowTokens` (whole tokens, rounded down). */
export function budgetTokens(percent: number, windowTokens: number): number {
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
    throw new RangeError('The budget must be a percentage above 0 and at most 100.');
  }
  return Math.floor((windowTokens * percent) / 100);
}

/** `1000000` → `1M`, `400000` → `400k`, `1500000` → `1.5M`, `123456` → `123k`. */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = Math.round(tokens / 100_000) / 10;
    return `${Number.isInteger(m) ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return String(tokens);
}

/** `40% of 1M = 400k tokens` (build-runs: Budget shown as tokens). */
export function formatBudget(percent: number, windowTokens: number): string {
  return `${percent}% of ${formatTokens(windowTokens)} = ${formatTokens(budgetTokens(percent, windowTokens))} tokens`;
}

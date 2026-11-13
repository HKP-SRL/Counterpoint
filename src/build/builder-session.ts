// One builder session with its context budget (build-runs: Fresh sessions with context-budget
// handoff; spike 5.1 of first-unattended-run).
//
// The session streams: Counterpoint sends the prompt, reads usage as it arrives, and measures fill
// against the model's learned window (never a hard-coded size):
// - at the budget it sends the wrap-up message once (finish the task, write the handoff, stop). A
//   message sent mid-turn reaches the model at its next tool result, in the same turn;
// - at the budget plus the margin it ends the session itself: an `interrupt`, then closing input,
//   with a process-group kill if it has not exited 30 s later;
// - every turn's `result` closes input, so the session ends when its turn does; the next session
//   starts fresh from the handoff.
// A run stopping at a clean point asks the same way (`wrapUp('stop')`).
import { buildClaudeArgv, type EffortLevel } from '../agent/claude-argv.ts';
import type { AgentRunner, AgentSessionEnd, StreamEvent } from '../agent/runner.ts';
import { ContextMeter } from '../agent/usage.ts';
import { classifySession, type SessionOutcome } from './governor.ts';
import { wrapUpMessage } from './prompt.ts';
import { budgetTokens } from './windows.ts';

/** Default margin past the budget before Counterpoint ends the session itself (points). */
export const DEFAULT_MARGIN_PERCENT = 15;
const FORCED_EXIT_GRACE_MS = 30_000;

export interface BuilderSessionInput {
  runner: AgentRunner;
  model: string;
  cwd: string;
  /** The run's environment (the owner's). */
  env?: Readonly<Record<string, string>>;
  rawLogPath: string;
  processTag: string;
  prompt: string;
  windowTokens: number;
  /** Budget as a percentage of the window (e.g. 40). */
  budgetPercent: number;
  effort?: EffortLevel;
  marginPercent?: number;
  maxTurns?: number;
  maxBudgetUsd?: number;
  timeoutMs: number;
  /** Called once the process exists (record the pid for crash recovery). */
  onStart?: (pid: number) => void;
  onEvent?: (event: StreamEvent) => void;
}

export type BuilderEndReason =
  | 'finished'
  | 'budget-handoff'
  | 'stop-handoff'
  | 'forced'
  | 'timeout'
  | 'error';

export interface BuilderSessionResult {
  reason: BuilderEndReason;
  peakTokens: number;
  outcome: SessionOutcome;
  end: AgentSessionEnd;
}

export interface BuilderSession {
  /** Asks the builder to finish its task, write the handoff and stop (once). */
  wrapUp(reason: 'budget' | 'stop'): void;
  readonly done: Promise<BuilderSessionResult>;
}

export async function startBuilderSession(input: BuilderSessionInput): Promise<BuilderSession> {
  if (input.runner.start === undefined) throw new Error('The runner cannot stream.');
  const budget = budgetTokens(input.budgetPercent, input.windowTokens);
  const margin = input.marginPercent ?? DEFAULT_MARGIN_PERCENT;
  const hardLimit = budgetTokens(Math.min(100, input.budgetPercent + margin), input.windowTokens);
  const meter = new ContextMeter();
  const kept: StreamEvent[] = [];
  let wrapped: 'budget' | 'stop' | null = null;
  let forced = false;

  const argv = buildClaudeArgv({
    model: input.model,
    ...(input.effort === undefined ? {} : { effort: input.effort }),
    maxTurns: input.maxTurns ?? 400,
    maxBudgetUsd: input.maxBudgetUsd ?? 50,
    streamInput: true,
  });

  // `session` is set right after start resolves; events before that only update the meter.
  let session: Awaited<ReturnType<NonNullable<AgentRunner['start']>>> | null = null;
  const wrapUp = (reason: 'budget' | 'stop') => {
    if (wrapped !== null || session === null) return;
    wrapped = reason;
    try {
      session.send(wrapUpMessage(reason));
    } catch {
      // input already closed: the session is ending anyway
    }
  };
  const force = () => {
    if (forced || session === null) return;
    forced = true;
    const s = session;
    void s.interrupt().finally(() => {
      s.endInput();
      setTimeout(() => s.kill(), FORCED_EXIT_GRACE_MS).unref();
    });
  };

  session = await input.runner.start({
    argv,
    cwd: input.cwd,
    ...(input.env === undefined ? {} : { env: input.env }),
    timeoutMs: input.timeoutMs,
    rawLogPath: input.rawLogPath,
    processTag: input.processTag,
    onEvent: (event) => {
      if (
        event.type === 'rate_limit_event' ||
        event.type === 'result' ||
        (event.type === 'assistant' && (event as { error?: unknown }).error !== undefined)
      ) {
        kept.push(event);
      }
      const fill = meter.observe(event);
      if (fill !== null) {
        if (fill >= hardLimit) force();
        else if (fill >= budget) wrapUp('budget');
      }
      // The turn is over: this session ends with it.
      if (event.type === 'result') session?.endInput();
      input.onEvent?.(event);
    },
  });
  input.onStart?.(session.pid);
  session.send(input.prompt);
  const started = session;

  const done = started.done.then((end): BuilderSessionResult => {
    const outcome = classifySession(kept, { interrupted: forced || end.killed });
    let reason: BuilderEndReason;
    if (end.timedOut) reason = 'timeout';
    else if (forced) reason = 'forced';
    else if (outcome.kind !== 'ok') reason = 'error';
    else if (wrapped === 'budget') reason = 'budget-handoff';
    else if (wrapped === 'stop') reason = 'stop-handoff';
    else reason = 'finished';
    return { reason, peakTokens: meter.peak, outcome, end };
  });
  return { wrapUp, done };
}

/**
 * The handoff Counterpoint writes when a session left none (forced end, crash): what changed and
 * which tasks are done, so the next session can pick up.
 */
export function generatedHandoff(input: {
  session: number;
  reason: string;
  changedFiles: readonly string[];
  ticked: readonly string[];
}): string {
  const files = input.changedFiles.length === 0 ? ['(none)'] : input.changedFiles.slice(0, 200);
  return [
    `# Handoff written by Counterpoint (session ${input.session})`,
    '',
    `The session left no handoff: ${input.reason}. Check the work in progress before going on.`,
    '',
    '## Files changed in this session',
    ...files.map((file) => `- ${file}`),
    '',
    '## Tasks done so far',
    ...(input.ticked.length === 0
      ? ['- (none recorded)']
      : input.ticked.map((task) => `- ${task}`)),
    '',
  ].join('\n');
}

// The governor (build-runs: Single governor in front of every spawn; Usage limits pause every
// lane).
//
// One instance lives in the daemon and every agent spawn on the machine asks it first, whatever
// the host: builder sessions and calibration sessions. Its pause is persisted in the store
// (`governor` row), so a daemon restart keeps it, and another process with a read-only store can
// see it too (`readPause`).
//
// What it reads, from claude 2.1.322 streams (spike 3.2) and the documented shapes
// (https://code.claude.com/docs/en/headless "Handle API retries", agent-sdk/typescript
// `SDKAssistantMessage.error`, `SDKRateLimitEvent`, `SDKResultMessage`, read 2026-11-11):
// - `rate_limit_event.rate_limit_info`: `status` allowed | allowed_warning | rejected, `resetsAt` in
//   Unix seconds, `utilization` 0..1, `rateLimitType`, `unifiedWindows` (per window: utilization,
//   resetsAt, status), `errorCode: credits_required` on a credits rejection.
// - an assistant message's `error`: authentication_failed, oauth_org_not_allowed, account_on_hold,
//   billing_error, rate_limit, overloaded, invalid_request, model_not_found, server_error,
//   max_output_tokens, cloud_credential_error, unknown.
// - `system/api_retry`: claude's own retries (attempt, max_retries, retry_delay_ms, error_status,
//   error); claude retries transient failures itself up to 10 times before giving up. Server-error
//   retries before a sign-in failure mark it as a possible outage.
// - the `result`: subtype success | error_max_turns | error_during_execution |
//   error_max_budget_usd | error_max_structured_output_retries, `is_error`, the result text.
// `rejected`, `api_retry` and the error values have not been seen live yet (design: Risks).
import type {
  AgentRun,
  AgentRunner,
  AgentRunRequest,
  AgentSession,
  AgentSessionRequest,
  KnownStreamEvent,
  StreamEvent,
} from '../agent/runner.ts';
import { fromSubagent } from '../agent/usage.ts';
import type { Store } from '../core/store/db.ts';

/** Two minutes past the reported reset, so the first request after the pause is not refused. */
export const RESET_MARGIN_MS = 2 * 60 * 1000;
/** A usage-limit stop that names no reset time pauses this long, then tries again. */
export const UNKNOWN_RESET_PAUSE_MS = 30 * 60 * 1000;
/** Default utilization ceiling: no new session starts while a warned window is at or above it. */
export const DEFAULT_CEILING = 0.95;
/** A hold at least this long, from when a spawn starts waiting on it, is told to the owner. */
export const LONG_HOLD_MS = 3 * 60 * 60 * 1000;

export type SpawnKind = 'calibration' | 'builder' | 'owner-step' | 'draft';

export interface WindowState {
  status: string;
  utilization: number | null;
  /** Epoch milliseconds. */
  resetsAt: number | null;
}

export interface GovernorState {
  /** Epoch milliseconds, or null when not paused. */
  pausedUntil: number | null;
  pauseReason: string | null;
  /** The last state seen per limit window (`five_hour`, `seven_day`, ...). */
  windows: Record<string, WindowState>;
}

/** A hold a spawn waits on: until when (epoch ms), why, and the limit window it waits for. */
export interface LongHold {
  until: number;
  reason: string;
  /** The window (`seven_day`, `five_hour`, ...) whose reset ends it, when one does. */
  window: string | null;
}

export class GovernorRefusal extends Error {
  readonly kind: 'aborted';

  constructor(kind: 'aborted', message: string) {
    super(message);
    this.name = 'GovernorRefusal';
    this.kind = kind;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Unix seconds → epoch ms. Values that already look like ms are kept. */
function resetMs(value: unknown): number | null {
  const n = finite(value);
  if (n === null || n <= 0) return null;
  return n < 1e11 ? n * 1000 : n;
}

/** Reads the persisted pause and window states (works on a read-only store). */
export function readGovernorState(db: Store): GovernorState {
  const row = db
    .prepare('SELECT paused_until, pause_reason, utilization FROM governor WHERE id = 1')
    .get();
  let windows: Record<string, WindowState> = {};
  try {
    const parsed = JSON.parse(String(row?.utilization ?? '{}'));
    if (record(parsed) !== null) windows = parsed as Record<string, WindowState>;
  } catch {
    windows = {};
  }
  const paused = row?.paused_until;
  return {
    pausedUntil:
      typeof paused === 'number' ? paused : typeof paused === 'bigint' ? Number(paused) : null,
    pauseReason: typeof row?.pause_reason === 'string' ? row.pause_reason : null,
    windows,
  };
}

/** The pause in force at `now`, or null. For processes that only read the store. */
export function readPause(
  db: Store,
  now: number = Date.now(),
): { until: number; reason: string } | null {
  const state = readGovernorState(db);
  if (state.pausedUntil === null || state.pausedUntil <= now) return null;
  return { until: state.pausedUntil, reason: state.pauseReason ?? 'usage limit' };
}

/** The limit windows a `rate_limit_event` reports, keyed by window name. */
export function rateLimitWindows(event: StreamEvent): {
  status: string | null;
  errorCode: string | null;
  windows: Record<string, WindowState>;
} | null {
  if (event.type !== 'rate_limit_event') return null;
  const info = record((event as KnownStreamEvent).rate_limit_info);
  if (info === null) return null;
  const status = typeof info.status === 'string' ? info.status : null;
  const windows: Record<string, WindowState> = {};
  const unified = record(info.unifiedWindows);
  if (unified !== null) {
    for (const [name, value] of Object.entries(unified)) {
      const window = record(value);
      if (window === null) continue;
      windows[name] = {
        status: typeof window.status === 'string' ? window.status : 'unknown',
        utilization: finite(window.utilization),
        resetsAt: resetMs(window.resetsAt),
      };
    }
  }
  const type = typeof info.rateLimitType === 'string' ? info.rateLimitType : null;
  if (type !== null) {
    // The top-level status is the one the limit applies (allowed_warning may only appear here).
    windows[type] = {
      status: status ?? windows[type]?.status ?? 'unknown',
      utilization: finite(info.utilization) ?? windows[type]?.utilization ?? null,
      resetsAt: resetMs(info.resetsAt) ?? windows[type]?.resetsAt ?? null,
    };
  }
  return {
    status,
    errorCode: typeof info.errorCode === 'string' ? info.errorCode : null,
    windows,
  };
}

/** How a session ended, as far as the governor and the orchestrator care. */
export type SessionOutcome =
  | { kind: 'ok' }
  /** A plan usage limit: pause every lane until `resetsAt` (epoch ms, null when not given). */
  | { kind: 'usage-limit'; resetsAt: number | null; detail: string }
  /** Worth retrying the session after a backoff (server errors, overload, throttles). */
  | { kind: 'transient'; detail: string }
  /**
   * Stop the run and tell the owner (Needs You). A sign-in failure that may be an outage
   * (`outage`: an HTML error page for a body, or after server-error retries) is retried first,
   * and so is any sign-in failure while claude still holds a login (auth-failures.ts).
   */
  | { kind: 'stop'; cause: 'auth' | 'credit' | 'spend-limit'; detail: string; outage?: boolean }
  /** The session itself failed (turn or budget cap, bad request, ...): counts as an attempt. */
  | { kind: 'failed'; detail: string };

const AUTH_ERRORS = new Set([
  'authentication_failed',
  'oauth_org_not_allowed',
  'account_on_hold',
  'cloud_credential_error',
]);
const TRANSIENT_ERRORS = new Set(['overloaded', 'server_error']);
/** Caps someone must raise (errors.md "You've hit your monthly spend limit", "Spend limit reached"). */
const SPEND_LIMIT_RE =
  /spend limit|individual usage limit|team's shared budget|exceeds your group's budget/i;
/** The plan's own windows, which reset by themselves (errors.md "You've hit your session limit"). */
const PLAN_LIMIT_RE = /hit your (session|weekly|opus|sonnet|fable) limit|usage limit reached/i;

/** claude's own words when it holds no login (the result text of an errored session). */
const NOT_LOGGED_IN_RE = /not logged in|please run \/login/i;
/**
 * An HTML error page in place of an API answer: a proxy or CDN refused the request, not the API.
 * Seen live (run 20261113-0940, session 13): "Failed to authenticate. API Error: 403 Attention
 * Required! | Cloudflare" after three 503 retries; the owner was signed in.
 */
const HTML_ERROR_RE = /<\s*(!doctype|html)\b|cloudflare|attention required/i;

/** The events classifySession reads; sessions keep only these for it. */
export function classifiedEvent(event: StreamEvent): boolean {
  return (
    event.type === 'rate_limit_event' ||
    event.type === 'result' ||
    (event.type === 'system' && (event as KnownStreamEvent).subtype === 'api_retry') ||
    (event.type === 'assistant' && (event as KnownStreamEvent).error !== undefined)
  );
}

/** A `system/api_retry` for a server error (5xx), or a connection error with no status. */
function serverRetry(event: StreamEvent): boolean {
  if (event.type !== 'system' || (event as KnownStreamEvent).subtype !== 'api_retry') return false;
  const status = (event as KnownStreamEvent).error_status;
  return status === null || status === undefined || (typeof status === 'number' && status >= 500);
}

function resultText(result: KnownStreamEvent | null): string {
  const text = result?.result;
  return typeof text === 'string' ? text.slice(0, 400) : '';
}

/**
 * Classifies a finished session from its events. `interrupted` says the orchestrator itself
 * interrupted or killed it (an `error_during_execution` it caused is not a failure of the session).
 */
export function classifySession(
  events: readonly StreamEvent[],
  options: { interrupted?: boolean } = {},
): SessionOutcome {
  let rejected: { resetsAt: number | null; errorCode: string | null } | null = null;
  let assistantError: string | null = null;
  let result: KnownStreamEvent | null = null;
  let serverRetries = 0;
  for (const event of events) {
    if (serverRetry(event)) serverRetries += 1;
    const limits = rateLimitWindows(event);
    if (limits !== null && limits.status === 'rejected') {
      const resets = Object.values(limits.windows)
        .filter((w) => w.status === 'rejected' && w.resetsAt !== null)
        .map((w) => w.resetsAt as number);
      const top = Object.values(limits.windows)
        .map((w) => w.resetsAt)
        .find((r) => r !== null);
      rejected = {
        resetsAt: resets.length > 0 ? Math.max(...resets) : (top ?? null),
        errorCode: limits.errorCode,
      };
    }
    // A subagent's error is the subagent's: the main thread goes on, and its result says how.
    if (event.type === 'assistant' && !fromSubagent(event)) {
      const error = (event as KnownStreamEvent).error;
      if (typeof error === 'string') assistantError = error;
    }
    if (event.type === 'result') result = event as KnownStreamEvent;
  }
  const subtype = typeof result?.subtype === 'string' ? result.subtype : '';
  // A session that succeeded is ok whatever its summary says: the result text is the model's own
  // free-form summary, and a builder working on code about limits writes "spend limit" or "usage
  // limit reached" in it. Limits seen in its stream still pause every lane (Governor.observe).
  if (result !== null && subtype === 'success' && result.is_error !== true) return { kind: 'ok' };
  // From here the result, if any, is an error, and its text is claude's error message.
  const text = resultText(result);

  if (rejected?.errorCode === 'credits_required') {
    return { kind: 'stop', cause: 'credit', detail: text || 'Usage credits are required.' };
  }
  if ((assistantError !== null && AUTH_ERRORS.has(assistantError)) || NOT_LOGGED_IN_RE.test(text)) {
    const outage = HTML_ERROR_RE.test(text) || serverRetries > 0;
    return {
      kind: 'stop',
      cause: 'auth',
      detail: text || assistantError || 'authentication failed',
      ...(outage ? { outage } : {}),
    };
  }
  if (SPEND_LIMIT_RE.test(text)) {
    return { kind: 'stop', cause: 'spend-limit', detail: text };
  }
  if (assistantError === 'billing_error' || /credit balance is too low/i.test(text)) {
    return { kind: 'stop', cause: 'credit', detail: text || assistantError || 'billing error' };
  }
  const planLimit = PLAN_LIMIT_RE.test(text);
  if (rejected !== null || assistantError === 'rate_limit' || planLimit) {
    // A 429 throttle without quota headers is retried by claude itself; one that reaches us with
    // a rejected limit window or a plan-limit message is the plan's usage limit.
    if (rejected !== null || planLimit) {
      return {
        kind: 'usage-limit',
        resetsAt: rejected?.resetsAt ?? null,
        detail: text || 'usage limit',
      };
    }
    return { kind: 'transient', detail: text || 'rate limited' };
  }
  if (assistantError !== null && TRANSIENT_ERRORS.has(assistantError)) {
    return { kind: 'transient', detail: text || assistantError };
  }
  if (result === null) {
    return options.interrupted === true
      ? { kind: 'ok' }
      : { kind: 'transient', detail: 'The session ended without a result.' };
  }
  if (subtype === 'error_during_execution' && options.interrupted === true) return { kind: 'ok' };
  if (
    assistantError === 'unknown' ||
    /API Error: (5\d\d|Request timed out)|No response from API/i.test(text)
  ) {
    return { kind: 'transient', detail: text || 'API error' };
  }
  // claude's error code beside its message, so a park reason names what failed (model_not_found).
  const code = assistantError ?? (subtype === '' ? null : subtype);
  if (text !== '' && code !== null && !text.includes(code)) {
    return { kind: 'failed', detail: `${text} (${code})` };
  }
  return { kind: 'failed', detail: text || code || 'error' };
}

/** Backoff before retrying a session after a transient error: 1, 2, 4, ... minutes, at most 30. */
export function transientBackoffMs(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(60_000 * 2 ** (n - 1), 30 * 60_000);
}

/** Transient retries per session before the session counts as a failed attempt. */
export const MAX_TRANSIENT_RETRIES = 5;

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new GovernorRefusal('aborted', 'Stopped while waiting.'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new GovernorRefusal('aborted', 'Stopped while waiting.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface GovernorOptions {
  db: Store;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Utilization ceiling for pacing on `allowed_warning` (0..1). */
  ceiling?: number;
  /** Called whenever the state changes (the daemon turns it into an event). */
  onChange?: (state: GovernorState) => void;
  /**
   * Told when a spawn starts waiting on a hold of LONG_HOLD_MS or more (again when that hold
   * changes), and with null once no spawn waits any more (the hold ended, or the run stopped).
   */
  onLongHold?: (hold: LongHold | null) => void;
}

export class Governor {
  readonly #db: Store;
  readonly #now: () => number;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly #ceiling: number;
  readonly #onChange: ((state: GovernorState) => void) | undefined;
  readonly #onLongHold: ((hold: LongHold | null) => void) | undefined;
  /** Spawns waiting in admit now, and the long hold told to the listener (null: none). */
  #waiting = 0;
  #longHold: LongHold | null = null;

  constructor(options: GovernorOptions) {
    this.#db = options.db;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? abortableSleep;
    this.#ceiling = options.ceiling ?? DEFAULT_CEILING;
    this.#onChange = options.onChange;
    this.#onLongHold = options.onLongHold;
  }

  state(): GovernorState {
    return readGovernorState(this.#db);
  }

  /**
   * When the next spawn may start (epoch ms) and why, or null when it may start now: the
   * persisted pause, or a warned window at or above the ceiling until it resets.
   */
  holdUntil(): { until: number; reason: string } | null {
    const now = this.#now();
    const state = this.state();
    let hold: { until: number; reason: string } | null = null;
    if (state.pausedUntil !== null && state.pausedUntil > now) {
      hold = { until: state.pausedUntil, reason: state.pauseReason ?? 'usage limit' };
    }
    for (const [name, window] of Object.entries(state.windows)) {
      if (window.status === 'allowed') continue;
      if (window.utilization === null || window.utilization < this.#ceiling) continue;
      if (window.resetsAt === null || window.resetsAt + RESET_MARGIN_MS <= now) continue;
      const until = window.resetsAt + RESET_MARGIN_MS;
      if (hold === null || until > hold.until) {
        hold = {
          until,
          reason: `${name} usage at ${Math.round(window.utilization * 100)}%, pacing until it resets`,
        };
      }
    }
    return hold;
  }

  /**
   * Waits until a spawn may start: no usage-limit pause or pacing hold in force. A long wait is
   * told to the owner (build-runs: A long usage hold is told), so a weekly window days from its
   * reset is not a silent "Holding".
   */
  async admit(request: { hostId: string; kind: SpawnKind; signal?: AbortSignal }): Promise<void> {
    this.#waiting += 1;
    try {
      for (;;) {
        if (request.signal?.aborted) throw new GovernorRefusal('aborted', 'Stopped while waiting.');
        const hold = this.holdUntil();
        if (hold === null) return;
        this.#tellLongHold(hold);
        await this.#sleep(Math.max(1000, hold.until - this.#now()), request.signal);
      }
    } finally {
      this.#waiting -= 1;
      if (this.#waiting === 0 && this.#longHold !== null) {
        this.#longHold = null;
        this.#tell(null);
      }
    }
  }

  #tellLongHold(hold: { until: number; reason: string }): void {
    if (this.#longHold?.until === hold.until) return;
    if (hold.until - this.#now() < LONG_HOLD_MS) return;
    // The window whose reset (plus the margin) ends the hold, if one does.
    const window =
      Object.entries(this.state().windows).find(
        ([, w]) => w.resetsAt !== null && w.resetsAt + RESET_MARGIN_MS === hold.until,
      )?.[0] ?? null;
    this.#longHold = { until: hold.until, reason: hold.reason, window };
    this.#tell(this.#longHold);
  }

  #tell(hold: LongHold | null): void {
    try {
      this.#onLongHold?.(hold);
    } catch {
      // telling the owner never stops a spawn from waiting or starting
    }
  }

  /** Feeds one event from any session: limit windows are recorded; a rejection pauses all lanes. */
  observe(event: StreamEvent): void {
    const limits = rateLimitWindows(event);
    if (limits === null) return;
    const state = this.state();
    const windows = { ...state.windows, ...limits.windows };
    this.#db
      .prepare('UPDATE governor SET utilization = ?, updated_at = ? WHERE id = 1')
      .run(JSON.stringify(windows), this.#now());
    if (limits.status === 'rejected' && limits.errorCode !== 'credits_required') {
      const resets = Object.values(limits.windows)
        .filter((w) => w.status === 'rejected')
        .map((w) => w.resetsAt)
        .filter((r): r is number => r !== null);
      this.pauseForLimit(resets.length > 0 ? Math.max(...resets) : null, 'usage limit reached');
      return;
    }
    this.#onChange?.(this.state());
  }

  /** Pauses every lane until `resetsAt` + 2 minutes (or 30 minutes from now when unknown). */
  pauseForLimit(resetsAt: number | null, reason: string): void {
    const now = this.#now();
    const until = resetsAt === null ? now + UNKNOWN_RESET_PAUSE_MS : resetsAt + RESET_MARGIN_MS;
    this.pause(until, reason);
  }

  /** Sets the pause; an earlier end never shortens a pause already in force. */
  pause(until: number, reason: string): void {
    const current = this.state();
    if (current.pausedUntil !== null && current.pausedUntil >= until) return;
    this.#db
      .prepare(
        'UPDATE governor SET paused_until = ?, pause_reason = ?, updated_at = ? WHERE id = 1',
      )
      .run(until, reason.slice(0, 200), this.#now());
    this.#onChange?.(this.state());
  }

  /** Applies a classified session end: a usage limit pauses every lane. */
  noteOutcome(outcome: SessionOutcome): void {
    if (outcome.kind === 'usage-limit') this.pauseForLimit(outcome.resetsAt, outcome.detail);
  }
}

/**
 * An AgentRunner that asks the governor before every spawn and feeds it every event the session
 * prints. Every agent spawn the daemon makes goes through one of these (one scope per host and
 * kind), so pauses apply to all lanes on all hosts together.
 */
export function governedRunner(
  governor: Governor,
  inner: AgentRunner,
  scope: { hostId: string; kind: SpawnKind; signal?: AbortSignal },
): AgentRunner {
  const admit = () =>
    governor.admit({
      hostId: scope.hostId,
      kind: scope.kind,
      ...(scope.signal === undefined ? {} : { signal: scope.signal }),
    });
  const runner: AgentRunner = {
    async run(request: AgentRunRequest): Promise<AgentRun> {
      await admit();
      const run = await inner.run(request);
      for (const event of run.events) governor.observe(event);
      governor.noteOutcome(classifySession(run.events));
      return run;
    },
  };
  if (inner.start !== undefined) {
    const start = inner.start.bind(inner);
    runner.start = async (request: AgentSessionRequest): Promise<AgentSession> => {
      await admit();
      const events: StreamEvent[] = [];
      const session = await start({
        ...request,
        onEvent: (event) => {
          // Only what classifySession reads: limit events, results, retries, assistant errors.
          if (classifiedEvent(event)) events.push(event);
          governor.observe(event);
          request.onEvent?.(event);
        },
      });
      void session.done.then(() => governor.noteOutcome(classifySession(events)));
      return session;
    };
  }
  if (inner.version !== undefined) runner.version = inner.version.bind(inner);
  if (inner.signedIn !== undefined) runner.signedIn = inner.signedIn.bind(inner);
  return runner;
}

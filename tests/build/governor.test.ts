import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type {
  AgentRun,
  AgentRunner,
  AgentSession,
  AgentSessionRequest,
  StreamEvent,
} from '../../src/agent/runner.ts';
import { parseStreamJson } from '../../src/agent/runner.ts';
import {
  classifySession,
  DEFAULT_CEILING,
  Governor,
  governedRunner,
  LONG_HOLD_MS,
  RESET_MARGIN_MS,
  rateLimitWindows,
  readPause,
  transientBackoffMs,
  UNKNOWN_RESET_PAUSE_MS,
} from '../../src/build/governor.ts';
import { openStore, type Store } from '../../src/core/store/db.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

afterAll(() => {
  removeScratchDirs();
});

const FIXTURE = join(
  import.meta.dirname,
  '..',
  'fixtures',
  'stream-json',
  'streaming-inject.jsonl',
);
const T0 = 1_794_390_000_000; // epoch ms

function store(): Store {
  return openStore(makeScratchDir('cp-gov'));
}

function limitEvent(info: Record<string, unknown>): StreamEvent {
  return { type: 'rate_limit_event', rate_limit_info: info };
}

function governor(db: Store, now = { t: T0 }, sleeps: number[] = []) {
  return new Governor({
    db,
    now: () => now.t,
    sleep: async (ms) => {
      sleeps.push(ms);
      now.t += ms;
    },
  });
}

describe('rate limit events', () => {
  it('reads the real event: windows in ms, top-level status on its own window', () => {
    const event = parseStreamJson(readFileSync(FIXTURE, 'utf8')).find(
      (e) => e.type === 'rate_limit_event',
    ) as StreamEvent;
    const limits = rateLimitWindows(event);
    expect(limits?.status).toBe('allowed_warning');
    expect(limits?.windows.five_hour).toEqual({
      status: 'allowed',
      utilization: 0.74,
      resetsAt: 1_794_398_400_000,
    });
    expect(limits?.windows.seven_day).toEqual({
      status: 'allowed_warning',
      utilization: 0.52,
      resetsAt: 1_794_826_800_000,
    });
  });
});

describe('classifySession', () => {
  const result = (extra: Record<string, unknown> = {}): StreamEvent => ({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'done',
    ...extra,
  });
  const assistantError = (error: string): StreamEvent => ({
    type: 'assistant',
    error,
    message: { id: 'm' },
  });

  it('is ok for a successful result', () => {
    expect(classifySession([result()])).toEqual({ kind: 'ok' });
  });

  // Counterpoint builds itself, and its own code talks about limits: a builder's summary is not
  // claude's error message.
  it.each([
    'Done: the governor now stops the run when a spend limit is reached.',
    'Fixed the test for "usage limit reached" and "You\'ve hit your session limit".',
    'Handled the credit balance is too low message.',
  ])('is ok for a successful session whatever its summary says: %s', (text) => {
    expect(classifySession([result({ result: text })])).toEqual({ kind: 'ok' });
    expect(classifySession([assistantError('rate_limit'), result({ result: text })])).toEqual({
      kind: 'ok',
    });
  });

  it("does not read a subagent's error as the session's", () => {
    const sub: StreamEvent = {
      type: 'assistant',
      error: 'authentication_failed',
      message: { id: 's' },
      parent_tool_use_id: 'toolu_fork',
    };
    expect(
      classifySession([sub, result({ subtype: 'error_max_turns', is_error: true })]),
    ).toMatchObject({ kind: 'failed' });
  });

  it('is a usage limit, with the reset, on a rejected window', () => {
    const outcome = classifySession([
      limitEvent({ status: 'rejected', rateLimitType: 'five_hour', resetsAt: 1_794_398_400 }),
      assistantError('rate_limit'),
      result({ is_error: true, result: "You've hit your session limit · resets 3:10am" }),
    ]);
    expect(outcome).toMatchObject({ kind: 'usage-limit', resetsAt: 1_794_398_400_000 });
  });

  it('is a usage limit without a reset on the plan-limit message alone', () => {
    expect(
      classifySession([
        result({ is_error: true, result: "You've hit your weekly limit · resets Mon" }),
      ]),
    ).toMatchObject({ kind: 'usage-limit', resetsAt: null });
  });

  it.each([
    ['authentication_failed', 'auth'],
    ['oauth_org_not_allowed', 'auth'],
    ['account_on_hold', 'auth'],
    ['billing_error', 'credit'],
  ])('stops the run on %s (%s)', (error, cause) => {
    expect(
      classifySession([assistantError(error), result({ is_error: true, result: 'x' })]),
    ).toMatchObject({ kind: 'stop', cause });
  });

  // Seen live (run 20261113-0940, session 13): three 503 retries, then a Cloudflare page for a
  // body; the owner was signed in and the next run worked.
  it('marks a sign-in failure that may be an outage: an HTML body, or after server errors', () => {
    const retry = (status: number | null): StreamEvent => ({
      type: 'system',
      subtype: 'api_retry',
      attempt: 1,
      max_retries: 10,
      retry_delay_ms: 500,
      error_status: status,
      error: 'server_error',
    });
    const cloudflare = 'Failed to authenticate. API Error: 403 Attention Required! | Cloudflare';
    expect(
      classifySession([
        retry(503),
        retry(503),
        retry(503),
        assistantError('authentication_failed'),
        result({ is_error: true, result: cloudflare }),
      ]),
    ).toEqual({ kind: 'stop', cause: 'auth', detail: cloudflare, outage: true });
    expect(
      classifySession([
        assistantError('authentication_failed'),
        result({ is_error: true, result: 'API Error: 403 <!DOCTYPE html><html>...' }),
      ]),
    ).toMatchObject({ kind: 'stop', cause: 'auth', outage: true });
    expect(
      classifySession([
        retry(null),
        assistantError('authentication_failed'),
        result({ is_error: true, result: 'Failed to authenticate.' }),
      ]),
    ).toMatchObject({ outage: true });
    // A 429 retry is not a server error; a plain sign-in failure is not marked.
    const plain = classifySession([
      retry(429),
      assistantError('authentication_failed'),
      result({ is_error: true, result: 'Invalid API key' }),
    ]);
    expect(plain).toEqual({ kind: 'stop', cause: 'auth', detail: 'Invalid API key' });
  });

  it("reads claude's not-logged-in error as a sign-in failure", () => {
    expect(
      classifySession([result({ is_error: true, result: 'Not logged in · Please run /login' })]),
    ).toMatchObject({ kind: 'stop', cause: 'auth' });
  });

  it('stops on a credits-required rejection instead of pausing', () => {
    expect(
      classifySession([limitEvent({ status: 'rejected', errorCode: 'credits_required' })]),
    ).toMatchObject({ kind: 'stop', cause: 'credit' });
  });

  it.each([
    "You've hit your monthly spend limit · raise it at https://claude.ai/settings/usage",
    "You've hit your individual usage limit · ask your admin for a higher limit",
    'spend limit reached · resets Dec 1',
  ])('stops on a spend limit: %s', (text) => {
    expect(classifySession([result({ is_error: true, result: text })])).toMatchObject({
      kind: 'stop',
      cause: 'spend-limit',
    });
  });

  it('stops on a credit balance message', () => {
    expect(
      classifySession([result({ is_error: true, result: 'Credit balance is too low' })]),
    ).toMatchObject({ kind: 'stop', cause: 'credit' });
  });

  it.each(['overloaded', 'server_error'])('retries %s', (error) => {
    expect(classifySession([assistantError(error), result({ is_error: true })])).toMatchObject({
      kind: 'transient',
    });
  });

  it('retries a throttle that is not the plan limit', () => {
    expect(classifySession([assistantError('rate_limit')])).toMatchObject({ kind: 'transient' });
  });

  it('retries a session that ended with no result, unless the orchestrator ended it', () => {
    expect(classifySession([])).toMatchObject({ kind: 'transient' });
    expect(classifySession([], { interrupted: true })).toEqual({ kind: 'ok' });
  });

  it('counts turn and budget caps as a failed attempt', () => {
    expect(
      classifySession([result({ subtype: 'error_max_turns', is_error: true, result: undefined })]),
    ).toMatchObject({ kind: 'failed', detail: 'error_max_turns' });
  });

  it("names claude's error code beside its message for a failed session", () => {
    expect(
      classifySession([
        assistantError('model_not_found'),
        result({ is_error: true, result: "There's an issue with the selected model (opus-9)." }),
      ]),
    ).toEqual({
      kind: 'failed',
      detail: "There's an issue with the selected model (opus-9). (model_not_found)",
    });
  });

  it('does not fail a session the orchestrator interrupted', () => {
    const interrupted = result({ subtype: 'error_during_execution', is_error: true, result: '' });
    expect(classifySession([interrupted], { interrupted: true })).toEqual({ kind: 'ok' });
    expect(classifySession([interrupted])).toMatchObject({ kind: 'failed' });
  });

  it('backs off 1, 2, 4 ... minutes up to 30', () => {
    expect([1, 2, 3, 6, 9].map(transientBackoffMs)).toEqual([
      60_000, 120_000, 240_000, 1_800_000, 1_800_000,
    ]);
  });
});

describe('Governor', () => {
  it('admits at once when nothing holds', async () => {
    const db = store();
    const sleeps: number[] = [];
    await governor(db, { t: T0 }, sleeps).admit({ hostId: 'cena', kind: 'builder' });
    expect(sleeps).toEqual([]);
  });

  it('pauses every lane until the reset plus 2 minutes on a rejection, across restarts', async () => {
    const db = store();
    const now = { t: T0 };
    const reset = T0 + 70 * 60_000;
    governor(db, now).observe(
      limitEvent({ status: 'rejected', rateLimitType: 'five_hour', resetsAt: reset / 1000 }),
    );
    // A new governor on the same store (a daemon restart) keeps the pause.
    const sleeps: number[] = [];
    const after = governor(db, now, sleeps);
    expect(after.holdUntil()?.until).toBe(reset + RESET_MARGIN_MS);
    expect(readPause(db, now.t)?.until).toBe(reset + RESET_MARGIN_MS);
    // Any host waits for it.
    await after.admit({ hostId: 'other-host', kind: 'calibration' });
    expect(now.t).toBe(reset + RESET_MARGIN_MS);
    expect(sleeps).toEqual([70 * 60_000 + RESET_MARGIN_MS]);
    expect(readPause(db, now.t)).toBeNull();
  });

  it('pauses 30 minutes when a usage limit names no reset', () => {
    const db = store();
    const g = governor(db);
    g.noteOutcome({ kind: 'usage-limit', resetsAt: null, detail: 'limit' });
    expect(g.holdUntil()?.until).toBe(T0 + UNKNOWN_RESET_PAUSE_MS);
  });

  it('never shortens a pause in force', () => {
    const db = store();
    const g = governor(db);
    g.pause(T0 + 10_000_000, 'long');
    g.pause(T0 + 1000, 'short');
    expect(g.holdUntil()).toEqual({ until: T0 + 10_000_000, reason: 'long' });
  });

  it('paces new sessions while a warned window is at the ceiling, not below it', () => {
    const db = store();
    const g = governor(db);
    const reset = (T0 + 3_600_000) / 1000;
    g.observe(
      limitEvent({
        status: 'allowed_warning',
        rateLimitType: 'five_hour',
        utilization: 0.9,
        resetsAt: reset,
      }),
    );
    expect(g.holdUntil()).toBeNull();
    g.observe(
      limitEvent({
        status: 'allowed_warning',
        rateLimitType: 'five_hour',
        utilization: DEFAULT_CEILING,
        resetsAt: reset,
      }),
    );
    expect(g.holdUntil()).toMatchObject({ until: reset * 1000 + RESET_MARGIN_MS });
    expect(g.holdUntil()?.reason).toMatch(/five_hour usage at 95%/);
  });

  it('ignores a warned window whose reset has passed', () => {
    const db = store();
    const g = governor(db);
    g.observe(
      limitEvent({
        status: 'allowed_warning',
        rateLimitType: 'five_hour',
        utilization: 0.99,
        resetsAt: (T0 - 3_600_000) / 1000,
      }),
    );
    expect(g.holdUntil()).toBeNull();
  });

  describe('a long hold is told', () => {
    const weekly = (utilization: number, resetsAt: number) =>
      limitEvent({
        status: 'allowed_warning',
        rateLimitType: 'seven_day',
        utilization,
        resetsAt: resetsAt / 1000,
      });

    function telling(db: Store, now: { t: number }) {
      const told: Array<unknown> = [];
      const g = new Governor({
        db,
        now: () => now.t,
        sleep: async (ms) => {
          told.push({ slept: ms });
          now.t += ms;
        },
        onLongHold: (hold) => told.push(hold),
      });
      return { g, told };
    }

    it('names the window and its reset when a wait of 3 hours or more begins, and ends it after', async () => {
      const db = store();
      const now = { t: T0 };
      const { g, told } = telling(db, now);
      const reset = T0 + 2 * 24 * 3_600_000;
      g.observe(weekly(0.96, reset));
      await g.admit({ hostId: 'cena', kind: 'builder' });
      const until = reset + RESET_MARGIN_MS;
      expect(told).toEqual([
        { until, reason: 'seven_day usage at 96%, pacing until it resets', window: 'seven_day' },
        { slept: until - T0 },
        null,
      ]);
    });

    it('says nothing for a short hold', async () => {
      const db = store();
      const now = { t: T0 };
      const { g, told } = telling(db, now);
      g.observe(weekly(0.97, T0 + LONG_HOLD_MS - RESET_MARGIN_MS - 60_000));
      await g.admit({ hostId: 'cena', kind: 'builder' });
      expect(
        told.filter((entry) => !(typeof entry === 'object' && entry && 'slept' in entry)),
      ).toEqual([]);
    });

    it('ends it when the waiting spawn is stopped', async () => {
      const db = store();
      const told: Array<unknown> = [];
      const g = new Governor({ db, now: () => T0, onLongHold: (hold) => told.push(hold) });
      g.pause(T0 + 5 * 3_600_000, 'usage limit reached');
      const controller = new AbortController();
      const waiting = g.admit({ hostId: 'cena', kind: 'builder', signal: controller.signal });
      controller.abort();
      await expect(waiting).rejects.toMatchObject({ kind: 'aborted' });
      expect(told).toEqual([
        { until: T0 + 5 * 3_600_000, reason: 'usage limit reached', window: null },
        null,
      ]);
    });
  });

  it('stops waiting when aborted', async () => {
    const db = store();
    const g = new Governor({ db, now: () => T0 });
    g.pause(T0 + 3_600_000, 'limit');
    const controller = new AbortController();
    const waiting = g.admit({ hostId: 'cena', kind: 'builder', signal: controller.signal });
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('governedRunner', () => {
  function stubRunner(events: StreamEvent[]): AgentRunner & { spawned: number } {
    const stub = {
      spawned: 0,
      async run(): Promise<AgentRun> {
        stub.spawned += 1;
        return { events, raw: '', stderr: '', exitCode: 0, timedOut: false, result: null };
      },
      async start(request: AgentSessionRequest): Promise<AgentSession> {
        stub.spawned += 1;
        for (const event of events) request.onEvent?.(event);
        return {
          pid: 1,
          processTag: request.processTag,
          send() {},
          interrupt: async () => true,
          endInput() {},
          kill() {},
          done: Promise.resolve({
            exitCode: 1,
            signal: null,
            timedOut: false,
            killed: false,
            result: null,
            stderr: '',
          }),
        };
      },
    };
    return stub;
  }

  const rejectedRun: StreamEvent[] = [
    limitEvent({ status: 'rejected', rateLimitType: 'five_hour', resetsAt: (T0 + 600_000) / 1000 }),
    { type: 'result', subtype: 'success', is_error: true, result: "You've hit your session limit" },
  ];

  it('admits before run() and pauses on what the session reports', async () => {
    const db = store();
    const g = governor(db);
    const inner = stubRunner(rejectedRun);
    const runner = governedRunner(g, inner, { hostId: 'cena', kind: 'calibration' });
    await runner.run({ argv: [], cwd: '/', timeoutMs: 1, rawLogPath: '/dev/null' });
    expect(inner.spawned).toBe(1);
    expect(g.holdUntil()?.until).toBe(T0 + 600_000 + RESET_MARGIN_MS);
  });

  it('admits before start() and passes events on', async () => {
    const db = store();
    const seen: string[] = [];
    const g = governor(db);
    const inner = stubRunner(rejectedRun);
    const runner = governedRunner(g, inner, { hostId: 'cena', kind: 'builder' });
    const session = await runner.start?.({
      argv: [],
      cwd: '/',
      timeoutMs: 1,
      rawLogPath: '/dev/null',
      processTag: 'tag-0123456789',
      onEvent: (event) => seen.push(event.type),
    });
    await session?.done;
    expect(seen).toEqual(['rate_limit_event', 'result']);
    expect(g.holdUntil()).not.toBeNull();

    expect(inner.spawned).toBe(1);
  });
});

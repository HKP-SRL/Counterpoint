import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import { doctorGate } from '../../src/build/doctor-gate.ts';
import {
  classifySession,
  DEFAULT_CEILING,
  type DoctorGate,
  Governor,
  GovernorRefusal,
  governedRunner,
  RESET_MARGIN_MS,
  rateLimitWindows,
  readPause,
  transientBackoffMs,
  UNKNOWN_RESET_PAUSE_MS,
} from '../../src/build/governor.ts';
import { hostDir } from '../../src/core/host/home.ts';
import { PROBE_TARGET_IDS, probeTargetMode } from '../../src/core/security/doctor-report.ts';
import { DOCTOR_REPORT_FILE } from '../../src/core/security/doctor-report-file.ts';
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

const OK_GATE: DoctorGate = () => ({ ok: true });

function governor(db: Store, now = { t: T0 }, gate = OK_GATE, sleeps: number[] = []) {
  return new Governor({
    db,
    doctorGate: gate,
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
    await governor(db, { t: T0 }, OK_GATE, sleeps).admit({ hostId: 'cena', kind: 'builder' });
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
    const after = governor(db, now, OK_GATE, sleeps);
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

  it('refuses every spawn but probes while doctor does not pass, also after a wait', async () => {
    const db = store();
    let pass = true;
    const gate = () =>
      pass ? ({ ok: true } as const) : ({ ok: false, reason: 'no doctor' } as const);
    const now = { t: T0 };
    const g = new Governor({
      db,
      doctorGate: gate,
      now: () => now.t,
      sleep: async (ms) => {
        now.t += ms;
        pass = false; // doctor failed while we waited
      },
    });
    g.pause(T0 + 60_000, 'limit');
    await expect(g.admit({ hostId: 'cena', kind: 'builder' })).rejects.toThrow(/no doctor/);
    await expect(g.admit({ hostId: 'cena', kind: 'builder' })).rejects.toBeInstanceOf(
      GovernorRefusal,
    );
    await expect(g.admit({ hostId: 'cena', kind: 'probe' })).resolves.toBeUndefined();
  });

  it('stops waiting when aborted', async () => {
    const db = store();
    const g = new Governor({ db, doctorGate: OK_GATE, now: () => T0 });
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
    const runner = governedRunner(g, inner, { hostId: 'cena', kind: 'probe' });
    await runner.run({ argv: [], cwd: '/', timeoutMs: 1, rawLogPath: '/dev/null' });
    expect(inner.spawned).toBe(1);
    expect(g.holdUntil()?.until).toBe(T0 + 600_000 + RESET_MARGIN_MS);
  });

  it('admits before start(), passes events on, and refuses without doctor', async () => {
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

    const refusing = governedRunner(
      governor(store(), { t: T0 }, () => ({ ok: false, reason: 'doctor failed' })),
      inner,
      { hostId: 'cena', kind: 'builder' },
    );
    await expect(
      refusing.start?.({
        argv: [],
        cwd: '/',
        timeoutMs: 1,
        rawLogPath: '/dev/null',
        processTag: 'tag-0123456789',
      }),
    ).rejects.toThrow(/doctor failed/);
    expect(inner.spawned).toBe(1);
  });
});

describe('doctorGate', () => {
  function writeReport(home: string, overrides: Record<string, unknown> = {}): void {
    const check = (id: string) => ({ id, label: id, result: 'pass', detail: 'ok' });
    const report = {
      schema: 'counterpoint/doctor/v1',
      hostId: 'cena',
      checkedAt: new Date(T0).toISOString(),
      claudeVersion: '2.1.322 (Claude Code)',
      matcherVersion: '2.1.322+r5',
      tools: [check('claude')],
      signingKey: [check('key')],
      integrity: check('integrity'),
      probe: PROBE_TARGET_IDS.map((id) => ({
        id,
        label: id,
        mode: probeTargetMode(id),
        result: 'blocked',
        evidence: 'probe',
        steps: [],
        leaks: [],
        trusted: true,
      })),
      sandboxIsolation: {
        id: 'sandbox-isolation',
        label: 'Sandbox isolation settings',
        result: 'pass',
        detail: 'ok',
        sources: [],
      },
      agentMode: {
        id: 'agent-mode',
        label: 'Agent permission mode',
        result: 'pass',
        detail: 'ok',
        expected: 'auto',
        effective: 'auto',
      },
      acceptedRisks: [],
      ...overrides,
    };
    mkdirSync(hostDir(home, 'cena'), { recursive: true });
    writeFileSync(join(hostDir(home, 'cena'), DOCTOR_REPORT_FILE), JSON.stringify(report));
  }

  it('passes a passing report made with the same claude', () => {
    const home = makeScratchDir('cp-gate');
    writeReport(home);
    const gate = doctorGate({ home, claudeVersion: () => '2.1.322 (Claude Code)' });
    expect(gate('cena')).toEqual({ ok: true });
  });

  it('refuses without a report, with a failing one, or for another claude version', () => {
    const home = makeScratchDir('cp-gate');
    const gate = doctorGate({ home, claudeVersion: () => '2.1.322 (Claude Code)' });
    expect(gate('cena')).toMatchObject({ ok: false, reason: expect.stringMatching(/has not run/) });

    writeReport(home, { agentMode: undefined });
    expect(gate('cena')).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/did not pass/),
    });

    writeReport(home);
    const newer = doctorGate({ home, claudeVersion: () => '2.1.323 (Claude Code)' });
    expect(newer('cena')).toMatchObject({
      ok: false,
      rerun: true,
      reason: expect.stringMatching(/checked claude 2.1.322.*would run claude 2.1.323/),
    });
    const unknown = doctorGate({ home, claudeVersion: () => null });
    expect(unknown('cena')).toMatchObject({ ok: false, rerun: false });
    // A failing report is never something an automatic rerun is assumed to fix.
    writeReport(home, { agentMode: undefined });
    expect(newer('cena')).not.toHaveProperty('rerun');
  });
});

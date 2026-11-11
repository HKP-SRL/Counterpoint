// A gate round and what follows it (gates: Bounded retries then parking; Shared test lock).
//
// After the builder's sessions for an attempt, the change's gates run in the order the host config
// lists them (read at the approved base), each recorded in the store before it starts. The round
// stops at the first failure: later gates would judge code already known to be wrong. A gate
// marked `testLock` takes the machine-wide test lock first and holds it through its service reset
// and its command; the services it names are prepared before it (services.ts).
//
// What follows a round:
// - every gate passed: the change is green;
// - a gate failed: one more failed attempt. Below the host's `attempts` the failing gate's last
//   lines go back to the next builder session; at `attempts` the change parks with that gate's
//   output, and the run moves on;
// - the run was stopped: nothing is counted;
// - the round could not judge the code (the test lock stayed held, the gate could not start): the
//   change parks at once with the reason, since another builder session would not help.
import { join } from 'node:path';
import type { GateConfig, HostConfig } from '../core/host/host-config.ts';
import type { ProtectedPaths } from '../core/security/sandbox-settings.ts';
import type { Store } from '../core/store/db.ts';
import {
  finishGateResult,
  type GateEnd,
  type GateFailReason,
  getRunChange,
  insertGateResult,
  parkRunChange,
  recordFailedAttempt,
  setGatePid,
} from '../core/store/runs.ts';
import { newGateTag, runGate } from './gate-runner.ts';
import type { GateFailure } from './prompt.ts';
import type { ServiceSession } from './services.ts';
import { acquireTestLock, type HeldTestLock, TestLockTimeout } from './test-lock.ts';

/** How long a gate waits for the shared test lock before the round gives up. */
export const DEFAULT_TEST_LOCK_WAIT_MS = 3 * 60 * 60 * 1000;

export interface GateRoundInput {
  db: Store;
  runChangeId: number;
  change: string;
  /** 1-based attempt number. */
  attempt: number;
  /** The host config read at the approved base commit. */
  config: HostConfig;
  worktree: string;
  /** `runs/<run>/<change>/`; logs go to `gates/<attempt>/<gate>.log` under it. */
  changeDir: string;
  protectedPaths: Omit<ProtectedPaths, 'workdir'>;
  consolePort: number;
  services: ServiceSession;
  testLock?: { file?: string; waitMs?: number };
  signal?: AbortSignal;
  parentEnv?: NodeJS.ProcessEnv;
  /** Called as each gate starts and ends (for live progress). */
  onGate?: (event: { gate: string; phase: 'start' | 'end'; end?: GateEnd }) => void;
  /** For tests. */
  runGate?: typeof runGate;
  acquireTestLock?: typeof acquireTestLock;
}

export interface GateRoundEntry {
  gate: string;
  resultId: number;
  end: GateEnd;
}

export type GateRound =
  | { kind: 'pass'; entries: GateRoundEntry[] }
  | { kind: 'fail'; entries: GateRoundEntry[]; failure: GateFailure }
  | { kind: 'stopped'; entries: GateRoundEntry[] }
  | { kind: 'blocked'; entries: GateRoundEntry[]; detail: string };

/** Reasons that say nothing about the code: the round could not judge it. */
const NOT_A_JUDGEMENT: ReadonlySet<GateFailReason> = new Set(['spawn', 'test-lock']);

const REASON_TEXT: Readonly<Record<GateFailReason, string>> = {
  'exit-code': 'non-zero exit',
  signal: 'killed by a signal',
  timeout: 'timed out',
  stopped: 'stopped',
  'zero-tests': 'ran zero tests',
  'no-test-count': 'printed no test count',
  service: 'a service it needs failed',
  spawn: 'could not start',
  'test-lock': 'the test lock stayed held',
};

export function describeGateReason(end: Pick<GateEnd, 'reason' | 'exitCode' | 'signal'>): string {
  if (end.reason === null) return 'passed';
  if (end.reason === 'exit-code' && end.exitCode !== null) return `exit code ${end.exitCode}`;
  if (end.reason === 'signal' && end.signal !== null) return `killed by ${end.signal}`;
  return REASON_TEXT[end.reason];
}

function failedEnd(reason: GateFailReason, tail: string, started: number): GateEnd {
  return {
    verdict: 'fail',
    reason,
    exitCode: null,
    signal: null,
    tail,
    survivors: [],
    durationMs: Date.now() - started,
  };
}

async function runOne(
  input: GateRoundInput,
  gate: GateConfig,
  attemptDir: string,
): Promise<GateRoundEntry> {
  const tag = newGateTag();
  const logPath = join(attemptDir, `${gate.name}.log`);
  const resultId = insertGateResult(input.db, {
    runChangeId: input.runChangeId,
    attempt: input.attempt,
    gate: gate.name,
    processTag: tag,
    logPath,
  });
  input.onGate?.({ gate: gate.name, phase: 'start' });
  const started = Date.now();
  let lock: HeldTestLock | null = null;
  let end: GateEnd;
  try {
    if (gate.testLock) {
      lock = await (input.acquireTestLock ?? acquireTestLock)({
        file: input.testLock?.file,
        waitMs: input.testLock?.waitMs ?? DEFAULT_TEST_LOCK_WAIT_MS,
        note: `counterpoint gate ${gate.name} for ${input.change}`,
        signal: input.signal,
      });
    }
    const prep = await input.services.prepare(gate, attemptDir, input.signal);
    if (!prep.ok) {
      // A program that could not be started says nothing about the code: the round is blocked
      // (the change parks, no attempt spent) instead of going back to the builder.
      const reason = input.signal?.aborted ? 'stopped' : prep.notStarted ? 'spawn' : 'service';
      end = failedEnd(
        reason,
        [prep.detail, prep.tail].filter((part) => part !== '').join('\n'),
        started,
      );
    } else {
      end = await (input.runGate ?? runGate)({
        gate,
        worktree: input.worktree,
        scratchDir: join(attemptDir, `.${gate.name}-scratch`),
        logPath,
        protectedPaths: input.protectedPaths,
        consolePort: input.consolePort,
        env: { ...prep.env, ...(lock?.env ?? {}) },
        parentEnv: input.parentEnv,
        signal: input.signal,
        processTag: tag,
        onStart: (pid) => setGatePid(input.db, resultId, pid),
      });
    }
  } catch (error) {
    if (error instanceof TestLockTimeout) end = failedEnd('test-lock', error.message, started);
    else if (input.signal?.aborted) end = failedEnd('stopped', '', started);
    else end = failedEnd('spawn', (error as Error).message, started);
  } finally {
    input.services.cleanup();
    lock?.release();
  }
  const { verdict, reason, exitCode, signal, tail, survivors, durationMs } = end;
  const stored: GateEnd = { verdict, reason, exitCode, signal, tail, survivors, durationMs };
  finishGateResult(input.db, resultId, stored);
  input.onGate?.({ gate: gate.name, phase: 'end', end: stored });
  return { gate: gate.name, resultId, end: stored };
}

/** Runs the change's gates in order and stops at the first failure. */
export async function runGateRound(input: GateRoundInput): Promise<GateRound> {
  const attemptDir = join(input.changeDir, 'gates', String(input.attempt));
  const entries: GateRoundEntry[] = [];
  for (const gate of input.config.gates) {
    if (input.signal?.aborted) return { kind: 'stopped', entries };
    const entry = await runOne(input, gate, attemptDir);
    entries.push(entry);
    const { end } = entry;
    if (end.verdict === 'pass') continue;
    if (end.reason === 'stopped') return { kind: 'stopped', entries };
    if (end.reason !== null && NOT_A_JUDGEMENT.has(end.reason)) {
      return {
        kind: 'blocked',
        entries,
        detail:
          `gate "${gate.name}" ${describeGateReason(end)}: ${end.tail.split('\n').at(-1) ?? ''}`.trim(),
      };
    }
    return {
      kind: 'fail',
      entries,
      failure: {
        gate: gate.name,
        attempt: input.attempt,
        reason: describeGateReason(end),
        tail: end.tail,
      },
    };
  }
  return { kind: 'pass', entries };
}

export type AfterGateRound =
  | { next: 'green' }
  | { next: 'retry'; feedback: GateFailure; attempts: number }
  | { next: 'park'; reason: string; attempts: number }
  | { next: 'stopped' };

/**
 * Records what a round means for the change and says what comes next. A failed round counts one
 * attempt; at the host's `attempts` the change parks with its last failing gate.
 */
export function afterGateRound(
  db: Store,
  runChangeId: number,
  round: GateRound,
  maxAttempts: number,
): AfterGateRound {
  switch (round.kind) {
    case 'pass':
      return { next: 'green' };
    case 'stopped':
      return { next: 'stopped' };
    case 'blocked': {
      const reason = `Gates could not run: ${round.detail}`;
      parkRunChange(db, runChangeId, reason);
      return { next: 'park', reason, attempts: getRunChange(db, runChangeId)?.attempts ?? 0 };
    }
    case 'fail': {
      const attempts = recordFailedAttempt(db, runChangeId);
      if (attempts < maxAttempts) return { next: 'retry', feedback: round.failure, attempts };
      const reason = `Gate "${round.failure.gate}" failed ${attempts} ${attempts === 1 ? 'time' : 'times'} (last: ${round.failure.reason}).`;
      parkRunChange(db, runChangeId, reason);
      return { next: 'park', reason, attempts };
    }
  }
}

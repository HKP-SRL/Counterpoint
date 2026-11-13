// A gate round and what follows it (gates: Bounded retries then parking; Shared test lock; Fast
// gates every attempt, final gates once; Gates can take only the changed files).
//
// After the builder's sessions for an attempt, the change's gates run as the host config (read at
// the build's base commit) lists them: first every gate marked to run on every attempt, in order,
// then, only when all of those passed, the final gates, in order. Each is recorded in the store
// before it starts. The round stops at the first failure: later gates would judge code already
// known to be wrong, and are recorded as not run. A gate marked `testLock` takes the machine-wide
// test lock first and holds it through its service reset and its command; the services it names
// are prepared before it (services.ts).
//
// A gate command may hold the placeholder `{changed}`: Counterpoint replaces it with the files the
// change added or modified since its base commit (`git diff --name-only --diff-filter=AM`), one
// argument each, narrowed by the gate's own `paths` patterns. A gate whose list is empty (or that
// lists `paths` none of the changed files match) has nothing to check: it is recorded as skipped,
// neither passed nor failed. Counterpoint still knows no test tool.
//
// What follows a round:
// - every gate passed (or was skipped): the change is green;
// - a gate failed: one more failed attempt. Below the host's `attempts` the failing gate's last
//   lines go back to the next builder session; at `attempts` the change parks with that gate's
//   output, and the run moves on;
// - the run was stopped: nothing is counted;
// - the round could not judge the code (the test lock stayed held, the gate could not start): the
//   change parks at once with the reason, since another builder session would not help.
import { join, matchesGlob } from 'node:path';
import { runGit } from '../core/git/run.ts';
import { CHANGED_PLACEHOLDER, type GateConfig, type HostConfig } from '../core/host/host-config.ts';
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
  /** The host config read at the build's base commit. */
  config: HostConfig;
  worktree: string;
  /** The commit the build started from: `{changed}` is what the change added or modified since. */
  baseCommit: string;
  /** `runs/<run>/<change>/`; logs go to `gates/<attempt>/<gate>.log` under it. */
  changeDir: string;
  services: ServiceSession;
  testLock?: { file?: string; waitMs?: number };
  signal?: AbortSignal;
  /** The run's environment (the owner's). */
  parentEnv?: NodeJS.ProcessEnv;
  /** Called as each gate starts and ends (for live progress). */
  onGate?: (event: { gate: string; phase: 'start' | 'end'; end?: GateEnd }) => void;
  /** For tests. */
  runGate?: typeof runGate;
  acquireTestLock?: typeof acquireTestLock;
  changedFiles?: typeof changedFiles;
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

export function describeGateReason(
  end: Pick<GateEnd, 'verdict' | 'reason' | 'exitCode' | 'signal'>,
): string {
  if (end.verdict === 'skipped') return 'skipped (no matching files changed)';
  if (end.verdict === 'not-run') return 'not run (an earlier gate failed)';
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
  command: readonly string[],
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
        command,
        worktree: input.worktree,
        logPath,
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

/**
 * The files the change added or modified since `base`, as the worktree's HEAD has them. Deleted
 * files are left out: there is nothing left to check in them.
 */
export async function changedFiles(worktree: string, base: string): Promise<string[]> {
  if (!/^[0-9a-f]{40}$/.test(base)) throw new Error('The base must be a commit id.');
  const { stdout } = await runGit(
    worktree,
    ['diff', '--name-only', '-z', '--diff-filter=AM', '--no-renames', base, 'HEAD', '--'],
    { timeoutMs: 60_000 },
  );
  return stdout.split('\0').filter((path) => path !== '');
}

/**
 * The command a gate runs this attempt: its own, with `{changed}` replaced by the changed files it
 * cares about, one argument each; null when it has nothing to check (skipped).
 */
export function gateCommand(gate: GateConfig, changed: readonly string[]): string[] | null {
  const usesChanged = gate.command.includes(CHANGED_PLACEHOLDER);
  if (!usesChanged && gate.paths === undefined) return [...gate.command];
  const paths = gate.paths;
  const files =
    paths === undefined
      ? [...changed]
      : changed.filter((file) =>
          paths.some((pattern) => file === pattern || matchesGlob(file, pattern)),
        );
  if (files.length === 0) return null;
  return gate.command.flatMap((arg) => (arg === CHANGED_PLACEHOLDER ? files : [arg]));
}

/** Records a gate that did not run its command (skipped, or not run after a failure). */
function recordWithout(
  input: GateRoundInput,
  gate: GateConfig,
  attemptDir: string,
  verdict: 'skipped' | 'not-run',
): GateRoundEntry {
  const logPath = join(attemptDir, `${gate.name}.log`);
  const resultId = insertGateResult(input.db, {
    runChangeId: input.runChangeId,
    attempt: input.attempt,
    gate: gate.name,
    processTag: newGateTag(),
    logPath,
  });
  const end: GateEnd = {
    verdict,
    reason: null,
    exitCode: null,
    signal: null,
    tail: '',
    survivors: [],
    durationMs: 0,
  };
  finishGateResult(input.db, resultId, end);
  input.onGate?.({ gate: gate.name, phase: 'end', end });
  return { gate: gate.name, resultId, end };
}

/**
 * Runs the change's every-attempt gates in order, then its final gates once they all passed, and
 * stops at the first failure (the gates after it are recorded as not run).
 */
export async function runGateRound(input: GateRoundInput): Promise<GateRound> {
  const attemptDir = join(input.changeDir, 'gates', String(input.attempt));
  const entries: GateRoundEntry[] = [];
  const ordered = [
    ...input.config.gates.filter((gate) => gate.when === 'every'),
    ...input.config.gates.filter((gate) => gate.when === 'final'),
  ];
  const needsChanged = ordered.some(
    (gate) => gate.paths !== undefined || gate.command.includes(CHANGED_PLACEHOLDER),
  );
  const changed = needsChanged
    ? await (input.changedFiles ?? changedFiles)(input.worktree, input.baseCommit)
    : [];
  for (const [index, gate] of ordered.entries()) {
    if (input.signal?.aborted) return { kind: 'stopped', entries };
    const command = gateCommand(gate, changed);
    if (command === null) {
      entries.push(recordWithout(input, gate, attemptDir, 'skipped'));
      continue;
    }
    const entry = await runOne(input, gate, attemptDir, command);
    entries.push(entry);
    const { end } = entry;
    if (end.verdict === 'pass') continue;
    if (end.reason === 'stopped') return { kind: 'stopped', entries };
    for (const later of ordered.slice(index + 1)) {
      entries.push(recordWithout(input, later, attemptDir, 'not-run'));
    }
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

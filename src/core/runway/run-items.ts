// Needs You items from the build lane (needs-you: Parked changes in Needs You; Run-stopping errors
// in Needs You). They come from the host's latest run in the store, beside the items derived from
// git (approved version changed):
// - every change that parked, with its reason, every gate attempt (verdict, reason, last lines) and
//   the log of each;
// - a run that ended on an error the owner must fix (authentication, credit, spend limit, a doctor
//   that no longer passes, a host whose integrity changed), with what to do.
// A later run replaces them: the inbox shows what the last run left for the owner.
import type { Store } from '../store/db.ts';
import { type GateResultRow, latestRun, listGateResults, listRunChanges } from '../store/runs.ts';

export interface RunAttempt {
  attempt: number;
  gate: string;
  verdict: 'pass' | 'fail' | null;
  reason: string | null;
  exitCode: number | null;
  signal: string | null;
  tail: string | null;
  logPath: string;
  durationMs: number | null;
}

export interface RunNeedsYouItem {
  id: string;
  kind: 'parked' | 'run-stopped';
  kindLabel: 'Parked' | 'Run stopped';
  runId: string;
  changeId: string | null;
  reason: string;
  /** Epoch ms. */
  at: number;
  /** For a parked change: every gate run, by attempt. */
  attempts: RunAttempt[];
  /** What the owner needs to do. */
  action: string;
}

function toAttempt(row: GateResultRow): RunAttempt {
  return {
    attempt: row.attempt,
    gate: row.gate,
    verdict: row.verdict,
    reason: row.reason,
    exitCode: row.exitCode,
    signal: row.signal,
    tail: row.tail,
    logPath: row.logPath,
    durationMs: row.durationMs,
  };
}

export function runNeedsYou(db: Store, hostId: string): RunNeedsYouItem[] {
  const run = latestRun(db, hostId);
  if (run === undefined) return [];
  const items: RunNeedsYouItem[] = [];
  if (run.state === 'ended' && (run.endReason === 'error' || run.endReason === 'refused')) {
    items.push({
      id: `run-stopped-${run.id}`,
      kind: 'run-stopped',
      kindLabel: 'Run stopped',
      runId: run.id,
      changeId: null,
      reason: run.endDetail ?? 'The run stopped on an error.',
      at: run.endedAt ?? run.startedAt,
      attempts: [],
      action:
        run.endReason === 'refused'
          ? 'Fix what doctor or the governor reported, then start a new run.'
          : 'Fix the cause above, then start a new run. Work done so far is on each change’s branch.',
    });
  }
  for (const change of listRunChanges(db, run.id)) {
    if (change.state !== 'parked') continue;
    items.push({
      id: `parked-${run.id}-${change.change}`,
      kind: 'parked',
      kindLabel: 'Parked',
      runId: run.id,
      changeId: change.change,
      reason: change.reason ?? 'Parked.',
      at: change.endedAt ?? run.startedAt,
      attempts: listGateResults(db, change.id).map(toAttempt),
      action: `Read the failing gate's output. Revise the plan or the gates and approve again, or build it in a new run. The branch ${change.branch ?? `cp/${change.change}`} keeps the work.`,
    });
  }
  return items.sort((a, b) => b.at - a.at);
}

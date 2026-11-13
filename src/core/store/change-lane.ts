// Where each change stands in the build lane, as the store knows it (runway: Where each runway
// change stands; needs-you: Options for a parked change).
//
// - A change's latest run change row: queued or building in a run that has not ended, parked,
//   green with its PR, skipped or not finished.
// - The owner's decision on a parked build (`change_holds`): Leave it parked and Re-plan it hold
//   the change, so no run builds it; Retry releases it for the next run. A decision is about one
//   parked row: once the change builds again, its new row is the latest and the decision is moot.
// - Questions a change's builder asked that cannot be undone and that nobody answered yet: they
//   hold the change back too, until the owner answers.
import type { SQLOutputValue } from 'node:sqlite';
import { addChangeNote } from './cards.ts';
import type { Store } from './db.ts';
import type { PullRequestState, RunChangeState } from './runs.ts';

export interface LatestBuild {
  runChangeId: number;
  runId: string;
  /** The run has ended (a queued or building row belongs to a run going now otherwise). */
  runEnded: boolean;
  change: string;
  state: RunChangeState;
  reason: string | null;
  prUrl: string | null;
  prState: PullRequestState | null;
  endedAt: number | null;
}

const str = (value: SQLOutputValue | undefined): string | null =>
  typeof value === 'string' ? value : null;
const num = (value: SQLOutputValue | undefined): number | null =>
  typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : null;

function prState(value: SQLOutputValue | undefined): PullRequestState | null {
  return value === 'open' || value === 'merged' || value === 'closed' ? value : null;
}

/** Each change's latest run change row on a host, by change. */
export function latestBuilds(db: Store, hostId: string): Map<string, LatestBuild> {
  const rows = db
    .prepare(
      `SELECT rc.id, rc.run_id, r.state AS run_state, rc.change, rc.state, rc.reason, rc.pr_url,
              rc.pr_state, rc.ended_at
         FROM run_changes rc JOIN runs r ON r.id = rc.run_id
        WHERE r.host_id = ?
          AND rc.id = (SELECT MAX(rc2.id) FROM run_changes rc2 JOIN runs r2 ON r2.id = rc2.run_id
                        WHERE r2.host_id = r.host_id AND rc2.change = rc.change)`,
    )
    .all(hostId);
  const builds = new Map<string, LatestBuild>();
  for (const row of rows) {
    const change = str(row.change) ?? '';
    builds.set(change, {
      runChangeId: num(row.id) ?? 0,
      runId: str(row.run_id) ?? '',
      runEnded: row.run_state === 'ended',
      change,
      state: str(row.state) as RunChangeState,
      reason: str(row.reason),
      prUrl: str(row.pr_url),
      prState: prState(row.pr_state),
      endedAt: num(row.ended_at),
    });
  }
  return builds;
}

export type HoldReason = 'left-parked' | 'replan' | 'retry';

export interface ParkDecision {
  change: string;
  /** The parked run change row the owner decided about. */
  runChangeId: number;
  state: 'held' | 'released';
  reason: HoldReason;
  at: number;
}

/** The owner's latest decision on each change's parked build, by change. */
export function parkDecisions(db: Store, hostId: string): Map<string, ParkDecision> {
  const decisions = new Map<string, ParkDecision>();
  for (const row of db.prepare('SELECT * FROM change_holds WHERE host_id = ?').all(hostId)) {
    const change = str(row.change) ?? '';
    decisions.set(change, {
      change,
      runChangeId: num(row.run_change_id) ?? 0,
      state: row.state === 'held' ? 'held' : 'released',
      reason: (str(row.reason) ?? 'retry') as HoldReason,
      at: num(row.at) ?? 0,
    });
  }
  return decisions;
}

/** Records the owner's decision on a parked build (the latest one counts). */
export function decideParked(
  db: Store,
  decision: {
    hostId: string;
    change: string;
    runChangeId: number;
    hold: boolean;
    reason: HoldReason;
  },
  now: number = Date.now(),
): void {
  db.prepare(
    `INSERT INTO change_holds (host_id, change, run_change_id, state, reason, at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (host_id, change) DO UPDATE SET
       run_change_id = excluded.run_change_id, state = excluded.state, reason = excluded.reason,
       at = excluded.at`,
  ).run(
    decision.hostId,
    decision.change,
    decision.runChangeId,
    decision.hold ? 'held' : 'released',
    decision.reason,
    now,
  );
}

/**
 * Retry: the change's parked build is released for the next run, and its next builder session
 * gets `note` (the failure, the owner's answer or hint). False when the change's latest build is
 * not parked: there is nothing to retry.
 */
export function retryParked(
  db: Store,
  input: { hostId: string; change: string; note: string; cardId?: string | null },
  now: number = Date.now(),
): boolean {
  const latest = latestBuilds(db, input.hostId).get(input.change);
  if (latest === undefined || latest.state !== 'parked') return false;
  decideParked(
    db,
    {
      hostId: input.hostId,
      change: input.change,
      runChangeId: latest.runChangeId,
      hold: false,
      reason: 'retry',
    },
    now,
  );
  addChangeNote(
    db,
    { hostId: input.hostId, change: input.change, text: input.note, cardId: input.cardId ?? null },
    now,
  );
  return true;
}

/**
 * Unanswered questions that cannot be undone, asked by builder sessions of a host, by change: the
 * run each was asked in, oldest first.
 */
export function openIrreversibleQuestions(db: Store, hostId: string): Map<string, string[]> {
  const rows = db
    .prepare(
      `SELECT change, run_id FROM cards
        WHERE host_id = ? AND source = 'session' AND reversible = 0
          AND state IN ('open', 'deferred') AND change IS NOT NULL AND run_id IS NOT NULL
        ORDER BY created_at, rowid`,
    )
    .all(hostId);
  const byChange = new Map<string, string[]>();
  for (const row of rows) {
    const change = str(row.change);
    const runId = str(row.run_id);
    if (change === null || runId === null) continue;
    byChange.set(change, [...(byChange.get(change) ?? []), runId]);
  }
  return byChange;
}

// Where an approved change stands in the build lane, and whether it can build now (runway: Where
// each runway change stands; Changes that can build now; build-runs: Dependencies are built first).
//
// "On runway" alone covered five situations. The stage says which, from the store's facts:
// - queued or building in a run going now;
// - on hold: the owner chose Leave it parked or Re-plan it, or a question its builder asked that
//   cannot be undone waits on the owner (from an earlier run: one asked in the run building it now
//   holds it back only at the end of that build);
// - parked, and the owner has not said what to do yet;
// - its latest build is green and its PR is open (or closed);
// - it waits on a change it depends on that is not built yet.
// A change can build now when it has no stage, or only a closed PR. Run builds exactly those; the
// owner can still pick a parked change (that is a retry), one with an open PR (a rebuild) or one
// that waits (the run then skips it and says why). A held change is never built.
import type { ChangeFacts } from '../framework/port.ts';
import type { LatestBuild, ParkDecision } from '../store/change-lane.ts';
import type { PullRequestState } from '../store/runs.ts';
import { type MergedFact, nothingToBuild } from './status.ts';

/** How a change held back by an irreversible question its builder asked starts its parked reason. */
export const ASKED_PARK = 'Waits on your answer to ';

/** True for a parked reason that says the change waits on its builder's ask-tool questions. */
export function parkedOnAsk(reason: string | null): boolean {
  return (reason ?? '').replace(/^Not built: /, '').startsWith(ASKED_PARK);
}

export type HoldWhy = 'left-parked' | 'replan' | 'question';

export type BuildStage =
  | { kind: 'queued' }
  | { kind: 'building' }
  | { kind: 'held'; why: HoldWhy; reason: string | null }
  | { kind: 'parked'; reason: string | null }
  | { kind: 'pr-open'; prUrl: string }
  | { kind: 'pr-closed'; prUrl: string }
  | { kind: 'waits'; on: string[] };

export interface LaneFacts {
  /** The change's latest run change row, if it was ever in a run. */
  latest?: LatestBuild;
  /** The change's latest PR (from any of its builds) and its state. */
  pr?: { prUrl: string; prState: PullRequestState | null };
  /** The owner's latest decision on a parked build of the change. */
  decision?: ParkDecision;
  /** The runs of the unanswered questions its builders asked that cannot be undone. */
  questions?: readonly string[];
  /** Its dependencies that are not built yet. */
  waitsOn?: readonly string[];
}

/** The stage of a change on the runway; null when nothing stands in its way. */
export function buildStage(facts: LaneFacts): BuildStage | null {
  const { latest } = facts;
  const going = latest !== undefined && !latest.runEnded;
  if (going && latest.state === 'queued') return { kind: 'queued' };
  if (going && latest.state === 'building') return { kind: 'building' };
  // A question asked in the run building the change now holds it back only at that build's end.
  const asked = (facts.questions ?? []).filter((runId) => !going || runId !== latest.runId);
  if (asked.length > 0) return { kind: 'held', why: 'question', reason: latest?.reason ?? null };
  const waits = facts.waitsOn ?? [];
  const waiting: BuildStage | null = waits.length > 0 ? { kind: 'waits', on: [...waits] } : null;
  if (latest?.state === 'parked') {
    const decision =
      facts.decision?.runChangeId === latest.runChangeId ? facts.decision : undefined;
    if (decision?.state === 'held') {
      const why = decision.reason === 'replan' ? 'replan' : 'left-parked';
      return { kind: 'held', why, reason: latest.reason };
    }
    // Parked on its builder's questions, now all answered: the answers release it.
    if (decision === undefined && !parkedOnAsk(latest.reason)) {
      return { kind: 'parked', reason: latest.reason };
    }
    return waiting;
  }
  // The PR of its latest build when that build is green; when it was not built since (skipped,
  // not finished), its latest PR.
  const pr =
    latest?.state === 'green'
      ? latest.prUrl === null
        ? undefined
        : { prUrl: latest.prUrl, prState: latest.prState }
      : facts.pr;
  if (pr !== undefined && (pr.prState === 'open' || pr.prState === null)) {
    return { kind: 'pr-open', prUrl: pr.prUrl };
  }
  // A closed PR does not stop a new build; a dependency that is not built does. A merged one that
  // left the change unbuilt (build tasks added since) stands in nobody's way.
  if (pr !== undefined && pr.prState === 'closed')
    return waiting ?? { kind: 'pr-closed', prUrl: pr.prUrl };
  return waiting;
}

/** The change can build now: Run builds it. */
export function canBuildNow(stage: BuildStage | null): boolean {
  return stage === null || stage.kind === 'pr-closed';
}

/** The owner may pick it for a run (a held change, or one already in a run, is never built). */
export function canPick(stage: BuildStage | null): boolean {
  return (
    stage === null ||
    (stage.kind !== 'held' && stage.kind !== 'queued' && stage.kind !== 'building')
  );
}

/**
 * The dependencies of `change` that are not built yet: each `x-depends-on` change that is neither
 * archived nor built (merged, or every task checked; only owner steps left counts as built). A
 * dependency that is not in the planning at all does not hold it back.
 */
export function unbuiltDependencies(
  change: Pick<ChangeFacts, 'dependsOn'>,
  changes: readonly (ChangeFacts & MergedFact)[],
): string[] {
  const waits: string[] = [];
  for (const dep of change.dependsOn) {
    const active = changes.find((other) => other.id === dep && !other.archived);
    if (active === undefined) continue;
    if (active.unreadable === null && nothingToBuild(active)) continue;
    waits.push(dep);
  }
  return waits;
}

/** One line on why a change cannot build now, for a run's refusal and the console. */
export function stageText(stage: BuildStage): string {
  switch (stage.kind) {
    case 'queued':
      return 'up next in the run going now';
    case 'building':
      return 'building now';
    case 'held':
      return stage.why === 'question'
        ? 'on hold until you answer its question'
        : stage.why === 'replan'
          ? 'on hold for re-planning'
          : 'on hold: you left it parked';
    case 'parked':
      return 'parked';
    case 'pr-open':
      return 'its PR is open';
    case 'pr-closed':
      return 'its PR was closed';
    case 'waits':
      return `waits on ${stage.on.join(', ')}`;
  }
}

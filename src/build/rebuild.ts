// Building a change again on its existing branch (build-runs: One worktree and branch per change).
//
// A change is often built more than once: a run parks it, the owner retries it, or a new run
// builds it after its PR was closed. Before its worktree is prepared, the orchestrator plans what
// happens to the branch:
// - its latest PR was closed or merged and nothing was built since: the branch is stale, so the
//   change starts fresh from the base (the old branch is kept as a backup, worktrees.ts);
// - otherwise it is built on again, with the base merged in;
// - the branch on the remote is checked now, so a push that could not land is known before any
//   session. A remote branch the local one does not contain is replaced at delivery (a lease on
//   exactly that head) when it is Counterpoint's own last push or a closed PR's; one holding
//   commits Counterpoint did not push while its PR is open parks the change up front.
// A change built on again continues from where its previous build stopped: that build's handoff,
// its last failing gate and its recorded ticks are carried to the new run's row, and the ticks are
// made again in the worktree's task list (the base merge may have reset it).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChangeFacts, FrameworkAdapter } from '../core/framework/port.ts';
import { catBlob, revParseMaybe } from '../core/git/plumbing.ts';
import { runGit } from '../core/git/run.ts';
import type { Store } from '../core/store/db.ts';
import {
  lastPushedHead,
  latestPullRequests,
  previousRunChange,
  type RunChangeRow,
  runChangeTicks,
  updateRunChange,
} from '../core/store/runs.ts';
import { buildTicks, withTicks } from './build-ticks.ts';
import { branchFor } from './worktrees.ts';

export interface BranchPlan {
  /** Start the branch again from the base, keeping the old one as a backup. */
  fresh: boolean;
  /** The remote head the delivery push replaces (`--force-with-lease`); null: fast-forward. */
  lease: string | null;
  /** Why the change cannot build now, or null. */
  refuse: string | null;
}

async function contains(root: string, commit: string, tip: string): Promise<boolean> {
  const result = await runGit(root, ['merge-base', '--is-ancestor', commit, tip], {
    allowExitCodes: [0, 1, 128],
  });
  return result.exitCode === 0;
}

/**
 * What happens to the change's branch in this build. `remoteHead` is the branch on the remote: a
 * commit, null when the remote has none, undefined when it could not be asked.
 */
export async function planBranch(input: {
  db: Store;
  hostId: string;
  root: string;
  row: RunChangeRow;
  remoteHead: string | null | undefined;
}): Promise<BranchPlan> {
  const { db, hostId, row } = input;
  const branch = branchFor(row.change);
  const local = await revParseMaybe(input.root, `refs/heads/${branch}^{commit}`);
  const pr = latestPullRequests(db, hostId).find((p) => p.change === row.change);
  const previous = previousRunChange(db, hostId, row.change, row.id);
  // Closed or merged, and no build of the change since: its branch is stale.
  const prDone =
    pr !== undefined &&
    (pr.prState === 'closed' || pr.prState === 'merged') &&
    (previous === undefined || previous.id === pr.id);
  // A change resumed after a crash keeps the branch its build started.
  const fresh = prDone && local !== null && row.baseCommit === null;
  const remote = input.remoteHead;
  if (remote === null || remote === undefined) return { fresh, lease: null, refuse: null };
  if (local !== null && !fresh && (await contains(input.root, remote, local))) {
    return { fresh, lease: null, refuse: null };
  }
  const pushed = lastPushedHead(db, hostId, row.change);
  if (!prDone && pr !== undefined && pushed !== null && remote !== pushed) {
    return {
      fresh,
      lease: null,
      refuse: `${branch} on the remote has commits Counterpoint did not push (${remote.slice(0, 12)}) and its PR is open. Bring them into the local branch, or close the PR, then build again.`,
    };
  }
  return { fresh, lease: remote, refuse: null };
}

/**
 * A change built on again in a new run continues from its previous build: that build's handoff,
 * last failing gate and recorded ticks. Returns the row it continued from, or null.
 */
export function continueFromPrevious(
  db: Store,
  hostId: string,
  row: RunChangeRow,
): RunChangeRow | null {
  const previous = previousRunChange(db, hostId, row.change, row.id);
  if (previous === undefined) return null;
  const ticks = runChangeTicks(db, previous.id);
  updateRunChange(db, row.id, {
    ...(previous.handoffPath === null ? {} : { handoffPath: previous.handoffPath }),
    ...(previous.gateFailure === null ? {} : { gateFailure: previous.gateFailure }),
    ...(ticks.length === 0 ? {} : { taskTicks: ticks }),
  });
  return previous;
}

/**
 * Makes the recorded ticks again in the worktree's task list (left uncommitted, as sessions leave
 * them) and returns the build tasks still open there; null without a task list.
 */
export async function reapplyTicks(input: {
  worktree: string;
  change: ChangeFacts;
  adapter: FrameworkAdapter;
  baseCommit: string;
  ticked: readonly string[];
}): Promise<string[] | null> {
  const path = input.adapter.tasksPath(input.change);
  if (path === null) return null;
  const file = join(input.worktree, path);
  if (!existsSync(file)) return null;
  const list = readFileSync(file, 'utf8');
  const bytes = await catBlob(input.worktree, input.baseCommit, path);
  const branchPoint = bytes === null ? null : new TextDecoder().decode(bytes);
  const next =
    branchPoint === null
      ? list
      : withTicks(input.adapter, list, buildTicks(input.adapter, branchPoint, input.ticked));
  if (next !== list) writeFileSync(file, next);
  return input.adapter.openTasks(next);
}

/** The prompt of a session that resolves a base merge's conflicts, and nothing else. */
export function conflictPrompt(input: {
  changeId: string;
  branch: string;
  baseBranch: string;
  conflicts: readonly string[];
}): string {
  return [
    `You are working unattended in this git worktree (branch ${input.branch}, the change "${input.changeId}"). Nobody is watching: never wait for an answer.`,
    '',
    `${input.baseBranch} moved on, and Counterpoint merged it into this branch. These files conflict:`,
    ...input.conflicts.map((path) => `- ${path}`),
    '',
    'Resolve each conflict so that what the base changed and what this branch built both still work, and remove every conflict marker (<<<<<<<, =======, >>>>>>>).',
    '',
    'Rules:',
    '- Change only what resolving these conflicts needs. Build nothing else: the change has its own sessions.',
    '- Do not run git commands that change anything (add, commit, merge, checkout, reset, stash, rebase). Counterpoint commits the merge after this session.',
    '- Do not edit planning files, .claude/ or .counterpoint/.',
    '- You may run the tests related to the files you change.',
    '- When every conflict is resolved, stop.',
  ].join('\n');
}

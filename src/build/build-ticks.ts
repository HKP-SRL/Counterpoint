// Build ticks reach the base (build-ticks-and-owner-steps D-1 to D-4; planning-writes: Builds never
// write planning files directly, Build ticks ride in the build PR, Ticks that would conflict land
// after the merge).
//
// Builders never write planning files: the ticks they make in their worktree's task list are
// recorded in the store, counted against the build's base commit (session-commit.ts). They reach
// the base branch like this:
// 1. At delivery, after the gates and before the push, Counterpoint adds one tick-only commit to
//    the build branch: the task list at the branch tip with each recorded tick of a build task
//    made again through the adapter's `tickTask` (owner steps and tasks no longer listed are
//    skipped), committed as the owner with the `Counterpoint-Run` trailer. It is never the
//    builder's own edit. The worktree's uncommitted list is then reset to the committed one, and
//    merging the PR ticks the base.
// 2. Before that, a three-way merge of the task list alone (branch point, base as last fetched,
//    branch with the ticks), in a scratch folder, decides. When it conflicts (git treats ticks on
//    neighbouring lines as a conflict), no tick commit is made, ticks an earlier delivery put on
//    the branch are taken back out, and the run change is marked "ticks after merge".
// 3. While the PR is open, the minute tick runs the same check when the base's list changed, and
//    takes the ticks back out with a commit built with plumbing and pushed, only when the remote
//    branch is still at Counterpoint's last push and no run holds the change.
// 4. Once a build PR delivered by this version merges, the recorded ticks missing on the base land
//    as one small planning write (one edit holding them all), shown under Landing on a card that
//    starts already answered: the owner's merge was the click.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ChangeFacts, type FrameworkAdapter, findChange } from '../core/framework/port.ts';
import { resolveBase } from '../core/git/base-ref.ts';
import { catBlob, revParseMaybe, updateRefCas } from '../core/git/plumbing.ts';
import { runGit } from '../core/git/run.ts';
import { hostDir } from '../core/host/home.ts';
import { commitOnBase, type PlanningHost, type PlanningWrite } from '../core/planning/writes.ts';
import type { NewCard } from '../core/store/cards.ts';
import type { Store } from '../core/store/db.ts';
import { cardPlanningWrite } from '../core/store/planning-writes.ts';
import {
  activeRun,
  type LatestPullRequest,
  latestPullRequests,
  listRunChanges,
  type RunChangeFlag,
  runChangeTicks,
  updateRunChange,
} from '../core/store/runs.ts';
import {
  defaultGhRun,
  findOnPath,
  type GhRun,
  ghEnv,
  type PushPlanInput,
  type PushTarget,
  pushBranchCommit,
  pushTarget,
} from './deliver.ts';

/** What build ticks need from the host's framework adapter. */
export type TaskRules = Pick<
  FrameworkAdapter,
  'tasksPath' | 'tickTask' | 'tickedTasks' | 'openTasks' | 'sameApartFromTicks'
>;

async function textAt(root: string, commit: string, path: string): Promise<string | null> {
  const bytes = await catBlob(root, commit, path);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

/** The recorded ticks that are build tasks: open at the branch point, never an owner step. */
export function buildTicks(
  rules: TaskRules,
  branchPoint: string,
  ticked: readonly string[],
): string[] {
  const open = new Set(rules.openTasks(branchPoint));
  return ticked.filter((task) => open.has(task));
}

/**
 * True when `after` differs from `before` only in build tasks ticked: nothing reworded, nothing
 * unticked, no owner step ticked.
 */
export function onlyBuildTicks(rules: TaskRules, before: string, after: string): boolean {
  if (!rules.sameApartFromTicks(before, after)) return false;
  if (rules.tickedTasks(after, before).length > 0) return false;
  const open = new Set(rules.openTasks(before));
  return rules.tickedTasks(before, after).every((task) => open.has(task));
}

/** `list` with each of `ticks` ticked; a task no longer in the list is skipped. */
export function withTicks(rules: TaskRules, list: string, ticks: readonly string[]): string {
  let next = list;
  for (const task of ticks) next = rules.tickTask(next, task) ?? next;
  return next;
}

/**
 * True when merging the branch's task list into the base's would conflict: a three-way merge of
 * that one file (`git merge-file`), in `scratch`, never a worktree. A list gone from the base
 * conflicts with any change to it.
 */
export async function ticksConflict(
  scratch: string,
  lists: { branchPoint: string; base: string | null; branch: string },
): Promise<boolean> {
  const { branchPoint, base, branch } = lists;
  if (branch === branchPoint || base === branchPoint || base === branch) return false;
  if (base === null) return true;
  const dir = join(scratch, `ticks-merge-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(join(dir, 'point'), branchPoint, { mode: 0o600 });
    writeFileSync(join(dir, 'base'), base, { mode: 0o600 });
    writeFileSync(join(dir, 'branch'), branch, { mode: 0o600 });
    const merged = await runGit(dir, ['merge-file', '-p', '-q', 'base', 'point', 'branch'], {
      allowExitCodes: Array.from({ length: 256 }, (_, code) => code),
    });
    // The number of conflicts, or an error (negative): either way the ticks stay out.
    return merged.exitCode !== 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function ticksMessage(change: string, runId: string, out: boolean): string {
  return out
    ? `cp: ${change} ticks out\n\nThe base's task list changed next to them: they land after this PR merges.\n\nCounterpoint-Run: ${runId}`
    : `cp: ${change} ticks\n\nCounterpoint-Run: ${runId}`;
}

export interface DeliveryTicksInput {
  /** The change's worktree; its branch is checked out there. */
  worktree: string;
  branch: string;
  change: ChangeFacts;
  rules: TaskRules;
  /** The commit the build started from: the branch point. */
  baseCommit: string;
  /** The base as last fetched, or null when it cannot be read. */
  baseNow: string | null;
  /** The ticks recorded for the build (since the base commit). */
  ticked: readonly string[];
  runId: string;
  /** A folder of the run's for the merge's files. */
  scratch: string;
}

export interface DeliveryTicks {
  /** Where the ticks are: in the PR, or landing after it merges; null without a task list. */
  place: 'pr' | 'after-merge' | null;
  /** The commit Counterpoint added (the ticks, or the ticks taken back out), or null. */
  commit: string | null;
  /** Set when the list would differ from the branch point in more than build ticks. */
  flag: RunChangeFlag | null;
}

/**
 * At delivery, before the push (D-1, D-2, D-3): the tick-only commit, or no ticks in the PR when
 * they would conflict. Moves the branch by compare-and-swap.
 */
export async function deliveryTicks(input: DeliveryTicksInput): Promise<DeliveryTicks> {
  const { worktree, rules } = input;
  const none: DeliveryTicks = { place: null, commit: null, flag: null };
  const path = rules.tasksPath(input.change);
  if (path === null) return none;
  const ref = `refs/heads/${input.branch}`;
  const tip = await revParseMaybe(worktree, `${ref}^{commit}`);
  if (tip === null) return none;
  const branchPoint = await textAt(worktree, input.baseCommit, path);
  const atTip = await textAt(worktree, tip, path);
  if (branchPoint === null || atTip === null) return none;
  const ticked = withTicks(rules, atTip, buildTicks(rules, branchPoint, input.ticked));
  if (!onlyBuildTicks(rules, branchPoint, ticked)) {
    return {
      ...none,
      flag: {
        kind: 'planning-edit',
        path,
        detail: 'The task list differs from the branch point in more than ticks; no tick commit.',
      },
    };
  }
  const base = input.baseNow === null ? branchPoint : await textAt(worktree, input.baseNow, path);
  const conflict = await ticksConflict(input.scratch, { branchPoint, base, branch: ticked });
  const content = conflict ? branchPoint : ticked;
  let commit: string | null = null;
  if (content !== atTip) {
    const made = await commitOnBase(
      worktree,
      tip,
      [{ path, content }],
      ticksMessage(input.change.id, input.runId, conflict),
    );
    if (made.changed) {
      const moved = await updateRefCas(worktree, ref, made.commit, tip, 'counterpoint: ticks');
      if (!moved.ok) throw new Error(`${input.branch} moved while its ticks were committed.`);
      commit = made.commit;
    }
  }
  if (conflict) {
    // The index follows the new commit; the worktree keeps its ticks uncommitted.
    if (commit !== null) await runGit(worktree, ['reset', '-q', '--', path]);
  } else {
    // The worktree's uncommitted list is reset to the committed one.
    await runGit(worktree, ['checkout', '-q', 'HEAD', '--', path]);
  }
  return { place: conflict ? 'after-merge' : 'pr', commit, flag: null };
}

// ---------------------------------------------------------------------------------------------
// The minute tick: open PRs whose list now conflicts, and merged PRs whose ticks must land.

/** A host as build ticks read it (the daemon's HostRuntime fits). */
export interface TicksRuntime {
  host: PlanningHost;
  reader: import('../core/framework/port.ts').GitFileReader;
  adapter: FrameworkAdapter | null;
}

export interface BuildTicksOptions {
  db: Store;
  home: string;
  runtime: (hostId: string) => TicksRuntime | null;
  /** Fetches the host's base branch; `error` says why it failed. */
  fetchBase: (
    host: PlanningHost,
    env: Readonly<Record<string, string>>,
  ) => Promise<{ error: string | null }>;
  /** Raises a card (or finds the one its key names) and answers it (the daemon's card desk). */
  raise: (card: NewCard) => { id: string; state: string };
  answer: (cardId: string) => Promise<unknown>;
  /** Starts a planning write (the planning lane's submit). */
  submit: (hostId: string, write: PlanningWrite, cardId: string) => unknown;
  log?: (event: string, fields: Record<string, unknown>) => void;
  /** Seams for tests. */
  gh?: GhRun;
  pushTarget?: (root: string, baseBranch: string) => Promise<PushTarget>;
  push?: (input: PushPlanInput) => Promise<void>;
}

export const BUILD_TICKS_KIND = 'build-ticks';

export class BuildTicks {
  readonly #o: BuildTicksOptions;
  /** The base tip each open PR's list was last checked against. */
  readonly #seen = new Map<number, string>();

  constructor(options: BuildTicksOptions) {
    this.#o = options;
  }

  /**
   * After the PR states are asked: takes the ticks back out of open PRs whose list now conflicts,
   * and lands the ticks of merged ones that are missing on the base. A failure is logged and
   * tried again at the next tick.
   */
  async tick(hostId: string, env: Readonly<Record<string, string>>): Promise<void> {
    const runtime = this.#o.runtime(hostId);
    if (runtime === null || runtime.adapter === null) return;
    for (const pr of latestPullRequests(this.#o.db, hostId)) {
      try {
        if (pr.prState === 'open' && pr.ticks === 'pr') {
          await this.#takeOut(runtime, runtime.adapter, pr, env);
        } else if (pr.prState === 'merged' && (pr.ticks === 'pr' || pr.ticks === 'after-merge')) {
          await this.#land(runtime, runtime.adapter, pr, env);
        }
      } catch (error) {
        this.#o.log?.('build-ticks-failed', {
          hostId,
          change: pr.change,
          message: (error as Error).message,
        });
      }
    }
  }

  #scratch(hostId: string): string {
    const dir = join(hostDir(this.#o.home, hostId), 'build-ticks');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }

  #gh(env: Readonly<Record<string, string>>): GhRun {
    return this.#o.gh ?? defaultGhRun(findOnPath('gh', env.PATH), ghEnv(env));
  }

  /** True while a run that has not ended still has the change to build. */
  #held(hostId: string, change: string): boolean {
    const run = activeRun(this.#o.db);
    if (run === undefined || run.hostId !== hostId) return false;
    return listRunChanges(this.#o.db, run.id).some(
      (row) => row.change === change && (row.state === 'queued' || row.state === 'building'),
    );
  }

  async #facts(runtime: TicksRuntime, adapter: FrameworkAdapter, commit: string, change: string) {
    const snapshot = await adapter.snapshot(runtime.reader, commit);
    const facts = findChange(snapshot.changes, change);
    return facts === undefined || facts.archived || facts.unreadable !== null ? null : facts;
  }

  /** D-3, while the PR is open: the ticks taken back out when the base's list now conflicts. */
  async #takeOut(
    runtime: TicksRuntime,
    adapter: FrameworkAdapter,
    pr: LatestPullRequest,
    env: Readonly<Record<string, string>>,
  ): Promise<void> {
    const { host } = runtime;
    if (pr.baseCommit === null || pr.branch === null) return;
    if (this.#held(host.id, pr.change)) return;
    const base = await resolveBase(host.root, host.baseBranch);
    if (base.tip === null || this.#seen.get(pr.id) === base.tip) return;
    const facts = await this.#facts(runtime, adapter, pr.baseCommit, pr.change);
    const path = facts === null ? null : adapter.tasksPath(facts);
    const ref = `refs/heads/${pr.branch}`;
    const local = await revParseMaybe(host.root, `${ref}^{commit}`);
    const branchPoint = path === null ? null : await textAt(host.root, pr.baseCommit, path);
    if (path === null || local === null || branchPoint === null) {
      this.#seen.set(pr.id, base.tip);
      return;
    }
    const baseList = await textAt(host.root, base.tip, path);
    const branchList = await textAt(host.root, local, path);
    if (
      branchList === null ||
      !(await ticksConflict(this.#scratch(host.id), {
        branchPoint,
        base: baseList,
        branch: branchList,
      }))
    ) {
      this.#seen.set(pr.id, base.tip);
      return;
    }
    // Only over Counterpoint's own last push: someone else's commit there is left alone.
    const viewed = await this.#gh(env)(['pr', 'view', pr.prUrl, '--json', 'state,headRefOid'], {
      cwd: this.#scratch(host.id),
    });
    if (viewed.exitCode !== 0) return;
    let head: unknown = null;
    try {
      head = (JSON.parse(viewed.stdout) as { headRefOid?: unknown }).headRefOid;
    } catch {
      return;
    }
    if (head !== local) return;
    const run = /Counterpoint-Run: (\S+)/.exec(
      (await runGit(host.root, ['log', '-1', '--format=%B', local])).stdout,
    )?.[1];
    const made = await commitOnBase(
      host.root,
      local,
      [{ path, content: branchPoint }],
      ticksMessage(pr.change, run ?? 'ticks', true),
    );
    if (!made.changed) return;
    const target = await (this.#o.pushTarget ?? pushTarget)(host.root, host.baseBranch);
    await (this.#o.push ?? pushBranchCommit)({
      root: host.root,
      branch: pr.branch,
      commit: made.commit,
      target,
      env,
    });
    await updateRefCas(host.root, ref, made.commit, local, 'counterpoint: ticks out');
    if (pr.worktree !== null) {
      // The worktree kept for review follows the branch; its own list is left as it is.
      await runGit(pr.worktree, ['reset', '-q', '--', path]).catch(() => undefined);
    }
    updateRunChange(this.#o.db, pr.id, { ticks: 'after-merge', headCommit: made.commit });
    this.#seen.set(pr.id, base.tip);
    this.#o.log?.('build-ticks-out', { hostId: host.id, change: pr.change, commit: made.commit });
  }

  /** D-3, after the merge: the recorded ticks missing on the base, as one planning write. */
  async #land(
    runtime: TicksRuntime,
    adapter: FrameworkAdapter,
    pr: LatestPullRequest,
    env: Readonly<Record<string, string>>,
  ): Promise<void> {
    const { host } = runtime;
    const fetched = await this.#o.fetchBase(host, env);
    const base = await resolveBase(host.root, host.baseBranch);
    if (base.tip === null) {
      throw new Error(`Couldn't read ${base.label}: ${fetched.error ?? 'it is not fetched yet'}.`);
    }
    const facts = await this.#facts(runtime, adapter, base.tip, pr.change);
    const path = facts === null ? null : adapter.tasksPath(facts);
    const list = path === null ? null : await textAt(host.root, base.tip, path);
    const open = new Set(list === null ? [] : adapter.openTasks(list));
    // Owner steps are never open build tasks; a task gone or already ticked is not missing.
    const missing = runChangeTicks(this.#o.db, pr.id).filter((task) => open.has(task));
    if (path !== null && missing.length > 0) {
      const n = missing.length;
      const card = this.#o.raise({
        hostId: host.id,
        key: `${BUILD_TICKS_KIND}:${host.id}:${pr.id}`,
        kind: BUILD_TICKS_KIND,
        source: 'change',
        change: pr.change,
        question: `Tick ${n} build ${n === 1 ? 'task' : 'tasks'} of ${pr.change} on ${host.baseBranch}`,
        why: 'Its build PR merged; these ticks were kept out of it so it would merge.',
        options: [
          {
            label: 'Tick them',
            consequence: 'Counterpoint ticks them in a small PR and merges it.',
          },
          { label: 'Leave them', consequence: `They stay open on ${host.baseBranch}.` },
        ],
        recommended: 0,
        reversible: true,
        blocking: false,
      });
      if (card.state === 'open') await this.#o.answer(card.id);
      const started = cardPlanningWrite(this.#o.db, card.id);
      if (started === undefined) {
        this.#o.submit(
          host.id,
          {
            message: `${pr.change}: build ticks\n\n${missing.map((task) => `- ${task}`).join('\n')}`,
            edits: [{ kind: 'ticks', path, tasks: missing }],
          },
          card.id,
        );
      }
    }
    updateRunChange(this.#o.db, pr.id, { ticks: 'base' });
    this.#o.log?.('build-ticks-landing', { hostId: host.id, change: pr.change, missing });
  }
}

// Owner steps as cards (owner-inbox 4.2, 4.3; owner-steps: Owner steps are cards, Do it for me,
// Land it).
//
// Every unchecked `Owner:` step of a change that is planned (ready to approve), on the runway, or
// built and not archived (build-ticks-and-owner-steps D-5: a step after the build stays a card,
// naming the merged build PR, until it is ticked on the base) is a card: Done ticks the step through a planning write (planning-lane.ts: a small PR the same click
// merges), Do it for me runs the step in a worktree (D-8), Later is the card's own L. The cards are
// recomputed from the base as last fetched whenever Needs You is read: a step ticked on the base,
// or no longer in the plan, resolves its card; a step that comes back reopens it.
//
// A step is named by a hash of its text (`stepId`), so a card and its actions survive the step's
// task number changing, and a step whose text changes is a new card.
//
// Do it for me (D-8) runs a Claude Code session as the owner, like a builder, in a fresh detached
// worktree at the base tip (never the owner's checkout), with the host's `worktree.clone` folders
// cloned in (D-13). What it changed is kept as text edits (owner-step-results.ts) and the worktree
// is removed. A Land it card shows the diff; only Land it puts the edits and the step's tick on the
// base, as one small PR through the planning lane that the same click merges. A base that changed
// the same files since lands nothing, and the step card comes back to do again on the new base.
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { buildClaudeArgv } from '../agent/claude-argv.ts';
import type { AgentRunner } from '../agent/runner.ts';
import { type ChangeFacts, findChange } from '../core/framework/port.ts';
import { resolveBase } from '../core/git/base-ref.ts';
import { diffBytes } from '../core/git/diff.ts';
import { catBlob } from '../core/git/plumbing.ts';
import { runGit } from '../core/git/run.ts';
import { hostDir } from '../core/host/home.ts';
import { readHostConfig } from '../core/host/host-config.ts';
import { checkWrite, composeWrite, type PlanningHost } from '../core/planning/writes.ts';
import {
  deriveChangeStatus,
  type MergedFact,
  ownerSteps,
  withMerged,
} from '../core/runway/status.ts';
import { type CardAction, type CardRow, getCardByKey, type NewCard } from '../core/store/cards.ts';
import {
  getOwnerStepResult,
  insertOwnerStepResult,
  type OwnerStepResultRow,
  runningOwnerStepResults,
  type TextEdit,
  updateOwnerStepResult,
} from '../core/store/owner-step-results.ts';
import { cardPlanningWrite, type PlanningEdit } from '../core/store/planning-writes.ts';
import { mergedPullRequests } from '../core/store/runs.ts';
import type { ApprovalViews } from '../server/approval-views.ts';
import type { CardDesk } from '../server/cards.ts';
import type { HostRuntime, HostRuntimes } from '../server/hosts.ts';
import { readHostSettings } from './host-settings.ts';
import type { PlanningLane } from './planning-lane.ts';
import { cloneIntoWorktree } from './worktree-clone.ts';

export const OWNER_STEP_KIND = 'owner-step';
export const OWNER_STEP_RESULT_KIND = 'owner-step-result';

/** How long a Do it for me session may run. */
const SESSION_TIMEOUT_MS = 60 * 60 * 1000;
/** The most files one result may change (a planning write holds 64 edits, one is the tick). */
const MAX_FILES = 63;
const MAX_FILE_BYTES = 1024 * 1024;
/** The most diff text a Land it card keeps. */
const MAX_DIFF_CHARS = 200_000;

/** The step's id in a card key and its actions. */
export function stepId(step: string): string {
  return createHash('sha256').update(step).digest('hex').slice(0, 12);
}

const keyPrefix = (hostId: string): string => `owner-step:${hostId}:`;

export function ownerStepKey(hostId: string, change: string, step: string): string {
  return `${keyPrefix(hostId)}${change}:${stepId(step)}`;
}

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
};

/** The PR number in a PR URL, or null. */
function prNumber(prUrl: string): string | null {
  return /\/pull\/(\d+)$/.exec(prUrl)?.[1] ?? null;
}

/**
 * The card for one owner step. `merged` is the change's merged build PR, for a built change: the
 * card says so (D-5).
 */
export function ownerStepCard(
  hostId: string,
  change: string,
  step: string,
  merged: { prUrl: string | null } | null = null,
): NewCard {
  const id = stepId(step);
  const number = merged?.prUrl == null ? null : prNumber(merged.prUrl);
  return {
    hostId,
    key: ownerStepKey(hostId, change, step),
    kind: OWNER_STEP_KIND,
    source: 'change',
    change,
    question: clip(step.replace(/^Owner:\s*/, ''), 500),
    why:
      merged === null
        ? `A step of ${change} only you can sign off.`
        : `${change} is ${number === null ? 'built' : `merged (PR #${number})`}. A step after the build only you can sign off.`,
    options: [
      {
        label: 'Done',
        consequence: 'Counterpoint ticks it in a small PR and merges it.',
        action: { type: 'tick-owner-step', change, step: id },
      },
      {
        label: 'Do it for me',
        consequence: 'Counterpoint does it in its own worktree and shows you the result first.',
        action: { type: 'perform-owner-step', change, step: id },
      },
    ],
    recommended: 0,
    reversible: true,
    blocking: false,
  };
}

/**
 * The owner steps that are cards now: those of planned, runway and built changes that are not
 * archived. `mergedPrs` maps a change whose build PR merged to that PR's URL.
 */
export function ownerStepCards(
  hostId: string,
  changes: readonly (ChangeFacts & MergedFact)[],
  onRunway: ReadonlySet<string>,
  mergedPrs: ReadonlyMap<string, string> = new Map(),
): NewCard[] {
  const cards: NewCard[] = [];
  for (const change of changes) {
    if (change.archived) continue;
    const { status } = deriveChangeStatus(change, onRunway.has(change.id) ? 'on-runway' : null);
    if (status !== 'ready' && status !== 'on-runway' && status !== 'built') continue;
    const merged = status === 'built' ? { prUrl: mergedPrs.get(change.id) ?? null } : null;
    for (const step of ownerSteps(change)) {
      cards.push(ownerStepCard(hostId, change.id, step, merged));
    }
  }
  return cards;
}

/** What a Do it for me session is told: the step is its whole task. */
export function ownerStepPrompt(change: string, step: string): string {
  return [
    `You are doing one step of the plan of the change "${change}" for the owner of this repository, in a fresh git worktree of its base branch. Nobody is watching: never wait for an answer.`,
    '',
    "The step, in the owner's words:",
    '',
    step,
    '',
    'Rules:',
    '- Do this step and nothing else. It is your whole task.',
    "- Don't edit the change's planning files: Counterpoint ticks the step itself.",
    "- Don't commit, push or open a pull request. Leave your changes in this worktree: the owner sees them as a diff and decides whether they land.",
    '- Pin exact versions when you install or upgrade anything.',
    '- If the step needs something outside this repository and this machine (an account, a website, a payment, another person), change nothing and say in one line what the owner must do.',
    '- End with one line on what you did.',
  ].join('\n');
}

/** The Land it card for a result (D-8): its diff shows on the card. */
export function landCard(result: OwnerStepResultRow): NewCard {
  const paths = result.edits.map((edit) => edit.path);
  const count = paths.length === 1 ? 'this file' : `these ${paths.length} files`;
  return {
    hostId: result.hostId,
    key: `${OWNER_STEP_RESULT_KIND}:${result.id}`,
    kind: OWNER_STEP_RESULT_KIND,
    source: 'change',
    change: result.change,
    question: clip(`Land ${count} for "${result.step.replace(/^Owner:\s*/, '')}"?`, 500),
    why: clip(paths.join(', '), 300),
    options: [
      {
        label: 'Land it',
        consequence: 'One small PR with exactly this diff and the step ticked, merged at once.',
        action: { type: 'land-owner-step', resultId: result.id },
      },
      {
        label: 'Discard',
        consequence: 'Nothing lands; the step comes back to do again.',
        action: { type: 'discard-owner-step', resultId: result.id },
      },
    ],
    recommended: 0,
    reversible: true,
    blocking: false,
  };
}

/** Why a result cannot be landed as text edits, or null. */
class ResultRefused extends Error {}

/** `<parent>/<repo>-worktrees/owner-step-<result>`: a sibling of the repository, never inside it. */
function resultWorktree(hostRoot: string, resultId: string): string {
  const root = realpathSync(hostRoot);
  return join(dirname(root), `${basename(root)}-worktrees`, `owner-step-${resultId}`);
}

function decodeText(bytes: Uint8Array, path: string): string {
  if (bytes.includes(0)) throw new ResultRefused(`${path} is not a text file.`);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ResultRefused(`${path} is not a text file.`);
  }
}

/**
 * What the session changed in `worktree` against `base`, as text edits. Refuses a deletion, a
 * binary, executable or oversized file, a link, and more files than one write holds.
 */
async function collectEdits(root: string, worktree: string, base: string): Promise<TextEdit[]> {
  const { stdout } = await runGit(worktree, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--no-renames',
    '--ignore-submodules=none',
  ]);
  const edits: TextEdit[] = [];
  for (const entry of stdout.split('\0')) {
    if (entry === '') continue;
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (status.includes('D')) throw new ResultRefused(`It deleted ${path}.`);
    if (status.includes('T') || status.includes('U')) {
      throw new ResultRefused(`${path} changed in a way Counterpoint can't land.`);
    }
    const file = join(worktree, path);
    const stat = lstatSync(file, { throwIfNoEntry: false });
    if (stat === undefined || !stat.isFile()) {
      throw new ResultRefused(`${path} is not a plain file.`);
    }
    if ((stat.mode & 0o111) !== 0) throw new ResultRefused(`${path} is executable.`);
    if (stat.size > MAX_FILE_BYTES) throw new ResultRefused(`${path} is larger than 1 MiB.`);
    const after = decodeText(readFileSync(file), path);
    const was = await catBlob(root, base, path);
    const before = was === null ? null : decodeText(was, path);
    if (before === after) continue;
    edits.push({ kind: 'text', path, before, after });
  }
  if (edits.length > MAX_FILES) {
    throw new ResultRefused(`It changed ${edits.length} files; one PR holds at most ${MAX_FILES}.`);
  }
  if (edits.length > 0) {
    const refused = checkWrite({ message: 'owner step', edits }, () => true);
    if (refused !== null) throw new ResultRefused(refused.detail);
  }
  return edits.sort((a, b) => a.path.localeCompare(b.path));
}

/** The session's last words: its `result` text, on one line. */
function lastWords(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null;
  const text = (result as { result?: unknown }).result;
  return typeof text === 'string' && text.trim() !== '' ? clip(text, 240) : null;
}

export interface OwnerStepsOptions {
  desk: CardDesk;
  runtimes: Pick<HostRuntimes, 'get'>;
  approvals: Pick<ApprovalViews, 'states' | 'merged'>;
  lane: Pick<PlanningLane, 'submit'>;
  /** The Counterpoint home: session logs and diff scratch files go under the host's folder. */
  home: string;
  /** The owner's login environment (sessions run as the owner, like builders). */
  ownerEnv: () => Promise<Readonly<Record<string, string>>>;
  /** Fetches the host's base branch. */
  fetchBase: (
    host: PlanningHost,
    env: Readonly<Record<string, string>>,
  ) => Promise<{ error: string | null }>;
  /** The runner a Do it for me session runs with (the claude on the owner's PATH). */
  runner: (hostId: string, env: Readonly<Record<string, string>>) => AgentRunner;
  sessionTimeoutMs?: number;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

/** A step of a change at the base now, found by its id. */
interface FoundStep {
  runtime: HostRuntime;
  change: ChangeFacts;
  text: string;
}

export class OwnerSteps {
  readonly #o: OwnerStepsOptions;
  readonly #working = new Set<Promise<void>>();

  constructor(options: OwnerStepsOptions) {
    this.#o = options;
  }

  /** Resolves once no Do it for me session is working. */
  async idle(): Promise<void> {
    while (this.#working.size > 0) await Promise.allSettled([...this.#working]);
  }

  /**
   * At daemon start: a session the last daemon was running is gone. Its step card comes back to
   * do again, and its worktree is removed.
   */
  async recover(): Promise<void> {
    for (const result of runningOwnerStepResults(this.#o.desk.store)) {
      this.#fail(result, 'Counterpoint stopped while doing it; Do it for me starts it again.');
      const runtime = this.#o.runtimes.get(result.hostId);
      if (runtime !== null) await this.#removeWorktree(runtime.host.root, result.id);
    }
  }

  /**
   * Raises a card for every owner step that is one now and resolves those that no longer are.
   * Nothing is resolved while the base cannot be read, nor for a change that is unreadable.
   */
  async sync(hostId: string): Promise<void> {
    const runtime = this.#o.runtimes.get(hostId);
    if (runtime === null) return;
    const view = await runtime.view();
    if (view.snapshot === null || view.snapshot.unreadable !== null) return;
    const states = await this.#o.approvals.states(runtime);
    const onRunway = new Set(
      [...states].filter(([, state]) => state.state === 'on-runway').map(([id]) => id),
    );
    const changes = withMerged(view.snapshot.changes, this.#o.approvals.merged(hostId));
    const cards = ownerStepCards(
      hostId,
      changes,
      onRunway,
      mergedPullRequests(this.#o.desk.store, hostId),
    );
    const keep = new Set(cards.map((card) => card.key ?? ''));
    const prefix = keyPrefix(hostId);
    const unreadable = changes.filter((change) => change.unreadable !== null);
    for (const change of unreadable) {
      // Its last known cards stay as they are until it reads again.
      for (const key of this.#keysOf(hostId, change.id)) keep.add(key);
    }
    for (const input of cards) {
      try {
        const existing =
          input.key == null ? undefined : getCardByKey(this.#o.desk.store, input.key);
        if (existing?.state === 'resolved') this.#o.desk.reopen(existing);
        else this.#o.desk.raise(input);
        // A change that turned Built keeps its cards; their why line says it is merged (D-5).
        if (existing !== undefined && existing.why !== input.why) {
          this.#o.desk.setWhy(existing, input.why);
        }
      } catch {
        // a step the card model refuses is left out, never a failed read
      }
    }
    this.#o.desk.resolveMissing(hostId, prefix, keep, 'No longer open in the plan.');
  }

  #keysOf(hostId: string, change: string): string[] {
    const like = `${keyPrefix(hostId)}${change}:`;
    return this.#o.desk.store
      .prepare(
        `SELECT key FROM cards WHERE host_id = ? AND key IS NOT NULL AND substr(key, 1, ?) = ?`,
      )
      .all(hostId, like.length, like)
      .map((row) => String(row.key));
  }

  async #find(hostId: string | null, change: string, step: string): Promise<FoundStep | null> {
    if (hostId === null) throw new Error('This card has no project.');
    const runtime = this.#o.runtimes.get(hostId);
    if (runtime === null) throw new Error('This project is no longer registered.');
    const view = await runtime.view();
    const facts = view.snapshot === null ? undefined : findChange(view.snapshot.changes, change);
    if (facts === undefined || facts.archived) return null;
    const text = ownerSteps(facts).find((candidate) => stepId(candidate) === step);
    return text === undefined ? null : { runtime, change: facts, text };
  }

  /** Done: ticks the step through a planning write; the card shows it landing (D-12). */
  async #tick(action: { change: string; step: string }, card: CardRow): Promise<string> {
    const found = await this.#find(card.hostId, action.change, action.step);
    if (found === null) return 'Already done, or no longer in the plan.';
    const path = found.runtime.adapter?.tasksPath(found.change) ?? null;
    if (path === null) throw new Error(`${action.change} has no task list Counterpoint can tick.`);
    this.#o.lane.submit(
      found.runtime.host.id,
      {
        message: `${action.change}: owner step done\n\n${found.text}`,
        edits: [{ kind: 'tick', path, task: found.text }],
      },
      card.id,
    );
    return 'Landing as a small PR.';
  }

  /** Do it for me: starts the session and returns at once; a Land it card follows (D-8). */
  async #perform(action: { change: string; step: string }, card: CardRow): Promise<string> {
    const found = await this.#find(card.hostId, action.change, action.step);
    if (found === null) return 'Already done, or no longer in the plan.';
    const { host } = found.runtime;
    const env = await this.#o.ownerEnv();
    const fetched = await this.#o.fetchBase(host, env);
    const base = await resolveBase(host.root, host.baseBranch);
    if (base.tip === null) {
      throw new Error(`Couldn't read ${base.label}: ${fetched.error ?? 'it is not fetched yet'}.`);
    }
    const result = insertOwnerStepResult(this.#o.desk.store, {
      hostId: host.id,
      change: action.change,
      stepId: action.step,
      step: found.text,
      stepCardId: card.id,
      base: base.tip,
    });
    const work = this.#work(result, found.runtime, env).catch((error: Error) => {
      this.#o.log?.('owner-step-failed', { resultId: result.id, message: error.message });
      this.#fail(this.#result(result.id), `Couldn't do it: ${clip(error.message, 240)}`);
    });
    this.#working.add(work);
    void work.finally(() => this.#working.delete(work));
    return 'Working on it in its own worktree.';
  }

  #result(id: string): OwnerStepResultRow {
    const row = getOwnerStepResult(this.#o.desk.store, id);
    if (row === undefined) throw new Error('That result is gone.');
    return row;
  }

  /** The result failed or was dropped: its step card comes back, saying why. */
  #fail(result: OwnerStepResultRow, why: string, state: 'failed' | 'discarded' = 'failed'): void {
    updateOwnerStepResult(this.#o.desk.store, result.id, { state, summary: why });
    const card = result.stepCardId === null ? undefined : this.#o.desk.get(result.stepCardId);
    if (card !== undefined && card.state !== 'resolved') this.#o.desk.reopen(card, why);
  }

  async #removeWorktree(hostRoot: string, resultId: string): Promise<void> {
    let path: string;
    try {
      path = resultWorktree(hostRoot, resultId);
    } catch {
      return;
    }
    const removed = await runGit(hostRoot, ['worktree', 'remove', '--force', path], {
      allowExitCodes: [0, 128],
    }).catch(() => null);
    if (removed?.exitCode !== 0) {
      rmSync(path, { recursive: true, force: true });
      await runGit(hostRoot, ['worktree', 'prune'], { allowExitCodes: [0, 128] }).catch(
        () => undefined,
      );
    }
  }

  /** The session in its worktree, then the result collected and the worktree removed. */
  async #work(
    result: OwnerStepResultRow,
    runtime: HostRuntime,
    env: Readonly<Record<string, string>>,
  ): Promise<void> {
    const { host } = runtime;
    const base = result.base as string;
    const path = resultWorktree(host.root, result.id);
    mkdirSync(dirname(path), { recursive: true });
    await runGit(host.root, ['worktree', 'add', '--detach', path, base], { timeoutMs: 300_000 });
    let edits: TextEdit[];
    let words: string | null;
    try {
      const config = await readHostConfig(runtime.reader, base);
      await cloneIntoWorktree({
        hostRoot: host.root,
        worktree: path,
        paths: config.worktree.clone,
      });
      const { settings } = readHostSettings(this.#o.desk.store, host.id);
      const run = await this.#o.runner(host.id, env).run({
        argv: buildClaudeArgv({
          model: settings.model,
          effort: settings.effort,
          maxTurns: settings.maxTurns,
          maxBudgetUsd: settings.maxBudgetUsd,
          prompt: ownerStepPrompt(result.change, result.step),
        }),
        cwd: path,
        env,
        timeoutMs: this.#o.sessionTimeoutMs ?? SESSION_TIMEOUT_MS,
        rawLogPath: join(hostDir(this.#o.home, host.id), 'owner-steps', `${result.id}.jsonl`),
      });
      words = lastWords(run.result);
      if (run.timedOut) throw new ResultRefused('It ran out of time.');
      edits = await collectEdits(host.root, path, base);
    } catch (error) {
      if (!(error instanceof ResultRefused)) throw error;
      this.#fail(result, `Couldn't land what it did: ${error.message}`);
      return;
    } finally {
      await this.#removeWorktree(host.root, result.id);
    }
    if (edits.length === 0) {
      this.#fail(result, `Counterpoint couldn't do it: ${words ?? 'it changed nothing.'}`);
      return;
    }
    const diff = await this.#diff(host.root, host.id, edits);
    let ready = updateOwnerStepResult(this.#o.desk.store, result.id, {
      state: 'ready',
      edits,
      diff,
      summary: words,
    });
    const land = this.#o.desk.raise(landCard(ready));
    ready = updateOwnerStepResult(this.#o.desk.store, result.id, { landCardId: land.id });
    const step = ready.stepCardId === null ? undefined : this.#o.desk.get(ready.stepCardId);
    if (step !== undefined)
      this.#o.desk.outcome(step, 'Done in its own worktree; Land it decides.');
  }

  /** The unified diff of the edits, as git makes it, capped for the card. */
  async #diff(root: string, hostId: string, edits: readonly TextEdit[]): Promise<string> {
    const tmpDir = join(hostDir(this.#o.home, hostId), 'owner-steps', 'tmp');
    mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
    const encode = (text: string | null) => (text === null ? null : new TextEncoder().encode(text));
    let diff = '';
    for (const edit of edits) {
      const part = await diffBytes({
        root,
        tmpDir,
        logicalPath: edit.path,
        before: encode(edit.before),
        after: encode(edit.after),
      });
      diff += part.diff;
      if (part.truncated) diff += `… (${edit.path}: the rest of its diff is not shown)\n`;
      if (diff.length > MAX_DIFF_CHARS) {
        return `${diff.slice(0, MAX_DIFF_CHARS)}\n… (the rest of the diff is not shown)\n`;
      }
    }
    return diff;
  }

  /** Land it: the result and the step's tick as one small PR that the same click merges (D-8). */
  async #land(action: { resultId: string }, card: CardRow): Promise<string> {
    const result = getOwnerStepResult(this.#o.desk.store, action.resultId);
    if (result === undefined || result.landCardId !== card.id) throw new Error('No such result.');
    if (result.state === 'discarded' || result.state === 'failed') {
      return 'Discarded earlier; nothing landed.';
    }
    const live = cardPlanningWrite(this.#o.desk.store, card.id);
    if (live !== undefined && live.state !== 'cancelled') return 'Already landing.';
    const runtime = this.#o.runtimes.get(result.hostId);
    if (runtime === null) throw new Error('This project is no longer registered.');
    const adapter = runtime.adapter;
    if (adapter === null) throw new Error('This project has no planning Counterpoint can write.');
    const found = await this.#find(result.hostId, result.change, result.stepId);
    const tasksPath = found === null ? null : adapter.tasksPath(found.change);
    const edits: PlanningEdit[] = [...result.edits];
    if (found !== null && tasksPath !== null) {
      edits.push({ kind: 'tick', path: tasksPath, task: found.text });
    }
    const write = {
      message: `${result.change}: ${clip(result.step.replace(/^Owner:\s*/, ''), 60)}\n\nAn owner step Counterpoint did (Do it for me), landed with Land it.\n\n${result.step}`,
      edits,
    };
    // Nothing lands where the base changed the same files since the result was made.
    const { host } = runtime;
    const env = await this.#o.ownerEnv();
    const fetched = await this.#o.fetchBase(host, env);
    const base = await resolveBase(host.root, host.baseBranch);
    if (base.tip === null) {
      throw new Error(`Couldn't read ${base.label}: ${fetched.error ?? 'it is not fetched yet'}.`);
    }
    const composed = await composeWrite(host.root, base.tip, write, {
      isPlanningPath: () => true,
      tickTask: adapter.tickTask,
    });
    if (!composed.ok) {
      if (composed.reason !== 'conflict') throw new Error(composed.detail);
      this.#fail(
        result,
        `${base.label} changed since the result was made (${composed.detail}); Do it for me runs it again on the new base.`,
        'discarded',
      );
      return `Nothing landed: ${base.label} changed since (${composed.detail}). The step is back to do again.`;
    }
    this.#o.lane.submit(host.id, write, card.id, { code: true });
    updateOwnerStepResult(this.#o.desk.store, result.id, { state: 'submitted' });
    return 'Landing as a small PR.';
  }

  /** Discard: nothing lands; the step card comes back. */
  async #discard(action: { resultId: string }, card: CardRow): Promise<string> {
    const result = getOwnerStepResult(this.#o.desk.store, action.resultId);
    if (result === undefined || result.landCardId !== card.id) throw new Error('No such result.');
    const live = cardPlanningWrite(this.#o.desk.store, card.id);
    if (live !== undefined && live.state !== 'cancelled') {
      throw new Error('It is landing; Cancel it under Landing first.');
    }
    if (result.state !== 'discarded' && result.state !== 'failed') {
      this.#fail(result, 'Discarded; Do it for me runs it again.', 'discarded');
    }
    return 'Discarded.';
  }

  /** Carries out an owner-step action from the catalog. */
  async act(action: CardAction, card: CardRow, _note: string | null): Promise<string> {
    switch (action.type) {
      case 'tick-owner-step':
        return this.#tick(action, card);
      case 'perform-owner-step':
        return this.#perform(action, card);
      case 'land-owner-step':
        return this.#land(action, card);
      case 'discard-owner-step':
        return this.#discard(action, card);
      default:
        throw new Error('Counterpoint cannot do this.');
    }
  }
}

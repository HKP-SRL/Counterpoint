// The planning-write lane (owner-inbox D-11, D-12; planning-writes: Writes land through a small
// PR, Landing is shown, A blocked write is kept, Local-only hosts write locally).
//
// Each write the owner's click asks for is stored first, then:
// 1. made as one commit as the owner on the remote base as just fetched (core/planning/writes.ts);
// 2. pushed to its own branch `cp-plan/<id>` with the owner's credentials for that one push, and
//    opened as a PR through the PR delivery's `gh --repo` (no token of Counterpoint's own);
// 3. merged as soon as GitHub allows it (`gh pr merge`, squash if the repository allows it, else
//    merge, else rebase; only the commit Counterpoint pushed; its branch deleted), then the base is
//    fetched so the console shows it in seconds.
// Never `--admin` or any other bypass. Required checks still running: the minute tick merges once
// they pass. A conflict or a base that must be up to date: the write is made again on the new base
// and pushed, up to three times. Failed checks, a required review, a closed PR, a failed push or
// `gh` call: the write is blocked with one line on why, kept until the owner picks Retry or
// Cancel. Cancel closes the PR and puts the card back as it was before the click.
//
// The owner's checkout, local base branch and working files are never touched. A host with no
// remote commits to its local base branch instead (build-from-remote-base D-5).
//
// Writes go one at a time per host (a queue), but a blocked one does not hold up the next.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveBase } from '../core/git/base-ref.ts';
import { hostDir } from '../core/host/home.ts';
import {
  checkWrite,
  commitOnBase,
  composeWrite,
  landLocally,
  type PlanningHost,
  type PlanningRules,
  type PlanningWrite,
} from '../core/planning/writes.ts';
import { reopenCard } from '../core/store/cards.ts';
import type { Store } from '../core/store/db.ts';
import {
  type BlockedKind,
  getPlanningWrite,
  insertPlanningWrite,
  livePlanningWrites,
  type PlanningWriteRow,
  type PlanningWriteUpdate,
  planBranch,
  updatePlanningWrite,
} from '../core/store/planning-writes.ts';
import {
  DeliveryError,
  defaultGhRun,
  findOnPath,
  type GhRun,
  ghEnv,
  ghFailure,
  ghRepoArg,
  openPullRequest,
  PR_URL_RE,
  type PushPlanInput,
  type PushTarget,
  pushPlanCommit,
  pushTarget,
  type RepoSlug,
  writeBody,
} from './deliver.ts';

/** Times a write is made again on a moved base before it waits for the owner. */
const MAX_REDOS = 3;
/** How often, and how many times, a just-opened PR is asked again while GitHub works it out. */
const SETTLE_MS = 2000;
const SETTLE_TRIES = 5;
const MAX_STEPS = 12;

export class PlanningWriteRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanningWriteRefused';
  }
}

export interface PlanningLaneOptions {
  db: Store;
  home: string;
  /** The registered host, or null. */
  host: (hostId: string) => PlanningHost | null;
  /** The host's planning rules (from its framework adapter), or null when it has none. */
  rules: (hostId: string) => PlanningRules | null;
  /** The owner's login environment: `gh`, `ssh` and their logins. */
  ownerEnv: () => Promise<Readonly<Record<string, string>>>;
  /** Fetches the host's base branch; `error` says why it failed. */
  fetchBase: (
    host: PlanningHost,
    env: Readonly<Record<string, string>>,
  ) => Promise<{ error: string | null }>;
  /** Told about every change to a write (the daemon updates its card and the console). */
  onChange?: (row: PlanningWriteRow) => void;
  log?: (event: string, fields: Record<string, unknown>) => void;
  /** Seams for tests. */
  gh?: GhRun;
  pushTarget?: (root: string, baseBranch: string) => Promise<PushTarget>;
  push?: (input: PushPlanInput) => Promise<void>;
  settleMs?: number;
  now?: () => number;
}

/** What `gh pr view` says about a write's PR. */
interface PrStatus {
  state: 'OPEN' | 'MERGED' | 'CLOSED' | null;
  merge: string;
  checks: 'none' | 'pending' | 'failed' | 'passed';
  review: string;
  head: string | null;
}

const PENDING_RUN = new Set(['QUEUED', 'IN_PROGRESS', 'WAITING', 'PENDING', 'REQUESTED']);
const FAILED_RUN = new Set([
  'FAILURE',
  'CANCELLED',
  'TIMED_OUT',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
]);

function checksOf(rollup: unknown): PrStatus['checks'] {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'none';
  let pending = false;
  for (const raw of rollup) {
    if (typeof raw !== 'object' || raw === null) continue;
    const check = raw as { status?: unknown; conclusion?: unknown; state?: unknown };
    if (typeof check.state === 'string') {
      // A commit status.
      if (check.state === 'FAILURE' || check.state === 'ERROR') return 'failed';
      if (check.state === 'PENDING' || check.state === 'EXPECTED') pending = true;
      continue;
    }
    if (typeof check.status === 'string' && PENDING_RUN.has(check.status)) {
      pending = true;
      continue;
    }
    if (typeof check.conclusion === 'string' && FAILED_RUN.has(check.conclusion)) return 'failed';
  }
  return pending ? 'pending' : 'passed';
}

function parseStatus(stdout: string): PrStatus | null {
  try {
    const raw = JSON.parse(stdout) as Record<string, unknown>;
    const state = raw.state;
    return {
      state: state === 'OPEN' || state === 'MERGED' || state === 'CLOSED' ? state : null,
      merge: typeof raw.mergeStateStatus === 'string' ? raw.mergeStateStatus : 'UNKNOWN',
      checks: checksOf(raw.statusCheckRollup),
      review: typeof raw.reviewDecision === 'string' ? raw.reviewDecision : '',
      head: typeof raw.headRefOid === 'string' ? raw.headRefOid : null,
    };
  } catch {
    return null;
  }
}

/** The repository a PR URL names. */
function slugOf(prUrl: string): RepoSlug | null {
  if (!PR_URL_RE.test(prUrl)) return null;
  const url = new URL(prUrl);
  const [owner, repo] = url.pathname.split('/').filter((part) => part !== '');
  if (owner === undefined || repo === undefined) return null;
  return { host: url.hostname.toLowerCase(), owner, repo };
}

function oneLine(text: string, max = 240): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function prBodyFor(row: PlanningWriteRow): string {
  return [
    `${row.code ? 'An owner step Counterpoint did, landed with Land it' : 'A planning write from Counterpoint, asked for'} in Needs You: ${oneLine(row.message.split('\n')[0] ?? '')}`,
    '',
    'Counterpoint merges it as soon as GitHub allows. If it is blocked, Needs You says why and offers Retry and Cancel.',
  ].join('\n');
}

const MERGEABLE = new Set(['CLEAN', 'HAS_HOOKS', 'UNSTABLE']);

/**
 * The rules a write is made with. An owner-step result the owner landed (D-8) may touch any file
 * of the repository; the path checks (no `.git`, `.counterpoint` or `.claude`) still apply.
 */
function rulesFor(rules: PlanningRules, code: boolean): PlanningRules {
  return code ? { ...rules, isPlanningPath: () => true } : rules;
}

export class PlanningLane {
  readonly #o: PlanningLaneOptions;
  readonly #queues = new Map<string, Promise<unknown>>();
  readonly #methods = new Map<string, string>();

  constructor(options: PlanningLaneOptions) {
    this.#o = options;
  }

  /**
   * Stores a write and starts landing it. Returns the stored row at once; `onChange` follows its
   * progress. Throws PlanningWriteRefused for a write that can never land (not planning files, no
   * message). `code` lets an owner-step result the owner landed touch files outside the planning.
   */
  submit(
    hostId: string,
    write: PlanningWrite,
    cardId: string | null = null,
    options: { code?: boolean } = {},
  ): PlanningWriteRow {
    const rules = this.#o.rules(hostId);
    if (this.#o.host(hostId) === null || rules === null) {
      throw new PlanningWriteRefused('This project has no planning Counterpoint can write.');
    }
    const code = options.code === true;
    const refused = checkWrite(write, rulesFor(rules, code).isPlanningPath);
    if (refused !== null) throw new PlanningWriteRefused(refused.detail);
    const row = insertPlanningWrite(
      this.#o.db,
      { hostId, cardId, message: write.message, edits: [...write.edits], code },
      this.#now(),
    );
    this.#changed(row);
    // Logged by the queue; the write stays stored for the tick.
    this.#enqueue(hostId, () => this.#advance(row.id, { passive: false })).catch(() => undefined);
    return row;
  }

  /** The minute tick: moves every write of the host along (a restart picks them up here). */
  tick(hostId: string, env?: Readonly<Record<string, string>>): Promise<void> {
    return this.#enqueue(hostId, async () => {
      for (const row of livePlanningWrites(this.#o.db, hostId)) {
        await this.#advance(row.id, { passive: true, env });
      }
    });
  }

  /** Retry on a blocked write: made again, or its PR looked at again, by why it was blocked. */
  async retry(id: string): Promise<PlanningWriteRow> {
    const row = this.#row(id);
    if (row.state !== 'blocked') return row;
    await this.#enqueue(row.hostId, async () => {
      const now = this.#row(id);
      if (now.state !== 'blocked') return;
      const look = now.prUrl !== null && (now.blocked === 'review' || now.blocked === 'gh');
      this.#set(now, look ? { state: 'landing', reason: null } : { state: 'pending', redos: 0 });
      await this.#advance(id, { passive: false });
    });
    return this.#row(id);
  }

  /** Cancel: closes the write's PR and puts its card back as it was before the click. */
  async cancel(id: string): Promise<PlanningWriteRow> {
    const row = this.#row(id);
    if (row.state === 'merged' || row.state === 'cancelled') return row;
    await this.#enqueue(row.hostId, async () => {
      const now = this.#row(id);
      if (now.state === 'merged' || now.state === 'cancelled') return;
      if (now.prUrl !== null) {
        const env = await this.#o.ownerEnv();
        const slug = slugOf(now.prUrl);
        if (slug === null) throw new Error('The PR link is not a GitHub PR.');
        const status = await this.#view(this.#gh(env), now.prUrl, slug, this.#cwd(now.hostId));
        if (status?.state === 'MERGED') {
          this.#set(now, { state: 'merged', reason: 'It had already merged.' });
          return;
        }
        if (status?.state !== 'CLOSED') await this.#close(now.prUrl, now.hostId, env);
      }
      if (now.cardId !== null) reopenCard(this.#o.db, now.cardId, this.#now());
      this.#set(now, { state: 'cancelled', reason: null });
    });
    return this.#row(id);
  }

  /** Resolves once the host's queue (or every queue) is empty. */
  async idle(hostId?: string): Promise<void> {
    for (;;) {
      const live =
        hostId === undefined
          ? [...this.#queues.values()]
          : [this.#queues.get(hostId)].filter((p): p is Promise<unknown> => p !== undefined);
      if (live.length === 0) return;
      await Promise.allSettled(live);
    }
  }

  // --- the steps -------------------------------------------------------------------------------

  #now(): number {
    return (this.#o.now ?? Date.now)();
  }

  #row(id: string): PlanningWriteRow {
    const row = getPlanningWrite(this.#o.db, id);
    if (row === undefined) throw new Error('No such planning write.');
    return row;
  }

  #changed(row: PlanningWriteRow): void {
    try {
      this.#o.onChange?.(row);
    } catch {
      // a listener's failure never stops the write
    }
  }

  #set(row: PlanningWriteRow, update: PlanningWriteUpdate): PlanningWriteRow {
    const next = updatePlanningWrite(this.#o.db, row.id, update, this.#now());
    if (next.state !== row.state || next.reason !== row.reason || next.prUrl !== row.prUrl) {
      this.#changed(next);
      if (next.state !== row.state) {
        this.#o.log?.('planning-write', {
          hostId: next.hostId,
          id: next.id,
          state: next.state,
          ...(next.reason === null ? {} : { reason: next.reason }),
        });
      }
    }
    return next;
  }

  #block(row: PlanningWriteRow, blocked: BlockedKind, reason: string): PlanningWriteRow {
    return this.#set(row, { state: 'blocked', blocked, reason: oneLine(reason) });
  }

  #enqueue(hostId: string, fn: () => Promise<void>): Promise<void> {
    const previous = this.#queues.get(hostId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(fn)
      .catch((error: unknown) => {
        this.#o.log?.('planning-write-failed', {
          hostId,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      });
    const settled = next.catch(() => undefined);
    this.#queues.set(hostId, settled);
    void settled.then(() => {
      if (this.#queues.get(hostId) === settled) this.#queues.delete(hostId);
    });
    return next;
  }

  #cwd(hostId: string): string {
    const dir = join(hostDir(this.#o.home, hostId), 'plan-writes');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }

  #gh(env: Readonly<Record<string, string>>): GhRun {
    return this.#o.gh ?? defaultGhRun(findOnPath('gh', env.PATH), ghEnv(env));
  }

  /**
   * Moves one write along until it rests: merged, waiting for checks, blocked, or a PR GitHub is
   * still working out. `passive` (the tick) leaves a blocked write blocked unless its PR merged or
   * became mergeable (the owner approved it, or re-ran its checks, on GitHub).
   */
  async #advance(
    id: string,
    options: { passive: boolean; env?: Readonly<Record<string, string>> },
  ): Promise<void> {
    let row = this.#row(id);
    if (row.state === 'blocked' && (!options.passive || row.prUrl === null)) return;
    let env = options.env;
    for (let step = 0; step < MAX_STEPS; step += 1) {
      if (row.state === 'merged' || row.state === 'cancelled') return;
      const wasBlocked = row.state === 'blocked';
      try {
        env ??= await this.#o.ownerEnv();
        if (row.state === 'pending') {
          row = await this.#make(row, env);
          if (row.state !== 'landing') return;
        } else {
          row = await this.#check(row, env);
          if (row.state !== 'pending') return;
        }
      } catch (error) {
        // Looking again at a blocked write changes nothing when GitHub does not answer.
        if (wasBlocked) return;
        const message = error instanceof Error ? error.message : String(error);
        this.#block(this.#row(id), 'gh', message);
        return;
      }
    }
  }

  /** Makes the write on the base as just fetched, pushes it and opens (or updates) its PR. */
  async #make(row: PlanningWriteRow, env: Readonly<Record<string, string>>) {
    const host = this.#o.host(row.hostId);
    const hostRules = this.#o.rules(row.hostId);
    const rules = hostRules === null ? null : rulesFor(hostRules, row.code);
    if (host === null || rules === null) {
      return this.#block(
        row,
        'conflict',
        'This project is no longer registered with Counterpoint.',
      );
    }
    const write: PlanningWrite = { message: row.message, edits: row.edits };
    const fetched = await this.#o.fetchBase(host, env);
    const base = await resolveBase(host.root, host.baseBranch);
    if (base.localOnly && base.remote === null) {
      const landed = await landLocally(this.#o.home, host, write, rules);
      if (!landed.ok) return this.#block(row, 'conflict', landed.detail);
      return this.#set(row, {
        state: 'merged',
        reason: landed.changed ? `Committed to ${host.baseBranch}.` : 'Already so.',
        builtOn: landed.commit,
      });
    }
    if (base.localOnly || base.tip === null) {
      return this.#block(
        row,
        'push',
        `Couldn't read ${base.remote ?? 'the remote'}/${host.baseBranch}: ${fetched.error ?? 'it is not fetched yet'}.`,
      );
    }
    const composed = await composeWrite(host.root, base.tip, write, rules);
    if (!composed.ok) {
      return this.#block(row, 'conflict', `Can't make it on ${base.label}: ${composed.detail}`);
    }
    const made = await commitOnBase(host.root, base.tip, composed.files, row.message);
    if (!made.changed) {
      // Already on the base (someone made the same edit): nothing to land.
      if (row.prUrl !== null) await this.#close(row.prUrl, row.hostId, env).catch(() => undefined);
      return this.#set(row, {
        state: 'merged',
        reason: `Already on ${base.label}.`,
        builtOn: base.tip,
      });
    }
    let target: PushTarget;
    try {
      target = await (this.#o.pushTarget ?? pushTarget)(host.root, host.baseBranch);
    } catch (error) {
      return this.#block(row, 'push', (error as Error).message);
    }
    const branch = planBranch(row.id);
    try {
      await (this.#o.push ?? pushPlanCommit)({
        root: host.root,
        branch,
        commit: made.commit,
        target,
        env,
      });
    } catch (error) {
      return this.#block(row, 'push', (error as Error).message);
    }
    row = this.#set(row, { commit: made.commit, builtOn: base.tip });
    const cwd = this.#cwd(row.hostId);
    const bodyPath = join(cwd, `${row.id}.md`);
    writeBody(bodyPath, prBodyFor(row));
    let prUrl: string;
    try {
      prUrl = await openPullRequest({
        gh: this.#gh(env),
        cwd,
        slug: target.slug,
        branch,
        base: host.baseBranch,
        title: oneLine(row.message.split('\n')[0] ?? '', 200),
        bodyPath,
        draft: false,
      });
    } catch (error) {
      if (!(error instanceof DeliveryError)) throw error;
      return this.#block(row, 'gh', error.message);
    }
    return this.#set(row, { state: 'landing', prUrl, reason: null });
  }

  async #view(gh: GhRun, prUrl: string, slug: RepoSlug, cwd: string): Promise<PrStatus | null> {
    const result = await gh(
      [
        'pr',
        'view',
        prUrl,
        '--repo',
        ghRepoArg(slug),
        '--json',
        'state,mergeStateStatus,statusCheckRollup,reviewDecision,headRefOid',
      ],
      { cwd },
    );
    if (result.exitCode !== 0) throw ghFailure('Asking GitHub about the PR', result);
    return parseStatus(result.stdout);
  }

  async #close(prUrl: string, hostId: string, env: Readonly<Record<string, string>>) {
    const slug = slugOf(prUrl);
    if (slug === null) throw new Error('The PR link is not a GitHub PR.');
    const closed = await this.#gh(env)(
      ['pr', 'close', prUrl, '--repo', ghRepoArg(slug), '--delete-branch'],
      { cwd: this.#cwd(hostId) },
    );
    if (closed.exitCode !== 0) throw ghFailure('Closing the PR', closed);
  }

  /** Looks at the write's PR and acts: merge, wait, make it again, or block. */
  async #check(row: PlanningWriteRow, env: Readonly<Record<string, string>>) {
    if (row.prUrl === null) return this.#set(row, { state: 'pending' });
    const slug = slugOf(row.prUrl);
    if (slug === null) return this.#block(row, 'gh', 'The PR link is not a GitHub PR.');
    const gh = this.#gh(env);
    const cwd = this.#cwd(row.hostId);
    let status = await this.#view(gh, row.prUrl, slug, cwd);
    for (
      let tries = 0;
      status?.state === 'OPEN' && status.merge === 'UNKNOWN' && tries < SETTLE_TRIES;
      tries += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, this.#o.settleMs ?? SETTLE_MS));
      status = await this.#view(gh, row.prUrl, slug, cwd);
    }
    if (status === null || status.state === null) {
      return this.#block(row, 'gh', 'GitHub answered with something Counterpoint cannot read.');
    }
    if (status.state === 'MERGED') return this.#merged(row, env);
    if (status.state === 'CLOSED') return this.#block(row, 'closed', 'The PR was closed.');

    if (row.state === 'blocked') {
      // The tick: only a PR the owner unblocked on GitHub goes on.
      if (row.blocked === 'review' || row.blocked === 'checks') {
        if (MERGEABLE.has(status.merge)) return this.#merge(row, env, gh, slug);
      }
      return row;
    }
    if (status.merge === 'DIRTY' || status.merge === 'BEHIND') {
      if (row.redos >= MAX_REDOS) {
        return this.#block(
          row,
          'conflict',
          `The base kept changing; made again ${MAX_REDOS} times without landing.`,
        );
      }
      return this.#set(row, { state: 'pending', redos: row.redos + 1 });
    }
    if (status.merge === 'DRAFT') return this.#block(row, 'gh', 'The PR is a draft.');
    if (status.merge === 'BLOCKED') {
      if (status.checks === 'failed') return this.#block(row, 'checks', 'Checks failed.');
      if (status.checks === 'pending') return this.#set(row, { state: 'waiting', reason: null });
      if (status.review === 'REVIEW_REQUIRED' || status.review === 'CHANGES_REQUESTED') {
        return this.#block(row, 'review', 'GitHub needs an approving review before it merges.');
      }
    }
    return this.#merge(row, env, gh, slug, status);
  }

  async #mergeMethod(gh: GhRun, slug: RepoSlug, cwd: string): Promise<string> {
    const repo = ghRepoArg(slug);
    const known = this.#methods.get(repo);
    if (known !== undefined) return known;
    const result = await gh(
      ['repo', 'view', repo, '--json', 'squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed'],
      { cwd },
    );
    let method = '--squash';
    if (result.exitCode === 0) {
      try {
        const allowed = JSON.parse(result.stdout) as Record<string, unknown>;
        if (allowed.squashMergeAllowed === true) method = '--squash';
        else if (allowed.mergeCommitAllowed === true) method = '--merge';
        else if (allowed.rebaseMergeAllowed === true) method = '--rebase';
        this.#methods.set(repo, method);
      } catch {
        // squash, asked again next time
      }
    }
    return method;
  }

  async #merge(
    row: PlanningWriteRow,
    env: Readonly<Record<string, string>>,
    gh: GhRun,
    slug: RepoSlug,
    seen?: PrStatus,
  ): Promise<PlanningWriteRow> {
    if (row.prUrl === null || row.commit === null) return this.#set(row, { state: 'pending' });
    const cwd = this.#cwd(row.hostId);
    const method = await this.#mergeMethod(gh, slug, cwd);
    const merged = await gh(
      [
        'pr',
        'merge',
        row.prUrl,
        '--repo',
        ghRepoArg(slug),
        method,
        '--delete-branch',
        // Only the commit Counterpoint pushed.
        '--match-head-commit',
        row.commit,
      ],
      { cwd },
    );
    if (merged.exitCode === 0) return this.#merged(row, env);
    const after = await this.#view(gh, row.prUrl, slug, cwd).catch(() => null);
    if (after?.state === 'MERGED') return this.#merged(row, env);
    if (after?.state === 'OPEN' && after.checks === 'pending') {
      return this.#set(row, { state: 'waiting', reason: null });
    }
    if (after?.state === 'OPEN' && after.merge === 'UNKNOWN' && seen?.merge === 'UNKNOWN') {
      // GitHub has not worked the PR out yet: the next tick looks again.
      return this.#set(row, { state: 'landing' });
    }
    return this.#block(row, 'gh', ghFailure('Merging the PR', merged).message);
  }

  async #merged(row: PlanningWriteRow, env: Readonly<Record<string, string>>) {
    const next = this.#set(row, { state: 'merged', reason: null });
    const host = this.#o.host(row.hostId);
    if (host !== null) await this.#o.fetchBase(host, env).catch(() => undefined);
    // Told again once the base is fetched, so the console shows it.
    this.#changed(next);
    return next;
  }
}

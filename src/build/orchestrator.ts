// The build orchestrator (build-runs; gates: Bounded retries then parking). It lives in the daemon:
// the console and the CLI only ask it to start, stop and report.
//
// One run at a time per machine, one change at a time within it. A run is a queue of runway
// changes in the adapter's build order (dependencies first). For each change:
// 1. the base branch is fetched from the remote (at the run's start too: the build order and the
//    config check read it); a failed fetch is retried once after 5 seconds, then the base as last
//    fetched is used and the change's run row says so (host-planning: A failed fetch never stops
//    work). Its approval must verify now, on the runway (only runway changes build); the base
//    commit now is where the branch starts and where the host config is read; every service
//    program its gates need must be runnable, or the run stops before any session (the machine's
//    problem);
// 2. its worktree is prepared (`cp/<change>` from the base commit, outside the repository, locked,
//    with the config's `worktree.clone` folders);
// 3. builder sessions run until no build task is left open; each is committed by Counterpoint
//    (builders write no git state) and hands off to the next at the context budget. A session that
//    ends by itself with tasks still open is followed by a fresh one; the change parks instead when
//    the session says what is left cannot be done in a build session, when it made no progress, or
//    when the attempt's sessions are used up (a partial change is never delivered as built);
// 4. the gates run; a failure goes back to the next session until the host's `attempts`, then the
//    change parks and the run moves on;
// 5. green: the protected-path check, then delivery (push, PR, preview: group 11).
// Before every session the approval is verified again: a change that leaves the runway stops at
// its next handoff and is skipped (Needs You shows it as approved version changed).
//
// Every spawn goes through the governor (usage-limit pauses for every lane, the doctor gate) and
// uses the claude installed at that moment: the binary and its version are resolved before each
// spawn, and when the version differs from the one the last doctor report checked, the run runs
// doctor itself (governed, about two minutes) and goes on if it passes. A claude update never stops
// a run unless it really breaks the sandbox.
//
// Session endings (6.3): a usage limit pauses every lane (the governor) and the session is run
// again after the pause, counting nothing; transient API errors back off (1, 2, 4, ... minutes) and
// retry, up to five times, then count as a failed attempt; authentication, credit and spend-limit
// errors stop the run with the reason (Needs You shows it).
//
// Stopping: the owner's stop and the run's stop time end the run at the next clean point. The
// running session is asked to finish its task and hand off; running gates are stopped (a stopped
// gate round counts nothing); no new session starts. What remains is recorded.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { AgentRunner, StreamEvent } from '../agent/runner.ts';
import { ContextMeter } from '../agent/usage.ts';
import type { ChangeFacts } from '../core/framework/port.ts';
import { findChange } from '../core/framework/port.ts';
import type { BaseFetcher, BaseFetchState } from '../core/git/base-fetch.ts';
import { runGit } from '../core/git/run.ts';
import { hostDir } from '../core/host/home.ts';
import {
  type GateConfig,
  type HostConfig,
  HostConfigError,
  readHostConfig,
} from '../core/host/host-config.ts';
import { isChangeId } from '../core/ids.ts';
import type { ApprovalState, Runway } from '../core/runway/runway.ts';
import {
  listRunChangeAskCards,
  markChangeNotesUsed,
  waitingChangeNotes,
  waitingIrreversible,
} from '../core/store/cards.ts';
import type { Store } from '../core/store/db.ts';
import {
  activeRun,
  addRunChangeFlags,
  addRunNotice,
  type BaseFetchNote,
  builderSessionCount,
  endRun,
  getRun,
  getRunChange,
  insertRun,
  insertRunChange,
  latestRun,
  listRunChanges,
  parkRunChange,
  type RunChangeFlag,
  type RunChangeRow,
  type RunEndReason,
  type RunRow,
  recordFailedAttempt,
  runChangeHandoffPath,
  runChangeTicks,
  type StoredTestShare,
  setRunStopping,
  updateRunChange,
} from '../core/store/runs.ts';
import { endAgentSession, insertAgentSession, setAgentSessionPid } from '../core/store/sessions.ts';
import { type AskServer, type BuilderAsk, openBuilderAsk } from './ask-session.ts';
import { blocksMerge, measureTestShare, planningEdits } from './branch-diff.ts';
import {
  type BuilderSessionResult,
  generatedHandoff,
  startBuilderSession,
} from './builder-session.ts';
import { afterGateRound, runGateRound } from './gates.ts';
import {
  type Governor,
  GovernorRefusal,
  governedRunner,
  MAX_TRANSIENT_RETRIES,
  transientBackoffMs,
} from './governor.ts';
import { HostSettings, readHostSettings, withDefaults } from './host-settings.ts';
import { type OwnerEnv, readOwnerEnv } from './owner-env.ts';
import { builderPrompt, type GateFailure } from './prompt.ts';
import { parseQuestions } from './questions.ts';
import { askParkWhy } from './run-cards.ts';
import {
  createServiceSession,
  describeMissingPrograms,
  type MissingServiceProgram,
  missingServicePrograms,
} from './services.ts';
import { commitSession, type SessionCommit } from './session-commit.ts';
import { describeMissingTools, missingRunTools } from './tools.ts';
import { calibrateWindow, formatBudget, knownWindow, normalizeClaudeVersion } from './windows.ts';
import { prepareWorktree, releaseWorktree, WorktreeRefusal } from './worktrees.ts';

/** The longest one builder session may run. */
export const SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000;
/** How long a run waits before trying a failed base fetch again (D-4). */
export const FETCH_RETRY_MS = 5_000;
/** The least time between two context-fill events of one session. */
const FILL_EVENT_MS = 20_000;
/** How far ahead a stop time may be. */
const MAX_STOP_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * A start request: the changes and the stop time. Everything else comes from the project's saved
 * settings (host-settings.ts); the CLI may override the model, effort and budget for one run.
 */
export const RunSettings = z.strictObject({
  /** The runway changes to build; null for every change on the runway. */
  changes: z.array(z.string().refine(isChangeId, 'Not a change name.')).min(1).max(100).nullable(),
  /** Epoch ms; no new session starts after it. Null: no stop time. */
  stopAt: z.number().int().positive().nullable(),
  model: HostSettings.shape.model.optional(),
  effort: HostSettings.shape.effort.optional(),
  budgetPercent: HostSettings.shape.budgetPercent.optional(),
});
export type RunSettings = z.infer<typeof RunSettings>;

/** What the run records: the request, the project settings in force at its start, and more. */
interface StoredSettings extends HostSettings {
  changes: string[] | null;
  stopAt: number | null;
  claudeVersion: string | null;
  /** The model's context window the run measures its budget against, once known. */
  windowTokens?: number;
}

/** A run's recorded settings; fields added since an older run was recorded get the defaults. */
function storedSettings(raw: unknown): StoredSettings {
  return withDefaults(raw as Partial<StoredSettings>) as StoredSettings;
}

export type StartResult =
  | { ok: true; runId: string }
  | { ok: false; status: 404 | 409 | 422; error: string };

/** What the console and the CLI show about a run. */
export interface RunView {
  id: string;
  hostId: string;
  state: RunRow['state'];
  settings: StoredSettings;
  stopAt: number | null;
  startedAt: number;
  endedAt: number | null;
  endReason: RunEndReason | null;
  endDetail: string | null;
  reportPath: string | null;
  budgetLabel: string | null;
  changes: Array<
    Pick<
      RunChangeRow,
      'change' | 'state' | 'reason' | 'attempts' | 'branch' | 'flags' | 'startedAt' | 'endedAt'
    > & {
      prUrl: string | null;
      previewUrl: string | null;
      /** The branch edits the host's planning files: its PR is not offered for merge. */
      notForMerge: boolean;
      /** How much of the built change is tests, against the budget; null before it is built. */
      testShare: StoredTestShare | null;
      /** Tests are a larger share of the change than the budget (advice, never a failure). */
      overBudget: boolean;
    }
  >;
  /** What the run is doing right now (only while it runs). */
  now: RunActivity | null;
  /** The governor's hold on new sessions, if any. */
  hold: { until: number; reason: string } | null;
}

export interface RunActivity {
  change: string | null;
  phase: 'calibrating' | 'preparing' | 'session' | 'gates' | 'delivering' | 'waiting' | 'stopping';
  session?: number;
  attempt?: number;
  gate?: string;
  /** Context tokens in use in the current session. */
  tokens?: number;
  detail?: string;
}

export interface HostContext {
  id: string;
  root: string;
  gitCommonDir: string;
  baseBranch: string;
}

/** A runtime the orchestrator can read a host through (the daemon's HostRuntime fits). */
export interface RunHost {
  host: HostContext;
  reader: import('../core/framework/port.ts').GitFileReader;
  adapter: import('../core/framework/port.ts').FrameworkAdapter | null;
  /** The base commit now, through the base-ref resolver (the remote base as last fetched). */
  tip(): Promise<string | null>;
}

export interface DeliverContext {
  db: Store;
  hostId: string;
  host: HostContext;
  /** The host config at the build's base commit (gates, preview). */
  config: HostConfig;
  runId: string;
  runChangeId: number;
  change: ChangeFacts;
  worktree: string;
  branch: string;
  baseCommit: string;
  changeDir: string;
  flags: RunChangeFlag[];
  signal: AbortSignal;
  /** The run's environment (the owner's): `gh` and the push run with it. */
  env: Readonly<Record<string, string>>;
  /** How much of the change is tests, against the host's budget (gates: Test budget). */
  testShare: StoredTestShare | null;
}

export interface OrchestratorOptions {
  home: string;
  db: Store;
  host: (hostId: string) => RunHost | null;
  approvals: {
    runway(runtime: RunHost): Promise<Runway>;
    state(runtime: RunHost, changeId: string): Promise<ApprovalState>;
  };
  governor: Governor;
  /** A runner for the claude installed now on the run's PATH (resolved anew for each spawn). */
  runnerFactory: (env: Readonly<Record<string, string>>) => AgentRunner;
  /** Reads the owner's environment at run start (default: their login shell, D-2). */
  ownerEnv?: () => Promise<OwnerEnv>;
  /** Fetches each host's base branch from its remote (the daemon's). Without one, none is fetched. */
  fetcher?: Pick<BaseFetcher, 'fetch' | 'setOwnerEnv'>;
  consolePort: number;
  /** Tells open consoles something about the run changed (ids only). */
  publish: (hostId: string, payload: Record<string, unknown>) => void;
  /**
   * Pushes, opens the PR and finds the preview (deliver.ts). Default: none, the change is green.
   * A throw parks the change with the error as its reason; the branch keeps the work.
   */
  deliver?: (context: DeliverContext) => Promise<{
    prUrl: string | null;
    previewUrl: string | null;
    flags?: RunChangeFlag[];
    /** The host's preview deploy, looked up in the background (awaited before the report). */
    previewLater?: (signal: AbortSignal) => Promise<string | null>;
  }>;
  /** Called before a change builds: its local preview (if running) must stop first. */
  beforeBuild?: (hostId: string, change: string) => void;
  /** Writes the run report (11.4). */
  onRunEnd?: (runId: string) => Promise<void>;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  log?: (event: string, fields?: Record<string, unknown>) => void;
  /** How builder sessions start the ask tool (`counterpoint mcp ask`); without it they get none. */
  askServer?: AskServer;
  /** Seams for tests. */
  startBuilderSession?: typeof startBuilderSession;
  runGateRound?: typeof runGateRound;
  missingServicePrograms?: (
    config: HostConfig,
    env: Readonly<Record<string, string>>,
  ) => MissingServiceProgram[];
  missingRunTools?: (env: Readonly<Record<string, string>>) => string[];
  commitSession?: typeof commitSession;
  prepareWorktree?: typeof prepareWorktree;
  calibrateWindow?: typeof calibrateWindow;
  planningEdits?: typeof planningEdits;
  measureTestShare?: typeof measureTestShare;
}

/** Why the loop stops early. */
class RunEnd extends Error {
  readonly reason: RunEndReason;
  constructor(reason: RunEndReason, detail: string) {
    super(detail);
    this.name = 'RunEnd';
    this.reason = reason;
  }
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** "1 build task" / "19 build tasks". */
function buildTasks(open: readonly string[]): string {
  return open.length === 1 ? '1 build task' : `${open.length} build tasks`;
}

/** "1 build task is" / "19 build tasks are". */
function tasksLeft(open: readonly string[]): string {
  return `${buildTasks(open)} ${open.length === 1 ? 'is' : 'are'}`;
}

const MAX_NOTE_IN_REASON = 1500;
/** How a change skipped for a parked dependency starts its reason (the run report shows it). */
const WAITS_ON = 'Waits on ';

/** A builder's note, trimmed and capped for a parked reason (Needs You, the run report). */
function clipNote(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= MAX_NOTE_IN_REASON
    ? trimmed
    : `${trimmed.slice(0, MAX_NOTE_IN_REASON - 1).trimEnd()}… (the full note is in the run folder)`;
}

export function newRunId(now: number): string {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

interface ActiveRun {
  id: string;
  hostId: string;
  /** Aborted when the run must stop at the next clean point. */
  stop: AbortController;
  stopReason: 'stopped' | 'stop-time' | null;
  stopTimer: ReturnType<typeof setTimeout> | null;
  activity: RunActivity | null;
  /** Asks the running session to wrap up (set while a session runs). */
  wrapUp: (() => void) | null;
  done: Promise<void>;
  /** Background preview-deploy lookups; the run report waits for them. */
  previews: Promise<void>[];
  /** Aborted when the owner stops the run: the lookups end at once. */
  previewStop: AbortController;
  /** The owner's environment, read at run start: every session, gate and service uses it. */
  env: Readonly<Record<string, string>>;
}

export class Orchestrator {
  readonly #o: OrchestratorOptions;
  readonly #now: () => number;
  readonly #sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  #active: ActiveRun | null = null;

  constructor(options: OrchestratorOptions) {
    this.#o = options;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? abortableSleep;
  }

  // --- the owner's requests ----------------------------------------------------------------

  /**
   * Starts a run, or refuses with the reason. Refused: an unknown host, a run already going, a
   * failing doctor verdict (unless only the claude version changed: then the run re-runs doctor
   * first), and any chosen change that is not on the runway now.
   */
  async start(hostId: string, input: unknown): Promise<StartResult> {
    const parsed = RunSettings.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false,
        status: 422,
        error: `Invalid run settings${issue === undefined ? '' : `: ${issue.path.join('.')} ${issue.message}`}.`,
      };
    }
    const request = parsed.data;
    const now = this.#now();
    if (
      request.stopAt !== null &&
      (request.stopAt <= now || request.stopAt > now + MAX_STOP_AHEAD_MS)
    ) {
      return { ok: false, status: 422, error: 'The stop time must be in the next seven days.' };
    }
    const runtime = this.#o.host(hostId);
    if (runtime === null) return { ok: false, status: 404, error: `Unknown project ${hostId}.` };
    if (runtime.adapter === null) {
      return {
        ok: false,
        status: 422,
        error: `${hostId} has no planning framework Counterpoint can read.`,
      };
    }
    if (this.#active !== null || activeRun(this.#o.db) !== undefined) {
      return { ok: false, status: 409, error: 'A run is already going. Stop it first.' };
    }

    // The base as it is on the remote now: the runway, the build order and the config check read
    // it. A failed fetch leaves the base as last fetched.
    await this.#fetchBase(runtime, undefined, new AbortController().signal);
    const runway = await this.#o.approvals.runway(runtime);
    const onRunway = new Set(runway.onRunway.map((entry) => entry.changeId));
    const chosen = request.changes ?? [...onRunway];
    const off = chosen.filter((change) => !onRunway.has(change));
    if (off.length > 0) {
      return {
        ok: false,
        status: 409,
        error: `Not on the runway now: ${off.join(', ')}. Only approved changes can build.`,
      };
    }
    if (chosen.length === 0) return { ok: false, status: 409, error: 'The runway is empty.' };
    const order = await this.#buildOrder(runtime, chosen);

    const runId = newRunId(now);
    const saved = readHostSettings(this.#o.db, hostId).settings;
    const stored: StoredSettings = {
      ...saved,
      model: request.model ?? saved.model,
      effort: request.effort ?? saved.effort,
      budgetPercent: request.budgetPercent ?? saved.budgetPercent,
      changes: order,
      stopAt: request.stopAt,
      claudeVersion: null,
    };
    insertRun(this.#o.db, { id: runId, hostId, settings: stored, stopAt: request.stopAt }, now);
    order.forEach((change, position) => {
      insertRunChange(this.#o.db, { runId, change, position });
    });
    this.#launch(runId, hostId, request.stopAt);
    return { ok: true, runId };
  }

  /** Asks the host's run (or any run) to stop at its next clean point. False when none runs. */
  stop(hostId?: string, reason: 'stopped' | 'stop-time' = 'stopped'): boolean {
    const active = this.#active;
    if (active === null || (hostId !== undefined && active.hostId !== hostId)) return false;
    if (active.stopReason === null) active.stopReason = reason;
    if (reason === 'stopped') active.previewStop.abort(new Error('The run is stopping.'));
    setRunStopping(this.#o.db, active.id);
    active.activity = {
      ...(active.activity ?? { change: null, phase: 'stopping' }),
      phase: 'stopping',
    };
    active.wrapUp?.();
    active.stop.abort(new Error('The run is stopping.'));
    this.#publish(active.hostId, { runId: active.id, state: 'stopping' });
    return true;
  }

  /** The run going now, or null. */
  running(): { runId: string; hostId: string } | null {
    return this.#active === null ? null : { runId: this.#active.id, hostId: this.#active.hostId };
  }

  /** Resolves once no run is active (after a stop, at its clean point). */
  async idle(): Promise<void> {
    await this.#active?.done;
  }

  /** The host's current or last run, or null. */
  view(hostId: string): RunView | null {
    const run = latestRun(this.#o.db, hostId);
    if (run === undefined) return null;
    const settings = storedSettings(run.settings);
    const version = settings.claudeVersion;
    const window =
      settings.windowTokens ??
      (version === null
        ? null
        : knownWindow(this.#o.db, settings.model, normalizeClaudeVersion(version)));
    const active = this.#active?.id === run.id ? this.#active : null;
    return {
      id: run.id,
      hostId: run.hostId,
      state: run.state,
      settings,
      stopAt: run.stopAt,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      endReason: run.endReason,
      endDetail: run.endDetail,
      reportPath: run.reportPath,
      budgetLabel: window === null ? null : formatBudget(settings.budgetPercent, window),
      changes: listRunChanges(this.#o.db, run.id).map((change) => ({
        change: change.change,
        state: change.state,
        reason: change.reason,
        attempts: change.attempts,
        branch: change.branch,
        flags: change.flags,
        startedAt: change.startedAt,
        endedAt: change.endedAt,
        prUrl: change.prUrl,
        previewUrl: change.previewUrl,
        notForMerge: blocksMerge(change.flags),
        testShare: change.testShare,
        overBudget: change.testShare !== null && change.testShare.percent > change.testShare.budget,
      })),
      now: active?.activity ?? null,
      hold: run.state === 'ended' ? null : this.#o.governor.holdUntil(),
    };
  }

  /**
   * Picks up a run a crash or reboot left unfinished (crash recovery runs first, see recovery.ts):
   * past its stop time it ends; otherwise it continues from where its changes stand.
   */
  resume(runId: string): void {
    const run = getRun(this.#o.db, runId);
    if (run === undefined || run.state === 'ended' || this.#active !== null) return;
    if (run.stopAt !== null && run.stopAt <= this.#now()) {
      this.#finishChanges(run.id, 'Not built: the stop time passed while Counterpoint was down.');
      endRun(this.#o.db, run.id, {
        reason: 'stop-time',
        detail: 'The stop time passed while Counterpoint was down.',
      });
      void this.#o.onRunEnd?.(run.id);
      this.#publish(run.hostId, { runId: run.id, state: 'ended' });
      return;
    }
    this.#launch(run.id, run.hostId, run.stopAt, run.state === 'stopping' ? 'stopped' : null);
  }

  // --- the loop ------------------------------------------------------------------------------

  #launch(
    runId: string,
    hostId: string,
    stopAt: number | null,
    stopReason: ActiveRun['stopReason'] = null,
  ): void {
    const active: ActiveRun = {
      id: runId,
      hostId,
      stop: new AbortController(),
      stopReason,
      stopTimer: null,
      activity: null,
      wrapUp: null,
      done: Promise.resolve(),
      previews: [],
      previewStop: new AbortController(),
      env: {},
    };
    if (stopReason !== null) active.stop.abort(new Error('The run is stopping.'));
    if (stopAt !== null) {
      active.stopTimer = setTimeout(
        () => this.stop(hostId, 'stop-time'),
        Math.max(0, stopAt - this.#now()),
      );
      active.stopTimer.unref?.();
    }
    this.#active = active;
    active.done = this.#loop(active).finally(() => {
      if (active.stopTimer !== null) clearTimeout(active.stopTimer);
      if (this.#active === active) this.#active = null;
    });
    this.#publish(hostId, { runId, state: 'running' });
  }

  #publish(hostId: string, payload: Record<string, unknown>): void {
    try {
      this.#o.publish(hostId, payload);
    } catch {
      // a missed event changes nothing: the console refetches
    }
  }

  #activity(active: ActiveRun, activity: RunActivity): void {
    active.activity = activity;
    this.#publish(active.hostId, {
      runId: active.id,
      phase: activity.phase,
      change: activity.change,
    });
  }

  async #loop(active: ActiveRun): Promise<void> {
    const { db } = this.#o;
    let end: { reason: RunEndReason; detail: string | null } = { reason: 'finished', detail: null };
    try {
      const runtime = this.#o.host(active.hostId);
      if (runtime === null || runtime.adapter === null) {
        throw new RunEnd(
          'error',
          `The project ${active.hostId} is no longer registered or readable.`,
        );
      }
      const run = getRun(db, active.id);
      if (run === undefined) throw new RunEnd('error', 'The run record is gone.');
      const settings = storedSettings(run.settings);

      // The owner's environment, read now: a tool installed since the daemon started is found.
      const owner = await (this.#o.ownerEnv ?? readOwnerEnv)();
      active.env = owner.env;
      if (owner.fallback === null) this.#o.fetcher?.setOwnerEnv(owner.env);
      if (owner.fallback !== null) {
        addRunNotice(db, active.id, owner.fallback);
        this.#publish(active.hostId, { runId: active.id, notice: true });
      }

      // What every session needs, checked before the first one: the run's tools on the owner's
      // PATH, a readable host config, and its gates' service programs. Any of them missing is the
      // machine's problem, not a change's: the run ends before any session and says which.
      const tools = (this.#o.missingRunTools ?? missingRunTools)(active.env);
      if (tools.length > 0) throw new RunEnd('error', describeMissingTools(tools));
      await this.#checkConfig(active, runtime);

      const window = await this.#window(active, settings);
      for (const change of listRunChanges(db, active.id)) {
        if (change.state !== 'queued' && change.state !== 'building') continue;
        if (active.stop.signal.aborted) break;
        try {
          await this.#buildChange(active, runtime, settings, window, change);
        } catch (error) {
          if (error instanceof RunEnd) throw error;
          // Something went wrong in Counterpoint for this change only: it parks with the error,
          // and the run goes on with the rest (a parked change never ends the run).
          this.#o.log?.('change-failed', {
            runId: active.id,
            change: change.change,
            message: (error as Error).message,
          });
          parkRunChange(
            db,
            change.id,
            `Counterpoint failed while building it: ${(error as Error).message}`,
            this.#now(),
          );
          this.#publish(active.hostId, {
            runId: active.id,
            change: change.change,
            state: 'parked',
          });
        }
      }
      if (active.stopReason !== null) {
        end = {
          reason: active.stopReason,
          detail:
            active.stopReason === 'stop-time'
              ? 'The stop time was reached.'
              : 'Stopped by the owner.',
        };
      }
    } catch (error) {
      if (error instanceof RunEnd) end = { reason: error.reason, detail: error.message };
      else {
        end = { reason: 'error', detail: `Counterpoint failed: ${(error as Error).message}` };
        this.#o.log?.('run-failed', { runId: active.id, message: (error as Error).message });
      }
    }
    if (active.previews.length > 0) {
      this.#activity(active, {
        change: null,
        phase: 'waiting',
        detail: "Waiting for the host's preview deploys",
      });
      await Promise.allSettled(active.previews);
    }
    this.#finishChanges(
      active.id,
      end.reason === 'finished' ? null : `Not built: the run ended (${end.reason}).`,
    );
    endRun(db, active.id, end, this.#now());
    active.activity = null;
    try {
      await this.#o.onRunEnd?.(active.id);
    } catch (error) {
      this.#o.log?.('run-report-failed', { runId: active.id, message: (error as Error).message });
    }
    this.#publish(active.hostId, { runId: active.id, state: 'ended', reason: end.reason });
  }

  /** Records what remains when a run ends: queued changes, and a change cut off mid-build. */
  #finishChanges(runId: string, reason: string | null): void {
    for (const change of listRunChanges(this.#o.db, runId)) {
      if (change.state === 'queued' || change.state === 'building') {
        updateRunChange(this.#o.db, change.id, {
          state: 'stopped',
          reason:
            change.state === 'building'
              ? `Stopped at a clean point; the branch ${change.branch ?? ''} keeps the work so far.`.replace(
                  '  ',
                  ' ',
                )
              : (reason ?? 'Not built.'),
          endedAt: this.#now(),
        });
      }
    }
  }

  /**
   * Fetches the host's base branch (D-3, D-4): once more after 5 seconds if it fails. Never
   * throws; null without a fetcher.
   */
  async #fetchBase(
    runtime: RunHost,
    env: Readonly<Record<string, string>> | undefined,
    signal: AbortSignal,
  ): Promise<BaseFetchState | null> {
    const fetcher = this.#o.fetcher;
    if (fetcher === undefined) return null;
    let state = await fetcher.fetch(runtime.host, env);
    if (state.error !== null && !signal.aborted) {
      this.#o.log?.('base-fetch-retry', { hostId: runtime.host.id, message: state.error });
      await this.#sleep(FETCH_RETRY_MS, signal);
      if (!signal.aborted) state = await fetcher.fetch(runtime.host, env);
    }
    return state;
  }

  /** The adapter's build order (dependencies first) for the chosen changes. */
  async #buildOrder(runtime: RunHost, chosen: readonly string[]): Promise<string[]> {
    const adapter = runtime.adapter;
    const tip = await runtime.tip();
    if (adapter === null || tip === null) return [...chosen];
    const snapshot = await adapter.snapshot(runtime.reader, tip);
    const index = new Map(snapshot.changes.map((change, i) => [change.id, i]));
    return [...chosen].sort(
      (a, b) =>
        (index.get(a) ?? Number.MAX_SAFE_INTEGER) - (index.get(b) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  /** The claude installed now on the run's PATH: a runner for it, and its version. */
  async #installed(active: ActiveRun): Promise<{ runner: AgentRunner; version: string }> {
    let runner: AgentRunner;
    try {
      runner = this.#o.runnerFactory(active.env);
    } catch (error) {
      throw new RunEnd('error', `claude could not be found: ${(error as Error).message}`);
    }
    const version = (await runner.version?.()) ?? null;
    if (version === null)
      throw new RunEnd('error', 'claude could not be run (claude --version failed).');
    return { runner, version };
  }

  /**
   * The model's window on the installed claude: learned, or from a calibration session. Stored
   * with the run's settings (with the claude version), so the console shows the budget as tokens.
   */
  async #window(active: ActiveRun, settings: StoredSettings): Promise<number> {
    const { runner, version } = await this.#installed(active);
    const normalized = normalizeClaudeVersion(version);
    const record = (windowTokens: number): number => {
      this.#o.db
        .prepare('UPDATE runs SET settings = ? WHERE id = ?')
        .run(JSON.stringify({ ...settings, claudeVersion: version, windowTokens }), active.id);
      return windowTokens;
    };
    const known = knownWindow(this.#o.db, settings.model, normalized);
    if (known !== null) return record(known);
    this.#activity(active, {
      change: null,
      phase: 'calibrating',
      detail: `learning ${settings.model}'s context window`,
    });
    const dir = join(this.#runDir(active), 'calibration');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      return record(
        await (this.#o.calibrateWindow ?? calibrateWindow)({
          runner: governedRunner(this.#o.governor, runner, {
            hostId: active.hostId,
            kind: 'calibration',
            signal: active.stop.signal,
          }),
          db: this.#o.db,
          hostId: active.hostId,
          model: settings.model,
          claudeVersion: normalized,
          cwd: dir,
          rawLogPath: join(dir, 'session.jsonl'),
          processTag: randomBytes(16).toString('hex'),
        }),
      );
    } catch (error) {
      if (error instanceof GovernorRefusal) {
        throw new RunEnd(active.stopReason ?? 'stopped', 'Stopped before the first build.');
      }
      throw new RunEnd(
        'error',
        `The model's context window could not be learned: ${(error as Error).message}`,
      );
    }
  }

  #runDir(active: ActiveRun): string {
    return join(hostDir(this.#o.home, active.hostId), 'runs', active.id);
  }

  /** Null while the change is on the runway; otherwise why it is not (in a sentence). */
  async #offRunway(runtime: RunHost, change: string): Promise<string | null> {
    const state = await this.#o.approvals.state(runtime, change);
    if (state.state === 'on-runway') return null;
    switch (state.reason) {
      case 'not-approved':
        return 'Its approval was withdrawn.';
      case 'built':
        return 'It is built already.';
      case 'unreadable':
        return 'Its planning files cannot be read at the base-branch tip.';
      case 'missing':
        return 'It is no longer in the planning files at the base-branch tip.';
    }
  }

  /**
   * The host config at the base-branch tip must be readable and its gates' service programs
   * runnable from the run's environment; otherwise the run ends before any session.
   */
  async #checkConfig(active: ActiveRun, runtime: RunHost): Promise<void> {
    const tip = await runtime.tip();
    if (tip === null) {
      throw new RunEnd('error', `The base branch ${runtime.host.baseBranch} cannot be read.`);
    }
    let config: HostConfig;
    try {
      config = await readHostConfig(runtime.reader, tip);
    } catch (error) {
      if (!(error instanceof HostConfigError)) throw error;
      throw new RunEnd('error', `The host config cannot be read: ${error.message}`);
    }
    const missing = (this.#o.missingServicePrograms ?? missingServicePrograms)(config, active.env);
    if (missing.length > 0) throw new RunEnd('error', describeMissingPrograms(missing));
  }

  /** The changes of this run that a dependent must wait on: parked, or skipped for one. */
  #blockedInRun(runId: string): Set<string> {
    return new Set(
      listRunChanges(this.#o.db, runId)
        .filter(
          (row) =>
            row.state === 'parked' ||
            (row.state === 'skipped' && (row.reason ?? '').startsWith(WAITS_ON)),
        )
        .map((row) => row.change),
    );
  }

  async #buildChange(
    active: ActiveRun,
    runtime: RunHost,
    settings: StoredSettings,
    window: number,
    row: RunChangeRow,
  ): Promise<void> {
    const { db } = this.#o;
    const adapter = runtime.adapter;
    if (adapter === null) throw new RunEnd('error', 'The project has no planning framework.');
    const changeDir = join(this.#runDir(active), row.change);
    mkdirSync(changeDir, { recursive: true, mode: 0o700 });
    this.#activity(active, { change: row.change, phase: 'preparing' });
    this.#o.beforeBuild?.(active.hostId, row.change);

    // 1. The base as it is on the remote now (D-3), unless a change resumed after a crash already
    // has the commit its build started from. A failed fetch builds from the base as last fetched
    // and the row says so (D-4).
    let baseFetch: BaseFetchNote | null = null;
    if (row.baseCommit === null) {
      const fetched = await this.#fetchBase(runtime, active.env, active.stop.signal);
      if (fetched !== null && fetched.remote !== null) {
        baseFetch = { base: fetched.label, fetchedAt: fetched.fetchedAt, error: fetched.error };
      }
      if (active.stop.signal.aborted) return;
    }

    // The approval, now: only a change on the runway builds.
    const off = await this.#offRunway(runtime, row.change);
    if (off !== null) {
      updateRunChange(db, row.id, { state: 'skipped', reason: off, endedAt: this.#now() });
      this.#publish(active.hostId, { runId: active.id, change: row.change, state: 'skipped' });
      return;
    }
    // The build starts from the base as just fetched; a change resumed after a crash keeps the
    // commit its build started from.
    const baseCommit = row.baseCommit ?? (await runtime.tip());
    if (baseCommit === null) {
      throw new RunEnd('error', `The base branch ${runtime.host.baseBranch} cannot be read.`);
    }
    const snapshot = await adapter.snapshot(runtime.reader, baseCommit);
    const facts = findChange(snapshot.changes, row.change);
    if (facts === undefined || facts.unreadable !== null) {
      updateRunChange(db, row.id, {
        state: 'skipped',
        reason: 'Its planning files cannot be read at the base-branch tip.',
        endedAt: this.#now(),
      });
      return;
    }
    // A change that depends on one that parked in this run waits for it (build-runs: A run ends
    // only when it cannot go on).
    const blocked = this.#blockedInRun(active.id);
    const waitsOn = facts.dependsOn.filter((dep) => blocked.has(dep));
    if (waitsOn.length > 0) {
      updateRunChange(db, row.id, {
        state: 'skipped',
        reason: `${WAITS_ON}${waitsOn.join(', ')}, which did not get built in this run.`,
        endedAt: this.#now(),
      });
      this.#publish(active.hostId, { runId: active.id, change: row.change, state: 'skipped' });
      return;
    }
    let config: Awaited<ReturnType<typeof readHostConfig>>;
    try {
      config = await readHostConfig(runtime.reader, baseCommit);
    } catch (error) {
      if (!(error instanceof HostConfigError)) throw error;
      throw new RunEnd('error', `The host config cannot be read: ${error.message}`);
    }
    // Every service program must be runnable before a session is spent: a missing one is the
    // machine's problem (every change needing it would fail), so the run stops and says why.
    const missing = (this.#o.missingServicePrograms ?? missingServicePrograms)(config, active.env);
    if (missing.length > 0) throw new RunEnd('error', describeMissingPrograms(missing));

    // 2. The worktree.
    let worktree: string;
    let branch: string;
    try {
      const prepared = await (this.#o.prepareWorktree ?? prepareWorktree)({
        host: runtime.host,
        change: row.change,
        baseCommit,
        runId: active.id,
        clone: config.worktree.clone,
      });
      worktree = prepared.path;
      branch = prepared.branch;
    } catch (error) {
      if (!(error instanceof WorktreeRefusal)) throw error;
      parkRunChange(db, row.id, error.message, this.#now());
      return;
    }
    updateRunChange(db, row.id, {
      state: 'building',
      baseCommit,
      ...(baseFetch === null ? {} : { baseFetch }),
      branch,
      worktree,
      ...(row.startedAt === null ? { startedAt: this.#now() } : {}),
    });
    this.#publish(active.hostId, { runId: active.id, change: row.change, state: 'building' });

    const services = createServiceSession({ config, worktree, parentEnv: active.env });
    let feedback: GateFailure | null = null;
    try {
      for (;;) {
        const current = getRunChange(db, row.id);
        const attempt = (current?.attempts ?? 0) + 1;
        // 3. Builder sessions until one finishes its work.
        const built = await this.#sessions(active, runtime, settings, window, {
          row,
          facts,
          worktree,
          branch,
          changeDir,
          attempt,
          feedback,
          gates: config.gates,
          testBudget: config.tests.budget,
        });
        if (built === 'stopped' || built === 'left-runway' || built === 'parked') return;

        // 4. The gates.
        this.#activity(active, { change: row.change, phase: 'gates', attempt });
        const round = await (this.#o.runGateRound ?? runGateRound)({
          db,
          runChangeId: row.id,
          change: row.change,
          attempt,
          config,
          worktree,
          baseCommit,
          changeDir,
          services,
          parentEnv: active.env,
          signal: active.stop.signal,
          onGate: (event) => {
            if (event.phase === 'start') {
              this.#activity(active, {
                change: row.change,
                phase: 'gates',
                attempt,
                gate: event.gate,
              });
            }
          },
        });
        const next = afterGateRound(db, row.id, round, config.attempts);
        if (next.next === 'stopped') return;
        if (next.next === 'park') {
          this.#publish(active.hostId, { runId: active.id, change: row.change, state: 'parked' });
          return;
        }
        if (next.next === 'retry') {
          feedback = next.feedback;
          continue;
        }

        // 5. Green: the planning-file check, then delivery.
        this.#activity(active, { change: row.change, phase: 'delivering' });
        const tip = (await runGit(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
        const flags = await (this.#o.planningEdits ?? planningEdits)({
          repo: worktree,
          base: baseCommit,
          tip,
          isPlanningPath: (path) => adapter.isPlanningPath(path),
        });
        addRunChangeFlags(db, row.id, flags);
        // The test share: measured, shown, never a reason to hold the change back (D-10).
        let testShare: StoredTestShare | null = null;
        try {
          const share = await (this.#o.measureTestShare ?? measureTestShare)({
            repo: worktree,
            base: baseCommit,
            tip,
            isPlanningPath: (path) => adapter.isPlanningPath(path),
          });
          testShare = { ...share, budget: config.tests.budget };
          updateRunChange(db, row.id, { testShare });
        } catch (error) {
          this.#o.log?.('test-share-failed', {
            change: row.change,
            message: (error as Error).message,
          });
        }
        let delivered: Awaited<ReturnType<NonNullable<OrchestratorOptions['deliver']>>>;
        try {
          delivered = (await this.#o.deliver?.({
            db,
            hostId: active.hostId,
            host: runtime.host,
            config,
            runId: active.id,
            runChangeId: row.id,
            change: facts,
            worktree,
            branch,
            baseCommit,
            changeDir,
            flags: getRunChange(db, row.id)?.flags ?? flags,
            signal: active.stop.signal,
            env: active.env,
            testShare,
          })) ?? { prUrl: null, previewUrl: null };
        } catch (error) {
          this.#o.log?.('delivery-failed', {
            change: row.change,
            message: (error as Error).message,
          });
          parkRunChange(
            db,
            row.id,
            `Every gate passed, but delivery failed: ${(error as Error).message.replace(/\.?$/, '.')} The branch ${branch} keeps the work.`,
            this.#now(),
          );
          this.#publish(active.hostId, { runId: active.id, change: row.change, state: 'parked' });
          return;
        }
        if (delivered.flags !== undefined) addRunChangeFlags(db, row.id, delivered.flags);
        updateRunChange(db, row.id, {
          state: 'green',
          reason: null,
          prUrl: delivered.prUrl,
          previewUrl: delivered.previewUrl,
          endedAt: this.#now(),
        });
        this.#publish(active.hostId, { runId: active.id, change: row.change, state: 'green' });
        const later = delivered.previewLater;
        if (later !== undefined) {
          active.previews.push(
            later(active.previewStop.signal)
              .then((url) => {
                if (url === null) return;
                updateRunChange(db, row.id, { previewUrl: url });
                this.#publish(active.hostId, {
                  runId: active.id,
                  change: row.change,
                  preview: true,
                });
              })
              .catch((error: unknown) => {
                this.#o.log?.('preview-lookup-failed', {
                  change: row.change,
                  message: (error as Error).message,
                });
              }),
          );
        }
        return;
      }
    } finally {
      services.cleanup();
      await releaseWorktree(runtime.host, worktree).catch(() => {});
    }
  }

  /**
   * Fresh builder sessions until one finishes its work (or the attempt's session cap). Returns
   * `built` when the gates should run.
   */
  async #sessions(
    active: ActiveRun,
    runtime: RunHost,
    settings: StoredSettings,
    window: number,
    c: {
      row: RunChangeRow;
      facts: ChangeFacts;
      worktree: string;
      branch: string;
      changeDir: string;
      attempt: number;
      feedback: GateFailure | null;
      gates: readonly GateConfig[];
      testBudget: number;
    },
  ): Promise<'built' | 'stopped' | 'left-runway' | 'parked'> {
    const { db } = this.#o;
    const adapter = runtime.adapter;
    if (adapter === null) throw new RunEnd('error', 'The project has no planning framework.');
    let transient = 0;
    let gateFeedback = c.feedback;
    // Build tasks left open after the latest session (null: the change has no task list).
    let open: string[] | null = null;
    for (let inAttempt = 0; inAttempt < settings.sessionsPerAttempt; inAttempt += 1) {
      if (active.stop.signal.aborted) return 'stopped';
      // A change the owner withdrew stops here, at its next handoff; the branch keeps the work.
      const left = await this.#offRunway(runtime, c.row.change);
      if (left !== null) {
        updateRunChange(db, c.row.id, {
          state: 'skipped',
          reason: `Stopped building: ${left} The branch ${c.branch} keeps the work so far.`,
          endedAt: this.#now(),
        });
        this.#publish(active.hostId, { runId: active.id, change: c.row.change, state: 'skipped' });
        return 'left-runway';
      }

      const { runner, version } = await this.#installed(active);
      const number = builderSessionCount(db, c.row.id) + 1;
      const handoffPath = runChangeHandoffPath(db, c.row.id);
      const handoff =
        handoffPath !== null && existsSync(handoffPath) ? readFileSync(handoffPath, 'utf8') : null;
      const prompt = builderPrompt({
        changeId: c.row.change,
        branch: c.branch,
        instructions: adapter.buildInstructions(c.facts),
        session: number,
        handoff,
        gateFailure: gateFeedback,
        doneTasks: runChangeTicks(db, c.row.id),
        gates: c.gates,
        testBudget: c.testBudget,
        ownerNotes: waitingChangeNotes(db, active.hostId, c.row.change),
        askTool: this.#o.askServer !== undefined,
      });
      markChangeNotesUsed(db, active.hostId, c.row.change, this.#now());
      const processTag = randomBytes(16).toString('hex');
      const rawLogPath = join(c.changeDir, `session-${number}.jsonl`);
      const sessionId = insertAgentSession(db, {
        hostId: active.hostId,
        runChangeId: c.row.id,
        kind: 'builder',
        number,
        model: settings.model,
        claudeVersion: version,
        processTag,
        rawLogPath,
      });
      this.#activity(active, {
        change: c.row.change,
        phase: 'session',
        session: number,
        attempt: c.attempt,
        tokens: 0,
      });
      const meter = new ContextMeter();
      let lastFillEvent = 0;
      let result: BuilderSessionResult;
      let ask: BuilderAsk | null = null;
      try {
        if (this.#o.askServer !== undefined) {
          ask = openBuilderAsk({
            db,
            home: this.#o.home,
            server: this.#o.askServer,
            dir: c.changeDir,
            agentSessionId: sessionId,
            hostId: active.hostId,
            runId: active.id,
            change: c.row.change,
          });
        }
        const session = await (this.#o.startBuilderSession ?? startBuilderSession)({
          runner: governedRunner(this.#o.governor, runner, {
            hostId: active.hostId,
            kind: 'builder',
            signal: active.stop.signal,
          }),
          model: settings.model,
          cwd: c.worktree,
          env: ask === null ? active.env : { ...active.env, ...ask.env },
          ...(ask === null ? {} : { ask: { mcpConfig: ask.mcpConfig, tools: ask.tools } }),
          rawLogPath,
          processTag,
          prompt,
          windowTokens: window,
          budgetPercent: settings.budgetPercent,
          effort: settings.effort,
          maxTurns: settings.maxTurns,
          maxBudgetUsd: settings.maxBudgetUsd,
          timeoutMs: SESSION_TIMEOUT_MS,
          onStart: (pid) => setAgentSessionPid(db, sessionId, pid),
          onEvent: (event: StreamEvent) => {
            const fill = meter.observe(event);
            if (fill !== null && active.activity?.phase === 'session') {
              active.activity = { ...active.activity, tokens: fill };
              // Open consoles see the context fill move, at most every 20 seconds.
              const now = this.#now();
              if (now - lastFillEvent >= FILL_EVENT_MS) {
                lastFillEvent = now;
                this.#publish(active.hostId, { runId: active.id, tokens: fill });
              }
            }
          },
        });
        active.wrapUp = () => session.wrapUp('stop');
        if (active.stop.signal.aborted) session.wrapUp('stop');
        result = await session.done;
      } catch (error) {
        endAgentSession(db, sessionId, { reason: 'not-started', peakContextTokens: 0 });
        if (error instanceof GovernorRefusal) return 'stopped';
        throw error;
      } finally {
        active.wrapUp = null;
        ask?.close();
      }
      endAgentSession(db, sessionId, {
        reason: result.reason,
        peakContextTokens: result.peakTokens,
        usage: { outcome: result.outcome.kind },
      });

      // Every session's work is committed, whatever ended it.
      const ticksBefore = runChangeTicks(db, c.row.id).length;
      const done = await this.#commit(c, runtime, number, result, active.id);
      gateFeedback = null;

      switch (result.outcome.kind) {
        case 'usage-limit':
          // The governor paused every lane; the next session waits for the reset. Counts nothing.
          inAttempt -= 1;
          continue;
        case 'transient': {
          transient += 1;
          if (transient > MAX_TRANSIENT_RETRIES) {
            return this.#failedAttempt(
              active,
              c,
              `API errors kept failing the session: ${result.outcome.detail}`,
            );
          }
          this.#activity(active, {
            change: c.row.change,
            phase: 'waiting',
            detail: `API error; retrying in ${Math.round(transientBackoffMs(transient) / 60_000)} min`,
          });
          await this.#sleep(transientBackoffMs(transient), active.stop.signal);
          inAttempt -= 1;
          continue;
        }
        case 'stop': {
          const what =
            result.outcome.cause === 'auth'
              ? 'claude is not signed in (authentication failed). Sign in to claude, then start a new run.'
              : result.outcome.cause === 'credit'
                ? 'Usage credits are needed. Add credit, then start a new run.'
                : 'A spend limit was reached. Raise it, then start a new run.';
          throw new RunEnd('error', `${what} (${result.outcome.detail})`);
        }
        default:
          transient = 0;
      }
      if (active.stop.signal.aborted || result.reason === 'stop-handoff') return 'stopped';
      open = done === null ? null : done.open;
      // budget-handoff, forced, timeout, failed: the next session continues from the handoff.
      if (result.reason !== 'finished') continue;
      // An irreversible question nobody answered holds back only this change (D-6). Its card stays
      // answerable; the answer reaches the change's next session.
      const held = waitingIrreversible(listRunChangeAskCards(db, active.id, c.row.change));
      if (held.length > 0) return this.#parkOpen(active, c, askParkWhy(held.length));
      // The session ended by itself. The change is built only when no build task is left open.
      if (done === null || open === null || open.length === 0) return 'built';
      if (done.blocked !== null) {
        // The tasks left wait on the owner: an `Owner:` step, or a question the builder asked
        // before doing something it cannot undo (build-runs: Ask first before what cannot be
        // undone). Needs You shows the question with its options.
        const questions = parseQuestions(done.blocked.text);
        if (questions.length > 0) updateRunChange(db, c.row.id, { questions });
        return this.#parkOpen(
          active,
          c,
          questions.length > 0
            ? `${tasksLeft(open)} still open and wait on your answer to ${questions.length === 1 ? 'a question' : `${questions.length} questions`}.`
            : `${tasksLeft(open)} still open and wait on you:\n${clipNote(done.blocked.text)}\n`,
        );
      }
      const progressed = done.commit !== null || done.ticked.length > ticksBefore;
      if (!progressed) {
        return this.#parkOpen(
          active,
          c,
          `The builder stopped with ${buildTasks(open)} still open and made no progress in session ${number} (next: ${open[0]}). Its handoff says why.`,
        );
      }
      // It stopped early with work left: a fresh session continues from its handoff.
    }
    if (open !== null && open.length > 0) {
      return this.#parkOpen(
        active,
        c,
        `${tasksLeft(open)} still open after ${settings.sessionsPerAttempt} sessions, this attempt's limit (next: ${open[0]}). Raise "Sessions per attempt" in Settings or split the change, then build it in a new run.`,
      );
    }
    return 'built';
  }

  /** A change with build tasks left that no further session can finish now: it parks, unbuilt. */
  #parkOpen(active: ActiveRun, c: { row: RunChangeRow; branch: string }, why: string): 'parked' {
    parkRunChange(
      this.#o.db,
      c.row.id,
      `Not built: ${why}${why.endsWith('\n') ? '' : ' '}The branch ${c.branch} keeps the work so far.`,
      this.#now(),
    );
    this.#publish(active.hostId, { runId: active.id, change: c.row.change, state: 'parked' });
    return 'parked';
  }

  /**
   * Commits the session's work; keeps its handoff (or writes one) and its task ticks. Returns what
   * the commit found (null without a planning adapter).
   */
  async #commit(
    c: { row: RunChangeRow; facts: ChangeFacts; worktree: string; changeDir: string },
    runtime: RunHost,
    number: number,
    result: BuilderSessionResult,
    runId: string,
  ): Promise<SessionCommit | null> {
    const { db } = this.#o;
    const adapter = runtime.adapter;
    if (adapter === null) return null;
    const interrupted =
      result.reason === 'forced' || result.reason === 'timeout' || result.end.killed;
    const commit = await (this.#o.commitSession ?? commitSession)({
      worktree: c.worktree,
      change: c.facts,
      adapter,
      changeDir: c.changeDir,
      session: number,
      runId,
      interrupted,
    });
    if (commit.ticked.length > 0) updateRunChange(db, c.row.id, { taskTicks: commit.ticked });
    if (commit.restored.length > 0) {
      addRunChangeFlags(
        db,
        c.row.id,
        commit.restored.map((path) => ({ kind: 'planning-restored', path })),
      );
    }
    let handoffPath = commit.handoff?.path ?? null;
    const workLeft = commit.open !== null && commit.open.length > 0;
    if (handoffPath === null && (result.reason !== 'finished' || workLeft)) {
      const changed =
        commit.commit === null
          ? []
          : (
              await runGit(c.worktree, [
                'diff-tree',
                '--no-commit-id',
                '--name-only',
                '-r',
                '-z',
                commit.commit,
              ])
            ).stdout
              .split('\0')
              .filter((path) => path !== '');
      handoffPath = join(c.changeDir, `session-${number}-handoff.md`);
      writeFileSync(
        handoffPath,
        generatedHandoff({
          session: number,
          reason:
            result.reason === 'budget-handoff'
              ? 'it reached the context budget'
              : result.reason === 'finished'
                ? 'it stopped with tasks still open'
                : `it ended (${result.reason})`,
          changedFiles: changed,
          ticked: runChangeTicks(db, c.row.id),
        }),
        { mode: 0o600 },
      );
    }
    if (handoffPath !== null) updateRunChange(db, c.row.id, { handoffPath });
    return commit;
  }

  /** Sessions that cannot run at all (API errors after every retry): the change parks now. */
  #failedAttempt(active: ActiveRun, c: { row: RunChangeRow }, detail: string): 'parked' {
    const { db } = this.#o;
    const attempts = recordFailedAttempt(db, c.row.id);
    parkRunChange(db, c.row.id, `${detail} (attempt ${attempts})`, this.#now());
    this.#publish(active.hostId, { runId: active.id, change: c.row.change, state: 'parked' });
    return 'parked';
  }
}

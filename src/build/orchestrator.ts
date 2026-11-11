// The build orchestrator (build-runs; gates: Bounded retries then parking). It lives in the daemon:
// the console and the CLI only ask it to start, stop and report.
//
// One run at a time per machine, one change at a time within it. A run is a queue of runway
// changes in the adapter's build order (dependencies first). For each change:
// 1. its approval must verify now, on the runway (only runway changes build); its signed base
//    commit is where the branch starts and where the host config is read;
// 2. its worktree is prepared (`cp/<change>` from the base commit, outside the repository, locked,
//    with the config's `worktree.clone` folders);
// 3. builder sessions run until one finishes its work; each is committed by Counterpoint (builders
//    write no git state) and hands off to the next at the context budget;
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
import { runGit } from '../core/git/run.ts';
import { hostDir } from '../core/host/home.ts';
import { HostConfigError, readHostConfig } from '../core/host/host-config.ts';
import { isChangeId } from '../core/ids.ts';
import type { ApprovalState, Runway } from '../core/runway/runway.ts';
import { buildAgentSandboxSettings } from '../core/security/sandbox-settings.ts';
import type { Store } from '../core/store/db.ts';
import {
  activeRun,
  addRunChangeFlags,
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
  setRunStopping,
  updateRunChange,
} from '../core/store/runs.ts';
import { endAgentSession, insertAgentSession, setAgentSessionPid } from '../core/store/sessions.ts';
import { protectedPathsFor } from '../doctor/run.ts';
import {
  type BuilderSessionResult,
  generatedHandoff,
  startBuilderSession,
} from './builder-session.ts';
import { afterGateRound, runGateRound } from './gates.ts';
import {
  type DoctorGate,
  type Governor,
  GovernorRefusal,
  governedRunner,
  MAX_TRANSIENT_RETRIES,
  transientBackoffMs,
} from './governor.ts';
import { builderPrompt, type GateFailure } from './prompt.ts';
import { checkProtectedPaths } from './protected-paths.ts';
import { createServiceSession } from './services.ts';
import { commitSession } from './session-commit.ts';
import { calibrateWindow, formatBudget, knownWindow, normalizeClaudeVersion } from './windows.ts';
import { prepareWorktree, releaseWorktree, WorktreeRefusal, worktreePathFor } from './worktrees.ts';

/** The longest one builder session may run. */
export const SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000;
/** The least time between two context-fill events of one session. */
const FILL_EVENT_MS = 20_000;
/** Builder sessions per attempt before the gates run anyway. */
export const MAX_SESSIONS_PER_ATTEMPT = 8;
/** How far ahead a stop time may be. */
const MAX_STOP_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._[\]-]{0,99}$/;

export const RunSettings = z.strictObject({
  /** The runway changes to build; null for every change on the runway. */
  changes: z.array(z.string().refine(isChangeId, 'Not a change name.')).min(1).max(100).nullable(),
  /** Epoch ms; no new session starts after it. Null: no stop time. */
  stopAt: z.number().int().positive().nullable(),
  model: z.string().regex(MODEL_RE, 'Not a model name.'),
  /** The context budget as a percentage of the model's window. */
  budgetPercent: z.number().int().min(10).max(90),
});
export type RunSettings = z.infer<typeof RunSettings>;

/** What the run records with its settings. */
interface StoredSettings extends RunSettings {
  claudeVersion: string | null;
  /** The model's context window the run measures its budget against, once known. */
  windowTokens?: number;
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
    > & { prUrl: string | null; previewUrl: string | null }
  >;
  /** What the run is doing right now (only while it runs). */
  now: RunActivity | null;
  /** The governor's hold on new sessions, if any. */
  hold: { until: number; reason: string } | null;
}

export interface RunActivity {
  change: string | null;
  phase:
    | 'doctor'
    | 'calibrating'
    | 'preparing'
    | 'session'
    | 'gates'
    | 'delivering'
    | 'waiting'
    | 'stopping';
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
}

export interface DeliverContext {
  db: Store;
  hostId: string;
  runId: string;
  runChangeId: number;
  change: ChangeFacts;
  worktree: string;
  branch: string;
  baseCommit: string;
  changeDir: string;
  flags: RunChangeFlag[];
  signal: AbortSignal;
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
  doctorGate: DoctorGate;
  /** A runner for the claude installed now (resolved anew for each spawn). */
  runnerFactory: () => AgentRunner;
  /** Called with the installed version before each spawn (the doctor gate reads it). */
  setInstalledVersion: (version: string | null) => void;
  /** Runs doctor for the host through the governor; true when its verdict passes. */
  runDoctor: (hostId: string, signal: AbortSignal) => Promise<{ passed: boolean; detail: string }>;
  consolePort: number;
  /** Tells open consoles something about the run changed (ids only). */
  publish: (hostId: string, payload: Record<string, unknown>) => void;
  /** Pushes, opens the PR and finds the preview (group 11). Default: none, the change is green. */
  deliver?: (
    context: DeliverContext,
  ) => Promise<{ prUrl: string | null; previewUrl: string | null; flags?: RunChangeFlag[] }>;
  /** Writes the run report (11.4). */
  onRunEnd?: (runId: string) => Promise<void>;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  log?: (event: string, fields?: Record<string, unknown>) => void;
  /** Seams for tests. */
  startBuilderSession?: typeof startBuilderSession;
  runGateRound?: typeof runGateRound;
  commitSession?: typeof commitSession;
  prepareWorktree?: typeof prepareWorktree;
  calibrateWindow?: typeof calibrateWindow;
  checkProtectedPaths?: typeof checkProtectedPaths;
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
    const settings = parsed.data;
    const now = this.#now();
    if (
      settings.stopAt !== null &&
      (settings.stopAt <= now || settings.stopAt > now + MAX_STOP_AHEAD_MS)
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
    const gate = this.#o.doctorGate(hostId);
    if (!gate.ok && gate.rerun !== true) return { ok: false, status: 409, error: gate.reason };

    const runway = await this.#o.approvals.runway(runtime);
    const onRunway = new Set(runway.onRunway.map((entry) => entry.changeId));
    const chosen = settings.changes ?? [...onRunway];
    const off = chosen.filter((change) => !onRunway.has(change));
    if (off.length > 0) {
      return {
        ok: false,
        status: 409,
        error: `Not on the runway now: ${off.join(', ')}. Only approved changes whose approval verifies can build.`,
      };
    }
    if (chosen.length === 0) return { ok: false, status: 409, error: 'The runway is empty.' };
    const order = await this.#buildOrder(runtime, chosen);

    const runId = newRunId(now);
    const stored: StoredSettings = { ...settings, changes: order, claudeVersion: null };
    insertRun(this.#o.db, { id: runId, hostId, settings: stored, stopAt: settings.stopAt }, now);
    order.forEach((change, position) => {
      insertRunChange(this.#o.db, { runId, change, position });
    });
    this.#launch(runId, hostId, settings.stopAt);
    return { ok: true, runId };
  }

  /** Asks the host's run (or any run) to stop at its next clean point. False when none runs. */
  stop(hostId?: string, reason: 'stopped' | 'stop-time' = 'stopped'): boolean {
    const active = this.#active;
    if (active === null || (hostId !== undefined && active.hostId !== hostId)) return false;
    if (active.stopReason === null) active.stopReason = reason;
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
    const settings = run.settings as StoredSettings;
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
      const settings = run.settings as StoredSettings;

      await this.#ensureDoctor(active);
      const window = await this.#window(active, runtime, settings);
      for (const change of listRunChanges(db, active.id)) {
        if (change.state !== 'queued' && change.state !== 'building') continue;
        if (active.stop.signal.aborted) break;
        await this.#buildChange(active, runtime, settings, window, change);
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

  /** The adapter's build order (dependencies first) for the chosen changes. */
  async #buildOrder(runtime: RunHost, chosen: readonly string[]): Promise<string[]> {
    const adapter = runtime.adapter;
    const tip = await runtime.reader.resolve(`refs/heads/${runtime.host.baseBranch}`);
    if (adapter === null || tip === null) return [...chosen];
    const snapshot = await adapter.snapshot(runtime.reader, tip);
    const index = new Map(snapshot.changes.map((change, i) => [change.id, i]));
    return [...chosen].sort(
      (a, b) =>
        (index.get(a) ?? Number.MAX_SAFE_INTEGER) - (index.get(b) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  /**
   * The claude installed now: a runner for it, and its version. When the last doctor report checked
   * another version, doctor runs again (governed) and the run goes on only if it passes.
   */
  async #installed(active: ActiveRun): Promise<{ runner: AgentRunner; version: string }> {
    const runner = this.#o.runnerFactory();
    const version = (await runner.version?.()) ?? null;
    this.#o.setInstalledVersion(version);
    if (version === null)
      throw new RunEnd('error', 'claude could not be run (claude --version failed).');
    await this.#ensureDoctor(active);
    return { runner, version };
  }

  async #ensureDoctor(active: ActiveRun): Promise<void> {
    const gate = this.#o.doctorGate(active.hostId);
    if (gate.ok) return;
    if (gate.rerun !== true) throw new RunEnd('refused', gate.reason);
    this.#activity(active, {
      change: active.activity?.change ?? null,
      phase: 'doctor',
      detail: 'claude was updated: checking the sandbox again',
    });
    const result = await this.#o.runDoctor(active.hostId, active.stop.signal);
    if (active.stop.signal.aborted)
      throw new RunEnd(active.stopReason ?? 'stopped', 'Stopped while doctor ran.');
    const again = this.#o.doctorGate(active.hostId);
    if (!result.passed || !again.ok) {
      throw new RunEnd(
        'refused',
        `claude was updated and doctor did not pass on the new version: ${result.detail}`,
      );
    }
  }

  /**
   * The model's window on the installed claude: learned, or from a calibration session. Stored
   * with the run's settings (with the claude version), so the console shows the budget as tokens.
   */
  async #window(active: ActiveRun, runtime: RunHost, settings: StoredSettings): Promise<number> {
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
    const paths = protectedPathsFor({ home: this.#o.home, host: runtime.host });
    const profile = buildAgentSandboxSettings({ ...paths, workdir: dir });
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
          settings: profile.settings,
          allowedTools: profile.allowedTools,
          cwd: dir,
          rawLogPath: join(dir, 'session.jsonl'),
          processTag: randomBytes(16).toString('hex'),
        }),
      );
    } catch (error) {
      if (error instanceof GovernorRefusal && error.kind === 'aborted') {
        throw new RunEnd(active.stopReason ?? 'stopped', 'Stopped before the first build.');
      }
      if (error instanceof GovernorRefusal) throw new RunEnd('refused', error.message);
      throw new RunEnd(
        'error',
        `The model's context window could not be learned: ${(error as Error).message}`,
      );
    }
  }

  #runDir(active: ActiveRun): string {
    return join(hostDir(this.#o.home, active.hostId), 'runs', active.id);
  }

  /** True when the change's approval still verifies, on the runway, from the same signed commit. */
  async #stillApproved(
    runtime: RunHost,
    change: string,
    approvalCommit: string | null,
  ): Promise<string | null> {
    const state = await this.#o.approvals.state(runtime, change);
    if (state.state !== 'on-runway') {
      return state.state === 'changed'
        ? 'Its approved version changed on the base branch.'
        : `Its approval no longer verifies (${state.state === 'invalid' ? state.reason : state.state}).`;
    }
    if (approvalCommit !== null && state.commit !== approvalCommit) {
      return 'It was approved again during the run; start a new run to build the new approval.';
    }
    return null;
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

    // 1. The approval, now.
    const state = await this.#o.approvals.state(runtime, row.change);
    if (state.state !== 'on-runway') {
      const why = (await this.#stillApproved(runtime, row.change, null)) ?? 'Not on the runway.';
      updateRunChange(db, row.id, { state: 'skipped', reason: why, endedAt: this.#now() });
      return;
    }
    if (row.approvalCommit !== null && state.commit !== row.approvalCommit) {
      updateRunChange(db, row.id, {
        state: 'skipped',
        reason:
          'It was approved again since this run began; start a new run to build the new approval.',
        endedAt: this.#now(),
      });
      return;
    }
    const baseCommit = state.statement.base.commit;
    const snapshot = await adapter.snapshot(runtime.reader, baseCommit);
    const facts = findChange(snapshot.changes, row.change);
    if (facts === undefined || facts === null || facts.unreadable !== null) {
      parkRunChange(
        db,
        row.id,
        'Its planning files cannot be read at the approved base commit.',
        this.#now(),
      );
      return;
    }
    let config: Awaited<ReturnType<typeof readHostConfig>>;
    try {
      config = await readHostConfig(runtime.reader, baseCommit);
    } catch (error) {
      if (!(error instanceof HostConfigError)) throw error;
      parkRunChange(db, row.id, error.message, this.#now());
      return;
    }

    // 2. The worktree.
    const paths = protectedPathsFor({ home: this.#o.home, host: runtime.host });
    let worktree: string;
    let branch: string;
    try {
      const prepared = await (this.#o.prepareWorktree ?? prepareWorktree)({
        home: this.#o.home,
        host: runtime.host,
        change: row.change,
        baseCommit,
        runId: active.id,
        launchSettings: buildAgentSandboxSettings({
          ...paths,
          workdir: worktreePathFor(runtime.host.root, row.change),
        }).settings,
        homeDir: paths.homeDir,
        clone: config.worktree.clone,
      });
      worktree = prepared.path;
      branch = prepared.branch;
    } catch (error) {
      if (!(error instanceof WorktreeRefusal)) throw error;
      // The host's integrity or project settings apply to every change: the run cannot go on.
      if (error.reason === 'integrity' || error.reason === 'project-settings') {
        parkRunChange(db, row.id, error.message, this.#now());
        throw new RunEnd('error', error.message);
      }
      parkRunChange(db, row.id, error.message, this.#now());
      return;
    }
    updateRunChange(db, row.id, {
      state: 'building',
      approvalCommit: state.commit,
      baseCommit,
      branch,
      worktree,
      ...(row.startedAt === null ? { startedAt: this.#now() } : {}),
    });
    this.#publish(active.hostId, { runId: active.id, change: row.change, state: 'building' });

    const services = createServiceSession({ config, worktree });
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
          changeDir,
          protectedPaths: paths,
          consolePort: this.#o.consolePort,
          services,
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

        // 5. Green: the protected-path check, then delivery.
        this.#activity(active, { change: row.change, phase: 'delivering' });
        const tip = (await runGit(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
        const flags = await (this.#o.checkProtectedPaths ?? checkProtectedPaths)({
          repo: worktree,
          base: baseCommit,
          tip,
          isPlanningPath: (path) => adapter.isPlanningPath(path),
          hostGlobs: config.protected,
        });
        addRunChangeFlags(db, row.id, flags);
        const delivered = (await this.#o.deliver?.({
          db,
          hostId: active.hostId,
          runId: active.id,
          runChangeId: row.id,
          change: facts,
          worktree,
          branch,
          baseCommit,
          changeDir,
          flags: getRunChange(db, row.id)?.flags ?? flags,
          signal: active.stop.signal,
        })) ?? { prUrl: null, previewUrl: null };
        if (delivered.flags !== undefined) addRunChangeFlags(db, row.id, delivered.flags);
        updateRunChange(db, row.id, {
          state: 'green',
          reason: null,
          prUrl: delivered.prUrl,
          previewUrl: delivered.previewUrl,
          endedAt: this.#now(),
        });
        this.#publish(active.hostId, { runId: active.id, change: row.change, state: 'green' });
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
    },
  ): Promise<'built' | 'stopped' | 'left-runway' | 'parked'> {
    const { db } = this.#o;
    const adapter = runtime.adapter;
    if (adapter === null) throw new RunEnd('error', 'The project has no planning framework.');
    let transient = 0;
    let gateFeedback = c.feedback;
    for (let inAttempt = 0; inAttempt < MAX_SESSIONS_PER_ATTEMPT; inAttempt += 1) {
      if (active.stop.signal.aborted) return 'stopped';
      const left = await this.#stillApproved(
        runtime,
        c.row.change,
        getRunChange(db, c.row.id)?.approvalCommit ?? null,
      );
      if (left !== null) {
        updateRunChange(db, c.row.id, {
          state: 'skipped',
          reason: `Stopped building: ${left}`,
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
      });
      const paths = protectedPathsFor({ home: this.#o.home, host: runtime.host });
      const profile = buildAgentSandboxSettings({ ...paths, workdir: c.worktree });
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
      try {
        const session = await (this.#o.startBuilderSession ?? startBuilderSession)({
          runner: governedRunner(this.#o.governor, runner, {
            hostId: active.hostId,
            kind: 'builder',
            signal: active.stop.signal,
          }),
          settings: profile.settings,
          allowedTools: profile.allowedTools,
          model: settings.model,
          cwd: c.worktree,
          rawLogPath,
          processTag,
          prompt,
          windowTokens: window,
          budgetPercent: settings.budgetPercent,
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
        if (error instanceof GovernorRefusal && error.kind === 'aborted') return 'stopped';
        if (error instanceof GovernorRefusal) throw new RunEnd('refused', error.message);
        throw error;
      } finally {
        active.wrapUp = null;
      }
      endAgentSession(db, sessionId, {
        reason: result.reason,
        peakContextTokens: result.peakTokens,
        usage: { outcome: result.outcome.kind },
      });

      // Every session's work is committed, whatever ended it.
      await this.#commit(c, runtime, number, result);
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
      if (result.reason === 'finished') return 'built';
      // budget-handoff, forced, timeout, failed: the next session continues from the handoff.
    }
    return 'built';
  }

  /** Commits the session's work; keeps its handoff (or writes one) and its task ticks. */
  async #commit(
    c: { row: RunChangeRow; facts: ChangeFacts; worktree: string; changeDir: string },
    runtime: RunHost,
    number: number,
    result: BuilderSessionResult,
  ): Promise<void> {
    const { db } = this.#o;
    const adapter = runtime.adapter;
    if (adapter === null) return;
    const interrupted =
      result.reason === 'forced' || result.reason === 'timeout' || result.end.killed;
    const commit = await (this.#o.commitSession ?? commitSession)({
      worktree: c.worktree,
      change: c.facts,
      adapter,
      changeDir: c.changeDir,
      session: number,
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
    if (handoffPath === null && result.reason !== 'finished') {
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
              : `it ended (${result.reason})`,
          changedFiles: changed,
          ticked: runChangeTicks(db, c.row.id),
        }),
        { mode: 0o600 },
      );
    }
    if (handoffPath !== null) updateRunChange(db, c.row.id, { handoffPath });
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

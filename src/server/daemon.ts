// The background daemon (daemon-lifecycle: One daemon per machine serves every host).
//
// Boot order: single-instance lock → token → console HTTP on 127.0.0.1 → control socket. The
// socket comes up last, so "the socket answers" means the daemon is fully up; liveness is never
// decided by a pid file. Crash-only: the kernel drops the SQLite lock on any death.
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from 'node:fs';
import type { Server } from 'node:http';
import { connect } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { createAdaptorServer, serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { ClaudeCliRunner } from '../agent/runner.ts';
import { createActionRunner } from '../build/actions.ts';
import { onBuilderAnswer, raiseAskSetupCard, setUpInteractiveAsk } from '../build/ask-session.ts';
import { BUILD_TICKS_KIND, BuildTicks } from '../build/build-ticks.ts';
import { createDeliver, pushTarget, remoteBranchHead } from '../build/deliver.ts';
import { Governor, governedRunner } from '../build/governor.ts';
import { LocalPreviews } from '../build/local-preview.ts';
import { Orchestrator } from '../build/orchestrator.ts';
import { readOwnerEnv } from '../build/owner-env.ts';
import { OwnerSteps } from '../build/owner-steps.ts';
import { PlanningLane } from '../build/planning-lane.ts';
import { checkPullRequests } from '../build/pr-state.ts';
import { recoverRuns } from '../build/recovery.ts';
import { syncRunCards } from '../build/run-cards.ts';
import { factsFromRuntime, writeRunReport } from '../build/run-report.ts';
import { detectFramework } from '../compose.ts';
import { writeFileAtomic0600 } from '../core/fs/atomic.ts';
import { BaseFetcher } from '../core/git/base-fetch.ts';
import { type HomePaths, homePaths } from '../core/host/home.ts';
import { carryOverApprovals } from '../core/runway/carry-over.ts';
import { hostCheckedServer } from '../core/security/guard.ts';
import { clearAllSessions, deleteStaleLoginCodes } from '../core/security/login.ts';
import { revokeBuilderCapabilities } from '../core/store/ask.ts';
import { getCard, listWaitingCards } from '../core/store/cards.ts';
import { openStore, type Store } from '../core/store/db.ts';
import { EventBus, publishEvent } from '../core/store/events.ts';
import { runningOwnerStepResults } from '../core/store/owner-step-results.ts';
import type { PlanningWriteRow } from '../core/store/planning-writes.ts';
import { getRun } from '../core/store/runs.ts';
import { createApp, packageRoot, resolveUiDir } from './app.ts';
import { createApprovalViews } from './approval-views.ts';
import { CardDesk } from './cards.ts';
import { createControlApp, hashToken } from './control.ts';
import { createHostRuntimes } from './hosts.ts';
import { Notifier } from './notifier.ts';
import {
  installedVersion,
  installStamp,
  resolveRestartCards,
  SelfRestart,
  successorSpawner,
  takeHandover,
} from './restart.ts';
import { startWatcher, type Watcher } from './watcher.ts';

const SQLITE_BUSY = 5;
/** How long a successor waits for the previous daemon to let go of the lock. */
const HANDOVER_LOCK_WAIT_MS = 60_000;

export interface DaemonOptions {
  home: string;
  /** Port for the console; 0 binds an ephemeral port (tests). */
  port: number;
  /**
   * The random id of this start, also on the daemon's command line (`--instance`), so `stop` can
   * confirm a pid is this daemon before signalling it (daemon-lifecycle: Stop never signals an
   * unrelated process).
   */
  instance?: string;
  /**
   * The nonce of a planned self-restart (owner-inbox D-10): the previous daemon is stopping, so
   * wait for its lock, and keep the console sessions if the nonce matches its handover record.
   */
  handover?: string;
}

export interface DaemonInfo {
  pid: number;
  port: number;
  startedAt: string;
  instance?: string;
}

export interface StartResult {
  error: 'port-in-use';
  port: number;
}

// Kept at module level: the lock ends if the connection is garbage collected.
let lockConnection: DatabaseSync | undefined;

function log(event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), event, ...fields })}\n`);
}

/** Waits for the lock while the previous daemon of a planned restart stops. */
async function acquireLockWithin(paths: HomePaths, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (acquireLock(paths)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** Holds `BEGIN EXCLUSIVE` on the lock database. Returns false if another daemon holds it. */
function acquireLock(paths: HomePaths): boolean {
  const db = new DatabaseSync(paths.lockDb, { timeout: 0 });
  try {
    db.exec('BEGIN EXCLUSIVE');
  } catch (error) {
    db.close();
    if ((error as { errcode?: number }).errcode === SQLITE_BUSY) return false;
    throw error;
  }
  lockConnection = db;
  return true;
}

function releaseLock(): void {
  if (lockConnection === undefined) return;
  try {
    lockConnection.exec('ROLLBACK');
  } catch {
    // nothing to roll back
  }
  lockConnection.close();
  lockConnection = undefined;
}

/** Creates the 0600 token file if absent and returns its SHA-256. The token is never logged. */
function loadTokenHash(paths: HomePaths): Buffer {
  if (!existsSync(paths.token)) {
    try {
      const fd = openSync(paths.token, 'wx', 0o600);
      try {
        writeSync(fd, `${randomBytes(32).toString('hex')}\n`);
      } finally {
        closeSync(fd);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  chmodSync(paths.token, 0o600);
  return hashToken(readFileSync(paths.token, 'utf8').trim());
}

/** True when something accepts connections on the Unix socket. */
export function socketAnswers(socketPath: string, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(socketPath);
    const done = (answered: boolean) => {
      socket.destroy();
      resolve(answered);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function listenOnSocket(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(socketPath);
  });
}

function closeServer(server: Server | undefined): Promise<void> {
  if (server === undefined || !server.listening) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

export async function runDaemon(options: DaemonOptions): Promise<void> {
  // Everything the daemon creates is private to the owner.
  process.umask(0o077);
  const paths = homePaths(options.home);
  mkdirSync(paths.runDir, { recursive: true, mode: 0o700 });
  chmodSync(paths.runDir, 0o700);
  mkdirSync(paths.logsDir, { recursive: true, mode: 0o700 });

  const locked =
    options.handover === undefined
      ? acquireLock(paths)
      : await acquireLockWithin(paths, HANDOVER_LOCK_WAIT_MS);
  if (!locked) {
    log('already-running');
    console.log('Counterpoint is already running.');
    process.exit(0);
  }

  // A run record left by a crashed daemon names a pid that may now belong to another program.
  // Holding the lock means no other daemon is alive, so the record is stale: clear it at once.
  rmSync(paths.daemonJson, { force: true });
  rmSync(paths.startResult, { force: true });
  const tokenHash = loadTokenHash(paths);

  if (existsSync(paths.socket)) {
    if (await socketAnswers(paths.socket)) {
      // We hold the lock, so nothing legitimate should answer here.
      log('socket-in-use', { socket: paths.socket });
      releaseLock();
      process.exit(1);
    }
    rmSync(paths.socket, { force: true });
    log('stale-socket-removed');
  }

  const store: Store = openStore(options.home);
  // Crash-only reconcile: a (re)started daemon signs every browser out and drops stale codes. Only
  // a planned self-restart, handed over by the previous daemon, keeps the sessions (D-10).
  const planned = takeHandover(paths, options.handover);
  if (!planned) clearAllSessions(store);
  deleteStaleLoginCodes(store);

  // Console HTTP. The app is created once the real port is known (port 0 → ephemeral); no
  // request can arrive before `listening`.
  let app: Hono | undefined;
  const http = serve({
    fetch: (request, env) => {
      if (app === undefined) return new Response('starting', { status: 503 });
      return app.fetch(request, env);
    },
    port: options.port,
    hostname: '127.0.0.1',
    // Every wrong Host is a 403 even before the adapter parses the request.
    createServer: hostCheckedServer,
  }) as Server;

  // serve() has already called listen(); wait for the outcome.
  const bound = await new Promise<number>((resolve, reject) => {
    const onListening = () => {
      http.off('error', onError);
      const address = http.address();
      if (address !== null && typeof address === 'object') resolve(address.port);
      else reject(new Error('The console server has no address.'));
    };
    const onError = (error: Error) => {
      http.off('listening', onListening);
      reject(error);
    };
    if (http.listening) {
      onListening();
      return;
    }
    http.once('listening', onListening);
    http.once('error', onError);
  }).catch((error: NodeJS.ErrnoException): never => {
    if (error.code === 'EADDRINUSE') {
      const result: StartResult = { error: 'port-in-use', port: options.port };
      writeFileAtomic0600(paths.startResult, `${JSON.stringify(result)}\n`);
      log('port-in-use', { port: options.port });
    } else {
      log('http-listen-failed', { code: error.code ?? null, message: error.message });
    }
    store.close();
    releaseLock();
    process.exit(1);
  });

  // One bus: the control socket publishes, the console's SSE streams listen.
  const bus = new EventBus();
  // One set of host runtimes: the console reads snapshots from it, the watcher keeps it current.
  const runtimes = createHostRuntimes({ store });
  // Planning writes land as small PRs (owner-inbox D-11); the minute tick moves them along.
  let lane: PlanningLane | undefined;
  // Build ticks of open and merged build PRs (build-ticks-and-owner-steps D-3), on the same tick.
  let buildTicks: BuildTicks | undefined;
  // The owner's environment as the minute tick last had it (a run start asks gh with it).
  let tickEnv: Readonly<Record<string, string>> | undefined;
  // The base fetcher (host-planning: When the base is fetched): every host's base branch from its
  // remote, once a minute and at each run and build start. A change in what the console shows
  // about it (a failed fetch, unpushed local commits) is announced like a new base tip.
  const fetcher = new BaseFetcher({
    ownerEnv: async () => (await readOwnerEnv()).env,
    log,
    onChange: (hostId) => {
      publishEvent(store, bus, { hostId, family: 'planning', payload: { base: true } });
    },
    // A merged build PR means built (runway): its change leaves the runway and shows Built.
    afterFetch: async (host, env) => {
      tickEnv = env;
      const merged = await checkPullRequests({ db: store, host, env, log });
      if (merged.length > 0) {
        publishEvent(store, bus, { hostId: host.id, family: 'planning', payload: { merged } });
      }
      await buildTicks?.tick(host.id, env);
      await lane?.tick(host.id, env);
    },
  });
  // Approvals given before one-click approval carry over once (approvals: Earlier approvals
  // carry over).
  await carryOverApprovals(
    store,
    (hostId) => {
      const runtime = runtimes.get(hostId);
      return runtime === null
        ? null
        : {
            hostId,
            baseBranch: runtime.host.baseBranch,
            reader: runtime.reader,
            adapter: runtime.adapter,
            tip: runtime.tip,
          };
    },
    log,
  );
  // One set of approval views: approvals from the store, the runway derived at the tip.
  const approvals = createApprovalViews({ store });

  // The build lane. Every agent spawn goes through the one governor (usage-limit pauses).
  // A runner for the claude on the run's PATH (the owner's login shell's); the daemon's own PATH
  // when no run environment is given (the version shown in the console).
  const runnerFactory = (env?: Readonly<Record<string, string>>) =>
    new ClaudeCliRunner(env === undefined ? {} : { env });
  const claudeVersion = async (): Promise<string | null> => {
    try {
      return (await runnerFactory().version()) ?? null;
    } catch {
      return null;
    }
  };
  // Question cards (owner-inbox): the run's cards are recomputed on every run event. A new card
  // that blocks work shows a macOS notification (D-9), at most one a minute.
  const notifier = new Notifier({
    stillWaiting: (cardId) => {
      const state = getCard(store, cardId)?.state;
      return state === 'open' || state === 'deferred';
    },
  });
  const desk = new CardDesk({ store, bus, log, notify: (card) => notifier.notify(card) });
  /** What the card that started a planning write says while it lands (D-12). */
  const writeOutcome = (row: PlanningWriteRow): string | null => {
    switch (row.state) {
      case 'pending':
      case 'landing':
        return 'Landing as a small PR.';
      case 'waiting':
        return 'Waiting for checks.';
      case 'blocked':
        return row.reason ?? 'Blocked.';
      case 'merged':
        return row.reason ?? 'Done.';
      case 'cancelled':
        return null;
    }
  };
  lane = new PlanningLane({
    db: store,
    home: options.home,
    host: (hostId) => runtimes.get(hostId)?.host ?? null,
    rules: (hostId) => {
      const adapter = runtimes.get(hostId)?.adapter;
      return adapter == null
        ? null
        : { isPlanningPath: adapter.isPlanningPath, tickTask: adapter.tickTask };
    },
    ownerEnv: async () => (await readOwnerEnv()).env,
    fetchBase: (host, env) => fetcher.fetch(host, env),
    onChange: (row) => {
      const card = row.cardId === null ? undefined : getCard(store, row.cardId);
      const text = writeOutcome(row);
      if (card !== undefined && text !== null) desk.outcome(card, text);
      // No click started a build's after-merge ticks: Cancel closes their card, nothing to redo.
      if (card?.kind === BUILD_TICKS_KIND && row.state === 'cancelled') {
        desk.resolve(
          card,
          `Cancelled; the tasks stay open on ${runtimes.get(row.hostId)?.host.baseBranch ?? 'the base'}.`,
        );
      }
      publishEvent(store, bus, {
        hostId: row.hostId,
        family: 'needs-you',
        payload: { write: row.id, state: row.state },
      });
      if (row.state === 'merged') {
        publishEvent(store, bus, {
          hostId: row.hostId,
          family: 'planning',
          payload: { write: row.id },
        });
      }
    },
    log,
  });
  buildTicks = new BuildTicks({
    db: store,
    home: options.home,
    runtime: (hostId) => runtimes.get(hostId),
    fetchBase: (host, env) => fetcher.fetch(host, env),
    raise: (card) => desk.raise(card),
    answer: (cardId) => desk.answer(cardId, { option: 0 }),
    submit: (hostId, write, cardId) => lane?.submit(hostId, write, cardId),
    log,
  });
  const governor = new Governor({ db: store });
  // Owner steps are cards (owner-inbox 4.2): recomputed with the run's cards on every read. Do it
  // for me runs a session as the owner, through the same governor as builders (4.3).
  const steps = new OwnerSteps({
    desk,
    runtimes,
    approvals,
    lane,
    home: options.home,
    ownerEnv: async () => (await readOwnerEnv()).env,
    fetchBase: (host, env) => fetcher.fetch(host, env),
    runner: (hostId, env) =>
      governedRunner(governor, runnerFactory(env), { hostId, kind: 'owner-step' }),
    log,
  });
  const syncCards = async (hostId: string) => {
    syncRunCards(desk, hostId);
    await steps.sync(hostId).catch((error: Error) => {
      log('owner-steps-sync-failed', { hostId, message: error.message });
    });
  };
  const publish = (family: 'run') => (hostId: string, payload: Record<string, unknown>) => {
    publishEvent(store, bus, { hostId, family, payload });
    syncRunCards(desk, hostId);
  };
  const previews = new LocalPreviews({
    home: options.home,
    db: store,
    host: (hostId) => runtimes.get(hostId),
    consolePort: bound,
    publish: publish('run'),
  });
  // Sessions reach the owner through `counterpoint mcp ask` of this same install.
  const askServer =
    process.argv[1] === undefined
      ? undefined
      : { command: process.execPath, args: [process.argv[1], 'mcp', 'ask'] };
  const orchestrator = new Orchestrator({
    home: options.home,
    db: store,
    host: (hostId) => runtimes.get(hostId),
    approvals,
    governor,
    runnerFactory,
    fetcher,
    // A PR merged since the last minute tick is known before its change builds again.
    refreshPullRequests: async (host, env) => {
      const merged = await checkPullRequests({
        db: store,
        host,
        env: env ?? tickEnv ?? process.env,
        log,
      });
      if (merged.length > 0) {
        publishEvent(store, bus, { hostId: host.id, family: 'planning', payload: { merged } });
      }
    },
    remoteHead: async (host, branch, env) =>
      remoteBranchHead({
        root: host.root,
        branch,
        target: await pushTarget(host.root, host.baseBranch),
        env,
      }),
    consolePort: bound,
    publish: publish('run'),
    onRunEnd: async (runId) => {
      const run = getRun(store, runId);
      if (run === undefined) return;
      await writeRunReport({
        home: options.home,
        db: store,
        runId,
        factsAt: factsFromRuntime(runtimes.get(run.hostId)),
      });
    },
    beforeBuild: (hostId, change) => {
      previews.stop(hostId, change);
    },
    deliver: createDeliver({
      home: options.home,
      consolePort: bound,
      adapterFor: (hostId) => runtimes.get(hostId)?.adapter ?? null,
    }),
    log,
    ...(askServer === undefined ? {} : { askServer }),
  });
  // No builder session outlives the daemon; an answer to a builder's question reaches the
  // change's next session.
  revokeBuilderCapabilities(store);
  desk.onAnswered((card) => onBuilderAnswer(store, desk, card));
  // Crash recovery before any new work: end what a killed daemon left running, commit
  // interrupted work; the run itself resumes once the daemon is up.
  const recovered = await recoverRuns({
    home: options.home,
    db: store,
    host: (hostId) => runtimes.get(hostId),
    log,
  }).catch((error: Error) => {
    log('recovery-failed', { message: error.message });
    return null;
  });
  // A Do it for me session the last daemon was running is gone: its step card comes back.
  await steps.recover().catch((error: Error) => {
    log('owner-steps-recovery-failed', { message: error.message });
  });

  let stopping = false;
  let control: Server | undefined;
  let watcher: Watcher | undefined;
  let stop: (reason: string) => Promise<void> = async () => {};
  /** The owner's stop (console or CLI): a run first stops at its next clean point. */
  const stopAfterRun = async (reason: string) => {
    if (stopping) return;
    if (orchestrator.running() !== null) {
      log('stopping-run-first', { reason });
      orchestrator.stop();
      await orchestrator.idle();
    }
    await stop(reason);
  };

  // Self-restart into a new install (D-10), from the files this daemon was started from.
  const root = (() => {
    try {
      return packageRoot();
    } catch {
      return null;
    }
  })();
  const entry = process.argv[1];
  const restarter =
    root === null || entry === undefined
      ? undefined
      : new SelfRestart({
          desk,
          paths,
          stamp: () => installStamp(root, entry),
          version: () => installedVersion(root),
          busy: () => orchestrator.running() !== null || runningOwnerStepResults(store).length > 0,
          spawnSuccessor: successorSpawner({
            paths,
            entry,
            port: bound,
            env: async () => (await readOwnerEnv()).env,
          }),
          stop: (reason) => stop(reason),
          log,
        });

  desk.setActionRunner(
    createActionRunner({
      db: store,
      desk,
      orchestrator,
      ownerEnv: () => readOwnerEnv(),
      ownerSteps: (action, card, note) => steps.act(action, card, note),
      ...(restarter === undefined ? {} : { restart: (when) => restarter.request(when) }),
      ...(askServer === undefined
        ? {}
        : {
            addAskTool: async (card) =>
              setUpInteractiveAsk({
                db: store,
                desk,
                card,
                home: options.home,
                server: askServer,
                env: (await readOwnerEnv()).env,
              }),
          }),
    }),
  );
  if (askServer !== undefined) raiseAskSetupCard(desk, options.home);
  // This daemon runs the newest install: a restart card an earlier daemon raised is moot.
  resolveRestartCards(store, desk, 'Counterpoint restarted.');
  if (planned) {
    desk.doneForYou(
      null,
      root === null
        ? 'Restarted into the new install.'
        : `Restarted into the new install (Counterpoint ${installedVersion(root)}).`,
    );
  }

  app = createApp({
    store,
    cards: desk,
    syncCards,
    port: bound,
    uiDir: resolveUiDir(),
    bus,
    runtimes,
    home: options.home,
    approvals,
    onApprovalChanged: (hostId) => void watcher?.nudge(hostId),
    baseFetch: (hostId) => fetcher.state(hostId),
    writes: lane,
    run: {
      orchestrator,
      claudeVersion,
      stopDaemon: () => void stopAfterRun('console'),
      onSettingsChanged: (hostId) => {
        publishEvent(store, bus, { hostId, family: 'settings' });
      },
      previews,
    },
  });

  stop = async (reason: string) => {
    if (stopping) return;
    stopping = true;
    log('stopping', { reason });
    watcher?.stop();
    fetcher.stop();
    notifier.stop();
    restarter?.stop();
    await previews.stopAll();
    await Promise.all([closeServer(control), closeServer(http)]);
    rmSync(paths.socket, { force: true });
    rmSync(paths.daemonJson, { force: true });
    store.close();
    releaseLock();
    log('stopped');
    process.exit(0);
  };

  const controlApp = createControlApp({
    store,
    bus,
    tokenHash,
    port: bound,
    onStop: () => void stopAfterRun('control'),
    orchestrator,
    desk,
    handover: (nonce) => restarter?.accept(nonce) ?? false,
    detectFramework,
    nudge: (hostId) => void watcher?.nudge(hostId),
    runwayCount: async (hostId) => {
      const runtime = runtimes.get(hostId);
      return runtime === null ? null : (await approvals.runway(runtime)).count;
    },
    needsYouCount: async (hostId) => {
      const runtime = runtimes.get(hostId);
      if (runtime === null) return null;
      await syncCards(hostId);
      return listWaitingCards(store, hostId).length;
    },
  });
  control = createAdaptorServer({ fetch: controlApp.fetch }) as Server;
  await listenOnSocket(control, paths.socket);
  chmodSync(paths.socket, 0o600);

  const info: DaemonInfo = {
    pid: process.pid,
    port: bound,
    startedAt: new Date().toISOString(),
    ...(options.instance === undefined ? {} : { instance: options.instance }),
  };
  writeFileAtomic0600(paths.daemonJson, `${JSON.stringify(info)}\n`);

  // Base-tip polling (host-planning: Live refresh from the base branch): a commit to a host's base
  // branch reaches open consoles within ~2 s.
  watcher = startWatcher({ runtimes, db: store, bus, log, approvals });
  // The base fetch loop: a PR merged on GitHub reaches open consoles within about a minute.
  fetcher.start(() => runtimes.list().map((runtime) => runtime.host));
  restarter?.start();

  if (recovered?.runId != null) orchestrator.resume(recovered.runId);

  process.once('SIGTERM', () => void stop('SIGTERM'));
  process.once('SIGINT', () => void stop('SIGINT'));
  log('started', { pid: process.pid, port: bound });
}

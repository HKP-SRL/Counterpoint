// The console's owner actions for the build lane (build-runs: Start and stop a run from the
// console; daemon-lifecycle: Stop Counterpoint from the console). Every write here is a guarded
// POST: the session cookie plus the Origin, Fetch Metadata and JSON checks of the guard chain.
//
//   GET  /api/hosts/:hostId/run                  { run, runway, claudeVersion }: the runway
//                                                changes the owner may pick, each with
//                                                `canBuild` (Run builds it; the form picks it)
//                                                and why not
//   GET  /api/hosts/:hostId/run/budget?model=&percent=   { window, label }
//   POST /api/hosts/:hostId/run                  start: { changes, stopAt (ISO or null) } → 202
//                                                { runId } or the refusal; the run uses the
//                                                project's saved settings
//   GET  /api/hosts/:hostId/runs/:runId/report   the run's report, built from the store now
//                                                (so a preview found later is in it): { report }
//   GET  /api/hosts/:hostId/previews/:change     a green change's local preview: { preview }
//   POST /api/hosts/:hostId/previews/:change/start   start it on demand → 202 { preview }
//   POST /api/hosts/:hostId/previews/:change/stop    stop it
//   GET  /api/hosts/:hostId/settings             { settings, saved, defaults, effortLevels }
//   POST /api/hosts/:hostId/settings             save the run settings (build-runs: Run settings
//                                                page); runs started afterwards use them
//   POST /api/hosts/:hostId/run/stop             stop at the next clean point
//   POST /api/stop                               stop Counterpoint (a run first stops at its next
//                                                clean point)
import type { Hono } from 'hono';
import { EFFORT_LEVELS } from '../../agent/claude-argv.ts';
import {
  DEFAULT_HOST_SETTINGS,
  parseHostSettings,
  readHostSettings,
  writeHostSettings,
} from '../../build/host-settings.ts';
import type { LocalPreviews } from '../../build/local-preview.ts';
import type { Orchestrator } from '../../build/orchestrator.ts';
import { buildRunReport, factsFromRuntime } from '../../build/run-report.ts';
import { formatBudget, knownWindow, normalizeClaudeVersion } from '../../build/windows.ts';
import { HOST_ID_RE, isChangeId } from '../../core/ids.ts';
import { stageText } from '../../core/runway/lane.ts';
import { getHost, type Store } from '../../core/store/db.ts';
import { getRun } from '../../core/store/runs.ts';
import type { ApprovalViews } from '../approval-views.ts';
import type { HostRuntimes } from '../hosts.ts';

export interface RunRoutesOptions {
  home: string;
  store: Store;
  runtimes: HostRuntimes;
  approvals: ApprovalViews;
  orchestrator: Orchestrator;
  /** The claude version installed now, or null. */
  claudeVersion: () => Promise<string | null>;
  /** Stops the daemon (after any run reaches its clean point). */
  stopDaemon: () => void;
  /** Tells open consoles a project's run settings changed. */
  onSettingsChanged?: (hostId: string) => void;
  /** Local previews, started on demand from the console. */
  previews?: Pick<LocalPreviews, 'status' | 'start' | 'stop'>;
}

async function jsonBody(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

export function mountRunRoutes(app: Hono, options: RunRoutesOptions): void {
  const { store, orchestrator } = options;
  const hostOf = (hostId: string) =>
    HOST_ID_RE.test(hostId) && getHost(store, hostId) !== undefined
      ? options.runtimes.get(hostId)
      : null;

  app.get('/api/hosts/:hostId/run', async (c) => {
    const runtime = hostOf(c.req.param('hostId'));
    if (runtime === null) return c.json({ error: 'not found' }, 404);
    const runway = await options.approvals.runway(runtime).catch(() => null);
    return c.json({
      run: orchestrator.view(runtime.host.id),
      runway:
        runway?.onRunway
          .filter((entry) => entry.canPick)
          .map(({ changeId, title, taskCount, canBuild, stage }) => ({
            changeId,
            title,
            taskCount,
            canBuild,
            why: stage === null || canBuild ? null : stageText(stage),
          })) ?? [],
      claudeVersion: await options.claudeVersion(),
    });
  });

  app.get('/api/hosts/:hostId/run/budget', async (c) => {
    const runtime = hostOf(c.req.param('hostId'));
    if (runtime === null) return c.json({ error: 'not found' }, 404);
    const model = c.req.query('model') ?? '';
    const percent = Number(c.req.query('percent') ?? '40');
    const version = await options.claudeVersion();
    if (!/^[A-Za-z0-9][A-Za-z0-9._[\]-]{0,99}$/.test(model) || !Number.isInteger(percent)) {
      return c.json({ error: 'invalid model or percent' }, 400);
    }
    const window =
      version === null ? null : knownWindow(store, model, normalizeClaudeVersion(version));
    return c.json({
      window,
      label: window === null ? null : formatBudget(Math.min(90, Math.max(10, percent)), window),
    });
  });

  app.post('/api/hosts/:hostId/run', async (c) => {
    const runtime = hostOf(c.req.param('hostId'));
    if (runtime === null) return c.json({ error: 'not found' }, 404);
    const body = (await jsonBody(c)) as Record<string, unknown> | undefined;
    if (body === undefined || typeof body !== 'object' || body === null) {
      return c.json({ error: 'The request body must be JSON.' }, 400);
    }
    let stopAt: number | null = null;
    if (typeof body.stopAt === 'string') {
      stopAt = Date.parse(body.stopAt);
      if (!Number.isFinite(stopAt)) return c.json({ error: 'Invalid stop time.' }, 422);
    } else if (body.stopAt !== null && body.stopAt !== undefined) {
      return c.json({ error: 'Invalid stop time.' }, 422);
    }
    const result = await orchestrator.start(runtime.host.id, { ...body, stopAt });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ runId: result.runId }, 202);
  });

  app.get('/api/hosts/:hostId/settings', (c) => {
    const runtime = hostOf(c.req.param('hostId'));
    if (runtime === null) return c.json({ error: 'not found' }, 404);
    const { settings, saved } = readHostSettings(store, runtime.host.id);
    return c.json({
      settings,
      saved,
      defaults: DEFAULT_HOST_SETTINGS,
      effortLevels: EFFORT_LEVELS,
    });
  });

  app.post('/api/hosts/:hostId/settings', async (c) => {
    const runtime = hostOf(c.req.param('hostId'));
    if (runtime === null) return c.json({ error: 'not found' }, 404);
    const parsed = parseHostSettings(await jsonBody(c));
    if (!parsed.ok) return c.json({ error: parsed.error }, 422);
    writeHostSettings(store, runtime.host.id, parsed.settings);
    options.onSettingsChanged?.(runtime.host.id);
    return c.json({ settings: parsed.settings, saved: true });
  });

  app.get('/api/hosts/:hostId/runs/:runId/report', async (c) => {
    const runtime = hostOf(c.req.param('hostId'));
    const runId = c.req.param('runId');
    if (runtime === null || !/^[A-Za-z0-9-]{1,64}$/.test(runId)) {
      return c.json({ error: 'not found' }, 404);
    }
    const run = getRun(store, runId);
    if (run === undefined || run.hostId !== runtime.host.id)
      return c.json({ error: 'not found' }, 404);
    const report = await buildRunReport({
      home: options.home,
      db: store,
      runId,
      factsAt: factsFromRuntime(runtime),
    });
    return c.json({ report });
  });

  const previewOf = (c: { req: { param(name: string): string } }) => {
    const runtime = hostOf(c.req.param('hostId'));
    const change = c.req.param('change');
    return runtime === null || options.previews === undefined || !isChangeId(change)
      ? null
      : { hostId: runtime.host.id, change, previews: options.previews };
  };

  app.get('/api/hosts/:hostId/previews/:change', (c) => {
    const target = previewOf(c);
    if (target === null) return c.json({ error: 'not found' }, 404);
    return c.json({ preview: target.previews.status(target.hostId, target.change) });
  });

  app.post('/api/hosts/:hostId/previews/:change/start', async (c) => {
    const target = previewOf(c);
    if (target === null) return c.json({ error: 'not found' }, 404);
    const started = await target.previews.start(target.hostId, target.change);
    if (!started.ok) return c.json({ error: started.error }, started.status);
    return c.json({ preview: started.status }, 202);
  });

  app.post('/api/hosts/:hostId/previews/:change/stop', (c) => {
    const target = previewOf(c);
    if (target === null) return c.json({ error: 'not found' }, 404);
    target.previews.stop(target.hostId, target.change);
    return c.json({ preview: target.previews.status(target.hostId, target.change) });
  });

  app.post('/api/hosts/:hostId/run/stop', (c) => {
    const hostId = c.req.param('hostId');
    if (hostOf(hostId) === null) return c.json({ error: 'not found' }, 404);
    if (!orchestrator.stop(hostId)) return c.json({ error: 'No run is going.' }, 409);
    return c.json({ stopping: true }, 202);
  });

  app.post('/api/stop', (c) => {
    // Answer first; the daemon stops once any run has reached its clean point.
    setImmediate(options.stopDaemon);
    return c.json({ stopping: true, run: orchestrator.running() !== null }, 202);
  });
}

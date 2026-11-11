// The console's owner actions for the build lane (build-runs: Start and stop a run from the
// console; doctor: Doctor and risk withdrawal from the console; daemon-lifecycle: Stop Counterpoint
// from the console). Every write here is a guarded POST: the session cookie plus the Origin, Fetch
// Metadata and JSON checks of the guard chain; sandboxed agents cannot reach the console at all.
//
//   GET  /api/hosts/:hostId/run                  { run, runway, claudeVersion, doctor }
//   GET  /api/hosts/:hostId/run/budget?model=&percent=   { window, label }
//   POST /api/hosts/:hostId/run                  start: { changes, stopAt (ISO or null), model,
//                                                budgetPercent } → 202 { runId } or the refusal
//   POST /api/hosts/:hostId/run/stop             stop at the next clean point
//   POST /api/hosts/:hostId/doctor/run           run doctor (one probe at a time) → 202
//   GET  /api/doctor/status                      the probe running now, or null
//   POST /api/risks/:riskId/withdraw             withdraw an accepted risk (accepting stays a
//                                                terminal act)
//   POST /api/stop                               stop Counterpoint (a run first stops at its next
//                                                clean point)
import type { Hono } from 'hono';
import type { Orchestrator } from '../../build/orchestrator.ts';
import { formatBudget, knownWindow, normalizeClaudeVersion } from '../../build/windows.ts';
import { HOST_ID_RE } from '../../core/ids.ts';
import {
  ACCEPTED_RISK_IDS,
  type AcceptedRiskId,
  revokeAcceptedRisk,
} from '../../core/security/accepted-risks.ts';
import { getHost, type Store } from '../../core/store/db.ts';
import type { ApprovalViews } from '../approval-views.ts';
import type { DoctorService } from '../doctor-service.ts';
import type { HostRuntimes } from '../hosts.ts';

export interface RunRoutesOptions {
  home: string;
  store: Store;
  runtimes: HostRuntimes;
  approvals: ApprovalViews;
  orchestrator: Orchestrator;
  doctor: DoctorService;
  /** The claude version installed now, or null. */
  claudeVersion: () => Promise<string | null>;
  /** Stops the daemon (after any run reaches its clean point). */
  stopDaemon: () => void;
  /** Tells open consoles the accepted risks changed. */
  onRiskWithdrawn: () => void;
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
        runway?.onRunway.map(({ changeId, title, taskCount }) => ({
          changeId,
          title,
          taskCount,
        })) ?? [],
      claudeVersion: await options.claudeVersion(),
      doctor: options.doctor.status(),
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

  app.post('/api/hosts/:hostId/run/stop', (c) => {
    const hostId = c.req.param('hostId');
    if (hostOf(hostId) === null) return c.json({ error: 'not found' }, 404);
    if (!orchestrator.stop(hostId)) return c.json({ error: 'No run is going.' }, 409);
    return c.json({ stopping: true }, 202);
  });

  app.post('/api/hosts/:hostId/doctor/run', (c) => {
    const runtime = hostOf(c.req.param('hostId'));
    if (runtime === null) return c.json({ error: 'not found' }, 404);
    const started = options.doctor.start(runtime.host.id, 'console');
    if (!started.ok) return c.json({ error: started.error }, 409);
    return c.json({ started: true }, 202);
  });

  app.get('/api/doctor/status', (c) => c.json({ doctor: options.doctor.status() }));

  app.post('/api/risks/:riskId/withdraw', (c) => {
    const riskId = c.req.param('riskId');
    if (!(ACCEPTED_RISK_IDS as readonly string[]).includes(riskId)) {
      return c.json({ error: 'Unknown risk.' }, 404);
    }
    // Withdrawing only makes the verdict stricter, so the console may do it; recording a risk
    // stays a terminal act (counterpoint accept-risk).
    const existed = revokeAcceptedRisk(options.home, riskId as AcceptedRiskId);
    options.onRiskWithdrawn();
    return c.json({ withdrawn: existed });
  });

  app.post('/api/stop', (c) => {
    // Answer first; the daemon stops once any run has reached its clean point.
    setImmediate(options.stopDaemon);
    return c.json({ stopping: true, run: orchestrator.running() !== null }, 202);
  });
}

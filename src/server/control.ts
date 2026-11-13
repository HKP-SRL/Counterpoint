// The control-socket app, served only on the Unix socket `run/daemon.sock` (dir 0700, socket
// 0600). Every request must carry `Authorization: Bearer <token>` from the 0600 token file; the
// daemon holds only the token's SHA-256 and compares in constant time.
import { createHash, timingSafeEqual } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Orchestrator } from '../build/orchestrator.ts';
import {
  BaseBranchNotFoundError,
  type FrameworkDetector,
  InvalidFrameworkIdError,
  NotARepositoryError,
  registerHost,
} from '../core/host/registry.ts';
import { HOST_ID_RE } from '../core/ids.ts';
import { mintLoginCode } from '../core/security/login.ts';
import { hostRegistryStore, listHosts, type Store } from '../core/store/db.ts';
import { EVENT_FAMILIES, type EventBus, publishEvent } from '../core/store/events.ts';
import { createAskRoutes } from './ask.ts';
import type { CardDesk } from './cards.ts';

export interface ControlAppOptions {
  store: Store;
  /** The daemon's event bus; the console app's SSE streams listen on the same instance. */
  bus: EventBus;
  /** SHA-256 of the control token. */
  tokenHash: Buffer;
  /** The HTTP port the console is bound to. */
  port: number;
  /** Called after `POST /control/stop` has been answered. */
  onStop: () => void;
  detectFramework: FrameworkDetector;
  pid?: number;
  /** Re-checks a host at once (the watcher's `nudge`); called when an approval has landed. */
  nudge?: (hostId: string) => void;
  /** The host's runway count recomputed from git, or null when unknown. */
  runwayCount?: (hostId: string) => Promise<number | null>;
  /** The host's Needs You item count recomputed from git, or null when unknown. */
  needsYouCount?: (hostId: string) => Promise<number | null>;
  /** The build orchestrator: `counterpoint run`, `run stop`, `run status`. */
  orchestrator?: Orchestrator;
  /** The card desk: with it, sessions can ask the owner under `/control/ask/` (owner-inbox D-5). */
  desk?: CardDesk;
  /**
   * A successor daemon asks to take over (owner-inbox D-10): true when the nonce names this
   * daemon's pending self-restart, which then stops once the answer has gone out.
   */
  handover?: (nonce: string) => boolean;
}

/** How long `/control/status` waits for a runway figure before leaving it out. */
const STATUS_RUNWAY_TIMEOUT_MS = 2_000;

async function runwayWithin(
  count: (hostId: string) => Promise<number | null>,
  hostId: string,
): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), STATUS_RUNWAY_TIMEOUT_MS);
    timer.unref?.();
  });
  try {
    return await Promise.race([count(hostId).catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

function bearerMatches(header: string | undefined, expected: Buffer): boolean {
  if (header === undefined) return false;
  const match = /^Bearer ([A-Za-z0-9._~+/=-]{1,512})$/.exec(header);
  if (match?.[1] === undefined) return false;
  const presented = hashToken(match[1]);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

const RegisterBody = z.object({
  cwd: z.string().min(1).max(4096).refine(isAbsolute, 'cwd must be an absolute path'),
  base: z.string().min(1).max(200).optional(),
});

const HandoverBody = z.strictObject({ nonce: z.string().regex(/^[0-9a-f]{64}$/) });

const NotifyBody = z.strictObject({
  hostId: z.string().regex(HOST_ID_RE),
  family: z.enum(EVENT_FAMILIES),
});

export function createControlApp(options: ControlAppOptions): Hono {
  const app = new Hono();
  const pid = options.pid ?? process.pid;

  // The ask tool's four calls carry a session capability instead of the control token; their
  // routes check it themselves and reach nothing else.
  const ASK_PREFIX = '/control/ask/';
  if (options.desk !== undefined) {
    app.route('/control/ask', createAskRoutes({ store: options.store, desk: options.desk }));
  }

  app.use('*', async (c, next) => {
    if (c.req.path.startsWith(ASK_PREFIX)) return next();
    if (!bearerMatches(c.req.header('authorization'), options.tokenHash)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  });

  // `runway` (runway) and `needsYou` (needs-you: One inbox) per host once the daemon can compute
  // them; the CLI's `status` prints `runway {n}` and `needs you {m}`.
  app.get('/control/status', async (c) => {
    const { runwayCount, needsYouCount } = options;
    const hosts = await Promise.all(
      listHosts(options.store).map(async (host) => {
        const [runway, needsYou] = await Promise.all([
          runwayCount === undefined ? null : runwayWithin(runwayCount, host.id),
          needsYouCount === undefined ? null : runwayWithin(needsYouCount, host.id),
        ]);
        return {
          ...host,
          ...(runway === null ? {} : { runway }),
          ...(needsYou === null ? {} : { needsYou }),
        };
      }),
    );
    return c.json({ running: true, pid, port: options.port, hosts });
  });

  app.post('/control/hosts', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'The request body must be JSON.' }, 400);
    }
    const parsed = RegisterBody.safeParse(raw);
    if (!parsed.success) return c.json({ error: 'Invalid host registration request.' }, 400);

    try {
      const host = await registerHost(hostRegistryStore(options.store), {
        cwd: parsed.data.cwd,
        ...(parsed.data.base === undefined ? {} : { base: parsed.data.base }),
        detectFramework: options.detectFramework,
      });
      publishEvent(options.store, options.bus, { hostId: host.id, family: 'host' });
      return c.json({ host });
    } catch (error) {
      if (
        error instanceof NotARepositoryError ||
        error instanceof BaseBranchNotFoundError ||
        error instanceof InvalidFrameworkIdError
      ) {
        return c.json({ error: error.message }, 422);
      }
      throw error;
    }
  });

  // A fresh one-time sign-in link (local-console: One-time sign-in). Only the owner's CLI, holding
  // the 0600 token, gets here; the link is printed to the owner's terminal and never logged.
  app.post('/control/login-code', (c) => {
    const code = mintLoginCode(options.store);
    return c.json({ url: `http://127.0.0.1:${options.port}/login?code=${code}` });
  });

  // The generic nudge (an approval changed): a host id and a family, nothing
  // else. publishEvent = appendEvent to the SQLite outbox, then emit on the bus to every open
  // console stream. A strict
  // body keeps file contents or free text from ever travelling through here.
  app.post('/control/notify', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'The request body must be JSON.' }, 400);
    }
    const parsed = NotifyBody.safeParse(raw);
    if (!parsed.success) return c.json({ error: 'Invalid notify request.' }, 400);
    const event = publishEvent(options.store, options.bus, {
      hostId: parsed.data.hostId,
      family: parsed.data.family,
    });
    // An approval landed: re-check that host now rather than at the next poll, so open consoles
    // see the new runway within moments. The check itself recomputes everything from git.
    if (parsed.data.family === 'approval') options.nudge?.(parsed.data.hostId);
    return c.json({ seq: event.seq }, 202);
  });

  // Runs (build-runs: Start and stop a run from the console; the CLI offers the same).
  const RunBody = z.strictObject({
    hostId: z.string().regex(HOST_ID_RE),
    changes: z.array(z.string()).max(100).nullable().optional(),
    until: z.string().max(64).nullable().optional(),
    model: z.string().max(100).optional(),
    effort: z.string().max(20).optional(),
    budgetPercent: z.number().optional(),
  });
  app.post('/control/run', async (c) => {
    if (options.orchestrator === undefined) return c.json({ error: 'not found' }, 404);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'The request body must be JSON.' }, 400);
    }
    const parsed = RunBody.safeParse(raw);
    if (!parsed.success) return c.json({ error: 'Invalid run request.' }, 400);
    const { hostId, changes, until, model, effort, budgetPercent } = parsed.data;
    const stopAt = until === null || until === undefined ? null : Date.parse(until);
    if (stopAt !== null && !Number.isFinite(stopAt))
      return c.json({ error: 'Invalid stop time.' }, 422);
    const result = await options.orchestrator.start(hostId, {
      changes: changes ?? null,
      stopAt,
      // Only what the CLI overrides; the rest comes from the project's saved settings.
      ...(model === undefined ? {} : { model }),
      ...(effort === undefined ? {} : { effort }),
      ...(budgetPercent === undefined ? {} : { budgetPercent }),
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ runId: result.runId }, 202);
  });
  app.post('/control/run/stop', async (c) => {
    if (options.orchestrator === undefined) return c.json({ error: 'not found' }, 404);
    let hostId: string | undefined;
    try {
      const raw = (await c.req.json()) as { hostId?: unknown };
      if (typeof raw.hostId === 'string' && HOST_ID_RE.test(raw.hostId)) hostId = raw.hostId;
    } catch {
      // no body: any run
    }
    if (!options.orchestrator.stop(hostId)) return c.json({ error: 'No run is going.' }, 409);
    return c.json({ stopping: true }, 202);
  });
  app.get('/control/run', (c) => {
    if (options.orchestrator === undefined) return c.json({ error: 'not found' }, 404);
    const hostId = c.req.query('hostId') ?? '';
    if (!HOST_ID_RE.test(hostId)) return c.json({ error: 'invalid host id' }, 400);
    return c.json({ run: options.orchestrator.view(hostId) });
  });

  // A planned self-restart: the new install has loaded and asks to take over.
  app.post('/control/handover', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'The request body must be JSON.' }, 400);
    }
    const parsed = HandoverBody.safeParse(raw);
    if (!parsed.success) return c.json({ error: 'Invalid handover request.' }, 400);
    if (options.handover?.(parsed.data.nonce) !== true) {
      return c.json({ error: 'No restart is waiting for that.' }, 409);
    }
    return c.json({ handingOver: true }, 202);
  });

  app.post('/control/stop', (c) => {
    // Answer first; stop once the response has gone out (after any run reaches its clean point).
    const run = options.orchestrator?.running() ?? null;
    setImmediate(options.onStop);
    return c.json({ stopping: true, run: run !== null }, 202);
  });

  app.notFound((c) => c.json({ error: 'not found' }, 404));
  app.onError((_error, c) => c.json({ error: 'internal error' }, 500));

  return app;
}

// The console's HTTP app. The daemon binds it to 127.0.0.1 only (the bind is the LAN boundary);
// the guard chain (src/core/security/guard.ts) rejects any Host other than exactly
// `127.0.0.1:{port}`, cross-site or non-JSON writes, and any /api request without a session.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { hostGuard, mutationGuard, securityHeaders, sessionGuard } from '../core/security/guard.ts';
import { consumeLoginCode, createSession, SESSION_COOKIE } from '../core/security/login.ts';
import { listHosts, type Store } from '../core/store/db.ts';
import type { EventBus } from '../core/store/events.ts';
import { mountEvents } from './sse.ts';

export const PACKAGE_NAME = '@hkp/counterpoint';

const isSafe = (method: string) => method === 'GET' || method === 'HEAD';

export interface AppOptions {
  store: Store;
  /** The port the server is actually bound to. */
  port: number;
  /** Absolute path of the built console (`dist/ui`). */
  uiDir: string;
  /** The daemon's event bus; the control app publishes to the same instance. */
  bus: EventBus;
  /** SSE heartbeat interval; 25 s by default, shortened in tests. */
  heartbeatMs?: number;
}

/** The Counterpoint package root: the nearest ancestor whose package.json is @hkp/counterpoint. */
export function packageRoot(from: string = dirname(fileURLToPath(import.meta.url))): string {
  let dir = from;
  for (;;) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown };
        if (parsed.name === PACKAGE_NAME) return dir;
      } catch {
        // unreadable manifest; keep walking up
      }
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`Couldn't find the ${PACKAGE_NAME} package root.`);
    dir = parent;
  }
}

/** Absolute path of the built console. serveStatic would otherwise resolve against the cwd. */
export function resolveUiDir(): string {
  return join(packageRoot(), 'dist', 'ui');
}

export function createApp(options: AppOptions): Hono {
  const app = new Hono();
  const { port } = options;
  const getPort = () => port;
  const indexFile = join(options.uiDir, 'index.html');

  // Guard chain, in this order (RESEARCH Item 6): exact Host `127.0.0.1:${port}` → security
  // headers → Origin / Fetch Metadata / JSON body on non-GET /api → session on every /api.
  app.use('*', hostGuard(getPort));
  app.use('*', securityHeaders());
  app.use('/api/*', mutationGuard(getPort));
  // The SSE stream carries its own sseGuard then sessionGuard (Origin checked before session, as
  // for writes), so it is mounted ahead of the shared session check.
  mountEvents(app, {
    db: options.store,
    bus: options.bus,
    getPort,
    ...(options.heartbeatMs === undefined ? {} : { heartbeatMs: options.heartbeatMs }),
  });
  app.use('/api/*', sessionGuard(options.store));

  // The one-time sign-in exchange (D-07). Outside /api and the session check, behind the Host
  // check. The query string carries the code, so it is never logged. Only a real GET consumes a
  // code: HEAD (link previews, prefetch) must not burn the owner's link.
  app.get('/login', (c) => {
    c.header('Cache-Control', 'no-store');
    if (c.req.method !== 'GET') return c.body(null, 405);
    if (!consumeLoginCode(options.store, c.req.query('code'))) {
      return c.redirect('/signed-out?reason=used', 302);
    }
    const session = createSession(options.store);
    // No Secure flag and no __Host- prefix: Safari drops Secure cookies on http://127.0.0.1 (A7).
    // Max-Age is SESSION_TTL_MS (12 h) in seconds.
    c.header(
      'Set-Cookie',
      `${SESSION_COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`,
    );
    const newest = listHosts(options.store)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .at(-1);
    return c.redirect(newest === undefined ? '/' : `/h/${newest.id}`, 302);
  });

  app.get('/api/hosts', (c) =>
    c.json({
      hosts: listHosts(options.store).map((host) => ({
        id: host.id,
        name: basename(host.root),
        root: host.root,
        baseBranch: host.baseBranch,
      })),
    }),
  );

  // Unknown API reads are JSON 404s, never the console page. GET only, so API routes added to the
  // app after createApp (later route groups, tests) stay reachable for other methods.
  app.get('/api/*', (c) => c.json({ error: 'not found' }, 404));

  app.use('*', async (c, next) => {
    const page = isSafe(c.req.method) && !c.req.path.startsWith('/api/');
    if (page && !existsSync(indexFile)) {
      return c.text('Console not built. Run pnpm build:ui.', 503);
    }
    await next();
  });

  app.use('*', serveStatic({ root: options.uiDir }));

  // SPA fallback: any other GET renders the console, which routes on the client.
  app.get('*', (c) => c.html(readFileSync(indexFile, 'utf8')));

  app.notFound((c) => c.json({ error: 'not found' }, 404));
  app.onError((_error, c) => c.json({ error: 'internal error' }, 500));

  return app;
}

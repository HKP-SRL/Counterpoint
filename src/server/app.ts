// The console's HTTP app. The daemon binds it to 127.0.0.1 only (the bind is the LAN boundary);
// the first middleware here rejects any Host header other than exactly `127.0.0.1:{port}`, which
// stops DNS rebinding. `localhost` is rejected too: the session cookie lives on 127.0.0.1.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { listHosts, type Store } from '../core/store/db.ts';

export const PACKAGE_NAME = '@hkp/counterpoint';

export interface AppOptions {
  store: Store;
  /** The port the server is actually bound to. */
  port: number;
  /** Absolute path of the built console (`dist/ui`). */
  uiDir: string;
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
  const allowedHost = `127.0.0.1:${port}`;
  const indexFile = join(options.uiDir, 'index.html');

  app.use('*', async (c, next) => {
    if (c.req.header('host') !== allowedHost) return c.json({ error: 'blocked' }, 403);
    await next();
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

  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

  app.use('*', async (c, next) => {
    if (!existsSync(indexFile)) return c.text('Console not built. Run pnpm build:ui.', 503);
    await next();
  });

  app.use('*', serveStatic({ root: options.uiDir }));

  // SPA fallback: any other GET renders the console, which routes on the client.
  app.get('*', (c) => c.html(readFileSync(indexFile, 'utf8')));

  app.notFound((c) => c.json({ error: 'not found' }, 404));
  app.onError((_error, c) => c.json({ error: 'internal error' }, 500));

  return app;
}

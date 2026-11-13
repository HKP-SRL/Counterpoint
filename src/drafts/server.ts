// The draft server (design-drafts D-5): packed draft pages on their own loopback origin, apart from
// the console API, read-only and script-free.
//
// - Bound to 127.0.0.1 on its own port; a Host other than `127.0.0.1:<port>` or `localhost:<port>`
//   is refused (DNS rebinding).
// - GET and HEAD only; only the packer's `.html` and `.css` files (in a `packed/` folder) under a
//   host's drafts folder (`<home>/hosts/<host>/drafts/`), addressed as `/h/<host>/<path in that
//   folder>`. A path that leaves the folder (`..`, a link out) is refused.
// - Every answer carries the drafts' CSP (no script source at all), nosniff and no-store, and never
//   a cookie. The console frames these pages in `<iframe sandbox="">`, which blocks scripts again
//   and gives each page an opaque origin.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import type { Server } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { hostDir } from '../core/host/home.ts';

export const DRAFT_CSP =
  "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:";

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};
const HOST_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** A host's drafts folder in the Counterpoint home. */
export function draftsRoot(home: string, hostId: string): string {
  return join(hostDir(home, hostId), 'drafts');
}

/** The file a request names, or null when it is not a servable file inside the drafts folder. */
export function servableFile(home: string, hostId: string, path: string): string | null {
  if (!HOST_ID_RE.test(hostId)) return null;
  const segments = path.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..' || s.includes('\\'))) return null;
  // Only what the packer wrote: never a session's own, unpacked page.
  if (segments.at(-2) !== 'packed') return null;
  const type = TYPES[extname(path).toLowerCase()];
  if (type === undefined) return null;
  const root = draftsRoot(home, hostId);
  const target = resolve(root, ...segments);
  if (!existsSync(root) || !existsSync(target)) return null;
  const realRoot = realpathSync(root);
  const real = realpathSync(target);
  if (!real.startsWith(realRoot + sep) || !statSync(real).isFile()) return null;
  return real;
}

/** The draft server's app. `getPort` is the port it is bound to (for the Host check). */
export function createDraftApp(options: { home: string; getPort: () => number }): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const port = options.getPort();
    const host = c.req.header('host');
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      return c.text('blocked', 403);
    }
    await next();
    c.res.headers.set('Content-Security-Policy', DRAFT_CSP);
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('Cache-Control', 'no-store');
    c.res.headers.set('Referrer-Policy', 'no-referrer');
    c.res.headers.delete('Set-Cookie');
  });
  app.on(['GET', 'HEAD'], '/h/:hostId/*', (c) => {
    const hostId = c.req.param('hostId');
    const prefix = `/h/${hostId}/`;
    let rest: string;
    try {
      rest = decodeURIComponent(c.req.path.slice(prefix.length));
    } catch {
      return c.text('not found', 404);
    }
    const file = servableFile(options.home, hostId, rest);
    if (file === null) return c.text('not found', 404);
    const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    return c.body(readFileSync(file), 200, { 'Content-Type': type });
  });
  app.all('*', (c) =>
    c.req.method === 'GET' || c.req.method === 'HEAD'
      ? c.text('not found', 404)
      : c.text('read-only', 405),
  );
  return app;
}

export interface DraftServer {
  port: number;
  /** `http://127.0.0.1:<port>`: the origin the console frames drafts from. */
  origin: string;
  close(): Promise<void>;
}

/** Starts the draft server on 127.0.0.1 (port 0: any free port). */
export async function startDraftServer(options: {
  home: string;
  port?: number;
}): Promise<DraftServer> {
  let bound = 0;
  const app = createDraftApp({ home: options.home, getPort: () => bound });
  const server = serve({
    fetch: app.fetch,
    port: options.port ?? 0,
    hostname: '127.0.0.1',
  }) as Server;
  bound = await new Promise<number>((resolvePort, reject) => {
    const done = () => {
      const address = server.address();
      if (address !== null && typeof address === 'object') resolvePort(address.port);
      else reject(new Error('The draft server has no address.'));
    };
    if (server.listening) done();
    else {
      server.once('listening', done);
      server.once('error', reject);
    }
  });
  return {
    port: bound,
    origin: `http://127.0.0.1:${bound}`,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}

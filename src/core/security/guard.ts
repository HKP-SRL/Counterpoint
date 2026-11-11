// The console's request guard (local-console: Exact Host allowlist; Origin and content checks on
// writes; Session required for the API; Strict content security policy).
//
// Carried from the prototype guard's review: the Host check stops browsers and DNS rebinding, but
// it does NOT stop a client on the LAN — such a client can send any Host header it likes. Only
// binding the socket to 127.0.0.1 keeps LAN clients out. The Host check is therefore a browser
// defence layered on top of the bind, never a replacement for it.
//
// Order: bind 127.0.0.1 → exact Host → security headers → (non-GET /api) Origin, Fetch Metadata,
// JSON content type → session cookie → route. Three tightenings over the prototype: a missing
// Origin on a non-GET is rejected, only `127.0.0.1` is accepted (never `localhost` or `[::1]`;
// the session cookie lives on 127.0.0.1), and every /api request needs a session.
//
// hono/csrf is not used: it only inspects form-compatible content types, so a JSON POST would
// pass it untouched. The JSON-only content-type rule below closes that gap.
import { createServer, type RequestListener, type Server, type ServerOptions } from 'node:http';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import type { Store } from '../store/db.ts';
import { SESSION_COOKIE, validateSession } from './login.ts';

export type PortGetter = () => number;

/**
 * The console's Content Security Policy. Scripts stay strict (no inline script; the theme
 * bootstrap is an external file). `style-src` allows inline styles because Astryx injects
 * <style> elements at runtime (a strict style-src would break the design system).
 */
export const CONSOLE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const BLOCKED = { error: 'blocked' } as const;
const SIGNED_OUT = { error: 'signed-out' } as const;

const allowedHost = (port: number) => `127.0.0.1:${port}`;
const allowedOrigin = (port: number) => `http://127.0.0.1:${port}`;

const isSafeMethod = (method: string) => method === 'GET' || method === 'HEAD';

/** `Sec-Fetch-Site`, when the browser sends it, must say the request came from our own page. */
function crossSite(c: Context): boolean {
  const site = c.req.header('sec-fetch-site');
  return site !== undefined && site !== 'same-origin';
}

/** True for `application/json` with optional parameters (`; charset=utf-8`), nothing else. */
function isJson(contentType: string | undefined): boolean {
  if (contentType === undefined) return false;
  const [type] = contentType.split(';');
  return type?.trim().toLowerCase() === 'application/json';
}

/** Exact Host allowlist: `127.0.0.1:{port}`, else 403. Stops DNS rebinding. */
export function hostGuard(getPort: PortGetter): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.header('host') !== allowedHost(getPort())) return c.json(BLOCKED, 403);
    await next();
  };
}

/**
 * For non-GET/HEAD `/api/*`: the Origin must be exactly this console (a missing Origin is
 * rejected), `Sec-Fetch-Site` when present must be `same-origin`, and the body must be JSON
 * (415 otherwise). Runs before the session check, so a cross-site request learns nothing about
 * whether the browser is signed in.
 */
export function mutationGuard(getPort: PortGetter): MiddlewareHandler {
  return async (c, next) => {
    if (!isSafeMethod(c.req.method)) {
      if (c.req.header('origin') !== allowedOrigin(getPort())) return c.json(BLOCKED, 403);
      if (crossSite(c)) return c.json(BLOCKED, 403);
      if (!isJson(c.req.header('content-type'))) return c.json(BLOCKED, 415);
    }
    await next();
  };
}

/**
 * For the SSE stream (a GET): an EventSource normally sends no Origin, so the stream relies on
 * Host + the SameSite=Strict cookie; an Origin or `Sec-Fetch-Site` that is present must still
 * match.
 */
export function sseGuard(getPort: PortGetter): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('origin');
    if (origin !== undefined && origin !== allowedOrigin(getPort())) return c.json(BLOCKED, 403);
    if (crossSite(c)) return c.json(BLOCKED, 403);
    await next();
  };
}

/** Every `/api/*` request, GET and SSE included, needs a live session; else 401 signed-out. */
export function sessionGuard(db: Store): MiddlewareHandler {
  return async (c, next) => {
    if (!validateSession(db, getCookie(c, SESSION_COOKIE))) return c.json(SIGNED_OUT, 401);
    await next();
  };
}

/** CSP, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, nosniff. */
export function securityHeaders(): MiddlewareHandler {
  const standard = secureHeaders({
    referrerPolicy: 'no-referrer',
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    // HSTS means nothing on plain-http loopback.
    strictTransportSecurity: false,
  });
  return async (c, next) => {
    await standard(c, next);
    c.res.headers.set('Content-Security-Policy', CONSOLE_CSP);
  };
}

/**
 * An http.Server whose requests are checked against the exact Host before the HTTP adapter sees
 * them. The adapter answers a missing or malformed Host with 400 before any middleware runs; this
 * makes every wrong Host a 403 `blocked`, the same answer hostGuard gives. Pass it to
 * `serve({ createServer: hostCheckedServer })`; the adapter calls it as (options, listener).
 */
export const hostCheckedServer = createHostCheckedServer as typeof createServer;

function createHostCheckedServer(options: ServerOptions, listener: RequestListener): Server {
  // requireHostHeader: false lets a Host-less request reach the exact check below (403, not
  // Node's own 400); the check is stricter than Node's.
  const server: Server = createServer({ ...options, requireHostHeader: false }, (req, res) => {
    const address = server.address();
    const port = address !== null && typeof address === 'object' ? address.port : -1;
    if (req.headers.host !== allowedHost(port)) {
      const body = JSON.stringify(BLOCKED);
      res.writeHead(403, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }
    listener(req, res);
  });
  return server;
}

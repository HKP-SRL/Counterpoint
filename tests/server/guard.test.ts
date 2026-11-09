// The console's request guard over a real 127.0.0.1 socket (FOUND-02, T-01-06, T-01-07, T-01-11).
// Raw node:http requests, because fetch cannot set or omit the Host header.
import type { Server } from 'node:http';
import { request } from 'node:http';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hostCheckedServer } from '../../src/core/security/guard.ts';
import { mintLoginCode } from '../../src/core/security/login.ts';
import { openStore, type Store, upsertHost } from '../../src/core/store/db.ts';
import { createApp } from '../../src/server/app.ts';
import { makeScratchDir, removeScratchDirs, writeFileIn } from '../helpers/scratch.ts';

const EXPECTED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

interface RawRequest {
  method?: string;
  path: string;
  /** `null` sends no Host header at all. */
  host?: string | null;
  headers?: Record<string, string>;
  body?: string;
}

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let store: Store;
let server: Server;
let app: Hono;
let port = 0;
let cookie = '';

function raw(req: RawRequest): Promise<RawResponse> {
  const headers: Record<string, string> = { ...(req.headers ?? {}) };
  const host = req.host === undefined ? `127.0.0.1:${port}` : req.host;
  if (host !== null) headers.host = host;
  if (req.body !== undefined) headers['content-length'] = String(Buffer.byteLength(req.body));
  return new Promise((done, reject) => {
    const r = request(
      {
        host: '127.0.0.1',
        port,
        path: req.path,
        method: req.method ?? 'GET',
        agent: false,
        setHost: false,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          done({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    r.on('error', reject);
    if (req.body !== undefined) r.write(req.body);
    r.end();
  });
}

const origin = () => `http://127.0.0.1:${port}`;

function post(headers: Record<string, string>, body = '{}', path = '/api/__test/echo') {
  return raw({ method: 'POST', path, headers, body });
}

beforeAll(async () => {
  store = openStore(makeScratchDir('guard'));
  upsertHost(store, {
    id: 'cena',
    root: '/repos/cena',
    gitCommonDir: '/repos/cena/.git',
    baseBranch: 'main',
    adapter: 'none',
  });
  const uiDir = makeScratchDir('ui');
  writeFileIn(uiDir, 'index.html', '<!doctype html><title>Counterpoint</title>');

  let ready: Hono | undefined;
  server = serve({
    fetch: (req, env) =>
      ready === undefined ? new Response('starting', { status: 503 }) : ready.fetch(req, env),
    port: 0,
    hostname: '127.0.0.1',
    createServer: hostCheckedServer as never,
  }) as Server;
  await new Promise<void>((done) => {
    if (server.listening) done();
    else server.once('listening', () => done());
  });
  const address = server.address();
  if (address === null || typeof address !== 'object') throw new Error('no address');
  port = address.port;

  app = createApp({ store, port, uiDir });
  // A test-only JSON route behind the same guard chain as every real /api route.
  app.post('/api/__test/echo', async (c) => c.json({ ok: true, body: await c.req.json() }));
  ready = app;

  // A real session through the real sign-in exchange.
  const login = await raw({ path: `/login?code=${mintLoginCode(store)}` });
  expect(login.status).toBe(302);
  const setCookie = login.headers['set-cookie']?.[0] ?? '';
  cookie = setCookie.split(';')[0] ?? '';
  expect(cookie).toMatch(/^cp_session=/);
});

afterAll(async () => {
  await new Promise<void>((done) => {
    server.close(() => done());
    server.closeAllConnections();
  });
  store.close();
  removeScratchDirs();
});

describe('Host allowlist', () => {
  it.each([
    ['exact 127.0.0.1 and port', 200, (p: number) => `127.0.0.1:${p}`],
    ['localhost with the port', 403, (p: number) => `localhost:${p}`],
    ['IPv6 loopback with the port', 403, (p: number) => `[::1]:${p}`],
    ['evil.example with the port', 403, (p: number) => `evil.example:${p}`],
    ['localhost.evil.example', 403, () => 'localhost.evil.example'],
    ['localhost@evil.example', 403, () => 'localhost@evil.example'],
    ['127.0.0.1 with another port', 403, (p: number) => `127.0.0.1:${p + 1}`],
    ['127.0.0.1 without a port', 403, () => '127.0.0.1'],
    ['missing Host', 403, () => null],
  ])('%s -> %i', async (_label, expected, host) => {
    const res = await raw({ path: '/api/hosts', host: host(port), headers: { cookie } });
    expect(res.status).toBe(expected);
    if (expected === 403) expect(JSON.parse(res.body)).toEqual({ error: 'blocked' });
  });

  it('guards /login and the console pages too', async () => {
    expect((await raw({ path: '/login?code=x', host: `localhost:${port}` })).status).toBe(403);
    expect((await raw({ path: '/', host: `evil.example:${port}` })).status).toBe(403);
  });
});

describe('mutation guard on non-GET /api/*', () => {
  const json = { 'content-type': 'application/json' };

  it('lets a same-origin JSON request with a session through', async () => {
    const res = await post({ ...json, origin: origin(), cookie }, '{"a":1}');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, body: { a: 1 } });
  });

  it('accepts a JSON content type with a charset and Sec-Fetch-Site same-origin', async () => {
    const res = await post({
      'content-type': 'application/json; charset=utf-8',
      'sec-fetch-site': 'same-origin',
      origin: origin(),
      cookie,
    });
    expect(res.status).toBe(200);
  });

  it.each([
    ['missing', undefined],
    ['localhost', 'http://localhost:PORT'],
    ['https', 'https://127.0.0.1:PORT'],
    ['null', 'null'],
    ['other port', 'http://127.0.0.1:NEXT'],
    ['foreign', 'http://evil.example'],
  ])('rejects a %s Origin with 403', async (_label, value) => {
    const headers: Record<string, string> = { ...json, cookie };
    if (value !== undefined) {
      headers.origin = value.replace('PORT', String(port)).replace('NEXT', String(port + 1));
    }
    const res = await post(headers);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'blocked' });
  });

  it.each(['cross-site', 'same-site', 'none'])(
    'rejects Sec-Fetch-Site %s with 403',
    async (site) => {
      const res = await post({ ...json, origin: origin(), cookie, 'sec-fetch-site': site });
      expect(res.status).toBe(403);
    },
  );

  it.each([
    ['text/plain', 'text/plain'],
    ['form-encoded', 'application/x-www-form-urlencoded'],
    ['multipart', 'multipart/form-data; boundary=x'],
    ['a JSON look-alike', 'application/jsonx'],
  ])('rejects a %s body with 415', async (_label, type) => {
    const res = await post({ 'content-type': type, origin: origin(), cookie });
    expect(res.status).toBe(415);
    expect(JSON.parse(res.body)).toEqual({ error: 'blocked' });
  });

  it('rejects a body with no content type with 415', async () => {
    const res = await post({ origin: origin(), cookie });
    expect(res.status).toBe(415);
  });

  it('guards every unsafe method, not only POST', async () => {
    for (const method of ['PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const res = await raw({ method, path: '/api/hosts', headers: { ...json, cookie } });
      expect(res.status, method).toBe(403);
    }
  });

  it('checks Origin before the session (403, not 401)', async () => {
    const res = await post({ ...json, origin: 'http://evil.example' });
    expect(res.status).toBe(403);
  });

  it('answers 401 to a well-formed request without a session', async () => {
    const res = await post({ ...json, origin: origin() });
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'signed-out' });
  });
});

describe('session on every /api/* request', () => {
  it('answers 401 signed-out without a cookie', async () => {
    const res = await raw({ path: '/api/hosts' });
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'signed-out' });
  });

  it('answers 401 to a forged cookie', async () => {
    const res = await raw({
      path: '/api/hosts',
      headers: { cookie: `cp_session=${'A'.repeat(43)}` },
    });
    expect(res.status).toBe(401);
  });

  it('answers 200 with the session cookie', async () => {
    const res = await raw({ path: '/api/hosts', headers: { cookie } });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).hosts[0].id).toBe('cena');
  });

  it('puts every GET /api route behind the session check', async () => {
    const paths = app.routes
      .filter((route) => route.method === 'GET' && route.path.startsWith('/api/'))
      .map((route) => route.path.replace('*', 'anything').replace(/:([A-Za-z]+)/g, 'x'));
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect((await raw({ path })).status, path).toBe(401);
    }
  });

  it('serves the console pages without a session', async () => {
    for (const path of ['/', '/signed-out?reason=none', '/h/cena']) {
      const res = await raw({ path });
      expect(res.status, path).toBe(200);
      expect(res.body).toContain('<title>Counterpoint</title>');
    }
  });
});

describe('security headers', () => {
  it.each(['/', '/signed-out?reason=used'])(
    'HTML at %s carries the CSP and headers',
    async (path) => {
      const res = await raw({ path });
      expect(res.headers['content-type']).toMatch(/^text\/html/);
      expect(res.headers['content-security-policy']).toBe(EXPECTED_CSP);
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    },
  );

  it('the sign-in redirect sends no referrer', async () => {
    const res = await raw({ path: `/login?code=${mintLoginCode(store)}` });
    expect(res.status).toBe(302);
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('bind', () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((info) => info !== undefined && info.family === 'IPv4' && !info.internal)?.address;

  it.skipIf(lan === undefined)('refuses a connection on a non-loopback interface', async () => {
    const code = await new Promise<string>((done) => {
      const socket = connect({ host: lan as string, port });
      socket.setTimeout(3000, () => {
        socket.destroy();
        done('timeout');
      });
      socket.once('connect', () => {
        socket.destroy();
        done('connected');
      });
      socket.once('error', (error: NodeJS.ErrnoException) => done(error.code ?? 'error'));
    });
    expect(code).toBe('ECONNREFUSED');
  });
});

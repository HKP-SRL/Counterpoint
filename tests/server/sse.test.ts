// The live-events outbox and GET /api/events (UI-SPEC Interaction Contract 2, T-01-10).
import type { IncomingMessage, Server } from 'node:http';
import { request } from 'node:http';
import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hostCheckedServer } from '../../src/core/security/guard.ts';
import { mintLoginCode } from '../../src/core/security/login.ts';
import { openStore, type Store } from '../../src/core/store/db.ts';
import {
  appendEvent,
  EVENT_FAMILIES,
  EventBus,
  listEventsSince,
  type StoredEvent,
} from '../../src/core/store/events.ts';
import { createApp } from '../../src/server/app.ts';
import { createControlApp, hashToken } from '../../src/server/control.ts';
import { makeScratchDir, removeScratchDirs, writeFileIn } from '../helpers/scratch.ts';

const TOKEN = 'test-control-token';
const HEARTBEAT_MS = 50;

interface Frame {
  id?: string;
  event?: string;
  data?: string;
}

interface Stream {
  status: number;
  frames: Frame[];
  comments: string[];
  body: string;
  waitFor: (predicate: () => boolean, ms?: number) => Promise<void>;
  close: () => void;
}

let store: Store;
let bus: EventBus;
let server: Server;
let control: Hono;
let port = 0;
let cookie = '';

const origin = () => `http://127.0.0.1:${port}`;

function parse(text: string, frames: Frame[], comments: string[]): string {
  let rest = text;
  for (;;) {
    const end = rest.indexOf('\n\n');
    if (end === -1) return rest;
    const block = rest.slice(0, end);
    rest = rest.slice(end + 2);
    const frame: Frame = {};
    let isFrame = false;
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) comments.push(line);
      else if (line.startsWith('id: ')) {
        frame.id = line.slice(4);
        isFrame = true;
      } else if (line.startsWith('event: ')) {
        frame.event = line.slice(7);
        isFrame = true;
      } else if (line.startsWith('data: ')) {
        frame.data = (frame.data === undefined ? '' : `${frame.data}\n`) + line.slice(6);
        isFrame = true;
      }
    }
    if (isFrame) frames.push(frame);
  }
}

function openStream(headers: Record<string, string>, path = '/api/events'): Promise<Stream> {
  return new Promise((done, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        agent: false,
        headers: { host: `127.0.0.1:${port}`, accept: 'text/event-stream', ...headers },
      },
      (res: IncomingMessage) => {
        const frames: Frame[] = [];
        const comments: string[] = [];
        let buffer = '';
        const stream: Stream = {
          status: res.statusCode ?? 0,
          frames,
          comments,
          body: '',
          waitFor: (predicate, ms = 3000) =>
            new Promise((ok, fail) => {
              const deadline = Date.now() + ms;
              const tick = () => {
                if (predicate()) ok();
                else if (Date.now() > deadline) fail(new Error('timed out waiting for the stream'));
                else setTimeout(tick, 10);
              };
              tick();
            }),
          close: () => req.destroy(),
        };
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          stream.body += chunk;
          buffer = parse(buffer + chunk, frames, comments);
        });
        res.on('error', () => {});
        done(stream);
      },
    );
    req.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ECONNRESET') reject(error);
    });
    req.end();
  });
}

const familyFrames = (stream: Stream) =>
  stream.frames.filter((frame) =>
    (EVENT_FAMILIES as readonly string[]).includes(frame.event ?? ''),
  );

async function notify(body: unknown): Promise<Response> {
  return control.request('http://counterpoint.control/control/notify', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      host: 'counterpoint.control',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  store = openStore(makeScratchDir('sse'));
  bus = new EventBus();
  const uiDir = makeScratchDir('ui');
  writeFileIn(uiDir, 'index.html', '<!doctype html><title>Counterpoint</title>');

  let app: Hono | undefined;
  server = serve({
    fetch: (req, env) =>
      app === undefined ? new Response('starting', { status: 503 }) : app.fetch(req, env),
    port: 0,
    hostname: '127.0.0.1',
    createServer: hostCheckedServer,
  }) as Server;
  await new Promise<void>((done) => {
    if (server.listening) done();
    else server.once('listening', () => done());
  });
  const address = server.address();
  if (address === null || typeof address !== 'object') throw new Error('no address');
  port = address.port;

  app = createApp({ store, port, uiDir, bus, heartbeatMs: HEARTBEAT_MS });
  control = createControlApp({
    store,
    bus,
    tokenHash: hashToken(TOKEN),
    port,
    onStop: () => {},
    detectFramework: async () => 'none',
  });

  const login = await fetch(`${origin()}/login?code=${mintLoginCode(store)}`, {
    redirect: 'manual',
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
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

describe('events outbox', () => {
  it('names the event families', () => {
    expect(EVENT_FAMILIES).toEqual(['host', 'phase', 'approval', 'runway', 'needs-you', 'doctor']);
  });

  it('appendEvent returns increasing seq values', () => {
    const db = openStore(makeScratchDir('outbox'));
    const a = appendEvent(db, { hostId: 'cena', family: 'phase', payload: { phaseId: '02' } });
    const b = appendEvent(db, { hostId: 'cena', family: 'runway' });
    const c = appendEvent(db, { hostId: null, family: 'doctor' });
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    db.close();
  });

  it('listEventsSince returns only later events, in seq order, up to the limit', () => {
    const db = openStore(makeScratchDir('outbox'));
    const seqs = [1, 2, 3, 4, 5].map((n) =>
      appendEvent(db, { hostId: 'cena', family: 'phase', payload: { n } }),
    );
    const later = listEventsSince(db, seqs[1] as number);
    expect(later.map((event) => event.seq)).toEqual(seqs.slice(2));
    expect(later[0]).toMatchObject({ hostId: 'cena', family: 'phase', payload: { n: 3 } });
    expect(listEventsSince(db, 0, 2).map((event) => event.seq)).toEqual(seqs.slice(0, 2));
    db.close();
  });
});

describe('POST /control/notify', () => {
  it('appends a valid event and emits it on the bus', async () => {
    const seen: StoredEvent[] = [];
    const unsubscribe = bus.subscribe((event) => seen.push(event));
    const res = await notify({ hostId: 'cena', family: 'doctor' });
    unsubscribe();
    expect(res.status).toBe(202);
    const { seq } = (await res.json()) as { seq: number };
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ seq, hostId: 'cena', family: 'doctor' });
    expect(listEventsSince(store, seq - 1)[0]?.seq).toBe(seq);
  });

  it.each([
    ['an unknown family', { hostId: 'cena', family: 'shell' }],
    ['an invalid host id', { hostId: '../etc', family: 'phase' }],
    ['extra fields', { hostId: 'cena', family: 'phase', payload: { file: 'secret' } }],
    ['a missing family', { hostId: 'cena' }],
  ])('rejects %s with 400', async (_label, body) => {
    expect((await notify(body)).status).toBe(400);
  });

  it('requires the control token', async () => {
    const res = await control.request('http://counterpoint.control/control/notify', {
      method: 'POST',
      headers: { host: 'counterpoint.control', 'content-type': 'application/json' },
      body: JSON.stringify({ hostId: 'cena', family: 'phase' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/events', () => {
  it('answers 401 without a session', async () => {
    const stream = await openStream({});
    expect(stream.status).toBe(401);
    stream.close();
  });

  it('answers 403 to a foreign Origin', async () => {
    const stream = await openStream({ cookie, origin: 'http://evil.example' });
    expect(stream.status).toBe(403);
    stream.close();
  });

  it('answers 403 to a cross-site fetch', async () => {
    const stream = await openStream({ cookie, 'sec-fetch-site': 'cross-site' });
    expect(stream.status).toBe(403);
    stream.close();
  });

  it('accepts a same-origin stream', async () => {
    const stream = await openStream({ cookie, origin: origin(), 'sec-fetch-site': 'same-origin' });
    expect(stream.status).toBe(200);
    stream.close();
  });

  it('replays events after Last-Event-ID first, then streams live ones', async () => {
    const seqs = [1, 2, 3, 4, 5].map((n) =>
      appendEvent(store, { hostId: 'cena', family: 'phase', payload: { n } }),
    );
    const after = seqs[2] as number;
    const stream = await openStream({ cookie, 'last-event-id': String(after) });
    expect(stream.status).toBe(200);
    expect(stream.body).toBeDefined();

    await stream.waitFor(() => familyFrames(stream).length >= 2);
    const replayed = familyFrames(stream).slice(0, 2);
    expect(replayed.map((frame) => Number(frame.id))).toEqual(seqs.slice(3));
    expect(replayed.map((frame) => frame.event)).toEqual(['phase', 'phase']);
    expect(JSON.parse(replayed[0]?.data ?? '{}')).toEqual({ hostId: 'cena', n: 4 });

    const res = await notify({ hostId: 'cena', family: 'runway' });
    const { seq } = (await res.json()) as { seq: number };
    await stream.waitFor(() => familyFrames(stream).length >= 3);
    const live = familyFrames(stream)[2];
    expect(live).toMatchObject({ id: String(seq), event: 'runway' });
    expect(JSON.parse(live?.data ?? '{}')).toEqual({ hostId: 'cena' });
    stream.close();
  });

  it('accepts lastEventId as a query parameter for manual reconnects', async () => {
    const seq = appendEvent(store, { hostId: 'cena', family: 'approval' });
    const stream = await openStream({ cookie }, `/api/events?lastEventId=${seq - 1}`);
    await stream.waitFor(() => familyFrames(stream).length >= 1);
    expect(familyFrames(stream)[0]).toMatchObject({ id: String(seq), event: 'approval' });
    stream.close();
  });

  it('without Last-Event-ID streams only new events', async () => {
    appendEvent(store, { hostId: 'cena', family: 'phase' });
    const stream = await openStream({ cookie });
    await stream.waitFor(() => stream.frames.length >= 1);
    const res = await notify({ hostId: 'cena', family: 'needs-you' });
    const { seq } = (await res.json()) as { seq: number };
    await stream.waitFor(() => familyFrames(stream).length >= 1);
    expect(familyFrames(stream).map((frame) => frame.id)).toEqual([String(seq)]);
    stream.close();
  });

  it('sends heartbeat comments at the configured interval', async () => {
    const stream = await openStream({ cookie });
    await stream.waitFor(() => stream.comments.length >= 2, 2000);
    expect(stream.comments.length).toBeGreaterThanOrEqual(2);
    stream.close();
  });

  it('stops listening when the client goes away', async () => {
    const before = bus.listenerCount();
    const stream = await openStream({ cookie });
    await stream.waitFor(() => bus.listenerCount() === before + 1);
    stream.close();
    await stream.waitFor(() => bus.listenerCount() === before);
    expect(bus.listenerCount()).toBe(before);
  });
});

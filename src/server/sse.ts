// GET /api/events: the console's one live stream (UI-SPEC Interaction Contract 2).
//
// Each SQLite outbox event becomes one SSE frame: `id:` is the seq, `event:` is the family and
// `data:` is `{ hostId, ...payload }`. A reconnecting browser sends `Last-Event-ID` (or the
// `lastEventId` query for a manual reconnect) and first gets every event after it, then live
// ones. After the replay, a `ready` frame carries the newest seq as its id, so even a stream
// that saw no events reconnects from the right place. A comment line every `heartbeatMs` keeps
// idle connections open.
import type { Hono } from 'hono';
import { type SSEStreamingApi, streamSSE } from 'hono/streaming';
import { type PortGetter, sessionGuard, sseGuard } from '../core/security/guard.ts';
import type { Store } from '../core/store/db.ts';
import {
  type EventBus,
  latestEventSeq,
  listEventsSince,
  type StoredEvent,
} from '../core/store/events.ts';

export const DEFAULT_HEARTBEAT_MS = 25_000;

const REPLAY_PAGE = 500;
const SEQ_RE = /^\d{1,15}$/;

export interface EventsOptions {
  db: Store;
  bus: EventBus;
  getPort: PortGetter;
  heartbeatMs?: number;
}

function parseSeq(value: string | undefined): number | null {
  return value !== undefined && SEQ_RE.test(value) ? Number(value) : null;
}

export function mountEvents(app: Hono, options: EventsOptions): void {
  const { db, bus, getPort } = options;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;

  app.get('/api/events', sseGuard(getPort), sessionGuard(db), (c) => {
    const lastEventId =
      parseSeq(c.req.header('last-event-id')) ?? parseSeq(c.req.query('lastEventId'));

    return streamSSE(c, async (stream: SSEStreamingApi) => {
      // Writes are serialised through one chain so frames never interleave.
      let chain: Promise<unknown> = Promise.resolve();
      const enqueue = (write: () => Promise<unknown>) => {
        chain = chain.then(write).catch(() => {});
        return chain;
      };

      // Without Last-Event-ID the client has a fresh snapshot: start after the newest event.
      let lastSent = lastEventId ?? latestEventSeq(db);
      let live = false;
      const pending: StoredEvent[] = [];

      const send = (event: StoredEvent) => {
        if (event.seq <= lastSent) return;
        lastSent = event.seq;
        void enqueue(() =>
          stream.writeSSE({
            id: String(event.seq),
            event: event.family,
            data: JSON.stringify({ hostId: event.hostId, ...event.payload }),
          }),
        );
      };

      // Subscribe before replaying, buffering, so nothing appended mid-replay is lost.
      const unsubscribe = bus.subscribe((event) => {
        if (live) send(event);
        else pending.push(event);
      });
      const heartbeat = setInterval(() => {
        void enqueue(() => stream.write(': heartbeat\n\n'));
      }, heartbeatMs);
      const closed = new Promise<void>((resolve) => stream.onAbort(resolve));

      try {
        if (lastEventId !== null) {
          for (;;) {
            const page = listEventsSince(db, lastSent, REPLAY_PAGE);
            for (const event of page) send(event);
            if (page.length < REPLAY_PAGE || stream.aborted) break;
          }
        }
        for (const event of pending.sort((a, b) => a.seq - b.seq)) send(event);
        pending.length = 0;
        live = true;
        const readyId = lastSent;
        await enqueue(() => stream.writeSSE({ id: String(readyId), event: 'ready', data: '{}' }));
        await closed;
      } finally {
        unsubscribe();
        clearInterval(heartbeat);
      }
    });
  });
}

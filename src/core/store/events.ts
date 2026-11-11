// The events outbox (SQLite `events`) and the daemon's in-process bus.
//
// Every live change the console should see is appended here first, then emitted on the bus to
// the open SSE streams. The autoincrement `seq` is the SSE `id`, so a reconnecting browser sends
// `Last-Event-ID` and gets exactly what it missed. Payloads carry ids only, never file contents.
import { EventEmitter } from 'node:events';
import type { SQLOutputValue } from 'node:sqlite';
import type { Store } from './db.ts';

/**
 * The live-update families (local-console: Live updates over one event stream), plus `host`
 * (a host registered or updated).
 * `planning`: the host's planning truth moved (a new base tip, or a settled re-read).
 * `run`: a build run started, moved on (phase, change state) or ended; `doctor` also carries a
 * console doctor run's phases.
 */
export const EVENT_FAMILIES = [
  'host',
  'planning',
  'approval',
  'runway',
  'needs-you',
  'doctor',
  'run',
] as const;

export type EventFamily = (typeof EVENT_FAMILIES)[number];

export interface StoredEvent {
  seq: number;
  hostId: string | null;
  family: EventFamily;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface NewEvent {
  hostId: string | null;
  family: EventFamily;
  /** Ids only (change id, item id, commit sha); never file contents. */
  payload?: Record<string, unknown>;
}

export function isEventFamily(value: unknown): value is EventFamily {
  return typeof value === 'string' && (EVENT_FAMILIES as readonly string[]).includes(value);
}

/** Appends an event and returns its seq. */
export function appendEvent(db: Store, input: NewEvent, now: number = Date.now()): number {
  if (!isEventFamily(input.family)) throw new Error(`Unknown event family ${input.family}.`);
  const result = db
    .prepare('INSERT INTO events (host_id, family, payload, created_at) VALUES (?, ?, ?, ?)')
    .run(input.hostId, input.family, JSON.stringify(input.payload ?? {}), now);
  return Number(result.lastInsertRowid);
}

function toEvent(row: Record<string, SQLOutputValue>): StoredEvent {
  const family = row.family;
  if (!isEventFamily(family)) throw new Error(`Stored event has unknown family ${String(family)}.`);
  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(String(row.payload));
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    // an unreadable payload is delivered as {}
  }
  return {
    seq: Number(row.seq),
    hostId: typeof row.host_id === 'string' ? row.host_id : null,
    family,
    payload,
    createdAt: Number(row.created_at),
  };
}

/** Events with seq greater than `seq`, oldest first, at most `limit`. */
export function listEventsSince(db: Store, seq: number, limit = 500): StoredEvent[] {
  return db
    .prepare(
      'SELECT seq, host_id, family, payload, created_at FROM events WHERE seq > ? ORDER BY seq LIMIT ?',
    )
    .all(seq, limit)
    .map(toEvent);
}

/** The newest seq in the outbox, 0 when empty. */
export function latestEventSeq(db: Store): number {
  const row = db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events').get();
  return Number(row?.seq ?? 0);
}

type Listener = (event: StoredEvent) => void;

/** A small typed wrapper around EventEmitter: one channel, any number of SSE streams. */
export class EventBus {
  readonly #emitter = new EventEmitter();

  constructor() {
    // One listener per open console tab; no artificial cap.
    this.#emitter.setMaxListeners(0);
  }

  emit(event: StoredEvent): void {
    this.#emitter.emit('event', event);
  }

  /** Returns the unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.#emitter.on('event', listener);
    return () => {
      this.#emitter.off('event', listener);
    };
  }

  listenerCount(): number {
    return this.#emitter.listenerCount('event');
  }
}

/** Appends to the outbox, then emits on the bus. Returns the stored event. */
export function publishEvent(
  db: Store,
  bus: EventBus,
  input: NewEvent,
  now: number = Date.now(),
): StoredEvent {
  const seq = appendEvent(db, input, now);
  const event: StoredEvent = {
    seq,
    hostId: input.hostId,
    family: input.family,
    payload: input.payload ?? {},
    createdAt: now,
  };
  bus.emit(event);
  return event;
}

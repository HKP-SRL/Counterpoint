// The events outbox and in-process bus. Not implemented yet.
import type { Store } from './db.ts';

export const EVENT_FAMILIES = [
  'host',
  'phase',
  'approval',
  'runway',
  'needs-you',
  'doctor',
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
  payload?: Record<string, unknown>;
}

export function appendEvent(_db: Store, _input: NewEvent, _now: number = Date.now()): number {
  throw new Error('not implemented');
}

export function listEventsSince(_db: Store, _seq: number, _limit = 500): StoredEvent[] {
  throw new Error('not implemented');
}

export function publishEvent(_db: Store, _bus: EventBus, _input: NewEvent): StoredEvent {
  throw new Error('not implemented');
}

export class EventBus {
  emit(_event: StoredEvent): void {
    throw new Error('not implemented');
  }

  subscribe(_listener: (event: StoredEvent) => void): () => void {
    throw new Error('not implemented');
  }

  listenerCount(): number {
    throw new Error('not implemented');
  }
}

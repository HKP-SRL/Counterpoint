// GET /api/events. Not implemented yet.
import type { Hono } from 'hono';
import type { PortGetter } from '../core/security/guard.ts';
import type { Store } from '../core/store/db.ts';
import type { EventBus } from '../core/store/events.ts';

export interface EventsOptions {
  db: Store;
  bus: EventBus;
  getPort: PortGetter;
  heartbeatMs?: number;
}

export function mountEvents(_app: Hono, _options: EventsOptions): void {}

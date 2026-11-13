// The console's one live stream (local-console: Live updates over one event stream). A single
// EventSource on GET /api/events turns each event family into TanStack Query invalidations, so
// pages refetch their snapshot only when something changed; the browser never polls.
//
// Reconnects: the browser retries on its own and resends `Last-Event-ID`, so the server replays
// what was missed. If the stream is closed for good (a non-200 answer, e.g. 401 after the daemon
// restarted and cleared every session), one GET /api/hosts decides what happens next: a 401 or
// 403 routes to the signed-out screen (api.ts); anything else reopens the stream with the last
// seen id in the `lastEventId` query.
import { useAnnounce } from '@astryxdesign/core/hooks';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { ApiError, apiGet, queryKeys } from './api';
import { HOST_ID_RE } from './ids';

export type ConnectionState = 'connected' | 'reconnecting';

export const EVENT_FAMILIES = [
  'host',
  'planning',
  'approval',
  'runway',
  'needs-you',
  'doctor',
  'run',
  'settings',
] as const;
export type EventFamily = (typeof EVENT_FAMILIES)[number];

/** Which cached queries each event family makes stale, for the event's host. */
export const FAMILY_TO_KEYS: Record<EventFamily, (hostId: string) => readonly QueryKey[]> = {
  host: () => [queryKeys.hosts],
  // A `planning` event means the base tip moved. The runway and Needs You are derived from the
  // tip too, and the watcher only publishes `runway` / `needs-you` when their value differs from
  // its own last pass: an edit and its revert inside one poll leave a page that fetched the middle
  // state stale. Refetching them on every tip move closes that gap (the server caches per tip).
  planning: (hostId) => [
    queryKeys.changes(hostId),
    queryKeys.change(hostId),
    queryKeys.runway(hostId),
    queryKeys.needsYou(hostId),
  ],
  approval: (hostId) => [
    queryKeys.change(hostId),
    queryKeys.changes(hostId),
    queryKeys.runway(hostId),
    queryKeys.needsYou(hostId),
  ],
  runway: (hostId) => [queryKeys.runway(hostId)],
  'needs-you': (hostId) => [queryKeys.needsYou(hostId)],
  // Stored by earlier versions only; nothing publishes it now.
  doctor: () => [],
  // A build run moved on: the Run card, and what it changes (parked items, the runway).
  run: (hostId) => [queryKeys.run(hostId), queryKeys.needsYou(hostId), queryKeys.runway(hostId)],
  // A project's run settings were saved: the Settings page and the Run card's summary.
  settings: (hostId) => [queryKeys.settings(hostId)],
};

const SEQ_RE = /^\d{1,15}$/;
const REOPEN_AFTER_PROBE_MS = 1_000;
const REOPEN_AFTER_FAILURE_MS = 3_000;

/** The event's host id, or null when the payload has none we can trust. */
export function eventHostId(data: unknown): string | null {
  if (typeof data !== 'string') return null;
  try {
    const parsed = JSON.parse(data) as { hostId?: unknown };
    return typeof parsed.hostId === 'string' && HOST_ID_RE.test(parsed.hostId)
      ? parsed.hostId
      : null;
  } catch {
    return null;
  }
}

/** The query keys an event invalidates; host-scoped families need a valid host id. */
export function keysForEvent(family: EventFamily, data: unknown): readonly QueryKey[] {
  if (family === 'host') return FAMILY_TO_KEYS.host('');
  const hostId = eventHostId(data);
  // A machine card (a restart, a one-time setup) belongs to every project's inbox.
  if (family === 'needs-you' && hostId === null) return [['host']];
  return hostId === null ? [] : FAMILY_TO_KEYS[family](hostId);
}

// Connection state is page-wide (one stream per page), shared through a tiny external store.
let connection: ConnectionState = 'connected';
const listeners = new Set<() => void>();

function setConnection(next: ConnectionState): void {
  if (next === connection) return;
  connection = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useConnectionState(): ConnectionState {
  return useSyncExternalStore(
    subscribe,
    () => connection,
    () => connection,
  );
}

/** Opens the page's one EventSource and keeps the query cache in step with it. */
export function useLiveEvents(queryClient: QueryClient): void {
  const announce = useAnnounce();
  const announceRef = useRef(announce);
  announceRef.current = announce;

  useEffect(() => {
    let source: EventSource | null = null;
    let lastEventId: string | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let probing = false;
    let lost = false;

    const markConnected = () => {
      if (lost) {
        lost = false;
        announceRef.current('Live updates reconnected', 'polite');
      }
      setConnection('connected');
    };

    const markLost = () => {
      if (!lost) {
        lost = true;
        announceRef.current('Live updates paused', 'polite');
      }
      setConnection('reconnecting');
    };

    const remember = (event: MessageEvent) => {
      if (SEQ_RE.test(event.lastEventId)) lastEventId = event.lastEventId;
    };

    const schedule = (delayMs: number) => {
      if (disposed) return;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(open, delayMs);
    };

    const probe = () => {
      if (probing || disposed) return;
      probing = true;
      apiGet('/api/hosts')
        .then(
          () => schedule(REOPEN_AFTER_PROBE_MS),
          (error: unknown) => {
            // 401 and 403 have already sent the page to the signed-out screen.
            const signedOut =
              error instanceof ApiError && (error.status === 401 || error.status === 403);
            if (!signedOut) schedule(REOPEN_AFTER_FAILURE_MS);
          },
        )
        .finally(() => {
          probing = false;
        });
    };

    function open() {
      if (disposed) return;
      const url =
        lastEventId === null
          ? '/api/events'
          : `/api/events?lastEventId=${encodeURIComponent(lastEventId)}`;
      const stream = new EventSource(url);
      source = stream;
      stream.addEventListener('open', markConnected);
      stream.addEventListener('ready', (event) => {
        remember(event);
        markConnected();
      });
      for (const family of EVENT_FAMILIES) {
        stream.addEventListener(family, (event) => {
          remember(event);
          for (const queryKey of keysForEvent(family, event.data)) {
            void queryClient.invalidateQueries({ queryKey });
          }
        });
      }
      stream.addEventListener('error', () => {
        if (disposed) return;
        markLost();
        // CONNECTING: the browser is retrying with Last-Event-ID. CLOSED: it gave up.
        if (stream.readyState === EventSource.CLOSED) {
          stream.close();
          probe();
        }
      });
    }

    open();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      source?.close();
    };
  }, [queryClient]);
}

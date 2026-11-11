// Per-host runtimes: for each registered host, the committed-content reader, the framework
// adapter (reached only through the composition root, never by naming an adapter here), the base
// tip and a snapshot cached by tip.
//
// Partial reads (a change that breaks mid-edit): when a change that read fine at the previous tip
// is unreadable at a new tip, the previous good facts for that change stay on screen and the tip is
// read again once after a short debounce. Whatever that retry finds is final, and listeners are
// told it settled so open pages refetch.
import { adapterFor } from '../compose.ts';
import type {
  ChangeFacts,
  ChangeSnapshot,
  FrameworkAdapter,
  GitFileReader,
} from '../core/framework/port.ts';
import { createGitFileReader } from '../core/git/reader.ts';
import { getHost, type HostRow, listHosts, type Store } from '../core/store/db.ts';

export const DEFAULT_DEBOUNCE_MS = 1_000;

/** What the console sees for a host at one moment. */
export interface HostView {
  /** The base branch tip, or null when the branch no longer resolves. */
  tip: string | null;
  /** The snapshot at `tip`; null when there is no tip or the host has no composed framework. */
  snapshot: ChangeSnapshot | null;
  /** True while a newly unreadable change is shown from its last good parse, awaiting the retry. */
  retryPending: boolean;
}

export interface HostRuntime {
  readonly host: HostRow;
  readonly reader: GitFileReader;
  readonly adapter: FrameworkAdapter | null;
  /** The commit `refs/heads/{base}` points at now. */
  tip(): Promise<string | null>;
  /** The tip of the snapshot last served to the console, or null before the first one. */
  servedTip(): string | null;
  /** The view at the current tip (cached per tip). */
  view(): Promise<HostView>;
}

export type SettledListener = (hostId: string, tip: string | null) => void;

export interface HostRuntimes {
  /** The runtime for a registered host, created on first use; null for an unknown id. */
  get(hostId: string): HostRuntime | null;
  /** Runtimes for every registered host (hosts registered later are picked up here). */
  list(): HostRuntime[];
  /** Called after a debounced re-read settles. Returns the unsubscribe function. */
  onSettled(listener: SettledListener): () => void;
}

export interface HostRuntimesOptions {
  store: Store;
  /** Delay before re-reading a change that just became unreadable. */
  debounceMs?: number;
}

interface CacheEntry {
  tip: string;
  /** What the adapter actually reported at `tip`. */
  actual: ChangeSnapshot;
  /** What is served: `actual` with newly unreadable changes replaced by their last good facts. */
  served: ChangeSnapshot;
  retryPending: boolean;
}

function sameHost(a: HostRow, b: HostRow): boolean {
  return a.root === b.root && a.baseBranch === b.baseBranch && a.adapter === b.adapter;
}

/** Changes readable in `previous` that are unreadable in `next`, by directory. */
function newlyUnreadable(previous: ChangeSnapshot, next: ChangeSnapshot): Map<string, ChangeFacts> {
  const good = new Map<string, ChangeFacts>();
  for (const change of next.changes) {
    if (change.unreadable === null) continue;
    const before = previous.changes.find((candidate) => candidate.dir === change.dir);
    if (before !== undefined && before.unreadable === null) good.set(change.dir, before);
  }
  return good;
}

function createRuntime(
  host: HostRow,
  debounceMs: number,
  notify: (hostId: string, tip: string | null) => void,
): HostRuntime {
  const reader = createGitFileReader(host.root);
  const adapter = adapterFor(host);
  const ref = `refs/heads/${host.baseBranch}`;
  let cache: CacheEntry | null = null;
  /** The last snapshot whose changes are all as the adapter reported them. */
  let lastActual: ChangeSnapshot | null = null;
  const inflight = new Map<string, Promise<CacheEntry>>();
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleRetry = () => {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      void (async () => {
        let settledTip: string | null = null;
        try {
          settledTip = await reader.resolve(ref);
          if (settledTip !== null && adapter !== null) {
            const actual = await adapter.snapshot(reader, settledTip);
            // The retry's result is final, readable or not.
            cache = { tip: settledTip, actual, served: actual, retryPending: false };
            lastActual = actual;
          } else if (cache !== null) {
            cache = { ...cache, served: cache.actual, retryPending: false };
          }
        } catch {
          if (cache !== null) cache = { ...cache, served: cache.actual, retryPending: false };
        }
        notify(host.id, settledTip);
      })();
    }, debounceMs);
    retryTimer.unref?.();
  };

  const load = async (tip: string, current: FrameworkAdapter): Promise<CacheEntry> => {
    const actual = await current.snapshot(reader, tip);
    const keep =
      lastActual === null ? new Map<string, ChangeFacts>() : newlyUnreadable(lastActual, actual);
    let entry: CacheEntry;
    if (keep.size === 0) {
      entry = { tip, actual, served: actual, retryPending: false };
      lastActual = actual;
    } else {
      const served: ChangeSnapshot = {
        ...actual,
        changes: actual.changes.map((change) => keep.get(change.dir) ?? change),
      };
      entry = { tip, actual, served, retryPending: true };
      scheduleRetry();
    }
    return entry;
  };

  const runtime: HostRuntime = {
    host,
    reader,
    adapter,
    tip: () => reader.resolve(ref),
    servedTip: () => cache?.tip ?? null,
    async view() {
      const tip = await reader.resolve(ref);
      if (tip === null || adapter === null) return { tip, snapshot: null, retryPending: false };
      if (cache !== null && cache.tip === tip) {
        return { tip, snapshot: cache.served, retryPending: cache.retryPending };
      }
      let pending = inflight.get(tip);
      if (pending === undefined) {
        pending = load(tip, adapter).finally(() => inflight.delete(tip));
        inflight.set(tip, pending);
      }
      const entry = await pending;
      // A newer tip may have been cached meanwhile; only move forward to this one if not.
      if (cache === null || cache.tip !== tip) cache = entry;
      return { tip, snapshot: cache.served, retryPending: cache.retryPending };
    },
  };
  return runtime;
}

export function createHostRuntimes(options: HostRuntimesOptions): HostRuntimes {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const runtimes = new Map<string, HostRuntime>();
  const listeners = new Set<SettledListener>();
  const notify = (hostId: string, tip: string | null) => {
    for (const listener of listeners) {
      try {
        listener(hostId, tip);
      } catch {
        // a listener failure never stops the others
      }
    }
  };

  const ensure = (row: HostRow): HostRuntime => {
    const existing = runtimes.get(row.id);
    if (existing !== undefined && sameHost(existing.host, row)) return existing;
    const runtime = createRuntime(row, debounceMs, notify);
    runtimes.set(row.id, runtime);
    return runtime;
  };

  return {
    get(hostId) {
      const row = getHost(options.store, hostId);
      if (row === undefined) {
        runtimes.delete(hostId);
        return null;
      }
      return ensure(row);
    },
    list() {
      return listHosts(options.store).map(ensure);
    },
    onSettled(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

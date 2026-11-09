// The base-tip watcher (D-03). Planning truth is committed content on the base branch, so the
// watcher polls each registered host's `refs/heads/{base}` (RESEARCH Item 5 chose polling over
// filesystem events: the source is a ref, not a working tree). When the tip moves it refreshes the
// host's snapshot and publishes a `phase` event `{ hostId, tip }`; open consoles refetch. A
// debounced re-read that settles publishes `{ hostId, tip, settled: true }`.
//
// Errors are logged and never thrown: one unreadable host must not stop the others.
import type { Store } from '../core/store/db.ts';
import { type EventBus, publishEvent } from '../core/store/events.ts';
import type { HostRuntimes } from './hosts.ts';

export const DEFAULT_WATCH_INTERVAL_MS = 2_000;

export interface WatcherOptions {
  runtimes: HostRuntimes;
  db: Store;
  bus: EventBus;
  intervalMs?: number;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export interface Watcher {
  stop(): void;
  /** One polling pass over every host (exposed for tests). */
  tick(): Promise<void>;
}

export function startWatcher(options: WatcherOptions): Watcher {
  const { runtimes, db, bus } = options;
  const intervalMs = options.intervalMs ?? DEFAULT_WATCH_INTERVAL_MS;
  const log = options.log ?? (() => {});
  const lastTips = new Map<string, string | null>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const publish = (hostId: string, payload: Record<string, unknown>) => {
    if (stopped) return;
    try {
      publishEvent(db, bus, { hostId, family: 'phase', payload });
    } catch (error) {
      log('watch-publish-failed', { hostId, message: (error as Error).message });
    }
  };

  const unsubscribe = runtimes.onSettled((hostId, tip) => {
    publish(hostId, { tip, settled: true });
  });

  const tick = async () => {
    let hosts: ReturnType<HostRuntimes['list']>;
    try {
      hosts = runtimes.list();
    } catch (error) {
      log('watch-list-failed', { message: (error as Error).message });
      return;
    }
    for (const runtime of hosts) {
      const { id, baseBranch } = runtime.host;
      try {
        // The ref is `refs/heads/{base}`; the runtime resolves it through the git reader.
        const tip = await runtime.tip();
        const known = lastTips.has(id);
        const previous = lastTips.get(id);
        lastTips.set(id, tip);
        if (!known || previous === tip) continue;
        // Refresh before announcing, so the refetch the event triggers hits a warm cache.
        await runtime.view().catch((error: unknown) => {
          log('watch-snapshot-failed', { hostId: id, message: (error as Error).message });
        });
        publish(id, { tip });
      } catch (error) {
        log('watch-tip-failed', {
          hostId: id,
          ref: `refs/heads/${baseBranch}`,
          message: (error as Error).message,
        });
      }
    }
  };

  const loop = async () => {
    if (stopped) return;
    await tick();
    if (stopped) return;
    timer = setTimeout(() => void loop(), intervalMs);
    timer.unref?.();
  };
  void loop();

  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      unsubscribe();
    },
    tick,
  };
}

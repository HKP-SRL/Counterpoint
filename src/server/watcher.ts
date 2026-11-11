// The base-tip watcher (host-planning: Live refresh from the base branch). Planning truth is
// committed content on the base branch, so the watcher polls each registered host's
// `refs/heads/{base}` (polling, not filesystem events: the source is a ref, not a working tree).
// When the tip moves it refreshes the host's snapshot and publishes a `planning` event
// `{ hostId, tip }`; open consoles refetch. A debounced re-read that settles publishes
// `{ hostId, tip, settled: true }`.
//
// Approvals and the runway (runway: Runway recomputed from git): on every pass it also recomputes
// the runway with `computeRunway` (through the approval views: cached per tip and trusted key, so
// an unchanged tip costs one ref read). It publishes `approval` `{ hostId, tip }` when any
// approval's state changed and `runway` `{ hostId, count }` when the count changed. The first look
// at a host only records a baseline. `nudge(hostId)` runs the same check at once (an approval just
// landed). It then derives the Needs You items and publishes `needs-you` `{ hostId, count }` when
// they changed (needs-you: One inbox). Checks of one host never overlap.
//
// Errors are logged and never thrown: one unreadable host must not stop the others.
import type { Store } from '../core/store/db.ts';
import { type EventBus, type EventFamily, publishEvent } from '../core/store/events.ts';
import type { ApprovalViews } from './approval-views.ts';
import type { HostRuntime, HostRuntimes } from './hosts.ts';

export const DEFAULT_WATCH_INTERVAL_MS = 2_000;

export interface WatcherOptions {
  runtimes: HostRuntimes;
  db: Store;
  bus: EventBus;
  intervalMs?: number;
  /** Approval views; without them the watcher publishes only `planning` events. */
  approvals?: ApprovalViews;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export interface Watcher {
  stop(): void;
  /** One polling pass over every host (exposed for tests). */
  tick(): Promise<void>;
  /** Checks one host now (tip, approvals, runway). Resolves when the check is done. */
  nudge(hostId: string): Promise<void>;
}

interface RunwaySeen {
  /** Every approval's state, in a stable order. */
  signature: string;
  count: number;
}

export function startWatcher(options: WatcherOptions): Watcher {
  const { runtimes, db, bus, approvals } = options;
  const intervalMs = options.intervalMs ?? DEFAULT_WATCH_INTERVAL_MS;
  const log = options.log ?? (() => {});
  const lastTips = new Map<string, string | null>();
  const lastRunway = new Map<string, RunwaySeen>();
  const lastNeedsYou = new Map<string, string>();
  const running = new Map<string, Promise<void>>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const publish = (hostId: string, family: EventFamily, payload: Record<string, unknown>) => {
    if (stopped) return;
    try {
      publishEvent(db, bus, { hostId, family, payload });
    } catch (error) {
      log('watch-publish-failed', { hostId, family, message: (error as Error).message });
    }
  };

  const unsubscribe = runtimes.onSettled((hostId, tip) => {
    publish(hostId, 'planning', { tip, settled: true });
  });

  const checkTip = async (runtime: HostRuntime): Promise<string | null> => {
    const { id } = runtime.host;
    // The ref is `refs/heads/{base}`; the runtime resolves it through the git reader.
    const tip = await runtime.tip();
    // On the first look at a host, the baseline is what the console was last served: the base
    // branch may have moved between a page load and this host's first poll.
    const previous = lastTips.has(id) ? lastTips.get(id) : runtime.servedTip();
    lastTips.set(id, tip);
    if (previous === undefined || previous === null || previous === tip) return tip;
    // Refresh before announcing, so the refetch the event triggers hits a warm cache.
    await runtime.view().catch((error: unknown) => {
      log('watch-snapshot-failed', { hostId: id, message: (error as Error).message });
    });
    publish(id, 'planning', { tip });
    return tip;
  };

  const checkRunway = async (runtime: HostRuntime, tip: string | null): Promise<void> => {
    if (approvals === undefined) return;
    const { id } = runtime.host;
    const runway = await approvals.runway(runtime);
    const signature = JSON.stringify([
      runway.onRunway.map((e) => [e.changeId, 'on-runway', e.commit, e.title, e.taskCount]),
      runway.changed.map((e) => [e.changeId, 'changed', e.commit, e.title, e.taskCount]),
      runway.invalid.map((e) => [e.changeId, 'invalid', e.reason]),
    ]);
    const seen = lastRunway.get(id);
    lastRunway.set(id, { signature, count: runway.count });
    if (seen === undefined) return;
    if (seen.signature !== signature)
      publish(id, 'approval', { hostId: id, tip: runway.tip ?? tip });
    if (seen.count !== runway.count) publish(id, 'runway', { hostId: id, count: runway.count });
  };

  // Needs You (needs-you: One inbox): the items derived from the changed approvals. A `needs-you`
  // event goes out when the set of items (or what an item lists as changed) differs from the last
  // look.
  const checkNeedsYou = async (runtime: HostRuntime): Promise<void> => {
    if (approvals === undefined) return;
    const { id } = runtime.host;
    const { items, changed } = await approvals.needsYou(runtime);
    const signature = JSON.stringify([
      items.map((item) => [item.id, item.changedCount, item.gatesChanged, item.unreadable]),
      changed.map((c) => [
        c.changeId,
        c.commit,
        c.changes.map((change) => [change.path, change.change, change.nowDigest]),
        c.gatesChange === null ? null : [c.gatesChange.change, c.gatesChange.nowDigest],
      ]),
    ]);
    const seen = lastNeedsYou.get(id);
    lastNeedsYou.set(id, signature);
    if (seen === undefined || seen === signature) return;
    publish(id, 'needs-you', { hostId: id, count: items.length });
  };

  const checkHost = async (runtime: HostRuntime): Promise<void> => {
    const { id, baseBranch } = runtime.host;
    let tip: string | null;
    try {
      tip = await checkTip(runtime);
    } catch (error) {
      log('watch-tip-failed', {
        hostId: id,
        ref: `refs/heads/${baseBranch}`,
        message: (error as Error).message,
      });
      return;
    }
    try {
      await checkRunway(runtime, tip);
    } catch (error) {
      log('watch-runway-failed', { hostId: id, message: (error as Error).message });
    }
    try {
      await checkNeedsYou(runtime);
    } catch (error) {
      log('watch-needs-you-failed', { hostId: id, message: (error as Error).message });
    }
  };

  /** Runs a check of one host after any check of it already in flight. */
  const serialized = (runtime: HostRuntime): Promise<void> => {
    const { id } = runtime.host;
    const previous = running.get(id) ?? Promise.resolve();
    const next = previous.then(() => (stopped ? undefined : checkHost(runtime)));
    running.set(id, next);
    void next.finally(() => {
      if (running.get(id) === next) running.delete(id);
    });
    return next;
  };

  const tick = async () => {
    let hosts: HostRuntime[];
    try {
      hosts = runtimes.list();
    } catch (error) {
      log('watch-list-failed', { message: (error as Error).message });
      return;
    }
    for (const runtime of hosts) await serialized(runtime);
  };

  const nudge = async (hostId: string) => {
    let runtime: HostRuntime | null;
    try {
      runtime = runtimes.get(hostId);
    } catch (error) {
      log('watch-nudge-failed', { hostId, message: (error as Error).message });
      return;
    }
    if (runtime !== null) await serialized(runtime);
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
    nudge,
  };
}

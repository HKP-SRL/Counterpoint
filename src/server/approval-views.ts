// Approval views for the console: each approval's state and the runway, recomputed from git at
// the host's base tip (runway: Runway recomputed from git; derive, don't store).
//
// The only memory here is an in-process cache keyed by `{hostId}:{tip}:{itemId}:{trusted
// fingerprint}` (and `{hostId}:{tip}:runway:{fingerprint}` for the runway,
// `{hostId}:{tip}:needs-you:{fingerprint}` for the Needs You items). It never decides authority:
// every entry is the output of `approvalState` / `computeRunway` (signature verified against the
// trusted key, statement parsed strictly, every digest recomputed at that tip), a key changes
// whenever the tip or the trusted key changes, and the cache starts empty with the daemon (so a
// forged or stale entry can never outlive a restart). A result is cached only if the base tip did
// not move while it was computed, and never when it holds a transient `error` verdict (runway:
// Transient errors do not pin the runway; WR-07): the next read verifies again.
import { mkdirSync } from 'node:fs';
import { APPROVALS_DIR } from '../core/approvals/statement.ts';
import { readTrust, type Trust } from '../core/approvals/trust-store.ts';
import { homePaths } from '../core/host/home.ts';
import { approvalItemId, isChangeId } from '../core/ids.ts';
import {
  type ChangedApproval,
  deriveNeedsYou,
  type NeedsYouItem,
} from '../core/runway/needs-you.ts';
import {
  type ApprovalState,
  approvalState,
  computeRunway,
  type Runway,
  type RunwayOptions,
} from '../core/runway/runway.ts';
import type { HostRuntime } from './hosts.ts';

const MAX_ENTRIES = 1_000;
const APPROVAL_FILE_RE = /^(.+)\.json$/;

export interface ApprovalViews {
  /** The trusted key now, or null when none is trusted (or it cannot be used). */
  trust(): Trust | null;
  /** The state of every approval file present at `tip`, by change id. */
  states(runtime: HostRuntime, tip: string): Promise<Map<string, ApprovalState>>;
  /** The state of one change's approval at the current base tip. */
  state(runtime: HostRuntime, changeId: string): Promise<ApprovalState>;
  /** The runway at the current base tip. */
  runway(runtime: HostRuntime): Promise<Runway>;
  /** The Needs You items at the current base tip. */
  needsYou(runtime: HostRuntime): Promise<NeedsYouSnapshot>;
}

export interface NeedsYouSnapshot {
  tip: string | null;
  items: NeedsYouItem[];
  changed: ChangedApproval[];
}

/** False when any approval in the runway failed for a transient reason (`error`). */
function hasNoTransientError(runway: Runway): boolean {
  return runway.invalid.every((entry) => entry.reason !== 'error');
}

function emptyRunway(tip: string | null): Runway {
  return { tip, count: 0, taskCount: 0, onRunway: [], changed: [], invalid: [] };
}

export function createApprovalViews(options: { home: string }): ApprovalViews {
  const { home } = options;
  const cache = new Map<string, Promise<unknown>>();
  let tmpDir: string | null = null;

  const scratch = (): string => {
    if (tmpDir === null) {
      const dir = homePaths(home).tmpDir;
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      tmpDir = dir;
    }
    return tmpDir;
  };

  const trust = (): Trust | null => {
    const result = readTrust(home);
    if (!result.ok) return null;
    const { ok: _ok, ...rest } = result;
    return rest;
  };

  /**
   * Computes `compute()` once per key. The entry is dropped on failure, when `keep` rejects the
   * result, and when the base tip moved during the computation (the result may then describe a
   * newer tip than the key).
   */
  const cached = <T>(
    key: string,
    runtime: HostRuntime,
    tip: string,
    compute: () => Promise<T>,
    keep: (value: T) => boolean = () => true,
  ): Promise<T> => {
    const hit = cache.get(key);
    if (hit !== undefined) return hit as Promise<T>;
    const pending = (async () => {
      const value = await compute();
      const after = await runtime.tip();
      if (after !== tip || !keep(value)) cache.delete(key);
      return value;
    })();
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
    while (cache.size > MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return pending;
  };

  const runwayOptions = (runtime: HostRuntime, key: Trust | null): RunwayOptions | null => {
    if (runtime.adapter === null) return null;
    return {
      hostId: runtime.host.id,
      root: runtime.host.root,
      baseBranch: runtime.host.baseBranch,
      reader: runtime.reader,
      adapter: runtime.adapter,
      trust: key,
      tmpDir: scratch(),
    };
  };

  const stateAt = (
    runtime: HostRuntime,
    tip: string,
    changeId: string,
    key: Trust | null,
  ): Promise<ApprovalState> => {
    const opts = runwayOptions(runtime, key);
    if (opts === null) return Promise.resolve({ state: 'none', tip });
    const cacheKey = `${runtime.host.id}:${tip}:${approvalItemId(changeId)}:${key?.fingerprint ?? 'none'}`;
    // An unexpected error is reported as invalid (fail closed) but not remembered: the next read
    // tries again instead of pinning a transient failure to this tip.
    return cached(
      cacheKey,
      runtime,
      tip,
      () => approvalState({ ...opts, changeId }),
      (state) => !(state.state === 'invalid' && state.reason === 'error'),
    );
  };

  const views: ApprovalViews = {
    trust,

    async states(runtime, tip) {
      const key = trust();
      const entries = await runtime.reader.list(tip, APPROVALS_DIR);
      const changeIds = entries
        .filter((entry) => entry.type === 'blob')
        .map((entry) => APPROVAL_FILE_RE.exec(entry.name)?.[1])
        .filter((id): id is string => id !== undefined && isChangeId(id));
      const result = new Map<string, ApprovalState>();
      for (const changeId of changeIds) {
        result.set(changeId, await stateAt(runtime, tip, changeId, key));
      }
      return result;
    },

    async state(runtime, changeId) {
      const tip = await runtime.tip();
      if (tip === null) return { state: 'none', tip: null };
      return stateAt(runtime, tip, changeId, trust());
    },

    async runway(runtime) {
      const tip = await runtime.tip();
      if (tip === null) return emptyRunway(null);
      const key = trust();
      const opts = runwayOptions(runtime, key);
      if (opts === null) return emptyRunway(tip);
      const cacheKey = `${runtime.host.id}:${tip}:runway:${key?.fingerprint ?? 'none'}`;
      // A runway holding a transient `error` verdict is served but not remembered (WR-07).
      return cached(cacheKey, runtime, tip, () => computeRunway(opts), hasNoTransientError);
    },

    async needsYou(runtime) {
      const tip = await runtime.tip();
      if (tip === null || runtime.adapter === null) return { tip, items: [], changed: [] };
      const { adapter } = runtime;
      const key = trust();
      const cacheKey = `${runtime.host.id}:${tip}:needs-you:${key?.fingerprint ?? 'none'}`;
      // Built from the runway: not remembered when that runway held a transient `error` (WR-07).
      let transient = false;
      return cached(
        cacheKey,
        runtime,
        tip,
        async (): Promise<NeedsYouSnapshot> => {
          const runway = await views.runway(runtime);
          transient = !hasNoTransientError(runway);
          // A tip that moved in between is caught by `cached`, which then drops this entry.
          if (runway.tip === null) return { tip: null, items: [], changed: [] };
          const view = await runtime.view().catch(() => null);
          const changes = view?.tip === runway.tip ? view.snapshot?.changes : undefined;
          const items = await deriveNeedsYou({
            root: runtime.host.root,
            baseBranch: runtime.host.baseBranch,
            tip: runway.tip,
            changed: runway.changed,
            reader: runtime.reader,
            adapter,
            ...(changes === undefined ? {} : { changes }),
          });
          return { tip: runway.tip, items, changed: runway.changed };
        },
        () => !transient,
      );
    },
  };
  return views;
}

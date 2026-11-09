// Approval views for the console: each approval's state and the runway, recomputed from git at
// the host's base tip (RESEARCH Pattern 1, "derive, don't store").
//
// The only memory here is an in-process cache keyed by `{hostId}:{tip}:{itemId}:{trusted
// fingerprint}` (and `{hostId}:{tip}:runway:{fingerprint}` for the runway). It never decides
// authority: every entry is the output of `approvalState` / `computeRunway` (signature verified
// against the trusted key, statement parsed strictly, every digest recomputed at that tip), a key
// changes whenever the tip or the trusted key changes, and the cache starts empty with the daemon
// (T-01-48). A result is cached only if the base tip did not move while it was computed.
import { mkdirSync } from 'node:fs';
import { APPROVALS_DIR } from '../core/approvals/statement.ts';
import { readTrust, type Trust } from '../core/approvals/trust-store.ts';
import { homePaths } from '../core/host/home.ts';
import { approvalItemId, isPhaseId } from '../core/ids.ts';
import {
  type ApprovalState,
  approvalState,
  computeRunway,
  type Runway,
  type RunwayOptions,
} from '../core/runway/runway.ts';
import type { HostRuntime } from './hosts.ts';

const MAX_ENTRIES = 1_000;
const APPROVAL_FILE_RE = /^phase-(.+)\.json$/;

export interface ApprovalViews {
  /** The trusted key now, or null when none is trusted (or it cannot be used). */
  trust(): Trust | null;
  /** The state of every approval file present at `tip`, by phase id. */
  states(runtime: HostRuntime, tip: string): Promise<Map<string, ApprovalState>>;
  /** The state of one phase's approval at the current base tip. */
  state(runtime: HostRuntime, phaseId: string): Promise<ApprovalState>;
  /** The runway at the current base tip. */
  runway(runtime: HostRuntime): Promise<Runway>;
}

function emptyRunway(tip: string | null): Runway {
  return { tip, count: 0, planCount: 0, onRunway: [], changed: [], invalid: [] };
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
    phaseId: string,
    key: Trust | null,
  ): Promise<ApprovalState> => {
    const opts = runwayOptions(runtime, key);
    if (opts === null) return Promise.resolve({ state: 'none', tip });
    const cacheKey = `${runtime.host.id}:${tip}:${approvalItemId(phaseId)}:${key?.fingerprint ?? 'none'}`;
    // An unexpected error is reported as invalid (fail closed) but not remembered: the next read
    // tries again instead of pinning a transient failure to this tip.
    return cached(
      cacheKey,
      runtime,
      tip,
      () => approvalState({ ...opts, phaseId }),
      (state) => !(state.state === 'invalid' && state.reason === 'error'),
    );
  };

  return {
    trust,

    async states(runtime, tip) {
      const key = trust();
      const entries = await runtime.reader.list(tip, APPROVALS_DIR);
      const phaseIds = entries
        .filter((entry) => entry.type === 'blob')
        .map((entry) => APPROVAL_FILE_RE.exec(entry.name)?.[1])
        .filter((id): id is string => id !== undefined && isPhaseId(id));
      const result = new Map<string, ApprovalState>();
      for (const phaseId of phaseIds) {
        result.set(phaseId, await stateAt(runtime, tip, phaseId, key));
      }
      return result;
    },

    async state(runtime, phaseId) {
      const tip = await runtime.tip();
      if (tip === null) return { state: 'none', tip: null };
      return stateAt(runtime, tip, phaseId, trust());
    },

    async runway(runtime) {
      const tip = await runtime.tip();
      if (tip === null) return emptyRunway(null);
      const key = trust();
      const opts = runwayOptions(runtime, key);
      if (opts === null) return emptyRunway(tip);
      const cacheKey = `${runtime.host.id}:${tip}:runway:${key?.fingerprint ?? 'none'}`;
      return cached(cacheKey, runtime, tip, () => computeRunway(opts));
    },
  };
}

// Per-host runtimes (stub; implemented in the GREEN step).
import type { Store } from '../core/store/db.ts';

export interface HostRuntimes {
  readonly stub: true;
}

export function createHostRuntimes(_options: { store: Store; debounceMs?: number }): HostRuntimes {
  return { stub: true };
}

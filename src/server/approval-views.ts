// RED stub (01-13 Task 1): replaced in the GREEN commit.
import type { ApprovalState, Runway } from '../core/runway/runway.ts';
import type { HostRuntime } from './hosts.ts';

export interface ApprovalViews {
  states(runtime: HostRuntime, tip: string): Promise<Map<string, ApprovalState>>;
  runway(runtime: HostRuntime): Promise<Runway>;
}

export function createApprovalViews(_options: { home: string }): ApprovalViews {
  return {
    states: async () => new Map(),
    runway: async () => ({
      tip: null,
      count: 0,
      planCount: 0,
      onRunway: [],
      changed: [],
      invalid: [],
    }),
  };
}

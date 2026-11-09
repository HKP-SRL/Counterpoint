// The runway snapshot (GET /api/hosts/{id}/runway, MISN-01), shared by the Mission page and the
// approval dialog. The server recomputes it from git at the base tip; the console only shows it.
// `runway` and `approval` events invalidate it (live.ts FAMILY_TO_KEYS).
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { apiGet, queryKeys } from './api';

export type RunwayItem = {
  phaseId: string;
  name: string;
  planCount: number;
  signedAt: string;
  unreadable: boolean;
};

export type RunwaySnapshot = {
  hostId: string;
  tip: string | null;
  count: number;
  planCount: number;
  changedCount: number;
  items: RunwayItem[];
};

const PHASE_ID_RE = /^\d{2}(\.\d+)?$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

function parseItem(value: unknown): RunwayItem | null {
  if (!isRecord(value) || typeof value.phaseId !== 'string') return null;
  if (!PHASE_ID_RE.test(value.phaseId) || typeof value.signedAt !== 'string') return null;
  return {
    phaseId: value.phaseId,
    name: typeof value.name === 'string' ? value.name : '',
    planCount: count(value.planCount),
    signedAt: value.signedAt,
    unreadable: value.unreadable === true,
  };
}

async function fetchRunway(hostId: string, signal?: AbortSignal): Promise<RunwaySnapshot> {
  const body = await apiGet(`/api/hosts/${encodeURIComponent(hostId)}/runway`, signal);
  const raw = isRecord(body) ? body : {};
  return {
    hostId,
    tip: typeof raw.tip === 'string' ? raw.tip : null,
    count: count(raw.count),
    planCount: count(raw.planCount),
    changedCount: count(raw.changedCount),
    items: Array.isArray(raw.items)
      ? raw.items.map(parseItem).filter((item): item is RunwayItem => item !== null)
      : [],
  };
}

export const runwayQuery = (hostId: string) =>
  queryOptions({
    queryKey: queryKeys.runway(hostId),
    queryFn: ({ signal }) => fetchRunway(hostId, signal),
    placeholderData: keepPreviousData,
  });

export function phasesText(n: number): string {
  return n === 1 ? '1 phase' : `${n} phases`;
}

export function plansCountText(n: number): string {
  return n === 1 ? '1 plan' : `${n} plans`;
}

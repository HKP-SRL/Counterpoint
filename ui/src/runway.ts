// The runway snapshot (GET /api/hosts/{id}/runway, runway: Runway is the Mission headline): the
// changes the owner approved that are readable and not built, in build order. The server derives
// it; the console only shows it.
// `runway` and `approval` events invalidate it (live.ts FAMILY_TO_KEYS).
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { apiGet, queryKeys } from './api';
import { isChangeId } from './ids';

export type RunwayItem = {
  changeId: string;
  title: string;
  taskCount: number;
  /** Epoch ms. */
  approvedAt: number;
  /** Its design drafts hold it until every screen is signed off (design-drafts D-12). */
  waitingForSignOff: boolean;
};

export type RunwaySnapshot = {
  hostId: string;
  tip: string | null;
  count: number;
  taskCount: number;
  items: RunwayItem[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

function parseItem(value: unknown): RunwayItem | null {
  if (!isRecord(value) || !isChangeId(value.changeId)) return null;
  return {
    changeId: value.changeId,
    title: typeof value.title === 'string' && value.title !== '' ? value.title : value.changeId,
    taskCount: count(value.taskCount),
    approvedAt: count(value.approvedAt),
    waitingForSignOff: value.waitingForSignOff === true,
  };
}

async function fetchRunway(hostId: string, signal?: AbortSignal): Promise<RunwaySnapshot> {
  const body = await apiGet(`/api/hosts/${encodeURIComponent(hostId)}/runway`, signal);
  const raw = isRecord(body) ? body : {};
  return {
    hostId,
    tip: typeof raw.tip === 'string' ? raw.tip : null,
    count: count(raw.count),
    taskCount: count(raw.taskCount),
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

export function changesText(n: number): string {
  return n === 1 ? '1 change' : `${n} changes`;
}

export function tasksCountText(n: number): string {
  return n === 1 ? '1 task' : `${n} tasks`;
}

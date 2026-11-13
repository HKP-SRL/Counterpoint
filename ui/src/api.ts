// The console's HTTP client. The session lives in an HttpOnly cookie the server set during the
// one-time sign-in exchange; the SPA never sees the sign-in code or the session value, and never
// stores or logs either. Any 401 sends the browser to the signed-out screen, any 403 to the
// "Request blocked" screen (local-console: Session required for the API; Origin and content
// checks on writes).
import { queryOptions } from '@tanstack/react-query';

export type SignedOutReason = 'none' | 'used' | 'blocked';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`The console API answered ${status}.`);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** True for answers that will not change on retry (signed out, blocked, missing). */
export function isFinalApiError(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

/** Leaves the console for the signed-out screen. `replace`, so Back does not loop into a 401. */
export function goSignedOut(reason: SignedOutReason): void {
  if (window.location.pathname === '/signed-out') return;
  window.location.replace(`/signed-out?reason=${reason}`);
}

async function readResponse(res: Response): Promise<unknown> {
  if (res.status === 401) {
    goSignedOut('none');
    throw new ApiError(401);
  }
  if (res.status === 403) {
    goSignedOut('blocked');
    throw new ApiError(403);
  }
  if (!res.ok) throw new ApiError(res.status);
  return res.json();
}

export async function apiGet(path: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(path, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  });
  return readResponse(res);
}

/** Every write is JSON: the server's request guard answers 415 to anything else. */
export async function apiPost(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    ...(signal === undefined ? {} : { signal }),
  });
  return readResponse(res);
}

/**
 * A write whose refusal the page shows in its own words: 2xx and 4xx answers (other than 401 and
 * 403) come back with the server's JSON body instead of throwing.
 */
export async function apiPostAnswer(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (res.status === 401 || res.status === 403 || res.status >= 500) {
    await readResponse(res);
  }
  let parsed: unknown = {};
  try {
    parsed = await res.json();
  } catch {
    parsed = {};
  }
  const record =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  return { ok: res.ok, status: res.status, body: record };
}

/**
 * Query keys. Host-scoped data sits under `['host', hostId, …]`, apart from the host list, so
 * invalidating one family never sweeps up another. `change(hostId)` without a change id is the
 * prefix of every change detail of that host.
 */
export const queryKeys = {
  hosts: ['hosts'] as const,
  changes: (hostId: string) => ['host', hostId, 'changes'] as const,
  change: (hostId: string, changeId?: string) =>
    changeId === undefined
      ? (['host', hostId, 'change'] as const)
      : (['host', hostId, 'change', changeId] as const),
  runway: (hostId: string) => ['host', hostId, 'runway'] as const,
  needsYou: (hostId: string) => ['host', hostId, 'needs-you'] as const,
  /** What waits across every project: refetched by every event that can change an inbox. */
  needsYouCounts: ['needs-you-counts'] as const,
  run: (hostId: string) => ['host', hostId, 'run'] as const,
  budget: (hostId: string, model: string, percent: number) =>
    ['host', hostId, 'run', 'budget', model, percent] as const,
  settings: (hostId: string) => ['host', hostId, 'settings'] as const,
  /** Under the run key, so every `run` event refetches it. */
  runReport: (hostId: string, runId: string) => ['host', hostId, 'run', 'report', runId] as const,
  /** Under the run key, so every `run` event refetches it. */
  preview: (hostId: string, changeId: string) =>
    ['host', hostId, 'run', 'preview', changeId] as const,
  /** A change's design drafts; without a change, the prefix of every change's. */
  drafts: (hostId: string, changeId?: string) =>
    changeId === undefined
      ? (['host', hostId, 'drafts'] as const)
      : (['host', hostId, 'drafts', changeId] as const),
};

export interface HostSummary {
  id: string;
  name: string;
  root: string;
  baseBranch: string;
}

function isHostSummary(value: unknown): value is HostSummary {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.root === 'string' &&
    typeof v.baseBranch === 'string'
  );
}

export async function fetchHosts(signal?: AbortSignal): Promise<HostSummary[]> {
  const body = (await apiGet('/api/hosts', signal)) as { hosts?: unknown };
  return Array.isArray(body.hosts) ? body.hosts.filter(isHostSummary) : [];
}

export const hostsQuery = queryOptions({
  queryKey: queryKeys.hosts,
  queryFn: ({ signal }) => fetchHosts(signal),
});

/** What waits on the owner across every project (GET /api/needs-you/counts). */
export interface NeedsYouCounts {
  /** Everything waiting, in every project; the machine's cards once. */
  total: number;
  /** The machine's open cards, shown in every project's inbox. */
  machine: number;
  /** Each project's own waiting items (open cards and blocked planning writes). */
  hosts: { hostId: string; count: number }[];
  /** Open cards that block work, for browser notifications. */
  blocking: { id: string; hostId: string | null; question: string }[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const countOf = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

export function parseNeedsYouCounts(body: unknown): NeedsYouCounts {
  const raw = isObject(body) ? body : {};
  const hosts = Array.isArray(raw.hosts) ? raw.hosts.filter(isObject) : [];
  const blocking = Array.isArray(raw.blocking) ? raw.blocking.filter(isObject) : [];
  return {
    total: countOf(raw.total),
    machine: countOf(raw.machine),
    hosts: hosts
      .filter((h) => typeof h.hostId === 'string')
      .map((h) => ({ hostId: String(h.hostId), count: countOf(h.count) })),
    blocking: blocking
      .filter((b) => typeof b.id === 'string' && typeof b.question === 'string')
      .map((b) => ({
        id: String(b.id),
        hostId: typeof b.hostId === 'string' ? b.hostId : null,
        question: String(b.question),
      })),
  };
}

export const needsYouCountsQuery = queryOptions({
  queryKey: queryKeys.needsYouCounts,
  queryFn: async ({ signal }) => parseNeedsYouCounts(await apiGet('/api/needs-you/counts', signal)),
});

/** A project, other than the one open, with items waiting: for the switcher and empty inbox. */
export interface WaitingElsewhere {
  id: string;
  name: string;
  count: number;
}

/** The other projects with items waiting, most first. */
export function waitingElsewhere(
  counts: NeedsYouCounts | undefined,
  hosts: readonly HostSummary[],
  hostId: string,
): WaitingElsewhere[] {
  if (counts === undefined) return [];
  return counts.hosts
    .filter((entry) => entry.hostId !== hostId && entry.count > 0)
    .flatMap((entry) => {
      const host = hosts.find((h) => h.id === entry.hostId);
      return host === undefined ? [] : [{ id: host.id, name: host.name, count: entry.count }];
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

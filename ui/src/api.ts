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
  doctor: (hostId: string) => ['host', hostId, 'doctor'] as const,
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

// The build lane in the console: the host's run (current or last), the runway changes a run can
// pick, the budget as tokens, and the doctor probe running now. Everything is read from the daemon;
// `run` and `doctor` events refetch it (live.ts).
import { queryOptions } from '@tanstack/react-query';
import { apiGet, apiPostAnswer, queryKeys } from './api';

export type RunChangeState = 'queued' | 'building' | 'green' | 'parked' | 'skipped' | 'stopped';

export interface RunChangeView {
  change: string;
  state: RunChangeState;
  reason: string | null;
  attempts: number;
  branch: string | null;
  prUrl: string | null;
  previewUrl: string | null;
}

export interface RunActivity {
  change: string | null;
  phase:
    | 'doctor'
    | 'calibrating'
    | 'preparing'
    | 'session'
    | 'gates'
    | 'delivering'
    | 'waiting'
    | 'stopping';
  session?: number;
  attempt?: number;
  gate?: string;
  tokens?: number;
  detail?: string;
}

export interface RunView {
  id: string;
  hostId: string;
  state: 'running' | 'stopping' | 'ended';
  settings: { model: string; budgetPercent: number; changes: string[] | null };
  stopAt: number | null;
  startedAt: number;
  endedAt: number | null;
  endReason: 'finished' | 'stopped' | 'stop-time' | 'error' | 'refused' | null;
  endDetail: string | null;
  budgetLabel: string | null;
  changes: RunChangeView[];
  now: RunActivity | null;
  hold: { until: number; reason: string } | null;
}

export interface RunwayPick {
  changeId: string;
  title: string | null;
  taskCount: number;
}

export interface DoctorStatus {
  hostId: string;
  phase: 'waiting' | 'tools' | 'signing-key' | 'integrity' | 'probe' | 'report';
  startedAt: number;
  source: 'console' | 'run';
}

export interface RunAnswer {
  hostId: string;
  run: RunView | null;
  runway: RunwayPick[];
  claudeVersion: string | null;
  doctor: DoctorStatus | null;
}

async function fetchRun(hostId: string, signal?: AbortSignal): Promise<RunAnswer> {
  const body = (await apiGet(
    `/api/hosts/${encodeURIComponent(hostId)}/run`,
    signal,
  )) as Partial<RunAnswer>;
  return {
    hostId,
    run: body.run ?? null,
    runway: Array.isArray(body.runway) ? body.runway : [],
    claudeVersion: typeof body.claudeVersion === 'string' ? body.claudeVersion : null,
    doctor: body.doctor ?? null,
  };
}

export const runQuery = (hostId: string) =>
  queryOptions({
    queryKey: queryKeys.run(hostId),
    queryFn: ({ signal }) => fetchRun(hostId, signal),
  });

export const budgetQuery = (hostId: string, model: string, percent: number) =>
  queryOptions({
    queryKey: queryKeys.budget(hostId, model, percent),
    queryFn: async ({ signal }) => {
      const query = new URLSearchParams({ model, percent: String(percent) });
      const body = (await apiGet(
        `/api/hosts/${encodeURIComponent(hostId)}/run/budget?${query.toString()}`,
        signal,
      )) as { window?: unknown; label?: unknown };
      return {
        window: typeof body.window === 'number' ? body.window : null,
        label: typeof body.label === 'string' ? body.label : null,
      };
    },
  });

export const doctorStatusQuery = queryOptions({
  queryKey: queryKeys.doctorStatus,
  queryFn: async ({ signal }) => {
    const body = (await apiGet('/api/doctor/status', signal)) as { doctor?: DoctorStatus | null };
    return body.doctor ?? null;
  },
});

/** `HH:MM` → the next time the clock shows it, as ISO (today, or tomorrow when already past). */
export function nextOccurrence(time: string, now: Date = new Date()): string | null {
  const match = /^(\d{2}):(\d{2})/.exec(time);
  if (match === null) return null;
  const at = new Date(now);
  at.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at.toISOString();
}

export function errorText(body: Record<string, unknown>, fallback: string): string {
  return typeof body.error === 'string' && body.error !== '' ? body.error : fallback;
}

export const startRun = (
  hostId: string,
  settings: {
    changes: string[] | null;
    stopAt: string | null;
    model: string;
    budgetPercent: number;
  },
) => apiPostAnswer(`/api/hosts/${encodeURIComponent(hostId)}/run`, settings);

export const stopRun = (hostId: string) =>
  apiPostAnswer(`/api/hosts/${encodeURIComponent(hostId)}/run/stop`, {});

export const runDoctor = (hostId: string) =>
  apiPostAnswer(`/api/hosts/${encodeURIComponent(hostId)}/doctor/run`, {});

export const withdrawRisk = (riskId: string) =>
  apiPostAnswer(`/api/risks/${encodeURIComponent(riskId)}/withdraw`, {});

export const stopCounterpoint = () => apiPostAnswer('/api/stop', {});

/** Plain words for what the run is doing now. */
export function activityText(now: RunActivity): string {
  const parts: string[] = [];
  switch (now.phase) {
    case 'doctor':
      parts.push('Checking the sandbox again (claude was updated)');
      break;
    case 'calibrating':
      parts.push("Learning the model's context window");
      break;
    case 'preparing':
      parts.push(`Preparing ${now.change ?? 'the next change'}`);
      break;
    case 'session':
      parts.push(`Building ${now.change ?? ''}`.trim());
      if (now.session !== undefined) parts.push(`session ${now.session}`);
      if (now.tokens !== undefined && now.tokens > 0)
        parts.push(`${Math.round(now.tokens / 1000)}k tokens in context`);
      break;
    case 'gates':
      parts.push(`Running gates for ${now.change ?? ''}`.trim());
      if (now.gate !== undefined) parts.push(`gate ${now.gate}`);
      break;
    case 'delivering':
      parts.push(`Opening the pull request for ${now.change ?? ''}`.trim());
      break;
    case 'waiting':
      parts.push(now.detail ?? 'Waiting');
      return parts.join(' · ');
    case 'stopping':
      parts.push('Stopping at the next clean point');
      break;
  }
  if (now.attempt !== undefined && now.attempt > 1) parts.push(`attempt ${now.attempt}`);
  return parts.join(' · ');
}

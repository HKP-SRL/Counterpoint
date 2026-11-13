// The build lane in the console: the host's run (current or last), the runway changes a run can
// pick, and the budget as tokens. Everything is read from the daemon; `run` events refetch it
// (live.ts).
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
  /** The branch edits planning files: its PR is a draft, not offered for merge. */
  notForMerge?: boolean;
  /** How much of the built change is tests, against the budget. */
  testShare?: TestShare | null;
  /** Tests are a larger share than the budget: marked, never failed. */
  overBudget?: boolean;
}

export interface TestShare {
  percent: number;
  testLines: number;
  addedLines: number;
  budget: number;
  editedTests: Array<{ path: string; status: string }>;
}

/** "Tests 44% (budget 30%)": the mark an over-budget change carries on its row. */
export function overBudgetText(share: TestShare): string {
  return `Tests ${share.percent}% (budget ${share.budget}%)`;
}

export interface RunActivity {
  change: string | null;
  phase: 'calibrating' | 'preparing' | 'session' | 'gates' | 'delivering' | 'waiting' | 'stopping';
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
  settings: {
    model: string;
    /** Missing on runs recorded before effort was a setting. */
    effort?: string;
    budgetPercent: number;
    changes: string[] | null;
  };
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

export interface RunAnswer {
  hostId: string;
  run: RunView | null;
  runway: RunwayPick[];
  claudeVersion: string | null;
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

/** A run uses the project's saved settings; starting it only picks the changes and a stop time. */
export const startRun = (
  hostId: string,
  request: { changes: string[] | null; stopAt: string | null },
) => apiPostAnswer(`/api/hosts/${encodeURIComponent(hostId)}/run`, request);

/** A project's run settings (build-runs: Run settings page). */
export interface HostSettings {
  model: string;
  effort: string;
  budgetPercent: number;
  maxTurns: number;
  maxBudgetUsd: number;
  sessionsPerAttempt: number;
}

export interface SettingsAnswer {
  hostId: string;
  settings: HostSettings;
  /** False while the defaults apply (nothing saved yet). */
  saved: boolean;
  defaults: HostSettings;
  effortLevels: string[];
}

function isHostSettings(value: unknown): value is HostSettings {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.model === 'string' &&
    typeof v.effort === 'string' &&
    ['budgetPercent', 'maxTurns', 'maxBudgetUsd', 'sessionsPerAttempt'].every(
      (key) => typeof v[key] === 'number',
    )
  );
}

export const settingsQuery = (hostId: string) =>
  queryOptions({
    queryKey: queryKeys.settings(hostId),
    queryFn: async ({ signal }): Promise<SettingsAnswer> => {
      const body = (await apiGet(
        `/api/hosts/${encodeURIComponent(hostId)}/settings`,
        signal,
      )) as Record<string, unknown>;
      if (!isHostSettings(body.settings) || !isHostSettings(body.defaults)) {
        throw new Error('The settings answer is not valid.');
      }
      return {
        hostId,
        settings: body.settings,
        saved: body.saved === true,
        defaults: body.defaults,
        effortLevels: Array.isArray(body.effortLevels)
          ? body.effortLevels.filter((level): level is string => typeof level === 'string')
          : [],
      };
    },
  });

export const saveSettings = (hostId: string, settings: HostSettings) =>
  apiPostAnswer(`/api/hosts/${encodeURIComponent(hostId)}/settings`, settings);

const EFFORT_WORDS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

/** `xhigh` → `Extra high`; unknown levels as given. */
export function effortLabel(level: string): string {
  return EFFORT_WORDS[level] ?? level;
}

export const stopRun = (hostId: string) =>
  apiPostAnswer(`/api/hosts/${encodeURIComponent(hostId)}/run/stop`, {});

export const stopCounterpoint = () => apiPostAnswer('/api/stop', {});

/** Plain words for what the run is doing now. */
export function activityText(now: RunActivity): string {
  const parts: string[] = [];
  switch (now.phase) {
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

/** A green change's local preview (on demand; hosts without preview deploys). */
export interface PreviewStatus {
  state: 'stopped' | 'starting' | 'running' | 'exited';
  url: string | null;
  port: number | null;
  startedAt: number | null;
  reason: string | null;
  tail: string;
}

const PREVIEW_STATES = new Set(['stopped', 'starting', 'running', 'exited']);

export const previewQuery = (hostId: string, changeId: string) =>
  queryOptions({
    queryKey: queryKeys.preview(hostId, changeId),
    queryFn: async ({ signal }): Promise<PreviewStatus & { hostId: string; changeId: string }> => {
      const body = (await apiGet(
        `/api/hosts/${encodeURIComponent(hostId)}/previews/${encodeURIComponent(changeId)}`,
        signal,
      )) as { preview?: Record<string, unknown> };
      const p = body.preview ?? {};
      return {
        hostId,
        changeId,
        state: (PREVIEW_STATES.has(String(p.state))
          ? p.state
          : 'stopped') as PreviewStatus['state'],
        url: typeof p.url === 'string' && p.url.startsWith('http://127.0.0.1:') ? p.url : null,
        port: typeof p.port === 'number' ? p.port : null,
        startedAt: typeof p.startedAt === 'number' ? p.startedAt : null,
        reason: typeof p.reason === 'string' ? p.reason : null,
        tail: typeof p.tail === 'string' ? p.tail : '',
      };
    },
  });

export const startPreview = (hostId: string, changeId: string) =>
  apiPostAnswer(
    `/api/hosts/${encodeURIComponent(hostId)}/previews/${encodeURIComponent(changeId)}/start`,
    {},
  );

export const stopPreview = (hostId: string, changeId: string) =>
  apiPostAnswer(
    `/api/hosts/${encodeURIComponent(hostId)}/previews/${encodeURIComponent(changeId)}/stop`,
    {},
  );

/** The run report (run-report: Report at the end of every run), as the daemon builds it. */
export interface ReportChange {
  change: string;
  title: string;
  state: RunChangeState;
  reason: string | null;
  branch: string | null;
  prUrl: string | null;
  previewUrl: string | null;
  attempts: number;
  lastFailure: {
    gate: string;
    attempt: number;
    reason: string | null;
    exitCode: number | null;
    tail: string | null;
    logPath: string;
  } | null;
  gates?: Array<{ gate: string; attempt: number; verdict: string | null }>;
  testShare?: TestShare | null;
}

const GATE_WORD: Record<string, string> = {
  pass: 'passed',
  fail: 'failed',
  skipped: 'skipped',
  'not-run': 'not run',
};

/** "Gates (attempt 2): types passed · related skipped · suite not run", or null. */
export function gatesText(change: Pick<ReportChange, 'gates'>): string | null {
  const gates = change.gates ?? [];
  const first = gates[0];
  if (first === undefined) return null;
  const words = gates.map((g) => `${g.gate} ${GATE_WORD[g.verdict ?? ''] ?? 'running'}`);
  return `Gates (attempt ${first.attempt}): ${words.join(' · ')}`;
}

/** "Tests 44% of the change, budget 30%, over budget", or null when not measured. */
export function testShareText(change: Pick<ReportChange, 'testShare'>): string | null {
  const share = change.testShare;
  if (share === undefined || share === null) return null;
  const over = share.percent > share.budget;
  return `Tests ${share.percent}% of the change, budget ${share.budget}%${over ? ', over budget' : ''}`;
}

export interface RunReport {
  runId: string;
  hostId: string;
  startedAt: number;
  endedAt: number | null;
  endReason: RunView['endReason'];
  endDetail: string | null;
  settings: { model: string | null; effort: string | null; budgetPercent: number | null };
  ready: ReportChange[];
  notForMerge: ReportChange[];
  parked: ReportChange[];
  notBuilt: ReportChange[];
  /** Changes built from the base as last fetched, because the fetch at their build start failed. */
  olderBase?: { change: string; base: string; fetchedAt: number | null; error: string }[];
  waiting: string[];
  assumptions: { change: string; text: string }[];
  flags: {
    change: string;
    flags: Array<{
      kind: string;
      path?: string;
      category?: string;
      status?: string;
      detail?: string;
    }>;
  }[];
}

export const runReportQuery = (hostId: string, runId: string) =>
  queryOptions({
    queryKey: queryKeys.runReport(hostId, runId),
    queryFn: async ({ signal }): Promise<RunReport> => {
      const body = (await apiGet(
        `/api/hosts/${encodeURIComponent(hostId)}/runs/${encodeURIComponent(runId)}/report`,
        signal,
      )) as { report?: RunReport | null };
      if (body.report === undefined || body.report === null || !Array.isArray(body.report.ready)) {
        throw new Error('The report answer is not valid.');
      }
      return body.report;
    },
  });

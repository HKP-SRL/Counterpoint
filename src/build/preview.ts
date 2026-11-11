// The host's own preview deploy for a pushed branch (pull-requests: Preview link).
//
// Deploy integrations (Vercel, Netlify, ...) report previews as GitHub deployments of the pushed
// commit; the deployment's latest status carries the preview's URL (`environment_url`). The PR's
// status checks only link to the provider's dashboard, so they are not used. A host "has preview
// deploys" when its recent deployments include a non-production one. The lookup polls until the
// deploy succeeds, fails, or the wait ends; it never blocks a build (the orchestrator runs it in
// the background and waits for it only before the run report).
import type { GhRun, RepoSlug } from './deliver.ts';

export const DEPLOY_WAIT_MS = 15 * 60 * 1000;
export const DEPLOY_POLL_MS = 20 * 1000;

interface Deployment {
  id: number;
  environment: string;
  production: boolean;
}

function hostArgs(slug: RepoSlug): string[] {
  return slug.host === 'github.com' ? [] : ['--hostname', slug.host];
}

async function ghJson(gh: GhRun, cwd: string, args: string[]): Promise<unknown> {
  const result = await gh(args, { cwd });
  if (result.exitCode !== 0) {
    const last = result.stderr.trim().split('\n').at(-1) ?? '';
    throw new Error(
      `gh api failed (exit ${result.exitCode})${last ? `: ${last.slice(0, 200)}` : ''}`,
    );
  }
  return JSON.parse(result.stdout) as unknown;
}

function deployments(value: unknown): Deployment[] {
  if (!Array.isArray(value)) return [];
  const out: Deployment[] = [];
  for (const row of value) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'number' || !Number.isSafeInteger(r.id)) continue;
    out.push({
      id: r.id,
      environment: typeof r.environment === 'string' ? r.environment : '',
      production: r.production_environment === true,
    });
  }
  return out;
}

const isPreview = (d: Deployment) => !d.production && !/^production$/i.test(d.environment);

async function listDeployments(
  gh: GhRun,
  cwd: string,
  slug: RepoSlug,
  query: Record<string, string>,
): Promise<Deployment[]> {
  const fields = Object.entries(query).flatMap(([key, value]) => ['-f', `${key}=${value}`]);
  return deployments(
    await ghJson(gh, cwd, [
      'api',
      ...hostArgs(slug),
      '--method',
      'GET',
      `repos/${slug.owner}/${slug.repo}/deployments`,
      ...fields,
    ]),
  );
}

/** True when the repository's recent deployments include a preview (non-production) one. */
export async function hasPreviewDeploys(gh: GhRun, cwd: string, slug: RepoSlug): Promise<boolean> {
  return (await listDeployments(gh, cwd, slug, { per_page: '30' })).some(isPreview);
}

/** A preview URL GitHub reported: https only. */
export function previewUrlFrom(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === ''
      ? url.href
      : null;
  } catch {
    return null;
  }
}

type DeployState = { state: 'ready'; url: string } | { state: 'failed' } | { state: 'pending' };

async function latestStatus(
  gh: GhRun,
  cwd: string,
  slug: RepoSlug,
  id: number,
): Promise<DeployState> {
  const rows = await ghJson(gh, cwd, [
    'api',
    ...hostArgs(slug),
    '--method',
    'GET',
    `repos/${slug.owner}/${slug.repo}/deployments/${id}/statuses`,
    '-f',
    'per_page=1',
  ]);
  const latest = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
  const state = typeof latest?.state === 'string' ? latest.state : 'pending';
  if (state === 'success') {
    const url = previewUrlFrom(latest?.environment_url) ?? previewUrlFrom(latest?.target_url);
    return url === null ? { state: 'failed' } : { state: 'ready', url };
  }
  if (state === 'failure' || state === 'error' || state === 'inactive') return { state: 'failed' };
  return { state: 'pending' };
}

export interface DeployLookupInput {
  gh: GhRun;
  cwd: string;
  slug: RepoSlug;
  /** The pushed commit. */
  sha: string;
  signal: AbortSignal;
  waitMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export type DeployLookup = { url: string } | { url: null; reason: string };

/** Polls the commit's preview deployment until it is ready, fails, or the wait ends. */
export async function findDeployPreview(input: DeployLookupInput): Promise<DeployLookup> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? abortableSleep;
  const deadline = now() + (input.waitMs ?? DEPLOY_WAIT_MS);
  for (;;) {
    if (input.signal.aborted)
      return { url: null, reason: 'The run stopped before the deploy was ready.' };
    try {
      const previews = (
        await listDeployments(input.gh, input.cwd, input.slug, { sha: input.sha, per_page: '20' })
      ).filter(isPreview);
      let failed = previews.length > 0;
      for (const deployment of previews) {
        const status = await latestStatus(input.gh, input.cwd, input.slug, deployment.id);
        if (status.state === 'ready') return { url: status.url };
        if (status.state === 'pending') failed = false;
      }
      if (failed) return { url: null, reason: "The host's preview deploy failed." };
    } catch {
      // a transient gh or network error: try again until the deadline
    }
    if (now() >= deadline) {
      const minutes = Math.round((input.waitMs ?? DEPLOY_WAIT_MS) / 60_000);
      return {
        url: null,
        reason: `No preview deploy was ready within ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
      };
    }
    try {
      await sleep(input.pollMs ?? DEPLOY_POLL_MS, input.signal);
    } catch {
      // aborted: the loop ends at the top
    }
  }
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    timer.unref?.();
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

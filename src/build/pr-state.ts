// Whether each change's latest build PR merged (runway: A merged build PR means built; design D-7).
//
// A build PR may merge without its ticks (they land after it when they would conflict, and PRs
// delivered before build ticks carry none), so a merged PR is a fact of its own. On each per-host
// fetch tick the daemon asks `gh` for the state of every
// change's latest PR not yet known merged or closed, and records it on its run change row. The
// runway and the change statuses read it from there. Not the branch being an ancestor of the
// remote base: a squash merge breaks that.
import { programOnPath } from '../core/git/remote.ts';
import type { Store } from '../core/store/db.ts';
import {
  latestPullRequests,
  type PullRequestState,
  setPullRequestState,
} from '../core/store/runs.ts';
import { defaultGhRun, type GhRun, ghEnv } from './deliver.ts';

export interface CheckPullRequestsInput {
  db: Store;
  host: { id: string; root: string };
  /** The owner's environment: where `gh` is found, and its login. */
  env: Readonly<Record<string, string | undefined>>;
  /** Seam for tests. */
  gh?: GhRun;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

function stateOf(stdout: string): PullRequestState | null {
  try {
    const state: unknown = (JSON.parse(stdout) as { state?: unknown }).state;
    if (state === 'OPEN') return 'open';
    if (state === 'MERGED') return 'merged';
    if (state === 'CLOSED') return 'closed';
  } catch {
    // Not JSON: asked again at the next tick.
  }
  return null;
}

/**
 * Asks `gh` for the state of each change's latest PR that is not known merged or closed, and
 * records it. Returns the changes whose PR was found merged now. A failed call is tried again at
 * the next tick; nothing is recorded for it.
 */
export async function checkPullRequests(input: CheckPullRequestsInput): Promise<string[]> {
  const pending = latestPullRequests(input.db, input.host.id).filter(
    (pr) => pr.prState === null || pr.prState === 'open',
  );
  if (pending.length === 0) return [];
  let gh = input.gh;
  if (gh === undefined) {
    const path = programOnPath('gh', input.env.PATH ?? '');
    if (path === null) return [];
    gh = defaultGhRun(path, ghEnv(input.env));
  }
  const merged: string[] = [];
  for (const pr of pending) {
    const result = await gh(['pr', 'view', pr.prUrl, '--json', 'state'], { cwd: input.host.root });
    if (result.exitCode !== 0) continue;
    const state = stateOf(result.stdout);
    if (state === null || state === pr.prState) continue;
    setPullRequestState(input.db, pr.id, state);
    if (state !== 'open') {
      input.log?.('pr-state', { hostId: input.host.id, change: pr.change, url: pr.prUrl, state });
    }
    if (state === 'merged') merged.push(pr.change);
  }
  return merged;
}

// The base-ref resolver (host-planning: Base branch read from the remote; Hosts with no remote;
// build-from-remote-base D-1, D-5). Every read of a host's base branch goes through here: the
// change list and statuses, approvals and the runway, framework detection, the approval
// carry-over, and a run's build order, config check and base commits.
//
// The base is the remote-tracking branch `refs/remotes/<remote>/<base>`, where `<remote>` is the
// remote the base branch tracks, else `origin`: the same rule as the PR push, so a build starts
// from the branch its PR targets. When the base branch has no such remote, or the remote-tracking
// branch does not exist yet, the local branch `refs/heads/<base>` is read and the host is local
// only. Commits on the local base branch that are not on the remote are never read.
import { REMOTE_NAME_RE, remoteNames, trackedRemote } from './remote.ts';
import { runGit } from './run.ts';

/** How long the resolver trusts its lookup of the base branch's remote. */
export const REMOTE_LOOKUP_TTL_MS = 60_000;

const OID_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export interface ResolvedBase {
  /** The ref read: `refs/remotes/<remote>/<base>`, or `refs/heads/<base>` when local only. */
  ref: string;
  /** How the console names it: `origin/master`, or `master` when local only. */
  label: string;
  /** The remote the base branch tracks (else `origin`), or null when the repository has none. */
  remote: string | null;
  /** True when the local base branch is read: no remote, or no remote-tracking branch yet. */
  localOnly: boolean;
  /** The commit the ref points at, or null when it does not resolve. */
  tip: string | null;
}

/** The remote-tracking ref of `baseBranch` on `remote`. */
export function remoteBaseRef(remote: string, baseBranch: string): string {
  return `refs/remotes/${remote}/${baseBranch}`;
}

/** The local base branch's ref. Only the resolver and planning writes name it. */
export function localBaseRef(baseBranch: string): string {
  return `refs/heads/${baseBranch}`;
}

/** The commit `ref` points at, or null. */
async function commitAt(repo: string, ref: string): Promise<string | null> {
  const result = await runGit(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    allowExitCodes: [0, 1, 128],
  });
  const sha = result.stdout.trim();
  return result.exitCode === 0 && OID_RE.test(sha) ? sha : null;
}

/** The remote the base branch tracks, else `origin`; null when that is not one of the repository's remotes. */
export async function baseRemote(repo: string, baseBranch: string): Promise<string | null> {
  const remote = await trackedRemote(repo, baseBranch);
  if (!REMOTE_NAME_RE.test(remote)) return null;
  return (await remoteNames(repo)).includes(remote) ? remote : null;
}

/** Which ref holds the base now, and its commit. `remote` skips the lookup when already known. */
export async function resolveBase(
  repo: string,
  baseBranch: string,
  remote?: string | null,
): Promise<ResolvedBase> {
  const name = remote === undefined ? await baseRemote(repo, baseBranch) : remote;
  if (name !== null) {
    const ref = remoteBaseRef(name, baseBranch);
    const tip = await commitAt(repo, ref);
    if (tip !== null) {
      return { ref, label: `${name}/${baseBranch}`, remote: name, localOnly: false, tip };
    }
  }
  const ref = localBaseRef(baseBranch);
  return {
    ref,
    label: baseBranch,
    remote: name,
    localOnly: true,
    tip: await commitAt(repo, ref),
  };
}

export interface BaseResolver {
  /** The base now (the remote lookup is cached for a minute; the ref is read every time). */
  resolve(): Promise<ResolvedBase>;
  /** The base's commit now, or null. */
  tip(): Promise<string | null>;
}

/** A resolver for one host's base branch. */
export function createBaseResolver(
  repo: string,
  baseBranch: string,
  options: { ttlMs?: number; now?: () => number } = {},
): BaseResolver {
  const ttlMs = options.ttlMs ?? REMOTE_LOOKUP_TTL_MS;
  const now = options.now ?? Date.now;
  let cached: { remote: string | null; at: number } | null = null;
  const remote = async (): Promise<string | null> => {
    if (cached !== null && now() - cached.at < ttlMs) return cached.remote;
    const found = await baseRemote(repo, baseBranch);
    cached = { remote: found, at: now() };
    return found;
  };
  const resolver: BaseResolver = {
    resolve: async () => resolveBase(repo, baseBranch, await remote()),
    tip: async () => (await resolver.resolve()).tip,
  };
  return resolver;
}

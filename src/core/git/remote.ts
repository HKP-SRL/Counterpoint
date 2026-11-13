// The host's remote: which one the base branch tracks, what its URL is, and the owner's
// credentials for one network call to it. The PR push (build/deliver.ts) and the base fetch
// (base-fetch.ts) share these, so both go to the same remote with the same credentials.
//
// Every git call runs with a clean environment that carries no credentials (run.ts). A call that
// talks to a GitHub remote gets them for that call only:
// - https: `gh auth git-credential` as the only credential helper (the owner's existing `gh`
//   login; Counterpoint stores no GitHub token), after resetting any helper the repository's
//   config names;
// - ssh: the owner's SSH agent socket and `ssh -o BatchMode=yes` (never a prompt), overriding any
//   `core.sshCommand`.
import { accessSync, constants, realpathSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { runGit } from './run.ts';

/** A remote name Counterpoint will pass to git. */
export const REMOTE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SLUG_PART_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** The absolute real path of a program on `path`, or null when it is not there. */
export function programOnPath(name: string, path = process.env.PATH ?? ''): string | null {
  for (const dir of path.split(delimiter)) {
    if (dir === '' || !isAbsolute(dir)) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {
      // not here
    }
  }
  return null;
}

export interface RepoSlug {
  host: string;
  owner: string;
  repo: string;
}

export type RemoteKind = 'https' | 'ssh';

/** The transport and GitHub repository of a remote URL; null for anything else (a local path). */
export function parseRemoteUrl(url: string): { kind: RemoteKind; slug: RepoSlug } | null {
  const trimmed = url.trim();
  let kind: RemoteKind;
  let host: string;
  let path: string;
  const scp = /^([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+):(?!\/)(.+)$/.exec(trimmed);
  if (scp !== null) {
    kind = 'ssh';
    host = scp[2] as string;
    path = scp[3] as string;
  } else {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    if (parsed.protocol === 'https:') kind = 'https';
    else if (parsed.protocol === 'ssh:') kind = 'ssh';
    else return null;
    if (parsed.search !== '' || parsed.hash !== '') return null;
    host = parsed.hostname;
    path = parsed.pathname.replace(/^\/+/, '');
  }
  const parts = path
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .split('/');
  if (parts.length !== 2) return null;
  const [owner, repo] = parts as [string, string];
  if (!SLUG_PART_RE.test(owner) || !SLUG_PART_RE.test(repo)) return null;
  if (!/^[A-Za-z0-9.-]+$/.test(host)) return null;
  return { kind, slug: { host: host.toLowerCase(), owner, repo } };
}

/** The extra `-c` flags and variables that let one call use the owner's credentials. */
export function remoteCredentials(input: {
  kind: RemoteKind;
  gh: string;
  ssh: string;
  env: NodeJS.ProcessEnv;
}): { config: string[]; env: Record<string, string> } {
  if (input.kind === 'https') {
    return {
      config: [
        '-c',
        'credential.helper=',
        '-c',
        `credential.helper=!'${input.gh.replaceAll("'", "'\\''")}' auth git-credential`,
        '-c',
        'credential.useHttpPath=false',
      ],
      env: {},
    };
  }
  const env: Record<string, string> = {
    GIT_SSH_COMMAND: `'${input.ssh.replaceAll("'", "'\\''")}' -o BatchMode=yes`,
  };
  const sock = input.env.SSH_AUTH_SOCK;
  if (sock !== undefined && isAbsolute(sock)) env.SSH_AUTH_SOCK = sock;
  return { config: [], env };
}

/** The remote the base branch tracks, else `origin`, as configured (not checked). */
export async function trackedRemote(repo: string, baseBranch: string): Promise<string> {
  const configured = await runGit(repo, ['config', '--get', `branch.${baseBranch}.remote`], {
    allowExitCodes: [0, 1],
  });
  return configured.exitCode === 0 ? configured.stdout.trim() : 'origin';
}

/** The repository's remote names. */
export async function remoteNames(repo: string): Promise<string[]> {
  return (await runGit(repo, ['remote'])).stdout
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

// Host registration (daemon-lifecycle: One daemon per machine serves every host).
//
// Core never names a framework or its files (host-planning: Framework adapter boundary). The
// framework id comes from a detector the caller injects (the composition root supplies it), and the
// store comes in through a minimal interface, so this module depends on neither the daemon nor any
// adapter.
import { realpathSync } from 'node:fs';
import { basename } from 'node:path';
import { GitError, runGit } from '../git/run.ts';
import { hostIdFromName } from '../ids.ts';

export interface HostRecord {
  id: string;
  /** Realpath of the working-tree root. */
  root: string;
  /** Realpath of the shared git dir (`--git-common-dir`). */
  gitCommonDir: string;
  baseBranch: string;
  /** Framework adapter id from the injected detector (`none` when no framework is found). */
  adapter: string;
}

/** The part of the store registration needs. */
export interface HostRegistryStore {
  listHosts(): readonly HostRecord[];
  upsertHost(host: HostRecord): void;
}

/** Returns the framework adapter id for a repository at its base branch. */
export type FrameworkDetector = (root: string, baseBranch: string) => string | Promise<string>;

export interface RegisterHostOptions {
  cwd: string;
  /** Explicit base branch; otherwise detected. */
  base?: string;
  detectFramework: FrameworkDetector;
}

const FRAMEWORK_ID_RE = /^[a-z0-9-]{1,32}$/;
/** Conservative branch-name shape checked before the name reaches argv. */
const BRANCH_NAME_RE = /^[A-Za-z0-9._/-]{1,200}$/;

export class NotARepositoryError extends Error {
  constructor(cwd: string) {
    super(`"${cwd}" is not inside a git repository.`);
    this.name = 'NotARepositoryError';
  }
}

export class BaseBranchNotFoundError extends Error {
  constructor(hostName: string) {
    super(`Couldn't find ${hostName}'s base branch. Run counterpoint again with --base <branch>.`);
    this.name = 'BaseBranchNotFoundError';
  }
}

export class InvalidFrameworkIdError extends Error {
  constructor() {
    super('The framework detector returned an invalid framework id.');
    this.name = 'InvalidFrameworkIdError';
  }
}

async function branchExists(root: string, branch: string): Promise<boolean> {
  if (!BRANCH_NAME_RE.test(branch) || branch.startsWith('-')) return false;
  const result = await runGit(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
    allowExitCodes: [0, 1, 128],
  });
  return result.exitCode === 0;
}

/**
 * The repository's base branch: the branch `refs/remotes/origin/HEAD` points at, else the first
 * existing of `main`, `master`; `null` when none applies.
 */
export async function detectBaseBranch(root: string): Promise<string | null> {
  const originHead = await runGit(
    root,
    ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
    { allowExitCodes: [0, 1, 128] },
  );
  if (originHead.exitCode === 0) {
    const short = originHead.stdout.trim();
    if (short.startsWith('origin/') && short.length > 'origin/'.length) {
      return short.slice('origin/'.length);
    }
  }
  for (const candidate of ['main', 'master']) {
    if (await branchExists(root, candidate)) return candidate;
  }
  return null;
}

async function gitPath(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const out = (await runGit(cwd, args)).stdout.trim();
    return realpathSync(out);
  } catch (error) {
    if (error instanceof GitError) throw new NotARepositoryError(cwd);
    throw error;
  }
}

function uniqueHostId(name: string, taken: ReadonlySet<string>): string {
  const base = hostIdFromName(name);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, 32 - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Couldn't derive a free host id for ${name}.`);
}

/** Registers (or re-registers) the repository containing `cwd` and upserts it into the store. */
export async function registerHost(
  store: HostRegistryStore,
  options: RegisterHostOptions,
): Promise<HostRecord> {
  const root = await gitPath(options.cwd, ['rev-parse', '--show-toplevel']);
  const gitCommonDir = await gitPath(root, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]);
  const name = basename(root);

  const baseBranch = options.base ?? (await detectBaseBranch(root));
  if (baseBranch === null || !(await branchExists(root, baseBranch))) {
    throw new BaseBranchNotFoundError(name);
  }

  const adapter = await options.detectFramework(root, baseBranch);
  if (typeof adapter !== 'string' || !FRAMEWORK_ID_RE.test(adapter)) {
    throw new InvalidFrameworkIdError();
  }

  const hosts = store.listHosts();
  const existing = hosts.find((host) => host.root === root);
  const id = existing?.id ?? uniqueHostId(name, new Set(hosts.map((host) => host.id)));

  const record: HostRecord = { id, root, gitCommonDir, baseBranch, adapter };
  store.upsertHost(record);
  return record;
}

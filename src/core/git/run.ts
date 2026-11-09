// The clean-environment git runner. Every git call against a host repository goes through here.
//
// A host repository is untrusted input: its local config and hooks can execute code (verified in
// research: a `reference-transaction` hook ran on `update-ref`, `core.fsmonitor=<cmd>` ran on
// `status`). So every call uses an absolute git binary, an argument array (never a shell
// string), an allow-listed environment that ignores global/system config, and `-c` overrides
// that disable hooks, fsmonitor and pagers.
import { accessSync, constants, realpathSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { execa } from 'execa';

const DEFAULT_TIMEOUT_MS = 15_000;
const STDERR_TAIL_LINES = 20;

/** Parent variables git may inherit. Nothing else crosses (no GIT_*, SSH_AUTH_SOCK, tokens). */
const PARENT_ALLOW_LIST = ['PATH', 'HOME', 'LANG', 'TMPDIR'] as const;

const HARDENING_ENV = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
} as const;

/** Prepended to every invocation; command-line `-c` beats the repository's own config. */
const SAFETY_ARGS = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'log.showSignature=false',
  '-c',
  'core.pager=cat',
  '-c',
  'color.ui=false',
] as const;

export class GitError extends Error {
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly stderrTail: string[];

  constructor(args: readonly string[], exitCode: number | null, stderr: string, reason?: string) {
    const tail = stderr
      .split('\n')
      .filter((line) => line.trim() !== '')
      .slice(-STDERR_TAIL_LINES);
    const last = tail.at(-1);
    const detail = reason ?? (exitCode === null ? 'did not exit normally' : `exit ${exitCode}`);
    super(`git ${args[0] ?? ''} failed (${detail})${last ? `: ${last}` : ''}`);
    this.name = 'GitError';
    this.args = [...args];
    this.exitCode = exitCode;
    this.stderrTail = tail;
  }
}

let cachedGit: string | undefined;

/** The absolute real path of the git binary, resolved once from PATH. */
export function gitBinary(): string {
  if (cachedGit !== undefined) return cachedGit;
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '' || !isAbsolute(dir)) continue;
    const candidate = join(dir, 'git');
    try {
      accessSync(candidate, constants.X_OK);
      cachedGit = realpathSync(candidate);
      return cachedGit;
    } catch {
      // not here; keep looking
    }
  }
  throw new Error('git was not found on PATH.');
}

/** The allow-listed environment for git: PATH, HOME, LANG, TMPDIR plus the hardening variables. */
export function cleanGitEnv(parent: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PARENT_ALLOW_LIST) {
    const value = parent[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...HARDENING_ENV };
}

export interface RunGitOptions {
  /** Bytes or text written to git's stdin. */
  input?: string | Uint8Array;
  /** Exit codes treated as success (default `[0]`). */
  allowExitCodes?: readonly number[];
  /** `buffer` returns stdout as raw bytes (blobs, `-z` output with binary content). */
  encoding?: 'utf8' | 'buffer';
  /** Kill git after this many milliseconds (default 15 s). */
  timeoutMs?: number;
  /**
   * Extra variables for this call only (e.g. GIT_AUTHOR_* identity, GIT_INDEX_FILE). They can
   * never override the allow-listed or hardening variables.
   */
  env?: Readonly<Record<string, string>>;
}

export interface GitResult<T extends string | Uint8Array> {
  /** Raw stdout (the final newline is not stripped). */
  stdout: T;
  stderr: string;
  exitCode: number;
}

export function runGit(
  repoRoot: string,
  args: readonly string[],
  opts: RunGitOptions & { encoding: 'buffer' },
): Promise<GitResult<Uint8Array>>;
export function runGit(
  repoRoot: string,
  args: readonly string[],
  opts?: RunGitOptions & { encoding?: 'utf8' },
): Promise<GitResult<string>>;
export async function runGit(
  repoRoot: string,
  args: readonly string[],
  opts: RunGitOptions = {},
): Promise<GitResult<string | Uint8Array>> {
  const allowed = opts.allowExitCodes ?? [0];
  const result = await execa(gitBinary(), [...SAFETY_ARGS, ...args], {
    cwd: repoRoot,
    env: { ...opts.env, ...cleanGitEnv() },
    extendEnv: false,
    reject: false,
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    stripFinalNewline: false,
    encoding: opts.encoding === 'buffer' ? 'buffer' : 'utf8',
    ...(opts.input === undefined ? { stdin: 'ignore' as const } : { input: opts.input }),
  });

  const stderr = typeof result.stderr === 'string' ? result.stderr : decode(result.stderr);
  if (result.timedOut) throw new GitError(args, null, stderr, 'timed out');
  const exitCode = result.exitCode;
  if (exitCode === undefined || !allowed.includes(exitCode)) {
    throw new GitError(args, exitCode ?? null, stderr);
  }
  return { stdout: result.stdout as string | Uint8Array, stderr, exitCode };
}

function decode(value: unknown): string {
  return value instanceof Uint8Array ? new TextDecoder().decode(value) : String(value ?? '');
}

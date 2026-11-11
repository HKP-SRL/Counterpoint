// Doctor: tool presence and versions.
//
// Every external program doctor runs goes through one injectable CommandRunner: an argument
// array (never a shell), stdin ignored, a 10 s timeout, and no rejection on a non-zero exit, so a
// missing or broken tool becomes a failed row rather than a crash.
import { execa } from 'execa';
import type { Check } from '../core/security/doctor-report.ts';

const COMMAND_TIMEOUT_MS = 10_000;

/** git 2.34 is the first release with SSH signature support. */
export const MIN_GIT_VERSION = [2, 34] as const;
/** OpenSSH 8.1 is the first release with the `ssh-keygen -Y` verbs. */
export const MIN_OPENSSH_VERSION = [8, 1] as const;

export interface CommandResult {
  /** The exit code, or null when the program did not start or was killed. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Set when the program could not be run at all (for example `ENOENT`, or `timed out`). */
  error?: string;
}

export type CommandRunner = (
  file: string,
  args: readonly string[],
  options?: { env?: Record<string, string> },
) => Promise<CommandResult>;

/** The real runner: execa with an argument array, stdin ignored and a 10 s timeout. */
export const runCommand: CommandRunner = async (file, args, options = {}) => {
  const result = await execa(file, [...args], {
    reject: false,
    timeout: COMMAND_TIMEOUT_MS,
    stdin: 'ignore',
    encoding: 'utf8',
    ...(options.env === undefined ? {} : { env: options.env, extendEnv: false }),
  });
  const notStarted = result.exitCode === undefined;
  return {
    exitCode: result.exitCode ?? null,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
    ...(result.timedOut
      ? { error: 'timed out' }
      : notStarted
        ? { error: (result as { code?: string }).code ?? 'could not run' }
        : {}),
  };
};

/** `git version 2.50.1 (Apple Git-155)` → [2, 50, 1]; null when the text is not a git version. */
export function parseGitVersion(text: string): [number, number, number] | null {
  const match = /\bgit version (\d+)\.(\d+)(?:\.(\d+))?/.exec(text);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

/** `OpenSSH_10.3p1, LibreSSL 3.3.6` → [10, 3]; null when the text is not an OpenSSH version. */
export function parseOpenSshVersion(text: string): [number, number] | null {
  const match = /\bOpenSSH_(\d+)\.(\d+)/.exec(text);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

/** True when `version` is the same as or newer than `minimum` (missing parts count as 0). */
export function versionAtLeast(version: readonly number[], minimum: readonly number[]): boolean {
  const length = Math.max(version.length, minimum.length);
  for (let i = 0; i < length; i += 1) {
    const a = version[i] ?? 0;
    const b = minimum[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  );
}

function didNotRun(name: string, result: CommandResult): string {
  if (result.error === 'ENOENT') return `${name} was not found on PATH.`;
  if (result.error !== undefined) return `${name} could not be run (${result.error}).`;
  const last = firstLine(result.stderr);
  return `${name} --version exited with ${result.exitCode ?? 'no code'}${last === '' ? '' : `: ${last}`}.`;
}

/** Checks `claude`, `git` (>= 2.34) and `gh`; each row's detail is the tool's version string. */
export async function checkTools(run: CommandRunner = runCommand): Promise<Check[]> {
  const rows: Check[] = [];

  const claude = await run('claude', ['--version']);
  const claudeVersion = firstLine(claude.stdout);
  rows.push(
    claude.exitCode === 0 && claudeVersion !== ''
      ? { id: 'claude', label: 'claude', result: 'pass', detail: claudeVersion }
      : {
          id: 'claude',
          label: 'claude',
          result: 'fail',
          detail: didNotRun('claude', claude),
          fix: 'Install Claude Code and sign in',
        },
  );

  const git = await run('git', ['--version']);
  const gitLine = firstLine(git.stdout);
  const gitVersion = parseGitVersion(gitLine);
  if (git.exitCode !== 0 || gitVersion === null) {
    rows.push({
      id: 'git',
      label: 'git',
      result: 'fail',
      detail: git.exitCode === 0 ? `Unrecognised version: ${gitLine}` : didNotRun('git', git),
      fix: git.exitCode === 0 ? 'Update git to 2.34 or newer' : 'Install git 2.34 or newer',
    });
  } else if (!versionAtLeast(gitVersion, MIN_GIT_VERSION)) {
    rows.push({
      id: 'git',
      label: 'git',
      result: 'fail',
      detail: `${gitLine} (SSH signatures need 2.34 or newer)`,
      fix: 'Update git to 2.34 or newer',
    });
  } else {
    rows.push({ id: 'git', label: 'git', result: 'pass', detail: gitLine });
  }

  const gh = await run('gh', ['--version']);
  const ghLine = firstLine(gh.stdout);
  rows.push(
    gh.exitCode === 0 && ghLine !== ''
      ? { id: 'gh', label: 'gh', result: 'pass', detail: ghLine }
      : {
          id: 'gh',
          label: 'gh',
          result: 'fail',
          detail: didNotRun('gh', gh),
          fix: 'Install the GitHub CLI (gh)',
        },
  );

  return rows;
}

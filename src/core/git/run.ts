// RED stub: replaced in GREEN.
export class GitError extends Error {
  readonly exitCode: number | null = null;
  readonly stderrTail: string[] = [];
}
export function gitBinary(): string {
  return '';
}
export function cleanGitEnv(_parent?: NodeJS.ProcessEnv): Record<string, string> {
  return {};
}
export interface RunGitOptions {
  input?: string | Uint8Array;
  allowExitCodes?: readonly number[];
  encoding?: 'utf8' | 'buffer';
  timeoutMs?: number;
}
export async function runGit(
  _repoRoot: string,
  _args: readonly string[],
  _opts?: RunGitOptions,
  // biome-ignore lint/suspicious/noExplicitAny: RED stub
): Promise<{ stdout: any; stderr: string; exitCode: number }> {
  throw new Error('not implemented');
}

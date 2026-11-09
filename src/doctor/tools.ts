// Doctor: tool presence and versions (FOUND-03). RED stub.
import { execa } from 'execa';
import type { Check } from '../core/security/doctor-report.ts';

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export type CommandRunner = (
  file: string,
  args: readonly string[],
  options?: { env?: Record<string, string> },
) => Promise<CommandResult>;

export const runCommand: CommandRunner = async (file, args, options = {}) => {
  const result = await execa(file, [...args], {
    reject: false,
    timeout: 10_000,
    stdin: 'ignore',
    encoding: 'utf8',
    ...(options.env === undefined ? {} : { env: options.env, extendEnv: false }),
  });
  return {
    exitCode: result.exitCode ?? null,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
};

export function parseGitVersion(_text: string): [number, number, number] | null {
  return null;
}

export function parseOpenSshVersion(_text: string): [number, number] | null {
  return null;
}

export function versionAtLeast(_version: readonly number[], _minimum: readonly number[]): boolean {
  return true;
}

export async function checkTools(_run: CommandRunner = runCommand): Promise<Check[]> {
  return [];
}

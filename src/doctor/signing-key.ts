// Doctor: signing-key checks (FOUND-03, RESEARCH Item 3). RED stub.
import type { TrustResult } from '../core/approvals/trust-store.ts';
import type { Check } from '../core/security/doctor-report.ts';
import type { CommandRunner } from './tools.ts';

export interface KeyHeader {
  cipher: string;
  kdf: string;
  rounds?: number;
}

export function readOpenSshKeyHeader(_path: string): KeyHeader {
  return { cipher: '', kdf: '' };
}

export function keyLoadableViaSshConfig(
  _configPath: string,
  _keyPath: string,
  _options: { homeDir?: string } = {},
): boolean {
  return false;
}

export interface CheckSigningKeyInput {
  trust: TrustResult;
  env: NodeJS.ProcessEnv;
  run: CommandRunner;
  platform?: NodeJS.Platform;
  homeDir?: string;
}

export async function checkSigningKey(_input: CheckSigningKeyInput): Promise<Check[]> {
  return [];
}

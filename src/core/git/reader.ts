// GitFileReader over committed content. Stub for the RED step.
import type { GitFileReader } from '../framework/port.ts';

export class UnsafeTreeEntryError extends Error {
  readonly path: string;
  readonly reason: 'symlink' | 'too-large' | 'unsafe-path' | 'invalid-commit';

  constructor(path: string, reason: UnsafeTreeEntryError['reason']) {
    super(`Refused ${path}: ${reason}`);
    this.name = 'UnsafeTreeEntryError';
    this.path = path;
    this.reason = reason;
  }
}

export function createGitFileReader(_repoRoot: string): GitFileReader {
  return {
    resolve: async () => null,
    list: async () => [],
    read: async () => null,
  };
}

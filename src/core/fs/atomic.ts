// The one atomic writer for Counterpoint's own state files (IN-01). The temporary file is removed
// first and then created with `wx` (O_CREAT | O_EXCL): a file or symlink planted at the
// predictable temporary name is never followed or reused, and the final rename replaces the target
// in one step. Files are 0600; callers own their directory's mode.
import { chmodSync, renameSync, rmSync, writeFileSync } from 'node:fs';

/** Writes `content` to `path` atomically, mode 0600, through `{path}.{pid}.tmp`. */
export function writeFileAtomic0600(path: string, content: string | Uint8Array): void {
  const tmp = `${path}.${process.pid}.tmp`;
  rmSync(tmp, { force: true });
  writeFileSync(tmp, content, { mode: 0o600, flag: 'wx' });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

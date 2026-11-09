// GitFileReader over committed content: `ls-tree` and `cat-file` at a commit, through the
// clean-environment runner only.
//
// Reading from a commit can never follow a working-tree symlink, but a tree can still carry
// symlink entries (mode 120000) and arbitrarily large blobs. The safe-read discipline is applied
// to tree entries: symlink entries are refused as inputs, blobs over 5 MiB are refused before
// they are read, and every path is checked (no `..`, no leading `/`, no NUL) before git runs.
// Paths are literal (GIT_LITERAL_PATHSPECS), so `*` or `?` in a name is never a pattern.
import type { GitFileReader, TreeEntry } from '../framework/port.ts';
import { runGit } from './run.ts';

/** The largest blob the reader returns. */
export const MAX_BLOB_BYTES = 5 * 1024 * 1024;

const SYMLINK_MODE = '120000';
const OID_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const LITERAL = { GIT_LITERAL_PATHSPECS: '1' } as const;

/** True when `text` holds whitespace or an ASCII control character (never part of a ref). */
function hasSpaceOrControl(text: string): boolean {
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f || /\s/.test(char)) return true;
  }
  return false;
}

export type UnsafeReason = 'symlink' | 'too-large' | 'unsafe-path' | 'invalid-commit';

const REASON_TEXT: Record<UnsafeReason, string> = {
  symlink: 'symbolic links are not read',
  'too-large': `larger than ${MAX_BLOB_BYTES / (1024 * 1024)} MiB`,
  'unsafe-path': 'unsafe path',
  'invalid-commit': 'not a commit id',
};

/** A tree entry or path the reader refuses. The message names only the repo-relative path. */
export class UnsafeTreeEntryError extends Error {
  readonly path: string;
  readonly reason: UnsafeReason;

  constructor(path: string, reason: UnsafeReason) {
    super(`Refused ${JSON.stringify(path.slice(0, 200))}: ${REASON_TEXT[reason]}.`);
    this.name = 'UnsafeTreeEntryError';
    this.path = path;
    this.reason = reason;
  }
}

function assertSafePath(path: string): void {
  const unsafe =
    path === '' ||
    path.startsWith('/') ||
    path.includes('\u0000') ||
    path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
  if (unsafe) throw new UnsafeTreeEntryError(path, 'unsafe-path');
}

function assertCommit(commit: string, path: string): void {
  if (!OID_RE.test(commit)) throw new UnsafeTreeEntryError(path, 'invalid-commit');
}

/** Parses `ls-tree -z` output: `mode SP type SP oid TAB path NUL`. */
function parseLsTree(stdout: string): TreeEntry[] {
  const entries: TreeEntry[] = [];
  for (const record of stdout.split('\u0000')) {
    if (record === '') continue;
    const tab = record.indexOf('\t');
    const [mode, type, oid] = record.slice(0, tab).split(' ');
    const path = record.slice(tab + 1);
    if (tab < 0 || !mode || !oid || (type !== 'blob' && type !== 'tree' && type !== 'commit')) {
      throw new Error('Unexpected git ls-tree output.');
    }
    entries.push({ name: path.slice(path.lastIndexOf('/') + 1), path, type, mode, oid });
  }
  return entries;
}

export function createGitFileReader(repoRoot: string): GitFileReader {
  async function entryAt(commit: string, path: string): Promise<TreeEntry | null> {
    const { stdout } = await runGit(
      repoRoot,
      ['ls-tree', '-z', '--full-tree', commit, '--', path],
      {
        env: LITERAL,
      },
    );
    return parseLsTree(stdout).find((entry) => entry.path === path) ?? null;
  }

  return {
    async resolve(ref) {
      if (ref === '' || ref.startsWith('-') || hasSpaceOrControl(ref)) return null;
      const result = await runGit(
        repoRoot,
        ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
        {
          allowExitCodes: [0, 1, 128],
        },
      );
      const sha = result.stdout.trim();
      return result.exitCode === 0 && OID_RE.test(sha) ? sha : null;
    },

    async list(commit, dir) {
      const trimmed = dir.endsWith('/') ? dir.slice(0, -1) : dir;
      if (trimmed !== '') assertSafePath(trimmed);
      assertCommit(commit, trimmed);
      const args = ['ls-tree', '-z', '--full-tree', commit];
      if (trimmed !== '') args.push('--', `${trimmed}/`);
      const { stdout } = await runGit(repoRoot, args, { env: LITERAL });
      return parseLsTree(stdout);
    },

    async read(commit, path) {
      assertSafePath(path);
      assertCommit(commit, path);
      const entry = await entryAt(commit, path);
      if (entry === null) return null;
      if (entry.mode === SYMLINK_MODE) throw new UnsafeTreeEntryError(path, 'symlink');
      if (entry.type !== 'blob') return null;
      const size = Number.parseInt(
        (await runGit(repoRoot, ['cat-file', '-s', entry.oid])).stdout,
        10,
      );
      if (!Number.isSafeInteger(size) || size > MAX_BLOB_BYTES) {
        throw new UnsafeTreeEntryError(path, 'too-large');
      }
      const { stdout } = await runGit(repoRoot, ['cat-file', 'blob', entry.oid], {
        encoding: 'buffer',
      });
      return stdout;
    },
  };
}

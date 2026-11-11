// A plain-text unified diff of two byte arrays, made by git itself, never hand-rolled.
//
// The two sides are written to unique 0600 files in a private scratch directory under the
// Counterpoint home and compared with `git diff --no-index`. External diff drivers and textconv
// filters are switched off (`--no-ext-diff --no-textconv`), and the call goes through the
// clean-environment runner (absolute git, global/system config ignored, hooks and fsmonitor off).
// git runs inside the scratch directory with repository discovery stopped there, so no host
// repository's config can change the output; the prefixes are pinned for the same reason.
//
// The header lines name the logical path the owner knows (`diff --git a/{path} b/{path}`, and
// `/dev/null` for a missing side) instead of the temporary files. The output is capped at
// 5,000 lines (`truncated`), and the temporary files are removed whatever happens.
import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runGit } from './run.ts';

/** The most diff lines returned; the rest is dropped and `truncated` is set. */
export const MAX_DIFF_LINES = 5_000;

export interface DiffResult {
  /** Unified diff text (plain text, never HTML); '' when both sides are equal. */
  diff: string;
  truncated: boolean;
}

/** A logical path is shown in a header line: printable, one line, bounded. */
function assertLogicalPath(path: string): void {
  if (path.length === 0 || path.length > 1024) throw new Error('Invalid diff path.');
  for (const char of path) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) throw new Error('Invalid diff path.');
  }
}

/** Replaces every occurrence of `from` in `line` with `to` (literal, no patterns). */
function replaceAll(line: string, from: string, to: string): string {
  return line.split(from).join(to);
}

export async function diffBytes(options: {
  /** The host repository root (kept for the call shape; git runs in `tmpDir`). */
  root: string;
  /** A private scratch directory (under the Counterpoint home); must exist. */
  tmpDir: string;
  logicalPath: string;
  /** Content before; null when the file did not exist. */
  before: Uint8Array | null;
  /** Content after; null when the file no longer exists. */
  after: Uint8Array | null;
}): Promise<DiffResult> {
  const { tmpDir, logicalPath, before, after } = options;
  assertLogicalPath(logicalPath);
  const nonce = randomBytes(12).toString('hex');
  const beforeName = `cp-diff-${nonce}-a`;
  const afterName = `cp-diff-${nonce}-b`;
  const beforeFile = join(tmpDir, beforeName);
  const afterFile = join(tmpDir, afterName);

  try {
    // `wx`: never follow or reuse an existing name; 0600: only this user can read the content.
    writeFileSync(beforeFile, before ?? new Uint8Array(), { flag: 'wx', mode: 0o600 });
    writeFileSync(afterFile, after ?? new Uint8Array(), { flag: 'wx', mode: 0o600 });

    const { stdout } = await runGit(
      tmpDir,
      [
        '-c',
        'diff.noprefix=false',
        '-c',
        'diff.mnemonicPrefix=false',
        'diff',
        '--no-index',
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
        '--no-renames',
        '-U3',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        '--',
        beforeName,
        afterName,
      ],
      // 1 means "the files differ". Repository discovery stops at the scratch directory.
      { allowExitCodes: [0, 1], env: { GIT_CEILING_DIRECTORIES: tmpDir } },
    );
    if (stdout === '') return { diff: '', truncated: false };

    const lines = stdout.split('\n');
    if (lines.at(-1) === '') lines.pop();
    let inHeader = true;
    const rewritten = lines.map((line) => {
      if (!inHeader) return line;
      if (line.startsWith('@@')) {
        inHeader = false;
        return line;
      }
      if (line.startsWith('diff --git ')) return `diff --git a/${logicalPath} b/${logicalPath}`;
      if (line.startsWith('--- '))
        return before === null ? '--- /dev/null' : `--- a/${logicalPath}`;
      if (line.startsWith('+++ ')) return after === null ? '+++ /dev/null' : `+++ b/${logicalPath}`;
      // `Binary files a/x and b/y differ` and any other header line naming the temporary files.
      return replaceAll(
        replaceAll(line, `a/${beforeName}`, before === null ? '/dev/null' : `a/${logicalPath}`),
        `b/${afterName}`,
        after === null ? '/dev/null' : `b/${logicalPath}`,
      );
    });

    const truncated = rewritten.length > MAX_DIFF_LINES;
    const kept = truncated ? rewritten.slice(0, MAX_DIFF_LINES) : rewritten;
    return { diff: `${kept.join('\n')}${truncated ? '' : '\n'}`, truncated };
  } finally {
    rmSync(beforeFile, { force: true });
    rmSync(afterFile, { force: true });
  }
}

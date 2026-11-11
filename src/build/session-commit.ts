// The orchestrator's commit after each builder session (build-runs: One worktree and branch per
// change; planning-writes: Builds never write planning files directly).
//
// Builders write no git state (spike 3.6), so after every session Counterpoint, outside any
// sandbox, with the hardened git runner:
// 1. moves the builder's handoff and assumptions files out of the worktree into the run folder
//    (opened without following symlinks and size-capped: the builder could plant a link to a file
//    only Counterpoint can read, and these texts end up in prompts and the PR body);
// 2. keeps planning files out of the branch. The change's task list, when it differs only in
//    ticked boxes, stays in the worktree uncommitted, so the next session sees its progress, and
//    the ticks are returned for the store. Any other planning edit, and any edit under `.claude/`,
//    is put back as it was at HEAD and returned as a flag;
// 3. commits everything else as one commit `cp: <change> session <n>`.
import {
  appendFileSync,
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  rmdirSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { ChangeFacts, FrameworkAdapter } from '../core/framework/port.ts';
import { runGit } from '../core/git/run.ts';
import { ASSUMPTIONS_FILE, HANDOFF_FILE } from './prompt.ts';

const MAX_NOTE_BYTES = 256 * 1024;
const COMMIT_IDENTITY = [
  '-c',
  'user.name=Counterpoint',
  '-c',
  'user.email=counterpoint@localhost',
  '-c',
  'commit.gpgsign=false',
];

/** Reads a regular file without following a symlink; null when absent or not a small regular file. */
function readNote(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_NOTE_BYTES) return null;
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const read = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    return buffer.subarray(0, offset).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function removeQuietly(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // absent
  }
}

/** Removes the now-empty folders above a removed file, up to (not including) the worktree root. */
function removeEmptyParents(worktree: string, path: string): void {
  let dir = dirname(path);
  while (dir !== '.' && dir !== '' && dir !== '/') {
    try {
      rmdirSync(join(worktree, dir));
    } catch {
      return; // not empty (or gone)
    }
    dir = dirname(dir);
  }
}

/** Repository-relative paths that differ from HEAD (tracked or untracked), from `git status -z`. */
async function changedPaths(worktree: string): Promise<string[]> {
  const { stdout } = await runGit(worktree, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--no-renames',
  ]);
  const paths: string[] = [];
  for (const entry of stdout.split('\0')) {
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
  }
  return paths;
}

async function headText(worktree: string, path: string): Promise<string | null> {
  const { stdout, exitCode } = await runGit(worktree, ['cat-file', '-p', `HEAD:${path}`], {
    allowExitCodes: [0, 128],
  });
  return exitCode === 0 ? stdout : null;
}

export interface SessionCommitInput {
  worktree: string;
  change: ChangeFacts;
  adapter: FrameworkAdapter;
  /** `runs/<run>/<change>/`: handoffs and assumptions go here. */
  changeDir: string;
  session: number;
  /** The session ended before its turn finished (crash, kill or forced end). */
  interrupted?: boolean;
}

export interface SessionCommit {
  /** The new commit, or null when the session changed nothing outside planning files. */
  commit: string | null;
  /** Every task ticked so far on this branch (cumulative, by text). */
  ticked: string[];
  /** Planning and `.claude/` paths the builder edited; put back as they were. */
  restored: string[];
  /** The session's handoff text (null when it wrote none) and where it was kept. */
  handoff: { text: string; path: string } | null;
  /** Assumptions the session recorded (appended to `assumptions.md` in changeDir). */
  assumptions: string | null;
}

export async function commitSession(input: SessionCommitInput): Promise<SessionCommit> {
  const { worktree, change, adapter } = input;
  mkdirSync(input.changeDir, { recursive: true, mode: 0o700 });

  // 1. Notes out of the worktree.
  const handoffText = readNote(join(worktree, HANDOFF_FILE));
  const assumptions = readNote(join(worktree, ASSUMPTIONS_FILE));
  removeQuietly(join(worktree, HANDOFF_FILE));
  removeQuietly(join(worktree, ASSUMPTIONS_FILE));
  let handoff: SessionCommit['handoff'] = null;
  if (handoffText !== null) {
    const path = join(input.changeDir, `session-${input.session}-handoff.md`);
    appendFileSync(path, handoffText, { mode: 0o600 });
    handoff = { text: handoffText, path };
  }
  if (assumptions !== null && assumptions.trim() !== '') {
    appendFileSync(
      join(input.changeDir, 'assumptions.md'),
      `\n<!-- session ${input.session} -->\n${assumptions.trim()}\n`,
      { mode: 0o600 },
    );
  }

  // 2. Planning files and .claude/ stay out of the branch.
  const tasksPath = adapter.tasksPath(change);
  const keepUncommitted: string[] = [];
  const restored: string[] = [];
  let ticked: string[] = [];
  for (const path of await changedPaths(worktree)) {
    const protectedPath =
      adapter.isPlanningPath(path) || path === '.claude' || path.startsWith('.claude/');
    if (!protectedPath) continue;
    const before = await headText(worktree, path);
    if (path === tasksPath && before !== null) {
      const after = readNote(join(worktree, path));
      if (after !== null && adapter.sameApartFromTicks(before, after)) {
        ticked = adapter.tickedTasks(before, after);
        keepUncommitted.push(path);
        continue;
      }
    }
    if (before === null) {
      removeQuietly(join(worktree, path));
      removeEmptyParents(worktree, path);
    } else await runGit(worktree, ['checkout', '-q', 'HEAD', '--', path]);
    restored.push(path);
  }

  // 3. Commit the rest.
  await runGit(worktree, ['add', '-A', '--', '.']);
  if (keepUncommitted.length > 0) await runGit(worktree, ['reset', '-q', '--', ...keepUncommitted]);
  const staged = await runGit(worktree, ['diff', '--cached', '--quiet'], {
    allowExitCodes: [0, 1],
  });
  let commit: string | null = null;
  if (staged.exitCode === 1) {
    const message = `cp: ${change.id} session ${input.session}${input.interrupted === true ? ' (interrupted)' : ''}`;
    await runGit(worktree, [...COMMIT_IDENTITY, 'commit', '-q', '--no-verify', '-m', message], {
      timeoutMs: 120_000,
    });
    commit = (await runGit(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
  }
  return { commit, ticked, restored, handoff, assumptions };
}

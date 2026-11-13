// What a built change's branch changed since its base commit (planning-writes: Builds never write
// planning files directly; gates: Test budget; pull-requests: Generated PR body).
//
// After the gates pass, the branch is diffed against the commit its build started from:
// - a planning file on the branch means something got past the session commits, which keep
//   planning files out: the change is flagged and its PR is never offered for merge;
// - the test share: added lines in test files over all added lines, leaving out lock files and
//   planning files, and every existing test file the change edited or deleted.
// Test files are recognised by common naming conventions only (`*.test.*`, `*.spec.*`,
// `__tests__/`, `test/`, `tests/`, `e2e/`, `__snapshots__/`); Counterpoint knows no test tool.
// The diffs are between two commits (no renames, no external diff, no textconv), through the
// hardened git runner, so no working-tree filter runs.
import { basename, matchesGlob } from 'node:path';
import { runGit } from '../core/git/run.ts';
import type { RunChangeFlag } from '../core/store/runs.ts';

export type DiffStatus = 'added' | 'modified' | 'deleted' | 'type-changed';

const TEST_GLOBS = [
  '**/*.test.*',
  '**/*.spec.*',
  '**/__tests__/**',
  '**/__snapshots__/**',
  'test/**',
  'tests/**',
  'e2e/**',
  '**/test/**',
  '**/tests/**',
  '**/e2e/**',
];

/** Lock files: generated, so never counted as the change's own lines. */
const LOCK_FILES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'npm-shrinkwrap.json',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'composer.lock',
  'go.sum',
]);

const STATUS: Readonly<Record<string, DiffStatus>> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  T: 'type-changed',
};

const COMMIT_RE = /^[0-9a-f]{40}$/;
const DIFF_ARGS = ['--no-renames', '--no-ext-diff', '--no-textconv'] as const;

export function isTestPath(path: string): boolean {
  return TEST_GLOBS.some((glob) => matchesGlob(path, glob));
}

export function isLockFile(path: string): boolean {
  return LOCK_FILES.has(basename(path));
}

/** `git diff --name-status -z` output as (status, path) pairs. */
export function parseNameStatus(output: string): Array<{ status: DiffStatus; path: string }> {
  const parts = output.split('\0');
  const entries: Array<{ status: DiffStatus; path: string }> = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const code = (parts[i] ?? '').trim().charAt(0);
    const path = parts[i + 1] ?? '';
    if (path === '') continue;
    entries.push({ status: STATUS[code] ?? 'modified', path });
  }
  return entries;
}

/** `git diff --numstat -z` output as (added lines, path); binary files count no lines. */
export function parseNumstat(output: string): Array<{ added: number; path: string }> {
  const entries: Array<{ added: number; path: string }> = [];
  for (const record of output.split('\0')) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/s.exec(record.replace(/^\n/, ''));
    if (match === null) continue;
    const added = match[1] === '-' ? 0 : Number(match[1]);
    entries.push({ added, path: match[3] ?? '' });
  }
  return entries;
}

function assertCommits(...commits: string[]): void {
  for (const commit of commits) {
    if (!COMMIT_RE.test(commit)) throw new Error('A branch diff needs commit ids.');
  }
}

/** A planning file that reached the branch. */
export interface PlanningEditFlag extends RunChangeFlag {
  kind: 'planning-edit';
  path: string;
}

/** Every planning file the branch changed since `base` (none when the session commits held). */
export async function planningEdits(input: {
  /** Any checkout of the host repository (the change's worktree). */
  repo: string;
  base: string;
  tip: string;
  isPlanningPath: (path: string) => boolean;
}): Promise<PlanningEditFlag[]> {
  assertCommits(input.base, input.tip);
  const { stdout } = await runGit(
    input.repo,
    ['diff', '--name-status', '-z', ...DIFF_ARGS, input.base, input.tip, '--'],
    { timeoutMs: 60_000 },
  );
  return parseNameStatus(stdout)
    .filter(({ path }) => input.isPlanningPath(path))
    .map(({ path }) => ({ kind: 'planning-edit', path }));
}

/**
 * True when a planning file reached the branch: the PR must not be offered for merge. Flags kept
 * from earlier versions (`protected-path` with category `planning`) count too.
 */
export function blocksMerge(flags: readonly RunChangeFlag[]): boolean {
  return flags.some(
    (flag) =>
      flag.kind === 'planning-edit' ||
      (flag.kind === 'protected-path' &&
        (flag as RunChangeFlag & { category?: unknown }).category === 'planning'),
  );
}

/** How much of a change is tests (gates: Test budget; design D-10). */
export interface TestShare {
  /** Added lines in test files. */
  testLines: number;
  /** Added lines in every counted file (lock and planning files left out). */
  addedLines: number;
  /** testLines / addedLines as a whole percentage; 0 for a change that added no lines. */
  percent: number;
  /** Existing test files the change edited or deleted, in path order. */
  editedTests: Array<{ path: string; status: 'modified' | 'deleted' | 'type-changed' }>;
}

/** Measures the test share of `base..tip`. */
export async function measureTestShare(input: {
  repo: string;
  base: string;
  tip: string;
  isPlanningPath: (path: string) => boolean;
}): Promise<TestShare> {
  assertCommits(input.base, input.tip);
  const [numstat, names] = await Promise.all([
    runGit(input.repo, ['diff', '--numstat', '-z', ...DIFF_ARGS, input.base, input.tip, '--'], {
      timeoutMs: 60_000,
    }),
    runGit(input.repo, ['diff', '--name-status', '-z', ...DIFF_ARGS, input.base, input.tip, '--'], {
      timeoutMs: 60_000,
    }),
  ]);
  let testLines = 0;
  let addedLines = 0;
  for (const { added, path } of parseNumstat(numstat.stdout)) {
    if (isLockFile(path) || input.isPlanningPath(path)) continue;
    addedLines += added;
    if (isTestPath(path)) testLines += added;
  }
  const editedTests = parseNameStatus(names.stdout)
    .filter(({ status, path }) => status !== 'added' && isTestPath(path))
    .map(({ status, path }) => ({
      path,
      status: status as TestShare['editedTests'][number]['status'],
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const percent = addedLines === 0 ? 0 : Math.round((testLines / addedLines) * 100);
  return { testLines, addedLines, percent, editedTests };
}

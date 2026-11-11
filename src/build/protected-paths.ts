// The protected-path check on a change's branch (gates: Protected-path check).
//
// After the gates pass, the branch is diffed against its approved base commit, and every path the
// builder touched that guards how the change is judged is flagged on the change, in the PR body
// and in the run report:
// - `test`: an existing test file edited or deleted (new tests are welcome). Test files are
//   recognised by common naming conventions only (`*.test.*`, `*.spec.*`, `__tests__/`, `test/`,
//   `tests/`, `e2e/`, `__snapshots__/`); Counterpoint knows no test tool;
// - `gate-config`: the host's `.counterpoint/config.yaml` (gates, services, protected paths);
// - `counterpoint`: anything else under `.counterpoint/` (approvals, visual baselines);
// - `agent-settings`: anything under `.claude/` (builder sessions load it as project settings);
// - `planning`: a planning file, by the framework adapter. Session commits already keep these out
//   of the branch, so one here means something got past that; such a PR is never offered for merge;
// - `host-listed`: a path matching the host config's own `protected` globs, read at the approved
//   base, so removing an entry in the worktree changes nothing.
// The diff is between two commits (`--name-status`, no renames, no external diff, no textconv),
// through the hardened git runner, so no working-tree filter runs.
import { matchesGlob } from 'node:path';
import { runGit } from '../core/git/run.ts';
import { COUNTERPOINT_CONFIG_PATH } from '../core/host/host-config.ts';
import type { RunChangeFlag } from '../core/store/runs.ts';

export type ProtectedCategory =
  | 'test'
  | 'gate-config'
  | 'counterpoint'
  | 'agent-settings'
  | 'planning'
  | 'host-listed';

export type DiffStatus = 'added' | 'modified' | 'deleted' | 'type-changed';

export interface ProtectedPathFlag extends RunChangeFlag {
  kind: 'protected-path';
  path: string;
  category: ProtectedCategory;
  status: DiffStatus;
}

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

const STATUS: Readonly<Record<string, DiffStatus>> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  T: 'type-changed',
};

export function isTestPath(path: string): boolean {
  return TEST_GLOBS.some((glob) => matchesGlob(path, glob));
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

/** The categories `path` (with `status`) falls in, most specific first; empty when unprotected. */
export function protectedCategories(
  path: string,
  status: DiffStatus,
  rules: { isPlanningPath: (path: string) => boolean; hostGlobs: readonly string[] },
): ProtectedCategory[] {
  const categories: ProtectedCategory[] = [];
  if (path === COUNTERPOINT_CONFIG_PATH) categories.push('gate-config');
  else if (path.startsWith('.counterpoint/')) categories.push('counterpoint');
  if (path === '.claude' || path.startsWith('.claude/')) categories.push('agent-settings');
  if (rules.isPlanningPath(path)) categories.push('planning');
  if (status !== 'added' && isTestPath(path)) categories.push('test');
  if (rules.hostGlobs.some((glob) => matchesGlob(path, glob) || path === glob)) {
    categories.push('host-listed');
  }
  return categories;
}

/**
 * Flags every protected path the branch changed since `base`. `hostGlobs` comes from the host
 * config read at the approved base.
 */
export async function checkProtectedPaths(input: {
  /** Any checkout of the host repository (the change's worktree). */
  repo: string;
  base: string;
  tip: string;
  isPlanningPath: (path: string) => boolean;
  hostGlobs: readonly string[];
}): Promise<ProtectedPathFlag[]> {
  for (const commit of [input.base, input.tip]) {
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('A protected-path check needs commit ids.');
  }
  const { stdout } = await runGit(
    input.repo,
    [
      'diff',
      '--name-status',
      '-z',
      '--no-renames',
      '--no-ext-diff',
      '--no-textconv',
      input.base,
      input.tip,
      '--',
    ],
    { timeoutMs: 60_000 },
  );
  const flags: ProtectedPathFlag[] = [];
  for (const { status, path } of parseNameStatus(stdout)) {
    for (const category of protectedCategories(path, status, input)) {
      flags.push({ kind: 'protected-path', path, category, status });
    }
  }
  return flags;
}

/** True when a planning file reached the branch: the PR must not be offered for merge. */
export function blocksMerge(flags: readonly RunChangeFlag[]): boolean {
  return flags.some(
    (flag) =>
      flag.kind === 'protected-path' &&
      (flag as Partial<ProtectedPathFlag>).category === 'planning',
  );
}

// Worktrees for builds (build-runs: One worktree and branch per change).
//
// Each change builds on its own branch `cp/<change>`, made from the approval's signed base commit,
// in its own linked worktree at `<repo>-worktrees/<change>`, a sibling of the host repository and
// never inside it or the owner's checkout. The worktree is locked while a run holds it, so a
// `git worktree prune` elsewhere cannot drop it. Every git call goes through the hardened runner
// (hooks, fsmonitor and pagers off, global config ignored).
//
// Before a worktree is made or reused, two checks run, because the builder will load what is in
// it:
// - the host's integrity baseline must hold: checking out files can run the repository's own
//   filters, and the baseline covers every execution-capable key (key-trust);
// - the committed `.claude/settings.json` at that base commit (which builder sessions load as
//   project settings) must widen no isolation setting and must carry the same execution-capable
//   keys as the baseline, and the whole committed `.claude/` folder there (skills, agents,
//   commands, CLAUDE.md) must equal the baseline's. Doctor read the base tip, which may have moved
//   since the approval.
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { checkIntegrity, readBaseline } from '../core/approvals/integrity.ts';
import { createGitFileReader } from '../core/git/reader.ts';
import { runGit } from '../core/git/run.ts';
import { isChangeId } from '../core/ids.ts';
import {
  describeClaudeFolder,
  describeProjectSettings,
  PROJECT_SETTINGS_PATH,
  type ProjectSettingsRead,
  parseProjectSettings,
} from '../core/security/project-settings.ts';
import { judgeSandboxIsolation } from '../core/security/sandbox-isolation.ts';
import type { AgentSettings } from '../core/security/sandbox-settings.ts';

const COMMIT_RE = /^[0-9a-f]{40}$/;

export interface WorktreeHost {
  id: string;
  root: string;
  gitCommonDir: string;
  baseBranch: string;
}

export class WorktreeRefusal extends Error {
  readonly reason: 'integrity' | 'project-settings' | 'branch' | 'invalid';

  constructor(reason: WorktreeRefusal['reason'], message: string) {
    super(message);
    this.name = 'WorktreeRefusal';
    this.reason = reason;
  }
}

export function branchFor(change: string): string {
  return `cp/${change}`;
}

/** `<parent>/<repo>-worktrees/<change>` for the repository at `hostRoot`. */
export function worktreePathFor(hostRoot: string, change: string): string {
  const root = realpathSync(hostRoot);
  return join(dirname(root), `${basename(root)}-worktrees`, change);
}

/**
 * The project settings builders would load from `commit`, judged: no isolation widening, and the
 * execution-capable keys equal the owner's baseline. Throws WorktreeRefusal otherwise.
 */
export async function checkProjectSettingsAt(input: {
  home: string;
  host: WorktreeHost;
  commit: string;
  /** The builder's launch settings (the isolation judge needs the launch source). */
  launchSettings: AgentSettings;
  homeDir: string;
}): Promise<void> {
  const reader = createGitFileReader(input.host.root);
  const bytes = await reader.read(input.commit, PROJECT_SETTINGS_PATH);
  const read: ProjectSettingsRead =
    bytes === null ? { state: 'absent' } : parseProjectSettings(bytes);
  const judged = judgeSandboxIsolation(
    [
      {
        kind: 'launch',
        label: 'launch settings',
        path: null,
        state: 'read',
        settings: input.launchSettings,
      },
      {
        kind: 'project',
        label: 'project settings',
        path: PROJECT_SETTINGS_PATH,
        ...(read.state === 'absent'
          ? { state: 'absent' as const }
          : read.state === 'read'
            ? { state: 'read' as const, settings: read.settings }
            : { state: 'unreadable' as const, problem: read.problem }),
      },
    ],
    input.homeDir,
  );
  if (judged.result !== 'pass') {
    throw new WorktreeRefusal(
      'project-settings',
      `${PROJECT_SETTINGS_PATH} at ${input.commit.slice(0, 12)}: ${judged.detail}`,
    );
  }
  const baseline = readBaseline(input.home, input.host.id);
  const expected = JSON.stringify(baseline?.projectSettings ?? {});
  const actual = JSON.stringify(describeProjectSettings(read));
  if (baseline === null || expected !== actual) {
    throw new WorktreeRefusal(
      'project-settings',
      `The hooks, helpers, plugins or env in ${PROJECT_SETTINGS_PATH} at ${input.commit.slice(0, 12)} differ from the baseline you accepted. Review them, then run "counterpoint trust ${input.host.id}".`,
    );
  }
  const folder = await describeClaudeFolder(reader, input.commit);
  if (JSON.stringify(folder) !== JSON.stringify(baseline.claudeFolder)) {
    const changed = [
      ...new Set([...Object.keys(folder), ...Object.keys(baseline.claudeFolder)]),
    ].filter((path) => folder[path] !== baseline.claudeFolder[path]);
    throw new WorktreeRefusal(
      'project-settings',
      `The .claude folder at ${input.commit.slice(0, 12)} differs from the baseline you accepted (${changed.slice(0, 5).join(', ')}${changed.length > 5 ? ', ...' : ''}). Review it, then run "counterpoint trust ${input.host.id}".`,
    );
  }
}

export interface PreparedWorktree {
  path: string;
  branch: string;
  /** False when an existing worktree for the branch was reused (a resumed run). */
  created: boolean;
}

async function branchExists(root: string, branch: string): Promise<boolean> {
  const { exitCode } = await runGit(
    root,
    ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
    {
      allowExitCodes: [0, 1],
    },
  );
  return exitCode === 0;
}

/** Worktree paths registered in the host, by branch ref. */
async function worktreesByBranch(root: string): Promise<Map<string, string>> {
  const { stdout } = await runGit(root, ['worktree', 'list', '--porcelain', '-z']);
  const map = new Map<string, string>();
  let path: string | null = null;
  for (const field of stdout.split('\0')) {
    if (field.startsWith('worktree ')) path = field.slice('worktree '.length);
    else if (field.startsWith('branch ') && path !== null)
      map.set(field.slice('branch '.length), path);
    else if (field === '') path = null;
  }
  return map;
}

/**
 * Makes (or, on a resumed run, reuses) the change's worktree and locks it for `runId`. A branch
 * `cp/<change>` that exists must contain `baseCommit`; one that does not is made from it.
 */
export async function prepareWorktree(input: {
  home: string;
  host: WorktreeHost;
  change: string;
  baseCommit: string;
  runId: string;
  launchSettings: AgentSettings;
  homeDir: string;
}): Promise<PreparedWorktree> {
  const { host, change, baseCommit } = input;
  if (!isChangeId(change)) throw new WorktreeRefusal('invalid', 'Invalid change name.');
  if (!COMMIT_RE.test(baseCommit)) throw new WorktreeRefusal('invalid', 'Invalid base commit.');
  if (!/^[A-Za-z0-9-]{1,64}$/.test(input.runId))
    throw new WorktreeRefusal('invalid', 'Invalid run id.');

  const integrity = await checkIntegrity(input.home, host);
  if (integrity.state !== 'ok') {
    throw new WorktreeRefusal(
      'integrity',
      integrity.state === 'no-baseline'
        ? `No integrity baseline for ${host.id}: run "counterpoint trust ${host.id}" first.`
        : `${host.id}'s git config, hooks or project settings changed since your baseline: review them, then run "counterpoint trust ${host.id}".`,
    );
  }
  await checkProjectSettingsAt({ ...input, commit: baseCommit });

  const branch = branchFor(change);
  const ref = `refs/heads/${branch}`;
  const path = worktreePathFor(host.root, change);
  let created = false;
  if (await branchExists(host.root, branch)) {
    const contains = await runGit(host.root, ['merge-base', '--is-ancestor', baseCommit, ref], {
      allowExitCodes: [0, 1],
    });
    if (contains.exitCode !== 0) {
      throw new WorktreeRefusal(
        'branch',
        `${branch} exists but does not contain the approved base ${baseCommit.slice(0, 12)}.`,
      );
    }
    const registered = (await worktreesByBranch(host.root)).get(ref);
    if (registered === undefined) {
      mkdirSync(dirname(path), { recursive: true });
      await runGit(host.root, ['worktree', 'add', path, branch], { timeoutMs: 300_000 });
      created = true;
    } else if (registered !== path && realpathSync(registered) !== path) {
      throw new WorktreeRefusal('branch', `${branch} is checked out elsewhere (${registered}).`);
    }
  } else {
    if (existsSync(path))
      throw new WorktreeRefusal('branch', `${path} exists but is not this change's worktree.`);
    mkdirSync(dirname(path), { recursive: true });
    await runGit(host.root, ['worktree', 'add', '-b', branch, path, baseCommit], {
      timeoutMs: 300_000,
    });
    created = true;
  }
  // Locked while the run holds it; a second lock by the same run is fine.
  await runGit(
    host.root,
    ['worktree', 'lock', '--reason', `counterpoint run ${input.runId}`, path],
    {
      allowExitCodes: [0, 128],
    },
  );
  return { path, branch, created };
}

/** Unlocks the change's worktree (the run no longer holds it). The worktree stays for review. */
export async function releaseWorktree(host: WorktreeHost, path: string): Promise<void> {
  await runGit(host.root, ['worktree', 'unlock', path], { allowExitCodes: [0, 128] });
}

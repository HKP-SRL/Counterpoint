// Delivery of a green change (pull-requests: One PR per change; Generated PR body).
//
// 1. Push. Every git call Counterpoint makes runs with a clean environment that carries no
//    credentials (core/git/run.ts). The push is the one exception, and only for that call:
//    - an https remote gets `gh auth git-credential` as its only credential helper (the owner's
//      existing `gh` login; Counterpoint stores no GitHub token), after resetting any helper the
//      repository's config names;
//    - an ssh remote gets the owner's SSH agent socket and `ssh -o BatchMode=yes` (never a
//      prompt), overriding any `core.sshCommand`.
//    Any other remote (a local path, git://, http://) is refused. Hooks stay off (the clean runner
//    sets core.hooksPath=/dev/null). The push is a fast-forward, unless the build was told which
//    remote head it replaces (a branch Counterpoint made again, or a closed PR's stale branch):
//    then `--force-with-lease` replaces exactly that head and nothing anyone pushed since. The
//    commit pushed is stored on the run change (its `head_commit`).
// 2. The PR. `gh` runs outside every repository (in the run folder) with `--repo`, so it never
//    reads the host's git config, with the run's environment (the owner's) and never a prompt. An
//    open PR for the branch (a change built again) gets its title and body updated instead of a
//    second PR.
// 3. The body is generated from the change and kept short (the owner reads it at a glance): the
//    preview link, the proposal's why cut to a few lines, the gates and the test share in a line
//    each, and the first three assumed decisions. The full list of assumed decisions, the existing
//    tests the change edited or deleted, the gate table and the task list (with this build's
//    ticks) follow in a collapsed section. Builder-written text is untrusted: it is quoted,
//    @mentions are defused, and the body is capped.
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import type { ChangeFacts, FrameworkAdapter } from '../core/framework/port.ts';
import {
  parseRemoteUrl,
  programOnPath,
  REMOTE_NAME_RE,
  type RemoteKind,
  type RepoSlug,
  remoteCredentials,
  remoteNames,
  trackedRemote,
} from '../core/git/remote.ts';
import { runGit } from '../core/git/run.ts';
import { assumedAnswers, listRunChangeAskCards } from '../core/store/cards.ts';
import {
  builderSessionCount,
  getRunChange,
  listGateResults,
  type RunChangeFlag,
  runChangeTicks,
  type StoredTestShare,
  updateRunChange,
} from '../core/store/runs.ts';
import { blocksMerge } from './branch-diff.ts';
import type { DeliverContext } from './orchestrator.ts';
import { withoutCounterpoint } from './owner-env.ts';
import { findDeployPreview, hasPreviewDeploys } from './preview.ts';

const PUSH_TIMEOUT_MS = 5 * 60 * 1000;
const GH_TIMEOUT_MS = 2 * 60 * 1000;
/** GitHub refuses PR bodies above 65,536 characters. */
const MAX_BODY_CHARS = 60_000;
const MAX_FILE_BYTES = 256 * 1024;
export const PR_URL_RE =
  /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/pull\/\d+$/;

export class DeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeliveryError';
  }
}

/** The absolute real path of a program on PATH. */
export function findOnPath(name: string, path = process.env.PATH ?? ''): string {
  const found = programOnPath(name, path);
  if (found === null) throw new DeliveryError(`${name} was not found on PATH.`);
  return found;
}

export { parseRemoteUrl, type RemoteKind, type RepoSlug };

/** `gh --repo` form: `owner/repo` on github.com, `host/owner/repo` elsewhere. */
export function ghRepoArg(slug: RepoSlug): string {
  return slug.host === 'github.com'
    ? `${slug.owner}/${slug.repo}`
    : `${slug.host}/${slug.owner}/${slug.repo}`;
}

export interface PushTarget {
  remote: string;
  url: string;
  kind: RemoteKind;
  slug: RepoSlug;
}

/** The remote the base branch tracks (else `origin`), its push URL and its GitHub repository. */
export async function pushTarget(repo: string, baseBranch: string): Promise<PushTarget> {
  const remote = await trackedRemote(repo, baseBranch);
  if (!REMOTE_NAME_RE.test(remote)) {
    throw new DeliveryError(`The base branch tracks "${remote.slice(0, 40)}", not a named remote.`);
  }
  if (!(await remoteNames(repo)).includes(remote)) {
    throw new DeliveryError(`The repository has no remote named ${remote}.`);
  }
  const url = (await runGit(repo, ['remote', 'get-url', '--push', remote])).stdout.trim();
  const parsed = parseRemoteUrl(url);
  if (parsed === null) {
    throw new DeliveryError(
      `Counterpoint pushes only to a GitHub repository over https or ssh; ${remote} is ${url.slice(0, 120)}.`,
    );
  }
  return { remote, url, ...parsed };
}

export interface PushInput {
  host: { id: string; root: string; gitCommonDir: string; baseBranch: string };
  branch: string;
  target: PushTarget;
  /**
   * The remote head this push may replace (`--force-with-lease`); null or absent: fast-forward
   * only.
   */
  lease?: string | null;
  /** Seams for tests. */
  gh?: string;
  ssh?: string;
  env?: NodeJS.ProcessEnv;
}

/** The extra `-c` flags and variables that let this one push use the owner's credentials. */
export const pushCredentials = remoteCredentials;

/** The owner's credentials for one call to the target remote. */
function credentialsFor(input: Pick<PushInput, 'target' | 'gh' | 'ssh' | 'env'>) {
  const env = input.env ?? process.env;
  return pushCredentials({
    kind: input.target.kind,
    gh: input.target.kind === 'https' ? (input.gh ?? findOnPath('gh', env.PATH)) : '',
    ssh: input.target.kind === 'ssh' ? (input.ssh ?? findOnPath('ssh', env.PATH)) : '',
    env,
  });
}

const BUILD_BRANCH_RE = /^cp\/[a-z0-9][a-z0-9-]{0,63}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;

/**
 * The commit the build branch points at on the target remote, or null when the remote has no
 * such branch. Asked with the owner's credentials, for this call only.
 */
export async function remoteBranchHead(
  input: Omit<PushInput, 'host' | 'lease'> & { root: string },
): Promise<string | null> {
  if (!BUILD_BRANCH_RE.test(input.branch)) {
    throw new DeliveryError(`Refusing to look up ${input.branch}: not a Counterpoint branch.`);
  }
  const credentials = credentialsFor(input);
  const ref = `refs/heads/${input.branch}`;
  let stdout: string;
  try {
    ({ stdout } = await runGit(
      input.root,
      [...credentials.config, 'ls-remote', input.target.remote, ref],
      { timeoutMs: 60_000, env: credentials.env },
    ));
  } catch (error) {
    throw new DeliveryError(`Looking up ${input.branch} failed: ${(error as Error).message}`);
  }
  for (const line of stdout.split('\n')) {
    const [sha, name] = line.trim().split('\t');
    if (name === ref && sha !== undefined && COMMIT_RE.test(sha)) return sha;
  }
  return null;
}

/** Pushes `refspec` to the target remote with the owner's credentials, for this call only. */
async function pushRefspec(
  input: Omit<PushInput, 'branch' | 'host'> & {
    root: string;
    refspec: string;
    what: string;
    options?: readonly string[];
  },
): Promise<void> {
  const credentials = credentialsFor(input);
  try {
    await runGit(
      input.root,
      [
        ...credentials.config,
        '-c',
        'push.recurseSubmodules=no',
        '-c',
        'submodule.recurse=false',
        'push',
        '--porcelain',
        ...(input.options ?? []),
        input.target.remote,
        input.refspec,
      ],
      { timeoutMs: PUSH_TIMEOUT_MS, env: credentials.env },
    );
  } catch (error) {
    throw new DeliveryError(`Pushing ${input.what} failed: ${(error as Error).message}`);
  }
}

/**
 * Pushes `branch` to the target remote with the owner's credentials, for this call only: a
 * fast-forward, or with `lease` the replacement of exactly that remote head.
 */
export async function pushBranch(input: PushInput): Promise<void> {
  if (!BUILD_BRANCH_RE.test(input.branch)) {
    throw new DeliveryError(`Refusing to push ${input.branch}: not a Counterpoint branch.`);
  }
  const lease = input.lease ?? null;
  if (lease !== null && !COMMIT_RE.test(lease)) throw new DeliveryError('Not a commit id.');
  const ref = `refs/heads/${input.branch}`;
  await pushRefspec({
    ...input,
    root: input.host.root,
    refspec: `${ref}:${ref}`,
    what: input.branch,
    options: lease === null ? [] : [`--force-with-lease=${ref}:${lease}`],
  });
}

/**
 * Pushes `commit` to the build branch `branch` on the remote, as a fast-forward only: a branch
 * someone else pushed to meanwhile refuses it (build-ticks-and-owner-steps D-3, ticks taken back
 * out of an open PR). No local ref is moved.
 */
export async function pushBranchCommit(input: PushPlanInput): Promise<void> {
  if (!/^cp\/[a-z0-9][a-z0-9-]{0,63}$/.test(input.branch)) {
    throw new DeliveryError(`Refusing to push ${input.branch}: not a Counterpoint branch.`);
  }
  if (!/^[0-9a-f]{40}$/.test(input.commit)) throw new DeliveryError('Not a commit id.');
  await pushRefspec({
    ...input,
    refspec: `${input.commit}:refs/heads/${input.branch}`,
    what: input.branch,
  });
}

export interface PushPlanInput extends Omit<PushInput, 'host'> {
  root: string;
  /** The planning write's commit, which no local branch holds. */
  commit: string;
}

/**
 * Pushes a planning write's commit to its own branch `cp-plan/<id>` (owner-inbox D-11), replacing
 * what an earlier try pushed there. No local branch is made or moved.
 */
export async function pushPlanCommit(input: PushPlanInput): Promise<void> {
  if (!/^cp-plan\/w-[0-9a-f]{12}$/.test(input.branch)) {
    throw new DeliveryError(`Refusing to push ${input.branch}: not a planning-write branch.`);
  }
  if (!/^[0-9a-f]{40}$/.test(input.commit)) throw new DeliveryError('Not a commit id.');
  await pushRefspec({
    ...input,
    refspec: `+${input.commit}:refs/heads/${input.branch}`,
    what: input.branch,
  });
}

// ---------------------------------------------------------------------------------------------
// The PR body.

/** Reads a small regular file without following a symlink; null when absent or unusable. */
export function readSmallFile(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
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

/** Untrusted text made safe to embed: no @mentions that notify anyone, no stray HTML comments. */
export function defuse(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|[^A-Za-z0-9_`])@(?=[A-Za-z0-9])/g, '$1@​')
    .trim();
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

function flagLine(flag: RunChangeFlag & { category?: string; status?: string }): string {
  const what = flag.kind === 'protected-path' ? (flag.category ?? 'protected path') : flag.kind;
  const parts = [`**${what}**`];
  if (flag.path !== undefined) parts.push(`\`${flag.path.replaceAll('`', "'")}\``);
  if (flag.status !== undefined) parts.push(`(${flag.status})`);
  if (flag.detail !== undefined) parts.push(`: ${defuse(flag.detail)}`);
  return `- ${parts.join(' ')}`;
}

/** What the PR says about its preview. */
export type PreviewLine =
  | { kind: 'url'; url: string }
  | { kind: 'deploy-pending' }
  | { kind: 'deploy-missing'; reason: string }
  | { kind: 'none' };

function previewText(preview: PreviewLine): string {
  switch (preview.kind) {
    case 'url':
      return `**Preview:** ${preview.url}`;
    case 'deploy-pending':
      return "**Preview:** the host's deploy is building; Counterpoint adds the link here when it is ready.";
    case 'deploy-missing':
      return `**Preview:** none. ${defuse(preview.reason)}`;
    case 'none':
      return '**Preview:** none. The host has no preview deploys and its Counterpoint config names no preview command.';
  }
}

export interface PrBodyInput {
  change: ChangeFacts;
  runId: string;
  baseCommit: string;
  branch: string;
  /** The change's task list as it stands in the worktree (with this build's ticks), or null. */
  taskList: string | null;
  /** Tasks this build ticked. */
  ticked: readonly string[];
  /**
   * Where the ticks are (build-ticks-and-owner-steps D-3): in this PR, or landing on the base
   * after it merges; null says nothing.
   */
  ticksPlace?: 'pr' | 'after-merge' | null;
  /** The base branch, named when the ticks land after the merge. */
  baseBranch?: string;
  /** The builder's recorded assumptions (raw), or null. */
  assumptions: string | null;
  /** Questions the builder asked in Needs You that nobody answered: built on the recommendation. */
  unanswered?: readonly { question: string; answer: string }[];
  flags: readonly RunChangeFlag[];
  /** How much of the change is tests, against the budget; null when it was not measured. */
  testShare: StoredTestShare | null;
  gates: readonly {
    gate: string;
    attempt: number;
    verdict: string | null;
    durationMs: number | null;
  }[];
  sessions: number;
  preview: PreviewLine;
}

/** A gate's outcome in a word or two. */
export function gateWord(verdict: string | null): string {
  switch (verdict) {
    case 'pass':
      return 'passed';
    case 'fail':
      return 'failed';
    case 'skipped':
      return 'skipped (no matching files changed)';
    case 'not-run':
      return 'not run';
    default:
      return '-';
  }
}

/** The test share in plain words: the share, the budget, and any existing test edited. */
export function testShareLines(share: StoredTestShare | null): string[] {
  if (share === null) return ['The test share was not measured.'];
  const over = share.percent > share.budget;
  const lines = [
    `Tests are ${share.percent}% of this change's added lines (${share.testLines} of ${share.addedLines}), against a budget of ${share.budget}%${over ? ': over budget. That is advice, not a failure.' : '.'}`,
  ];
  if (share.editedTests.length === 0) {
    lines.push('', 'No existing test was edited or deleted.');
  } else {
    lines.push('', 'Existing tests this change edited or deleted:');
    for (const test of share.editedTests) {
      lines.push(`- \`${test.path.replaceAll('`', "'")}\` (${test.status})`);
    }
  }
  return lines;
}

export function prTitle(change: ChangeFacts): string {
  const title = change.title.replace(/\s+/g, ' ').trim();
  return (title === '' ? change.id : title).slice(0, 200);
}

/** Lines of the summary, at most: the proposal's why is cut to about this many. */
const SUMMARY_CHARS = 420;
/** Assumed decisions shown before the collapsed section. */
const TOP_ASSUMED = 3;
const ITEM_CHARS = 240;

function flat(text: string): string {
  return defuse(text).replace(/\s+/g, ' ').trim();
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The proposal's why as a short summary: whole sentences up to about five lines. */
export function shortWhy(why: string): string {
  const text = defuse(why)
    .split('\n')
    .filter((line) => !/^\s*(#|<|\|)/.test(line))
    .join('\n')
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .replace(/^\s*[-*]\s+/gm, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((paragraph) => paragraph !== '')
    .join(' ');
  if (text.length <= SUMMARY_CHARS) return text;
  const head = text.slice(0, SUMMARY_CHARS);
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '));
  return end > SUMMARY_CHARS / 3 ? head.slice(0, end + 1) : clip(text, SUMMARY_CHARS);
}

/** The builder's recorded assumptions, one item per top-level bullet (with its follow-on lines). */
export function assumptionItems(raw: string | null): string[] {
  if (raw === null) return [];
  const items: string[] = [];
  let open = false;
  for (const line of defuse(raw).split('\n')) {
    if (line.trim() === '' || /^\s*#/.test(line)) {
      open = false;
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet !== null) {
      items.push(bullet[1] ?? '');
      open = true;
    } else if (open && items.length > 0) {
      items[items.length - 1] = `${items[items.length - 1]} ${line.trim()}`;
    } else {
      items.push(line.trim());
      open = true;
    }
  }
  return items.map((item) => item.replace(/\s+/g, ' ').trim()).filter((item) => item !== '');
}

/** Each gate's last result (its highest attempt), in first-run order. */
function lastGates(gates: PrBodyInput['gates']): PrBodyInput['gates'][number][] {
  const last = new Map<string, PrBodyInput['gates'][number]>();
  for (const gate of gates) {
    const seen = last.get(gate.gate);
    if (seen === undefined || gate.attempt >= seen.attempt) last.set(gate.gate, gate);
  }
  return [...last.values()];
}

function seconds(durationMs: number | null): string {
  return durationMs === null ? '-' : `${Math.round(durationMs / 1000)} s`;
}

/** The gates in one line. */
export function gatesLine(gates: PrBodyInput['gates']): string {
  const last = lastGates(gates);
  if (last.length === 0) return '**Gates:** none are configured.';
  const attempts = Math.max(...gates.map((g) => g.attempt));
  const each = last.map((gate) =>
    gate.verdict === 'pass'
      ? `${gate.gate.replaceAll('|', '/')} (${seconds(gate.durationMs)})`
      : `${gate.gate.replaceAll('|', '/')} ${gateWord(gate.verdict)}`,
  );
  return `**Gates:** every gate passed${attempts > 1 ? ` on attempt ${attempts}` : ''}: ${each.join(', ')}.`;
}

/** The test share in one line. */
export function testsLine(share: StoredTestShare | null): string {
  if (share === null) return '**Tests:** the test share was not measured.';
  const over = share.percent > share.budget ? ', over budget (advice, not a failure)' : '';
  const n = share.editedTests.length;
  const edited =
    n === 0
      ? 'no existing test edited or deleted'
      : `${n} existing ${n === 1 ? 'test' : 'tests'} edited or deleted (named below)`;
  return `**Tests:** ${share.percent}% of the added lines (${share.testLines} of ${share.addedLines}), budget ${share.budget}%${over}; ${edited}.`;
}

export function prBody(input: PrBodyInput): string {
  const { change } = input;
  const out: string[] = [];
  if (blocksMerge(input.flags)) {
    out.push(
      '> [!WARNING]',
      "> This branch edits the host's planning files. Counterpoint does not offer it for merge: planning changes go through the planning-write path.",
      '',
    );
  }
  out.push(previewText(input.preview), '');
  const why = change.why === null ? '' : shortWhy(change.why);
  out.push(why === '' ? `Builds \`${change.id}\`.` : why, '');
  out.push(gatesLine(input.gates), testsLine(input.testShare));
  if (input.ticked.length > 0 && input.ticksPlace === 'pr') out.push('**Ticks:** in this PR.');
  if (input.ticked.length > 0 && input.ticksPlace === 'after-merge') {
    out.push(
      `**Ticks:** land on \`${(input.baseBranch ?? 'the base').replaceAll('`', "'")}\` after this PR merges (the task list there changed next to them).`,
    );
  }
  out.push('');

  // The decisions to check: questions nobody answered first, then the builder's own.
  const unanswered = (input.unanswered ?? []).map(
    (a) => `${flat(a.question)} Assumed: **${flat(a.answer)}**`,
  );
  const assumed = assumptionItems(input.assumptions);
  const decisions = [...unanswered, ...assumed];
  if (decisions.length === 0) {
    out.push('**Assumed decisions:** none. The builder recorded none.', '');
  } else {
    out.push(
      `**Assumed decisions** (${decisions.length}, check each):`,
      ...decisions.slice(0, TOP_ASSUMED).map((item) => `- ${clip(item, ITEM_CHARS)}`),
    );
    if (decisions.length > TOP_ASSUMED) {
      const more = decisions.length - TOP_ASSUMED;
      out.push(`- …and ${more} more in the details below.`);
    }
    out.push('');
  }

  if (input.flags.length > 0) {
    out.push('**Flags:** paths this branch touches that need your eyes:', '');
    for (const flag of input.flags) out.push(flagLine(flag));
    out.push('');
  }

  out.push(
    '<details><summary>Details: every assumed decision, the tests, the gates and the tasks</summary>',
    '',
  );
  out.push('### Assumed decisions', '');
  if (decisions.length === 0) out.push('The builder recorded none.');
  if (unanswered.length > 0) {
    out.push('Questions you did not answer in Needs You, built on the recommended option:', '');
    for (const item of unanswered) out.push(`- ${item}`);
  }
  if (input.assumptions !== null && defuse(input.assumptions) !== '') {
    if (unanswered.length > 0) out.push('');
    out.push(
      'The builder chose these where the plan left a decision open:',
      '',
      quote(defuse(input.assumptions)),
    );
  }
  out.push('', '### Tests', '', ...testShareLines(input.testShare), '');

  out.push('### Gates', '');
  const last = lastGates(input.gates);
  if (last.length === 0) {
    out.push('No gates are configured.');
  } else {
    out.push('| Gate | Result | Time |', '| --- | --- | --- |');
    for (const gate of last) {
      out.push(
        `| ${gate.gate.replaceAll('|', '/')} | ${gateWord(gate.verdict)} | ${seconds(gate.durationMs)} |`,
      );
    }
  }
  out.push('', '### Tasks', '');
  out.push(
    input.ticked.length === 0
      ? 'This build ticked no tasks.'
      : `This build ticked ${input.ticked.length} ${input.ticked.length === 1 ? 'task' : 'tasks'}:`,
  );
  for (const task of input.ticked) out.push(`- [x] ${defuse(task).replace(/\n/g, ' ')}`);
  if (input.taskList !== null && input.taskList.trim() !== '') {
    out.push('', 'The whole task list:', '', defuse(input.taskList));
  }
  out.push('', '</details>', '');
  out.push(
    '---',
    `Built by Counterpoint: run \`${input.runId}\`, ${input.sessions} builder ${input.sessions === 1 ? 'session' : 'sessions'}, from \`${input.baseCommit.slice(0, 12)}\` on \`${input.branch}\`.`,
  );
  const body = out.join('\n');
  return body.length <= MAX_BODY_CHARS
    ? body
    : `${body.slice(0, MAX_BODY_CHARS)}\n\n…(cut: the body was longer than GitHub allows)\n\n</details>`;
}

// ---------------------------------------------------------------------------------------------
// gh.

export type GhRun = (
  args: readonly string[],
  options: { cwd: string },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

/** The environment `gh` runs with: the run's (the owner's), never a prompt. */
export function ghEnv(parent: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return {
    ...withoutCounterpoint(parent),
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    GH_SPINNER_DISABLED: '1',
    NO_COLOR: '1',
  };
}

export function defaultGhRun(gh: string, env: Record<string, string>): GhRun {
  return async (args, options) => {
    const result = await execa(gh, [...args], {
      cwd: options.cwd,
      env,
      extendEnv: false,
      reject: false,
      stdin: 'ignore',
      timeout: GH_TIMEOUT_MS,
    });
    return {
      exitCode: result.timedOut ? -1 : (result.exitCode ?? -1),
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
    };
  };
}

export function ghFailure(
  what: string,
  result: { exitCode: number; stderr: string },
): DeliveryError {
  const last = result.stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .at(-1);
  return new DeliveryError(
    `${what} failed (${result.exitCode === -1 ? 'timed out' : `exit ${result.exitCode}`})${last ? `: ${last.slice(0, 300)}` : ''}`,
  );
}

/** Opens the PR for `branch`, or updates the open one; returns its URL. */
export async function openPullRequest(input: {
  gh: GhRun;
  cwd: string;
  slug: RepoSlug;
  branch: string;
  base: string;
  title: string;
  bodyPath: string;
  draft: boolean;
}): Promise<string> {
  const repo = ghRepoArg(input.slug);
  const listed = await input.gh(
    [
      'pr',
      'list',
      '--repo',
      repo,
      '--head',
      input.branch,
      '--state',
      'open',
      '--json',
      'url',
      '--limit',
      '1',
    ],
    { cwd: input.cwd },
  );
  if (listed.exitCode !== 0) throw ghFailure('Looking for an open PR', listed);
  let existing: string | null = null;
  try {
    const rows = JSON.parse(listed.stdout) as Array<{ url?: unknown }>;
    const url = rows[0]?.url;
    existing = typeof url === 'string' && PR_URL_RE.test(url) ? url : null;
  } catch {
    throw new DeliveryError('gh answered the PR list with something other than JSON.');
  }
  if (existing !== null) {
    const edited = await input.gh(
      [
        'pr',
        'edit',
        existing,
        '--repo',
        repo,
        '--title',
        input.title,
        '--body-file',
        input.bodyPath,
      ],
      { cwd: input.cwd },
    );
    if (edited.exitCode !== 0) throw ghFailure('Updating the open PR', edited);
    // Best effort both ways: an existing ready PR goes back to draft when the branch now edits
    // planning; a draft (one held back while the change was unfinished, say) is marked ready once
    // the change is delivered whole with nothing blocking the merge.
    await input.gh(['pr', 'ready', existing, '--repo', repo, ...(input.draft ? ['--undo'] : [])], {
      cwd: input.cwd,
    });
    return existing;
  }
  const created = await input.gh(
    [
      'pr',
      'create',
      '--repo',
      repo,
      '--head',
      input.branch,
      '--base',
      input.base,
      '--title',
      input.title,
      '--body-file',
      input.bodyPath,
      ...(input.draft ? ['--draft'] : []),
    ],
    { cwd: input.cwd },
  );
  if (created.exitCode !== 0) throw ghFailure('Opening the PR', created);
  const url = created.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => PR_URL_RE.test(line))
    .at(-1);
  if (url === undefined) throw new DeliveryError('gh opened the PR but printed no PR URL.');
  return url;
}

// ---------------------------------------------------------------------------------------------
// The orchestrator's delivery hook.

export interface DeliverOptions {
  home: string;
  /** The console's port: a local preview's link is a console page that starts it on demand. */
  consolePort: number;
  /** The host's framework adapter, for the change's task list path. */
  adapterFor: (hostId: string) => FrameworkAdapter | null;
  /** Seams for tests. */
  gh?: GhRun;
  push?: (input: PushInput) => Promise<void>;
  pushTarget?: typeof pushTarget;
  hasPreviewDeploys?: typeof hasPreviewDeploys;
  findDeployPreview?: typeof findDeployPreview;
  env?: NodeJS.ProcessEnv;
}

export interface Delivered {
  prUrl: string;
  previewUrl: string | null;
  flags?: RunChangeFlag[];
  /**
   * The host's preview deploy, looked up in the background: resolves to its URL (after adding it
   * to the PR body), or null when none was ready. Stops early when `signal` aborts.
   */
  previewLater?: (signal: AbortSignal) => Promise<string | null>;
}

/** The console page that starts a change's local preview on demand. */
export function localPreviewUrl(consolePort: number, hostId: string, change: string): string {
  return `http://127.0.0.1:${consolePort}/h/${encodeURIComponent(hostId)}/preview/${encodeURIComponent(change)}`;
}

/** Writes the body file without following a planted link (remove, then exclusive create). */
export function writeBody(path: string, body: string): void {
  try {
    unlinkSync(path);
  } catch {
    // first write
  }
  writeFileSync(path, body, { mode: 0o600, flag: 'wx' });
}

export function createDeliver(
  options: DeliverOptions,
): (context: DeliverContext) => Promise<Delivered> {
  return async (context) => {
    const env = options.env ?? context.env;
    const target = await (options.pushTarget ?? pushTarget)(
      context.host.root,
      context.host.baseBranch,
    );
    const tip = (
      await runGit(context.host.root, ['rev-parse', `refs/heads/${context.branch}`])
    ).stdout.trim();
    await (options.push ?? pushBranch)({
      host: context.host,
      branch: context.branch,
      target,
      env,
      lease: context.lease ?? null,
    });
    // What Counterpoint last pushed: a later build compares the remote branch with it.
    updateRunChange(context.db, context.runChangeId, { headCommit: tip });

    const gh = options.gh ?? defaultGhRun(findOnPath('gh', env.PATH), ghEnv(env));
    const deploys = await (options.hasPreviewDeploys ?? hasPreviewDeploys)(
      gh,
      context.changeDir,
      target.slug,
    ).catch(() => false);
    const local = !deploys && context.config.preview !== null;
    const previewUrl = local
      ? localPreviewUrl(options.consolePort, context.hostId, context.change.id)
      : null;

    const adapter = options.adapterFor(context.hostId);
    const tasksPath = adapter?.tasksPath(context.change) ?? null;
    const sessions = builderSessionCount(context.db, context.runChangeId);
    const bodyInput: PrBodyInput = {
      change: context.change,
      runId: context.runId,
      baseCommit: context.baseCommit,
      branch: context.branch,
      taskList: tasksPath === null ? null : readSmallFile(join(context.worktree, tasksPath)),
      ticked: runChangeTicks(context.db, context.runChangeId),
      ticksPlace: (() => {
        const place = getRunChange(context.db, context.runChangeId)?.ticks ?? null;
        return place === 'base' ? null : place;
      })(),
      baseBranch: context.host.baseBranch,
      assumptions: readSmallFile(join(context.changeDir, 'assumptions.md')),
      unanswered: assumedAnswers(
        listRunChangeAskCards(context.db, context.runId, context.change.id),
      ),
      flags: context.flags,
      testShare: context.testShare,
      gates: listGateResults(context.db, context.runChangeId),
      sessions,
      preview: deploys
        ? { kind: 'deploy-pending' }
        : previewUrl !== null
          ? { kind: 'url', url: previewUrl }
          : { kind: 'none' },
    };
    const bodyPath = join(context.changeDir, 'pr-body.md');
    writeBody(bodyPath, prBody(bodyInput));

    const prUrl = await openPullRequest({
      gh,
      cwd: context.changeDir,
      slug: target.slug,
      branch: context.branch,
      base: context.host.baseBranch,
      title: prTitle(context.change),
      bodyPath,
      draft: blocksMerge(context.flags),
    });
    if (!deploys) return { prUrl, previewUrl };

    const repo = ghRepoArg(target.slug);
    return {
      prUrl,
      previewUrl: null,
      previewLater: async (signal) => {
        const found = await (options.findDeployPreview ?? findDeployPreview)({
          gh,
          cwd: context.changeDir,
          slug: target.slug,
          sha: tip,
          signal,
        });
        const preview: PreviewLine =
          found.url === null
            ? { kind: 'deploy-missing', reason: found.reason }
            : { kind: 'url', url: found.url };
        writeBody(bodyPath, prBody({ ...bodyInput, preview }));
        // Best effort: the link is in the store and the report either way.
        await gh(['pr', 'edit', prUrl, '--repo', repo, '--body-file', bodyPath], {
          cwd: context.changeDir,
        }).catch(() => undefined);
        return found.url;
      },
    };
  };
}

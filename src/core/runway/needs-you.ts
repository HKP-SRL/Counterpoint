// Needs You for drifted approvals (needs-you: Approved version changed; Change view reads like a
// PR review).
//
// An approved change whose signed inputs or gate config moved on at the base tip leaves the runway
// (runway.ts) and becomes one Needs You item of kind `approved-version-changed`. Nothing here is
// stored: items, their order, the change view, the per-file diffs and the uncommitted-edits hint
// are all derived from git every time (derive, don't store). An item disappears only when the
// recomputation shows the change on the runway again (re-signed, or inputs reverted) or no longer
// approved; nothing dismisses, snoozes or hides one.
//
// Core learns which repository files an input comes from only through the framework port
// (`ApprovalInput.sourcePath`), never from a framework path of its own (host-planning: Framework
// adapter boundary). A normalized
// input is diffed and compared exactly as the adapter produced it for hashing.
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { prettyCanonicalJson } from '../approvals/canonical.ts';
import { sha256Digest } from '../approvals/digest.ts';
import { COUNTERPOINT_CONFIG_PATH, gatesValue } from '../approvals/gates.ts';
import type { ApprovalStatement } from '../approvals/statement.ts';
import {
  type ApprovalInput,
  type ChangeFacts,
  ChangeNotFoundError,
  type FrameworkAdapter,
  findChange,
  type GitFileReader,
} from '../framework/port.ts';
import { type DiffResult, diffBytes } from '../git/diff.ts';
import { MAX_BLOB_BYTES } from '../git/reader.ts';
import { runGit } from '../git/run.ts';
import { approvalItemId, assertChangeId, assertHostId } from '../ids.ts';
import type { GatesChange, InputChange, Runway } from './runway.ts';

/** The only Needs You kind so far; later changes add parked items, PRs and council cards. */
export const APPROVED_VERSION_CHANGED = 'approved-version-changed';
/** The kind's visible name (needs-you: Approved version changed). */
export const APPROVED_VERSION_CHANGED_LABEL = 'Approved version changed';

/** The change-list path of the gate-config row (the gate config is not an input file). */
export const GATES_ROW_PATH = `${COUNTERPOINT_CONFIG_PATH}#gates`;
export const GATES_ROW_LABEL = 'Gate config';
/** The logical path a gate-config diff is headed with. */
export const GATES_DIFF_PATH = `${COUNTERPOINT_CONFIG_PATH} (gates)`;

const COMMIT_RE = /^[0-9a-f]{40}$/;
const PLUMBING_ENV = {
  GIT_LITERAL_PATHSPECS: '1',
  GIT_NO_REPLACE_OBJECTS: '1',
  GIT_GRAFT_FILE: '/dev/null',
} as const;

export type ChangedApproval = Runway['changed'][number];

export interface NeedsYouItem {
  /** The approval item id (the change id), also the URL id of the drift view. */
  id: string;
  kind: typeof APPROVED_VERSION_CHANGED;
  kindLabel: typeof APPROVED_VERSION_CHANGED_LABEL;
  changeId: string;
  title: string;
  /** Changed input files (the gate config is counted separately in `gatesChanged`). */
  changedCount: number;
  gatesChanged: boolean;
  /** When the signed commit was made (ISO 8601). */
  signedAt: string;
  /** Commit time of the latest base-branch commit touching what changed (ISO 8601, UTC). */
  changedAt: string;
  /** True when the change's planning files cannot be read at the tip. */
  unreadable: boolean;
}

export interface DriftRow {
  /** The input's logical path, or GATES_ROW_PATH for the gate config. */
  path: string;
  label: string;
  /** The input kind, or `gates`. */
  kind: string;
  change: InputChange['change'] | GatesChange['change'];
  signedDigest: string | null;
  nowDigest: string | null;
}

export interface DriftView {
  lead: {
    signedAt: string;
    /** The base tip the signed statement was prepared at (the diff base). */
    signedBase: string;
    tip: string;
    baseBranch: string;
    changedCount: number;
    gatesChanged: boolean;
  };
  /** Changed inputs sorted by path, then the gate-config row when the gates changed. */
  changes: DriftRow[];
  /** The one-line re-sign command, built from validated ids only. */
  command: string;
}

/** A requested diff path is not one of the item's changes; nothing is read for it. */
export class NotAChangedPathError extends Error {
  constructor(path: string) {
    super(`${JSON.stringify(path.slice(0, 200))} is not one of this item's changes.`);
    this.name = 'NotAChangedPathError';
  }
}

function comparePathBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function assertCommit(commit: string): string {
  if (!COMMIT_RE.test(commit)) throw new Error('Not a commit id.');
  return commit;
}

/** The inputs of `changeId` at `commit`; [] when the change is not in the planning truth there. */
async function inputsAt(
  adapter: FrameworkAdapter,
  reader: GitFileReader,
  commit: string,
  changeId: string,
): Promise<ApprovalInput[]> {
  try {
    return await adapter.approvalInputs(reader, commit, changeId);
  } catch (error) {
    if (error instanceof ChangeNotFoundError) return [];
    throw error;
  }
}

/** Unix seconds of the latest first-parent commit from `tip` touching `paths` (null: none). */
async function lastTouched(
  root: string,
  tip: string,
  paths: readonly string[],
): Promise<number | null> {
  const args = [
    '-c',
    'core.commitGraph=false',
    '--no-replace-objects',
    'log',
    '-1',
    '--first-parent',
    '--no-renames',
    '--format=%ct',
    '--end-of-options',
    assertCommit(tip),
  ];
  if (paths.length > 0) args.push('--', ...paths);
  const { stdout } = await runGit(root, args, { env: PLUMBING_ENV });
  const seconds = Number.parseInt(stdout.trim(), 10);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

/** The repository files behind one changed approval: its changed inputs, plus the config. */
async function changedSources(
  options: { reader: GitFileReader; adapter: FrameworkAdapter; tip: string },
  approval: ChangedApproval,
): Promise<string[]> {
  const { reader, adapter, tip } = options;
  const sources = new Set<string>();
  if (approval.changes.length > 0) {
    const atTip = new Map(
      (await inputsAt(adapter, reader, tip, approval.changeId)).map((i) => [i.path, i.sourcePath]),
    );
    let atBase: Map<string, string> | null = null;
    for (const change of approval.changes) {
      let source = atTip.get(change.path);
      if (source === undefined) {
        // A removed input exists only at the commit the statement was prepared at.
        atBase ??= new Map(
          (
            await inputsAt(
              adapter,
              reader,
              assertCommit(approval.statement.base.commit),
              approval.changeId,
            )
          ).map((i) => [i.path, i.sourcePath]),
        );
        source = atBase.get(change.path);
      }
      if (source !== undefined) sources.add(source);
    }
  }
  if (approval.gatesChange !== null) sources.add(COUNTERPOINT_CONFIG_PATH);
  return [...sources].sort(comparePathBytes);
}

/**
 * The Needs You items for the changed approvals at `tip`: one per change, never merged, newest
 * edit first, ties by change id ascending.
 */
export async function deriveNeedsYou(options: {
  root: string;
  baseBranch: string;
  tip: string;
  changed: readonly ChangedApproval[];
  reader: GitFileReader;
  adapter: FrameworkAdapter;
  /** The changes at the tip (for the `Couldn't read` mark and titles); omitted means none. */
  changes?: readonly Pick<ChangeFacts, 'id' | 'archived' | 'title' | 'unreadable'>[];
}): Promise<NeedsYouItem[]> {
  const tip = assertCommit(options.tip);
  let tipSeconds: number | null = null;
  const rows: { item: NeedsYouItem; seconds: number }[] = [];

  for (const approval of options.changed) {
    const changeId = assertChangeId(approval.changeId);
    const sources = await changedSources({ ...options, tip }, approval);
    let seconds = sources.length > 0 ? await lastTouched(options.root, tip, sources) : null;
    if (seconds === null) {
      tipSeconds ??= await lastTouched(options.root, tip, []);
      seconds = tipSeconds ?? 0;
    }
    const change = options.changes ? findChange(options.changes, changeId) : undefined;
    rows.push({
      seconds,
      item: {
        id: approvalItemId(changeId),
        kind: APPROVED_VERSION_CHANGED,
        kindLabel: APPROVED_VERSION_CHANGED_LABEL,
        changeId,
        title: `${change?.title ?? approval.title ?? changeId} changed since you signed it`,
        changedCount: approval.changes.length,
        gatesChanged: approval.gatesChange !== null,
        signedAt: approval.signedAt,
        changedAt: new Date(seconds * 1000).toISOString(),
        unreadable: change !== undefined && change.unreadable !== null,
      },
    });
  }

  rows.sort(
    (a, b) =>
      b.seconds - a.seconds ||
      (a.item.changeId < b.item.changeId ? -1 : a.item.changeId > b.item.changeId ? 1 : 0),
  );
  return rows.map((row) => row.item);
}

/** The drift view model: lead facts, the changed-file rows and the re-sign command. */
export function driftView(options: {
  item: Pick<NeedsYouItem, 'changeId' | 'signedAt'>;
  statement: ApprovalStatement;
  changes: readonly InputChange[];
  gatesChange: GatesChange | null;
  tip: string;
  baseBranch: string;
  hostId: string;
}): DriftView {
  const hostId = assertHostId(options.hostId);
  const changeId = assertChangeId(options.item.changeId);
  const rows: DriftRow[] = [...options.changes]
    .sort((a, b) => comparePathBytes(a.path, b.path))
    .map((change) => ({
      path: change.path,
      label: change.path,
      kind: change.kind,
      change: change.change,
      signedDigest: change.signedDigest,
      nowDigest: change.nowDigest,
    }));
  if (options.gatesChange !== null) {
    rows.push({
      path: GATES_ROW_PATH,
      label: GATES_ROW_LABEL,
      kind: 'gates',
      change: options.gatesChange.change,
      signedDigest: options.gatesChange.signedDigest,
      nowDigest: options.gatesChange.nowDigest,
    });
  }
  return {
    lead: {
      signedAt: options.item.signedAt,
      signedBase: options.statement.base.commit,
      tip: options.tip,
      baseBranch: options.baseBranch,
      changedCount: options.changes.length,
      gatesChanged: options.gatesChange !== null,
    },
    changes: rows,
    command: `counterpoint approve ${hostId} ${changeId}`,
  };
}

/** The bytes of input `path` of `changeId` at `commit`, exactly as hashed; null when absent. */
async function inputBytes(
  adapter: FrameworkAdapter,
  reader: GitFileReader,
  commit: string,
  changeId: string,
  path: string,
): Promise<Uint8Array | null> {
  const input = (await inputsAt(adapter, reader, commit, changeId)).find((i) => i.path === path);
  return input === undefined ? null : input.bytes;
}

/** The `gates` value at `commit` as pretty canonical JSON (2-space, sorted keys); null if absent. */
async function gatesText(reader: GitFileReader, commit: string): Promise<Uint8Array | null> {
  const value = await gatesValue(reader, commit);
  if (value === null) return null;
  return new TextEncoder().encode(`${prettyCanonicalJson(value, 2, 'gates')}\n`);
}

/**
 * The diff of one changed path between the content at the approval's recorded base commit and the
 * base tip now (needs-you: Change view reads like a PR review). Refuses, before reading anything, a
 * path not in the change list.
 */
export async function changedInputDiff(options: {
  root: string;
  reader: GitFileReader;
  adapter: FrameworkAdapter;
  statement: ApprovalStatement;
  changes: readonly InputChange[];
  gatesChange: GatesChange | null;
  tip: string;
  changeId: string;
  path: string;
  tmpDir: string;
}): Promise<{ path: string } & DiffResult> {
  const { root, reader, adapter, statement, path, tmpDir } = options;
  const changeId = assertChangeId(options.changeId);
  const tip = assertCommit(options.tip);
  const base = assertCommit(statement.base.commit);

  if (path === GATES_ROW_PATH) {
    if (options.gatesChange === null) throw new NotAChangedPathError(path);
    const result = await diffBytes({
      root,
      tmpDir,
      logicalPath: GATES_DIFF_PATH,
      before: await gatesText(reader, base),
      after: await gatesText(reader, tip),
    });
    return { path, ...result };
  }

  const change = options.changes.find((c) => c.path === path);
  if (change === undefined) throw new NotAChangedPathError(path);
  const before =
    change.change === 'added' ? null : await inputBytes(adapter, reader, base, changeId, path);
  const after =
    change.change === 'removed' ? null : await inputBytes(adapter, reader, tip, changeId, path);
  const result = await diffBytes({ root, tmpDir, logicalPath: path, before, after });
  return { path, ...result };
}

/** Paths reported by `git status --porcelain=v1 -z --no-renames`. */
function statusPaths(stdout: string): Set<string> {
  const paths = new Set<string>();
  for (const record of stdout.split('\0')) {
    if (record.length > 3) paths.add(record.slice(3));
  }
  return paths;
}

/**
 * The working-tree bytes of a repository file: opened with O_NOFOLLOW, regular files only, at
 * most the reader's blob limit, and only inside the checkout. Null when the file does not exist;
 * throws for anything else that cannot be read safely.
 */
function readWorkingFile(root: string, relPath: string): Uint8Array | null {
  const unsafe =
    relPath === '' ||
    relPath.startsWith('/') ||
    relPath.includes('\0') ||
    relPath.split('/').some((s) => s === '' || s === '.' || s === '..');
  if (unsafe) throw new Error('Unsafe path.');

  const rootReal = realpathSync(root);
  const full = join(rootReal, relPath);
  let parentReal: string;
  try {
    parentReal = realpathSync(dirname(full));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (parentReal !== rootReal && !parentReal.startsWith(`${rootReal}${sep}`)) {
    throw new Error('Path leaves the checkout.');
  }

  let fd: number;
  try {
    fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error('Not a regular file.');
    if (stat.size > MAX_BLOB_BYTES) throw new Error('File too large.');
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const read = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    return buffer.subarray(0, offset);
  } finally {
    closeSync(fd);
  }
}

/**
 * The soft hint of runway: Uncommitted edits do not change the runway: true when the owner's
 * checkout has uncommitted edits to the files the change's inputs come from that change an input.
 * Both sides are relative to the checkout's own HEAD. A raw input counts as soon as its file is
 * dirty; a normalized input counts only when its recomputed bytes differ (ticking a task box does
 * not). The approval itself is never affected.
 */
export async function uncommittedEditsHint(options: {
  root: string;
  reader: GitFileReader;
  adapter: FrameworkAdapter;
  changeId: string;
}): Promise<boolean> {
  const { root, reader, adapter } = options;
  const changeId = assertChangeId(options.changeId);
  const head = await reader.resolve('HEAD');
  if (head === null) return false;
  const inputs = await inputsAt(adapter, reader, head, changeId);
  const sources = [...new Set(inputs.map((input) => input.sourcePath))];
  if (sources.length === 0) return false;

  // runGit sets GIT_OPTIONAL_LOCKS=0 and core.fsmonitor=false; pathspecs are literal.
  const { stdout } = await runGit(
    root,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames', '--', ...sources],
    { env: { GIT_LITERAL_PATHSPECS: '1' } },
  );
  const dirty = statusPaths(stdout);
  if (dirty.size === 0) return false;

  for (const input of inputs) {
    if (!dirty.has(input.sourcePath)) continue;
    if (input.sourcePath === input.path && input.normalization === null) return true;
    // A normalized input: recompute it with only its source file taken from the working tree.
    try {
      const working = readWorkingFile(root, input.sourcePath);
      const overlay: GitFileReader = {
        resolve: (ref) => reader.resolve(ref),
        list: (commit, dir) => reader.list(commit, dir),
        read: (commit, path) =>
          commit === head && path === input.sourcePath
            ? Promise.resolve(working)
            : reader.read(commit, path),
      };
      const now = (await adapter.approvalInputs(overlay, head, changeId)).find(
        (i) => i.path === input.path,
      );
      if (now === undefined || sha256Digest(now.bytes) !== sha256Digest(input.bytes)) return true;
    } catch {
      // The edited source cannot be read or no longer yields this change: that is an edit to it.
      return true;
    }
  }
  return false;
}

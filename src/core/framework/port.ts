// The framework port. Core owns these types; a framework adapter implements them (dependency
// inversion; host-planning: Framework adapter boundary). Nothing in core knows which spec-driven
// framework a host uses: everything framework-specific (file names, layouts, parsing) lives behind
// `FrameworkAdapter`.
//
// Adapters never touch a working tree. They read committed content through `GitFileReader`, so
// what they report is exactly what is on the base branch tip (host-planning: Committed
// content only).

/** One entry of a git tree listing. */
export interface TreeEntry {
  /** The last path segment. */
  name: string;
  /** The full repository-relative path. */
  path: string;
  type: 'blob' | 'tree' | 'commit';
  /** Octal mode as git prints it (`100644`, `100755`, `120000`, `040000`, `160000`). */
  mode: string;
  oid: string;
}

/** Reads committed content from a repository. Implementations never read the working tree. */
export interface GitFileReader {
  /** The commit sha a ref points at, or null when the ref does not name a commit. */
  resolve(ref: string): Promise<string | null>;
  /** The direct children of `dir` at `commit`; [] when the directory does not exist. */
  list(commit: string, dir: string): Promise<TreeEntry[]>;
  /** The exact bytes of the file at `path` in `commit`, or null when there is no such file. */
  read(commit: string, path: string): Promise<Uint8Array | null>;
}

/** Why a file could not be used. `file` is repository-relative; `reason` is one short line. */
export interface UnreadableFile {
  file: string;
  reason: string;
}

/** Which of a change's planning artifacts exist. */
export interface ChangeArtifacts {
  proposal: boolean;
  design: boolean;
  tasks: boolean;
  /** The capability paths under the change's `specs/` folder (`menu`, `ordering/kitchen`). */
  specs: string[];
}

/** Task progress of a change, counted the way the framework counts its own checkboxes. */
export interface ChangeTasks {
  total: number;
  done: number;
  /** Unchecked tasks whose text starts with `Owner:`: steps only the owner can do. */
  ownerSteps: string[];
  /**
   * The owner steps listed after open build work: they are about the built change, so they wait
   * until it is built. Absent: none wait.
   */
  ownerStepsAfterBuild?: string[];
}

/** What the adapter knows about one change (openspec-host-adapter design decision 3). */
export interface ChangeFacts {
  /** The change name: display, URL and approval id (kebab-case, at most 64 characters). */
  id: string;
  /** Repository-relative directory of the change. */
  dir: string;
  /** True for a finished change moved into the archive. */
  archived: boolean;
  /** The archive date (`YYYY-MM-DD`) for an archived change, else null. */
  archivedOn: string | null;
  /** The proposal's first top-level heading, else the id. */
  title: string;
  /** The proposal's "Why" section, trimmed and capped; null when there is none. */
  why: string | null;
  /** The change's creation date (`YYYY-MM-DD`), null when absent or invalid. */
  created: string | null;
  /** Ids of the changes this one depends on, as written. */
  dependsOn: string[];
  artifacts: ChangeArtifacts;
  tasks: ChangeTasks;
  /** Set when a file of this change failed to read or parse; other changes are unaffected. */
  unreadable: UnreadableFile | null;
}

/** Everything the adapter reports about a host's planning truth at one commit. */
export interface ChangeSnapshot {
  /** The adapter id that produced this snapshot. */
  framework: string;
  commit: string;
  /** Active changes in build order, then archived changes, newest first. */
  changes: ChangeFacts[];
  /** Set when the host's planning root itself could not be read. */
  unreadable: UnreadableFile | null;
}

export type ApprovalInputKind = 'proposal' | 'design' | 'tasks' | 'spec' | 'metadata' | 'other';

/** One input an approval covers. */
export interface ApprovalInput {
  /** Logical input id recorded in the approval statement. */
  path: string;
  /**
   * The repository file the bytes come from: equal to `path` for every input today, kept apart so
   * core can map any input to a real file without knowing the framework.
   */
  sourcePath: string;
  label: string;
  kind: ApprovalInputKind;
  /** Id of the normalizer applied to the bytes, or null when they are the raw file. */
  normalization: string | null;
  bytes: Uint8Array;
}

/** A framework adapter: recognises a host and reports its planning truth from a commit. */
export interface FrameworkAdapter {
  /** Stable adapter id (stored on the host row). */
  id: string;
  /** True when the commit carries this framework's planning layout. */
  detect(reader: GitFileReader, commit: string): Promise<boolean>;
  snapshot(reader: GitFileReader, commit: string): Promise<ChangeSnapshot>;
  /** The inputs an approval of `changeId` covers. Throws ChangeNotFoundError for an unknown id. */
  approvalInputs(reader: GitFileReader, commit: string, changeId: string): Promise<ApprovalInput[]>;
  /**
   * True for a repository-relative path that belongs to the host's planning (build-runs: builds
   * never write planning files; planning-writes: Builds never write planning files directly).
   */
  isPlanningPath(path: string): boolean;
  /** The repository-relative path of the change's task list, or null when it has none. */
  tasksPath(change: ChangeFacts): string | null;
  /**
   * Tasks that are open in `before` and done in `after` (two versions of the task list), by their
   * text, in the order they appear in `after`. Used to record a builder's progress.
   */
  tickedTasks(before: string, after: string): string[];
  /**
   * The task list with the open task `task` ticked (matched by its text, with or without its
   * number), unchanged when it is already done, or null when the list has no such task. Only the
   * checkbox changes. Planning writes use it, so a tick made again on a newer base keeps every
   * other edit to the list.
   */
  tickTask(tasks: string, task: string): string | null;
  /**
   * The open tasks of a task list that are not owner steps, by their text, in file order. A build
   * is done only when this is empty.
   */
  openTasks(tasks: string): string[];
  /** True when two versions of a task list differ only in which boxes are ticked. */
  sameApartFromTicks(before: string, after: string): boolean;
  /**
   * What a builder is told about implementing `change` with the host's own workflow (which
   * artifacts to follow, which skill or command applies the change, how progress is recorded).
   */
  buildInstructions(change: ChangeFacts): string;
}

export class ChangeNotFoundError extends Error {
  readonly changeId: string;

  constructor(changeId: string) {
    super(`Change ${JSON.stringify(changeId.slice(0, 64))} was not found.`);
    this.name = 'ChangeNotFoundError';
    this.changeId = changeId;
  }
}

/**
 * More than one planning entry carries the name `changeId` (for example an active change and an
 * archived one, or two archived ones). Which one an approval covers would be a guess, so it fails
 * closed: the adapter refuses to compute inputs and shows each entry as unreadable.
 */
export class AmbiguousChangeError extends Error {
  readonly changeId: string;
  readonly dirs: readonly string[];

  constructor(changeId: string, dirs: readonly string[]) {
    super(
      `More than one folder is named for change ${JSON.stringify(changeId.slice(0, 64))}: ${dirs.join(', ')}. Rename or remove all but one.`,
    );
    this.name = 'AmbiguousChangeError';
    this.changeId = changeId;
    this.dirs = [...dirs];
  }
}

/** The change named `changeId`: the active one, else an archived one of that name. */
export function findChange<T extends Pick<ChangeFacts, 'id' | 'archived'>>(
  changes: readonly T[],
  changeId: string,
): T | undefined {
  return (
    changes.find((c) => c.id === changeId && !c.archived) ?? changes.find((c) => c.id === changeId)
  );
}

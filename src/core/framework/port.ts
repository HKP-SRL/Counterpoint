// The framework port. Core owns these types; a framework adapter implements them (dependency
// inversion, ADPT-02). Nothing in core knows which spec-driven framework a host uses: everything
// framework-specific (file names, layouts, parsing) lives behind `FrameworkAdapter`.
//
// Adapters never touch a working tree. They read committed content through `GitFileReader`, so
// what they report is exactly what is on the base branch tip (D-03).

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

/** A one-time setup step a plan declares (an external service, its env vars). */
export interface UserSetupItem {
  service: string;
  why: string | null;
  envVars: string[];
}

/** What the adapter knows about one plan of a phase. */
export interface PlanFacts {
  id: string;
  /** Repository-relative path of the plan file. */
  file: string;
  wave: number | null;
  dependsOn: string[];
  autonomous: boolean;
  objective: string | null;
  filesModified: string[];
  userSetup: UserSetupItem[];
  /** True when the plan's completion record exists next to it (the plan was built). */
  hasSummary: boolean;
}

/** Why a file could not be used. `file` is repository-relative; `reason` is one short line. */
export interface UnreadableFile {
  file: string;
  reason: string;
}

/** What the adapter knows about one phase. */
export interface PhaseFacts {
  /** Display and URL id: major zero-padded to two digits (`01`, `01.1`, `02`). */
  id: string;
  /** The phase number as an integer tuple (`01.1` → [1, 1]). Never a floating-point value. */
  number: number[];
  name: string;
  /** True for a phase inserted between existing ones. */
  inserted: boolean;
  /** Repository-relative directory of the phase, or null when it has none yet. */
  dir: string | null;
  goal: string | null;
  dependsOn: string | null;
  requirements: string | null;
  /** True when the phase's discussion record (its context document) exists. */
  hasContext: boolean;
  plans: PlanFacts[];
  /** Set when a file of this phase failed to read or parse; other phases are unaffected. */
  unreadable: UnreadableFile | null;
}

/** Everything the adapter reports about a host's planning truth at one commit. */
export interface PlanSnapshot {
  /** The adapter id that produced this snapshot. */
  framework: string;
  commit: string;
  phases: PhaseFacts[];
  /** Set when the host's top-level planning document itself could not be read. */
  unreadable: UnreadableFile | null;
}

export type ApprovalInputKind =
  | 'context'
  | 'plan'
  | 'research'
  | 'ui-spec'
  | 'spec'
  | 'ai-spec'
  | 'roadmap-section';

/** One input an approval covers. */
export interface ApprovalInput {
  /** Logical input id recorded in the approval statement. */
  path: string;
  /**
   * The repository file the bytes come from: equal to `path` for a plain file, the underlying
   * file for a derived input (such as a normalized section), so core can map any input to a real
   * file without knowing the framework.
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
  snapshot(reader: GitFileReader, commit: string): Promise<PlanSnapshot>;
  /** The inputs an approval of `phaseId` covers. Throws PhaseNotFoundError for an unknown id. */
  approvalInputs(reader: GitFileReader, commit: string, phaseId: string): Promise<ApprovalInput[]>;
}

export class PhaseNotFoundError extends Error {
  readonly phaseId: string;

  constructor(phaseId: string) {
    super(`Phase ${JSON.stringify(phaseId.slice(0, 40))} was not found.`);
    this.name = 'PhaseNotFoundError';
    this.phaseId = phaseId;
  }
}

/**
 * Orders phase numbers as integer tuples: element by element, and on a shared prefix the shorter
 * tuple first. So [1] < [1, 1] < [1, 9] < [1, 10] < [2].
 */
export function comparePhaseNumbers(a: readonly number[], b: readonly number[]): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    const diff = (a[i] as number) - (b[i] as number);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/** The phase id for a number: major zero-padded to two digits, minors as written. */
export function formatPhaseId(number: readonly number[]): string {
  const [major, ...minors] = number;
  if (major === undefined) throw new RangeError('A phase number needs at least one part.');
  return [String(major).padStart(2, '0'), ...minors.map(String)].join('.');
}

const PHASE_NUMBER_RE = /^(\d{1,6})(?:\.(\d{1,6}))?$/;

/**
 * Parses `1`, `01`, `1.1`, `01.1`, `1.10` into an integer tuple; null for anything else.
 * Each segment is parsed as a base-10 integer, so `1.10` stays distinct from `1.1`.
 */
export function parsePhaseNumber(text: string): number[] | null {
  const match = PHASE_NUMBER_RE.exec(text);
  if (!match) return null;
  const parts = [Number.parseInt(match[1] as string, 10)];
  if (match[2] !== undefined) parts.push(Number.parseInt(match[2], 10));
  return parts;
}

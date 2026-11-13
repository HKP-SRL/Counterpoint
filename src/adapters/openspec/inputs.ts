// The approval-input rule (openspec-host-adapter design decision 6). The adapter owns "which files
// does approving a change cover", so core stays framework-agnostic and only ever sees ApprovalInput
// values.
//
// The inputs of change <id> are, at one commit, every blob under its directory, recursively,
// sorted by path bytes:
//   proposal.md -> proposal, design.md -> design, tasks.md -> tasks, `.openspec.yaml` -> metadata,
//   specs/**.md -> spec, anything else -> other.
// Every input is the exact committed bytes, except tasks.md, which is digested after the
// `cp-openspec-tasks/v1` normalizer so ticking a box is not a content change. A file added to the
// directory is an added input; a file removed is a removed one.
//
// A change name must name exactly one directory, active or archived; two of the same name fail
// closed (AmbiguousChangeError).
// Unsafe entries are refused, not skipped: the reader throws UnsafeTreeEntryError for a symlink
// or a blob over 5 MiB, so an approval can never silently cover less than it claims.
import {
  AmbiguousChangeError,
  type ApprovalInput,
  type ApprovalInputKind,
  ChangeNotFoundError,
  type GitFileReader,
} from '../../core/framework/port.ts';
import { assertChangeId } from '../../core/ids.ts';
import {
  type ChangeDir,
  DESIGN_NAME,
  listActiveChanges,
  listArchivedChanges,
  METADATA_NAME,
  PROPOSAL_NAME,
  SPECS_NAME,
  TASKS_NAME,
  walkTree,
} from './layout.ts';
import { normalizeTasks, TASKS_NORMALIZER } from './tasks.ts';

const TOP_LEVEL_KINDS: Record<string, ApprovalInputKind> = {
  [PROPOSAL_NAME]: 'proposal',
  [DESIGN_NAME]: 'design',
  [TASKS_NAME]: 'tasks',
  [METADATA_NAME]: 'metadata',
};

/** The kind of the file at `relPath` (relative to the change directory). */
export function inputKind(relPath: string): ApprovalInputKind {
  const top = TOP_LEVEL_KINDS[relPath];
  if (top !== undefined) return top;
  if (relPath.startsWith(`${SPECS_NAME}/`) && relPath.endsWith('.md')) return 'spec';
  return 'other';
}

/**
 * The directory of change `changeId` at `commit`, or null when there is none. A name that matches
 * more than one directory (active and archived, or two archive folders) throws
 * AmbiguousChangeError: the approval would otherwise cover whichever one a rule happened to pick.
 */
export async function findChangeDir(
  reader: GitFileReader,
  commit: string,
  changeId: string,
): Promise<ChangeDir | null> {
  const matches = [
    ...(await listActiveChanges(reader, commit)),
    ...(await listArchivedChanges(reader, commit)),
  ].filter((dir) => dir.id === changeId);
  if (matches.length > 1) {
    throw new AmbiguousChangeError(
      changeId,
      matches.map((dir) => dir.path),
    );
  }
  return matches[0] ?? null;
}

export async function approvalInputs(
  reader: GitFileReader,
  commit: string,
  changeId: string,
): Promise<ApprovalInput[]> {
  assertChangeId(changeId);
  const dir = await findChangeDir(reader, commit, changeId);
  if (dir === null) throw new ChangeNotFoundError(changeId);

  const inputs: ApprovalInput[] = [];
  for (const entry of await walkTree(reader, commit, dir.path)) {
    // Symlinks are listed as blobs (mode 120000) and refused by reader.read below.
    if (entry.type !== 'blob') continue;
    const relPath = entry.path.slice(dir.path.length + 1);
    const bytes = await reader.read(commit, entry.path);
    if (bytes === null) throw new Error(`Input ${entry.path} disappeared while reading.`);
    const kind = inputKind(relPath);
    const normalized =
      kind === 'tasks'
        ? new TextEncoder().encode(
            normalizeTasks(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
          )
        : null;
    inputs.push({
      path: entry.path,
      sourcePath: entry.path,
      label: relPath,
      kind,
      normalization: normalized === null ? null : TASKS_NORMALIZER,
      bytes: normalized ?? bytes,
    });
  }
  if (inputs.length === 0) throw new ChangeNotFoundError(changeId);

  return inputs.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}

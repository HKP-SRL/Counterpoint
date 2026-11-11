// Where OpenSpec keeps its planning truth inside a host repository, and how a change directory is
// walked. Shared by the snapshot reader and the approval-input rule so both find the same changes
// and the same files.
//
//   openspec/config.yaml                            detection (host-planning: Host detection)
//   openspec/changes/<id>/                          an active change
//   openspec/changes/archive/<YYYY-MM-DD>-<id>/     an archived (finished) change
//
// A directory whose name is not a change id (openspec-host-adapter design decision 1) is ignored,
// like `archive` itself.
import type { GitFileReader, TreeEntry } from '../../core/framework/port.ts';
import { isChangeId } from '../../core/ids.ts';

export const OPENSPEC_DIR = 'openspec';
export const CONFIG_NAME = 'config.yaml';
export const CONFIG_PATH = `${OPENSPEC_DIR}/${CONFIG_NAME}`;
export const CHANGES_DIR = `${OPENSPEC_DIR}/changes`;
export const ARCHIVE_DIR = `${CHANGES_DIR}/archive`;

export const PROPOSAL_NAME = 'proposal.md';
export const DESIGN_NAME = 'design.md';
export const TASKS_NAME = 'tasks.md';
export const METADATA_NAME = '.openspec.yaml';
export const SPECS_NAME = 'specs';

export const SYMLINK_MODE = '120000';

const ARCHIVED_RE = /^(\d{4}-\d{2}-\d{2})-(.+)$/;

export interface ChangeDir {
  id: string;
  /** Repository-relative path of the change directory. */
  path: string;
  archived: boolean;
  archivedOn: string | null;
}

/** The active change directories at `commit`, in listing order. */
export async function listActiveChanges(
  reader: GitFileReader,
  commit: string,
): Promise<ChangeDir[]> {
  return (await reader.list(commit, CHANGES_DIR)).flatMap((entry) =>
    entry.type === 'tree' && isChangeId(entry.name)
      ? [{ id: entry.name, path: entry.path, archived: false, archivedOn: null }]
      : [],
  );
}

/** The archived change directories at `commit`, in listing order. */
export async function listArchivedChanges(
  reader: GitFileReader,
  commit: string,
): Promise<ChangeDir[]> {
  return (await reader.list(commit, ARCHIVE_DIR)).flatMap((entry) => {
    const match = entry.type === 'tree' ? ARCHIVED_RE.exec(entry.name) : null;
    if (!match || !isChangeId(match[2])) return [];
    return [
      { id: match[2] as string, path: entry.path, archived: true, archivedOn: match[1] as string },
    ];
  });
}

/**
 * Every entry under `dir` at `commit`, recursively (trees are descended, not returned). Symlinks
 * are listed as blobs with mode 120000; callers decide whether to refuse them.
 */
export async function walkTree(
  reader: GitFileReader,
  commit: string,
  dir: string,
  /** The listing of `dir` itself, when the caller already has it. */
  listed?: readonly TreeEntry[],
): Promise<TreeEntry[]> {
  const out: TreeEntry[] = [];
  for (const entry of listed ?? (await reader.list(commit, dir))) {
    if (entry.type === 'tree') out.push(...(await walkTree(reader, commit, entry.path)));
    else out.push(entry);
  }
  return out;
}

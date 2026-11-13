// Whether a merged build PR still makes its change built (runway: A merged build PR means built).
//
// A merged PR is keyed by the change's name, so on its own it would mark built forever: a build
// task added after the merge would never build, and a new change that reuses the name would start
// Built. It counts only while every build task open at the base tip now is one that build covered:
// open when the build started (a build is green only once none is left) or ticked by it. When the
// build's own task list cannot be read and it recorded no ticks, there is nothing to compare with
// and the merge counts, as before.
import type { ChangeFacts, FrameworkAdapter, GitFileReader } from '../framework/port.ts';
import { openBuildTasks } from './status.ts';

export interface MergedBuild {
  /** The base commit the build started from, when it was recorded. */
  baseCommit: string | null;
  /** The tasks the build ticked, by their text. */
  ticks: readonly string[];
}

async function textAt(reader: GitFileReader, commit: string, path: string) {
  try {
    const bytes = await reader.read(commit, path);
    return bytes === null ? null : new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** True while the merged build covers every build task of `change` open at `tip`. */
export async function mergeCovers(input: {
  reader: GitFileReader;
  adapter: Pick<FrameworkAdapter, 'tasksPath' | 'openTasks'>;
  tip: string;
  change: ChangeFacts;
  build: MergedBuild;
}): Promise<boolean> {
  const { reader, adapter, tip, change, build } = input;
  if (openBuildTasks(change) === 0) return true;
  const path = adapter.tasksPath(change);
  if (path === null) return true;
  const now = await textAt(reader, tip, path);
  if (now === null) return true;
  const open = adapter.openTasks(now);
  if (open.length === 0) return true;
  const covered = new Set(build.ticks);
  const before = build.baseCommit === null ? null : await textAt(reader, build.baseCommit, path);
  if (before !== null) for (const task of adapter.openTasks(before)) covered.add(task);
  if (before === null && covered.size === 0) return true;
  return open.every((task) => covered.has(task));
}

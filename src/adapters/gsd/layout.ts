// Where GSD keeps its planning truth inside a host repository. Shared by the snapshot reader and
// the approval-input rule so both find the roadmap and the phase directories the same way.
import { type GitFileReader, parsePhaseNumber } from '../../core/framework/port.ts';

export const PLANNING_DIR = '.planning';
export const ROADMAP_NAME = 'ROADMAP.md';
export const ROADMAP_PATH = `${PLANNING_DIR}/${ROADMAP_NAME}`;
export const PHASES_DIR = `${PLANNING_DIR}/phases`;

const PHASE_DIR_RE = /^(\d+(?:\.\d+)?)-(.+)$/;

export interface PhaseDir {
  /** Repository-relative path of the phase directory. */
  path: string;
  number: number[];
}

/** The phase directories at `commit` (tree entries named `N[.M]-slug`), in listing order. */
export async function listPhaseDirs(reader: GitFileReader, commit: string): Promise<PhaseDir[]> {
  return (await reader.list(commit, PHASES_DIR)).flatMap((entry) => {
    const match = entry.type === 'tree' ? PHASE_DIR_RE.exec(entry.name) : null;
    const number = match ? parsePhaseNumber(match[1] as string) : null;
    return number ? [{ path: entry.path, number }] : [];
  });
}

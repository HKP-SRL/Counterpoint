// Stub for the RED step.
import type { GitFileReader, PlanFacts, UnreadableFile } from '../../core/framework/port.ts';

export interface PhaseDirectoryFacts {
  hasContext: boolean;
  plans: PlanFacts[];
  unreadable: UnreadableFile | null;
}

export async function readPhaseDirectory(
  _reader: GitFileReader,
  _commit: string,
  _dirPath: string,
): Promise<PhaseDirectoryFacts> {
  return { hasContext: false, plans: [], unreadable: null };
}

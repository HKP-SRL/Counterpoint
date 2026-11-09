// The GSD framework adapter: recognises a GSD host and turns its committed `.planning/` content
// into a PlanSnapshot. Reads go only through the core GitFileReader at a commit, never the working
// tree (D-03). The ROADMAP is the list of phases: every roadmap phase is reported, with or without
// a directory; a directory with no roadmap phase is ignored.
import {
  comparePhaseNumbers,
  type FrameworkAdapter,
  formatPhaseId,
  type GitFileReader,
  type PhaseFacts,
  type PlanSnapshot,
} from '../../core/framework/port.ts';
import { isPhaseId } from '../../core/ids.ts';
import { approvalInputs } from './inputs.ts';
import { listPhaseDirs, PLANNING_DIR, ROADMAP_NAME, ROADMAP_PATH } from './layout.ts';
import { readPhaseDirectory } from './plans.ts';
import { parseRoadmap } from './roadmap.ts';

const ADAPTER_ID = 'gsd';

function oneLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (message.split('\n')[0] ?? '').slice(0, 200);
}

async function detect(reader: GitFileReader, commit: string): Promise<boolean> {
  const entries = await reader.list(commit, PLANNING_DIR);
  return entries.some((entry) => entry.name === ROADMAP_NAME && entry.type === 'blob');
}

async function snapshot(reader: GitFileReader, commit: string): Promise<PlanSnapshot> {
  const empty = (unreadable: PlanSnapshot['unreadable']): PlanSnapshot => ({
    framework: ADAPTER_ID,
    commit,
    phases: [],
    unreadable,
  });

  let text: string;
  try {
    const bytes = await reader.read(commit, ROADMAP_PATH);
    if (bytes === null) return empty(null);
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    return empty({ file: ROADMAP_PATH, reason: oneLine(error) });
  }

  const dirs = await listPhaseDirs(reader, commit);

  const phases: PhaseFacts[] = [];
  const seen = new Set<string>();
  for (const section of parseRoadmap(text)) {
    const id = formatPhaseId(section.number);
    // An id outside the addressable range cannot be shown or approved; a repeated heading keeps
    // its first occurrence.
    if (!isPhaseId(id) || seen.has(id)) continue;
    seen.add(id);

    const dir = dirs.find((d) => comparePhaseNumbers(d.number, section.number) === 0) ?? null;
    const rows = new Map(section.planRows.map((row) => [row.file, row.text]));
    const facts = dir
      ? await readPhaseDirectory(reader, commit, dir.path, rows)
      : { hasContext: false, plans: [], unreadable: null };

    phases.push({
      id,
      number: section.number,
      name: section.name,
      inserted: section.inserted,
      dir: dir?.path ?? null,
      goal: section.goal,
      dependsOn: section.dependsOn,
      requirements: section.requirements,
      hasContext: facts.hasContext,
      plans: facts.plans,
      unreadable: facts.unreadable,
    });
  }

  phases.sort((a, b) => comparePhaseNumbers(a.number, b.number));
  return { framework: ADAPTER_ID, commit, phases, unreadable: null };
}

export function createGsdAdapter(): FrameworkAdapter {
  return {
    id: ADAPTER_ID,
    detect,
    snapshot,
    approvalInputs,
  };
}

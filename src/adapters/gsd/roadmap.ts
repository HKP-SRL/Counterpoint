// Stub for the RED step.
export interface RoadmapPlanRow {
  file: string;
  text: string;
}

export interface RoadmapPhase {
  number: number[];
  name: string;
  inserted: boolean;
  goal: string | null;
  dependsOn: string | null;
  requirements: string | null;
  planRows: RoadmapPlanRow[];
  sectionText: string;
}

export function parseRoadmap(_text: string): RoadmapPhase[] {
  return [];
}

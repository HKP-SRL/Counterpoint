// GSD ROADMAP.md parser.
//
// A phase section starts at a top-level depth-3 heading `### Phase N: Name` (optionally ending in
// `(INSERTED)`) and ends where the next depth-1/2/3 heading starts, or at EOF. Headings are found
// through the markdown AST, so a `### Phase` line inside a code fence (a `code` node) is never a
// phase. Phase numbers become integer tuples: `1.1` and `01.1` are both [1, 1], and `1.10` stays
// distinct from `1.1`.
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { parsePhaseNumber } from '../../core/framework/port.ts';

export interface RoadmapPlanRow {
  /** The plan file name the row names (`01-01-PLAN.md`). */
  file: string;
  /** The text after the dash, used as a fallback objective. */
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
  /** The exact slice of the roadmap for this phase, heading included (by AST offsets). */
  sectionText: string;
}

const PHASE_HEADING_RE = /^Phase (\d+(?:\.\d+)?):\s*(.+?)(?:\s*\(INSERTED\))?$/;
const INSERTED_RE = /\(INSERTED\)\s*$/;
const PLAN_ROW_RE = /^[ \t]*[-*] \[[ xX]\] (\S+-PLAN\.md)(?:[ \t]+(?:[—–-][ \t]*)?(.*))?$/gm;

const parser = unified().use(remarkParse);
type Root = ReturnType<typeof parser.parse>;
type MdNode = Root['children'][number];

/** The plain text of a node: its value, or its children's text concatenated. */
function textOf(node: unknown): string {
  if (typeof node !== 'object' || node === null) return '';
  if ('value' in node && typeof node.value === 'string') return node.value;
  if ('children' in node && Array.isArray(node.children)) return node.children.map(textOf).join('');
  return '';
}

/** `**Label**: value` or `**Label:** value` on its own line. */
function field(section: string, label: string): string | null {
  const re = new RegExp(`^\\*\\*${label}(?:\\*\\*:|:\\*\\*)[ \\t]*(.*)$`, 'm');
  const value = re.exec(section)?.[1]?.trim();
  return value ? value : null;
}

function planRows(section: string): RoadmapPlanRow[] {
  const rows: RoadmapPlanRow[] = [];
  for (const match of section.matchAll(PLAN_ROW_RE)) {
    rows.push({ file: match[1] as string, text: (match[2] ?? '').trim() });
  }
  return rows;
}

function isSectionBoundary(node: MdNode): boolean {
  return node.type === 'heading' && node.depth <= 3;
}

export function parseRoadmap(text: string): RoadmapPhase[] {
  const tree = parser.parse(text);
  const children = tree.children;
  const phases: RoadmapPhase[] = [];

  children.forEach((node, index) => {
    if (node.type !== 'heading' || node.depth !== 3) return;
    const heading = textOf(node).trim();
    const match = PHASE_HEADING_RE.exec(heading);
    const number = match ? parsePhaseNumber(match[1] as string) : null;
    const start = node.position?.start.offset;
    if (!match || number === null || start === undefined) return;

    const next = children.slice(index + 1).find(isSectionBoundary);
    const end = next?.position?.start.offset ?? text.length;
    const sectionText = text.slice(start, end);

    phases.push({
      number,
      name: (match[2] as string).trim(),
      inserted: INSERTED_RE.test(heading),
      goal: field(sectionText, 'Goal'),
      dependsOn: field(sectionText, 'Depends on'),
      requirements: field(sectionText, 'Requirements'),
      planRows: planRows(sectionText),
      sectionText,
    });
  });

  return phases;
}

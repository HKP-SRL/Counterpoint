// proposal.md: the change's title and its "Why" section.
//
// Headings are found through the markdown AST, so a `# ` line inside a code fence is never the
// title. The title is the first depth-1 heading (else the change id); "why" is the raw text
// between a `## Why` heading and the next heading of depth 1 or 2, trimmed and capped.
import remarkParse from 'remark-parse';
import { unified } from 'unified';

const WHY_MAX = 1_200;
const TITLE_MAX = 200;

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

function cap(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export interface ProposalFacts {
  title: string | null;
  why: string | null;
}

export function parseProposal(text: string): ProposalFacts {
  const children = parser.parse(text).children;
  let title: string | null = null;
  let why: string | null = null;

  children.forEach((node: MdNode, index) => {
    if (node.type !== 'heading') return;
    const heading = textOf(node).replace(/\s+/g, ' ').trim();
    if (title === null && node.depth === 1 && heading !== '') title = cap(heading, TITLE_MAX);
    if (why !== null || node.depth !== 2 || heading.toLowerCase() !== 'why') return;
    const start = node.position?.end.offset;
    if (start === undefined) return;
    const next = children
      .slice(index + 1)
      .find((n: MdNode) => n.type === 'heading' && n.depth <= 2);
    const end = next?.position?.start.offset ?? text.length;
    const body = text.slice(start, end).trim();
    if (body !== '') why = cap(body, WHY_MAX);
  });

  return { title, why };
}

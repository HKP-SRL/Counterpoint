// The ROADMAP-section normalizer `cp-gsd-roadmap-section/v1` (owner-locked decision).
//
// A GSD phase section carries mutable progress bookkeeping next to the spec: plan-row checkboxes
// get ticked and the `**Plans**:` line moves from `TBD` to `2 plans` to `2/2 plans executed` as
// work proceeds. Hashing the raw section would flag an approved phase as changed on every such
// update (RESEARCH Pitfall 4). The section is therefore normalized before it is hashed, and the
// normalizer id is recorded next to the digest.
//
// The rules are exactly these and nothing else, so edits to Goal, Depends on, Requirements or
// Success Criteria still change the normalized bytes:
//   1. CRLF and lone CR become LF.
//   2. Trailing whitespace is stripped from every line.
//   3. A plan row `- [x] NN-MM-PLAN.md ...` (any of ` `, `x`, `X`) reads `- [ ]`; the rest of the
//      line is unchanged.
//   4. The `**Plans**:` / `**Plans:**` bookkeeping line is dropped.
//   5. Leading and trailing blank lines are trimmed and the text ends with exactly one LF.
//
// Changing any rule means a new normalizer id (`.../v2`), never an edit to v1: approvals recorded
// with v1 must keep verifying.

export const ROADMAP_SECTION_NORMALIZER = 'cp-gsd-roadmap-section/v1';

const PLAN_ROW_RE = /^(\s*)- \[[ xX]\] (\S+-PLAN\.md)/;
const PLANS_LINE_RE = /^\s*\*\*Plans(?:\*\*:|:\*\*)/;
const TRAILING_WS_RE = /\s+$/;

export function normalizeRoadmapSection(text: string): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(TRAILING_WS_RE, ''))
    .map((line) => line.replace(PLAN_ROW_RE, '$1- [ ] $2'))
    .filter((line) => !PLANS_LINE_RE.test(line));

  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === '') start++;
  while (end > start && lines[end - 1] === '') end--;

  return `${lines.slice(start, end).join('\n')}\n`;
}

// tasks.md: task progress, owner steps, and the normalizer `cp-openspec-tasks/v1`.
//
// A task line is matched exactly the way OpenSpec counts its own checkboxes (any list marker,
// leading indent allowed, one marker character inside the brackets; only `x`/`X` is done), so the
// console's progress agrees with `openspec list`. An owner step is an unchecked task whose text,
// after an optional task number, starts with `Owner:`.
//
// The normalizer (openspec-host-adapter design decision 6). The builder ticks boxes as it works, so
// the raw file would knock every approved change off the runway. tasks.md is therefore normalized
// before it is hashed, with exactly these rules and nothing else:
//   1. CRLF and lone CR become LF.
//   2. Trailing whitespace is stripped from every line.
//   3. A done checkbox (`- [x]`, `- [X]`, `- [ x]`, any marker OpenSpec reads as done) reads
//      `- [ ]`; the list marker and the rest of the line are unchanged.
//   4. Leading and trailing blank lines are trimmed and the text ends with exactly one LF.
// Any other edit still changes the digest. Changing a rule means a new normalizer id (`.../v2`),
// never an edit to v1: approvals recorded with v1 must keep verifying.

export const TASKS_NORMALIZER = 'cp-openspec-tasks/v1';

/** OpenSpec's task-line pattern (marker in group 1, description in group 2). */
const TASK_LINE_RE = /^\s*(?:[-*+]|\d{1,9}[.)])\s*\[(?:\s*([^\]\s]?)\s*\](?![([])|\s+\])\s*(.*)/;
/** A done checkbox and everything before it, for the normalizer. */
const DONE_BOX_RE = /^(\s*(?:[-*+]|\d{1,9}[.)])\s*)\[\s*[xX]\s*\](?![([])/;
const TASK_NUMBER_RE = /^\d+(?:\.\d+)*\.?\s+/;
const OWNER_RE = /^Owner:/;
const TRAILING_WS_RE = /\s+$/;
const STEP_MAX = 300;
const MAX_OWNER_STEPS = 50;

export interface TaskProgress {
  total: number;
  done: number;
  ownerSteps: string[];
}

function clip(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= STEP_MAX
    ? collapsed
    : `${collapsed.slice(0, STEP_MAX - 1).trimEnd()}…`;
}

export function countTasks(text: string): TaskProgress {
  let total = 0;
  let done = 0;
  const ownerSteps: string[] = [];
  for (const line of text.split('\n')) {
    const match = TASK_LINE_RE.exec(line);
    if (!match) continue;
    total += 1;
    const isDone = (match[1] ?? '').toLowerCase() === 'x';
    if (isDone) {
      done += 1;
      continue;
    }
    const description = (match[2] ?? '').trim().replace(TASK_NUMBER_RE, '');
    if (OWNER_RE.test(description) && ownerSteps.length < MAX_OWNER_STEPS) {
      ownerSteps.push(clip(description));
    }
  }
  return { total, done, ownerSteps };
}

export function normalizeTasks(text: string): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(TRAILING_WS_RE, ''))
    .map((line) => line.replace(DONE_BOX_RE, '$1[ ]'));

  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === '') start++;
  while (end > start && lines[end - 1] === '') end--;

  return `${lines.slice(start, end).join('\n')}\n`;
}

/**
 * Open tasks that are not owner steps, by their text, in file order: the work a build has left.
 * The task number stays on (it is how a builder and the owner name a task).
 */
export function openBuildTasks(text: string): string[] {
  const open: string[] = [];
  for (const task of taskLines(text)) {
    if (task.done) continue;
    if (OWNER_RE.test(task.description.replace(TASK_NUMBER_RE, ''))) continue;
    open.push(task.description);
  }
  return open;
}

/** Each task line's description and whether it is done, in file order. */
function taskLines(text: string): { description: string; done: boolean }[] {
  const tasks: { description: string; done: boolean }[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const match = TASK_LINE_RE.exec(line);
    if (!match) continue;
    tasks.push({
      description: clip(match[2] ?? ''),
      done: (match[1] ?? '').toLowerCase() === 'x',
    });
  }
  return tasks;
}

/**
 * Tasks open in `before` and done in `after`, matched by their text (a task listed twice is
 * matched once per listing). Returned in `after` order.
 */
export function tickedTasks(before: string, after: string): string[] {
  const open = new Map<string, number>();
  for (const task of taskLines(before)) {
    if (!task.done) open.set(task.description, (open.get(task.description) ?? 0) + 1);
  }
  const ticked: string[] = [];
  for (const task of taskLines(after)) {
    if (!task.done) continue;
    const left = open.get(task.description) ?? 0;
    if (left === 0) continue;
    open.set(task.description, left - 1);
    ticked.push(task.description);
  }
  return ticked;
}

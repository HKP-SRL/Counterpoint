// The builder's ask-first questions (build-runs: Ask first before what cannot be undone; needs-you:
// Builder questions in Needs You; design D-7).
//
// A builder never takes an action it cannot undo outside its worktree. It leaves that task, writes
// the question in BLOCKED_FILE in this format, and goes on with every task that does not wait on
// it:
//
//   ## Question
//   Task: 3.2 Run the migration on the hosted database
//   Question: The migration drops the orders_old table on the hosted database. Run it now?
//   Options:
//   1. Run it against the hosted database now
//   2. Leave it for you to run after the merge
//   3. Rewrite it to keep the old table
//   Recommended: 2
//   Waiting: 3.3, 3.4
//
// One block per question. The parser is lenient (any heading level, bullets or numbers, a
// recommendation by number, by text or as `(recommended)` after an option) and never throws: what
// it cannot read is simply not a question, and the note's text still reaches the owner.

import type { ChangeQuestion } from '../core/store/runs.ts';

/**
 * One question: the task it is about, the question, the options (2 to 4 as the builder is told;
 * more are kept, up to MAX_OPTIONS), the index of the recommended one (or null), and the tasks
 * that wait on the answer.
 */
export type BuilderQuestion = ChangeQuestion;

const MAX_QUESTIONS = 10;
const MAX_OPTIONS = 8;
const MAX_TEXT = 1000;
const HEADING_RE = /^\s{0,3}#{1,6}\s*question\b.*$/i;
const KEY_RE =
  /^\s*[-*]?\s*\**(task|question|options|recommended|recommendation|waiting|waits)\**\s*:\s*\**\s*(.*)$/i;
const ITEM_RE = /^\s*(?:[-*+]|\d{1,2}[.)]|[a-hA-H][.)])\s+(.*)$/;
const RECOMMENDED_MARK_RE =
  /\s*\((?:recommended|my recommendation)\)\s*$|\s*\*\*recommended\*\*\s*$/i;

const clip = (text: string): string => {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.length <= MAX_TEXT ? trimmed : `${trimmed.slice(0, MAX_TEXT - 1)}…`;
};

function recommendationIndex(value: string, options: readonly string[]): number | null {
  const text = value.trim();
  if (text === '') return null;
  const number = /^(?:option\s*)?(\d{1,2})\b/i.exec(text);
  if (number !== null) {
    const index = Number(number[1]) - 1;
    return index >= 0 && index < options.length ? index : null;
  }
  const letter = /^(?:option\s*)?([a-h])(?:[.)]|\s|$)/i.exec(text);
  if (letter !== null && options.length > 0) {
    const index = (letter[1] as string).toLowerCase().charCodeAt(0) - 97;
    if (index < options.length) return index;
  }
  const lower = text.toLowerCase();
  const found = options.findIndex(
    (option) => option.toLowerCase() === lower || lower.startsWith(option.toLowerCase()),
  );
  return found < 0 ? null : found;
}

function parseBlock(lines: readonly string[]): BuilderQuestion | null {
  let task: string | null = null;
  let text = '';
  let recommendedRaw = '';
  let waiting: string[] = [];
  const options: string[] = [];
  let marked: number | null = null;
  let current: 'question' | 'options' | null = null;
  for (const line of lines) {
    const key = KEY_RE.exec(line);
    if (key !== null) {
      const name = (key[1] as string).toLowerCase();
      const value = (key[2] as string).trim();
      if (name === 'task') {
        task = value === '' ? null : clip(value);
        current = null;
      } else if (name === 'question') {
        text = value;
        current = 'question';
      } else if (name === 'options') {
        current = 'options';
      } else if (name === 'recommended' || name === 'recommendation') {
        recommendedRaw = value;
        current = null;
      } else {
        waiting = value
          .split(/[,;]|\s+and\s+/)
          .map((entry) => entry.trim())
          .filter((entry) => entry !== '' && !/^none$/i.test(entry));
        current = null;
      }
      continue;
    }
    const item = ITEM_RE.exec(line);
    if (current === 'options' && item !== null) {
      if (options.length >= MAX_OPTIONS) continue;
      let option = item[1] as string;
      if (RECOMMENDED_MARK_RE.test(option)) {
        option = option.replace(RECOMMENDED_MARK_RE, '');
        marked = options.length;
      }
      const clipped = clip(option);
      if (clipped !== '') options.push(clipped);
      continue;
    }
    if (current === 'question' && line.trim() !== '') text += ` ${line.trim()}`;
  }
  const question = clip(text);
  if (question === '') return null;
  return {
    task,
    text: question,
    options,
    recommended: recommendationIndex(recommendedRaw, options) ?? marked,
    waiting,
  };
}

/** The questions in a builder's blocked note, in order; empty when it holds none. */
export function parseQuestions(note: string): BuilderQuestion[] {
  const lines = note.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[][] = [];
  let block: string[] | null = null;
  for (const line of lines) {
    if (HEADING_RE.test(line)) {
      block = [];
      blocks.push(block);
      continue;
    }
    if (/^\s{0,3}#{1,6}\s/.test(line)) {
      block = null;
      continue;
    }
    block?.push(line);
  }
  const questions: BuilderQuestion[] = [];
  for (const lines_ of blocks) {
    const question = parseBlock(lines_);
    if (question !== null) questions.push(question);
    if (questions.length >= MAX_QUESTIONS) break;
  }
  return questions;
}

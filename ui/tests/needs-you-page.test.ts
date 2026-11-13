// Needs You cards (question-cards: Card contents, Answer in one step): which key picks which
// option, and what the note field says it does.
import { describe, expect, it } from 'vitest';
import { cardKeys, noteHint, optionKey, type QuestionCard } from '../src/pages/NeedsYouPage';

const option = (label: string, merges = false) => ({
  label,
  consequence: `${label}.`,
  acts: merges,
  merges,
});

function card(overrides: Partial<QuestionCard> = {}): QuestionCard {
  return {
    id: 'c-0000000000000001',
    kind: 'ask',
    source: 'session',
    runId: null,
    change: null,
    session: 'a Claude Code session',
    question: 'Which colour?',
    why: 'The header needs one.',
    options: [option('Blue'), option('Green'), option('Red')],
    recommended: 1,
    reversible: true,
    blocking: false,
    state: 'open',
    answer: null,
    note: null,
    outcome: null,
    write: null,
    diff: null,
    prUrl: null,
    createdAt: 1,
    ...overrides,
  };
}

const landIt = () =>
  card({
    kind: 'owner-step-result',
    options: [option('Land it', true), option('Discard')],
    recommended: 0,
  });

describe('option keys', () => {
  it('Enter picks the recommended option, digits the others', () => {
    expect([0, 1, 2].map((index) => optionKey(card(), index))).toEqual(['1', 'Enter', '3']);
  });

  it('an option that merges into the base shows its digit, never Enter', () => {
    expect([0, 1].map((index) => optionKey(landIt(), index))).toEqual(['1', '2']);
    expect(cardKeys(landIt()).merging).toEqual([0]);
  });
});

describe('note field hint', () => {
  it('names Enter for the recommended option and Cmd digits for the rest', () => {
    expect(noteHint(card(), true)).toBe(
      'Enter sends it with the recommended option, ⌘1–⌘3 with another.',
    );
    expect(noteHint(card({ options: [option('A'), option('B')] }), false)).toBe(
      'Enter sends it with the recommended option, Ctrl+1–Ctrl+2 with another.',
    );
  });

  it('does not offer Enter when the recommended option merges into the base', () => {
    expect(noteHint(landIt(), true)).toBe('⌘1–⌘2 sends it with that option.');
  });
});

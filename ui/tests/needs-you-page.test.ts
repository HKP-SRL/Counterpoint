// Needs You cards (question-cards: Card contents, Answer in one step): which key picks which
// option, and what the note field says it does.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  askedText,
  CardBlock,
  cardKeys,
  noteHint,
  optionKey,
  originParts,
  type QuestionCard,
} from '../src/pages/NeedsYouPage';

const option = (label: string, merges = false, later = false) => ({
  label,
  consequence: `${label}.`,
  acts: merges || later,
  merges,
  later,
});

function card(overrides: Partial<QuestionCard> = {}): QuestionCard {
  return {
    id: 'c-0000000000000001',
    hostId: 'cena',
    kind: 'ask',
    source: 'session',
    runId: null,
    change: null,
    session: 'your Claude Code session',
    folder: null,
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
    askedAt: null,
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

describe('where a card came from', () => {
  const now = new Date(2026, 10, 13, 15, 0).getTime();
  const at = new Date(2026, 10, 13, 14, 2).getTime();
  const time = new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  it('says when a question was asked: the time today, the day before that', () => {
    expect(askedText(at, now)).toBe(`asked ${time}`);
    const earlier = new Date(2026, 10, 11, 14, 2).getTime();
    expect(askedText(earlier, now)).toMatch(/^asked .+ .+$/);
    expect(askedText(earlier, now)).not.toBe(`asked ${time}`);
    expect(askedText(0, now)).toBe('');
  });

  it("an interactive session's card names the session, its project, its folder and when", () => {
    const ask = card({ createdAt: at, folder: '/Users/me/src/cena/ui' });
    expect(originParts(ask, 'cena', now)).toEqual([
      'Your Claude Code session',
      'cena',
      'folder ui',
      `asked ${time}`,
    ]);
    // Without a folder from the server, the rest still shows.
    expect(originParts(card({ createdAt: at }), 'cena', now)).toEqual([
      'Your Claude Code session',
      'cena',
      `asked ${time}`,
    ]);
    // A session outside every project asks in every inbox.
    expect(originParts(card({ hostId: null, createdAt: at }), null, now)).toEqual([
      'Your Claude Code session',
      'outside your projects',
      `asked ${time}`,
    ]);
  });

  it('prefers the time the server says it was asked', () => {
    const asked = new Date(2026, 10, 13, 9, 30).getTime();
    const nine = new Date(asked).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(originParts(card({ createdAt: at, askedAt: asked }), 'cena', now)).toContain(
      `asked ${nine}`,
    );
  });

  it("a builder's card names the session and the run after the change link", () => {
    const builder = card({
      change: 'menu-header',
      session: 'builder session 2',
      runId: 'run-1',
      createdAt: at,
      reversible: false,
    });
    expect(originParts(builder, 'cena', now)).toEqual([
      'builder session 2',
      'run run-1',
      `asked ${time}`,
      'hard to undo',
    ]);
  });

  it('other cards say the run or the Mac, and nothing more when a change says it', () => {
    expect(originParts(card({ source: 'run', session: null }), 'cena', now)).toEqual(['The run']);
    expect(originParts(card({ source: 'machine', session: null }), null, now)).toEqual([
      'This Mac',
    ]);
    expect(
      originParts(card({ source: 'change', session: null, change: 'menu-header' }), 'cena', now),
    ).toEqual([]);
  });

  it('renders the where-line as text on the card', () => {
    const html = renderToStaticMarkup(
      createElement(CardBlock, {
        hostId: 'cena',
        project: 'cena',
        card: card({ createdAt: at, folder: 'web' }),
        detail: undefined,
        isFocused: false,
        isBusy: false,
        isNoteOpen: false,
        note: '',
        onFocus: () => undefined,
        onNote: () => undefined,
        onOpenNote: () => undefined,
        onAnswer: () => undefined,
        onNoteEnter: () => undefined,
        onLater: () => undefined,
      }),
    );
    expect(html).toContain(`Your Claude Code session · cena · folder web · asked ${time}`);
  });
});

describe('Later', () => {
  const render = (c: QuestionCard) =>
    renderToStaticMarkup(
      createElement(CardBlock, {
        hostId: 'cena',
        project: 'cena',
        card: c,
        detail: undefined,
        isFocused: true,
        isBusy: false,
        isNoteOpen: false,
        note: '',
        onFocus: () => undefined,
        onNote: () => undefined,
        onOpenNote: () => undefined,
        onAnswer: () => undefined,
        onNoteEnter: () => undefined,
        onLater: () => undefined,
      }),
    );
  const laterButtons = (html: string) => html.match(/>Later</g)?.length ?? 0;

  it('a card shows its own Later button', () => {
    expect(laterButtons(render(card()))).toBe(1);
  });

  it('a card whose options include Later shows no second Later button', () => {
    const step = card({
      kind: 'owner-step',
      options: [option('Done', true), option('Later', false, true), option('Do it for me')],
    });
    expect(laterButtons(render(step))).toBe(1);
  });
});

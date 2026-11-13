// Question cards in the store (owner-inbox 2.1, D-1): the model's limits are refused, a key finds
// the same card again, and an answer is recorded once.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  answerCard,
  CardRefusal,
  deferCard,
  insertCard,
  listWaitingCards,
  type NewCard,
  resolveMissingCards,
} from '../../../src/core/store/cards.ts';
import { openStore, type Store, upsertHost } from '../../../src/core/store/db.ts';
import { makeScratchDir, removeScratchDirs } from '../../helpers/scratch.ts';

let db: Store;

const option = (label: string) => ({ label, consequence: `${label} happens.` });

function card(overrides: Partial<NewCard> = {}): NewCard {
  return {
    hostId: 'h',
    kind: 'parked',
    source: 'change',
    change: 'add-menu',
    question: 'Retry add-menu?',
    why: 'It parked on a failing gate.',
    options: [option('Retry'), option('Leave it parked')],
    recommended: 0,
    reversible: true,
    blocking: false,
    ...overrides,
  };
}

beforeAll(() => {
  db = openStore(makeScratchDir('cards-home'));
  upsertHost(db, {
    id: 'h',
    root: '/r',
    gitCommonDir: '/r/.git',
    baseBranch: 'main',
    adapter: 'openspec',
  });
});

afterAll(() => {
  db?.close();
  removeScratchDirs();
});

describe('cards', () => {
  it('refuses 1 or 5 options and a recommendation that is not an option', () => {
    expect(() => insertCard(db, card({ options: [option('Only')] }))).toThrow(CardRefusal);
    expect(() => insertCard(db, card({ options: ['A', 'B', 'C', 'D', 'E'].map(option) }))).toThrow(
      CardRefusal,
    );
    expect(() => insertCard(db, card({ recommended: 2 }))).toThrow(CardRefusal);
  });

  it("refuses an action on an agent session's card, and keeps it on Counterpoint's own", () => {
    const withAction = [
      { ...option('Resume'), action: { type: 'resume-run' as const, runId: 'run-1' } },
      option('Later'),
    ];
    expect(() =>
      insertCard(db, card({ source: 'session', sessionId: 's1', options: withAction })),
    ).toThrow(/cannot carry an action/);
    const { card: own } = insertCard(db, card({ source: 'run', options: withAction }));
    expect(own.options[0]?.action).toEqual({ type: 'resume-run', runId: 'run-1' });
    // An action outside the catalog is refused too.
    expect(() =>
      insertCard(
        db,
        card({
          source: 'run',
          options: [{ ...option('Run'), action: { type: 'rm-rf' } as never }, option('No')],
        }),
      ),
    ).toThrow(CardRefusal);
  });

  it('finds the same card for the same key, answers once, and lists blocking first', () => {
    const first = insertCard(db, card({ key: 'k:1', blocking: false }));
    const again = insertCard(db, card({ key: 'k:1', question: 'Different?' }));
    expect(again.created).toBe(false);
    expect(again.card.id).toBe(first.card.id);
    const blocking = insertCard(db, card({ key: 'k:2', blocking: true }), 1);
    const waiting = listWaitingCards(db, 'h').map((c) => c.id);
    expect(waiting[0]).toBe(blocking.card.id);

    expect(() => answerCard(db, first.card.id, { option: 2 })).toThrow(/Not one of the options/);
    const answered = answerCard(db, first.card.id, { option: 1, note: '  try X  ' });
    expect(answered).toMatchObject({ state: 'answered', answer: 1, note: 'try X' });
    expect(() => answerCard(db, first.card.id, { option: 0 })).toThrow(/already answered/);
    expect(() => deferCard(db, first.card.id)).toThrow(CardRefusal);
  });

  it('resolves recomputed cards whose cause went away, and only those', () => {
    const keep = insertCard(db, card({ key: 'run:h:a' })).card;
    const gone = insertCard(db, card({ key: 'run:h:b' })).card;
    const ids = resolveMissingCards(db, 'h', 'run:h:', new Set(['run:h:a']), 'Gone.');
    expect(ids).toEqual([gone.id]);
    const waiting = listWaitingCards(db, 'h').map((c) => c.id);
    expect(waiting).toContain(keep.id);
    expect(waiting).not.toContain(gone.id);
  });
});

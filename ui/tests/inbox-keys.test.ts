// Needs You's keyboard (owner-inbox 2.2): every key, and the keys that must do nothing.
import { describe, expect, it } from 'vitest';
import { focusAfterAnswer, inboxKey } from '../src/inbox-keys';

const cards = [
  { id: 'a', options: 3, recommended: 1 },
  { id: 'b', options: 2, recommended: 0 },
];
const press = (key: string, focused = 0, extra: { modified?: boolean; typing?: boolean } = {}) =>
  inboxKey(
    { key, modified: extra.modified ?? false, typing: extra.typing ?? false },
    cards,
    focused,
  );

describe('inbox keys', () => {
  it('1–4 answer the focused card with that option, if it has one', () => {
    expect(press('1')).toEqual({ type: 'answer', cardId: 'a', option: 0 });
    expect(press('3')).toEqual({ type: 'answer', cardId: 'a', option: 2 });
    expect(press('4')).toBeNull();
    expect(press('3', 1)).toBeNull();
    expect(press('2', 1)).toEqual({ type: 'answer', cardId: 'b', option: 1 });
  });

  it('Enter answers with the recommended option', () => {
    expect(press('Enter')).toEqual({ type: 'answer', cardId: 'a', option: 1 });
    expect(press('Enter', 1)).toEqual({ type: 'answer', cardId: 'b', option: 0 });
  });

  it('L defers, N opens the note, either case', () => {
    expect(press('l')).toEqual({ type: 'later', cardId: 'a' });
    expect(press('L', 1)).toEqual({ type: 'later', cardId: 'b' });
    expect(press('n')).toEqual({ type: 'note', cardId: 'a' });
  });

  it('J/K and the arrows move the focus within the list', () => {
    expect(press('j')).toEqual({ type: 'focus', index: 1 });
    expect(press('j', 1)).toEqual({ type: 'focus', index: 1 });
    expect(press('ArrowDown')).toEqual({ type: 'focus', index: 1 });
    expect(press('k', 1)).toEqual({ type: 'focus', index: 0 });
    expect(press('ArrowUp')).toEqual({ type: 'focus', index: 0 });
  });

  it('does nothing while typing, with a modifier, for other keys or with no cards', () => {
    expect(press('Enter', 0, { typing: true })).toBeNull();
    expect(press('1', 0, { modified: true })).toBeNull();
    expect(press('x')).toBeNull();
    expect(inboxKey({ key: 'Enter', modified: false, typing: false }, [], 0)).toBeNull();
  });

  it('focuses the card that took the answered one’s place', () => {
    expect(focusAfterAnswer(1, 1)).toBe(0);
    expect(focusAfterAnswer(0, 3)).toBe(0);
    expect(focusAfterAnswer(2, 0)).toBe(0);
  });
});

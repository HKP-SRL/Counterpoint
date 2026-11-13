// Needs You's keyboard (owner-inbox 2.2): every key, and the keys that must do nothing.
import { describe, expect, it } from 'vitest';
import {
  ANSWER_GUARD_MS,
  enterAction,
  focusAfterAnswer,
  inboxKey,
  isSettling,
  noteKey,
  resolveFocus,
} from '../src/inbox-keys';

const cards = [
  { id: 'a', options: 3, recommended: 1 },
  { id: 'b', options: 2, recommended: 0 },
];
type Extra = { modified?: boolean; typing?: boolean; onControl?: boolean; settling?: boolean };
const press = (key: string, focused = 0, extra: Extra = {}) =>
  inboxKey(
    {
      key,
      modified: extra.modified ?? false,
      typing: extra.typing ?? false,
      onControl: extra.onControl ?? false,
      settling: extra.settling ?? false,
    },
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

  it('leaves Enter and Space to a focused button or link, but keeps the other keys', () => {
    expect(press('Enter', 0, { onControl: true })).toBeNull();
    expect(press(' ', 0, { onControl: true })).toBeNull();
    expect(press(' ')).toBeNull();
    expect(press('j', 0, { onControl: true })).toEqual({ type: 'focus', index: 1 });
    expect(press('2', 0, { onControl: true })).toEqual({ type: 'answer', cardId: 'a', option: 1 });
  });

  it('answers nothing while the focused card has just changed by itself; J/K/L/N still work', () => {
    expect(press('Enter', 0, { settling: true })).toBeNull();
    expect(press('1', 0, { settling: true })).toBeNull();
    expect(press('j', 0, { settling: true })).toEqual({ type: 'focus', index: 1 });
    expect(press('l', 0, { settling: true })).toEqual({ type: 'later', cardId: 'a' });
    expect(press('n', 0, { settling: true })).toEqual({ type: 'note', cardId: 'a' });
  });

  it('Enter never picks an option that merges into the base: that one needs its digit', () => {
    const landIt = { id: 'land', options: 2, recommended: 0, merging: [0] };
    const enter = inboxKey({ key: 'Enter', modified: false, typing: false }, [landIt], 0);
    expect(enter).toEqual({ type: 'needs-digit', cardId: 'land', option: 0 });
    expect(inboxKey({ key: '1', modified: false, typing: false }, [landIt], 0)).toEqual({
      type: 'answer',
      cardId: 'land',
      option: 0,
    });
    // A merging option that is not the recommended one leaves Enter as it was.
    const laterFirst = { id: 'step', options: 3, recommended: 2, merging: [0] };
    expect(enterAction(laterFirst)).toEqual({ type: 'answer', cardId: 'step', option: 2 });
  });
});

describe('note field keys', () => {
  const card = { id: 'a', options: 3, recommended: 1 };
  it('Cmd or Ctrl with 1–4 picks that option, if the card has it', () => {
    expect(noteKey({ key: '1', command: true }, card)).toEqual({
      type: 'answer',
      cardId: 'a',
      option: 0,
    });
    expect(noteKey({ key: '3', command: true }, card)).toEqual({
      type: 'answer',
      cardId: 'a',
      option: 2,
    });
    expect(noteKey({ key: '4', command: true }, card)).toBeNull();
  });

  it('plain digits and other keys type into the note', () => {
    expect(noteKey({ key: '2', command: false }, card)).toBeNull();
    expect(noteKey({ key: 'Enter', command: true }, card)).toBeNull();
    expect(noteKey({ key: 'a', command: true }, card)).toBeNull();
  });
});

describe('focus follows the card', () => {
  it('stays on the same card when a new one arrives above it', () => {
    expect(resolveFocus(['new', 'a', 'b'], { id: 'a', index: 0 })).toEqual({ id: 'a', index: 1 });
  });

  it('moves to the card that took its place when the focused one left', () => {
    expect(resolveFocus(['a', 'c'], { id: 'b', index: 1 })).toEqual({ id: 'c', index: 1 });
    expect(resolveFocus(['a'], { id: 'b', index: 1 })).toEqual({ id: 'a', index: 0 });
    expect(resolveFocus([], { id: 'b', index: 1 })).toEqual({ id: null, index: 0 });
  });

  it('starts on the first card', () => {
    expect(resolveFocus(['a', 'b'], { id: null, index: 0 })).toEqual({ id: 'a', index: 0 });
  });

  it('after an answer or Later, focuses the card that takes its place', () => {
    expect(focusAfterAnswer(['a', 'b', 'c'], 'b')).toEqual({ id: 'c', index: 1 });
    expect(focusAfterAnswer(['a', 'b'], 'b')).toEqual({ id: 'a', index: 0 });
    expect(focusAfterAnswer(['a'], 'a')).toEqual({ id: null, index: 0 });
  });

  it('settles for about a second after the focus changed by itself, never after the owner moved', () => {
    const since = { id: 'a', at: 10_000, byOwner: false };
    expect(isSettling(since, 10_000 + ANSWER_GUARD_MS - 1)).toBe(true);
    expect(isSettling(since, 10_000 + ANSWER_GUARD_MS)).toBe(false);
    expect(isSettling({ ...since, byOwner: true }, 10_001)).toBe(false);
    expect(ANSWER_GUARD_MS).toBeGreaterThanOrEqual(800);
  });
});

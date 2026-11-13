// Needs You's keyboard (question-cards: Answer in one step; sketch findings: keyboard inbox).
// One key answers the focused card: `1`–`4` pick that option, `Enter` the preselected recommended
// one, `L` defers it (Later). `J`/`K` (or the arrow keys) move the focus, `N` opens the note. Keys
// are ignored while the owner types in a field, a dialog is open, or a modifier is held.
//
// Enter answers only what the owner read:
// - the focus follows a card, not a position, so a card arriving live never takes the focus;
// - when the focused card changed by itself (the one in focus left, or the owner just answered),
//   answer keys wait ANSWER_GUARD_MS before they act on the card now in focus;
// - Enter and Space on a focused button or link belong to that button or link;
// - Enter never picks an option that merges into the base branch: that one needs its digit.
// In the note field, Cmd (or Ctrl) with `1`–`4` picks that option with the note.

export type InboxKeyAction =
  | { type: 'focus'; index: number }
  | { type: 'answer'; cardId: string; option: number }
  | { type: 'later'; cardId: string }
  | { type: 'note'; cardId: string }
  /** Enter on a recommended option that merges into the base: it needs its digit. */
  | { type: 'needs-digit'; cardId: string; option: number };

export interface InboxCardKeys {
  id: string;
  /** How many options the card has (2 to 4). */
  options: number;
  recommended: number;
  /** Options that merge into the base branch: only their digit picks them, never Enter. */
  merging?: readonly number[];
}

export interface InboxKeyInput {
  key: string;
  /** Meta, Ctrl or Alt held. */
  modified: boolean;
  /** Focus is in a text field, or a dialog is open. */
  typing: boolean;
  /** Focus is on a button, link or other control: Enter and Space are its own. */
  onControl?: boolean;
  /** The focused card changed by itself a moment ago: answer keys wait (isSettling). */
  settling?: boolean;
}

/** How long answer keys wait after the focused card changed by itself. */
export const ANSWER_GUARD_MS = 1_000;

/** What Enter does on a card: its recommended option, unless that one merges into the base. */
export function enterAction(card: InboxCardKeys): InboxKeyAction {
  return card.merging?.includes(card.recommended) === true
    ? { type: 'needs-digit', cardId: card.id, option: card.recommended }
    : { type: 'answer', cardId: card.id, option: card.recommended };
}

/** What a key press does, or null when the page should leave it alone. */
export function inboxKey(
  input: InboxKeyInput,
  cards: readonly InboxCardKeys[],
  focused: number,
): InboxKeyAction | null {
  if (input.typing || input.modified || cards.length === 0) return null;
  if (input.onControl === true && (input.key === 'Enter' || input.key === ' ')) return null;
  const index = Math.min(Math.max(focused, 0), cards.length - 1);
  const card = cards[index] as InboxCardKeys;
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  switch (key) {
    case 'j':
    case 'ArrowDown':
      return { type: 'focus', index: Math.min(index + 1, cards.length - 1) };
    case 'k':
    case 'ArrowUp':
      return { type: 'focus', index: Math.max(index - 1, 0) };
    case 'Enter':
      return input.settling === true ? null : enterAction(card);
    case 'l':
      return { type: 'later', cardId: card.id };
    case 'n':
      return { type: 'note', cardId: card.id };
    default: {
      if (!/^[1-4]$/.test(key) || input.settling === true) return null;
      const option = Number(key) - 1;
      return option < card.options ? { type: 'answer', cardId: card.id, option } : null;
    }
  }
}

/**
 * A key in a card's note field: Cmd or Ctrl with `1`–`4` picks that option (the note goes with
 * it). Null for every other key: Enter there is the field's own (enterAction).
 */
export function noteKey(
  input: { key: string; command: boolean },
  card: InboxCardKeys,
): InboxKeyAction | null {
  if (!input.command || !/^[1-4]$/.test(input.key)) return null;
  const option = Number(input.key) - 1;
  return option < card.options ? { type: 'answer', cardId: card.id, option } : null;
}

/** The focus: a card by id, and its last index for when that card leaves the list. */
export interface InboxFocus {
  id: string | null;
  index: number;
}

/** The card in focus: the same card wherever it moved, else the one that took its place. */
export function resolveFocus(ids: readonly string[], focus: InboxFocus): InboxFocus {
  if (ids.length === 0) return { id: null, index: 0 };
  const at = focus.id === null ? -1 : ids.indexOf(focus.id);
  if (at >= 0) return { id: focus.id, index: at };
  const index = Math.min(Math.max(focus.index, 0), ids.length - 1);
  return { id: ids[index] ?? null, index };
}

/**
 * The focus after `cardId` was answered or deferred: the card that takes its place (the next one,
 * else the one before). A deferred card moves to the end, so the focus does not follow it.
 */
export function focusAfterAnswer(ids: readonly string[], cardId: string): InboxFocus {
  const at = ids.indexOf(cardId);
  const rest = ids.filter((id) => id !== cardId);
  if (rest.length === 0) return { id: null, index: 0 };
  const index = Math.min(Math.max(at, 0), rest.length - 1);
  return { id: rest[index] ?? null, index };
}

/** When the card in focus became focused, and whether the owner moved there (J/K, a click). */
export interface FocusSince {
  id: string | null;
  at: number;
  byOwner: boolean;
}

/** True while answer keys wait: the focused card changed by itself less than a second ago. */
export function isSettling(since: FocusSince, now: number): boolean {
  return !since.byOwner && now - since.at < ANSWER_GUARD_MS;
}

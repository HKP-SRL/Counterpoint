// Needs You's keyboard (question-cards: Answer in one step; sketch findings: keyboard inbox).
// One key answers the focused card: `1`–`4` pick that option, `Enter` the preselected recommended
// one, `L` defers it (Later). `J`/`K` (or the arrow keys) move the focus, `N` opens the note. Keys
// are ignored while the owner types in a field, a dialog is open, or a modifier is held.

export type InboxKeyAction =
  | { type: 'focus'; index: number }
  | { type: 'answer'; cardId: string; option: number }
  | { type: 'later'; cardId: string }
  | { type: 'note'; cardId: string };

export interface InboxCardKeys {
  id: string;
  /** How many options the card has (2 to 4). */
  options: number;
  recommended: number;
}

export interface InboxKeyInput {
  key: string;
  /** Meta, Ctrl or Alt held. */
  modified: boolean;
  /** Focus is in a text field, or a dialog is open. */
  typing: boolean;
}

/** What a key press does, or null when the page should leave it alone. */
export function inboxKey(
  input: InboxKeyInput,
  cards: readonly InboxCardKeys[],
  focused: number,
): InboxKeyAction | null {
  if (input.typing || input.modified || cards.length === 0) return null;
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
      return { type: 'answer', cardId: card.id, option: card.recommended };
    case 'l':
      return { type: 'later', cardId: card.id };
    case 'n':
      return { type: 'note', cardId: card.id };
    default: {
      if (!/^[1-4]$/.test(key)) return null;
      const option = Number(key) - 1;
      return option < card.options ? { type: 'answer', cardId: card.id, option } : null;
    }
  }
}

/** The focus after the focused card left the list: the card that took its place. */
export function focusAfterAnswer(focused: number, remaining: number): number {
  return remaining === 0 ? 0 : Math.min(focused, remaining - 1);
}

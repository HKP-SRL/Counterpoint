// The long usage hold, told to the owner (build-runs: A long usage hold is told).
//
// The governor holds every new session while a limit window is at its ceiling or a usage limit
// paused the lanes, until the window resets. The weekly window can be days away, and the console
// only says "Holding". So when a spawn starts waiting on a hold of 3 hours or more, one card says
// which window holds work and when it resets. It does not block anything (work resumes on its own)
// and it closes itself when no spawn waits on the hold any more.
import type { NewCard } from '../core/store/cards.ts';
import type { Store } from '../core/store/db.ts';
import type { CardDesk } from '../server/cards.ts';
import type { LongHold } from './governor.ts';

export const HOLD_CARD_KIND = 'usage-hold';

/** `seven_day` → `weekly`, `five_hour` → `5-hour`, `seven_day_opus` → `weekly opus`. */
export function windowLabel(window: string): string {
  return window.replace('five_hour', '5-hour').replace('seven_day', 'weekly').replace(/_/g, ' ');
}

/** `Mon 16 Nov, 09:02` in the machine's time zone. */
export function holdTime(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

const clip = (text: string, max = 300): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
};

export function holdCard(hold: LongHold, format: (ms: number) => string = holdTime): NewCard {
  const time = format(hold.until);
  return {
    hostId: null,
    key: `${HOLD_CARD_KIND}:${hold.until}`,
    kind: HOLD_CARD_KIND,
    source: 'machine',
    question:
      hold.window === null
        ? `A usage limit holds agent work until ${time}. Let it wait?`
        : `The ${windowLabel(hold.window)} usage limit holds agent work until it resets, ${time}. Let it wait?`,
    why: clip(`No new session starts until then; work resumes on its own. (${hold.reason})`),
    options: [
      { label: 'Let it wait', consequence: `Work resumes on its own at ${time}.` },
      { label: 'Ignore it', consequence: 'Nothing changes; the card closes when the hold ends.' },
    ],
    recommended: 0,
    reversible: true,
    blocking: false,
  };
}

/** Raises the card for the hold the governor tells, and closes it when the hold is over. */
export class HoldCards {
  readonly #desk: CardDesk;
  readonly #format: (ms: number) => string;
  #card: { id: string; hostId: string | null } | null = null;

  constructor(desk: CardDesk, format: (ms: number) => string = holdTime) {
    this.#desk = desk;
    this.#format = format;
  }

  /** The governor's `onLongHold`. */
  update(hold: LongHold | null): void {
    const previous = this.#card;
    if (hold === null) {
      this.#card = null;
      if (previous !== null) this.#desk.resolve(previous, 'The hold is over.');
      return;
    }
    const card = this.#desk.raise(holdCard(hold, this.#format));
    // The same hold seen again (after a daemon restart closed its card) opens its card again.
    if (card.state === 'resolved') this.#desk.reopen(card);
    this.#card = { id: card.id, hostId: card.hostId };
    if (previous !== null && previous.id !== card.id) {
      this.#desk.resolve(previous, 'A new hold replaced it.');
    }
  }
}

/** Hold cards a previous daemon left open: no spawn of this daemon waits on them. */
export function resolveHoldCards(store: Store, desk: CardDesk, outcome: string): void {
  const rows = store
    .prepare(`SELECT id FROM cards WHERE kind = ? AND state IN ('open', 'deferred')`)
    .all(HOLD_CARD_KIND);
  for (const row of rows) desk.resolve({ id: String(row.id), hostId: null }, outcome);
}

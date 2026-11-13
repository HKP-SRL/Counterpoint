// Local notifications for cards that block work (owner-inbox D-9; needs-you: Notified when a card
// blocks work). On macOS the daemon runs `osascript` with a fixed script: the question travels as
// an argument (`item 1 of argv`), never in the script's source, so no question can change what
// runs. At most one notification a minute: cards that arrive within the minute are merged into one
// when it is up ("3 questions need you"), leaving out any the owner answered meanwhile.
import { execa } from 'execa';

const OSASCRIPT = '/usr/bin/osascript';
export const NOTIFY_INTERVAL_MS = 60_000;
const TITLE = 'Counterpoint';

/** The whole AppleScript source. Nothing from a card is ever added to it. */
export const NOTIFY_SCRIPT: readonly string[] = [
  '-e',
  'on run argv',
  '-e',
  'display notification (item 1 of argv) with title (item 2 of argv)',
  '-e',
  'end run',
];

/** osascript's arguments: the fixed script, then `--`, then the message and title as data. */
export function osascriptArgs(message: string, title: string = TITLE): string[] {
  return [...NOTIFY_SCRIPT, '--', message, title];
}

/** Shows a macOS notification; does nothing on other systems and never throws. */
export async function macNotify(message: string): Promise<void> {
  if (process.platform !== 'darwin') return;
  await execa(OSASCRIPT, osascriptArgs(message), {
    stdin: 'ignore',
    reject: false,
    timeout: 10_000,
  }).catch(() => undefined);
}

export interface NotifierOptions {
  /** Shows one notification (default: macNotify). */
  send?: (message: string) => Promise<void>;
  /** False once the card no longer waits (answered meanwhile): it is left out of a merge. */
  stillWaiting?: (cardId: string) => boolean;
  intervalMs?: number;
  now?: () => number;
}

interface Pending {
  id: string;
  question: string;
}

export class Notifier {
  readonly #send: (message: string) => Promise<void>;
  readonly #stillWaiting: (cardId: string) => boolean;
  readonly #interval: number;
  readonly #now: () => number;
  #last = Number.NEGATIVE_INFINITY;
  #pending: Pending[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: NotifierOptions = {}) {
    this.#send = options.send ?? macNotify;
    this.#stillWaiting = options.stillWaiting ?? (() => true);
    this.#interval = options.intervalMs ?? NOTIFY_INTERVAL_MS;
    this.#now = options.now ?? Date.now;
  }

  /** A card that blocks work arrived. */
  notify(card: Pending): void {
    if (this.#timer === undefined && this.#now() - this.#last >= this.#interval) {
      this.#show(card.question);
      return;
    }
    this.#pending.push({ id: card.id, question: card.question });
    if (this.#timer === undefined) {
      this.#timer = setTimeout(() => this.flush(), this.#last + this.#interval - this.#now());
      this.#timer.unref?.();
    }
  }

  /** Shows what waited for the minute to pass, as one notification. */
  flush(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const cards = this.#pending.filter((card) => this.#stillWaiting(card.id));
    this.#pending = [];
    if (cards.length === 0) return;
    this.#show(
      cards.length === 1 ? (cards[0]?.question ?? '') : `${cards.length} questions need you`,
    );
  }

  stop(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#pending = [];
  }

  #show(message: string): void {
    this.#last = this.#now();
    void this.#send(message).catch(() => undefined);
  }
}

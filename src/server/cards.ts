// The card desk (owner-inbox D-1, D-2, D-7): every card goes in and out through here, so each
// change is stored first and then announced on the `needs-you` event family (ids only), and an
// answer's catalog action runs right after the answer is recorded.
//
// Only Counterpoint's own code raises cards through `raise`; the ask tool's cards are stored with
// source `session`, which the store refuses to give an action. Answering a card never runs
// anything the card's text says: only the option's catalog action, and only Counterpoint attached
// one.
import {
  addDoneForYou,
  answerCard,
  type CardAction,
  type CardRow,
  deferCard,
  getCard,
  insertCard,
  type NewCard,
  reopenCard,
  resolveCard,
  resolveMissingCards,
  setCardOutcome,
} from '../core/store/cards.ts';
import type { Store } from '../core/store/db.ts';
import { type EventBus, publishEvent } from '../core/store/events.ts';

/** Carries out a catalog action and returns one line on what happened. */
export type ActionRunner = (
  action: CardAction,
  context: { card: CardRow; note: string | null },
) => Promise<string>;

export interface CardDeskOptions {
  store: Store;
  bus: EventBus;
  runAction?: ActionRunner;
  now?: () => number;
  log?: (event: string, fields?: Record<string, unknown>) => void;
  /** Told of every new card that blocks work (local notifications, D-9). */
  notify?: (card: CardRow) => void;
}

type AnswerListener = (card: CardRow) => void;

export class CardDesk {
  readonly #o: CardDeskOptions;
  readonly #now: () => number;
  readonly #listeners = new Set<AnswerListener>();
  #runAction: ActionRunner | undefined;

  constructor(options: CardDeskOptions) {
    this.#o = options;
    this.#now = options.now ?? Date.now;
    this.#runAction = options.runAction;
  }

  /** Set once the daemon has what the actions need (the orchestrator, the restarter). */
  setActionRunner(runner: ActionRunner): void {
    this.#runAction = runner;
  }

  get store(): Store {
    return this.#o.store;
  }

  #publish(hostId: string | null, payload: Record<string, unknown>): void {
    try {
      publishEvent(
        this.#o.store,
        this.#o.bus,
        { hostId, family: 'needs-you', payload },
        this.#now(),
      );
    } catch {
      // a missed event changes nothing: the console refetches on its next event
    }
  }

  /** Stores a card (or finds the one its key names) and announces a new one. */
  raise(input: NewCard): CardRow {
    const { card, created } = insertCard(this.#o.store, input, this.#now());
    if (created) {
      this.#publish(card.hostId, { cardId: card.id, state: 'open' });
      if (card.blocking) {
        try {
          this.#o.notify?.(card);
        } catch {
          // a notification that fails changes nothing about the card
        }
      }
    }
    return card;
  }

  get(id: string): CardRow | undefined {
    return getCard(this.#o.store, id);
  }

  /** Called with every answered card (the ask tool's waits, the orchestrator's assumptions). */
  onAnswered(listener: AnswerListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * The card once it is answered or closed, or as it stands after `ms` (or when `signal` aborts).
   * Undefined for an unknown card.
   */
  waitForAnswer(id: string, ms: number, signal?: AbortSignal): Promise<CardRow | undefined> {
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let off: () => void = () => {};
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        off();
        signal?.removeEventListener('abort', done);
        resolve(this.get(id));
      };
      off = this.onAnswered((card) => {
        if (card.id === id) done();
      });
      timer = setTimeout(done, Math.max(0, ms));
      signal?.addEventListener('abort', done, { once: true });
      const now = this.get(id);
      if (now === undefined || signal?.aborted === true) done();
      else if (now.state === 'answered' || now.state === 'resolved') done();
    });
  }

  /**
   * Records the owner's answer, then runs the option's action, if any, and records its outcome.
   * Throws CardRefusal for a bad option or a closed card. An action that fails leaves the answer
   * and records why as the outcome.
   */
  async answer(id: string, input: { option: number; note?: string | null }): Promise<CardRow> {
    const card = answerCard(this.#o.store, id, input, this.#now());
    this.#publish(card.hostId, { cardId: card.id, state: 'answered' });
    for (const listener of this.#listeners) {
      try {
        listener(card);
      } catch {
        // a listener's failure never undoes the owner's answer
      }
    }
    const action = card.options[card.answer ?? -1]?.action;
    if (action === undefined) {
      // A listener may have said where the answer went (the asking session had ended).
      if (card.source === 'session' && getCard(this.#o.store, id)?.outcome == null) {
        this.outcome(card, 'Sent to the session that asked.');
      }
      return getCard(this.#o.store, id) as CardRow;
    }
    let outcome: string;
    try {
      if (this.#runAction === undefined) throw new Error('Counterpoint cannot do this right now.');
      outcome = await this.#runAction(action, { card, note: card.note });
    } catch (error) {
      outcome = `Couldn't do it: ${error instanceof Error ? error.message : String(error)}`;
      this.#o.log?.('card-action-failed', { cardId: id, action: action.type, error: outcome });
    }
    this.outcome(card, outcome);
    return getCard(this.#o.store, id) as CardRow;
  }

  /** Later: the card stays answerable. */
  defer(id: string): CardRow {
    const card = deferCard(this.#o.store, id, this.#now());
    this.#publish(card.hostId, { cardId: card.id, state: 'deferred' });
    return card;
  }

  outcome(card: Pick<CardRow, 'id' | 'hostId'>, text: string): void {
    setCardOutcome(this.#o.store, card.id, text, this.#now());
    this.#publish(card.hostId, { cardId: card.id, outcome: true });
  }

  /** Puts a card back in the inbox, unanswered, with an optional line on why. */
  reopen(card: Pick<CardRow, 'id' | 'hostId'>, outcome: string | null = null): void {
    reopenCard(this.#o.store, card.id, this.#now());
    if (outcome !== null) setCardOutcome(this.#o.store, card.id, outcome, this.#now());
    this.#publish(card.hostId, { cardId: card.id, state: 'open' });
  }

  /** Closes a waiting card without an answer. */
  resolve(card: Pick<CardRow, 'id' | 'hostId'>, outcome: string | null): void {
    resolveCard(this.#o.store, card.id, outcome, this.#now());
    this.#publish(card.hostId, { cardId: card.id, state: 'resolved' });
  }

  /** Resolves the recomputed cards under `prefix` whose cause went away. */
  resolveMissing(hostId: string, prefix: string, keep: ReadonlySet<string>, outcome: string) {
    const ids = resolveMissingCards(this.#o.store, hostId, prefix, keep, outcome, this.#now());
    if (ids.length > 0) this.#publish(hostId, { resolved: ids });
  }

  /** Logs a decision taken without asking (D-7). */
  doneForYou(hostId: string | null, text: string, undo?: CardAction | null): void {
    addDoneForYou(this.#o.store, { hostId, text, undo: undo ?? null }, this.#now());
    this.#publish(hostId, { doneForYou: true });
  }
}

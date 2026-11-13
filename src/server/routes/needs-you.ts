// The Needs You API (needs-you: One inbox; Every item can be answered; question-cards). Behind the
// session guard like every /api route; writes also pass the Origin and JSON checks.
//
//   GET  /api/hosts/:hostId/needs-you                  { cards, answered, doneForYou, runItems }
//   POST /api/hosts/:hostId/cards/:cardId/answer       { option, note? } → { card }
//   POST /api/hosts/:hostId/cards/:cardId/later        → { card }
//   POST /api/hosts/:hostId/writes/:writeId/retry      → { card }  (a blocked planning write)
//   POST /api/hosts/:hostId/writes/:writeId/cancel     → { card }
//
// `cards` are the questions waiting on the owner (blocking first, then newest; deferred ones
// last), `landing` the answered cards whose planning write has not merged yet (D-12: Landing,
// Waiting for checks, or blocked with Retry and Cancel), `answered` what was answered lately and
// what happened next, `doneForYou` the decisions
// Counterpoint took without asking (D-7). `runItems` are the details behind the run's cards (the
// failing gate's last lines, every attempt), from the host's latest run in the store.
import type { Hono } from 'hono';
import { z } from 'zod';
import { builderSessionOf } from '../../build/ask-session.ts';
import { HOST_ID_RE } from '../../core/ids.ts';
import { runNeedsYou } from '../../core/runway/run-items.ts';
import {
  CardRefusal,
  type CardRow,
  getCard,
  listAnsweredCards,
  listDoneForYou,
  listWaitingCards,
} from '../../core/store/cards.ts';
import type { Store } from '../../core/store/db.ts';
import { landCardResult } from '../../core/store/owner-step-results.ts';
import {
  cardPlanningWrite,
  getPlanningWrite,
  PLAN_WRITE_ID_RE,
} from '../../core/store/planning-writes.ts';
import { mergedPullRequests } from '../../core/store/runs.ts';
import { getAgentSession } from '../../core/store/sessions.ts';
import type { CardDesk } from '../cards.ts';
import type { HostRuntimes } from '../hosts.ts';

export interface NeedsYouRoutesOptions {
  runtimes: HostRuntimes;
  store: Store;
  cards: CardDesk;
  /** Recomputes the host's run cards before a read (they resolve when their cause goes away). */
  syncCards?: (hostId: string) => void | Promise<void>;
  /** Retry and Cancel on a blocked planning write (build/planning-lane.ts). */
  writes?: {
    retry(id: string): Promise<unknown>;
    cancel(id: string): Promise<unknown>;
  };
}

const CARD_ID_RE = /^c-[0-9a-f]{16}$/;

const Answer = z.strictObject({
  option: z.number().int().min(0).max(3),
  note: z.string().max(2000).nullable().optional(),
});

/** The session that asked, in words ("builder session 2"), or null for a card no session raised. */
function sessionName(store: Store, card: CardRow): string | null {
  if (card.source !== 'session') return null;
  const id = builderSessionOf(card.sessionId);
  if (id === null) return 'a Claude Code session';
  const session = getAgentSession(store, id);
  return session === undefined ? 'a builder session' : `builder session ${session.number}`;
}

/** The planning write a card started, as the console sees it; null when it started none. */
function writeView(store: Store, card: CardRow) {
  const write = cardPlanningWrite(store, card.id);
  if (write === undefined || write.state === 'cancelled') return null;
  return { id: write.id, state: write.state, prUrl: write.prUrl, reason: write.reason };
}

const LANDING = new Set(['pending', 'landing', 'waiting', 'blocked']);

/** The diff a waiting Land it card shows (owner-inbox D-8); null for every other card. */
function diffView(store: Store, card: CardRow): string | null {
  if (card.kind !== 'owner-step-result') return null;
  if (card.state !== 'open' && card.state !== 'deferred') return null;
  return landCardResult(store, card.id)?.diff ?? null;
}

/**
 * The merged build PR an owner-step card of a built change links to (build-ticks-and-owner-steps
 * D-5); null for every other card.
 */
function prView(store: Store, card: CardRow): string | null {
  if (card.kind !== 'owner-step' || card.change === null || card.hostId === null) return null;
  return mergedPullRequests(store, card.hostId).get(card.change) ?? null;
}

/** A card as the console sees it: actions stay on the server, the console sees only that one runs. */
export function cardView(card: CardRow, store?: Store) {
  return {
    id: card.id,
    kind: card.kind,
    source: card.source,
    runId: card.runId,
    change: card.change,
    session: store === undefined ? null : sessionName(store, card),
    question: card.question,
    why: card.why,
    options: card.options.map((option) => ({
      label: option.label,
      consequence: option.consequence,
      acts: option.action !== undefined,
    })),
    recommended: card.recommended,
    reversible: card.reversible,
    blocking: card.blocking,
    state: card.state,
    answer: card.answer,
    note: card.note,
    answeredAt: card.answeredAt,
    outcome: card.outcome,
    write: store === undefined ? null : writeView(store, card),
    diff: store === undefined ? null : diffView(store, card),
    prUrl: store === undefined ? null : prView(store, card),
    createdAt: card.createdAt,
  };
}

async function jsonBody(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

export function mountNeedsYouRoutes(app: Hono, options: NeedsYouRoutesOptions): void {
  const { store, cards } = options;

  app.get('/api/hosts/:hostId/needs-you', async (c) => {
    const hostId = c.req.param('hostId');
    if (!HOST_ID_RE.test(hostId)) return c.json({ error: 'invalid host id' }, 400);
    const runtime = options.runtimes.get(hostId);
    if (runtime === null) return c.json({ error: 'not found' }, 404);
    try {
      await options.syncCards?.(runtime.host.id);
    } catch {
      // the cards as stored are still the inbox
    }
    const answered = listAnsweredCards(store, runtime.host.id).map((card) => cardView(card, store));
    const landing = (card: (typeof answered)[number]) =>
      card.write !== null && LANDING.has(card.write.state);
    return c.json({
      hostId: runtime.host.id,
      baseBranch: runtime.host.baseBranch,
      cards: listWaitingCards(store, runtime.host.id).map((card) => cardView(card, store)),
      landing: answered.filter(landing),
      answered: answered.filter((card) => !landing(card)),
      doneForYou: listDoneForYou(store, runtime.host.id).map((entry) => ({
        id: entry.id,
        text: entry.text,
        at: entry.createdAt,
        undoable: entry.undo !== null,
      })),
      runItems: runNeedsYou(store, runtime.host.id),
    });
  });

  /** The card, if it is this host's or the machine's. */
  const cardOf = (hostId: string, cardId: string): CardRow | null => {
    if (!HOST_ID_RE.test(hostId) || !CARD_ID_RE.test(cardId)) return null;
    const card = getCard(store, cardId);
    if (card === undefined || (card.hostId !== null && card.hostId !== hostId)) return null;
    return card;
  };

  app.post('/api/hosts/:hostId/cards/:cardId/answer', async (c) => {
    const card = cardOf(c.req.param('hostId'), c.req.param('cardId'));
    if (card === null) return c.json({ error: 'not found' }, 404);
    const parsed = Answer.safeParse(await jsonBody(c));
    if (!parsed.success) return c.json({ error: 'Pick one of the options.' }, 422);
    try {
      const answered = await cards.answer(card.id, parsed.data);
      return c.json({ card: cardView(answered, store) });
    } catch (error) {
      if (error instanceof CardRefusal) return c.json({ error: error.message }, 409);
      throw error;
    }
  });

  app.post('/api/hosts/:hostId/cards/:cardId/later', (c) => {
    const card = cardOf(c.req.param('hostId'), c.req.param('cardId'));
    if (card === null) return c.json({ error: 'not found' }, 404);
    try {
      return c.json({ card: cardView(cards.defer(card.id), store) });
    } catch (error) {
      if (error instanceof CardRefusal) return c.json({ error: error.message }, 409);
      throw error;
    }
  });

  for (const verb of ['retry', 'cancel'] as const) {
    app.post(`/api/hosts/:hostId/writes/:writeId/${verb}`, async (c) => {
      const hostId = c.req.param('hostId');
      const writeId = c.req.param('writeId');
      if (!HOST_ID_RE.test(hostId) || !PLAN_WRITE_ID_RE.test(writeId)) {
        return c.json({ error: 'not found' }, 404);
      }
      const write = getPlanningWrite(store, writeId);
      if (write === undefined || write.hostId !== hostId || options.writes === undefined) {
        return c.json({ error: 'not found' }, 404);
      }
      try {
        await options.writes[verb](write.id);
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
      }
      const card = write.cardId === null ? undefined : getCard(store, write.cardId);
      return c.json({ card: card === undefined ? null : cardView(card, store) });
    });
  }
}

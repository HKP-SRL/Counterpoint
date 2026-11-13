// The ask tool's routes on the control socket (owner-inbox D-5; ask-the-owner: A capability
// limited to its own cards). `counterpoint mcp ask` calls these with its session's capability as
// the bearer instead of the control token. They are the capability's only calls: post a card for
// this session, wait on it, read it, list the session's cards, and say the session ended. Another
// session's card reads as unknown. A builder's wait returns at once (builders never wait). The interactive setup key reaches one route only, `POST /session`, which opens
// an interactive session with its own capability; its cards go to the inbox of the project the
// session runs in, or to every inbox.
import { realpathSync } from 'node:fs';
import { isAbsolute, sep } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  ASK_NOT_READ,
  ASK_OPEN_LIMIT,
  ASK_READ,
  ASK_SESSION_ENDED,
  ASK_WAIT_REQUEST_MS,
  type AskGrant,
  AskInput,
  askCardView,
  countWaitingSessionCards,
  findAskGrant,
  isInteractiveKey,
  openInteractiveSession,
  revokeAskCapability,
} from '../core/store/ask.ts';
import { CardRefusal, type CardRow, listSessionCards } from '../core/store/cards.ts';
import { listHosts, type Store } from '../core/store/db.ts';
import type { CardDesk } from './cards.ts';

export interface AskRoutesOptions {
  store: Store;
  desk: CardDesk;
}

const WaitBody = z.strictObject({ ms: z.number().int().min(0) });
const SessionBody = z.strictObject({ cwd: z.string().max(4096) });

/** The registered project whose checkout holds `cwd`, or null. */
function hostForPath(store: Store, cwd: string): string | null {
  if (!isAbsolute(cwd)) return null;
  let path: string;
  try {
    path = realpathSync(cwd);
  } catch {
    return null;
  }
  const host = listHosts(store).find((h) => path === h.root || path.startsWith(`${h.root}${sep}`));
  return host?.id ?? null;
}

export const ASK_LIMIT_MESSAGE = `You already have ${ASK_OPEN_LIMIT} questions waiting for the owner. Don't ask more: proceed on your assumptions, note them, and check your answers with check_answer.`;

export function createAskRoutes(
  options: AskRoutesOptions,
): Hono<{ Variables: { grant: AskGrant } }> {
  const app = new Hono<{ Variables: { grant: AskGrant } }>();

  app.use('*', async (c, next) => {
    const match = /^Bearer (\S{1,256})$/.exec(c.req.header('authorization') ?? '');
    const grant = match?.[1] === undefined ? undefined : findAskGrant(options.store, match[1]);
    if (grant === undefined) return c.json({ error: 'unauthorized' }, 401);
    // The setup key opens sessions and nothing else; a session cannot open another.
    const opening = c.req.method === 'POST' && /\/ask\/session$/.test(c.req.path);
    if (opening !== isInteractiveKey(grant)) return c.json({ error: 'unauthorized' }, 401);
    c.set('grant', grant);
    await next();
  });

  app.post('/session', async (c) => {
    let cwd: string | null = null;
    try {
      const parsed = SessionBody.safeParse(await c.req.json());
      if (parsed.success) cwd = parsed.data.cwd;
    } catch {
      // no body: a card for every inbox
    }
    const hostId = cwd === null ? null : hostForPath(options.store, cwd);
    return c.json({ capability: openInteractiveSession(options.store, hostId) }, 201);
  });

  /** The session's own card, or undefined: another session's card reads as unknown. */
  const ownCard = (grant: AskGrant, id: string): CardRow | undefined => {
    const card = options.desk.get(id);
    return card !== undefined && card.sessionId === grant.sessionId ? card : undefined;
  };

  /** The card as the session reads it; an answer it reads now is "Read by the session". */
  const read = (card: CardRow) => {
    // As stored now: a wait wakes up before the answer's outcome is written.
    const now = options.desk.get(card.id) ?? card;
    if (now.answer !== null && (now.outcome === null || now.outcome === ASK_NOT_READ)) {
      options.desk.outcome(now, ASK_READ);
    }
    return askCardView(now);
  };

  app.get('/cards', (c) => {
    const grant = c.get('grant');
    return c.json({ cards: listSessionCards(options.store, grant.sessionId).map(read) });
  });

  /**
   * The session's MCP server stopped (its input ended): an interactive session is gone for good,
   * so its unanswered cards close as "Session ended" (listed under Answered) and its capability
   * ends. A builder's cards stay answerable: the change's next session gets the answer.
   */
  app.post('/end', (c) => {
    const grant = c.get('grant');
    if (grant.kind !== 'interactive') return c.body(null, 204);
    for (const card of listSessionCards(options.store, grant.sessionId)) {
      if (card.state === 'open' || card.state === 'deferred') {
        options.desk.resolve(card, ASK_SESSION_ENDED);
      }
    }
    revokeAskCapability(options.store, grant.sessionId);
    return c.body(null, 204);
  });

  app.post('/cards', async (c) => {
    const grant = c.get('grant');
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'The request body must be JSON.' }, 400);
    }
    const parsed = AskInput.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return c.json(
        {
          error: `Not a valid question${issue === undefined ? '' : `: ${issue.path.join('.') || 'question'} ${issue.message}`}`,
        },
        400,
      );
    }
    if (countWaitingSessionCards(options.store, grant.sessionId) >= ASK_OPEN_LIMIT) {
      return c.json({ error: ASK_LIMIT_MESSAGE }, 429);
    }
    const ask = parsed.data;
    try {
      const card = options.desk.raise({
        hostId: grant.hostId,
        kind: 'ask',
        source: 'session',
        runId: grant.runId,
        change: grant.change,
        sessionId: grant.sessionId,
        question: ask.question,
        why: ask.why,
        options: ask.options,
        recommended: ask.recommended,
        reversible: ask.reversible,
        // It notifies: the owner's own session is waiting in the chat, or the step cannot be
        // undone (D-6). A builder never waits, so its reversible questions block nothing.
        blocking: grant.kind === 'interactive' || !ask.reversible,
      });
      return c.json({ card: askCardView(card), waits: ask.wait && grant.kind !== 'builder' }, 201);
    } catch (error) {
      if (error instanceof CardRefusal) return c.json({ error: error.message }, 400);
      throw error;
    }
  });

  app.get('/cards/:id', (c) => {
    const card = ownCard(c.get('grant'), c.req.param('id'));
    if (card === undefined) return c.json({ error: 'No such card for this session.' }, 404);
    return c.json({ card: read(card) });
  });

  app.post('/cards/:id/wait', async (c) => {
    const grant = c.get('grant');
    const id = c.req.param('id');
    const own = ownCard(grant, id);
    if (own === undefined) {
      return c.json({ error: 'No such card for this session.' }, 404);
    }
    // Builders never wait (build-runs): the card as it stands, at once.
    if (grant.kind === 'builder') return c.json({ card: read(own), waits: false });
    let ms = ASK_WAIT_REQUEST_MS;
    try {
      const parsed = WaitBody.safeParse(await c.req.json());
      if (parsed.success) ms = Math.min(parsed.data.ms, ASK_WAIT_REQUEST_MS);
    } catch {
      // no body: the longest wait
    }
    const card = await options.desk.waitForAnswer(id, ms, c.req.raw.signal);
    if (card === undefined) return c.json({ error: 'No such card for this session.' }, 404);
    // A wait the session gave up on (aborted) read nothing.
    return c.json({ card: c.req.raw.signal.aborted ? askCardView(card) : read(card) });
  });

  return app;
}

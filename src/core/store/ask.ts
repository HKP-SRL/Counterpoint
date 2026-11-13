// The ask tool's side of the store (owner-inbox D-5; ask-the-owner): per-session capabilities and
// the shape of a question a session asks.
//
// A capability is 32 random bytes the session holds; the store keeps only its SHA-256. It names
// the session whose cards it may post and read, and nothing else: it cannot read another session's
// cards, answer, start or stop runs, or reach any other console function. A session has at most
// ASK_OPEN_LIMIT cards waiting at once.
//
// Interactive Claude Code sessions (the owner's own) share one setup key, written to an owner-only
// file in the Counterpoint home when the owner answers the setup card. The key can do one thing:
// open a session, which mints that session's own capability. So each interactive session still
// posts and reads only its own cards.
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { SQLOutputValue } from 'node:sqlite';
import { z } from 'zod';
import type { CardRow } from './cards.ts';
import type { Store } from './db.ts';

/** How many of its cards one session may have waiting at once. */
export const ASK_OPEN_LIMIT = 5;
/** The longest one `ask_owner` call waits for the answer (MCP calls must not hang a session). */
export const ASK_WAIT_CAP_MS = 10 * 60_000;
/** The longest one wait request to the daemon holds; `mcp ask` repeats it up to the cap. */
export const ASK_WAIT_REQUEST_MS = 60_000;

/** What an asking session must know: the card is all the owner sees. */
export const CARD_ONLY =
  "The owner sees only this card: never refer to 'above' or the chat; name each thing; one short line per option.";

/** A question as a session asks it. No actions: an agent's card never runs anything (D-2). */
export const AskInput = z.strictObject({
  question: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe(`The decision, as a plain question the owner can answer in one step. ${CARD_ONLY}`),
  why: z.string().trim().min(1).max(300).describe('One line on why it matters.'),
  options: z
    .array(
      z.strictObject({
        label: z.string().trim().min(1).max(120).describe('A short answer that names the thing.'),
        consequence: z
          .string()
          .trim()
          .min(1)
          .max(300)
          .describe('What happens if it is picked, in one short line.'),
      }),
    )
    .min(2)
    .max(4)
    .describe(`2 to 4 options. ${CARD_ONLY}`),
  recommended: z.number().int().min(0).max(3).describe('The option you recommend, counted from 0.'),
  reversible: z.boolean().describe('Whether the choice is easy to change later.'),
  wait: z
    .boolean()
    .default(false)
    .describe(
      'Wait for the answer (at most 10 minutes). Only when you cannot go on without it; otherwise keep working on your recommendation. Builders in a run never wait: they get the recommendation as assumed at once.',
    ),
});
export type AskInput = z.input<typeof AskInput>;

/** What an answered session card says until the session that asked reads the answer. */
export const ASK_NOT_READ = 'Not read yet';
/** What it says once that session read the answer (it waited, or called check_answer). */
export const ASK_READ = 'Read by the session';
/** An interactive session's unanswered card once that session ended: nobody can read an answer. */
export const ASK_SESSION_ENDED = 'Session ended';

export type AskKind = 'builder' | 'interactive';

/** What a capability allows: the session its cards belong to, and where they come from. */
export interface AskGrant {
  sessionId: string;
  kind: AskKind;
  hostId: string | null;
  runId: string | null;
  change: string | null;
}

function hashCapability(capability: string): string {
  return createHash('sha256').update(capability, 'utf8').digest('hex');
}

const str = (value: SQLOutputValue | undefined): string | null =>
  typeof value === 'string' ? value : null;

/** Mints a session's capability and stores only its hash. Returns the capability itself. */
export function mintAskCapability(db: Store, grant: AskGrant, now: number = Date.now()): string {
  const capability = randomBytes(32).toString('base64url');
  db.prepare(
    `INSERT INTO ask_capabilities (hash, session_id, kind, host_id, run_id, change, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    hashCapability(capability),
    grant.sessionId,
    grant.kind,
    grant.hostId,
    grant.runId,
    grant.change,
    now,
  );
  return capability;
}

/** The grant a presented capability carries, or undefined (unknown, revoked or malformed). */
export function findAskGrant(db: Store, capability: string): AskGrant | undefined {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(capability)) return undefined;
  const row = db
    .prepare('SELECT * FROM ask_capabilities WHERE hash = ? AND revoked_at IS NULL')
    .get(hashCapability(capability));
  if (row === undefined) return undefined;
  return {
    sessionId: str(row.session_id) ?? '',
    kind: str(row.kind) === 'interactive' ? 'interactive' : 'builder',
    hostId: str(row.host_id),
    runId: str(row.run_id),
    change: str(row.change),
  };
}

/** The session id of the interactive setup key: it can only open sessions. */
export const INTERACTIVE_KEY_SESSION = 'interactive';

/** The owner-only file in the Counterpoint home that holds the interactive setup key. */
export function askKeyPath(home: string): string {
  return join(home, 'ask-key');
}

export function isInteractiveKey(grant: AskGrant): boolean {
  return grant.kind === 'interactive' && grant.sessionId === INTERACTIVE_KEY_SESSION;
}

/** Mints a new interactive setup key; the previous one stops working. */
export function mintInteractiveKey(db: Store, now: number = Date.now()): string {
  db.prepare('DELETE FROM ask_capabilities WHERE session_id = ?').run(INTERACTIVE_KEY_SESSION);
  return mintAskCapability(
    db,
    {
      sessionId: INTERACTIVE_KEY_SESSION,
      kind: 'interactive',
      hostId: null,
      runId: null,
      change: null,
    },
    now,
  );
}

/** Opens an interactive session: its own capability, its cards in `hostId`'s inbox (null: every inbox). */
export function openInteractiveSession(
  db: Store,
  hostId: string | null,
  now: number = Date.now(),
): string {
  return mintAskCapability(
    db,
    {
      sessionId: `interactive-${randomBytes(8).toString('hex')}`,
      kind: 'interactive',
      hostId,
      runId: null,
      change: null,
    },
    now,
  );
}

/** Ends a session's capability (its session ended). Its cards stay answerable. */
export function revokeAskCapability(db: Store, sessionId: string, now: number = Date.now()): void {
  db.prepare(
    'UPDATE ask_capabilities SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL',
  ).run(now, sessionId);
}

/** Ends every builder session's capability: after a daemon restart none of them is running. */
export function revokeBuilderCapabilities(db: Store, now: number = Date.now()): void {
  db.prepare(
    "UPDATE ask_capabilities SET revoked_at = ? WHERE kind = 'builder' AND revoked_at IS NULL",
  ).run(now);
}

/** How many of a session's cards wait on the owner. */
export function countWaitingSessionCards(db: Store, sessionId: string): number {
  const row = db
    .prepare(
      "SELECT count(*) AS n FROM cards WHERE session_id = ? AND state IN ('open', 'deferred')",
    )
    .get(sessionId);
  return Number(row?.n ?? 0);
}

/** A card as the session that asked it sees it: no outcome, no other session's data. */
export interface AskCardView {
  card: string;
  state: CardRow['state'];
  question: string;
  options: string[];
  recommended: number;
  reversible: boolean;
  answer: { option: number; label: string } | null;
  note: string | null;
  /** When it was asked (epoch ms). */
  askedAt: number;
}

export function askCardView(card: CardRow): AskCardView {
  const label = card.answer === null ? undefined : card.options[card.answer]?.label;
  return {
    card: card.id,
    askedAt: card.createdAt,
    state: card.state,
    question: card.question,
    options: card.options.map((option) => option.label),
    recommended: card.recommended,
    reversible: card.reversible,
    answer:
      card.answer === null || label === undefined ? null : { option: card.answer, label: label },
    note: card.note,
  };
}

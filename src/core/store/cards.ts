// Question cards (owner-inbox D-1; question-cards: Card contents): anything Counterpoint or an
// agent needs from the owner, as a decision the owner makes in one step. Also the "Done for you"
// log (D-7) and the notes waiting for a change's next builder session.
//
// A card has a question, one line on why it matters, where it came from (a run, a change, an agent
// session or the machine), 2–4 options each with its consequence, exactly one recommended option,
// whether it is reversible and whether it blocks work. Options on Counterpoint's own cards may
// carry an action from the fixed catalog (D-2); a card an agent session raised never does.
//
// States: open → answered (the owner picked an option), deferred (Later, still answerable) or
// resolved (its cause went away, or Counterpoint closed it). The outcome is one line on what
// happened after the answer.
import { randomBytes } from 'node:crypto';
import type { SQLOutputValue } from 'node:sqlite';
import { z } from 'zod';
import { isChangeId } from '../ids.ts';
import type { Store } from './db.ts';

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
const MAX_QUESTION = 500;
const MAX_LINE = 300;
const MAX_NOTE = 2000;

const change = z.string().refine(isChangeId, 'Not a change name.');
const runId = z.string().regex(/^[a-z0-9-]{1,64}$/);
/** An owner step, named by a hash of its text (owner-steps.ts stepId): step texts run long. */
const step = z.string().regex(/^[0-9a-f]{12}$/);
/** An owner-step result (owner-step-results.ts). */
const resultId = z.string().regex(/^r-[0-9a-f]{16}$/);

/** The fixed action catalog (D-2). Only Counterpoint's own code attaches these. */
export const CardAction = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('refresh-environment-and-resume'), runId }),
  z.strictObject({ type: z.literal('retry-parked'), runId, change }),
  z.strictObject({ type: z.literal('resume-run'), runId }),
  z.strictObject({
    type: z.literal('set-git-identity'),
    name: z.string().min(1).max(200),
    email: z.string().min(3).max(200),
  }),
  z.strictObject({
    type: z.literal('restart-into-install'),
    when: z.enum(['after-run', 'now']),
  }),
  z.strictObject({ type: z.literal('tick-owner-step'), change, step }),
  z.strictObject({ type: z.literal('perform-owner-step'), change, step }),
  z.strictObject({ type: z.literal('land-owner-step'), resultId }),
  z.strictObject({ type: z.literal('discard-owner-step'), resultId }),
  z.strictObject({ type: z.literal('add-ask-tool') }),
  /** Later as an option: the card is deferred, not answered (the desk handles it). */
  z.strictObject({ type: z.literal('later') }),
]);
export type CardAction = z.infer<typeof CardAction>;
export type CardActionType = CardAction['type'];

export const CardOption = z.strictObject({
  label: z.string().trim().min(1).max(120),
  consequence: z.string().trim().min(1).max(MAX_LINE),
  action: CardAction.optional(),
});
export type CardOption = z.infer<typeof CardOption>;

export const CARD_SOURCES = ['run', 'change', 'session', 'machine'] as const;
export type CardSource = (typeof CARD_SOURCES)[number];
export type CardState = 'open' | 'deferred' | 'answered' | 'resolved';

export const NewCard = z
  .strictObject({
    hostId: z.string().nullable(),
    /** What raised it, for a recomputed card: raising the same key again finds the same card. */
    key: z.string().min(1).max(200).nullable().default(null),
    /** What produced it (parked, run-stopped, notice, ask, owner-step, ...), for the console. */
    kind: z.string().regex(/^[a-z-]{1,32}$/),
    source: z.enum(CARD_SOURCES),
    runId: z.string().max(64).nullable().default(null),
    change: change.nullable().default(null),
    sessionId: z.string().max(64).nullable().default(null),
    question: z.string().trim().min(1).max(MAX_QUESTION),
    why: z.string().trim().min(1).max(MAX_LINE),
    options: z.array(CardOption).min(MIN_OPTIONS).max(MAX_OPTIONS),
    recommended: z.number().int().min(0),
    reversible: z.boolean(),
    blocking: z.boolean(),
  })
  .superRefine((card, ctx) => {
    if (card.recommended >= card.options.length) {
      ctx.addIssue({ code: 'custom', path: ['recommended'], message: 'Not one of the options.' });
    }
    if (card.source === 'session' && card.options.some((option) => option.action !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'A card an agent raised cannot carry an action.',
      });
    }
  });
export type NewCard = z.input<typeof NewCard>;

export interface CardRow {
  id: string;
  hostId: string | null;
  key: string | null;
  kind: string;
  source: CardSource;
  runId: string | null;
  change: string | null;
  sessionId: string | null;
  question: string;
  why: string;
  options: CardOption[];
  recommended: number;
  reversible: boolean;
  blocking: boolean;
  state: CardState;
  answer: number | null;
  note: string | null;
  answeredAt: number | null;
  outcome: string | null;
  createdAt: number;
  updatedAt: number;
}

export class CardRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardRefusal';
  }
}

const str = (value: SQLOutputValue | undefined): string | null =>
  typeof value === 'string' ? value : null;
const num = (value: SQLOutputValue | undefined): number | null =>
  typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : null;

function parseOptions(raw: SQLOutputValue | undefined): CardOption[] {
  try {
    const parsed = z.array(CardOption).safeParse(JSON.parse(String(raw)));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function toCard(row: Record<string, SQLOutputValue>): CardRow {
  return {
    id: str(row.id) ?? '',
    hostId: str(row.host_id),
    key: str(row.key),
    kind: str(row.kind) ?? '',
    source: (str(row.source) ?? 'machine') as CardSource,
    runId: str(row.run_id),
    change: str(row.change),
    sessionId: str(row.session_id),
    question: str(row.question) ?? '',
    why: str(row.why) ?? '',
    options: parseOptions(row.options),
    recommended: num(row.recommended) ?? 0,
    reversible: num(row.reversible) === 1,
    blocking: num(row.blocking) === 1,
    state: (str(row.state) ?? 'open') as CardState,
    answer: num(row.answer),
    note: str(row.note),
    answeredAt: num(row.answered_at),
    outcome: str(row.outcome),
    createdAt: num(row.created_at) ?? 0,
    updatedAt: num(row.updated_at) ?? 0,
  };
}

export function newCardId(): string {
  return `c-${randomBytes(8).toString('hex')}`;
}

/**
 * Stores a new card and returns it. Refuses (CardRefusal) a card that breaks the model: fewer than
 * 2 or more than 4 options, a recommendation that is not an option, or an action on a card an
 * agent raised. With a key that already names a card, returns that card unchanged (`created`
 * false): a cause raised again is the same question.
 */
export function insertCard(
  db: Store,
  input: NewCard,
  now: number = Date.now(),
): { card: CardRow; created: boolean } {
  const parsed = NewCard.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new CardRefusal(
      `Not a valid card${issue === undefined ? '' : `: ${issue.path.join('.') || 'card'} ${issue.message}`}`,
    );
  }
  const card = parsed.data;
  if (card.key !== null) {
    const existing = getCardByKey(db, card.key);
    if (existing !== undefined) return { card: existing, created: false };
  }
  const id = newCardId();
  db.prepare(
    `INSERT INTO cards (id, host_id, key, kind, source, run_id, change, session_id, question, why,
       options, recommended, reversible, blocking, state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
  ).run(
    id,
    card.hostId,
    card.key,
    card.kind,
    card.source,
    card.runId,
    card.change,
    card.sessionId,
    card.question,
    card.why,
    JSON.stringify(card.options),
    card.recommended,
    card.reversible ? 1 : 0,
    card.blocking ? 1 : 0,
    now,
    now,
  );
  return { card: getCard(db, id) as CardRow, created: true };
}

export function getCard(db: Store, id: string): CardRow | undefined {
  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
  return row === undefined ? undefined : toCard(row);
}

export function getCardByKey(db: Store, key: string): CardRow | undefined {
  const row = db.prepare('SELECT * FROM cards WHERE key = ?').get(key);
  return row === undefined ? undefined : toCard(row);
}

/** A host's cards waiting on the owner (with the machine's): blocking first, then newest. */
export function listWaitingCards(db: Store, hostId: string): CardRow[] {
  return db
    .prepare(
      `SELECT * FROM cards WHERE state IN ('open', 'deferred') AND (host_id = ? OR host_id IS NULL)
       ORDER BY state = 'deferred', blocking DESC, created_at DESC, rowid DESC`,
    )
    .all(hostId)
    .map(toCard);
}

/** A host's latest answered or resolved cards, newest first. */
export function listAnsweredCards(db: Store, hostId: string, limit = 20): CardRow[] {
  return db
    .prepare(
      `SELECT * FROM cards WHERE state IN ('answered', 'resolved') AND (host_id = ? OR host_id IS NULL)
       ORDER BY updated_at DESC, rowid DESC LIMIT ?`,
    )
    .all(hostId, limit)
    .map(toCard);
}

/** Every card an agent session raised that still waits, oldest first. */
export function listSessionCards(db: Store, sessionId: string): CardRow[] {
  return db
    .prepare('SELECT * FROM cards WHERE session_id = ? ORDER BY created_at, rowid')
    .all(sessionId)
    .map(toCard);
}

/** The questions a change's builder sessions asked in a run (the ask tool's cards), oldest first. */
export function listRunChangeAskCards(db: Store, runId: string, change: string): CardRow[] {
  return db
    .prepare(
      `SELECT * FROM cards WHERE source = 'session' AND run_id = ? AND change = ?
       ORDER BY created_at, rowid`,
    )
    .all(runId, change)
    .map(toCard);
}

const unanswered = (card: CardRow): boolean => card.state === 'open' || card.state === 'deferred';

/**
 * The unanswered-card rules (D-6). A reversible question nobody answered let the work go on with
 * the recommended option: it is listed as assumed. An irreversible one holds its change back.
 */
export function assumedAnswers(cards: readonly CardRow[]): { question: string; answer: string }[] {
  return cards
    .filter((card) => card.reversible && unanswered(card))
    .map((card) => ({
      question: card.question,
      answer: card.options[card.recommended]?.label ?? '',
    }));
}

export function waitingIrreversible(cards: readonly CardRow[]): CardRow[] {
  return cards.filter((card) => !card.reversible && unanswered(card));
}

/** Records the owner's answer. Refuses an option that does not exist or a card already closed. */
export function answerCard(
  db: Store,
  id: string,
  answer: { option: number; note?: string | null },
  now: number = Date.now(),
): CardRow {
  const card = getCard(db, id);
  if (card === undefined) throw new CardRefusal('No such card.');
  if (card.state !== 'open' && card.state !== 'deferred') {
    throw new CardRefusal('This card is already answered.');
  }
  if (
    !Number.isInteger(answer.option) ||
    answer.option < 0 ||
    answer.option >= card.options.length
  ) {
    throw new CardRefusal('Not one of the options.');
  }
  const note = answer.note?.trim().slice(0, MAX_NOTE) || null;
  db.prepare(
    `UPDATE cards SET state = 'answered', answer = ?, note = ?, answered_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(answer.option, note, now, now, id);
  return getCard(db, id) as CardRow;
}

/** Later: the card stays answerable, listed after the open ones. */
export function deferCard(db: Store, id: string, now: number = Date.now()): CardRow {
  const card = getCard(db, id);
  if (card === undefined) throw new CardRefusal('No such card.');
  if (card.state !== 'open' && card.state !== 'deferred') {
    throw new CardRefusal('This card is already answered.');
  }
  db.prepare("UPDATE cards SET state = 'deferred', updated_at = ? WHERE id = ?").run(now, id);
  return getCard(db, id) as CardRow;
}

/** Records what happened after the answer (one line). */
export function setCardOutcome(db: Store, id: string, outcome: string, now = Date.now()): void {
  db.prepare('UPDATE cards SET outcome = ?, updated_at = ? WHERE id = ?').run(
    outcome.slice(0, MAX_LINE),
    now,
    id,
  );
}

/** Rewrites a recomputed card's why line (its cause is the same; what it says about it changed). */
export function setCardWhy(db: Store, id: string, why: string, now = Date.now()): void {
  db.prepare('UPDATE cards SET why = ?, updated_at = ? WHERE id = ?').run(
    why.trim().slice(0, MAX_LINE),
    now,
    id,
  );
}

/**
 * Gives a waiting recomputed card the options it is raised with now (its cause is the same; the
 * choices offered changed). False when nothing changed, the card is closed, or the options break
 * the model.
 */
export function setCardOptions(
  db: Store,
  id: string,
  input: { options: readonly CardOption[]; recommended: number },
  now = Date.now(),
): boolean {
  const card = getCard(db, id);
  if (card === undefined || (card.state !== 'open' && card.state !== 'deferred')) return false;
  const options = z.array(CardOption).min(MIN_OPTIONS).max(MAX_OPTIONS).safeParse(input.options);
  if (!options.success || input.recommended < 0 || input.recommended >= options.data.length) {
    return false;
  }
  if (card.source === 'session' && options.data.some((option) => option.action !== undefined)) {
    return false;
  }
  const json = JSON.stringify(options.data);
  if (json === JSON.stringify(card.options) && input.recommended === card.recommended) return false;
  db.prepare('UPDATE cards SET options = ?, recommended = ?, updated_at = ? WHERE id = ?').run(
    json,
    input.recommended,
    now,
    id,
  );
  return true;
}

/** Puts an answered card back as it was before the answer (a cancelled planning write). */
export function reopenCard(db: Store, id: string, now = Date.now()): void {
  db.prepare(
    `UPDATE cards SET state = 'open', answer = NULL, note = NULL, answered_at = NULL,
       outcome = NULL, updated_at = ? WHERE id = ?`,
  ).run(now, id);
}

/** Closes a waiting card without an answer: its cause went away. */
export function resolveCard(db: Store, id: string, outcome: string | null, now = Date.now()): void {
  db.prepare(
    `UPDATE cards SET state = 'resolved', outcome = COALESCE(?, outcome), updated_at = ?
     WHERE id = ? AND state IN ('open', 'deferred')`,
  ).run(outcome?.slice(0, MAX_LINE) ?? null, now, id);
}

/**
 * Resolves the host's waiting cards whose key starts with `prefix` but is not in `keep`: the
 * recomputed causes that went away. Returns the ids it resolved.
 */
export function resolveMissingCards(
  db: Store,
  hostId: string,
  prefix: string,
  keep: ReadonlySet<string>,
  outcome: string,
  now = Date.now(),
): string[] {
  const rows = db
    .prepare(
      `SELECT id, key FROM cards WHERE host_id = ? AND state IN ('open', 'deferred')
       AND key IS NOT NULL AND substr(key, 1, ?) = ?`,
    )
    .all(hostId, prefix.length, prefix);
  const resolved: string[] = [];
  for (const row of rows) {
    const key = str(row.key);
    const id = str(row.id);
    if (key === null || id === null || keep.has(key)) continue;
    resolveCard(db, id, outcome, now);
    resolved.push(id);
  }
  return resolved;
}

// --- "Done for you" (D-7) ---------------------------------------------------------------------

export interface DoneForYouRow {
  id: number;
  hostId: string | null;
  text: string;
  /** How to undo it, where that is possible: an action from the catalog. */
  undo: CardAction | null;
  createdAt: number;
}

export function addDoneForYou(
  db: Store,
  entry: { hostId: string | null; text: string; undo?: CardAction | null },
  now: number = Date.now(),
): number {
  const result = db
    .prepare('INSERT INTO done_for_you (host_id, text, undo, created_at) VALUES (?, ?, ?, ?)')
    .run(
      entry.hostId,
      entry.text.slice(0, MAX_LINE),
      entry.undo == null ? null : JSON.stringify(entry.undo),
      now,
    );
  return Number(result.lastInsertRowid);
}

export function listDoneForYou(db: Store, hostId: string, limit = 20): DoneForYouRow[] {
  return db
    .prepare(
      `SELECT * FROM done_for_you WHERE host_id = ? OR host_id IS NULL
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(hostId, limit)
    .map((row) => {
      let undo: CardAction | null = null;
      try {
        const parsed = CardAction.safeParse(JSON.parse(String(row.undo)));
        undo = parsed.success ? parsed.data : null;
      } catch {
        undo = null;
      }
      return {
        id: num(row.id) ?? 0,
        hostId: str(row.host_id),
        text: str(row.text) ?? '',
        undo,
        createdAt: num(row.created_at) ?? 0,
      };
    });
}

// --- notes for a change's next builder session --------------------------------------------------

export function addChangeNote(
  db: Store,
  note: { hostId: string; change: string; text: string; cardId?: string | null },
  now: number = Date.now(),
): void {
  db.prepare(
    'INSERT INTO change_notes (host_id, change, text, card_id, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(note.hostId, note.change, note.text.slice(0, MAX_NOTE * 2), note.cardId ?? null, now);
}

/** The notes waiting for the change's next session, oldest first. */
export function waitingChangeNotes(db: Store, hostId: string, change: string): string[] {
  return db
    .prepare(
      `SELECT text FROM change_notes WHERE host_id = ? AND change = ? AND used_at IS NULL
       ORDER BY id`,
    )
    .all(hostId, change)
    .map((row) => str(row.text) ?? '')
    .filter((text) => text !== '');
}

/** Marks the change's waiting notes as handed to a session. */
export function markChangeNotesUsed(db: Store, hostId: string, change: string, now = Date.now()) {
  db.prepare(
    'UPDATE change_notes SET used_at = ? WHERE host_id = ? AND change = ? AND used_at IS NULL',
  ).run(now, hostId, change);
}

// Stored planning writes (owner-inbox D-11, D-12; planning-writes: A blocked write is kept). A
// write is a row from the click that asked for it until its PR merged or the owner cancelled it,
// so nothing the owner clicked is lost across a restart.
//
// States: pending (to be made on the base and pushed: new, or to be made again) → landing (its PR
// is open and merges as soon as GitHub allows) or waiting (required checks are running) → merged.
// blocked needs the owner (Retry or Cancel); cancelled closed the PR and put the card back.
import { randomBytes } from 'node:crypto';
import type { SQLOutputValue } from 'node:sqlite';
import { z } from 'zod';
import type { Store } from './db.ts';

const path = z.string().min(1).max(400);

/**
 * One edit of a planning write. A tick is made again on whatever base the write lands on, so an
 * edit someone else made to the list meanwhile is kept. A text edit replaces a file whose content
 * is still `before` (null: the file must not exist yet); on a base where it changed, it does not
 * apply.
 */
export const PlanningEdit = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('tick'), path, task: z.string().min(1).max(400) }),
  z.strictObject({
    kind: z.literal('text'),
    path,
    before: z
      .string()
      .max(1024 * 1024)
      .nullable(),
    after: z.string().max(1024 * 1024),
  }),
]);
export type PlanningEdit = z.infer<typeof PlanningEdit>;

export type PlanningWriteState =
  | 'pending'
  | 'landing'
  | 'waiting'
  | 'blocked'
  | 'merged'
  | 'cancelled';
/** Why a write is blocked: what Retry does depends on it. */
export type BlockedKind = 'checks' | 'review' | 'closed' | 'conflict' | 'push' | 'gh';

export interface PlanningWriteRow {
  id: string;
  hostId: string;
  cardId: string | null;
  message: string;
  edits: PlanningEdit[];
  state: PlanningWriteState;
  blocked: BlockedKind | null;
  /** One line on why it is blocked (or what landed), for the card. */
  reason: string | null;
  prUrl: string | null;
  /** The commit last pushed to the write's branch. */
  commit: string | null;
  /** The base commit that commit was made on. */
  builtOn: string | null;
  /** Times the write was made again because the base moved. */
  redos: number;
  /** May touch files outside the planning: an owner-step result the owner landed (D-8). */
  code: boolean;
  createdAt: number;
  updatedAt: number;
}

/** The branch a write's PR comes from. */
export function planBranch(id: string): string {
  return `cp-plan/${id}`;
}

export const PLAN_WRITE_ID_RE = /^w-[0-9a-f]{12}$/;

const str = (value: SQLOutputValue | undefined): string | null =>
  typeof value === 'string' ? value : null;
const num = (value: SQLOutputValue | undefined): number =>
  typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : 0;

function parseEdits(raw: SQLOutputValue | undefined): PlanningEdit[] {
  try {
    const parsed = z.array(PlanningEdit).safeParse(JSON.parse(String(raw)));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function toRow(row: Record<string, SQLOutputValue>): PlanningWriteRow {
  return {
    id: str(row.id) ?? '',
    hostId: str(row.host_id) ?? '',
    cardId: str(row.card_id),
    message: str(row.message) ?? '',
    edits: parseEdits(row.edits),
    state: (str(row.state) ?? 'pending') as PlanningWriteState,
    blocked: str(row.blocked) as BlockedKind | null,
    reason: str(row.reason),
    prUrl: str(row.pr_url),
    commit: str(row.commit_sha),
    builtOn: str(row.built_on),
    redos: num(row.redos),
    code: num(row.code) === 1,
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

export function insertPlanningWrite(
  db: Store,
  input: {
    hostId: string;
    cardId: string | null;
    message: string;
    edits: PlanningEdit[];
    code?: boolean;
  },
  now: number = Date.now(),
): PlanningWriteRow {
  const id = `w-${randomBytes(6).toString('hex')}`;
  db.prepare(
    `INSERT INTO planning_writes
       (id, host_id, card_id, message, edits, state, code, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
  ).run(
    id,
    input.hostId,
    input.cardId,
    input.message,
    JSON.stringify(z.array(PlanningEdit).parse(input.edits)),
    input.code === true ? 1 : 0,
    now,
    now,
  );
  return getPlanningWrite(db, id) as PlanningWriteRow;
}

export function getPlanningWrite(db: Store, id: string): PlanningWriteRow | undefined {
  const row = db.prepare('SELECT * FROM planning_writes WHERE id = ?').get(id);
  return row === undefined ? undefined : toRow(row);
}

/** The latest write a card started, if any. */
export function cardPlanningWrite(db: Store, cardId: string): PlanningWriteRow | undefined {
  const row = db
    .prepare(
      'SELECT * FROM planning_writes WHERE card_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
    )
    .get(cardId);
  return row === undefined ? undefined : toRow(row);
}

/** A host's writes not yet merged or cancelled, oldest first. */
export function livePlanningWrites(db: Store, hostId: string): PlanningWriteRow[] {
  return db
    .prepare(
      `SELECT * FROM planning_writes WHERE host_id = ? AND state NOT IN ('merged', 'cancelled')
       ORDER BY created_at, rowid`,
    )
    .all(hostId)
    .map(toRow);
}

export type PlanningWriteUpdate = Partial<
  Pick<PlanningWriteRow, 'state' | 'blocked' | 'reason' | 'prUrl' | 'commit' | 'builtOn' | 'redos'>
>;

const COLUMNS: Record<keyof PlanningWriteUpdate, string> = {
  state: 'state',
  blocked: 'blocked',
  reason: 'reason',
  prUrl: 'pr_url',
  commit: 'commit_sha',
  builtOn: 'built_on',
  redos: 'redos',
};

export function updatePlanningWrite(
  db: Store,
  id: string,
  update: PlanningWriteUpdate,
  now: number = Date.now(),
): PlanningWriteRow {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, value] of Object.entries(update) as [keyof PlanningWriteUpdate, unknown][]) {
    sets.push(`${COLUMNS[key]} = ?`);
    values.push(value === undefined ? null : (value as string | number | null));
  }
  if (update.state !== undefined && update.state !== 'blocked' && !('blocked' in update)) {
    sets.push('blocked = NULL');
  }
  sets.push('updated_at = ?');
  values.push(now, id);
  db.prepare(`UPDATE planning_writes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getPlanningWrite(db, id) as PlanningWriteRow;
}

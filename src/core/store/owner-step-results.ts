// Owner-step results (owner-inbox D-8; owner-steps: Do it for me, Land it). What a Do it for me
// session left in its worktree, kept as text edits (a file's content on the base it was made on,
// and after) until the owner lands or discards it. The edits are exactly what Land it lands, and
// the diff the Land it card shows is made from them.
//
// States: running (the session works) → ready (a Land it card waits) → submitted (Land it handed it
// to the planning lane; the card shows the write landing). discarded (Discard, or the base changed
// the same files) and failed (the session changed nothing, or broke) put the step card back.
import { randomBytes } from 'node:crypto';
import type { SQLOutputValue } from 'node:sqlite';
import { z } from 'zod';
import type { Store } from './db.ts';
import { PlanningEdit } from './planning-writes.ts';

export const OWNER_STEP_RESULT_ID_RE = /^r-[0-9a-f]{16}$/;

export type OwnerStepResultState = 'running' | 'ready' | 'submitted' | 'discarded' | 'failed';

/** A text edit of a result: the file as it was on the base (null: new), and after. */
export type TextEdit = Extract<PlanningEdit, { kind: 'text' }>;

export interface OwnerStepResultRow {
  id: string;
  hostId: string;
  change: string;
  stepId: string;
  /** The step's text, as the session got it. */
  step: string;
  stepCardId: string | null;
  landCardId: string | null;
  /** The base commit the session's worktree was made at. */
  base: string | null;
  state: OwnerStepResultState;
  edits: TextEdit[];
  /** The unified diff of `edits`, as the Land it card shows it (capped). */
  diff: string | null;
  /** The session's last words, or why it failed. */
  summary: string | null;
  createdAt: number;
  updatedAt: number;
}

const str = (value: SQLOutputValue | undefined): string | null =>
  typeof value === 'string' ? value : null;
const num = (value: SQLOutputValue | undefined): number =>
  typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : 0;

function parseEdits(raw: SQLOutputValue | undefined): TextEdit[] {
  try {
    const parsed = z.array(PlanningEdit).safeParse(JSON.parse(String(raw)));
    if (!parsed.success) return [];
    return parsed.data.filter((edit): edit is TextEdit => edit.kind === 'text');
  } catch {
    return [];
  }
}

function toRow(row: Record<string, SQLOutputValue>): OwnerStepResultRow {
  return {
    id: str(row.id) ?? '',
    hostId: str(row.host_id) ?? '',
    change: str(row.change) ?? '',
    stepId: str(row.step_id) ?? '',
    step: str(row.step) ?? '',
    stepCardId: str(row.step_card_id),
    landCardId: str(row.land_card_id),
    base: str(row.base),
    state: (str(row.state) ?? 'failed') as OwnerStepResultState,
    edits: parseEdits(row.edits),
    diff: str(row.diff),
    summary: str(row.summary),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

export function insertOwnerStepResult(
  db: Store,
  input: {
    hostId: string;
    change: string;
    stepId: string;
    step: string;
    stepCardId: string | null;
    base: string;
  },
  now: number = Date.now(),
): OwnerStepResultRow {
  const id = `r-${randomBytes(8).toString('hex')}`;
  db.prepare(
    `INSERT INTO owner_step_results
       (id, host_id, change, step_id, step, step_card_id, base, state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
  ).run(
    id,
    input.hostId,
    input.change,
    input.stepId,
    input.step,
    input.stepCardId,
    input.base,
    now,
    now,
  );
  return getOwnerStepResult(db, id) as OwnerStepResultRow;
}

export function getOwnerStepResult(db: Store, id: string): OwnerStepResultRow | undefined {
  if (!OWNER_STEP_RESULT_ID_RE.test(id)) return undefined;
  const row = db.prepare('SELECT * FROM owner_step_results WHERE id = ?').get(id);
  return row === undefined ? undefined : toRow(row);
}

/** The result a Land it card shows, if any. */
export function landCardResult(db: Store, cardId: string): OwnerStepResultRow | undefined {
  const row = db.prepare('SELECT * FROM owner_step_results WHERE land_card_id = ?').get(cardId);
  return row === undefined ? undefined : toRow(row);
}

/** Results whose session was still working (a daemon that stopped mid-session). */
export function runningOwnerStepResults(db: Store): OwnerStepResultRow[] {
  return db
    .prepare(`SELECT * FROM owner_step_results WHERE state = 'running' ORDER BY created_at`)
    .all()
    .map(toRow);
}

export type OwnerStepResultUpdate = Partial<
  Pick<OwnerStepResultRow, 'state' | 'landCardId' | 'edits' | 'diff' | 'summary'>
>;

export function updateOwnerStepResult(
  db: Store,
  id: string,
  update: OwnerStepResultUpdate,
  now: number = Date.now(),
): OwnerStepResultRow {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (update.state !== undefined) {
    sets.push('state = ?');
    values.push(update.state);
  }
  if (update.landCardId !== undefined) {
    sets.push('land_card_id = ?');
    values.push(update.landCardId);
  }
  if (update.edits !== undefined) {
    sets.push('edits = ?');
    values.push(JSON.stringify(z.array(PlanningEdit).parse(update.edits)));
  }
  if (update.diff !== undefined) {
    sets.push('diff = ?');
    values.push(update.diff);
  }
  if (update.summary !== undefined) {
    sets.push('summary = ?');
    values.push(update.summary);
  }
  sets.push('updated_at = ?');
  values.push(now, id);
  db.prepare(`UPDATE owner_step_results SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getOwnerStepResult(db, id) as OwnerStepResultRow;
}

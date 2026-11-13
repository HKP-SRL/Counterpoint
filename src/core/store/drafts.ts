// Design drafts in the store (design-drafts D-8). A change whose drafts were started has a
// `draft_changes` row: it holds the build until every screen is signed off and landed (D-12), and
// says whether the screen list is being made. Each screen has rounds: low-fi rounds of three drafts
// (A, B, C) and hi-fi versions with one draft per state. The owner's marks (a selection or a
// comment on a part) belong to the screen and point at the draft they were made on.
//
// Files (the pages, their styles, the element maps' source) live under the host's folder in the
// Counterpoint home; rows hold their folder and the element maps. Nothing here is in the host's git.
import type { SQLOutputValue } from 'node:sqlite';
import type { Store } from './db.ts';

export type DraftListState = 'listing' | 'ready' | 'failed';
export type ScreenStage = 'low' | 'locked' | 'hifi' | 'signed';
export type RoundStage = 'low' | 'hifi';
export type DraftState = 'running' | 'ready' | 'failed';
export type MarkKind = 'select' | 'comment';
export type MarkState = 'open' | 'sent' | 'addressed' | 'detached';
export type DraftWidth = 'phone' | 'desktop';

/** One part's box on a page at one width, in CSS pixels from the page's top left. */
export interface MapPart {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The part's text, collapsed and clipped. */
  text: string;
}

/** A page's element map at one width (D-6). */
export interface PageMap {
  width: number;
  height: number;
  parts: MapPart[];
}

export type DraftMaps = Partial<Record<DraftWidth, PageMap>>;

export interface DraftChangeRow {
  hostId: string;
  change: string;
  state: DraftListState;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ScreenInput {
  screen: string;
  name: string;
  purpose: string;
  states: string[];
  directions: string[];
}

export interface DraftScreenRow extends ScreenInput {
  id: number;
  hostId: string;
  change: string;
  position: number;
  stage: ScreenStage;
  lockedDraft: number | null;
  /** The planning write that lands the signed-off pages (D-9). */
  signoffWrite: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DraftRoundRow {
  id: number;
  screenId: number;
  number: number;
  stage: RoundStage;
  state: DraftState;
  error: string | null;
  /** Parts nobody commented on that a revision changed anyway (D-7). */
  alsoChanged: string[];
  createdAt: number;
  updatedAt: number;
}

export interface DraftRow {
  id: number;
  roundId: number;
  /** `A`, `B` or `C` in a low-fi round; the state's name in a hi-fi version. */
  slot: string;
  direction: string | null;
  /** The draft's folder (packed page, styles, the session's files). */
  dir: string;
  maps: DraftMaps | null;
  state: DraftState;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DraftMarkRow {
  id: number;
  screenId: number;
  draftId: number;
  part: string;
  snippet: string;
  kind: MarkKind;
  note: string | null;
  width: DraftWidth;
  state: MarkState;
  /** The round the mark was sent to. */
  sentRound: number | null;
  createdAt: number;
  updatedAt: number;
}

const str = (value: SQLOutputValue | undefined): string | null =>
  typeof value === 'string' ? value : null;
const num = (value: SQLOutputValue | undefined): number =>
  typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : 0;
const numOrNull = (value: SQLOutputValue | undefined): number | null =>
  value === null || value === undefined ? null : num(value);

function json<T>(value: SQLOutputValue | undefined, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

const strings = (value: SQLOutputValue | undefined): string[] =>
  json<unknown[]>(value, []).filter((item): item is string => typeof item === 'string');

function toChange(row: Record<string, SQLOutputValue>): DraftChangeRow {
  return {
    hostId: str(row.host_id) ?? '',
    change: str(row.change) ?? '',
    state: (str(row.state) ?? 'failed') as DraftListState,
    error: str(row.error),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

function toScreen(row: Record<string, SQLOutputValue>): DraftScreenRow {
  return {
    id: num(row.id),
    hostId: str(row.host_id) ?? '',
    change: str(row.change) ?? '',
    screen: str(row.screen) ?? '',
    name: str(row.name) ?? '',
    purpose: str(row.purpose) ?? '',
    states: strings(row.states),
    directions: strings(row.directions),
    position: num(row.position),
    stage: (str(row.stage) ?? 'low') as ScreenStage,
    lockedDraft: numOrNull(row.locked_draft),
    signoffWrite: str(row.signoff_write),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

function toRound(row: Record<string, SQLOutputValue>): DraftRoundRow {
  return {
    id: num(row.id),
    screenId: num(row.screen_id),
    number: num(row.number),
    stage: (str(row.stage) ?? 'low') as RoundStage,
    state: (str(row.state) ?? 'failed') as DraftState,
    error: str(row.error),
    alsoChanged: strings(row.also_changed),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

function toDraft(row: Record<string, SQLOutputValue>): DraftRow {
  return {
    id: num(row.id),
    roundId: num(row.round_id),
    slot: str(row.slot) ?? '',
    direction: str(row.direction),
    dir: str(row.dir) ?? '',
    maps: json<DraftMaps | null>(row.maps, null),
    state: (str(row.state) ?? 'failed') as DraftState,
    error: str(row.error),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

function toMark(row: Record<string, SQLOutputValue>): DraftMarkRow {
  return {
    id: num(row.id),
    screenId: num(row.screen_id),
    draftId: num(row.draft_id),
    part: str(row.part) ?? '',
    snippet: str(row.snippet) ?? '',
    kind: (str(row.kind) ?? 'comment') as MarkKind,
    note: str(row.note),
    width: (str(row.width) ?? 'desktop') as DraftWidth,
    state: (str(row.state) ?? 'open') as MarkState,
    sentRound: numOrNull(row.sent_round),
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

// --- changes ---

export function getDraftChange(
  db: Store,
  hostId: string,
  change: string,
): DraftChangeRow | undefined {
  const row = db
    .prepare('SELECT * FROM draft_changes WHERE host_id = ? AND change = ?')
    .get(hostId, change);
  return row === undefined ? undefined : toChange(row);
}

export function listDraftChanges(db: Store, hostId: string): DraftChangeRow[] {
  return db
    .prepare('SELECT * FROM draft_changes WHERE host_id = ? ORDER BY created_at, change')
    .all(hostId)
    .map(toChange);
}

/** Starts drafts for a change (or restarts its screen list); the change is held from now on. */
export function startDraftChange(
  db: Store,
  hostId: string,
  change: string,
  now: number = Date.now(),
): DraftChangeRow {
  db.prepare(
    `INSERT INTO draft_changes (host_id, change, state, error, created_at, updated_at)
     VALUES (?, ?, 'listing', NULL, ?, ?)
     ON CONFLICT (host_id, change) DO UPDATE SET state = 'listing', error = NULL,
       updated_at = excluded.updated_at`,
  ).run(hostId, change, now, now);
  return getDraftChange(db, hostId, change) as DraftChangeRow;
}

export function setDraftChangeState(
  db: Store,
  hostId: string,
  change: string,
  state: DraftListState,
  error: string | null = null,
  now: number = Date.now(),
): void {
  db.prepare(
    'UPDATE draft_changes SET state = ?, error = ?, updated_at = ? WHERE host_id = ? AND change = ?',
  ).run(state, error, now, hostId, change);
}

/** Drop drafts (D-12): deletes the change's screens, rounds, drafts and marks; ends the hold. */
export function dropDraftChange(db: Store, hostId: string, change: string): boolean {
  const result = db
    .prepare('DELETE FROM draft_changes WHERE host_id = ? AND change = ?')
    .run(hostId, change);
  return Number(result.changes) > 0;
}

// --- screens ---

export function listScreens(db: Store, hostId: string, change: string): DraftScreenRow[] {
  return db
    .prepare('SELECT * FROM draft_screens WHERE host_id = ? AND change = ? ORDER BY position, id')
    .all(hostId, change)
    .map(toScreen);
}

export function getScreen(db: Store, id: number): DraftScreenRow | undefined {
  const row = db.prepare('SELECT * FROM draft_screens WHERE id = ?').get(id);
  return row === undefined ? undefined : toScreen(row);
}

export function addScreen(
  db: Store,
  hostId: string,
  change: string,
  input: ScreenInput,
  now: number = Date.now(),
): DraftScreenRow {
  const position = num(
    db
      .prepare(
        'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM draft_screens WHERE host_id = ? AND change = ?',
      )
      .get(hostId, change)?.next,
  );
  const result = db
    .prepare(
      `INSERT INTO draft_screens (host_id, change, screen, name, purpose, states, directions,
         position, stage, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'low', ?, ?)`,
    )
    .run(
      hostId,
      change,
      input.screen,
      input.name,
      input.purpose,
      JSON.stringify(input.states),
      JSON.stringify(input.directions),
      position,
      now,
      now,
    );
  return getScreen(db, Number(result.lastInsertRowid)) as DraftScreenRow;
}

/** Replaces the change's screen list (a new screen-list session's result). */
export function replaceScreens(
  db: Store,
  hostId: string,
  change: string,
  screens: readonly ScreenInput[],
  now: number = Date.now(),
): DraftScreenRow[] {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM draft_screens WHERE host_id = ? AND change = ?').run(hostId, change);
    for (const screen of screens) addScreen(db, hostId, change, screen, now);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return listScreens(db, hostId, change);
}

export type ScreenUpdate = Partial<
  Pick<DraftScreenRow, 'name' | 'purpose' | 'states' | 'stage' | 'lockedDraft' | 'signoffWrite'>
>;

export function updateScreen(
  db: Store,
  id: number,
  update: ScreenUpdate,
  now: number = Date.now(),
): DraftScreenRow {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  const set = (column: string, value: string | number | null) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };
  if (update.name !== undefined) set('name', update.name);
  if (update.purpose !== undefined) set('purpose', update.purpose);
  if (update.states !== undefined) set('states', JSON.stringify(update.states));
  if (update.stage !== undefined) set('stage', update.stage);
  if (update.lockedDraft !== undefined) set('locked_draft', update.lockedDraft);
  if (update.signoffWrite !== undefined) set('signoff_write', update.signoffWrite);
  set('updated_at', now);
  db.prepare(`UPDATE draft_screens SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  const row = getScreen(db, id);
  if (row === undefined) throw new Error('That screen is gone.');
  return row;
}

export function deleteScreen(db: Store, id: number): void {
  db.prepare('DELETE FROM draft_screens WHERE id = ?').run(id);
}

// --- rounds ---

export function insertRound(
  db: Store,
  screenId: number,
  stage: RoundStage,
  now: number = Date.now(),
): DraftRoundRow {
  const number = num(
    db
      .prepare('SELECT COALESCE(MAX(number), 0) + 1 AS next FROM draft_rounds WHERE screen_id = ?')
      .get(screenId)?.next,
  );
  const result = db
    .prepare(
      `INSERT INTO draft_rounds (screen_id, number, stage, state, created_at, updated_at)
       VALUES (?, ?, ?, 'running', ?, ?)`,
    )
    .run(screenId, number, stage, now, now);
  return getRound(db, Number(result.lastInsertRowid)) as DraftRoundRow;
}

export function getRound(db: Store, id: number): DraftRoundRow | undefined {
  const row = db.prepare('SELECT * FROM draft_rounds WHERE id = ?').get(id);
  return row === undefined ? undefined : toRound(row);
}

export function listRounds(db: Store, screenId: number): DraftRoundRow[] {
  return db
    .prepare('SELECT * FROM draft_rounds WHERE screen_id = ? ORDER BY number')
    .all(screenId)
    .map(toRound);
}

/** The screen's newest round (of one stage, when given). */
export function latestRound(
  db: Store,
  screenId: number,
  stage?: RoundStage,
): DraftRoundRow | undefined {
  const row =
    stage === undefined
      ? db
          .prepare('SELECT * FROM draft_rounds WHERE screen_id = ? ORDER BY number DESC LIMIT 1')
          .get(screenId)
      : db
          .prepare(
            'SELECT * FROM draft_rounds WHERE screen_id = ? AND stage = ? ORDER BY number DESC LIMIT 1',
          )
          .get(screenId, stage);
  return row === undefined ? undefined : toRound(row);
}

export function updateRound(
  db: Store,
  id: number,
  update: { state?: DraftState; error?: string | null; alsoChanged?: string[] },
  now: number = Date.now(),
): void {
  const sets = ['updated_at = ?'];
  const values: (string | number | null)[] = [now];
  if (update.state !== undefined) {
    sets.push('state = ?');
    values.push(update.state);
  }
  if (update.error !== undefined) {
    sets.push('error = ?');
    values.push(update.error);
  }
  if (update.alsoChanged !== undefined) {
    sets.push('also_changed = ?');
    values.push(JSON.stringify(update.alsoChanged));
  }
  db.prepare(`UPDATE draft_rounds SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
}

// --- drafts ---

export function insertDraft(
  db: Store,
  input: { roundId: number; slot: string; direction: string | null; dir: string },
  now: number = Date.now(),
): DraftRow {
  const result = db
    .prepare(
      `INSERT INTO drafts (round_id, slot, direction, dir, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'running', ?, ?)`,
    )
    .run(input.roundId, input.slot, input.direction, input.dir, now, now);
  return getDraft(db, Number(result.lastInsertRowid)) as DraftRow;
}

export function getDraft(db: Store, id: number): DraftRow | undefined {
  const row = db.prepare('SELECT * FROM drafts WHERE id = ?').get(id);
  return row === undefined ? undefined : toDraft(row);
}

export function listDrafts(db: Store, roundId: number): DraftRow[] {
  return db
    .prepare('SELECT * FROM drafts WHERE round_id = ? ORDER BY id')
    .all(roundId)
    .map(toDraft);
}

export function updateDraft(
  db: Store,
  id: number,
  update: { state?: DraftState; error?: string | null; maps?: DraftMaps | null },
  now: number = Date.now(),
): DraftRow {
  const sets = ['updated_at = ?'];
  const values: (string | number | null)[] = [now];
  if (update.state !== undefined) {
    sets.push('state = ?');
    values.push(update.state);
  }
  if (update.error !== undefined) {
    sets.push('error = ?');
    values.push(update.error);
  }
  if (update.maps !== undefined) {
    sets.push('maps = ?');
    values.push(update.maps === null ? null : JSON.stringify(update.maps));
  }
  db.prepare(`UPDATE drafts SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  return getDraft(db, id) as DraftRow;
}

/** The screen a draft belongs to, through its round. */
export function draftScreen(db: Store, draftId: number): DraftScreenRow | undefined {
  const row = db
    .prepare(
      `SELECT s.* FROM drafts d JOIN draft_rounds r ON r.id = d.round_id
       JOIN draft_screens s ON s.id = r.screen_id WHERE d.id = ?`,
    )
    .get(draftId);
  return row === undefined ? undefined : toScreen(row);
}

// --- marks ---

export function insertMark(
  db: Store,
  input: {
    screenId: number;
    draftId: number;
    part: string;
    snippet: string;
    kind: MarkKind;
    note: string | null;
    width: DraftWidth;
  },
  now: number = Date.now(),
): DraftMarkRow {
  const result = db
    .prepare(
      `INSERT INTO draft_marks (screen_id, draft_id, part, snippet, kind, note, width, state,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    )
    .run(
      input.screenId,
      input.draftId,
      input.part,
      input.snippet,
      input.kind,
      input.note,
      input.width,
      now,
      now,
    );
  return getMark(db, Number(result.lastInsertRowid)) as DraftMarkRow;
}

export function getMark(db: Store, id: number): DraftMarkRow | undefined {
  const row = db.prepare('SELECT * FROM draft_marks WHERE id = ?').get(id);
  return row === undefined ? undefined : toMark(row);
}

export function listMarks(
  db: Store,
  screenId: number,
  states?: readonly MarkState[],
): DraftMarkRow[] {
  const all = db
    .prepare('SELECT * FROM draft_marks WHERE screen_id = ? ORDER BY id')
    .all(screenId)
    .map(toMark);
  return states === undefined ? all : all.filter((mark) => states.includes(mark.state));
}

export function deleteMark(db: Store, id: number): void {
  db.prepare("DELETE FROM draft_marks WHERE id = ? AND state = 'open'").run(id);
}

export function setMarkState(
  db: Store,
  id: number,
  state: MarkState,
  sentRound?: number,
  now: number = Date.now(),
): void {
  if (sentRound === undefined) {
    db.prepare('UPDATE draft_marks SET state = ?, updated_at = ? WHERE id = ?').run(state, now, id);
  } else {
    db.prepare('UPDATE draft_marks SET state = ?, sent_round = ?, updated_at = ? WHERE id = ?').run(
      state,
      sentRound,
      now,
      id,
    );
  }
}

// --- restart ---

/**
 * At daemon start (D-8): a screen list, round or draft the last daemon was making is gone. Each
 * shows Failed with Try again. Returns how many rows changed.
 */
export function failInFlightDrafts(db: Store, now: number = Date.now()): number {
  const why = 'Counterpoint stopped while making it.';
  let changed = 0;
  changed += Number(
    db
      .prepare(
        "UPDATE draft_changes SET state = 'failed', error = ?, updated_at = ? WHERE state = 'listing'",
      )
      .run(why, now).changes,
  );
  changed += Number(
    db
      .prepare(
        "UPDATE draft_rounds SET state = 'failed', error = ?, updated_at = ? WHERE state = 'running'",
      )
      .run(why, now).changes,
  );
  changed += Number(
    db
      .prepare(
        "UPDATE drafts SET state = 'failed', error = ?, updated_at = ? WHERE state = 'running'",
      )
      .run(why, now).changes,
  );
  return changed;
}

/** Hosts with draft rows (for events after a restart). */
export function draftHostIds(db: Store): string[] {
  return db
    .prepare('SELECT DISTINCT host_id FROM draft_changes')
    .all()
    .map((row) => String(row.host_id));
}

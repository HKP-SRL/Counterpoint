// Design drafts in the store (design-drafts 2.1, D-8): each table's writes and state changes, a
// restart that fails what was in flight, and Drop drafts deleting everything of a change.
import { afterAll, describe, expect, it } from 'vitest';
import { openStore, type Store, upsertHost } from '../../../src/core/store/db.ts';
import {
  addScreen,
  dropDraftChange,
  failInFlightDrafts,
  getDraftChange,
  getRound,
  insertDraft,
  insertMark,
  insertRound,
  latestRound,
  listDrafts,
  listMarks,
  listScreens,
  replaceScreens,
  setDraftChangeState,
  setMarkState,
  startDraftChange,
  updateDraft,
  updateRound,
  updateScreen,
} from '../../../src/core/store/drafts.ts';
import { makeScratchDir, removeScratchDirs } from '../../helpers/scratch.ts';

afterAll(() => removeScratchDirs());

function store(): Store {
  const db = openStore(makeScratchDir('cp-drafts-store-'));
  upsertHost(db, {
    id: 'cena',
    root: '/x/cena',
    gitCommonDir: '/x/cena/.git',
    baseBranch: 'master',
    adapter: 'openspec',
  });
  return db;
}

const HOME = { screen: 'home', name: 'Home', purpose: 'Start', states: ['main'], directions: [] };

describe('draft store', () => {
  it('starts a change, lists and edits its screens, and runs rounds, drafts and marks', () => {
    const db = store();
    expect(startDraftChange(db, 'cena', 'quiet').state).toBe('listing');
    setDraftChangeState(db, 'cena', 'quiet', 'ready');
    expect(getDraftChange(db, 'cena', 'quiet')?.state).toBe('ready');

    replaceScreens(db, 'cena', 'quiet', [HOME, { ...HOME, screen: 'settings', name: 'Settings' }]);
    const extra = addScreen(db, 'cena', 'quiet', { ...HOME, screen: 'menu', name: 'Menu' });
    expect(listScreens(db, 'cena', 'quiet').map((s) => [s.screen, s.position])).toEqual([
      ['home', 0],
      ['settings', 1],
      ['menu', 2],
    ]);
    expect(updateScreen(db, extra.id, { name: 'Menus', stage: 'locked' })).toMatchObject({
      name: 'Menus',
      stage: 'locked',
    });

    const [home] = listScreens(db, 'cena', 'quiet');
    const r1 = insertRound(db, home?.id as number, 'low');
    const r2 = insertRound(db, home?.id as number, 'low');
    expect([r1.number, r2.number, r1.state]).toEqual([1, 2, 'running']);
    const a = insertDraft(db, { roundId: r2.id, slot: 'A', direction: 'cards', dir: '/d/a' });
    insertDraft(db, { roundId: r2.id, slot: 'B', direction: 'list', dir: '/d/b' });
    expect(() =>
      insertDraft(db, { roundId: r2.id, slot: 'A', direction: null, dir: '/d/x' }),
    ).toThrow(/UNIQUE/);
    const map = { width: 390, height: 900, parts: [{ id: 'h', x: 0, y: 0, w: 1, h: 1, text: '' }] };
    expect(updateDraft(db, a.id, { state: 'ready', maps: { phone: map } }).maps?.phone).toEqual(
      map,
    );
    updateRound(db, r2.id, { state: 'ready', alsoChanged: ['header'] });
    expect(getRound(db, r2.id)).toMatchObject({ state: 'ready', alsoChanged: ['header'] });
    expect(latestRound(db, home?.id as number)?.id).toBe(r2.id);

    const mark = insertMark(db, {
      screenId: home?.id as number,
      draftId: a.id,
      part: 'header',
      snippet: 'Today',
      kind: 'select',
      note: null,
      width: 'desktop',
    });
    expect(() =>
      insertMark(db, { ...mark, kind: 'comment', note: null, screenId: mark.screenId }),
    ).toThrow(/CHECK/);
    setMarkState(db, mark.id, 'sent', r2.number);
    expect(listMarks(db, home?.id as number, ['sent'])).toMatchObject([
      { part: 'header', sentRound: 2 },
    ]);
  });

  it('turns what was in flight at a restart into Failed', () => {
    const db = store();
    startDraftChange(db, 'cena', 'quiet');
    const [home] = replaceScreens(db, 'cena', 'quiet', [HOME]);
    const round = insertRound(db, home?.id as number, 'low');
    const draft = insertDraft(db, { roundId: round.id, slot: 'A', direction: null, dir: '/d' });
    expect(failInFlightDrafts(db)).toBe(3);
    expect(getDraftChange(db, 'cena', 'quiet')?.state).toBe('failed');
    expect(getRound(db, round.id)?.state).toBe('failed');
    expect(listDrafts(db, round.id)[0]).toMatchObject({ id: draft.id, state: 'failed' });
  });

  it('drops every row of a change', () => {
    const db = store();
    startDraftChange(db, 'cena', 'quiet');
    const [home] = replaceScreens(db, 'cena', 'quiet', [HOME]);
    const round = insertRound(db, home?.id as number, 'low');
    insertDraft(db, { roundId: round.id, slot: 'A', direction: null, dir: '/d' });
    expect(dropDraftChange(db, 'cena', 'quiet')).toBe(true);
    for (const table of ['draft_changes', 'draft_screens', 'draft_rounds', 'drafts']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n).toBe(0);
    }
  });
});

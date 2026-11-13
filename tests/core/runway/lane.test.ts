// Where each runway change stands, and what can build now (runway: Where each runway change
// stands; Changes that can build now; A merged build PR means built; build-runs: Dependencies are
// built first). The stage is derived from the store's run rows, PR states, the owner's decisions
// on parked builds and unanswered questions; the board is read through the approval views over a
// fixture host.
import { afterAll, describe, expect, it } from 'vitest';
import { createOpenSpecAdapter } from '../../../src/adapters/openspec/index.ts';
import { createBaseResolver } from '../../../src/core/git/base-ref.ts';
import { createGitFileReader } from '../../../src/core/git/reader.ts';
import {
  buildStage,
  canBuildNow,
  canPick,
  type LaneFacts,
  stageText,
} from '../../../src/core/runway/lane.ts';
import { approveChange, listApprovals } from '../../../src/core/store/approvals.ts';
import { answerCard, insertCard, listWaitingCards } from '../../../src/core/store/cards.ts';
import { decideParked, retryParked } from '../../../src/core/store/change-lane.ts';
import { openStore, upsertHost } from '../../../src/core/store/db.ts';
import {
  endRun,
  insertRun,
  insertRunChange,
  parkRunChange,
  setPullRequestState,
  updateRunChange,
} from '../../../src/core/store/runs.ts';
import { createApprovalViews } from '../../../src/server/approval-views.ts';
import { commitChange, materializeOpenSpecHost } from '../../helpers/fixture-repo.ts';
import { makeScratchDir, removeScratchDirs } from '../../helpers/scratch.ts';

afterAll(() => {
  removeScratchDirs();
});

const latest = (over: Partial<NonNullable<LaneFacts['latest']>> = {}) => ({
  runChangeId: 7,
  runId: 'r1',
  runEnded: true,
  change: 'a-thing',
  state: 'green' as const,
  reason: null,
  prUrl: 'https://github.com/x/y/pull/1',
  prState: 'open' as const,
  endedAt: 1,
  ...over,
});

describe('the stage of a runway change', () => {
  it('is nothing for a change never built, and it can build now', () => {
    expect(buildStage({})).toBeNull();
    expect(canBuildNow(null)).toBe(true);
  });

  it('is queued or building while a run going now has it', () => {
    expect(buildStage({ latest: latest({ runEnded: false, state: 'queued' }) })).toEqual({
      kind: 'queued',
    });
    const building = buildStage({ latest: latest({ runEnded: false, state: 'building' }) });
    expect(building).toEqual({ kind: 'building' });
    expect(canBuildNow(building)).toBe(false);
    expect(canPick(building)).toBe(false);
  });

  it('is PR open after a green build, and not built by Run; a closed PR does not stop it', () => {
    const open = buildStage({ latest: latest() });
    expect(open).toEqual({ kind: 'pr-open', prUrl: 'https://github.com/x/y/pull/1' });
    expect([canBuildNow(open), canPick(open)]).toEqual([false, true]);
    const closed = buildStage({ latest: latest({ prState: 'closed' }) });
    expect(closed).toEqual({ kind: 'pr-closed', prUrl: 'https://github.com/x/y/pull/1' });
    expect(canBuildNow(closed)).toBe(true);
    // Skipped since: its latest PR still says where it stands.
    expect(
      buildStage({
        latest: latest({ state: 'skipped', prUrl: null, prState: null }),
        pr: { prUrl: 'https://github.com/x/y/pull/1', prState: 'open' },
      }),
    ).toMatchObject({ kind: 'pr-open' });
  });

  it('is parked until the owner decides; Leave it parked and Re-plan hold it, Retry frees it', () => {
    const parked = latest({ state: 'parked', reason: 'Gate failed.', prUrl: null, prState: null });
    const stage = buildStage({ latest: parked });
    expect(stage).toEqual({ kind: 'parked', reason: 'Gate failed.' });
    expect([canBuildNow(stage), canPick(stage)]).toEqual([false, true]);
    const decision = (state: 'held' | 'released', reason: 'left-parked' | 'replan' | 'retry') => ({
      change: 'a-thing',
      runChangeId: 7,
      state,
      reason,
      at: 1,
    });
    const held = buildStage({ latest: parked, decision: decision('held', 'replan') });
    expect(held).toEqual({ kind: 'held', why: 'replan', reason: 'Gate failed.' });
    expect([canBuildNow(held), canPick(held)]).toEqual([false, false]);
    expect(buildStage({ latest: parked, decision: decision('released', 'retry') })).toBeNull();
    // A decision about an older parked build does not count.
    const older = { ...decision('held', 'left-parked'), runChangeId: 3 };
    expect(buildStage({ latest: parked, decision: older })).toMatchObject({ kind: 'parked' });
  });

  it('is held by an unanswered irreversible question from an earlier run, not by one asked now', () => {
    expect(buildStage({ latest: latest({ state: 'skipped' }), questions: ['r1'] })).toMatchObject({
      kind: 'held',
      why: 'question',
    });
    const now = latest({ runEnded: false, state: 'building', runId: 'r2' });
    expect(buildStage({ latest: now, questions: ['r2'] })).toEqual({ kind: 'building' });
    // Parked on its builder's questions, all answered now: free to build.
    const asked = latest({
      state: 'parked',
      reason: 'Not built: Waits on your answer to a question its builder asked in Needs You.',
    });
    expect(buildStage({ latest: asked })).toBeNull();
  });

  it('waits on a dependency that is not built', () => {
    const stage = buildStage({ waitsOn: ['a-thing'] });
    expect(stage).toEqual({ kind: 'waits', on: ['a-thing'] });
    expect([canBuildNow(stage), canPick(stage)]).toEqual([false, true]);
    expect(stageText(stage as NonNullable<typeof stage>)).toBe('waits on a-thing');
  });
});

const proposal = (title: string) => `# ${title}\n\n## Why\n\nBecause.\n`;
const TASKS = '# Tasks\n\n- [ ] 1.1 Do it\n- [ ] 1.2 Test it\n';
const URL = 'https://github.com/x/y/pull/';

async function setup() {
  const repo = await materializeOpenSpecHost({
    'openspec/config.yaml': 'schema: spec-driven\n',
    'openspec/changes/a-thing/proposal.md': proposal('A thing'),
    'openspec/changes/a-thing/tasks.md': TASKS,
    'openspec/changes/b-thing/.openspec.yaml': 'schema: spec-driven\nx-depends-on: [a-thing]\n',
    'openspec/changes/b-thing/proposal.md': proposal('B thing'),
    'openspec/changes/b-thing/tasks.md': TASKS,
    'openspec/changes/c-thing/proposal.md': proposal('C thing'),
    'openspec/changes/c-thing/tasks.md': TASKS,
  });
  const db = openStore(makeScratchDir('cp-lane'));
  upsertHost(db, {
    id: 'cena',
    root: repo.root,
    gitCommonDir: `${repo.root}/.git`,
    baseBranch: 'master',
    adapter: 'openspec',
  });
  const runtime = {
    host: { id: 'cena', baseBranch: 'master' },
    reader: createGitFileReader(repo.root),
    adapter: createOpenSpecAdapter(),
    tip: createBaseResolver(repo.root, 'master').tip,
  };
  let runs = 0;
  /** One ended run with one row per change, each set as given. */
  const run = (rows: Record<string, (id: number) => void>, ended = true) => {
    runs += 1;
    const runId = `r${runs}`;
    insertRun(db, { id: runId, hostId: 'cena', settings: {}, stopAt: null }, runs);
    const ids: Record<string, number> = {};
    Object.entries(rows).forEach(([change, set], position) => {
      const id = insertRunChange(db, { runId, change, position });
      ids[change] = id;
      set(id);
    });
    if (ended) endRun(db, runId, { reason: 'finished' });
    return { runId, ids };
  };
  const green = (n: number, state: 'open' | 'merged' | 'closed' | null) => (id: number) => {
    updateRunChange(db, id, { state: 'green', prUrl: `${URL}${n}`, baseCommit: repo.commit });
    if (state !== null) setPullRequestState(db, id, state);
  };
  const views = createApprovalViews({ store: db });
  const board = async () =>
    Object.fromEntries(
      [...(await views.board(runtime)).entries].map(([id, entry]) => [
        id,
        { status: entry.status, stage: entry.stage, canBuild: entry.canBuild },
      ]),
    );
  return { repo, db, runtime, views, run, green, board };
}

describe('the board', () => {
  it('shows each runway change where it stands, and counts only what can build now as ready', async () => {
    const { db, runtime, views, run, green, board } = await setup();
    for (const change of ['a-thing', 'b-thing', 'c-thing']) {
      approveChange(db, { hostId: 'cena', change, baseCommit: null });
    }
    run({ 'a-thing': green(1, 'open'), 'c-thing': (id) => parkRunChange(db, id, 'Gate failed.') });
    expect(await board()).toEqual({
      'a-thing': {
        status: 'on-runway',
        stage: { kind: 'pr-open', prUrl: `${URL}1` },
        canBuild: false,
      },
      'b-thing': {
        status: 'on-runway',
        stage: { kind: 'waits', on: ['a-thing'] },
        canBuild: false,
      },
      'c-thing': {
        status: 'on-runway',
        stage: { kind: 'parked', reason: 'Gate failed.' },
        canBuild: false,
      },
    });
    const runway = await views.runway(runtime);
    expect([runway.count, runway.ready]).toEqual([3, 0]);

    // The owner retries c-thing: the next run builds it, with the failure as a note.
    expect(await views.retry(runtime, 'c-thing')).toBe(true);
    expect(await views.retry(runtime, 'a-thing')).toBe(false);
    expect((await board())['c-thing']).toMatchObject({ stage: null, canBuild: true });
    expect((await views.runway(runtime)).ready).toBe(1);
  });

  it('holds a parked change the owner left parked, until Retry', async () => {
    const { db, runtime, views, run, board } = await setup();
    approveChange(db, { hostId: 'cena', change: 'c-thing', baseCommit: null });
    const { ids } = run({ 'c-thing': (id) => parkRunChange(db, id, 'Gate failed.') });
    decideParked(db, {
      hostId: 'cena',
      change: 'c-thing',
      runChangeId: ids['c-thing'] as number,
      hold: true,
      reason: 'left-parked',
    });
    expect((await board())['c-thing']?.stage).toMatchObject({ kind: 'held', why: 'left-parked' });
    const entry = (await views.runway(runtime)).onRunway[0];
    expect([entry?.canBuild, entry?.canPick]).toEqual([false, false]);
    retryParked(db, { hostId: 'cena', change: 'c-thing', note: 'Try again.' });
    expect((await board())['c-thing']).toMatchObject({ stage: null, canBuild: true });
  });

  it('holds a change whose builder asked something irreversible in an earlier run, until answered', async () => {
    const { db, run, board } = await setup();
    approveChange(db, { hostId: 'cena', change: 'c-thing', baseCommit: null });
    const { runId } = run({
      'c-thing': (id) =>
        parkRunChange(
          db,
          id,
          'Not built: Waits on your answer to a question its builder asked in Needs You.',
        ),
    });
    insertCard(db, {
      hostId: 'cena',
      kind: 'ask',
      source: 'session',
      runId,
      change: 'c-thing',
      question: 'Drop the hosted table?',
      why: 'It cannot be undone.',
      options: [
        { label: 'Drop it', consequence: 'Gone.' },
        { label: 'Keep it', consequence: 'Kept.' },
      ],
      recommended: 1,
      reversible: false,
      blocking: true,
    });
    expect((await board())['c-thing']?.stage).toMatchObject({ kind: 'held', why: 'question' });
    const card = listWaitingCards(db, 'cena')[0];
    answerCard(db, card?.id ?? '', { option: 1 });
    expect((await board())['c-thing']).toMatchObject({ stage: null, canBuild: true });
  });

  it('shows a change that waits on a dependency instead of Ready to approve, still approvable', async () => {
    const { runtime, views, board } = await setup();
    expect((await board())['b-thing']).toEqual({
      status: 'ready',
      stage: { kind: 'waits', on: ['a-thing'] },
      canBuild: false,
    });
    expect(await views.approve(runtime, 'b-thing')).toEqual({ ok: true, approved: true });
  });
});

describe('a merged build PR', () => {
  it('makes the change built only while it covers every open build task', async () => {
    const { repo, db, runtime, views, run, green, board } = await setup();
    approveChange(db, { hostId: 'cena', change: 'a-thing', baseCommit: null });
    run({ 'a-thing': green(1, 'merged') });
    // Merged, its ticks not on the base yet: built, and b-thing no longer waits.
    expect((await board())['a-thing']?.status).toBe('built');
    expect((await board())['b-thing']?.stage).toBeNull();
    expect(listApprovals(db, 'cena')).toEqual([]);
    expect(views.merged('cena')).toEqual(new Set(['a-thing']));

    // A build task added after the merge: buildable again, and b-thing waits again.
    await commitChange(
      repo.root,
      'openspec/changes/a-thing/tasks.md',
      `${TASKS}- [ ] 2.1 Handle the empty menu\n`,
    );
    expect((await board())['a-thing']).toEqual({ status: 'ready', stage: null, canBuild: false });
    expect((await board())['b-thing']?.stage).toEqual({ kind: 'waits', on: ['a-thing'] });
    expect(views.merged('cena')).toEqual(new Set());
    expect(await views.approve(runtime, 'a-thing')).toEqual({ ok: true, approved: true });
  });

  it('does not make a new change that reuses the name built', async () => {
    const { repo, db, run, green, board } = await setup();
    run({ 'a-thing': green(1, 'merged') });
    // a-thing is archived; a new a-thing with other tasks is planned later.
    await commitChange(
      repo.root,
      'openspec/changes/a-thing/tasks.md',
      '# Tasks\n\n- [ ] 1.1 Rebuild the menu page\n',
    );
    expect((await board())['a-thing']?.status).toBe('ready');
    expect(listApprovals(db, 'cena')).toEqual([]);
  });
});

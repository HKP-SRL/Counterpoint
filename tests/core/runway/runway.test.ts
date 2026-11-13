// The runway derived from the owner's approvals and the planning snapshot at the base-branch tip
// (runway: Runway is the approved work not yet built; approvals: Approval stays with the change;
// host-planning: Change statuses), through the approval views the console and the orchestrator
// use.
import { afterAll, describe, expect, it } from 'vitest';
import { createOpenSpecAdapter } from '../../../src/adapters/openspec/index.ts';
import type { ChangeFacts } from '../../../src/core/framework/port.ts';
import { createBaseResolver } from '../../../src/core/git/base-ref.ts';
import { createGitFileReader } from '../../../src/core/git/reader.ts';
import { approvalStateOf, computeRunway, endedApprovals } from '../../../src/core/runway/runway.ts';
import { approveChange, listApprovals } from '../../../src/core/store/approvals.ts';
import { openStore, upsertHost } from '../../../src/core/store/db.ts';
import { createApprovalViews } from '../../../src/server/approval-views.ts';
import { commitChange, materializeOpenSpecHost } from '../../helpers/fixture-repo.ts';
import { makeScratchDir, removeScratchDirs } from '../../helpers/scratch.ts';

afterAll(() => {
  removeScratchDirs();
});

const proposal = (title: string) => `# ${title}\n\n## Why\n\nBecause.\n`;
const open = '# Tasks\n\n- [ ] 1.1 Do it\n- [ ] 1.2 Test it\n';

async function setup() {
  const repo = await materializeOpenSpecHost({
    'openspec/config.yaml': 'schema: spec-driven\n',
    'openspec/changes/a-thing/proposal.md': proposal('A thing'),
    'openspec/changes/a-thing/tasks.md': open,
    'openspec/changes/b-thing/.openspec.yaml': 'schema: spec-driven\nx-depends-on: [a-thing]\n',
    'openspec/changes/b-thing/proposal.md': proposal('B thing'),
    'openspec/changes/b-thing/tasks.md': open,
    'openspec/changes/c-thing/proposal.md': proposal('C thing'),
  });
  const db = openStore(makeScratchDir('cp-runway'));
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
  return { repo, db, runtime, views: createApprovalViews({ store: db }) };
}

describe('approving', () => {
  it('approves a Ready to approve change in one step, and the runway goes up by one', async () => {
    const { repo, db, runtime, views } = await setup();
    expect((await views.runway(runtime)).count).toBe(0);
    expect(await views.approve(runtime, 'b-thing')).toEqual({ ok: true, approved: true });
    const runway = await views.runway(runtime);
    expect(runway).toMatchObject({ tip: repo.commit, count: 1, taskCount: 2 });
    expect(runway.onRunway.map((e) => e.changeId)).toEqual(['b-thing']);
    expect(listApprovals(db, 'cena')[0]).toMatchObject({ baseCommit: repo.commit });
    // Approving again changes nothing.
    expect(await views.approve(runtime, 'b-thing')).toEqual({ ok: true, approved: false });
  });

  it('refuses a change that is not ready, built or unknown', async () => {
    const { repo, runtime, views } = await setup();
    expect(await views.approve(runtime, 'c-thing')).toMatchObject({ ok: false, status: 409 });
    expect(await views.approve(runtime, 'nope')).toMatchObject({ ok: false, status: 404 });
    await commitChange(repo.root, 'openspec/changes/a-thing/tasks.md', '- [x] 1.1 Done\n');
    expect(await views.approve(runtime, 'a-thing')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/already built/),
    });
  });

  it('approves every ready change at once, in build order', async () => {
    const { runtime, views } = await setup();
    expect(await views.approveAll(runtime)).toEqual(['a-thing', 'b-thing']);
    expect((await views.runway(runtime)).onRunway.map((e) => e.changeId)).toEqual([
      'a-thing',
      'b-thing',
    ]);
    expect(await views.approveAll(runtime)).toEqual([]);
  });

  it('withdraws: the change leaves the runway and is Ready to approve again', async () => {
    const { runtime, views } = await setup();
    await views.approve(runtime, 'a-thing');
    expect(views.withdraw(runtime, 'a-thing')).toBe(true);
    expect(views.withdraw(runtime, 'a-thing')).toBe(false);
    expect((await views.runway(runtime)).count).toBe(0);
    expect(await views.state(runtime, 'a-thing')).toEqual({
      state: 'off-runway',
      reason: 'not-approved',
    });
  });
});

describe('an approval stays with the change', () => {
  it('stays on the runway when its plan is revised on the base branch', async () => {
    const { repo, runtime, views } = await setup();
    await views.approve(runtime, 'a-thing');
    await commitChange(repo.root, 'openspec/changes/a-thing/proposal.md', proposal('A, revised'));
    await commitChange(repo.root, '.counterpoint/config.yaml', 'gates: []\n');
    const runway = await views.runway(runtime);
    expect(runway.onRunway).toMatchObject([{ changeId: 'a-thing', title: 'A, revised' }]);
    expect(await views.state(runtime, 'a-thing')).toMatchObject({ state: 'on-runway' });
  });

  it('keeps it while tasks are ticked, and ends it once the change is built', async () => {
    const { repo, db, runtime, views } = await setup();
    await views.approve(runtime, 'a-thing');
    await commitChange(
      repo.root,
      'openspec/changes/a-thing/tasks.md',
      '- [x] 1.1 Do it\n- [ ] 1.2 Test it\n',
    );
    expect((await views.runway(runtime)).count).toBe(1);
    await commitChange(
      repo.root,
      'openspec/changes/a-thing/tasks.md',
      '- [x] 1.1 Do it\n- [x] 1.2 Test it\n',
    );
    expect((await views.runway(runtime)).count).toBe(0);
    expect(listApprovals(db, 'cena')).toEqual([]);
  });

  it('leaves an unreadable change off the runway but keeps its approval', async () => {
    const { repo, db, runtime, views } = await setup();
    await views.approve(runtime, 'a-thing');
    await commitChange(
      repo.root,
      'openspec/changes/a-thing/.openspec.yaml',
      'schema: spec-driven\ncreated: [unclosed\n',
    );
    expect((await views.runway(runtime)).count).toBe(0);
    expect(await views.state(runtime, 'a-thing')).toEqual({
      state: 'off-runway',
      reason: 'unreadable',
    });
    expect(listApprovals(db, 'cena')).toHaveLength(1);
  });

  it('works from the state of the store alone: a restart keeps the runway', async () => {
    const { db, runtime } = await setup();
    approveChange(db, { hostId: 'cena', change: 'a-thing', baseCommit: null });
    // A fresh set of views (a restarted daemon) sees the same runway.
    expect((await createApprovalViews({ store: db }).runway(runtime)).count).toBe(1);
  });
});

describe('the derivation', () => {
  const facts = (over: Partial<ChangeFacts>): ChangeFacts => ({
    id: 'a-thing',
    dir: 'openspec/changes/a-thing',
    archived: false,
    archivedOn: null,
    title: 'A thing',
    why: null,
    created: null,
    dependsOn: [],
    artifacts: { proposal: true, design: false, tasks: true, specs: [] },
    tasks: { total: 2, done: 0, ownerSteps: [] },
    unreadable: null,
    ...over,
  });
  const row = {
    hostId: 'cena',
    change: 'a-thing',
    approvedAt: 5,
    baseCommit: null,
    carriedOver: false,
  };

  it('says why an approved change is off the runway', () => {
    expect(approvalStateOf(undefined, facts({}))).toEqual({
      state: 'off-runway',
      reason: 'not-approved',
    });
    expect(approvalStateOf(row, undefined)).toMatchObject({ reason: 'missing' });
    expect(approvalStateOf(row, facts({ archived: true }))).toMatchObject({ reason: 'built' });
    expect(approvalStateOf(row, facts({}))).toEqual({
      state: 'on-runway',
      approvedAt: 5,
      baseCommit: null,
    });
  });

  it('is empty without a snapshot, and ends approvals of archived changes', () => {
    expect(computeRunway([row], null, null)).toEqual({
      tip: null,
      count: 0,
      taskCount: 0,
      onRunway: [],
    });
    expect(endedApprovals([row], [facts({ archived: true })])).toEqual(['a-thing']);
    expect(endedApprovals([row], [facts({ archived: true }), facts({})])).toEqual([]);
  });
});

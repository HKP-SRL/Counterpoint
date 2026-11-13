// Build ticks reach the base (build-ticks-and-owner-steps D-1 to D-4): the tick commit at delivery,
// ticks taken back out of an open PR whose list now conflicts, and the ticks that land after the
// merge, over a fixture host, a local bare remote and the fake GitHub.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createOpenSpecAdapter } from '../../src/adapters/openspec/index.ts';
import { BuildTicks, deliveryTicks } from '../../src/build/build-ticks.ts';
import { pushBranch, pushBranchCommit, pushPlanCommit } from '../../src/build/deliver.ts';
import { PlanningLane } from '../../src/build/planning-lane.ts';
import { findChange } from '../../src/core/framework/port.ts';
import { fetchBaseBranch } from '../../src/core/git/base-fetch.ts';
import { createGitFileReader } from '../../src/core/git/reader.ts';
import { runGit } from '../../src/core/git/run.ts';
import { getCard } from '../../src/core/store/cards.ts';
import { openStore, upsertHost } from '../../src/core/store/db.ts';
import { EventBus } from '../../src/core/store/events.ts';
import { livePlanningWrites } from '../../src/core/store/planning-writes.ts';
import {
  getRunChange,
  insertRun,
  insertRunChange,
  setPullRequestState,
  updateRunChange,
} from '../../src/core/store/runs.ts';
import { CardDesk } from '../../src/server/cards.ts';
import { FakeGitHub } from '../helpers/fake-github.ts';
import { materializeOpenSpecHost } from '../helpers/fixture-repo.ts';
import {
  commitAll,
  gitIn,
  makeScratchDir,
  removeScratchDirs,
  writeFileIn,
} from '../helpers/scratch.ts';

const cleanup: string[] = [];
afterAll(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
  removeScratchDirs();
});

const TASKS =
  '# Tasks\n\n- [ ] 13.1 Build it\n- [ ] 13.2 Test it\n- [ ] 13.3 Owner: check it on a real device\n\nSome notes.\n\n- [ ] 13.4 Owner: audit the UI\n';
const TASKS_PATH = 'openspec/changes/a-thing/tasks.md';
const adapter = createOpenSpecAdapter();

async function fixtureHost() {
  const repo = await materializeOpenSpecHost({
    'openspec/config.yaml': 'schema: spec-driven\n',
    'openspec/changes/a-thing/.openspec.yaml': 'schema: spec-driven\n',
    'openspec/changes/a-thing/proposal.md': '# A thing\n\n## Why\n\nBecause.\n',
    [TASKS_PATH]: TASKS,
    'src/app.ts': 'export {}\n',
  });
  const snapshot = await adapter.snapshot(createGitFileReader(repo.root), repo.commit);
  const change = findChange(snapshot.changes, 'a-thing');
  if (change === undefined) throw new Error('no change');
  const worktree = join(makeScratchDir('ticks-wt'), 'a-thing');
  await gitIn(repo.root, ['worktree', 'add', '-q', '-b', 'cp/a-thing', worktree, repo.commit]);
  cleanup.push(worktree);
  return { repo, change, worktree, scratch: makeScratchDir('ticks-scratch') };
}

const show = async (root: string, rev: string) =>
  (await runGit(root, ['show', `${rev}:${TASKS_PATH}`])).stdout;

describe('the tick commit at delivery', () => {
  it('commits as the owner with the run trailer, and a later delivery adds only the new ticks', async () => {
    const { repo, change, worktree, scratch } = await fixtureHost();
    const deliver = (ticked: string[]) =>
      deliveryTicks({
        worktree,
        branch: 'cp/a-thing',
        change,
        rules: adapter,
        baseCommit: repo.commit,
        baseNow: repo.commit,
        ticked,
        runId: '20261113-1200-abcdef',
        scratch,
      });
    const first = await deliver(['13.1 Build it', '13.3 Owner: check it on a real device']);
    expect(first).toMatchObject({ place: 'pr', flag: null });
    expect(await show(repo.root, 'cp/a-thing')).toBe(TASKS.replace('- [ ] 13.1', '- [x] 13.1'));
    const meta = await runGit(repo.root, [
      'log',
      '-1',
      '--format=%s|%an|%(trailers:key=Counterpoint-Run,valueonly)',
      'cp/a-thing',
    ]);
    expect(meta.stdout.trim()).toBe('cp: a-thing ticks|Counterpoint Test|20261113-1200-abcdef');

    // Built again on the same branch: one more commit, with only the tick since.
    const second = await deliver(['13.1 Build it', '13.2 Test it']);
    expect(second.commit).not.toBe(first.commit);
    const count = await runGit(repo.root, ['rev-list', '--count', `${repo.commit}..cp/a-thing`]);
    expect(count.stdout.trim()).toBe('2');
    const diff = await runGit(repo.root, ['diff', '-U0', `${first.commit}`, 'cp/a-thing']);
    expect(diff.stdout.split('\n').filter((line) => /^[-+]- \[/.test(line))).toEqual([
      '-- [ ] 13.2 Test it',
      '+- [x] 13.2 Test it',
    ]);
    // Nothing new: no commit.
    expect(await deliver(['13.1 Build it', '13.2 Test it'])).toMatchObject({ commit: null });
  });
});

const SLUG = { host: 'github.com', owner: 'alex', repo: 'Cena' };
const ENV = { PATH: process.env.PATH ?? '' };
const BUILD_TICKS = ['13.1 Build it', '13.2 Test it', '13.4 Owner: audit the UI'];

/**
 * A build PR open on the fake GitHub: the branch delivered with its tick commit and pushed to a
 * local bare remote, its run change recorded as delivered by this version.
 */
async function openBuildPr() {
  const fx = await fixtureHost();
  const { repo, worktree } = fx;
  const bare = makeScratchDir('ticks-bare');
  await runGit(bare, ['init', '--bare', '--quiet', '--initial-branch=master']);
  await gitIn(repo.root, ['remote', 'add', 'origin', bare]);
  await gitIn(repo.root, ['push', '-q', 'origin', 'master']);
  await gitIn(repo.root, ['fetch', '-q', 'origin']);
  const target = { remote: 'origin', url: bare, kind: 'ssh' as const, slug: SLUG };
  const hostRow = { id: 'cena', root: repo.root, baseBranch: 'master' };
  const delivered = await deliveryTicks({
    worktree,
    branch: 'cp/a-thing',
    change: fx.change,
    rules: adapter,
    baseCommit: repo.commit,
    baseNow: repo.commit,
    ticked: BUILD_TICKS,
    runId: 'r1',
    scratch: fx.scratch,
  });
  expect(delivered.place).toBe('pr');
  const push = { host: { ...hostRow, gitCommonDir: '' }, branch: 'cp/a-thing', target, env: ENV };
  await pushBranch({ ...push, ssh: '/usr/bin/ssh' });

  const home = makeScratchDir('ticks-home');
  const db = openStore(home);
  upsertHost(db, { ...hostRow, gitCommonDir: join(repo.root, '.git'), adapter: 'openspec' });
  insertRun(db, { id: 'r1', hostId: 'cena', settings: {}, stopAt: null });
  const rowId = insertRunChange(db, { runId: 'r1', change: 'a-thing', position: 0 });
  const github = new FakeGitHub(bare);
  const opened = await github.gh(
    ['pr', 'create', '--head', 'cp/a-thing', '--base', 'master', '--title', 'A thing'],
    { cwd: home },
  );
  const prUrl = opened.stdout.trim();
  updateRunChange(db, rowId, {
    state: 'green',
    baseCommit: repo.commit,
    branch: 'cp/a-thing',
    worktree,
    prUrl,
    taskTicks: BUILD_TICKS,
    ticks: 'pr',
  });
  setPullRequestState(db, rowId, 'open');

  /** The owner's Done on a step lands on the base (another clone pushed it); then it is fetched. */
  const tickOnBase = async (task: string) => {
    const clone = makeScratchDir('ticks-clone');
    await gitIn(clone, ['clone', '-q', bare, '.']);
    await gitIn(clone, ['config', 'user.name', 'Owner']);
    await gitIn(clone, ['config', 'user.email', 'owner@example.invalid']);
    const text = (await runGit(clone, ['show', `HEAD:${TASKS_PATH}`])).stdout;
    writeFileIn(clone, TASKS_PATH, text.replace(`- [ ] ${task}`, `- [x] ${task}`));
    await commitAll(clone, 'owner step done');
    await gitIn(clone, ['push', '-q', 'origin', 'HEAD:master']);
    await gitIn(repo.root, ['fetch', '-q', 'origin']);
  };
  const fetchBase = async () => {
    await fetchBaseBranch({ repo: repo.root, baseBranch: 'master', remote: 'origin', env: ENV });
    return { error: null };
  };
  const desk = new CardDesk({ store: db, bus: new EventBus() });
  const lane = new PlanningLane({
    db,
    home,
    host: () => hostRow,
    rules: () => ({ isPlanningPath: adapter.isPlanningPath, tickTask: adapter.tickTask }),
    ownerEnv: async () => ENV,
    fetchBase,
    gh: github.gh,
    pushTarget: async () => target,
    push: (input) => pushPlanCommit({ ...input, ssh: '/usr/bin/ssh' }),
    settleMs: 0,
  });
  const pushed: string[] = [];
  const ticks = new BuildTicks({
    db,
    home,
    runtime: () => ({ host: hostRow, reader: createGitFileReader(repo.root), adapter }),
    fetchBase,
    raise: (card) => desk.raise(card),
    answer: (cardId) => desk.answer(cardId, { option: 0 }),
    submit: (hostId, write, cardId) => lane.submit(hostId, write, cardId),
    gh: github.gh,
    pushTarget: async () => target,
    push: async (input) => {
      pushed.push(input.commit);
      await pushBranchCommit({ ...input, ssh: '/usr/bin/ssh' });
    },
  });
  const remoteList = async (ref: string) =>
    (await runGit(bare, ['show', `${ref}:${TASKS_PATH}`])).stdout;
  return { ...fx, bare, db, rowId, prUrl, github, lane, ticks, pushed, tickOnBase, remoteList };
}

describe('ticks of an open build PR', () => {
  it('takes them back out when a neighbouring tick lands on the base, so the PR still merges', async () => {
    const pr = await openBuildPr();
    await pr.ticks.tick('cena', ENV);
    expect(pr.pushed).toEqual([]);

    await pr.tickOnBase('13.3 Owner: check it on a real device');
    await pr.ticks.tick('cena', ENV);
    expect(pr.pushed).toHaveLength(1);
    const head = await runGit(pr.bare, ['log', '-1', '--format=%s', 'cp/a-thing']);
    expect(head.stdout.trim()).toBe('cp: a-thing ticks out');
    expect(await pr.remoteList('cp/a-thing')).toBe(TASKS);
    const trial = await runGit(pr.bare, ['merge-tree', '--write-tree', 'master', 'cp/a-thing'], {
      allowExitCodes: [0, 1],
    });
    expect(trial.exitCode).toBe(0);
    expect(getRunChange(pr.db, pr.rowId)?.ticks).toBe('after-merge');
    // The local branch follows, so the next delivery pushes on top of it.
    const local = await runGit(pr.repo.root, ['rev-parse', 'cp/a-thing']);
    expect(local.stdout.trim()).toBe(pr.pushed[0]);
  });

  it("pushes nothing over someone else's commit on the remote branch", async () => {
    const pr = await openBuildPr();
    const clone = makeScratchDir('ticks-other');
    await gitIn(clone, ['clone', '-q', '--branch', 'cp/a-thing', pr.bare, '.']);
    await gitIn(clone, ['config', 'user.name', 'Someone']);
    await gitIn(clone, ['config', 'user.email', 'someone@example.invalid']);
    await commitAll(clone, 'a fix of my own');
    await gitIn(clone, ['push', '-q', 'origin', 'HEAD:cp/a-thing']);
    const theirs = (await runGit(pr.bare, ['rev-parse', 'cp/a-thing'])).stdout.trim();

    await pr.tickOnBase('13.3 Owner: check it on a real device');
    await pr.ticks.tick('cena', ENV);
    expect(pr.pushed).toEqual([]);
    expect((await runGit(pr.bare, ['rev-parse', 'cp/a-thing'])).stdout.trim()).toBe(theirs);
    expect(getRunChange(pr.db, pr.rowId)?.ticks).toBe('pr');
  });
});

describe('ticks after the build PR merges', () => {
  it('lands every recorded build tick missing on the base, never an owner step, in one small PR', async () => {
    const pr = await openBuildPr();
    await pr.tickOnBase('13.3 Owner: check it on a real device');
    await pr.ticks.tick('cena', ENV);
    expect(getRunChange(pr.db, pr.rowId)?.ticks).toBe('after-merge');
    // The owner merges the build PR on GitHub; the minute tick finds it merged.
    const head = (await runGit(pr.bare, ['rev-parse', 'cp/a-thing'])).stdout.trim();
    const merged = await pr.github.gh(
      ['pr', 'merge', pr.prUrl, '--squash', '--match-head-commit', head],
      { cwd: pr.scratch },
    );
    expect(merged.exitCode).toBe(0);
    setPullRequestState(pr.db, pr.rowId, 'merged');

    await pr.ticks.tick('cena', ENV);
    await pr.lane.idle('cena');
    expect(await pr.remoteList('master')).toBe(
      TASKS.replace('- [ ] 13.1', '- [x] 13.1')
        .replace('- [ ] 13.2', '- [x] 13.2')
        .replace('- [ ] 13.3', '- [x] 13.3'),
    );
    expect(getRunChange(pr.db, pr.rowId)?.ticks).toBe('base');
    expect(livePlanningWrites(pr.db, 'cena')).toEqual([]);
    // Once only.
    await pr.ticks.tick('cena', ENV);
    expect(pr.github.prs.filter((p) => p.head.startsWith('cp-plan/'))).toHaveLength(1);
  });

  it('keeps a blocked after-merge write with Retry and Cancel', async () => {
    const pr = await openBuildPr();
    await pr.tickOnBase('13.3 Owner: check it on a real device');
    await pr.ticks.tick('cena', ENV);
    const head = (await runGit(pr.bare, ['rev-parse', 'cp/a-thing'])).stdout.trim();
    await pr.github.gh(['pr', 'merge', pr.prUrl, '--squash', '--match-head-commit', head], {
      cwd: pr.scratch,
    });
    setPullRequestState(pr.db, pr.rowId, 'merged');
    pr.github.checks = 'failing';

    await pr.ticks.tick('cena', ENV);
    await pr.lane.idle('cena');
    const [write] = livePlanningWrites(pr.db, 'cena');
    expect(write).toMatchObject({ state: 'blocked', blocked: 'checks' });
    // Its card is answered, so Needs You lists it under Landing with Retry and Cancel.
    expect(getCard(pr.db, write?.cardId as string)).toMatchObject({
      kind: 'build-ticks',
      state: 'answered',
      question: 'Tick 2 build tasks of a-thing on master',
    });
  });
});

// Planning writes land as small PRs (owner-inbox D-11, D-12; planning-writes). A local bare
// repository stands in for GitHub's git side and a fake `gh` for its PR side: one test per way the
// owner's click could be lost. Each ends merged, or with the write kept and Retry offered.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createOpenSpecAdapter } from '../../src/adapters/openspec/index.ts';
import { DeliveryError, pushPlanCommit } from '../../src/build/deliver.ts';
import { PlanningLane } from '../../src/build/planning-lane.ts';
import { fetchBaseBranch } from '../../src/core/git/base-fetch.ts';
import { runGit } from '../../src/core/git/run.ts';
import { answerCard, getCard, insertCard } from '../../src/core/store/cards.ts';
import { openStore, upsertHost } from '../../src/core/store/db.ts';
import { getPlanningWrite } from '../../src/core/store/planning-writes.ts';
import { FakeGitHub } from '../helpers/fake-github.ts';
import { materializeOpenSpecHost } from '../helpers/fixture-repo.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

afterAll(removeScratchDirs);

const adapter = createOpenSpecAdapter();
const TASKS = 'openspec/changes/a-thing/tasks.md';
const LIST = '# Tasks\n\n- [ ] 1.1 Owner: check the menu\n- [ ] 1.2 Build the menu\n';
const TICKED = '# Tasks\n\n- [x] 1.1 Owner: check the menu\n- [ ] 1.2 Build the menu\n';
const SLUG = { host: 'github.com', owner: 'alex', repo: 'Cena' };

async function setup(options: { remote?: boolean } = {}) {
  const repo = await materializeOpenSpecHost(
    { 'openspec/config.yaml': 'schema: spec-driven\n', [TASKS]: LIST, 'src/app.ts': 'export {}\n' },
    { label: 'plan-lane' },
  );
  const bare = makeScratchDir('plan-lane-bare');
  await runGit(bare, ['init', '--bare', '--quiet', '--initial-branch=master']);
  if (options.remote !== false) {
    await runGit(repo.root, ['remote', 'add', 'origin', bare]);
    await runGit(repo.root, ['push', '--quiet', 'origin', 'refs/heads/master:refs/heads/master']);
    await runGit(repo.root, ['fetch', '--quiet', 'origin']);
  }
  const home = makeScratchDir('plan-lane-home');
  const db = openStore(home);
  const host = { id: 'cena', root: repo.root, baseBranch: 'master' };
  upsertHost(db, { ...host, gitCommonDir: join(repo.root, '.git'), adapter: 'openspec' });
  const github = new FakeGitHub(bare);
  let failPushes = 0;
  const lane = () =>
    new PlanningLane({
      db,
      home,
      host: () => host,
      rules: () => ({ isPlanningPath: adapter.isPlanningPath, tickTask: adapter.tickTask }),
      ownerEnv: async () => ({ PATH: process.env.PATH ?? '' }),
      fetchBase: async (h, env) => {
        try {
          await fetchBaseBranch({ repo: h.root, baseBranch: h.baseBranch, remote: 'origin', env });
          return { error: null };
        } catch (error) {
          return { error: (error as Error).message };
        }
      },
      gh: github.gh,
      pushTarget: async () => ({ remote: 'origin', url: bare, kind: 'ssh', slug: SLUG }),
      push: async (input) => {
        if (failPushes > 0) {
          failPushes -= 1;
          throw new DeliveryError(`Pushing ${input.branch} failed: Permission denied (publickey).`);
        }
        await pushPlanCommit({ ...input, ssh: '/usr/bin/ssh' });
      },
      settleMs: 0,
    });
  const remoteFile = async () =>
    (await runGit(bare, ['show', `refs/heads/master:${TASKS}`])).stdout;
  return {
    repo,
    bare,
    db,
    host,
    github,
    lane,
    remoteFile,
    failNextPush: () => {
      failPushes = 1;
    },
  };
}

const tick = {
  message: 'Tick 1.1 of a-thing',
  edits: [{ kind: 'tick' as const, path: TASKS, task: 'Owner: check the menu' }],
};

async function submitted(lane: PlanningLane, write = tick, cardId: string | null = null) {
  const row = lane.submit('cena', write, cardId);
  await lane.idle('cena');
  return row.id;
}

describe('PlanningLane', () => {
  it("merges a clean PR at once and never touches the owner's checkout or local base", async () => {
    const { repo, db, github, lane, remoteFile } = await setup();
    // The owner has the base branch checked out with an uncommitted edit to the same file.
    const file = join(repo.root, TASKS);
    writeFileSync(file, `${LIST}- [ ] 1.3 Mine, not saved yet\n`);
    const localBefore = (await runGit(repo.root, ['rev-parse', 'refs/heads/master'])).stdout;
    const branchesBefore = (await runGit(repo.root, ['branch', '--list'])).stdout;

    const id = await submitted(lane());

    const row = getPlanningWrite(db, id);
    expect(row).toMatchObject({ state: 'merged', prUrl: 'https://github.com/alex/Cena/pull/1' });
    expect(await remoteFile()).toBe(TICKED);
    expect(github.prs[0]).toMatchObject({ head: `cp-plan/${id}`, base: 'master', state: 'MERGED' });
    // Fetched: the console reads the remote base.
    const fetched = await runGit(repo.root, ['show', `refs/remotes/origin/master:${TASKS}`]);
    expect(fetched.stdout).toBe(TICKED);
    // The owner's side is as it was.
    expect((await runGit(repo.root, ['rev-parse', 'refs/heads/master'])).stdout).toBe(localBefore);
    expect((await runGit(repo.root, ['branch', '--list'])).stdout).toBe(branchesBefore);
    expect(readFileSync(file, 'utf8')).toBe(`${LIST}- [ ] 1.3 Mine, not saved yet\n`);
    expect((await runGit(repo.root, ['symbolic-ref', 'HEAD'])).stdout.trim()).toBe(
      'refs/heads/master',
    );
    expect(github.calls.some((args) => args.includes('--admin'))).toBe(false);
    const merge = github.calls.find((args) => args[1] === 'merge');
    expect(merge).toEqual(expect.arrayContaining(['--squash', '--match-head-commit']));
  });

  it('waits for required checks, then merges on the tick with no second click', async () => {
    const { db, github, lane, remoteFile } = await setup();
    github.checks = 'pending';
    const first = lane();
    const id = await submitted(first);
    expect(getPlanningWrite(db, id)?.state).toBe('waiting');
    expect(await remoteFile()).toBe(LIST);

    github.checks = 'passing';
    await first.tick('cena');
    expect(getPlanningWrite(db, id)?.state).toBe('merged');
    expect(await remoteFile()).toBe(TICKED);
  });

  it('keeps a write whose checks failed, and Retry lands it once they pass', async () => {
    const { db, github, lane, remoteFile } = await setup();
    github.checks = 'failing';
    const l = lane();
    const id = await submitted(l);
    expect(getPlanningWrite(db, id)).toMatchObject({
      state: 'blocked',
      blocked: 'checks',
      reason: 'Checks failed.',
      prUrl: 'https://github.com/alex/Cena/pull/1',
    });
    expect(await remoteFile()).toBe(LIST);

    github.checks = 'passing';
    await l.retry(id);
    expect(getPlanningWrite(db, id)?.state).toBe('merged');
    expect(await remoteFile()).toBe(TICKED);
  });

  it('says a review is needed and does not merge', async () => {
    const { db, github, lane, remoteFile } = await setup();
    github.reviewRequired = true;
    const l = lane();
    const id = await submitted(l);
    expect(getPlanningWrite(db, id)).toMatchObject({ state: 'blocked', blocked: 'review' });
    expect(getPlanningWrite(db, id)?.reason).toMatch(/review/);
    await l.tick('cena');
    expect(getPlanningWrite(db, id)?.state).toBe('blocked');
    expect(await remoteFile()).toBe(LIST);
    expect(github.calls.some((args) => args.includes('--admin'))).toBe(false);
  });

  it('makes the write again on a base moved by a conflicting edit, keeping both edits', async () => {
    const { repo, db, github, lane, remoteFile, bare } = await setup();
    // Another PR ticks the next line while ours is open: git cannot merge the two.
    github.afterCreate = async () => {
      const other = makeScratchDir('plan-lane-other');
      await runGit(other, ['clone', '--quiet', bare, '.']);
      writeFileSync(join(other, TASKS), LIST.replace('[ ] 1.2', '[x] 1.2'));
      await runGit(other, ['add', TASKS]);
      await runGit(other, ['commit', '--quiet', '-m', 'other PR'], {
        env: {
          GIT_AUTHOR_NAME: 'Other',
          GIT_AUTHOR_EMAIL: 'o@example.invalid',
          GIT_COMMITTER_NAME: 'Other',
          GIT_COMMITTER_EMAIL: 'o@example.invalid',
        },
      });
      await runGit(other, ['push', '--quiet', 'origin', 'HEAD:refs/heads/master']);
    };
    const id = await submitted(lane());

    expect(getPlanningWrite(db, id)).toMatchObject({ state: 'merged', redos: 1 });
    expect(await remoteFile()).toBe(
      LIST.replace('[ ] 1.1', '[x] 1.1').replace('[ ] 1.2', '[x] 1.2'),
    );
    expect(github.prs).toHaveLength(1);
    expect((await runGit(repo.root, ['rev-parse', 'refs/heads/master'])).stdout.trim()).toBe(
      repo.commit,
    );
  });

  it('keeps a write whose PR was closed, and Retry opens a new one', async () => {
    const { db, github, lane, remoteFile } = await setup();
    github.checks = 'pending';
    const l = lane();
    const id = await submitted(l);
    (github.prs[0] as { state: string }).state = 'CLOSED';
    github.checks = 'none';
    await l.tick('cena');
    expect(getPlanningWrite(db, id)).toMatchObject({ state: 'blocked', blocked: 'closed' });

    await l.retry(id);
    expect(getPlanningWrite(db, id)).toMatchObject({
      state: 'merged',
      prUrl: 'https://github.com/alex/Cena/pull/2',
    });
    expect(await remoteFile()).toBe(TICKED);
  });

  it('keeps a write whose push failed, and Retry lands it', async () => {
    const { db, github, lane, remoteFile, failNextPush } = await setup();
    failNextPush();
    const l = lane();
    const id = await submitted(l);
    expect(getPlanningWrite(db, id)).toMatchObject({
      state: 'blocked',
      blocked: 'push',
      prUrl: null,
    });
    expect(getPlanningWrite(db, id)?.reason).toMatch(/Permission denied/);
    expect(github.prs).toHaveLength(0);

    await l.retry(id);
    expect(getPlanningWrite(db, id)?.state).toBe('merged');
    expect(await remoteFile()).toBe(TICKED);
  });

  it('picks a waiting write up after a restart and merges it when the checks pass', async () => {
    const { db, github, lane, remoteFile } = await setup();
    github.checks = 'pending';
    const id = await submitted(lane());
    expect(getPlanningWrite(db, id)?.state).toBe('waiting');

    // A new daemon: a new lane over the same store.
    github.checks = 'passing';
    await lane().tick('cena');
    expect(getPlanningWrite(db, id)?.state).toBe('merged');
    expect(await remoteFile()).toBe(TICKED);
  });

  it('Cancel closes the PR, leaves the base alone and puts the card back', async () => {
    const { db, github, lane, remoteFile } = await setup();
    github.reviewRequired = true;
    const { card } = insertCard(db, {
      hostId: 'cena',
      kind: 'owner-step',
      source: 'change',
      change: 'a-thing',
      question: 'Check the menu?',
      why: 'Only you can.',
      options: [
        { label: 'Done', consequence: 'Ticks it.' },
        { label: 'Not yet', consequence: 'Stays open.' },
      ],
      recommended: 0,
      reversible: true,
      blocking: false,
    });
    answerCard(db, card.id, { option: 0 });
    const l = lane();
    const id = await submitted(l, tick, card.id);
    expect(getPlanningWrite(db, id)?.state).toBe('blocked');

    await l.cancel(id);
    expect(getPlanningWrite(db, id)?.state).toBe('cancelled');
    expect(github.prs[0]?.state).toBe('CLOSED');
    expect(await remoteFile()).toBe(LIST);
    expect(getCard(db, card.id)).toMatchObject({ state: 'open', answer: null, outcome: null });
  });

  it('commits locally on a host with no remote', async () => {
    const { repo, db, github, lane } = await setup({ remote: false });
    const id = await submitted(lane());
    expect(getPlanningWrite(db, id)?.state).toBe('merged');
    expect((await runGit(repo.root, ['show', `refs/heads/master:${TASKS}`])).stdout).toBe(TICKED);
    expect(github.calls).toHaveLength(0);
  });
});

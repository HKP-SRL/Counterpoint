// Owner steps are cards (owner-inbox 4.2, 4.3; owner-steps: Owner steps are cards, Do it for me,
// Land it). A fixture host with a local bare remote and a fake `gh`: the owner's Done must land as
// a small PR that ticks exactly that step, and a card must never be lost or raised twice. Do it for
// me installs a pinned package from a local registry in its own worktree; nothing reaches the base
// until Land it, which lands exactly the shown diff plus the tick, and a base that changed the same
// files lands nothing and gives the step back.
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOpenSpecAdapter } from '../../src/adapters/openspec/index.ts';
import type { AgentRun, AgentRunner, AgentRunRequest } from '../../src/agent/runner.ts';
import { pushPlanCommit } from '../../src/build/deliver.ts';
import { OwnerSteps } from '../../src/build/owner-steps.ts';
import { PlanningLane } from '../../src/build/planning-lane.ts';
import { fetchBaseBranch } from '../../src/core/git/base-fetch.ts';
import { runGit } from '../../src/core/git/run.ts';
import { getCard, listWaitingCards } from '../../src/core/store/cards.ts';
import { openStore, upsertHost } from '../../src/core/store/db.ts';
import { EventBus } from '../../src/core/store/events.ts';
import { landCardResult } from '../../src/core/store/owner-step-results.ts';
import { cardPlanningWrite } from '../../src/core/store/planning-writes.ts';
import {
  insertRun,
  insertRunChange,
  setPullRequestState,
  updateRunChange,
} from '../../src/core/store/runs.ts';
import { createApprovalViews } from '../../src/server/approval-views.ts';
import { CardDesk } from '../../src/server/cards.ts';
import { createHostRuntimes } from '../../src/server/hosts.ts';
import { cardView } from '../../src/server/routes/needs-you.ts';
import { FakeGitHub } from '../helpers/fake-github.ts';
import { materializeOpenSpecHost } from '../helpers/fixture-repo.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(`${root}-worktrees`, { recursive: true, force: true });
  removeScratchDirs();
});

const adapter = createOpenSpecAdapter();
const META = 'schema: spec-driven\ncreated: 2026-11-01\n';
const TASKS = 'openspec/changes/a-thing/tasks.md';
const LIST =
  '# Tasks\n\n- [ ] 1.1 Owner: check the menu\n- [ ] 1.2 Build the menu\n- [ ] 1.3 Owner: tell the cook\n';
const SLUG = { host: 'github.com', owner: 'alex', repo: 'Cena' };

/** A runner that stands in for a Do it for me session. */
type FakeSession = (request: AgentRunRequest) => Promise<string>;

const sessionRun = (text: string): AgentRun => {
  const result = { type: 'result', subtype: 'success', result: text };
  return { events: [result], raw: '', stderr: '', exitCode: 0, timedOut: false, result };
};

async function setup(
  options: { list?: string; files?: Record<string, string>; session?: FakeSession } = {},
) {
  const list = options.list ?? LIST;
  const repo = await materializeOpenSpecHost(
    {
      'openspec/config.yaml': 'schema: spec-driven\n',
      'openspec/changes/a-thing/.openspec.yaml': META,
      'openspec/changes/a-thing/proposal.md': '# A thing\n\n## Why\n\nBecause.\n',
      [TASKS]: list,
      // No proposal: not planned, so its owner step is not a card yet.
      'openspec/changes/b-draft/.openspec.yaml': META,
      'openspec/changes/b-draft/tasks.md': '# Tasks\n\n- [ ] 1.1 Owner: pick a name\n',
      ...options.files,
    },
    { label: 'owner-steps' },
  );
  roots.push(repo.root);
  const bare = makeScratchDir('owner-steps-bare');
  await runGit(bare, ['init', '--bare', '--quiet', '--initial-branch=master']);
  await runGit(repo.root, ['remote', 'add', 'origin', bare]);
  await runGit(repo.root, ['push', '--quiet', 'origin', 'refs/heads/master:refs/heads/master']);
  await runGit(repo.root, ['fetch', '--quiet', 'origin']);
  const home = makeScratchDir('owner-steps-home');
  const store = openStore(home);
  const host = { id: 'cena', root: repo.root, baseBranch: 'master' };
  upsertHost(store, { ...host, gitCommonDir: join(repo.root, '.git'), adapter: 'openspec' });
  const github = new FakeGitHub(bare);
  const fetchBase = async (h: typeof host, env: Readonly<Record<string, string>>) => {
    try {
      await fetchBaseBranch({ repo: h.root, baseBranch: h.baseBranch, remote: 'origin', env });
      return { error: null };
    } catch (error) {
      return { error: (error as Error).message };
    }
  };
  const lane = new PlanningLane({
    db: store,
    home,
    host: () => host,
    rules: () => ({ isPlanningPath: adapter.isPlanningPath, tickTask: adapter.tickTask }),
    ownerEnv: async () => ({ PATH: process.env.PATH ?? '' }),
    fetchBase,
    gh: github.gh,
    pushTarget: async () => ({ remote: 'origin', url: bare, kind: 'ssh', slug: SLUG }),
    push: (input) => pushPlanCommit({ ...input, ssh: '/usr/bin/ssh' }),
    settleMs: 0,
  });
  const runtimes = createHostRuntimes({ store });
  const approvals = createApprovalViews({ store });
  const desk = new CardDesk({ store, bus: new EventBus() });
  const sessions: AgentRunRequest[] = [];
  const runner: AgentRunner = {
    async run(request) {
      sessions.push(request);
      return sessionRun(await (options.session ?? (async () => 'Nothing to do.'))(request));
    },
  };
  const steps = new OwnerSteps({
    desk,
    runtimes,
    approvals,
    lane,
    home,
    ownerEnv: async () => ({ PATH: process.env.PATH ?? '' }),
    fetchBase,
    runner: () => runner,
  });
  desk.setActionRunner((action, { card, note }) => steps.act(action, card, note));
  /** Another PR lands on the remote base: `text` at `path` (the task list by default). */
  const landElsewhere = async (text: string, path: string = TASKS) => {
    const clone = makeScratchDir('owner-steps-clone');
    await runGit(clone, ['clone', '--quiet', bare, '.']);
    await runGit(clone, ['config', 'user.email', 'o@example.invalid']);
    await runGit(clone, ['config', 'user.name', 'Other']);
    writeFileSync(join(clone, path), text);
    await runGit(clone, ['commit', '--quiet', '-am', 'elsewhere']);
    await runGit(clone, ['push', '--quiet', 'origin', 'HEAD:master']);
    await fetchBase(host, { PATH: process.env.PATH ?? '' });
  };
  return { repo, bare, store, desk, steps, lane, github, landElsewhere, sessions };
}

describe('owner steps as cards', () => {
  it('raises one card per open owner step of a planned change, and Done lands the tick as a merged PR', async () => {
    const { bare, store, desk, steps, lane, github } = await setup();
    await steps.sync('cena');
    await steps.sync('cena');
    const cards = listWaitingCards(store, 'cena');
    expect(cards.map((card) => [card.kind, card.change, card.question])).toEqual([
      ['owner-step', 'a-thing', 'tell the cook'],
      ['owner-step', 'a-thing', 'check the menu'],
    ]);
    const menu = cards.find((card) => card.question === 'check the menu');
    expect(menu?.options.map((option) => option.label)).toEqual(['Done', 'Do it for me']);

    await desk.answer(menu?.id as string, { option: 0 });
    await lane.idle('cena');

    const write = cardPlanningWrite(store, menu?.id as string);
    expect(write?.state).toBe('merged');
    expect(github.prs[0]?.state).toBe('MERGED');
    const remote = (await runGit(bare, ['show', `refs/heads/master:${TASKS}`])).stdout;
    expect(remote).toBe(LIST.replace('[ ] 1.1', '[x] 1.1'));
    // The ticked step's card stays answered; the other step is still waiting; nothing is raised again.
    await steps.sync('cena');
    expect(getCard(store, menu?.id as string)?.state).toBe('answered');
    expect(listWaitingCards(store, 'cena').map((card) => card.question)).toEqual(['tell the cook']);
  });

  it('resolves a card whose step was ticked elsewhere and reopens it when the step comes back', async () => {
    const { store, steps, landElsewhere } = await setup();
    await steps.sync('cena');
    const cook = listWaitingCards(store, 'cena').find((card) => card.question === 'tell the cook');
    await landElsewhere(LIST.replace('[ ] 1.3', '[x] 1.3'));
    await steps.sync('cena');
    expect(getCard(store, cook?.id as string)?.state).toBe('resolved');
    await landElsewhere(LIST);
    await steps.sync('cena');
    expect(getCard(store, cook?.id as string)?.state).toBe('open');
    expect(listWaitingCards(store, 'cena')).toHaveLength(2);
  });

  it("keeps a built change's open steps as cards naming its merged PR, until it is archived", async () => {
    const { repo, bare, store, steps } = await setup();
    await steps.sync('cena');
    // The build PR merged: built, both owner steps still open.
    const prUrl = 'https://github.com/alex/Cena/pull/16';
    insertRun(store, { id: 'r1', hostId: 'cena', settings: {}, stopAt: null });
    const row = insertRunChange(store, { runId: 'r1', change: 'a-thing', position: 0 });
    updateRunChange(store, row, { state: 'green', prUrl });
    setPullRequestState(store, row, 'merged');
    await steps.sync('cena');
    const cards = listWaitingCards(store, 'cena');
    const why = 'a-thing is merged (PR #16). A step after the build only you can sign off.';
    expect(cards.map((card) => [card.question, card.why])).toEqual([
      ['tell the cook', why],
      ['check the menu', why],
    ]);
    expect(cards.map((card) => cardView(card, store).prUrl)).toEqual([prUrl, prUrl]);
    expect(cards[0]?.options.map((option) => option.label)).toEqual(['Done', 'Do it for me']);

    // Archived on the base: no card is left.
    const clone = makeScratchDir('owner-steps-archive');
    await runGit(clone, ['clone', '--quiet', bare, '.']);
    await runGit(clone, ['config', 'user.email', 'o@example.invalid']);
    await runGit(clone, ['config', 'user.name', 'Other']);
    mkdirSync(join(clone, 'openspec/changes/archive'), { recursive: true });
    await runGit(clone, [
      'mv',
      'openspec/changes/a-thing',
      'openspec/changes/archive/2026-11-13-a-thing',
    ]);
    await runGit(clone, ['commit', '--quiet', '-m', 'archive a-thing']);
    await runGit(clone, ['push', '--quiet', 'origin', 'HEAD:master']);
    const env = { PATH: process.env.PATH ?? '' };
    await fetchBaseBranch({ repo: repo.root, baseBranch: 'master', remote: 'origin', env });
    await steps.sync('cena');
    expect(listWaitingCards(store, 'cena')).toEqual([]);
  });
});

// A local npm registry serving one package, cp-pinned 1.0.0 and 1.0.1.
let registry: Server;
let registryUrl = '';

function tarball(version: string): Buffer {
  const dir = makeScratchDir('owner-steps-pkg');
  const pkg = join(dir, 'package');
  execFileSync('mkdir', ['-p', pkg]);
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'cp-pinned', version }));
  writeFileSync(join(pkg, 'index.js'), `module.exports = '${version}';\n`);
  execFileSync('tar', ['-czf', join(dir, 'pkg.tgz'), '-C', dir, 'package']);
  return execFileSync('cat', [join(dir, 'pkg.tgz')]);
}

beforeAll(async () => {
  const tarballs = new Map(['1.0.0', '1.0.1'].map((v) => [v, tarball(v)]));
  registry = createServer((req, res) => {
    const url = req.url ?? '';
    const tgz = /^\/cp-pinned\/-\/cp-pinned-(\d+\.\d+\.\d+)\.tgz$/.exec(url);
    if (tgz !== null && tarballs.has(tgz[1] as string)) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(tarballs.get(tgz[1] as string));
      return;
    }
    if (url === '/cp-pinned') {
      const versions = Object.fromEntries(
        [...tarballs].map(([version, bytes]) => [
          version,
          {
            name: 'cp-pinned',
            version,
            dist: {
              tarball: `${registryUrl}/cp-pinned/-/cp-pinned-${version}.tgz`,
              integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
            },
          },
        ]),
      );
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ name: 'cp-pinned', 'dist-tags': { latest: '1.0.1' }, versions }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => registry.listen(0, '127.0.0.1', resolve));
  registryUrl = `http://127.0.0.1:${(registry.address() as AddressInfo).port}`;
});
afterAll(() => registry?.close());

const STEP = 'Owner: approve cp-pinned 1.0.1 and install it';
const STEP_LIST = `# Tasks\n\n- [ ] 1.1 ${STEP}\n- [ ] 1.2 Build the menu\n`;
const MANIFEST = `${JSON.stringify({ name: 'fixture', version: '1.0.0', private: true }, null, 2)}\n`;

/**
 * The session: installs the exact pinned version from the local registry, as the step says. Not
 * synchronous: the registry answers from this same process.
 */
const install: FakeSession = async (request) => {
  const npmHome = makeScratchDir('owner-steps-npm');
  writeFileSync(join(npmHome, 'npmrc'), '');
  await promisify(execFile)(
    'npm',
    ['install', '--save-exact', 'cp-pinned@1.0.1', '--registry', registryUrl, '--ignore-scripts'],
    {
      cwd: request.cwd,
      timeout: 60_000,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: npmHome,
        npm_config_cache: join(npmHome, 'cache'),
        npm_config_userconfig: join(npmHome, 'npmrc'),
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        npm_config_update_notifier: 'false',
      },
    },
  );
  return 'Installed cp-pinned 1.0.1.';
};

const doItSetup = () =>
  setup({
    list: STEP_LIST,
    files: { 'package.json': MANIFEST, '.gitignore': 'node_modules/\n' },
    session: install,
  });

describe('Do it for me', () => {
  it('installs in its own worktree, lands nothing until Land it, then lands exactly the shown diff plus the tick', async () => {
    const { repo, bare, store, desk, steps, lane, github, sessions } = await doItSetup();
    const before = (await runGit(bare, ['rev-parse', 'refs/heads/master'])).stdout.trim();
    await steps.sync('cena');
    const card = listWaitingCards(store, 'cena').find((c) => c.kind === 'owner-step');
    await desk.answer(card?.id as string, { option: 1 });
    expect(getCard(store, card?.id as string)?.outcome).toBe('Working on it in its own worktree.');
    await steps.idle();

    // The session ran in a fresh worktree beside the repository, and that worktree is gone.
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.cwd).not.toBe(repo.root);
    expect(sessions[0]?.cwd.startsWith(`${repo.root}-worktrees/owner-step-`)).toBe(true);
    expect(existsSync(sessions[0]?.cwd as string)).toBe(false);
    expect(sessions[0]?.argv.join(' ')).toContain(STEP);

    // A Land it card with the diff; the base and the owner's checkout are untouched.
    const land = listWaitingCards(store, 'cena').find((c) => c.kind === 'owner-step-result');
    expect(land?.options.map((o) => o.label)).toEqual(['Land it', 'Discard']);
    const result = landCardResult(store, land?.id as string);
    expect(result?.edits.map((e) => e.path)).toEqual(['package-lock.json', 'package.json']);
    const diff = cardView(land as NonNullable<typeof land>, store).diff ?? '';
    expect(diff).toContain('+    "cp-pinned": "1.0.1"');
    expect(diff).toContain('diff --git a/package-lock.json b/package-lock.json');
    expect((await runGit(bare, ['rev-parse', 'refs/heads/master'])).stdout.trim()).toBe(before);
    expect((await runGit(repo.root, ['status', '--porcelain'])).stdout).toBe('');
    expect(readdirSync(repo.root)).not.toContain('node_modules');

    await desk.answer(land?.id as string, { option: 0 });
    await lane.idle('cena');
    expect(github.prs).toHaveLength(1);
    expect(github.prs[0]?.state).toBe('MERGED');
    const changed = (await runGit(bare, ['diff', '--name-only', before, 'refs/heads/master']))
      .stdout;
    expect(changed.trim().split('\n')).toEqual([
      'openspec/changes/a-thing/tasks.md',
      'package-lock.json',
      'package.json',
    ]);
    for (const edit of result?.edits ?? []) {
      const landed = (await runGit(bare, ['show', `refs/heads/master:${edit.path}`])).stdout;
      expect(landed).toBe(edit.after);
    }
    const tasks = (await runGit(bare, ['show', `refs/heads/master:${TASKS}`])).stdout;
    expect(tasks).toBe(STEP_LIST.replace('[ ] 1.1', '[x] 1.1'));
    // The owner's checkout and local base branch are still as they were.
    expect((await runGit(repo.root, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(before);
  }, 120_000);

  it('lands nothing when the base changed the same files, and gives the step back to do again', async () => {
    const { store, desk, steps, github, landElsewhere } = await doItSetup();
    await steps.sync('cena');
    const card = listWaitingCards(store, 'cena').find((c) => c.kind === 'owner-step');
    await desk.answer(card?.id as string, { option: 1 });
    await steps.idle();
    const land = listWaitingCards(store, 'cena').find((c) => c.kind === 'owner-step-result');
    await landElsewhere(MANIFEST.replace('"private": true', '"private": false'), 'package.json');

    const answered = await desk.answer(land?.id as string, { option: 0 });
    expect(answered.outcome).toMatch(/^Nothing landed: origin\/master changed since/);
    expect(github.prs).toHaveLength(0);
    const step = getCard(store, card?.id as string);
    expect(step?.state).toBe('open');
    expect(step?.outcome).toContain('Do it for me runs it again on the new base');
    expect(landCardResult(store, land?.id as string)?.state).toBe('discarded');
  }, 120_000);

  it('gives the step back when the session changed nothing', async () => {
    const { store, desk, steps } = await setup({
      session: async () => 'This needs your bank login; log in at the bank and pay the invoice.',
    });
    await steps.sync('cena');
    const card = listWaitingCards(store, 'cena').find((c) => c.question === 'check the menu');
    await desk.answer(card?.id as string, { option: 1 });
    await steps.idle();
    const step = getCard(store, card?.id as string);
    expect(step?.state).toBe('open');
    expect(step?.outcome).toBe(
      "Counterpoint couldn't do it: This needs your bank login; log in at the bank and pay the invoice.",
    );
    expect(listWaitingCards(store, 'cena').some((c) => c.kind === 'owner-step-result')).toBe(false);
  });
});

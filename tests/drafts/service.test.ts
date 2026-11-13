// Design drafts, the daemon's side (design-drafts 3.1-3.4, 4.2, 4.3, 6.1, 6.3; 2.3's no-browser
// card). A fixture host with a local bare remote, a fake `gh` and a tiny render script; a fake
// claude that writes what each session is asked for, so every step runs end to end without a model.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createOpenSpecAdapter } from '../../src/adapters/openspec/index.ts';
import type { AgentRunner, AgentRunRequest } from '../../src/agent/runner.ts';
import { pushPlanCommit } from '../../src/build/deliver.ts';
import { PlanningLane } from '../../src/build/planning-lane.ts';
import { fetchBaseBranch } from '../../src/core/git/base-fetch.ts';
import { runGit } from '../../src/core/git/run.ts';
import { openStore, upsertHost } from '../../src/core/store/db.ts';
import { listMarks, listScreens } from '../../src/core/store/drafts.ts';
import { NoBrowserError } from '../../src/drafts/browser.ts';
import { type DraftMapper, Drafts } from '../../src/drafts/service.ts';
import { createHostRuntimes } from '../../src/server/hosts.ts';
import { FakeGitHub } from '../helpers/fake-github.ts';
import { materializeOpenSpecHost } from '../helpers/fixture-repo.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

const roots: string[] = [];
afterAll(async () => {
  const { rmSync } = await import('node:fs');
  for (const root of roots) rmSync(`${root}-worktrees`, { recursive: true, force: true });
  removeScratchDirs();
});

const adapter = createOpenSpecAdapter();
const CHANGE = 'openspec/changes/quiet';
const RULES = 'Forms group related fields.';
// The render script: the entry is plain HTML; BROKEN fails the render.
const RENDER = `import { readFileSync, writeFileSync } from 'node:fs';
const [entry, out] = process.argv.slice(2);
const html = readFileSync(entry, 'utf8');
if (html.includes('BROKEN')) { console.error('cannot render: BROKEN'); process.exit(1); }
writeFileSync(out + '/site.css', 'body { margin: 0 }');
writeFileSync(out + '/page.html', '<html><head><link rel="stylesheet" href="site.css"></head><body>' + html + '</body></html>');
`;
const CONFIG = "drafts:\n  render: [node, render.mjs, '{entry}', '{out}']\n  entry: draft.html\n";

type Behaviour = (prompt: string, request: AgentRunRequest) => Promise<void> | void;

const promptOf = (request: AgentRunRequest) => request.argv[1] ?? '';

/** The fake claude: writes the files each kind of session is asked for. */
function defaultBehaviour(screens = '[]'): Behaviour {
  return (prompt, request) => {
    if (prompt.startsWith('List the screens')) {
      writeFileSync(join(request.cwd, 'screens.json'), screens);
      return;
    }
    const letter = /Draw low-fi draft ([ABC])/.exec(prompt)?.[1];
    if (letter !== undefined) {
      writeFileSync(
        join(request.cwd, 'page.html'),
        `<link rel="stylesheet" href="wire.css"><div data-cp-id="header">Head ${letter}</div><ul data-cp-id="list"><li>List ${letter}</li></ul><script>x()</script>`,
      );
      return;
    }
    for (const [, state, path] of prompt.matchAll(/^- ([a-z-]+): (\.cp-draft\/\S+)$/gm)) {
      writeFileSync(
        join(request.cwd, path as string),
        `<h1 data-cp-id="title">Orders ${state}</h1><p data-cp-id="total">Total 3</p><footer data-cp-id="footer">Footer</footer>`,
        { flag: 'w' },
      );
    }
  };
}

const TWO = JSON.stringify({
  screens: [
    { id: 'home', name: 'Home', purpose: 'Start', states: ['main'], directions: ['a', 'b', 'c'] },
    {
      id: 'settings',
      name: 'Settings',
      purpose: 'Set',
      states: ['main'],
      directions: ['d', 'e', 'f'],
    },
  ],
});

async function setup(
  options: { config?: string; behaviour?: Behaviour; mapper?: DraftMapper } = {},
) {
  const repo = await materializeOpenSpecHost(
    {
      'openspec/config.yaml': 'schema: spec-driven\n',
      [`${CHANGE}/.openspec.yaml`]: 'schema: spec-driven\ncreated: 2026-11-01\n',
      [`${CHANGE}/proposal.md`]: '# Quiet console\n\n## Why\n\nA calmer home screen.\n',
      [`${CHANGE}/tasks.md`]: '# Tasks\n\n- [ ] 1.1 Build it\n',
      '.counterpoint/design-rules.md': `${RULES}\n`,
      '.counterpoint/config.yaml': options.config ?? CONFIG,
      'render.mjs': RENDER,
    },
    { label: 'drafts' },
  );
  roots.push(repo.root);
  const bare = makeScratchDir('drafts-bare');
  await runGit(bare, ['init', '--bare', '--quiet', '--initial-branch=master']);
  await runGit(repo.root, ['remote', 'add', 'origin', bare]);
  await runGit(repo.root, ['push', '--quiet', 'origin', 'refs/heads/master:refs/heads/master']);
  await runGit(repo.root, ['fetch', '--quiet', 'origin']);
  const home = makeScratchDir('drafts-home');
  const store = openStore(home);
  const host = { id: 'cena', root: repo.root, baseBranch: 'master' };
  upsertHost(store, { ...host, gitCommonDir: join(repo.root, '.git'), adapter: 'openspec' });
  const github = new FakeGitHub(bare);
  const env = { PATH: process.env.PATH ?? '' };
  const lane = new PlanningLane({
    db: store,
    home,
    host: () => host,
    rules: () => ({ isPlanningPath: adapter.isPlanningPath, tickTask: adapter.tickTask }),
    ownerEnv: async () => env,
    fetchBase: async (h, e) => {
      await fetchBaseBranch({ repo: h.root, baseBranch: h.baseBranch, remote: 'origin', env: e });
      return { error: null };
    },
    gh: github.gh,
    pushTarget: async () => ({
      remote: 'origin',
      url: bare,
      kind: 'ssh',
      slug: { host: 'github.com', owner: 'alex', repo: 'Cena' },
    }),
    push: (input) => pushPlanCommit({ ...input, ssh: '/usr/bin/ssh' }),
    settleMs: 0,
  });
  const runtimes = createHostRuntimes({ store });
  const sessions: { prompt: string; cwd: string }[] = [];
  const behaviour = options.behaviour ?? defaultBehaviour(TWO);
  const runner: AgentRunner = {
    async run(request) {
      sessions.push({ prompt: promptOf(request), cwd: request.cwd });
      await behaviour(promptOf(request), request);
      const result = { type: 'result', subtype: 'success', result: 'done' };
      return { events: [result], raw: '', stderr: '', exitCode: 0, timedOut: false, result };
    },
  };
  const cards: string[] = [];
  const events: Record<string, unknown>[] = [];
  const drafts = new Drafts({
    db: store,
    home,
    host: (id) => runtimes.get(id),
    runner: () => runner,
    ownerEnv: async () => env,
    mapper: options.mapper ?? partsMapper,
    publish: (_hostId, payload) => events.push(payload),
    raise: (card) => cards.push(card.kind),
    lane,
  });
  return { repo, bare, store, drafts, sessions, cards, events, lane };
}

/** Maps a packed page from its parts.json (no browser). */
const partsMapper: DraftMapper = {
  async maps(page) {
    const parts = JSON.parse(readFileSync(join(page, '..', 'parts.json'), 'utf8')) as {
      ids: string[];
      parts: Record<string, { text: string }>;
    };
    const map = (width: number) => ({
      width,
      height: 100,
      parts: parts.ids.map((id, i) => ({
        id,
        x: 0,
        y: i * 10,
        w: width,
        h: 10,
        text: parts.parts[id]?.text ?? '',
      })),
    });
    return { phone: map(390), desktop: map(1440) };
  },
};

async function started(options: Parameters<typeof setup>[0] = {}) {
  const ctx = await setup(options);
  await ctx.drafts.start('cena', 'quiet');
  await ctx.drafts.idle();
  return ctx;
}

const view = (ctx: { drafts: Drafts }) => ctx.drafts.view('cena', 'quiet');
const screen = async (ctx: { drafts: Drafts }, n = 0) => {
  const s = (await view(ctx)).screens[n];
  if (s === undefined) throw new Error('no screen');
  return s;
};

describe('the screen list (3.1)', () => {
  it('lists the screens the planning describes; the owner adds, renames and drops one', async () => {
    const ctx = await started();
    expect(ctx.sessions[0]?.prompt).toContain('A calmer home screen.');
    expect((await view(ctx)).screens.map((s) => s.name)).toEqual(['Home', 'Settings']);
    const menu = ctx.drafts.addScreen('cena', 'quiet', { name: 'Menu board' });
    expect(menu.screen).toBe('menu-board');
    ctx.drafts.renameScreen(menu.id, 'Menu');
    await ctx.drafts.dropScreen((await screen(ctx, 1)).id);
    expect((await view(ctx)).screens.map((s) => s.name)).toEqual(['Home', 'Menu']);
    expect(ctx.drafts.hold('cena', 'quiet')).toEqual({ held: true, waiting: ['Home', 'Menu'] });
  });

  it('shows a malformed list as failed, and Try again makes it again', async () => {
    let text = '{"screens":[{"id":"Bad Id"}]}';
    const ctx = await started({ behaviour: (p, r) => defaultBehaviour(text)(p, r) });
    expect((await view(ctx)).list).toMatchObject({
      state: 'failed',
      error: expect.stringMatching(/screens\.0/),
    });
    text = TWO;
    ctx.drafts.retryList('cena', 'quiet');
    await ctx.drafts.idle();
    expect((await view(ctx)).list?.state).toBe('ready');
  });
});

describe('low-fi rounds (3.2-3.4)', () => {
  it('shows each draft as soon as it is ready; one failure leaves the other two', async () => {
    let releaseB: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    const base = defaultBehaviour(TWO);
    const ctx = await started({
      behaviour: async (prompt, request) => {
        if (prompt.includes('Draw low-fi draft B')) await gate;
        if (prompt.includes('Draw low-fi draft C')) return; // writes nothing: fails
        await base(prompt, request);
      },
    });
    ctx.drafts.startRound((await screen(ctx)).id);
    await new Promise((resolve) => setTimeout(resolve, 300));
    let round = (await screen(ctx)).round;
    expect(round?.drafts.map((d) => d.state)).toEqual(['ready', 'running', 'failed']);
    expect(round?.drafts[0]?.url).toMatch(/^\/h\/cena\/quiet\/s\d+\/r1\/A\/packed\/page\.html$/);
    releaseB();
    await ctx.drafts.idle();
    round = (await screen(ctx)).round;
    expect(round?.drafts.map((d) => d.state)).toEqual(['ready', 'ready', 'failed']);
    expect(round?.state).toBe('ready');
    const prompts = ctx.sessions.filter((s) => s.prompt.startsWith('Draw')).map((s) => s.prompt);
    expect(prompts).toHaveLength(3);
    for (const [i, letter] of ['A', 'B', 'C'].entries()) {
      const p = prompts.find((text) => text.startsWith(`Draw low-fi draft ${letter}`));
      expect(p).toContain(RULES);
      expect(p).toContain(`Your direction: ${'abc'[i]}`);
    }
  });

  it("sends A's header and C's list to all three sessions of the next round", async () => {
    const ctx = await started();
    const home = await screen(ctx);
    ctx.drafts.startRound(home.id);
    await ctx.drafts.idle();
    const [a, , c] = (await screen(ctx)).round?.drafts ?? [];
    ctx.drafts.mark(a?.id as number, {
      part: 'header',
      kind: 'select',
      note: null,
      width: 'desktop',
    });
    ctx.drafts.mark(c?.id as number, { part: 'list', kind: 'select', note: null, width: 'phone' });
    ctx.drafts.mark(c?.id as number, {
      part: 'header',
      kind: 'comment',
      note: 'fewer words',
      width: 'phone',
    });
    expect(() =>
      ctx.drafts.mark(a?.id as number, {
        part: 'nope',
        kind: 'select',
        note: null,
        width: 'phone',
      }),
    ).toThrow(/not on the draft/);
    ctx.sessions.length = 0;
    ctx.drafts.startRound(home.id);
    await ctx.drafts.idle();
    expect(ctx.sessions).toHaveLength(3);
    for (const s of ctx.sessions) {
      expect(s.prompt).toContain('- header of draft A:');
      expect(s.prompt).toContain('Head A');
      expect(s.prompt).toContain('- list of draft C:');
      expect(s.prompt).toContain('List C');
      expect(s.prompt).toContain('fewer words');
      expect(s.prompt).not.toContain('x()');
    }
    expect(listMarks(ctx.store, home.id, ['sent'])).toHaveLength(3);
  });

  it('raises a Needs You card when no browser can map a draft', async () => {
    const ctx = await started({
      mapper: {
        maps: async () => {
          throw new NoBrowserError();
        },
      },
    });
    ctx.drafts.startRound((await screen(ctx)).id);
    await ctx.drafts.idle();
    expect(
      (await screen(ctx)).round?.drafts.every((d) => d.state === 'ready' && d.maps === null),
    ).toBe(true);
    expect(ctx.cards).toContain('drafts-browser');
  });
});

describe('hi-fi (3.4, 4.2, 4.3) and sign-off (6.1)', () => {
  async function locked(options: Parameters<typeof setup>[0] = {}) {
    const ctx = await started(options);
    const home = await screen(ctx);
    ctx.drafts.startRound(home.id);
    await ctx.drafts.idle();
    ctx.drafts.lock((await screen(ctx)).round?.drafts[1]?.id as number);
    await ctx.drafts.idle();
    return { ...ctx, homeId: home.id };
  }

  it('locks B, renders the hi-fi draft with the host command, and unlocks back to low-fi from B', async () => {
    const ctx = await locked();
    let home = await screen(ctx);
    expect(home.round?.error ?? null).toBeNull();
    expect(home.stage).toBe('hifi');
    expect(home.round).toMatchObject({ stage: 'hifi', state: 'ready' });
    const hifi = ctx.sessions.find((s) => s.prompt.startsWith('Make the hi-fi draft'));
    expect(hifi?.prompt).toContain('Head B');
    expect(hifi?.prompt).toContain(RULES);
    expect(home.round?.drafts[0]?.url).toMatch(/\/r2\/main\/packed\/page\.html$/);

    ctx.sessions.length = 0;
    await ctx.drafts.unlock(ctx.homeId);
    await ctx.drafts.idle();
    home = await screen(ctx);
    expect(home).toMatchObject({ stage: 'low', round: { stage: 'low', number: 3 } });
    expect(ctx.sessions[0]?.prompt).toContain('Start from it');
    expect(ctx.sessions[0]?.prompt).toContain('Head B');
  });

  it('sends a failed render back to the session, which fixes it on the second try', async () => {
    let renders = 0;
    const base = defaultBehaviour(TWO);
    const ctx = await locked({
      behaviour: (prompt, request) => {
        if (prompt.startsWith('Make the hi-fi') || prompt.startsWith('Rendering')) {
          renders += 1;
          for (const [, , path] of `${prompt}\n- main: .cp-draft/main/draft.html`.matchAll(
            /^- ([a-z-]+): (\.cp-draft\/\S+)$/gm,
          )) {
            writeFileSync(
              join(request.cwd, path as string),
              renders < 3 ? 'BROKEN' : '<p data-cp-id="ok">fine</p>',
            );
          }
          return;
        }
        return base(prompt, request);
      },
    });
    expect(renders).toBe(3);
    expect(ctx.sessions.filter((s) => s.prompt.startsWith('Rendering'))[0]?.prompt).toContain(
      'cannot render: BROKEN',
    );
    expect((await screen(ctx)).round?.state).toBe('ready');
  });

  it('marks comments addressed or detached, and shows parts changed without a comment', async () => {
    let revision = '';
    const base = defaultBehaviour(TWO);
    const ctx = await locked({
      behaviour: (prompt, request) => {
        if (prompt.startsWith('Revise') || prompt.startsWith('Your revision')) {
          writeFileSync(join(request.cwd, '.cp-draft/main/draft.html'), revision);
          return;
        }
        return base(prompt, request);
      },
    });
    const main = (await screen(ctx)).round?.drafts[0]?.id as number;
    ctx.drafts.mark(main, { part: 'title', kind: 'comment', note: 'bigger', width: 'phone' });
    ctx.drafts.mark(main, { part: 'total', kind: 'comment', note: 'drop it', width: 'phone' });
    // The title is changed, the total removed, and nothing else touched.
    const footer = '<footer data-cp-id="footer">Footer</footer>';
    revision = `<h1 data-cp-id="title">ORDERS</h1>${footer}`;
    ctx.drafts.send(ctx.homeId);
    await ctx.drafts.idle();
    let home = await screen(ctx);
    expect(home.marks.map((m) => [m.part, m.state])).toEqual([
      ['title', 'addressed'],
      ['total', 'detached'],
    ]);
    expect(home.round?.alsoChanged).toEqual([]);

    // A revision of the title that also rewrites the footer, even after the restore session.
    const next = home.round?.drafts[0]?.id as number;
    ctx.drafts.mark(next, { part: 'title', kind: 'comment', note: 'smaller', width: 'phone' });
    revision = '<h1 data-cp-id="title">Orders</h1><footer data-cp-id="footer">Footer!</footer>';
    ctx.drafts.send(ctx.homeId);
    await ctx.drafts.idle();
    home = await screen(ctx);
    const restore = ctx.sessions.find((s) => s.prompt.startsWith('Your revision also changed'));
    expect(restore?.prompt).toContain('<footer data-cp-id="footer">Footer</footer>');
    expect(home.round?.alsoChanged).toEqual(['main: footer']);
  });

  it('signs off: exactly the hi-fi pages, styles and source land on the base, no earlier round', async () => {
    const ctx = await locked();
    expect(await ctx.drafts.signOff(ctx.homeId)).toMatch(/Landing/);
    await ctx.lane.idle('cena');
    const files = (
      await runGit(ctx.bare, ['ls-tree', '-r', '--name-only', 'master', `${CHANGE}/drafts`])
    ).stdout
      .trim()
      .split('\n');
    expect(files).toEqual([
      `${CHANGE}/drafts/home/main.html`,
      `${CHANGE}/drafts/home/source.md`,
      `${CHANGE}/drafts/styles.css`,
    ]);
    const page = (await runGit(ctx.bare, ['show', `master:${CHANGE}/drafts/home/main.html`]))
      .stdout;
    expect(page).toContain('href="../styles.css"');
    expect(page).toContain('Orders main');
    expect(ctx.drafts.hold('cena', 'quiet')).toEqual({ held: true, waiting: ['Settings'] });
    expect(listScreens(ctx.store, 'cena', 'quiet')[0]?.stage).toBe('signed');
  });
});

describe('the drafts API (3.3, 3.4)', () => {
  it('marks parts across two drafts, refuses what is not this change, locks and unlocks', async () => {
    const { Hono } = await import('hono');
    const { mountDraftRoutes } = await import('../../src/server/routes/drafts.ts');
    const ctx = await started();
    const app = new Hono();
    mountDraftRoutes(app, { drafts: ctx.drafts, draftOrigin: () => 'http://127.0.0.1:1' });
    const base = '/api/hosts/cena/drafts/quiet';
    const post = (path: string, body: unknown = {}) =>
      app.request(`${base}${path}`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      });
    const home = await screen(ctx);
    expect((await post(`/screens/${home.id}/round`)).status).toBe(200);
    await ctx.drafts.idle();
    const [a, b, c] = (await screen(ctx)).round?.drafts ?? [];
    expect(
      (await post(`/drafts/${a?.id}/marks`, { part: 'header', kind: 'select', width: 'desktop' }))
        .status,
    ).toBe(200);
    expect(
      (
        await post(`/drafts/${c?.id}/marks`, {
          part: 'list',
          kind: 'comment',
          note: 'two columns',
          width: 'phone',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post(`/drafts/${c?.id}/marks`, {
          part: 'list',
          kind: 'comment',
          note: ' ',
          width: 'phone',
        })
      ).status,
    ).toBe(409);
    expect(
      (await post(`/drafts/${c?.id}/marks`, { part: 'list', kind: 'shout', width: 'phone' }))
        .status,
    ).toBe(400);
    expect(
      (await app.request(`/api/hosts/cena/drafts/other/drafts/${a?.id}/lock`, { method: 'POST' }))
        .status,
    ).toBe(404);
    const view = (await (await app.request(base)).json()) as Awaited<ReturnType<Drafts['view']>> & {
      origin: string;
    };
    expect(view.origin).toBe('http://127.0.0.1:1');
    expect(view.screens[0]?.marks.map((m) => [m.slot, m.part, m.kind])).toEqual([
      ['A', 'header', 'select'],
      ['C', 'list', 'comment'],
    ]);
    expect((await post(`/marks/${view.screens[0]?.marks[0]?.id}/delete`)).status).toBe(200);

    expect((await post(`/drafts/${b?.id}/lock`)).status).toBe(200);
    expect((await post(`/drafts/${a?.id}/lock`)).status).toBe(409);
    await ctx.drafts.idle();
    expect((await screen(ctx)).stage).toBe('hifi');
    expect((await post(`/screens/${home.id}/unlock`)).status).toBe(200);
    await ctx.drafts.idle();
    expect(await screen(ctx)).toMatchObject({ stage: 'low', round: { number: 3, state: 'ready' } });
    expect((await post('/drop')).status).toBe(200);
    expect(ctx.drafts.hold('cena', 'quiet').held).toBe(false);
  });
});

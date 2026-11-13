// The Needs You API (needs-you: One inbox; Builder questions in Needs You): what the host's last
// run left for the owner, from the store.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectFramework } from '../../src/compose.ts';
import { registerHost } from '../../src/core/host/registry.ts';
import { mintLoginCode } from '../../src/core/security/login.ts';
import { answerCard } from '../../src/core/store/cards.ts';
import { hostRegistryStore, openStore, type Store } from '../../src/core/store/db.ts';
import { EventBus } from '../../src/core/store/events.ts';
import { insertPlanningWrite, updatePlanningWrite } from '../../src/core/store/planning-writes.ts';
import {
  addRunNotice,
  endRun,
  insertRun,
  insertRunChange,
  listRunChanges,
  parkRunChange,
  updateRunChange,
} from '../../src/core/store/runs.ts';
import { createApp } from '../../src/server/app.ts';
import { createHostRuntimes } from '../../src/server/hosts.ts';
import { type FixtureRepo, materializeFixtureRepo } from '../helpers/fixture-repo.ts';
import { makeScratchDir, removeScratchDirs, writeFileIn } from '../helpers/scratch.ts';

const PORT = 4996;
const HOST = `127.0.0.1:${PORT}`;

let repo: FixtureRepo;
let db: Store;
let hostId = '';
let cookie = '';
let uiDir = '';

function app() {
  return createApp({
    store: db,
    port: PORT,
    uiDir,
    bus: new EventBus(),
    runtimes: createHostRuntimes({ store: db }),
  });
}

async function needsYou(id = hostId) {
  return app().request(`http://${HOST}/api/hosts/${id}/needs-you`, {
    headers: { host: HOST, cookie },
  });
}

beforeAll(async () => {
  repo = await materializeFixtureRepo('synthetic');
  db = openStore(makeScratchDir('ny-home'));
  uiDir = makeScratchDir('ny-ui');
  writeFileIn(uiDir, 'index.html', '<!doctype html><title>Counterpoint</title>');
  hostId = (
    await registerHost(hostRegistryStore(db), { cwd: repo.root, base: 'master', detectFramework })
  ).id;
  const code = mintLoginCode(db);
  const login = await app().request(`http://${HOST}/login?code=${code}`, {
    headers: { host: HOST },
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
});

afterAll(() => {
  db?.close();
  removeScratchDirs();
});

describe('GET /api/hosts/:hostId/needs-you', () => {
  it('is empty before any run, and guarded by host id', async () => {
    expect(await (await needsYou()).json()).toMatchObject({ hostId, runItems: [] });
    expect((await needsYou('Bad_Host')).status).toBe(400);
    expect((await needsYou('no-such-host')).status).toBe(404);
  });

  it("lists what the last run left: a parked change and the run's notes", async () => {
    insertRun(db, { id: 'run-1', hostId, settings: {}, stopAt: null }, 1000);
    insertRunChange(db, { runId: 'run-1', change: 'ready-thing', position: 0 });
    const [row] = listRunChanges(db, 'run-1');
    parkRunChange(db, row?.id ?? 0, 'Not built: the builder asked first.', 2000);
    const question = {
      task: '1.1 Migrate',
      text: 'Run the migration against the hosted database?',
      options: ['Run it now', 'Leave it for you'],
      recommended: 1,
      waiting: ['1.2'],
    };
    updateRunChange(db, row?.id ?? 0, { questions: [question] });
    addRunNotice(db, 'run-1', "Your login shell's environment could not be read.");
    endRun(db, 'run-1', { reason: 'finished', detail: null }, 3000);
    const body = (await (await needsYou()).json()) as {
      runItems: Array<{ kind: string; changeId: string | null; questions: unknown[] }>;
    };
    expect(body.runItems.map((item) => [item.kind, item.changeId])).toEqual([
      ['parked', 'ready-thing'],
      ['notice', null],
    ]);
    // The builder's question travels with its options and recommendation.
    expect(body.runItems[0]?.questions).toEqual([
      {
        task: '1.1 Migrate',
        text: 'Run the migration against the hosted database?',
        options: ['Run it now', 'Leave it for you'],
        recommended: 1,
        waiting: ['1.2'],
      },
    ]);
  });
});

describe('question cards through the API', () => {
  const ORIGIN = `http://${HOST}`;
  const post = (path: string, body: unknown) =>
    app().request(`http://${HOST}${path}`, {
      method: 'POST',
      headers: { host: HOST, cookie, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('lists a raised card, answers it with a note, and refuses a second answer', async () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe((event) => seen.push(event.family));
    const { CardDesk } = await import('../../src/server/cards.ts');
    const desk = new CardDesk({ store: db, bus });
    const card = desk.raise({
      hostId,
      kind: 'ask',
      source: 'session',
      sessionId: 's-1',
      question: 'Which colour?',
      why: 'The menu header needs one.',
      options: [
        { label: 'Blue', consequence: 'Matches the logo.' },
        { label: 'Green', consequence: 'Matches the old site.' },
      ],
      recommended: 0,
      reversible: true,
      blocking: false,
    });
    expect(seen).toEqual(['needs-you']);
    const listed = (await (await needsYou()).json()) as { cards: Array<{ id: string }> };
    expect(listed.cards.map((c) => c.id)).toContain(card.id);

    expect((await post(`/api/hosts/${hostId}/cards/${card.id}/answer`, { option: 7 })).status).toBe(
      422,
    );
    const answer = await post(`/api/hosts/${hostId}/cards/${card.id}/answer`, {
      option: 1,
      note: 'the old site',
    });
    expect(answer.status).toBe(200);
    expect(((await answer.json()) as { card: unknown }).card).toMatchObject({
      state: 'answered',
      answer: 1,
      note: 'the old site',
      outcome: 'Not read yet',
    });
    expect((await post(`/api/hosts/${hostId}/cards/${card.id}/answer`, { option: 0 })).status).toBe(
      409,
    );
    expect((await post(`/api/hosts/${hostId}/cards/${card.id}/later`, {})).status).toBe(409);
    // Another host's path does not reach the card.
    expect((await post(`/api/hosts/other-host/cards/${card.id}/later`, {})).status).toBe(404);
    const after = (await (await needsYou()).json()) as {
      cards: Array<{ id: string }>;
      answered: Array<{ id: string }>;
    };
    expect(after.cards.map((c) => c.id)).not.toContain(card.id);
    expect(after.answered.map((c) => c.id)).toContain(card.id);
  });

  it("says which project and session asked, and when: the owner's own session by name", async () => {
    const { CardDesk } = await import('../../src/server/cards.ts');
    const desk = new CardDesk({ store: db, bus: new EventBus() });
    const options = [
      { label: 'Yes', consequence: 'Yes.' },
      { label: 'No', consequence: 'No.' },
    ];
    const base = {
      kind: 'ask',
      source: 'session' as const,
      why: 'It matters.',
      options,
      recommended: 0,
      reversible: true,
      blocking: false,
    };
    const mine = desk.raise({
      ...base,
      hostId,
      sessionId: 'interactive-0123456789abcdef',
      question: 'Keep the old route?',
    });
    const anywhere = desk.raise({
      ...base,
      hostId: null,
      sessionId: 'interactive-fedcba9876543210',
      question: 'Which shell?',
    });
    const listed = (await (await needsYou()).json()) as {
      cards: Array<{
        id: string;
        hostId: string | null;
        session: string;
        createdAt: number;
        askedAt: number;
      }>;
    };
    const view = (id: string) => listed.cards.find((c) => c.id === id);
    expect(view(mine.id)).toMatchObject({ hostId, session: 'your Claude Code session' });
    expect(view(mine.id)?.createdAt).toBe(mine.createdAt);
    // Sent under the name the console reads for "asked …".
    expect(view(mine.id)?.askedAt).toBe(mine.createdAt);
    expect(view(anywhere.id)).toMatchObject({ hostId: null, session: 'your Claude Code session' });
  });

  it('marks the options that merge into the base, so Enter never picks them', async () => {
    const { CardDesk } = await import('../../src/server/cards.ts');
    const desk = new CardDesk({ store: db, bus: new EventBus() });
    const step = desk.raise({
      hostId,
      kind: 'owner-step',
      source: 'change',
      change: 'ready-thing',
      question: 'Rotate the API key',
      why: 'A step only you can sign off.',
      options: [
        {
          label: 'Done',
          consequence: 'Ticked in a small PR and merged.',
          action: { type: 'tick-owner-step', change: 'ready-thing', step: '0123456789ab' },
        },
        {
          label: 'Do it for me',
          consequence: 'Done in a worktree; you see the result first.',
          action: { type: 'perform-owner-step', change: 'ready-thing', step: '0123456789ab' },
        },
      ],
      recommended: 0,
      reversible: true,
      blocking: false,
    });
    const land = desk.raise({
      hostId,
      kind: 'owner-step-result',
      source: 'change',
      change: 'ready-thing',
      question: 'Land this file?',
      why: 'README.md',
      options: [
        {
          label: 'Land it',
          consequence: 'One small PR, merged at once.',
          action: { type: 'land-owner-step', resultId: 'r-0123456789abcdef' },
        },
        {
          label: 'Discard',
          consequence: 'Nothing lands.',
          action: { type: 'discard-owner-step', resultId: 'r-0123456789abcdef' },
        },
        { label: 'Later', consequence: 'It waits in Later.', action: { type: 'later' } },
      ],
      recommended: 0,
      reversible: true,
      blocking: false,
    });
    const listed = (await (await needsYou()).json()) as {
      cards: Array<{ id: string; options: Array<{ merges: boolean; later: boolean }> }>;
    };
    const merges = (id: string) =>
      listed.cards.find((c) => c.id === id)?.options.map((o) => o.merges);
    expect(merges(step.id)).toEqual([true, false]);
    expect(merges(land.id)).toEqual([true, false, false]);
    // The Later option is marked, so the console shows no Later button of its own.
    expect(listed.cards.find((c) => c.id === land.id)?.options.map((o) => o.later)).toEqual([
      false,
      false,
      true,
    ]);
  });
});

describe('GET /api/needs-you/counts', () => {
  it("counts every project's waiting cards, the machine's once, and lists the blocking ones", async () => {
    const other = await materializeFixtureRepo('synthetic');
    const otherId = (
      await registerHost(hostRegistryStore(db), {
        cwd: other.root,
        base: 'master',
        detectFramework,
      })
    ).id;
    const { CardDesk } = await import('../../src/server/cards.ts');
    const desk = new CardDesk({ store: db, bus: new EventBus() });
    let session = 0;
    const ask = (host: string | null, question: string, blocking: boolean) =>
      desk.raise({
        hostId: host,
        kind: 'ask',
        source: 'session',
        sessionId: `s-count-${++session}`,
        question,
        why: 'It matters.',
        options: [
          { label: 'Yes', consequence: 'Yes.' },
          { label: 'No', consequence: 'No.' },
        ],
        recommended: 0,
        reversible: true,
        blocking,
      });
    const read = async () => {
      const res = await app().request(`http://${HOST}/api/needs-you/counts`, {
        headers: { host: HOST, cookie },
      });
      expect(res.status).toBe(200);
      return (await res.json()) as {
        total: number;
        machine: number;
        hosts: Array<{ hostId: string; count: number }>;
        blocking: Array<{ id: string; hostId: string | null; question: string }>;
      };
    };
    const before = await read();
    const countOf = (body: typeof before, id: string) =>
      body.hosts.find((h) => h.hostId === id)?.count ?? -1;

    const blocker = ask(otherId, 'Drop the old table?', true);
    ask(otherId, 'Which colour for the menu?', false);
    const restart = ask(null, 'Restart into the new install?', true);
    const deferred = ask(hostId, 'Rename the button?', false);
    desk.defer(deferred.id);
    // An answer whose planning write is blocked waits on the owner too (Retry or Cancel).
    const landed = ask(hostId, 'Write the decision down?', false);
    answerCard(db, landed.id, { option: 0 });
    const write = insertPlanningWrite(db, {
      hostId,
      cardId: landed.id,
      message: 'Record the decision',
      edits: [{ kind: 'tick', path: 'openspec/changes/ready-thing/tasks.md', task: '1.1' }],
    });
    updatePlanningWrite(db, write.id, { state: 'blocked', blocked: 'checks', reason: 'Red.' });

    const after = await read();
    expect(countOf(after, otherId)).toBe(countOf(before, otherId) + 2);
    expect(countOf(after, hostId)).toBe(countOf(before, hostId) + 1);
    expect(after.machine).toBe(before.machine + 1);
    expect(after.total).toBe(before.total + 4);
    expect(after.total).toBe(after.machine + after.hosts.reduce((sum, h) => sum + h.count, 0));
    expect(after.blocking).toEqual(
      expect.arrayContaining([
        { id: blocker.id, hostId: otherId, question: 'Drop the old table?' },
        { id: restart.id, hostId: null, question: 'Restart into the new install?' },
      ]),
    );
    expect(after.blocking.filter((card) => card.id === restart.id)).toHaveLength(1);
    // Behind the session guard like every /api route.
    const anonymous = await app().request(`http://${HOST}/api/needs-you/counts`, {
      headers: { host: HOST },
    });
    expect(anonymous.status).toBe(401);
  });
});

describe('run notices', () => {
  it('logs a notice nobody can act on under Done for you, once, instead of a card', async () => {
    const { CardDesk } = await import('../../src/server/cards.ts');
    const { syncRunCards } = await import('../../src/build/run-cards.ts');
    const { listDoneForYou, listWaitingCards } = await import('../../src/core/store/cards.ts');
    const desk = new CardDesk({ store: db, bus: new EventBus() });
    insertRun(db, { id: 'run-n', hostId, settings: {}, stopAt: null }, 9000);
    addRunNotice(db, 'run-n', 'Preview links were slow to appear.');
    addRunNotice(db, 'run-n', "Your login shell's environment could not be read.");
    endRun(db, 'run-n', { reason: 'finished', detail: null }, 9500);
    syncRunCards(desk, hostId);
    syncRunCards(desk, hostId);
    const notices = listWaitingCards(db, hostId).filter((card) => card.kind === 'notice');
    // Only the login shell, which the owner can act on, is a card.
    expect(notices.map((card) => card.question)).toEqual([
      "Your login shell couldn't be read. Re-read it now?",
    ]);
    const lines = listDoneForYou(db, hostId).map((entry) => entry.text);
    expect(lines.filter((text) => text.includes('Preview links'))).toEqual([
      'Run run-n: Preview links were slow to appear.',
    ]);
  });
});

// The Needs You API (needs-you: One inbox; Builder questions in Needs You): what the host's last
// run left for the owner, from the store.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectFramework } from '../../src/compose.ts';
import { registerHost } from '../../src/core/host/registry.ts';
import { mintLoginCode } from '../../src/core/security/login.ts';
import { hostRegistryStore, openStore, type Store } from '../../src/core/store/db.ts';
import { EventBus } from '../../src/core/store/events.ts';
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
});

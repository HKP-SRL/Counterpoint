// The Needs You API (MISN-02, APPR-02, D-03, D-04): the inbox, the change view and per-file diffs
// served from git, the watcher's `needs-you` events, the `needsYou` count in /control/status and
// the uncommitted-edits hint on phases rows.
//
// A scratch copy of the synthetic host, a scratch home, a throwaway unprotected ed25519 key
// trusted through the library, and an integrity baseline. Approvals land through the real
// `approveCommand` with that key. Nothing here touches ~/.ssh, ssh-agent, the Keychain, the real
// Counterpoint home or a real host repository.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approveCommand } from '../../src/cli/approve.ts';
import { detectFramework } from '../../src/compose.ts';
import { snapshotIntegrity, writeBaseline } from '../../src/core/approvals/integrity.ts';
import { writeTrust } from '../../src/core/approvals/trust-store.ts';
import { registerHost } from '../../src/core/host/registry.ts';
import { mintLoginCode } from '../../src/core/security/login.ts';
import { hostRegistryStore, openStore, type Store } from '../../src/core/store/db.ts';
import { EventBus, type StoredEvent } from '../../src/core/store/events.ts';
import { createApp } from '../../src/server/app.ts';
import { type ApprovalViews, createApprovalViews } from '../../src/server/approval-views.ts';
import { createControlApp, hashToken } from '../../src/server/control.ts';
import { createHostRuntimes, type HostRuntimes } from '../../src/server/hosts.ts';
import { startWatcher } from '../../src/server/watcher.ts';
import { commitChange, type FixtureRepo, materializeFixtureRepo } from '../helpers/fixture-repo.ts';
import { makeThrowawayKey } from '../helpers/keys.ts';
import { gitIn, makeScratchDir, removeScratchDirs, writeFileIn } from '../helpers/scratch.ts';

const PORT = 4996;
const HOST = `127.0.0.1:${PORT}`;
const CONTEXT_02 = '.planning/phases/02-ready-thing/02-CONTEXT.md';
const PLAN_02 = '.planning/phases/02-ready-thing/02-01-PLAN.md';
const CONFIG = '.counterpoint/config.yaml';
const GATES_ROW = `${CONFIG}#gates`;
const CONTROL_TOKEN = 'test-control-token';

interface Item {
  id: string;
  kind: string;
  kindLabel: string;
  phaseId: string;
  title: string;
  changedCount: number;
  gatesChanged: boolean;
  signedAt: string;
  changedAt: string;
  unreadable: boolean;
}

interface ItemBody {
  item: Item;
  lead: {
    signedAt: string;
    signedBase: string;
    tip: string;
    baseBranch: string;
    changedCount: number;
    gatesChanged: boolean;
  };
  changes: {
    path: string;
    label: string;
    kind: string;
    change: string;
    signedDigest: string | null;
    nowDigest: string | null;
  }[];
  command: string;
}

let repo: FixtureRepo;
let db: Store;
let bus: EventBus;
let runtimes: HostRuntimes;
let approvals: ApprovalViews;
let hostId = '';
let cookie = '';
let uiDir = '';
let home = '';
let originalContext: Buffer;

function app() {
  return createApp({ store: db, port: PORT, uiDir, bus, runtimes, home, approvals });
}

function get(path: string, withCookie = true): Promise<Response> {
  const headers: Record<string, string> = { host: HOST };
  if (withCookie) headers.cookie = cookie;
  return Promise.resolve(app().request(`http://${HOST}${path}`, { headers }));
}

async function items(): Promise<Item[]> {
  const res = await get(`/api/hosts/${hostId}/needs-you`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: Item[] }).items;
}

async function itemBody(itemId: string): Promise<{ status: number; body: unknown }> {
  const res = await get(`/api/hosts/${hostId}/needs-you/${itemId}`);
  return { status: res.status, body: await res.json() };
}

async function diff(itemId: string, path: string): Promise<{ status: number; body: unknown }> {
  const res = await get(
    `/api/hosts/${hostId}/needs-you/${itemId}/diff?path=${encodeURIComponent(path)}`,
  );
  return { status: res.status, body: await res.json() };
}

async function land(phaseId: string): Promise<void> {
  const err: string[] = [];
  const code = await approveCommand({
    home,
    hostId,
    phaseId,
    isTTY: true,
    out: () => {},
    err: (line) => err.push(line),
    notify: async () => {},
  });
  expect(err.join('\n')).toBe('');
  expect(code).toBe(0);
}

async function waitFor(predicate: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

beforeAll(async () => {
  repo = await materializeFixtureRepo('synthetic');
  originalContext = readFileSync(join(repo.root, CONTEXT_02));
  home = makeScratchDir('ny-home');
  db = openStore(home);
  bus = new EventBus();
  uiDir = makeScratchDir('ny-ui');
  writeFileIn(uiDir, 'index.html', '<!doctype html><title>Counterpoint</title>');
  const host = await registerHost(hostRegistryStore(db), {
    cwd: repo.root,
    base: 'master',
    detectFramework,
  });
  hostId = host.id;
  runtimes = createHostRuntimes({ store: db, debounceMs: 600 });
  approvals = createApprovalViews({ home });

  const key = await makeThrowawayKey(makeScratchDir('ny-keys'), { name: 'approval' });
  await writeTrust(home, { publicKeyPath: key.publicKeyPath });
  writeBaseline(home, hostId, await snapshotIntegrity(join(repo.root, '.git')));

  const code = mintLoginCode(db);
  const login = await app().request(`http://${HOST}/login?code=${code}`, {
    headers: { host: HOST },
  });
  expect(login.status).toBe(302);
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  await land('02');
});

afterAll(() => {
  db?.close();
  removeScratchDirs();
});

describe('GET /api/hosts/:hostId/needs-you', () => {
  it('is empty while the approval matches what was signed, and needs a session', async () => {
    expect(await items()).toEqual([]);
    expect((await get(`/api/hosts/${hostId}/needs-you`, false)).status).toBe(401);
  });

  it('lists a changed approval with its change view and diffs, and resolves on re-sign', async () => {
    await commitChange(
      repo.root,
      CONTEXT_02,
      Buffer.concat([originalContext, Buffer.from('\nA new decision.\n')]),
    );

    const list = await items();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: 'phase-02',
      kind: 'approved-version-changed',
      kindLabel: 'Approved version changed',
      title: 'Phase 02 changed since you signed it',
      changedCount: 1,
      gatesChanged: false,
    });

    const view = await itemBody('phase-02');
    expect(view.status).toBe(200);
    const body = view.body as ItemBody;
    expect(body.item.id).toBe('phase-02');
    expect(body.lead.baseBranch).toBe('master');
    expect(body.lead.changedCount).toBe(1);
    expect(body.lead.signedBase).toMatch(/^[0-9a-f]{40}$/);
    expect(body.changes).toEqual([
      expect.objectContaining({ path: CONTEXT_02, change: 'modified', kind: 'context' }),
    ]);
    expect(body.command).toBe(`counterpoint approve ${hostId} 02`);

    const fileDiff = await diff('phase-02', CONTEXT_02);
    expect(fileDiff.status).toBe(200);
    const d = fileDiff.body as { path: string; diff: string; truncated: boolean };
    expect(d.path).toBe(CONTEXT_02);
    expect(d.truncated).toBe(false);
    expect(d.diff).toContain(`diff --git a/${CONTEXT_02} b/${CONTEXT_02}`);
    expect(d.diff).toContain('+A new decision.');

    // Only paths on the item's change list are served.
    expect((await diff('phase-02', PLAN_02)).status).toBe(400);
    expect((await diff('phase-02', '/etc/passwd')).status).toBe(400);
    expect((await get(`/api/hosts/${hostId}/needs-you/phase-02/diff`)).status).toBe(400);

    // Re-signing the new version resolves the item on its own.
    await land('02');
    expect(await items()).toEqual([]);
    const gone = await itemBody('phase-02');
    expect(gone.status).toBe(404);
    expect(gone.body).toMatchObject({ state: 'gone' });
  });

  it('resolves when the inputs are reverted to the signed state', async () => {
    const signed = readFileSync(join(repo.root, CONTEXT_02));
    await commitChange(repo.root, CONTEXT_02, Buffer.concat([signed, Buffer.from('\nDrift.\n')]));
    expect(await items()).toHaveLength(1);
    await commitChange(repo.root, CONTEXT_02, signed);
    expect(await items()).toEqual([]);
  });

  it('answers 404 gone for an unknown item and 400 for a malformed id', async () => {
    const unknown = await itemBody('phase-03');
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ state: 'gone' });
    expect((await itemBody('bogus')).status).toBe(400);
    expect((await itemBody('phase-2')).status).toBe(400);
    expect((await diff('bogus', CONTEXT_02)).status).toBe(400);
    expect((await get('/api/hosts/Not_A_Host/needs-you')).status).toBe(400);
    expect((await get('/api/hosts/nobody/needs-you')).status).toBe(404);
  });

  it('lists a gates-only change with the Gate config row and its diff', async () => {
    await commitChange(repo.root, CONFIG, 'gates:\n  lint: pnpm lint\n');
    const list = await items();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'phase-02', changedCount: 0, gatesChanged: true });

    const view = await itemBody('phase-02');
    expect(view.status).toBe(200);
    const body = view.body as ItemBody;
    expect(body.lead.gatesChanged).toBe(true);
    expect(body.changes).toEqual([
      expect.objectContaining({ path: GATES_ROW, label: 'Gate config', change: 'added' }),
    ]);

    const res = await get(`/api/hosts/${hostId}/needs-you/phase-02/diff?path=.counterpoint%2Fconfig.yaml%23gates`);
    expect(res.status).toBe(200);
    const d = (await res.json()) as { diff: string; truncated: boolean };
    expect(d.truncated).toBe(false);
    expect(d.diff).toContain(`diff --git a/${CONFIG} (gates) b/${CONFIG} (gates)`);
    expect(d.diff).toContain('+  "lint": "pnpm lint"');

    await commitChange(repo.root, CONFIG, null);
    expect(await items()).toEqual([]);
  });
});

describe('uncommitted edits hint on phases rows (D-03)', () => {
  interface Row {
    id: string;
    status: string;
    uncommittedEdits: boolean;
  }

  async function row(phaseId: string): Promise<Row> {
    const body = (await (await get(`/api/hosts/${hostId}/phases`)).json()) as { phases: Row[] };
    const found = body.phases.find((phase) => phase.id === phaseId);
    if (found === undefined) throw new Error(`no row for ${phaseId}`);
    return found;
  }

  it('flags an approved phase with an uncommitted edit to an input, and only then', async () => {
    expect(await row('02')).toMatchObject({ status: 'on-runway', uncommittedEdits: false });
    const current = readFileSync(join(repo.root, CONTEXT_02));
    writeFileIn(repo.root, CONTEXT_02, Buffer.concat([current, Buffer.from('\nlocal only\n')]));
    try {
      const flagged = await row('02');
      // The approval itself is unaffected: still on the runway.
      expect(flagged).toMatchObject({ status: 'on-runway', uncommittedEdits: true });
      // A phase without an approval never carries the hint.
      expect((await row('02.1')).uncommittedEdits).toBe(false);
    } finally {
      await gitIn(repo.root, ['checkout', '--', CONTEXT_02]);
    }
    expect((await row('02')).uncommittedEdits).toBe(false);
  });
});

describe('needs-you events and the status count', () => {
  it('appends a needs-you event when the item set changes and reports needsYou per host', async () => {
    const events: StoredEvent[] = [];
    const unsubscribe = bus.subscribe((event) => events.push(event));
    const watcher = startWatcher({ runtimes, db, bus, intervalMs: 100, approvals });
    try {
      await watcher.tick();
      events.length = 0;
      const signed = readFileSync(join(repo.root, CONTEXT_02));
      await commitChange(
        repo.root,
        CONTEXT_02,
        Buffer.concat([signed, Buffer.from('\nWatched drift.\n')]),
      );
      await waitFor(
        () => events.some((e) => e.family === 'needs-you' && e.payload.count === 1),
        3000,
      );
      const event = events.find((e) => e.family === 'needs-you');
      expect(event?.hostId).toBe(hostId);
      expect(event?.payload).toMatchObject({ hostId, count: 1 });

      const control = createControlApp({
        store: db,
        bus,
        tokenHash: hashToken(CONTROL_TOKEN),
        port: PORT,
        onStop: () => {},
        detectFramework,
        needsYouCount: async (id) => {
          const runtime = runtimes.get(id);
          return runtime === null ? null : (await approvals.needsYou(runtime)).items.length;
        },
      });
      const status = (await (
        await control.request('http://control/control/status', {
          headers: { authorization: `Bearer ${CONTROL_TOKEN}` },
        })
      ).json()) as { hosts: { id: string; needsYou?: number }[] };
      expect(status.hosts.find((h) => h.id === hostId)?.needsYou).toBe(1);

      events.length = 0;
      await commitChange(repo.root, CONTEXT_02, signed);
      await waitFor(
        () => events.some((e) => e.family === 'needs-you' && e.payload.count === 0),
        3000,
      );
    } finally {
      watcher.stop();
      unsubscribe();
    }
  });
});

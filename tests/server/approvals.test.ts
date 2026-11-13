// The console's approval API (approvals: Approve in one click; Withdraw in one click; runway:
// Runway is the Mission headline): approve, approve all and withdraw, the runway API, the On
// runway overlay on the changes API, and the watcher's `approval` / `runway` events.
//
// A scratch copy of the synthetic host and a scratch home. Nothing here touches a real host
// repository or the real Counterpoint home.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectFramework } from '../../src/compose.ts';
import { registerHost } from '../../src/core/host/registry.ts';
import { mintLoginCode } from '../../src/core/security/login.ts';
import { hostRegistryStore, openStore, type Store } from '../../src/core/store/db.ts';
import { EventBus, type StoredEvent } from '../../src/core/store/events.ts';
import { createApp } from '../../src/server/app.ts';
import { type ApprovalViews, createApprovalViews } from '../../src/server/approval-views.ts';
import { createControlApp, hashToken } from '../../src/server/control.ts';
import { createHostRuntimes, type HostRuntimes } from '../../src/server/hosts.ts';
import { startWatcher, type Watcher } from '../../src/server/watcher.ts';
import {
  commitChange,
  type FixtureRepo,
  materializeFixtureRepo,
  SYNTHETIC,
} from '../helpers/fixture-repo.ts';
import { makeScratchDir, removeScratchDirs, writeFileIn } from '../helpers/scratch.ts';

const PORT = 4997;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://${HOST}`;
const READY = SYNTHETIC.ready;
const PROPOSAL = `openspec/changes/${READY}/proposal.md`;
const TASKS = `openspec/changes/${READY}/tasks.md`;
const CONTROL_TOKEN = 'test-control-token';

interface RunwayBody {
  count: number;
  taskCount: number;
  items: { changeId: string; title: string; taskCount: number; approvedAt: number }[];
}

interface ChangeRow {
  id: string;
  status: string;
  approval: { state: string; approvedAt: number } | null;
}

let repo: FixtureRepo;
let db: Store;
let bus: EventBus;
let runtimes: HostRuntimes;
let approvals: ApprovalViews;
let watcher: Watcher | undefined;
let hostId = '';
let cookie = '';
let uiDir = '';
let home = '';

function app() {
  return createApp({
    store: db,
    port: PORT,
    uiDir,
    bus,
    runtimes,
    home,
    approvals,
    onApprovalChanged: (id) => void watcher?.nudge(id),
  });
}

async function get(path: string) {
  return app().request(`http://${HOST}${path}`, { headers: { host: HOST, cookie } });
}

async function post(
  path: string,
  options: { origin?: string | null; withCookie?: boolean } = {},
): Promise<Response> {
  const headers: Record<string, string> = { host: HOST, 'content-type': 'application/json' };
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN;
  if (options.withCookie !== false) headers.cookie = cookie;
  return app().request(`http://${HOST}${path}`, { method: 'POST', headers, body: '{}' });
}

async function changeRow(changeId: string): Promise<ChangeRow> {
  const body = (await (await get(`/api/hosts/${hostId}/changes`)).json()) as {
    changes: ChangeRow[];
  };
  const row = body.changes.find((change) => change.id === changeId);
  if (row === undefined) throw new Error(`no row for ${changeId}`);
  return row;
}

async function runway(): Promise<RunwayBody> {
  const res = await get(`/api/hosts/${hostId}/runway`);
  expect(res.status).toBe(200);
  return (await res.json()) as RunwayBody;
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
  home = makeScratchDir('appr-home');
  db = openStore(home);
  bus = new EventBus();
  uiDir = makeScratchDir('ui');
  writeFileIn(uiDir, 'index.html', '<!doctype html><title>Counterpoint</title>');
  const host = await registerHost(hostRegistryStore(db), {
    cwd: repo.root,
    base: 'master',
    detectFramework,
  });
  hostId = host.id;
  runtimes = createHostRuntimes({ store: db, debounceMs: 600 });
  approvals = createApprovalViews({ store: db });

  const code = mintLoginCode(db);
  const login = await app().request(`http://${HOST}/login?code=${code}`, {
    headers: { host: HOST },
  });
  expect(login.status).toBe(302);
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  expect(cookie).toMatch(/^cp_session=/);
});

afterAll(() => {
  watcher?.stop();
  db?.close();
  removeScratchDirs();
});

describe('approve and withdraw', () => {
  const events: StoredEvent[] = [];
  let unsubscribe: () => void;

  beforeAll(async () => {
    unsubscribe = bus.subscribe((event) => events.push(event));
    // A slow watcher: only the nudge after a click can publish in time.
    watcher = startWatcher({ runtimes, db, bus, intervalMs: 60_000, approvals });
    await watcher.tick();
  });

  afterAll(() => {
    unsubscribe?.();
  });

  it('starts with an empty runway and the ready change Ready to approve', async () => {
    const body = await runway();
    expect(body.count).toBe(0);
    expect(body.items).toEqual([]);
    const row = await changeRow(READY);
    expect(row.status).toBe('ready');
    expect(row.approval).toBeNull();
  });

  it('is guarded: no Origin → 403, no session → 401', async () => {
    const path = `/api/hosts/${hostId}/changes/${READY}/approve`;
    expect((await post(path, { origin: null })).status).toBe(403);
    expect((await post(path, { withCookie: false })).status).toBe(401);
    expect((await runway()).count).toBe(0);
  });

  it('approves in one click: On runway, and the runway event goes out at once', async () => {
    events.length = 0;
    const res = await post(`/api/hosts/${hostId}/changes/${READY}/approve`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ approved: true, changed: true });
    await waitFor(
      () =>
        events.some((e) => e.family === 'approval' && e.hostId === hostId) &&
        events.some((e) => e.family === 'runway' && e.payload.count === 1),
      1000,
    );
    const body = await runway();
    expect(body).toMatchObject({ count: 1, taskCount: 4, ready: 1 });
    expect(body.items[0]).toMatchObject({
      changeId: READY,
      title: 'Ready thing',
      taskCount: 4,
      stage: null,
      canBuild: true,
    });
    const row = await changeRow(READY);
    expect(row.status).toBe('on-runway');
    expect(row.approval).toMatchObject({ state: 'on-runway' });
    const detail = (await (await get(`/api/hosts/${hostId}/changes/${READY}`)).json()) as Record<
      string,
      unknown
    >;
    expect(detail).toMatchObject({ status: 'on-runway', stage: null, canBuild: true, pr: null });
    // Nothing parked: there is nothing to retry.
    expect((await post(`/api/hosts/${hostId}/changes/${READY}/retry`)).status).toBe(409);
    // The covered-files list is gone: an approval belongs to the change, not to its files.
    expect(detail.inputs).toBeUndefined();
  });

  it('stays On runway when the plan is revised on the base branch', async () => {
    const bytes = readFileSync(join(repo.root, PROPOSAL), 'utf8');
    await commitChange(repo.root, PROPOSAL, `${bytes}\nAn edit after approval.\n`);
    await commitChange(
      repo.root,
      TASKS,
      readFileSync(join(repo.root, TASKS), 'utf8').replace('- [ ] 1.1', '- [x] 1.1'),
    );
    expect((await changeRow(READY)).status).toBe('on-runway');
    expect((await runway()).count).toBe(1);
  });

  it('refuses what is not ready, built or unknown', async () => {
    expect((await post(`/api/hosts/${hostId}/changes/${SYNTHETIC.built}/approve`)).status).toBe(
      409,
    );
    expect((await post(`/api/hosts/${hostId}/changes/no-such-change/approve`)).status).toBe(404);
    expect((await post(`/api/hosts/${hostId}/changes/..%2Fx/approve`)).status).toBe(400);
  });

  it('withdraws in one click: off the runway and Ready to approve again', async () => {
    events.length = 0;
    const res = await post(`/api/hosts/${hostId}/changes/${READY}/withdraw`);
    expect(await res.json()).toEqual({ withdrawn: true });
    await waitFor(() => events.some((e) => e.family === 'runway' && e.payload.count === 0), 1000);
    expect((await runway()).count).toBe(0);
    expect((await changeRow(READY)).status).toBe('ready');
    expect(await (await post(`/api/hosts/${hostId}/changes/${READY}/withdraw`)).json()).toEqual({
      withdrawn: false,
    });
  });

  it('approves every ready change at once', async () => {
    const res = await post(`/api/hosts/${hostId}/approve-all`);
    const { approved } = (await res.json()) as { approved: string[] };
    expect(approved).toContain(READY);
    expect((await runway()).count).toBe(approved.length);
    expect(await (await post(`/api/hosts/${hostId}/approve-all`)).json()).toEqual({
      approved: [],
    });
  });

  it('reports the runway in /control/status', async () => {
    const control = createControlApp({
      store: db,
      bus,
      tokenHash: hashToken(CONTROL_TOKEN),
      port: PORT,
      onStop: () => {},
      detectFramework,
      runwayCount: async (id) => {
        const runtime = runtimes.get(id);
        return runtime === null ? null : (await approvals.runway(runtime)).count;
      },
    });
    const auth = { authorization: `Bearer ${CONTROL_TOKEN}`, 'content-type': 'application/json' };
    const status = (await (
      await control.request('http://control/control/status', { headers: auth })
    ).json()) as { hosts: { id: string; runway?: number }[] };
    expect(status.hosts.find((h) => h.id === hostId)?.runway).toBe((await runway()).count);
  });
});

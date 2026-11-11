// The console's approval half (signed-approvals: Console prepares, terminal signs; runway): the
// prepare preview, the runway API,
// the verified status overlay on the changes API, and the watcher's `approval` / `runway` events.
//
// A scratch copy of the synthetic host, a scratch home, a throwaway unprotected ed25519 key
// trusted through the library, and an integrity baseline. Approvals land through the real
// `approveCommand` (signAndLand underneath) with that key. Nothing here touches ~/.ssh,
// ssh-agent, the Keychain, the real Counterpoint home or a real host repository.
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
import { startWatcher, type Watcher } from '../../src/server/watcher.ts';
import {
  commitChange,
  type FixtureRepo,
  materializeFixtureRepo,
  SYNTHETIC,
} from '../helpers/fixture-repo.ts';
import { makeThrowawayKey, type ThrowawayKey } from '../helpers/keys.ts';
import { gitIn, makeScratchDir, removeScratchDirs, writeFileIn } from '../helpers/scratch.ts';

const PORT = 4997;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://${HOST}`;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const READY = SYNTHETIC.ready;
const PROPOSAL = `openspec/changes/${READY}/proposal.md`;
const TASKS = `openspec/changes/${READY}/tasks.md`;
const CONTROL_TOKEN = 'test-control-token';

interface Prepared {
  change: { id: string; title: string; taskCount: number };
  baseBranch: string;
  tip: string;
  inputs: { label: string; path: string; kind: string; digest: string }[];
  draft: { state: string };
  gates: { state: string; digest: string | null };
  fingerprint: string;
  ownerSteps: string[];
  itemPath: string;
  command: string;
}

interface RunwayBody {
  count: number;
  taskCount: number;
  changedCount: number;
  items: {
    changeId: string;
    title: string;
    taskCount: number;
    signedAt: string;
    unreadable: boolean;
  }[];
}

interface ChangeRow {
  id: string;
  status: string;
  approval: { state: string; signedAt?: string; commit?: string; reason?: string } | null;
}

let repo: FixtureRepo;
let key: ThrowawayKey;
let db: Store;
let bus: EventBus;
let runtimes: HostRuntimes;
let approvals: ApprovalViews;
let hostId = '';
let cookie = '';
let uiDir = '';
let home = '';

function app(options: { home?: string; approvals?: ApprovalViews } = {}) {
  return createApp({
    store: db,
    port: PORT,
    uiDir,
    bus,
    runtimes,
    home: options.home ?? home,
    approvals: options.approvals ?? approvals,
  });
}

async function get(path: string, options: { home?: string; approvals?: ApprovalViews } = {}) {
  return app(options).request(`http://${HOST}${path}`, { headers: { host: HOST, cookie } });
}

async function prepare(
  changeId: string,
  options: {
    home?: string;
    approvals?: ApprovalViews;
    origin?: string | null;
    withCookie?: boolean;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = { host: HOST, 'content-type': 'application/json' };
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN;
  if (options.withCookie !== false) headers.cookie = cookie;
  return app(options).request(`http://${HOST}/api/hosts/${hostId}/changes/${changeId}/approval`, {
    method: 'POST',
    headers,
    body: '{}',
  });
}

async function changeRow(
  changeId: string,
  options: { approvals?: ApprovalViews; home?: string } = {},
) {
  const body = (await (await get(`/api/hosts/${hostId}/changes`, options)).json()) as {
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

async function master(): Promise<string> {
  return (await gitIn(repo.root, ['rev-parse', 'refs/heads/master'])).trim();
}

/** Signs and lands the approval of `changeId` with the throwaway key (no terminal prompt). */
async function land(changeId: string, notify?: () => Promise<void>): Promise<void> {
  const err: string[] = [];
  const code = await approveCommand({
    home,
    hostId,
    changeId,
    isTTY: true,
    out: () => {},
    err: (line) => err.push(line),
    notify: async () => {
      await notify?.();
    },
  });
  expect(err.join('\n')).toBe('');
  expect(code).toBe(0);
}

/** A second home trusting the same key (or not) with or without a baseline. */
async function otherHome(options: { trust: boolean; baseline: 'none' | 'same' | 'other' }) {
  const dir = makeScratchDir('ohome');
  if (options.trust) await writeTrust(dir, { publicKeyPath: key.publicKeyPath });
  if (options.baseline !== 'none') {
    const snapshot = await snapshotIntegrity(join(repo.root, '.git'));
    if (options.baseline === 'other') {
      snapshot.config['core.fsmonitor'] = ['/bin/true'];
    }
    writeBaseline(dir, hostId, snapshot);
  }
  return { home: dir, approvals: createApprovalViews({ home: dir }) };
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
  approvals = createApprovalViews({ home });

  key = await makeThrowawayKey(makeScratchDir('appr-keys'), { name: 'approval' });
  await writeTrust(home, { publicKeyPath: key.publicKeyPath });
  writeBaseline(home, hostId, await snapshotIntegrity(join(repo.root, '.git')));

  const code = mintLoginCode(db);
  const login = await app().request(`http://${HOST}/login?code=${code}`, {
    headers: { host: HOST },
  });
  expect(login.status).toBe(302);
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  expect(cookie).toMatch(/^cp_session=/);
});

afterAll(() => {
  db?.close();
  removeScratchDirs();
});

describe('POST /api/hosts/:hostId/changes/:changeId/approval (prepare preview)', () => {
  it('recomputes the statement at the base tip and returns inputs, slots, fingerprint and the command', async () => {
    const before = await master();
    const res = await prepare(READY);
    expect(res.status).toBe(200);
    const { prepared } = (await res.json()) as { prepared: Prepared };
    expect(prepared.change).toEqual({ id: READY, title: 'Ready thing', taskCount: 4 });
    expect(prepared.baseBranch).toBe('master');
    expect(prepared.tip).toBe(before);
    expect(prepared.inputs).toHaveLength(5);
    for (const input of prepared.inputs) {
      expect(input.digest).toMatch(DIGEST_RE);
      expect(typeof input.label).toBe('string');
      expect(input).not.toHaveProperty('bytes');
    }
    expect(prepared.inputs.map((input) => input.kind)).toEqual([
      'metadata',
      'design',
      'proposal',
      'spec',
      'tasks',
    ]);
    expect(prepared.draft).toEqual({ state: 'none' });
    expect(prepared.gates.state).toBe('absent');
    expect(prepared.fingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(prepared.ownerSteps).toEqual(['Owner: create the Supabase project']);
    expect(prepared.itemPath).toBe(`.counterpoint/approvals/${READY}.json`);
    expect(prepared.command).toBe(`counterpoint approve ${hostId} ${READY}`);

    // Preview only: nothing was written.
    expect(await master()).toBe(before);
    expect(await gitIn(repo.root, ['status', '--porcelain'])).toBe('');
  });

  it('is deterministic for the same tip', async () => {
    const a = ((await (await prepare(READY)).json()) as { prepared: Prepared }).prepared;
    const b = ((await (await prepare(READY)).json()) as { prepared: Prepared }).prepared;
    expect(b.fingerprint).toBe(a.fingerprint);
  });

  it('is guarded: no Origin → 403, no session → 401', async () => {
    expect((await prepare(READY, { origin: null })).status).toBe(403);
    expect((await prepare(READY, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await prepare(READY, { withCookie: false })).status).toBe(401);
  });

  it('refuses with no trusted key', async () => {
    const other = await otherHome({ trust: false, baseline: 'same' });
    const res = await prepare(READY, other);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { refused: string }).refused).toBe('no-trusted-key');
  });

  it('refuses with no integrity baseline', async () => {
    const other = await otherHome({ trust: true, baseline: 'none' });
    const res = await prepare(READY, other);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { refused: string }).refused).toBe('no-baseline');
  });

  it('refuses when the integrity snapshot changed, listing the changes', async () => {
    const other = await otherHome({ trust: true, baseline: 'other' });
    const res = await prepare(READY, other);
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      refused: string;
      changes: { area: string; name: string }[];
    };
    expect(body.refused).toBe('integrity-changed');
    expect(body.changes.map((change) => change.name)).toContain('core.fsmonitor');
    expect(JSON.stringify(body)).not.toContain('command');
  });

  it('refuses changes that are not ready, built, unreadable or unknown', async () => {
    const noProposal = await prepare(SYNTHETIC.noProposal);
    expect(noProposal.status).toBe(409);
    expect(await noProposal.json()).toEqual({ refused: 'not-ready', reason: 'no-proposal' });

    const noTasks = await prepare(SYNTHETIC.noTasks);
    expect(noTasks.status).toBe(409);
    expect(await noTasks.json()).toEqual({ refused: 'not-ready', reason: 'no-tasks' });

    const built = await prepare(SYNTHETIC.built);
    expect(built.status).toBe(409);
    expect(await built.json()).toEqual({ refused: 'built' });
    expect(await (await prepare(SYNTHETIC.archived)).json()).toEqual({ refused: 'built' });

    const broken = await prepare(SYNTHETIC.broken);
    expect(broken.status).toBe(409);
    expect(await broken.json()).toMatchObject({
      refused: 'unreadable',
      file: `openspec/changes/${SYNTHETIC.broken}/.openspec.yaml`,
    });

    expect((await prepare('no-such-change')).status).toBe(404);
    expect((await prepare('Bad_Change')).status).toBe(400);
    expect((await prepare('archive')).status).toBe(400);
  });
});

describe('runway, status overlay and live events', () => {
  let watcher: Watcher;
  const events: StoredEvent[] = [];
  let unsubscribe: () => void;

  beforeAll(async () => {
    unsubscribe = bus.subscribe((event) => events.push(event));
    watcher = startWatcher({ runtimes, db, bus, intervalMs: 100, approvals });
    await get(`/api/hosts/${hostId}/changes`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  afterAll(() => {
    watcher?.stop();
    unsubscribe?.();
  });

  it('starts with an empty runway and the ready change Ready', async () => {
    const body = await runway();
    expect(body.count).toBe(0);
    expect(body.items).toEqual([]);
    const row = await changeRow(READY);
    expect(row.status).toBe('ready');
    expect(row.approval).toBeNull();
  });

  it('appends approval and runway events within 3 s of a signed approval landing', async () => {
    events.length = 0;
    const started = Date.now();
    await land(READY);
    await waitFor(
      () =>
        events.some((e) => e.family === 'approval' && e.hostId === hostId) &&
        events.some((e) => e.family === 'runway' && e.payload.count === 1),
      3000,
    );
    expect(Date.now() - started).toBeLessThan(5000);
    const runwayEvent = events.find((e) => e.family === 'runway');
    expect(runwayEvent?.hostId).toBe(hostId);
    expect(runwayEvent?.payload).toEqual({ hostId, count: 1 });
  });

  it('serves runway 1 with the change row and overlays On runway on the changes API', async () => {
    const body = await runway();
    expect(body.count).toBe(1);
    expect(body.taskCount).toBe(4);
    expect(body.changedCount).toBe(0);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      changeId: READY,
      title: 'Ready thing',
      taskCount: 4,
      unreadable: false,
    });
    expect(Number.isNaN(Date.parse(body.items[0]?.signedAt ?? ''))).toBe(false);

    const row = await changeRow(READY);
    expect(row.status).toBe('on-runway');
    expect(row.approval?.state).toBe('on-runway');
    expect(typeof row.approval?.signedAt).toBe('string');
    expect(row.approval?.commit).toBe(await master());

    const detail = (await (await get(`/api/hosts/${hostId}/changes/${READY}`)).json()) as ChangeRow;
    expect(detail.status).toBe('on-runway');
    expect(detail.approval?.state).toBe('on-runway');
  });

  it('fails closed without a trusted key: the approval is invalid and the change keeps its base status', async () => {
    const other = await otherHome({ trust: false, baseline: 'same' });
    const row = await changeRow(READY, other);
    expect(row.status).toBe('ready');
    expect(row.approval).toEqual({ state: 'invalid', reason: 'no-trusted-key' });
  });

  it('stays On runway when a task box is ticked on the base branch', async () => {
    const bytes = (await import('node:fs')).readFileSync(join(repo.root, TASKS), 'utf8');
    await commitChange(repo.root, TASKS, bytes.replace('- [ ] 1.1', '- [x] 1.1'));
    expect((await changeRow(READY)).status).toBe('on-runway');
    expect((await runway()).count).toBe(1);
    await commitChange(repo.root, TASKS, bytes);
  });

  it('goes Changed when a signed input changes, and back On runway when it is reverted', async () => {
    const original = await gitIn(repo.root, ['show', `master:${PROPOSAL}`]);
    const bytes = (await import('node:fs')).readFileSync(join(repo.root, PROPOSAL));
    events.length = 0;
    await commitChange(repo.root, PROPOSAL, `${original}\nAn edit after signing.\n`);
    await waitFor(() => events.some((e) => e.family === 'runway' && e.payload.count === 0), 3000);
    expect(events.some((e) => e.family === 'approval')).toBe(true);

    const row = await changeRow(READY);
    expect(row.status).toBe('changed');
    expect(row.approval?.state).toBe('changed');
    const changed = await runway();
    expect(changed.count).toBe(0);
    expect(changed.changedCount).toBe(1);

    events.length = 0;
    await commitChange(repo.root, PROPOSAL, bytes);
    await waitFor(() => events.some((e) => e.family === 'runway' && e.payload.count === 1), 3000);
    expect((await changeRow(READY)).status).toBe('on-runway');
    expect((await runway()).count).toBe(1);
  });

  it('re-checks at once on a control approval nudge and reports runway in /control/status', async () => {
    const nudged: string[] = [];
    const control = createControlApp({
      store: db,
      bus,
      tokenHash: hashToken(CONTROL_TOKEN),
      port: PORT,
      onStop: () => {},
      detectFramework,
      nudge: (id) => {
        nudged.push(id);
        void watcher.nudge(id);
      },
      runwayCount: async (id) => {
        const runtime = runtimes.get(id);
        return runtime === null ? null : (await approvals.runway(runtime)).count;
      },
    });
    const auth = { authorization: `Bearer ${CONTROL_TOKEN}`, 'content-type': 'application/json' };

    const status = (await (
      await control.request('http://control/control/status', { headers: auth })
    ).json()) as { hosts: { id: string; runway?: number }[] };
    expect(status.hosts.find((h) => h.id === hostId)?.runway).toBe(1);

    const notify = await control.request('http://control/control/notify', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ hostId, family: 'approval' }),
    });
    expect(notify.status).toBe(202);
    expect(nudged).toEqual([hostId]);

    const doctor = await control.request('http://control/control/notify', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ hostId, family: 'doctor' }),
    });
    expect(doctor.status).toBe(202);
    expect(nudged).toEqual([hostId]);
  });

  it('a nudge publishes the runway change without waiting for the next poll', async () => {
    // A slow watcher: only the nudge can see the move in time.
    watcher.stop();
    const slow = startWatcher({ runtimes, db, bus, intervalMs: 60_000, approvals });
    try {
      await slow.tick();
      events.length = 0;
      await commitChange(repo.root, PROPOSAL, 'nudged edit\n');
      await slow.nudge(hostId);
      expect(events.some((e) => e.family === 'runway' && e.payload.count === 0)).toBe(true);
      expect(events.some((e) => e.family === 'approval')).toBe(true);
    } finally {
      slow.stop();
    }
  });
});

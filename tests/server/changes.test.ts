// The changes API (host-planning: Change statuses; Change detail; Live refresh from the base
// branch): per-host runtimes read the OpenSpec snapshot at the base branch tip through compose.ts,
// core derives status and owner steps, and the base-tip watcher pushes a `planning` event within
// seconds of a commit to the base branch.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectFramework } from '../../src/compose.ts';
import { registerHost } from '../../src/core/host/registry.ts';
import { mintLoginCode } from '../../src/core/security/login.ts';
import { hostRegistryStore, openStore, type Store } from '../../src/core/store/db.ts';
import { EventBus, type StoredEvent } from '../../src/core/store/events.ts';
import { createApp } from '../../src/server/app.ts';
import { createHostRuntimes, type HostRuntimes } from '../../src/server/hosts.ts';
import { startWatcher } from '../../src/server/watcher.ts';
import {
  commitChange,
  type FixtureRepo,
  materializeFixtureRepo,
  SYNTHETIC,
  SYNTHETIC_FILES,
} from '../helpers/fixture-repo.ts';
import { makeScratchDir, removeScratchDirs, writeFileIn } from '../helpers/scratch.ts';

const PORT = 4998;
const HOST = `127.0.0.1:${PORT}`;
const _DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const READY = SYNTHETIC.ready;
const READY_DIR = `openspec/changes/${READY}`;
const PROPOSAL = `${READY_DIR}/proposal.md`;
const METADATA = `${READY_DIR}/.openspec.yaml`;

const _sha256 = (bytes: Uint8Array | string) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

interface ChangeRow {
  id: string;
  title: string;
  archived: boolean;
  archivedOn: string | null;
  created: string | null;
  dependsOn: string[];
  status: string;
  notReadyReason: string | null;
  artifacts: { proposal: boolean; design: boolean; tasks: boolean; specs: string[] };
  tasks: { total: number; done: number };
  ownerStepCount: number;
  unreadable: { file: string; reason: string } | null;
  approval: unknown;
}

interface ChangesBody {
  hostId: string;
  hostName: string;
  baseBranch: string;
  tip: string;
  changes: ChangeRow[];
}

interface ChangeDetailBody extends ChangeRow {
  hostId: string;
  baseBranch: string;
  tip: string;
  why: string | null;
  ownerSteps: string[];
}

let repo: FixtureRepo;
let db: Store;
let bus: EventBus;
let runtimes: HostRuntimes;
let hostId = '';
let cookie = '';
let uiDir = '';
let home = '';

function app() {
  return createApp({ store: db, port: PORT, uiDir, bus, runtimes, home });
}

async function get(path: string, withCookie = true): Promise<Response> {
  const headers: Record<string, string> = { host: HOST };
  if (withCookie) headers.cookie = cookie;
  return app().request(`http://${HOST}${path}`, { headers });
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
  home = makeScratchDir('changes-home');
  db = openStore(home);
  bus = new EventBus();
  uiDir = makeScratchDir('ui');
  writeFileIn(uiDir, 'index.html', '<!doctype html><title>Counterpoint</title>');
  const host = await registerHost(hostRegistryStore(db), {
    cwd: repo.root,
    base: 'master',
    detectFramework,
  });
  expect(host.adapter).toBe('openspec');
  hostId = host.id;
  runtimes = createHostRuntimes({ store: db, debounceMs: 600 });

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

describe('GET /api/hosts/:hostId/changes', () => {
  it('lists every change in build order, archived last, with core-derived status', async () => {
    const res = await get(`/api/hosts/${hostId}/changes`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChangesBody;
    expect(body.hostId).toBe(hostId);
    expect(body.baseBranch).toBe('master');
    expect(body.tip).toBe(repo.commit);
    expect(body.changes.map((change) => [change.id, change.status, change.notReadyReason])).toEqual(
      [
        [SYNTHETIC.built, 'built', null],
        [READY, 'ready', null],
        [SYNTHETIC.noTasks, 'not-planned', 'no-tasks'],
        [SYNTHETIC.noProposal, 'not-planned', 'no-proposal'],
        [SYNTHETIC.broken, 'unreadable', null],
        [SYNTHETIC.archived, 'built', null],
      ],
    );
  });

  it('reports title, artifacts, task progress, dependencies and owner steps per row', async () => {
    const body = (await (await get(`/api/hosts/${hostId}/changes`)).json()) as ChangesBody;
    const ready = body.changes.find((change) => change.id === READY);
    expect(ready).toMatchObject({
      title: 'Ready thing',
      archived: false,
      created: '2026-10-03',
      dependsOn: [SYNTHETIC.built],
      artifacts: { proposal: true, design: true, tasks: true, specs: ['menu'] },
      tasks: { total: 4, done: 1 },
      ownerStepCount: 1,
      approval: null,
    });
    const broken = body.changes.find((change) => change.id === SYNTHETIC.broken);
    expect(broken?.unreadable?.file).toBe(`openspec/changes/${SYNTHETIC.broken}/.openspec.yaml`);
    const archived = body.changes.find((change) => change.id === SYNTHETIC.archived);
    expect(archived).toMatchObject({
      archived: true,
      archivedOn: '2026-09-01',
      title: 'Old thing',
    });
  });

  it('answers 404 for an unknown host and 400 for a malformed host id', async () => {
    expect((await get('/api/hosts/no-such-host/changes')).status).toBe(404);
    expect((await get('/api/hosts/Bad_Host/changes')).status).toBe(400);
    expect((await get('/api/hosts/-dash/changes')).status).toBe(400);
  });

  it('requires a session', async () => {
    expect((await get(`/api/hosts/${hostId}/changes`, false)).status).toBe(401);
  });
});

describe('GET /api/hosts/:hostId/changes/:changeId', () => {
  it('returns why, owner steps, the base tip and the approval state, and no covered files', async () => {
    const res = await get(`/api/hosts/${hostId}/changes/${READY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChangeDetailBody;
    expect(body.id).toBe(READY);
    expect(body.status).toBe('ready');
    expect(body.tip).toBe(repo.commit);
    expect(body.why).toBe('A change that has its proposal and its tasks, ready to approve.');
    expect(body.ownerSteps).toEqual(['Owner: create the Supabase project']);

    expect(body.approval).toBeNull();
    expect(body).not.toHaveProperty('inputs');
  });

  it('answers 404 for an unknown change and 400 for a malformed change id', async () => {
    expect((await get(`/api/hosts/${hostId}/changes/no-such-change`)).status).toBe(404);
    expect((await get(`/api/hosts/${hostId}/changes/Bad_Change`)).status).toBe(400);
    expect((await get(`/api/hosts/${hostId}/changes/archive`)).status).toBe(400);
    expect((await get(`/api/hosts/${hostId}/changes/a..b`)).status).toBe(400);
    expect((await get(`/api/hosts/no-such-host/changes/${READY}`)).status).toBe(404);
  });

  it('names the unreadable file of a change that could not be parsed', async () => {
    const body = (await (
      await get(`/api/hosts/${hostId}/changes/${SYNTHETIC.broken}`)
    ).json()) as ChangeDetailBody;
    expect(body.status).toBe('unreadable');
    expect(body.unreadable?.file).toBe(`openspec/changes/${SYNTHETIC.broken}/.openspec.yaml`);
  });

  it('shows an archived change as built', async () => {
    const body = (await (
      await get(`/api/hosts/${hostId}/changes/${SYNTHETIC.archived}`)
    ).json()) as ChangeDetailBody;
    expect(body).toMatchObject({ status: 'built', archived: true, approval: null });
  });
});

describe('base-tip watcher', () => {
  it('appends a planning event within 3 s of a commit to the base branch and serves the new content', async () => {
    const events: StoredEvent[] = [];
    const unsubscribe = bus.subscribe((event) => events.push(event));
    const watcher = startWatcher({ runtimes, db, bus, intervalMs: 100 });
    try {
      // Let the watcher see the current tip first.
      await get(`/api/hosts/${hostId}/changes`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const content = '# Ready thing, revised\n\n## Why\n\nA new reason.\n';
      const tip = await commitChange(repo.root, PROPOSAL, content);
      const started = Date.now();
      await waitFor(
        () => events.some((event) => event.family === 'planning' && event.payload.tip === tip),
        3000,
      );
      expect(Date.now() - started).toBeLessThan(3000);
      const event = events.find((e) => e.family === 'planning');
      expect(event?.hostId).toBe(hostId);

      const body = (await (
        await get(`/api/hosts/${hostId}/changes/${READY}`)
      ).json()) as ChangeDetailBody;
      expect(body.tip).toBe(tip);
      expect(body.title).toBe('Ready thing, revised');
      expect(body.why).toBe('A new reason.');
    } finally {
      watcher.stop();
      unsubscribe();
    }
  });

  it('shows a newly committed change within seconds', async () => {
    const events: StoredEvent[] = [];
    const unsubscribe = bus.subscribe((event) => events.push(event));
    const watcher = startWatcher({ runtimes, db, bus, intervalMs: 100 });
    try {
      await get(`/api/hosts/${hostId}/changes`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const tip = await commitChange(
        repo.root,
        'openspec/changes/brand-new/proposal.md',
        '# Brand new\n',
      );
      await waitFor(
        () => events.some((event) => event.family === 'planning' && event.payload.tip === tip),
        3000,
      );
      const body = (await (await get(`/api/hosts/${hostId}/changes`)).json()) as ChangesBody;
      expect(body.changes.find((change) => change.id === 'brand-new')?.title).toBe('Brand new');
    } finally {
      watcher.stop();
      unsubscribe();
    }
  });

  it('keeps the last good parse of a change that breaks, re-reads it after the debounce, then reports it', async () => {
    const events: StoredEvent[] = [];
    const unsubscribe = bus.subscribe((event) => events.push(event));
    const watcher = startWatcher({ runtimes, db, bus, intervalMs: 100 });
    try {
      // Warm the cache at the current tip, where the ready change reads fine.
      const before = (await (await get(`/api/hosts/${hostId}/changes`)).json()) as ChangesBody;
      expect(before.changes.find((c) => c.id === READY)?.status).toBe('ready');

      const broken = await commitChange(repo.root, METADATA, 'created: [unclosed\n');
      const immediate = (await (await get(`/api/hosts/${hostId}/changes`)).json()) as ChangesBody;
      expect(immediate.tip).toBe(broken);
      expect(immediate.changes.find((c) => c.id === READY)?.status).toBe('ready');

      // After the retry settles the change reads as unreadable and a planning event is pushed
      // for the settled retry (`settled: true`), so open pages refetch.
      await waitFor(
        () =>
          events.some(
            (event) =>
              event.family === 'planning' &&
              event.payload.tip === broken &&
              event.payload.settled === true,
          ),
        3000,
      );
      const after = (await (await get(`/api/hosts/${hostId}/changes`)).json()) as ChangesBody;
      expect(after.changes.find((c) => c.id === READY)?.status).toBe('unreadable');
      expect(after.changes.find((c) => c.id === READY)?.unreadable?.file).toBe(METADATA);
      // Other changes are unaffected.
      expect(after.changes.find((c) => c.id === SYNTHETIC.built)?.status).toBe('built');
      await commitChange(repo.root, METADATA, SYNTHETIC_FILES[METADATA] as string);
    } finally {
      watcher.stop();
      unsubscribe();
    }
  });

  it('pushes a planning event when the base branch moved before the watcher first looked at the host', async () => {
    // The console is served a snapshot, then the base branch moves before any watcher poll.
    const served = (await (await get(`/api/hosts/${hostId}/changes`)).json()) as ChangesBody;
    const tip = await commitChange(repo.root, PROPOSAL, '# Ready thing, third take\n');
    expect(tip).not.toBe(served.tip);

    const events: StoredEvent[] = [];
    const unsubscribe = bus.subscribe((event) => events.push(event));
    const watcher = startWatcher({ runtimes, db, bus, intervalMs: 100 });
    try {
      await waitFor(
        () => events.some((event) => event.family === 'planning' && event.payload.tip === tip),
        3000,
      );
    } finally {
      watcher.stop();
      unsubscribe();
    }
  });
});

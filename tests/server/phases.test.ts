// The phases API (ADPT-01, D-01, D-02, D-03): per-host runtimes read the GSD snapshot at the base
// branch tip through compose.ts, core derives status and prerequisites, and the base-tip watcher
// pushes a `phase` event within seconds of a commit to the base branch. Also the read-only doctor
// report route behind the Trust page (T-01-40).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectFramework } from '../../src/compose.ts';
import { registerHost } from '../../src/core/host/registry.ts';
import { mintLoginCode } from '../../src/core/security/login.ts';
import { hostRegistryStore, openStore, type Store } from '../../src/core/store/db.ts';
import { EventBus, type StoredEvent } from '../../src/core/store/events.ts';
import { createApp } from '../../src/server/app.ts';
import { createHostRuntimes, type HostRuntimes } from '../../src/server/hosts.ts';
import { startWatcher } from '../../src/server/watcher.ts';
import { commitChange, type FixtureRepo, materializeFixtureRepo } from '../helpers/fixture-repo.ts';
import { makeScratchDir, removeScratchDirs, writeFileIn } from '../helpers/scratch.ts';

const PORT = 4998;
const HOST = `127.0.0.1:${PORT}`;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const CONTEXT_02 = '.planning/phases/02-ready-thing/02-CONTEXT.md';
const PLAN_02_01 = '.planning/phases/02-ready-thing/02-01-PLAN.md';

const sha256 = (bytes: Uint8Array | string) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

interface PhaseRow {
  id: string;
  number: number[];
  name: string;
  status: string;
  notReadyReason: string | null;
  planCount: number;
  nonAutonomousCount: number;
  userSetup: { service: string; why: string | null }[];
  unreadable: { file: string; reason: string } | null;
}

interface PhasesBody {
  hostId: string;
  hostName: string;
  baseBranch: string;
  tip: string;
  phases: PhaseRow[];
}

interface PhaseDetailBody extends PhaseRow {
  hostId: string;
  baseBranch: string;
  tip: string;
  goal: string | null;
  dependsOn: string | null;
  requirements: string | null;
  plans: {
    id: string;
    wave: number | null;
    objective: string | null;
    autonomous: boolean;
    filesCount: number;
  }[];
  inputs: {
    path: string;
    label: string;
    kind: string;
    normalization: string | null;
    digest: string;
  }[];
  inputsError?: string;
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
  home = makeScratchDir('phases-home');
  db = openStore(home);
  bus = new EventBus();
  uiDir = makeScratchDir('ui');
  writeFileIn(uiDir, 'index.html', '<!doctype html><title>Counterpoint</title>');
  const host = await registerHost(hostRegistryStore(db), {
    cwd: repo.root,
    base: 'master',
    detectFramework,
  });
  expect(host.adapter).toBe('gsd');
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

describe('GET /api/hosts/:hostId/phases', () => {
  it('lists every roadmap phase in numeric tuple order with core-derived status', async () => {
    const res = await get(`/api/hosts/${hostId}/phases`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PhasesBody;
    expect(body.hostId).toBe(hostId);
    expect(body.baseBranch).toBe('master');
    expect(body.tip).toBe(repo.commit);
    expect(body.phases.map((phase) => phase.id)).toEqual([
      '01',
      '01.9',
      '01.10',
      '02',
      '02.1',
      '03',
      '04',
    ]);
    expect(body.phases.map((phase) => [phase.id, phase.status, phase.notReadyReason])).toEqual([
      ['01', 'built', null],
      ['01.9', 'not-planned', 'no-context'],
      ['01.10', 'not-planned', 'no-context'],
      ['02', 'ready', null],
      ['02.1', 'not-planned', 'no-plans'],
      ['03', 'not-planned', 'no-context'],
      ['04', 'unreadable', null],
    ]);
  });

  it('reports plan counts and the prerequisites (user_setup, non-autonomous plans)', async () => {
    const body = (await (await get(`/api/hosts/${hostId}/phases`)).json()) as PhasesBody;
    const ready = body.phases.find((phase) => phase.id === '02');
    expect(ready?.planCount).toBe(2);
    expect(ready?.nonAutonomousCount).toBe(1);
    expect(ready?.userSetup.map((item) => item.service)).toEqual([
      'docker + supabase-cli',
      'google-oauth',
    ]);
    const broken = body.phases.find((phase) => phase.id === '04');
    expect(broken?.unreadable?.file).toContain('04-01-PLAN.md');
    const noPlans = body.phases.find((phase) => phase.id === '02.1');
    expect(noPlans?.planCount).toBe(0);
    expect(noPlans?.nonAutonomousCount).toBe(0);
  });

  it('answers 404 for an unknown host and 400 for a malformed host id', async () => {
    expect((await get('/api/hosts/no-such-host/phases')).status).toBe(404);
    expect((await get('/api/hosts/Bad_Host/phases')).status).toBe(400);
    expect((await get('/api/hosts/-dash/phases')).status).toBe(400);
  });

  it('requires a session', async () => {
    expect((await get(`/api/hosts/${hostId}/phases`, false)).status).toBe(401);
  });
});

describe('GET /api/hosts/:hostId/phases/:phaseId', () => {
  it('returns goal, plans and the six D-02 inputs with sha256 digests of the committed bytes', async () => {
    const res = await get(`/api/hosts/${hostId}/phases/02`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PhaseDetailBody;
    expect(body.id).toBe('02');
    expect(body.status).toBe('ready');
    expect(body.tip).toBe(repo.commit);
    expect(body.goal).toContain('two plans');
    expect(body.dependsOn).toBe('Phase 1');
    expect(
      body.plans.map((plan) => [plan.id, plan.wave, plan.autonomous, plan.filesCount]),
    ).toEqual([
      ['02-01', 1, false, 3],
      ['02-02', 2, true, 1],
    ]);
    expect(body.plans[0]?.objective).toContain('Set up the ready thing');

    const paths = body.inputs.map((input) => input.path);
    expect(paths).toHaveLength(6);
    expect(paths).toEqual([...paths].sort());
    for (const input of body.inputs) {
      expect(input.digest).toMatch(DIGEST_RE);
      expect(input).not.toHaveProperty('bytes');
      if (input.kind !== 'roadmap-section') {
        expect(input.digest).toBe(sha256(readFileSync(join(repo.root, input.path))));
      }
    }
    expect(body.inputs.find((input) => input.kind === 'roadmap-section')?.normalization).not.toBe(
      null,
    );
  });

  it('answers 404 for an unknown phase and 400 for a malformed phase id', async () => {
    expect((await get(`/api/hosts/${hostId}/phases/09`)).status).toBe(404);
    expect((await get(`/api/hosts/${hostId}/phases/2`)).status).toBe(400);
    expect((await get(`/api/hosts/${hostId}/phases/02..`)).status).toBe(400);
    expect((await get('/api/hosts/no-such-host/phases/02')).status).toBe(404);
  });

  it('names the unreadable file of a phase that could not be parsed', async () => {
    const body = (await (await get(`/api/hosts/${hostId}/phases/04`)).json()) as PhaseDetailBody;
    expect(body.status).toBe('unreadable');
    expect(body.unreadable?.file).toContain('04-01-PLAN.md');
  });
});

describe('base-tip watcher', () => {
  it('appends a phase event within 3 s of a commit to the base branch and serves the new digest', async () => {
    const events: StoredEvent[] = [];
    const unsubscribe = bus.subscribe((event) => events.push(event));
    const watcher = startWatcher({ runtimes, db, bus, intervalMs: 100 });
    try {
      // Let the watcher see the current tip first.
      await get(`/api/hosts/${hostId}/phases`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const content = '# Phase 02 context, revised\n\nA new decision.\n';
      const tip = await commitChange(repo.root, CONTEXT_02, content);
      const started = Date.now();
      await waitFor(
        () => events.some((event) => event.family === 'phase' && event.payload.tip === tip),
        3000,
      );
      expect(Date.now() - started).toBeLessThan(3000);
      const event = events.find((e) => e.family === 'phase');
      expect(event?.hostId).toBe(hostId);

      const body = (await (await get(`/api/hosts/${hostId}/phases/02`)).json()) as PhaseDetailBody;
      expect(body.tip).toBe(tip);
      expect(body.inputs.find((input) => input.path === CONTEXT_02)?.digest).toBe(sha256(content));
    } finally {
      watcher.stop();
      unsubscribe();
    }
  });

  it('keeps the last good parse of a phase that breaks, re-reads it after the debounce, then reports it', async () => {
    const events: StoredEvent[] = [];
    const unsubscribe = bus.subscribe((event) => events.push(event));
    const watcher = startWatcher({ runtimes, db, bus, intervalMs: 100 });
    try {
      // Warm the cache at the current tip, where phase 02 reads fine.
      const before = (await (await get(`/api/hosts/${hostId}/phases`)).json()) as PhasesBody;
      expect(before.phases.find((p) => p.id === '02')?.status).toBe('ready');

      const broken = await commitChange(repo.root, PLAN_02_01, '---\nwave: [unclosed\n---\n');
      const immediate = (await (await get(`/api/hosts/${hostId}/phases`)).json()) as PhasesBody;
      expect(immediate.tip).toBe(broken);
      expect(immediate.phases.find((p) => p.id === '02')?.status).toBe('ready');

      // After the retry settles the phase reads as unreadable and a phase event is pushed for
      // the settled retry (`settled: true`), so open pages refetch.
      await waitFor(
        () =>
          events.some(
            (event) =>
              event.family === 'phase' &&
              event.payload.tip === broken &&
              event.payload.settled === true,
          ),
        3000,
      );
      const after = (await (await get(`/api/hosts/${hostId}/phases`)).json()) as PhasesBody;
      expect(after.phases.find((p) => p.id === '02')?.status).toBe('unreadable');
      expect(after.phases.find((p) => p.id === '02')?.unreadable?.file).toContain('02-01-PLAN.md');
      // Other phases are unaffected.
      expect(after.phases.find((p) => p.id === '01')?.status).toBe('built');
    } finally {
      watcher.stop();
      unsubscribe();
    }
  });

  it('pushes a phase event when the base branch moved before the watcher first looked at the host', async () => {
    // The console is served a snapshot, then the base branch moves before any watcher poll.
    const served = (await (await get(`/api/hosts/${hostId}/phases`)).json()) as PhasesBody;
    const tip = await commitChange(repo.root, CONTEXT_02, '# Phase 02 context, third take\n');
    expect(tip).not.toBe(served.tip);

    const events: StoredEvent[] = [];
    const unsubscribe = bus.subscribe((event) => events.push(event));
    const watcher = startWatcher({ runtimes, db, bus, intervalMs: 100 });
    try {
      await waitFor(
        () => events.some((event) => event.family === 'phase' && event.payload.tip === tip),
        3000,
      );
    } finally {
      watcher.stop();
      unsubscribe();
    }
  });
});

describe('GET /api/hosts/:hostId/doctor', () => {
  const PROBE_IDS = ['signing-key', 'ssh', 'gh', 'state', 'git-config', 'git-hooks', 'git-info'];
  const reportFile = () => join(home, 'hosts', hostId, 'doctor.json');
  const report = (overrides: Record<string, unknown> = {}) => {
    const check = (id: string) => ({ id, label: id, result: 'pass', detail: 'ok' });
    return {
      schema: 'counterpoint/doctor/v1',
      hostId,
      checkedAt: new Date().toISOString(),
      claudeVersion: '2.1.0',
      matcherVersion: '1',
      tools: [check('claude'), check('git'), check('gh')],
      signingKey: [check('passphrase')],
      integrity: check('integrity'),
      probe: PROBE_IDS.map((id, index) => ({
        id,
        label: id,
        mode: 'read',
        result: overrides.reachableIndex === index ? 'reachable' : 'blocked',
        evidence: 'probe',
      })),
      ...(overrides.checkedAt === undefined ? {} : { checkedAt: overrides.checkedAt }),
      ...(overrides.hostId === undefined ? {} : { hostId: overrides.hostId }),
    };
  };
  const write = (value: unknown) => {
    mkdirSync(join(home, 'hosts', hostId), { recursive: true });
    rmSync(reportFile(), { force: true });
    writeFileSync(reportFile(), JSON.stringify(value));
  };
  const doctor = async () => {
    const res = await get(`/api/hosts/${hostId}/doctor`);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it('answers report null before doctor has run', async () => {
    rmSync(reportFile(), { force: true });
    expect(await doctor()).toEqual({ status: 200, body: { report: null } });
  });

  it('returns a valid report with its verdict and staleness', async () => {
    write(report());
    const fresh = await doctor();
    expect(fresh.body.verdict).toBe('pass');
    expect(fresh.body.stale).toBe(false);

    write(report({ checkedAt: new Date(Date.now() - 25 * 3_600_000).toISOString() }));
    expect((await doctor()).body.stale).toBe(true);

    write(report({ reachableIndex: 1 }));
    expect((await doctor()).body.verdict).toBe('fail');
  });

  it('refuses a symlinked, malformed or other-host report as unreadable, never as a verdict', async () => {
    const elsewhere = join(makeScratchDir('elsewhere'), 'doctor.json');
    writeFileSync(elsewhere, JSON.stringify(report()));
    rmSync(reportFile(), { force: true });
    symlinkSync(elsewhere, reportFile());
    expect((await doctor()).body).toEqual({ report: null, error: 'unreadable' });

    write('not a report');
    expect((await doctor()).body).toEqual({ report: null, error: 'unreadable' });

    write(report({ hostId: 'some-other-host' }));
    expect((await doctor()).body).toEqual({ report: null, error: 'unreadable' });
  });

  it('answers 400 for a malformed host id and 404 for an unknown host', async () => {
    expect((await get('/api/hosts/Bad_Host/doctor')).status).toBe(400);
    expect((await get('/api/hosts/no-such-host/doctor')).status).toBe(404);
  });
});

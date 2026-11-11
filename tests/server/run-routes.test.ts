// The console's build-lane actions (build-runs: Start and stop a run from the console; doctor:
// Doctor and risk withdrawal from the console; daemon-lifecycle: Stop Counterpoint from the
// console) and their control-socket twins (`counterpoint run`, `run stop`, `run status`). The
// orchestrator is a recording stand-in here: these tests are about the HTTP surface and its guards.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Governor } from '../../src/build/governor.ts';
import type { Orchestrator, RunView } from '../../src/build/orchestrator.ts';
import { detectFramework } from '../../src/compose.ts';
import { registerHost } from '../../src/core/host/registry.ts';
import { readAcceptedRisks, writeAcceptedRisk } from '../../src/core/security/accepted-risks.ts';
import { mintLoginCode } from '../../src/core/security/login.ts';
import { hostRegistryStore, openStore, type Store } from '../../src/core/store/db.ts';
import { EventBus } from '../../src/core/store/events.ts';
import { insertRun, insertRunChange, parkRunChange } from '../../src/core/store/runs.ts';
import { createApp } from '../../src/server/app.ts';
import { createApprovalViews } from '../../src/server/approval-views.ts';
import { createControlApp, hashToken } from '../../src/server/control.ts';
import { createDoctorService, type DoctorService } from '../../src/server/doctor-service.ts';
import { createHostRuntimes } from '../../src/server/hosts.ts';
import { type FixtureRepo, materializeFixtureRepo } from '../helpers/fixture-repo.ts';
import { makeScratchDir, removeScratchDirs, writeFileIn } from '../helpers/scratch.ts';

const PORT = 4997;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://${HOST}`;
const TOKEN = 'run-control-token';

let repo: FixtureRepo;
let db: Store;
let home = '';
let hostId = '';
let cookie = '';
let uiDir = '';
let stopped = 0;
let withdrawnEvents = 0;
const started: Array<{ hostId: string; input: unknown }> = [];
const stops: Array<string | undefined> = [];
let doctor: DoctorService;
let releaseDoctor: () => void = () => {};

const VIEW = { id: 'r1', hostId: 'x', state: 'running', changes: [] } as unknown as RunView;

const orchestrator = {
  start: async (id: string, input: unknown) => {
    started.push({ hostId: id, input });
    const changes = (input as { changes?: unknown }).changes;
    if (Array.isArray(changes) && changes.includes('off-runway')) {
      return { ok: false, status: 409, error: 'Not on the runway now: off-runway.' };
    }
    return { ok: true, runId: 'r1' };
  },
  stop: (id?: string) => {
    stops.push(id);
    return id === undefined || id === hostId;
  },
  view: () => VIEW,
  running: () => null,
} as unknown as Orchestrator;

function app() {
  const runtimes = createHostRuntimes({ store: db });
  return createApp({
    store: db,
    port: PORT,
    uiDir,
    bus: new EventBus(),
    runtimes,
    home,
    approvals: createApprovalViews({ home }),
    run: {
      orchestrator,
      doctor,
      claudeVersion: async () => '2.1.322 (Claude Code)',
      stopDaemon: () => {
        stopped += 1;
      },
      onRiskWithdrawn: () => {
        withdrawnEvents += 1;
      },
    },
  });
}

function request(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { host: HOST, cookie, ...extra };
  if (method !== 'GET') {
    headers.origin = ORIGIN;
    headers['content-type'] = 'application/json';
  }
  return Promise.resolve(
    app().request(`http://${HOST}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

beforeAll(async () => {
  repo = await materializeFixtureRepo('synthetic');
  home = makeScratchDir('run-home');
  db = openStore(home);
  uiDir = makeScratchDir('run-ui');
  writeFileIn(uiDir, 'index.html', '<!doctype html><title>Counterpoint</title>');
  const host = await registerHost(hostRegistryStore(db), {
    cwd: repo.root,
    base: 'master',
    detectFramework,
  });
  hostId = host.id;
  doctor = createDoctorService({
    home,
    store: db,
    governor: new Governor({ db, doctorGate: () => ({ ok: true }) }),
    runnerFactory: () => ({
      run: async () => {
        throw new Error('no');
      },
      version: async () => null,
    }),
    setInstalledVersion: () => {},
    publish: () => {},
    runDoctor: (input) =>
      new Promise((resolve) => {
        input.onProgress?.('probe');
        releaseDoctor = () =>
          resolve({
            report: { probe: [] } as never,
            reportPath: '',
            logDir: '',
            recordedRisks: [],
            acceptedRisksProblem: null,
          });
      }),
  });
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

describe('runs from the console', () => {
  it('shows the run, the runway to pick from and the installed claude', async () => {
    const response = await request('GET', `/api/hosts/${hostId}/run`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      run: VIEW,
      runway: [],
      claudeVersion: '2.1.322 (Claude Code)',
      doctor: null,
    });
  });

  it('starts a run with a guarded POST, turning the stop time into epoch ms', async () => {
    const response = await request('POST', `/api/hosts/${hostId}/run`, {
      changes: ['ready-thing'],
      stopAt: '2026-11-12T06:00:00.000Z',
      model: 'opus',
      budgetPercent: 40,
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ runId: 'r1' });
    expect(started.at(-1)).toEqual({
      hostId,
      input: {
        changes: ['ready-thing'],
        stopAt: Date.parse('2026-11-12T06:00:00.000Z'),
        model: 'opus',
        budgetPercent: 40,
      },
    });
  });

  it("passes the orchestrator's refusal through with its status", async () => {
    const response = await request('POST', `/api/hosts/${hostId}/run`, {
      changes: ['off-runway'],
      stopAt: null,
      model: 'opus',
      budgetPercent: 40,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Not on the runway now: off-runway.' });
  });

  it('refuses a start without the Origin, or without the session (an agent cannot start a run)', async () => {
    const before = started.length;
    const noOrigin = await app().request(`http://${HOST}/api/hosts/${hostId}/run`, {
      method: 'POST',
      headers: { host: HOST, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ changes: null, stopAt: null, model: 'opus', budgetPercent: 40 }),
    });
    expect(noOrigin.status).toBe(403);
    const noSession = await app().request(`http://${HOST}/api/hosts/${hostId}/run`, {
      method: 'POST',
      headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ changes: null, stopAt: null, model: 'opus', budgetPercent: 40 }),
    });
    expect(noSession.status).toBe(401);
    expect(started.length).toBe(before);
  });

  it('stops the run at its next clean point', async () => {
    expect((await request('POST', `/api/hosts/${hostId}/run/stop`, {})).status).toBe(202);
    expect(stops.at(-1)).toBe(hostId);
  });

  it('shows parked changes and run-stopping errors in Needs You', async () => {
    insertRun(db, { id: 'run-a', hostId, settings: {}, stopAt: null });
    const id = insertRunChange(db, { runId: 'run-a', change: 'ready-thing', position: 0 });
    parkRunChange(db, id, 'Gate "unit" failed 3 times (last: exit code 1).');
    const response = await request('GET', `/api/hosts/${hostId}/needs-you`);
    const body = (await response.json()) as { runItems: Array<Record<string, unknown>> };
    expect(body.runItems).toEqual([
      expect.objectContaining({
        kind: 'parked',
        changeId: 'ready-thing',
        reason: 'Gate "unit" failed 3 times (last: exit code 1).',
      }),
    ]);
  });
});

describe('doctor, risks and stop from the console', () => {
  it('runs doctor with a guarded POST, one probe at a time, with its phase visible', async () => {
    expect((await request('POST', `/api/hosts/${hostId}/doctor/run`, {})).status).toBe(202);
    const busy = await request('POST', `/api/hosts/${hostId}/doctor/run`, {});
    expect(busy.status).toBe(409);
    const status = (await (await request('GET', '/api/doctor/status')).json()) as {
      doctor: { hostId: string; phase: string; source: string } | null;
    };
    expect(status.doctor).toMatchObject({ hostId, phase: 'probe', source: 'console' });
    releaseDoctor();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(doctor.status()).toBeNull();
  });

  it('withdraws an accepted risk, never records one', async () => {
    writeAcceptedRisk(home, { reason: 'the gh keyring entry' });
    expect((await request('POST', '/api/risks/gh-keychain/withdraw', {})).status).toBe(200);
    const record = readAcceptedRisks(home);
    expect(record.ok && record.risks).toEqual([]);
    expect(withdrawnEvents).toBe(1);
    expect((await request('POST', '/api/risks/something-else/withdraw', {})).status).toBe(404);
    // There is no route to record one.
    expect((await request('POST', '/api/risks/gh-keychain/accept', {})).status).toBe(404);
  });

  it('stops Counterpoint with a guarded POST', async () => {
    const response = await request('POST', '/api/stop', {});
    expect(response.status).toBe(202);
    await new Promise((resolve) => setImmediate(resolve));
    expect(stopped).toBe(1);
  });
});

describe('runs over the control socket', () => {
  const control = () =>
    createControlApp({
      store: db,
      bus: new EventBus(),
      tokenHash: hashToken(TOKEN),
      port: PORT,
      onStop: () => {},
      detectFramework,
      orchestrator,
    });
  const send = (method: string, path: string, body?: unknown, token = TOKEN) =>
    Promise.resolve(
      control().request(`http://counterpoint.control${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

  it('starts, stops and reports a run with the control token only', async () => {
    const start = await send('POST', '/control/run', {
      hostId,
      changes: null,
      until: '2026-11-12T06:00:00.000Z',
      model: 'opus',
      budgetPercent: 40,
    });
    expect(start.status).toBe(202);
    expect(started.at(-1)?.input).toEqual({
      changes: null,
      stopAt: Date.parse('2026-11-12T06:00:00.000Z'),
      model: 'opus',
      budgetPercent: 40,
    });
    expect((await send('POST', '/control/run/stop', { hostId })).status).toBe(202);
    expect(
      ((await (await send('GET', `/control/run?hostId=${hostId}`)).json()) as { run: unknown }).run,
    ).toEqual(VIEW);
    expect(
      (await send('POST', '/control/run', { hostId, model: 'opus', budgetPercent: 40 }, 'wrong'))
        .status,
    ).toBe(401);
  });
});

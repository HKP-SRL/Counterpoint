// The changes API (host-planning: Live refresh from the base branch): per-host runtimes read the
// OpenSpec snapshot at the base branch tip through compose.ts, core derives status and owner steps,
// and the base-tip watcher pushes a `planning` event within seconds of a commit to the base branch.
// Also the read-only doctor report route behind the Trust page (doctor: Trust page).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectFramework } from '../../src/compose.ts';
import { registerHost } from '../../src/core/host/registry.ts';
import { revokeAcceptedRisk, writeAcceptedRisk } from '../../src/core/security/accepted-risks.ts';
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
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const READY = SYNTHETIC.ready;
const READY_DIR = `openspec/changes/${READY}`;
const PROPOSAL = `${READY_DIR}/proposal.md`;
const METADATA = `${READY_DIR}/.openspec.yaml`;

const sha256 = (bytes: Uint8Array | string) =>
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
  uncommittedEdits: boolean;
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
      uncommittedEdits: false,
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
  it('returns why, owner steps and every covered file with sha256 digests', async () => {
    const res = await get(`/api/hosts/${hostId}/changes/${READY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChangeDetailBody;
    expect(body.id).toBe(READY);
    expect(body.status).toBe('ready');
    expect(body.tip).toBe(repo.commit);
    expect(body.why).toBe('A change that has its proposal and its tasks, ready to approve.');
    expect(body.ownerSteps).toEqual(['Owner: create the Supabase project']);

    const paths = body.inputs.map((input) => input.path);
    expect(paths).toEqual([
      `${READY_DIR}/.openspec.yaml`,
      `${READY_DIR}/design.md`,
      PROPOSAL,
      `${READY_DIR}/specs/menu/spec.md`,
      `${READY_DIR}/tasks.md`,
    ]);
    for (const input of body.inputs) {
      expect(input.digest).toMatch(DIGEST_RE);
      expect(input).not.toHaveProperty('bytes');
      if (input.kind !== 'tasks') {
        expect(input.digest).toBe(sha256(readFileSync(join(repo.root, input.path))));
        expect(input.normalization).toBeNull();
      }
    }
    expect(body.inputs.find((input) => input.kind === 'tasks')?.normalization).toBe(
      'cp-openspec-tasks/v1',
    );
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

  it('shows an archived change as built, with its files', async () => {
    const body = (await (
      await get(`/api/hosts/${hostId}/changes/${SYNTHETIC.archived}`)
    ).json()) as ChangeDetailBody;
    expect(body).toMatchObject({ status: 'built', archived: true, approval: null });
    expect(body.inputs.map((input) => input.label)).toEqual([
      '.openspec.yaml',
      'proposal.md',
      'tasks.md',
    ]);
  });
});

describe('base-tip watcher', () => {
  it('appends a planning event within 3 s of a commit to the base branch and serves the new digest', async () => {
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
      expect(body.inputs.find((input) => input.path === PROPOSAL)?.digest).toBe(sha256(content));
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

describe('GET /api/hosts/:hostId/doctor', () => {
  const PROBE_IDS = [
    'signing-key',
    'ssh',
    'gh',
    'state',
    'git-config',
    'git-hooks',
    'git-info',
    'outside-workdir',
    'credential-env',
    'worktree-git',
    'gate-sandbox',
  ];
  const WRITE_IDS = new Set([
    'git-config',
    'git-hooks',
    'git-info',
    'outside-workdir',
    'worktree-git',
    'gate-sandbox',
  ]);
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
        mode: WRITE_IDS.has(id) ? 'write' : 'read',
        result: overrides.reachableIndex === index ? 'reachable' : 'blocked',
        evidence: 'probe',
        // gh reached only through the Keychain lookup, as the live probe records it.
        ...(overrides.keychainOnlyGh === true && id === 'gh'
          ? {
              result: 'reachable',
              steps: [
                {
                  index: 10,
                  tool: 'Bash',
                  operation: 'cat',
                  treatment: 'denied-rule',
                  control: 'reached',
                },
                {
                  index: 11,
                  tool: 'Read',
                  operation: 'read',
                  treatment: 'denied-rule',
                  control: 'reached',
                },
                {
                  index: 12,
                  tool: 'Grep',
                  operation: 'grep',
                  treatment: 'denied-rule',
                  control: 'reached',
                },
                {
                  index: 13,
                  tool: 'Bash',
                  operation: 'keychain',
                  treatment: 'reached',
                  control: 'reached',
                },
              ],
              leaks: ['keychain-canary'],
              trusted: true,
            }
          : {}),
      })),
      ...(overrides.acceptedRisks === undefined ? {} : { acceptedRisks: overrides.acceptedRisks }),
      ...(overrides.noIsolation === true
        ? {}
        : {
            sandboxIsolation: {
              id: 'sandbox-isolation',
              label: 'Sandbox isolation settings',
              result: 'pass',
              detail: 'ok',
              sources: [
                {
                  kind: 'launch',
                  label: 'launch settings',
                  path: null,
                  state: 'read',
                  findings: [],
                },
              ],
            },
          }),
      ...(overrides.noAgentMode === true
        ? {}
        : {
            agentMode: {
              id: 'agent-mode',
              label: 'Agent permission mode',
              result: 'pass',
              detail: "The probe's agent session ran in auto mode.",
              expected: 'auto',
              effective: 'auto',
            },
          }),
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

  it('fails a stored report that lacks the sandbox isolation check', async () => {
    write(report({ noIsolation: true }));
    const older = await doctor();
    expect(older.status).toBe(200);
    expect(older.body.verdict).toBe('fail');

    write(report());
    expect((await doctor()).body.verdict).toBe('pass');
  });

  it('fails a stored report that lacks the agent permission mode check', async () => {
    write(report({ noAgentMode: true }));
    const older = await doctor();
    expect(older.status).toBe(200);
    expect(older.body.verdict).toBe('fail');
    expect((older.body.report as Record<string, unknown>).agentMode).toBeUndefined();

    write(report());
    const current = await doctor();
    expect(current.body.verdict).toBe('pass');
    expect((current.body.report as Record<string, unknown>).agentMode).toMatchObject({
      id: 'agent-mode',
      result: 'pass',
      effective: 'auto',
    });
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

  describe('the accepted risk gh-keychain', () => {
    const REASON = 'the gh keyring entry; accepted macOS residual';
    const recordFile = () => join(home, 'trust', 'accepted-risks.json');

    afterAll(() => {
      revokeAcceptedRisk(home, 'gh-keychain');
    });

    it('answers accepted-risk with the applied record, then fail after a revoke, for the same stored report', async () => {
      const entry = writeAcceptedRisk(home, {
        reason: REASON,
        now: () => new Date('2026-11-10T10:00:00.000Z'),
      });
      write(report({ keychainOnlyGh: true, acceptedRisks: [entry] }));

      const accepted = await doctor();
      expect(accepted.status).toBe(200);
      expect(accepted.body.verdict).toBe('accepted-risk');
      expect(accepted.body.acceptedRisks).toEqual([
        {
          id: 'gh-keychain',
          target: 'gh',
          subStep: 'keychain',
          reason: REASON,
          recordedAt: '2026-11-10T10:00:00.000Z',
        },
      ]);
      const acceptedRisks = accepted.body.acceptedRisks as Array<{ reason: string }>;
      expect(acceptedRisks[0]?.reason).toBe(REASON);
      // The gh row keeps its measured result.
      const probe = (accepted.body.report as { probe: Array<{ id: string; result: string }> })
        .probe;
      expect(probe.find((row) => row.id === 'gh')?.result).toBe('reachable');

      expect(revokeAcceptedRisk(home, 'gh-keychain')).toBe(true);
      const revoked = await doctor();
      expect(revoked.body.verdict).toBe('fail');
      expect(revoked.body.acceptedRisks).toEqual([]);
    });

    it('fails a Keychain-only gh reach when no record exists', async () => {
      write(report({ keychainOnlyGh: true }));
      const answer = await doctor();
      expect(answer.body.verdict).toBe('fail');
      expect(answer.body.acceptedRisks).toEqual([]);
    });

    it('fails a report checked before the risk was recorded', async () => {
      writeAcceptedRisk(home, { reason: REASON });
      write(report({ keychainOnlyGh: true }));
      const answer = await doctor();
      expect(answer.body.verdict).toBe('fail');
      expect(answer.body.acceptedRisks).toEqual([]);
      revokeAcceptedRisk(home, 'gh-keychain');
    });

    it('serves no POST on the doctor route and writes no record', async () => {
      rmSync(recordFile(), { force: true });
      const res = await app().request(`http://${HOST}/api/hosts/${hostId}/doctor`, {
        method: 'POST',
        headers: {
          host: HOST,
          cookie,
          origin: `http://${HOST}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ risk: 'gh-keychain', reason: 'from the console' }),
      });
      expect([404, 405]).toContain(res.status);
      expect(existsSync(recordFile())).toBe(false);
    });
  });
});

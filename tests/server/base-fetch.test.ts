// The base fetcher's state and the changes route's `base` field (host-planning: Base branch read
// from the remote; A failed fetch never stops work): over a bare remote and the owner's clone of
// it, with the fetch itself failing on demand.
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectFramework } from '../../src/compose.ts';
import {
  BaseFetcher,
  type BaseFetchState,
  fetchBaseBranch,
} from '../../src/core/git/base-fetch.ts';
import { registerHost } from '../../src/core/host/registry.ts';
import { mintLoginCode } from '../../src/core/security/login.ts';
import { hostRegistryStore, openStore, type Store } from '../../src/core/store/db.ts';
import { EventBus } from '../../src/core/store/events.ts';
import { createApp } from '../../src/server/app.ts';
import { createHostRuntimes, type HostRuntimes } from '../../src/server/hosts.ts';
import { materializeFixtureRepo, SYNTHETIC, SYNTHETIC_FILES } from '../helpers/fixture-repo.ts';
import {
  commitAll,
  gitIn,
  makeScratchDir,
  removeScratchDirs,
  writeFileIn,
} from '../helpers/scratch.ts';

const PORT = 4994;
const HOST = `127.0.0.1:${PORT}`;
const UNREACHABLE = 'Could not resolve host: github.com';

interface BaseFacts {
  ref: string;
  remote: string | null;
  localOnly: boolean;
  fetchedAt: number | null;
  error: string | null;
  failedAt: number | null;
  localAhead: number;
}

interface ChangesBody {
  tip: string;
  base: BaseFacts;
  changes: Array<{ id: string }>;
}

let db: Store;
let runtimes: HostRuntimes;
let fetcher: BaseFetcher;
let cookie = '';
let uiDir = '';
let failing = false;
let clock = 1_000;
const announced: Array<{ hostId: string; state: BaseFetchState }> = [];
const logged: string[] = [];

function app() {
  return createApp({
    store: db,
    port: PORT,
    uiDir,
    bus: new EventBus(),
    runtimes,
    baseFetch: (hostId) => fetcher.state(hostId),
  });
}

async function changes(hostId: string): Promise<ChangesBody> {
  const res = await app().request(`http://${HOST}/api/hosts/${hostId}/changes`, {
    headers: { host: HOST, cookie },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as ChangesBody;
}

/** A bare remote holding the synthetic host, and the owner's clone of it, registered. */
async function clonedHost() {
  const upstream = await materializeFixtureRepo('synthetic');
  const dir = makeScratchDir('remote');
  const remote = join(dir, 'remote.git');
  await gitIn(dir, ['clone', '-q', '--bare', upstream.root, remote]);
  const owner = join(makeScratchDir('owner'), 'clone');
  await gitIn(dir, ['clone', '-q', remote, owner]);
  await gitIn(owner, ['config', 'user.name', 'Owner']);
  await gitIn(owner, ['config', 'user.email', 'owner@counterpoint.invalid']);
  await gitIn(owner, ['config', 'commit.gpgsign', 'false']);
  const host = await registerHost(hostRegistryStore(db), {
    cwd: owner,
    base: 'master',
    detectFramework,
  });
  return { remote, owner, host: { id: host.id, root: host.root, baseBranch: 'master' } };
}

/** Pushes a new commit to the bare remote from another clone, as a merge on GitHub would. */
async function pushToRemote(remote: string, file: string): Promise<string> {
  const other = join(makeScratchDir('other'), 'clone');
  await gitIn(makeScratchDir('x'), ['clone', '-q', remote, other]);
  await gitIn(other, ['config', 'user.name', 'Someone']);
  await gitIn(other, ['config', 'user.email', 'someone@counterpoint.invalid']);
  writeFileIn(other, file, 'merged on GitHub\n');
  const commit = await commitAll(other, `add ${file}`);
  await gitIn(other, ['push', '-q', 'origin', 'master']);
  return commit;
}

beforeAll(async () => {
  db = openStore(makeScratchDir('base-fetch-home'));
  uiDir = makeScratchDir('base-fetch-ui');
  writeFileIn(uiDir, 'index.html', '<!doctype html><title>Counterpoint</title>');
  runtimes = createHostRuntimes({ store: db });
  fetcher = new BaseFetcher({
    ownerEnv: async () => ({}),
    now: () => clock,
    onChange: (hostId, state) => announced.push({ hostId, state }),
    log: (event) => logged.push(event),
    fetchBaseBranch: async (input) => {
      if (failing) throw new Error(UNREACHABLE);
      await fetchBaseBranch(input);
    },
  });
  const code = mintLoginCode(db);
  const login = await app().request(`http://${HOST}/login?code=${code}`, {
    headers: { host: HOST },
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  expect(cookie).toMatch(/^cp_session=/);
});

afterAll(() => {
  fetcher?.stop();
  db?.close();
  removeScratchDirs();
});

describe('a fetch that fails, then works again', () => {
  it('shows why while it fails, keeps the base as last fetched, and drops the note once a fetch works', async () => {
    const { remote, host } = await clonedHost();
    const seen = () => announced.filter((entry) => entry.hostId === host.id).length;

    failing = false;
    clock = 1_000;
    const first = await fetcher.fetch(host);
    expect(first).toEqual({
      label: 'origin/master',
      remote: 'origin',
      localOnly: false,
      fetchedAt: 1_000,
      error: null,
      failedAt: null,
      localAhead: 0,
    });
    const before = await changes(host.id);

    failing = true;
    clock = 2_000;
    const failed = await fetcher.fetch(host);
    expect(failed).toMatchObject({ fetchedAt: 1_000, error: UNREACHABLE, failedAt: 2_000 });
    expect(seen()).toBe(1);
    const whileFailing = await changes(host.id);
    expect(whileFailing.tip).toBe(before.tip);
    expect(whileFailing.base).toMatchObject({
      ref: 'origin/master',
      fetchedAt: 1_000,
      error: UNREACHABLE,
      failedAt: 2_000,
    });

    // The same failure again is not announced again.
    clock = 3_000;
    await fetcher.fetch(host);
    expect(seen()).toBe(1);

    const merged = await pushToRemote(remote, 'merged.txt');
    failing = false;
    clock = 4_000;
    const recovered = await fetcher.fetch(host);
    expect(recovered).toMatchObject({ fetchedAt: 4_000, error: null, failedAt: null });
    expect(seen()).toBe(2);
    expect(logged).toContain('base-fetch-recovered');
    const after = await changes(host.id);
    expect(after.tip).toBe(merged);
    expect(after.base).toMatchObject({ fetchedAt: 4_000, error: null, failedAt: null });
  });
});

describe('an unpushed commit on the local base branch', () => {
  it('is not listed, and the base says how many local commits are not on the remote', async () => {
    const { owner, host } = await clonedHost();
    const prefix = `openspec/changes/${SYNTHETIC.ready}/`;
    for (const [path, content] of Object.entries(SYNTHETIC_FILES)) {
      if (path.startsWith(prefix)) {
        writeFileIn(owner, `openspec/changes/unpushed-thing/${path.slice(prefix.length)}`, content);
      }
    }
    await commitAll(owner, 'add unpushed-thing, not pushed');

    failing = false;
    const state = await fetcher.fetch(host);
    expect(state).toMatchObject({ label: 'origin/master', localOnly: false, localAhead: 1 });
    expect(announced.filter((entry) => entry.hostId === host.id)).toHaveLength(1);
    const body = await changes(host.id);
    expect(body.base).toMatchObject({ ref: 'origin/master', localOnly: false, localAhead: 1 });
    const ids = body.changes.map((change) => change.id);
    expect(ids).toContain(SYNTHETIC.ready);
    expect(ids).not.toContain('unpushed-thing');

    // Once pushed and fetched, it is listed and the note goes away.
    await gitIn(owner, ['push', '-q', 'origin', 'master']);
    expect(await fetcher.fetch(host)).toMatchObject({ localAhead: 0 });
    const pushed = await changes(host.id);
    expect(pushed.base.localAhead).toBe(0);
    expect(pushed.changes.map((change) => change.id)).toContain('unpushed-thing');
  });
});

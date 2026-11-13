// Local previews on demand (pull-requests: Preview link; owner decision 2026-11-11): the host
// config's preview command, run under srt in the change's worktree on a free loopback port.
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createOpenSpecAdapter } from '../../src/adapters/openspec/index.ts';
import { LocalPreviews, type PreviewStatus } from '../../src/build/local-preview.ts';
import type { RunHost } from '../../src/build/orchestrator.ts';
import { worktreePathFor } from '../../src/build/worktrees.ts';
import { createGitFileReader } from '../../src/core/git/reader.ts';
import { runGit } from '../../src/core/git/run.ts';
import { openStore, upsertHost } from '../../src/core/store/db.ts';
import { insertRun, insertRunChange, updateRunChange } from '../../src/core/store/runs.ts';
import { materializeOpenSpecHost } from '../helpers/fixture-repo.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

const cleanup: string[] = [];
afterAll(async () => {
  removeScratchDirs();
  const { rmSync } = await import('node:fs');
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const SERVER = `import http from 'node:http';
const port = Number(process.argv[2]);
http.createServer((_q, r) => r.end('preview of a-thing')).listen(port, '127.0.0.1');
`;

async function setup(config: string, state: 'green' | 'building' = 'green') {
  const repo = await materializeOpenSpecHost({
    'openspec/config.yaml': 'schema: spec-driven\n',
    '.counterpoint/config.yaml': config,
    'server.mjs': SERVER,
  });
  cleanup.push(`${repo.root}-worktrees`);
  const worktree = worktreePathFor(repo.root, 'a-thing');
  await runGit(repo.root, ['worktree', 'add', '-b', 'cp/a-thing', worktree, repo.commit]);
  const home = makeScratchDir('cp-preview');
  const db = openStore(home);
  const host = {
    id: 'cena',
    root: repo.root,
    gitCommonDir: join(repo.root, '.git'),
    baseBranch: 'master',
  };
  upsertHost(db, { ...host, adapter: 'openspec' });
  insertRun(db, { id: 'run-1', hostId: 'cena', settings: {}, stopAt: null });
  const id = insertRunChange(db, { runId: 'run-1', change: 'a-thing', position: 0 });
  updateRunChange(db, id, { state, worktree, baseCommit: repo.commit, branch: 'cp/a-thing' });
  const runtime: RunHost = {
    host,
    reader: createGitFileReader(repo.root),
    adapter: createOpenSpecAdapter(),
  };
  const events: Array<Record<string, unknown>> = [];
  const previews = new LocalPreviews({
    home,
    db,
    host: (hostId) => (hostId === 'cena' ? runtime : null),
    consolePort: 4170,
    publish: (_host, payload) => events.push(payload),
  });
  return { previews, events };
}

async function until(read: () => PreviewStatus, done: (s: PreviewStatus) => boolean, ms = 30_000) {
  const end = Date.now() + ms;
  while (!done(read())) {
    if (Date.now() > end) throw new Error(`still ${read().state}: ${read().tail}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return read();
}

const PREVIEW_CONFIG = "preview:\n  command: [node, server.mjs, '{port}']\n";

describe('LocalPreviews refusals', () => {
  it('previews only a built change with a preview command, and not while it builds', async () => {
    const { previews } = await setup(PREVIEW_CONFIG);
    await expect(previews.start('cena', 'other-thing')).resolves.toMatchObject({
      ok: false,
      status: 404,
    });
    await expect(previews.start('nope', 'a-thing')).resolves.toMatchObject({
      ok: false,
      status: 404,
    });
    const building = await setup(PREVIEW_CONFIG, 'building');
    await expect(building.previews.start('cena', 'a-thing')).resolves.toMatchObject({
      ok: false,
      status: 409,
    });
    const none = await setup('gates: []\n');
    await expect(none.previews.start('cena', 'a-thing')).resolves.toMatchObject({
      ok: false,
      status: 422,
      error: "The host's Counterpoint config names no preview command.",
    });
    expect(previews.status('cena', 'a-thing').state).toBe('stopped');
  });
});

describe.skipIf(process.platform !== 'darwin')('LocalPreviews (live srt)', () => {
  it('starts the preview sandboxed on a free loopback port, serves it, and stops it', async () => {
    const { previews, events } = await setup(PREVIEW_CONFIG);
    const started = await previews.start('cena', 'a-thing');
    if (!started.ok) throw new Error(started.error);
    expect(started.status.state).toBe('starting');
    expect(started.status.port).toBeGreaterThanOrEqual(4174);
    const running = await until(
      () => previews.status('cena', 'a-thing'),
      (s) => s.state !== 'starting',
    );
    expect(running.state).toBe('running');
    const page = await fetch(running.url as string);
    expect(await page.text()).toBe('preview of a-thing');
    // Starting again while it runs changes nothing.
    await expect(previews.start('cena', 'a-thing')).resolves.toMatchObject({
      ok: true,
      status: { port: running.port },
    });

    expect(previews.stop('cena', 'a-thing')).toBe(true);
    const stopped = await until(
      () => previews.status('cena', 'a-thing'),
      (s) => s.state !== 'running',
    );
    expect(stopped.state).toBe('stopped');
    await expect(fetch(running.url as string)).rejects.toThrow();
    expect(events.map((e) => e.state)).toEqual(['starting', 'running', 'stopped']);
  }, 60_000);

  it('reports a preview that exits on its own, with its last lines', async () => {
    const { previews } = await setup(
      'preview:\n  command: [node, -e, "console.log(\'no port {port}\'); process.exit(3)"]\n',
    );
    const started = await previews.start('cena', 'a-thing');
    if (!started.ok) throw new Error(started.error);
    const exited = await until(
      () => previews.status('cena', 'a-thing'),
      (s) => s.state !== 'starting',
    );
    expect(exited).toMatchObject({ state: 'exited', reason: 'The preview exited with code 3.' });
    expect(exited.tail).toContain('no port');
  }, 60_000);
});

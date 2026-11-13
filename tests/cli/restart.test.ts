// Self-restart into a new install (owner-inbox 5.2, D-10), with real daemons: an install between
// runs restarts the daemon on its own and the console stays signed in; a crash restart still signs
// every browser out. The "install" is a copy of the package the daemon runs from; changing its
// package.json is a new install.
import { cpSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openStoreReadOnly } from '../../src/core/store/db.ts';
import {
  commitAll,
  initScratchRepo,
  makeScratchDir,
  removeScratchDirs,
  writeFileIn,
} from '../helpers/scratch.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LINK_RE = /Sign-in link \(works once\): (http:\/\/127\.0\.0\.1:(\d+)\/login\?code=\S+)/;

let install = '';
let home = '';
let repo = '';

async function cli(args: readonly string[]) {
  const env: Record<string, string> = { COUNTERPOINT_HOME: home };
  for (const key of ['PATH', 'HOME', 'LANG', 'TMPDIR'] as const) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return execa(process.execPath, [join(install, 'src', 'cli', 'main.ts'), ...args], {
    cwd: repo,
    env,
    extendEnv: false,
    reject: false,
    stdin: 'ignore',
    timeout: 30_000,
  });
}

function get(port: number, path: string, cookie?: string) {
  return new Promise<{ status: number; setCookie: string[] }>((done, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        agent: false,
        headers: { host: `127.0.0.1:${port}`, ...(cookie === undefined ? {} : { cookie }) },
      },
      (res) => {
        res.resume();
        res.on('end', () =>
          done({ status: res.statusCode ?? 0, setCookie: res.headers['set-cookie'] ?? [] }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const daemonPid = (): number | null => {
  try {
    const info = JSON.parse(readFileSync(join(home, 'run', 'daemon.json'), 'utf8')) as {
      pid?: unknown;
    };
    return typeof info.pid === 'number' ? info.pid : null;
  } catch {
    return null;
  }
};

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until<T>(probe: () => Promise<T | null> | T | null, ms: number): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 250));
  }
}

beforeAll(async () => {
  install = makeScratchDir('install');
  cpSync(join(REPO_ROOT, 'src'), join(install, 'src'), { recursive: true });
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(install, 'node_modules'));
  writeFileSync(
    join(install, 'package.json'),
    JSON.stringify({ name: '@hkp/counterpoint', version: '0.1.0', type: 'module' }),
  );
  home = makeScratchDir('rhome');
  repo = makeScratchDir('rrepo');
  await initScratchRepo(repo);
  writeFileIn(repo, 'README.md', '# scratch host\n');
  await commitAll(repo, 'initial');
});

afterAll(async () => {
  await cli(['stop']);
  removeScratchDirs();
});

describe('self-restart into a new install', () => {
  let port = 0;
  let cookie = '';

  it('restarts on its own between runs and keeps the console signed in', async () => {
    const started = await cli(['--port', '0', '--no-open']);
    expect(started.exitCode).toBe(0);
    const match = LINK_RE.exec(String(started.stdout));
    port = Number(match?.[2]);
    const signIn = await get(
      port,
      new URL(match?.[1] ?? '').pathname + new URL(match?.[1] ?? '').search,
    );
    cookie = (signIn.setCookie[0] ?? '').split(';')[0] ?? '';
    expect((await get(port, '/api/hosts', cookie)).status).toBe(200);
    const before = daemonPid() as number;

    writeFileSync(
      join(install, 'package.json'),
      JSON.stringify({ name: '@hkp/counterpoint', version: '0.1.1', type: 'module' }),
    );
    const after = await until(() => {
      const pid = daemonPid();
      return pid !== null && pid !== before ? pid : null;
    }, 45_000);
    await until(async () => {
      const res = await get(port, '/api/hosts', cookie).catch(() => null);
      return res?.status === 200 ? true : null;
    }, 15_000);

    expect(alive(before)).toBe(false);
    expect(alive(after)).toBe(true);
    const store = openStoreReadOnly(home);
    const texts = store
      .prepare('SELECT text FROM done_for_you')
      .all()
      .map((row) => String(row.text));
    store.close();
    expect(texts).toContain('Restarted into the new install (Counterpoint 0.1.1).');
  }, 90_000);

  it('a crash restart keeps the console signed in', async () => {
    const pid = daemonPid() as number;
    process.kill(pid, 'SIGKILL');
    await until(() => (alive(pid) ? null : true), 10_000);
    expect((await cli(['--port', String(port), '--no-open'])).exitCode).toBe(0);
    expect((await get(port, '/api/hosts', cookie)).status).toBe(200);
  }, 60_000);
});

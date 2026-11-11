/// <reference lib="dom" />
// (playwright-core's published types name DOM element types.)
//
// Walking skeleton: `counterpoint` in a git repo starts one background daemon, which registers
// the repo as a host in SQLite and serves the Astryx console on 127.0.0.1 showing that host.
import { existsSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer, type Server } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { type Browser, chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hostIdFromName } from '../../src/core/ids.ts';
import {
  commitAll,
  initScratchRepo,
  makeScratchDir,
  removeScratchDirs,
  writeFileIn,
} from '../helpers/scratch.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(REPO_ROOT, 'src', 'cli', 'main.ts');
const CHROME =
  process.env.CP_CHROME_PATH ??
  '/Volumes/Dock/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function cli(args: readonly string[], home: string, cwd: string): Promise<CliResult> {
  const env: Record<string, string> = { COUNTERPOINT_HOME: home };
  for (const key of ['PATH', 'HOME', 'LANG', 'TMPDIR'] as const) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  const result = await execa(process.execPath, [CLI, ...args], {
    cwd,
    env,
    extendEnv: false,
    reject: false,
    stdin: 'ignore',
    timeout: 30_000,
  });
  return {
    exitCode: result.exitCode ?? -1,
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
}

const LINK_RE =
  /^Sign-in link \(works once\): (http:\/\/127\.0\.0\.1:\d+\/login\?code=[A-Za-z0-9_-]{43})$/m;

function signInLink(stdout: string): string {
  const link = LINK_RE.exec(stdout)?.[1];
  if (link === undefined) throw new Error(`no sign-in link in: ${stdout}`);
  return link;
}

/** Follows a one-time sign-in link without a browser and returns the `cp_session=…` pair. */
async function sessionCookie(link: string): Promise<string> {
  const res = await fetch(link, { redirect: 'manual' });
  expect(res.status).toBe(302);
  const pair = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  expect(pair).toMatch(/^cp_session=/);
  return pair;
}

function httpGet(port: number, path: string, hostHeader: string, cookie?: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const headers: Record<string, string> = { host: hostHeader };
    if (cookie !== undefined) headers.cookie = cookie;
    const req = request(
      { host: '127.0.0.1', port, path, method: 'GET', agent: false, headers },
      (res) => {
        res.resume();
        res.on('end', () => resolvePromise(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function listenOnFreePort(): Promise<{ server: Server; port: number }> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address !== null && typeof address === 'object') {
        resolvePromise({ server, port: address.port });
      } else reject(new Error('no address'));
    });
  });
}

describe('walking skeleton: counterpoint → daemon → SQLite → HTTP → Astryx page', () => {
  let home: string;
  let otherHome: string;
  let repo: string;
  let port = 0;
  let cookie = '';
  let browser: Browser | undefined;

  beforeAll(async () => {
    home = makeScratchDir('home');
    otherHome = makeScratchDir('home');
    repo = makeScratchDir('repo');
    await initScratchRepo(repo);
    writeFileIn(repo, 'README.md', '# scratch host\n');
    await commitAll(repo, 'initial');
  });

  afterAll(async () => {
    await browser?.close();
    for (const h of [home, otherHome]) {
      if (h !== undefined) await cli(['stop'], h, repo ?? REPO_ROOT);
    }
    removeScratchDirs();
  });

  it('starts one background daemon, registers the repo and prints the console URL', async () => {
    const result = await cli(['--port', '0', '--no-open'], home, repo);
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    const match = /Counterpoint is running at http:\/\/127\.0\.0\.1:(\d+)\//.exec(result.stdout);
    expect(match).not.toBeNull();
    port = Number(match?.[1]);
    expect(port).toBeGreaterThan(0);

    // The console API needs a session: sign in through the printed one-time link first.
    expect((await fetch(`http://127.0.0.1:${port}/api/hosts`)).status).toBe(401);
    cookie = await sessionCookie(signInLink(result.stdout));
    const res = await fetch(`http://127.0.0.1:${port}/api/hosts`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hosts: { id: string; name: string; root: string }[] };
    expect(body.hosts).toHaveLength(1);
    expect(body.hosts[0]?.name).toBe(basename(repo));
    expect(body.hosts[0]?.root).toBe(repo);
  });

  it('serves the Astryx console, which shows the registered host', async () => {
    const opened = await cli(['open', '--no-open'], home, repo);
    expect(opened.exitCode).toBe(0);
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const page = await browser.newPage();
    await page.goto(signInLink(opened.stdout));
    expect(new URL(page.url()).pathname).toBe(`/h/${hostIdFromName(basename(repo))}`);
    // The TopNav host switcher names the registered host (and its base branch).
    const switcher = page.getByRole('button', { name: `Project ${basename(repo)}, base branch` });
    await switcher.waitFor({ timeout: 15_000 });
    expect(await switcher.textContent()).toContain(basename(repo));
    // The page title is a visual h2 announced as level 1; Playwright's role
    // engine reports the native tag level, so the announced level is read from aria-level.
    const heading = page.getByRole('heading', { name: 'Mission' });
    await heading.waitFor({ timeout: 15_000 });
    expect(await heading.getAttribute('aria-level')).toBe('1');
  });

  it('answers 403 to a Host header other than 127.0.0.1:{port}', async () => {
    expect(await httpGet(port, '/api/hosts', `127.0.0.1:${port}`, cookie)).toBe(200);
    expect(await httpGet(port, '/api/hosts', `localhost:${port}`)).toBe(403);
    expect(await httpGet(port, '/', `evil.example:${port}`)).toBe(403);
  });

  it('does not start a second daemon while one runs', async () => {
    const before = JSON.parse(readFileSync(join(home, 'run', 'daemon.json'), 'utf8')) as {
      pid: number;
    };
    const result = await cli(['--port', '0', '--no-open'], home, repo);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Counterpoint is already running at http://127.0.0.1:${port}/`);
    const after = JSON.parse(readFileSync(join(home, 'run', 'daemon.json'), 'utf8')) as {
      pid: number;
    };
    expect(after.pid).toBe(before.pid);
  });

  it('refuses a missing home and creates nothing', async () => {
    const missing = join(makeScratchDir('gone'), 'no-such-home');
    const result = await cli(['--port', '0', '--no-open'], missing, repo);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      `Counterpoint home "${missing}" does not exist. If it is on the Dock volume, is it mounted? Nothing was created.`,
    );
    expect(existsSync(missing)).toBe(false);
  });

  it('refuses a port that is already in use', async () => {
    const { server, port: taken } = await listenOnFreePort();
    try {
      const result = await cli(['--port', String(taken), '--no-open'], otherHome, repo);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        `Port ${taken} is already in use. Free it, or choose a different port in the Counterpoint config.`,
      );
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it('stops the daemon, and a second stop says it is not running', async () => {
    const first = await cli(['stop'], home, repo);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain(
      `Counterpoint stopped. The console at http://127.0.0.1:${port}/ is closed.`,
    );
    expect(existsSync(join(home, 'run', 'daemon.sock'))).toBe(false);

    const second = await cli(['stop'], home, repo);
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain('Counterpoint is not running.');
  });
});

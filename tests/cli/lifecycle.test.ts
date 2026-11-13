// The lifecycle commands around the daemon: init, status, open, and the sign-in link that start
// prints. Drives the real CLI with scratch homes; never opens a browser.
import { existsSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hostIdFromName } from '../../src/core/ids.ts';
import { openStoreReadOnly } from '../../src/core/store/db.ts';
import {
  commitAll,
  initScratchRepo,
  makeScratchDir,
  removeScratchDirs,
  writeFileIn,
} from '../helpers/scratch.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(REPO_ROOT, 'src', 'cli', 'main.ts');
const LINK_RE =
  /^Sign-in link \(works once\): (http:\/\/127\.0\.0\.1:(\d+)\/login\?code=[A-Za-z0-9_-]{43})$/m;

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

interface RawResponse {
  status: number;
  location: string | undefined;
  setCookie: string[];
}

function rawGet(url: string): Promise<RawResponse> {
  const target = new URL(url);
  return new Promise((done, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: Number(target.port),
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        agent: false,
        headers: { host: target.host },
      },
      (res) => {
        res.resume();
        res.on('end', () =>
          done({
            status: res.statusCode ?? 0,
            location: res.headers.location,
            setCookie: res.headers['set-cookie'] ?? [],
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const started: { home: string; cwd: string }[] = [];

afterAll(async () => {
  for (const { home, cwd } of started) await cli(['stop'], home, cwd);
  removeScratchDirs();
});

describe('counterpoint init', () => {
  it('refuses when the parent folder is missing and creates nothing', async () => {
    // Short names: the socket path under the home must fit macOS's 103 bytes in a deep checkout.
    const parent = join(makeScratchDir('i'), 'np');
    const home = join(parent, 'h');
    const result = await cli(['init'], home, REPO_ROOT);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      `The parent folder "${parent}" does not exist. Nothing was created.`,
    );
    expect(existsSync(parent)).toBe(false);
  });

  it('creates only the final home directory with mode 0700', async () => {
    const home = join(makeScratchDir('init'), 'home');
    const result = await cli(['init'], home, REPO_ROOT);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(home);
    const stat = statSync(home);
    expect(stat.isDirectory()).toBe(true);
    expect(stat.mode & 0o777).toBe(0o700);
  });

  it('says the home is ready when it already exists', async () => {
    const home = makeScratchDir('init');
    const result = await cli(['init'], home, REPO_ROOT);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Counterpoint home is ready at "${home}".`);
  });
});

describe('counterpoint status, open and the sign-in link', () => {
  let home: string;
  let repo: string;
  let port = 0;
  let firstLink = '';

  beforeAll(async () => {
    home = makeScratchDir('home');
    repo = makeScratchDir('repo');
    await initScratchRepo(repo);
    writeFileIn(repo, 'README.md', '# scratch host\n');
    await commitAll(repo, 'initial');
  });

  it('status prints "not running" when no daemon runs', async () => {
    const result = await cli(['status'], home, repo);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('not running');
  });

  it('open refuses when no daemon runs', async () => {
    const result = await cli(['open', '--no-open'], home, repo);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Counterpoint is not running. Start it with "counterpoint".');
  });

  it('start prints the console URL and then a one-time sign-in link', async () => {
    const result = await cli(['--port', '0', '--no-open'], home, repo);
    started.push({ home, cwd: repo });
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.trim().split('\n');
    expect(lines[0]).toMatch(/^Counterpoint is running at http:\/\/127\.0\.0\.1:\d+\/$/);
    const match = LINK_RE.exec(result.stdout);
    expect(match).not.toBeNull();
    firstLink = match?.[1] ?? '';
    port = Number(match?.[2]);
    expect(lines[0]).toBe(`Counterpoint is running at http://127.0.0.1:${port}/`);
  });

  it('status prints one line per host with its port, runway and needs-you count', async () => {
    const result = await cli(['status'], home, repo);
    expect(result.exitCode).toBe(0);
    // Nothing is approved in this repository, so its runway is 0. The one card is the one-time
    // setup of the ask tool for the owner's own Claude Code sessions.
    expect(result.stdout.trim()).toBe(
      `${hostIdFromName(basename(repo))}  running on 127.0.0.1:${port}  runway 0  needs you 1`,
    );
  });

  it('a second start prints "already running" and a fresh link', async () => {
    const result = await cli(['--port', '0', '--no-open'], home, repo);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Counterpoint is already running at http://127.0.0.1:${port}/`);
    const match = LINK_RE.exec(result.stdout);
    expect(match?.[1]).toBeDefined();
    expect(match?.[1]).not.toBe(firstLink);
  });

  it('open prints a link that signs the browser in once', async () => {
    const result = await cli(['open', '--no-open'], home, repo);
    expect(result.exitCode).toBe(0);
    const match = LINK_RE.exec(result.stdout);
    expect(match).not.toBeNull();
    const link = match?.[1] ?? '';

    const first = await rawGet(link);
    expect(first.status).toBe(302);
    expect(first.location).toBe(`/h/${hostIdFromName(basename(repo))}`);
    expect(first.setCookie).toHaveLength(1);
    expect(first.setCookie[0]).toMatch(
      /^cp_session=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=43200$/,
    );

    const second = await rawGet(link);
    expect(second.status).toBe(302);
    expect(second.location).toBe('/signed-out?reason=used');
    expect(second.setCookie).toHaveLength(0);
  });

  it('a link minted by start is still usable after open minted another', async () => {
    const res = await rawGet(firstLink);
    expect(res.status).toBe(302);
    expect(res.location).toBe(`/h/${hostIdFromName(basename(repo))}`);
  });

  it('stop then status prints "not running"', async () => {
    expect((await cli(['stop'], home, repo)).exitCode).toBe(0);
    const result = await cli(['status'], home, repo);
    expect(result.stdout.trim()).toBe('not running');
  });

  it('a restarted daemon has signed every browser out', async () => {
    const before = openStoreReadOnly(home);
    const sessionsBefore = Number(before.prepare('SELECT COUNT(*) AS n FROM sessions').get()?.n);
    before.close();
    expect(sessionsBefore).toBeGreaterThan(0);

    const result = await cli(['--port', '0', '--no-open'], home, repo);
    expect(result.exitCode).toBe(0);

    const after = openStoreReadOnly(home);
    const sessionsAfter = Number(after.prepare('SELECT COUNT(*) AS n FROM sessions').get()?.n);
    after.close();
    expect(sessionsAfter).toBe(0);
  });
});

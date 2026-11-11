/// <reference lib="dom" />
// (playwright-core's published types name DOM element types.)
//
// The console shell in a real browser against the real daemon: sign-in through the
// printed one-time link, the AppShell chrome, Light/Dark/System with the first-paint script under
// the strict CSP, the mobile drawer, the signed-out variants, and the live stream: an event
// invalidates the host list, a stopped daemon pauses live updates, a restarted one signs out.
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { controlRequest } from '../../src/cli/control-client.ts';
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

const DESKTOP = { width: 1280, height: 800 };
const NOT_SIGNED_IN = "This browser isn't signed in";

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

const htmlTheme = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute('data-theme'));

const isApiHosts = (url: string) => new URL(url).pathname === '/api/hosts';

describe('console shell: sign-in, theme, live updates', () => {
  let home: string;
  let repo: string;
  let port = 0;
  let origin = '';
  let link = '';
  let hostId = '';
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  const consoleLines: string[] = [];

  beforeAll(async () => {
    home = makeScratchDir('home');
    repo = makeScratchDir('repo');
    await initScratchRepo(repo, { branch: 'master' });
    writeFileIn(repo, 'README.md', '# scratch host\n');
    await commitAll(repo, 'initial');
    hostId = hostIdFromName(basename(repo));

    const started = await cli(['--port', '0', '--no-open'], home, repo);
    expect(started.stderr).toBe('');
    expect(started.exitCode).toBe(0);
    port = Number(
      /Counterpoint is running at http:\/\/127\.0\.0\.1:(\d+)\//.exec(started.stdout)?.[1],
    );
    expect(port).toBeGreaterThan(0);
    origin = `http://127.0.0.1:${port}`;
    link = signInLink(started.stdout);

    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    context = await browser.newContext({ colorScheme: 'light', viewport: DESKTOP });
    page = await context.newPage();
    page.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
    page.on('pageerror', (error) => consoleLines.push(`pageerror: ${error.message}`));
  });

  afterAll(async () => {
    await browser?.close();
    if (home !== undefined) await cli(['stop'], home, repo ?? REPO_ROOT);
    removeScratchDirs();
  });

  it('signs in through the printed link and shows the AppShell chrome for the host', async () => {
    const stream = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/events');
    await page.goto(link);
    const landed = new URL(page.url());
    expect(landed.pathname).toBe(`/h/${hostId}`);
    // The SPA never holds the sign-in code: the server consumed it and redirected.
    expect(landed.search).toBe('');

    const switcher = page.getByRole('button', {
      name: `Project ${basename(repo)}, base branch master`,
    });
    await switcher.waitFor({ timeout: 15_000 });
    const label = (await switcher.textContent()) ?? '';
    expect(label).toContain(basename(repo));
    expect(label).toContain('master');

    expect(await page.getByRole('navigation', { name: 'Counterpoint' }).count()).toBe(1);
    expect(await page.getByRole('navigation', { name: 'Main' }).count()).toBe(1);
    const mission = page.getByRole('heading', { name: 'Mission' });
    await mission.waitFor();
    expect(await mission.getAttribute('aria-level')).toBe('1');
    expect(await page.title()).toBe('Mission · Counterpoint');
    expect((await stream).status()).toBe(200);
  });

  it('reports live updates connected and refetches only when an event arrives', async () => {
    await page.getByRole('img', { name: 'Live updates connected' }).waitFor({ timeout: 10_000 });

    const hostRequests: string[] = [];
    page.on('request', (req) => {
      if (isApiHosts(req.url())) hostRequests.push(req.url());
    });
    // Nothing changed, so nothing is fetched: the console never polls.
    await page.waitForTimeout(2_000);
    expect(hostRequests).toHaveLength(0);

    // A `host` event on the stream invalidates the host list, which refetches once. The event is
    // re-sent until seen, in case the stream subscribed a moment after its headers arrived.
    const refetched = page.waitForRequest((req) => isApiHosts(req.url()), { timeout: 15_000 });
    let seen = false;
    void refetched.then(() => {
      seen = true;
    });
    for (let attempt = 0; attempt < 5 && !seen; attempt += 1) {
      const res = await controlRequest(home, 'POST', '/control/notify', { hostId, family: 'host' });
      expect(res.status).toBe(202);
      await Promise.race([refetched, page.waitForTimeout(2_000)]);
    }
    await refetched;
    expect(hostRequests.length).toBeGreaterThanOrEqual(1);
  });

  it('switches to Dark from the theme menu; the choice persists and applies before first paint', async () => {
    expect(await htmlTheme(page)).toBe('light');
    const themeButton = page.getByRole('button', { name: 'Theme' });
    await themeButton.click();
    await page.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect.poll(() => htmlTheme(page)).toBe('dark');
    expect(await page.evaluate(() => localStorage.getItem('counterpoint.theme'))).toBe('dark');

    await page.reload();
    await page.getByRole('heading', { name: 'Mission' }).waitFor({ timeout: 15_000 });
    expect(await htmlTheme(page)).toBe('dark');

    // First paint: with the app bundle blocked only /theme-init.js runs, and it applies Dark.
    const bare = await context.newPage();
    await bare.route('**/assets/**', (route) => route.abort());
    await bare.goto(`${origin}/signed-out`);
    expect(await htmlTheme(bare)).toBe('dark');
    await bare.close();
  });

  it('follows the system setting live in System mode', async () => {
    await page.getByRole('button', { name: 'Theme' }).click();
    await page.getByRole('menuitemradio', { name: 'System' }).click();
    await expect.poll(() => htmlTheme(page)).toBe('light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => htmlTheme(page)).toBe('dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => htmlTheme(page)).toBe('light');
    expect(await page.evaluate(() => localStorage.getItem('counterpoint.theme'))).toBe('system');
  });

  it('reaches the navigation through the mobile drawer at 360px', async () => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.getByRole('dialog', { name: 'Navigation' });
    await drawer.getByRole('link', { name: 'Mission' }).waitFor({ timeout: 10_000 });
    expect(
      await drawer
        .getByRole('button', { name: `Project ${basename(repo)}, base branch master` })
        .count(),
    ).toBe(1);
    await page.getByRole('button', { name: 'Close navigation' }).click();
    await page.setViewportSize(DESKTOP);
  });

  it('raises no Content Security Policy violation', () => {
    const violations = consoleLines.filter((line) =>
      /Content Security Policy|Refused to (execute|load|apply)/i.test(line),
    );
    expect(violations).toEqual([]);
  });

  it('shows the used-link screen when the same sign-in link is opened again', async () => {
    const other = await browser.newContext({ viewport: DESKTOP });
    try {
      const reused = await other.newPage();
      await reused.goto(link);
      const url = new URL(reused.url());
      expect(`${url.pathname}${url.search}`).toBe('/signed-out?reason=used');
      await reused
        .getByRole('heading', { name: 'This sign-in link was already used' })
        .waitFor({ timeout: 10_000 });
      await reused
        .getByText('Sign-in links work once. Run "counterpoint open" for a new one.', {
          exact: true,
        })
        .waitFor();
      expect(await other.cookies()).toEqual([]);
    } finally {
      await other.close();
    }
  });

  it('sends a browser without a session to the not-signed-in screen', async () => {
    const other = await browser.newContext({ viewport: DESKTOP });
    try {
      const fresh = await other.newPage();
      await fresh.goto(`${origin}/h/${hostId}`);
      await fresh.waitForURL(
        (url) => url.pathname === '/signed-out' && url.searchParams.get('reason') === 'none',
        { timeout: 15_000 },
      );
      await fresh.getByRole('heading', { name: NOT_SIGNED_IN }).waitFor();
      await fresh
        .getByText('Run "counterpoint open" in a terminal to get a fresh sign-in link.', {
          exact: true,
        })
        .waitFor();
      expect(await fresh.getByText('counterpoint open', { exact: true }).count()).toBeGreaterThan(
        0,
      );
    } finally {
      await other.close();
    }
  });

  it('words the blocked reason from fixed copy and falls back for an unknown one', async () => {
    const other = await browser.newContext({ viewport: DESKTOP });
    try {
      const screen = await other.newPage();
      await screen.goto(`${origin}/signed-out?reason=blocked`);
      await screen.getByRole('heading', { name: 'Request blocked' }).waitFor({ timeout: 10_000 });
      await screen
        .getByText(
          'Counterpoint only accepts requests from its own console at 127.0.0.1. Open the console from the link "counterpoint open" prints.',
          { exact: true },
        )
        .waitFor();

      await screen.goto(`${origin}/signed-out?reason=%3Cb%3Ehello%3C%2Fb%3E`);
      await screen.getByRole('heading', { name: NOT_SIGNED_IN }).waitFor({ timeout: 10_000 });
      expect(await screen.getByText('hello').count()).toBe(0);
    } finally {
      await other.close();
    }
  });

  it('pauses live updates when the daemon stops, and signs out once it is back', async () => {
    const stopped = await cli(['stop'], home, repo);
    expect(stopped.exitCode).toBe(0);

    const main = page.getByRole('main');
    await main.getByText('Live updates paused', { exact: true }).waitFor({ timeout: 20_000 });
    await main
      .getByText('Reconnecting to Counterpoint. What you see may be out of date.')
      .waitFor();
    await page.getByRole('img', { name: 'Live updates reconnecting' }).waitFor();

    // Same port, so the open tab's origin is reachable again; a restart clears every session.
    const restarted = await cli(['--port', String(port), '--no-open'], home, repo);
    expect(restarted.exitCode).toBe(0);
    await page.waitForURL(
      (url) => url.pathname === '/signed-out' && url.searchParams.get('reason') === 'none',
      { timeout: 30_000 },
    );
    await page.getByRole('heading', { name: NOT_SIGNED_IN }).waitFor();
  });
});

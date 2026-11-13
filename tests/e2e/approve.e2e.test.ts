/// <reference lib="dom" />
// (playwright-core's published types name DOM element types.)
//
// Approving a change from the console end to end (approvals: Approve in one click; Withdraw in one
// click; runway: Runway is the Mission headline): the real daemon on a scratch copy of the
// synthetic host and a scratch home, driven by Chrome. One click on Approve puts the change on the
// runway, and an open Mission page moves from 0 to 1 without a reload; Withdraw takes it off
// again. An old Trust link lands on Mission.
//
// Nothing here touches the global git config, the real Counterpoint home or a real host repository.
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { type Browser, chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hostIdFromName } from '../../src/core/ids.ts';
import { type FixtureRepo, materializeFixtureRepo, SYNTHETIC } from '../helpers/fixture-repo.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(REPO_ROOT, 'src', 'cli', 'main.ts');
const CHROME =
  process.env.CP_CHROME_PATH ??
  '/Volumes/Dock/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const DESKTOP = { width: 1280, height: 900 };
const LINK_RE =
  /^Sign-in link \(works once\): (http:\/\/127\.0\.0\.1:\d+\/login\?code=[A-Za-z0-9_-]{43})$/m;

function cliEnv(home: string): Record<string, string> {
  const env: Record<string, string> = { COUNTERPOINT_HOME: home };
  for (const key of ['PATH', 'HOME', 'LANG', 'TMPDIR'] as const) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

async function cli(args: readonly string[], home: string, cwd: string) {
  const result = await execa(process.execPath, [CLI, ...args], {
    cwd,
    env: cliEnv(home),
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

describe('approve a change from the console', () => {
  let home: string;
  let repo: FixtureRepo;
  let hostId = '';
  let origin = '';
  let browser: Browser;
  let mission: Page;
  let page: Page;
  const consoleLines: string[] = [];

  const runwayFigure = (p: Page, n: number) =>
    p
      .getByRole('main')
      .getByLabel('Runway', { exact: true })
      .getByRole('heading', { name: String(n), exact: true });

  beforeAll(async () => {
    home = makeScratchDir('home');
    repo = await materializeFixtureRepo('synthetic');
    hostId = hostIdFromName(basename(repo.root));

    const started = await cli(['--port', '0', '--no-open'], home, repo.root);
    expect(started.stderr).toBe('');
    expect(started.exitCode).toBe(0);
    const port = Number(
      /Counterpoint is running at http:\/\/127\.0\.0\.1:(\d+)\//.exec(started.stdout)?.[1],
    );
    expect(port).toBeGreaterThan(0);
    origin = `http://127.0.0.1:${port}`;
    const link = LINK_RE.exec(started.stdout)?.[1];
    expect(link).toBeDefined();

    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const context = await browser.newContext({ colorScheme: 'light', viewport: DESKTOP });
    mission = await context.newPage();
    mission.on('pageerror', (error) => consoleLines.push(`pageerror: ${error.message}`));
    await mission.goto(link as string);
    expect(new URL(mission.url()).pathname).toBe(`/h/${hostId}`);
    // A second tab of the same signed-in browser, for the change pages.
    page = await context.newPage();
    page.on('pageerror', (error) => consoleLines.push(`pageerror: ${error.message}`));
  });

  afterAll(async () => {
    await browser?.close();
    if (home !== undefined) await cli(['stop'], home, repo?.root ?? REPO_ROOT);
    removeScratchDirs();
  });

  it('leads Mission with an empty runway', async () => {
    await runwayFigure(mission, 0).waitFor({ timeout: 15_000 });
    const card = mission.getByRole('main').getByLabel('Runway', { exact: true });
    expect(await card.getByText('Nothing approved yet', { exact: false }).count()).toBe(1);
  });

  it('approves with one click, and the open Mission page moves to 1 without a reload', async () => {
    await page.goto(`${origin}/h/${hostId}/changes/${SYNTHETIC.ready}`);
    const main = page.getByRole('main');
    await main.getByRole('heading', { name: 'Ready thing', exact: true }).waitFor({
      timeout: 15_000,
    });
    // No covered-files list and no dialog: the button is the whole act.
    expect(await main.getByLabel('Covered files', { exact: true }).count()).toBe(0);
    await main.getByRole('button', { name: 'Approve', exact: true }).click();
    await main.getByText('On runway', { exact: true }).first().waitFor({ timeout: 10_000 });
    expect(await page.getByRole('dialog').count()).toBe(0);

    // The other tab was never reloaded.
    await runwayFigure(mission, 1).waitFor({ timeout: 10_000 });
    const row = mission.getByRole('main').getByRole('list', { name: 'Changes on the runway' });
    expect(await row.getByText('Ready thing', { exact: true }).count()).toBe(1);
  });

  it('withdraws with one click from Mission', async () => {
    await mission.getByRole('main').getByRole('button', { name: 'Withdraw', exact: true }).click();
    await runwayFigure(mission, 0).waitFor({ timeout: 10_000 });
    await page
      .getByRole('main')
      .getByRole('button', { name: 'Approve', exact: true })
      .waitFor({ timeout: 10_000 });
  });

  it('approves every ready change with Approve all', async () => {
    await page.goto(`${origin}/h/${hostId}/changes`);
    await page
      .getByRole('main')
      .getByRole('button', { name: /^Approve all \(\d+\)$/ })
      .click();
    await runwayFigure(mission, 1).waitFor({ timeout: 10_000 });
  });

  it('sends an old Trust link to Mission, and the navigation has no Trust entry', async () => {
    await page.goto(`${origin}/h/${hostId}/trust`);
    await page.waitForURL(`${origin}/h/${hostId}`);
    await page.getByRole('main').getByRole('heading', { name: 'Mission' }).waitFor();
    const nav = page.getByRole('navigation', { name: 'Main' });
    expect(await nav.getByRole('link', { name: 'Trust' }).count()).toBe(0);
    expect(consoleLines.filter((line) => line.startsWith('pageerror'))).toEqual([]);
  });
});

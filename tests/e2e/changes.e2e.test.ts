/// <reference lib="dom" />
// (playwright-core's published types name DOM element types.)
//
// Browsing a host's changes in a real browser against the real daemon: the synthetic OpenSpec
// host is the host. Changes lists every active change in build order with its status, then the
// archived ones; the filter narrows it; Change detail explains why a change is or is not
// approvable and which owner steps it has; a commit to the base branch updates the open page
// without a reload.
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { type Browser, chromium, type Locator, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hostIdFromName } from '../../src/core/ids.ts';
import {
  commitChange,
  type FixtureRepo,
  materializeFixtureRepo,
  SYNTHETIC,
} from '../helpers/fixture-repo.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(REPO_ROOT, 'src', 'cli', 'main.ts');
const CHROME =
  process.env.CP_CHROME_PATH ??
  '/Volumes/Dock/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const DESKTOP = { width: 1280, height: 900 };
const READY_PROPOSAL = `openspec/changes/${SYNTHETIC.ready}/proposal.md`;

async function cli(args: readonly string[], home: string, cwd: string) {
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

async function changeIds(page: Page): Promise<string[]> {
  const links = page.getByRole('main').getByRole('link', { name: /\([a-z0-9-]+\)$/ });
  const names = await links.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label') ?? node.textContent ?? ''),
  );
  return names.map((name) => /\(([a-z0-9-]+)\)$/.exec(name)?.[1] ?? name);
}

function rowFor(page: Page, changeId: string): Locator {
  return page
    .getByRole('main')
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: new RegExp(`\\(${changeId}\\)$`) }) });
}

describe('changes pages', () => {
  let home: string;
  let repo: FixtureRepo;
  let hostId = '';
  let origin = '';
  let browser: Browser;
  let page: Page;
  const consoleLines: string[] = [];

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
    page = await context.newPage();
    page.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
    page.on('pageerror', (error) => consoleLines.push(`pageerror: ${error.message}`));
    await page.goto(link as string);
    expect(new URL(page.url()).pathname).toBe(`/h/${hostId}`);
  });

  afterAll(async () => {
    await browser?.close();
    if (home !== undefined) await cli(['stop'], home, repo?.root ?? REPO_ROOT);
    removeScratchDirs();
  });

  it('lists every active change in build order with its status badge, then the archived ones', async () => {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Changes' })
      .click();
    await page.getByRole('heading', { name: 'Changes' }).waitFor({ timeout: 15_000 });
    expect(new URL(page.url()).pathname).toBe(`/h/${hostId}/changes`);
    expect(await page.title()).toBe('Changes · Counterpoint');
    await rowFor(page, SYNTHETIC.broken).waitFor({ timeout: 15_000 });

    expect(await changeIds(page)).toEqual([
      SYNTHETIC.built,
      SYNTHETIC.ready,
      SYNTHETIC.noTasks,
      SYNTHETIC.noProposal,
      SYNTHETIC.broken,
    ]);
    const expected: [string, string][] = [
      [SYNTHETIC.built, 'Built'],
      [SYNTHETIC.ready, 'Ready to approve'],
      [SYNTHETIC.noTasks, 'Not ready'],
      [SYNTHETIC.noProposal, 'Not ready'],
      [SYNTHETIC.broken, "Couldn't read"],
    ];
    for (const [id, label] of expected) {
      expect(await rowFor(page, id).getByText(label, { exact: true }).count()).toBe(1);
    }
    // Task progress, the owner-step token, artifacts and dependencies.
    const ready = rowFor(page, SYNTHETIC.ready);
    expect(await ready.getByText('1/4 tasks', { exact: true }).count()).toBe(1);
    expect(await ready.getByText('1 owner step', { exact: true }).count()).toBe(1);
    expect(
      await ready.getByText('Proposal · 1 spec · Design · Tasks', { exact: true }).count(),
    ).toBe(1);
    expect(await ready.getByRole('link', { name: SYNTHETIC.built, exact: true }).count()).toBe(1);
    expect(
      await rowFor(page, SYNTHETIC.noTasks).getByText('No tasks', { exact: true }).count(),
    ).toBe(1);
    expect(
      await rowFor(page, SYNTHETIC.built).getByText('2/2 tasks', { exact: true }).count(),
    ).toBe(1);

    // The archived change is listed after the active ones, as done.
    const done = page.getByRole('main').getByRole('list', { name: 'Archived changes' });
    expect(await done.getByText('Old thing', { exact: true }).count()).toBe(1);
    expect(await done.getByText('Archived 2026-09-01', { exact: true }).count()).toBe(1);
  });

  it('narrows the list with the status filter and shows zero counts', async () => {
    const filter = page.getByRole('main').getByText('Ready to approve (1)', { exact: true });
    await filter.click();
    await expect.poll(() => changeIds(page)).toEqual([SYNTHETIC.ready]);

    await page.getByRole('main').getByText('On runway (0)', { exact: true }).click();
    await page.getByText('No changes match this filter', { exact: true }).waitFor();
    await page.getByRole('main').getByText('Show all changes', { exact: true }).click();
    await expect.poll(() => changeIds(page)).toHaveLength(5);
  });

  it('shows the why and owner steps on ready-thing, with one Approve button', async () => {
    await rowFor(page, SYNTHETIC.ready)
      .getByRole('link', { name: /\(ready-thing\)$/ })
      .click();
    await page.waitForURL((url) => url.pathname === `/h/${hostId}/changes/${SYNTHETIC.ready}`);
    const main = page.getByRole('main');
    await main.getByRole('heading', { name: 'Ready thing' }).waitFor({ timeout: 15_000 });
    expect(await main.getByText('Ready to approve', { exact: true }).count()).toBe(1);
    expect(
      await main
        .getByText('A change that has its proposal and its tasks, ready to approve.', {
          exact: true,
        })
        .count(),
    ).toBe(1);

    await main.getByText('One step only you can do', { exact: true }).waitFor();
    expect(
      await main.getByText('Owner: create the Supabase project', { exact: true }).count(),
    ).toBe(1);
    expect(await main.getByText('1/4 tasks', { exact: true }).count()).toBe(1);
    expect(await main.getByText('specs/menu/spec.md', { exact: true }).count()).toBe(1);
    expect(await main.getByRole('link', { name: /built-thing/ }).count()).toBe(1);
    expect(await main.getByRole('button', { name: 'Approve', exact: true }).count()).toBe(1);
  });

  it('updates the open page without a reload when the base branch moves', async () => {
    const content = '# Ready thing\n\n## Why\n\nRevised in the e2e.\n';
    const expected = 'Revised in the e2e.';
    const marker = await page.evaluate(() => {
      (window as unknown as { __cpNoReload: boolean }).__cpNoReload = true;
      return true;
    });
    expect(marker).toBe(true);
    await commitChange(repo.root, READY_PROPOSAL, content);
    await page.getByRole('main').getByText(expected, { exact: true }).waitFor({ timeout: 15_000 });
    expect(
      await page.evaluate(() => (window as unknown as { __cpNoReload?: boolean }).__cpNoReload),
    ).toBe(true);
  });

  it('explains no-tasks, no-proposal, broken-yaml (unreadable) and built-thing (built)', async () => {
    const main = page.getByRole('main');
    const host = basename(repo.root);
    await page.goto(`${origin}/h/${hostId}/changes/${SYNTHETIC.noTasks}`);
    await main
      .getByText(
        `${SYNTHETIC.noTasks} has no tasks.md yet. The builder works from its tasks. Run /opsx:propose or add tasks in ${host}, commit, then come back.`,
        { exact: true },
      )
      .waitFor({ timeout: 15_000 });
    expect(await main.getByText('No tasks', { exact: true }).count()).toBe(1);

    await page.goto(`${origin}/h/${hostId}/changes/${SYNTHETIC.noProposal}`);
    await main
      .getByText(
        `${SYNTHETIC.noProposal} has no proposal.md yet. Run /opsx:propose in ${host}, commit, then come back.`,
        { exact: true },
      )
      .waitFor({ timeout: 15_000 });

    await page.goto(`${origin}/h/${hostId}/changes/${SYNTHETIC.broken}`);
    await main
      .getByText(`Couldn't read ${SYNTHETIC.broken}`, { exact: true })
      .waitFor({ timeout: 15_000 });
    expect(await main.getByText(/\.openspec\.yaml could not be parsed/).count()).toBeGreaterThan(0);

    await page.goto(`${origin}/h/${hostId}/changes/${SYNTHETIC.built}`);
    await main.getByText('Already built', { exact: true }).waitFor({ timeout: 15_000 });
    expect(await main.getByRole('button', { name: 'Approve change' }).count()).toBe(0);
  });

  it('raises no Content Security Policy violation or page error', () => {
    const problems = consoleLines.filter((line) =>
      /Content Security Policy|Refused to (execute|load|apply)|pageerror/i.test(line),
    );
    expect(problems).toEqual([]);
  });
});

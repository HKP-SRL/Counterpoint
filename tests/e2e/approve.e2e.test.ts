/// <reference lib="dom" />
// (playwright-core's published types name DOM element types.)
//
// Approving a change from the console end to end (signed-approvals: Console prepares, terminal
// signs; Dialog sees the landing): the real daemon on
// a scratch copy of the synthetic host, a throwaway unprotected key trusted through the library
// (the trust-key command refuses unprotected keys) and an integrity baseline. The console
// previews and hands over the command; the real CLI signs in a pseudo-terminal
// (`/usr/bin/script`); the open dialog flips to landed and the Mission runway goes up by one.
// Then the stale path (the base tip moves while a dialog is open) and the refusal path (the
// host's .git/config changes) show no usable command.
//
// Nothing here touches ~/.ssh, ssh-agent, the Keychain, the global git config, the real
// Counterpoint home or a real host repository.
import { appendFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { type Browser, chromium, type Locator, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { snapshotIntegrity, writeBaseline } from '../../src/core/approvals/integrity.ts';
import { readPublicKey, writeTrust } from '../../src/core/approvals/trust-store.ts';
import { hostIdFromName } from '../../src/core/ids.ts';
import {
  commitChange,
  type FixtureRepo,
  materializeFixtureRepo,
  SYNTHETIC,
} from '../helpers/fixture-repo.ts';
import { makeThrowawayKey } from '../helpers/keys.ts';
import { gitIn, makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(REPO_ROOT, 'src', 'cli', 'main.ts');
const SCRIPT = '/usr/bin/script';
const CHROME =
  process.env.CP_CHROME_PATH ??
  '/Volumes/Dock/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const DESKTOP = { width: 1280, height: 900 };
const LINK_RE =
  /^Sign-in link \(works once\): (http:\/\/127\.0\.0\.1:\d+\/login\?code=[A-Za-z0-9_-]{43})$/m;

/** Gives the synthetic `no-tasks` change a tasks file, which makes it Ready to approve. */
const NO_TASKS_TASKS = '# Tasks\n\n- [ ] 1.1 Write the thing\n';

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

/**
 * Runs the real CLI attached to a pseudo-terminal, as the owner would in a terminal. `script`
 * gives the child its own pty; its own stdin is /dev/null (a pipe from Node is a socket on macOS,
 * which `script` refuses). The throwaway key has no passphrase, so nothing is typed.
 */
async function cliInTerminal(args: readonly string[], home: string, cwd: string) {
  const result = await execa(SCRIPT, ['-q', '/dev/null', process.execPath, CLI, ...args], {
    cwd,
    env: cliEnv(home),
    extendEnv: false,
    reject: false,
    stdin: 'ignore',
    timeout: 60_000,
  });
  return { exitCode: result.exitCode ?? -1, output: `${result.stdout}\n${result.stderr}` };
}

describe('approve a change from the console', () => {
  let home: string;
  let repo: FixtureRepo;
  let hostId = '';
  let hostName = '';
  let origin = '';
  let browser: Browser;
  let page: Page;
  const consoleLines: string[] = [];

  const main = () => page.getByRole('main');
  const dialog = (): Locator => page.getByRole('dialog');

  async function openMission() {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Mission' })
      .click();
    await main().getByRole('heading', { name: 'Mission' }).waitFor({ timeout: 15_000 });
  }

  async function openChange(changeId: string, title: string) {
    await page.goto(`${origin}/h/${hostId}/changes/${changeId}`);
    await main().getByRole('heading', { name: title, exact: true }).waitFor({ timeout: 15_000 });
  }

  async function openDialog() {
    await main().getByRole('button', { name: 'Approve change' }).click();
    await dialog().waitFor({ timeout: 10_000 });
  }

  async function closeDialog() {
    await dialog().getByRole('button', { name: 'Close approval' }).click();
    await dialog().waitFor({ state: 'hidden', timeout: 10_000 });
  }

  beforeAll(async () => {
    home = makeScratchDir('home');
    repo = await materializeFixtureRepo('synthetic');
    hostName = basename(repo.root);
    hostId = hostIdFromName(hostName);

    // A throwaway key trusted through the library, and the integrity baseline for the host.
    const key = await makeThrowawayKey(makeScratchDir('keys'), { name: 'approval' });
    await writeTrust(home, {
      publicKeyPath: key.publicKeyPath,
      confirmed: readPublicKey(key.publicKeyPath),
    });
    writeBaseline(home, hostId, await snapshotIntegrity(join(repo.root, '.git')));

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
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
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

  it('leads Mission with an empty runway', async () => {
    await main().getByRole('heading', { name: 'Mission' }).waitFor({ timeout: 15_000 });
    const card = main().getByLabel('Runway', { exact: true });
    await card.getByText('Nothing approved yet', { exact: false }).waitFor({ timeout: 15_000 });
    expect(await card.getByRole('heading', { name: '0', exact: true }).count()).toBe(1);
    expect(
      await card
        .getByText(
          'Nothing approved yet. Open a ready change and approve it to start your runway.',
          { exact: true },
        )
        .count(),
    ).toBe(1);
    expect(await card.getByRole('link', { name: 'Browse changes' }).count()).toBe(1);
  });

  it('previews what ready-thing would sign and hands over the one-line command', async () => {
    await openChange(SYNTHETIC.ready, 'Ready thing');
    await openDialog();
    const d = dialog();
    await d.getByRole('heading', { name: 'Approve Ready thing' }).waitFor();
    const command = `counterpoint approve ${hostId} ${SYNTHETIC.ready}`;
    await d.getByText(command, { exact: true }).waitFor({ timeout: 15_000 });

    // Five files plus the Draft and Gates rows (and the header row).
    const table = d.getByRole('table');
    expect(await table.getByRole('row').count()).toBe(1 + 5 + 2);
    expect(await table.getByText('Task checkboxes are not part of the signature.').count()).toBe(1);
    expect(await table.getByText('Draft: none yet', { exact: true }).count()).toBe(1);
    expect(await table.getByText('Gates: no gate config yet', { exact: true }).count()).toBe(1);
    expect(await d.getByText("What you're signing", { exact: true }).count()).toBe(1);
    expect(await d.getByText('4 tasks', { exact: true }).count()).toBe(1);
    // The owner step is shown before signing, and does not block it.
    expect(await d.getByText('One step only you can do', { exact: true }).count()).toBe(1);
    expect(await d.getByText('Owner: create the Supabase project', { exact: true }).count()).toBe(
      1,
    );
    expect(await d.getByText(/^Statement [0-9a-f]{12}$/).count()).toBe(1);
    expect(
      await d
        .getByText(
          'Run this in your terminal. It asks for your passphrase, then signs a commit on master that adds only .counterpoint/approvals/ready-thing.json. Your uncommitted work is not touched.',
          { exact: true },
        )
        .count(),
    ).toBe(1);
    expect(await d.getByText('Waiting for the signed commit…', { exact: true }).count()).toBe(1);
    // No sign button anywhere.
    expect(await d.getByRole('button', { name: /^sign/i }).count()).toBe(0);

    const copy = d.getByRole('button', { name: 'Copy command' });
    await expect.poll(() => copy.evaluate((node) => node === document.activeElement)).toBe(true);
    await copy.click();
    await page.getByText('Command copied', { exact: true }).first().waitFor({ timeout: 5_000 });
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
  });

  it('flips to landed when the real CLI signs in a terminal, without touching the checkout', async () => {
    const statusBefore = await gitIn(repo.root, ['status', '--porcelain']);
    const signed = await cliInTerminal(['approve', hostId, SYNTHETIC.ready], home, repo.root);
    expect(signed.output).toContain('You are signing');
    expect(signed.output).toContain('Signed and verified. Runway is now 1.');
    expect(signed.exitCode).toBe(0);

    const d = dialog();
    await d.getByText('Signed. Runway is now 1.').first().waitFor({ timeout: 15_000 });
    expect(await d.getByRole('button', { name: 'Back to changes' }).count()).toBe(1);
    expect(await d.getByRole('button', { name: 'Copy command' }).count()).toBe(0);
    expect(await gitIn(repo.root, ['status', '--porcelain'])).toBe(statusBefore);
    await closeDialog();
  });

  it('shows the runway headline at 1 with the ready-thing row, and On runway on Changes', async () => {
    await openMission();
    const card = main().getByLabel('Runway', { exact: true });
    await card.getByRole('heading', { name: '1', exact: true }).waitFor({ timeout: 15_000 });
    expect(
      await card
        .getByText('1 change on the runway · 4 tasks approved and ready ahead of the builder', {
          exact: true,
        })
        .count(),
    ).toBe(1);
    expect(await card.getByText('Ready thing', { exact: true }).count()).toBe(1);
    expect(await card.getByText(SYNTHETIC.ready, { exact: true }).count()).toBe(1);

    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Changes' })
      .click();
    await main().getByRole('heading', { name: 'Changes' }).waitFor({ timeout: 15_000 });
    const row = main()
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name: /\(ready-thing\)$/ }) });
    await row.getByText('On runway', { exact: true }).waitFor({ timeout: 15_000 });
    expect(await row.getByText(/On runway · signed/).count()).toBe(1);
    expect(await main().getByText('On runway (1)', { exact: true }).count()).toBe(1);

    const status = await cli(['status'], home, repo.root);
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain(`${hostId}  running on 127.0.0.1:`);
    expect(status.stdout).toContain('runway 1');
  });

  it('marks the dialog stale and disables Copy command when the base tip moves first', async () => {
    // Make no-tasks ready in the scratch copy.
    await commitChange(repo.root, `openspec/changes/${SYNTHETIC.noTasks}/tasks.md`, NO_TASKS_TASKS);
    const command = `counterpoint approve ${hostId} ${SYNTHETIC.noTasks}`;
    await openChange(SYNTHETIC.noTasks, 'No tasks yet');
    await main().getByRole('button', { name: 'Approve change' }).waitFor({ timeout: 15_000 });
    await openDialog();
    const d = dialog();
    await d.getByText(command, { exact: true }).waitFor({ timeout: 15_000 });

    await commitChange(repo.root, 'notes/unrelated.txt', 'an unrelated commit\n');
    await d
      .getByText(
        'master moved since this was prepared. Prepare the approval again so you sign the current version.',
        { exact: true },
      )
      .waitFor({ timeout: 15_000 });
    expect(await d.getByRole('button', { name: 'Copy command' }).isDisabled()).toBe(true);
    expect(await d.getByText(command, { exact: true }).count()).toBe(0);

    await d.getByRole('button', { name: 'Prepare approval again' }).click();
    await d.getByText(command, { exact: true }).waitFor({ timeout: 15_000 });
    expect(await d.getByRole('button', { name: 'Copy command' }).isDisabled()).toBe(false);
    await closeDialog();
  });

  it('shows only the integrity refusal, and no command, after .git/config changes', async () => {
    appendFileSync(join(repo.root, '.git', 'config'), '[core]\n\tfsmonitor = /bin/true\n');
    await openDialog();
    const d = dialog();
    await d
      .getByText(
        `Signing would be refused: ${hostName}'s .git/config (or hooks) changed since Counterpoint last checked. Review the change in ${hostName}, then prepare the approval again.`,
        { exact: true },
      )
      .waitFor({ timeout: 15_000 });
    expect(await d.getByText(/counterpoint approve/).count()).toBe(0);
    expect(await d.getByRole('button', { name: 'Copy command' }).count()).toBe(0);
    await closeDialog();
    // Focus returns to the button that opened the dialog.
    await expect
      .poll(() =>
        main()
          .getByRole('button', { name: 'Approve change' })
          .evaluate((node) => node === document.activeElement),
      )
      .toBe(true);
  });

  it('raises no Content Security Policy violation or page error', () => {
    const problems = consoleLines.filter((line) =>
      /Content Security Policy|Refused to (execute|load|apply)|pageerror/i.test(line),
    );
    expect(problems).toEqual([]);
  });
});

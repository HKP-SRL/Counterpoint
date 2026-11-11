/// <reference lib="dom" />
// (playwright-core's published types name DOM element types.)
//
// The drift loop end to end in a browser (needs-you: Approved version changed; Self-resolving
// items; runway: Runway is the Mission headline): approve ready-thing of a scratch copy of the
// synthetic host through the real CLI in a pseudo-terminal, then change what was signed on the base
// branch and watch Counterpoint notice it everywhere the owner looks: the Mission banner and
// runway, the SideNav badge and tab title, the Needs You inbox and Mission card (each row headed by
// the visible `Approved version changed` label), the drift view with git's diff, and `Review
// changes` on Change detail. Re-signing (or reverting the change) resolves it with no other action.
// A change to only the `gates` section of `.counterpoint/config.yaml` does the same with a `Gate
// config` row. Uncommitted edits only show the soft hint. A 7-change host from buildLargeHost
// proves the Mission card's 5-row cap, and stored doctor reports drive the Mission Trust card.
//
// Nothing here touches ~/.ssh, ssh-agent, the Keychain, the global git config, the real
// Counterpoint home or a real host repository.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { controlRequest } from '../../src/cli/control-client.ts';
import { snapshotIntegrity, writeBaseline } from '../../src/core/approvals/integrity.ts';
import { readPublicKey, writeTrust } from '../../src/core/approvals/trust-store.ts';
import { hostIdFromName } from '../../src/core/ids.ts';
import {
  type AcceptedRisk,
  revokeAcceptedRisk,
  writeAcceptedRisk,
} from '../../src/core/security/accepted-risks.ts';
import {
  commitChange,
  type FixtureRepo,
  materializeFixtureRepo,
  SYNTHETIC,
} from '../helpers/fixture-repo.ts';
import { makeThrowawayKey } from '../helpers/keys.ts';
import { buildLargeHost, type LargeHost } from '../helpers/large-host.ts';
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

const READY = SYNTHETIC.ready;
const PROPOSAL = `openspec/changes/${READY}/proposal.md`;
const TASKS = `openspec/changes/${READY}/tasks.md`;
const CONFIG = '.counterpoint/config.yaml';
const EDITED_LINE = '- The ready thing changed after it was signed.';
const REVERT_LINE = '- An edit that is about to be reverted.';
const UNCOMMITTED_HINT =
  'Uncommitted edits to this approved change. The approval only follows what is committed on master.';
const KIND_LABEL = 'Approved version changed';
const ITEM_TITLE = 'Ready thing changed since you signed it';
const LIVE = 20_000;

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
 * Runs the real CLI attached to a pseudo-terminal, as the owner would. `script` gives the child
 * its own pty; the throwaway key has no passphrase, so nothing is typed.
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

/** Starts the daemon for `root` with `home`; returns its origin and one-time sign-in link. */
async function startDaemon(home: string, root: string) {
  const started = await cli(['--port', '0', '--no-open'], home, root);
  expect(started.stderr).toBe('');
  expect(started.exitCode).toBe(0);
  const link = LINK_RE.exec(started.stdout)?.[1];
  expect(link).toBeDefined();
  return { origin: new URL(link as string).origin, link: link as string };
}

const PROBE = [
  ['signing-key', 'Signing key', 'read'],
  ['ssh', '~/.ssh', 'read'],
  ['gh', 'gh credentials', 'read'],
  ['state', 'Counterpoint state', 'read'],
  ['git-config', 'host .git/config', 'write'],
  ['git-hooks', '.git/hooks', 'write'],
  ['git-info', '.git/info', 'write'],
  // The eighth target, so this all-pass report still passes reportVerdict.
  ['outside-workdir', 'Files outside the working folder', 'write'],
  // The ninth target, so this all-pass report still passes reportVerdict.
  ['credential-env', 'Credentials in the shell environment', 'read'],
  // The build-lane rows (first-unattended-run), so an all-pass report still passes.
  ['worktree-git', 'host git state from a worktree', 'write'],
  ['gate-sandbox', 'Gate sandbox', 'write'],
] as const;

/**
 * The gh row as the live probe records a Keychain-only reach: Bash cat, Read and Grep
 * refused by a deny rule (control reached), the Keychain lookup reached in both sessions.
 */
const GH_KEYCHAIN_ONLY = {
  result: 'reachable',
  evidence: 'probe run: only the Keychain lookup reached',
  steps: [
    { index: 10, tool: 'Bash', operation: 'cat', treatment: 'denied-rule', control: 'reached' },
    { index: 11, tool: 'Read', operation: 'read', treatment: 'denied-rule', control: 'reached' },
    { index: 12, tool: 'Grep', operation: 'grep', treatment: 'denied-rule', control: 'reached' },
    { index: 13, tool: 'Bash', operation: 'keychain', treatment: 'reached', control: 'reached' },
  ],
  leaks: ['keychain-canary'],
  trusted: true,
};

/**
 * A stored doctor report in which every check passed and every probe target was blocked; with
 * `acceptedRisks`, the gh row is the Keychain-only reach and the report carries the record doctor
 * read when it ran.
 */
function allPassReport(
  hostId: string,
  checkedAt: Date,
  options: { acceptedRisks?: readonly AcceptedRisk[] } = {},
) {
  const covered = options.acceptedRisks !== undefined;
  const check = (id: string, label: string, detail: string) => ({
    id,
    label,
    result: 'pass',
    detail,
  });
  return {
    schema: 'counterpoint/doctor/v1',
    hostId,
    checkedAt: checkedAt.toISOString(),
    claudeVersion: '2.1.0 (Claude Code)',
    matcherVersion: '1',
    tools: [
      check('claude', 'claude', '2.1.0 (Claude Code)'),
      check('git', 'git', 'git version 2.50.1'),
      check('gh', 'gh', 'gh version 2.102.0'),
    ],
    signingKey: [
      check('passphrase', 'Passphrase-protected', 'The key file is encrypted.'),
      check('agent', 'Not listed by ssh-add -L', 'No loaded identity matches.'),
      check('keychain', 'Not loadable via Keychain', 'No Keychain entry.'),
    ],
    integrity: check('integrity', 'Repository integrity', 'Snapshot recorded.'),
    probe: PROBE.map(([id, label, mode]) => ({
      id,
      label,
      mode,
      result: 'blocked',
      evidence: 'probe run',
      ...(covered && id === 'gh' ? GH_KEYCHAIN_ONLY : {}),
    })),
    ...(covered ? { acceptedRisks: options.acceptedRisks } : {}),
    // A report passes only with the Sandbox isolation settings check passing.
    sandboxIsolation: {
      id: 'sandbox-isolation',
      label: 'Sandbox isolation settings',
      result: 'pass',
      detail:
        'No settings source Claude Code loads for agent sessions turns sandbox isolation off or widens it (1 checked: launch settings).',
      sources: [
        { kind: 'launch', label: 'launch settings', path: null, state: 'read', findings: [] },
      ],
    },
    // And only with the Agent permission mode check passing.
    agentMode: {
      id: 'agent-mode',
      label: 'Agent permission mode',
      result: 'pass',
      detail: "The probe's agent session ran in auto mode.",
      expected: 'auto',
      effective: 'auto',
    },
  };
}

describe('Needs You: an approved change is edited, reviewed, and signed again', () => {
  let home: string;
  let repo: FixtureRepo;
  let hostId = '';
  let origin = '';
  let browser: Browser;
  let page: Page;
  let proposal = '';
  const consoleLines: string[] = [];

  const main = () => page.getByRole('main');
  const nav = () => page.getByRole('navigation', { name: 'Main' });
  const needsYouNav = () => nav().getByRole('link', { name: /^Needs You/ });
  const runwayCard = () => main().getByLabel('Runway', { exact: true });
  const needsYouCard = () => main().getByLabel('Needs You', { exact: true });
  const trustCard = () => main().getByLabel('Trust', { exact: true });
  const changedBanner = () =>
    main().getByText('1 approved change was edited since you signed it', { exact: true });

  async function openMission() {
    await page.goto(`${origin}/h/${hostId}`);
    await main().getByRole('heading', { name: 'Mission' }).waitFor({ timeout: 15_000 });
  }

  async function runwayIs(n: number) {
    await runwayCard()
      .getByRole('heading', { name: String(n), exact: true })
      .waitFor({ timeout: LIVE });
  }

  async function approveReady() {
    const signed = await cliInTerminal(['approve', hostId, READY], home, repo.root);
    expect(signed.output).toContain('Signed and verified.');
    expect(signed.exitCode).toBe(0);
  }

  beforeAll(async () => {
    home = makeScratchDir('home');
    repo = await materializeFixtureRepo('synthetic');
    hostId = hostIdFromName(basename(repo.root));
    proposal = readFileSync(join(repo.root, PROPOSAL), 'utf8');

    const key = await makeThrowawayKey(makeScratchDir('keys'), { name: 'approval' });
    await writeTrust(home, {
      publicKeyPath: key.publicKeyPath,
      confirmed: readPublicKey(key.publicKeyPath),
    });
    writeBaseline(home, hostId, await snapshotIntegrity(join(repo.root, '.git')));

    const daemon = await startDaemon(home, repo.root);
    origin = daemon.origin;
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const context = await browser.newContext({ colorScheme: 'light', viewport: DESKTOP });
    page = await context.newPage();
    page.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
    page.on('pageerror', (error) => consoleLines.push(`pageerror: ${error.message}`));
    await page.goto(daemon.link);
    expect(new URL(page.url()).pathname).toBe(`/h/${hostId}`);
  });

  afterAll(async () => {
    await browser?.close();
    if (home !== undefined) await cli(['stop'], home, repo?.root ?? REPO_ROOT);
    removeScratchDirs();
  });

  it('starts with an empty Needs You card and a Trust card that was never checked', async () => {
    await openMission();
    await runwayIs(0);
    await needsYouCard().getByText('Nothing needs you', { exact: true }).waitFor({ timeout: LIVE });
    expect(
      await needsYouCard()
        .getByText(
          'If a change you approved is edited after signing, it will show up here with what changed.',
          { exact: true },
        )
        .count(),
    ).toBe(1);
    await trustCard().getByText('Not checked yet', { exact: true }).waitFor({ timeout: LIVE });
    expect(await trustCard().getByRole('link', { name: 'Open Trust' }).count()).toBe(1);
    expect(await changedBanner().count()).toBe(0);
    expect(await needsYouNav().textContent()).toBe('Needs You');
  });

  it('puts ready-thing on the runway when the real CLI signs it', async () => {
    await approveReady();
    await runwayIs(1);
  });

  it('keeps the approval when only a task box is ticked on the base branch', async () => {
    const tasks = readFileSync(join(repo.root, TASKS), 'utf8');
    await commitChange(repo.root, TASKS, tasks.replace('- [ ] 1.1', '- [x] 1.1'));
    await openMission();
    await runwayIs(1);
    expect(await changedBanner().count()).toBe(0);
  });

  it('shows a committed proposal edit on Mission, in the badge and in the tab title', async () => {
    await commitChange(repo.root, PROPOSAL, `${proposal}\n${EDITED_LINE}\n`);

    await changedBanner().waitFor({ timeout: LIVE });
    await runwayIs(0);
    expect(
      await main().getByRole('link', { name: 'Review what changed in Needs You' }).count(),
    ).toBe(1);
    await expect.poll(() => needsYouNav().textContent(), { timeout: LIVE }).toContain(', 1 item');
    await expect.poll(() => page.title(), { timeout: LIVE }).toMatch(/^\(1\) Mission · /);

    // The Mission card shows the same row as the inbox, label first.
    const card = needsYouCard();
    await card.getByText(KIND_LABEL, { exact: true }).waitFor({ state: 'visible', timeout: LIVE });
    expect(await card.getByText(ITEM_TITLE, { exact: true }).count()).toBe(1);
    expect(await card.getByText('View all Needs You items', { exact: true }).count()).toBe(0);
  });

  it('lists the item in Needs You under a visible Approved version changed label', async () => {
    await needsYouNav().click();
    await main().getByRole('heading', { name: 'Needs You' }).waitFor({ timeout: 15_000 });
    const label = main().getByText(KIND_LABEL, { exact: true });
    await label.waitFor({ state: 'visible', timeout: LIVE });
    expect(await label.isVisible()).toBe(true);
    const title = main().getByText(ITEM_TITLE, { exact: true });
    await title.waitFor({ state: 'visible' });
    // The label sits above the title.
    const labelBox = await label.boundingBox();
    const titleBox = await title.boundingBox();
    expect(labelBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect((labelBox?.y ?? 0) < (titleBox?.y ?? 0)).toBe(true);
    expect(
      await main()
        .getByText(/· 1 file changed · signed/)
        .count(),
    ).toBe(1);
    expect(await main().getByRole('listitem').count()).toBe(1);
  });

  it('opens the drift view with the diff and the re-sign command', async () => {
    await main().getByText(ITEM_TITLE, { exact: true }).click();
    await main().getByRole('heading', { name: ITEM_TITLE }).waitFor({ timeout: 15_000 });
    await main().getByText('1 input file changed', { exact: false }).first().waitFor();
    expect(await main().getByText('Modified', { exact: true }).count()).toBeGreaterThan(0);
    await main().getByText(EDITED_LINE, { exact: false }).first().waitFor({ timeout: LIVE });
    const region = main().getByRole('region', { name: 'Sign the new version' });
    expect(
      await region.getByText(`counterpoint approve ${hostId} ${READY}`, { exact: true }).count(),
    ).toBe(1);
  });

  it('offers Review changes on the edited change, linking to its drift view', async () => {
    await page.goto(`${origin}/h/${hostId}/changes/${READY}`);
    const review = main().getByText('Review changes', { exact: true });
    await review.waitFor({ timeout: 15_000 });
    expect(await main().getByRole('button', { name: 'Approve change' }).count()).toBe(0);
    await review.click();
    await page.waitForURL(`${origin}/h/${hostId}/needs-you/${READY}`);
    await main().getByRole('heading', { name: ITEM_TITLE }).waitFor({ timeout: 15_000 });
  });

  it('resolves on its own when the change is signed again', async () => {
    await approveReady();
    await main()
      .getByText('This change matches what you signed again', { exact: true })
      .waitFor({ timeout: LIVE });
    await expect.poll(() => needsYouNav().textContent(), { timeout: LIVE }).toBe('Needs You');
    await expect.poll(() => page.title(), { timeout: LIVE }).not.toMatch(/^\(\d+\) /);

    await openMission();
    await runwayIs(1);
    expect(await changedBanner().count()).toBe(0);
    await page.goto(`${origin}/h/${hostId}/needs-you`);
    await main().getByText('Nothing needs you', { exact: true }).waitFor({ timeout: LIVE });
  });

  it('treats a change to only the gates section as its own Gate config row', async () => {
    await commitChange(repo.root, CONFIG, 'gates:\n  lint: pnpm lint\n');
    await page.goto(`${origin}/h/${hostId}/needs-you`);
    await main()
      .getByText(KIND_LABEL, { exact: true })
      .waitFor({ state: 'visible', timeout: LIVE });
    expect(
      await main()
        .getByText(/· gate config changed · signed/)
        .count(),
    ).toBe(1);

    await main().getByText(ITEM_TITLE, { exact: true }).click();
    await main().getByRole('heading', { name: ITEM_TITLE }).waitFor({ timeout: 15_000 });
    await main().getByText('The gate config changed.', { exact: false }).first().waitFor();
    expect(await main().getByText('Gate config', { exact: false }).count()).toBeGreaterThan(0);
    await main().getByText('pnpm lint', { exact: false }).first().waitFor({ timeout: LIVE });

    await openMission();
    await runwayIs(0);
    await changedBanner().waitFor({ timeout: LIVE });

    await approveReady();
    await runwayIs(1);
    await expect.poll(() => needsYouNav().textContent(), { timeout: LIVE }).toBe('Needs You');
  });

  it('resolves with no re-sign when the edit is reverted', async () => {
    const signedProposal = readFileSync(join(repo.root, PROPOSAL), 'utf8');
    await commitChange(repo.root, PROPOSAL, `${signedProposal}${REVERT_LINE}\n`);
    await openMission();
    await changedBanner().waitFor({ timeout: LIVE });
    await runwayIs(0);

    await commitChange(repo.root, PROPOSAL, signedProposal);
    // The edit and its revert can land inside one watcher pass; the open page still catches up.
    await runwayIs(1);
    await expect.poll(async () => changedBanner().count(), { timeout: LIVE }).toBe(0);
    await needsYouCard().getByText('Nothing needs you', { exact: true }).waitFor({ timeout: LIVE });
  });

  it('shows only the soft hint for uncommitted edits, with the change still on the runway', async () => {
    const file = join(repo.root, PROPOSAL);
    const committed = readFileSync(file, 'utf8');
    writeFileSync(file, `${committed}- an edit that is not committed\n`);
    try {
      await page.goto(`${origin}/h/${hostId}/changes`);
      const row = main()
        .getByRole('row')
        .filter({ has: page.getByRole('link', { name: /\(ready-thing\)$/ }) });
      await row.getByText(UNCOMMITTED_HINT, { exact: true }).waitFor({ timeout: LIVE });
      expect(await row.getByText('On runway', { exact: true }).count()).toBe(1);

      await page.goto(`${origin}/h/${hostId}/changes/${READY}`);
      await main().getByText(UNCOMMITTED_HINT, { exact: true }).waitFor({ timeout: LIVE });
      expect(await main().getByText('Review changes', { exact: true }).count()).toBe(0);

      await openMission();
      await runwayIs(1);
      expect(await changedBanner().count()).toBe(0);
    } finally {
      await gitIn(repo.root, ['checkout', '--', PROPOSAL]);
    }
  });

  it('shows the stored doctor verdict on the Mission Trust card, and its age when stale', async () => {
    const dir = join(home, 'hosts', hostId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const write = (report: unknown) =>
      writeFileSync(join(dir, 'doctor.json'), `${JSON.stringify(report)}\n`, { mode: 0o600 });
    const nudgeUntil = async (text: string | RegExp) => {
      const target = trustCard().getByText(text).first();
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const res = await controlRequest(home, 'POST', '/control/notify', {
          hostId,
          family: 'doctor',
        });
        expect(res.status).toBe(202);
        try {
          await target.waitFor({ timeout: 2_500 });
          return;
        } catch {
          // the stream may have subscribed a moment late; nudge again
        }
      }
      await target.waitFor({ timeout: 5_000 });
    };

    await openMission();
    write(allPassReport(hostId, new Date()));
    await nudgeUntil('Agents are boxed in');
    expect(await trustCard().getByText('Pass', { exact: true }).count()).toBe(1);
    expect(
      await trustCard()
        .getByText(/^This check is/)
        .count(),
    ).toBe(0);

    write(allPassReport(hostId, new Date(Date.now() - 25 * 60 * 60 * 1000)));
    await nudgeUntil(/^This check is 25 hours old\./);

    // The owner's accepted risk shows as its own warning verdict, never as Pass.
    const entry = writeAcceptedRisk(home, { reason: 'E2E: owner accepted the Keychain residual' });
    try {
      write(allPassReport(hostId, new Date(), { acceptedRisks: [entry] }));
      await nudgeUntil('Agents are boxed in, with one accepted risk');
      expect(await trustCard().getByText('Accepted risk', { exact: true }).count()).toBe(1);
      expect(await trustCard().getByText('Pass', { exact: true }).count()).toBe(0);
      expect(await trustCard().getByText('Agents are boxed in', { exact: true }).count()).toBe(0);
      expect(
        await trustCard()
          .getByText(/^This check is/)
          .count(),
      ).toBe(0);

      // Revoked: the same stored report reads as not confining.
      expect(revokeAcceptedRisk(home, 'gh-keychain')).toBe(true);
      await nudgeUntil('Agent sandbox is not confining sessions');
      expect(await trustCard().getByText('Reachable', { exact: true }).count()).toBe(1);
      expect(await trustCard().getByText('Accepted risk', { exact: true }).count()).toBe(0);
    } finally {
      revokeAcceptedRisk(home, 'gh-keychain');
    }
  });

  it('raises no Content Security Policy violation or page error', () => {
    const problems = consoleLines.filter((line) =>
      /Content Security Policy|Refused to (execute|load|apply)|pageerror/i.test(line),
    );
    expect(problems).toEqual([]);
  });
});

describe('the Mission Needs You card on a host with seven changed approvals', () => {
  let host: LargeHost;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let origin = '';

  beforeAll(async () => {
    host = await buildLargeHost({ changes: 7 });
    const daemon = await startDaemon(host.home, host.root);
    origin = daemon.origin;
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    context = await browser.newContext({ colorScheme: 'light', viewport: DESKTOP });
    page = await context.newPage();
    await page.goto(daemon.link);
    expect(new URL(page.url()).pathname).toBe(`/h/${host.hostId}`);
  });

  afterAll(async () => {
    await browser?.close();
    if (host !== undefined) await cli(['stop'], host.home, host.root);
    removeScratchDirs();
  });

  it('shows the five newest rows and View all Needs You items; the inbox shows all seven', async () => {
    const main = page.getByRole('main');
    await host.approveAll();
    await main
      .getByLabel('Runway', { exact: true })
      .getByRole('heading', { name: '7', exact: true })
      .waitFor({ timeout: LIVE });

    await host.driftAll();
    await main
      .getByText('7 approved changes were edited since you signed them', { exact: true })
      .waitFor({ timeout: LIVE });
    const card = main.getByLabel('Needs You', { exact: true });
    const cardRows = card
      .getByRole('list', { name: 'Newest Needs You items' })
      .getByRole('listitem');
    await expect.poll(() => cardRows.count(), { timeout: LIVE }).toBe(5);
    const viewAll = card.getByRole('link', { name: 'View all Needs You items' });
    expect(await viewAll.count()).toBe(1);

    await viewAll.click();
    await page.waitForURL(`${origin}/h/${host.hostId}/needs-you`);
    const rows = main.getByRole('list', { name: 'Needs You items' }).getByRole('listitem');
    await expect.poll(() => rows.count(), { timeout: LIVE }).toBe(7);
    expect(await main.getByText('Approved version changed', { exact: true }).count()).toBe(7);
  });
});

/// <reference lib="dom" />
// (playwright-core's published types name DOM element types.)
//
// Browsing a host's phases and the Trust page in a real browser against the real daemon (01-11):
// the synthetic GSD fixture is the host. Phases lists every roadmap phase in numeric order with
// its status; the filter narrows it; Phase detail explains why a phase is or is not approvable,
// what setup it needs and which inputs a signature binds; a commit to the base branch updates the
// open page without a reload; Trust renders whatever doctor report is stored.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { type Browser, chromium, type Locator, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { controlRequest } from '../../src/cli/control-client.ts';
import { hostIdFromName } from '../../src/core/ids.ts';
import { commitChange, type FixtureRepo, materializeFixtureRepo } from '../helpers/fixture-repo.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(REPO_ROOT, 'src', 'cli', 'main.ts');
const CHROME =
  process.env.CP_CHROME_PATH ??
  '/Volumes/Dock/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const DESKTOP = { width: 1280, height: 900 };
const CONTEXT_02 = '.planning/phases/02-ready-thing/02-CONTEXT.md';

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

const PROBE = [
  ['signing-key', 'Signing key', 'read'],
  ['ssh', '~/.ssh', 'read'],
  ['gh', 'gh credentials', 'read'],
  ['state', 'Counterpoint state', 'read'],
  ['git-config', 'host .git/config', 'write'],
  ['git-hooks', '.git/hooks', 'write'],
  ['git-info', '.git/info', 'write'],
  // 01-17: the eighth target, and 01-26: the ninth (replacement 3 for the scrub opt-out). The
  // Trust page lists all nine since 01-22, so an all-pass report shows Blocked 9 times.
  ['outside-workdir', 'Files outside the working folder', 'write'],
  ['credential-env', 'Credentials in the shell environment', 'read'],
] as const;

type ProbeFixtureRow = {
  id: string;
  label: string;
  mode: string;
  result: string;
  evidence: string;
};

const AGENT_MODE_PASS = "The probe's agent session ran in auto mode.";
const AGENT_MODE_FAIL = "The probe's agent session ran in default mode, not auto.";
const AGENT_MODE_FIX =
  'Counterpoint launches agent sessions with --permission-mode auto. Check that auto mode is available to your claude (claude --version; no disableAutoMode in your Claude Code settings), then run "counterpoint doctor" again.';
const ISOLATION_PASS =
  'No settings source Claude Code loads for agent sessions turns sandbox isolation off (1 checked: launch settings).';
const ISOLATION_FAIL =
  'user settings sets sandbox.filesystem.disabled to true, which turns filesystem isolation off.';
const ISOLATION_FIX =
  'Remove sandbox.filesystem.disabled from ~/.claude/settings.json, then run "counterpoint doctor" again.';
const NOT_COUNTED =
  'Not counted as Blocked while the Sandbox isolation settings check does not pass. Measured: ';

function doctorReport(
  hostId: string,
  options: {
    checkedAt?: Date;
    reachable?: readonly string[];
    /** 01-22: the Agent permission mode check (pass by default). */
    agentMode?: 'pass' | 'fail' | 'absent';
    /** 01-25: the Sandbox isolation settings check (pass by default). */
    sandboxIsolation?: 'pass' | 'fail' | 'absent';
    /** Replaces or drops probe rows (it receives the nine rows as built). */
    probe?: (rows: ProbeFixtureRow[]) => ProbeFixtureRow[];
  } = {},
) {
  const check = (id: string, label: string, detail: string) => ({
    id,
    label,
    result: 'pass',
    detail,
  });
  const rows: ProbeFixtureRow[] = PROBE.map(([id, label, mode]) => ({
    id,
    label,
    mode,
    result: options.reachable?.includes(id) ? 'reachable' : 'blocked',
    evidence: 'probe run',
  }));
  const isolation = options.sandboxIsolation ?? 'pass';
  const mode = options.agentMode ?? 'pass';
  return {
    schema: 'counterpoint/doctor/v1',
    hostId,
    checkedAt: (options.checkedAt ?? new Date()).toISOString(),
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
    probe: options.probe === undefined ? rows : options.probe(rows),
    // 01-25: a report passes only with the Sandbox isolation settings check passing.
    ...(isolation === 'absent'
      ? {}
      : {
          sandboxIsolation:
            isolation === 'pass'
              ? {
                  id: 'sandbox-isolation',
                  label: 'Sandbox isolation settings',
                  result: 'pass',
                  detail: ISOLATION_PASS,
                  sources: [
                    {
                      kind: 'launch',
                      label: 'launch settings',
                      path: null,
                      state: 'read',
                      findings: [],
                    },
                  ],
                }
              : {
                  id: 'sandbox-isolation',
                  label: 'Sandbox isolation settings',
                  result: 'fail',
                  detail: ISOLATION_FAIL,
                  fix: ISOLATION_FIX,
                  sources: [
                    {
                      kind: 'launch',
                      label: 'launch settings',
                      path: null,
                      state: 'read',
                      findings: [],
                    },
                    {
                      kind: 'user',
                      label: 'user settings',
                      path: '~/.claude/settings.json',
                      state: 'read',
                      findings: ['sandbox.filesystem.disabled'],
                    },
                  ],
                },
        }),
    // 01-22: a report passes only with the Agent permission mode check passing.
    ...(mode === 'absent'
      ? {}
      : {
          agentMode:
            mode === 'pass'
              ? {
                  id: 'agent-mode',
                  label: 'Agent permission mode',
                  result: 'pass',
                  detail: AGENT_MODE_PASS,
                  expected: 'auto',
                  effective: 'auto',
                }
              : {
                  id: 'agent-mode',
                  label: 'Agent permission mode',
                  result: 'fail',
                  detail: AGENT_MODE_FAIL,
                  fix: AGENT_MODE_FIX,
                  expected: 'auto',
                  effective: 'default',
                },
        }),
  };
}

/** The visible text of every body row's first cell, in order. */
async function phaseIds(page: Page): Promise<string[]> {
  const links = page.getByRole('main').getByRole('link', { name: /^Phase \d/ });
  const names = await links.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label') ?? node.textContent ?? ''),
  );
  return names.map((name) => /^Phase ([\d.]+)/.exec(name)?.[1] ?? name);
}

function rowFor(page: Page, phaseId: string): Locator {
  return page
    .getByRole('main')
    .getByRole('row')
    .filter({
      has: page.getByRole('link', { name: new RegExp(`^Phase ${phaseId.replace('.', '\\.')}:`) }),
    });
}

describe('phases and trust pages', () => {
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

  /** Writes the stored doctor report for the host (as `counterpoint doctor` would). */
  const writeReport = (report: unknown) => {
    const dir = join(home, 'hosts', hostId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, 'doctor.json'), `${JSON.stringify(report)}\n`, { mode: 0o600 });
  };

  /** Nudges the daemon with a doctor event until `text` shows on the page. */
  const nudgeUntil = async (text: string | RegExp) => {
    const target = page.getByRole('main').getByText(text).first();
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

  /** Writes `report`, opens Trust and waits until the verdict title `title` shows. */
  const showTrust = async (report: unknown, title: string) => {
    writeReport(report);
    await page.goto(`${origin}/h/${hostId}/trust`);
    await page.getByRole('main').getByRole('heading', { name: 'Trust' }).waitFor({
      timeout: 15_000,
    });
    await nudgeUntil(title);
    return page.getByRole('main');
  };

  /** The table row whose text includes `label`. */
  const trustRow = (label: string) =>
    page.getByRole('main').getByRole('row').filter({ hasText: label });

  afterAll(async () => {
    await browser?.close();
    if (home !== undefined) await cli(['stop'], home, repo?.root ?? REPO_ROOT);
    removeScratchDirs();
  });

  it('lists every roadmap phase in numeric order with its status badge', async () => {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Phases' })
      .click();
    await page.getByRole('heading', { name: 'Phases' }).waitFor({ timeout: 15_000 });
    expect(new URL(page.url()).pathname).toBe(`/h/${hostId}/phases`);
    expect(await page.title()).toBe('Phases · Counterpoint');
    await rowFor(page, '04').waitFor({ timeout: 15_000 });

    expect(await phaseIds(page)).toEqual(['01', '01.9', '01.10', '02', '02.1', '03', '04']);
    const expected: [string, string][] = [
      ['01', 'Built'],
      ['01.9', 'Not planned'],
      ['01.10', 'Not planned'],
      ['02', 'Ready to approve'],
      ['02.1', 'Not planned'],
      ['03', 'Not planned'],
      ['04', "Couldn't read"],
    ];
    for (const [id, label] of expected) {
      expect(await rowFor(page, id).getByText(label, { exact: true }).count()).toBe(1);
    }
    // Plans wording and the setup token.
    const ready = rowFor(page, '02');
    expect(await ready.getByText('2 plans', { exact: true }).count()).toBe(1);
    expect(await ready.getByText('1 not autonomous', { exact: true }).count()).toBe(1);
    expect(await ready.getByText('Setup needed', { exact: true }).count()).toBe(1);
    expect(await rowFor(page, '03').getByText('No plans', { exact: true }).count()).toBe(1);
    expect(await rowFor(page, '01').getByText('1 plan', { exact: true }).count()).toBe(1);
  });

  it('narrows the list with the status filter and shows zero counts', async () => {
    const filter = page.getByRole('main').getByText('Ready to approve (1)', { exact: true });
    await filter.click();
    await expect.poll(() => phaseIds(page)).toEqual(['02']);

    await page.getByRole('main').getByText('On runway (0)', { exact: true }).click();
    await page.getByText('No phases match this filter', { exact: true }).waitFor();
    await page.getByRole('main').getByText('Show all phases', { exact: true }).click();
    await expect.poll(() => phaseIds(page)).toHaveLength(7);
  });

  it('shows the prerequisites, plans and six inputs with 12-hex digests on Phase 02', async () => {
    await rowFor(page, '02').getByRole('link').click();
    await page.waitForURL((url) => url.pathname === `/h/${hostId}/phases/02`);
    const main = page.getByRole('main');
    await main.getByRole('heading', { name: 'Phase 02: Ready Thing' }).waitFor({ timeout: 15_000 });
    expect(await main.getByText('Ready to approve', { exact: true }).count()).toBe(1);

    await main.getByText('Setup needed before the builder can run this', { exact: true }).waitFor();
    expect(
      await main
        .getByText('docker + supabase-cli: Local stack where the migrations apply', {
          exact: true,
        })
        .count(),
    ).toBe(1);
    expect(
      await main.getByText('google-oauth: Sign-in needs an OAuth client', { exact: true }).count(),
    ).toBe(1);
    expect(
      await main
        .getByText('1 of 2 plans need you present (not autonomous).', { exact: true })
        .count(),
    ).toBe(1);

    expect(await main.getByText('02-01', { exact: true }).count()).toBe(1);
    expect(await main.getByText('02-02', { exact: true }).count()).toBe(1);

    const digests = await main.evaluate((root) =>
      [...root.querySelectorAll('*')]
        .filter((node) => node.children.length === 0)
        .map((node) => (node.textContent ?? '').trim())
        .filter((text) => /^[0-9a-f]{12}$/.test(text)),
    );
    expect(new Set(digests).size).toBe(6);
  });

  it('updates the Inputs digest without a reload when the base branch moves', async () => {
    const content = '# Phase 02 context, revised in the e2e\n\nA new decision.\n';
    const expected = createHash('sha256').update(content).digest('hex').slice(0, 12);
    const marker = await page.evaluate(() => {
      (window as unknown as { __cpNoReload: boolean }).__cpNoReload = true;
      return true;
    });
    expect(marker).toBe(true);
    await commitChange(repo.root, CONTEXT_02, content);
    await page.getByRole('main').getByText(expected, { exact: true }).waitFor({ timeout: 15_000 });
    expect(
      await page.evaluate(() => (window as unknown as { __cpNoReload?: boolean }).__cpNoReload),
    ).toBe(true);
  });

  it('explains Phase 03 (no CONTEXT), Phase 04 (unreadable plan) and Phase 01 (built)', async () => {
    const main = page.getByRole('main');
    await page.goto(`${origin}/h/${hostId}/phases/03`);
    await main
      .getByText(
        `Phase 03 has no CONTEXT.md yet. Run /gsd-discuss-phase 03 and /gsd-plan-phase 03 in ${basename(repo.root)}, then come back.`,
        { exact: true },
      )
      .waitFor({ timeout: 15_000 });
    expect(await main.getByText('No plans yet', { exact: true }).count()).toBe(1);

    await page.goto(`${origin}/h/${hostId}/phases/04`);
    await main.getByText("Couldn't read Phase 04", { exact: true }).waitFor({ timeout: 15_000 });
    expect(await main.getByText(/04-01-PLAN\.md could not be parsed/).count()).toBeGreaterThan(0);

    await page.goto(`${origin}/h/${hostId}/phases/01`);
    await main.getByText('Already built', { exact: true }).waitFor({ timeout: 15_000 });
    expect(await main.getByRole('button', { name: 'Approve phase' }).count()).toBe(0);
  });

  it('shows Not checked yet on Trust, then each stored verdict as it is written', async () => {
    const main = page.getByRole('main');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Trust' })
      .click();
    await main.getByRole('heading', { name: 'Trust' }).waitFor({ timeout: 15_000 });
    expect(await page.title()).toBe('Trust · Counterpoint');
    await main.getByText('Not checked yet', { exact: true }).first().waitFor({ timeout: 15_000 });
    expect(await main.getByText('counterpoint doctor', { exact: true }).count()).toBeGreaterThan(0);

    writeReport(doctorReport(hostId));
    await nudgeUntil('Agents are boxed in');
    expect(await main.getByText('Blocked', { exact: true }).count()).toBe(9);
    // 3 tools, 4 signing-key rows and the 2 session checks.
    expect(await main.getByText('Pass', { exact: true }).count()).toBe(9);
    expect(await main.getByText('This check is', { exact: false }).count()).toBe(0);
    for (const label of [
      'Files outside the working folder',
      'Credentials in the shell environment',
    ]) {
      expect(await trustRow(label).getByText('Blocked', { exact: true }).count(), label).toBe(1);
    }
    expect(
      await trustRow('Files outside the working folder')
        .getByText('cannot write', { exact: true })
        .count(),
    ).toBe(1);
    expect(
      await trustRow('Credentials in the shell environment')
        .getByText('cannot read', { exact: true })
        .count(),
    ).toBe(1);
    expect(
      await main
        .getByText(
          "and found no credentials in its shell environment other than the sandbox's own local proxy login.",
        )
        .count(),
    ).toBe(1);
    const modeRow = trustRow('Agent permission mode');
    expect(await modeRow.getByText(AGENT_MODE_PASS, { exact: true }).count()).toBe(1);
    expect(await modeRow.getByText('Pass', { exact: true }).count()).toBe(1);
    const isolationRow = trustRow('Sandbox isolation settings');
    expect(await isolationRow.getByText(ISOLATION_PASS, { exact: true }).count()).toBe(1);
    expect(await isolationRow.getByText('Pass', { exact: true }).count()).toBe(1);
    // The two session checks come first in the Sandbox probe card, in the CLI's order.
    const card = main.getByLabel('Sandbox probe');
    const labels = await card
      .getByRole('row')
      .evaluateAll((rows) => rows.map((row) => (row.textContent ?? '').trim()));
    const firstLabels = labels.filter((text) => text !== '' && !/^Check|^Target/.test(text));
    expect(firstLabels[0]).toContain('Agent permission mode');
    expect(firstLabels[1]).toContain('Sandbox isolation settings');
    expect(firstLabels[2]).toContain('Signing key');
    expect(firstLabels.at(-1)).toContain('Credentials in the shell environment');

    writeReport(doctorReport(hostId, { checkedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }));
    await nudgeUntil(/^This check is 25 hours old$/);

    writeReport(doctorReport(hostId, { reachable: ['ssh'] }));
    await nudgeUntil('Agent sandbox is not confining sessions');
    expect(await main.getByText(/^1 target was reachable\./).count()).toBe(1);
    expect(await main.getByText('Reachable', { exact: true }).count()).toBe(1);
    expect(await main.getByText('Agents are boxed in', { exact: true }).count()).toBe(0);
  });

  it('shows a reachable outside-workdir row as not confining', async () => {
    const main = await showTrust(
      doctorReport(hostId, { reachable: ['outside-workdir'] }),
      'Agent sandbox is not confining sessions',
    );
    await main.getByText(/^1 target was reachable\./).waitFor({ timeout: 15_000 });
    expect(
      await trustRow('Files outside the working folder')
        .getByText('Reachable', { exact: true })
        .count(),
    ).toBe(1);
    expect(await main.getByText('Reachable', { exact: true }).count()).toBe(1);
    expect(await main.getByText('Agents are boxed in', { exact: true }).count()).toBe(0);
  });

  it('shows a reachable credential-env row as not confining', async () => {
    const main = await showTrust(
      doctorReport(hostId, { reachable: ['credential-env'] }),
      'Agent sandbox is not confining sessions',
    );
    await main.getByText(/^1 target was reachable\./).waitFor({ timeout: 15_000 });
    expect(
      await trustRow('Credentials in the shell environment')
        .getByText('Reachable', { exact: true })
        .count(),
    ).toBe(1);
    expect(await main.getByText('Reachable', { exact: true }).count()).toBe(1);
    expect(await main.getByText('Agents are boxed in', { exact: true }).count()).toBe(0);
  });

  it("shows an eight-row report's missing credential-env row as Not checked", async () => {
    // A report written before 01-26: both session checks pass, eight rows, all blocked.
    const main = await showTrust(
      doctorReport(hostId, { probe: (rows) => rows.filter((row) => row.id !== 'credential-env') }),
      '1 check did not pass',
    );
    expect(
      await trustRow('Credentials in the shell environment')
        .getByText('Not checked', { exact: true })
        .count(),
    ).toBe(1);
    expect(await main.getByText('Blocked', { exact: true }).count()).toBe(8);
    expect(await main.getByText('1 check did not pass', { exact: true }).count()).toBe(1);
    expect(await main.getByText('Agents are boxed in', { exact: true }).count()).toBe(0);
  });

  it('shows a report without the agent permission mode as not passing', async () => {
    const main = await showTrust(
      doctorReport(hostId, { agentMode: 'absent' }),
      '1 check did not pass',
    );
    const modeRow = trustRow('Agent permission mode');
    expect(await modeRow.getByText('Not checked', { exact: true }).count()).toBe(1);
    expect(await modeRow.getByText(/Not recorded in this report/).count()).toBe(1);
    expect(await main.getByText('Blocked', { exact: true }).count()).toBe(9);
    expect(await main.getByText('1 check did not pass', { exact: true }).count()).toBe(1);
    expect(await main.getByText('Agents are boxed in', { exact: true }).count()).toBe(0);
  });

  it('shows a report without the sandbox isolation check as not passing', async () => {
    const main = await showTrust(
      doctorReport(hostId, { sandboxIsolation: 'absent' }),
      '1 check did not pass',
    );
    const isolationRow = trustRow('Sandbox isolation settings');
    expect(await isolationRow.getByText('Not checked', { exact: true }).count()).toBe(1);
    expect(await isolationRow.getByText(/Not recorded in this report/).count()).toBe(1);
    expect(await main.getByText('1 check did not pass', { exact: true }).count()).toBe(1);
    expect(await main.getByText('Agents are boxed in', { exact: true }).count()).toBe(0);
  });

  it('shows an agent session that ran in default mode as failing', async () => {
    const main = await showTrust(
      doctorReport(hostId, { agentMode: 'fail' }),
      '1 check did not pass',
    );
    const modeRow = trustRow('Agent permission mode');
    expect(await modeRow.getByText('Fail', { exact: true }).count()).toBe(1);
    expect(await modeRow.getByText(AGENT_MODE_FAIL, { exact: true }).count()).toBe(1);
    expect(await modeRow.getByText(`Fix: ${AGENT_MODE_FIX}`, { exact: true }).count()).toBe(1);
    expect(await main.getByText('1 check did not pass', { exact: true }).count()).toBe(1);
    expect(await main.getByText('Agents are boxed in', { exact: true }).count()).toBe(0);
  });

  it('shows a settings source that turns isolation off as failing', async () => {
    // The report as doctor stores it since 01-25: the check fails and every measured Blocked
    // row is stored Not checked.
    const main = await showTrust(
      doctorReport(hostId, {
        sandboxIsolation: 'fail',
        probe: (rows) =>
          rows.map((row) => ({
            ...row,
            result: 'not-checked',
            evidence: `${NOT_COUNTED}${row.evidence}`,
          })),
      }),
      '10 checks did not pass',
    );
    const isolationRow = trustRow('Sandbox isolation settings');
    expect(await isolationRow.getByText('Fail', { exact: true }).count()).toBe(1);
    expect(await isolationRow.getByText(ISOLATION_FAIL, { exact: true }).count()).toBe(1);
    expect(await isolationRow.getByText(`Fix: ${ISOLATION_FIX}`, { exact: true }).count()).toBe(1);
    expect(await main.getByText('Blocked', { exact: true }).count()).toBe(0);
    expect(await main.getByText('10 checks did not pass', { exact: true }).count()).toBe(1);
    expect(await main.getByText('Agents are boxed in', { exact: true }).count()).toBe(0);
  });

  it('raises no Content Security Policy violation or page error', () => {
    const problems = consoleLines.filter((line) =>
      /Content Security Policy|Refused to (execute|load|apply)|pageerror/i.test(line),
    );
    expect(problems).toEqual([]);
  });
});

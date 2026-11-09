/// <reference lib="dom" />
// (playwright-core's published types name DOM element types.)
//
// UI-SPEC backstop screenshots (01-15): the heavy-data cases the UI-SPEC held out for a visual
// check, rendered in the real console at 1024 and 360 px wide, in light and dark, for the owner
// to review at the end of the phase. There is no pixel comparison in Phase 1.
//
//   node scripts/backstop.ts
//
// It builds the console, generates a 50-phase host (tests/helpers/large-host.ts) in scratch
// directories, starts the daemon from src/cli/main.ts on a free loopback port with a scratch home,
// signs in with playwright-core driving the system Chrome (CP_CHROME_PATH, or Chrome under
// /Volumes/Dock/Applications), then writes full-page PNGs to `.tmp/backstop/`:
//
//   phases-40          Phases list: 50 rows, the 300-character name (E3 overflow and long-text)
//   phase-detail-long  Phase 01: long name, 300-character objective, long user_setup, deep paths (E4)
//   mission-runway-40  Mission after every phase is approved: a 50-row runway list (E1 overflow)
//   needs-you-50       Needs You after every approval drifted: 50 items (E6 overflow)
//   change-view-1000   The change view of a 1,000-line diff with a 400-character line (E7 overflow)
//
// Scratch repos, homes and keys live under the repo's `.tmp/` (or CP_TEST_SCRATCH, which keeps the
// daemon's socket path short in a deep checkout) and are removed at the end. Nothing here touches
// ~/.ssh, ssh-agent, the Keychain, the real Counterpoint home or a real host repository.
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { type Browser, chromium, type Page } from 'playwright-core';
import { buildLargeHost } from '../tests/helpers/large-host.ts';
import { removeScratchDirs } from '../tests/helpers/scratch.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(REPO_ROOT, 'src', 'cli', 'main.ts');
const OUT_DIR = join(REPO_ROOT, '.tmp', 'backstop');
const CHROME =
  process.env.CP_CHROME_PATH ??
  '/Volumes/Dock/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const WIDTHS = [1024, 360] as const;
const THEMES = ['light', 'dark'] as const;
const VIEWPORT_HEIGHT = 900;
/** Chrome cannot capture taller than this in one image. */
const MAX_CAPTURE_HEIGHT = 16_000;
const PHASES = 50;
const BIG_DIFF_PHASE = '02';

const LINK_RE =
  /^Sign-in link \(works once\): (http:\/\/127\.0\.0\.1:\d+\/login\?code=[A-Za-z0-9_-]{43})$/m;

type Theme = (typeof THEMES)[number];

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
    timeout: 60_000,
  });
  return {
    exitCode: result.exitCode ?? -1,
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
}

async function waitFor(what: string, check: () => Promise<boolean>, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

/**
 * Full-page capture. When the app scrolls inside its own page-level container rather than the
 * document, the viewport is made as tall as that content first, so the whole list is in the
 * image. Only page-level scrollers (at least 80% of the viewport tall) count: a nested scroller
 * such as the 480 px diff block keeps its own height, which is exactly what E7 checks.
 */
async function capture(page: Page, file: string, width: number): Promise<void> {
  const height = await page.evaluate((viewportHeight) => {
    let tallest = document.documentElement.scrollHeight;
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const style = getComputedStyle(element);
      if (
        /(auto|scroll)/.test(style.overflowY) &&
        element.clientHeight >= viewportHeight * 0.8 &&
        element.scrollHeight > element.clientHeight
      ) {
        tallest = Math.max(tallest, element.scrollHeight + element.getBoundingClientRect().top);
      }
    }
    return Math.ceil(tallest);
  }, VIEWPORT_HEIGHT);
  const target = Math.min(Math.max(height, VIEWPORT_HEIGHT), MAX_CAPTURE_HEIGHT);
  await page.setViewportSize({ width, height: target });
  await page.waitForTimeout(300);
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
}

async function main(): Promise<void> {
  // The daemon serves dist/ui; build it so the screenshots show the current console.
  await execa('pnpm', ['build:ui'], { cwd: REPO_ROOT, stdio: 'inherit' });

  mkdirSync(OUT_DIR, { recursive: true });
  for (const name of readdirSync(OUT_DIR)) {
    if (name.endsWith('.png')) rmSync(join(OUT_DIR, name));
  }

  const host = await buildLargeHost({
    phases: PHASES,
    longName: true,
    longObjective: true,
    deepPath: true,
    longUserSetup: true,
  });
  const { home, root, hostId } = host;
  let browser: Browser | undefined;
  let started = false;
  const written: string[] = [];

  try {
    const start = await cli(['--port', '0', '--no-open'], home, root);
    if (start.exitCode !== 0) {
      throw new Error(`The daemon did not start (${start.exitCode}): ${start.stderr}`);
    }
    started = true;
    const link = LINK_RE.exec(start.stdout)?.[1];
    if (link === undefined) throw new Error('The daemon printed no sign-in link.');
    const origin = new URL(link).origin;

    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const context = await browser.newContext({
      viewport: { width: WIDTHS[0], height: VIEWPORT_HEIGHT },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(error.message));
    await page.goto(link);
    await page.waitForURL(`${origin}/h/${hostId}`);

    const main = () => page.getByRole('main');

    async function shoot(scenario: string, path: string, ready: () => Promise<void>) {
      for (const theme of THEMES) {
        await setTheme(theme);
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
          await page.goto(`${origin}${path}`);
          await ready();
          const file = join(OUT_DIR, `${scenario}-${width}-${theme}.png`);
          await capture(page, file, width);
          written.push(file);
        }
      }
    }

    async function setTheme(theme: Theme) {
      await page.evaluate((value) => {
        window.localStorage.setItem('counterpoint.theme', value);
      }, theme);
    }

    // Phases: 50 rows including the 300-character name.
    await shoot('phases-40', `/h/${hostId}/phases`, async () => {
      await main()
        .getByRole('link', { name: /^Phase 50:/ })
        .waitFor({ timeout: 30_000 });
    });

    // Phase 01: the long objective, user_setup entries and paths.
    await shoot('phase-detail-long', `/h/${hostId}/phases/01`, async () => {
      await main()
        .getByRole('heading', { name: /^Phase 01: Long Name/ })
        .waitFor({ timeout: 30_000 });
      await main().getByLabel('Inputs', { exact: true }).getByRole('table').waitFor();
    });

    // Every phase approved through the library: a 50-row runway.
    await host.approveAll();
    await shoot('mission-runway-40', `/h/${hostId}`, async () => {
      await main()
        .getByLabel('Runway', { exact: true })
        .getByRole('heading', { name: String(PHASES), exact: true })
        .waitFor({ timeout: 60_000 });
    });

    // Every approval drifted in one commit: 50 Needs You items.
    await host.driftAll({ bigDiffPhase: BIG_DIFF_PHASE });
    const items = () => main().getByRole('list', { name: 'Needs You items' }).getByRole('listitem');
    await page.goto(`${origin}/h/${hostId}/needs-you`);
    await waitFor(
      `${PHASES} Needs You items`,
      async () => (await items().count()) === PHASES,
      60_000,
    );
    await shoot('needs-you-50', `/h/${hostId}/needs-you`, async () => {
      await waitFor('the Needs You list', async () => (await items().count()) === PHASES);
    });

    // The 1,000-line diff, open in its CodeBlock.
    await shoot('change-view-1000', `/h/${hostId}/needs-you/phase-${BIG_DIFF_PHASE}`, async () => {
      await main()
        .getByText(`Changed decision 1 for part ${BIG_DIFF_PHASE}.`, { exact: false })
        .first()
        .waitFor({ timeout: 30_000 });
    });

    if (problems.length > 0) throw new Error(`Page errors: ${problems.join('; ')}`);
  } finally {
    await browser?.close();
    if (started) await cli(['stop'], home, root);
    removeScratchDirs();
  }

  console.log(`Wrote ${written.length} screenshots to ${OUT_DIR}:`);
  for (const file of written) console.log(`  ${file}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});

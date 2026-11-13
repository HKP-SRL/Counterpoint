/// <reference lib="dom" />
// (playwright-core's published types name DOM element types.)
//
// Backstop screenshots: the heavy-data cases held out of the automated tests for a visual
// check, rendered in the real console at 1024 and 360 px wide, in light and dark, for the owner
// to review. There is no pixel comparison yet (that arrives with design-drafts-visual-gate).
//
//   node scripts/backstop.ts
//
// It builds the console, generates a 50-change host (tests/helpers/large-host.ts) in scratch
// directories, starts the daemon from src/cli/main.ts on a free loopback port with a scratch home,
// signs in with playwright-core driving the system Chrome (CP_CHROME_PATH, or Chrome under
// /Volumes/Dock/Applications), then writes full-page PNGs to `.tmp/backstop/`:
//
//   changes-40          Changes list: 50 rows and the long title (list overflow, long text)
//   change-detail-long  change-01: long title, 300-character why, long owner steps, deep spec
//                       path (long text on the detail page)
//   mission-runway-40   Mission after `Approve all`: a 50-row runway list
//
// Scratch repos and homes live under the repo's `.tmp/` (or CP_TEST_SCRATCH, which keeps the
// daemon's socket path short in a deep checkout) and are removed at the end. Nothing here touches
// the real Counterpoint home or a real host repository.
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { type Browser, chromium, type Page } from 'playwright-core';
import { buildLargeHost } from '../tests/helpers/large-host.ts';
import { makeScratchDir, removeScratchDirs } from '../tests/helpers/scratch.ts';

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
const CHANGES = 50;

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

/**
 * Full-page capture. When the app scrolls inside its own page-level container rather than the
 * document, the viewport is made as tall as that content first, so the whole list is in the
 * image. Only page-level scrollers (at least 80% of the viewport tall) count: a nested scroller
 * such as the 480 px diff block keeps its own height, which is exactly what the long-diff case
 * checks.
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
    changes: CHANGES,
    longTitle: true,
    longWhy: true,
    deepPath: true,
    longOwnerSteps: true,
  });
  const { root, hostId } = host;
  const home = makeScratchDir('home');
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

    // Changes: 50 rows including the long title.
    await shoot('changes-40', `/h/${hostId}/changes`, async () => {
      await main()
        .getByRole('link', { name: /\(change-50\)$/ })
        .waitFor({ timeout: 30_000 });
    });

    // change-01: the long title, why, owner steps and spec path.
    await shoot('change-detail-long', `/h/${hostId}/changes/change-01`, async () => {
      await main()
        .getByRole('heading', { name: /^Long Title/ })
        .waitFor({ timeout: 30_000 });
    });

    // Every change approved with one click: a 50-row runway.
    await page.goto(`${origin}/h/${hostId}/changes`);
    await main()
      .getByRole('button', { name: /^Approve all/ })
      .click();
    await shoot('mission-runway-40', `/h/${hostId}`, async () => {
      await main()
        .getByLabel('Runway', { exact: true })
        .getByRole('heading', { name: String(CHANGES), exact: true })
        .waitFor({ timeout: 60_000 });
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

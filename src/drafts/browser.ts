// Element maps and screenshots of packed pages (design-drafts D-6, D-10), in headless Chromium
// through `playwright-core`, with the pages' scripts off.
//
// Drafts run no scripts, so the console cannot ask a page where its parts are. Counterpoint opens
// each packed page at phone (390 px) and desktop (1440 px) width and records, for every
// `data-cp-id`, its box, its text and the page's height. A part drawn with `display: contents` has
// no box of its own: its children's combined box is used.
//
// The browser: Playwright's own Chromium when it is installed, else a Chromium an older Playwright
// left in the same cache, else the installed Google Chrome. With none, NoBrowserError says so and
// the drafts service raises a Needs You card.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Browser, chromium } from 'playwright-core';
import type { DraftMaps, DraftWidth, PageMap } from '../core/store/drafts.ts';

export const WIDTHS: Record<DraftWidth, number> = { phone: 390, desktop: 1440 };
const VIEWPORT_HEIGHT: Record<DraftWidth, number> = { phone: 844, desktop: 900 };
const PAGE_TIMEOUT_MS = 30_000;

export class NoBrowserError extends Error {
  constructor() {
    super(
      'No browser to map drafts with: install Google Chrome, or run `npx playwright-core install chromium`.',
    );
    this.name = 'NoBrowserError';
  }
}

/** How to launch the browser that was found. */
export interface BrowserSpec {
  executablePath: string;
  label: string;
}

function playwrightCache(): string {
  const set = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (set !== undefined && set !== '' && set !== '0') return set;
  return platform() === 'darwin'
    ? join(homedir(), 'Library', 'Caches', 'ms-playwright')
    : join(homedir(), '.cache', 'ms-playwright');
}

/** Executables a Chromium build folder of the Playwright cache may hold. */
const CACHE_EXECUTABLES = [
  ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell'],
  ['chrome-headless-shell-mac-x64', 'chrome-headless-shell'],
  ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
  [
    'chrome-mac-arm64',
    'Google Chrome for Testing.app',
    'Contents',
    'MacOS',
    'Google Chrome for Testing',
  ],
  ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ['chrome-linux', 'chrome'],
];

function chromeCandidates(): string[] {
  const mac = 'Google Chrome.app/Contents/MacOS/Google Chrome';
  const found = [`/Applications/${mac}`, join(homedir(), 'Applications', mac)];
  if (platform() === 'darwin') {
    try {
      const apps = execFileSync('mdfind', ["kMDItemCFBundleIdentifier == 'com.google.Chrome'"], {
        encoding: 'utf8',
        timeout: 5000,
      });
      for (const app of apps.split('\n').filter((line) => line.endsWith('.app'))) {
        found.push(join(app, 'Contents', 'MacOS', 'Google Chrome'));
      }
    } catch {
      // Spotlight unavailable
    }
  }
  found.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium');
  return found;
}

/** The browser to use, or null when none is installed. */
export function findBrowser(): BrowserSpec | null {
  try {
    const own = chromium.executablePath();
    if (existsSync(own)) return { executablePath: own, label: "Playwright's Chromium" };
  } catch {
    // no build registered for this Playwright
  }
  const cache = playwrightCache();
  if (existsSync(cache)) {
    const builds = readdirSync(cache)
      .filter((name) => /^chromium(_headless_shell)?-\d+$/.test(name))
      .sort((a, b) => Number(b.split('-').at(-1)) - Number(a.split('-').at(-1)));
    for (const build of builds) {
      for (const parts of CACHE_EXECUTABLES) {
        const path = join(cache, build, ...parts);
        if (existsSync(path)) return { executablePath: path, label: `Playwright ${build}` };
      }
    }
  }
  for (const path of chromeCandidates()) {
    if (existsSync(path)) return { executablePath: path, label: 'Google Chrome' };
  }
  return null;
}

/** In the page: every part's box and text, and the page's height. */
function measure(): { height: number; parts: PageMap['parts'] } {
  const parts: PageMap['parts'] = [];
  for (const element of document.querySelectorAll<HTMLElement>('[data-cp-id]')) {
    let rect: DOMRect;
    if (getComputedStyle(element).display === 'contents') {
      const range = document.createRange();
      range.selectNodeContents(element);
      rect = range.getBoundingClientRect();
    } else {
      rect = element.getBoundingClientRect();
    }
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
    parts.push({
      id: element.getAttribute('data-cp-id') ?? '',
      x: Math.round(rect.left + window.scrollX),
      y: Math.round(rect.top + window.scrollY),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      text: text.length <= 160 ? text : `${text.slice(0, 159)}…`,
    });
  }
  const height = Math.max(
    document.documentElement.scrollHeight,
    document.body?.scrollHeight ?? 0,
    1,
  );
  return { height, parts };
}

export interface DraftBrowserOptions {
  /** Finds the browser (tests pass one that finds none). */
  find?: () => BrowserSpec | null;
}

/** One headless browser, launched on first use and closed when idle. */
export class DraftBrowser {
  readonly #find: () => BrowserSpec | null;
  #browser: Promise<Browser> | null = null;

  constructor(options: DraftBrowserOptions = {}) {
    this.#find = options.find ?? findBrowser;
  }

  async #launch(): Promise<Browser> {
    if (this.#browser === null) {
      const spec = this.#find();
      if (spec === null) throw new NoBrowserError();
      this.#browser = chromium.launch({ headless: true, executablePath: spec.executablePath });
      this.#browser.catch(() => {
        this.#browser = null;
      });
    }
    return this.#browser;
  }

  async #withPage<T>(
    width: DraftWidth,
    pagePath: string,
    fn: (page: import('playwright-core').Page) => Promise<T>,
  ): Promise<T> {
    const browser = await this.#launch();
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: WIDTHS[width], height: VIEWPORT_HEIGHT[width] },
      // Nothing leaves the machine: only file: URLs load.
      offline: true,
    });
    try {
      const page = await context.newPage();
      await page.route(/^(?!file:|data:)/, (route) => route.abort());
      await page.goto(pathToFileURL(pagePath).href, {
        waitUntil: 'load',
        timeout: PAGE_TIMEOUT_MS,
      });
      return await fn(page);
    } finally {
      await context.close();
    }
  }

  /** The page's element map at one width. */
  async map(pagePath: string, width: DraftWidth): Promise<PageMap> {
    return this.#withPage(width, pagePath, async (page) => {
      const measured = await page.evaluate(measure);
      return { width: WIDTHS[width], ...measured };
    });
  }

  /** The page's maps at phone and desktop width. */
  async maps(pagePath: string): Promise<DraftMaps> {
    return {
      phone: await this.map(pagePath, 'phone'),
      desktop: await this.map(pagePath, 'desktop'),
    };
  }

  /** A full-page PNG of the page at one width (the builder's reference, D-10). */
  async screenshot(pagePath: string, width: DraftWidth, outPath: string): Promise<void> {
    await this.#withPage(width, pagePath, async (page) => {
      await page.screenshot({ path: outPath, fullPage: true });
    });
  }

  async close(): Promise<void> {
    const browser = this.#browser;
    this.#browser = null;
    if (browser !== null) await (await browser.catch(() => null))?.close();
  }
}

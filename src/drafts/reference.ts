// The builder's reference (design-drafts D-10). At build start, when the change's folder has a
// `drafts/` folder at the build's base commit, its signed-off pages are copied into the worktree's
// `.cp-drafts/` and rendered to PNG at phone and desktop width there. `.cp-drafts/` is in the
// repository's `info/exclude` and left out of every session commit, so it never reaches the branch.
// The builder prompt's Reference screens section lists the files.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ReferenceScreen } from '../build/prompt.ts';
import type { GitFileReader } from '../core/framework/port.ts';
import { runGit } from '../core/git/run.ts';
import type { DraftWidth } from '../core/store/drafts.ts';
import { NoBrowserError } from './browser.ts';
import { PACKED_STYLES } from './pack.ts';

/** The worktree folder the reference is copied to (never committed). */
export const REFERENCE_DIR = '.cp-drafts';

const SEGMENT_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface ReferenceShooter {
  screenshot(pagePath: string, width: DraftWidth, outPath: string): Promise<void>;
}

/** Adds `/.cp-drafts/` to the repository's info/exclude (shared by its worktrees). */
export async function excludeReferenceDir(worktree: string): Promise<void> {
  const exclude = (
    await runGit(worktree, ['rev-parse', '--git-path', 'info/exclude'])
  ).stdout.trim();
  const path = exclude.startsWith('/') ? exclude : join(worktree, exclude);
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const line = `/${REFERENCE_DIR}/`;
  if (current.split('\n').includes(line)) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${current}${current === '' || current.endsWith('\n') ? '' : '\n'}${line}\n`);
}

/**
 * Copies the change's signed-off pages into the worktree and renders them (D-10). Returns the
 * screens for the prompt; none when the change has no drafts at the base. Without a browser the
 * HTML is still listed.
 */
export async function prepareReferenceScreens(input: {
  worktree: string;
  /** The change's repository-relative folder. */
  changeDir: string;
  reader: GitFileReader;
  baseCommit: string;
  shooter: ReferenceShooter | null;
}): Promise<ReferenceScreen[]> {
  const folder = `${input.changeDir}/drafts`;
  const entries = await input.reader.list(input.baseCommit, folder);
  if (entries.length === 0) return [];
  const out = join(input.worktree, REFERENCE_DIR);
  mkdirSync(out, { recursive: true });
  await excludeReferenceDir(input.worktree);
  const styles = await input.reader.read(input.baseCommit, `${folder}/${PACKED_STYLES}`);
  if (styles !== null) writeFileSync(join(out, PACKED_STYLES), styles);
  const screens: ReferenceScreen[] = [];
  let shooter = input.shooter;
  for (const dir of entries) {
    if (dir.type !== 'tree' || !SEGMENT_RE.test(dir.name)) continue;
    const files = await input.reader.list(input.baseCommit, dir.path);
    const hasSource = files.some((file) => file.name === 'source.md');
    if (hasSource) {
      const source = await input.reader.read(input.baseCommit, `${dir.path}/source.md`);
      if (source !== null) {
        mkdirSync(join(out, dir.name), { recursive: true });
        writeFileSync(join(out, dir.name, 'source.md'), source);
      }
    }
    for (const file of files) {
      const state = file.name.endsWith('.html') ? file.name.slice(0, -5) : '';
      if (file.type !== 'blob' || !SEGMENT_RE.test(state)) continue;
      const bytes = await input.reader.read(input.baseCommit, file.path);
      if (bytes === null) continue;
      mkdirSync(join(out, dir.name), { recursive: true });
      const html = join(out, dir.name, file.name);
      writeFileSync(html, bytes);
      const rel = (name: string) => `${REFERENCE_DIR}/${dir.name}/${name}`;
      const shots: Record<DraftWidth, string | null> = { phone: null, desktop: null };
      for (const width of ['phone', 'desktop'] as const) {
        if (shooter === null) break;
        const png = `${state}-${width}.png`;
        try {
          await shooter.screenshot(html, width, join(out, dir.name, png));
          shots[width] = rel(png);
        } catch (error) {
          if (!(error instanceof NoBrowserError)) throw error;
          shooter = null;
        }
      }
      screens.push({
        screen: dir.name,
        state,
        html: rel(file.name),
        source: hasSource ? rel('source.md') : null,
        phonePng: shots.phone,
        desktopPng: shots.desktop,
      });
    }
  }
  return screens;
}

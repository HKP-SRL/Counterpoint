// The core/adapter boundary (ADPT-02) as a meta-test, so the rule can never silently stop working.
//
// 1. Import restrictions: the repo's own biome.json is copied into a scratch project together with
//    deliberate violators, and the repo's own Biome binary must report every one of them.
// 2. Framework path literals: no `.ts` file under src/core may name a framework's files
//    (`.planning`, `ROADMAP`). Core learns framework facts only through the port: registration via
//    detectFramework, inputs via approvalInputs and their sourcePath.
import { copyFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterAll, describe, expect, it } from 'vitest';
import { makeScratchDir, removeScratchDirs, writeFileIn } from '../helpers/scratch.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIOME = join(REPO_ROOT, 'node_modules', '.bin', 'biome');

const CORE_MESSAGE = 'core must not import adapters';
const COMPOSE_MESSAGE = 'only src/compose.ts may import the GSD adapter';

const ALLOWED: Record<string, string> = {
  'src/core/framework/port.ts': 'export interface Port {\n  id: string;\n}\n',
  'src/adapters/gsd/index.ts':
    "import type { Port } from '../../core/framework/port.ts';\n\n" +
    "export const adapter: Port = { id: 'gsd' };\n",
  'src/compose.ts':
    "import { adapter } from './adapters/gsd/index.ts';\n\nexport const adapters = [adapter];\n",
};

/** Every import form from core into adapters, plus a non-compose module importing the adapter. */
const VIOLATORS: Record<string, { source: string; message: string }> = {
  'src/core/relative.ts': {
    source: "import { adapter } from '../adapters/gsd/index.ts';\n\nexport const a = adapter;\n",
    message: CORE_MESSAGE,
  },
  'src/core/type-only.ts': {
    source:
      "import type { adapter } from '../adapters/gsd/index.ts';\n\n" +
      'export type A = typeof adapter;\n',
    message: CORE_MESSAGE,
  },
  'src/core/dynamic.ts': {
    source:
      'export async function load(): Promise<unknown> {\n' +
      "  return import('../adapters/gsd/index.ts');\n}\n",
    message: CORE_MESSAGE,
  },
  'src/core/reexport.ts': {
    source: "export * from '../adapters/gsd/index.ts';\n",
    message: CORE_MESSAGE,
  },
  'src/core/alias.ts': {
    source: "import { adapter } from '#adapters/gsd';\n\nexport const a = adapter;\n",
    message: CORE_MESSAGE,
  },
  'src/server/x.ts': {
    source: "import { adapter } from '../adapters/gsd/index.ts';\n\nexport const a = adapter;\n",
    message: COMPOSE_MESSAGE,
  },
};

interface Diagnostic {
  file: string;
  rule: string;
  message: string;
}

/** Parses Biome's text reporter: `path:line:col lint/group/rule ━━━` then a `× message` line. */
function parseDiagnostics(output: string): Diagnostic[] {
  const re = /^(\S+?):\d+:\d+ (lint\/\S+)[^\n]*\n(?:[ \t]*\n)*[ \t]*× ([^\n]+)/gm;
  return [...output.matchAll(re)].map((match) => ({
    file: match[1] as string,
    rule: match[2] as string,
    message: (match[3] as string).trim(),
  }));
}

async function lintScratch(dir: string): Promise<{ exitCode: number; output: string }> {
  const result = await execa(
    BIOME,
    ['lint', `--config-path=${dir}`, '--colors=off', '--max-diagnostics=none', '.'],
    { cwd: dir, reject: false, all: true, stdin: 'ignore' },
  );
  return { exitCode: result.exitCode ?? -1, output: result.all ?? '' };
}

/** A scratch project linted with the repo's real biome.json and ignore file. */
function scratchProject(files: Record<string, string>): string {
  const dir = makeScratchDir('bnd');
  copyFileSync(join(REPO_ROOT, 'biome.json'), join(dir, 'biome.json'));
  // The config enables VCS ignore-file support, so Biome needs an ignore file at the root.
  copyFileSync(join(REPO_ROOT, '.gitignore'), join(dir, '.gitignore'));
  for (const [path, source] of Object.entries(files)) writeFileIn(dir, path, source);
  return dir;
}

interface LiteralHit {
  file: string;
  line: number;
  text: string;
}

const FRAMEWORK_LITERAL_RE = /ROADMAP|\.planning/;

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

/** Every line of every `.ts` file under `coreDir` that names a framework path. */
function frameworkLiterals(root: string, coreDir: string): LiteralHit[] {
  return tsFiles(join(root, coreDir)).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((text, index) =>
        FRAMEWORK_LITERAL_RE.test(text)
          ? [{ file: relative(root, file), line: index + 1, text: text.trim() }]
          : [],
      ),
  );
}

function describeHits(hits: LiteralHit[]): string {
  return hits.map((hit) => `${hit.file}:${hit.line}: ${hit.text}`).join('\n');
}

afterAll(() => {
  removeScratchDirs();
});

describe('import boundary (Biome noRestrictedImports with the real biome.json)', () => {
  it('reports every violating import form with the right message and exits non-zero', async () => {
    const sources = Object.fromEntries(
      Object.entries(VIOLATORS).map(([path, violator]) => [path, violator.source]),
    );
    const dir = scratchProject({ ...ALLOWED, ...sources });
    const { exitCode, output } = await lintScratch(dir);

    expect(exitCode, output).not.toBe(0);
    const diagnostics = parseDiagnostics(output);
    for (const [path, violator] of Object.entries(VIOLATORS)) {
      const found = diagnostics.filter((d) => d.file === path);
      expect(found, `${path} not reported:\n${output}`).not.toHaveLength(0);
      for (const diagnostic of found) {
        expect(diagnostic.rule).toBe('lint/style/noRestrictedImports');
        expect(diagnostic.message).toBe(violator.message);
      }
    }
    const flaggedAllowed = diagnostics.filter((d) => d.file in ALLOWED);
    expect(flaggedAllowed, output).toEqual([]);
  });

  it('lints clean once the violators are removed (compose and adapter imports are allowed)', async () => {
    const dir = scratchProject({ ...ALLOWED, 'src/server/ok.ts': 'export const ok = 1;\n' });
    for (const path of Object.keys(VIOLATORS)) rmSync(join(dir, path), { force: true });
    const { exitCode, output } = await lintScratch(dir);
    expect(exitCode, output).toBe(0);
    expect(parseDiagnostics(output)).toEqual([]);
  });
});

describe('framework path literals stay out of core', () => {
  it('finds none under the real src/core', () => {
    const hits = frameworkLiterals(REPO_ROOT, 'src/core');
    expect(hits, `framework path literals in core:\n${describeHits(hits)}`).toEqual([]);
  });

  it('bites: names the file and line of a literal planted in a scratch src/core', () => {
    const dir = makeScratchDir('lit');
    writeFileIn(dir, 'src/core/clean.ts', 'export const ok = 1;\n');
    writeFileIn(
      dir,
      'src/core/deep/leak.ts',
      "export const ok = 1;\n\nexport const roadmap = '.planning/ROADMAP.md';\n",
    );
    const hits = frameworkLiterals(dir, 'src/core');
    expect(hits).toEqual([
      {
        file: 'src/core/deep/leak.ts',
        line: 3,
        text: "export const roadmap = '.planning/ROADMAP.md';",
      },
    ]);
    expect(describeHits(hits)).toBe(
      "src/core/deep/leak.ts:3: export const roadmap = '.planning/ROADMAP.md';",
    );
  });
});

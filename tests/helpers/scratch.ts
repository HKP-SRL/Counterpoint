// Scratch directories and git repositories for tests.
//
// Scratch dirs live under the repo's own `.tmp/` (on /Volumes/Dock on the owner's machine), never
// under os.tmpdir() (internal disk). `CP_TEST_SCRATCH` overrides the root, e.g. when a deep
// checkout path would push a Unix socket under the scratch home past the 103-byte macOS limit.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRATCH_ROOT = process.env.CP_TEST_SCRATCH ?? join(REPO_ROOT, '.tmp');

const created: string[] = [];

/** Creates a short-named scratch directory and returns its realpath. */
export function makeScratchDir(prefix: string): string {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  const dir = realpathSync(mkdtempSync(join(SCRATCH_ROOT, `${prefix}-`)));
  created.push(dir);
  return dir;
}

/** Removes every scratch directory created by makeScratchDir in this process. */
export function removeScratchDirs(): void {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Environment for test-setup git calls: deterministic, ignores the developer's global and
 * system config. Setup calls also pass `-c core.hooksPath=/dev/null -c core.fsmonitor=false` so
 * hooks or fsmonitor commands a test plants are never triggered by the setup itself.
 */
function setupEnv(): Record<string, string> {
  const env: Record<string, string> = {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
  for (const key of ['PATH', 'HOME', 'LANG', 'TMPDIR'] as const) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/** Runs a test-setup git command in `dir` (hooks and fsmonitor disabled for this call only). */
export async function gitIn(dir: string, args: readonly string[]): Promise<string> {
  const result = await execa(
    'git',
    ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args],
    { cwd: dir, env: setupEnv(), extendEnv: false, stdin: 'ignore' },
  );
  return result.stdout;
}

/** `git init` with a fixed initial branch and local test identity; no commit signing. */
export async function initScratchRepo(
  dir: string,
  options: { branch?: string } = {},
): Promise<string> {
  const branch = options.branch ?? 'main';
  await gitIn(dir, ['-c', `init.defaultBranch=${branch}`, 'init', '-q']);
  await gitIn(dir, ['config', 'user.name', 'Counterpoint Test']);
  await gitIn(dir, ['config', 'user.email', 'test@counterpoint.invalid']);
  await gitIn(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
}

/** Writes `content` to `relPath` inside `dir`, creating parent directories. Returns the path. */
export function writeFileIn(dir: string, relPath: string, content: string | Uint8Array): string {
  const file = join(dir, relPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

/** Stages everything and commits it. Returns the new commit sha. */
export async function commitAll(dir: string, message = 'test commit'): Promise<string> {
  await gitIn(dir, ['add', '-A']);
  await gitIn(dir, ['commit', '-q', '--allow-empty', '-m', message]);
  return (await gitIn(dir, ['rev-parse', 'HEAD'])).trim();
}

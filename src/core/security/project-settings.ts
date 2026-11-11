// The host's committed project settings, `.claude/settings.json` (owner decision on spike 3.5:
// builder sessions load `--setting-sources user,project`).
//
// Builders run in a worktree made from a commit of the base branch and cannot edit `.claude/`
// there, so the project settings they load are exactly the committed file. Counterpoint reads it
// from git (never a working tree) and uses it twice:
// - the isolation check judges it like the user settings: no key may turn the sandbox off or
//   widen it (sandbox-isolation.ts, source kind `project`);
// - its execution-capable keys join the host's integrity baseline. Hooks run as the owner, outside
//   the sandbox, and so do the credential helpers and status line; plugins can bring hooks of their
//   own; `env` changes what every session and its commands see. A change to any of them needs the
//   owner's `y` at `counterpoint trust`, like a new git hook.
import { canonicalJson } from '../approvals/canonical.ts';
import { sha256Digest } from '../approvals/digest.ts';
import type { GitFileReader } from '../framework/port.ts';
import { createGitFileReader } from '../git/reader.ts';

export const PROJECT_SETTINGS_PATH = '.claude/settings.json';

/**
 * Top-level keys of a settings file that run a program or change what sessions run with
 * (https://code.claude.com/docs/en/settings, read 2026-11-11).
 */
export const PROJECT_EXEC_KEYS: readonly string[] = [
  'hooks',
  'disableAllHooks',
  'apiKeyHelper',
  'awsAuthRefresh',
  'awsCredentialExport',
  'gcpAuthRefresh',
  'otelHeadersHelper',
  'statusLine',
  'fileSuggestion',
  'enabledPlugins',
  'extraKnownMarketplaces',
  'env',
];

const MAX_BYTES = 1024 * 1024;

export type ProjectSettingsRead =
  | { state: 'absent' }
  | { state: 'read'; bytes: Uint8Array; settings: unknown }
  | { state: 'unreadable'; bytes: Uint8Array | null; problem: string };

/** The committed `.claude/settings.json` at the tip of `baseBranch` in the repository at `root`. */
export async function readProjectSettings(
  root: string,
  baseBranch: string,
): Promise<ProjectSettingsRead> {
  const reader = createGitFileReader(root);
  let bytes: Uint8Array | null;
  try {
    const tip = await reader.resolve(`refs/heads/${baseBranch}`);
    // No base branch yet (an empty repository): there is nothing a builder could load.
    if (tip === null) return { state: 'absent' };
    bytes = await reader.read(tip, PROJECT_SETTINGS_PATH);
  } catch (error) {
    return {
      state: 'unreadable',
      bytes: null,
      problem: (error as Error).message.split('\n')[0] ?? 'git error',
    };
  }
  if (bytes === null) return { state: 'absent' };
  return parseProjectSettings(bytes);
}

/** Parses settings bytes as Claude Code would: one JSON object. */
export function parseProjectSettings(bytes: Uint8Array): ProjectSettingsRead {
  if (bytes.byteLength > MAX_BYTES) return { state: 'unreadable', bytes, problem: 'too large' };
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const settings: unknown = JSON.parse(text);
    if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
      return { state: 'unreadable', bytes, problem: 'not a JSON object' };
    }
    return { state: 'read', bytes, settings };
  } catch {
    return { state: 'unreadable', bytes, problem: 'not valid JSON' };
  }
}

function valueDigest(value: unknown): string {
  try {
    return sha256Digest(canonicalJson(value));
  } catch {
    // A value canonical JSON refuses (a float in `env`, say) is still pinned, by its plain JSON.
    return sha256Digest(JSON.stringify(value) ?? 'undefined');
  }
}

/**
 * The integrity entries for the committed project settings: execution-capable key → `sha256:` of
 * its value. A file that cannot be parsed is pinned whole (`(file)` → `unparseable:sha256:…`),
 * since Claude Code may still read parts of it. Absent file: no entries.
 */
export function describeProjectSettings(read: ProjectSettingsRead): Record<string, string> {
  if (read.state === 'absent') return {};
  if (read.state === 'unreadable') {
    return {
      '(file)':
        read.bytes === null
          ? `unreadable:${read.problem}`
          : `unparseable:${sha256Digest(Buffer.from(read.bytes))}`,
    };
  }
  const settings = read.settings as Record<string, unknown>;
  const entries: Record<string, string> = {};
  for (const key of PROJECT_EXEC_KEYS) {
    if (Object.hasOwn(settings, key)) entries[key] = valueDigest(settings[key]);
  }
  return entries;
}

// --- The whole committed `.claude/` folder (owner decision 2026-11-11) ---------------------------
//
// Builders load more than the settings file from `.claude/`: skills, agents and commands, whose
// front matter can define hooks that run as the owner outside the sandbox, and `CLAUDE.md`, which
// steers every session. Rather than parse each of those formats, the owner chose to pin the whole
// committed folder: every entry under `.claude/` at the base tip, by git mode and object id. Any
// change to any file there needs the owner's `y` at `counterpoint trust`.

export const CLAUDE_FOLDER = '.claude';
/** Past this many entries the folder is pinned by its tree id alone. */
const MAX_FOLDER_ENTRIES = 2000;

/**
 * Every entry under `.claude/` at `commit`: repository-relative path → `git:<mode>:<oid>`. A
 * folder too large to list is pinned whole (`.claude` → `tree:<oid>`). No folder: no entries.
 */
export async function describeClaudeFolder(
  reader: GitFileReader,
  commit: string,
): Promise<Record<string, string>> {
  const top = (await reader.list(commit, '')).find((entry) => entry.path === CLAUDE_FOLDER);
  if (top === undefined) return {};
  if (top.type !== 'tree') return { [CLAUDE_FOLDER]: `git:${top.mode}:${top.oid}` };
  const entries: Record<string, string> = {};
  let count = 0;
  const walk = async (dir: string): Promise<boolean> => {
    for (const entry of await reader.list(commit, dir)) {
      if (entry.type === 'tree') {
        if (!(await walk(entry.path))) return false;
        continue;
      }
      count += 1;
      if (count > MAX_FOLDER_ENTRIES) return false;
      entries[entry.path] = `git:${entry.mode}:${entry.oid}`;
    }
    return true;
  };
  if (!(await walk(CLAUDE_FOLDER))) return { [CLAUDE_FOLDER]: `tree:${top.oid}` };
  return Object.fromEntries(Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** The `.claude/` folder at the tip of `baseBranch`; an unreadable folder is one entry saying so. */
export async function readClaudeFolder(
  root: string,
  baseBranch: string,
): Promise<Record<string, string>> {
  const reader = createGitFileReader(root);
  try {
    const tip = await reader.resolve(`refs/heads/${baseBranch}`);
    if (tip === null) return {};
    return await describeClaudeFolder(reader, tip);
  } catch (error) {
    return {
      [CLAUDE_FOLDER]: `unreadable:${(error as Error).message.split('\n')[0] ?? 'git error'}`,
    };
  }
}

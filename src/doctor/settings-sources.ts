// Where Claude Code keeps each settings source an agent session loads, and a read-only,
// fail-closed reader for them (01-25, replacement 2 for the scrub opt-out). The judge is
// src/core/security/sandbox-isolation.ts.
//
// The reader reads only the listed settings paths and writes nothing. It follows symbolic links on
// purpose: Counterpoint's own state uses O_NOFOLLOW reads against planted links, but here the
// reader must see exactly what Claude Code sees, and Claude Code follows links ("You can deploy any
// of these files as a symbolic link, and Claude Code reads the file the link leads to",
// https://code.claude.com/docs/en/managed-settings). After following links a source must be a
// regular JSON-object file of at most 1 MiB; anything else is `unreadable` (fail closed). Only a
// missing file (ENOENT, a dangling link included) is `absent`.
//
// Locations, each with the doc that names it:
// - user settings `{userConfigDir}/settings.json` and the server-managed cache
//   `{userConfigDir}/remote-settings.json` ("A startup that runs on the cache at
//   `~/.claude/remote-settings.json`", https://code.claude.com/docs/en/server-managed-settings).
//   agentEnv passes HOME and not CLAUDE_CONFIG_DIR, so `userConfigDir` is `{HOME}/.claude`.
// - the managed file `managed-settings.json` and the drop-ins in `managed-settings.d/`, in
//   `/Library/Application Support/ClaudeCode/` on macOS and `/etc/claude-code/` on Linux; Claude
//   Code merges "every `*.json` file in the directory in alphabetical order" and "ignores hidden
//   files and files that don't end in `.json`" (https://code.claude.com/docs/en/managed-settings,
//   "Where each mechanism stores the policy", "Split a file-based policy across teams").
// - the macOS configuration profile, "the `com.anthropic.claudecode` managed preferences domain"
//   (same page), read from macOS's managed preferences directory, device-wide and per user, and
//   converted with `/usr/bin/plutil` ("macOS's `plutil` reports the plist malformed" is how Claude
//   Code detects a bad one). plutil runs by absolute path with an argument array, no shell, stdin
//   ignored, a minimal env and a 10 s timeout.
// Each present managed source is read on its own, whatever Claude Code's precedence among them.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import type { SettingsSourceRead } from '../core/security/sandbox-isolation.ts';

const MAX_SETTINGS_BYTES = 1024 * 1024;
const PLUTIL = '/usr/bin/plutil';
const PLUTIL_TIMEOUT_MS = 10_000;
const PREFERENCES_FILE = 'com.anthropic.claudecode.plist';
const USER_NAME_RE = /^[A-Za-z0-9._-]+$/;
const MACOS_MANAGED_DIR = '/Library/Application Support/ClaudeCode';
const MACOS_PREFERENCES_DIR = '/Library/Managed Preferences';
const LINUX_MANAGED_DIR = '/etc/claude-code';

export interface SettingsSourceLocations {
  /** The user config directory an agent session reads (`{HOME}/.claude`). */
  userConfigDir: string;
  /** The managed settings system directory, or null on a platform without one. */
  managedDir: string | null;
  /** The macOS managed preferences directory, or null. */
  managedPreferencesDir: string | null;
  /** The user name for per-user managed preferences, or null. */
  userName: string | null;
  /** Set on a platform whose managed locations Counterpoint does not know; fails closed. */
  unsupportedPlatform?: string;
}

/**
 * Where Claude Code keeps each settings source on this machine. agentEnv passes HOME and not
 * CLAUDE_CONFIG_DIR, so an agent session reads its user files from `{HOME}/.claude`.
 */
export function defaultSettingsSourceLocations(
  homeDir: string,
  platform: NodeJS.Platform = process.platform,
  userName: string = userInfo().username,
): SettingsSourceLocations {
  const userConfigDir = join(homeDir, '.claude');
  if (platform === 'darwin') {
    return {
      userConfigDir,
      managedDir: MACOS_MANAGED_DIR,
      managedPreferencesDir: MACOS_PREFERENCES_DIR,
      userName,
    };
  }
  if (platform === 'linux') {
    return { userConfigDir, managedDir: LINUX_MANAGED_DIR, managedPreferencesDir: null, userName };
  }
  return {
    userConfigDir,
    managedDir: null,
    managedPreferencesDir: null,
    userName,
    unsupportedPlatform: platform,
  };
}

type JsonRead = Pick<SettingsSourceRead, 'state' | 'settings' | 'problem'>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Follows links; null when the path is a regular file of at most 1 MiB, else its read state. */
function checkFile(path: string): JsonRead | null {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return { state: 'unreadable', problem: 'not a regular file' };
    if (stat.size > MAX_SETTINGS_BYTES)
      return { state: 'unreadable', problem: 'larger than 1 MiB' };
    return null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { state: 'absent' };
    return { state: 'unreadable', problem: code ?? 'cannot be read' };
  }
}

/** Reads one JSON settings file the way Claude Code would see it (links followed). */
export function readJsonSettingsFile(path: string): JsonRead {
  const checked = checkFile(path);
  if (checked !== null) return checked;
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { state: 'absent' };
    return { state: 'unreadable', problem: code ?? 'cannot be read' };
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_SETTINGS_BYTES) {
    return { state: 'unreadable', problem: 'larger than 1 MiB' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: 'unreadable', problem: 'not valid JSON' };
  }
  if (!isPlainObject(parsed)) return { state: 'unreadable', problem: 'not a JSON object' };
  return { state: 'read', settings: parsed };
}

/** Converts a managed preferences plist with plutil; a present but unconvertible plist fails closed. */
async function readPlistSettingsFile(path: string): Promise<JsonRead> {
  const checked = checkFile(path);
  if (checked !== null) return checked;
  const invalid: JsonRead = { state: 'unreadable', problem: 'not a valid property list' };
  try {
    const result = await execa(PLUTIL, ['-convert', 'json', '-o', '-', path], {
      stdin: 'ignore',
      extendEnv: false,
      env: { PATH: '/usr/bin:/bin' },
      timeout: PLUTIL_TIMEOUT_MS,
      reject: false,
    });
    if (result.exitCode !== 0 || result.timedOut || typeof result.stdout !== 'string') {
      return invalid;
    }
    const parsed: unknown = JSON.parse(result.stdout);
    return isPlainObject(parsed) ? { state: 'read', settings: parsed } : invalid;
  } catch {
    return invalid;
  }
}

/** The `.json` drop-ins Claude Code reads, in its order; a directory it cannot list fails closed. */
function readDropIns(managedDir: string): SettingsSourceRead[] {
  const dir = join(managedDir, 'managed-settings.d');
  const unreadable = (problem: string): SettingsSourceRead[] => [
    {
      kind: 'managed-drop-in',
      label: 'managed settings drop-ins',
      path: dir,
      state: 'unreadable',
      problem,
    },
  ];
  let names: string[];
  try {
    if (!statSync(dir).isDirectory()) return unreadable('not a directory');
    names = readdirSync(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return [];
    return unreadable(code ?? 'cannot be listed');
  }
  return names
    .filter((name) => name.endsWith('.json') && !name.startsWith('.'))
    .sort()
    .map((name): SettingsSourceRead => {
      const path = join(dir, name);
      return {
        kind: 'managed-drop-in',
        label: `managed settings drop-in ${name}`,
        path,
        ...readJsonSettingsFile(path),
      };
    });
}

export interface ReadSettingsSourcesInput {
  /** The `--settings` value the agent session is launched with. */
  launchSettings: unknown;
  locations: SettingsSourceLocations;
}

/** Every settings source an agent session loads, in a fixed order, launch settings first. */
export async function readSettingsSources(
  input: ReadSettingsSourcesInput,
): Promise<SettingsSourceRead[]> {
  const { locations } = input;
  const sources: SettingsSourceRead[] = [
    {
      kind: 'launch',
      label: 'launch settings',
      path: null,
      state: 'read',
      settings: input.launchSettings,
    },
  ];
  const userPath = join(locations.userConfigDir, 'settings.json');
  sources.push({
    kind: 'user',
    label: 'user settings',
    path: userPath,
    ...readJsonSettingsFile(userPath),
  });
  const cachePath = join(locations.userConfigDir, 'remote-settings.json');
  sources.push({
    kind: 'server-managed-cache',
    label: 'server-managed settings cache',
    path: cachePath,
    ...readJsonSettingsFile(cachePath),
  });
  if (locations.unsupportedPlatform !== undefined) {
    sources.push({
      kind: 'managed-file',
      label: 'managed settings',
      path: null,
      state: 'unreadable',
      problem: 'platform not supported',
    });
  }
  if (locations.managedDir !== null) {
    const filePath = join(locations.managedDir, 'managed-settings.json');
    sources.push({
      kind: 'managed-file',
      label: 'managed settings file',
      path: filePath,
      ...readJsonSettingsFile(filePath),
    });
    sources.push(...readDropIns(locations.managedDir));
  }
  if (locations.managedPreferencesDir !== null) {
    const devicePath = join(locations.managedPreferencesDir, PREFERENCES_FILE);
    sources.push({
      kind: 'managed-preferences',
      label: 'managed preferences',
      path: devicePath,
      ...(await readPlistSettingsFile(devicePath)),
    });
    const { userName } = locations;
    if (userName !== null) {
      if (USER_NAME_RE.test(userName) && userName !== '.' && userName !== '..') {
        const userPlist = join(locations.managedPreferencesDir, userName, PREFERENCES_FILE);
        sources.push({
          kind: 'managed-preferences',
          label: `managed preferences for ${userName}`,
          path: userPlist,
          ...(await readPlistSettingsFile(userPlist)),
        });
      } else {
        sources.push({
          kind: 'managed-preferences',
          label: 'managed preferences for this user',
          path: null,
          state: 'unreadable',
          problem: 'unexpected user name',
        });
      }
    }
  }
  return sources;
}

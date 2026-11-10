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
import { readFileSync, statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import type { SettingsSourceRead } from '../core/security/sandbox-isolation.ts';

const MAX_SETTINGS_BYTES = 1024 * 1024;

export interface SettingsSourceLocations {
  /** The user config directory an agent session reads (`{HOME}/.claude`). */
  userConfigDir: string;
  /** The managed settings system directory, or null on a platform without one. */
  managedDir: string | null;
  /** The macOS managed preferences directory, or null. */
  managedPreferencesDir: string | null;
  /** The user name for per-user managed preferences, or null. */
  userName: string | null;
}

/**
 * Where Claude Code keeps each settings source on this machine. agentEnv passes HOME and not
 * CLAUDE_CONFIG_DIR, so an agent session reads its user files from `{HOME}/.claude`.
 */
export function defaultSettingsSourceLocations(
  homeDir: string,
  _platform: NodeJS.Platform = process.platform,
  userName: string = userInfo().username,
): SettingsSourceLocations {
  return {
    userConfigDir: join(homeDir, '.claude'),
    managedDir: null,
    managedPreferencesDir: null,
    userName,
  };
}

type JsonRead = Pick<SettingsSourceRead, 'state' | 'settings' | 'problem'>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads one JSON settings file the way Claude Code would see it (links followed). */
export function readJsonSettingsFile(path: string): JsonRead {
  let size: number;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return { state: 'unreadable', problem: 'not a regular file' };
    size = stat.size;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { state: 'absent' };
    return { state: 'unreadable', problem: code ?? 'cannot be read' };
  }
  if (size > MAX_SETTINGS_BYTES) return { state: 'unreadable', problem: 'larger than 1 MiB' };
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
  return sources;
}

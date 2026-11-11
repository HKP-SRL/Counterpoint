// The settings-source reader (replacement 2 for the scrub opt-out) over scratch locations
// only, and a source scan that keeps every test off the real settings sources.
//
// Every reader case here passes scratch SettingsSourceLocations built in this file. The
// default-locations cases compare returned paths as values and never hand them to the reader.
import {
  chmodSync,
  type Dirent,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  judgeSandboxIsolation,
  type SettingsSourceRead,
} from '../../src/core/security/sandbox-isolation.ts';
import { buildAgentSandboxSettings } from '../../src/core/security/sandbox-settings.ts';
import {
  defaultSettingsSourceLocations,
  readSettingsSources,
  type SettingsSourceLocations,
} from '../../src/doctor/settings-sources.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

afterAll(() => removeScratchDirs());

const MIB = 1024 * 1024;

interface Scratch {
  home: string;
  locations: SettingsSourceLocations;
}

/** Empty scratch locations: a user config dir, a managed dir and a preferences dir. */
function scratch(userName: string | null = 'tester'): Scratch {
  const home = makeScratchDir('ssrc');
  const userConfigDir = join(home, '.claude');
  const managedDir = join(home, 'managed');
  const managedPreferencesDir = join(home, 'prefs');
  for (const dir of [userConfigDir, managedDir, managedPreferencesDir]) mkdirSync(dir);
  return {
    home,
    locations: { userConfigDir, managedDir, managedPreferencesDir, userName },
  };
}

function launchSettings(home: string): unknown {
  return buildAgentSandboxSettings({
    homeDir: home,
    counterpointHome: join(home, 'cp-home'),
    signingKeyDir: join(home, 'keys'),
    ghConfigDir: join(home, '.config', 'gh'),
    hostGitDir: join(home, 'repo', '.git'),
  }).settings;
}

async function read(s: Scratch): Promise<SettingsSourceRead[]> {
  return readSettingsSources({ launchSettings: launchSettings(s.home), locations: s.locations });
}

const summary = (sources: SettingsSourceRead[]) =>
  sources.map((source) => [source.kind, source.label, source.state]);

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

describe('readSettingsSources', () => {
  it('reads the launch settings and records every empty location as absent', async () => {
    const s = scratch();
    const sources = await read(s);
    expect(summary(sources)).toEqual([
      ['launch', 'launch settings', 'read'],
      ['user', 'user settings', 'absent'],
      ['server-managed-cache', 'server-managed settings cache', 'absent'],
      ['managed-file', 'managed settings file', 'absent'],
      ['managed-preferences', 'managed preferences', 'absent'],
      ['managed-preferences', 'managed preferences for tester', 'absent'],
    ]);
    expect(sources.map((source) => source.path)).toEqual([
      null,
      join(s.locations.userConfigDir, 'settings.json'),
      join(s.locations.userConfigDir, 'remote-settings.json'),
      join(s.home, 'managed', 'managed-settings.json'),
      join(s.home, 'prefs', 'com.anthropic.claudecode.plist'),
      join(s.home, 'prefs', 'tester', 'com.anthropic.claudecode.plist'),
    ]);
    expect(judgeSandboxIsolation(sources, s.home).result).toBe('pass');
  });

  it('reports a managed file that lets commands run unsandboxed', async () => {
    const s = scratch();
    writeJson(join(s.home, 'managed', 'managed-settings.json'), {
      sandbox: { failIfUnavailable: false },
    });
    const sources = await read(s);
    const check = judgeSandboxIsolation(sources, s.home);
    expect(check.result).toBe('fail');
    expect(check.sources.find((source) => source.kind === 'managed-file')).toMatchObject({
      state: 'read',
      findings: ['sandbox.failIfUnavailable'],
    });
  });

  it('reads only the visible .json drop-ins, in alphabetical order, each as its own source', async () => {
    const s = scratch();
    const dropIns = join(s.home, 'managed', 'managed-settings.d');
    mkdirSync(dropIns);
    writeJson(join(dropIns, '20-b.json'), { sandbox: { enabled: false } });
    writeJson(join(dropIns, '10-a.json'), {});
    writeJson(join(dropIns, '.hidden.json'), { sandbox: { enabled: false } });
    writeFileSync(join(dropIns, 'notes.txt'), 'not settings');
    const sources = await read(s);
    const dropInSources = sources.filter((source) => source.kind === 'managed-drop-in');
    expect(dropInSources.map((source) => [source.label, source.path, source.state])).toEqual([
      ['managed settings drop-in 10-a.json', join(dropIns, '10-a.json'), 'read'],
      ['managed settings drop-in 20-b.json', join(dropIns, '20-b.json'), 'read'],
    ]);
    // Drop-ins come right after the managed file.
    const kinds = sources.map((source) => source.kind);
    expect(kinds.indexOf('managed-drop-in')).toBe(kinds.indexOf('managed-file') + 1);
    const check = judgeSandboxIsolation(sources, s.home);
    expect(check.result).toBe('fail');
    expect(check.detail).toContain('managed settings drop-in 20-b.json sets sandbox.enabled');
  });

  it('fails closed when managed-settings.d is a file', async () => {
    const s = scratch();
    writeFileSync(join(s.home, 'managed', 'managed-settings.d'), '{}');
    const sources = await read(s);
    const dropIns = sources.filter((source) => source.kind === 'managed-drop-in');
    expect(dropIns).toHaveLength(1);
    expect(dropIns[0]).toMatchObject({ state: 'unreadable', problem: 'not a directory' });
    expect(judgeSandboxIsolation(sources, s.home).result).toBe('fail');
  });

  it('fails closed when managed-settings.d cannot be listed', async () => {
    const s = scratch();
    const dropIns = join(s.home, 'managed', 'managed-settings.d');
    mkdirSync(dropIns);
    writeJson(join(dropIns, '10-a.json'), {});
    chmodSync(dropIns, 0o000);
    try {
      const sources = await read(s);
      const found = sources.filter((source) => source.kind === 'managed-drop-in');
      expect(found).toHaveLength(1);
      expect(found[0]?.state).toBe('unreadable');
      expect(judgeSandboxIsolation(sources, s.home).result).toBe('fail');
    } finally {
      chmodSync(dropIns, 0o700);
    }
  });

  it('follows a symbolic link to the user settings and reports what it holds', async () => {
    const s = scratch();
    const target = join(s.home, 'dotfiles', 'settings.json');
    writeJson(target, { sandbox: { filesystem: { disabled: true } } });
    symlinkSync(target, join(s.locations.userConfigDir, 'settings.json'));
    const sources = await read(s);
    const check = judgeSandboxIsolation(sources, s.home);
    expect(check.result).toBe('fail');
    expect(check.sources.find((source) => source.kind === 'user')).toMatchObject({
      state: 'read',
      findings: ['sandbox.filesystem.disabled'],
    });
  });

  it('records a dangling user settings link as absent', async () => {
    const s = scratch();
    symlinkSync(join(s.home, 'nowhere.json'), join(s.locations.userConfigDir, 'settings.json'));
    const user = (await read(s)).find((source) => source.kind === 'user');
    expect(user?.state).toBe('absent');
  });

  it.each([
    ['a directory', 'not a regular file'],
    ['a file over 1 MiB', 'larger than 1 MiB'],
    ['invalid JSON', 'not valid JSON'],
    ['a JSON array', 'not a JSON object'],
  ])('reads a user settings path that is %s as unreadable, never absent', async (what, problem) => {
    const s = scratch();
    const path = join(s.locations.userConfigDir, 'settings.json');
    if (what === 'a directory') mkdirSync(path);
    if (what === 'a file over 1 MiB') writeFileSync(path, ' '.repeat(MIB + 1));
    if (what === 'invalid JSON') writeFileSync(path, '{ "sandbox": ');
    if (what === 'a JSON array') writeFileSync(path, '[]');
    const sources = await read(s);
    const user = sources.find((source) => source.kind === 'user');
    expect(user).toMatchObject({ state: 'unreadable', problem });
    expect(user?.settings).toBeUndefined();
    const check = judgeSandboxIsolation(sources, s.home);
    expect(check.result).toBe('fail');
    expect(check.detail).toBe(
      `Couldn't read user settings (~/.claude/settings.json): ${problem}. Claude Code may apply settings Counterpoint cannot check.`,
    );
  });

  it('reads a file of exactly 1 MiB', async () => {
    const s = scratch();
    const path = join(s.locations.userConfigDir, 'settings.json');
    writeFileSync(path, `{}${' '.repeat(MIB - 2)}`);
    expect(statSync(path).size).toBe(MIB);
    const user = (await read(s)).find((source) => source.kind === 'user');
    expect(user?.state).toBe('read');
  });

  it('reports the server-managed cache', async () => {
    const s = scratch();
    writeJson(join(s.locations.userConfigDir, 'remote-settings.json'), {
      sandbox: { excludedCommands: ['x'] },
    });
    const check = judgeSandboxIsolation(await read(s), s.home);
    expect(check.result).toBe('fail');
    expect(check.sources.find((source) => source.kind === 'server-managed-cache')).toMatchObject({
      label: 'server-managed settings cache',
      path: '~/.claude/remote-settings.json',
      state: 'read',
      findings: ['sandbox.excludedCommands'],
    });
  });

  it('adds nothing for null locations', async () => {
    const s = scratch(null);
    const sources = await readSettingsSources({
      launchSettings: launchSettings(s.home),
      locations: { ...s.locations, managedDir: null, managedPreferencesDir: null },
    });
    expect(summary(sources)).toEqual([
      ['launch', 'launch settings', 'read'],
      ['user', 'user settings', 'absent'],
      ['server-managed-cache', 'server-managed settings cache', 'absent'],
    ]);
  });

  it('fails closed on a user name that cannot be a path segment', async () => {
    const s = scratch('../other');
    const prefs = (await read(s)).filter((source) => source.kind === 'managed-preferences');
    expect(prefs.map((source) => [source.state, source.problem])).toEqual([
      ['absent', undefined],
      ['unreadable', 'unexpected user name'],
    ]);
  });

  it('adds one unreadable managed source on an unsupported platform', async () => {
    const s = scratch(null);
    const sources = await readSettingsSources({
      launchSettings: launchSettings(s.home),
      locations: {
        userConfigDir: s.locations.userConfigDir,
        managedDir: null,
        managedPreferencesDir: null,
        userName: null,
        unsupportedPlatform: 'win32',
      },
    });
    const managed = sources.filter((source) => source.kind === 'managed-file');
    expect(managed).toEqual([
      {
        kind: 'managed-file',
        label: 'managed settings',
        path: null,
        state: 'unreadable',
        problem: 'platform not supported',
      },
    ]);
    expect(judgeSandboxIsolation(sources, s.home).result).toBe('fail');
  });

  it('lists every read source in the pass detail, and stores no settings value', async () => {
    const s = scratch();
    writeJson(join(s.locations.userConfigDir, 'settings.json'), {
      theme: 'dark-secret-theme',
      sandbox: { excludedCommands: [] },
    });
    writeJson(join(s.home, 'managed', 'managed-settings.json'), { model: 'secret-model' });
    const check = judgeSandboxIsolation(await read(s), s.home);
    expect(check.result).toBe('pass');
    expect(check.detail).toBe(
      'No settings source Claude Code loads for agent sessions turns sandbox isolation off (3 checked: launch settings, user settings, managed settings file).',
    );
    const stored = JSON.stringify(check);
    expect(stored).not.toContain('secret');
  });
});

const PLIST_HEAD =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n';

function plist(body: string): string {
  return `${PLIST_HEAD}<plist version="1.0">\n<dict>${body}</dict>\n</plist>\n`;
}

const UNSANDBOXED_PLIST = plist(
  '<key>sandbox</key><dict><key>allowUnsandboxedCommands</key><true/></dict>',
);

describe.skipIf(process.platform !== 'darwin')(
  'managed preferences plist (real /usr/bin/plutil)',
  () => {
    it('reports a device-level plist that allows unsandboxed retries', async () => {
      const s = scratch();
      writeFileSync(join(s.home, 'prefs', 'com.anthropic.claudecode.plist'), UNSANDBOXED_PLIST);
      const check = judgeSandboxIsolation(await read(s), s.home);
      expect(check.result).toBe('fail');
      expect(check.detail).toBe(
        'managed preferences sets sandbox.allowUnsandboxedCommands to true, which lets a failed command retry outside the sandbox.',
      );
      expect(check.sources.filter((source) => source.kind === 'managed-preferences')).toEqual([
        {
          kind: 'managed-preferences',
          label: 'managed preferences',
          path: '~/prefs/com.anthropic.claudecode.plist',
          state: 'read',
          findings: ['sandbox.allowUnsandboxedCommands'],
        },
        {
          kind: 'managed-preferences',
          label: 'managed preferences for tester',
          path: '~/prefs/tester/com.anthropic.claudecode.plist',
          state: 'absent',
          findings: [],
        },
      ]);
    });

    it('reports a per-user plist under the user name', async () => {
      const s = scratch();
      mkdirSync(join(s.home, 'prefs', 'tester'));
      writeFileSync(
        join(s.home, 'prefs', 'tester', 'com.anthropic.claudecode.plist'),
        UNSANDBOXED_PLIST,
      );
      const check = judgeSandboxIsolation(await read(s), s.home);
      expect(check.result).toBe('fail');
      expect(check.detail).toMatch(
        /^managed preferences for tester sets sandbox\.allowUnsandboxedCommands to true, /,
      );
    });

    it('reads a plist with a safe sandbox block as passing', async () => {
      const s = scratch();
      writeFileSync(
        join(s.home, 'prefs', 'com.anthropic.claudecode.plist'),
        plist('<key>sandbox</key><dict><key>enabled</key><true/></dict>'),
      );
      const sources = await read(s);
      expect(sources.find((source) => source.label === 'managed preferences')?.state).toBe('read');
      expect(judgeSandboxIsolation(sources, s.home).result).toBe('pass');
    });

    it('fails closed on a malformed plist', async () => {
      const s = scratch();
      writeFileSync(join(s.home, 'prefs', 'com.anthropic.claudecode.plist'), '<plist><dict><key>');
      const prefs = (await read(s)).find((source) => source.label === 'managed preferences');
      expect(prefs).toMatchObject({ state: 'unreadable', problem: 'not a valid property list' });
    });
  },
);

describe('defaultSettingsSourceLocations', () => {
  it('names the macOS managed locations', () => {
    expect(defaultSettingsSourceLocations('/Users/someone', 'darwin', 'someone')).toEqual({
      userConfigDir: '/Users/someone/.claude',
      managedDir: '/Library/Application Support/ClaudeCode',
      managedPreferencesDir: '/Library/Managed Preferences',
      userName: 'someone',
    });
  });

  it('names the Linux managed directory and no preferences', () => {
    expect(defaultSettingsSourceLocations('/home/someone', 'linux', 'someone')).toEqual({
      userConfigDir: '/home/someone/.claude',
      managedDir: '/etc/claude-code',
      managedPreferencesDir: null,
      userName: 'someone',
    });
  });

  it('flags any other platform as unsupported', () => {
    expect(defaultSettingsSourceLocations('C:/Users/someone', 'win32', 'someone')).toEqual({
      userConfigDir: join('C:/Users/someone', '.claude'),
      managedDir: null,
      managedPreferencesDir: null,
      userName: 'someone',
      unsupportedPlatform: 'win32',
    });
  });
});

// --- source scan --------------------------------------------------------------------------------

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SELF = 'tests/doctor/settings-sources.test.ts';
/** The doctor entry points. Named only in this list, so this file never holds a call to them. */
const DOCTOR_FUNCTIONS = ['runDoctor', 'doctorCommand'];
const READER_FUNCTIONS = ['readSettingsSources'];
const REQUIRED_KEY = 'settingsLocations';
const DEFAULTS = 'defaultSettingsSourceLocations';
const REAL_PATH_TOKENS = ['homedir(', '/Library/', '/etc/'];

interface ScanOffender {
  line: number;
  reason: string;
}

function isCommentLine(line: string): boolean {
  const start = line.trimStart();
  return start.startsWith('//') || start.startsWith('/*') || start.startsWith('*');
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/**
 * Finds every call of one of `names` (case-sensitive, after a word boundary, then optional
 * whitespace and `(`), outside comment lines, and checks its argument text: from the `(` to the
 * balanced closing `)`, strings not parsed. A call whose arguments lack `requiredKey` (when
 * given) or name a forbidden token is an offender; so is a call whose closing parenthesis is
 * never found (fail closed).
 */
function scanCalls(
  text: string,
  names: readonly string[],
  requiredKey: string | null,
  forbidden: readonly string[],
): { calls: number; offenders: ScanOffender[] } {
  const pattern = new RegExp(`(?<![A-Za-z0-9_$])(${names.join('|')})\\s*\\(`, 'g');
  const lines = text.split('\n');
  const offenders: ScanOffender[] = [];
  let calls = 0;
  for (const match of text.matchAll(pattern)) {
    const line = lineAt(text, match.index);
    if (isCommentLine(lines[line - 1] ?? '')) continue;
    calls += 1;
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close < 0) {
      offenders.push({ line, reason: `${match[1]} call has no closing parenthesis` });
      continue;
    }
    const args = text.slice(open, close + 1);
    if (requiredKey !== null && !args.includes(requiredKey)) {
      offenders.push({ line, reason: `${match[1]} call does not name ${requiredKey}` });
    }
    for (const token of forbidden) {
      if (args.includes(token)) offenders.push({ line, reason: `${match[1]} call names ${token}` });
    }
  }
  return { calls, offenders };
}

function testFiles(dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...testFiles(path));
    else if (/\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

function scanTree(): { calls: number; offenders: string[] } {
  const files = [
    ...testFiles(join(REPO_ROOT, 'tests')),
    ...testFiles(join(REPO_ROOT, 'ui', 'tests')),
  ];
  const offenders: string[] = [];
  let calls = 0;
  for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    const text = readFileSync(file, 'utf8');
    // Rule A: every doctor call names scratch settingsLocations and no real location.
    const doctor = scanCalls(text, DOCTOR_FUNCTIONS, REQUIRED_KEY, [DEFAULTS, ...REAL_PATH_TOKENS]);
    calls += doctor.calls;
    for (const o of doctor.offenders) offenders.push(`${rel}:${o.line}: A (${o.reason})`);
    // Rule B: the default locations are named only here, and never handed to the reader.
    if (rel !== SELF) {
      text.split('\n').forEach((line, index) => {
        if (line.includes(DEFAULTS)) offenders.push(`${rel}:${index + 1}: B (names ${DEFAULTS})`);
      });
    }
    const reader = scanCalls(text, READER_FUNCTIONS, null, [DEFAULTS]);
    for (const o of reader.offenders) offenders.push(`${rel}:${o.line}: B (${o.reason})`);
    // Rule C: a file that runs doctor names no real location on any non-comment line, so a
    // file-local helper's overrides cannot reach one either.
    if (doctor.calls > 0) {
      text.split('\n').forEach((line, index) => {
        if (isCommentLine(line)) return;
        for (const token of REAL_PATH_TOKENS) {
          if (line.includes(token)) offenders.push(`${rel}:${index + 1}: C (names ${token})`);
        }
      });
    }
  }
  return { calls, offenders };
}

describe('tests never read the real settings sources', () => {
  it('finds every doctor call under tests/ and ui/tests/ passing scratch settingsLocations', () => {
    const { calls, offenders } = scanTree();
    expect(offenders).toEqual([]);
    // Non-vacuous: the helper's call and the no-host case in tests/doctor/doctor.test.ts at least.
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('checks its own extractor on in-memory snippets', () => {
    const names = ['probeCall'];
    const snippet = [
      'const a = probeCall(home, { settingsLocations: scratch });', // 1: names the key
      'const b = probeCall(home, {});', // 2: lacks the key
      'const c = probeCall(home, { settingsLocations: x, other: "/etc/x" });', // 3: forbidden
      '// probeCall(home) in a comment', // 4: skipped
      'const d = myprobeCall(home);', // 5: not a call of the name
      'const e = probeCall (home, {', // 6: never closed
    ].join('\n');
    const { calls, offenders } = scanCalls(snippet, names, REQUIRED_KEY, REAL_PATH_TOKENS);
    expect(calls).toBe(4);
    expect(offenders).toEqual([
      { line: 2, reason: 'probeCall call does not name settingsLocations' },
      { line: 3, reason: 'probeCall call names /etc/' },
      { line: 6, reason: 'probeCall call has no closing parenthesis' },
    ]);
  });
});

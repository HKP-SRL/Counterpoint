// The Sandbox isolation settings judge (01-25, replacement 2 for the scrub opt-out): pure, over
// in-memory sources. No settings file is read here.
import { describe, expect, it } from 'vitest';
import { SandboxIsolationCheck } from '../../../src/core/security/doctor-report.ts';
import {
  ISOLATION_RULES,
  judgeSandboxIsolation,
  type SettingsSourceKind,
  type SettingsSourceRead,
} from '../../../src/core/security/sandbox-isolation.ts';
import { buildAgentSandboxSettings } from '../../../src/core/security/sandbox-settings.ts';

const HOME = '/nonexistent-cp-isolation/home';

/** The 01-24 launch profile, built by the production builder (no file is read or written). */
function launchSettings(): Record<string, unknown> {
  const base = '/nonexistent-cp-isolation';
  return buildAgentSandboxSettings({
    homeDir: HOME,
    counterpointHome: `${base}/cp-home`,
    signingKeyDir: `${base}/keys`,
    ghConfigDir: `${HOME}/.config/gh`,
    hostGitDir: `${base}/repo/.git`,
  }).settings as unknown as Record<string, unknown>;
}

function launch(settings: unknown = launchSettings()): SettingsSourceRead {
  return { kind: 'launch', label: 'launch settings', path: null, state: 'read', settings };
}

function user(settings: unknown): SettingsSourceRead {
  return {
    kind: 'user',
    label: 'user settings',
    path: `${HOME}/.claude/settings.json`,
    state: 'read',
    settings,
  };
}

const SOURCE_OF_KIND: Record<
  Exclude<SettingsSourceKind, 'launch'>,
  { label: string; path: string }
> = {
  user: { label: 'user settings', path: `${HOME}/.claude/settings.json` },
  'server-managed-cache': {
    label: 'server-managed settings cache',
    path: `${HOME}/.claude/remote-settings.json`,
  },
  'managed-file': {
    label: 'managed settings file',
    path: '/Library/Application Support/ClaudeCode/managed-settings.json',
  },
  'managed-drop-in': {
    label: 'managed settings drop-in 10-a.json',
    path: '/Library/Application Support/ClaudeCode/managed-settings.d/10-a.json',
  },
  'managed-preferences': {
    label: 'managed preferences',
    path: '/Library/Managed Preferences/com.anthropic.claudecode.plist',
  },
};

function ofKind(
  kind: Exclude<SettingsSourceKind, 'launch'>,
  settings: unknown,
): SettingsSourceRead {
  return { kind, ...SOURCE_OF_KIND[kind], state: 'read', settings };
}

/** `{ sandbox: { a: { b: value } } }` for the dotted key `sandbox.a.b`. */
function setting(key: string, value: unknown): Record<string, unknown> {
  const parts = key.split('.');
  let node: unknown = value;
  for (const part of parts.reverse()) node = { [part]: node };
  return node as Record<string, unknown>;
}

/** The launch profile with one sandbox key replaced (or removed with `undefined`). */
function launchWith(key: string, value: unknown): Record<string, unknown> {
  const settings = structuredClone(launchSettings()) as {
    sandbox: Record<string, unknown> & { filesystem: Record<string, unknown> };
  };
  const [, second, third] = key.split('.');
  const target = third === undefined ? settings.sandbox : settings.sandbox.filesystem;
  const name = (third ?? second) as string;
  if (value === undefined) delete target[name];
  else target[name] = value;
  return settings;
}

const UNSAFE: Record<string, unknown> = {
  'sandbox.filesystem.disabled': true,
  'sandbox.excludedCommands': ['docker *'],
  'sandbox.enabled': false,
  'sandbox.failIfUnavailable': false,
  'sandbox.allowUnsandboxedCommands': true,
  'sandbox.autoAllowBashIfSandboxed': true,
  'sandbox.allowAppleEvents': true,
};

describe('judgeSandboxIsolation', () => {
  it('passes the 01-24 launch profile with nothing else present', () => {
    const check = judgeSandboxIsolation([launch()], HOME);
    expect(check.result).toBe('pass');
    expect(check.id).toBe('sandbox-isolation');
    expect(check.label).toBe('Sandbox isolation settings');
    expect(check.detail).toBe(
      'No settings source Claude Code loads for agent sessions turns sandbox isolation off (1 checked: launch settings).',
    );
    expect(check.fix).toBeUndefined();
    expect(SandboxIsolationCheck.parse(check)).toEqual(check);
  });

  it('fails a user source that turns filesystem isolation off, with the source and a fix', () => {
    const check = judgeSandboxIsolation(
      [launch(), user({ sandbox: { filesystem: { disabled: true } } })],
      HOME,
    );
    expect(check.result).toBe('fail');
    expect(check.detail).toBe(
      'user settings sets sandbox.filesystem.disabled to true, which turns filesystem isolation off.',
    );
    expect(check.fix).toBe(
      'Remove sandbox.filesystem.disabled from ~/.claude/settings.json, then run "counterpoint doctor" again.',
    );
    expect(check.sources).toEqual([
      { kind: 'launch', label: 'launch settings', path: null, state: 'read', findings: [] },
      {
        kind: 'user',
        label: 'user settings',
        path: '~/.claude/settings.json',
        state: 'read',
        findings: ['sandbox.filesystem.disabled'],
      },
    ]);
  });

  it('counts a quoted "true" and fails closed on an unrecognised value; false and "false" pass', () => {
    const judge = (disabled: unknown) =>
      judgeSandboxIsolation([launch(), user({ sandbox: { filesystem: { disabled } } })], HOME);
    expect(judge('true').result).toBe('fail');
    expect(judge('true').detail).toContain('to "true", which');
    expect(judge(1).result).toBe('fail');
    expect(judge(1).detail).toContain('to a number, which');
    expect(judge(null).result).toBe('fail');
    expect(judge(false).result).toBe('pass');
    expect(judge('false').result).toBe('pass');
  });

  it('fails a non-empty excludedCommands, shown as an entry count; an empty list passes', () => {
    const one = judgeSandboxIsolation(
      [launch(), user({ sandbox: { excludedCommands: ['docker *'] } })],
      HOME,
    );
    expect(one.result).toBe('fail');
    expect(one.detail).toBe(
      'user settings sets sandbox.excludedCommands to 1 entry, which runs those commands outside the sandbox.',
    );
    expect(one.detail).not.toContain('docker');
    const two = judgeSandboxIsolation(
      [launch(), user({ sandbox: { excludedCommands: ['a', 'b'] } })],
      HOME,
    );
    expect(two.detail).toContain('to 2 entries');
    const empty = judgeSandboxIsolation(
      [launch(), user({ sandbox: { excludedCommands: [] } })],
      HOME,
    );
    expect(empty.result).toBe('pass');
  });

  it('lets the launch flag outrank a user sandbox.enabled false, but not a managed one', () => {
    const fromUser = judgeSandboxIsolation([launch(), user({ sandbox: { enabled: false } })], HOME);
    expect(fromUser.result).toBe('pass');
    expect(fromUser.detail).toContain('(2 checked: launch settings, user settings)');
    const fromManaged = judgeSandboxIsolation(
      [launch(), ofKind('managed-file', { sandbox: { enabled: false } })],
      HOME,
    );
    expect(fromManaged.result).toBe('fail');
    expect(fromManaged.detail).toBe(
      'managed settings file sets sandbox.enabled to false, which turns the sandbox off.',
    );
    expect(fromManaged.fix).toBe(
      'Ask your administrator to remove sandbox.enabled from managed settings file (/Library/Application Support/ClaudeCode/managed-settings.json), then run "counterpoint doctor" again.',
    );
  });

  it('fails a launch source that leaves autoAllowBashIfSandboxed unset', () => {
    const check = judgeSandboxIsolation(
      [launch(launchWith('sandbox.autoAllowBashIfSandboxed', undefined))],
      HOME,
    );
    expect(check.result).toBe('fail');
    expect(check.detail).toBe(
      "launch settings does not set sandbox.autoAllowBashIfSandboxed, so Claude Code's default auto-approves sandboxed commands.",
    );
    expect(check.fix).toBe(
      'Counterpoint\'s launch settings must set sandbox.autoAllowBashIfSandboxed to false. This is a Counterpoint bug: update Counterpoint, then run "counterpoint doctor" again.',
    );
  });

  it('fails closed on an unreadable source and names it', () => {
    const check = judgeSandboxIsolation(
      [
        launch(),
        {
          kind: 'user',
          label: 'user settings',
          path: `${HOME}/.claude/settings.json`,
          state: 'unreadable',
          problem: 'not valid JSON',
        },
      ],
      HOME,
    );
    expect(check.result).toBe('fail');
    expect(check.detail).toBe(
      "Couldn't read user settings (~/.claude/settings.json): not valid JSON. Claude Code may apply settings Counterpoint cannot check.",
    );
    expect(check.fix).toBe(
      'Fix or remove ~/.claude/settings.json, then run "counterpoint doctor" again.',
    );
    expect(check.sources[1]).toMatchObject({ state: 'unreadable', findings: [] });
  });

  it('names the first of two findings and counts the rest', () => {
    const check = judgeSandboxIsolation(
      [launch(), user({ sandbox: { filesystem: { disabled: true }, excludedCommands: ['x'] } })],
      HOME,
    );
    expect(check.result).toBe('fail');
    expect(check.detail).toBe(
      'user settings sets sandbox.filesystem.disabled to true, which turns filesystem isolation off. 1 more finding in the stored report.',
    );
    expect(check.sources[1]?.findings).toEqual([
      'sandbox.filesystem.disabled',
      'sandbox.excludedCommands',
    ]);
  });

  it('pluralises several more findings', () => {
    const check = judgeSandboxIsolation(
      [
        launch(),
        user({
          sandbox: {
            filesystem: { disabled: true },
            excludedCommands: ['x'],
            allowAppleEvents: true,
          },
        }),
      ],
      HOME,
    );
    expect(check.detail).toMatch(/ 2 more findings in the stored report\.$/);
  });

  it('fails without a launch source', () => {
    const check = judgeSandboxIsolation([user({})], HOME);
    expect(check.result).toBe('fail');
    expect(check.detail).toBe('The launch settings were not checked.');
  });

  it('records an absent source and passes over it', () => {
    const check = judgeSandboxIsolation(
      [
        launch(),
        {
          kind: 'user',
          label: 'user settings',
          path: `${HOME}/.claude/settings.json`,
          state: 'absent',
        },
      ],
      HOME,
    );
    expect(check.result).toBe('pass');
    expect(check.detail).toContain('(1 checked: launch settings)');
    expect(check.sources[1]).toEqual({
      kind: 'user',
      label: 'user settings',
      path: '~/.claude/settings.json',
      state: 'absent',
      findings: [],
    });
  });

  it('fails a sandbox or sandbox.filesystem value that is not an object', () => {
    const notObject = judgeSandboxIsolation([launch(), user({ sandbox: 'off' })], HOME);
    expect(notObject.result).toBe('fail');
    expect(notObject.detail).toBe(
      'user settings sets sandbox to "off", which Counterpoint cannot check.',
    );
    const fs = judgeSandboxIsolation([launch(), user({ sandbox: { filesystem: [1, 2] } })], HOME);
    expect(fs.result).toBe('fail');
    expect(fs.detail).toBe(
      'user settings sets sandbox.filesystem to 2 entries, which Counterpoint cannot check.',
    );
  });

  it('applies rules in the documented order', () => {
    expect(ISOLATION_RULES.map((rule) => [rule.key, rule.failsIn])).toEqual([
      ['sandbox.filesystem.disabled', 'any'],
      ['sandbox.excludedCommands', 'any'],
      ['sandbox.enabled', 'managed'],
      ['sandbox.failIfUnavailable', 'managed'],
      ['sandbox.allowUnsandboxedCommands', 'managed'],
      ['sandbox.autoAllowBashIfSandboxed', 'managed'],
      ['sandbox.allowAppleEvents', 'any'],
    ]);
    for (const rule of ISOLATION_RULES) expect(rule.doc).toContain('code.claude.com/docs');
  });
});

describe('the rule matrix: each rule in each source kind', () => {
  const kinds = Object.keys(SOURCE_OF_KIND) as Exclude<SettingsSourceKind, 'launch'>[];
  const managed = new Set([
    'server-managed-cache',
    'managed-file',
    'managed-drop-in',
    'managed-preferences',
  ]);

  for (const rule of ISOLATION_RULES) {
    const unsafe = UNSAFE[rule.key];
    for (const kind of kinds) {
      const applies = rule.failsIn === 'any' || managed.has(kind);
      it(`${rule.key} ${applies ? 'fails' : 'does not fail'} in a ${kind} source`, () => {
        const check = judgeSandboxIsolation(
          [launch(), ofKind(kind, setting(rule.key, unsafe))],
          HOME,
        );
        expect(check.result).toBe(applies ? 'fail' : 'pass');
        expect(check.sources[1]?.findings).toEqual(applies ? [rule.key] : []);
        if (applies) {
          expect(check.detail).toContain(`${SOURCE_OF_KIND[kind].label} sets ${rule.key} to `);
          expect(check.detail).toContain(rule.effect);
        }
      });
    }

    it(`${rule.key} fails in the launch source when set unsafe`, () => {
      const check = judgeSandboxIsolation([launch(launchWith(rule.key, unsafe))], HOME);
      expect(check.result).toBe('fail');
      expect(check.sources[0]?.findings).toEqual([rule.key]);
      expect(check.fix).toContain("Counterpoint's launch settings must set");
    });

    it(`${rule.key} in the launch source ${rule.failsIn === 'managed' ? 'must' : 'need not'} be set explicitly`, () => {
      const check = judgeSandboxIsolation([launch(launchWith(rule.key, undefined))], HOME);
      expect(check.result).toBe(rule.failsIn === 'managed' ? 'fail' : 'pass');
    });

    it(`${rule.key} passes at its safe value in a managed source`, () => {
      const safe = rule.safe === 'empty-list' ? [] : rule.safe;
      const check = judgeSandboxIsolation(
        [launch(), ofKind('managed-file', setting(rule.key, safe))],
        HOME,
      );
      expect(check.result).toBe('pass');
    });
  }
});

describe('several sources at once (01-25 Task 2)', () => {
  it('names the first finding in source order and keeps each source its own findings', () => {
    const check = judgeSandboxIsolation(
      [
        launch(),
        user({}),
        ofKind('server-managed-cache', {}),
        ofKind('managed-file', { sandbox: { allowUnsandboxedCommands: true } }),
        ofKind('managed-drop-in', { sandbox: { excludedCommands: ['gh *'] } }),
        ofKind('managed-preferences', { sandbox: { autoAllowBashIfSandboxed: 'true' } }),
      ],
      HOME,
    );
    expect(check.result).toBe('fail');
    expect(check.detail).toBe(
      'managed settings file sets sandbox.allowUnsandboxedCommands to true, which lets a failed command retry outside the sandbox. 2 more findings in the stored report.',
    );
    expect(check.sources.map((source) => [source.kind, source.findings])).toEqual([
      ['launch', []],
      ['user', []],
      ['server-managed-cache', []],
      ['managed-file', ['sandbox.allowUnsandboxedCommands']],
      ['managed-drop-in', ['sandbox.excludedCommands']],
      ['managed-preferences', ['sandbox.autoAllowBashIfSandboxed']],
    ]);
  });

  it('lists every read source in the pass detail and skips absent ones', () => {
    const check = judgeSandboxIsolation(
      [
        launch(),
        user({ sandbox: { enabled: true } }),
        {
          kind: 'server-managed-cache',
          label: 'server-managed settings cache',
          path: null,
          state: 'absent',
        },
        ofKind('managed-file', { sandbox: { failIfUnavailable: 'true' } }),
        ofKind('managed-drop-in', {}),
        ofKind('managed-preferences', {
          sandbox: { enabled: true, allowUnsandboxedCommands: false },
        }),
      ],
      HOME,
    );
    expect(check.result).toBe('pass');
    expect(check.detail).toBe(
      'No settings source Claude Code loads for agent sessions turns sandbox isolation off (5 checked: launch settings, user settings, managed settings file, managed settings drop-in 10-a.json, managed preferences).',
    );
  });

  it('fails on an unreadable source before reporting any finding', () => {
    const check = judgeSandboxIsolation(
      [
        launch(),
        user({ sandbox: { filesystem: { disabled: true } } }),
        {
          kind: 'managed-preferences',
          label: 'managed preferences',
          path: '/Library/Managed Preferences/com.anthropic.claudecode.plist',
          state: 'unreadable',
          problem: 'not a valid property list',
        },
      ],
      HOME,
    );
    expect(check.detail).toBe(
      "Couldn't read managed preferences (/Library/Managed Preferences/com.anthropic.claudecode.plist): not a valid property list. Claude Code may apply settings Counterpoint cannot check.",
    );
    expect(check.sources[1]?.findings).toEqual(['sandbox.filesystem.disabled']);
  });
});

describe('what the check may show', () => {
  it('sanitises and caps a string value at 40 characters', () => {
    const value = `on\u0000\u001b[31m\u2028${'x'.repeat(60)}`;
    const check = judgeSandboxIsolation(
      [launch(), user({ sandbox: { filesystem: { disabled: value } } })],
      HOME,
    );
    const shown = /to (".*"), which/.exec(check.detail)?.[1] as string;
    const inner = JSON.parse(shown) as string;
    expect([...inner]).toHaveLength(40);
    const control = [...inner].filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
    });
    expect(control).toEqual([]);
    expect(check.detail).not.toContain('x'.repeat(41));
  });

  it('never shows list entries, object contents or unrelated settings', () => {
    const check = judgeSandboxIsolation(
      [
        launch(),
        user({
          apiKeyHelper: 'secret-helper',
          sandbox: { excludedCommands: ['secret-cmd *'], filesystem: { disabled: { secret: 1 } } },
        }),
      ],
      HOME,
    );
    expect(check.result).toBe('fail');
    expect(check.detail).toContain('to an object, which');
    expect(JSON.stringify(check)).not.toContain('secret');
  });

  it('sanitises control characters in a source label and path', () => {
    const check = judgeSandboxIsolation(
      [
        launch(),
        {
          kind: 'managed-drop-in',
          label: 'managed settings drop-in a\u001b[2Jb.json',
          path: '/etc/claude-code/managed-settings.d/a\u001b[2Jb.json',
          state: 'read',
          settings: { sandbox: { enabled: false } },
        },
      ],
      HOME,
    );
    expect(check.result).toBe('fail');
    expect(check.detail).not.toContain('\u001b');
    expect(check.fix).not.toContain('\u001b');
    expect(JSON.stringify(check.sources)).not.toContain('\\u001b');
  });
});

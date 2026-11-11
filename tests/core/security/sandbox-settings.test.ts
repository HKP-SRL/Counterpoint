// Unit tests for the agent sandbox-settings builder, the agent environment allow-list, the
// `claude -p` argv builder and the doctor report schema.
import { mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT_PERMISSION_MODE, buildClaudeArgv } from '../../../src/agent/claude-argv.ts';
import { AGENT_ENV_ALLOW, agentEnv } from '../../../src/core/security/agent-env.ts';
import {
  DoctorReport,
  isReportStale,
  PROBE_TARGET_IDS,
  probeTargetMode,
  reportVerdict,
} from '../../../src/core/security/doctor-report.ts';
import {
  AGENT_TOOLS,
  buildAgentSandboxSettings,
  CREDENTIAL_ENV_DENY,
  FILE_EDIT_TOOLS,
  fileEditGrants,
  type ProtectedPaths,
} from '../../../src/core/security/sandbox-settings.ts';
import { initScratchRepo, makeScratchDir, removeScratchDirs } from '../../helpers/scratch.ts';

/** True when `a` equals `b`, or one lies inside the other (compared by realpath where possible). */
function overlaps(a: string, b: string): boolean {
  const ra = realOrSelf(a);
  const rb = realOrSelf(b);
  return inside(ra, rb) || inside(rb, ra);
}

function inside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

let root: string;
let home: string;
let cpHome: string;
let keyDir: string;
let repo: string;
let gitDir: string;
let work: string;
let homeLink: string;
let paths: ProtectedPaths;

beforeAll(async () => {
  root = makeScratchDir('sbx');
  home = join(root, 'home');
  mkdirSync(join(home, '.ssh'), { recursive: true });
  mkdirSync(join(home, '.config', 'gh'), { recursive: true });
  cpHome = join(root, 'Library', 'Application Support', 'Counterpoint');
  mkdirSync(cpHome, { recursive: true });
  keyDir = join(root, 'keys');
  mkdirSync(keyDir);
  repo = join(root, 'repo');
  mkdirSync(repo);
  await initScratchRepo(repo);
  gitDir = join(repo, '.git');
  work = join(root, 'work');
  mkdirSync(work);
  homeLink = join(root, 'home-link');
  symlinkSync(home, homeLink);
  paths = {
    homeDir: home,
    counterpointHome: cpHome,
    signingKeyDir: keyDir,
    ghConfigDir: join(home, '.config', 'gh'),
    hostGitDir: gitDir,
    workdir: work,
  };
});

afterAll(() => {
  removeScratchDirs();
});

describe('buildAgentSandboxSettings', () => {
  it('denies Read and Edit for every read-protected directory', () => {
    const { settings } = buildAgentSandboxSettings(paths);
    for (const dir of [join(home, '.ssh'), join(home, '.config', 'gh'), cpHome, keyDir]) {
      expect(settings.permissions.deny).toContain(`Read(/${dir}/**)`);
      expect(settings.permissions.deny).toContain(`Edit(/${dir}/**)`);
    }
  });

  it('denies Edit on the whole git common dir', () => {
    const { settings } = buildAgentSandboxSettings(paths);
    expect(settings.permissions.deny).toContain(`Edit(/${gitDir}/**)`);
  });

  it("denies Edit on the working directory's .claude folder when a workdir is given", () => {
    const { settings } = buildAgentSandboxSettings(paths);
    expect(settings.permissions.deny).toContain(`Edit(/${work}/.claude/**)`);
  });

  it('emits no .claude rule when no workdir is given', () => {
    const { workdir: _omit, ...rest } = paths;
    const { settings } = buildAgentSandboxSettings(rest);
    expect(settings.permissions.deny.some((rule) => rule.includes('/.claude/'))).toBe(false);
  });

  it('uses the //abs rule form, never a doubled leading slash', () => {
    const { settings } = buildAgentSandboxSettings(paths);
    for (const rule of [...settings.permissions.deny, ...(settings.permissions.allow ?? [])]) {
      expect(rule).toMatch(/^(Read|Edit)\(\/\/[^/].*\/\*\*\)$/);
    }
  });

  it('enables the sandbox, fails if it is unavailable and never allows unsandboxed commands', () => {
    const { settings } = buildAgentSandboxSettings(paths);
    expect(settings.sandbox.enabled).toBe(true);
    expect(settings.sandbox.failIfUnavailable).toBe(true);
    expect(settings.sandbox.allowUnsandboxedCommands).toBe(false);
  });

  it('turns sandbox auto-allow off explicitly, with and without a workdir (scrub replacement 1)', () => {
    const { workdir: _omit, ...rest } = paths;
    expect(buildAgentSandboxSettings(paths).settings.sandbox.autoAllowBashIfSandboxed).toBe(false);
    expect(buildAgentSandboxSettings(rest).settings.sandbox.autoAllowBashIfSandboxed).toBe(false);
  });

  it('denies the credential env vars, with and without a workdir (scrub replacement 3)', () => {
    const { workdir: _omit, ...rest } = paths;
    // CLOUDSDK_PROXY_PASSWORD left the list: the rerun showed the deny does not reach it, and it
    // joined the sandbox-proxy-login exception (owner decision 2026-11-10).
    const expected = { envVars: [{ name: 'CLAUDE_CODE_MESSAGING_TOKEN', mode: 'deny' }] };
    expect(CREDENTIAL_ENV_DENY).toEqual(['CLAUDE_CODE_MESSAGING_TOKEN']);
    expect(buildAgentSandboxSettings(paths).settings.sandbox.credentials).toEqual(expected);
    expect(buildAgentSandboxSettings(rest).settings.sandbox.credentials).toEqual(expected);
  });

  it('lists the read-protected directories as plain absolute denyRead paths', () => {
    const { settings } = buildAgentSandboxSettings(paths);
    expect([...settings.sandbox.filesystem.denyRead].sort()).toEqual(
      [join(home, '.ssh'), join(home, '.config', 'gh'), cpHome, keyDir].sort(),
    );
  });

  it('denies writes to the git config, hooks and info', () => {
    const { settings } = buildAgentSandboxSettings(paths);
    expect(settings.sandbox.filesystem.denyWrite).toEqual([
      join(gitDir, 'config'),
      join(gitDir, 'hooks'),
      join(gitDir, 'info'),
    ]);
  });

  it('grants no allowWrite entry equal to, containing or inside the git common dir', () => {
    const { settings } = buildAgentSandboxSettings(paths);
    const allowWrite = settings.sandbox.filesystem.allowWrite;
    expect(allowWrite).toEqual([]);
    for (const entry of allowWrite) {
      expect(overlaps(entry, gitDir)).toBe(false);
    }
  });

  it('grants file edits only inside the workdir: permissions.allow is exactly Edit(//work/**)', () => {
    const profile = buildAgentSandboxSettings(paths);
    const { settings } = profile;
    expect(Object.keys(settings).sort()).toEqual(['permissions', 'sandbox']);
    expect(Object.keys(settings.permissions).sort()).toEqual([
      'allow',
      'blockWritesOutsideWorkingDirectories',
      'deny',
    ]);
    expect(settings.permissions.allow).toEqual([`Edit(/${work}/**)`]);
    expect(settings.permissions.blockWritesOutsideWorkingDirectories).toBe(true);
    expect(settings.permissions).not.toHaveProperty('additionalDirectories');
    expect(Object.keys(settings.sandbox).sort()).toEqual([
      'allowUnsandboxedCommands',
      'autoAllowBashIfSandboxed',
      'credentials',
      'enabled',
      'failIfUnavailable',
      'filesystem',
    ]);
    expect(settings.sandbox.autoAllowBashIfSandboxed).toBe(false);
    expect(Object.keys(settings.sandbox.filesystem).sort()).toEqual([
      'allowWrite',
      'denyRead',
      'denyWrite',
    ]);
    expect(profile.allowedTools).toEqual([...AGENT_TOOLS]);
    expect(profile.workdir).toBe(work);
    // Deny rules win over allow rules, so the workdir's .claude stays unwritable.
    expect(settings.permissions.deny).toContain(`Edit(/${work}/.claude/**)`);
  });

  it('has no allow side at all without a workdir, so nothing can be edited', () => {
    const { workdir: _omit, ...rest } = paths;
    const profile = buildAgentSandboxSettings(rest);
    expect(Object.keys(profile.settings.permissions).sort()).toEqual([
      'blockWritesOutsideWorkingDirectories',
      'deny',
    ]);
    expect(profile.settings.permissions).not.toHaveProperty('allow');
    // The outside-write block is on without a workdir too (fail closed).
    expect(profile.settings.permissions.blockWritesOutsideWorkingDirectories).toBe(true);
    expect(profile.settings.permissions).not.toHaveProperty('additionalDirectories');
    expect(Object.keys(profile.settings.sandbox).sort()).toEqual([
      'allowUnsandboxedCommands',
      'autoAllowBashIfSandboxed',
      'credentials',
      'enabled',
      'failIfUnavailable',
      'filesystem',
    ]);
    // Sandbox auto-allow is off without a workdir too.
    expect(profile.settings.sandbox.autoAllowBashIfSandboxed).toBe(false);
    expect(profile.allowedTools).toEqual([...AGENT_TOOLS]);
    expect(profile.workdir).toBeNull();
  });

  it('launches every session with exactly Bash, Read, Grep and Glob, as a fresh copy', () => {
    expect([...AGENT_TOOLS]).toEqual(['Bash', 'Read', 'Grep', 'Glob']);
    const a = buildAgentSandboxSettings(paths);
    const b = buildAgentSandboxSettings(paths);
    expect(a.allowedTools).not.toBe(b.allowedTools);
    for (const tool of FILE_EDIT_TOOLS) expect(a.allowedTools).not.toContain(tool);
  });

  it('resolves a symlinked input directory to its realpath', () => {
    const { settings } = buildAgentSandboxSettings({ ...paths, homeDir: homeLink });
    expect(settings.sandbox.filesystem.denyRead).toContain(join(home, '.ssh'));
    expect(settings.sandbox.filesystem.denyRead).not.toContain(join(homeLink, '.ssh'));
    expect(settings.permissions.deny).toContain(`Read(/${join(home, '.ssh')}/**)`);
  });

  it('keeps a path containing spaces verbatim', () => {
    const { settings } = buildAgentSandboxSettings(paths);
    expect(cpHome).toContain('Application Support');
    expect(settings.sandbox.filesystem.denyRead).toContain(cpHome);
    expect(settings.permissions.deny).toContain(`Read(/${cpHome}/**)`);
  });

  it.each([
    'homeDir',
    'counterpointHome',
    'signingKeyDir',
    'ghConfigDir',
    'hostGitDir',
    'workdir',
  ] as const)('throws on a relative %s', (key) => {
    expect(() => buildAgentSandboxSettings({ ...paths, [key]: 'relative/dir' })).toThrow(
      /absolute/,
    );
  });

  it.skipIf(process.platform !== 'darwin')(
    'resolves a missing directory through its realpath parent (/tmp becomes /private/tmp)',
    () => {
      const { settings } = buildAgentSandboxSettings({
        ...paths,
        signingKeyDir: '/tmp/cp-missing-dir-0104/keys',
      });
      expect(settings.sandbox.filesystem.denyRead).toContain(
        '/private/tmp/cp-missing-dir-0104/keys',
      );
    },
  );

  it('returns the read and write targets the probe plans against', () => {
    const { readTargets, writeTargets } = buildAgentSandboxSettings(paths);
    expect(readTargets.map((t) => [t.id, t.mode, t.path])).toEqual([
      ['signing-key', 'read', keyDir],
      ['ssh', 'read', join(home, '.ssh')],
      ['gh', 'read', join(home, '.config', 'gh')],
      ['state', 'read', cpHome],
    ]);
    expect(writeTargets.map((t) => [t.id, t.mode, t.path])).toEqual([
      ['git-config', 'write', join(gitDir, 'config')],
      ['git-hooks', 'write', join(gitDir, 'hooks')],
      ['git-info', 'write', join(gitDir, 'info')],
    ]);
  });
});

describe('fileEditGrants', () => {
  const profile = (allow: string[] | undefined, allowedTools: string[] = [...AGENT_TOOLS]) => {
    const { settings } = buildAgentSandboxSettings(paths);
    const permissions =
      allow === undefined
        ? { deny: settings.permissions.deny }
        : { ...settings.permissions, allow };
    return { settings: { ...settings, permissions }, allowedTools };
  };

  it('reads the production profile as edits inside the workdir only', () => {
    expect(fileEditGrants(buildAgentSandboxSettings(paths))).toEqual({
      everywhere: false,
      roots: [work],
    });
  });

  it('reads the no-workdir profile as no edit grant anywhere', () => {
    const { workdir: _omit, ...rest } = paths;
    expect(fileEditGrants(buildAgentSandboxSettings(rest))).toEqual({
      everywhere: false,
      roots: [],
    });
  });

  it('reads a bare Write allow rule as a grant everywhere', () => {
    expect(fileEditGrants(profile(['Write'])).everywhere).toBe(true);
  });

  it('reads a bare NotebookEdit in allowedTools as a grant everywhere', () => {
    expect(fileEditGrants(profile(undefined, ['Bash', 'NotebookEdit'])).everywhere).toBe(true);
  });

  it.each([
    ['a relative scope', 'Edit(./x)'],
    ['a home-relative scope', 'Edit(~/x/**)'],
    ['a single-slash scope', 'Edit(/x/**)'],
    ['a glob inside the path', 'Edit(//x/*/y/**)'],
    ['a dot-dot segment', 'Edit(//x/../y/**)'],
    ['the filesystem root', 'Edit(///**)'],
    ['a lowercase tool name', 'edit'],
    ['a bare MultiEdit', 'MultiEdit'],
  ])('fails closed on %s', (_name, entry) => {
    expect(fileEditGrants(profile([entry])).everywhere).toBe(true);
  });

  it('lists a scoped Write rule elsewhere as a root, not everywhere', () => {
    expect(fileEditGrants(profile(['Write(//elsewhere/**)']))).toEqual({
      everywhere: false,
      roots: ['/elsewhere'],
    });
    expect(fileEditGrants(profile(['Edit(//elsewhere)'])).roots).toEqual(['/elsewhere']);
  });

  it('ignores entries for tools that do not edit files', () => {
    expect(fileEditGrants(profile(['Read(//x/**)', 'Grep(//x/**)'], ['Bash', 'Read']))).toEqual({
      everywhere: false,
      roots: [],
    });
  });
});

describe('agentEnv', () => {
  const parent = {
    PATH: '/usr/bin:/bin',
    HOME: '/Users/someone',
    USER: 'someone',
    LOGNAME: 'someone',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    TMPDIR: '/tmp/',
    SHELL: '/bin/zsh',
    SSH_AUTH_SOCK: '/tmp/agent.sock',
    SSH_ASKPASS: '/usr/bin/askpass',
    GH_TOKEN: 'gh-secret',
    GITHUB_TOKEN: 'github-secret',
    ANTHROPIC_API_KEY: 'sk-secret',
    COUNTERPOINT_HOME: '/Users/someone/cp',
    COUNTERPOINT_TOKEN: 'cp-secret',
    NODE_OPTIONS: '--require /tmp/evil.js',
  };

  it("keeps only the allow-listed variables and opts out of the subprocess scrub ('0')", () => {
    const env = agentEnv(parent);
    expect(Object.keys(env).sort()).toEqual(
      [...AGENT_ENV_ALLOW, 'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB'].sort(),
    );
    // The owner's scrub opt-out (owner decision 2026-11-10): the value is exactly '0'.
    expect(env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBe('0');
    expect(env.PATH).toBe(parent.PATH);
  });

  it.each([
    'SSH_AUTH_SOCK',
    'SSH_ASKPASS',
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'ANTHROPIC_API_KEY',
    'COUNTERPOINT_HOME',
    'COUNTERPOINT_TOKEN',
    'NODE_OPTIONS',
  ])('never passes %s', (key) => {
    expect(agentEnv(parent)).not.toHaveProperty(key);
  });

  it('allows exactly PATH, HOME, USER, LOGNAME, LANG, LC_ALL, TMPDIR and SHELL', () => {
    expect([...AGENT_ENV_ALLOW]).toEqual([
      'PATH',
      'HOME',
      'USER',
      'LOGNAME',
      'LANG',
      'LC_ALL',
      'TMPDIR',
      'SHELL',
    ]);
  });
});

describe('buildClaudeArgv', () => {
  const base = () => ({
    settings: buildAgentSandboxSettings(paths).settings,
    model: 'haiku',
    maxTurns: 12,
    maxBudgetUsd: 0.5,
    allowedTools: ['Bash', 'Read'],
    prompt: 'Make each call once, in order, do nothing else.',
  });

  function valueAfter(argv: readonly string[], flag: string): string | undefined {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  }

  it('carries every mandatory flag', () => {
    const argv = buildClaudeArgv(base());
    for (const flag of [
      '-p',
      '--output-format',
      '--verbose',
      '--no-session-persistence',
      '--model',
      '--max-turns',
      '--max-budget-usd',
      '--settings',
      '--setting-sources',
      '--strict-mcp-config',
      '--permission-mode',
      '--permission-prompts',
      '--allowedTools',
    ]) {
      expect(argv).toContain(flag);
    }
    expect(valueAfter(argv, '--output-format')).toBe('stream-json');
    expect(valueAfter(argv, '--setting-sources')).toBe('user');
    expect(AGENT_PERMISSION_MODE).toBe('auto');
    expect(valueAfter(argv, '--permission-mode')).toBe(AGENT_PERMISSION_MODE);
    expect(valueAfter(argv, '--permission-prompts')).toBe('none');
    expect(valueAfter(argv, '--model')).toBe('haiku');
    expect(valueAfter(argv, '--max-turns')).toBe('12');
    expect(valueAfter(argv, '--max-budget-usd')).toBe('0.5');
  });

  it('puts the prompt right after -p', () => {
    const input = base();
    const argv = buildClaudeArgv(input);
    expect(valueAfter(argv, '-p')).toBe(input.prompt);
  });

  it('serialises the settings with JSON.stringify', () => {
    const input = base();
    const argv = buildClaudeArgv(input);
    expect(valueAfter(argv, '--settings')).toBe(JSON.stringify(input.settings));
  });

  it('passes each allowed tool as its own argument', () => {
    const argv = buildClaudeArgv(base());
    const at = argv.indexOf('--allowedTools');
    expect(argv.slice(at + 1, at + 3)).toEqual(['Bash', 'Read']);
  });

  it('adds one --add-dir per entry and none by default', () => {
    expect(buildClaudeArgv(base())).not.toContain('--add-dir');
    const argv = buildClaudeArgv({ ...base(), addDirs: ['/a', '/b'] });
    expect(argv.filter((arg) => arg === '--add-dir')).toHaveLength(2);
    expect(valueAfter(argv, '--add-dir')).toBe('/a');
  });

  it.each([
    ['a prompt that starts with a dash', { prompt: '-x' }],
    ['a non-integer turn limit', { maxTurns: 1.5 }],
    ['a zero turn limit', { maxTurns: 0 }],
    ['a non-positive budget', { maxBudgetUsd: 0 }],
    ['an empty tool list', { allowedTools: [] }],
    ['a relative --add-dir', { addDirs: ['rel'] }],
  ])('rejects %s', (_name, override) => {
    expect(() => buildClaudeArgv({ ...base(), ...override })).toThrow();
  });
});

describe('DoctorReport', () => {
  const now = new Date('2026-11-09T12:00:00.000Z');

  function validReport() {
    return {
      schema: 'counterpoint/doctor/v1' as const,
      hostId: 'cena',
      checkedAt: now.toISOString(),
      claudeVersion: '2.1.319 (Claude Code)',
      matcherVersion: '1',
      tools: [{ id: 'claude', label: 'claude', result: 'pass' as const, detail: '2.1.319' }],
      signingKey: [
        { id: 'passphrase', label: 'Passphrase', result: 'pass' as const, detail: 'protected' },
      ],
      integrity: { id: 'integrity', label: 'Integrity', result: 'pass' as const, detail: 'ok' },
      probe: PROBE_TARGET_IDS.map((id) => ({
        id,
        label: id,
        mode: probeTargetMode(id),
        result: 'blocked' as const,
        evidence: 'denied by your permission settings',
      })),
      sandboxIsolation: {
        id: 'sandbox-isolation' as const,
        label: 'Sandbox isolation settings',
        result: 'pass' as const,
        detail: 'No settings source turns sandbox isolation off.',
        sources: [
          {
            kind: 'launch' as const,
            label: 'launch settings',
            path: null,
            state: 'read' as const,
            findings: [],
          },
        ],
      },
      agentMode: {
        id: 'agent-mode' as const,
        label: 'Agent permission mode',
        result: 'pass' as const,
        detail: "The probe's agent session ran in auto mode.",
        expected: 'auto',
        effective: 'auto' as string | null,
      },
    };
  }

  it('parses a valid report', () => {
    expect(DoctorReport.parse(validReport()).schema).toBe('counterpoint/doctor/v1');
  });

  it('rejects another schema id', () => {
    expect(
      DoctorReport.safeParse({ ...validReport(), schema: 'counterpoint/doctor/v2' }).success,
    ).toBe(false);
  });

  it('rejects an unknown probe target id', () => {
    const report = validReport();
    const probe = [...report.probe, { ...report.probe[0], id: 'keychain' }];
    expect(DoctorReport.safeParse({ ...report, probe }).success).toBe(false);
  });

  it('passes only when every check passes and every probe target is blocked', () => {
    expect(reportVerdict(DoctorReport.parse(validReport()))).toBe('pass');
  });

  it.each(['fail', 'not-checked'] as const)('fails when a tool check is %s', (result) => {
    const report = validReport();
    report.tools = [{ ...report.tools[0], result } as never];
    expect(reportVerdict(DoctorReport.parse(report))).toBe('fail');
  });

  it.each(['fail', 'not-checked'] as const)('fails when the integrity check is %s', (result) => {
    const report = { ...validReport(), integrity: { ...validReport().integrity, result } };
    expect(reportVerdict(DoctorReport.parse(report))).toBe('fail');
  });

  it.each(['reachable', 'not-checked'] as const)('fails when a probe target is %s', (result) => {
    const report = validReport();
    report.probe = report.probe.map((row, i) => (i === 3 ? { ...row, result } : row)) as never;
    expect(reportVerdict(DoctorReport.parse(report))).toBe('fail');
  });

  it('parses an older report without sandboxIsolation, and fails it', () => {
    const { sandboxIsolation: _dropped, ...older } = validReport();
    const parsed = DoctorReport.parse(older);
    expect(parsed.schema).toBe('counterpoint/doctor/v1');
    expect(parsed.sandboxIsolation).toBeUndefined();
    expect(reportVerdict(parsed)).toBe('fail');
  });

  it.each(['fail', 'not-checked'] as const)(
    'fails when the sandbox isolation check is %s',
    (result) => {
      const report = validReport();
      const sandboxIsolation = { ...report.sandboxIsolation, result } as never;
      expect(reportVerdict(DoctorReport.parse({ ...report, sandboxIsolation }))).toBe('fail');
    },
  );

  it('parses an older report without agentMode, and fails it', () => {
    const { agentMode: _dropped, ...older } = validReport();
    const parsed = DoctorReport.parse(older);
    expect(parsed.schema).toBe('counterpoint/doctor/v1');
    expect(parsed.agentMode).toBeUndefined();
    expect(reportVerdict(parsed)).toBe('fail');
  });

  it.each(['fail', 'not-checked'] as const)(
    'fails when the agent permission mode check is %s',
    (result) => {
      const report = validReport();
      const agentMode = { ...report.agentMode, result, effective: 'default' };
      expect(reportVerdict(DoctorReport.parse({ ...report, agentMode }))).toBe('fail');
    },
  );

  it('rejects an agentMode with another id or without expected', () => {
    const report = validReport();
    expect(
      DoctorReport.safeParse({ ...report, agentMode: { ...report.agentMode, id: 'mode' } }).success,
    ).toBe(false);
    const { expected: _expected, ...noExpected } = report.agentMode;
    expect(DoctorReport.safeParse({ ...report, agentMode: noExpected }).success).toBe(false);
  });

  it('fails when a probe target is missing', () => {
    const report = validReport();
    report.probe = report.probe.slice(1);
    expect(reportVerdict(DoctorReport.parse(report))).toBe('fail');
  });

  it('fails a report that holds only the seven pre-gap probe rows', () => {
    // A report written before the outside-workdir row has neither it nor the credential-env row:
    // it still parses as schema v1, and it can never pass.
    const report = validReport();
    report.probe = report.probe.filter(
      (row) => row.id !== 'outside-workdir' && row.id !== 'credential-env',
    );
    expect(report.probe).toHaveLength(7);
    const parsed = DoctorReport.parse(report);
    expect(parsed.schema).toBe('counterpoint/doctor/v1');
    expect(reportVerdict(parsed)).toBe('fail');
  });

  it('fails a report that holds only the eight probe rows before credential-env', () => {
    // A report written before the credential-env row has none: it still parses as schema v1,
    // and it can never pass.
    const report = validReport();
    report.probe = report.probe.filter((row) => row.id !== 'credential-env');
    expect(report.probe).toHaveLength(8);
    const parsed = DoctorReport.parse(report);
    expect(parsed.schema).toBe('counterpoint/doctor/v1');
    expect(reportVerdict(parsed)).toBe('fail');
  });

  it('keeps a credential-env row with one sandbox-proxy-login exception', () => {
    const report = validReport();
    const exception = {
      id: 'sandbox-proxy-login' as const,
      reason: "the sandbox's own proxy login, local only",
      recordedAt: '2026-11-10',
      names: ['CLOUDSDK_PROXY_PASSWORD', 'HTTP_PROXY'],
    };
    const probe = report.probe.map((row) =>
      row.id === 'credential-env' ? { ...row, exceptions: [exception] } : row,
    );
    const parsed = DoctorReport.parse({ ...report, probe });
    expect(parsed.probe.find((row) => row.id === 'credential-env')?.exceptions).toEqual([
      exception,
    ]);
    expect(reportVerdict(parsed)).toBe('pass');
  });

  it('rejects an exception with another id, an extra key, a bad date or no names', () => {
    const good = {
      id: 'sandbox-proxy-login',
      reason: "the sandbox's own proxy login, local only",
      recordedAt: '2026-11-10',
      names: ['HTTP_PROXY'],
    };
    for (const exception of [
      { ...good, id: 'gh-keychain' },
      { ...good, extra: true },
      { ...good, recordedAt: '10 Nov 2026' },
      { ...good, names: [] },
    ]) {
      const report = validReport();
      const probe = report.probe.map((row) =>
        row.id === 'credential-env' ? { ...row, exceptions: [exception] } : row,
      );
      expect(DoctorReport.safeParse({ ...report, probe }).success, JSON.stringify(exception)).toBe(
        false,
      );
    }
  });

  it('lists nine probe targets, credential-env last, with their modes', () => {
    expect(PROBE_TARGET_IDS).toHaveLength(9);
    expect(PROBE_TARGET_IDS.at(-2)).toBe('outside-workdir');
    expect(PROBE_TARGET_IDS.at(-1)).toBe('credential-env');
    expect(probeTargetMode('credential-env')).toBe('read');
    expect(PROBE_TARGET_IDS.filter((id) => probeTargetMode(id) === 'write')).toEqual([
      'git-config',
      'git-hooks',
      'git-info',
      'outside-workdir',
    ]);
  });

  it('is stale only after 24 hours', () => {
    const report = DoctorReport.parse(validReport());
    const day = 24 * 60 * 60 * 1000;
    expect(isReportStale(report, new Date(now.getTime() + day - 1))).toBe(false);
    expect(isReportStale(report, new Date(now.getTime() + day))).toBe(false);
    expect(isReportStale(report, new Date(now.getTime() + day + 1))).toBe(true);
  });
});

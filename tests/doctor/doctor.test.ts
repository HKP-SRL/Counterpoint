// `counterpoint doctor` with an injected probe (no live claude), fake tool and key checks, a
// throwaway trusted key and scratch hosts. The live probe path is proven in 01-04/01-05 and
// exercised by the owner in 01-16.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type KeychainPort, runSandboxProbe } from '../../src/agent/probe.ts';
import { MATCHER_CLAUDE_VERSION } from '../../src/agent/probe-evaluator.ts';
import type { AgentRun, AgentRunner, AgentRunRequest } from '../../src/agent/runner.ts';
import { doctorCommand, resolveHostForCommand } from '../../src/cli/doctor.ts';
import { snapshotIntegrity, writeBaseline } from '../../src/core/approvals/integrity.ts';
import { type TrustResult, writeTrust } from '../../src/core/approvals/trust-store.ts';
import {
  type Check,
  DoctorReport,
  PROBE_TARGET_IDS,
  type ProbeResult,
  type ProbeTarget,
  probeTargetLabel,
  probeTargetMode,
  reportVerdict,
} from '../../src/core/security/doctor-report.ts';
import type { ProtectedPaths } from '../../src/core/security/sandbox-settings.ts';
import { openStore, upsertHost } from '../../src/core/store/db.ts';
import { formatDoctorReport } from '../../src/doctor/run.ts';
import { makeThrowawayKey, type ThrowawayKey } from '../helpers/keys.ts';
import {
  commitAll,
  initScratchRepo,
  makeScratchDir,
  removeScratchDirs,
  writeFileIn,
} from '../helpers/scratch.ts';

let key: ThrowawayKey;
let userHome: string;

beforeAll(async () => {
  const keysDir = makeScratchDir('dkeys');
  key = await makeThrowawayKey(keysDir, { name: 'approval', passphrase: 'pass' });
  userHome = makeScratchDir('duser');
});

afterAll(() => removeScratchDirs());

interface Host {
  home: string;
  root: string;
  gitDir: string;
}

async function scratchHost(
  options: { trusted?: boolean; baseline?: boolean; id?: string } = {},
): Promise<Host> {
  const home = makeScratchDir('dhome');
  const root = makeScratchDir('drepo');
  await initScratchRepo(root);
  writeFileIn(root, 'README.md', 'hi\n');
  await commitAll(root);
  const gitDir = join(root, '.git');
  const store = openStore(home);
  try {
    upsertHost(store, {
      id: options.id ?? 'demo',
      root,
      gitCommonDir: gitDir,
      baseBranch: 'main',
      adapter: 'none',
    });
  } finally {
    store.close();
  }
  if (options.trusted ?? true) await writeTrust(home, { publicKeyPath: key.publicKeyPath });
  if (options.baseline ?? true)
    writeBaseline(home, options.id ?? 'demo', await snapshotIntegrity(gitDir));
  return { home, root, gitDir };
}

const pass = (id: string, label: string, detail = 'ok'): Check => ({
  id,
  label,
  result: 'pass',
  detail,
});

const passingTools = async (): Promise<Check[]> => [
  pass('claude', 'claude', '2.1.319 (Claude Code)'),
  pass('git', 'git', 'git version 2.50.1'),
  pass('gh', 'gh', 'gh version 2.102.0'),
];

function passingKeys(seen: TrustResult[] = []) {
  return async (trust: TrustResult): Promise<Check[]> => {
    seen.push(trust);
    return [
      pass('key-passphrase', 'Passphrase-protected', 'cipher aes256-ctr, kdf bcrypt, 16 rounds'),
      pass('key-agent', 'Not loaded in ssh-agent', 'shell agent: no identities.'),
      pass('key-keychain', 'Not loadable via Keychain', 'nothing stored'),
      pass('openssh', 'OpenSSH 8.1 or newer', 'OpenSSH_10.3p1'),
      pass('trusted-key', 'Trusted key', 'SHA256:x'),
    ];
  };
}

interface ProbeCall {
  protectedPaths: ProtectedPaths;
  logDir: string;
}

function fakeProbe(
  results: Partial<Record<(typeof PROBE_TARGET_IDS)[number], ProbeResult>> = {},
  options: { calls?: ProbeCall[]; staleLeftovers?: (paths: ProtectedPaths) => string[] } = {},
) {
  return async (input: ProbeCall) => {
    options.calls?.push(input);
    const targets: ProbeTarget[] = PROBE_TARGET_IDS.map((id) => ({
      id,
      label: probeTargetLabel(id, 'Host'),
      mode: probeTargetMode(id),
      result: results[id] ?? 'blocked',
      evidence: `evidence for ${id}`,
    }));
    return {
      targets,
      claudeVersion: '2.1.319 (Claude Code)',
      staleLeftovers: options.staleLeftovers?.(input.protectedPaths) ?? [],
    };
  };
}

interface Run {
  code: number;
  out: string[];
  err: string[];
  notices: { home: string; body: unknown }[];
}

async function runDoctorCommand(
  host: Host,
  overrides: Partial<Parameters<typeof doctorCommand>[2]> = {},
  hostArg: string | undefined = 'demo',
): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const notices: { home: string; body: unknown }[] = [];
  const code = await doctorCommand(host.home, hostArg, {
    cwd: host.root,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    probe: fakeProbe(),
    tools: passingTools,
    keyChecks: passingKeys(),
    notify: async (home, body) => {
      notices.push({ home, body });
    },
    homeDir: userHome,
    env: {},
    // Scratch settings sources only: no test reads the real user or managed settings.
    settingsLocations: {
      userConfigDir: join(userHome, '.claude'),
      managedDir: null,
      managedPreferencesDir: null,
      userName: null,
    },
    ...overrides,
  });
  return { code, out, err, notices };
}

function readReport(home: string): DoctorReport {
  return DoctorReport.parse(
    JSON.parse(readFileSync(join(home, 'hosts', 'demo', 'doctor.json'), 'utf8')),
  );
}

/** The lines of one group, from its heading to the next heading or blank line. */
function group(out: string[], heading: string): string[] {
  const start = out.indexOf(heading);
  if (start < 0) throw new Error(`no ${heading} group`);
  const lines: string[] = [];
  for (const line of out.slice(start + 1)) {
    if (line === '' || /^\S/.test(line)) break;
    lines.push(line);
  }
  return lines;
}

describe('counterpoint doctor', () => {
  it('prints the three groups in order and exits 0 when everything passes', async () => {
    const host = await scratchHost();
    const run = await runDoctorCommand(host);
    expect(run.code).toBe(0);
    const tools = run.out.indexOf('Tools');
    const key = run.out.indexOf('Signing key');
    const probe = run.out.indexOf('Sandbox probe');
    expect(tools).toBeGreaterThanOrEqual(0);
    expect(key).toBeGreaterThan(tools);
    expect(probe).toBeGreaterThan(key);
    expect(group(run.out, 'Tools')).toEqual([
      '  PASS         claude: 2.1.319 (Claude Code)',
      '  PASS         git: git version 2.50.1',
      '  PASS         gh: gh version 2.102.0',
    ]);
    expect(group(run.out, 'Signing key').at(-1)).toMatch(
      /^ {2}PASS {9}drepo-\S+ \.git\/config and hooks match your baseline: /,
    );
    const probeGroup = group(run.out, 'Sandbox probe');
    expect(probeGroup[0]).toMatch(/^ {2}PASS {9}Sandbox isolation settings: /);
    const probeRows = probeGroup.slice(1);
    expect(probeRows).toHaveLength(8);
    for (const row of probeRows) expect(row).toMatch(/^ {2}BLOCKED {5}/);
    expect(probeRows.at(-1)).toBe(
      '  BLOCKED      Files outside the working folder: evidence for outside-workdir',
    );
    expect(run.out).toContain('Agents are boxed in');
  });

  it('writes a schema-valid report with mode 0600', async () => {
    const host = await scratchHost();
    await runDoctorCommand(host);
    const file = join(host.home, 'hosts', 'demo', 'doctor.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const report = readReport(host.home);
    expect(report.schema).toBe('counterpoint/doctor/v1');
    expect(report.hostId).toBe('demo');
    expect(report.claudeVersion).toBe('2.1.319 (Claude Code)');
    expect(reportVerdict(report)).toBe('pass');
  });

  it('records the classifier revision in matcherVersion', async () => {
    const host = await scratchHost();
    await runDoctorCommand(host);
    const { matcherVersion } = readReport(host.home);
    // Revision 3 (01-24): only deterministic refusals count.
    expect(matcherVersion).toBe(`${MATCHER_CLAUDE_VERSION}+r3`);
    expect(matcherVersion.endsWith('+r3')).toBe(true);
  });

  it('names a stale outside-workdir canary in the Files outside the working folder row', async () => {
    const host = await scratchHost();
    const hex = '0123456789abcdef0123456789abcdef';
    const run = await runDoctorCommand(host, {
      probe: fakeProbe(
        {},
        {
          staleLeftovers: (p) => [
            join(p.homeDir, `.cp-outside-${hex}`, `cp-${hex}-w`),
            join(p.homeDir, `.cp-outside-${hex}`),
          ],
        },
      ),
    });
    const row = readReport(host.home).probe.find((t) => t.id === 'outside-workdir');
    expect(row?.evidence).toContain(`cp-${hex}-w`);
    expect(row?.evidence).toContain(`.cp-outside-${hex}`);
    for (const other of readReport(host.home).probe.filter((t) => t.id !== 'outside-workdir')) {
      expect(other.evidence).not.toContain(hex);
    }
    const line = group(run.out, 'Sandbox probe').find((l) =>
      l.includes('Files outside the working folder'),
    );
    expect(line).toContain(`removed leftovers of an earlier interrupted probe: cp-${hex}-w`);
  });

  it('nudges the daemon with a doctor event for the host', async () => {
    const host = await scratchHost();
    const run = await runDoctorCommand(host);
    expect(run.notices).toEqual([{ home: host.home, body: { hostId: 'demo', family: 'doctor' } }]);
  });

  it('keeps its exit code when the nudge fails', async () => {
    const host = await scratchHost();
    const run = await runDoctorCommand(host, {
      notify: async () => {
        throw new Error('daemon gone');
      },
    });
    expect(run.code).toBe(0);
  });

  it('probes the real protected paths: key folder, user home, gh config, home and git dir', async () => {
    const host = await scratchHost();
    const calls: ProbeCall[] = [];
    await runDoctorCommand(host, { probe: fakeProbe({}, { calls }) });
    expect(calls).toHaveLength(1);
    const call = calls[0] as ProbeCall;
    expect(call.protectedPaths).toEqual({
      homeDir: userHome,
      counterpointHome: host.home,
      signingKeyDir: dirname(key.privateKeyPath),
      ghConfigDir: join(userHome, '.config', 'gh'),
      hostGitDir: host.gitDir,
    });
    expect(call.logDir.startsWith(join(host.home, 'logs', 'doctor'))).toBe(true);
  });

  it('honours GH_CONFIG_DIR for the gh credentials target', async () => {
    const host = await scratchHost();
    const calls: ProbeCall[] = [];
    await runDoctorCommand(host, {
      probe: fakeProbe({}, { calls }),
      env: { GH_CONFIG_DIR: '/Volumes/elsewhere/gh' },
    });
    expect(calls[0]?.protectedPaths.ghConfigDir).toBe('/Volumes/elsewhere/gh');
  });

  it('fails hard on a reachable probe target and says how many', async () => {
    const host = await scratchHost();
    const run = await runDoctorCommand(host, { probe: fakeProbe({ gh: 'reachable' }) });
    expect(run.code).toBe(1);
    // The first line is the Sandbox isolation settings check; the probe rows follow it.
    const rows = group(run.out, 'Sandbox probe').slice(1);
    expect(rows.filter((row) => /^ {2}REACHABLE {4}gh credentials: /.test(row))).toHaveLength(1);
    for (const row of rows) expect(row).not.toMatch(/^ {2}(PASS|FAIL) /);
    expect(run.out).toContain('Agent sandbox is not confining sessions: 1 target was reachable.');
    expect(run.out).toContain(
      'Approvals still work, but builds will refuse to start until this passes.',
    );
    expect(reportVerdict(readReport(host.home))).toBe('fail');
  });

  it('pluralises several reachable targets', async () => {
    const host = await scratchHost();
    const run = await runDoctorCommand(host, {
      probe: fakeProbe({ gh: 'reachable', 'git-hooks': 'reachable' }),
    });
    expect(run.out).toContain('Agent sandbox is not confining sessions: 2 targets were reachable.');
  });

  it('fails on a probe target that was not checked', async () => {
    const host = await scratchHost();
    const run = await runDoctorCommand(host, { probe: fakeProbe({ ssh: 'not-checked' }) });
    expect(run.code).toBe(1);
    expect(group(run.out, 'Sandbox probe')).toContain('  NOT CHECKED  ~/.ssh: evidence for ssh');
    expect(run.out).toContain('1 check did not pass.');
  });

  it('marks every probe row Not checked when the probe cannot run', async () => {
    const host = await scratchHost();
    const run = await runDoctorCommand(host, {
      probe: async () => {
        throw new Error('claude was not found on PATH.');
      },
    });
    expect(run.code).toBe(1);
    const rows = group(run.out, 'Sandbox probe').slice(1);
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(row).toMatch(/^ {2}NOT CHECKED {2}.*The probe could not run: claude was not found/);
    }
    const report = readReport(host.home);
    expect(report.claudeVersion).toBeNull();
    expect(report.probe.map((row) => [row.id, row.mode])).toEqual(
      PROBE_TARGET_IDS.map((id) => [id, probeTargetMode(id)]),
    );
    expect(report.probe.find((row) => row.id === 'outside-workdir')?.mode).toBe('write');
  });

  it('labels the git config row with the host name', async () => {
    const host = await scratchHost();
    const run = await runDoctorCommand(host);
    const name = host.root.split('/').at(-1) as string;
    expect(group(run.out, 'Sandbox probe')).toContain(
      `  BLOCKED      ${name} .git/config: evidence for git-config`,
    );
  });

  it('names leftovers of an interrupted probe in the affected row', async () => {
    const host = await scratchHost();
    const stale = 'cp-0123456789abcdef0123456789abcdef';
    const run = await runDoctorCommand(host, {
      probe: fakeProbe({}, { staleLeftovers: (p) => [join(p.hostGitDir, 'hooks', stale)] }),
    });
    const row = group(run.out, 'Sandbox probe').find((line) => line.includes('.git/hooks'));
    expect(row).toContain(stale);
    expect(run.code).toBe(0);
  });

  it('fails a tool with an indented Fix line', async () => {
    const host = await scratchHost();
    const run = await runDoctorCommand(host, {
      tools: async () => [
        pass('claude', 'claude', '2.1.319'),
        {
          id: 'git',
          label: 'git',
          result: 'fail',
          detail: 'git version 2.33.1 (SSH signatures need 2.34 or newer)',
          fix: 'Update git to 2.34 or newer',
        },
        pass('gh', 'gh', '2.102.0'),
      ],
    });
    expect(run.code).toBe(1);
    const rows = group(run.out, 'Tools');
    const at = rows.indexOf(
      '  FAIL         git: git version 2.33.1 (SSH signatures need 2.34 or newer)',
    );
    expect(at).toBeGreaterThanOrEqual(0);
    expect(rows[at + 1]).toBe('               Fix: Update git to 2.34 or newer');
    expect(run.out).toContain('1 check did not pass.');
  });

  it('fails the integrity row without a baseline, with the trust fix', async () => {
    const host = await scratchHost({ baseline: false });
    const run = await runDoctorCommand(host);
    expect(run.code).toBe(1);
    const rows = group(run.out, 'Signing key');
    const at = rows.findIndex((row) => row.includes('.git/config and hooks match your baseline'));
    expect(rows[at]).toMatch(/^ {2}FAIL /);
    expect(rows[at + 1]).toBe(
      '               Fix: Run "counterpoint trust demo" and review the list.',
    );
  });

  it('fails the integrity row when a hook appeared since the baseline', async () => {
    const host = await scratchHost();
    writeFileSync(join(host.gitDir, 'hooks', 'post-checkout'), '#!/bin/sh\n', { mode: 0o755 });
    const run = await runDoctorCommand(host);
    expect(run.code).toBe(1);
    const report = readReport(host.home);
    expect(report.integrity.result).toBe('fail');
    expect(report.integrity.detail).toContain('Signing would be refused');
    expect(report.integrity.detail).toContain('hooks post-checkout');
  });

  it('passes the trusted key to the key checks', async () => {
    const host = await scratchHost();
    const seen: TrustResult[] = [];
    await runDoctorCommand(host, { keyChecks: passingKeys(seen) });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.ok).toBe(true);
  });

  it('reads the signing-key target as Not checked when no key is trusted', async () => {
    const host = await scratchHost({ trusted: false });
    const calls: ProbeCall[] = [];
    const run = await runDoctorCommand(host, { probe: fakeProbe({}, { calls }) });
    expect(run.code).toBe(1);
    expect(calls[0]?.protectedPaths.signingKeyDir.startsWith(join(host.home, 'trust'))).toBe(true);
    const report = readReport(host.home);
    const row = report.probe.find((target) => target.id === 'signing-key');
    expect(row?.result).toBe('not-checked');
    expect(row?.evidence).toContain('No trusted signing key');
  });

  it('reads Files outside the working folder REACHABLE through the real probe pipeline (fake claude)', async () => {
    // The real runSandboxProbe (launch profile, plan, launch, evaluator, cleanup) behind
    // doctorCommand, with a fake claude whose Write tool is unconfined: it creates the outside
    // Write file the treatment prompt names. No live claude, no real Keychain.
    class OutsideWriter implements AgentRunner {
      readonly outsideDirs: string[] = [];

      async run(request: AgentRunRequest): Promise<AgentRun> {
        const prompt = request.argv[request.argv.indexOf('-p') + 1] as string;
        const target =
          /Write tool, file_path: (\/[^,]*\/\.cp-outside-[0-9a-f]{32}\/cp-[0-9a-f]{32}-w),/.exec(
            prompt,
          )?.[1];
        if (target !== undefined) {
          this.outsideDirs.push(dirname(target));
          writeFileSync(target, 'cp-probe');
        }
        writeFileSync(request.rawLogPath, '{"type":"result","subtype":"success"}\n', { flag: 'a' });
        return {
          events: [{ type: 'result', subtype: 'success' }],
          raw: '{"type":"result","subtype":"success"}\n',
          stderr: '',
          exitCode: 0,
          timedOut: false,
          result: { type: 'result', subtype: 'success' },
        };
      }

      async version(): Promise<string | null> {
        return '2.1.319 (Claude Code)';
      }
    }
    const keychain: KeychainPort = {
      async add() {
        return true;
      },
      async remove() {},
    };
    const runner = new OutsideWriter();
    const tmpRoot = makeScratchDir('dptmp');
    const host = await scratchHost();

    const run = await runDoctorCommand(host, {
      probe: async ({ protectedPaths, logDir }) => {
        const outcome = await runSandboxProbe({
          protectedPaths,
          runner,
          logDir,
          keychain,
          tmpRoot,
        });
        return {
          targets: outcome.targets,
          claudeVersion: outcome.claudeVersion,
          staleLeftovers: outcome.staleLeftovers,
        };
      },
    });

    // The treatment prompt named a canary dir in the scratch user home, and the probe planted it.
    const outsideRoot = runner.outsideDirs[0] as string;
    expect(dirname(outsideRoot)).toBe(userHome);
    const row = readReport(host.home).probe.find((target) => target.id === 'outside-workdir');
    expect(row?.result).toBe('reachable');
    expect(row?.mode).toBe('write');
    const line = group(run.out, 'Sandbox probe').find((l) =>
      l.includes('Files outside the working folder'),
    );
    expect(line).toMatch(/^ {2}REACHABLE {4}Files outside the working folder: /);
    expect(run.out).toContain(
      'Approvals still work, but builds will refuse to start until this passes.',
    );
    // Nothing of the probe is left in the user home.
    expect(existsSync(outsideRoot)).toBe(false);
    expect(readdirSync(userHome).filter((name) => name.startsWith('.cp-outside-'))).toEqual([]);
    expect(run.code).toBe(1);
  });

  describe('the Sandbox isolation settings check (01-25)', () => {
    /** A scratch user home whose `.claude/settings.json` holds `settings`, or nothing. */
    function settingsHome(settings?: unknown) {
      const home = makeScratchDir('dset');
      const userConfigDir = join(home, '.claude');
      mkdirSync(userConfigDir);
      if (settings !== undefined) {
        writeFileSync(join(userConfigDir, 'settings.json'), JSON.stringify(settings));
      }
      return {
        homeDir: home,
        settingsLocations: {
          userConfigDir,
          managedDir: null,
          managedPreferencesDir: null,
          userName: null,
        },
      };
    }

    const DISABLED = { sandbox: { filesystem: { disabled: true } } };
    const NOT_COUNTED =
      'Not counted as Blocked while the Sandbox isolation settings check does not pass. Measured: ';

    it('fails on a user settings file that turns filesystem isolation off, and counts no row Blocked', async () => {
      const host = await scratchHost();
      const run = await runDoctorCommand(host, settingsHome(DISABLED));
      expect(run.code).toBe(1);
      const rows = group(run.out, 'Sandbox probe');
      expect(rows[0]).toBe(
        '  FAIL         Sandbox isolation settings: user settings sets sandbox.filesystem.disabled to true, which turns filesystem isolation off.',
      );
      expect(rows[1]).toBe(
        '               Fix: Remove sandbox.filesystem.disabled from ~/.claude/settings.json, then run "counterpoint doctor" again.',
      );
      const probeRows = rows.slice(2);
      expect(probeRows).toHaveLength(8);
      for (const row of probeRows) {
        expect(row).toMatch(/^ {2}NOT CHECKED {2}/);
        expect(row).toContain(`: ${NOT_COUNTED}evidence for `);
      }
      expect(run.out).toContain('9 checks did not pass.');

      const report = readReport(host.home);
      expect(report.sandboxIsolation?.result).toBe('fail');
      expect(report.sandboxIsolation?.sources).toContainEqual({
        kind: 'user',
        label: 'user settings',
        path: '~/.claude/settings.json',
        state: 'read',
        findings: ['sandbox.filesystem.disabled'],
      });
      for (const row of report.probe) {
        expect(row.result).toBe('not-checked');
        expect(row.evidence).toBe(`${NOT_COUNTED}evidence for ${row.id}`);
      }
      // The probe path fails on its own: a passing check swapped in does not make it pass.
      const swapped = {
        ...report,
        sandboxIsolation: { ...report.sandboxIsolation, result: 'pass' as const, detail: 'ok' },
      } as DoctorReport;
      expect(reportVerdict(DoctorReport.parse(swapped))).toBe('fail');
    });

    it('keeps a Reachable row as measured while the check fails', async () => {
      const host = await scratchHost();
      const run = await runDoctorCommand(host, {
        ...settingsHome(DISABLED),
        probe: fakeProbe({ ssh: 'reachable' }),
      });
      expect(run.code).toBe(1);
      const rows = group(run.out, 'Sandbox probe').slice(2);
      expect(rows).toContain('  REACHABLE    ~/.ssh: evidence for ssh');
      expect(rows.filter((row) => /^ {2}NOT CHECKED {2}/.test(row))).toHaveLength(7);
      expect(run.out).toContain('Agent sandbox is not confining sessions: 1 target was reachable.');
      const ssh = readReport(host.home).probe.find((row) => row.id === 'ssh');
      expect(ssh).toMatchObject({ result: 'reachable', evidence: 'evidence for ssh' });
    });

    it('passes with no settings file, and the rows stay Blocked', async () => {
      const host = await scratchHost();
      const run = await runDoctorCommand(host, settingsHome());
      expect(run.code).toBe(0);
      const rows = group(run.out, 'Sandbox probe');
      expect(rows[0]).toBe(
        '  PASS         Sandbox isolation settings: No settings source Claude Code loads for agent sessions turns sandbox isolation off (1 checked: launch settings).',
      );
      expect(rows.slice(1)).toHaveLength(8);
      for (const row of rows.slice(1)) expect(row).toMatch(/^ {2}BLOCKED {5}/);
      const report = readReport(host.home);
      expect(report.sandboxIsolation?.result).toBe('pass');
      expect(report.sandboxIsolation?.sources.map((source) => [source.kind, source.state])).toEqual(
        [
          ['launch', 'read'],
          ['user', 'absent'],
        ],
      );
      expect(run.out).toContain('Agents are boxed in');
    });

    it('prints an older report without the check as not recorded, and fails it', async () => {
      const host = await scratchHost();
      await runDoctorCommand(host);
      const { sandboxIsolation: _dropped, ...older } = readReport(host.home);
      const report = DoctorReport.parse(older);
      expect(reportVerdict(report)).toBe('fail');
      const lines = formatDoctorReport(report);
      expect(lines[lines.indexOf('Sandbox probe') + 1]).toBe(
        '  NOT CHECKED  Sandbox isolation settings: not recorded in this report',
      );
      expect(lines).toContain('1 check did not pass.');
    });
  });

  it('formats a stored report the same way', async () => {
    const host = await scratchHost();
    const run = await runDoctorCommand(host);
    const lines = formatDoctorReport(readReport(host.home));
    const start = run.out.indexOf('Tools');
    expect(run.out.slice(start, start + lines.length)).toEqual(lines);
  });
});

describe('resolveHostForCommand', () => {
  it('takes an explicit id', async () => {
    const host = await scratchHost();
    const found = resolveHostForCommand(host.home, 'demo', '/');
    expect(found.ok && found.host.id).toBe('demo');
  });

  it('refuses an explicit id that fails the pattern', async () => {
    const host = await scratchHost();
    const found = resolveHostForCommand(host.home, 'Bad/Id', host.root);
    expect(found.ok).toBe(false);
    expect(!found.ok && found.code).toBe(2);
  });

  it('picks the host whose root contains the cwd', async () => {
    const host = await scratchHost();
    const store = openStore(host.home);
    try {
      upsertHost(store, {
        id: 'other',
        root: '/nowhere/other',
        gitCommonDir: '/nowhere/other/.git',
        baseBranch: 'main',
        adapter: 'none',
      });
    } finally {
      store.close();
    }
    writeFileIn(host.root, 'sub/dir/file.txt', 'x');
    const found = resolveHostForCommand(host.home, undefined, join(host.root, 'sub', 'dir'));
    expect(found.ok && found.host.id).toBe('demo');
  });

  it('picks the only registered host from anywhere', async () => {
    const host = await scratchHost();
    const found = resolveHostForCommand(host.home, undefined, '/');
    expect(found.ok && found.host.id).toBe('demo');
  });

  it('asks to name the project when several are registered and none contains the cwd', async () => {
    const host = await scratchHost();
    const store = openStore(host.home);
    try {
      upsertHost(store, {
        id: 'other',
        root: '/nowhere/other',
        gitCommonDir: '/nowhere/other/.git',
        baseBranch: 'main',
        adapter: 'none',
      });
    } finally {
      store.close();
    }
    const found = resolveHostForCommand(host.home, undefined, '/');
    expect(found.ok).toBe(false);
    expect(!found.ok && found.message).toBe(
      'Name the project: counterpoint doctor <host>. Registered: demo, other.',
    );
    expect(!found.ok && found.code).toBe(2);
  });

  it('says no project is registered for an empty home', () => {
    const home = makeScratchDir('dempty');
    const found = resolveHostForCommand(home, undefined, '/');
    expect(!found.ok && found.message).toBe(
      'No project registered yet. Run counterpoint inside it first.',
    );
  });

  it('exits 2 from the command when no host can be chosen', async () => {
    const home = makeScratchDir('dempty');
    const err: string[] = [];
    const code = await doctorCommand(home, undefined, {
      cwd: '/',
      out: () => {},
      err: (line) => err.push(line),
      settingsLocations: {
        userConfigDir: join(makeScratchDir('duser'), '.claude'),
        managedDir: null,
        managedPreferencesDir: null,
        userName: null,
      },
    });
    expect(code).toBe(2);
    expect(err).toEqual(['No project registered yet. Run counterpoint inside it first.']);
  });
});

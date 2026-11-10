// `counterpoint doctor` with an injected probe (no live claude), fake tool and key checks, a
// throwaway trusted key and scratch hosts. The live probe path is proven in 01-04/01-05 and
// exercised by the owner in 01-16.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type KeychainPort, runSandboxProbe } from '../../src/agent/probe.ts';
import { MATCHER_CLAUDE_VERSION, MATCHER_REVISION } from '../../src/agent/probe-evaluator.ts';
import {
  type AgentRun,
  type AgentRunner,
  type AgentRunRequest,
  sessionModeEvidence,
} from '../../src/agent/runner.ts';
import { doctorCommand, resolveHostForCommand } from '../../src/cli/doctor.ts';
import { snapshotIntegrity, writeBaseline } from '../../src/core/approvals/integrity.ts';
import { type TrustResult, writeTrust } from '../../src/core/approvals/trust-store.ts';
import {
  readAcceptedRisks,
  revokeAcceptedRisk,
  writeAcceptedRisk,
} from '../../src/core/security/accepted-risks.ts';
import {
  type Check,
  DoctorReport,
  judgeAgentMode,
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

type Evidence = Pick<ProbeTarget, 'steps' | 'leaks' | 'trusted'>;

/**
 * The gh row's structured evidence as the live probe records it (01-19): Bash cat, Read and Grep
 * refused by a deny rule (control reached), the Keychain lookup reached in both sessions. A
 * reachable row leaks only the Keychain canary; a blocked one leaks nothing and its lookup was
 * refused too.
 */
function ghEvidence(result: ProbeResult): Evidence {
  const reachable = result === 'reachable';
  return {
    steps: [
      { index: 10, tool: 'Bash', operation: 'cat', treatment: 'denied-rule', control: 'reached' },
      { index: 11, tool: 'Read', operation: 'read', treatment: 'denied-rule', control: 'reached' },
      { index: 12, tool: 'Grep', operation: 'grep', treatment: 'denied-rule', control: 'reached' },
      {
        index: 13,
        tool: 'Bash',
        operation: 'keychain',
        treatment: reachable ? 'reached' : 'denied-rule',
        control: 'reached',
      },
    ],
    leaks: reachable ? ['keychain-canary'] : [],
    trusted: true,
  };
}

function fakeProbe(
  results: Partial<Record<(typeof PROBE_TARGET_IDS)[number], ProbeResult>> = {},
  options: {
    calls?: ProbeCall[];
    staleLeftovers?: (paths: ProtectedPaths) => string[];
    /** What the treatment reported about its permission mode (default: one init event, auto). */
    agentSession?: { modes: Array<string | null>; notices: string[] };
    /** Overrides the gh row's structured evidence (default: ghEvidence(result)). */
    gh?: Partial<Evidence>;
  } = {},
) {
  return async (input: ProbeCall) => {
    options.calls?.push(input);
    const targets: ProbeTarget[] = PROBE_TARGET_IDS.map((id) => {
      const result = results[id] ?? 'blocked';
      const evidence: Evidence =
        id === 'gh'
          ? { ...ghEvidence(result), ...options.gh }
          : { steps: [], leaks: [], trusted: true };
      return {
        id,
        label: probeTargetLabel(id, 'Host'),
        mode: probeTargetMode(id),
        result,
        evidence: `evidence for ${id}`,
        ...evidence,
      };
    });
    return {
      targets,
      claudeVersion: '2.1.319 (Claude Code)',
      staleLeftovers: options.staleLeftovers?.(input.protectedPaths) ?? [],
      agentSession: options.agentSession ?? { modes: ['auto'], notices: [] },
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
    expect(probeGroup[0]).toBe(
      "  PASS         Agent permission mode: The probe's agent session ran in auto mode.",
    );
    expect(probeGroup[1]).toMatch(/^ {2}PASS {9}Sandbox isolation settings: /);
    const probeRows = probeGroup.slice(2);
    expect(probeRows).toHaveLength(9);
    for (const row of probeRows) expect(row).toMatch(/^ {2}BLOCKED {5}/);
    expect(probeRows.at(-2)).toBe(
      '  BLOCKED      Files outside the working folder: evidence for outside-workdir',
    );
    expect(probeRows.at(-1)).toBe(
      '  BLOCKED      Credentials in the shell environment: evidence for credential-env',
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
    // Revision 4 (01-26): the credential-env row, on top of 3's deterministic refusals only.
    expect(matcherVersion).toBe(`${MATCHER_CLAUDE_VERSION}+r${MATCHER_REVISION}`);
    expect(matcherVersion.endsWith('+r4')).toBe(true);
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
    // The first lines are the Agent permission mode and Sandbox isolation settings checks; the
    // probe rows follow them.
    const rows = group(run.out, 'Sandbox probe').slice(2);
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
    const probeGroup = group(run.out, 'Sandbox probe');
    expect(probeGroup[0]).toBe(
      '  NOT CHECKED  Agent permission mode: The probe could not run, so the agent permission mode was not seen.',
    );
    const rows = probeGroup.slice(2);
    expect(rows).toHaveLength(9);
    for (const row of rows) {
      expect(row).toMatch(/^ {2}NOT CHECKED {2}.*The probe could not run: claude was not found/);
    }
    const report = readReport(host.home);
    expect(report.agentMode).toMatchObject({
      id: 'agent-mode',
      result: 'not-checked',
      expected: 'auto',
      effective: null,
    });
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
        const raw =
          '{"type":"system","subtype":"init","permissionMode":"auto"}\n{"type":"result","subtype":"success"}\n';
        writeFileSync(request.rawLogPath, raw, { flag: 'a' });
        return {
          events: [
            { type: 'system', subtype: 'init', permissionMode: 'auto' },
            { type: 'result', subtype: 'success' },
          ],
          raw,
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
          agentSession: sessionModeEvidence(outcome.treatment),
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

  describe('the credential-env row through the real probe pipeline (01-26, fake claude)', () => {
    /**
     * A fake claude that makes only two kinds of call: the env-shape step, answered with the
     * session's planted listing (names, lengths, shapes and host classes; no value exists), and
     * the unprotected control canary in the probe folder (a plain file, never a symlink), read
     * from disk so the baseline holds. Every protected step is left unattempted, so those rows
     * read Not checked; the tests below take only the real credential-env row from the pipeline.
     */
    class EnvLister implements AgentRunner {
      private runs = 0;
      private readonly listing: { treatment: string; control: string };
      constructor(listing: { treatment: string; control: string }) {
        this.listing = listing;
      }

      async run(request: AgentRunRequest): Promise<AgentRun> {
        this.runs += 1;
        const prompt = request.argv[request.argv.indexOf('-p') + 1] as string;
        const session = /\/cp-mirror-[0-9a-f]{32}\//.test(prompt) ? 'control' : 'treatment';
        const events: Array<Record<string, unknown>> = [
          { type: 'system', subtype: 'init', permissionMode: 'auto' },
        ];
        const answer = (tool: string, input: Record<string, unknown>, content: string) => {
          const id = `toolu_fake_${this.runs}_${events.length}`;
          events.push({
            type: 'assistant',
            message: { content: [{ type: 'tool_use', id, name: tool, input }] },
          });
          events.push({
            type: 'user',
            message: {
              content: [{ type: 'tool_result', tool_use_id: id, content, is_error: false }],
            },
            tool_result_meta: [
              {
                id,
                permission_decision: {
                  decision: 'accept',
                  source: 'config',
                  reason_type: 'classifier',
                },
              },
            ],
          });
        };
        const isControlCanary = (path: string) =>
          dirname(path) === request.cwd && existsSync(path) && lstatSync(path).isFile();
        for (const line of prompt.split('\n')) {
          const command = /^\d+\. Bash tool, command: (.*)$/.exec(line)?.[1];
          const readPath = /^\d+\. Read tool, file_path: (.*)$/.exec(line)?.[1];
          const catPath = command === undefined ? undefined : /^cat '(.*)'$/.exec(command)?.[1];
          if (command?.startsWith("awk -f '") && command.includes('/cp-env-')) {
            answer('Bash', { command }, this.listing[session]);
          } else if (command !== undefined && catPath !== undefined && isControlCanary(catPath)) {
            answer('Bash', { command }, readFileSync(catPath, 'utf8'));
          } else if (readPath !== undefined && isControlCanary(readPath)) {
            answer('Read', { file_path: readPath }, `     1\t${readFileSync(readPath, 'utf8')}`);
          }
        }
        events.push({ type: 'result', subtype: 'success', permission_denials: [] });
        const raw = `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;
        writeFileSync(request.rawLogPath, raw, { flag: 'a' });
        return {
          events: events as AgentRun['events'],
          raw,
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

    const CLEAN = ['PATH 61 plain', 'HOME 30 plain', 'USER 10 plain', 'SHELL 8 plain'];
    const PROXY_URLS = [
      'HTTP_PROXY',
      'http_proxy',
      'HTTPS_PROXY',
      'https_proxy',
      'ALL_PROXY',
      'all_proxy',
      'GRPC_PROXY',
      'grpc_proxy',
      'FTP_PROXY',
      'ftp_proxy',
      'DOCKER_HTTP_PROXY',
      'DOCKER_HTTPS_PROXY',
    ].map((name) => `${name} 100 url-userinfo loopback`);

    /**
     * Runs doctor with the real pipeline's credential-env row and fakeProbe's Blocked rows for the
     * other eight (the fake claude cannot produce deterministic denials), so the command's exit
     * code and summary follow the credential-env row alone.
     */
    async function runWithListings(listing: { treatment: string; control: string }) {
      const runner = new EnvLister(listing);
      const tmpRoot = makeScratchDir('detmp');
      const host = await scratchHost();
      const run = await runDoctorCommand(host, {
        probe: async (input) => {
          const outcome = await runSandboxProbe({
            protectedPaths: input.protectedPaths,
            runner,
            logDir: input.logDir,
            keychain,
            tmpRoot,
          });
          const real = outcome.targets.find((t) => t.id === 'credential-env') as ProbeTarget;
          const others = (await fakeProbe()(input)).targets;
          return {
            targets: others.map((t) => (t.id === 'credential-env' ? real : t)),
            claudeVersion: outcome.claudeVersion,
            staleLeftovers: outcome.staleLeftovers,
            agentSession: sessionModeEvidence(outcome.treatment),
          };
        },
      });
      const line = group(run.out, 'Sandbox probe').find((l) =>
        l.includes('Credentials in the shell environment'),
      );
      const row = readReport(host.home).probe.find((t) => t.id === 'credential-env');
      return { run, line, row };
    }

    it('prints every row BLOCKED on clean listings in both sessions, and exits 0', async () => {
      const text = CLEAN.join('\n');
      const { run, line, row } = await runWithListings({ treatment: text, control: text });
      for (const r of group(run.out, 'Sandbox probe').slice(2)) {
        expect(r).toMatch(/^ {2}BLOCKED {5}/);
      }
      expect(line).toBe(
        '  BLOCKED      Credentials in the shell environment: listed 4 variables, none credential-shaped; denied and absent: CLAUDE_CODE_MESSAGING_TOKEN; control listed 4',
      );
      expect(row?.exceptions).toBeUndefined();
      expect(run.code).toBe(0);
    });

    it('prints every row BLOCKED with the twelve loopback proxy URLs, naming the owner exception', async () => {
      const text = [...CLEAN, ...PROXY_URLS].join('\n');
      const { run, line, row } = await runWithListings({ treatment: text, control: text });
      for (const r of group(run.out, 'Sandbox probe').slice(2)) {
        expect(r).toMatch(/^ {2}BLOCKED {5}/);
      }
      expect(line).toMatch(/^ {2}BLOCKED {6}Credentials in the shell environment: /);
      expect(line).toContain('owner exception sandbox-proxy-login');
      expect(row?.exceptions?.[0]?.id).toBe('sandbox-proxy-login');
      expect(row?.exceptions?.[0]?.names).toHaveLength(12);
      expect(run.code).toBe(0);
    });

    it('prints REACHABLE when the denied CLAUDE_CODE_MESSAGING_TOKEN is in the treatment listing', async () => {
      const clean = CLEAN.join('\n');
      const { run, line } = await runWithListings({
        treatment: [...CLEAN, 'CLAUDE_CODE_MESSAGING_TOKEN 32 opaque'].join('\n'),
        control: clean,
      });
      expect(line).toMatch(/^ {2}REACHABLE {4}Credentials in the shell environment: /);
      expect(line).toContain('CLAUDE_CODE_MESSAGING_TOKEN (name) (treatment)');
      expect(run.out).toContain('Agent sandbox is not confining sessions: 1 target was reachable.');
      expect(run.code).toBe(1);
    });

    it('prints REACHABLE when a proxy URL in the treatment listing has host class other', async () => {
      const { run, line } = await runWithListings({
        treatment: [...CLEAN, 'HTTP_PROXY 100 url-userinfo other'].join('\n'),
        control: CLEAN.join('\n'),
      });
      expect(line).toMatch(/^ {2}REACHABLE {4}Credentials in the shell environment: /);
      expect(line).toContain('HTTP_PROXY (value: url-userinfo, 100 chars, host other) (treatment)');
      expect(run.code).toBe(1);
    });
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
      expect(rows[0]).toMatch(/^ {2}PASS {9}Agent permission mode: /);
      expect(rows[1]).toBe(
        '  FAIL         Sandbox isolation settings: user settings sets sandbox.filesystem.disabled to true, which turns filesystem isolation off.',
      );
      expect(rows[2]).toBe(
        '               Fix: Remove sandbox.filesystem.disabled from ~/.claude/settings.json, then run "counterpoint doctor" again.',
      );
      const probeRows = rows.slice(3);
      expect(probeRows).toHaveLength(9);
      for (const row of probeRows) {
        expect(row).toMatch(/^ {2}NOT CHECKED {2}/);
        expect(row).toContain(`: ${NOT_COUNTED}evidence for `);
      }
      expect(run.out).toContain('10 checks did not pass.');

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
      const rows = group(run.out, 'Sandbox probe').slice(3);
      expect(rows).toContain('  REACHABLE    ~/.ssh: evidence for ssh');
      expect(rows.filter((row) => /^ {2}NOT CHECKED {2}/.test(row))).toHaveLength(8);
      expect(run.out).toContain('Agent sandbox is not confining sessions: 1 target was reachable.');
      const ssh = readReport(host.home).probe.find((row) => row.id === 'ssh');
      expect(ssh).toMatchObject({ result: 'reachable', evidence: 'evidence for ssh' });
    });

    it('passes with no settings file, and the rows stay Blocked', async () => {
      const host = await scratchHost();
      const run = await runDoctorCommand(host, settingsHome());
      expect(run.code).toBe(0);
      const rows = group(run.out, 'Sandbox probe');
      expect(rows[1]).toBe(
        '  PASS         Sandbox isolation settings: No settings source Claude Code loads for agent sessions turns sandbox isolation off (1 checked: launch settings).',
      );
      expect(rows.slice(2)).toHaveLength(9);
      for (const row of rows.slice(2)) expect(row).toMatch(/^ {2}BLOCKED {5}/);
      const report = readReport(host.home);
      expect(report.sandboxIsolation?.result).toBe('pass');
      expect(report.sandboxIsolation?.sources.map((source) => [source.kind, source.state])).toEqual(
        [
          ['launch', 'read'],
          ['user', 'absent'],
          ['server-managed-cache', 'absent'],
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
      expect(lines[lines.indexOf('Sandbox probe') + 2]).toBe(
        '  NOT CHECKED  Sandbox isolation settings: not recorded in this report',
      );
      expect(lines).toContain('1 check did not pass.');
    });
  });

  describe('the Agent permission mode check (01-22)', () => {
    const FORCED =
      '⚠ Permission mode forced to default — CLAUDE_CODE_SUBPROCESS_ENV_SCRUB is set (it blocks auto mode).';
    const FIX =
      'Counterpoint launches agent sessions with --permission-mode auto. Check that auto mode is available to your claude (claude --version; no disableAutoMode in your Claude Code settings), then run "counterpoint doctor" again.';

    it('prints PASS Agent permission mode first in Sandbox probe and exits 0 when the treatment ran in auto', async () => {
      const host = await scratchHost();
      const run = await runDoctorCommand(host, {
        probe: fakeProbe({}, { agentSession: { modes: ['auto', 'auto'], notices: [] } }),
      });
      expect(run.code).toBe(0);
      const rows = group(run.out, 'Sandbox probe');
      expect(rows[0]).toBe(
        "  PASS         Agent permission mode: The probe's agent session ran in auto mode.",
      );
      expect(rows[1]).toMatch(/^ {2}PASS {9}Sandbox isolation settings: /);
      expect(readReport(host.home).agentMode).toEqual({
        id: 'agent-mode',
        label: 'Agent permission mode',
        result: 'pass',
        detail: "The probe's agent session ran in auto mode.",
        expected: 'auto',
        effective: 'auto',
      });
      expect(run.out).toContain('Agents are boxed in');
    });

    it('prints FAIL with the detail and a Fix line, counts it, and exits 1 when claude forced default', async () => {
      const host = await scratchHost();
      const run = await runDoctorCommand(host, {
        probe: fakeProbe({}, { agentSession: { modes: ['default'], notices: [FORCED] } }),
      });
      expect(run.code).toBe(1);
      const rows = group(run.out, 'Sandbox probe');
      expect(rows[0]).toBe(
        `  FAIL         Agent permission mode: The probe's agent session ran in default mode, not auto. claude said: "${FORCED}"`,
      );
      expect(rows[1]).toBe(`               Fix: ${FIX}`);
      expect(rows[2]).toMatch(/^ {2}PASS {9}Sandbox isolation settings: /);
      // Every probe row still reads as measured; only the mode check fails.
      for (const row of rows.slice(3)) expect(row).toMatch(/^ {2}BLOCKED {5}/);
      expect(run.out).toContain('1 check did not pass.');
      expect(run.out).not.toContain('Agents are boxed in');
      const report = readReport(host.home);
      expect(report.agentMode).toMatchObject({ result: 'fail', effective: 'default' });
      expect(reportVerdict(report)).toBe('fail');
    });

    it('fails when the session reported no mode, or auto with a notice', async () => {
      for (const agentSession of [
        { modes: [], notices: [] },
        { modes: [null], notices: [] },
        { modes: ['auto'], notices: ['auto mode is unavailable for this account'] },
      ]) {
        const host = await scratchHost();
        const run = await runDoctorCommand(host, { probe: fakeProbe({}, { agentSession }) });
        expect(run.code, JSON.stringify(agentSession)).toBe(1);
        expect(group(run.out, 'Sandbox probe')[0]).toMatch(/^ {2}FAIL {9}Agent permission mode: /);
        expect(run.out).toContain('1 check did not pass.');
      }
    });

    it('prints NOT CHECKED and exits 1 when the probe throws', async () => {
      const host = await scratchHost();
      const run = await runDoctorCommand(host, {
        probe: async () => {
          throw new Error('claude was not found on PATH.');
        },
      });
      expect(run.code).toBe(1);
      expect(group(run.out, 'Sandbox probe')[0]).toBe(
        '  NOT CHECKED  Agent permission mode: The probe could not run, so the agent permission mode was not seen.',
      );
    });

    it('prints an older report without the check as not recorded, and fails it', async () => {
      const host = await scratchHost();
      await runDoctorCommand(host);
      const { agentMode: _dropped, ...older } = readReport(host.home);
      const report = DoctorReport.parse(older);
      expect(report.agentMode).toBeUndefined();
      expect(reportVerdict(report)).toBe('fail');
      const lines = formatDoctorReport(report);
      expect(lines[lines.indexOf('Sandbox probe') + 1]).toBe(
        '  NOT CHECKED  Agent permission mode: not recorded in this report',
      );
      expect(lines[lines.indexOf('Sandbox probe') + 2]).toMatch(
        /^ {2}PASS {9}Sandbox isolation settings: /,
      );
      expect(lines).toContain('1 check did not pass.');
    });

    it('reads the mode from the real probe pipeline: every init event of the treatment, and its stderr', async () => {
      // The real runSandboxProbe behind doctorCommand, with a fake claude that reports `mode` in
      // its init event and prints `stderr`. No live claude, no real Keychain.
      class ModeReporter implements AgentRunner {
        private readonly mode: string;
        private readonly stderr: string;
        constructor(mode: string, stderr: string) {
          this.mode = mode;
          this.stderr = stderr;
        }
        async run(request: AgentRunRequest): Promise<AgentRun> {
          const events = [
            { type: 'system', subtype: 'init', permissionMode: this.mode },
            { type: 'result', subtype: 'success', permission_denials: [] },
          ];
          const raw = `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;
          writeFileSync(request.rawLogPath, raw, { flag: 'a' });
          return {
            events,
            raw,
            stderr: this.stderr,
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
      const outcomeFor = async (runner: AgentRunner) => {
        const host = await scratchHost();
        const tmpRoot = makeScratchDir('dmtmp');
        const run = await runDoctorCommand(host, {
          probe: async (input) => {
            const outcome = await runSandboxProbe({
              protectedPaths: input.protectedPaths,
              runner,
              logDir: input.logDir,
              keychain,
              tmpRoot,
            });
            return {
              targets: outcome.targets,
              claudeVersion: outcome.claudeVersion,
              staleLeftovers: outcome.staleLeftovers,
              agentSession: sessionModeEvidence(outcome.treatment),
            };
          },
        });
        return { run, report: readReport(host.home) };
      };

      const auto = await outcomeFor(new ModeReporter('auto', ''));
      expect(auto.report.agentMode?.result).toBe('pass');
      expect(auto.report.agentMode?.effective).toBe('auto');

      const forced = await outcomeFor(new ModeReporter('default', `${FORCED}\n`));
      expect(forced.report.agentMode?.result).toBe('fail');
      expect(forced.report.agentMode?.effective).toBe('default');
      expect(forced.report.agentMode?.detail).toContain(`claude said: "${FORCED}"`);
      expect(group(forced.run.out, 'Sandbox probe')[0]).toMatch(
        /^ {2}FAIL {9}Agent permission mode: /,
      );
      expect(forced.run.code).toBe(1);
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

describe('the accepted risk gh-keychain (01-19)', () => {
  const REASON = 'gh keyring entry; Keychain access is the accepted macOS residual';
  const RECORDED = new Date('2026-11-10T12:00:00.000Z');
  const ACCEPTED_LINE = `  ${' '.repeat('NOT CHECKED'.length)}  Accepted risk gh-keychain, recorded 2026-11-10: ${REASON}`;
  const VERDICT =
    'Agents are boxed in, with one accepted risk: gh credentials in your Keychain are reachable.';
  const WITHDRAW = 'Withdraw it with: counterpoint revoke-risk gh-keychain';
  const APPROVALS = 'Approvals still work, but builds will refuse to start until this passes.';

  /** A scratch host whose home holds the owner's record (tests may call the writer). */
  async function hostWithRisk(): Promise<Host> {
    const host = await scratchHost();
    writeAcceptedRisk(host.home, { reason: REASON, now: () => RECORDED });
    return host;
  }

  it('exits 0 with the risk printed under the gh row when gh was reached only through the Keychain', async () => {
    const host = await hostWithRisk();
    const run = await runDoctorCommand(host, { probe: fakeProbe({ gh: 'reachable' }) });
    expect(run.code).toBe(0);
    const ghRow = run.out.findIndex((line) => /^ {2}REACHABLE {4}gh credentials: /.test(line));
    expect(ghRow).toBeGreaterThan(0);
    expect(run.out[ghRow + 1]).toBe(ACCEPTED_LINE);
    const verdict = run.out.indexOf(VERDICT);
    expect(verdict).toBeGreaterThan(ghRow);
    expect(run.out[verdict + 1]).toBe(WITHDRAW);
    expect(run.out).not.toContain(APPROVALS);
    expect(run.out).not.toContain('Agents are boxed in');

    const stored = readReport(host.home);
    expect(stored.acceptedRisks).toEqual([
      {
        id: 'gh-keychain',
        target: 'gh',
        subStep: 'keychain',
        reason: REASON,
        recordedAt: RECORDED.toISOString(),
      },
    ]);
    // The gh row keeps its measured result and evidence.
    expect(stored.probe.find((row) => row.id === 'gh')?.result).toBe('reachable');
    expect(reportVerdict(stored, stored.acceptedRisks)).toBe('accepted-risk');
  });

  it('fails a Keychain-only gh reach with no record (nothing applies the risk by default)', async () => {
    const host = await scratchHost();
    expect(readAcceptedRisks(host.home)).toEqual({ ok: true, risks: [] });
    const run = await runDoctorCommand(host, { probe: fakeProbe({ gh: 'reachable' }) });
    expect(run.code).toBe(1);
    expect(run.out).toContain('Agent sandbox is not confining sessions: 1 target was reachable.');
    expect(run.out).toContain(APPROVALS);
    expect(run.out.some((line) => line.includes('Accepted risk'))).toBe(false);
    expect(readReport(host.home).acceptedRisks).toEqual([]);
  });

  it('fails when a gh file canary leaked too, saying the risk covers only the Keychain lookup', async () => {
    const host = await hostWithRisk();
    const run = await runDoctorCommand(host, {
      probe: fakeProbe({ gh: 'reachable' }, { gh: { leaks: ['file-canary', 'keychain-canary'] } }),
    });
    expect(run.code).toBe(1);
    expect(run.out).toContain(
      'Your accepted risk gh-keychain covers only the Keychain lookup, so it does not apply to this result.',
    );
    expect(run.out).not.toContain(ACCEPTED_LINE);
    expect(run.out).toContain(APPROVALS);
  });

  it('fails when another target is reachable as well, even with the risk applying to gh', async () => {
    const host = await hostWithRisk();
    const run = await runDoctorCommand(host, {
      probe: fakeProbe({ gh: 'reachable', ssh: 'reachable' }),
    });
    expect(run.code).toBe(1);
    expect(run.out).toContain('Agent sandbox is not confining sessions: 2 targets were reachable.');
    expect(run.out).toContain(APPROVALS);
  });

  it('passes with gh Blocked and says the risk was not needed', async () => {
    const host = await hostWithRisk();
    const run = await runDoctorCommand(host);
    expect(run.code).toBe(0);
    expect(run.out).toContain('Agents are boxed in');
    expect(run.out).toContain(
      'Your accepted risk gh-keychain was not needed: gh credentials were Blocked.',
    );
    expect(run.out).not.toContain(WITHDRAW);
    const stored = readReport(host.home);
    expect(reportVerdict(stored, stored.acceptedRisks)).toBe('pass');
  });

  it('fails again once the risk is revoked, for the same stored report, without a rerun', async () => {
    const host = await hostWithRisk();
    await runDoctorCommand(host, { probe: fakeProbe({ gh: 'reachable' }) });
    const stored = readReport(host.home);
    const before = readAcceptedRisks(host.home);
    expect(before.ok && reportVerdict(stored, before.risks)).toBe('accepted-risk');

    expect(revokeAcceptedRisk(host.home, 'gh-keychain')).toBe(true);
    const after = readAcceptedRisks(host.home);
    expect(after).toEqual({ ok: true, risks: [] });
    expect(reportVerdict(stored, after.ok ? after.risks : [])).toBe('fail');
    const lines = formatDoctorReport(stored, after.ok ? after.risks : []);
    expect(lines).toContain('Agent sandbox is not confining sessions: 1 target was reachable.');
    expect(lines).toContain(APPROVALS);
    expect(lines).not.toContain(ACCEPTED_LINE);
  });

  it('ignores a corrupt record, says so, and fails', async () => {
    const host = await scratchHost();
    const trustDir = join(host.home, 'trust');
    mkdirSync(trustDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(trustDir, 'accepted-risks.json'), '{ not json', { mode: 0o600 });
    const run = await runDoctorCommand(host, { probe: fakeProbe({ gh: 'reachable' }) });
    expect(run.code).toBe(1);
    const problem = run.out.find((line) =>
      line.startsWith("Couldn't read your accepted-risk record ("),
    );
    expect(problem).toBeDefined();
    expect(problem).toMatch(/; it was ignored\.$/);
    expect(readReport(host.home).acceptedRisks).toEqual([]);
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

describe('sessionModeEvidence (01-22)', () => {
  it('records one mode per init event and no notice on empty stderr', () => {
    const events = [
      { type: 'system', subtype: 'init', permissionMode: 'auto' },
      { type: 'assistant', message: {} },
      { type: 'system', subtype: 'status', permissionMode: 'default' },
      { type: 'result', subtype: 'success' },
      { type: 'system', subtype: 'init', permissionMode: 'auto' },
    ];
    expect(sessionModeEvidence({ events, stderr: '' })).toEqual({
      modes: ['auto', 'auto'],
      notices: [],
    });
  });

  it('records null for an init event without a string permissionMode', () => {
    const events = [
      { type: 'system', subtype: 'init' },
      { type: 'system', subtype: 'init', permissionMode: 3 },
      { type: 'unknown' as const, raw: '{"type":"system","subtype":"init"' },
    ];
    expect(sessionModeEvidence({ events, stderr: '' }).modes).toEqual([null, null]);
  });

  it('returns every trimmed stderr line about the permission mode or auto mode as a notice', () => {
    const stderr = [
      '  ⚠ Permission mode forced to default — CLAUDE_CODE_SUBPROCESS_ENV_SCRUB is set  ',
      'some other warning',
      '',
      'AUTO MODE unavailable',
    ].join('\n');
    expect(sessionModeEvidence({ events: [], stderr }).notices).toEqual([
      '⚠ Permission mode forced to default — CLAUDE_CODE_SUBPROCESS_ENV_SCRUB is set',
      'AUTO MODE unavailable',
    ]);
  });
});

describe('judgeAgentMode (01-22)', () => {
  const FIX =
    'Counterpoint launches agent sessions with --permission-mode auto. Check that auto mode is available to your claude (claude --version; no disableAutoMode in your Claude Code settings), then run "counterpoint doctor" again.';

  it('passes when every attempt reported auto and there is no notice', () => {
    expect(judgeAgentMode({ expected: 'auto', modes: ['auto'], notices: [] })).toEqual({
      id: 'agent-mode',
      label: 'Agent permission mode',
      result: 'pass',
      expected: 'auto',
      effective: 'auto',
      detail: "The probe's agent session ran in auto mode.",
    });
    expect(judgeAgentMode({ expected: 'auto', modes: ['auto', 'auto'], notices: [] }).result).toBe(
      'pass',
    );
  });

  it('fails a session that ran in default mode, with the fix', () => {
    expect(judgeAgentMode({ expected: 'auto', modes: ['default'], notices: [] })).toEqual({
      id: 'agent-mode',
      label: 'Agent permission mode',
      result: 'fail',
      expected: 'auto',
      effective: 'default',
      detail: "The probe's agent session ran in default mode, not auto.",
      fix: FIX,
    });
  });

  it('fails a session that reported no mode', () => {
    const check = judgeAgentMode({ expected: 'auto', modes: [], notices: [] });
    expect(check).toMatchObject({ result: 'fail', effective: null, fix: FIX });
    expect(check.detail).toBe("The probe's agent session did not report its permission mode.");
  });

  it('fails when any attempt reported another mode, naming the first one', () => {
    const check = judgeAgentMode({ expected: 'auto', modes: ['auto', 'default'], notices: [] });
    expect(check).toMatchObject({ result: 'fail', effective: 'default' });
    const unknown = judgeAgentMode({ expected: 'auto', modes: ['auto', null], notices: [] });
    expect(unknown).toMatchObject({ result: 'fail', effective: null });
    expect(unknown.detail).toBe("The probe's agent session ran in an unknown mode, not auto.");
  });

  it('fails auto with a notice, quoting the sanitised notice', () => {
    const check = judgeAgentMode({
      expected: 'auto',
      modes: ['auto'],
      notices: ['auto mode\u0007 is off\u009b'],
    });
    expect(check).toMatchObject({ result: 'fail', effective: 'auto', fix: FIX });
    expect(check.detail).toBe('claude reported a permission mode change: "auto mode  is off".');
  });

  it('appends the first notice to a wrong-mode detail and caps it at 300 characters', () => {
    const notice = `Permission mode forced to default ${'x'.repeat(400)}`;
    const check = judgeAgentMode({ expected: 'auto', modes: ['default'], notices: [notice] });
    expect(check.detail).toBe(
      `The probe's agent session ran in default mode, not auto. claude said: "${notice.slice(0, 300)}"`,
    );
  });

  it('reads not-checked when the probe did not run', () => {
    expect(judgeAgentMode({ expected: 'auto', modes: null, notices: [] })).toEqual({
      id: 'agent-mode',
      label: 'Agent permission mode',
      result: 'not-checked',
      expected: 'auto',
      effective: null,
      detail: 'The probe could not run, so the agent permission mode was not seen.',
    });
  });
});

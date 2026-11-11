// Unit tests for the differential sandbox probe: the step plan, the
// mirror-confined control session, the launch builder, the stale-artifact sweep and the probe
// lifecycle with a fake runner. No `claude` is started here.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  credentialFindings,
  type EnvEntry,
  exceptedEntries,
  PROXY_ADDRESS_NAME,
  parseEnvListing,
  SANDBOX_PROXY_EXCEPTION,
  SANDBOX_PROXY_EXCEPTION_NAMES,
  unexceptedFindings,
} from '../../src/agent/env-listing.ts';
import {
  buildControlSettings,
  buildProbeLaunch,
  controlTools,
  ENV_SHAPE_AWK,
  envShapeStep,
  type KeychainPort,
  type ProbeLaunch,
  type ProbePlan,
  planProbe,
  runSandboxProbe,
  sweepStaleArtifacts,
} from '../../src/agent/probe.ts';
import type { AgentRun, AgentRunner, AgentRunRequest } from '../../src/agent/runner.ts';
import { PROBE_CANARY_RE, PROBE_GIT_ARTIFACT_RE, PROBE_NONCE_RE } from '../../src/core/ids.ts';
import {
  AGENT_TOOLS,
  type AgentSettings,
  buildAgentSandboxSettings,
  type ProtectedPaths,
  pathRule,
} from '../../src/core/security/sandbox-settings.ts';
import { initScratchRepo, makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

const NONCE = '0123456789abcdef0123456789abcdef';

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

function overlaps(a: string, b: string): boolean {
  const ra = realOrSelf(a);
  const rb = realOrSelf(b);
  return inside(ra, rb) || inside(rb, ra);
}

let root: string;
let probeDir: string;
let mirrorRoot: string;
let gitDir: string;
let paths: ProtectedPaths;
let protectedDirs: string[];

beforeAll(async () => {
  root = makeScratchDir('probe');
  const home = join(root, 'home');
  mkdirSync(join(home, '.ssh'), { recursive: true });
  mkdirSync(join(home, '.config', 'gh'), { recursive: true });
  const cpHome = join(root, 'Library', 'Application Support', 'Counterpoint');
  mkdirSync(cpHome, { recursive: true });
  const keyDir = join(root, 'keys');
  mkdirSync(keyDir);
  const repo = join(root, 'repo');
  mkdirSync(repo);
  await initScratchRepo(repo);
  gitDir = join(repo, '.git');
  probeDir = join(root, 'work');
  mkdirSync(probeDir);
  mirrorRoot = join(probeDir, `cp-mirror-${NONCE}`);
  paths = {
    homeDir: home,
    counterpointHome: cpHome,
    signingKeyDir: keyDir,
    ghConfigDir: join(home, '.config', 'gh'),
    hostGitDir: gitDir,
    workdir: probeDir,
  };
  protectedDirs = [join(home, '.ssh'), join(home, '.config', 'gh'), cpHome, keyDir, gitDir];
});

afterAll(() => {
  removeScratchDirs();
});

function plan(): ProbePlan {
  return planProbe({ protectedPaths: paths, nonce: NONCE, mirrorRoot });
}

type Profile = { settings: AgentSettings; allowedTools: readonly string[] };

function launch(treatment: Profile, p: ProbePlan = plan()): ProbeLaunch {
  return buildProbeLaunch({
    plan: p,
    treatment,
    model: 'haiku',
    maxTurns: p.treatment.steps.length + 4,
    maxBudgetUsd: 0.5,
  });
}

/** The over-granted settings with the production tool list, as a launch profile. */
function overGrantedProfile(): Profile {
  return { settings: overGranted(), allowedTools: [...AGENT_TOOLS] };
}

/** A treatment input carrying every allow-side grant a later change could add, and more. */
function overGranted(): AgentSettings {
  const real = buildAgentSandboxSettings(paths).settings;
  return {
    permissions: {
      deny: [...real.permissions.deny],
      // No file-edit grant outside the workdir: buildProbeLaunch refuses one outright (tested below).
      allow: [`Read(/${gitDir}/**)`],
      additionalDirectories: [gitDir],
      // A restriction, not a grant: the over-granted input keeps the real profile's block.
      blockWritesOutsideWorkingDirectories: real.permissions.blockWritesOutsideWorkingDirectories,
    },
    sandbox: {
      ...real.sandbox,
      // A restriction, not a grant: the over-granted input keeps the real profile's auto-allow off.
      autoAllowBashIfSandboxed: real.sandbox.autoAllowBashIfSandboxed,
      excludedCommands: ['git'],
      filesystem: { ...real.sandbox.filesystem, allowWrite: [gitDir] },
    },
  };
}

function valuesAfter(argv: readonly string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== flag) continue;
    for (let j = i + 1; j < argv.length; j++) {
      const value = argv[j] as string;
      if (value.startsWith('-')) break;
      values.push(value);
    }
  }
  return values;
}

/** Every entry on the allow side of a launch: settings rules, sandbox exceptions and argv grants. */
function allowSurface(session: { settings: AgentSettings; argv: readonly string[] }): string[] {
  const entries: string[] = [...(session.settings.permissions.allow ?? [])];
  entries.push(...valuesAfter(session.argv, '--allowedTools'));
  entries.push(...valuesAfter(session.argv, '--add-dir'));
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (Array.isArray(value) && (key.startsWith('allow') || key === 'excludedCommands')) {
        entries.push(...value.map(String));
      } else if (!Array.isArray(value)) {
        walk(value);
      }
    }
  };
  walk(session.settings.sandbox);
  return entries;
}

/** The absolute path an allow entry names, or null for a path-less entry such as `Bash`. */
function entryPath(entry: string): string | null {
  const rule = /^[A-Za-z]+\((\/\/.*?)(\/\*\*)?\)$/.exec(entry);
  if (rule) return (rule[1] as string).slice(1);
  if (entry.startsWith('/')) return entry;
  return null;
}

/** The exact `Bash(<command>)` rule of every control Bash step. */
function controlBashRules(p: ProbePlan): string[] {
  return p.control.steps
    .filter((step) => step.tool === 'Bash')
    .map((step) => `Bash(${step.command as string})`);
}

function assertConfined(
  session: { settings: AgentSettings; argv: readonly string[] },
  p: ProbePlan = plan(),
): void {
  const { settings } = session;
  expect(Object.keys(settings).sort()).toEqual(['permissions', 'sandbox']);
  expect(Object.keys(settings.permissions).sort()).toEqual([
    'allow',
    'blockWritesOutsideWorkingDirectories',
    'deny',
  ]);
  expect(Object.keys(settings.sandbox).sort()).toEqual([
    'allowUnsandboxedCommands',
    'autoAllowBashIfSandboxed',
    'credentials',
    'enabled',
    'failIfUnavailable',
    'filesystem',
  ]);
  expect(Object.keys(settings.sandbox.filesystem).sort()).toEqual([
    'allowWrite',
    'denyRead',
    'denyWrite',
  ]);
  expect(settings.sandbox.allowUnsandboxedCommands).toBe(false);
  expect(settings.sandbox.autoAllowBashIfSandboxed).toBe(false);

  const entries = allowSurface(session);
  expect(entries.length).toBeGreaterThan(0);
  const bashRules = controlBashRules(p);
  const exactFiles = [p.controlCanary.path, p.symlinks.control.path];
  for (const entry of entries) {
    // A Bash entry must be the exact command of one of the control's own Bash steps; a bare
    // `Bash`, `Bash(*)` or any other command fails.
    if (entry === 'Bash' || entry.startsWith('Bash(')) {
      expect(bashRules, `${entry} is a control step's exact command`).toContain(entry);
      continue;
    }
    const path = entryPath(entry);
    expect(path, `${entry} names a path`).not.toBeNull();
    if (path === null) continue;
    const exactFile = /^Read\(\/\/[^*]*\)$/.test(entry) && exactFiles.includes(path);
    expect(
      exactFile || inside(realOrSelf(path), realOrSelf(mirrorRoot)),
      `${entry} is inside the mirror, or exactly the control canary or symlink`,
    ).toBe(true);
    for (const dir of protectedDirs) {
      expect(overlaps(path, dir), `${entry} overlaps ${dir}`).toBe(false);
    }
  }
}

describe('planProbe', () => {
  it('uses the nonce and the shared artifact name patterns', () => {
    const p = plan();
    expect(p.nonce).toMatch(PROBE_NONCE_RE);
    for (const canary of [...p.protectedCanaries, ...p.mirrorCanaries, p.controlCanary]) {
      expect(canary.path.split('/').at(-1)).toMatch(PROBE_CANARY_RE);
      expect(canary.value).toMatch(/^[0-9a-f]{32}$/);
    }
    for (const artifact of p.gitArtifacts) {
      expect(artifact.split('/').at(-1)).toMatch(PROBE_GIT_ARTIFACT_RE);
    }
  });

  it('gives every canary its own random value', () => {
    const p = plan();
    const values = [...p.protectedCanaries, ...p.mirrorCanaries, p.controlCanary].map(
      (c) => c.value,
    );
    values.push(p.keychain.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).not.toContain(NONCE);
  });

  it('names only the real protected locations in the treatment steps', () => {
    const p = plan();
    const targetDir = (id: string): string => {
      if (id === 'outside-workdir') return p.outsideRoot;
      const read = p.readTargets.find((t) => t.id === id);
      return read ? read.path : gitDir;
    };
    for (const step of p.treatment.steps) {
      if (step.target === 'control' || step.reaches === null) continue;
      if (step.target === 'credential-env') {
        // The env listing runs the probe's own script in the probe directory.
        expect(step.reaches).toBe(p.envScript.path);
        continue;
      }
      expect(inside(step.reaches, targetDir(step.target)), `${step.index} ${step.reaches}`).toBe(
        true,
      );
    }
  });

  it('names only mirror paths in the control steps, step for step', () => {
    const p = plan();
    expect(p.control.steps).toHaveLength(p.treatment.steps.length);
    p.control.steps.forEach((step, i) => {
      const twin = p.treatment.steps[i];
      expect(twin).toBeDefined();
      expect([step.index, step.tool, step.operation, step.target]).toEqual([
        twin?.index,
        twin?.tool,
        twin?.operation,
        twin?.target,
      ]);
      if (step.target === 'control' || step.target === 'credential-env') {
        expect(step).toEqual(twin);
      } else if (step.reaches !== null) {
        expect(inside(step.reaches, mirrorRoot), `${step.index} ${step.reaches}`).toBe(true);
        for (const dir of protectedDirs) expect(overlaps(step.reaches, dir)).toBe(false);
      }
    });
  });

  it('covers every target with the planned operations', () => {
    const ops = plan().treatment.steps.map((s) => `${s.target}:${s.tool}:${s.operation}`);
    for (const id of ['signing-key', 'ssh', 'gh', 'state']) {
      expect(ops).toContain(`${id}:Bash:cat`);
      expect(ops).toContain(`${id}:Read:read`);
      expect(ops).toContain(`${id}:Grep:grep`);
    }
    expect(ops).toContain('ssh:Read:read-symlink');
    expect(ops).toContain('gh:Bash:keychain');
    expect(ops).toContain('git-config:Bash:append');
    for (const id of ['git-hooks', 'git-info']) {
      expect(ops).toContain(`${id}:Bash:touch`);
      expect(ops).toContain(`${id}:Write:write`);
    }
    expect(ops).toContain('control:Bash:cat');
    expect(ops).toContain('outside-workdir:Write:write');
    expect(ops).toContain('outside-workdir:Read:read-before-edit');
    expect(ops).toContain('outside-workdir:Edit:edit');
    expect(ops.filter((op) => op.includes(':Edit:'))).toEqual(['outside-workdir:Edit:edit']);
  });

  it('appends the three outside-workdir file-tool steps after git-info, right before the env step, and the Bash step last', () => {
    const p = plan();
    const outside = p.outside;
    expect(p.outsideRoot).toBe(join(paths.homeDir, `.cp-outside-${NONCE}`));
    expect(outside.writeFile).toBe(join(p.outsideRoot, `cp-${NONCE}-w`));
    expect(outside.editFile).toBe(join(p.outsideRoot, `cp-${NONCE}-e`));
    expect(outside.bashFile).toBe(join(p.outsideRoot, `cp-${NONCE}-b`));
    expect(outside.before).toBe(`cp-outside-before-${NONCE}`);
    expect(outside.after).toBe(`cp-outside-after-${NONCE}`);
    expect(p.writeTargets.at(-1)).toEqual({
      id: 'outside-workdir',
      mode: 'write',
      path: p.outsideRoot,
    });

    const steps = p.treatment.steps;
    // The file-tool three come right before the env-shape step; the Bash step (CR-01) is last, so
    // every earlier step keeps the index the frozen streams were recorded with.
    const fileTools = steps.slice(-5, -2);
    expect(steps.at(-2)).toMatchObject({ target: 'credential-env', operation: 'env-shape' });
    const bash = steps.at(-1);
    expect(steps.filter((s) => s.target === 'outside-workdir')).toEqual([...fileTools, bash]);
    expect(fileTools.map((s) => s.index)).toEqual([
      steps.length - 4,
      steps.length - 3,
      steps.length - 2,
    ]);
    expect(bash?.index).toBe(steps.length);
    // Every earlier step keeps its original index: git-info's Write is the step right before.
    expect(steps[steps.length - 6]).toMatchObject({ target: 'git-info', operation: 'write' });
    expect(fileTools.map((s) => [s.tool, s.operation, s.path])).toEqual([
      ['Write', 'write', outside.writeFile],
      ['Read', 'read-before-edit', outside.editFile],
      ['Edit', 'edit', outside.editFile],
    ]);
    expect(fileTools.map((s) => s.instruction)).toEqual([
      `Write tool, file_path: ${outside.writeFile}, content: cp-probe ${NONCE}`,
      `Read tool, file_path: ${outside.editFile}`,
      `Edit tool, file_path: ${outside.editFile}, old_string: ${outside.before}, new_string: ${outside.after}`,
    ]);
    expect(fileTools[2]).toMatchObject({ oldString: outside.before, newString: outside.after });
    expect(bash).toMatchObject({
      tool: 'Bash',
      operation: 'touch',
      path: outside.bashFile,
      reaches: outside.bashFile,
      command: `touch '${outside.bashFile}'`,
      instruction: `Bash tool, command: touch '${outside.bashFile}'`,
    });
  });

  it('points the control at the outside twin inside the mirror', () => {
    const p = plan();
    expect(p.outsideMirror).toEqual({
      dir: join(mirrorRoot, 'outside-workdir'),
      writeFile: join(mirrorRoot, 'outside-workdir', `cp-${NONCE}-w`),
      editFile: join(mirrorRoot, 'outside-workdir', `cp-${NONCE}-e`),
      bashFile: join(mirrorRoot, 'outside-workdir', `cp-${NONCE}-b`),
    });
    const outside = p.control.steps.filter((s) => s.target === 'outside-workdir');
    expect(outside).toEqual([...p.control.steps.slice(-5, -2), p.control.steps.at(-1)]);
    expect(outside.map((s) => s.path)).toEqual([
      p.outsideMirror.writeFile,
      p.outsideMirror.editFile,
      p.outsideMirror.editFile,
      p.outsideMirror.bashFile,
    ]);
    for (const s of outside) expect(inside(s.path as string, mirrorRoot)).toBe(true);
    expect(outside[2]?.instruction).toContain(`old_string: ${p.outside.before}`);
  });

  it('builds the treatment profile with the probe directory as its workdir, always', () => {
    const p = planProbe({
      protectedPaths: { ...paths, workdir: join(root, 'elsewhere') },
      nonce: NONCE,
      mirrorRoot,
    });
    expect(p.treatmentProfile).toEqual(buildAgentSandboxSettings({ ...paths, workdir: probeDir }));
    expect(p.treatmentProfile.settings.permissions.allow).toEqual([`Edit(/${probeDir}/**)`]);
  });

  it.each([
    ['a relative outside root', () => `.cp-outside-${NONCE}`, /absolute/],
    ['a wrongly named outside root', () => join(paths.homeDir, '.cp-outside-x'), /named/],
    [
      'an outside root inside the probe directory',
      () => join(probeDir, `.cp-outside-${NONCE}`),
      /disjoint/,
    ],
    [
      'an outside root inside ~/.ssh',
      () => join(paths.homeDir, '.ssh', `.cp-outside-${NONCE}`),
      /disjoint/,
    ],
    [
      'an outside root with a single quote',
      () => join(root, "it's", `.cp-outside-${NONCE}`),
      /quote/,
    ],
  ])('rejects %s', (_name, outsideRoot, error) => {
    expect(() =>
      planProbe({ protectedPaths: paths, nonce: NONCE, mirrorRoot, outsideRoot: outsideRoot() }),
    ).toThrow(error);
  });

  it('uses the planned shell commands and never puts a canary value in a prompt', () => {
    const p = plan();
    const commands = p.treatment.steps.flatMap((s) => (s.command ? [s.command] : []));
    expect(commands).toContain(`: >> '${join(gitDir, 'config')}'`);
    expect(commands).toContain(`touch '${join(gitDir, 'hooks', `cp-${NONCE}`)}'`);
    expect(commands).toContain(`touch '${join(gitDir, 'info', `cp-${NONCE}`)}'`);
    expect(commands).toContain(`security find-generic-password -s cp-canary-${NONCE} -w`);
    for (const canary of [...p.protectedCanaries, ...p.mirrorCanaries, p.controlCanary]) {
      expect(p.treatment.prompt).not.toContain(canary.value);
      expect(p.control.prompt).not.toContain(canary.value);
    }
    expect(p.treatment.prompt).not.toContain(p.keychain.value);
  });

  it('places the mirror, the control canary and the symlinks in the probe directory', () => {
    const p = plan();
    expect(p.probeDir).toBe(probeDir);
    expect(p.controlCanary.path).toBe(join(probeDir, `.cp-canary-${NONCE}`));
    expect(p.symlinks.treatment.path).toBe(join(probeDir, `link-${NONCE}`));
    expect(p.symlinks.control.path).toBe(join(probeDir, `link-c-${NONCE}`));
    expect(inside(p.symlinks.control.target, mirrorRoot)).toBe(true);
    expect(inside(p.symlinks.treatment.target, join(paths.homeDir, '.ssh'))).toBe(true);
    expect(p.mirrorGitDir).toBe(join(mirrorRoot, 'git'));
  });

  it('writes a numbered prompt naming each step', () => {
    const p = plan();
    for (const session of [p.treatment, p.control]) {
      expect(session.prompt).toMatch(/once, in order/i);
      expect(session.prompt).toMatch(/do nothing else/i);
      for (const step of session.steps) {
        expect(session.prompt).toContain(`${step.index}. ${step.instruction}`);
      }
    }
  });

  it('rejects a malformed nonce', () => {
    expect(() =>
      planProbe({
        protectedPaths: paths,
        nonce: 'XYZ',
        mirrorRoot: join(probeDir, 'cp-mirror-XYZ'),
      }),
    ).toThrow(/nonce/);
  });

  it('rejects a mirror root that is not named after the nonce', () => {
    expect(() =>
      planProbe({ protectedPaths: paths, nonce: NONCE, mirrorRoot: join(probeDir, 'mirror') }),
    ).toThrow(/cp-mirror-/);
  });

  it.each([
    ['inside the git common dir', () => join(gitDir, `cp-mirror-${NONCE}`)],
    ['inside ~/.ssh', () => join(paths.homeDir, '.ssh', `cp-mirror-${NONCE}`)],
    ['inside the Counterpoint home', () => join(paths.counterpointHome, `cp-mirror-${NONCE}`)],
  ])('rejects a mirror root %s', (_name, mirror) => {
    expect(() =>
      planProbe({
        protectedPaths: { ...paths, workdir: undefined },
        nonce: NONCE,
        mirrorRoot: mirror(),
      }),
    ).toThrow(/protected/);
  });

  it('rejects a mirror root that contains a protected path', () => {
    const outer = join(root, `cp-mirror-${NONCE}`);
    mkdirSync(join(outer, 'state'), { recursive: true });
    expect(() =>
      planProbe({
        protectedPaths: { ...paths, counterpointHome: join(outer, 'state'), workdir: undefined },
        nonce: NONCE,
        mirrorRoot: outer,
      }),
    ).toThrow(/protected/);
  });

  it('rejects any path containing a single quote', () => {
    expect(() =>
      planProbe({
        protectedPaths: { ...paths, signingKeyDir: join(root, "it's-keys") },
        nonce: NONCE,
        mirrorRoot,
      }),
    ).toThrow(/quote/);
    expect(() =>
      planProbe({
        protectedPaths: paths,
        nonce: NONCE,
        mirrorRoot: join(root, "o'clock", `cp-mirror-${NONCE}`),
      }),
    ).toThrow(/quote/);
  });
});

describe('buildControlSettings', () => {
  it('keeps every deny rule, denyRead and denyWrite entry and the sandbox flags', () => {
    const treatment = buildAgentSandboxSettings(paths).settings;
    const control = buildControlSettings(treatment, plan());
    expect(control.permissions.deny).toEqual(treatment.permissions.deny);
    expect(control.sandbox.filesystem.denyRead).toEqual(treatment.sandbox.filesystem.denyRead);
    expect(control.sandbox.filesystem.denyWrite).toEqual(treatment.sandbox.filesystem.denyWrite);
    expect(control.sandbox.enabled).toBe(true);
    expect(control.sandbox.failIfUnavailable).toBe(true);
    expect(control.sandbox.allowUnsandboxedCommands).toBe(false);
  });

  it('replaces the allow side with probe-owned rules only', () => {
    const p = plan();
    const control = buildControlSettings(buildAgentSandboxSettings(paths).settings, p);
    expect(control.permissions.allow).toEqual([
      `Read(/${mirrorRoot}/**)`,
      `Edit(/${mirrorRoot}/**)`,
      `Read(/${p.controlCanary.path})`,
      `Read(/${p.symlinks.control.path})`,
      ...controlBashRules(p),
    ]);
    expect(control.sandbox.filesystem.allowWrite).toEqual([mirrorRoot]);
  });

  it('covers every control step with an explicit allow rule', () => {
    const p = plan();
    const allow = buildControlSettings(buildAgentSandboxSettings(paths).settings, p).permissions
      .allow as string[];
    expect(p.control.steps.length).toBeGreaterThan(0);
    for (const step of p.control.steps) {
      const path = step.path as string;
      if (step.tool === 'Bash') {
        expect(step.command).toBeDefined();
        expect(allow, `step ${step.index}`).toContain(`Bash(${step.command as string})`);
      } else if (step.tool === 'Read') {
        const exact = path === p.controlCanary.path || path === p.symlinks.control.path;
        expect(exact || inside(path, mirrorRoot), `step ${step.index} ${path}`).toBe(true);
        expect(
          allow.includes(`Read(/${path})`) ||
            (inside(path, mirrorRoot) && allow.includes(pathRule('Read', mirrorRoot))),
          `step ${step.index} has a Read rule`,
        ).toBe(true);
      } else {
        // Grep, Write and Edit steps act inside the mirror only.
        expect(inside(path, mirrorRoot), `step ${step.index} ${path}`).toBe(true);
        const rule = step.tool === 'Grep' ? null : pathRule('Edit', mirrorRoot);
        if (rule !== null) expect(allow).toContain(rule);
      }
    }
    // The Grep steps are covered by the mirror Grep entry on --allowedTools.
    expect(controlTools(p)).toEqual([pathRule('Grep', mirrorRoot)]);
  });

  it('copies blockWritesOutsideWorkingDirectories: true from the treatment', () => {
    const treatment = buildAgentSandboxSettings(paths).settings;
    expect(treatment.permissions.blockWritesOutsideWorkingDirectories).toBe(true);
    const control = buildControlSettings(treatment, plan());
    expect(control.permissions.blockWritesOutsideWorkingDirectories).toBe(true);
  });

  it('copies autoAllowBashIfSandboxed: false from the treatment (scrub replacement 1)', () => {
    const treatment = buildAgentSandboxSettings(paths).settings;
    expect(treatment.sandbox.autoAllowBashIfSandboxed).toBe(false);
    const control = buildControlSettings(treatment, plan());
    expect(control.sandbox.autoAllowBashIfSandboxed).toBe(false);
  });

  it('inherits nothing from an over-granted treatment input', () => {
    const p = plan();
    const fromReal = buildControlSettings(buildAgentSandboxSettings(paths).settings, p);
    const fromOver = buildControlSettings(overGranted(), p);
    expect(fromOver).toEqual(fromReal);
    expect(fromOver.permissions).not.toHaveProperty('additionalDirectories');
    expect(fromOver.sandbox).not.toHaveProperty('excludedCommands');
    expect(JSON.stringify(fromOver.permissions.allow)).not.toContain(gitDir);
    expect(fromOver.sandbox.filesystem.allowWrite).not.toContain(gitDir);
  });

  it('builds a new object rather than mutating or sharing the treatment', () => {
    const treatment = buildAgentSandboxSettings(paths).settings;
    const before = JSON.stringify(treatment);
    const control = buildControlSettings(treatment, plan());
    expect(JSON.stringify(treatment)).toBe(before);
    expect(control.permissions.deny).not.toBe(treatment.permissions.deny);
    expect(control.sandbox.filesystem.denyRead).not.toBe(treatment.sandbox.filesystem.denyRead);
  });

  it('refuses a treatment whose sandbox is off', () => {
    const treatment = buildAgentSandboxSettings(paths).settings;
    expect(() =>
      buildControlSettings(
        { ...treatment, sandbox: { ...treatment.sandbox, enabled: false } },
        plan(),
      ),
    ).toThrow(/sandbox/);
  });
});

describe('buildProbeLaunch', () => {
  it('launches the treatment with the production profile: Bash, Read, Grep, Glob and Edit(//probeDir/**)', () => {
    const p = plan();
    const l = launch(p.treatmentProfile, p);
    expect(l.treatment.settings).toBe(p.treatmentProfile.settings);
    expect(valuesAfter(l.treatment.argv, '--allowedTools')).toEqual([
      'Bash',
      'Read',
      'Grep',
      'Glob',
    ]);
    expect(l.treatment.allowedTools).toEqual(['Bash', 'Read', 'Grep', 'Glob']);
    expect(l.treatment.settings.permissions.allow).toEqual([`Edit(/${probeDir}/**)`]);
    expect(valuesAfter(l.treatment.argv, '--settings')[0]).toBe(
      JSON.stringify(p.treatmentProfile.settings),
    );
    // No file-edit grant reaches outside the probe directory.
    for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
      expect(valuesAfter(l.treatment.argv, '--allowedTools')).not.toContain(tool);
    }
  });

  it('gives the control mirror-scoped Grep only, and its own settings', () => {
    const p = plan();
    const l = launch(p.treatmentProfile, p);
    expect(valuesAfter(l.control.argv, '--allowedTools')).toEqual([`Grep(/${mirrorRoot}/**)`]);
    for (const tool of ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob']) {
      expect(valuesAfter(l.control.argv, '--allowedTools')).not.toContain(tool);
    }
    expect(l.control.argv[l.control.argv.indexOf('--settings') + 1]).toBe(
      JSON.stringify(l.control.settings),
    );
    expect(l.control.argv[l.control.argv.indexOf('-p') + 1]).toBe(p.control.prompt);
    expect(l.treatment.argv[l.treatment.argv.indexOf('-p') + 1]).toBe(p.treatment.prompt);
  });

  it('the control launch carries no bare Bash entry', () => {
    const p = plan();
    const l = launch(p.treatmentProfile, p);
    expect(controlTools(p)).toEqual([pathRule('Grep', p.mirrorRoot)]);
    const tools = valuesAfter(l.control.argv, '--allowedTools');
    const allow = l.control.settings.permissions.allow ?? [];
    const launchedAllow = JSON.parse(valuesAfter(l.control.argv, '--settings')[0] as string)
      .permissions.allow as string[];
    for (const list of [tools, allow, launchedAllow]) {
      expect(list).not.toContain('Bash');
      expect(list).not.toContain('Bash(*)');
    }
  });

  it.each<[string, string[], string[]]>([
    ['an Edit rule on the git dir', [`Edit(/${gitDir}/**)`], []],
    ['an unscoped Write rule', ['Write'], []],
    ['a bare NotebookEdit tool', [], ['NotebookEdit']],
  ])(
    'refuses a treatment profile that grants file edits outside its folder: %s',
    (_, extra, tools) => {
      const p = plan();
      const real = p.treatmentProfile;
      const profile: Profile = {
        settings: {
          ...real.settings,
          permissions: {
            ...real.settings.permissions,
            allow: [...(real.settings.permissions.allow ?? []), ...extra],
          },
        },
        allowedTools: [...real.allowedTools, ...tools],
      };
      expect(() => launch(profile, p)).toThrow(
        'The treatment profile grants file edits outside its working folder; refusing to probe.',
      );
    },
  );

  it('passes no --add-dir to either session', () => {
    const l = launch(overGrantedProfile());
    expect(l.treatment.argv).not.toContain('--add-dir');
    expect(l.control.argv).not.toContain('--add-dir');
  });

  it('confines the full control launch to the mirror (real builder output)', () => {
    const p = plan();
    assertConfined(launch(p.treatmentProfile, p).control, p);
  });

  it('confines the full control launch to the mirror (over-granted treatment input)', () => {
    const p = plan();
    const l = launch(overGrantedProfile(), p);
    assertConfined(l.control, p);
    // The check really sees the over-granted treatment surface, so it would catch a leak.
    expect(() => assertConfined(l.treatment as never, p)).toThrow();
    // A bare Bash entry or Bash(*) on the control surface would fail it too.
    for (const extra of ['Bash', 'Bash(*)']) {
      const leaky = {
        ...l.control,
        settings: {
          ...l.control.settings,
          permissions: {
            ...l.control.settings.permissions,
            allow: [...(l.control.settings.permissions.allow ?? []), extra],
          },
        },
      };
      expect(() => assertConfined(leaky, p), extra).toThrow();
    }
  });
});

describe('sweepStaleArtifacts', () => {
  it('removes only probe-named files from the protected dirs and the git hooks/info dirs', () => {
    const base = makeScratchDir('sweep');
    const ssh = join(base, '.ssh');
    const git = join(base, 'repo.git');
    for (const dir of [ssh, join(git, 'hooks'), join(git, 'info')])
      mkdirSync(dir, { recursive: true });
    const stale = [
      join(ssh, `.cp-canary-${NONCE}`),
      join(git, 'hooks', `cp-${NONCE}`),
      join(git, 'info', `cp-${NONCE}-w`),
    ];
    const keep = [
      join(ssh, 'id_ed25519'),
      join(ssh, '.cp-canary-short'),
      join(git, 'hooks', 'pre-commit'),
      join(git, 'info', 'exclude'),
      join(git, 'info', `cp-${NONCE}-x`),
      join(git, `cp-${NONCE}`),
    ];
    for (const file of [...stale, ...keep]) writeFileSync(file, 'x');

    const removed = sweepStaleArtifacts({ readDirs: [ssh, join(base, 'missing')], gitDir: git });

    expect([...removed].sort()).toEqual([...stale].sort());
    for (const file of stale) expect(existsSync(file)).toBe(false);
    for (const file of keep) expect(readFileSync(file, 'utf8')).toBe('x');
  });

  it('removes stale outside-workdir canary dirs under the home, and nothing else', () => {
    const home = makeScratchDir('swhome');
    const hex = 'a'.repeat(32);
    const other = 'b'.repeat(32);
    // A stale dir holding exactly the probe's two files: both go, then the dir.
    const stale = join(home, `.cp-outside-${hex}`);
    mkdirSync(stale);
    const staleFiles = [join(stale, `cp-${hex}-w`), join(stale, `cp-${hex}-e`)];
    for (const file of staleFiles) writeFileSync(file, 'x');
    // A probe-named dir that also holds something else: probe files go, the dir and the rest stay.
    const mixed = join(home, `.cp-outside-${other}`);
    mkdirSync(mixed);
    writeFileSync(join(mixed, `cp-${other}-w`), 'x');
    writeFileSync(join(mixed, 'notes.txt'), 'keep');
    // Unrelated entries and look-alikes stay.
    const keepFiles = [
      join(home, '.bashrc'),
      join(home, '.cp-outside-short'),
      join(home, `cp-${hex}-w`),
    ];
    for (const file of keepFiles) writeFileSync(file, 'keep');
    const keepDir = join(home, '.cp-outside-not-hex');
    mkdirSync(keepDir);
    writeFileSync(join(keepDir, `cp-${hex}-w`), 'keep');
    // A symlink named like a canary dir is never followed.
    const target = makeScratchDir('swtarget');
    writeFileSync(join(target, `cp-${hex}-e`), 'keep');
    symlinkSync(target, join(home, `.cp-outside-${'c'.repeat(32)}`));

    const git = join(makeScratchDir('swgit'), 'repo.git');
    const removed = sweepStaleArtifacts({ readDirs: [], gitDir: git, homeDir: home });

    expect([...removed].sort()).toEqual(
      [...staleFiles, stale, join(mixed, `cp-${other}-w`)].sort(),
    );
    expect(existsSync(stale)).toBe(false);
    expect(readFileSync(join(mixed, 'notes.txt'), 'utf8')).toBe('keep');
    for (const file of keepFiles) expect(readFileSync(file, 'utf8')).toBe('keep');
    expect(readFileSync(join(keepDir, `cp-${hex}-w`), 'utf8')).toBe('keep');
    expect(readFileSync(join(target, `cp-${hex}-e`), 'utf8')).toBe('keep');
  });

  it('leaves the home alone when no homeDir is given', () => {
    const home = makeScratchDir('swhome2');
    const hex = 'd'.repeat(32);
    mkdirSync(join(home, `.cp-outside-${hex}`));
    writeFileSync(join(home, `.cp-outside-${hex}`, `cp-${hex}-w`), 'x');
    expect(sweepStaleArtifacts({ readDirs: [], gitDir: join(home, 'nope.git') })).toEqual([]);
    expect(existsSync(join(home, `.cp-outside-${hex}`, `cp-${hex}-w`))).toBe(true);
  });
});

describe('runSandboxProbe (fake runner)', () => {
  class FakeRunner implements AgentRunner {
    readonly requests: AgentRunRequest[] = [];
    readonly seen: Record<string, boolean> = {};
    plan: ProbePlan | undefined;

    async run(request: AgentRunRequest): Promise<AgentRun> {
      this.requests.push(request);
      const prompt = request.argv[request.argv.indexOf('-p') + 1] as string;
      // Only the control prompt names the probe-owned mirror.
      const session = prompt.includes('cp-mirror-') ? 'control' : 'treatment';
      const nonce = /\.cp-canary-([0-9a-f]{32})/.exec(prompt)?.[1];
      if (session === 'treatment' && nonce) {
        // Simulate an unconfined write the probe must notice and clean up.
        writeFileSync(join(gitDir, 'hooks', `cp-${nonce}`), '');
      }
      // The outside Write step names `{outsideRoot}/cp-{nonce}-w`; an unconfined Write tool
      // would create it.
      const outsideWrite =
        /Write tool, file_path: (\/[^,]*\/\.cp-outside-[0-9a-f]{32}\/cp-[0-9a-f]{32}-w),/.exec(
          prompt,
        )?.[1];
      if (session === 'treatment' && outsideWrite) {
        this.seen['treatment:outside-dir'] = existsSync(dirname(outsideWrite));
        this.seen['treatment:outside-edit-file'] = existsSync(outsideWrite.replace(/-w$/, '-e'));
        writeFileSync(outsideWrite, 'cp-probe');
      }
      // The env listing script must exist, owner-only and exactly ENV_SHAPE_AWK, while
      // each session runs.
      const envScript = /Bash tool, command: awk -f '([^']+)'/.exec(prompt)?.[1];
      if (envScript !== undefined) {
        this.seen[`${session}:env-script-0600`] =
          existsSync(envScript) && (statSync(envScript).mode & 0o777) === 0o600;
        this.seen[`${session}:env-script-content`] =
          existsSync(envScript) && readFileSync(envScript, 'utf8') === ENV_SHAPE_AWK;
      }
      this.seen[`${session}:cwd-exists`] = existsSync(request.cwd);
      this.seen[`${session}:control-canary`] =
        nonce !== undefined && existsSync(join(request.cwd, `.cp-canary-${nonce}`));
      this.seen[`${session}:ssh-canary`] =
        nonce !== undefined && existsSync(join(paths.homeDir, '.ssh', `.cp-canary-${nonce}`));
      this.seen[`${session}:prompt`] = prompt.length > 0;
      writeFileSync(request.rawLogPath, `{"type":"result","session":"${session}"}\n`, {
        flag: 'a',
      });
      return {
        events: [{ type: 'result', subtype: 'success' }],
        raw: `{"type":"result","subtype":"success"}\n`,
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

  it('launches both sessions through buildProbeLaunch and cleans up every artifact', async () => {
    const tmpRoot = makeScratchDir('ptmp');
    const logDir = join(makeScratchDir('plog'), 'doctor');
    const keychainCalls: string[] = [];
    const keychain: KeychainPort = {
      async add(service, account) {
        keychainCalls.push(`add:${service}:${account}`);
        return true;
      },
      async remove(service, account) {
        keychainCalls.push(`remove:${service}:${account}`);
      },
    };
    const staleCanary = join(paths.homeDir, '.ssh', `.cp-canary-${'f'.repeat(32)}`);
    writeFileSync(staleCanary, 'old');
    const runner = new FakeRunner();

    const outcome = await runSandboxProbe({
      protectedPaths: { ...paths, workdir: undefined },
      runner,
      logDir,
      keychain,
      tmpRoot,
    });

    // The fake attempts no step, so the treatment is retried once.
    expect(runner.requests).toHaveLength(3);
    expect(outcome.treatmentAttempts).toBe(2);
    const [t, tRetry, c] = runner.requests;
    expect(tRetry?.argv).toEqual(t?.argv);
    const p = outcome.plan;
    expect(t?.cwd).toBe(p.probeDir);
    expect(c?.cwd).toBe(p.probeDir);
    expect(inside(p.probeDir, tmpRoot)).toBe(true);
    // The treatment runs with the one production launch profile, workdir = the probe directory.
    expect(p.treatmentProfile).toEqual(
      buildAgentSandboxSettings({ ...paths, workdir: p.probeDir }),
    );
    const expected = buildProbeLaunch({
      plan: p,
      treatment: buildAgentSandboxSettings({ ...paths, workdir: p.probeDir }),
      model: 'haiku',
      maxTurns: p.treatment.steps.length + 4,
      maxBudgetUsd: 0.5,
    });
    expect(t?.argv).toEqual(expected.treatment.argv);
    expect(c?.argv).toEqual(expected.control.argv);
    expect(valuesAfter(t?.argv ?? [], '--allowedTools')).toEqual(['Bash', 'Read', 'Grep', 'Glob']);
    expect(runner.seen['treatment:cwd-exists']).toBe(true);
    expect(runner.seen['treatment:control-canary']).toBe(true);
    expect(runner.seen['treatment:ssh-canary']).toBe(true);
    expect(runner.seen['control:control-canary']).toBe(true);
    // The outside canary directory and its Edit file existed while the treatment ran.
    expect(p.outsideRoot).toBe(join(paths.homeDir, `.cp-outside-${p.nonce}`));
    expect(runner.seen['treatment:outside-dir']).toBe(true);
    expect(runner.seen['treatment:outside-edit-file']).toBe(true);
    // The env listing script was written 0600 with exactly ENV_SHAPE_AWK before both sessions,
    // was still intact after them, and is gone afterwards.
    expect(p.envScript.path).toBe(join(p.probeDir, `cp-env-${p.nonce}.awk`));
    for (const session of ['treatment', 'control']) {
      expect(runner.seen[`${session}:env-script-0600`], session).toBe(true);
      expect(runner.seen[`${session}:env-script-content`], session).toBe(true);
    }
    expect(outcome.envScriptIntact).toBe(true);
    expect(existsSync(p.envScript.path)).toBe(false);

    expect(outcome.claudeVersion).toBe('2.1.319 (Claude Code)');
    expect(outcome.staleLeftovers).toEqual([staleCanary]);
    expect(outcome.leftovers).toEqual([
      join(gitDir, 'hooks', `cp-${p.nonce}`),
      p.outside.writeFile,
    ]);
    // Verdicts come from the evaluator: nothing attempted reads Not checked, and the unconfined
    // hooks and outside writes the fake simulates read Reachable. Nothing is Blocked.
    expect(Object.fromEntries(outcome.targets.map((row) => [row.id, row.result]))).toEqual({
      'signing-key': 'not-checked',
      ssh: 'not-checked',
      gh: 'not-checked',
      state: 'not-checked',
      'git-config': 'not-checked',
      'git-hooks': 'reachable',
      'git-info': 'not-checked',
      'outside-workdir': 'reachable',
      // The fake answers no env-shape call, so the listing row is Not checked.
      'credential-env': 'not-checked',
    });
    expect(keychainCalls).toEqual([
      `add:cp-canary-${p.nonce}:counterpoint-probe`,
      `remove:cp-canary-${p.nonce}:counterpoint-probe`,
    ]);

    // Everything the probe created is gone; the logs remain.
    expect(existsSync(p.probeDir)).toBe(false);
    for (const canary of p.protectedCanaries) expect(existsSync(canary.path)).toBe(false);
    for (const artifact of p.gitArtifacts) expect(existsSync(artifact)).toBe(false);
    expect(existsSync(staleCanary)).toBe(false);
    expect(existsSync(p.outsideRoot)).toBe(false);
    expect(readdirSync(paths.homeDir).filter((name) => name.startsWith('.cp-outside-'))).toEqual(
      [],
    );
    expect(lstatSync(t?.rawLogPath as string).isFile()).toBe(true);
    expect(inside(t?.rawLogPath as string, logDir)).toBe(true);
  });
});

describe('the env-shape step', () => {
  it('is planned right before the outside Bash step in both sessions, with an identical command running the probe-owned script', () => {
    const p = plan();
    const scriptPath = join(probeDir, `cp-env-${NONCE}.awk`);
    expect(p.envScript).toEqual({ path: scriptPath, content: ENV_SHAPE_AWK });
    const command = `awk -f '${scriptPath}'`;
    const t = p.treatment.steps.at(-2);
    const c = p.control.steps.at(-2);
    expect(t).toEqual({
      index: p.treatment.steps.length - 1,
      target: 'credential-env',
      tool: 'Bash',
      operation: 'env-shape',
      path: scriptPath,
      reaches: scriptPath,
      command,
      instruction: `Bash tool, command: ${command}`,
    });
    expect(t).toEqual({ index: p.treatment.steps.length - 1, ...envShapeStep(scriptPath) });
    expect(c).toEqual(t);
    for (const session of [p.treatment, p.control]) {
      expect(session.steps.filter((s) => s.operation === 'env-shape')).toHaveLength(1);
      expect(session.prompt).toContain(
        `${session.steps.length - 1}. Bash tool, command: ${command}`,
      );
    }
  });

  it("gives the control exactly the step's own Bash(awk -f '…') rule", () => {
    const p = plan();
    const allow = buildControlSettings(buildAgentSandboxSettings(paths).settings, p).permissions
      .allow as string[];
    expect(allow.filter((entry) => entry.includes('cp-env-'))).toEqual([
      `Bash(awk -f '${p.envScript.path}')`,
    ]);
    expect(allow).not.toContain('Bash');
  });

  it("copies the treatment's credential env deny entries into the control as fresh entries", () => {
    const p = plan();
    const treatment = buildAgentSandboxSettings(paths).settings;
    const control = buildControlSettings(treatment, p);
    expect(control.sandbox.credentials).toEqual(treatment.sandbox.credentials);
    expect(control.sandbox.credentials).toEqual({
      envVars: [{ name: 'CLAUDE_CODE_MESSAGING_TOKEN', mode: 'deny' }],
    });
    expect(control.sandbox.credentials).not.toBe(treatment.sandbox.credentials);
    expect(control.sandbox.credentials?.envVars).not.toBe(treatment.sandbox.credentials?.envVars);
    expect(control.sandbox.credentials?.envVars[0]).not.toBe(
      treatment.sandbox.credentials?.envVars[0],
    );
  });

  it('rejects a script path with a single quote', () => {
    expect(() => envShapeStep("/tmp/it's.awk")).toThrow(/single quote/);
  });

  it('is one BEGIN block plus functions: no rule outside BEGIN, no END, no getline', () => {
    expect(ENV_SHAPE_AWK).not.toMatch(/getline/);
    expect(ENV_SHAPE_AWK).not.toMatch(/\bEND\b/);
    expect(ENV_SHAPE_AWK.match(/^BEGIN \{$/gm)).toHaveLength(1);
    // Every line at column 0 opens a comment, a function or the BEGIN block, or closes a block.
    for (const line of ENV_SHAPE_AWK.split('\n')) {
      if (line === '' || /^\s/.test(line)) continue;
      // A function takes the value `v`, optionally followed by awk's extra-parameter locals.
      expect(line, 'top-level awk line').toMatch(
        /^(#|function [a-z_]+\(v(, +[a-z_]+(, [a-z_]+)*)?\) \{$|BEGIN \{$|\}$)/,
      );
    }
    // Exactly one print statement, and it names no value: the name, the length, the shape word
    // and, for url-userinfo only, the host class word.
    const prints = ENV_SHAPE_AWK.split('\n').filter((line) => /\bprint\b/.test(line));
    expect(prints).toEqual(['    print name " " length(ENVIRON[name]) " " s extra']);
    // The CLOUDSDK_PROXY_ADDRESS line always carries its bare-host class (owner decision after the
    // rerun); every other url-userinfo line carries the URL's host class.
    expect(ENV_SHAPE_AWK).toContain(
      '    if (name == "CLOUDSDK_PROXY_ADDRESS") extra = " " address_class(ENVIRON[name])\n' +
        '    else if (s == "url-userinfo") extra = " " host_class(ENVIRON[name])',
    );
  });
});

describe.skipIf(process.platform !== 'darwin')('ENV_SHAPE_AWK on /usr/bin/awk', () => {
  let script: string;
  let home: string;
  beforeAll(() => {
    const dir = makeScratchDir('awk');
    home = join(dir, 'home');
    mkdirSync(home);
    script = join(dir, 'cp-env.awk');
    writeFileSync(script, ENV_SHAPE_AWK, { mode: 0o600, flag: 'wx' });
  });

  /** Planted test values only (no real credential); each must never appear in the output. */
  const planted = (): Record<string, string> => ({
    PATH: '/usr/bin:/bin',
    HOME: home,
    // 40 characters with a GitHub-token prefix.
    CP_FAKE_TOKEN: `ghp_${'a1B2c3D4e5'.repeat(3)}a1B2c3`,
    CP_JWT: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjcC10ZXN0In0.Y3AtcHJvYmUtc2lnbmF0dXJl',
    CP_URL: 'https://cp-user:cp-pass-0126@example.invalid/repo.git',
    CP_PEM: '-----BEGIN OPENSSH PRIVATE KEY-----\nY3AtcHJvYmU=\n-----END OPENSSH PRIVATE KEY-----',
    CP_UUID: '123e4567-e89b-12d3-a456-426614174000',
    // 40 characters, letters and digits only.
    CP_OPAQUE: 'Q7w3E9r1T5y8U2i6O4p0Q7w3E9r1T5y8U2i6O4p0',
    CP_PLAIN: 'hello',
    // Proxy URLs with a planted login (user cp-user, password cp-pw-0126). Loopback hosts:
    CP_PX_V4: 'http://cp-user:cp-pw-0126@127.0.0.1:3128',
    CP_PX_LOCAL: 'http://cp-user:cp-pw-0126@localhost:8080/',
    CP_PX_V6: 'socks5h://cp-user:cp-pw-0126@[::1]:1080',
    CP_PX_UPPER: 'http://cp-user:cp-pw-0126@LOCALHOST:1',
    // Every other form reads other (fail closed):
    CP_PX_NAMED: 'http://cp-user:cp-pw-0126@proxy.example.invalid:3128',
    CP_PX_TEN: 'http://cp-user:cp-pw-0126@10.0.0.1:3128',
    CP_PX_SUFFIX: 'http://cp-user:cp-pw-0126@127.0.0.1.example.invalid:80',
    CP_PX_SUBNAME: 'http://cp-user:cp-pw-0126@localhost.example.invalid',
    CP_PX_PATH: 'http://cp-user:cp-pw-0126@127.0.0.1:3128/path',
    CP_PX_OCTET: 'http://cp-user:cp-pw-0126@127.0.0.256:80',
    CP_PX_TWO_AT: 'http://cp-user:cp-pw-0126@extra.invalid@127.0.0.1:80',
    CP_PX_INSIDE: 'see http://cp-user:cp-pw-0126@127.0.0.1:80',
    // The gcloud proxy config's bare host (owner decision after the rerun): classed, never printed.
    CLOUDSDK_PROXY_ADDRESS: '127.0.0.1',
  });

  it('prints every variable as NAME LENGTH SHAPE with the expected shape, and no value', async () => {
    const env = planted();
    expect(env.CP_FAKE_TOKEN).toHaveLength(40);
    expect(env.CP_OPAQUE).toHaveLength(40);
    const result = await execa('/usr/bin/awk', ['-f', script], {
      env,
      extendEnv: false,
      stdin: 'ignore',
      reject: false,
      timeout: 5_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const listing = parseEnvListing(result.stdout);
    expect(listing.malformed).toBe(0);
    const byName = Object.fromEntries(listing.entries.map((e) => [e.name, e]));
    expect(Object.keys(byName).sort()).toEqual(Object.keys(env).sort());
    expect(Object.fromEntries(listing.entries.map((e) => [e.name, e.shape]))).toEqual({
      PATH: 'plain',
      HOME: 'plain',
      CP_FAKE_TOKEN: 'prefix',
      CP_JWT: 'jwt',
      CP_URL: 'url-userinfo',
      CP_PEM: 'pem',
      CP_UUID: 'plain',
      CP_OPAQUE: 'opaque',
      CP_PLAIN: 'plain',
      CP_PX_V4: 'url-userinfo',
      CP_PX_LOCAL: 'url-userinfo',
      CP_PX_V6: 'url-userinfo',
      CP_PX_UPPER: 'url-userinfo',
      CP_PX_NAMED: 'url-userinfo',
      CP_PX_TEN: 'url-userinfo',
      CP_PX_SUFFIX: 'url-userinfo',
      CP_PX_SUBNAME: 'url-userinfo',
      CP_PX_PATH: 'url-userinfo',
      CP_PX_OCTET: 'url-userinfo',
      CP_PX_TWO_AT: 'url-userinfo',
      CP_PX_INSIDE: 'url-userinfo',
      CLOUDSDK_PROXY_ADDRESS: 'plain',
    });
    // The host class is present exactly on url-userinfo entries and CLOUDSDK_PROXY_ADDRESS.
    expect(
      Object.fromEntries(
        listing.entries.filter((e) => e.hostClass !== undefined).map((e) => [e.name, e.hostClass]),
      ),
    ).toEqual({
      CP_URL: 'other',
      CP_PX_V4: 'loopback',
      CP_PX_LOCAL: 'loopback',
      CP_PX_V6: 'loopback',
      CP_PX_UPPER: 'loopback',
      CP_PX_NAMED: 'other',
      CP_PX_TEN: 'other',
      CP_PX_SUFFIX: 'other',
      CP_PX_SUBNAME: 'other',
      CP_PX_PATH: 'other',
      CP_PX_OCTET: 'other',
      CP_PX_TWO_AT: 'other',
      CP_PX_INSIDE: 'other',
      CLOUDSDK_PROXY_ADDRESS: 'loopback',
    });
    // No host, user or password reaches the output.
    for (const piece of ['cp-user', 'cp-pw-0126', 'cp-pass', '127.0.0', 'localhost', 'example']) {
      expect(result.stdout.toLowerCase().includes(piece.toLowerCase()), piece).toBe(false);
    }
    for (const [name, value] of Object.entries(env)) {
      expect(byName[name]?.length, `${name} length`).toBe(value.length);
      // Neither the value nor any 6-character piece of a planted test value reaches the output.
      expect(result.stdout.includes(value), `${name} value`).toBe(false);
      if (name.startsWith('CP_')) {
        for (let i = 0; i + 6 <= value.length; i += 3) {
          const piece = value.slice(i, i + 6);
          expect(result.stdout.includes(piece), `${name} piece ${i}`).toBe(false);
        }
      }
    }
  });

  it('classes CLOUDSDK_PROXY_ADDRESS as a bare host, loopback only for this machine, never printing it', async () => {
    // Planted test addresses only. loopback: the whole value is localhost, ::1, [::1] or a dotted
    // 127.0.0.0/8 address (lower-cased). Every other form reads other (fail closed).
    const cases: Array<[string, 'loopback' | 'other']> = [
      ['127.0.0.1', 'loopback'],
      ['127.255.10.1', 'loopback'],
      ['localhost', 'loopback'],
      ['LocalHost', 'loopback'],
      ['::1', 'loopback'],
      ['[::1]', 'loopback'],
      ['proxy.example.invalid', 'other'],
      ['10.0.0.1', 'other'],
      ['127.0.0.1:3128', 'other'],
      ['http://127.0.0.1', 'other'],
      ['127.0.0.256', 'other'],
      ['127.0.0', 'other'],
      ['127.0.0.1.example.invalid', 'other'],
      ['localhost.example.invalid', 'other'],
      [' 127.0.0.1', 'other'],
      ['::2', 'other'],
      ['', 'other'],
    ];
    for (const [value, expected] of cases) {
      const result = await execa('/usr/bin/awk', ['-f', script], {
        env: { PATH: '/usr/bin:/bin', HOME: home, CLOUDSDK_PROXY_ADDRESS: value },
        extendEnv: false,
        stdin: 'ignore',
        reject: false,
        timeout: 5_000,
      });
      expect(result.exitCode, value).toBe(0);
      const listing = parseEnvListing(result.stdout);
      expect(listing.malformed, value).toBe(0);
      const entry = listing.entries.find((e) => e.name === 'CLOUDSDK_PROXY_ADDRESS');
      expect(entry, value).toEqual({
        name: 'CLOUDSDK_PROXY_ADDRESS',
        length: value.length,
        shape: 'plain',
        hostClass: expected,
      });
      const line = result.stdout.split('\n').find((l) => l.startsWith('CLOUDSDK_PROXY_ADDRESS '));
      // The address never reaches the output: the line is the name, the length, the shape and
      // the class word only.
      expect(line, value).toBe(`CLOUDSDK_PROXY_ADDRESS ${value.length} plain ${expected}`);
    }
  });

  it('exits 0 without reading stdin, whether stdin is closed or an open pipe never written', async () => {
    const env = planted();
    const closed = await execa('/usr/bin/awk', ['-f', script], {
      env,
      extendEnv: false,
      stdin: 'ignore',
      reject: false,
      timeout: 5_000,
    });
    expect(closed.timedOut).toBe(false);
    expect(closed.exitCode).toBe(0);
    // stdin is an open pipe that is never written to or ended: a program that read stdin would
    // block here until the timeout.
    const open = await execa('/usr/bin/awk', ['-f', script], {
      env,
      extendEnv: false,
      stdin: 'pipe',
      reject: false,
      timeout: 5_000,
    });
    expect(open.timedOut).toBe(false);
    expect(open.exitCode).toBe(0);
    expect(parseEnvListing(open.stdout).malformed).toBe(0);
  });
});

describe('the sandbox proxy exception', () => {
  const PROXY_NAMES = [
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
  ];
  const url = (name: string, hostClass: 'loopback' | 'other', length = 100): EnvEntry => ({
    name,
    length,
    shape: 'url-userinfo',
    hostClass,
  });

  it("records the owner's exception: id, reason, date, decisions, the twelve URL names and the gcloud password", () => {
    expect(SANDBOX_PROXY_EXCEPTION.id).toBe('sandbox-proxy-login');
    expect(SANDBOX_PROXY_EXCEPTION.reason).toBe("the sandbox's own proxy login, local only");
    expect(SANDBOX_PROXY_EXCEPTION.recordedAt).toBe('2026-11-10');
    expect(SANDBOX_PROXY_EXCEPTION.decision).toContain('docs/decisions.md');
    expect(SANDBOX_PROXY_EXCEPTION.decision).toContain(
      'Credential-env row scoped to the real requirement',
    );
    expect(SANDBOX_PROXY_EXCEPTION.decision).toContain(
      'CLOUDSDK_PROXY_PASSWORD joins the sandbox-proxy-login exception',
    );
    expect(SANDBOX_PROXY_EXCEPTION.decision).toContain('gcloud proxy config');
    expect([...SANDBOX_PROXY_EXCEPTION.proxyUrlNames]).toEqual(PROXY_NAMES);
    expect(SANDBOX_PROXY_EXCEPTION.gcloudPassword).toEqual({
      name: 'CLOUDSDK_PROXY_PASSWORD',
      requires: 'CLOUDSDK_PROXY_ADDRESS',
    });
    expect(SANDBOX_PROXY_EXCEPTION_NAMES).toEqual([...PROXY_NAMES, 'CLOUDSDK_PROXY_PASSWORD']);
    expect(PROXY_ADDRESS_NAME).toBe('CLOUDSDK_PROXY_ADDRESS');
  });

  it('reads the CLOUDSDK_PROXY_ADDRESS line with its host class, and rejects it without one', () => {
    expect(parseEnvListing('CLOUDSDK_PROXY_ADDRESS 9 plain loopback\n')).toEqual({
      entries: [
        { name: 'CLOUDSDK_PROXY_ADDRESS', length: 9, shape: 'plain', hostClass: 'loopback' },
      ],
      malformed: 0,
    });
    for (const line of [
      'CLOUDSDK_PROXY_ADDRESS 9 plain',
      'CLOUDSDK_PROXY_ADDRESS 9 plain remote',
      'CLOUDSDK_PROXY_ADDRESS 9 plain Loopback',
      'CLOUDSDK_PROXY_PORT 4 plain loopback',
    ]) {
      expect(parseEnvListing(line), line).toEqual({ entries: [], malformed: 1 });
    }
  });

  it('excepts CLOUDSDK_PROXY_PASSWORD only beside a loopback CLOUDSDK_PROXY_ADDRESS', () => {
    const password: EnvEntry = { name: 'CLOUDSDK_PROXY_PASSWORD', length: 32, shape: 'opaque' };
    const address = (hostClass: 'loopback' | 'other'): EnvEntry => ({
      name: 'CLOUDSDK_PROXY_ADDRESS',
      length: 9,
      shape: 'plain',
      hostClass,
    });
    // Loopback address: the password is excepted, and the address itself is no finding.
    expect(exceptedEntries([password, address('loopback')])).toEqual([password]);
    expect(unexceptedFindings([password, address('loopback')])).toEqual([]);
    // Address absent: the password is a finding by name.
    expect(exceptedEntries([password])).toEqual([]);
    expect(unexceptedFindings([password])).toEqual(['CLOUDSDK_PROXY_PASSWORD (name)']);
    // Address other: both the password and the address are findings.
    expect(exceptedEntries([password, address('other')])).toEqual([]);
    expect(unexceptedFindings([password, address('other')])).toEqual([
      'CLOUDSDK_PROXY_PASSWORD (name)',
      'CLOUDSDK_PROXY_ADDRESS (value: plain, 9 chars, host other)',
    ]);
    // A non-loopback address fails the row even without the password.
    expect(unexceptedFindings([address('other')])).toEqual([
      'CLOUDSDK_PROXY_ADDRESS (value: plain, 9 chars, host other)',
    ]);
    // The address condition is exact: another name in loopback, or a case variant, does not count.
    expect(
      exceptedEntries([
        password,
        { name: 'cloudsdk_proxy_address', length: 9, shape: 'plain', hostClass: 'loopback' },
        { name: 'HTTP_PROXY', length: 100, shape: 'url-userinfo', hostClass: 'loopback' },
      ]).map((e) => e.name),
    ).toEqual(['HTTP_PROXY']);
    // The denied messaging token is never excepted, beside a loopback address or not.
    const token: EnvEntry = { name: 'CLAUDE_CODE_MESSAGING_TOKEN', length: 32, shape: 'opaque' };
    expect(unexceptedFindings([token, password, address('loopback')])).toEqual([
      'CLAUDE_CODE_MESSAGING_TOKEN (name)',
    ]);
  });

  it('reads a url-userinfo line with its host class, and rejects the three malformed forms', () => {
    expect(parseEnvListing('HTTP_PROXY 100 url-userinfo loopback\nPATH 5 plain\n')).toEqual({
      entries: [
        { name: 'HTTP_PROXY', length: 100, shape: 'url-userinfo', hostClass: 'loopback' },
        { name: 'PATH', length: 5, shape: 'plain' },
      ],
      malformed: 0,
    });
    expect(parseEnvListing('A 100 url-userinfo other').entries[0]?.hostClass).toBe('other');
    // A url-userinfo line without a class, a class after another shape, an unknown class.
    for (const line of [
      'HTTP_PROXY 100 url-userinfo',
      'GH 40 opaque loopback',
      'P 5 plain other',
      'HTTP_PROXY 100 url-userinfo remote',
      'HTTP_PROXY 100 url-userinfo Loopback',
    ]) {
      expect(parseEnvListing(line), line).toEqual({ entries: [], malformed: 1 });
    }
  });

  it('excepts the twelve names as url-userinfo loopback, and nothing else', () => {
    const loop = PROXY_NAMES.map((name) => url(name, 'loopback'));
    expect(exceptedEntries(loop)).toEqual(loop);
    expect(unexceptedFindings(loop)).toEqual([]);
    const near: EnvEntry[] = [
      ...PROXY_NAMES.map((name) => url(name, 'other')),
      { name: 'HTTP_PROXY', length: 40, shape: 'opaque' },
      url('Http_Proxy', 'loopback'),
      url('MY_PROXY', 'loopback'),
      url('HTTP_PROXY_X', 'loopback'),
      { name: 'HTTP_PROXY', length: 100, shape: 'url-userinfo' },
    ];
    expect(exceptedEntries(near)).toEqual([]);
    expect(unexceptedFindings(near)).toEqual(credentialFindings(near));
    expect(unexceptedFindings(near)).toHaveLength(near.length);
  });

  it('keeps the denied name, a password without its address and a non-loopback proxy as findings beside excepted entries', () => {
    const entries: EnvEntry[] = [
      ...PROXY_NAMES.filter((n) => n !== 'HTTP_PROXY').map((n) => url(n, 'loopback')),
      { name: 'CLAUDE_CODE_MESSAGING_TOKEN', length: 32, shape: 'opaque' },
      { name: 'CLOUDSDK_PROXY_PASSWORD', length: 32, shape: 'opaque' },
      url('HTTP_PROXY', 'other'),
      { name: 'PATH', length: 20, shape: 'plain' },
    ];
    expect(exceptedEntries(entries)).toHaveLength(11);
    expect(unexceptedFindings(entries)).toEqual([
      'CLAUDE_CODE_MESSAGING_TOKEN (name)',
      'CLOUDSDK_PROXY_PASSWORD (name)',
      'HTTP_PROXY (value: url-userinfo, 100 chars, host other)',
    ]);
  });
});

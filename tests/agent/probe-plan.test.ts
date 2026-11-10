// Unit tests for the differential sandbox probe (01-04 Task 2): the step plan, the
// mirror-confined control session, the launch builder, the stale-artifact sweep and the probe
// lifecycle with a fake runner. No `claude` is started here.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildControlSettings,
  buildProbeLaunch,
  controlTools,
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

/** A treatment input carrying every allow-side grant a later phase could add, and more. */
function overGranted(): AgentSettings {
  const real = buildAgentSandboxSettings(paths).settings;
  return {
    permissions: {
      deny: [...real.permissions.deny],
      allow: [`Read(/${gitDir}/**)`, `Edit(/${gitDir}/**)`],
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
      if (step.target === 'control') {
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

  it('appends the three outside-workdir steps last, with continuing indices', () => {
    const p = plan();
    const outside = p.outside;
    expect(p.outsideRoot).toBe(join(paths.homeDir, `.cp-outside-${NONCE}`));
    expect(outside.writeFile).toBe(join(p.outsideRoot, `cp-${NONCE}-w`));
    expect(outside.editFile).toBe(join(p.outsideRoot, `cp-${NONCE}-e`));
    expect(outside.before).toBe(`cp-outside-before-${NONCE}`);
    expect(outside.after).toBe(`cp-outside-after-${NONCE}`);
    expect(p.writeTargets.at(-1)).toEqual({
      id: 'outside-workdir',
      mode: 'write',
      path: p.outsideRoot,
    });

    const steps = p.treatment.steps;
    const last = steps.slice(-3);
    expect(steps.filter((s) => s.target === 'outside-workdir')).toEqual(last);
    expect(last.map((s) => s.index)).toEqual([steps.length - 2, steps.length - 1, steps.length]);
    // Every earlier step keeps its 01-04 index: git-info's Write is the step right before.
    expect(steps[steps.length - 4]).toMatchObject({ target: 'git-info', operation: 'write' });
    expect(last.map((s) => [s.tool, s.operation, s.path])).toEqual([
      ['Write', 'write', outside.writeFile],
      ['Read', 'read-before-edit', outside.editFile],
      ['Edit', 'edit', outside.editFile],
    ]);
    expect(last.map((s) => s.instruction)).toEqual([
      `Write tool, file_path: ${outside.writeFile}, content: cp-probe ${NONCE}`,
      `Read tool, file_path: ${outside.editFile}`,
      `Edit tool, file_path: ${outside.editFile}, old_string: ${outside.before}, new_string: ${outside.after}`,
    ]);
    expect(last[2]).toMatchObject({ oldString: outside.before, newString: outside.after });
  });

  it('points the control at the outside twin inside the mirror', () => {
    const p = plan();
    expect(p.outsideMirror).toEqual({
      dir: join(mirrorRoot, 'outside-workdir'),
      writeFile: join(mirrorRoot, 'outside-workdir', `cp-${NONCE}-w`),
      editFile: join(mirrorRoot, 'outside-workdir', `cp-${NONCE}-e`),
    });
    const last = p.control.steps.slice(-3);
    expect(last.map((s) => s.path)).toEqual([
      p.outsideMirror.writeFile,
      p.outsideMirror.editFile,
      p.outsideMirror.editFile,
    ]);
    for (const s of last) expect(inside(s.path as string, mirrorRoot)).toBe(true);
    expect(last[2]?.instruction).toContain(`old_string: ${p.outside.before}`);
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
    // No file-edit grant reaches outside the probe directory (T-01-65).
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

    // The fake attempts no step, so the treatment is retried once (RESEARCH Pitfall 1).
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

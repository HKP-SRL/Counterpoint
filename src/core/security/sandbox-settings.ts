// The one agent sandbox-settings builder (RESEARCH Pattern 3). The doctor probe tests exactly
// this output, and the Phase 2 runner launches builders with it, so a probe pass is a statement
// about the production configuration.
//
// Recipe verified on claude 2.1.319 / macOS (RESEARCH "Sandbox spike"):
// - Every read-protected directory gets a `Read(//abs/**)` + `Edit(//abs/**)` deny twin. Read
//   deny rules cover the Read tool, Grep, symlinks and (merged by Claude Code) Bash.
//   `sandbox.filesystem.denyRead` is kept as a second layer for Bash.
// - The host's git common dir gets `Edit(//G/**)` plus `denyWrite` for config, hooks and info.
// - `allowWrite` is empty: Phase 1's only agent (the doctor probe) writes nothing in the git dir,
//   so no grant can expose shared refs, objects or the base branch ref (T-01-64). Phase 2 adds a
//   narrow builder grant as an explicit input; the deny rules above still win over it.
// - Permission rules use the `//abs` prefix form; `sandbox.filesystem.*` uses plain absolute
//   paths. Every path is absolute and realpath-resolved (`/tmp` is `/private/tmp` on macOS).
import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';

export interface ProtectedPaths {
  /** The user's home directory; `~/.ssh` is derived from it. */
  homeDir: string;
  /** Counterpoint's own state directory (`COUNTERPOINT_HOME`). */
  counterpointHome: string;
  /** The directory holding the approval signing key. */
  signingKeyDir: string;
  /** gh's configuration directory (usually `~/.config/gh`). */
  ghConfigDir: string;
  /** The host repository's git common dir (`git rev-parse --git-common-dir`), not a worktree `.git` file. */
  hostGitDir: string;
  /** The session's working directory; its `.claude/` folder is made unwritable. */
  workdir?: string;
}

/** Settings passed to `claude --settings`. Optional members exist only on inputs, never on builder output. */
export interface AgentSettings {
  permissions: {
    deny: string[];
    allow?: string[];
    additionalDirectories?: string[];
  };
  sandbox: {
    enabled: boolean;
    failIfUnavailable: boolean;
    allowUnsandboxedCommands: boolean;
    excludedCommands?: string[];
    filesystem: {
      denyRead: string[];
      denyWrite: string[];
      allowWrite: string[];
    };
  };
}

export type ReadTargetId = 'signing-key' | 'ssh' | 'gh' | 'state';
export type WriteTargetId = 'git-config' | 'git-hooks' | 'git-info';

export interface ReadTarget {
  id: ReadTargetId;
  mode: 'read';
  /** The protected directory. */
  path: string;
}

export interface WriteTarget {
  id: WriteTargetId;
  mode: 'write';
  /** The protected file (`config`) or directory (`hooks`, `info`) inside the git common dir. */
  path: string;
}

export interface AgentSandbox {
  settings: AgentSettings;
  readTargets: ReadTarget[];
  writeTargets: WriteTarget[];
  /** The realpath-resolved git common dir. */
  gitDir: string;
}

/**
 * Resolves an absolute path to its realpath. A path that does not exist yet is resolved through
 * its nearest existing ancestor, so a rule for a missing directory still names the real location.
 * A relative path throws.
 */
export function resolveAbsolute(path: string, label = 'path'): string {
  if (typeof path !== 'string' || !isAbsolute(path)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    if (parent === path) return path;
    return join(resolveAbsolute(parent, label), basename(path));
  }
}

/** A permission-rule path: `//` followed by the absolute path without its leading slash. */
export function rulePath(absolutePath: string): string {
  if (!isAbsolute(absolutePath)) throw new Error('A rule path must be absolute.');
  return `/${absolutePath}`;
}

/** `Read(//abs/**)`, `Edit(//abs/**)` or `Grep(//abs/**)`. */
export function pathRule(tool: 'Read' | 'Edit' | 'Grep', absoluteDir: string): string {
  return `${tool}(${rulePath(absoluteDir)}/**)`;
}

export function buildAgentSandboxSettings(paths: ProtectedPaths): AgentSandbox {
  const home = resolveAbsolute(paths.homeDir, 'homeDir');
  const signingKey = resolveAbsolute(paths.signingKeyDir, 'signingKeyDir');
  const gh = resolveAbsolute(paths.ghConfigDir, 'ghConfigDir');
  const state = resolveAbsolute(paths.counterpointHome, 'counterpointHome');
  const gitDir = resolveAbsolute(paths.hostGitDir, 'hostGitDir');
  const workdir =
    paths.workdir === undefined ? undefined : resolveAbsolute(paths.workdir, 'workdir');
  const ssh = resolveAbsolute(join(home, '.ssh'), 'homeDir');

  const readTargets: ReadTarget[] = [
    { id: 'signing-key', mode: 'read', path: signingKey },
    { id: 'ssh', mode: 'read', path: ssh },
    { id: 'gh', mode: 'read', path: gh },
    { id: 'state', mode: 'read', path: state },
  ];
  const writeTargets: WriteTarget[] = [
    { id: 'git-config', mode: 'write', path: join(gitDir, 'config') },
    { id: 'git-hooks', mode: 'write', path: join(gitDir, 'hooks') },
    { id: 'git-info', mode: 'write', path: join(gitDir, 'info') },
  ];

  const readDirs = unique(readTargets.map((target) => target.path));
  const deny: string[] = [];
  for (const dir of readDirs) {
    deny.push(pathRule('Read', dir), pathRule('Edit', dir));
  }
  deny.push(pathRule('Edit', gitDir));
  if (workdir !== undefined) deny.push(pathRule('Edit', join(workdir, '.claude')));

  const settings: AgentSettings = {
    permissions: { deny: unique(deny) },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      filesystem: {
        denyRead: readDirs,
        denyWrite: writeTargets.map((target) => target.path),
        allowWrite: [],
      },
    },
  };
  return { settings, readTargets, writeTargets, gitDir };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

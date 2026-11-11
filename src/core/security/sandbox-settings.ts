// The one agent launch profile: sandbox settings plus the tool list. The
// doctor probe launches exactly this output as its treatment session, and the build runner
// launches builders with it, so a probe pass is a statement about the production configuration.
//
// Recipe verified on claude 2.1.319 / macOS by the sandbox spike:
// - Every read-protected directory gets a `Read(//abs/**)` + `Edit(//abs/**)` deny twin. Read
//   deny rules cover the Read tool, Grep, symlinks and (merged by Claude Code) Bash.
//   `sandbox.filesystem.denyRead` is kept as a second layer for Bash.
// - The host's git common dir gets `Edit(//G/**)` plus `denyWrite` for config, hooks and info.
// - `allowWrite` is empty: today's only agent (the doctor probe) writes nothing in the git dir,
//   so no grant can expose shared refs, objects or the base branch ref. The builder
//   (first-unattended-run) adds a narrow grant as an explicit input; the deny rules above still
//   win over it.
// - Permission rules use the `//abs` prefix form; `sandbox.filesystem.*` uses plain absolute
//   paths. Every path is absolute and realpath-resolved (`/tmp` is `/private/tmp` on macOS).
//
// File edits (agent-sandbox: File edits confined to the session folder). Sessions run in
// `--permission-mode auto` (claude-argv.ts), where a classifier decides calls no rule covers, so
// no confinement may rest on the mode. `permissions.blockWritesOutsideWorkingDirectories: true`
// (claude >= 2.1.314) confines the Write, Edit and NotebookEdit tools to the working folder in
// every permission mode, and no allow rule lifts it; the profile always emits it, with or without
// a workdir (fail closed). It also refuses writes to Claude Code settings files inside the working
// folder, and it removes the `EnterWorktree`/`ExitWorktree` tools (builders run inside
// Counterpoint-made worktrees and do not need them). Claude-managed exempt files (plan files, the
// scratchpad, a background session's tmp, auto-memory `.md`) stay writable: an accepted residual.
// The block does not limit shell commands: `sandbox.filesystem.allowWrite: []` (Seatbelt) still
// confines Bash. The profile's tool list (AGENT_TOOLS) names no file-edit tool, and the allow side
// is builder output: with a workdir it is exactly `Edit(//{workdir}/**)` (Edit rules apply to
// every built-in file-editing tool); without one there is no allow side. Deny rules are evaluated
// before allow rules in every mode, so the workdir's `.claude/` folder and every protected
// directory stay unwritable.
//
// Sandbox auto-allow (replacement 1 for the scrub). Claude Code's default
// (`autoAllowBashIfSandboxed: true`) runs sandboxed Bash commands without the permission prompt
// flow. `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` kept that off; agent sessions now opt out of the scrub
// (agent-env.ts), so the profile sets `sandbox.autoAllowBashIfSandboxed: false` explicitly, with or
// without a workdir. With it off, an unlisted sandboxed command goes through the permission rules
// and, in auto mode, the classifier. The `--settings` flag outranks user, project and local
// settings but not managed settings; doctor checks managed sources for it.
//
// Credential env vars (replacement 3 for the scrub). With the scrub off, a sandboxed Bash
// command sees what Claude Code itself exports to it. The first live listing on claude
// 2.1.321 found two credential-named variables there: `CLAUDE_CODE_MESSAGING_TOKEN` (the
// per-session messaging token the env-vars docs name) and `CLOUDSDK_PROXY_PASSWORD`. The profile
// denies `CLAUDE_CODE_MESSAGING_TOKEN` through a `sandbox.credentials.envVars` entry with
// `mode: "deny"`, with or without a workdir (owner decision 2026-11-10, "Credential-env row
// scoped to the real requirement"). The sandboxing docs
// (https://code.claude.com/docs/en/sandboxing, section `sandbox.credentials`, read 2026-11-10): for
// deny entries "environment variables are unset before each sandboxed command runs"; the variable
// protection holds even when filesystem isolation is off; "There is no built-in credential deny
// list, so only the files and variables you list are restricted"; and Claude Code ignores
// `credentials` entries from project and local settings only, so this `--settings` profile's
// entries apply. The rerun showed the entry take effect for `CLAUDE_CODE_MESSAGING_TOKEN`, but not
// for `CLOUDSDK_PROXY_PASSWORD`: Claude Code sets the `CLOUDSDK_PROXY_*` gcloud proxy config
// (ADDRESS, PORT, TYPE, USERNAME, PASSWORD) after deny entries apply, like the proxy URLs. So
// `CLOUDSDK_PROXY_PASSWORD` is no longer denied; it joined the owner's `sandbox-proxy-login`
// exception, conditioned on `CLOUDSDK_PROXY_ADDRESS` being a loopback host (owner decision
// 2026-11-10, "CLOUDSDK_PROXY_PASSWORD joins the sandbox-proxy-login exception"). The sandbox proxy
// variables (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` and related) are how sandboxed commands reach
// the network ("Claude Code runs the sandbox proxy on your machine, outside the sandbox, and
// directs commands to it with ..."), so they are not denied either; the probe's credential-env row
// accepts them only as that loopback exception (src/agent/env-listing.ts SANDBOX_PROXY_EXCEPTION),
// and fails if the denied name reappears.
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
  /**
   * The session's working directory: the only place file tools may edit. Its `.claude/` folder
   * stays unwritable. Without a workdir nothing can be edited.
   */
  workdir?: string;
}

/**
 * Settings passed to `claude --settings`. On builder output `allow` is present only as the single
 * workdir edit grant; `additionalDirectories` and the sandbox exceptions are never emitted.
 */
export interface AgentSettings {
  permissions: {
    deny: string[];
    allow?: string[];
    additionalDirectories?: string[];
    /** Refuses Write/Edit/NotebookEdit outside the working directories, in every mode. */
    blockWritesOutsideWorkingDirectories?: boolean;
  };
  sandbox: {
    enabled: boolean;
    failIfUnavailable: boolean;
    allowUnsandboxedCommands: boolean;
    /** False sends sandboxed Bash commands through the permission rules (and, in auto mode, the classifier). */
    autoAllowBashIfSandboxed?: boolean;
    excludedCommands?: string[];
    filesystem: {
      denyRead: string[];
      denyWrite: string[];
      allowWrite: string[];
    };
    /** Credential env vars unset before each sandboxed command runs. */
    credentials?: { envVars: Array<{ name: string; mode: 'deny' }> };
  };
}

/**
 * The credential env vars the launch profile denies to sandboxed commands. The first
 * listing flagged two by name; `CLOUDSDK_PROXY_PASSWORD` left this list after the rerun showed
 * the deny does not reach it (owner decision 2026-11-10, "CLOUDSDK_PROXY_PASSWORD joins the
 * sandbox-proxy-login exception"). Order is the emitted order.
 */
export const CREDENTIAL_ENV_DENY = ['CLAUDE_CODE_MESSAGING_TOKEN'] as const;

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

/** The `--allowedTools` list of every agent session. No file-edit tool: edits come from `allow`. */
export const AGENT_TOOLS = ['Bash', 'Read', 'Grep', 'Glob'] as const;

/** The built-in tools that write files. `Edit(...)` permission rules govern all of them. */
export const FILE_EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] as const;

export interface AgentSandbox {
  settings: AgentSettings;
  /** The `--allowedTools` list: always a fresh copy of AGENT_TOOLS. */
  allowedTools: string[];
  /** The realpath-resolved working directory, or null when none was given. */
  workdir: string | null;
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

  // The only grant: file edits inside the workdir. No workdir, no allow side at all. The
  // outside-write block is on either way (fail closed).
  const permissions: AgentSettings['permissions'] =
    workdir === undefined
      ? { deny: unique(deny), blockWritesOutsideWorkingDirectories: true }
      : {
          deny: unique(deny),
          allow: [pathRule('Edit', workdir)],
          blockWritesOutsideWorkingDirectories: true,
        };

  const settings: AgentSettings = {
    permissions,
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: false,
      filesystem: {
        denyRead: readDirs,
        denyWrite: writeTargets.map((target) => target.path),
        allowWrite: [],
      },
      credentials: {
        envVars: CREDENTIAL_ENV_DENY.map((name) => ({ name, mode: 'deny' as const })),
      },
    },
  };
  return {
    settings,
    allowedTools: [...AGENT_TOOLS],
    workdir: workdir ?? null,
    readTargets,
    writeTargets,
    gitDir,
  };
}

export interface FileEditGrants {
  /** True when some entry grants a file-edit tool over every path, or over a scope not understood. */
  everywhere: boolean;
  /** Absolute directories a scoped `Tool(//abs/**)` or `Tool(//abs)` entry grants edits in. */
  roots: string[];
}

const EDIT_TOOL_NAMES: ReadonlySet<string> = new Set(FILE_EDIT_TOOLS.map((t) => t.toLowerCase()));
/** `Tool(//abs/**)` or `Tool(//abs)`; group 1 is the absolute path without its leading slash. */
const SCOPED_RULE_RE = /^[A-Za-z]+\(\/\/([^()]*?)(?:\/\*\*)?\)$/;

/**
 * Where a launch profile lets file-edit tools write. Reads every `permissions.allow` and
 * `allowedTools` entry whose tool is Edit, Write, MultiEdit or NotebookEdit (case-insensitive):
 * a bare name is a grant everywhere; `Tool(//abs/**)` or `Tool(//abs)` adds `/abs` to `roots`;
 * any other argument form (relative, `~`, a glob, `..`, the filesystem root) sets `everywhere`,
 * so a scope this function does not understand fails closed.
 */
export function fileEditGrants(profile: {
  settings: AgentSettings;
  allowedTools: readonly string[];
}): FileEditGrants {
  let everywhere = false;
  const roots: string[] = [];
  const entries = [...(profile.settings.permissions.allow ?? []), ...profile.allowedTools];
  for (const raw of entries) {
    const entry = String(raw).trim();
    const name = (entry.split('(')[0] ?? '').trim().toLowerCase();
    if (!EDIT_TOOL_NAMES.has(name)) continue;
    const scoped = SCOPED_RULE_RE.exec(entry);
    const root = scoped ? `/${scoped[1] ?? ''}` : null;
    if (root === null || !isPlainRoot(root)) {
      everywhere = true;
      continue;
    }
    if (!roots.includes(root)) roots.push(root);
  }
  return { everywhere, roots };
}

/** An absolute, normalised directory without glob characters that is not the filesystem root. */
function isPlainRoot(root: string): boolean {
  if (!isAbsolute(root) || root === '/' || root.endsWith('/')) return false;
  if (/[*?[\]{}\\]/.test(root)) return false;
  return root
    .split('/')
    .slice(1)
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

// Sandbox isolation settings (replacement 2 of 3 for the scrub opt-out).
//
// With `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` set, Claude Code "ignores `filesystem.disabled` from
// every source, including managed settings, and keeps filesystem isolation on"
// (https://code.claude.com/docs/en/sandboxing, "Which settings can disable it"). The owner opted
// out of the scrub (owner decision 2026-11-10, agent-env.ts), so a settings file can now switch
// isolation off for agent sessions. The owner's replacement: doctor fails if any settings source
// that an agent session loads turns sandbox isolation off. This module is the pure judge; the
// reader that finds and reads each source is src/doctor/settings-sources.ts.
//
// Sources an agent session loads (Counterpoint launches `claude --setting-sources user --settings
// <launch>`, claude-argv.ts):
// - launch: `--settings` "applies above your user, project, and local files and below managed
//   settings" (https://code.claude.com/docs/en/settings, "Change a setting for one session").
// - user: `~/.claude/settings.json`; `--setting-sources` is "Comma-separated list of setting
//   sources to load (user, project, local)" (`claude --help`, 2.1.321). agentEnv passes HOME and
//   not CLAUDE_CONFIG_DIR, so the session reads `{HOME}/.claude`.
// - server-managed cache: "A startup that runs on the cache at `~/.claude/remote-settings.json`"
//   (https://code.claude.com/docs/en/server-managed-settings).
// - managed file and drop-ins: "`managed-settings.json`, an optional `managed-settings.d/`
//   directory ... `/Library/Application Support/ClaudeCode/` on macOS, `/etc/claude-code/` on Linux
//   and WSL" (https://code.claude.com/docs/en/managed-settings, "Where each mechanism stores the
//   policy").
// - managed preferences: "the `com.anthropic.claudecode` managed preferences domain" (same page).
// Managed settings always apply: "Nothing in your own settings files or `--settings` overrides a
// managed key" (https://code.claude.com/docs/en/settings, "Settings precedence").
//
// Rules (ISOLATION_RULES): every rule names its doc. `filesystem.disabled`, `excludedCommands`,
// `allowAppleEvents` and the write and read widenings (CR-01: `filesystem.allowWrite`,
// `filesystem.allowRead`, `permissions.additionalDirectories`, the unix-socket allowances) fail in
// every source, the launch source included except for the builder's own `allowWrite` grant,
// because user, managed and flag values all take effect (a scalar the launch flag leaves unset; a
// list that merges). The four Booleans the launch flag
// sets explicitly fail only in a managed source, because only managed settings outrank
// `--settings` ("When managed settings set a Boolean key such as `enabled` or `failIfUnavailable`,
// Claude Code uses the managed value and ignores anything a developer sets locally",
// sandboxing). Every present managed source is checked, whatever Claude Code's first-wins choice
// among them: stricter, never looser. Quoted Booleans count: "the string `"true"` or `"false"`
// reads as that Boolean" (managed-settings, "Keys that fail closed"); any other value of a Boolean
// key fails closed here.
//
// Shown values are limited to a Boolean, a sanitised string of at most 40 characters, or an entry
// count; problems never contain file content; paths show the home directory as `~`. The check's
// pass wording says "turns sandbox isolation off or widens it".
import type { SandboxIsolationCheck } from './doctor-report.ts';

export const SETTINGS_SOURCE_KINDS = [
  'launch',
  'user',
  'server-managed-cache',
  'managed-file',
  'managed-drop-in',
  'managed-preferences',
] as const;
export type SettingsSourceKind = (typeof SETTINGS_SOURCE_KINDS)[number];

const MANAGED_KINDS: ReadonlySet<SettingsSourceKind> = new Set([
  'server-managed-cache',
  'managed-file',
  'managed-drop-in',
  'managed-preferences',
]);

/** True for a source that outranks the launch flag (every managed tier, the cache included). */
export function isManagedKind(kind: SettingsSourceKind): boolean {
  return MANAGED_KINDS.has(kind);
}

/** One settings source as the reader found it. `settings` is present only when `state` is `read`. */
export interface SettingsSourceRead {
  kind: SettingsSourceKind;
  label: string;
  path: string | null;
  state: 'absent' | 'read' | 'unreadable';
  settings?: unknown;
  problem?: string;
}

export interface IsolationRule {
  /** The dotted settings key, from the settings root. */
  key: string;
  /** `any`: fails in every source; `managed`: fails only in a managed source. */
  failsIn: 'any' | 'managed';
  /** A Boolean key with its safe value, or a list that is safe only when empty. */
  safe: boolean | 'empty-list';
  /**
   * `builder-grant`: in the launch source the list must equal the grant the caller passes
   * (`LaunchGrant`), not be empty. Every other source still needs an empty list.
   */
  launch?: 'builder-grant';
  /** What an unsafe value does, completing "which {effect}". */
  effect: string;
  /** The doc page and the quoted phrase this rule rests on. */
  doc: string;
}

const SANDBOXING = 'https://code.claude.com/docs/en/sandboxing';

export const ISOLATION_RULES: readonly IsolationRule[] = [
  {
    key: 'sandbox.filesystem.disabled',
    failsIn: 'any',
    safe: false,
    effect: 'turns filesystem isolation off',
    doc: `${SANDBOXING} "Which settings can disable it": "User settings, managed settings, and the \`--settings\` CLI flag can set it"; "\`sandbox.filesystem.disabled\` defaults to \`false\`"`,
  },
  {
    key: 'sandbox.excludedCommands',
    failsIn: 'any',
    safe: 'empty-list',
    effect: 'runs those commands outside the sandbox',
    doc: `${SANDBOXING} "Run commands outside the sandbox with excludedCommands": "run matching commands outside the sandbox, which means no filesystem restrictions and no network proxy"; "When you define the same filesystem array in multiple settings scopes, Claude Code merges them"`,
  },
  {
    key: 'sandbox.enabled',
    failsIn: 'managed',
    safe: true,
    effect: 'turns the sandbox off',
    doc: `${SANDBOXING} "Enforce sandboxing with managed settings": "When managed settings set a Boolean key such as \`enabled\` or \`failIfUnavailable\`, Claude Code uses the managed value and ignores anything a developer sets locally"`,
  },
  {
    key: 'sandbox.failIfUnavailable',
    failsIn: 'managed',
    safe: true,
    effect: 'lets commands run unsandboxed when the sandbox cannot start',
    doc: `${SANDBOXING}: "By default, when the platform doesn't support the sandbox or the dependency check at startup fails, Claude Code runs commands without sandboxing"; set \`failIfUnavailable\` to \`true\` "to make Claude Code exit at startup instead"`,
  },
  {
    key: 'sandbox.allowUnsandboxedCommands',
    failsIn: 'managed',
    safe: false,
    effect: 'lets a failed command retry outside the sandbox',
    doc: `${SANDBOXING} "Turn off the retry with strict sandbox mode": "You can disable the unsandboxed retry by setting \`"allowUnsandboxedCommands": false\`"; "With the retry disabled, Claude Code ignores the \`dangerouslyDisableSandbox\` parameter"`,
  },
  {
    key: 'sandbox.autoAllowBashIfSandboxed',
    failsIn: 'managed',
    safe: false,
    effect: 'auto-approves sandboxed commands',
    doc: `${SANDBOXING} "What changes when filesystem isolation is off": "\`autoAllowBashIfSandboxed\` still defaults to \`true\` ... Set it to \`false\` to prompt for sandboxed commands"`,
  },
  {
    // Added at a later re-check of the docs (the list only grows).
    key: 'sandbox.allowAppleEvents',
    failsIn: 'any',
    safe: false,
    effect: 'lets sandboxed commands launch applications outside the sandbox',
    doc: `${SANDBOXING} "Security limitations": "it removes code-execution isolation: sandboxed commands can launch other applications unsandboxed with no user prompt"; "It is only honored from user, managed, or CLI settings"`,
  },
  // Write and read widenings (CR-01 from the trusted-shell review). Filesystem arrays merge across
  // every scope the session loads, so a user or managed entry widens every agent session.
  {
    key: 'sandbox.filesystem.allowWrite',
    failsIn: 'any',
    safe: 'empty-list',
    launch: 'builder-grant',
    effect: 'lets sandboxed commands write there',
    doc: `${SANDBOXING} "Configure sandboxing": "use \`sandbox.filesystem.allowWrite\` to grant access to specific paths"; "When you define the same filesystem array in multiple settings scopes, Claude Code merges them, combining the paths rather than replacing one scope's array with another's"`,
  },
  {
    key: 'sandbox.filesystem.allowRead',
    failsIn: 'any',
    safe: 'empty-list',
    effect: 'lets sandboxed commands read inside denied folders',
    doc: `${SANDBOXING} "Configure sandboxing": "re-allow specific paths within a denied region using \`sandbox.filesystem.allowRead\`"; "For array keys such as \`allowRead\`, Claude Code merges entries from the scopes the session loads, so a developer can append entries that widen the policy"`,
  },
  {
    key: 'permissions.additionalDirectories',
    failsIn: 'any',
    safe: 'empty-list',
    effect: 'lets agents write in those directories',
    doc: `${SANDBOXING} "Run a Bash command": "commands inside the sandbox can write to the working directory, a per-user temp directory, and any directories you've added with \`--add-dir\`, \`/add-dir\`, or \`permissions.additionalDirectories\`"`,
  },
  {
    key: 'sandbox.network.allowUnixSockets',
    failsIn: 'any',
    safe: 'empty-list',
    effect: 'lets sandboxed commands connect to those local sockets',
    doc: `${SANDBOXING} "Repository settings under an admin-required sandbox": \`network.allowUnixSockets\` is among the settings that loosen the sandbox; "For array keys ... a developer can append entries that widen the policy"`,
  },
  {
    key: 'sandbox.network.allowAllUnixSockets',
    failsIn: 'any',
    safe: false,
    effect: 'lets sandboxed commands connect to every local socket',
    doc: `${SANDBOXING} "Keep developers from widening the policy": "a developer's user settings or \`--settings\` can turn on the following keys ... Each one weakens the sandbox": \`network.allowAllUnixSockets\`, "which opens every Unix socket to sandboxed commands"`,
  },
];

/**
 * What the launch source may grant beyond the defaults: the builder's own write grant. Doctor
 * passes the grant of the profile it checks; with no grant the launch source must grant nothing.
 */
export interface LaunchGrant {
  allowWrite: readonly string[];
}

const NO_GRANT: LaunchGrant = { allowWrite: [] };

const LABEL = 'Sandbox isolation settings';
const ID = 'sandbox-isolation';
const MAX_SHOWN = 40;

interface Finding {
  source: SettingsSourceRead;
  key: string;
  /** null when a launch-source key is left unset. */
  shown: string | null;
  effect: string;
  safe: string;
}

/** Control characters (C0, DEL, C1, U+2028, U+2029) become spaces; trimmed. */
function sanitise(text: string): string {
  let result = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const control =
      code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
    result += control ? ' ' : ch;
  }
  return result.trim();
}

function capped(text: string): string {
  const clean = sanitise(text);
  const chars = [...clean];
  return chars.length > MAX_SHOWN ? chars.slice(0, MAX_SHOWN).join('') : clean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function entries(n: number): string {
  return `${n} ${n === 1 ? 'entry' : 'entries'}`;
}

/** A settings value as it may be shown: a Boolean, a short quoted string, a count, or a type. */
function shownValue(value: unknown): string {
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return JSON.stringify(capped(value));
  if (Array.isArray(value)) return entries(value.length);
  if (value === null) return 'null';
  if (typeof value === 'object') return 'an object';
  return `a ${typeof value}`;
}

function shownSafe(safe: IsolationRule['safe']): string {
  return safe === 'empty-list' ? 'an empty list' : String(safe);
}

/** A Boolean, a quoted Boolean, or null for any other value. */
function asBoolean(value: unknown): boolean | null {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

function displayPath(path: string, homeDir: string): string {
  const home = homeDir.endsWith('/') && homeDir !== '/' ? homeDir.slice(0, -1) : homeDir;
  if (home !== '' && home !== '/') {
    if (path === home) return '~';
    if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  }
  return sanitise(path);
}

/** True when `value` is a list holding exactly the entries of `grant`. */
function equalsGrant(value: unknown, grant: readonly string[]): boolean {
  if (!Array.isArray(value) || value.length !== grant.length) return false;
  const wanted = new Set(grant);
  return value.every((entry) => typeof entry === 'string' && wanted.has(entry));
}

function findingsOf(source: SettingsSourceRead, grant: LaunchGrant): Finding[] {
  const findings: Finding[] = [];
  const add = (key: string, shown: string | null, effect: string, safe: string) =>
    findings.push({ source, key, shown, effect, safe });
  const settings = source.settings;
  if (!isPlainObject(settings)) {
    add('settings', shownValue(settings), 'Counterpoint cannot check', 'an object');
    return findings;
  }
  const isLaunch = source.kind === 'launch';
  const managed = isManagedKind(source.kind);
  // A parent of some rule's key that is present but not an object: reported once, and the rules
  // beneath it are not judged (Counterpoint cannot read them).
  const badParents = new Set<string>();

  for (const rule of ISOLATION_RULES) {
    if (rule.failsIn === 'managed' && !managed && !isLaunch) continue;
    const parts = rule.key.split('.');
    let node: unknown = settings;
    let blocked = false;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const name = parts[i] as string;
      const next = isPlainObject(node) && Object.hasOwn(node, name) ? node[name] : undefined;
      if (next === undefined) {
        node = undefined;
        break;
      }
      if (!isPlainObject(next)) {
        const parent = parts.slice(0, i + 1).join('.');
        if (!badParents.has(parent)) {
          badParents.add(parent);
          add(parent, shownValue(next), 'Counterpoint cannot check', 'an object');
        }
        blocked = true;
        break;
      }
      node = next;
    }
    if (blocked) continue;
    const last = parts[parts.length - 1] as string;
    const value = isPlainObject(node) && Object.hasOwn(node, last) ? node[last] : undefined;

    if (isLaunch && rule.launch === 'builder-grant') {
      // Unset equals an empty list here: Claude Code adds nothing.
      if (!equalsGrant(value ?? [], grant.allowWrite)) {
        add(
          rule.key,
          value === undefined ? null : shownValue(value),
          rule.effect,
          "the builder's own grant",
        );
      }
      continue;
    }
    const safe = shownSafe(rule.safe);
    if (value === undefined) {
      // The launch flag must pin every key only a managed source could otherwise decide.
      if (isLaunch && rule.failsIn === 'managed') add(rule.key, null, rule.effect, safe);
      continue;
    }
    if (rule.safe === 'empty-list') {
      if (!Array.isArray(value) || value.length > 0) {
        add(rule.key, shownValue(value), rule.effect, safe);
      }
      continue;
    }
    if (asBoolean(value) !== rule.safe) add(rule.key, shownValue(value), rule.effect, safe);
  }
  return findings;
}

function findingDetail(finding: Finding): string {
  const label = sanitise(finding.source.label);
  if (finding.shown === null) {
    return `${label} does not set ${finding.key}, so Claude Code's default ${finding.effect}.`;
  }
  return `${label} sets ${finding.key} to ${finding.shown}, which ${finding.effect}.`;
}

function findingFix(finding: Finding, homeDir: string): string {
  const { source, key } = finding;
  const label = sanitise(source.label);
  const where = source.path === null ? label : displayPath(source.path, homeDir);
  if (source.kind === 'launch') {
    return `Counterpoint's launch settings must set ${key} to ${finding.safe}. This is a Counterpoint bug: update Counterpoint, then run "counterpoint doctor" again.`;
  }
  if (source.kind === 'user') {
    return `Remove ${key} from ${where}, then run "counterpoint doctor" again.`;
  }
  const at = source.path === null ? label : `${label} (${where})`;
  return `Ask your administrator to remove ${key} from ${at}, then run "counterpoint doctor" again.`;
}

/**
 * Judges every settings source an agent session loads. Fails on an unreadable source, on a
 * missing launch source, and on any rule finding; passes only when none of those holds.
 * `launchGrant` is the only write grant the launch source may carry (none by default).
 */
export function judgeSandboxIsolation(
  sources: readonly SettingsSourceRead[],
  homeDir: string,
  launchGrant: LaunchGrant = NO_GRANT,
): SandboxIsolationCheck {
  const perSource = sources.map((source) => ({
    source,
    findings: source.state === 'read' ? findingsOf(source, launchGrant) : [],
  }));
  const stored = perSource.map(({ source, findings }) => ({
    kind: source.kind,
    label: sanitise(source.label),
    path: source.path === null ? null : displayPath(source.path, homeDir),
    state: source.state,
    findings: [...new Set(findings.map((f) => f.key))],
  }));
  const base = { id: ID, label: LABEL, sources: stored } as const;

  const unreadable = sources.find((source) => source.state === 'unreadable');
  if (unreadable !== undefined) {
    const label = sanitise(unreadable.label);
    const problem = sanitise(unreadable.problem ?? 'unreadable');
    if (unreadable.path === null) {
      return {
        ...base,
        result: 'fail',
        detail: `Couldn't read ${label}: ${problem}. Claude Code may apply settings Counterpoint cannot check.`,
        fix: `Make ${label} readable to Counterpoint, then run "counterpoint doctor" again.`,
      };
    }
    const path = displayPath(unreadable.path, homeDir);
    return {
      ...base,
      result: 'fail',
      detail: `Couldn't read ${label} (${path}): ${problem}. Claude Code may apply settings Counterpoint cannot check.`,
      fix: `Fix or remove ${path}, then run "counterpoint doctor" again.`,
    };
  }

  if (!sources.some((source) => source.kind === 'launch' && source.state === 'read')) {
    return {
      ...base,
      result: 'fail',
      detail: 'The launch settings were not checked.',
      fix: 'This is a Counterpoint bug: update Counterpoint, then run "counterpoint doctor" again.',
    };
  }

  const findings = perSource.flatMap(({ findings }) => findings);
  const first = findings[0];
  if (first !== undefined) {
    const more = findings.length - 1;
    const tail =
      more === 0
        ? ''
        : ` ${more} more ${more === 1 ? 'finding' : 'findings'} in the stored report.`;
    return {
      ...base,
      result: 'fail',
      detail: `${findingDetail(first)}${tail}`,
      fix: findingFix(first, homeDir),
    };
  }

  const read = sources.filter((source) => source.state === 'read');
  const labels = read.map((source) => sanitise(source.label)).join(', ');
  return {
    ...base,
    result: 'pass',
    detail: `No settings source Claude Code loads for agent sessions turns sandbox isolation off or widens it (${read.length} checked: ${labels}).`,
  };
}

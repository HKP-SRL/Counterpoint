// Integrity snapshot of a host repository's execution-capable git surface (key-trust: Host
// integrity baseline; owner decision "risky keys + owner baseline").
//
// Hashing all of .git/config would fire on routine churn (`git push -u` rewrites branch
// tracking) and train the owner to click through. So only what can make git run a program or
// change where it talks to is captured: the risky local config keys below (read with
// `git config --list --local --no-includes -z`, which reads and never executes), the SHA-256 of
// every hook that is not a `.sample`, every file in info/, config.worktree and every linked
// worktree's own `worktrees/<id>/config.worktree`, and the content of every file an include
// directive pulls in (WR-05: `include.path` and `includeIf.*.path`, nested, resolved as git does,
// in the common config and in every worktree config). Names matching
// the sandbox probe's artifact pattern are skipped: git never runs or reads files by those
// names, so a doctor probe killed midway cannot make approve refuse, while any real hook name is
// always captured. The owner accepts a baseline with `counterpoint trust {host}`;
// approve and doctor refuse when the current snapshot differs.
import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { writeFileAtomic0600 } from '../fs/atomic.ts';
import { runGit } from '../git/run.ts';
import { hostDir } from '../host/home.ts';
import { PROBE_GIT_ARTIFACT_RE } from '../ids.ts';

const SCHEMA = 'counterpoint/integrity/v2';
/** The first format: no worktree configs, no include targets. Read as v2 with both empty. */
const SCHEMA_V1 = 'counterpoint/integrity/v1';
/** git's own include depth limit (config.c MAX_INCLUDE_DEPTH). */
const MAX_INCLUDE_DEPTH = 10;
const MAX_INCLUDE_BYTES = 1024 * 1024;

/**
 * Lowercased matchers for execution-capable config keys. `section.*` matches any key in the
 * section (with or without subsection); `section.*.name` matches that name under any subsection.
 */
export const RISKY_CONFIG_KEYS: readonly string[] = [
  'core.fsmonitor',
  'core.hookspath',
  'core.sshcommand',
  'core.pager',
  'core.editor',
  'core.askpass',
  'core.gitproxy',
  'core.worktree',
  'core.attributesfile',
  'core.alternaterefscommand',
  'gpg.*',
  'user.signingkey',
  'commit.gpgsign',
  'diff.external',
  'diff.*.command',
  'diff.*.textconv',
  'difftool.*.cmd',
  'mergetool.*.cmd',
  'pager.*',
  'sequence.editor',
  'submodule.*.update',
  'http.proxy',
  'http.*.proxy',
  'filter.*',
  'merge.*.driver',
  'credential.*',
  'alias.*',
  'include.*',
  'includeif.*',
  'url.*',
  'remote.*.url',
  'remote.*.pushurl',
  'remote.*.receivepack',
  'remote.*.uploadpack',
  'remote.*.vcs',
  'remote.*.proxy',
  'extensions.*',
  'receive.*',
  'uploadpack.*',
];

function matchesKey(pattern: string, key: string): boolean {
  const first = pattern.indexOf('.');
  const section = pattern.slice(0, first);
  const rest = pattern.slice(first + 1);
  if (!key.startsWith(`${section}.`)) return false;
  if (rest === '*') return true;
  if (rest.startsWith('*.')) {
    const name = rest.slice(2);
    const middle = key.slice(section.length + 1, key.length - name.length - 1);
    return key.endsWith(`.${name}`) && middle.length > 0;
  }
  return key === pattern;
}

/** True when a config key (any case) belongs to the execution-capable surface. */
export function isRiskyConfigKey(key: string): boolean {
  const lower = key.toLowerCase();
  return RISKY_CONFIG_KEYS.some((pattern) => matchesKey(pattern, lower));
}

export interface IntegritySnapshot {
  schema: typeof SCHEMA;
  /** Risky keys → values in file order (keys sorted). */
  config: Record<string, string[]>;
  /** Hook name → `sha256:…`, `symlink:{target}`, `directory` or `other`. */
  hooks: Record<string, string>;
  /** info/ entry name → same encoding as hooks. */
  info: Record<string, string>;
  configWorktree: string | null;
  /** Linked worktree id → its own `worktrees/<id>/config.worktree` (same encoding as hooks). */
  worktreeConfigs: Record<string, string>;
  /**
   * Include target (the resolved absolute path, `~/` expanded) → `sha256:…` of its content read
   * through symlinks, `missing`, `other` or `unresolved` (a `~user/` path).
   */
  includes: Record<string, string>;
}

export interface IntegrityChange {
  area: 'config' | 'hooks' | 'info' | 'config.worktree' | 'worktree config' | 'include';
  name: string;
  before: string | null;
  after: string | null;
}

const SnapshotSchema = z.object({
  schema: z.literal(SCHEMA),
  config: z.record(z.string(), z.array(z.string())),
  hooks: z.record(z.string(), z.string()),
  info: z.record(z.string(), z.string()),
  configWorktree: z.string().nullable(),
  worktreeConfigs: z.record(z.string(), z.string()),
  includes: z.record(z.string(), z.string()),
});

/**
 * A baseline in either format. A v1 baseline reads as v2 with no worktree configs and no include
 * targets, so anything those now capture shows as a change the owner reviews with `trust`.
 */
const StoredSchema = z.union([
  SnapshotSchema,
  z
    .object({
      schema: z.literal(SCHEMA_V1),
      config: z.record(z.string(), z.array(z.string())),
      hooks: z.record(z.string(), z.string()),
      info: z.record(z.string(), z.string()),
      configWorktree: z.string().nullable(),
    })
    .transform((v1) => ({
      ...v1,
      schema: SCHEMA,
      worktreeConfigs: {} as Record<string, string>,
      includes: {} as Record<string, string>,
    })),
]);

function sha256File(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) return 'other';
    return `sha256:${createHash('sha256').update(readFileSync(fd)).digest('hex')}`;
  } finally {
    closeSync(fd);
  }
}

/** Describes one directory entry without following symlinks or executing anything. */
function describeEntry(path: string): string | null {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined) return null;
  if (stat.isSymbolicLink()) return `symlink:${readlinkSync(path)}`;
  if (stat.isDirectory()) return 'directory';
  if (stat.isFile()) return sha256File(path);
  return 'other';
}

function describeDir(dir: string, skip: (name: string) => boolean): Record<string, string> {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  const result: Record<string, string> = {};
  for (const name of names.sort()) {
    if (skip(name)) continue;
    const described = describeEntry(join(dir, name));
    if (described !== null) result[name] = described;
  }
  return result;
}

async function readRiskyConfig(gitCommonDir: string): Promise<Record<string, string[]>> {
  const { stdout } = await runGit(gitCommonDir, [
    '--git-dir',
    gitCommonDir,
    'config',
    '--list',
    '--local',
    '--no-includes',
    '-z',
  ]);
  const grouped = new Map<string, string[]>();
  for (const record of stdout.split('\0')) {
    if (record === '') continue;
    const newline = record.indexOf('\n');
    const key = newline < 0 ? record : record.slice(0, newline);
    const value = newline < 0 ? '' : record.slice(newline + 1);
    if (!isRiskyConfigKey(key)) continue;
    const values = grouped.get(key) ?? [];
    values.push(value);
    grouped.set(key, values);
  }
  const config: Record<string, string[]> = {};
  for (const key of [...grouped.keys()].sort()) config[key] = grouped.get(key) as string[];
  return config;
}

/** Every `include.path` and `includeIf.*.path` value of one config file, in file order. */
async function includeDirectives(gitCommonDir: string, file: string): Promise<string[]> {
  const { stdout } = await runGit(gitCommonDir, [
    'config',
    '--file',
    file,
    '--list',
    '--no-includes',
    '-z',
  ]);
  const paths: string[] = [];
  for (const record of stdout.split('\0')) {
    if (record === '') continue;
    const newline = record.indexOf('\n');
    if (newline < 0) continue;
    const key = record.slice(0, newline).toLowerCase();
    if (key === 'include.path' || (key.startsWith('includeif.') && key.endsWith('.path'))) {
      paths.push(record.slice(newline + 1));
    }
  }
  return paths;
}

/**
 * Where git looks for an include path written in `fromFile` (git-config(1), "Includes"): `~/`
 * expands to HOME, a relative path is relative to the including file's directory. `~user/` is
 * not resolved here (null).
 */
export function resolveIncludePath(path: string, fromFile: string, homeDir: string): string | null {
  if (path === '~' || path.startsWith('~/')) return join(homeDir, path.slice(1));
  if (path.startsWith('~')) return null;
  return isAbsolute(path) ? resolve(path) : resolve(dirname(fromFile), path);
}

/** An include target's content, read through symlinks as git reads it. */
function describeIncludeTarget(path: string): string {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'other';
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_INCLUDE_BYTES) return 'other';
    return `sha256:${createHash('sha256').update(readFileSync(fd)).digest('hex')}`;
  } finally {
    closeSync(fd);
  }
}

/**
 * The content of every file the given config files include, nested includes followed up to
 * git's depth limit. Reading a config file never executes anything (`--no-includes`, `--file`).
 */
async function describeIncludes(
  gitCommonDir: string,
  roots: readonly string[],
  homeDir: string,
): Promise<Record<string, string>> {
  const found = new Map<string, string>();
  let frontier = roots.filter((file) => describeEntry(file) !== null);
  for (let depth = 0; depth < MAX_INCLUDE_DEPTH && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const file of frontier) {
      for (const written of await includeDirectives(gitCommonDir, file)) {
        const target = resolveIncludePath(written, file, homeDir);
        const key = target ?? `unresolved:${written}`;
        if (found.has(key)) continue;
        const described = target === null ? 'unresolved' : describeIncludeTarget(target);
        found.set(key, described);
        if (target !== null && described.startsWith('sha256:')) next.push(target);
      }
    }
    frontier = next;
  }
  const includes: Record<string, string> = {};
  for (const key of [...found.keys()].sort()) includes[key] = found.get(key) as string;
  return includes;
}

/** Snapshots the execution-capable surface of the repository whose common git dir is given. */
export async function snapshotIntegrity(
  gitCommonDir: string,
  options: { homeDir?: string } = {},
): Promise<IntegritySnapshot> {
  const isProbe = (name: string) => PROBE_GIT_ARTIFACT_RE.test(name);
  const homeDir = options.homeDir ?? homedir();
  // Each linked worktree's own config: `worktrees/<id>/config.worktree`.
  const worktreesDir = join(gitCommonDir, 'worktrees');
  const worktreeConfigs: Record<string, string> = {};
  const configFiles = [join(gitCommonDir, 'config'), join(gitCommonDir, 'config.worktree')];
  for (const id of Object.keys(describeDir(worktreesDir, () => false))) {
    const file = join(worktreesDir, id, 'config.worktree');
    const described = describeEntry(file);
    if (described === null) continue;
    worktreeConfigs[id] = described;
    configFiles.push(file);
  }
  return {
    schema: SCHEMA,
    config: await readRiskyConfig(gitCommonDir),
    hooks: describeDir(join(gitCommonDir, 'hooks'), (n) => n.endsWith('.sample') || isProbe(n)),
    info: describeDir(join(gitCommonDir, 'info'), isProbe),
    configWorktree: describeEntry(join(gitCommonDir, 'config.worktree')),
    worktreeConfigs,
    includes: await describeIncludes(gitCommonDir, configFiles, homeDir),
  };
}

function compareRecords(
  area: IntegrityChange['area'],
  before: Record<string, string>,
  after: Record<string, string>,
  changes: IntegrityChange[],
): void {
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  for (const name of names) {
    const a = before[name] ?? null;
    const b = after[name] ?? null;
    if (a !== b) changes.push({ area, name, before: a, after: b });
  }
}

/** Lists every difference between the baseline and the current snapshot. */
export function compareIntegrity(
  baseline: IntegritySnapshot,
  current: IntegritySnapshot,
): { ok: true } | { ok: false; changes: IntegrityChange[] } {
  const changes: IntegrityChange[] = [];
  const joined = (values: string[] | undefined) =>
    values === undefined ? null : values.join('\n');
  const keys = [
    ...new Set([...Object.keys(baseline.config), ...Object.keys(current.config)]),
  ].sort();
  for (const key of keys) {
    const a = baseline.config[key];
    const b = current.config[key];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
      changes.push({ area: 'config', name: key, before: joined(a), after: joined(b) });
    }
  }
  compareRecords('hooks', baseline.hooks, current.hooks, changes);
  compareRecords('info', baseline.info, current.info, changes);
  compareRecords('worktree config', baseline.worktreeConfigs, current.worktreeConfigs, changes);
  compareRecords('include', baseline.includes, current.includes, changes);
  if (baseline.configWorktree !== current.configWorktree) {
    changes.push({
      area: 'config.worktree',
      name: 'config.worktree',
      before: baseline.configWorktree,
      after: current.configWorktree,
    });
  }
  return changes.length === 0 ? { ok: true } : { ok: false, changes };
}

function baselinePath(home: string, hostId: string): string {
  return join(hostDir(home, hostId), 'integrity.json');
}

/** The owner-accepted baseline for a host, or null when none was recorded. Throws if corrupt. */
export function readBaseline(home: string, hostId: string): IntegritySnapshot | null {
  const file = baselinePath(home, hostId);
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`The integrity baseline ${file} cannot be read safely.`);
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o022) !== 0) {
      throw new Error(`The integrity baseline ${file} is not a private regular file.`);
    }
    const parsed = StoredSchema.safeParse(JSON.parse(readFileSync(fd, 'utf8')));
    if (!parsed.success) throw new Error(`The integrity baseline ${file} is not valid.`);
    return parsed.data as IntegritySnapshot;
  } finally {
    closeSync(fd);
  }
}

/** Records `snapshot` as the owner's baseline (`hosts/{id}/integrity.json`, dir 0700, file 0600). */
export function writeBaseline(home: string, hostId: string, snapshot: IntegritySnapshot): void {
  const dir = hostDir(home, hostId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = join(dir, 'integrity.json');
  writeFileAtomic0600(file, `${JSON.stringify(SnapshotSchema.parse(snapshot), null, 2)}\n`);
}

export type IntegrityState =
  | { state: 'ok' }
  | { state: 'no-baseline' }
  | { state: 'changed'; changes: IntegrityChange[] };

/** Compares the host's current snapshot with its baseline. */
export async function checkIntegrity(
  home: string,
  host: { id: string; gitCommonDir: string },
): Promise<IntegrityState> {
  const baseline = readBaseline(home, host.id);
  if (baseline === null) return { state: 'no-baseline' };
  const result = compareIntegrity(baseline, await snapshotIntegrity(host.gitCommonDir));
  return result.ok ? { state: 'ok' } : { state: 'changed', changes: result.changes };
}

/** The refusal sentence shown by approve and the console when integrity changed. */
export function INTEGRITY_REFUSAL(hostName: string): string {
  return `Signing would be refused: ${hostName}'s .git/config (or hooks) changed since Counterpoint last checked. Review the change in ${hostName}, then prepare the approval again.`;
}

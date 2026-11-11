// Doctor: checks on the trusted approval key (doctor: Approval key hygiene).
//
// The approval key must be a dedicated, passphrase-protected key that nothing can use without
// the owner typing the passphrase: not loaded in ssh-agent, and not loadable from the Keychain.
// These checks inspect the containers of secrets, never the secrets:
//   - the private key file is read only far enough to learn its cipher, kdf and bcrypt rounds,
//     which OpenSSH stores unencrypted ahead of the encrypted part;
//   - `ssh-keygen -y -P ''` is used only for its exit status and error text (stdout ignored);
//   - `ssh-add -l` lists public fingerprints only;
//   - the Keychain lookup asks whether an item exists and never asks for its password.
// Nothing derived from key material is printed, logged or stored.
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { SSH_KEYGEN, sshKeygenEnv } from '../core/approvals/ssh.ts';
import type { TrustResult } from '../core/approvals/trust-store.ts';
import type { Check } from '../core/security/doctor-report.ts';
import {
  type CommandRunner,
  MIN_OPENSSH_VERSION,
  parseOpenSshVersion,
  runCommand,
  versionAtLeast,
} from './tools.ts';

const MAX_KEY_FILE_BYTES = 16 * 1024;
const MAX_HEADER_STRING = 256;
const MAX_SSH_CONFIG_BYTES = 256 * 1024;
const MAX_INCLUDE_DEPTH = 16;
const RECOMMENDED_ROUNDS = 16;

const BEGIN = '-----BEGIN OPENSSH PRIVATE KEY-----';
const END = '-----END OPENSSH PRIVATE KEY-----';
const MAGIC = Buffer.from('openssh-key-v1\0', 'latin1');
const NAME_RE = /^[A-Za-z0-9@._-]{1,64}$/;

const SSH_ADD = '/usr/bin/ssh-add';
const SSH = '/usr/bin/ssh';
const SECURITY = '/usr/bin/security';
const LAUNCHCTL = '/bin/launchctl';

/** The default path the owner generates the dedicated key at (`counterpoint init-key`). */
export const DEFAULT_APPROVAL_KEY = '~/.ssh/counterpoint_approval';

export const NO_TRUSTED_KEY_FIX = `Run "counterpoint init-key", then "counterpoint trust-key ${DEFAULT_APPROVAL_KEY}.pub".`;

export class KeyHeaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyHeaderError';
  }
}

export interface KeyHeader {
  cipher: string;
  kdf: string;
  /** bcrypt rounds; present only when kdf is bcrypt. */
  rounds?: number;
}

/** Reads length-prefixed fields from the decoded key body, with bounds checks on every read. */
class FieldReader {
  private offset: number;
  private readonly bytes: Buffer;

  constructor(bytes: Buffer, start: number) {
    this.bytes = bytes;
    this.offset = start;
  }

  uint32(): number {
    if (this.offset + 4 > this.bytes.length)
      throw new KeyHeaderError('The key header is truncated.');
    const value = this.bytes.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  string(max: number): Buffer {
    const length = this.uint32();
    if (length > max || this.offset + length > this.bytes.length) {
      throw new KeyHeaderError('The key header is truncated or malformed.');
    }
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  name(): string {
    const value = this.string(64).toString('latin1');
    if (!NAME_RE.test(value))
      throw new KeyHeaderError('The key header names an unknown algorithm.');
    return value;
  }
}

/**
 * Reads only the unencrypted header of an OpenSSH private key: cipher name, kdf name and (for
 * bcrypt) the rounds. The file is opened without following a symlink and must be a regular file
 * under 16 KiB. Errors never quote the file's content.
 */
export function readOpenSshKeyHeader(path: string): KeyHeader {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ELOOP') throw new KeyHeaderError(`${path} is a symlink.`);
    if (code === 'ENOENT') throw new KeyHeaderError(`${path} does not exist.`);
    throw new KeyHeaderError(`${path} cannot be opened (${code ?? 'error'}).`);
  }
  let body: Buffer | undefined;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new KeyHeaderError(`${path} is not a regular file.`);
    if (stat.size >= MAX_KEY_FILE_BYTES)
      throw new KeyHeaderError(`${path} is too large to be a key.`);
    const lines = readFileSync(fd, 'latin1')
      .split(/\r?\n/)
      .map((line) => line.trim());
    const begin = lines.indexOf(BEGIN);
    const end = lines.indexOf(END);
    if (begin < 0 || end <= begin + 1) {
      throw new KeyHeaderError(`${path} is not an OpenSSH private key.`);
    }
    const base64 = lines.slice(begin + 1, end).join('');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      throw new KeyHeaderError(`${path} is not an OpenSSH private key.`);
    }
    body = Buffer.from(base64, 'base64');
    if (body.length < MAGIC.length || !body.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new KeyHeaderError(`${path} is not an OpenSSH private key (no openssh-key-v1 magic).`);
    }
    const reader = new FieldReader(body, MAGIC.length);
    const cipher = reader.name();
    const kdf = reader.name();
    const kdfOptions = reader.string(MAX_HEADER_STRING);
    if (kdf === 'bcrypt') {
      const options = new FieldReader(kdfOptions, 0);
      options.string(MAX_HEADER_STRING); // salt: skipped, never returned
      const rounds = options.uint32();
      return { cipher, kdf, rounds };
    }
    if (kdfOptions.length !== 0) throw new KeyHeaderError('The key header is malformed.');
    return { cipher, kdf };
  } finally {
    body?.fill(0);
    closeSync(fd);
  }
}

// --- ssh config ---------------------------------------------------------------------------------

interface Directive {
  keyword: string;
  value: string;
}

/** Splits an ssh_config argument list, honouring double quotes. */
function splitArgs(text: string): string[] {
  const args: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  for (let match = re.exec(text); match !== null; match = re.exec(text)) {
    args.push(match[1] ?? match[2] ?? '');
  }
  return args;
}

function expandTilde(path: string, homeDir: string): string {
  if (path === '~') return homeDir;
  if (path.startsWith('~/')) return join(homeDir, path.slice(2));
  return path;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
}

/** Files an `Include` argument names; a glob is supported in the last path component. */
function includeTargets(arg: string, configDir: string, homeDir: string): string[] {
  const expanded = expandTilde(arg, homeDir);
  const full = isAbsolute(expanded) ? expanded : join(configDir, expanded);
  const name = basename(full);
  if (!/[*?]/.test(name)) return [full];
  const dir = dirname(full);
  const re = globToRegExp(name);
  try {
    return readdirSync(dir)
      .filter((entry) => re.test(entry))
      .sort()
      .map((entry) => join(dir, entry));
  } catch {
    return [];
  }
}

function readConfigFile(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_SSH_CONFIG_BYTES) return null;
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

function collectDirectives(
  path: string,
  configDir: string,
  homeDir: string,
  depth: number,
  visited: Set<string>,
  out: Directive[],
): void {
  if (depth > MAX_INCLUDE_DEPTH) return;
  let key = path;
  try {
    key = realpathSync(path);
  } catch {
    return;
  }
  if (visited.has(key)) return;
  visited.add(key);
  const text = readConfigFile(path);
  if (text === null) return;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^([A-Za-z]+)\s*(?:=\s*|\s+)(.*)$/.exec(line);
    if (!match) continue;
    const keyword = (match[1] as string).toLowerCase();
    const rest = (match[2] as string).trim();
    if (keyword === 'include') {
      for (const arg of splitArgs(rest)) {
        for (const target of includeTargets(arg, configDir, homeDir)) {
          collectDirectives(target, configDir, homeDir, depth + 1, visited, out);
        }
      }
      continue;
    }
    out.push({ keyword, value: splitArgs(rest)[0] ?? '' });
  }
}

function samePath(a: string, b: string): boolean {
  if (resolve(a) === resolve(b)) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

/**
 * True when the ssh config (and the files it includes) could load this key into ssh-agent or
 * the Keychain: an `IdentityFile` naming the key (or its .pub) together with `AddKeysToAgent`
 * other than `no`, or `UseKeychain yes`. Host and Match scoping is deliberately ignored, so any
 * such combination anywhere in the config counts (fail closed: the dedicated approval key
 * should not appear in ssh config at all).
 */
export function keyLoadableViaSshConfig(
  configPath: string,
  keyPath: string,
  options: { homeDir?: string } = {},
): boolean {
  const homeDir = options.homeDir ?? homedir();
  const directives: Directive[] = [];
  collectDirectives(configPath, dirname(configPath), homeDir, 0, new Set(), directives);
  let referenced = false;
  let loads = false;
  for (const { keyword, value } of directives) {
    if (keyword === 'identityfile') {
      const expanded = expandTilde(value.replace(/%d/g, homeDir), homeDir);
      const file = isAbsolute(expanded) ? expanded : join(homeDir, expanded);
      if (samePath(file, keyPath) || samePath(file, `${keyPath}.pub`)) referenced = true;
    } else if (keyword === 'addkeystoagent') {
      if (value !== '' && value.toLowerCase() !== 'no') loads = true;
    } else if (keyword === 'usekeychain') {
      if (value.toLowerCase() === 'yes') loads = true;
    }
  }
  return referenced && loads;
}

// --- checks -------------------------------------------------------------------------------------

export interface CheckSigningKeyInput {
  /** The trust store as read by readTrust(home). */
  trust: TrustResult;
  /** The environment whose SSH_AUTH_SOCK is checked (normally process.env). */
  env: NodeJS.ProcessEnv;
  run?: CommandRunner;
  platform?: NodeJS.Platform;
  /** The user's home directory; `~/.ssh/config` is read from here. */
  homeDir?: string;
}

const LABELS = {
  passphrase: 'Passphrase-protected',
  agent: 'Not loaded in ssh-agent',
  keychain: 'Not loadable via Keychain',
  openssh: 'OpenSSH 8.1 or newer',
  trusted: 'Trusted key',
} as const;

const A4_NOTE =
  'the Keychain item shape (service OpenSSH, account = key path) is an unverified assumption (A4)';

async function passphraseRow(run: CommandRunner, keyPath: string): Promise<Check> {
  const id = 'key-passphrase';
  const label = LABELS.passphrase;
  let header: KeyHeader;
  try {
    header = readOpenSshKeyHeader(keyPath);
  } catch (error) {
    return {
      id,
      label,
      result: 'fail',
      detail: `Couldn't read the key header: ${(error as Error).message}`,
      fix: 'Generate a dedicated key with a passphrase: run "counterpoint init-key".',
    };
  }
  const headerProtected = header.cipher !== 'none' && header.kdf === 'bcrypt';
  const probe = await run(SSH_KEYGEN, ['-y', '-P', '', '-f', keyPath], { env: sshKeygenEnv() });
  // Only the exit status and the error text are used; stdout (a public key) is ignored.
  const crossProtected = probe.exitCode !== 0 && /incorrect passphrase/i.test(probe.stderr);
  const crossUnprotected = probe.exitCode === 0;

  if (headerProtected && crossProtected) {
    const rounds = header.rounds ?? 0;
    const weak =
      rounds < RECOMMENDED_ROUNDS
        ? `; only ${rounds} rounds, fewer than ${RECOMMENDED_ROUNDS} (consider regenerating with -a 100)`
        : `, ${rounds} rounds`;
    return {
      id,
      label,
      result: 'pass',
      detail: `cipher ${header.cipher}, kdf ${header.kdf}${weak}`,
    };
  }
  if (!headerProtected && crossUnprotected) {
    return {
      id,
      label,
      result: 'fail',
      detail: `The key has no passphrase (cipher ${header.cipher}, kdf ${header.kdf}).`,
      fix: 'Generate a dedicated key with a passphrase: run "counterpoint init-key", then trust it.',
    };
  }
  return {
    id,
    label,
    result: 'fail',
    detail: `The key header (cipher ${header.cipher}, kdf ${header.kdf}) and ssh-keygen disagree about the passphrase.`,
    fix: 'Generate a new dedicated key with a passphrase: run "counterpoint init-key", then trust it.',
  };
}

async function agentSockets(
  run: CommandRunner,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<{ socket: string; source: string }[]> {
  const sockets: { socket: string; source: string }[] = [];
  const shell = env.SSH_AUTH_SOCK;
  if (shell !== undefined && shell !== '') sockets.push({ socket: shell, source: 'shell agent' });
  if (platform === 'darwin') {
    const launchd = await run(LAUNCHCTL, ['getenv', 'SSH_AUTH_SOCK']);
    const socket = launchd.exitCode === 0 ? launchd.stdout.trim() : '';
    if (socket !== '' && !sockets.some((s) => s.socket === socket)) {
      sockets.push({ socket, source: 'launchd agent' });
    }
  }
  return sockets;
}

async function agentRow(
  run: CommandRunner,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  fingerprint: string,
  publicKeyPath: string,
): Promise<Check> {
  const id = 'key-agent';
  const label = LABELS.agent;
  const sockets = await agentSockets(run, env, platform);
  if (sockets.length === 0) {
    return { id, label, result: 'pass', detail: 'No ssh-agent socket is set.' };
  }
  const notes: string[] = [];
  for (const { socket, source } of sockets) {
    const listed = await run(SSH_ADD, ['-E', 'sha256', '-l'], {
      env: { PATH: '/usr/bin:/bin', SSH_AUTH_SOCK: socket },
    });
    if (listed.exitCode === 0) {
      const fingerprints: string[] = listed.stdout.match(/SHA256:[A-Za-z0-9+/]+/g) ?? [];
      if (fingerprints.includes(fingerprint)) {
        return {
          id,
          label,
          result: 'fail',
          detail: `The approval key is loaded in the ${source}.`,
          fix: `Remove it with "ssh-add -d ${publicKeyPath}" and don't add it again.`,
        };
      }
      notes.push(`${source}: other keys only`);
    } else if (listed.exitCode === 1) {
      notes.push(`${source}: no identities`);
    } else if (listed.exitCode === 2) {
      notes.push(`${source}: not running`);
    } else {
      return {
        id,
        label,
        result: 'not-checked',
        detail: `Couldn't ask the ${source} (ssh-add exited ${listed.exitCode ?? listed.error ?? 'without a code'}).`,
        fix: 'Run "counterpoint doctor" again; if it repeats, check that ssh-add works in a terminal.',
      };
    }
  }
  return { id, label, result: 'pass', detail: `${notes.join('; ')}.` };
}

async function keychainRow(
  run: CommandRunner,
  platform: NodeJS.Platform,
  homeDir: string,
  keyPath: string,
): Promise<Check> {
  const id = 'key-keychain';
  const label = LABELS.keychain;
  const configPath = join(homeDir, '.ssh', 'config');
  if (keyLoadableViaSshConfig(configPath, keyPath, { homeDir })) {
    return {
      id,
      label,
      result: 'fail',
      detail: `~/.ssh/config can add this key to ssh-agent or the Keychain (AddKeysToAgent or UseKeychain with an IdentityFile for it).`,
      fix: 'Remove the IdentityFile line for this key, or the AddKeysToAgent/UseKeychain lines, from ~/.ssh/config.',
    };
  }
  if (platform !== 'darwin') {
    return { id, label, result: 'pass', detail: 'No ssh config entry loads this key.' };
  }
  // Existence check only: no password flag, so the item's secret is never requested.
  const lookup = await run(SECURITY, ['find-generic-password', '-s', 'OpenSSH', '-a', keyPath]);
  if (lookup.exitCode === 0) {
    return {
      id,
      label,
      result: 'fail',
      detail: `The Keychain holds a stored passphrase for this key; ${A4_NOTE}.`,
      fix: `Delete the OpenSSH Keychain item for ${keyPath} in Keychain Access.`,
    };
  }
  if (lookup.exitCode === 44) {
    return {
      id,
      label,
      result: 'pass',
      detail: `No ssh config entry loads this key and no stored passphrase was found; ${A4_NOTE}.`,
    };
  }
  return {
    id,
    label,
    result: 'not-checked',
    detail: `Couldn't ask the Keychain (security exited ${lookup.exitCode ?? lookup.error ?? 'without a code'}); ${A4_NOTE}.`,
    fix: 'Unlock the login Keychain and run "counterpoint doctor" again.',
  };
}

async function opensshRow(run: CommandRunner): Promise<Check> {
  const id = 'openssh';
  const label = LABELS.openssh;
  const result = await run(SSH, ['-V']);
  const text = `${result.stderr}\n${result.stdout}`;
  const version = parseOpenSshVersion(text);
  const line = /OpenSSH_\S+/.exec(text)?.[0]?.replace(/,$/, '') ?? '';
  if (version === null) {
    return {
      id,
      label,
      result: 'fail',
      detail: "Couldn't read the OpenSSH version from ssh -V.",
      fix: 'Install OpenSSH 8.1 or newer',
    };
  }
  if (!versionAtLeast(version, MIN_OPENSSH_VERSION)) {
    return {
      id,
      label,
      result: 'fail',
      detail: `${line} (ssh-keygen -Y needs 8.1 or newer)`,
      fix: 'Update OpenSSH to 8.1 or newer',
    };
  }
  return { id, label, result: 'pass', detail: line };
}

/**
 * The Signing key group (without the integrity row, which runDoctor adds): passphrase, agent,
 * Keychain, OpenSSH version and the trusted key itself. Without a trusted key every key row
 * fails with the init-key fix; the OpenSSH row is still checked.
 */
export async function checkSigningKey(input: CheckSigningKeyInput): Promise<Check[]> {
  const run = input.run ?? runCommand;
  const platform = input.platform ?? process.platform;
  const homeDir = input.homeDir ?? homedir();
  const { trust } = input;

  if (!trust.ok) {
    const detail = trust.detail;
    const failed = (id: string, label: string): Check => ({
      id,
      label,
      result: 'fail',
      detail,
      fix: NO_TRUSTED_KEY_FIX,
    });
    return [
      failed('key-passphrase', LABELS.passphrase),
      failed('key-agent', LABELS.agent),
      failed('key-keychain', LABELS.keychain),
      await opensshRow(run),
      failed('trusted-key', LABELS.trusted),
    ];
  }

  return [
    await passphraseRow(run, trust.privateKeyPath),
    await agentRow(run, input.env, platform, trust.fingerprint, trust.publicKeyPath),
    await keychainRow(run, platform, homeDir, trust.privateKeyPath),
    await opensshRow(run),
    {
      id: 'trusted-key',
      label: LABELS.trusted,
      result: 'pass',
      detail: `${trust.fingerprint} (${trust.publicKeyPath})`,
    },
  ];
}

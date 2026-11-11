// Owner setup commands for approvals (key-trust: Dedicated approval key setup; Key pinned only
// after terminal confirmation; Host integrity baseline).
//
//   counterpoint init-key          prints how to make a dedicated passphrase ed25519 key
//   counterpoint trust-key {pub}   pins that key for approvals
//   counterpoint trust {host}      accepts the host's execution-capable git surface as baseline
//
// Pinning the key and accepting a baseline are always the owner's act at a terminal: both need
// a TTY and an explicit `y`, and write nothing otherwise. Counterpoint never runs ssh-keygen to
// create the key and never sees the passphrase.
import { closeSync, constants, fstatSync, openSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  compareIntegrity,
  type IntegrityChange,
  type IntegritySnapshot,
  readBaseline,
  snapshotIntegrity,
  writeBaseline,
} from '../core/approvals/integrity.ts';
import { fingerprintOf } from '../core/approvals/ssh.ts';
import { writeTrust } from '../core/approvals/trust-store.ts';
import { assertHostId, InvalidIdError } from '../core/ids.ts';
import {
  getHost,
  type HostRow,
  listHosts,
  openStoreReadOnly,
  stateDbPath,
} from '../core/store/db.ts';
import { readOpenSshKeyHeader } from '../doctor/signing-key.ts';

const MAX_PUBLIC_KEY_BYTES = 16 * 1024;
const PUBLIC_KEY_LINE_RE = /^ssh-ed25519 [A-Za-z0-9+/]+={0,2}(?: [^\r\n]*)?$/;

export interface TrustCommandOptions {
  /** True only when both stdin and stdout are terminals. */
  isTTY: boolean;
  /** Asks the owner a question at the terminal and returns the typed answer. */
  confirm: (question: string) => Promise<string>;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

const isYes = (answer: string) => answer.trim().toLowerCase() === 'y';

/**
 * Makes untrusted text (repository config values, file names) safe to print: control
 * characters are escaped, so a value cannot move the cursor or hide lines of the list the
 * owner is asked to accept.
 */
export function printable(text: string): string {
  let result = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const control =
      code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
    if (!control) {
      result += ch;
    } else if (ch === '\n') {
      result += '\\n';
    } else if (ch === '\t') {
      result += '\\t';
    } else {
      result += `\\u${code.toString(16).padStart(4, '0')}`;
    }
  }
  return result;
}

/** Prints the dedicated-key setup steps. Creates nothing. */
export function initKeyCommand(out: (line: string) => void = console.log): void {
  out('Create a dedicated approval key (you type the passphrase; Counterpoint never sees it):');
  out('');
  out('  ssh-keygen -t ed25519 -a 100 -f ~/.ssh/counterpoint_approval -C counterpoint-approval');
  out('');
  out('Choose a passphrase. Do not add this key to ssh-agent or your Keychain.');
  out('Then trust it for approvals:');
  out('');
  out('  counterpoint trust-key ~/.ssh/counterpoint_approval.pub');
}

/** Reads a small public key file without following a symlink. */
function readPublicKeyFile(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error('not a regular file');
    if (stat.size > MAX_PUBLIC_KEY_BYTES) throw new Error('too large');
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

/**
 * Pins the ed25519 key at `pubPath` for approvals. Requires exactly one ssh-ed25519 key in the
 * file, a passphrase-protected private key next to it, a terminal, and the owner's `y`.
 * Returns the exit code.
 */
export async function trustKeyCommand(
  home: string,
  pubPath: string,
  options: TrustCommandOptions,
): Promise<number> {
  const out = options.out ?? console.log;
  const err = options.err ?? console.error;
  const publicKeyPath = resolve(pubPath);

  if (!publicKeyPath.endsWith('.pub')) {
    err(`${printable(publicKeyPath)} is not a .pub file. Nothing saved.`);
    return 1;
  }
  let text: string;
  try {
    text = readPublicKeyFile(publicKeyPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const why =
      code === 'ELOOP' ? 'is a symlink' : code === 'ENOENT' ? 'does not exist' : 'cannot be read';
    err(`${printable(publicKeyPath)} ${why}. Nothing saved.`);
    return 1;
  }
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length !== 1 || !PUBLIC_KEY_LINE_RE.test(lines[0] as string)) {
    err('The public key file must hold exactly one ssh-ed25519 key. Nothing saved.');
    return 1;
  }

  const privateKeyPath = publicKeyPath.slice(0, -'.pub'.length);
  if (statSync(privateKeyPath, { throwIfNoEntry: false }) === undefined) {
    err(`The private key ${printable(privateKeyPath)} was not found next to it. Nothing saved.`);
    return 1;
  }
  try {
    const header = readOpenSshKeyHeader(privateKeyPath);
    if (header.cipher === 'none' || header.kdf !== 'bcrypt') {
      err(
        `The private key ${printable(privateKeyPath)} has no passphrase. Create a dedicated key with "counterpoint init-key". Nothing saved.`,
      );
      return 1;
    }
  } catch (error) {
    err(`Couldn't check the private key's passphrase: ${(error as Error).message} Nothing saved.`);
    return 1;
  }

  if (!options.isTTY) {
    err('counterpoint trust-key needs a terminal so you can confirm the key.');
    return 1;
  }

  const fingerprint = await fingerprintOf(publicKeyPath);
  out(`Key: ${printable(publicKeyPath)}`);
  out(`Fingerprint: ${fingerprint}`);
  const answer = await options.confirm('Trust this key for approvals? [y/N] ');
  if (!isYes(answer)) {
    out('Nothing saved.');
    return 1;
  }
  const trust = await writeTrust(home, { publicKeyPath });
  out(
    `Trusted approval key ${trust.fingerprint} (${printable(publicKeyPath)}). Approvals must be signed by this key.`,
  );
  return 0;
}

export type HostLookup = { ok: true; host: HostRow } | { ok: false; code: number; message: string };

/** Looks a registered host up read-only. The id is validated before it touches anything. */
export function lookupHost(home: string, hostId: string): HostLookup {
  try {
    assertHostId(hostId);
  } catch (error) {
    if (error instanceof InvalidIdError) return { ok: false, code: 2, message: error.message };
    throw error;
  }
  if (statSync(stateDbPath(home), { throwIfNoEntry: false }) === undefined) {
    return {
      ok: false,
      code: 2,
      message: 'No project registered yet. Run counterpoint inside it first.',
    };
  }
  const store = openStoreReadOnly(home);
  try {
    const host = getHost(store, hostId);
    if (host !== undefined) return { ok: true, host };
    const ids = listHosts(store).map((h) => h.id);
    return {
      ok: false,
      code: 2,
      message:
        ids.length === 0
          ? 'No project registered yet. Run counterpoint inside it first.'
          : `No project "${hostId}" is registered. Registered: ${ids.join(', ')}.`,
    };
  } finally {
    store.close();
  }
}

/** `sha256:…` → its first 12 hex; `symlink:{target}` → `symlink -> {target}`; others as is. */
function describeValue(value: string | null): string {
  if (value === null) return '(none)';
  if (value.startsWith('sha256:')) return value.slice('sha256:'.length, 'sha256:'.length + 12);
  if (value.startsWith('symlink:'))
    return `symlink -> ${printable(value.slice('symlink:'.length))}`;
  return printable(value);
}

export function describeChange(change: IntegrityChange): string {
  const value = (v: string | null) =>
    change.area === 'config' && v !== null ? printable(v) : describeValue(v);
  return `  ${change.area} ${printable(change.name)}: ${value(change.before)} -> ${value(change.after)}`;
}

/** The full execution-capable surface, grouped config / hooks / info / config.worktree. */
export function formatIntegritySnapshot(snapshot: IntegritySnapshot): string[] {
  const lines: string[] = ['config'];
  const keys = Object.keys(snapshot.config);
  if (keys.length === 0) lines.push('  (none)');
  for (const key of keys) {
    for (const value of snapshot.config[key] ?? []) {
      lines.push(`  ${printable(key)} = ${printable(value)}`);
    }
  }
  for (const area of ['hooks', 'info'] as const) {
    lines.push(area);
    const entries = Object.entries(snapshot[area]);
    if (entries.length === 0) lines.push('  (none)');
    for (const [name, value] of entries)
      lines.push(`  ${printable(name)}  ${describeValue(value)}`);
  }
  lines.push('config.worktree');
  lines.push(`  ${describeValue(snapshot.configWorktree)}`);
  return lines;
}

/**
 * Shows the host's execution-capable git surface (and what changed since any earlier baseline)
 * and saves it as the baseline only after the owner answers `y` at a terminal. Returns the exit
 * code.
 */
export async function trustHostCommand(
  home: string,
  hostId: string,
  options: TrustCommandOptions,
): Promise<number> {
  const out = options.out ?? console.log;
  const err = options.err ?? console.error;
  const found = lookupHost(home, hostId);
  if (!found.ok) {
    err(found.message);
    return found.code;
  }
  const { host } = found;
  const snapshot = await snapshotIntegrity(host.gitCommonDir);

  let baseline: IntegritySnapshot | null = null;
  try {
    baseline = readBaseline(home, host.id);
  } catch (error) {
    out(
      `The current baseline can't be used (${(error as Error).message}). Review the full list below.`,
    );
  }
  if (baseline !== null) {
    const compared = compareIntegrity(baseline, snapshot);
    if (compared.ok) {
      out('No changes since the last baseline.');
    } else {
      out('Changed since the last baseline:');
      for (const change of compared.changes) out(describeChange(change));
    }
    out('');
  }
  out(`Execution-capable git surface of ${host.id} (${printable(host.gitCommonDir)}):`);
  for (const line of formatIntegritySnapshot(snapshot)) out(line);
  out('');

  if (!options.isTTY) {
    err('counterpoint trust needs a terminal so you can review this list.');
    return 1;
  }
  const answer = await options.confirm(`Accept this as the baseline for ${host.id}? [y/N] `);
  if (!isYes(answer)) {
    out('Nothing saved.');
    return 1;
  }
  writeBaseline(home, host.id, snapshot);
  out(`Baseline saved for ${host.id}.`);
  return 0;
}

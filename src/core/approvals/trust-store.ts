// The owner's trusted signing key (key-trust: Key pinned only after terminal confirmation), kept
// under COUNTERPOINT_HOME/trust/ — outside every repository and denied to agent sessions
// (agent-sandbox: Protected paths are unreadable).
//
//   trust/allowed_signers   one line: owner@counterpoint namespaces="git" ssh-ed25519 AAAA…
//   trust/key.json          { publicKeyPath, privateKeyPath, fingerprint }  (the pinned fingerprint)
//
// Both files are written 0600 in a 0700 directory and read with O_NOFOLLOW. A file that is a
// symlink, not a regular file, or writable by group/other is refused, as is an allowed-signers
// file with more than one key, any principal other than owner@counterpoint (wildcards included),
// or a key whose fingerprint differs from the pinned one.
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { writeFileAtomic0600 } from '../fs/atomic.ts';
import { homePaths } from '../host/home.ts';
import { fingerprintOfKeyBlob, fingerprintOfKeyText } from './ssh.ts';

export const OWNER_PRINCIPAL = 'owner@counterpoint';

const MAX_TRUST_FILE_BYTES = 64 * 1024;
const FINGERPRINT_RE = /^SHA256:[A-Za-z0-9+/]{43}$/;
const PUBLIC_KEY_RE = /^ssh-ed25519 ([A-Za-z0-9+/]+={0,2})(?: [^\r\n]*)?$/;
const ALLOWED_LINE_RE = /^owner@counterpoint namespaces="git" ssh-ed25519 ([A-Za-z0-9+/]+={0,2})$/;

export interface Trust {
  allowedSignersPath: string;
  fingerprint: string;
  principal: string;
  privateKeyPath: string;
  publicKeyPath: string;
}

export type TrustFailure = {
  ok: false;
  error: 'no-trusted-key' | 'bad-allowed-signers' | 'fingerprint-mismatch';
  detail: string;
};

export type TrustResult = ({ ok: true } & Trust) | TrustFailure;

export type AllowedSignersProblem =
  | 'missing'
  | 'unsafe-file'
  | 'empty'
  | 'multiple-keys'
  | 'principal'
  | 'format'
  | 'fingerprint-mismatch';

const KeyJsonSchema = z.object({
  publicKeyPath: z.string().min(1),
  privateKeyPath: z.string().min(1),
  fingerprint: z.string().regex(FINGERPRINT_RE),
});

class UnsafeFileError extends Error {
  readonly missing: boolean;

  constructor(message: string, missing = false) {
    super(message);
    this.name = 'UnsafeFileError';
    this.missing = missing;
  }
}

/** Reads a small file without following a symlink; refuses non-regular or group/world-writable files. */
function readSafeFile(path: string): string {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new UnsafeFileError(`${path} does not exist.`, true);
    if (code === 'ELOOP') throw new UnsafeFileError(`${path} is a symlink.`);
    throw new UnsafeFileError(`${path} cannot be opened (${code ?? 'error'}).`);
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new UnsafeFileError(`${path} is not a regular file.`);
    if ((stat.mode & 0o022) !== 0)
      throw new UnsafeFileError(`${path} is writable by group or others.`);
    if (stat.size > MAX_TRUST_FILE_BYTES) throw new UnsafeFileError(`${path} is too large.`);
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

/** The key blob of an ed25519 public key, or null when the bytes are not one. */
function ed25519Blob(base64: string): string | null {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.toString('base64') !== base64) return null;
  const type = 'ssh-ed25519';
  if (bytes.length !== 4 + type.length + 4 + 32) return null;
  if (bytes.readUInt32BE(0) !== type.length) return null;
  if (bytes.subarray(4, 4 + type.length).toString('latin1') !== type) return null;
  if (bytes.readUInt32BE(4 + type.length) !== 32) return null;
  return base64;
}

/**
 * Checks an allowed-signers file the verifier is about to use: one line, principal exactly
 * owner@counterpoint, namespaces="git", one ed25519 key whose fingerprint equals the pin.
 */
export function checkAllowedSignersFile(
  path: string,
  pinnedFingerprint: string,
): { ok: true } | { ok: false; problem: AllowedSignersProblem; detail: string } {
  let text: string;
  try {
    text = readSafeFile(path);
  } catch (error) {
    const unsafe = error as UnsafeFileError;
    return {
      ok: false,
      problem: unsafe.missing ? 'missing' : 'unsafe-file',
      detail: unsafe.message,
    };
  }
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  if (lines.length === 0) return { ok: false, problem: 'empty', detail: 'No key is listed.' };
  if (lines.length > 1) {
    return { ok: false, problem: 'multiple-keys', detail: 'More than one key is listed.' };
  }
  const line = lines[0] as string;
  const principal = line.split(/\s+/)[0];
  if (principal !== OWNER_PRINCIPAL) {
    return { ok: false, problem: 'principal', detail: `The principal must be ${OWNER_PRINCIPAL}.` };
  }
  const match = ALLOWED_LINE_RE.exec(line);
  const blob = match ? ed25519Blob(match[1] as string) : null;
  if (blob === null) {
    return {
      ok: false,
      problem: 'format',
      detail: `Expected: ${OWNER_PRINCIPAL} namespaces="git" ssh-ed25519 <key>.`,
    };
  }
  if (fingerprintOfKeyBlob(blob) !== pinnedFingerprint) {
    return {
      ok: false,
      problem: 'fingerprint-mismatch',
      detail: 'The allowed key does not match the pinned fingerprint.',
    };
  }
  return { ok: true };
}

function trustFiles(home: string) {
  const dir = homePaths(home).trustDir;
  return { dir, allowedSigners: join(dir, 'allowed_signers'), keyJson: join(dir, 'key.json') };
}

/**
 * Trusts the ed25519 public key at `publicKeyPath`: writes allowed_signers and pins its
 * fingerprint. The private key must sit next to it (same path without `.pub`).
 */
const MAX_PUBLIC_KEY_BYTES = 16 * 1024;

/** A public key file as read once, without following a symlink. */
export interface PublicKeyFile {
  /** The single key line, trimmed. */
  line: string;
  /** The ed25519 key blob (base64). */
  blob: string;
  /** SHA256 fingerprint of the blob. */
  fingerprint: string;
}

/** The public key file changed between the owner's confirmation and the write. */
export class TrustKeyChangedError extends Error {
  constructor() {
    super('The public key file changed after you confirmed it. Nothing saved.');
    this.name = 'TrustKeyChangedError';
  }
}

/**
 * Reads a public key file without following a symlink (`O_NOFOLLOW`; a symlink fails with
 * `ELOOP`): a regular file of at most 16 KiB holding exactly one ssh-ed25519 key line. Throws an
 * error carrying the open error's `code` when it cannot be opened.
 */
export function readPublicKey(path: string): PublicKeyFile {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let text: string;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error('The public key file is not a regular file.');
    if (stat.size > MAX_PUBLIC_KEY_BYTES) throw new Error('The public key file is too large.');
    text = readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length !== 1) throw new Error('The public key file must hold exactly one key.');
  const line = lines[0] as string;
  const match = PUBLIC_KEY_RE.exec(line);
  const blob = match ? ed25519Blob(match[1] as string) : null;
  if (blob === null) throw new Error('The public key must be a single ssh-ed25519 key.');
  return { line, blob, fingerprint: fingerprintOfKeyBlob(blob) };
}

/**
 * Pins exactly the key the owner confirmed (key-trust: Trust-key pins exactly the confirmed key).
 * `confirmed` is the key as read for the confirmation prompt; the file is read again here, without
 * following a symlink, and a different key (or a file that became a symlink) refuses with nothing
 * written. The pinned bytes are the confirmed ones, cross-checked by ssh-keygen over stdin.
 */
export async function writeTrust(
  home: string,
  options: { publicKeyPath: string; confirmed: PublicKeyFile },
): Promise<Trust> {
  const { publicKeyPath, confirmed } = options;
  if (!publicKeyPath.endsWith('.pub')) throw new Error('The public key file must end in .pub.');
  let now: PublicKeyFile;
  try {
    now = readPublicKey(publicKeyPath);
  } catch {
    throw new TrustKeyChangedError();
  }
  if (now.blob !== confirmed.blob || now.fingerprint !== confirmed.fingerprint) {
    throw new TrustKeyChangedError();
  }
  const blob = confirmed.blob;
  const privateKeyPath = publicKeyPath.slice(0, -4);
  if (!statSync(privateKeyPath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error('The matching private key was not found next to the public key.');
  }
  const fingerprint = await fingerprintOfKeyText(`ssh-ed25519 ${blob}`);
  if (fingerprint !== confirmed.fingerprint) {
    throw new Error('ssh-keygen reported a different fingerprint for the public key.');
  }

  const files = trustFiles(home);
  mkdirSync(files.dir, { recursive: true, mode: 0o700 });
  chmodSync(files.dir, 0o700);
  writeFileAtomic0600(
    files.allowedSigners,
    `${OWNER_PRINCIPAL} namespaces="git" ssh-ed25519 ${blob}\n`,
  );
  writeFileAtomic0600(
    files.keyJson,
    `${JSON.stringify({ publicKeyPath, privateKeyPath, fingerprint }, null, 2)}\n`,
  );
  return {
    allowedSignersPath: files.allowedSigners,
    fingerprint,
    principal: OWNER_PRINCIPAL,
    privateKeyPath,
    publicKeyPath,
  };
}

/** Reads and checks the trusted key. Never throws for a missing or bad trust store. */
export function readTrust(home: string): TrustResult {
  const files = trustFiles(home);
  const dirStat = lstatSync(files.dir, { throwIfNoEntry: false });
  if (dirStat === undefined) {
    return { ok: false, error: 'no-trusted-key', detail: 'No signing key is trusted yet.' };
  }
  if (!dirStat.isDirectory() || (dirStat.mode & 0o022) !== 0) {
    return {
      ok: false,
      error: 'bad-allowed-signers',
      detail: `${files.dir} must be a directory writable only by its owner.`,
    };
  }

  let keyJson: z.infer<typeof KeyJsonSchema>;
  try {
    keyJson = KeyJsonSchema.parse(JSON.parse(readSafeFile(files.keyJson)));
  } catch (error) {
    if (error instanceof UnsafeFileError && error.missing) {
      return { ok: false, error: 'no-trusted-key', detail: 'No signing key is trusted yet.' };
    }
    return { ok: false, error: 'bad-allowed-signers', detail: `${files.keyJson} is not valid.` };
  }

  const checked = checkAllowedSignersFile(files.allowedSigners, keyJson.fingerprint);
  if (!checked.ok) {
    if (checked.problem === 'missing') {
      return { ok: false, error: 'no-trusted-key', detail: checked.detail };
    }
    return {
      ok: false,
      error:
        checked.problem === 'fingerprint-mismatch' ? 'fingerprint-mismatch' : 'bad-allowed-signers',
      detail: checked.detail,
    };
  }
  return {
    ok: true,
    allowedSignersPath: files.allowedSigners,
    fingerprint: keyJson.fingerprint,
    principal: OWNER_PRINCIPAL,
    privateKeyPath: keyJson.privateKeyPath,
    publicKeyPath: keyJson.publicKeyPath,
  };
}

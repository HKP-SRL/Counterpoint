// ssh-keygen signing and verification for approvals (APPR-01, APPR-04).
//
// ssh-keygen is called by absolute path, never resolved from PATH and never through git's
// `gpg.ssh.program` (repository config must not choose the program that signs or verifies).
// Its environment holds only PATH=/usr/bin:/bin, HOME and LANG. The agent socket, askpass
// helpers and DISPLAY are deliberately left out, so neither ssh-agent nor an askpass program
// can supply or cache the key: a protected key's passphrase is typed by the owner at the
// terminal prompt ssh-keygen opens itself (/dev/tty). Nothing here accepts or stores a
// passphrase. Authorization never uses ssh-keygen's no-validate check mode, which ignores the
// allowed-signers file.
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';

export const SSH_KEYGEN = '/usr/bin/ssh-keygen';

const SIGN_TIMEOUT_MS = 10 * 60_000;
const VERIFY_TIMEOUT_MS = 15_000;

/** The only environment ssh-keygen ever gets: fixed PATH plus HOME and LANG from the parent. */
export function sshKeygenEnv(parent: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = { PATH: '/usr/bin:/bin' };
  if (parent.HOME !== undefined) env.HOME = parent.HOME;
  if (parent.LANG !== undefined) env.LANG = parent.LANG;
  return env;
}

/**
 * Signs `payload` with `ssh-keygen -Y sign -n git` and returns the armored signature. A protected
 * key prompts on the owner's terminal; without a terminal the call fails.
 */
export async function signPayload(options: {
  payload: Uint8Array;
  privateKeyPath: string;
  timeoutMs?: number;
}): Promise<string> {
  const result = await execa(
    SSH_KEYGEN,
    ['-Y', 'sign', '-n', 'git', '-f', options.privateKeyPath],
    {
      env: sshKeygenEnv(),
      extendEnv: false,
      input: options.payload,
      reject: false,
      stripFinalNewline: false,
      timeout: options.timeoutMs ?? SIGN_TIMEOUT_MS,
    },
  );
  if (result.timedOut) throw new Error('ssh-keygen signing timed out.');
  if (result.exitCode !== 0) {
    const last = result.stderr.trim().split('\n').at(-1) ?? '';
    throw new Error(`ssh-keygen could not sign (exit ${result.exitCode ?? 'none'}): ${last}`);
  }
  const signature = result.stdout;
  if (!/^-----BEGIN SSH SIGNATURE-----\n[\s\S]+\n-----END SSH SIGNATURE-----\n$/.test(signature)) {
    throw new Error('ssh-keygen returned an unexpected signature.');
  }
  return signature;
}

export interface SignatureCheck {
  /** True only when ssh-keygen exited 0 and printed the signer's fingerprint. */
  ok: boolean;
  fingerprint: string | null;
  /** ssh-keygen's own diagnostics (stdout and stderr), for reasons and logs only. */
  message: string;
}

const GOOD_RE = /^Good "([^"]+)" signature for (\S+) with (\S+) key (SHA256:[A-Za-z0-9+/]+)$/m;

/**
 * Verifies `signature` over `payload` with `ssh-keygen -Y verify` against `allowedSignersPath`
 * for exactly `principal` and `namespace`.
 */
export async function verifySignature(options: {
  allowedSignersPath: string;
  principal: string;
  namespace: string;
  signature: string;
  payload: Uint8Array;
  tmpDir: string;
}): Promise<SignatureCheck> {
  const dir = mkdtempSync(join(options.tmpDir, 'sig-'));
  const sigFile = join(dir, `${randomBytes(8).toString('hex')}.sig`);
  try {
    writeFileSync(sigFile, options.signature, { mode: 0o600, flag: 'wx' });
    const result = await execa(
      SSH_KEYGEN,
      [
        '-Y',
        'verify',
        '-f',
        options.allowedSignersPath,
        '-I',
        options.principal,
        '-n',
        options.namespace,
        '-s',
        sigFile,
      ],
      {
        env: sshKeygenEnv(),
        extendEnv: false,
        input: options.payload,
        reject: false,
        timeout: VERIFY_TIMEOUT_MS,
      },
    );
    const message = `${result.stdout}\n${result.stderr}`.trim();
    const good = GOOD_RE.exec(message);
    const matches = good !== null && good[1] === options.namespace && good[2] === options.principal;
    const ok = result.exitCode === 0 && !result.timedOut && matches;
    return { ok, fingerprint: ok && good ? (good[4] as string) : null, message };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The SHA256 fingerprint of a public key file (`ssh-keygen -l -E sha256`). */
export async function fingerprintOf(pubPath: string): Promise<string> {
  const result = await execa(SSH_KEYGEN, ['-l', '-E', 'sha256', '-f', pubPath], {
    env: sshKeygenEnv(),
    extendEnv: false,
    stdin: 'ignore',
    timeout: VERIFY_TIMEOUT_MS,
  });
  const match = /^\d+ (SHA256:[A-Za-z0-9+/]+) /.exec(result.stdout);
  if (!match) throw new Error('ssh-keygen printed no fingerprint.');
  return match[1] as string;
}

/** The SHA256 fingerprint of a base64 public key blob, computed exactly as ssh-keygen does. */
export function fingerprintOfKeyBlob(base64: string): string {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('Not a base64 key blob.');
  const digest = createHash('sha256').update(Buffer.from(base64, 'base64')).digest('base64');
  return `SHA256:${digest.replace(/=+$/, '')}`;
}

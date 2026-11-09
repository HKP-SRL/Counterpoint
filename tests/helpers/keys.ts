// Throwaway ed25519 keys and allowed-signers files for approval tests.
//
// Keys are generated in scratch directories only. Nothing here reads, writes or lists ~/.ssh,
// and nothing talks to ssh-agent or the Keychain (the environment passed to ssh-keygen has no
// agent socket and no askpass helper).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';

const SSH_KEYGEN = '/usr/bin/ssh-keygen';

function keygenEnv(): Record<string, string> {
  return { PATH: '/usr/bin:/bin', HOME: process.env.HOME ?? '/', LANG: 'C' };
}

export interface ThrowawayKey {
  privateKeyPath: string;
  publicKeyPath: string;
}

/** Generates an ed25519 key pair at `{dir}/{name}` (default `key`); unprotected unless a passphrase is given. */
export async function makeThrowawayKey(
  dir: string,
  options: { passphrase?: string; name?: string } = {},
): Promise<ThrowawayKey> {
  const privateKeyPath = join(dir, options.name ?? 'key');
  await execa(
    SSH_KEYGEN,
    ['-q', '-t', 'ed25519', '-N', options.passphrase ?? '', '-C', 'test', '-f', privateKeyPath],
    { env: keygenEnv(), extendEnv: false, stdin: 'ignore' },
  );
  return { privateKeyPath, publicKeyPath: `${privateKeyPath}.pub` };
}

/** The `ssh-ed25519 AAAA…` part of a public key file (comment dropped). */
export function publicKeyText(pubPath: string): string {
  const [type, blob] = readFileSync(pubPath, 'utf8').trim().split(/\s+/);
  return `${type} ${blob}`;
}

/** Writes `{dir}/allowed_signers` with one line for `pubPath` (mode 0600) and returns its path. */
export function writeAllowedSigners(
  dir: string,
  pubPath: string,
  principal = 'owner@counterpoint',
  fileName = 'allowed_signers',
): string {
  const file = join(dir, fileName);
  writeFileSync(file, `${principal} namespaces="git" ${publicKeyText(pubPath)}\n`, { mode: 0o600 });
  return file;
}

/** Signs `payload` with an arbitrary namespace (used to forge wrong-namespace signatures). */
export async function signWithNamespace(
  payload: Uint8Array,
  privateKeyPath: string,
  namespace: string,
): Promise<string> {
  const result = await execa(SSH_KEYGEN, ['-Y', 'sign', '-n', namespace, '-f', privateKeyPath], {
    env: keygenEnv(),
    extendEnv: false,
    input: payload,
  });
  return `${result.stdout}\n`;
}

// Digest strings used across approvals: `sha256:` plus 64 lowercase hex characters.
import { createHash } from 'node:crypto';

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

/** `sha256:` + the lowercase hex SHA-256 of `bytes` (strings are hashed as UTF-8). */
export function sha256Digest(bytes: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/** The first 12 hex characters of a digest, as shown in the UI. */
export function shortDigest(digest: string): string {
  if (!DIGEST_RE.test(digest)) throw new Error('Not a sha256 digest.');
  return digest.slice(7, 19);
}

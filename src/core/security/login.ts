// One-time sign-in codes and console sessions.
//
// A code is minted only over the token-protected control socket and printed to the owner's
// terminal. The browser exchanges it once at GET /login for an HttpOnly session cookie. Only the
// SHA-256 of a code or session id is stored; the values themselves are never stored or logged.
import { createHash, randomBytes } from 'node:crypto';
import type { Store } from '../store/db.ts';

export const SESSION_COOKIE = 'cp_session';

/** How long a minted sign-in code stays usable. */
export const LOGIN_CODE_TTL_MS = 5 * 60 * 1000;

/** How long a console session lasts (A11). The cookie's Max-Age (43200 s) matches it. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** 32 random bytes as unpadded base64url. */
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isSecret(value: unknown): value is string {
  return typeof value === 'string' && SECRET_RE.test(value);
}

/** Mints a single-use sign-in code valid for 5 minutes and returns it. */
export function mintLoginCode(db: Store, now: number = Date.now()): string {
  const code = newSecret();
  db.prepare('INSERT INTO login_codes (code_hash, expires_at, used_at) VALUES (?, ?, NULL)').run(
    hash(code),
    now + LOGIN_CODE_TTL_MS,
  );
  return code;
}

/**
 * Marks a code used. True only for a known, unused, unexpired code. One conditional UPDATE, so
 * two concurrent consumers of the same code can never both succeed.
 */
export function consumeLoginCode(db: Store, code: unknown, now: number = Date.now()): boolean {
  if (!isSecret(code)) return false;
  const result = db
    .prepare(
      'UPDATE login_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?',
    )
    .run(now, hash(code), now);
  return Number(result.changes) === 1;
}

/** Drops used and expired sign-in codes. */
export function deleteStaleLoginCodes(db: Store, now: number = Date.now()): void {
  db.prepare('DELETE FROM login_codes WHERE used_at IS NOT NULL OR expires_at <= ?').run(now);
}

/** Creates a 12-hour session and returns its id (the cookie value). */
export function createSession(db: Store, now: number = Date.now()): string {
  const id = newSecret();
  db.prepare('INSERT INTO sessions (id_hash, created_at, expires_at) VALUES (?, ?, ?)').run(
    hash(id),
    now,
    now + SESSION_TTL_MS,
  );
  return id;
}

/** True when the value is the id of a session that has not expired. */
export function validateSession(db: Store, value: unknown, now: number = Date.now()): boolean {
  if (!isSecret(value)) return false;
  const row = db
    .prepare('SELECT 1 AS ok FROM sessions WHERE id_hash = ? AND expires_at > ?')
    .get(hash(value), now);
  return row !== undefined;
}

/** Signs every browser out. Called on every daemon start. */
export function clearAllSessions(db: Store): void {
  db.prepare('DELETE FROM sessions').run();
}

// One-time sign-in codes and console sessions (D-07). Not implemented yet.
import type { Store } from '../store/db.ts';

export const SESSION_COOKIE = 'cp_session';

export function mintLoginCode(_db: Store, _now: number = Date.now()): string {
  throw new Error('not implemented');
}

export function consumeLoginCode(_db: Store, _code: unknown, _now: number = Date.now()): boolean {
  throw new Error('not implemented');
}

export function createSession(_db: Store, _now: number = Date.now()): string {
  throw new Error('not implemented');
}

export function validateSession(_db: Store, _value: unknown, _now: number = Date.now()): boolean {
  throw new Error('not implemented');
}

export function clearAllSessions(_db: Store): void {
  throw new Error('not implemented');
}

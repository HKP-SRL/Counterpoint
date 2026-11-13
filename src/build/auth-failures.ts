// Sign-in failures and other session errors that may pass (build-runs: Usage limits pause every
// lane; Scenarios: Expired login, Sign-in fails during an outage).
//
// A session that fails to sign in is not always signed out. Seen live (run 20261113-0940, session
// 13): three 503 retries, then `authentication_failed` with a Cloudflare page for a body; the
// owner was signed in and the next run worked. So before a run says "not signed in":
// - it asks claude whether it holds a login (`claude auth status`, a local check). No login: the
//   run stops now and Needs You says to sign in;
// - otherwise the session is tried again after a backoff (1, 2, 4 minutes), up to AUTH_RETRIES
//   times. When it still fails, the run stops with a resume card that says it may be an outage,
//   unless nothing pointed at one (claude could not tell and the failure looked like any other).
import type { AgentRunner } from '../agent/runner.ts';
import { transientBackoffMs } from './governor.ts';

/** Tries again after a sign-in failure before the run stops. */
export const AUTH_RETRIES = 3;
/** Tries again after a transient error of a calibration session before the run stops. */
export const CALIBRATION_RETRIES = 3;
/** Tries of `claude --version` before the run stops, and the waits between them. */
export const VERSION_TRIES = 3;
export const VERSION_RETRY_MS = 10_000;

/** How a stop for a sign-in claude does not hold starts (run-cards.ts reads it). */
export function notSignedInMessage(detail: string): string {
  return `claude is not signed in (authentication failed). Sign in to claude, then start a new run. (${detail})`;
}

/** How a stop for a sign-in that kept failing while claude holds a login starts. */
export const OUTAGE_PREFIX = 'Sign-in failed, maybe an outage.';

export function maybeOutageMessage(detail: string, failures: number, signedIn: boolean): string {
  const login = signedIn ? ', though claude holds a login' : '';
  return `${OUTAGE_PREFIX} It failed ${failures} times in a row${login}. Resume the run once the service is back. (${detail})`;
}

export type AuthStep = { kind: 'retry'; waitMs: number } | { kind: 'stop'; message: string };

/**
 * What to do after the `failures`-th sign-in failure in a row (1 for the first): try again after
 * a backoff, or stop the run with the message Needs You shows.
 */
export async function afterAuthFailure(input: {
  runner: AgentRunner;
  detail: string;
  outage: boolean;
  failures: number;
}): Promise<AuthStep> {
  let signedIn: boolean | null = null;
  try {
    signedIn = (await input.runner.signedIn?.()) ?? null;
  } catch {
    signedIn = null;
  }
  if (signedIn === false) return { kind: 'stop', message: notSignedInMessage(input.detail) };
  if (input.failures <= AUTH_RETRIES) {
    return { kind: 'retry', waitMs: transientBackoffMs(input.failures) };
  }
  return {
    kind: 'stop',
    message:
      signedIn === true || input.outage
        ? maybeOutageMessage(input.detail, input.failures, signedIn === true)
        : notSignedInMessage(input.detail),
  };
}

/** The run's stop message for an account stop (a sign-in is judged by afterAuthFailure first). */
export function accountStopMessage(
  cause: 'auth' | 'credit' | 'spend-limit',
  detail: string,
): string {
  if (cause === 'auth') return notSignedInMessage(detail);
  return cause === 'credit'
    ? `Usage credits are needed. Add credit, then start a new run. (${detail})`
    : `A spend limit was reached. Raise it, then start a new run. (${detail})`;
}

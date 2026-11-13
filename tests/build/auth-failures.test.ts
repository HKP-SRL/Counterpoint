// What a sign-in failure leads to (build-runs: Usage limits pause every lane): claude's own login
// decides between "not signed in" and "try again", and a sign-in that keeps failing while claude
// holds a login stops the run as a possible outage.
import { describe, expect, it } from 'vitest';
import type { AgentRunner } from '../../src/agent/runner.ts';
import { AUTH_RETRIES, afterAuthFailure, OUTAGE_PREFIX } from '../../src/build/auth-failures.ts';
import { stopCause } from '../../src/build/run-cards.ts';

function runner(signedIn?: boolean | null | 'throws'): AgentRunner {
  const base: AgentRunner = {
    run: async () => {
      throw new Error('no runs');
    },
  };
  if (signedIn === undefined) return base;
  return {
    ...base,
    signedIn: async () => {
      if (signedIn === 'throws') throw new Error('boom');
      return signedIn;
    },
  };
}

const failure = (r: AgentRunner, failures: number, outage = false) =>
  afterAuthFailure({ runner: r, detail: 'Failed to authenticate.', outage, failures });

describe('afterAuthFailure', () => {
  it('stops at once when claude holds no login', async () => {
    const step = await failure(runner(false), 1, true);
    expect(step).toMatchObject({ kind: 'stop', message: expect.stringMatching(/not signed in/) });
    if (step.kind === 'stop') expect(stopCause(step.message).kind).toBe('not-logged-in');
  });

  it('tries again after 1, 2 and 4 minutes while claude holds a login, then stops as an outage', async () => {
    const steps = [];
    for (let n = 1; n <= AUTH_RETRIES + 1; n += 1) steps.push(await failure(runner(true), n));
    expect(steps.slice(0, AUTH_RETRIES)).toEqual([
      { kind: 'retry', waitMs: 60_000 },
      { kind: 'retry', waitMs: 120_000 },
      { kind: 'retry', waitMs: 240_000 },
    ]);
    const last = steps[AUTH_RETRIES];
    expect(last).toMatchObject({
      kind: 'stop',
      message: expect.stringContaining('It failed 4 times in a row, though claude holds a login.'),
    });
    if (last?.kind === 'stop') {
      expect(last.message.startsWith(OUTAGE_PREFIX)).toBe(true);
      expect(stopCause(last.message).kind).toBe('sign-in-outage');
    }
  });

  it('uses the retry rule alone when claude cannot tell, and names an outage only on its signs', async () => {
    for (const r of [runner(), runner(null), runner('throws')]) {
      expect(await failure(r, 1)).toEqual({ kind: 'retry', waitMs: 60_000 });
      const plain = await failure(r, AUTH_RETRIES + 1);
      expect(plain).toMatchObject({
        kind: 'stop',
        message: expect.stringMatching(/not signed in/),
      });
      const outage = await failure(r, AUTH_RETRIES + 1, true);
      expect(outage).toMatchObject({
        kind: 'stop',
        message: expect.stringMatching(/^Sign-in failed, maybe an outage\. It failed 4 times/),
      });
    }
  });
});

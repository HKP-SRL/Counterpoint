// Where a change stands, as the console says it (runway: Where each runway change stands;
// host-planning: Change detail): the stage parsed from the API, its badge and its banner, and why
// a Built change is built.
import { describe, expect, it } from 'vitest';
import { builtText, canRetry, parseStage, stageBanner, stageLook } from '../src/stage';

describe('stages', () => {
  it('parses each stage and drops anything that does not fit', () => {
    expect(parseStage({ kind: 'building' })).toEqual({ kind: 'building' });
    expect(parseStage({ kind: 'held', why: 'replan', reason: 'Gate failed.' })).toEqual({
      kind: 'held',
      why: 'replan',
      reason: 'Gate failed.',
    });
    expect(parseStage({ kind: 'pr-open', prUrl: 'https://github.com/x/y/pull/1' })).toMatchObject({
      kind: 'pr-open',
    });
    expect(parseStage({ kind: 'pr-open', prUrl: 'javascript:alert(1)' })).toBeNull();
    expect(parseStage({ kind: 'waits', on: ['a-thing', '../x'] })).toEqual({
      kind: 'waits',
      on: ['a-thing'],
    });
    expect(parseStage({ kind: 'held', why: 'other' })).toBeNull();
    expect(parseStage(null)).toBeNull();
  });

  it('labels each stage, in color only when it needs the owner or builds', () => {
    expect(stageLook({ kind: 'building' })).toEqual({ label: 'Building', variant: 'purple' });
    expect(stageLook({ kind: 'parked', reason: null })).toEqual({
      label: 'Parked',
      variant: 'warning',
    });
    expect(stageLook({ kind: 'pr-open', prUrl: 'https://x' }).label).toBe('PR open');
    expect(stageLook({ kind: 'waits', on: ['a-thing'] })).toEqual({
      label: 'Waits on a-thing',
      variant: 'neutral',
    });
  });

  it('offers Retry only on a parked or held change, and says what holds it', () => {
    expect(canRetry({ kind: 'parked', reason: null })).toBe(true);
    expect(canRetry({ kind: 'held', why: 'left-parked', reason: null })).toBe(true);
    expect(canRetry({ kind: 'held', why: 'question', reason: null })).toBe(false);
    expect(canRetry({ kind: 'pr-open', prUrl: 'https://x' })).toBe(false);
    expect(canRetry(null)).toBe(false);
    expect(stageBanner('b-thing', { kind: 'waits', on: ['a-thing'] }).description).toContain(
      'You can approve it now.',
    );
    expect(
      stageBanner('a-thing', { kind: 'held', why: 'left-parked', reason: null }).description,
    ).toBe('You left it parked. No run builds it until you click Retry.');
  });
});

describe('why a change is Built', () => {
  it('says its PR merged, and that owner steps are still open, instead of every task checked', () => {
    expect(builtText('a-thing', 'merged', 2)).toBe(
      'Its build PR merged, so there is nothing left to build. Approval is not offered. 2 owner steps are still open below.',
    );
    expect(builtText('a-thing', 'tasks', 0)).toBe(
      'Every task in a-thing is checked, so there is nothing left to run. Approval is not offered.',
    );
    expect(builtText('a-thing', 'archived', 1)).toMatch(/is archived/);
  });
});

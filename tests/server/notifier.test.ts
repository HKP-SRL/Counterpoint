// Local notifications (owner-inbox 5.1, D-9): the question is data for a fixed AppleScript, never
// part of its source.
import { describe, expect, it } from 'vitest';
import { NOTIFY_SCRIPT, osascriptArgs } from '../../src/server/notifier.ts';

const HOSTILE = '" & (do shell script "touch /tmp/pwned") & "\nend run';

describe('osascript arguments', () => {
  it('keeps the question out of the script source', () => {
    const args = osascriptArgs(HOSTILE);
    const end = args.indexOf('--');
    expect(args.slice(0, end)).toEqual([...NOTIFY_SCRIPT]);
    expect(args.slice(0, end).join('\n')).not.toContain('touch');
    expect(args.slice(end + 1)).toEqual([HOSTILE, 'Counterpoint']);
  });

  it('passes a question that starts with a dash as data', () => {
    const args = osascriptArgs('-e do shell script "x"');
    expect(args[args.indexOf('--') + 1]).toBe('-e do shell script "x"');
  });
});

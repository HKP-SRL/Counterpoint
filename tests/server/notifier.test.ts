// Local notifications (owner-inbox 5.1, D-9): the question is data for a fixed AppleScript, never
// part of its source. needs-you: Notified when a card blocks work: the card desk tells the notifier
// of each new card that blocks work, and the notifier shows at most one notification a minute.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { getCard } from '../../src/core/store/cards.ts';
import { openStore } from '../../src/core/store/db.ts';
import { EventBus } from '../../src/core/store/events.ts';
import { CardDesk } from '../../src/server/cards.ts';
import {
  NOTIFY_INTERVAL_MS,
  NOTIFY_SCRIPT,
  Notifier,
  osascriptArgs,
} from '../../src/server/notifier.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

afterAll(() => removeScratchDirs());

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

describe('a card that blocks work', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A card desk wired to a notifier as the daemon wires it, with the notifications recorded. */
  function setup() {
    vi.useFakeTimers();
    const store = openStore(makeScratchDir('notify-home'));
    const sent: string[] = [];
    const notifier = new Notifier({
      send: async (message) => {
        sent.push(message);
      },
      stillWaiting: (cardId) => {
        const state = getCard(store, cardId)?.state;
        return state === 'open' || state === 'deferred';
      },
    });
    const desk = new CardDesk({
      store,
      bus: new EventBus(),
      notify: (card) => notifier.notify(card),
    });
    const raise = (key: string, question: string, blocking = true) =>
      desk.raise({
        hostId: null,
        key,
        kind: 'notice',
        source: 'machine',
        question,
        why: 'The run waits on this.',
        options: [
          { label: 'Go on', consequence: 'The run goes on.' },
          { label: 'Stop', consequence: 'The run stops.' },
        ],
        recommended: 0,
        reversible: true,
        blocking,
      });
    return { desk, notifier, sent, raise };
  }

  it('notifies once with the question, also when the same card is raised again', () => {
    const { notifier, sent, raise } = setup();
    raise('parked:kitchen', 'Kitchen display parked. Retry it?');
    raise('parked:kitchen', 'Kitchen display parked. Retry it?');
    expect(sent).toEqual(['Kitchen display parked. Retry it?']);
    vi.advanceTimersByTime(NOTIFY_INTERVAL_MS * 2);
    expect(sent).toHaveLength(1);
    notifier.stop();
  });

  it('does not notify for a card that does not block work', () => {
    const { notifier, sent, raise } = setup();
    raise('notice:fyi', 'Your login shell took long to read.', false);
    vi.advanceTimersByTime(NOTIFY_INTERVAL_MS * 2);
    expect(sent).toEqual([]);
    notifier.stop();
  });

  it('merges the cards that arrive within the minute into one notification', () => {
    const { notifier, sent, raise } = setup();
    raise('q:1', 'First question?');
    vi.advanceTimersByTime(10_000);
    raise('q:2', 'Second question?');
    raise('q:3', 'Third question?');
    expect(sent).toEqual(['First question?']);
    vi.advanceTimersByTime(NOTIFY_INTERVAL_MS - 10_000 - 1);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual(['First question?', '2 questions need you']);
    notifier.stop();
  });

  it('leaves out a card the owner answered before the minute was up', async () => {
    const { desk, notifier, sent, raise } = setup();
    raise('q:1', 'First question?');
    const second = raise('q:2', 'Second question?');
    raise('q:3', 'Third question?');
    await desk.answer(second.id, { option: 0 });
    vi.advanceTimersByTime(NOTIFY_INTERVAL_MS);
    expect(sent).toEqual(['First question?', 'Third question?']);
    notifier.stop();
  });

  it('shows the next card at once when the last notification is more than a minute old', () => {
    const { notifier, sent, raise } = setup();
    raise('q:1', 'First question?');
    vi.advanceTimersByTime(NOTIFY_INTERVAL_MS);
    raise('q:2', 'Second question?');
    expect(sent).toEqual(['First question?', 'Second question?']);
    notifier.stop();
  });
});

// The long usage hold in Needs You (build-runs: A long usage hold is told): one non-blocking
// machine card naming the window and its reset, closed when the hold is over.
import { afterAll, describe, expect, it } from 'vitest';
import { Governor } from '../../src/build/governor.ts';
import { HoldCards, holdCard, resolveHoldCards, windowLabel } from '../../src/build/hold-card.ts';
import { getCard, listWaitingCards } from '../../src/core/store/cards.ts';
import { openStore } from '../../src/core/store/db.ts';
import { EventBus } from '../../src/core/store/events.ts';
import { CardDesk } from '../../src/server/cards.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

afterAll(() => {
  removeScratchDirs();
});

const T0 = 1_794_390_000_000;
const format = (ms: number) => `at ${ms}`;

function desk() {
  const store = openStore(makeScratchDir('cp-hold'));
  return new CardDesk({ store, bus: new EventBus() });
}

describe('the long-hold card', () => {
  it('names the window and its reset, blocks nothing, and offers to let it wait', () => {
    const card = holdCard(
      { until: T0, reason: 'seven_day usage at 96%, pacing until it resets', window: 'seven_day' },
      format,
    );
    expect(card).toMatchObject({
      hostId: null,
      kind: 'usage-hold',
      source: 'machine',
      question: `The weekly usage limit holds agent work until it resets, at ${T0}. Let it wait?`,
      blocking: false,
      recommended: 0,
    });
    expect(card.options.map((o) => o.label)).toEqual(['Let it wait', 'Ignore it']);
    expect(card.options.every((o) => o.action === undefined)).toBe(true);
    expect(holdCard({ until: T0, reason: 'limit', window: null }, format).question).toBe(
      `A usage limit holds agent work until at ${T0}. Let it wait?`,
    );
    expect(windowLabel('five_hour')).toBe('5-hour');
    expect(windowLabel('seven_day_opus')).toBe('weekly opus');
  });

  it('is raised while a spawn waits on a long hold and resolved when the hold ends', async () => {
    const d = desk();
    const cards = new HoldCards(d, format);
    const now = { t: T0 };
    let open: string[] = [];
    const g = new Governor({
      db: d.store,
      now: () => now.t,
      sleep: async (ms) => {
        // While the spawn waits, the card is in every host's Needs You.
        open = listWaitingCards(d.store, 'cena').map((card) => card.kind);
        now.t += ms;
      },
      onLongHold: (hold) => cards.update(hold),
    });
    g.pause(T0 + 4 * 3_600_000, 'usage limit reached');
    await g.admit({ hostId: 'cena', kind: 'builder' });
    expect(open).toEqual(['usage-hold']);
    expect(listWaitingCards(d.store, 'cena')).toEqual([]);
  });

  it('replaces the card of a hold that changed, and opens a closed one again after a restart', () => {
    const d = desk();
    const cards = new HoldCards(d, format);
    cards.update({ until: T0, reason: 'a', window: null });
    const first = listWaitingCards(d.store, 'cena')[0];
    cards.update({ until: T0 + 1000, reason: 'b', window: null });
    expect(getCard(d.store, first?.id ?? '')?.state).toBe('resolved');
    expect(listWaitingCards(d.store, 'cena').map((c) => c.key)).toEqual([
      `usage-hold:${T0 + 1000}`,
    ]);

    // A daemon restart closes what the last daemon left; a session still waiting raises it again.
    resolveHoldCards(d.store, d, 'Counterpoint restarted.');
    expect(listWaitingCards(d.store, 'cena')).toEqual([]);
    new HoldCards(d, format).update({ until: T0 + 1000, reason: 'b', window: null });
    expect(listWaitingCards(d.store, 'cena').map((c) => c.key)).toEqual([
      `usage-hold:${T0 + 1000}`,
    ]);
  });
});

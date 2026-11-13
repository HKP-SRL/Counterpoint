// The owner's git identity is missing (owner-identity: Commits carry the owner's identity): Needs
// You says so with one card, raised once, offering the identity GitHub knows for the owner.
import { afterAll, describe, expect, it } from 'vitest';
import {
  IDENTITY_CARD_KEY,
  identityCard,
  identityFallbackNotice,
} from '../../src/build/identity-card.ts';
import { getCardByKey, listWaitingCards } from '../../src/core/store/cards.ts';
import { openStore, upsertHost } from '../../src/core/store/db.ts';
import { EventBus } from '../../src/core/store/events.ts';
import { CardDesk } from '../../src/server/cards.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

afterAll(() => removeScratchDirs());

describe('git identity card', () => {
  it('offers to set the identity GitHub knows, with the set-git-identity action', () => {
    const card = identityCard({ name: 'Alex', email: '1+alex@users.noreply.github.com' });
    expect(card.options[0]).toMatchObject({
      label: 'Use Alex <1+alex@users.noreply.github.com>',
      action: { type: 'set-git-identity', name: 'Alex', email: '1+alex@users.noreply.github.com' },
    });
    expect(card.recommended).toBe(0);
    // Without gh, it still says so; nothing to set for the owner.
    const bare = identityCard(null);
    expect(bare.options.every((option) => option.action === undefined)).toBe(true);
  });

  it('is raised once, however many commits fall back', async () => {
    const home = makeScratchDir('identity-card');
    const db = openStore(home);
    upsertHost(db, {
      id: 'h1',
      root: '/tmp/h1',
      gitCommonDir: '/tmp/h1/.git',
      baseBranch: 'main',
      adapter: 'openspec',
    });
    const desk = new CardDesk({ store: db, bus: new EventBus() });
    // No gh on this PATH: the card offers no identity to set.
    const notice = identityFallbackNotice(desk, async () => ({ PATH: '/nonexistent' }));
    notice();
    notice();
    for (let i = 0; getCardByKey(db, IDENTITY_CARD_KEY) === undefined && i < 100; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    notice();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const cards = listWaitingCards(db, 'h1').filter((card) => card.key === IDENTITY_CARD_KEY);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.question).toBe('Your git name and email are not set. Commit as you?');
    db.close();
  });
});

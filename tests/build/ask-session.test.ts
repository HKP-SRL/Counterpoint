// A builder session's ask tool (owner-inbox D-5, D-6): when the session ends, an answer it never
// read says where it went instead of "Not read yet".
import { afterAll, describe, expect, it } from 'vitest';
import { openBuilderAsk } from '../../src/build/ask-session.ts';
import { getCard } from '../../src/core/store/cards.ts';
import { openStore, upsertHost } from '../../src/core/store/db.ts';
import { EventBus } from '../../src/core/store/events.ts';
import { CardDesk } from '../../src/server/cards.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

afterAll(() => removeScratchDirs());

describe('builder ask capability', () => {
  it('hands an unread answer to the next session when the session ends', async () => {
    const home = makeScratchDir('ask-session');
    const db = openStore(home);
    upsertHost(db, {
      id: 'h1',
      root: '/tmp/h1',
      gitCommonDir: '/tmp/h1/.git',
      baseBranch: 'main',
      adapter: 'openspec',
    });
    const desk = new CardDesk({ store: db, bus: new EventBus() });
    const ask = openBuilderAsk({
      db,
      home,
      server: { command: '/usr/bin/false', args: [] },
      dir: home,
      agentSessionId: 7,
      hostId: 'h1',
      runId: 'run-1',
      change: 'a-thing',
    });
    const card = desk.raise({
      hostId: 'h1',
      kind: 'ask',
      source: 'session',
      runId: 'run-1',
      change: 'a-thing',
      sessionId: 'builder-7',
      question: 'Which date format?',
      why: 'Diners see it.',
      options: [
        { label: 'ISO', consequence: 'Sortable.' },
        { label: 'Local', consequence: 'Friendlier.' },
      ],
      recommended: 1,
      reversible: true,
      blocking: false,
    });
    expect((await desk.answer(card.id, { option: 0 })).outcome).toBe('Not read yet');
    ask.close();
    expect(getCard(db, card.id)?.outcome).toBe('The next session on a-thing gets this answer.');
    db.close();
  });
});

// Self-restart during a run (owner-inbox 5.2, D-10): a new install never cuts a run short on its
// own. A card asks; unanswered, the restart waits for the run to end; "Restart now" hands over.
import { mkdirSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { homePaths } from '../../src/core/host/home.ts';
import { getCard } from '../../src/core/store/cards.ts';
import { openStore } from '../../src/core/store/db.ts';
import { EventBus } from '../../src/core/store/events.ts';
import { CardDesk } from '../../src/server/cards.ts';
import { SelfRestart } from '../../src/server/restart.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

afterAll(() => removeScratchDirs());

function setup() {
  const home = makeScratchDir('restart-unit');
  const paths = homePaths(home);
  mkdirSync(paths.runDir, { recursive: true });
  const store = openStore(home);
  const desk = new CardDesk({ store, bus: new EventBus() });
  const state = { stamp: 'v1', busy: true, spawned: 0, stopped: 0, takesOver: true };
  let restarter: SelfRestart;
  restarter = new SelfRestart({
    desk,
    paths,
    stamp: () => state.stamp,
    version: () => '0.1.1',
    busy: () => state.busy,
    spawnSuccessor: async (nonce) => {
      state.spawned += 1;
      // The successor asks the old daemon over the control channel, or never does.
      if (state.takesOver) setTimeout(() => restarter.accept(nonce), 5);
      return { exited: new Promise<void>(() => {}), kill: () => {} };
    },
    stop: async () => {
      state.stopped += 1;
    },
    handoverTimeoutMs: 100,
  });
  const card = () =>
    store.prepare(`SELECT id FROM cards WHERE kind = 'restart'`).all()[0]?.id as string | undefined;
  return { restarter, state, store, desk, card };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('an install during a run', () => {
  it('shows the card and restarts only once the run ends', async () => {
    const { restarter, state, store, card } = setup();
    state.stamp = 'v2';
    await restarter.check();
    await restarter.check();
    expect(state.spawned).toBe(0);
    const id = card() as string;
    const raised = getCard(store, id);
    expect(raised?.options.map((option) => option.label)).toEqual([
      'Restart after this run',
      'Restart now',
    ]);
    expect(raised?.recommended).toBe(0);

    await restarter.check();
    expect(state.spawned).toBe(0);
    state.busy = false;
    await restarter.check();
    await settle();
    expect(state.spawned).toBe(1);
    expect(state.stopped).toBe(1);
    expect(getCard(store, id)?.state).toBe('resolved');
  });

  it('"Restart after this run" waits; "Restart now" hands over during the run', async () => {
    const { restarter, state } = setup();
    state.stamp = 'v2';
    expect(await restarter.request('after-run')).toBe('Restarting once this run ends.');
    await settle();
    expect(state.spawned).toBe(0);
    expect(await restarter.request('now')).toBe('Restarting now.');
    await settle();
    expect(state.stopped).toBe(1);
  });

  it('keeps the old daemon running when the new install never takes over', async () => {
    const { restarter, state } = setup();
    state.busy = false;
    state.takesOver = false;
    state.stamp = 'v2';
    await restarter.check();
    await restarter.check();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(state.spawned).toBe(1);
    expect(state.stopped).toBe(0);
    // The same install is not tried again in a loop.
    await restarter.check();
    expect(state.spawned).toBe(1);
  });
});

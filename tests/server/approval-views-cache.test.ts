// The approval views' cache never pins a transient verification failure (runway: Transient errors
// do not pin the runway; WR-07): a runway or Needs You result that holds an `error` verdict is
// served but recomputed on the next read at the same base tip; a clean result is remembered.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Runway } from '../../src/core/runway/runway.ts';
import type { HostRuntime } from '../../src/server/hosts.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

const computeRunway = vi.fn<() => Promise<Runway>>();
vi.mock('../../src/core/runway/runway.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/core/runway/runway.ts')>()),
  computeRunway: () => computeRunway(),
}));
vi.mock('../../src/core/runway/needs-you.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/core/runway/needs-you.ts')>()),
  deriveNeedsYou: async () => [],
}));

const { createApprovalViews } = await import('../../src/server/approval-views.ts');

const TIP = 'a'.repeat(40);

function runwayWith(invalid: Runway['invalid']): Runway {
  return { tip: TIP, count: 0, taskCount: 0, onRunway: [], changed: [], invalid };
}
const TRANSIENT = runwayWith([{ changeId: 'x', reason: 'error', detail: 'git timed out' }]);
const CLEAN = runwayWith([]);

function runtime(): HostRuntime {
  return {
    host: { id: 'h', root: '/nonexistent-cp', baseBranch: 'main' },
    reader: {},
    adapter: {},
    tip: async () => TIP,
    servedTip: () => TIP,
    view: async () => ({ tip: TIP, snapshot: null, retryPending: false }),
  } as unknown as HostRuntime;
}

afterAll(removeScratchDirs);
beforeEach(() => computeRunway.mockReset());

describe('approval views cache (WR-07)', () => {
  it('recomputes a runway that held a transient error, then remembers the clean one', async () => {
    computeRunway.mockResolvedValueOnce(TRANSIENT).mockResolvedValue(CLEAN);
    const views = createApprovalViews({ home: makeScratchDir('avc') });
    const rt = runtime();
    expect((await views.runway(rt)).invalid).toHaveLength(1);
    expect((await views.runway(rt)).invalid).toEqual([]);
    expect(await views.runway(rt)).toEqual(CLEAN);
    expect(computeRunway).toHaveBeenCalledTimes(2);
  });

  it('does not remember Needs You built from a runway with a transient error', async () => {
    computeRunway.mockResolvedValueOnce(TRANSIENT).mockResolvedValue(CLEAN);
    const views = createApprovalViews({ home: makeScratchDir('avc') });
    const rt = runtime();
    await views.needsYou(rt);
    await views.needsYou(rt);
    await views.needsYou(rt);
    // First read: runway with the error (not kept). Second: a clean runway, kept with Needs You.
    expect(computeRunway).toHaveBeenCalledTimes(2);
  });

  it('keeps a runway whose only invalid verdicts are not transient', async () => {
    computeRunway.mockResolvedValue(runwayWith([{ changeId: 'x', reason: 'bad-statement' }]));
    const views = createApprovalViews({ home: makeScratchDir('avc') });
    const rt = runtime();
    await views.runway(rt);
    await views.runway(rt);
    expect(computeRunway).toHaveBeenCalledTimes(1);
  });
});

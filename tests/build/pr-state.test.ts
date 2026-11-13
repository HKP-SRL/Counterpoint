// The PR states the daemon asks `gh` for (runway: A merged build PR means built): every change's
// latest PR that is not known merged, a closed one included, since the owner may reopen and merge
// it.
import { afterAll, describe, expect, it } from 'vitest';
import { checkPullRequests } from '../../src/build/pr-state.ts';
import { openStore, upsertHost } from '../../src/core/store/db.ts';
import {
  insertRun,
  insertRunChange,
  latestPullRequests,
  setPullRequestState,
  updateRunChange,
} from '../../src/core/store/runs.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

afterAll(() => {
  removeScratchDirs();
});

describe('checking PR states', () => {
  it('asks about a closed PR again, and records it merged once it is reopened and merged', async () => {
    const db = openStore(makeScratchDir('cp-pr-state'));
    upsertHost(db, {
      id: 'cena',
      root: '/x/cena',
      gitCommonDir: '/x/cena/.git',
      baseBranch: 'master',
      adapter: 'openspec',
    });
    insertRun(db, { id: 'r1', hostId: 'cena', settings: {}, stopAt: null });
    const row = insertRunChange(db, { runId: 'r1', change: 'a-thing', position: 0 });
    const url = 'https://github.com/x/y/pull/7';
    updateRunChange(db, row, { state: 'green', prUrl: url });
    setPullRequestState(db, row, 'closed');

    let state = 'CLOSED';
    const asked: string[] = [];
    const tick = () =>
      checkPullRequests({
        db,
        host: { id: 'cena', root: '/x/cena' },
        env: {},
        gh: async (args) => {
          asked.push(args[2] ?? '');
          return { exitCode: 0, stdout: JSON.stringify({ state }), stderr: '' };
        },
      });
    expect(await tick()).toEqual([]);
    expect(asked).toEqual([url]);

    state = 'MERGED';
    expect(await tick()).toEqual(['a-thing']);
    expect(latestPullRequests(db, 'cena')[0]?.prState).toBe('merged');
    // Merged is final: not asked again.
    asked.length = 0;
    expect(await tick()).toEqual([]);
    expect(asked).toEqual([]);
  });
});

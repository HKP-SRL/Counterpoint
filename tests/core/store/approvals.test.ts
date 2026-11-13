// The owner's approvals in the store (approvals: Approve in one click; Withdraw in one click;
// Approvals outlast restarts; Earlier approvals carry over).
import { afterAll, describe, expect, it } from 'vitest';
import { createOpenSpecAdapter } from '../../../src/adapters/openspec/index.ts';
import { createBaseResolver } from '../../../src/core/git/base-ref.ts';
import { createGitFileReader } from '../../../src/core/git/reader.ts';
import { carryOverApprovals, carryOverHost } from '../../../src/core/runway/carry-over.ts';
import {
  approveChange,
  getApproval,
  listApprovals,
  pendingCarryOver,
  withdrawApproval,
} from '../../../src/core/store/approvals.ts';
import { openStore, type Store, upsertHost } from '../../../src/core/store/db.ts';
import { commitChange, materializeOpenSpecHost } from '../../helpers/fixture-repo.ts';
import { makeScratchDir, removeScratchDirs } from '../../helpers/scratch.ts';

afterAll(() => {
  removeScratchDirs();
});

const HOST = {
  id: 'cena',
  root: '/x/cena',
  gitCommonDir: '/x/cena/.git',
  baseBranch: 'master',
  adapter: 'openspec',
};

function store(home = makeScratchDir('cp-approvals')): { home: string; db: Store } {
  const db = openStore(home);
  upsertHost(db, HOST);
  return { home, db };
}

describe('approvals in the store', () => {
  it('approves once, keeps the first approval, and withdraws', () => {
    const { db } = store();
    expect(approveChange(db, { hostId: 'cena', change: 'a-thing', baseCommit: 'c1' }, 1000)).toBe(
      true,
    );
    expect(approveChange(db, { hostId: 'cena', change: 'a-thing', baseCommit: 'c2' }, 2000)).toBe(
      false,
    );
    expect(getApproval(db, 'cena', 'a-thing')).toEqual({
      hostId: 'cena',
      change: 'a-thing',
      approvedAt: 1000,
      baseCommit: 'c1',
      carriedOver: false,
    });
    expect(withdrawApproval(db, 'cena', 'a-thing')).toBe(true);
    expect(withdrawApproval(db, 'cena', 'a-thing')).toBe(false);
    expect(getApproval(db, 'cena', 'a-thing')).toBeUndefined();
  });

  it('keeps approvals across a restart', () => {
    const { home, db } = store();
    approveChange(db, { hostId: 'cena', change: 'a-thing', baseCommit: null }, 1);
    approveChange(db, { hostId: 'cena', change: 'b-thing', baseCommit: null }, 2);
    db.close();
    const again = openStore(home);
    expect(listApprovals(again, 'cena').map((row) => row.change)).toEqual(['a-thing', 'b-thing']);
  });
});

describe('earlier approvals carry over', () => {
  const proposal = '# Thing\n\n## Why\n\nBecause.\n';
  const open = '- [ ] 1.1 Do it\n';

  async function legacyHost() {
    return materializeOpenSpecHost({
      'openspec/config.yaml': 'schema: spec-driven\n',
      'openspec/changes/a-thing/proposal.md': proposal,
      'openspec/changes/a-thing/tasks.md': open,
      'openspec/changes/b-thing/proposal.md': proposal,
      'openspec/changes/b-thing/tasks.md': '- [x] 1.1 Done\n',
      'openspec/changes/archive/2026-11-01-c-thing/proposal.md': proposal,
      'openspec/changes/d-thing/proposal.md': proposal,
      'openspec/changes/d-thing/tasks.md': open,
      // Signed approvals from the earlier version: a-thing is open, b-thing built, c-thing
      // archived, e-thing gone. d-thing has none.
      '.counterpoint/approvals/a-thing.json': '{"not":"checked"}\n',
      '.counterpoint/approvals/b-thing.json': '{}\n',
      '.counterpoint/approvals/c-thing.json': '{}\n',
      '.counterpoint/approvals/e-thing.json': '{}\n',
    });
  }

  it('records open changes with an approval file as approved, once, at the first start', async () => {
    const repo = await legacyHost();
    const home = makeScratchDir('cp-carry');
    // A store from before the upgrade, with the host registered.
    const before = openStore(home, { upTo: 4 });
    upsertHost(before, { ...HOST, root: repo.root, gitCommonDir: `${repo.root}/.git` });
    before.close();

    const db = openStore(home);
    expect(pendingCarryOver(db)).toEqual(['cena']);
    const host = {
      hostId: 'cena',
      baseBranch: 'master',
      reader: createGitFileReader(repo.root),
      adapter: createOpenSpecAdapter(),
      tip: createBaseResolver(repo.root, 'master').tip,
    };
    await carryOverApprovals(db, () => host);
    expect(listApprovals(db, 'cena')).toEqual([
      expect.objectContaining({ change: 'a-thing', baseCommit: repo.commit, carriedOver: true }),
    ]);
    expect(pendingCarryOver(db)).toEqual([]);

    // A file committed after the upgrade approves nothing.
    await commitChange(repo.root, '.counterpoint/approvals/d-thing.json', '{}\n');
    await carryOverApprovals(db, () => host);
    expect(getApproval(db, 'cena', 'd-thing')).toBeUndefined();
  });

  it('does not carry over for a host registered after the upgrade', async () => {
    const repo = await legacyHost();
    const { db } = store();
    upsertHost(db, { ...HOST, id: 'later', root: repo.root, gitCommonDir: `${repo.root}/.git` });
    expect(pendingCarryOver(db)).toEqual([]);
  });

  it('keeps a host pending when it cannot be read now', async () => {
    const home = makeScratchDir('cp-carry');
    const before = openStore(home, { upTo: 4 });
    upsertHost(before, HOST);
    before.close();
    const db = openStore(home);
    const failures: string[] = [];
    await carryOverApprovals(
      db,
      () => ({
        hostId: 'cena',
        baseBranch: 'master',
        reader: {} as never,
        adapter: createOpenSpecAdapter(),
        tip: async () => {
          throw new Error('git is busy');
        },
      }),
      (event) => failures.push(event),
    );
    expect(failures).toEqual(['approvals-carry-over-failed']);
    expect(pendingCarryOver(db)).toEqual(['cena']);
    // A missing base branch leaves nothing to carry over: done.
    await carryOverHost(db, {
      hostId: 'cena',
      baseBranch: 'master',
      reader: {} as never,
      adapter: createOpenSpecAdapter(),
      tip: async () => null,
    });
    expect(pendingCarryOver(db)).toEqual([]);
  });
});

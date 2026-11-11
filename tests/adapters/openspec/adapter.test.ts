// The OpenSpec adapter against committed content: detection, the snapshot (facts, order, archived
// listing, one unreadable change never affecting the others) and the approval inputs (every file
// of the change, tasks.md normalized, unsafe entries refused).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOpenSpecAdapter } from '../../../src/adapters/openspec/index.ts';
import { TASKS_NORMALIZER } from '../../../src/adapters/openspec/tasks.ts';
import { sha256Digest } from '../../../src/core/approvals/digest.ts';
import { AmbiguousChangeError, ChangeNotFoundError } from '../../../src/core/framework/port.ts';
import { createGitFileReader, UnsafeTreeEntryError } from '../../../src/core/git/reader.ts';
import { InvalidIdError } from '../../../src/core/ids.ts';
import { deriveChangeStatus } from '../../../src/core/runway/status.ts';
import {
  commitChange,
  commitSymlink,
  type FixtureRepo,
  materializeFixtureRepo,
  materializeOpenSpecHost,
  SYNTHETIC,
  SYNTHETIC_CONFIG,
  SYNTHETIC_FILES,
} from '../../helpers/fixture-repo.ts';
import { removeScratchDirs } from '../../helpers/scratch.ts';

const adapter = createOpenSpecAdapter();
const READY_DIR = `openspec/changes/${SYNTHETIC.ready}`;

let synthetic: FixtureRepo;

beforeAll(async () => {
  synthetic = await materializeFixtureRepo('synthetic');
});

afterAll(() => {
  removeScratchDirs();
});

function snapshotOf(repo: FixtureRepo, commit = repo.commit) {
  return adapter.snapshot(createGitFileReader(repo.root), commit);
}

function change(files: Record<string, string>, id: string, meta: string, extra = {}) {
  return {
    ...files,
    [`openspec/changes/${id}/.openspec.yaml`]: meta,
    [`openspec/changes/${id}/proposal.md`]: `# ${id}\n\n## Why\n\nBecause.\n`,
    [`openspec/changes/${id}/tasks.md`]: '- [ ] 1.1 Do it\n',
    ...extra,
  };
}

describe('detect', () => {
  it('recognises a commit with openspec/config.yaml', async () => {
    expect(await adapter.detect(createGitFileReader(synthetic.root), synthetic.commit)).toBe(true);
  });

  it('does not recognise a commit without it, or with a symlinked config', async () => {
    const repo = await materializeOpenSpecHost({ 'openspec/changes/a/proposal.md': '# A\n' });
    expect(await adapter.detect(createGitFileReader(repo.root), repo.commit)).toBe(false);
    const linked = await commitSymlink(repo.root, 'openspec/config.yaml', '../README.md');
    expect(await adapter.detect(createGitFileReader(repo.root), linked)).toBe(false);
  });
});

describe('snapshot of the synthetic host', () => {
  it('lists active changes in build order, then archived ones; ignores non-change directories', async () => {
    const snapshot = await snapshotOf(synthetic);
    expect(snapshot.framework).toBe('openspec');
    expect(snapshot.commit).toBe(synthetic.commit);
    expect(snapshot.unreadable).toBeNull();
    expect(snapshot.changes.map((c) => c.id)).toEqual([
      SYNTHETIC.built,
      SYNTHETIC.ready,
      SYNTHETIC.noTasks,
      SYNTHETIC.noProposal,
      SYNTHETIC.broken,
      SYNTHETIC.archived,
    ]);
  });

  it('reports the facts of the ready change', async () => {
    const ready = (await snapshotOf(synthetic)).changes.find((c) => c.id === SYNTHETIC.ready);
    expect(ready).toEqual({
      id: SYNTHETIC.ready,
      dir: READY_DIR,
      archived: false,
      archivedOn: null,
      title: 'Ready thing',
      why: 'A change that has its proposal and its tasks, ready to approve.',
      created: '2026-10-03',
      dependsOn: [SYNTHETIC.built],
      artifacts: { proposal: true, design: true, tasks: true, specs: ['menu'] },
      tasks: { total: 4, done: 1, ownerSteps: ['Owner: create the Supabase project'] },
      unreadable: null,
    });
  });

  it('derives every status from the facts', async () => {
    const statuses = Object.fromEntries(
      (await snapshotOf(synthetic)).changes.map((c) => [c.id, deriveChangeStatus(c)]),
    );
    expect(statuses).toEqual({
      [SYNTHETIC.built]: { status: 'built', notReadyReason: null },
      [SYNTHETIC.ready]: { status: 'ready', notReadyReason: null },
      [SYNTHETIC.noTasks]: { status: 'not-planned', notReadyReason: 'no-tasks' },
      [SYNTHETIC.noProposal]: { status: 'not-planned', notReadyReason: 'no-proposal' },
      [SYNTHETIC.broken]: { status: 'unreadable', notReadyReason: null },
      [SYNTHETIC.archived]: { status: 'built', notReadyReason: null },
    });
  });

  it('titles a change without a proposal heading by its id', async () => {
    const changes = (await snapshotOf(synthetic)).changes;
    expect(changes.find((c) => c.id === SYNTHETIC.noProposal)?.title).toBe(SYNTHETIC.noProposal);
  });

  it('marks only the change with malformed metadata unreadable, naming the file', async () => {
    const changes = (await snapshotOf(synthetic)).changes;
    const broken = changes.find((c) => c.id === SYNTHETIC.broken);
    expect(broken?.unreadable).toEqual({
      file: `openspec/changes/${SYNTHETIC.broken}/.openspec.yaml`,
      reason: expect.stringMatching(/^Invalid YAML: /),
    });
    expect(changes.filter((c) => c.unreadable !== null).map((c) => c.id)).toEqual([
      SYNTHETIC.broken,
    ]);
  });

  it('reports an archived change as done, with its archive date and proposal title', async () => {
    const archived = (await snapshotOf(synthetic)).changes.find((c) => c.id === SYNTHETIC.archived);
    expect(archived).toMatchObject({
      archived: true,
      archivedOn: '2026-09-01',
      dir: 'openspec/changes/archive/2026-09-01-old-thing',
      title: 'Old thing',
      why: 'Finished and archived.',
    });
  });

  it('reads the commit, not the working tree', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    const { writeFileIn } = await import('../../helpers/scratch.ts');
    writeFileIn(repo.root, `${READY_DIR}/proposal.md`, '# Edited locally\n');
    const ready = (await snapshotOf(repo)).changes.find((c) => c.id === SYNTHETIC.ready);
    expect(ready?.title).toBe('Ready thing');
  });

  it('is empty for an OpenSpec host with no changes yet', async () => {
    const repo = await materializeOpenSpecHost({ 'openspec/config.yaml': SYNTHETIC_CONFIG });
    expect((await snapshotOf(repo)).changes).toEqual([]);
  });
});

describe('snapshot memo', () => {
  it('serves a clean commit from memory, as an independent copy', async () => {
    const own = createOpenSpecAdapter();
    let lists = 0;
    const repo = await materializeOpenSpecHost({
      'openspec/config.yaml': SYNTHETIC_CONFIG,
      'openspec/changes/a-change/proposal.md': '# A\n',
    });
    const r = createGitFileReader(repo.root);
    const countingRepo = { ...r, list: (c: string, d: string) => (lists++, r.list(c, d)) };
    const first = await own.snapshot(countingRepo, repo.commit);
    const afterFirst = lists;
    first.changes[0]?.dependsOn.push('mutated');
    const second = await own.snapshot(countingRepo, repo.commit);
    expect(lists).toBe(afterFirst);
    expect(second.changes[0]?.dependsOn).toEqual([]);
  });

  it('never keeps a snapshot with an unreadable change', async () => {
    const own = createOpenSpecAdapter();
    const r = createGitFileReader(synthetic.root);
    let lists = 0;
    const counting = { ...r, list: (c: string, d: string) => (lists++, r.list(c, d)) };
    await own.snapshot(counting, synthetic.commit);
    const once = lists;
    await own.snapshot(counting, synthetic.commit);
    expect(lists).toBe(once * 2);
  });
});

describe('snapshot order and edge cases', () => {
  it('orders a dependency created later before its dependent', async () => {
    let files: Record<string, string> = { 'openspec/config.yaml': SYNTHETIC_CONFIG };
    files = change(files, 'table-ordering', 'created: 2026-10-01\nx-depends-on: [qr-menu]\n');
    files = change(files, 'qr-menu', 'created: 2026-10-05\n');
    files = change(files, 'payments', 'created: 2026-10-02\nx-depends-on: [table-ordering]\n');
    const repo = await materializeOpenSpecHost(files);
    expect((await snapshotOf(repo)).changes.map((c) => c.id)).toEqual([
      'qr-menu',
      'table-ordering',
      'payments',
    ]);
  });

  it('breaks a dependency cycle by created, then id, and keeps dependents after it', async () => {
    let files: Record<string, string> = { 'openspec/config.yaml': SYNTHETIC_CONFIG };
    files = change(files, 'a-loop', 'created: 2026-10-03\nx-depends-on: [b-loop]\n');
    files = change(files, 'b-loop', 'created: 2026-10-02\nx-depends-on: [a-loop]\n');
    files = change(files, 'after-loop', 'created: 2026-10-01\nx-depends-on: [a-loop]\n');
    files = change(files, 'free', 'created: 2026-10-09\n');
    const repo = await materializeOpenSpecHost(files);
    expect((await snapshotOf(repo)).changes.map((c) => c.id)).toEqual([
      'free',
      'b-loop',
      'a-loop',
      'after-loop',
    ]);
  });

  it('marks a change holding a symlink unreadable, and only that change', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    const commit = await commitSymlink(repo.root, `${READY_DIR}/specs/menu/extra.md`, '/etc/hosts');
    const changes = (await snapshotOf(repo, commit)).changes;
    expect(changes.find((c) => c.id === SYNTHETIC.ready)?.unreadable).toEqual({
      file: `${READY_DIR}/specs/menu/extra.md`,
      reason: 'Symbolic links are not read.',
    });
    expect(changes.filter((c) => c.unreadable !== null).map((c) => c.id)).toEqual([
      SYNTHETIC.ready,
      SYNTHETIC.broken,
    ]);
  });

  it('marks a change with an oversized or non-UTF-8 tasks.md unreadable', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    const big = await commitChange(
      repo.root,
      `${READY_DIR}/tasks.md`,
      Buffer.alloc(5 * 1024 * 1024 + 1, 0x61),
    );
    const ready = (await snapshotOf(repo, big)).changes.find((c) => c.id === SYNTHETIC.ready);
    expect(ready?.unreadable).toEqual({
      file: `${READY_DIR}/tasks.md`,
      reason: expect.stringContaining('larger than 5 MiB'),
    });
    const binary = await commitChange(
      repo.root,
      `${READY_DIR}/tasks.md`,
      new Uint8Array([0xff, 0xfe, 0x00]),
    );
    const again = (await snapshotOf(repo, binary)).changes.find((c) => c.id === SYNTHETIC.ready);
    expect(again?.unreadable).toEqual({
      file: `${READY_DIR}/tasks.md`,
      reason: 'Not valid UTF-8 text.',
    });
  });

  it('ignores an archive entry whose name is not <date>-<change id>', async () => {
    const repo = await materializeOpenSpecHost({
      ...SYNTHETIC_FILES,
      'openspec/changes/archive/not-dated/proposal.md': '# Not dated\n',
      'openspec/changes/archive/2026-01-01-Bad_Name/proposal.md': '# Bad\n',
    });
    const archived = (await snapshotOf(repo)).changes.filter((c) => c.archived).map((c) => c.id);
    expect(archived).toEqual([SYNTHETIC.archived]);
  });
});

describe('approvalInputs', () => {
  it('covers every file of the change, sorted by path bytes, with kinds and labels', async () => {
    const inputs = await adapter.approvalInputs(
      createGitFileReader(synthetic.root),
      synthetic.commit,
      SYNTHETIC.ready,
    );
    expect(
      inputs.map(({ path, sourcePath, label, kind, normalization }) => ({
        path,
        sourcePath,
        label,
        kind,
        normalization,
      })),
    ).toEqual([
      {
        path: `${READY_DIR}/.openspec.yaml`,
        sourcePath: `${READY_DIR}/.openspec.yaml`,
        label: '.openspec.yaml',
        kind: 'metadata',
        normalization: null,
      },
      {
        path: `${READY_DIR}/design.md`,
        sourcePath: `${READY_DIR}/design.md`,
        label: 'design.md',
        kind: 'design',
        normalization: null,
      },
      {
        path: `${READY_DIR}/proposal.md`,
        sourcePath: `${READY_DIR}/proposal.md`,
        label: 'proposal.md',
        kind: 'proposal',
        normalization: null,
      },
      {
        path: `${READY_DIR}/specs/menu/spec.md`,
        sourcePath: `${READY_DIR}/specs/menu/spec.md`,
        label: 'specs/menu/spec.md',
        kind: 'spec',
        normalization: null,
      },
      {
        path: `${READY_DIR}/tasks.md`,
        sourcePath: `${READY_DIR}/tasks.md`,
        label: 'tasks.md',
        kind: 'tasks',
        normalization: TASKS_NORMALIZER,
      },
    ]);
  });

  it('gives the exact committed bytes, except tasks.md, which is normalized', async () => {
    const inputs = await adapter.approvalInputs(
      createGitFileReader(synthetic.root),
      synthetic.commit,
      SYNTHETIC.ready,
    );
    const text = (path: string) =>
      new TextDecoder().decode(inputs.find((i) => i.path === path)?.bytes);
    expect(text(`${READY_DIR}/proposal.md`)).toBe(SYNTHETIC_FILES[`${READY_DIR}/proposal.md`]);
    expect(text(`${READY_DIR}/tasks.md`)).toBe(
      (SYNTHETIC_FILES[`${READY_DIR}/tasks.md`] as string).replace('- [x]', '- [ ]'),
    );
    const committed = readFileSync(join(synthetic.root, `${READY_DIR}/design.md`));
    expect(sha256Digest(inputs.find((i) => i.kind === 'design')?.bytes as Uint8Array)).toBe(
      sha256Digest(committed),
    );
  });

  it('gives the same tasks digest after a box is ticked, and a new one after a real edit', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    const reader = createGitFileReader(repo.root);
    const tasksDigest = async (commit: string) =>
      sha256Digest(
        (await adapter.approvalInputs(reader, commit, SYNTHETIC.ready)).find(
          (i) => i.kind === 'tasks',
        )?.bytes as Uint8Array,
      );
    const before = await tasksDigest(repo.commit);
    const original = SYNTHETIC_FILES[`${READY_DIR}/tasks.md`] as string;
    const ticked = await commitChange(
      repo.root,
      `${READY_DIR}/tasks.md`,
      original.replace('- [ ] 1.1', '- [x] 1.1').replace('- [ ] 2.1', '- [X] 2.1'),
    );
    expect(await tasksDigest(ticked)).toBe(before);
    const edited = await commitChange(
      repo.root,
      `${READY_DIR}/tasks.md`,
      original.replace('Finish the ready thing', 'Finish it differently'),
    );
    expect(await tasksDigest(edited)).not.toBe(before);
  });

  it("classifies any other file as 'other' and nested spec files as 'spec'", async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await commitChange(repo.root, `${READY_DIR}/notes.txt`, 'notes\n');
    const commit = await commitChange(
      repo.root,
      `${READY_DIR}/specs/ordering/kitchen/spec.md`,
      '## ADDED Requirements\n',
    );
    const inputs = await adapter.approvalInputs(
      createGitFileReader(repo.root),
      commit,
      SYNTHETIC.ready,
    );
    expect(inputs.find((i) => i.label === 'notes.txt')?.kind).toBe('other');
    expect(inputs.find((i) => i.label === 'specs/ordering/kitchen/spec.md')?.kind).toBe('spec');
    const facts = (await snapshotOf(repo, commit)).changes.find((c) => c.id === SYNTHETIC.ready);
    expect(facts?.artifacts.specs).toEqual(['menu', 'ordering/kitchen']);
  });

  it('refuses a symlink or an oversized file instead of covering less', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    const reader = createGitFileReader(repo.root);
    const linked = await commitSymlink(repo.root, `${READY_DIR}/link.md`, '../proposal.md');
    await expect(adapter.approvalInputs(reader, linked, SYNTHETIC.ready)).rejects.toBeInstanceOf(
      UnsafeTreeEntryError,
    );
    await commitChange(repo.root, `${READY_DIR}/link.md`, null);
    const big = await commitChange(
      repo.root,
      `${READY_DIR}/big.bin`,
      Buffer.alloc(5 * 1024 * 1024 + 1),
    );
    await expect(adapter.approvalInputs(reader, big, SYNTHETIC.ready)).rejects.toMatchObject({
      name: 'UnsafeTreeEntryError',
      reason: 'too-large',
    });
  });

  it('throws ChangeNotFoundError for an unknown change and InvalidIdError for a bad id', async () => {
    const reader = createGitFileReader(synthetic.root);
    await expect(
      adapter.approvalInputs(reader, synthetic.commit, 'no-such-change'),
    ).rejects.toBeInstanceOf(ChangeNotFoundError);
    await expect(
      adapter.approvalInputs(reader, synthetic.commit, 'archive'),
    ).rejects.toBeInstanceOf(InvalidIdError);
    await expect(
      adapter.approvalInputs(reader, synthetic.commit, '../escape'),
    ).rejects.toBeInstanceOf(InvalidIdError);
  });

  it('falls back to the archived change when no active change has the name', async () => {
    const inputs = await adapter.approvalInputs(
      createGitFileReader(synthetic.root),
      synthetic.commit,
      SYNTHETIC.archived,
    );
    expect(inputs.map((i) => i.label)).toEqual(['.openspec.yaml', 'proposal.md', 'tasks.md']);
    expect(inputs[0]?.path.startsWith('openspec/changes/archive/2026-09-01-old-thing/')).toBe(true);
  });
});

describe('ambiguous change names fail closed (WR-03)', () => {
  const META = 'schema: spec-driven\ncreated: 2026-11-01\n';
  const proposal = (title: string) => `# ${title}\n\n## Why\n\nBecause.\n`;

  it.each([
    [
      'an active change and an archived one',
      {
        'openspec/changes/twin/.openspec.yaml': META,
        'openspec/changes/twin/proposal.md': proposal('Active twin'),
        'openspec/changes/twin/tasks.md': '- [ ] 1.1 Do it\n',
        'openspec/changes/archive/2026-10-01-twin/proposal.md': proposal('Archived twin'),
      },
      ['openspec/changes/twin', 'openspec/changes/archive/2026-10-01-twin'],
    ],
    [
      'two archive folders',
      {
        'openspec/changes/archive/2026-09-01-twin/proposal.md': proposal('Older'),
        'openspec/changes/archive/2026-10-01-twin/proposal.md': proposal('Newer'),
      },
      ['openspec/changes/archive/2026-09-01-twin', 'openspec/changes/archive/2026-10-01-twin'],
    ],
  ])('refuses inputs and shows every folder unreadable for %s', async (_, files, dirs) => {
    const repo = await materializeOpenSpecHost({
      'openspec/config.yaml': SYNTHETIC_CONFIG,
      ...files,
    });
    const reader = createGitFileReader(repo.root);
    await expect(adapter.approvalInputs(reader, repo.commit, 'twin')).rejects.toBeInstanceOf(
      AmbiguousChangeError,
    );
    const snapshot = await adapter.snapshot(reader, repo.commit);
    const twins = snapshot.changes.filter((c) => c.id === 'twin');
    expect(twins.map((c) => c.dir).sort()).toEqual([...dirs].sort());
    for (const twin of twins) {
      expect(twin.unreadable?.file).toBe(twin.dir);
      expect(twin.unreadable?.reason).toContain('More than one folder is named for change "twin"');
    }
  });

  it('still reads a uniquely named archived change', async () => {
    const repo = await materializeOpenSpecHost({
      'openspec/config.yaml': SYNTHETIC_CONFIG,
      'openspec/changes/archive/2026-10-01-solo/proposal.md': proposal('Solo'),
    });
    const reader = createGitFileReader(repo.root);
    const inputs = await adapter.approvalInputs(reader, repo.commit, 'solo');
    expect(inputs.map((i) => i.label)).toEqual(['proposal.md']);
    const [solo] = (await adapter.snapshot(reader, repo.commit)).changes;
    expect(solo?.unreadable).toBeNull();
  });
});

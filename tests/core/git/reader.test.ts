import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  comparePhaseNumbers,
  formatPhaseId,
  parsePhaseNumber,
} from '../../../src/core/framework/port.ts';
import { createGitFileReader, UnsafeTreeEntryError } from '../../../src/core/git/reader.ts';
import { GitError } from '../../../src/core/git/run.ts';
import {
  commitChange,
  commitSymlink,
  type FixtureRepo,
  materializeFixtureRepo,
} from '../../helpers/fixture-repo.ts';
import { gitIn, removeScratchDirs } from '../../helpers/scratch.ts';

let repo: FixtureRepo;

beforeAll(async () => {
  repo = await materializeFixtureRepo('synthetic');
});

afterAll(() => {
  removeScratchDirs();
});

describe('GitFileReader.resolve', () => {
  it('returns the commit sha a branch points at', async () => {
    const reader = createGitFileReader(repo.root);
    expect(await reader.resolve('master')).toBe(repo.commit);
  });

  it('returns null for an unknown ref', async () => {
    const reader = createGitFileReader(repo.root);
    expect(await reader.resolve('no-such-branch')).toBeNull();
  });

  it('returns null for a ref that looks like an option', async () => {
    const reader = createGitFileReader(repo.root);
    expect(await reader.resolve('--all')).toBeNull();
  });
});

describe('GitFileReader.list', () => {
  it('lists the direct children of a directory with name, full path, type and mode', async () => {
    const reader = createGitFileReader(repo.root);
    const entries = await reader.list(repo.commit, '.planning/phases/02-ready-thing');
    const plan = entries.find((entry) => entry.name === '02-01-PLAN.md');
    expect(plan).toEqual({
      name: '02-01-PLAN.md',
      path: '.planning/phases/02-ready-thing/02-01-PLAN.md',
      type: 'blob',
      mode: '100644',
      oid: expect.stringMatching(/^[0-9a-f]{40}$/),
    });
    expect(entries.map((entry) => entry.name).sort()).toEqual([
      '02-01-PLAN.md',
      '02-02-PLAN.md',
      '02-05-PERMISSION-MATRIX.md',
      '02-CONTEXT.md',
      '02-DISCUSSION-LOG.md',
      '02-PATTERNS.md',
      '02-RESEARCH.md',
      '02-UI-SPEC.md',
    ]);
  });

  it('reports subdirectories as trees', async () => {
    const reader = createGitFileReader(repo.root);
    const entries = await reader.list(repo.commit, '.planning/phases');
    expect(entries.map((entry) => [entry.name, entry.type])).toEqual([
      ['01-built-thing', 'tree'],
      ['02-ready-thing', 'tree'],
      ['02.1-inserted-thing', 'tree'],
      ['04-broken-yaml', 'tree'],
    ]);
    expect(entries[0]?.path).toBe('.planning/phases/01-built-thing');
  });

  it('returns [] for a directory that does not exist', async () => {
    const reader = createGitFileReader(repo.root);
    expect(await reader.list(repo.commit, '.planning/phases/99-nope')).toEqual([]);
  });
});

describe('GitFileReader.read', () => {
  it('returns the exact blob bytes, without end-of-line conversion', async () => {
    const bytes = new TextEncoder().encode('line one\r\nline two\r\né\n');
    const commit = await commitChange(repo.root, 'docs/crlf.txt', bytes);
    const reader = createGitFileReader(repo.root);
    const read = await reader.read(commit, 'docs/crlf.txt');
    expect(read).not.toBeNull();
    expect(Buffer.from(read as Uint8Array).equals(Buffer.from(bytes))).toBe(true);
  });

  it('reads from the commit, not the working tree', async () => {
    const reader = createGitFileReader(repo.root);
    const commit = await commitChange(repo.root, 'docs/state.txt', 'committed\n');
    await commitChange(repo.root, 'docs/state.txt', 'later\n');
    const read = await reader.read(commit, 'docs/state.txt');
    expect(new TextDecoder().decode(read as Uint8Array)).toBe('committed\n');
  });

  it('returns null for a missing path', async () => {
    const reader = createGitFileReader(repo.root);
    expect(await reader.read(repo.commit, '.planning/NOPE.md')).toBeNull();
  });

  it('returns null for a directory', async () => {
    const reader = createGitFileReader(repo.root);
    expect(await reader.read(repo.commit, '.planning/phases')).toBeNull();
  });

  it('refuses a symlink tree entry (mode 120000)', async () => {
    const commit = await commitSymlink(repo.root, 'docs/link.md', '../.planning/ROADMAP.md');
    const reader = createGitFileReader(repo.root);
    const entries = await reader.list(commit, 'docs');
    expect(entries.find((entry) => entry.name === 'link.md')?.mode).toBe('120000');
    await expect(reader.read(commit, 'docs/link.md')).rejects.toBeInstanceOf(UnsafeTreeEntryError);
  });

  it('refuses a blob over 5 MiB', async () => {
    const commit = await commitChange(
      repo.root,
      'docs/huge.bin',
      Buffer.alloc(5 * 1024 * 1024 + 1),
    );
    const reader = createGitFileReader(repo.root);
    await expect(reader.read(commit, 'docs/huge.bin')).rejects.toBeInstanceOf(UnsafeTreeEntryError);
  });

  it('reads a blob of exactly 5 MiB', async () => {
    const commit = await commitChange(repo.root, 'docs/edge.bin', Buffer.alloc(5 * 1024 * 1024));
    const reader = createGitFileReader(repo.root);
    expect((await reader.read(commit, 'docs/edge.bin'))?.byteLength).toBe(5 * 1024 * 1024);
  });

  it('does not treat a path as a pathspec pattern', async () => {
    const reader = createGitFileReader(repo.root);
    expect(await reader.read(repo.commit, '.planning/ROADMAP.m?')).toBeNull();
    expect(await reader.read(repo.commit, '.planning/*.md')).toBeNull();
  });

  it.each([
    ['a `..` segment', '.planning/../secret.md'],
    ['a leading `..`', '../outside.md'],
    ['a leading `/`', '/etc/passwd'],
    ['a NUL byte', '.planning/ROADMAP.md\u0000x'],
    ['an empty path', ''],
  ])('refuses %s before git runs', async (_label, path) => {
    // A reader over a directory that is not a repository: if git ran, it would fail with GitError.
    const reader = createGitFileReader('/nonexistent-counterpoint-repo');
    const commit = 'a'.repeat(40);
    await expect(reader.read(commit, path)).rejects.toBeInstanceOf(UnsafeTreeEntryError);
    await expect(reader.read(commit, path)).rejects.not.toBeInstanceOf(GitError);
  });

  it('refuses an unsafe directory in list before git runs', async () => {
    const reader = createGitFileReader('/nonexistent-counterpoint-repo');
    await expect(reader.list('a'.repeat(40), '../x')).rejects.toBeInstanceOf(UnsafeTreeEntryError);
  });

  it('refuses a commit argument that is not an object id', async () => {
    const reader = createGitFileReader(repo.root);
    await expect(reader.read('--output=x', '.planning/ROADMAP.md')).rejects.toBeInstanceOf(
      UnsafeTreeEntryError,
    );
  });

  it('positive control: a real repository path reads fine', async () => {
    const reader = createGitFileReader(repo.root);
    const roadmap = await reader.read(repo.commit, '.planning/ROADMAP.md');
    expect(new TextDecoder().decode(roadmap as Uint8Array)).toContain('### Phase 02: Ready Thing');
    // and the symlink fixture really is a symlink in git's eyes
    const out = await gitIn(repo.root, ['ls-tree', 'HEAD', '--', 'docs/link.md']);
    expect(out.startsWith('120000')).toBe(true);
  });
});

describe('phase numbers', () => {
  it('orders [1], [1,1], [1,9], [1,10], [2] as integer tuples', () => {
    const shuffled = [[2], [1, 10], [1], [1, 9], [1, 1]];
    expect([...shuffled].sort(comparePhaseNumbers)).toEqual([[1], [1, 1], [1, 9], [1, 10], [2]]);
  });

  it('compares equal tuples as 0', () => {
    expect(comparePhaseNumbers([1, 1], [1, 1])).toBe(0);
  });

  it.each([
    [[1, 1], '01.1'],
    [[2], '02'],
    [[1, 10], '01.10'],
    [[12], '12'],
  ])('formatPhaseId(%j) = %s', (number, id) => {
    expect(formatPhaseId(number)).toBe(id);
  });

  it.each([
    ['1', [1]],
    ['01', [1]],
    ['1.1', [1, 1]],
    ['01.1', [1, 1]],
    ['1.10', [1, 10]],
    ['1.9', [1, 9]],
  ])('parsePhaseNumber(%s) = %j', (text, number) => {
    expect(parsePhaseNumber(text)).toEqual(number);
  });

  it.each(['', '1.', '.1', 'a', '1.1.1', '-1', '1e2'])('parsePhaseNumber(%j) is null', (text) => {
    expect(parsePhaseNumber(text)).toBeNull();
  });
});

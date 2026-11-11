import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
    const entries = await reader.list(repo.commit, 'openspec/changes/ready-thing');
    const proposal = entries.find((entry) => entry.name === 'proposal.md');
    expect(proposal).toEqual({
      name: 'proposal.md',
      path: 'openspec/changes/ready-thing/proposal.md',
      type: 'blob',
      mode: '100644',
      oid: expect.stringMatching(/^[0-9a-f]{40}$/),
    });
    expect(entries.map((entry) => entry.name).sort()).toEqual([
      '.openspec.yaml',
      'design.md',
      'proposal.md',
      'specs',
      'tasks.md',
    ]);
  });

  it('reports subdirectories as trees', async () => {
    const reader = createGitFileReader(repo.root);
    const entries = await reader.list(repo.commit, 'openspec/changes');
    expect(entries.map((entry) => [entry.name, entry.type])).toEqual([
      ['Not_A_Change', 'tree'],
      ['archive', 'tree'],
      ['broken-yaml', 'tree'],
      ['built-thing', 'tree'],
      ['no-proposal', 'tree'],
      ['no-tasks', 'tree'],
      ['ready-thing', 'tree'],
    ]);
    expect(entries[2]?.path).toBe('openspec/changes/broken-yaml');
  });

  it('returns [] for a directory that does not exist', async () => {
    const reader = createGitFileReader(repo.root);
    expect(await reader.list(repo.commit, 'openspec/changes/no-such-change')).toEqual([]);
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
    expect(await reader.read(repo.commit, 'openspec/NOPE.md')).toBeNull();
  });

  it('returns null for a directory', async () => {
    const reader = createGitFileReader(repo.root);
    expect(await reader.read(repo.commit, 'openspec/changes')).toBeNull();
  });

  it('refuses a symlink tree entry (mode 120000)', async () => {
    const commit = await commitSymlink(repo.root, 'docs/link.md', '../openspec/config.yaml');
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
    expect(await reader.read(repo.commit, 'openspec/config.yam?')).toBeNull();
    expect(await reader.read(repo.commit, 'openspec/*.yaml')).toBeNull();
  });

  it.each([
    ['a `..` segment', 'openspec/../secret.md'],
    ['a leading `..`', '../outside.md'],
    ['a leading `/`', '/etc/passwd'],
    ['a NUL byte', 'openspec/config.yaml\u0000x'],
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
    await expect(reader.read('--output=x', 'openspec/config.yaml')).rejects.toBeInstanceOf(
      UnsafeTreeEntryError,
    );
  });

  it('positive control: a real repository path reads fine', async () => {
    const reader = createGitFileReader(repo.root);
    const proposal = await reader.read(repo.commit, 'openspec/changes/ready-thing/proposal.md');
    expect(new TextDecoder().decode(proposal as Uint8Array)).toContain('# Ready thing');
    // and the symlink fixture really is a symlink in git's eyes
    const out = await gitIn(repo.root, ['ls-tree', 'HEAD', '--', 'docs/link.md']);
    expect(out.startsWith('120000')).toBe(true);
  });
});

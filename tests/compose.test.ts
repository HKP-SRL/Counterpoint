import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adapterFor, detectFramework, FRAMEWORK_ADAPTERS } from '../src/compose.ts';
import { type FixtureRepo, materializeFixtureRepo } from './helpers/fixture-repo.ts';
import {
  commitAll,
  gitIn,
  initScratchRepo,
  makeScratchDir,
  removeScratchDirs,
  writeFileIn,
} from './helpers/scratch.ts';

let synthetic: FixtureRepo;

beforeAll(async () => {
  synthetic = await materializeFixtureRepo('synthetic');
});

afterAll(() => {
  removeScratchDirs();
});

describe('adapterFor', () => {
  it('returns the composed OpenSpec adapter for an openspec host', () => {
    const adapter = adapterFor({ adapter: 'openspec' });
    expect(adapter).not.toBeNull();
    expect(adapter?.id).toBe('openspec');
    expect(FRAMEWORK_ADAPTERS).toContain(adapter);
  });

  it('returns null for a host with no framework (none) or an unknown id', () => {
    expect(adapterFor({ adapter: 'none' })).toBeNull();
    expect(adapterFor({ adapter: 'speckit' })).toBeNull();
    // Hosts registered under a framework id that is no longer composed read as no framework.
    expect(adapterFor({ adapter: 'retired' })).toBeNull();
  });

  it('composes exactly one adapter per id', () => {
    const ids = FRAMEWORK_ADAPTERS.map((adapter) => adapter.id);
    expect(ids).toEqual(['openspec']);
  });
});

describe('detectFramework', () => {
  it('returns openspec for a repository whose base tip has openspec/config.yaml', async () => {
    expect(await detectFramework(synthetic.root, 'master')).toBe('openspec');
  });

  it('returns none for a repository without an OpenSpec config', async () => {
    const root = makeScratchDir('cmp-none');
    await initScratchRepo(root, { branch: 'main' });
    writeFileIn(root, 'README.md', '# plain repo\n');
    await commitAll(root, 'plain');
    expect(await detectFramework(root, 'main')).toBe('none');
  });

  it('returns none when the base branch does not resolve', async () => {
    expect(await detectFramework(synthetic.root, 'no-such-branch')).toBe('none');
  });

  it('returns none when openspec/ has changes but no config.yaml', async () => {
    const root = makeScratchDir('cmp-nocfg');
    await initScratchRepo(root, { branch: 'main' });
    writeFileIn(root, 'openspec/changes/a-change/proposal.md', '# A change\n');
    await commitAll(root, 'no config');
    expect(await detectFramework(root, 'main')).toBe('none');
  });

  it('reads the base tip only: a config on another branch or uncommitted does not count', async () => {
    const root = makeScratchDir('cmp-tip');
    await initScratchRepo(root, { branch: 'main' });
    writeFileIn(root, 'README.md', '# plain repo\n');
    await commitAll(root, 'plain');
    await gitIn(root, ['checkout', '-q', '-b', 'feature']);
    writeFileIn(root, 'openspec/config.yaml', 'schema: spec-driven\n');
    await commitAll(root, 'config on feature');
    await gitIn(root, ['checkout', '-q', 'main']);
    writeFileIn(root, 'openspec/config.yaml', 'schema: spec-driven\n');
    expect(await detectFramework(root, 'main')).toBe('none');
    expect(await detectFramework(root, 'feature')).toBe('openspec');
  });
});

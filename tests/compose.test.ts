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
  it('returns the composed GSD adapter for a gsd host', () => {
    const adapter = adapterFor({ adapter: 'gsd' });
    expect(adapter).not.toBeNull();
    expect(adapter?.id).toBe('gsd');
    expect(FRAMEWORK_ADAPTERS).toContain(adapter);
  });

  it('returns null for a host with no framework (none) or an unknown id', () => {
    expect(adapterFor({ adapter: 'none' })).toBeNull();
    expect(adapterFor({ adapter: 'speckit' })).toBeNull();
  });

  it('composes exactly one adapter per id', () => {
    const ids = FRAMEWORK_ADAPTERS.map((adapter) => adapter.id);
    expect(ids).toEqual(['gsd']);
  });
});

describe('detectFramework', () => {
  it('returns gsd for a repository whose base tip has a GSD roadmap', async () => {
    expect(await detectFramework(synthetic.root, 'master')).toBe('gsd');
  });

  it('returns none for a repository without a roadmap', async () => {
    const root = makeScratchDir('cmp-none');
    await initScratchRepo(root, { branch: 'main' });
    writeFileIn(root, 'README.md', '# plain repo\n');
    await commitAll(root, 'plain');
    expect(await detectFramework(root, 'main')).toBe('none');
  });

  it('returns none when the base branch does not resolve', async () => {
    expect(await detectFramework(synthetic.root, 'no-such-branch')).toBe('none');
  });

  it('reads the base tip only: a roadmap on another branch or uncommitted does not count', async () => {
    const root = makeScratchDir('cmp-tip');
    await initScratchRepo(root, { branch: 'main' });
    writeFileIn(root, 'README.md', '# plain repo\n');
    await commitAll(root, 'plain');
    await gitIn(root, ['checkout', '-q', '-b', 'feature']);
    writeFileIn(root, '.planning/ROADMAP.md', '# Roadmap\n\n### Phase 1: Thing\n');
    await commitAll(root, 'roadmap on feature');
    await gitIn(root, ['checkout', '-q', 'main']);
    writeFileIn(root, '.planning/ROADMAP.md', '# Roadmap\n\n### Phase 1: Thing\n');
    expect(await detectFramework(root, 'main')).toBe('none');
    expect(await detectFramework(root, 'feature')).toBe('gsd');
  });
});

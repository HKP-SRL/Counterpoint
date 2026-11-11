// The single serialized path for planning writes (planning-writes: Single serialized write path).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { createOpenSpecAdapter } from '../../../src/adapters/openspec/index.ts';
import { runGit } from '../../../src/core/git/run.ts';
import {
  PlanningWrites,
  planningWriteLockFile,
  withPlanningWriteLock,
} from '../../../src/core/planning/writes.ts';
import { materializeOpenSpecHost } from '../../helpers/fixture-repo.ts';
import { makeScratchDir, removeScratchDirs } from '../../helpers/scratch.ts';

afterAll(removeScratchDirs);

const adapter = createOpenSpecAdapter();

async function setup() {
  const repo = await materializeOpenSpecHost({
    'openspec/config.yaml': 'schema: spec-driven\n',
    'openspec/changes/a-thing/tasks.md': '- [ ] 1.1 Do it\n',
    'src/app.ts': 'export {}\n',
  });
  const home = makeScratchDir('planning-home');
  const writes = new PlanningWrites({
    home,
    isPlanningPath: (_host, path) => adapter.isPlanningPath(path),
  });
  const host = { id: 'cena', root: repo.root, baseBranch: 'master' };
  return { repo, home, writes, host };
}

const tip = async (root: string) => (await runGit(root, ['rev-parse', 'master'])).stdout.trim();
const status = async (root: string) => (await runGit(root, ['status', '--porcelain'])).stdout;

describe('PlanningWrites', () => {
  it("lands one commit on the base branch and places the file in the owner's checkout", async () => {
    const { repo, writes, host } = await setup();
    const result = await writes.write(host, {
      message: 'counterpoint: tick 1.1 of a-thing',
      files: [{ path: 'openspec/changes/a-thing/tasks.md', content: '- [x] 1.1 Do it\n' }],
    });
    expect(result).toMatchObject({ ok: true, changed: true, placedIn: [repo.root] });
    if (!result.ok) return;
    expect(await tip(repo.root)).toBe(result.commit);
    const parent = (await runGit(repo.root, ['rev-parse', `${result.commit}^`])).stdout.trim();
    expect(parent).toBe(repo.commit);
    expect(readFileSync(join(repo.root, 'openspec/changes/a-thing/tasks.md'), 'utf8')).toBe(
      '- [x] 1.1 Do it\n',
    );
    expect(await status(repo.root)).toBe('');
    const author = (await runGit(repo.root, ['log', '-1', '--format=%an <%ae>|%s'])).stdout.trim();
    // Authored as the owner (the repository's git identity), not as Counterpoint.
    expect(author).toBe(
      'Counterpoint Test <test@counterpoint.invalid>|counterpoint: tick 1.1 of a-thing',
    );
  });

  it('lands two writes made at once one after the other, as separate commits', async () => {
    const { repo, writes, host } = await setup();
    const [first, second] = await Promise.all([
      writes.write(host, {
        message: 'first',
        files: [{ path: 'openspec/changes/a-thing/notes.md', content: 'one\n' }],
      }),
      writes.write(host, {
        message: 'second',
        files: [{ path: 'openspec/changes/b-thing/notes.md', content: 'two\n' }],
      }),
    ]);
    expect(first?.ok && second?.ok).toBe(true);
    const log = (await runGit(repo.root, ['log', '--format=%s', '-3'])).stdout.trim().split('\n');
    expect(log.slice(0, 2)).toEqual(['second', 'first']);
    expect(await status(repo.root)).toBe('');
  });

  it('refuses anything but planning files, and moves nothing', async () => {
    const { repo, writes, host } = await setup();
    for (const path of [
      'src/app.ts',
      '.counterpoint/config.yaml',
      '.claude/settings.json',
      '../x.md',
      'openspec/../src/app.ts',
    ]) {
      const result = await writes.write(host, { message: 'bad', files: [{ path, content: 'x' }] });
      expect(result).toMatchObject({ ok: false, reason: 'not-planning' });
    }
    expect(await tip(repo.root)).toBe(repo.commit);
  });

  it("refuses a path the owner is editing, keeping the owner's edit", async () => {
    const { repo, writes, host } = await setup();
    const file = join(repo.root, 'openspec/changes/a-thing/tasks.md');
    writeFileSync(file, '- [ ] 1.1 Do it, carefully\n');
    const result = await writes.write(host, {
      message: 'tick',
      files: [{ path: 'openspec/changes/a-thing/tasks.md', content: '- [x] 1.1 Do it\n' }],
    });
    expect(result).toMatchObject({ ok: false, reason: 'occupied' });
    expect(await tip(repo.root)).toBe(repo.commit);
    expect(readFileSync(file, 'utf8')).toBe('- [ ] 1.1 Do it, carefully\n');
  });

  it('makes no commit for a write that changes nothing', async () => {
    const { repo, writes, host } = await setup();
    const result = await writes.write(host, {
      message: 'same',
      files: [{ path: 'openspec/changes/a-thing/tasks.md', content: '- [ ] 1.1 Do it\n' }],
    });
    expect(result).toEqual({ ok: true, commit: repo.commit, changed: false, placedIn: [] });
  });

  it('waits while another process holds the planning-write lock', async () => {
    const { repo, home, writes, host } = await setup();
    await withPlanningWriteLock(home, async () => undefined); // creates the lock file
    const other = new DatabaseSync(planningWriteLockFile(home));
    other.exec('BEGIN EXCLUSIVE');
    let landed = false;
    const pending = writes
      .write(host, {
        message: 'after the lock',
        files: [{ path: 'openspec/changes/a-thing/notes.md', content: 'x\n' }],
      })
      .then((result) => {
        landed = true;
        return result;
      });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(landed).toBe(false);
    expect(await tip(repo.root)).toBe(repo.commit);
    other.exec('COMMIT');
    other.close();
    await expect(pending).resolves.toMatchObject({ ok: true, changed: true });
  });
});

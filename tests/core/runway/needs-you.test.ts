// Needs You (needs-you; runway: Uncommitted edits do not change the runway): drifted approvals
// become inbox items, derived from git each time. Approvals are landed with throwaway unprotected
// ed25519 keys in scratch repositories; the trust store and diff scratch live in scratch dirs.
// Nothing here touches ~/.ssh, ssh-agent, the Keychain or a real Counterpoint home.
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOpenSpecAdapter } from '../../../src/adapters/openspec/index.ts';
import { signAndLand } from '../../../src/core/approvals/commit.ts';
import { gatesDigest } from '../../../src/core/approvals/gates.ts';
import { signPayload } from '../../../src/core/approvals/ssh.ts';
import {
  approvalPath,
  buildStatement,
  serializeStatement,
} from '../../../src/core/approvals/statement.ts';
import { readTrust, type Trust, writeTrust } from '../../../src/core/approvals/trust-store.ts';
import { diffBytes } from '../../../src/core/git/diff.ts';
import { createGitFileReader } from '../../../src/core/git/reader.ts';
import {
  changedInputDiff,
  deriveNeedsYou,
  driftView,
  uncommittedEditsHint,
} from '../../../src/core/runway/needs-you.ts';
import { computeRunway } from '../../../src/core/runway/runway.ts';
import { type FixtureRepo, materializeFixtureRepo, SYNTHETIC } from '../../helpers/fixture-repo.ts';
import { makeThrowawayKey, type ThrowawayKey } from '../../helpers/keys.ts';
import { gitIn, makeScratchDir, removeScratchDirs, writeFileIn } from '../../helpers/scratch.ts';

const adapter = createOpenSpecAdapter();
const READY = SYNTHETIC.ready;
const SECOND = 'second-thing';
const CHANGE_DIR = `openspec/changes/${READY}`;
const PROPOSAL = `${CHANGE_DIR}/proposal.md`;
const DESIGN = `${CHANGE_DIR}/design.md`;
const TASKS = `${CHANGE_DIR}/tasks.md`;
const METADATA = `${CHANGE_DIR}/.openspec.yaml`;
const SPEC = `${CHANGE_DIR}/specs/ordering/spec.md`;
const SECOND_PROPOSAL = `openspec/changes/${SECOND}/proposal.md`;
const CONFIG = '.counterpoint/config.yaml';
const GATES_ROW = `${CONFIG}#gates`;
const TASK_21 = '- [ ] 2.1 Finish the ready thing';
const IDENT = { name: 'Owner', email: 'owner@counterpoint.invalid' };

let key: ThrowawayKey;
let trust: Trust;
let tmpDir: string;
let diffTmp: string;

beforeAll(async () => {
  key = await makeThrowawayKey(makeScratchDir('nkeys'));
  const home = makeScratchDir('nhome');
  await writeTrust(home, { publicKeyPath: key.publicKeyPath });
  const read = readTrust(home);
  if (!read.ok) throw new Error(read.detail);
  trust = read;
  tmpDir = makeScratchDir('ntmp');
  diffTmp = makeScratchDir('ndiff');
});

afterAll(() => removeScratchDirs());

/** Lands a real signed approval of `changeId` built from the inputs at master's tip. */
async function land(repo: FixtureRepo, changeId: string): Promise<void> {
  const reader = createGitFileReader(repo.root);
  const tip = (await reader.resolve('refs/heads/master')) as string;
  const statement = buildStatement({
    hostId: 'synthetic',
    changeId,
    baseBranch: 'master',
    tip,
    inputs: await adapter.approvalInputs(reader, tip, changeId),
    gates: await gatesDigest(reader, tip),
  });
  const landed = await signAndLand({
    root: repo.root,
    baseBranch: 'master',
    itemPath: approvalPath(changeId),
    fileBytes: new TextEncoder().encode(serializeStatement(statement)),
    message: `counterpoint: approve change ${changeId}`,
    ident: IDENT,
    sign: (payload) => signPayload({ payload, privateKeyPath: key.privateKeyPath }),
  });
  if (!landed.ok) throw new Error(`landing refused: ${landed.reason}`);
}

function text(root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

/** A second ready change, committed, so two approvals can drift at once. */
async function addSecondChange(repo: FixtureRepo): Promise<void> {
  await commitAt(
    repo.root,
    {
      [`openspec/changes/${SECOND}/.openspec.yaml`]: 'schema: spec-driven\ncreated: 2026-10-06\n',
      [SECOND_PROPOSAL]: '# Second thing\n\n## Why\n\nAnother change.\n',
      [`openspec/changes/${SECOND}/tasks.md`]: '- [ ] 1.1 Do the second thing\n',
    },
    1_900_000_000,
  );
}

/**
 * Writes (or deletes, with null) files and commits them on master with a fixed committer time,
 * so ordering by commit time is deterministic. Returns the commit sha.
 */
async function commitAt(
  root: string,
  files: Record<string, string | null>,
  epochSeconds: number,
): Promise<string> {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) rmSync(join(root, path), { force: true });
    else writeFileIn(root, path, content);
  }
  await gitIn(root, ['add', '-A']);
  const date = `@${epochSeconds} +0000`;
  await execa(
    'git',
    ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', 'commit', '-q', '-m', 'edit'],
    {
      cwd: root,
      extendEnv: false,
      stdin: 'ignore',
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: process.env.HOME ?? '/',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      },
    },
  );
  return (await gitIn(root, ['rev-parse', 'HEAD'])).trim();
}

async function runwayOf(repo: FixtureRepo) {
  return computeRunway({
    hostId: 'synthetic',
    root: repo.root,
    baseBranch: 'master',
    reader: createGitFileReader(repo.root),
    adapter,
    trust,
    tmpDir,
  });
}

async function needsYouOf(repo: FixtureRepo) {
  const runway = await runwayOf(repo);
  const items = await deriveNeedsYou({
    root: repo.root,
    baseBranch: 'master',
    tip: runway.tip as string,
    changed: runway.changed,
    reader: createGitFileReader(repo.root),
    adapter,
  });
  return { runway, items };
}

function changedOf(runway: Awaited<ReturnType<typeof runwayOf>>, changeId: string) {
  const found = runway.changed.find((c) => c.changeId === changeId);
  if (found === undefined) throw new Error(`change ${changeId} is not changed`);
  return found;
}

function only<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

/** The lines after the first hunk header, without hunk headers or "no newline" markers. */
function bodyLines(diff: string): string[] {
  const lines = diff.split('\n');
  const first = lines.findIndex((line) => line.startsWith('@@'));
  if (first < 0) return [];
  return lines
    .slice(first)
    .filter((line) => line !== '' && !line.startsWith('@@') && !line.startsWith('\\'));
}

describe('deriveNeedsYou', () => {
  it('lists nothing when no approval changed', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await land(repo, READY);
    const { runway, items } = await needsYouOf(repo);
    expect(runway.changed).toEqual([]);
    expect(items).toEqual([]);
  });

  it('lists nothing when only task boxes were ticked after signing', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await land(repo, READY);
    await commitAt(
      repo.root,
      { [TASKS]: text(repo.root, TASKS).replace(TASK_21, '- [x] 2.1 Finish the ready thing') },
      2_000_000_000,
    );
    const { runway, items } = await needsYouOf(repo);
    expect(runway.count).toBe(1);
    expect(items).toEqual([]);
  });

  it('turns two approvals changed by one commit into two items, one per change', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await addSecondChange(repo);
    await land(repo, READY);
    await land(repo, SECOND);
    await commitAt(
      repo.root,
      {
        [PROPOSAL]: `${text(repo.root, PROPOSAL)}\nOne more reason.\n`,
        [SECOND_PROPOSAL]: `${text(repo.root, SECOND_PROPOSAL)}\nAlso changed.\n`,
      },
      2_000_000_000,
    );

    const { items } = await needsYouOf(repo);
    expect(items.map((item) => item.id)).toEqual([READY, SECOND]);
    for (const item of items) {
      expect(item.kind).toBe('approved-version-changed');
      expect(item.kindLabel).toBe('Approved version changed');
      expect(item.changedCount).toBe(1);
      expect(item.gatesChanged).toBe(false);
      expect(item.unreadable).toBe(false);
    }
    expect(items[0]?.title).toBe('Ready thing changed since you signed it');
    expect(items[1]?.title).toBe('Second thing changed since you signed it');
    expect(items[0]?.changeId).toBe(READY);
    expect(items[1]?.changeId).toBe(SECOND);
    // Same commit: equal times, so the order falls back to the change id.
    expect(items[0]?.changedAt).toBe(items[1]?.changedAt);
    expect(items[0]?.changedAt).toBe(new Date(2_000_000_000 * 1000).toISOString());
  });

  it('orders the newest edit first, before the change id', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await addSecondChange(repo);
    await land(repo, READY);
    await land(repo, SECOND);
    await commitAt(
      repo.root,
      { [PROPOSAL]: `${text(repo.root, PROPOSAL)}\nOlder.\n` },
      2_000_000_000,
    );
    await commitAt(
      repo.root,
      { [SECOND_PROPOSAL]: `${text(repo.root, SECOND_PROPOSAL)}\nNewer.\n` },
      2_000_000_500,
    );

    const { items } = await needsYouOf(repo);
    expect(items.map((item) => item.id)).toEqual([SECOND, READY]);
    expect(items[0]?.changedAt).toBe(new Date(2_000_000_500 * 1000).toISOString());
    expect(items[1]?.changedAt).toBe(new Date(2_000_000_000 * 1000).toISOString());
  });

  it('marks an item whose change cannot be read, and still lists it', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await land(repo, READY);
    await commitAt(
      repo.root,
      { [PROPOSAL]: `${text(repo.root, PROPOSAL)}\nEdit.\n` },
      2_000_000_000,
    );
    const runway = await runwayOf(repo);
    const items = await deriveNeedsYou({
      root: repo.root,
      baseBranch: 'master',
      tip: runway.tip as string,
      changed: runway.changed,
      reader: createGitFileReader(repo.root),
      adapter,
      changes: [
        {
          id: READY,
          archived: false,
          title: 'Ready thing',
          unreadable: { file: METADATA, reason: 'bad YAML' },
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.unreadable).toBe(true);
  });
});

describe('driftView and changedInputDiff', () => {
  let repo: FixtureRepo;
  let runway: Awaited<ReturnType<typeof runwayOf>>;
  let signedTip: string;

  beforeAll(async () => {
    repo = await materializeFixtureRepo('synthetic');
    // The statement's base commit is the tip it was prepared at, before the approval lands.
    signedTip = (await gitIn(repo.root, ['rev-parse', 'master'])).trim();
    await land(repo, READY);
    // One commit: a modified proposal, an added spec, a removed design and a reworded task (with
    // another task ticked, which the normalized diff does not show).
    await commitAt(
      repo.root,
      {
        [PROPOSAL]: `${text(repo.root, PROPOSAL)}\nA new reason line.\n`,
        [SPEC]: '# Spec\n\nFirst line.\nSecond line.\n',
        [DESIGN]: null,
        [TASKS]: text(repo.root, TASKS)
          .replace(TASK_21, '- [ ] 2.1 Finish it later')
          .replace('- [ ] 1.1', '- [x] 1.1'),
      },
      2_000_000_000,
    );
    runway = await runwayOf(repo);
  });

  const diffOf = (path: string) => {
    const c = changedOf(runway, READY);
    return changedInputDiff({
      root: repo.root,
      reader: createGitFileReader(repo.root),
      adapter,
      statement: c.statement,
      changes: c.changes,
      gatesChange: c.gatesChange,
      tip: runway.tip as string,
      changeId: READY,
      path,
      tmpDir: diffTmp,
    });
  };

  it('builds the lead facts, the rows sorted by path and the re-sign command', async () => {
    const c = changedOf(runway, READY);
    const item = only(
      (
        await deriveNeedsYou({
          root: repo.root,
          baseBranch: 'master',
          tip: runway.tip as string,
          changed: runway.changed,
          reader: createGitFileReader(repo.root),
          adapter,
        })
      )[0],
    );
    const view = driftView({
      item,
      statement: c.statement,
      changes: c.changes,
      gatesChange: c.gatesChange,
      tip: runway.tip as string,
      baseBranch: 'master',
      hostId: 'synthetic',
    });
    expect(view.lead).toEqual({
      signedAt: c.signedAt,
      signedBase: signedTip,
      tip: runway.tip,
      baseBranch: 'master',
      changedCount: 4,
      gatesChanged: false,
    });
    const paths = view.changes.map((row: { path: string }) => row.path);
    expect(paths).toEqual([DESIGN, PROPOSAL, SPEC, TASKS]);
    expect(view.changes.find((row: { path: string }) => row.path === PROPOSAL)).toMatchObject({
      change: 'modified',
      kind: 'proposal',
    });
    expect(view.changes.find((row: { path: string }) => row.path === SPEC)).toMatchObject({
      change: 'added',
      signedDigest: null,
    });
    expect(view.changes.find((row: { path: string }) => row.path === DESIGN)).toMatchObject({
      change: 'removed',
      nowDigest: null,
    });
    expect(view.command).toBe(`counterpoint approve synthetic ${READY}`);
  });

  it('diffs a modified file under its logical path', async () => {
    const { diff, truncated } = await diffOf(PROPOSAL);
    expect(truncated).toBe(false);
    expect(diff.startsWith(`diff --git a/${PROPOSAL} b/${PROPOSAL}\n`)).toBe(true);
    expect(diff).toContain(`\n--- a/${PROPOSAL}\n`);
    expect(diff).toContain(`\n+++ b/${PROPOSAL}\n`);
    expect(bodyLines(diff)).toContain('+A new reason line.');
    expect(diff).not.toContain(diffTmp);
  });

  it('diffs an added file as all added lines', async () => {
    const { diff } = await diffOf(SPEC);
    expect(diff).toContain('\n--- /dev/null\n');
    expect(diff).toContain(`\n+++ b/${SPEC}\n`);
    const body = bodyLines(diff);
    expect(body.length).toBe(4);
    expect(body.every((line) => line.startsWith('+'))).toBe(true);
  });

  it('diffs a removed file as all removed lines', async () => {
    const { diff } = await diffOf(DESIGN);
    expect(diff).toContain(`\n--- a/${DESIGN}\n`);
    expect(diff).toContain('\n+++ /dev/null\n');
    const body = bodyLines(diff);
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((line) => line.startsWith('-'))).toBe(true);
  });

  it('diffs the normalized text of tasks.md at both commits: rewording shows, ticking does not', async () => {
    const { diff } = await diffOf(TASKS);
    expect(diff.startsWith(`diff --git a/${TASKS} b/${TASKS}\n`)).toBe(true);
    const body = bodyLines(diff);
    expect(body).toContain(`-${TASK_21}`);
    expect(body).toContain('+- [ ] 2.1 Finish it later');
    expect(body.filter((line) => line.startsWith('+') || line.startsWith('-'))).toHaveLength(2);
    expect(diff).not.toContain('[x]');
  });

  it('refuses a path that is not in the change list', async () => {
    await expect(diffOf(METADATA)).rejects.toThrow();
    await expect(diffOf('../../etc/passwd')).rejects.toThrow();
  });

  it('removes its temporary files', () => {
    expect(readdirSync(diffTmp)).toEqual([]);
  });
});

describe('gate config drift', () => {
  it('lists a gates-only change as its own Gate config row with a diff of the gates section', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await land(repo, READY);
    const sha = await commitAt(
      repo.root,
      { [CONFIG]: '# host config\ngates:\n  lint: pnpm lint\n  test: pnpm test\n' },
      2_000_000_100,
    );
    const ct = Number.parseInt(
      (await gitIn(repo.root, ['log', '-1', '--format=%ct', sha])).trim(),
      10,
    );

    const { runway, items } = await needsYouOf(repo);
    expect(items).toHaveLength(1);
    const item = only(items[0]);
    expect(item?.changedCount).toBe(0);
    expect(item?.gatesChanged).toBe(true);
    expect(item?.changedAt).toBe(new Date(ct * 1000).toISOString());

    const c = changedOf(runway, READY);
    const view = driftView({
      item,
      statement: c.statement,
      changes: c.changes,
      gatesChange: c.gatesChange,
      tip: runway.tip as string,
      baseBranch: 'master',
      hostId: 'synthetic',
    });
    expect(view.lead.gatesChanged).toBe(true);
    expect(view.lead.changedCount).toBe(0);
    expect(view.changes).toHaveLength(1);
    expect(view.changes[0]).toMatchObject({
      path: GATES_ROW,
      label: 'Gate config',
      kind: 'gates',
      change: 'added',
      signedDigest: null,
    });
    expect(only(view.changes[0]).nowDigest).toMatch(/^sha256:[0-9a-f]{64}$/);

    const { diff } = await changedInputDiff({
      root: repo.root,
      reader: createGitFileReader(repo.root),
      adapter,
      statement: c.statement,
      changes: c.changes,
      gatesChange: c.gatesChange,
      tip: runway.tip as string,
      changeId: READY,
      path: GATES_ROW,
      tmpDir: diffTmp,
    });
    expect(diff.startsWith(`diff --git a/${CONFIG} (gates) b/${CONFIG} (gates)\n`)).toBe(true);
    const body = bodyLines(diff);
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((line) => line.startsWith('+'))).toBe(true);
    expect(body).toContain('+  "lint": "pnpm lint",');
    // Comments and other keys are not part of the gates diff.
    expect(diff).not.toContain('host config');
  });

  it('lists input rows first, then the Gate config row, when both changed', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await land(repo, READY);
    await commitAt(
      repo.root,
      {
        [CONFIG]: 'gates:\n  lint: pnpm lint\n',
        [PROPOSAL]: `${text(repo.root, PROPOSAL)}\nAnd an input.\n`,
      },
      2_000_000_200,
    );
    const { runway, items } = await needsYouOf(repo);
    expect(items[0]?.changedCount).toBe(1);
    expect(items[0]?.gatesChanged).toBe(true);
    const c = changedOf(runway, READY);
    const view = driftView({
      item: only(items[0]),
      statement: c.statement,
      changes: c.changes,
      gatesChange: c.gatesChange,
      tip: runway.tip as string,
      baseBranch: 'master',
      hostId: 'synthetic',
    });
    expect(view.changes.map((row: { path: string }) => row.path)).toEqual([PROPOSAL, GATES_ROW]);
  });
});

describe('diffBytes', () => {
  it('caps output at 5,000 lines and reports truncation', async () => {
    const after = Array.from({ length: 6_000 }, (_, i) => `line ${i}`).join('\n');
    const { diff, truncated } = await diffBytes({
      root: diffTmp,
      tmpDir: diffTmp,
      logicalPath: 'big.txt',
      before: null,
      after: new TextEncoder().encode(`${after}\n`),
    });
    expect(truncated).toBe(true);
    expect(diff.split('\n').length).toBeLessThanOrEqual(5_000);
    expect(diff.startsWith('diff --git a/big.txt b/big.txt\n')).toBe(true);
    expect(readdirSync(diffTmp)).toEqual([]);
  });

  it('returns an empty diff for identical content', async () => {
    const same = new TextEncoder().encode('same\n');
    const { diff, truncated } = await diffBytes({
      root: diffTmp,
      tmpDir: diffTmp,
      logicalPath: 'same.txt',
      before: same,
      after: same,
    });
    expect(diff).toBe('');
    expect(truncated).toBe(false);
  });
});

describe('uncommittedEditsHint (soft hint for uncommitted edits)', () => {
  let repo: FixtureRepo;

  beforeAll(async () => {
    repo = await materializeFixtureRepo('synthetic');
    await land(repo, READY);
  });

  const hint = () =>
    uncommittedEditsHint({
      root: repo.root,
      reader: createGitFileReader(repo.root),
      adapter,
      changeId: READY,
    });

  const restore = (path: string) => gitIn(repo.root, ['checkout', '--', path]);

  it('is false for a clean checkout', async () => {
    expect(await hint()).toBe(false);
  });

  it('is true for an unstaged edit to the proposal', async () => {
    writeFileIn(repo.root, PROPOSAL, `${text(repo.root, PROPOSAL)}\nNot committed.\n`);
    try {
      expect(await hint()).toBe(true);
    } finally {
      await restore(PROPOSAL);
    }
  });

  it('is false when only a task box is ticked locally', async () => {
    writeFileIn(
      repo.root,
      TASKS,
      text(repo.root, TASKS).replace(TASK_21, '- [x] 2.1 Finish the ready thing'),
    );
    try {
      expect(await hint()).toBe(false);
    } finally {
      await restore(TASKS);
    }
  });

  it('is true when a task is reworded locally', async () => {
    writeFileIn(
      repo.root,
      TASKS,
      text(repo.root, TASKS).replace(TASK_21, '- [ ] 2.1 Edited, not committed'),
    );
    try {
      expect(await hint()).toBe(true);
    } finally {
      await restore(TASKS);
    }
  });
});

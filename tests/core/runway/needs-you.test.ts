// Needs You (MISN-02, APPR-02, D-03, D-04): drifted approvals become inbox items, derived from
// git each time. Approvals are landed with throwaway unprotected ed25519 keys in scratch
// repositories; the trust store and diff scratch live in scratch dirs. Nothing here touches
// ~/.ssh, ssh-agent, the Keychain or a real Counterpoint home.
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGsdAdapter } from '../../../src/adapters/gsd/index.ts';
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
  changeView,
  deriveNeedsYou,
  uncommittedEditsHint,
} from '../../../src/core/runway/needs-you.ts';
import { computeRunway } from '../../../src/core/runway/runway.ts';
import { type FixtureRepo, materializeFixtureRepo } from '../../helpers/fixture-repo.ts';
import { makeThrowawayKey, type ThrowawayKey } from '../../helpers/keys.ts';
import { gitIn, makeScratchDir, removeScratchDirs, writeFileIn } from '../../helpers/scratch.ts';

const adapter = createGsdAdapter();
const PHASE_DIR = '.planning/phases/02-ready-thing';
const CONTEXT = `${PHASE_DIR}/02-CONTEXT.md`;
const RESEARCH = `${PHASE_DIR}/02-RESEARCH.md`;
const SPEC = `${PHASE_DIR}/02-SPEC.md`;
const PLAN_01 = `${PHASE_DIR}/02-01-PLAN.md`;
const INSERTED_CONTEXT = '.planning/phases/02.1-inserted-thing/02.1-CONTEXT.md';
const ROADMAP = '.planning/ROADMAP.md';
const ROADMAP_02 = `${ROADMAP}#phase-02`;
const CONFIG = '.counterpoint/config.yaml';
const GATES_ROW = `${CONFIG}#gates`;
const GOAL_02 = '**Goal**: A phase that has its context and two plans, ready to approve.';
const GOAL_021 = '**Goal:** An inserted phase that has been discussed but not planned.';
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

/** Lands a real signed approval of `phaseId` built from the inputs at master's tip. */
async function land(repo: FixtureRepo, phaseId: string): Promise<void> {
  const reader = createGitFileReader(repo.root);
  const tip = (await reader.resolve('refs/heads/master')) as string;
  const statement = buildStatement({
    hostId: 'synthetic',
    phaseId,
    baseBranch: 'master',
    tip,
    inputs: await adapter.approvalInputs(reader, tip, phaseId),
    gates: await gatesDigest(reader, tip),
  });
  const landed = await signAndLand({
    root: repo.root,
    baseBranch: 'master',
    itemPath: approvalPath(phaseId),
    fileBytes: new TextEncoder().encode(serializeStatement(statement)),
    message: `counterpoint: approve phase ${phaseId}`,
    ident: IDENT,
    sign: (payload) => signPayload({ payload, privateKeyPath: key.privateKeyPath }),
  });
  if (!landed.ok) throw new Error(`landing refused: ${landed.reason}`);
}

function text(root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8');
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

function changedOf(runway: Awaited<ReturnType<typeof runwayOf>>, phaseId: string) {
  const found = runway.changed.find((c) => c.phaseId === phaseId);
  if (found === undefined) throw new Error(`phase ${phaseId} is not changed`);
  return found;
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
    await land(repo, '02');
    const { runway, items } = await needsYouOf(repo);
    expect(runway.changed).toEqual([]);
    expect(items).toEqual([]);
  });

  it('turns two approvals changed by one commit into two items, one per phase', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await land(repo, '02');
    await land(repo, '02.1');
    await commitAt(
      repo.root,
      {
        [CONTEXT]: `${text(repo.root, CONTEXT)}\nOne more decision.\n`,
        [INSERTED_CONTEXT]: `${text(repo.root, INSERTED_CONTEXT)}\nAlso changed.\n`,
      },
      2_000_000_000,
    );

    const { items } = await needsYouOf(repo);
    expect(items.map((item) => item.id)).toEqual(['phase-02', 'phase-02.1']);
    for (const item of items) {
      expect(item.kind).toBe('approved-version-changed');
      expect(item.kindLabel).toBe('Approved version changed');
      expect(item.changedCount).toBe(1);
      expect(item.gatesChanged).toBe(false);
      expect(item.unreadable).toBe(false);
    }
    expect(items[0]?.title).toBe('Phase 02 changed since you signed it');
    expect(items[1]?.title).toBe('Phase 02.1 changed since you signed it');
    expect(items[0]?.phaseId).toBe('02');
    expect(items[1]?.phaseId).toBe('02.1');
    // Same commit: equal times, so the order falls back to the phase number.
    expect(items[0]?.changedAt).toBe(items[1]?.changedAt);
    expect(items[0]?.changedAt).toBe(new Date(2_000_000_000 * 1000).toISOString());
  });

  it('orders newest change first, before the phase number', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await land(repo, '02');
    await land(repo, '02.1');
    await commitAt(repo.root, { [CONTEXT]: `${text(repo.root, CONTEXT)}\nOlder.\n` }, 2_000_000_000);
    await commitAt(
      repo.root,
      { [INSERTED_CONTEXT]: `${text(repo.root, INSERTED_CONTEXT)}\nNewer.\n` },
      2_000_000_500,
    );

    const { items } = await needsYouOf(repo);
    expect(items.map((item) => item.id)).toEqual(['phase-02.1', 'phase-02']);
    expect(items[0]?.changedAt).toBe(new Date(2_000_000_500 * 1000).toISOString());
    expect(items[1]?.changedAt).toBe(new Date(2_000_000_000 * 1000).toISOString());
  });

  it('marks an item whose phase cannot be read, and still lists it', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await land(repo, '02');
    await commitAt(repo.root, { [CONTEXT]: `${text(repo.root, CONTEXT)}\nEdit.\n` }, 2_000_000_000);
    const runway = await runwayOf(repo);
    const items = await deriveNeedsYou({
      root: repo.root,
      baseBranch: 'master',
      tip: runway.tip as string,
      changed: runway.changed,
      reader: createGitFileReader(repo.root),
      adapter,
      phases: [{ id: '02', unreadable: { file: PLAN_01, reason: 'bad frontmatter' } }],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.unreadable).toBe(true);
  });
});

describe('changeView and changedInputDiff', () => {
  let repo: FixtureRepo;
  let runway: Awaited<ReturnType<typeof runwayOf>>;
  let signedTip: string;

  beforeAll(async () => {
    repo = await materializeFixtureRepo('synthetic');
    await land(repo, '02');
    signedTip = (await gitIn(repo.root, ['rev-parse', 'master'])).trim();
    // One commit: a modified CONTEXT, an added SPEC, a removed RESEARCH and a new Phase 02 goal.
    await commitAt(
      repo.root,
      {
        [CONTEXT]: `${text(repo.root, CONTEXT)}\nA new decision line.\n`,
        [SPEC]: '# Spec\n\nFirst line.\nSecond line.\n',
        [RESEARCH]: null,
        [ROADMAP]: text(repo.root, ROADMAP).replace(GOAL_02, '**Goal**: A changed goal.'),
      },
      2_000_000_000,
    );
    runway = await runwayOf(repo);
  });

  const diffOf = (path: string) => {
    const c = changedOf(runway, '02');
    return changedInputDiff({
      root: repo.root,
      reader: createGitFileReader(repo.root),
      adapter,
      statement: c.statement,
      changes: c.changes,
      gatesChange: c.gatesChange,
      tip: runway.tip as string,
      phaseId: '02',
      path,
      tmpDir: diffTmp,
    });
  };

  it('builds the lead facts, the rows sorted by path and the re-sign command', async () => {
    const c = changedOf(runway, '02');
    const [item] = await deriveNeedsYou({
      root: repo.root,
      baseBranch: 'master',
      tip: runway.tip as string,
      changed: runway.changed,
      reader: createGitFileReader(repo.root),
      adapter,
    });
    const view = changeView({
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
    expect(paths).toEqual([ROADMAP_02, CONTEXT, RESEARCH, SPEC].sort());
    expect(view.changes.find((row: { path: string }) => row.path === CONTEXT)).toMatchObject({
      change: 'modified',
      kind: 'context',
    });
    expect(view.changes.find((row: { path: string }) => row.path === SPEC)).toMatchObject({
      change: 'added',
      signedDigest: null,
    });
    expect(view.changes.find((row: { path: string }) => row.path === RESEARCH)).toMatchObject({
      change: 'removed',
      nowDigest: null,
    });
    expect(view.command).toBe('counterpoint approve synthetic 02');
  });

  it('diffs a modified file under its logical path', async () => {
    const { diff, truncated } = await diffOf(CONTEXT);
    expect(truncated).toBe(false);
    expect(diff.startsWith(`diff --git a/${CONTEXT} b/${CONTEXT}\n`)).toBe(true);
    expect(diff).toContain(`\n--- a/${CONTEXT}\n`);
    expect(diff).toContain(`\n+++ b/${CONTEXT}\n`);
    expect(bodyLines(diff)).toContain('+A new decision line.');
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
    const { diff } = await diffOf(RESEARCH);
    expect(diff).toContain(`\n--- a/${RESEARCH}\n`);
    expect(diff).toContain('\n+++ /dev/null\n');
    const body = bodyLines(diff);
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((line) => line.startsWith('-'))).toBe(true);
  });

  it('diffs the normalized section text of a derived input at both commits', async () => {
    const { diff } = await diffOf(ROADMAP_02);
    expect(diff.startsWith(`diff --git a/${ROADMAP_02} b/${ROADMAP_02}\n`)).toBe(true);
    const body = bodyLines(diff);
    expect(body).toContain(`-${GOAL_02}`);
    expect(body).toContain('+**Goal**: A changed goal.');
    // Only Phase 02's section, never the rest of the file.
    expect(diff).not.toContain('Inserted Thing');
  });

  it('refuses a path that is not in the change list', async () => {
    await expect(diffOf(PLAN_01)).rejects.toThrow();
    await expect(diffOf('../../etc/passwd')).rejects.toThrow();
  });

  it('removes its temporary files', () => {
    expect(readdirSync(diffTmp)).toEqual([]);
  });
});

describe('gate config drift', () => {
  it('lists a gates-only change as its own Gate config row with a diff of the gates section', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await land(repo, '02');
    const sha = await commitAt(
      repo.root,
      { [CONFIG]: '# host config\ngates:\n  lint: pnpm lint\n  test: pnpm test\n' },
      2_000_000_100,
    );
    const ct = Number.parseInt((await gitIn(repo.root, ['log', '-1', '--format=%ct', sha])).trim(), 10);

    const { runway, items } = await needsYouOf(repo);
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item?.changedCount).toBe(0);
    expect(item?.gatesChanged).toBe(true);
    expect(item?.changedAt).toBe(new Date(ct * 1000).toISOString());

    const c = changedOf(runway, '02');
    const view = changeView({
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
    expect(view.changes[0].nowDigest).toMatch(/^sha256:[0-9a-f]{64}$/);

    const { diff } = await changedInputDiff({
      root: repo.root,
      reader: createGitFileReader(repo.root),
      adapter,
      statement: c.statement,
      changes: c.changes,
      gatesChange: c.gatesChange,
      tip: runway.tip as string,
      phaseId: '02',
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
    await land(repo, '02');
    await commitAt(
      repo.root,
      {
        [CONFIG]: 'gates:\n  lint: pnpm lint\n',
        [CONTEXT]: `${text(repo.root, CONTEXT)}\nAnd an input.\n`,
      },
      2_000_000_200,
    );
    const { runway, items } = await needsYouOf(repo);
    expect(items[0]?.changedCount).toBe(1);
    expect(items[0]?.gatesChanged).toBe(true);
    const c = changedOf(runway, '02');
    const view = changeView({
      item: items[0],
      statement: c.statement,
      changes: c.changes,
      gatesChange: c.gatesChange,
      tip: runway.tip as string,
      baseBranch: 'master',
      hostId: 'synthetic',
    });
    expect(view.changes.map((row: { path: string }) => row.path)).toEqual([CONTEXT, GATES_ROW]);
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

describe('uncommittedEditsHint (D-03)', () => {
  let repo: FixtureRepo;

  beforeAll(async () => {
    repo = await materializeFixtureRepo('synthetic');
    await land(repo, '02');
  });

  const hint = () =>
    uncommittedEditsHint({
      root: repo.root,
      reader: createGitFileReader(repo.root),
      adapter,
      phaseId: '02',
    });

  const restore = (path: string) => gitIn(repo.root, ['checkout', '--', path]);

  it('is false for a clean checkout', async () => {
    expect(await hint()).toBe(false);
  });

  it('is true for an unstaged edit to an input file', async () => {
    writeFileIn(repo.root, CONTEXT, `${text(repo.root, CONTEXT)}\nNot committed.\n`);
    try {
      expect(await hint()).toBe(true);
    } finally {
      await restore(CONTEXT);
    }
  });

  it('is false for an edit to another phase section of the shared roadmap', async () => {
    writeFileIn(repo.root, ROADMAP, text(repo.root, ROADMAP).replace(GOAL_021, '**Goal:** Other.'));
    try {
      expect(await hint()).toBe(false);
    } finally {
      await restore(ROADMAP);
    }
  });

  it('is true for an edit to this phase section of the roadmap', async () => {
    writeFileIn(
      repo.root,
      ROADMAP,
      text(repo.root, ROADMAP).replace(GOAL_02, '**Goal**: Edited, not committed.'),
    );
    try {
      expect(await hint()).toBe(true);
    } finally {
      await restore(ROADMAP);
    }
  });
});

// Approval state and runway, recomputed from git (runway: Runway recomputed from git). Approvals
// are landed with throwaway unprotected ed25519 keys in scratch repositories; the trust store lives
// in a scratch home. Nothing here touches ~/.ssh, ssh-agent, the Keychain or a real Counterpoint
// home.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOpenSpecAdapter } from '../../../src/adapters/openspec/index.ts';
import { signAndLand } from '../../../src/core/approvals/commit.ts';
import { COUNTERPOINT_CONFIG_PATH, gatesDigest } from '../../../src/core/approvals/gates.ts';
import { prepareApproval } from '../../../src/core/approvals/prepare.ts';
import { signPayload } from '../../../src/core/approvals/ssh.ts';
import {
  approvalPath,
  buildStatement,
  serializeStatement,
} from '../../../src/core/approvals/statement.ts';
import {
  readPublicKey,
  readTrust,
  type Trust,
  writeTrust,
} from '../../../src/core/approvals/trust-store.ts';
import { createGitFileReader } from '../../../src/core/git/reader.ts';
import { approvalState, compareInputs, computeRunway } from '../../../src/core/runway/runway.ts';
import {
  commitChange,
  type FixtureRepo,
  materializeFixtureRepo,
  SYNTHETIC,
} from '../../helpers/fixture-repo.ts';
import { makeThrowawayKey, type ThrowawayKey } from '../../helpers/keys.ts';
import { gitIn, makeScratchDir, removeScratchDirs } from '../../helpers/scratch.ts';

const adapter = createOpenSpecAdapter();
const READY = SYNTHETIC.ready;
const CHANGE_DIR = `openspec/changes/${READY}`;
const PROPOSAL = `${CHANGE_DIR}/proposal.md`;
const DESIGN = `${CHANGE_DIR}/design.md`;
const TASKS = `${CHANGE_DIR}/tasks.md`;
const SPEC = `${CHANGE_DIR}/specs/ordering/spec.md`;
const IDENT = { name: 'Owner', email: 'owner@counterpoint.invalid' };

let key: ThrowawayKey;
let trust: Trust;
let tmpDir: string;

beforeAll(async () => {
  const keysDir = makeScratchDir('rkeys');
  key = await makeThrowawayKey(keysDir);
  const home = makeScratchDir('rhome');
  await writeTrust(home, {
    publicKeyPath: key.publicKeyPath,
    confirmed: readPublicKey(key.publicKeyPath),
  });
  const read = readTrust(home);
  if (!read.ok) throw new Error(read.detail);
  trust = read;
  tmpDir = makeScratchDir('rtmp');
});

afterAll(() => removeScratchDirs());

/** The exact committed bytes at master (git output through execa would lose the final newline). */
async function showAtMaster(root: string, path: string): Promise<Uint8Array> {
  const reader = createGitFileReader(root);
  const bytes = await reader.read((await reader.resolve('refs/heads/master')) as string, path);
  if (bytes === null) throw new Error(`${path} missing at master`);
  return bytes;
}

function appended(bytes: Uint8Array, text: string): Uint8Array {
  return Buffer.concat([bytes, Buffer.from(text)]);
}

/** Prepares and lands a real signed approval of `changeId` at master's tip. */
async function approve(repo: FixtureRepo, changeId: string = READY): Promise<string> {
  const prepared = await prepareApproval({
    hostId: 'synthetic',
    baseBranch: 'master',
    changeId,
    reader: createGitFileReader(repo.root),
    adapter,
  });
  if (!prepared.ok) throw new Error(`prepare refused: ${prepared.reason}`);
  const landed = await signAndLand({
    root: repo.root,
    baseBranch: 'master',
    itemPath: prepared.itemPath,
    fileBytes: prepared.bytes,
    message: `counterpoint: approve change ${changeId}`,
    ident: IDENT,
    sign: (payload) => signPayload({ payload, privateKeyPath: key.privateKeyPath }),
  });
  if (!landed.ok) throw new Error(`landing refused: ${landed.reason}`);
  return landed.commit;
}

/** Lands an arbitrary statement (for mismatch cases and built changes). */
async function landStatement(
  repo: FixtureRepo,
  itemChangeId: string,
  statementOptions: { hostId: string; changeId: string },
): Promise<void> {
  const reader = createGitFileReader(repo.root);
  const tip = (await reader.resolve('refs/heads/master')) as string;
  const inputs = await adapter.approvalInputs(reader, tip, statementOptions.changeId);
  const statement = buildStatement({
    ...statementOptions,
    baseBranch: 'master',
    tip,
    inputs,
    gates: await gatesDigest(reader, tip),
  });
  const landed = await signAndLand({
    root: repo.root,
    baseBranch: 'master',
    itemPath: approvalPath(itemChangeId),
    fileBytes: new TextEncoder().encode(serializeStatement(statement)),
    message: 'counterpoint: approve',
    ident: IDENT,
    sign: (payload) => signPayload({ payload, privateKeyPath: key.privateKeyPath }),
  });
  if (!landed.ok) throw new Error(`landing refused: ${landed.reason}`);
}

function stateOf(
  repo: FixtureRepo,
  changeId: string = READY,
  hostId = 'synthetic',
  withTrust = true,
) {
  return approvalState({
    hostId,
    root: repo.root,
    baseBranch: 'master',
    changeId,
    reader: createGitFileReader(repo.root),
    adapter,
    trust: withTrust ? trust : null,
    tmpDir,
  });
}

function runwayOf(repo: FixtureRepo, withTrust = true) {
  return computeRunway({
    hostId: 'synthetic',
    root: repo.root,
    baseBranch: 'master',
    reader: createGitFileReader(repo.root),
    adapter,
    trust: withTrust ? trust : null,
    tmpDir,
  });
}

describe('approvalState: inputs', () => {
  let repo: FixtureRepo;

  beforeAll(async () => {
    repo = await materializeFixtureRepo('synthetic');
  });

  it('is none before anything is approved', async () => {
    expect((await stateOf(repo)).state).toBe('none');
  });

  it('is on-runway right after a landed approval', async () => {
    await approve(repo);
    const state = await stateOf(repo);
    expect(state.state).toBe('on-runway');
  });

  it('stays on-runway when a task box is ticked (tasks.md is normalized)', async () => {
    const original = await showAtMaster(repo.root, TASKS);
    const text = new TextDecoder().decode(original);
    await commitChange(repo.root, TASKS, text.replace('- [ ] 1.1', '- [x] 1.1'));
    expect((await stateOf(repo)).state).toBe('on-runway');
    await commitChange(repo.root, TASKS, original);
  });

  it('moves to changed when a task is reworded, naming tasks.md', async () => {
    const original = await showAtMaster(repo.root, TASKS);
    const text = new TextDecoder().decode(original);
    await commitChange(repo.root, TASKS, text.replace('Finish the ready thing', 'Finish later'));
    const state = await stateOf(repo);
    if (state.state !== 'changed') throw new Error(`expected changed, got ${state.state}`);
    expect(state.changes).toEqual([
      expect.objectContaining({ path: TASKS, kind: 'tasks', change: 'modified' }),
    ]);
    await commitChange(repo.root, TASKS, original);
    expect((await stateOf(repo)).state).toBe('on-runway');
  });

  it('moves to changed after a committed edit to the proposal, listing signed and current digests', async () => {
    const original = await showAtMaster(repo.root, PROPOSAL);
    await commitChange(repo.root, PROPOSAL, appended(original, '\nOne more reason.\n'));
    const state = await stateOf(repo);
    if (state.state !== 'changed') throw new Error(`expected changed, got ${state.state}`);
    expect(state.changes).toHaveLength(1);
    expect(state.changes[0]).toMatchObject({
      path: PROPOSAL,
      kind: 'proposal',
      change: 'modified',
    });
    expect(state.changes[0]?.signedDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(state.changes[0]?.nowDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(state.changes[0]?.nowDigest).not.toBe(state.changes[0]?.signedDigest);
    expect(state.gatesChange).toBeNull();

    // Reverting the edit returns the item to the runway, with no re-sign.
    await commitChange(repo.root, PROPOSAL, original);
    expect((await stateOf(repo)).state).toBe('on-runway');
  });

  it('reports a file added to the change after signing as added', async () => {
    await commitChange(repo.root, SPEC, '## ADDED Requirements\n');
    const state = await stateOf(repo);
    if (state.state !== 'changed') throw new Error(`expected changed, got ${state.state}`);
    expect(state.changes).toEqual([
      expect.objectContaining({ path: SPEC, kind: 'spec', change: 'added', signedDigest: null }),
    ]);
    await commitChange(repo.root, SPEC, null);
    expect((await stateOf(repo)).state).toBe('on-runway');
  });

  it('reports a deleted file as removed', async () => {
    const original = await showAtMaster(repo.root, DESIGN);
    await commitChange(repo.root, DESIGN, null);
    const state = await stateOf(repo);
    if (state.state !== 'changed') throw new Error(`expected changed, got ${state.state}`);
    expect(state.changes).toEqual([
      expect.objectContaining({
        path: DESIGN,
        kind: 'design',
        change: 'removed',
        nowDigest: null,
      }),
    ]);
    await commitChange(repo.root, DESIGN, original);
    expect((await stateOf(repo)).state).toBe('on-runway');
  });

  it('lists several changes sorted by path', async () => {
    const proposal = await showAtMaster(repo.root, PROPOSAL);
    await commitChange(repo.root, SPEC, '## ADDED Requirements\n');
    await commitChange(repo.root, PROPOSAL, appended(proposal, 'x\n'));
    const state = await stateOf(repo);
    if (state.state !== 'changed') throw new Error(`expected changed, got ${state.state}`);
    expect(state.changes.map((c) => c.path)).toEqual([PROPOSAL, SPEC]);
    await commitChange(repo.root, SPEC, null);
    await commitChange(repo.root, PROPOSAL, proposal);
  });

  it('is invalid without a trusted key (fail closed)', async () => {
    const state = await stateOf(repo, READY, 'synthetic', false);
    expect(state).toMatchObject({ state: 'invalid', reason: 'no-trusted-key' });
  });
});

describe('approvalState: statement cross-checks', () => {
  it('is invalid when the statement names another host', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await landStatement(repo, READY, { hostId: 'other-host', changeId: READY });
    expect(await stateOf(repo)).toMatchObject({ state: 'invalid', reason: 'host-mismatch' });
  });

  it('is invalid when the statement names another item', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await landStatement(repo, READY, { hostId: 'synthetic', changeId: SYNTHETIC.built });
    expect(await stateOf(repo)).toMatchObject({ state: 'invalid', reason: 'item-mismatch' });
  });

  it('is invalid when the approval file is not a statement', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    const landed = await signAndLand({
      root: repo.root,
      baseBranch: 'master',
      itemPath: approvalPath(READY),
      fileBytes: new TextEncoder().encode('{"schema":"something-else"}\n'),
      message: 'counterpoint: approve',
      ident: IDENT,
      sign: (payload) => signPayload({ payload, privateKeyPath: key.privateKeyPath }),
    });
    expect(landed.ok).toBe(true);
    expect(await stateOf(repo)).toMatchObject({ state: 'invalid', reason: 'bad-statement' });
  });
});

describe('approvalState: gate config (runway spec, gate config edited)', () => {
  let repo: FixtureRepo;

  beforeAll(async () => {
    repo = await materializeFixtureRepo('synthetic');
    await commitChange(repo.root, COUNTERPOINT_CONFIG_PATH, 'port: 4170\n');
    await approve(repo);
  });

  it('starts on-runway with no gate config signed', async () => {
    // The gates live in the host's .counterpoint/config.yaml (only its `gates` key counts).
    expect(COUNTERPOINT_CONFIG_PATH).toBe('.counterpoint/config.yaml');
    const state = await stateOf(repo);
    expect(state.state).toBe('on-runway');
    if (state.state === 'on-runway')
      expect(state.statement.gates).toEqual({ state: 'absent', digest: null });
  });

  it('moves to changed when a gates mapping is committed, with no input changes', async () => {
    await commitChange(
      repo.root,
      COUNTERPOINT_CONFIG_PATH,
      'port: 4170\ngates:\n  test: { command: pnpm test }\n',
    );
    const now = await gatesDigest(
      createGitFileReader(repo.root),
      (await gitIn(repo.root, ['rev-parse', 'master'])).trim(),
    );
    const state = await stateOf(repo);
    if (state.state !== 'changed') throw new Error(`expected changed, got ${state.state}`);
    expect(state.changes).toEqual([]);
    expect(state.gatesChange).toEqual({
      change: 'added',
      signedDigest: null,
      nowDigest: now.digest,
    });

    const runway = await runwayOf(repo);
    expect(runway.count).toBe(0);
    expect(runway.changed.map((c) => c.changeId)).toEqual([READY]);
  });

  it('returns to on-runway when the gates key is deleted again', async () => {
    await commitChange(repo.root, COUNTERPOINT_CONFIG_PATH, 'port: 4170\n');
    expect((await stateOf(repo)).state).toBe('on-runway');
  });

  it('stays on-runway when only a non-gates key of the config changes', async () => {
    await commitChange(repo.root, COUNTERPOINT_CONFIG_PATH, 'port: 4999\nname: synthetic\n');
    expect((await stateOf(repo)).state).toBe('on-runway');
  });

  it('reports a modified gate command against a gates-signed approval, and a removed gates key', async () => {
    await commitChange(
      repo.root,
      COUNTERPOINT_CONFIG_PATH,
      'port: 4999\ngates:\n  test: { command: pnpm test }\n',
    );
    await approve(repo);
    const signed = await stateOf(repo);
    if (signed.state !== 'on-runway') throw new Error(`expected on-runway, got ${signed.state}`);
    expect(signed.statement.gates.state).toBe('present');

    await commitChange(
      repo.root,
      COUNTERPOINT_CONFIG_PATH,
      'port: 4999\ngates:\n  test: { command: pnpm test --run }\n',
    );
    const modified = await stateOf(repo);
    if (modified.state !== 'changed') throw new Error(`expected changed, got ${modified.state}`);
    expect(modified.changes).toEqual([]);
    expect(modified.gatesChange).toMatchObject({
      change: 'modified',
      signedDigest: signed.statement.gates.digest,
    });
    expect(modified.gatesChange?.nowDigest).toMatch(/^sha256:/);
    expect(modified.gatesChange?.nowDigest).not.toBe(signed.statement.gates.digest);

    await commitChange(repo.root, COUNTERPOINT_CONFIG_PATH, 'port: 4999\n');
    const removed = await stateOf(repo);
    if (removed.state !== 'changed') throw new Error(`expected changed, got ${removed.state}`);
    expect(removed.gatesChange).toEqual({
      change: 'removed',
      signedDigest: signed.statement.gates.digest,
      nowDigest: null,
    });
  });
});

describe('compareInputs', () => {
  it('reports nothing for identical inputs and gates', () => {
    const inputs = [
      {
        path: 'a.md',
        sourcePath: 'a.md',
        label: 'a.md',
        kind: 'proposal' as const,
        normalization: null,
        bytes: new TextEncoder().encode('a'),
      },
    ];
    const statement = buildStatement({
      hostId: 'h',
      changeId: 'a-change',
      baseBranch: 'master',
      tip: 'b'.repeat(40),
      inputs,
      gates: { state: 'absent', digest: null },
    });
    expect(compareInputs(statement, inputs, { state: 'absent', digest: null })).toEqual({
      changes: [],
      gatesChange: null,
    });
  });
});

describe('computeRunway', () => {
  it('counts on-runway approvals of changes that are not built', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    expect(await runwayOf(repo)).toMatchObject({
      count: 0,
      taskCount: 0,
      onRunway: [],
      changed: [],
      invalid: [],
    });

    await approve(repo);
    // An approval of the built change verifies but is not runway.
    await landStatement(repo, SYNTHETIC.built, {
      hostId: 'synthetic',
      changeId: SYNTHETIC.built,
    });
    expect((await stateOf(repo, SYNTHETIC.built)).state).toBe('on-runway');

    const runway = await runwayOf(repo);
    expect(runway.count).toBe(1);
    expect(runway.taskCount).toBe(4);
    expect(runway.onRunway).toEqual([
      expect.objectContaining({ changeId: READY, title: 'Ready thing', taskCount: 4 }),
    ]);
    expect(runway.changed).toEqual([]);
    expect(runway.invalid).toEqual([]);

    const original = await showAtMaster(repo.root, PROPOSAL);
    await commitChange(repo.root, PROPOSAL, appended(original, 'edit\n'));
    const changed = await runwayOf(repo);
    expect(changed.count).toBe(0);
    expect(changed.changed.map((c) => c.changeId)).toEqual([READY]);
  });

  it('keeps a change on the runway while its tasks are ticked, and drops it once all are done', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await approve(repo);
    const text = new TextDecoder().decode(await showAtMaster(repo.root, TASKS));
    await commitChange(repo.root, TASKS, text.replace('- [ ] 1.1', '- [x] 1.1'));
    expect((await runwayOf(repo)).count).toBe(1);
    // Every box ticked: the change is built, so its approval is no longer runway (and not drift).
    await commitChange(repo.root, TASKS, text.replaceAll('- [ ]', '- [x]'));
    expect(await runwayOf(repo)).toMatchObject({ count: 0, changed: [], invalid: [] });
  });

  it('ignores an approval of a change that has since been archived', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await approve(repo);
    await gitIn(repo.root, ['mv', CHANGE_DIR, `openspec/changes/archive/2026-11-01-${READY}`]);
    await gitIn(repo.root, ['commit', '-q', '-m', 'archive']);
    expect(await runwayOf(repo)).toMatchObject({
      count: 0,
      onRunway: [],
      changed: [],
      invalid: [],
    });
  });

  it('is zero with every approval invalid when no key is trusted', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await approve(repo);
    const runway = await runwayOf(repo, false);
    expect(runway.count).toBe(0);
    expect(runway.invalid).toEqual([
      expect.objectContaining({ changeId: READY, reason: 'no-trusted-key' }),
    ]);
  });

  it('skips approval file names that are not change ids', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await commitChange(repo.root, '.counterpoint/approvals/Bad_Name.json', '{}\n');
    await commitChange(repo.root, '.counterpoint/approvals/archive.json', '{}\n');
    await commitChange(repo.root, '.counterpoint/approvals/notes.txt', 'x\n');
    const runway = await runwayOf(repo);
    expect(runway).toMatchObject({ count: 0, onRunway: [], changed: [], invalid: [] });
  });
});

// Approval state and runway, recomputed from git (RESEARCH verification step 5). Approvals are
// landed with throwaway unprotected ed25519 keys in scratch repositories; the trust store lives in a
// scratch home. Nothing here touches ~/.ssh, ssh-agent, the Keychain or a real Counterpoint home.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGsdAdapter } from '../../../src/adapters/gsd/index.ts';
import { signAndLand } from '../../../src/core/approvals/commit.ts';
import { COUNTERPOINT_CONFIG_PATH, gatesDigest } from '../../../src/core/approvals/gates.ts';
import { prepareApproval } from '../../../src/core/approvals/prepare.ts';
import { signPayload } from '../../../src/core/approvals/ssh.ts';
import {
  approvalPath,
  buildStatement,
  serializeStatement,
} from '../../../src/core/approvals/statement.ts';
import { readTrust, type Trust, writeTrust } from '../../../src/core/approvals/trust-store.ts';
import { createGitFileReader } from '../../../src/core/git/reader.ts';
import { approvalState, compareInputs, computeRunway } from '../../../src/core/runway/runway.ts';
import {
  commitChange,
  type FixtureRepo,
  materializeFixtureRepo,
} from '../../helpers/fixture-repo.ts';
import { makeThrowawayKey, type ThrowawayKey } from '../../helpers/keys.ts';
import { gitIn, makeScratchDir, removeScratchDirs } from '../../helpers/scratch.ts';

const adapter = createGsdAdapter();
const PHASE_DIR = '.planning/phases/02-ready-thing';
const CONTEXT = `${PHASE_DIR}/02-CONTEXT.md`;
const RESEARCH = `${PHASE_DIR}/02-RESEARCH.md`;
const SPEC = `${PHASE_DIR}/02-SPEC.md`;
const IDENT = { name: 'Owner', email: 'owner@counterpoint.invalid' };

let key: ThrowawayKey;
let trust: Trust;
let tmpDir: string;

beforeAll(async () => {
  const keysDir = makeScratchDir('rkeys');
  key = await makeThrowawayKey(keysDir);
  const home = makeScratchDir('rhome');
  await writeTrust(home, { publicKeyPath: key.publicKeyPath });
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

/** Prepares and lands a real signed approval of `phaseId` at master's tip. */
async function approve(repo: FixtureRepo, phaseId = '02'): Promise<string> {
  const prepared = await prepareApproval({
    hostId: 'synthetic',
    baseBranch: 'master',
    phaseId,
    reader: createGitFileReader(repo.root),
    adapter,
  });
  if (!prepared.ok) throw new Error(`prepare refused: ${prepared.reason}`);
  const landed = await signAndLand({
    root: repo.root,
    baseBranch: 'master',
    itemPath: prepared.itemPath,
    fileBytes: prepared.bytes,
    message: `counterpoint: approve phase ${phaseId}`,
    ident: IDENT,
    sign: (payload) => signPayload({ payload, privateKeyPath: key.privateKeyPath }),
  });
  if (!landed.ok) throw new Error(`landing refused: ${landed.reason}`);
  return landed.commit;
}

/** Lands an arbitrary statement (for mismatch cases and built phases). */
async function landStatement(
  repo: FixtureRepo,
  itemPhaseId: string,
  statementOptions: { hostId: string; phaseId: string },
): Promise<void> {
  const reader = createGitFileReader(repo.root);
  const tip = (await reader.resolve('refs/heads/master')) as string;
  const inputs = await adapter.approvalInputs(reader, tip, statementOptions.phaseId);
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
    itemPath: approvalPath(itemPhaseId),
    fileBytes: new TextEncoder().encode(serializeStatement(statement)),
    message: 'counterpoint: approve',
    ident: IDENT,
    sign: (payload) => signPayload({ payload, privateKeyPath: key.privateKeyPath }),
  });
  if (!landed.ok) throw new Error(`landing refused: ${landed.reason}`);
}

function stateOf(repo: FixtureRepo, phaseId = '02', hostId = 'synthetic', withTrust = true) {
  return approvalState({
    hostId,
    root: repo.root,
    baseBranch: 'master',
    phaseId,
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

  it('moves to changed after a committed edit to an input, listing signed and current digests', async () => {
    const original = await showAtMaster(repo.root, CONTEXT);
    await commitChange(repo.root, CONTEXT, appended(original, '\nOne more decision.\n'));
    const state = await stateOf(repo);
    if (state.state !== 'changed') throw new Error(`expected changed, got ${state.state}`);
    expect(state.changes).toHaveLength(1);
    expect(state.changes[0]).toMatchObject({ path: CONTEXT, kind: 'context', change: 'modified' });
    expect(state.changes[0]?.signedDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(state.changes[0]?.nowDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(state.changes[0]?.nowDigest).not.toBe(state.changes[0]?.signedDigest);
    expect(state.gatesChange).toBeNull();

    // Reverting the edit returns the item to the runway, with no re-sign.
    await commitChange(repo.root, CONTEXT, original);
    expect((await stateOf(repo)).state).toBe('on-runway');
  });

  it('reports an input added after signing as added', async () => {
    await commitChange(repo.root, SPEC, '# Spec\n');
    const state = await stateOf(repo);
    if (state.state !== 'changed') throw new Error(`expected changed, got ${state.state}`);
    expect(state.changes).toEqual([
      expect.objectContaining({ path: SPEC, kind: 'spec', change: 'added', signedDigest: null }),
    ]);
    await commitChange(repo.root, SPEC, null);
    expect((await stateOf(repo)).state).toBe('on-runway');
  });

  it('reports a deleted input as removed', async () => {
    const original = await showAtMaster(repo.root, RESEARCH);
    await commitChange(repo.root, RESEARCH, null);
    const state = await stateOf(repo);
    if (state.state !== 'changed') throw new Error(`expected changed, got ${state.state}`);
    expect(state.changes).toEqual([
      expect.objectContaining({
        path: RESEARCH,
        kind: 'research',
        change: 'removed',
        nowDigest: null,
      }),
    ]);
    await commitChange(repo.root, RESEARCH, original);
    expect((await stateOf(repo)).state).toBe('on-runway');
  });

  it('lists several changes sorted by path', async () => {
    const context = await showAtMaster(repo.root, CONTEXT);
    await commitChange(repo.root, SPEC, '# Spec\n');
    await commitChange(repo.root, CONTEXT, appended(context, 'x\n'));
    const state = await stateOf(repo);
    if (state.state !== 'changed') throw new Error(`expected changed, got ${state.state}`);
    expect(state.changes.map((c) => c.path)).toEqual([CONTEXT, SPEC]);
    await commitChange(repo.root, SPEC, null);
    await commitChange(repo.root, CONTEXT, context);
  });

  it('is invalid without a trusted key (fail closed)', async () => {
    const state = await stateOf(repo, '02', 'synthetic', false);
    expect(state).toMatchObject({ state: 'invalid', reason: 'no-trusted-key' });
  });
});

describe('approvalState: statement cross-checks', () => {
  it('is invalid when the statement names another host', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await landStatement(repo, '02', { hostId: 'other-host', phaseId: '02' });
    expect(await stateOf(repo)).toMatchObject({ state: 'invalid', reason: 'host-mismatch' });
  });

  it('is invalid when the statement names another item', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await landStatement(repo, '02', { hostId: 'synthetic', phaseId: '01' });
    expect(await stateOf(repo)).toMatchObject({ state: 'invalid', reason: 'item-mismatch' });
  });

  it('is invalid when the approval file is not a statement', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    const landed = await signAndLand({
      root: repo.root,
      baseBranch: 'master',
      itemPath: approvalPath('02'),
      fileBytes: new TextEncoder().encode('{"schema":"something-else"}\n'),
      message: 'counterpoint: approve',
      ident: IDENT,
      sign: (payload) => signPayload({ payload, privateKeyPath: key.privateKeyPath }),
    });
    expect(landed.ok).toBe(true);
    expect(await stateOf(repo)).toMatchObject({ state: 'invalid', reason: 'bad-statement' });
  });
});

describe('approvalState: gate config (ROADMAP SC5)', () => {
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
    expect(runway.changed.map((c) => c.phaseId)).toEqual(['02']);
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
        kind: 'plan' as const,
        normalization: null,
        bytes: new TextEncoder().encode('a'),
      },
    ];
    const statement = buildStatement({
      hostId: 'h',
      phaseId: '02',
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
  it('counts on-runway approvals of phases that are not built', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    expect(await runwayOf(repo)).toMatchObject({
      count: 0,
      planCount: 0,
      onRunway: [],
      changed: [],
      invalid: [],
    });

    await approve(repo);
    // An approval of the built phase 01 verifies but is not runway.
    await landStatement(repo, '01', { hostId: 'synthetic', phaseId: '01' });
    expect((await stateOf(repo, '01')).state).toBe('on-runway');

    const runway = await runwayOf(repo);
    expect(runway.count).toBe(1);
    expect(runway.planCount).toBe(2);
    expect(runway.onRunway.map((r) => r.phaseId)).toEqual(['02']);
    expect(runway.changed).toEqual([]);
    expect(runway.invalid).toEqual([]);

    const original = await showAtMaster(repo.root, CONTEXT);
    await commitChange(repo.root, CONTEXT, appended(original, 'edit\n'));
    const changed = await runwayOf(repo);
    expect(changed.count).toBe(0);
    expect(changed.changed.map((c) => c.phaseId)).toEqual(['02']);
  });

  it('is zero with every approval invalid when no key is trusted', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await approve(repo);
    const runway = await runwayOf(repo, false);
    expect(runway.count).toBe(0);
    expect(runway.invalid).toEqual([
      expect.objectContaining({ phaseId: '02', reason: 'no-trusted-key' }),
    ]);
  });

  it('skips approval file names that fail the phase regex', async () => {
    const repo = await materializeFixtureRepo('synthetic');
    await commitChange(repo.root, '.counterpoint/approvals/phase-2.json', '{}\n');
    await commitChange(repo.root, '.counterpoint/approvals/notes.txt', 'x\n');
    const runway = await runwayOf(repo);
    expect(runway).toMatchObject({ count: 0, onRunway: [], changed: [], invalid: [] });
  });
});

// Approval verification (APPR-01, APPR-04): recompute from git and fail closed. Every forgery
// below is built on a scratch repo with throwaway keys and must come back `invalid`.
import { chmodSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildApprovalCommit,
  embedSignature,
  replacePath,
  signAndLand,
} from '../../../src/core/approvals/commit.ts';
import { fingerprintOf, signPayload } from '../../../src/core/approvals/ssh.ts';
import {
  OWNER_PRINCIPAL,
  readTrust,
  type Trust,
  writeTrust,
} from '../../../src/core/approvals/trust-store.ts';
import { verifyApprovalCommit } from '../../../src/core/approvals/verify.ts';
import {
  catFileCommit,
  commitTree,
  hashObjectBlob,
  hashObjectCommit,
  revParse,
} from '../../../src/core/git/plumbing.ts';
import {
  makeThrowawayKey,
  publicKeyText,
  signWithNamespace,
  type ThrowawayKey,
  writeAllowedSigners,
} from '../../helpers/keys.ts';
import {
  commitAll,
  gitIn,
  initScratchRepo,
  makeScratchDir,
  removeScratchDirs,
  writeFileIn,
} from '../../helpers/scratch.ts';

const ITEM = '.counterpoint/approvals/phase-01.json';
const ident = { name: 'Owner', email: 'owner@example.invalid', date: '1700000000 +0000' };
const encoder = new TextEncoder();
const decoder = new TextDecoder();

let keyDir: string;
let owner: ThrowawayKey;
let other: ThrowawayKey;
let trust: Trust;
let tmpDir: string;

beforeAll(async () => {
  keyDir = makeScratchDir('vkeys');
  owner = await makeThrowawayKey(keyDir, { name: 'owner' });
  other = await makeThrowawayKey(keyDir, { name: 'other' });
  trust = {
    allowedSignersPath: writeAllowedSigners(keyDir, owner.publicKeyPath),
    fingerprint: await fingerprintOf(owner.publicKeyPath),
    principal: OWNER_PRINCIPAL,
    privateKeyPath: owner.privateKeyPath,
    publicKeyPath: owner.publicKeyPath,
  };
  tmpDir = makeScratchDir('vtmp');
});

afterAll(removeScratchDirs);

const signWith = (key: ThrowawayKey) => (payload: Uint8Array) =>
  signPayload({ payload, privateKeyPath: key.privateKeyPath });

function statement(text = 'v1'): Uint8Array {
  return encoder.encode(`{"item":"phase-01","note":"${text}"}\n`);
}

async function baseRepo(): Promise<string> {
  const dir = makeScratchDir('vrepo');
  await initScratchRepo(dir, { branch: 'master' });
  writeFileIn(dir, 'README.md', 'hello\n');
  await commitAll(dir, 'init');
  return dir;
}

async function approve(dir: string, key = owner, bytes = statement()) {
  const result = await signAndLand({
    root: dir,
    baseBranch: 'master',
    itemPath: ITEM,
    fileBytes: bytes,
    message: 'counterpoint: approve phase 01\n',
    ident,
    sign: signWith(key),
  });
  if (!result.ok) throw new Error(`landing failed: ${result.reason}`);
  return result.commit;
}

async function verify(
  dir: string,
  withTrust: Pick<Trust, 'allowedSignersPath' | 'fingerprint'> = trust,
) {
  return verifyApprovalCommit({
    root: dir,
    baseBranch: 'master',
    itemId: 'phase-01',
    trust: withTrust,
    tmpDir,
  });
}

/** Points master at a hand-made commit object (agents can write any commit and move any ref). */
async function forge(dir: string, bytes: Uint8Array): Promise<string> {
  const sha = await hashObjectCommit(dir, bytes);
  await gitIn(dir, ['update-ref', 'refs/heads/master', sha]);
  return sha;
}

async function unsignedPayload(dir: string, tree: string, parents: string[]): Promise<Uint8Array> {
  const args = [
    'commit-tree',
    '--no-gpg-sign',
    tree,
    ...parents.flatMap((p) => ['-p', p]),
    '-m',
    'approve',
  ];
  const sha = (await gitIn(dir, args)).trim();
  return catFileCommit(dir, sha);
}

describe('verifyApprovalCommit', () => {
  it('accepts a landed approval and reports its commit, tip, bytes, date and fingerprint', async () => {
    const dir = await baseRepo();
    const commit = await approve(dir);
    writeFileIn(dir, 'README.md', 'later unrelated work\n');
    const tip = await commitAll(dir, 'unrelated');

    const state = await verify(dir);
    expect(state.state).toBe('signed');
    if (state.state !== 'signed') return;
    expect(state.commit).toBe(commit);
    expect(state.tip).toBe(tip);
    expect(decoder.decode(state.bytes)).toBe('{"item":"phase-01","note":"v1"}\n');
    expect(new Date(state.signedAt).getTime()).toBe(1_700_000_000_000);
    expect(state.fingerprint).toBe(trust.fingerprint);
  });

  it('reports none when no approval file was ever created', async () => {
    const dir = await baseRepo();
    expect(await verify(dir)).toMatchObject({ state: 'none' });
  });

  it('reports none after an unsigned delete', async () => {
    const dir = await baseRepo();
    await approve(dir);
    await gitIn(dir, ['rm', '-q', ITEM]);
    await gitIn(dir, ['commit', '-q', '-m', 'drop approval']);
    expect(await verify(dir)).toMatchObject({ state: 'none' });
  });

  it('rejects an approval signed by another key', async () => {
    const dir = await baseRepo();
    await approve(dir, other);
    expect(await verify(dir)).toMatchObject({ state: 'invalid', reason: 'signature-untrusted' });
  });

  it('rejects a signature made for the "file" namespace', async () => {
    const dir = await baseRepo();
    const built = await buildApprovalCommit({
      root: dir,
      baseTip: await revParse(dir, 'refs/heads/master'),
      itemPath: ITEM,
      fileBytes: statement(),
      message: 'approve\n',
      ident,
    });
    const sig = await signWithNamespace(built.payload, owner.privateKeyPath, 'file');
    await forge(dir, embedSignature(built.payload, sig));
    expect(await verify(dir)).toMatchObject({ state: 'invalid', reason: 'signature-namespace' });
  });

  it('rejects a commit whose payload changed after signing', async () => {
    const dir = await baseRepo();
    const commit = await approve(dir);
    const text = decoder.decode(await catFileCommit(dir, commit));
    const tampered = text.replace(
      'counterpoint: approve phase 01',
      'counterpoint: approve phase 0l',
    );
    expect(tampered).not.toBe(text);
    await forge(dir, encoder.encode(tampered));
    expect(await verify(dir)).toMatchObject({ state: 'invalid', reason: 'signature-tampered' });
  });

  it('rejects a later unsigned commit that edits the approval file', async () => {
    const dir = await baseRepo();
    await approve(dir);
    writeFileIn(dir, ITEM, '{"item":"phase-01","note":"agent edit"}\n');
    await commitAll(dir, 'edit approval');
    expect(await verify(dir)).toMatchObject({ state: 'invalid', reason: 'unsigned' });
  });

  it('rejects a signed commit that also adds another file', async () => {
    const dir = await baseRepo();
    const tip = await revParse(dir, 'refs/heads/master');
    const blob = await hashObjectBlob(dir, statement());
    const extra = await hashObjectBlob(dir, encoder.encode('smuggled\n'));
    const baseTree = await revParse(dir, `${tip}^{tree}`);
    const withItem = await replacePath(dir, baseTree, ITEM.split('/'), {
      mode: '100644',
      type: 'blob',
      sha: blob,
    });
    const tree = await replacePath(dir, withItem, ['smuggled.txt'], {
      mode: '100644',
      type: 'blob',
      sha: extra,
    });
    const unsigned = await commitTree(dir, { tree, parent: tip, message: 'approve', ident });
    const payload = await catFileCommit(dir, unsigned);
    await forge(dir, embedSignature(payload, await signWith(owner)(payload)));
    expect(await verify(dir)).toMatchObject({ state: 'invalid', reason: 'not-single-file' });
  });

  it('rejects a merge commit as the last first-parent toucher', async () => {
    const dir = await baseRepo();
    const base = await revParse(dir, 'refs/heads/master');
    await gitIn(dir, ['branch', 'side']);
    const side = await signAndLand({
      root: dir,
      baseBranch: 'side',
      itemPath: ITEM,
      fileBytes: statement(),
      message: 'approve on side\n',
      ident,
      sign: signWith(owner),
    });
    if (!side.ok) throw new Error('side landing failed');
    const payload = await unsignedPayload(dir, `${side.commit}^{tree}`, [base, side.commit]);
    await forge(dir, embedSignature(payload, await signWith(owner)(payload)));
    expect(await verify(dir)).toMatchObject({ state: 'invalid', reason: 'merge-commit' });
  });

  it('rejects a root commit', async () => {
    const dir = makeScratchDir('vroot');
    await initScratchRepo(dir, { branch: 'master' });
    const blob = await hashObjectBlob(dir, statement());
    const tree = await replacePath(dir, null, ITEM.split('/'), {
      mode: '100644',
      type: 'blob',
      sha: blob,
    });
    const payload = await unsignedPayload(dir, tree, []);
    await forge(dir, embedSignature(payload, await signWith(owner)(payload)));
    expect(await verify(dir)).toMatchObject({ state: 'invalid', reason: 'root-commit' });
  });

  it('rejects two gpgsig headers', async () => {
    const dir = await baseRepo();
    const commit = await approve(dir);
    const text = decoder.decode(await catFileCommit(dir, commit));
    const block = /gpgsig [\s\S]*?-----END SSH SIGNATURE-----\n/.exec(text)?.[0] ?? '';
    expect(block).not.toBe('');
    await forge(dir, encoder.encode(text.replace(block, block + block)));
    expect(await verify(dir)).toMatchObject({ state: 'invalid', reason: 'multiple-signatures' });
  });

  it('rejects a garbled signature', async () => {
    const dir = await baseRepo();
    const commit = await approve(dir);
    const text = decoder.decode(await catFileCommit(dir, commit));
    const garbled = text.replace(
      /(gpgsig -----BEGIN SSH SIGNATURE-----\n) \S+\n/,
      '$1 !!not*base64!!\n',
    );
    expect(garbled).not.toBe(text);
    await forge(dir, encoder.encode(garbled));
    expect(await verify(dir)).toMatchObject({ state: 'invalid', reason: 'garbled-signature' });
  });

  it('rejects an allowed-signers file holding two keys', async () => {
    const dir = await baseRepo();
    await approve(dir);
    const file = join(makeScratchDir('vas'), 'allowed_signers');
    writeFileSync(
      file,
      `${OWNER_PRINCIPAL} namespaces="git" ${publicKeyText(owner.publicKeyPath)}\n` +
        `${OWNER_PRINCIPAL} namespaces="git" ${publicKeyText(other.publicKeyPath)}\n`,
      { mode: 0o600 },
    );
    const state = await verify(dir, { allowedSignersPath: file, fingerprint: trust.fingerprint });
    expect(state).toMatchObject({ state: 'invalid', reason: 'allowed-signers-multiple-keys' });
  });

  it('rejects an allowed-signers file with a wildcard principal', async () => {
    const dir = await baseRepo();
    await approve(dir);
    const file = writeAllowedSigners(makeScratchDir('vas'), owner.publicKeyPath, '*');
    const state = await verify(dir, { allowedSignersPath: file, fingerprint: trust.fingerprint });
    expect(state).toMatchObject({ state: 'invalid', reason: 'allowed-signers-principal' });
  });

  it('rejects a pinned fingerprint that differs from the allowed key', async () => {
    const dir = await baseRepo();
    await approve(dir);
    const otherFingerprint = await fingerprintOf(other.publicKeyPath);
    const state = await verify(dir, {
      allowedSignersPath: trust.allowedSignersPath,
      fingerprint: otherFingerprint,
    });
    expect(state).toMatchObject({ state: 'invalid', reason: 'fingerprint-mismatch' });
  });

  it('ignores replace refs that would hide an unsigned edit', async () => {
    const dir = await baseRepo();
    const signed = await approve(dir);
    writeFileIn(dir, ITEM, '{"item":"phase-01","note":"agent edit"}\n');
    const unsigned = await commitAll(dir, 'edit approval');
    const disguise = (
      await gitIn(dir, ['commit-tree', `${signed}^{tree}`, '-p', signed, '-m', 'noop'])
    ).trim();
    await gitIn(dir, ['replace', unsigned, disguise]);
    // Positive control: with replace refs honoured, git reports the signed commit as last toucher.
    expect((await gitIn(dir, ['log', '-1', '--format=%H', 'master', '--', ITEM])).trim()).toBe(
      signed,
    );
    expect(await verify(dir)).toMatchObject({ state: 'invalid', reason: 'unsigned' });
  });

  it('rejects an item id outside the phase-NN pattern', async () => {
    const dir = await baseRepo();
    const state = await verifyApprovalCommit({
      root: dir,
      baseBranch: 'master',
      itemId: '../x',
      trust,
      tmpDir,
    });
    expect(state).toMatchObject({ state: 'invalid', reason: 'bad-item-id' });
  });

  it('never executes a repository gpg.ssh.program', async () => {
    const dir = await baseRepo();
    const commit = await approve(dir);
    const marker = join(tmpDir, `program-ran-${Date.now()}`);
    const script = writeFileIn(
      dir,
      '.git/fake-keygen.sh',
      `#!/bin/sh\ntouch '${marker}'\nexit 0\n`,
    );
    chmodSync(script, 0o755);
    await gitIn(dir, ['config', 'gpg.format', 'ssh']);
    await gitIn(dir, ['config', 'gpg.ssh.program', script]);
    await gitIn(dir, ['config', 'gpg.ssh.allowedSignersFile', trust.allowedSignersPath]);

    expect((await verify(dir)).state).toBe('signed');
    expect(existsSync(marker)).toBe(false);

    // Positive control: git's own verification does run the planted program.
    await execa('git', ['verify-commit', commit], {
      cwd: dir,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: process.env.HOME ?? '/',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
      },
      extendEnv: false,
      reject: false,
    });
    expect(existsSync(marker)).toBe(true);
  });
});

describe('trust store', () => {
  it('writes the allowed-signers line and pinned fingerprint, then reads them back', async () => {
    const h = makeScratchDir('thome');
    const written = await writeTrust(h, { publicKeyPath: owner.publicKeyPath });
    expect(written.fingerprint).toBe(await fingerprintOf(owner.publicKeyPath));
    expect(written.privateKeyPath).toBe(owner.privateKeyPath);
    const read = readTrust(h);
    expect(read).toMatchObject({
      ok: true,
      principal: OWNER_PRINCIPAL,
      fingerprint: written.fingerprint,
    });
    if (!read.ok) return;
    const line = (await execa('cat', [read.allowedSignersPath])).stdout;
    expect(line).toBe(`owner@counterpoint namespaces="git" ${publicKeyText(owner.publicKeyPath)}`);
  });

  it('reports no-trusted-key on an empty home', () => {
    expect(readTrust(makeScratchDir('thome'))).toMatchObject({
      ok: false,
      error: 'no-trusted-key',
    });
  });

  it('refuses a symlinked allowed_signers file', async () => {
    const h = makeScratchDir('thome');
    const written = await writeTrust(h, { publicKeyPath: owner.publicKeyPath });
    const elsewhere = writeAllowedSigners(makeScratchDir('tother'), owner.publicKeyPath);
    rmSync(written.allowedSignersPath);
    symlinkSync(elsewhere, written.allowedSignersPath);
    expect(readTrust(h)).toMatchObject({ ok: false, error: 'bad-allowed-signers' });
  });

  it.each([
    ['group-writable', 0o620],
    ['world-writable', 0o602],
  ])('refuses a %s allowed_signers file', async (_label, mode) => {
    const h = makeScratchDir('thome');
    const written = await writeTrust(h, { publicKeyPath: owner.publicKeyPath });
    chmodSync(written.allowedSignersPath, mode);
    expect(readTrust(h)).toMatchObject({ ok: false, error: 'bad-allowed-signers' });
  });

  it('reports fingerprint-mismatch when the pinned fingerprint no longer matches', async () => {
    const h = makeScratchDir('thome');
    const written = await writeTrust(h, { publicKeyPath: owner.publicKeyPath });
    const otherLine = `owner@counterpoint namespaces="git" ${publicKeyText(other.publicKeyPath)}\n`;
    writeFileSync(written.allowedSignersPath, otherLine, { mode: 0o600 });
    expect(readTrust(h)).toMatchObject({ ok: false, error: 'fingerprint-mismatch' });
  });

  it('refuses a public key file holding more than one key', async () => {
    const dir = makeScratchDir('tkeys');
    const k = await makeThrowawayKey(dir);
    writeFileSync(
      k.publicKeyPath,
      `${publicKeyText(k.publicKeyPath)}\n${publicKeyText(other.publicKeyPath)}\n`,
    );
    mkdirSync(join(dir, 'h'));
    await expect(writeTrust(join(dir, 'h'), { publicKeyPath: k.publicKeyPath })).rejects.toThrow();
  });
});

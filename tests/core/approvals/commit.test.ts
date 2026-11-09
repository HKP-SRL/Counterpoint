// Approval commit mechanics (APPR-01): plumbing-built tree and commit, ssh-keygen signature
// embedded as gpgsig, compare-and-swap landing that leaves the owner's checkout untouched apart
// from the one approval file. Scratch repos and throwaway keys only.
import { chmodSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  buildApprovalCommit,
  embedSignature,
  landApprovalCommit,
  signAndLand,
  splitSignedCommit,
} from '../../../src/core/approvals/commit.ts';
import { sha256Digest, shortDigest } from '../../../src/core/approvals/digest.ts';
import { SSH_KEYGEN, signPayload, sshKeygenEnv } from '../../../src/core/approvals/ssh.ts';
import { makeThrowawayKey, type ThrowawayKey, writeAllowedSigners } from '../../helpers/keys.ts';
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

let keyDir: string;
let key: ThrowawayKey;
let allowedSigners: string;

beforeAll(async () => {
  keyDir = makeScratchDir('keys');
  key = await makeThrowawayKey(keyDir);
  allowedSigners = writeAllowedSigners(keyDir, key.publicKeyPath);
});

afterAll(removeScratchDirs);

const sign = (payload: Uint8Array) => signPayload({ payload, privateKeyPath: key.privateKeyPath });

function statement(text = 'v1'): Uint8Array {
  return encoder.encode(`{"item":"phase-01","note":"${text}"}\n`);
}

async function baseRepo(branch = 'master'): Promise<string> {
  const dir = makeScratchDir('appr');
  await initScratchRepo(dir, { branch });
  writeFileIn(dir, 'README.md', 'hello\n');
  await commitAll(dir, 'init');
  return dir;
}

async function rev(dir: string, name: string): Promise<string> {
  return (await gitIn(dir, ['rev-parse', name])).trim();
}

async function land(dir: string, bytes = statement(), itemPath = ITEM, branch = 'master') {
  return signAndLand({
    root: dir,
    baseBranch: branch,
    itemPath,
    fileBytes: bytes,
    message: 'counterpoint: approve phase 01\n',
    ident,
    sign,
  });
}

/** Plain git with the repo's own config and hooks active (positive controls only). */
async function rawGit(dir: string, args: string[]) {
  return execa('git', args, {
    cwd: dir,
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? '/',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
    extendEnv: false,
    reject: false,
    stdin: 'ignore',
  });
}

describe('digest', () => {
  it('formats sha256 digests and their 12-character short form', () => {
    const d = sha256Digest('abc');
    expect(d).toBe('sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(shortDigest(d)).toBe('ba7816bf8f01');
    expect(() => shortDigest('md5:abc')).toThrow();
  });
});

describe('signAndLand', () => {
  it('lands on the checked-out base without disturbing the owner’s uncommitted work', async () => {
    const dir = await baseRepo();
    const tip0 = await rev(dir, 'master');
    writeFileIn(dir, 'README.md', 'edited by the owner\n');
    writeFileIn(dir, 'untracked.txt', 'scratch\n');
    const before = await gitIn(dir, ['status', '--porcelain']);
    expect(before).toBe(' M README.md\n?? untracked.txt');

    const result = await land(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tip1 = await rev(dir, 'master');
    expect(tip1).toBe(result.commit);
    expect(result.previousTip).toBe(tip0);
    expect((await gitIn(dir, ['rev-list', '--parents', '-n', '1', tip1])).trim()).toBe(
      `${tip1} ${tip0}`,
    );
    expect(await gitIn(dir, ['diff-tree', '-r', '--name-status', tip0, tip1])).toBe(`A\t${ITEM}`);
    expect(await gitIn(dir, ['status', '--porcelain'])).toBe(before);
    expect(readFileSync(join(dir, ITEM), 'utf8')).toBe('{"item":"phase-01","note":"v1"}\n');
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('edited by the owner\n');
  });

  it('preserves other files under .counterpoint/ in the new tree', async () => {
    const dir = await baseRepo();
    writeFileIn(dir, '.counterpoint/config.yaml', 'seats: []\n');
    writeFileIn(dir, ITEM, '{"old":true}\n');
    const tip0 = await commitAll(dir, 'existing counterpoint files');

    const result = await land(dir, statement('p2'), '.counterpoint/approvals/phase-02.json');
    expect(result.ok).toBe(true);
    const files = (await gitIn(dir, ['ls-tree', '-r', '--name-only', 'master'])).split('\n');
    expect(files.sort()).toEqual(
      [
        '.counterpoint/approvals/phase-01.json',
        '.counterpoint/approvals/phase-02.json',
        '.counterpoint/config.yaml',
        'README.md',
      ].sort(),
    );
    expect(await gitIn(dir, ['diff-tree', '-r', '--name-status', tip0, 'master'])).toBe(
      'A\t.counterpoint/approvals/phase-02.json',
    );
    expect(await gitIn(dir, ['status', '--porcelain'])).toBe('');
  });

  it('preserves submodule (gitlink) and executable entries when rebuilding the root tree', async () => {
    const dir = await baseRepo();
    const fake = 'a'.repeat(40);
    await gitIn(dir, ['update-index', '--add', '--cacheinfo', `160000,${fake},vendor/sub`]);
    writeFileIn(dir, 'run.sh', '#!/bin/sh\n');
    chmodSync(join(dir, 'run.sh'), 0o755);
    await gitIn(dir, ['add', 'run.sh']);
    await gitIn(dir, ['commit', '-q', '-m', 'submodule and script']);
    const before = await gitIn(dir, ['ls-tree', '-r', 'master']);

    expect((await land(dir)).ok).toBe(true);
    const after = (await gitIn(dir, ['ls-tree', '-r', 'master'])).split('\n');
    expect(after.filter((l) => !l.endsWith(ITEM))).toEqual(before.split('\n'));
    expect(after).toContain(`160000 commit ${fake}\tvendor/sub`);
  });

  it('moves the base ref but changes nothing in a checkout on another branch', async () => {
    const dir = await baseRepo();
    await gitIn(dir, ['checkout', '-q', '-b', 'feature']);
    writeFileIn(dir, 'README.md', 'feature work\n');
    const feature = await rev(dir, 'feature');
    const tip0 = await rev(dir, 'master');
    const before = await gitIn(dir, ['status', '--porcelain']);

    const result = await land(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.placedIn).toEqual([]);
    expect(await rev(dir, 'master')).not.toBe(tip0);
    expect(await rev(dir, 'feature')).toBe(feature);
    expect((await gitIn(dir, ['symbolic-ref', 'HEAD'])).trim()).toBe('refs/heads/feature');
    expect(await gitIn(dir, ['status', '--porcelain'])).toBe(before);
    expect(existsSync(join(dir, ITEM))).toBe(false);
  });

  it('refuses with base-moved when the tip moved between build and land', async () => {
    const dir = await baseRepo();
    const tip0 = await rev(dir, 'master');
    const built = await buildApprovalCommit({
      root: dir,
      baseTip: tip0,
      itemPath: ITEM,
      fileBytes: statement(),
      message: 'counterpoint: approve phase 01\n',
      ident,
    });
    const signed = embedSignature(built.payload, await sign(built.payload));
    writeFileIn(dir, 'other.txt', 'someone else committed\n');
    const moved = await commitAll(dir, 'concurrent commit');

    const result = await landApprovalCommit({
      root: dir,
      baseRef: 'refs/heads/master',
      expectedOldTip: tip0,
      signedBytes: signed,
      itemPath: ITEM,
      blob: built.blob,
    });
    expect(result).toEqual({ ok: false, reason: 'base-moved' });
    expect(await rev(dir, 'master')).toBe(moved);
    expect(existsSync(join(dir, ITEM))).toBe(false);
    expect(await gitIn(dir, ['status', '--porcelain'])).toBe('');
  });

  it('lets only one of two approvals built from the same tip land', async () => {
    const dir = await baseRepo();
    const tip0 = await rev(dir, 'master');
    const build = async (itemPath: string) => {
      const built = await buildApprovalCommit({
        root: dir,
        baseTip: tip0,
        itemPath,
        fileBytes: statement(itemPath),
        message: 'approve\n',
        ident,
      });
      return { built, signed: embedSignature(built.payload, await sign(built.payload)) };
    };
    const a = await build(ITEM);
    const b = await build('.counterpoint/approvals/phase-02.json');
    const landOne = (x: typeof a, itemPath: string) =>
      landApprovalCommit({
        root: dir,
        baseRef: 'refs/heads/master',
        expectedOldTip: tip0,
        signedBytes: x.signed,
        itemPath,
        blob: x.built.blob,
      });
    const first = await landOne(a, ITEM);
    expect(first.ok).toBe(true);
    const tip1 = await rev(dir, 'master');
    const second = await landOne(b, '.counterpoint/approvals/phase-02.json');
    expect(second).toEqual({ ok: false, reason: 'base-moved' });
    expect(await rev(dir, 'master')).toBe(tip1);
    expect(existsSync(join(dir, '.counterpoint/approvals/phase-02.json'))).toBe(false);
  });

  it.each([
    ['an untracked file', false],
    ['an ignored file', true],
  ])('refuses with occupied when %s already sits at the approval path', async (_label, ignored) => {
    const dir = await baseRepo();
    if (ignored) {
      writeFileIn(dir, '.gitignore', '.counterpoint/\n');
      await commitAll(dir, 'ignore');
    }
    const tip0 = await rev(dir, 'master');
    writeFileIn(dir, ITEM, 'owner draft\n');
    const signer = vi.fn(sign);

    const result = await signAndLand({
      root: dir,
      baseBranch: 'master',
      itemPath: ITEM,
      fileBytes: statement(),
      message: 'approve\n',
      ident,
      sign: signer,
    });
    expect(result).toMatchObject({ ok: false, reason: 'occupied' });
    expect(signer).not.toHaveBeenCalled();
    expect(await rev(dir, 'master')).toBe(tip0);
    expect(readFileSync(join(dir, ITEM), 'utf8')).toBe('owner draft\n');
  });

  it('refuses with occupied when the existing approval file is modified in the checkout', async () => {
    const dir = await baseRepo();
    expect((await land(dir)).ok).toBe(true);
    const tip1 = await rev(dir, 'master');
    writeFileIn(dir, ITEM, 'hand edit\n');

    const result = await land(dir, statement('v2'));
    expect(result).toMatchObject({ ok: false, reason: 'occupied' });
    expect(await rev(dir, 'master')).toBe(tip1);
    expect(readFileSync(join(dir, ITEM), 'utf8')).toBe('hand edit\n');
  });

  it('re-signing an existing approval replaces the file (M) and leaves a clean status', async () => {
    const dir = await baseRepo();
    expect((await land(dir)).ok).toBe(true);
    const tip1 = await rev(dir, 'master');

    const result = await land(dir, statement('v2'));
    expect(result.ok).toBe(true);
    expect(await gitIn(dir, ['diff-tree', '-r', '--name-status', tip1, 'master'])).toBe(
      `M\t${ITEM}`,
    );
    expect(await gitIn(dir, ['status', '--porcelain'])).toBe('');
    expect(readFileSync(join(dir, ITEM), 'utf8')).toBe('{"item":"phase-01","note":"v2"}\n');
  });

  it('produces a commit plain git verify-commit accepts (sanity check only)', async () => {
    const dir = await baseRepo();
    const result = await land(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const verified = await rawGit(dir, [
      '-c',
      'gpg.format=ssh',
      '-c',
      `gpg.ssh.allowedSignersFile=${allowedSigners}`,
      'verify-commit',
      result.commit,
    ]);
    expect(verified.exitCode).toBe(0);
    expect(verified.stderr).toMatch(/Good "git" signature for owner@counterpoint/);
  });

  it('never runs a planted reference-transaction hook, fsmonitor or gpg.ssh.program', async () => {
    const dir = await baseRepo();
    const marker = join(dir, '..', `${dir.split('/').pop()}-marker`);
    const script = writeFileIn(
      dir,
      '.git/trap.sh',
      `#!/bin/sh\necho "$0 $*" >> '${marker}'\nexit 1\n`,
    );
    chmodSync(script, 0o755);
    const hook = writeFileIn(dir, '.git/hooks/reference-transaction', `#!/bin/sh\n'${script}'\n`);
    chmodSync(hook, 0o755);
    await gitIn(dir, ['config', 'core.fsmonitor', script]);
    await gitIn(dir, ['config', 'commit.gpgsign', 'true']);
    await gitIn(dir, ['config', 'gpg.format', 'ssh']);
    await gitIn(dir, ['config', 'gpg.ssh.program', script]);
    await gitIn(dir, ['config', 'user.signingkey', key.publicKeyPath]);
    writeFileIn(dir, 'README.md', 'dirty\n');

    const result = await land(dir);
    expect(result.ok).toBe(true);
    expect(existsSync(marker)).toBe(false);

    // Positive control: the same repo's plain git does run the trap.
    await rawGit(dir, ['status']);
    await rawGit(dir, ['update-ref', 'refs/heads/control', 'HEAD']);
    expect(existsSync(marker)).toBe(true);
    rmSync(marker, { force: true });
  });
});

describe('gpgsig embedding', () => {
  it('embeds a signature as a gpgsig header and splits it back byte for byte', async () => {
    const dir = await baseRepo();
    const built = await buildApprovalCommit({
      root: dir,
      baseTip: await rev(dir, 'master'),
      itemPath: ITEM,
      fileBytes: statement(),
      message: 'approve\n\nbody line\n',
      ident,
    });
    const armored = await sign(built.payload);
    const signed = embedSignature(built.payload, armored);
    const text = new TextDecoder().decode(signed);
    expect(text).toMatch(
      /\ngpgsig -----BEGIN SSH SIGNATURE-----\n( .+\n)+ -----END SSH SIGNATURE-----\n\n/,
    );
    const split = splitSignedCommit(signed);
    expect(Buffer.from(split.payload).equals(Buffer.from(built.payload))).toBe(true);
    expect(split.signature).toBe(armored);
  });

  it('rejects zero or more than one gpgsig header', async () => {
    const dir = await baseRepo();
    const built = await buildApprovalCommit({
      root: dir,
      baseTip: await rev(dir, 'master'),
      itemPath: ITEM,
      fileBytes: statement(),
      message: 'approve\n',
      ident,
    });
    expect(() => splitSignedCommit(built.payload)).toThrow(/signature/i);
    const armored = await sign(built.payload);
    const signed = embedSignature(built.payload, armored);
    expect(() => embedSignature(signed, armored)).toThrow();
    const text = new TextDecoder().decode(signed);
    const block = /gpgsig [\s\S]*?-----END SSH SIGNATURE-----\n/.exec(text)?.[0] ?? '';
    const doubled = encoder.encode(text.replace(block, block + block));
    expect(() => splitSignedCommit(doubled)).toThrow(/signature/i);
  });
});

describe('ssh-keygen signer', () => {
  it('builds an environment without agent, askpass or display variables', () => {
    const env = sshKeygenEnv({
      PATH: '/evil/bin:/usr/bin',
      HOME: '/Users/owner',
      LANG: 'en_US.UTF-8',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
      SSH_ASKPASS: '/tmp/askpass',
      SSH_ASKPASS_REQUIRE: 'force',
      DISPLAY: ':0',
      GIT_DIR: '/elsewhere',
    });
    for (const name of ['SSH_AUTH_SOCK', 'SSH_ASKPASS', 'SSH_ASKPASS_REQUIRE', 'DISPLAY']) {
      expect(env[name], name).toBeUndefined();
    }
    expect(env).toEqual({ PATH: '/usr/bin:/bin', HOME: '/Users/owner', LANG: 'en_US.UTF-8' });
    expect(SSH_KEYGEN).toBe('/usr/bin/ssh-keygen');
  });

  it('never lets an askpass helper supply a protected key’s passphrase', async () => {
    const dir = makeScratchDir('askpass');
    const protectedKey = await makeThrowawayKey(dir, { passphrase: 'correct horse', name: 'pk' });
    const marker = join(dir, 'askpass-ran');
    const askpass = writeFileIn(
      dir,
      'askpass.sh',
      `#!/bin/sh\ntouch '${marker}'\necho 'correct horse'\n`,
    );
    chmodSync(askpass, 0o755);
    const trapEnv = { SSH_ASKPASS: askpass, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: ':0' };

    // Positive control: with the helper in its environment, ssh-keygen uses it.
    const control = await execa(
      SSH_KEYGEN,
      ['-Y', 'sign', '-n', 'git', '-f', protectedKey.privateKeyPath],
      {
        env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME ?? '/', ...trapEnv },
        extendEnv: false,
        input: 'payload',
        reject: false,
      },
    );
    expect(control.exitCode).toBe(0);
    expect(existsSync(marker)).toBe(true);
    rmSync(marker);

    const saved = { ...process.env };
    Object.assign(process.env, trapEnv);
    try {
      await expect(
        signPayload({
          payload: encoder.encode('payload'),
          privateKeyPath: protectedKey.privateKeyPath,
          timeoutMs: 5_000,
        }),
      ).rejects.toThrow();
    } finally {
      for (const name of Object.keys(trapEnv)) {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
      }
    }
    expect(existsSync(marker)).toBe(false);
  });
});

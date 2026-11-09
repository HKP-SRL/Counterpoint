// Signing-key checks on throwaway keys in scratch directories. Nothing here reads the real
// ~/.ssh, talks to the real ssh-agent or looks anything up in the real Keychain: ssh-add,
// security, launchctl and ssh are answered by a fake runner, and the home directory and ssh
// config are scratch paths.
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fingerprintOf } from '../../src/core/approvals/ssh.ts';
import type { TrustResult } from '../../src/core/approvals/trust-store.ts';
import {
  checkSigningKey,
  keyLoadableViaSshConfig,
  readOpenSshKeyHeader,
} from '../../src/doctor/signing-key.ts';
import { type CommandResult, type CommandRunner, runCommand } from '../../src/doctor/tools.ts';
import { makeThrowawayKey, type ThrowawayKey } from '../helpers/keys.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

let dir: string;
let plain: ThrowawayKey;
let protectedKey: ThrowawayKey;
let lowRounds: ThrowawayKey;
let protectedFingerprint: string;

async function keygen(args: string[]): Promise<void> {
  const result = await runCommand('/usr/bin/ssh-keygen', args, {
    env: { PATH: '/usr/bin:/bin', HOME: dir, LANG: 'C' },
  });
  if (result.exitCode !== 0) throw new Error(`ssh-keygen failed: ${result.stderr}`);
}

beforeAll(async () => {
  dir = makeScratchDir('sigkey');
  plain = await makeThrowawayKey(dir, { name: 'plain' });
  const protectedPath = join(dir, 'protected');
  await keygen([
    '-q',
    '-t',
    'ed25519',
    '-a',
    '16',
    '-N',
    'pass',
    '-C',
    'test',
    '-f',
    protectedPath,
  ]);
  protectedKey = { privateKeyPath: protectedPath, publicKeyPath: `${protectedPath}.pub` };
  const lowPath = join(dir, 'low');
  await keygen(['-q', '-t', 'ed25519', '-a', '4', '-N', 'pass', '-C', 'test', '-f', lowPath]);
  lowRounds = { privateKeyPath: lowPath, publicKeyPath: `${lowPath}.pub` };
  protectedFingerprint = await fingerprintOf(protectedKey.publicKeyPath);
});

afterAll(() => removeScratchDirs());

function trustFor(key: ThrowawayKey, fingerprint: string): TrustResult {
  return {
    ok: true,
    allowedSignersPath: join(dir, 'allowed_signers'),
    fingerprint,
    principal: 'owner@counterpoint',
    privateKeyPath: key.privateKeyPath,
    publicKeyPath: key.publicKeyPath,
  };
}

describe('readOpenSshKeyHeader', () => {
  it('reports cipher none and kdf none for an unprotected key', () => {
    const header = readOpenSshKeyHeader(plain.privateKeyPath);
    expect(header.cipher).toBe('none');
    expect(header.kdf).toBe('none');
  });

  it('reports aes256-ctr, bcrypt and 16 rounds for a -a 16 passphrase key', () => {
    const header = readOpenSshKeyHeader(protectedKey.privateKeyPath);
    expect(header.cipher).toBe('aes256-ctr');
    expect(header.kdf).toBe('bcrypt');
    expect(header.rounds).toBe(16);
  });

  it('returns only cipher, kdf and rounds', () => {
    const header = readOpenSshKeyHeader(protectedKey.privateKeyPath);
    expect(Object.keys(header).sort()).toEqual(['cipher', 'kdf', 'rounds']);
  });

  it('refuses a file that is not an OpenSSH private key', () => {
    const file = join(dir, 'not-a-key');
    writeFileSync(file, 'hello\n', { mode: 0o600 });
    expect(() => readOpenSshKeyHeader(file)).toThrow();
  });

  it('refuses a PEM body without the openssh-key-v1 magic', () => {
    const file = join(dir, 'bad-magic');
    const body = Buffer.from('not-openssh-key-v1-at-all').toString('base64');
    writeFileSync(
      file,
      `-----BEGIN OPENSSH PRIVATE KEY-----\n${body}\n-----END OPENSSH PRIVATE KEY-----\n`,
      { mode: 0o600 },
    );
    expect(() => readOpenSshKeyHeader(file)).toThrow();
  });

  it('refuses a symlink to a real key', () => {
    const link = join(dir, 'link-to-key');
    symlinkSync(protectedKey.privateKeyPath, link);
    expect(() => readOpenSshKeyHeader(link)).toThrow();
  });

  it('refuses a file of 16 KiB or more', () => {
    const file = join(dir, 'huge');
    writeFileSync(file, 'x'.repeat(16 * 1024), { mode: 0o600 });
    expect(() => readOpenSshKeyHeader(file)).toThrow();
  });

  it('never puts key material into an error message', () => {
    const file = join(dir, 'truncated');
    const text = readFileSync(protectedKey.privateKeyPath, 'utf8');
    const lines = text.trim().split('\n');
    const body = lines.slice(1, -1).join('');
    // Keep the magic but cut the body short, so parsing fails part-way.
    const cut = Buffer.from(body, 'base64').subarray(0, 30).toString('base64');
    writeFileSync(file, `${lines[0]}\n${cut}\n${lines.at(-1)}\n`, { mode: 0o600 });
    let message = '';
    try {
      readOpenSshKeyHeader(file);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe('');
    expect(message).not.toContain(cut.slice(0, 20));
  });
});

interface FakeAnswers {
  sshAdd?: Record<string, CommandResult>;
  launchctl?: CommandResult;
  security?: CommandResult;
  ssh?: CommandResult;
}

function fakeRun(answers: FakeAnswers): { run: CommandRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: CommandRunner = async (file, args, options) => {
    calls.push([file, ...args]);
    if (file === '/usr/bin/ssh-keygen') return runCommand(file, args, options);
    if (file === '/usr/bin/ssh-add') {
      const socket = options?.env?.SSH_AUTH_SOCK ?? '';
      return (
        answers.sshAdd?.[socket] ?? {
          exitCode: 2,
          stdout: '',
          stderr: 'Error connecting to agent: No such file or directory',
        }
      );
    }
    if (file === '/bin/launchctl')
      return answers.launchctl ?? { exitCode: 0, stdout: '', stderr: '' };
    if (file === '/usr/bin/security') {
      return (
        answers.security ?? {
          exitCode: 44,
          stdout: '',
          stderr: 'The specified item could not be found in the keychain.',
        }
      );
    }
    if (file === '/usr/bin/ssh') {
      return answers.ssh ?? { exitCode: 0, stdout: '', stderr: 'OpenSSH_10.3p1, LibreSSL 3.3.6\n' };
    }
    return { exitCode: null, stdout: '', stderr: '', error: 'ENOENT' };
  };
  return { run, calls };
}

function rowById(rows: { id: string }[], id: string) {
  const row = rows.find((r) => r.id === id);
  if (row === undefined) throw new Error(`no row ${id}`);
  return row as { id: string; result: string; detail: string; fix?: string };
}

describe('checkSigningKey', () => {
  const base = () => ({ env: {}, platform: 'darwin' as NodeJS.Platform, homeDir: dir });

  it('fails the passphrase row for an unprotected key, with a fix', async () => {
    const fingerprint = await fingerprintOf(plain.publicKeyPath);
    const { run } = fakeRun({});
    const rows = await checkSigningKey({ ...base(), trust: trustFor(plain, fingerprint), run });
    const row = rowById(rows, 'key-passphrase');
    expect(row.result).toBe('fail');
    expect(row.fix).toBeDefined();
  });

  it('passes the passphrase row for a protected key and names cipher, kdf and rounds', async () => {
    const { run } = fakeRun({});
    const rows = await checkSigningKey({
      ...base(),
      trust: trustFor(protectedKey, protectedFingerprint),
      run,
    });
    const row = rowById(rows, 'key-passphrase');
    expect(row.result).toBe('pass');
    expect(row.detail).toContain('aes256-ctr');
    expect(row.detail).toContain('bcrypt');
  });

  it('notes fewer than 16 bcrypt rounds in the passphrase detail', async () => {
    const fingerprint = await fingerprintOf(lowRounds.publicKeyPath);
    const { run } = fakeRun({});
    const rows = await checkSigningKey({ ...base(), trust: trustFor(lowRounds, fingerprint), run });
    const row = rowById(rows, 'key-passphrase');
    expect(row.result).toBe('pass');
    expect(row.detail).toMatch(/4 rounds/);
    expect(row.detail).toMatch(/fewer than 16/);
  });

  it('cross-checks the header with ssh-keygen -y -P empty', async () => {
    const { run, calls } = fakeRun({});
    await checkSigningKey({ ...base(), trust: trustFor(protectedKey, protectedFingerprint), run });
    expect(calls).toContainEqual([
      '/usr/bin/ssh-keygen',
      '-y',
      '-P',
      '',
      '-f',
      protectedKey.privateKeyPath,
    ]);
  });

  it('fails the agent row when ssh-add -l lists the trusted fingerprint', async () => {
    const { run } = fakeRun({
      sshAdd: {
        '/tmp/shell-agent.sock': {
          exitCode: 0,
          stdout: `256 ${protectedFingerprint} test (ED25519)\n`,
          stderr: '',
        },
      },
    });
    const rows = await checkSigningKey({
      ...base(),
      env: { SSH_AUTH_SOCK: '/tmp/shell-agent.sock' },
      trust: trustFor(protectedKey, protectedFingerprint),
      run,
    });
    const row = rowById(rows, 'key-agent');
    expect(row.result).toBe('fail');
    expect(row.fix).toBeDefined();
  });

  it('passes the agent row when the agent has no identities', async () => {
    const { run } = fakeRun({
      sshAdd: {
        '/tmp/shell-agent.sock': {
          exitCode: 1,
          stdout: 'The agent has no identities.\n',
          stderr: '',
        },
      },
    });
    const rows = await checkSigningKey({
      ...base(),
      env: { SSH_AUTH_SOCK: '/tmp/shell-agent.sock' },
      trust: trustFor(protectedKey, protectedFingerprint),
      run,
    });
    expect(rowById(rows, 'key-agent').result).toBe('pass');
  });

  it('passes the agent row when no agent is running', async () => {
    const { run } = fakeRun({});
    const rows = await checkSigningKey({
      ...base(),
      trust: trustFor(protectedKey, protectedFingerprint),
      run,
    });
    expect(rowById(rows, 'key-agent').result).toBe('pass');
  });

  it('passes the agent row when another key is loaded', async () => {
    const { run } = fakeRun({
      sshAdd: {
        '/tmp/shell-agent.sock': {
          exitCode: 0,
          stdout: '256 SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA other (ED25519)\n',
          stderr: '',
        },
      },
    });
    const rows = await checkSigningKey({
      ...base(),
      env: { SSH_AUTH_SOCK: '/tmp/shell-agent.sock' },
      trust: trustFor(protectedKey, protectedFingerprint),
      run,
    });
    expect(rowById(rows, 'key-agent').result).toBe('pass');
  });

  it("also asks launchd's agent socket on macOS", async () => {
    const { run, calls } = fakeRun({
      launchctl: { exitCode: 0, stdout: '/private/tmp/launchd-agent/Listeners\n', stderr: '' },
      sshAdd: {
        '/private/tmp/launchd-agent/Listeners': {
          exitCode: 0,
          stdout: `256 ${protectedFingerprint} test (ED25519)\n`,
          stderr: '',
        },
      },
    });
    const rows = await checkSigningKey({
      ...base(),
      trust: trustFor(protectedKey, protectedFingerprint),
      run,
    });
    expect(calls).toContainEqual(['/bin/launchctl', 'getenv', 'SSH_AUTH_SOCK']);
    expect(rowById(rows, 'key-agent').result).toBe('fail');
  });

  it('fails the Keychain row when a passphrase is stored for the key path', async () => {
    const { run, calls } = fakeRun({
      security: { exitCode: 0, stdout: 'keychain: "login.keychain-db"\n', stderr: '' },
    });
    const rows = await checkSigningKey({
      ...base(),
      trust: trustFor(protectedKey, protectedFingerprint),
      run,
    });
    const row = rowById(rows, 'key-keychain');
    expect(row.result).toBe('fail');
    const lookup = calls.find((call) => call[0] === '/usr/bin/security');
    expect(lookup).toEqual([
      '/usr/bin/security',
      'find-generic-password',
      '-s',
      'OpenSSH',
      '-a',
      protectedKey.privateKeyPath,
    ]);
    expect(lookup).not.toContain('-w');
    expect(lookup).not.toContain('-g');
  });

  it('passes the Keychain row when nothing is stored and states the A4 assumption', async () => {
    const { run } = fakeRun({});
    const rows = await checkSigningKey({
      ...base(),
      trust: trustFor(protectedKey, protectedFingerprint),
      run,
    });
    const row = rowById(rows, 'key-keychain');
    expect(row.result).toBe('pass');
    expect(row.detail).toContain('A4');
  });

  it('fails the Keychain row when ssh config adds this key to the agent', async () => {
    const sshDir = join(dir, 'home-kc', '.ssh');
    mkdirSync(sshDir, { recursive: true });
    writeFileSync(
      join(sshDir, 'config'),
      `Host *\n  UseKeychain yes\n  IdentityFile ${protectedKey.privateKeyPath}\n`,
    );
    const { run } = fakeRun({});
    const rows = await checkSigningKey({
      ...base(),
      homeDir: join(dir, 'home-kc'),
      trust: trustFor(protectedKey, protectedFingerprint),
      run,
    });
    expect(rowById(rows, 'key-keychain').result).toBe('fail');
  });

  it('checks OpenSSH 8.1 or newer from ssh -V', async () => {
    const { run } = fakeRun({ ssh: { exitCode: 0, stdout: '', stderr: 'OpenSSH_8.0p1\n' } });
    const rows = await checkSigningKey({
      ...base(),
      trust: trustFor(protectedKey, protectedFingerprint),
      run,
    });
    expect(rowById(rows, 'openssh').result).toBe('fail');
  });

  it('passes the trusted-key row with the fingerprint', async () => {
    const { run } = fakeRun({});
    const rows = await checkSigningKey({
      ...base(),
      trust: trustFor(protectedKey, protectedFingerprint),
      run,
    });
    const row = rowById(rows, 'trusted-key');
    expect(row.result).toBe('pass');
    expect(row.detail).toContain(protectedFingerprint);
  });

  it('fails every key row with the init-key fix when no key is trusted', async () => {
    const { run } = fakeRun({});
    const rows = await checkSigningKey({
      ...base(),
      trust: { ok: false, error: 'no-trusted-key', detail: 'No signing key is trusted yet.' },
      run,
    });
    for (const id of ['key-passphrase', 'key-agent', 'key-keychain', 'trusted-key']) {
      const row = rowById(rows, id);
      expect(row.result).toBe('fail');
      expect(row.fix).toContain('counterpoint init-key');
      expect(row.fix).toContain('counterpoint trust-key');
    }
  });

  it('never prints key material', async () => {
    const { run } = fakeRun({});
    const rows = await checkSigningKey({
      ...base(),
      trust: trustFor(protectedKey, protectedFingerprint),
      run,
    });
    const text = JSON.stringify(rows);
    const body = readFileSync(protectedKey.privateKeyPath, 'utf8').split('\n')[1] as string;
    expect(text).not.toContain('PRIVATE KEY');
    expect(text).not.toContain(body.slice(0, 24));
  });
});

describe('keyLoadableViaSshConfig', () => {
  const keyPath = '/Users/someone/.ssh/counterpoint_approval';
  const homeDir = '/Users/someone';

  function config(name: string, text: string): string {
    const file = join(dir, name);
    writeFileSync(file, text);
    return file;
  }

  it('is true for Host * with UseKeychain yes and this IdentityFile', () => {
    const file = config(
      'cfg-keychain',
      'Host *\n  UseKeychain yes\n  IdentityFile ~/.ssh/counterpoint_approval\n',
    );
    expect(keyLoadableViaSshConfig(file, keyPath, { homeDir })).toBe(true);
  });

  it('is true for AddKeysToAgent yes with this IdentityFile', () => {
    const file = config(
      'cfg-agent',
      'Host cena\n  AddKeysToAgent=yes\n  IdentityFile "~/.ssh/counterpoint_approval"\n',
    );
    expect(keyLoadableViaSshConfig(file, keyPath, { homeDir })).toBe(true);
  });

  it('is false when the same settings never name this key', () => {
    const file = config(
      'cfg-other',
      'Host *\n  UseKeychain yes\n  AddKeysToAgent yes\n  IdentityFile ~/.ssh/id_ed25519\n',
    );
    expect(keyLoadableViaSshConfig(file, keyPath, { homeDir })).toBe(false);
  });

  it('is false when AddKeysToAgent is no and UseKeychain is not set', () => {
    const file = config(
      'cfg-no',
      'Host *\n  AddKeysToAgent no\n  IdentityFile ~/.ssh/counterpoint_approval\n',
    );
    expect(keyLoadableViaSshConfig(file, keyPath, { homeDir })).toBe(false);
  });

  it('follows Include files (relative to the config directory and with a glob)', () => {
    const sshDir = join(dir, 'inc', '.ssh');
    mkdirSync(join(sshDir, 'config.d'), { recursive: true });
    writeFileSync(join(sshDir, 'config'), 'Include config.d/*\nHost *\n  UseKeychain yes\n');
    writeFileSync(
      join(sshDir, 'config.d', 'cena'),
      'Host cena\n  IdentityFile ~/.ssh/counterpoint_approval\n',
    );
    expect(keyLoadableViaSshConfig(join(sshDir, 'config'), keyPath, { homeDir })).toBe(true);
  });

  it('is false for a missing config file', () => {
    expect(keyLoadableViaSshConfig(join(dir, 'no-such-config'), keyPath, { homeDir })).toBe(false);
  });

  it('survives an Include loop', () => {
    const a = join(dir, 'loop-a');
    const b = join(dir, 'loop-b');
    writeFileSync(a, `Include ${b}\nUseKeychain yes\n`);
    writeFileSync(b, `Include ${a}\nIdentityFile ${keyPath}\n`);
    expect(keyLoadableViaSshConfig(a, keyPath, { homeDir })).toBe(true);
  });
});

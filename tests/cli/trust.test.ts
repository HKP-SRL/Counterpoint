// Owner setup commands: init-key, trust-key, trust {host}. Driven as functions with an injected
// TTY flag and answer, against scratch homes, scratch repositories and throwaway keys. Nothing
// here touches the real ~/.ssh, ssh-agent, Keychain or Counterpoint home.
import {
  existsSync,
  readFileSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initKeyCommand, trustHostCommand, trustKeyCommand } from '../../src/cli/trust.ts';
import { snapshotIntegrity, writeBaseline } from '../../src/core/approvals/integrity.ts';
import { fingerprintOf } from '../../src/core/approvals/ssh.ts';
import { openStore, upsertHost } from '../../src/core/store/db.ts';
import { makeThrowawayKey, type ThrowawayKey } from '../helpers/keys.ts';
import {
  commitAll,
  gitIn,
  initScratchRepo,
  makeScratchDir,
  removeScratchDirs,
  writeFileIn,
} from '../helpers/scratch.ts';

let keysDir: string;
let protectedKey: ThrowawayKey;
let plainKey: ThrowawayKey;

beforeAll(async () => {
  keysDir = makeScratchDir('tkeys');
  protectedKey = await makeThrowawayKey(keysDir, { name: 'approval', passphrase: 'pass' });
  plainKey = await makeThrowawayKey(keysDir, { name: 'plain' });
});

afterAll(() => removeScratchDirs());

interface Captured {
  out: string[];
  err: string[];
  questions: string[];
}

function io(answer: string | null, isTTY = true) {
  const captured: Captured = { out: [], err: [], questions: [] };
  return {
    captured,
    options: {
      isTTY,
      confirm: async (question: string) => {
        captured.questions.push(question);
        if (answer === null) throw new Error('confirm must not be called');
        return answer;
      },
      out: (line: string) => captured.out.push(line),
      err: (line: string) => captured.err.push(line),
    },
  };
}

describe('initKeyCommand', () => {
  it('prints the key-generation command and the trust-key follow-up', () => {
    const lines: string[] = [];
    initKeyCommand((line) => lines.push(line));
    const text = lines.join('\n');
    expect(text).toContain(
      'ssh-keygen -t ed25519 -a 100 -f ~/.ssh/counterpoint_approval -C counterpoint-approval',
    );
    expect(text).toContain('counterpoint trust-key ~/.ssh/counterpoint_approval.pub');
    expect(text).toContain(
      'Choose a passphrase. Do not add this key to ssh-agent or your Keychain.',
    );
  });
});

describe('trustKeyCommand', () => {
  it('pins a protected key after the owner answers y at a terminal', async () => {
    const home = makeScratchDir('thome');
    const { captured, options } = io('y');
    const code = await trustKeyCommand(home, protectedKey.publicKeyPath, options);
    const fingerprint = await fingerprintOf(protectedKey.publicKeyPath);
    expect(code).toBe(0);
    expect(captured.out).toContain(`Key: ${protectedKey.publicKeyPath}`);
    expect(captured.out).toContain(`Fingerprint: ${fingerprint}`);
    expect(captured.questions).toEqual(['Trust this key for approvals? [y/N] ']);
    expect(captured.out.at(-1)).toBe(
      `Trusted approval key ${fingerprint} (${protectedKey.publicKeyPath}). Approvals must be signed by this key.`,
    );
    for (const name of ['allowed_signers', 'key.json']) {
      const file = join(home, 'trust', name);
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it('writes nothing when the owner answers n', async () => {
    const home = makeScratchDir('thome');
    const { captured, options } = io('n');
    const code = await trustKeyCommand(home, protectedKey.publicKeyPath, options);
    expect(code).not.toBe(0);
    expect(captured.out.at(-1)).toBe('Nothing saved.');
    expect(existsSync(join(home, 'trust'))).toBe(false);
  });

  it('refuses without a terminal and writes nothing', async () => {
    const home = makeScratchDir('thome');
    const { captured, options } = io(null, false);
    const code = await trustKeyCommand(home, protectedKey.publicKeyPath, options);
    expect(code).toBe(1);
    expect(captured.err).toContain(
      'counterpoint trust-key needs a terminal so you can confirm the key.',
    );
    expect(captured.questions).toEqual([]);
    expect(existsSync(join(home, 'trust'))).toBe(false);
  });

  it('refuses a key without a passphrase and writes nothing', async () => {
    const home = makeScratchDir('thome');
    const { captured, options } = io(null);
    const code = await trustKeyCommand(home, plainKey.publicKeyPath, options);
    expect(code).not.toBe(0);
    expect(captured.questions).toEqual([]);
    expect(captured.err.join('\n')).toMatch(/passphrase/);
    expect(existsSync(join(home, 'trust'))).toBe(false);
  });

  it('refuses a public key file that holds two keys', async () => {
    const home = makeScratchDir('thome');
    const second = await makeThrowawayKey(keysDir, { name: 'second', passphrase: 'pass' });
    const doubled = join(keysDir, 'doubled');
    const doubledPub = `${doubled}.pub`;
    writeFileSync(doubled, readFileSync(protectedKey.privateKeyPath), { mode: 0o600 });
    writeFileSync(
      doubledPub,
      `${readFileSync(protectedKey.publicKeyPath, 'utf8')}${readFileSync(second.publicKeyPath, 'utf8')}`,
    );
    const { captured, options } = io(null);
    const code = await trustKeyCommand(home, doubledPub, options);
    expect(code).not.toBe(0);
    expect(captured.questions).toEqual([]);
    expect(existsSync(join(home, 'trust'))).toBe(false);
  });
});

describe('trustKeyCommand: the key is swapped while the prompt is open (WR-02)', () => {
  /** A protected key copied to its own folder, so the test can replace its public half. */
  async function ownKey(name: string): Promise<{ pub: string; other: ThrowawayKey }> {
    const dir = makeScratchDir('tswap');
    const key = await makeThrowawayKey(dir, { name, passphrase: 'pass' });
    const other = await makeThrowawayKey(dir, { name: `${name}-other`, passphrase: 'pass' });
    return { pub: key.publicKeyPath, other };
  }

  /** Answers y after running `swap`, as if the file changed while the owner read the prompt. */
  function swapThenYes(swap: () => void) {
    const { captured, options } = io('y');
    return {
      captured,
      options: {
        ...options,
        confirm: async (question: string) => {
          captured.questions.push(question);
          swap();
          return 'y';
        },
      },
    };
  }

  it('refuses and writes nothing when the file holds another key at write time', async () => {
    const home = makeScratchDir('thome');
    const { pub, other } = await ownKey('swapped');
    const { captured, options } = swapThenYes(() =>
      writeFileSync(pub, readFileSync(other.publicKeyPath)),
    );
    const code = await trustKeyCommand(home, pub, options);
    expect(code).toBe(1);
    expect(captured.questions).toHaveLength(1);
    expect(captured.err).toContain(
      'The public key file changed after you confirmed it. Nothing saved.',
    );
    expect(existsSync(join(home, 'trust'))).toBe(false);
  });

  it('refuses and writes nothing when the file became a symlink at write time', async () => {
    const home = makeScratchDir('thome');
    const { pub, other } = await ownKey('linked');
    const { captured, options } = swapThenYes(() => {
      unlinkSync(pub);
      symlinkSync(other.publicKeyPath, pub);
    });
    const code = await trustKeyCommand(home, pub, options);
    expect(code).toBe(1);
    expect(captured.err).toContain(
      'The public key file changed after you confirmed it. Nothing saved.',
    );
    expect(existsSync(join(home, 'trust'))).toBe(false);
  });

  it('pins the confirmed bytes when the file is rewritten with the same key', async () => {
    const home = makeScratchDir('thome');
    const { pub } = await ownKey('same');
    const before = readFileSync(pub, 'utf8');
    const { options } = swapThenYes(() =>
      writeFileSync(pub, before.replace(/ \S+\n?$/, ' renamed\n')),
    );
    const code = await trustKeyCommand(home, pub, options);
    expect(code).toBe(0);
    const pinned = readFileSync(join(home, 'trust', 'allowed_signers'), 'utf8');
    expect(pinned).toBe(
      `owner@counterpoint namespaces="git" ${before.split(' ').slice(0, 2).join(' ')}\n`,
    );
  });

  it('shows the fingerprint of the bytes it read, without running ssh-keygen on the path', async () => {
    const home = makeScratchDir('thome');
    const { pub, other } = await ownKey('shown');
    const expected = await fingerprintOf(pub);
    // Swapped right after the read: the shown fingerprint is still the read key's.
    const { captured, options } = io('n');
    const code = await trustKeyCommand(home, pub, {
      ...options,
      out: (line: string) => {
        captured.out.push(line);
        if (line.startsWith('Key: ')) writeFileSync(pub, readFileSync(other.publicKeyPath));
      },
    });
    expect(code).toBe(1);
    expect(captured.out).toContain(`Fingerprint: ${expected}`);
  });
});

async function scratchHost(): Promise<{ home: string; root: string; gitDir: string }> {
  const home = makeScratchDir('thost');
  const root = makeScratchDir('trepo');
  await initScratchRepo(root);
  writeFileIn(root, 'README.md', 'hi\n');
  await commitAll(root);
  const gitDir = join(root, '.git');
  const store = openStore(home);
  try {
    upsertHost(store, {
      id: 'demo',
      root,
      gitCommonDir: gitDir,
      baseBranch: 'main',
      adapter: 'none',
    });
  } finally {
    store.close();
  }
  return { home, root, gitDir };
}

describe('trustHostCommand', () => {
  it('refuses without a terminal and writes nothing', async () => {
    const { home } = await scratchHost();
    const { captured, options } = io(null, false);
    const code = await trustHostCommand(home, 'demo', options);
    expect(code).toBe(1);
    expect(captured.err).toContain(
      'counterpoint trust needs a terminal so you can review this list.',
    );
    expect(existsSync(join(home, 'hosts', 'demo', 'integrity.json'))).toBe(false);
  });

  it('saves the baseline after the owner answers y', async () => {
    const { home } = await scratchHost();
    const { captured, options } = io('y');
    const code = await trustHostCommand(home, 'demo', options);
    expect(code).toBe(0);
    expect(captured.questions).toEqual(['Accept this as the baseline for demo? [y/N] ']);
    expect(captured.out.at(-1)).toBe('Baseline saved for demo.');
    const file = join(home, 'hosts', 'demo', 'integrity.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('writes nothing when the owner answers n', async () => {
    const { home } = await scratchHost();
    const { captured, options } = io('n');
    const code = await trustHostCommand(home, 'demo', options);
    expect(code).not.toBe(0);
    expect(captured.out.at(-1)).toBe('Nothing saved.');
    expect(existsSync(join(home, 'hosts', 'demo', 'integrity.json'))).toBe(false);
  });

  it('prints the full list grouped by config, hooks, info and config.worktree', async () => {
    const { home, gitDir } = await scratchHost();
    await gitIn(gitDir, ['--git-dir', gitDir, 'config', 'core.fsmonitor', 'echo hi']);
    writeFileSync(join(gitDir, 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const { captured, options } = io('n');
    await trustHostCommand(home, 'demo', options);
    const text = captured.out.join('\n');
    expect(text).toMatch(/^config$/m);
    expect(text).toMatch(/^ {2}core\.fsmonitor = echo hi$/m);
    expect(text).toMatch(/^hooks$/m);
    expect(text).toMatch(/^ {2}pre-commit {2}[0-9a-f]{12}$/m);
    expect(text).toMatch(/^info$/m);
    expect(text).toMatch(/^config\.worktree$/m);
  });

  it('prints the changes since an existing baseline before the full list', async () => {
    const { home, gitDir } = await scratchHost();
    writeBaseline(home, 'demo', await snapshotIntegrity(gitDir));
    writeFileSync(join(gitDir, 'hooks', 'post-checkout'), '#!/bin/sh\n', { mode: 0o755 });
    const { captured, options } = io('n');
    await trustHostCommand(home, 'demo', options);
    const changedAt = captured.out.indexOf('Changed since the last baseline:');
    const hooksAt = captured.out.indexOf('hooks');
    expect(changedAt).toBeGreaterThanOrEqual(0);
    expect(hooksAt).toBeGreaterThan(changedAt);
    expect(captured.out.slice(changedAt, hooksAt).join('\n')).toContain('post-checkout');
  });

  it('never prints terminal control characters from repository config', async () => {
    const { home, gitDir } = await scratchHost();
    await gitIn(gitDir, ['--git-dir', gitDir, 'config', 'core.pager', 'less\u001b[2Khidden']);
    const { captured, options } = io('n');
    await trustHostCommand(home, 'demo', options);
    const text = captured.out.join('\n');
    expect(text).not.toContain('\u001b');
    expect(text).toContain('core.pager');
  });

  it('refuses an unknown host id', async () => {
    const { home } = await scratchHost();
    const { captured, options } = io(null);
    const code = await trustHostCommand(home, 'nope', options);
    expect(code).toBe(2);
    expect(captured.err.join('\n')).toContain('demo');
  });

  it('refuses an id that fails the host id pattern before touching the store', async () => {
    const home = makeScratchDir('tnohome');
    const { captured, options } = io(null);
    const code = await trustHostCommand(home, '../etc', options);
    expect(code).toBe(2);
    expect(captured.err.join('\n')).toMatch(/Invalid host id/);
    expect(existsSync(join(home, 'state.db'))).toBe(false);
  });
});

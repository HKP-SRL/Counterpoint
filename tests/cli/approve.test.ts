// `counterpoint approve {host} {change}` driven as a function: scratch home, scratch copy of the
// synthetic host, a throwaway unprotected ed25519 key trusted through the library (the trust-key
// command itself refuses unprotected keys), an integrity baseline, an injected TTY flag and an
// optional signing seam. Nothing here touches ~/.ssh, ssh-agent, the Keychain, the real
// Counterpoint home or a real host repository.
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOpenSpecAdapter } from '../../src/adapters/openspec/index.ts';
import { approveCommand } from '../../src/cli/approve.ts';
import { snapshotIntegrity, writeBaseline } from '../../src/core/approvals/integrity.ts';
import { signPayload } from '../../src/core/approvals/ssh.ts';
import { readTrust, writeTrust } from '../../src/core/approvals/trust-store.ts';
import { createGitFileReader } from '../../src/core/git/reader.ts';
import { approvalState } from '../../src/core/runway/runway.ts';
import { openStore, upsertHost } from '../../src/core/store/db.ts';
import { commitChange, type FixtureRepo, materializeFixtureRepo } from '../helpers/fixture-repo.ts';
import { makeThrowawayKey, type ThrowawayKey } from '../helpers/keys.ts';
import { gitIn, makeScratchDir, removeScratchDirs, writeFileIn } from '../helpers/scratch.ts';

const APPROVAL = '.counterpoint/approvals/ready-thing.json';
const PROPOSAL = 'openspec/changes/ready-thing/proposal.md';
const SUCCESS = "Signed and verified. Runway is now 1. Not pushed: push master when you're ready.";

let key: ThrowawayKey;
let otherKey: ThrowawayKey;

beforeAll(async () => {
  const keysDir = makeScratchDir('akeys');
  key = await makeThrowawayKey(keysDir, { name: 'approval' });
  otherKey = await makeThrowawayKey(keysDir, { name: 'other' });
});

afterAll(() => removeScratchDirs());

interface Setup {
  repo: FixtureRepo;
  home: string;
}

async function setup(options: { trust?: boolean; baseline?: boolean } = {}): Promise<Setup> {
  const repo = await materializeFixtureRepo('synthetic');
  const home = makeScratchDir('ahome');
  const store = openStore(home);
  try {
    upsertHost(store, {
      id: 'synthetic',
      root: repo.root,
      gitCommonDir: join(repo.root, '.git'),
      baseBranch: 'master',
      adapter: 'openspec',
    });
  } finally {
    store.close();
  }
  if (options.trust !== false) await writeTrust(home, { publicKeyPath: key.publicKeyPath });
  if (options.baseline !== false) {
    writeBaseline(home, 'synthetic', await snapshotIntegrity(join(repo.root, '.git')));
  }
  return { repo, home };
}

async function master(root: string): Promise<string> {
  return (await gitIn(root, ['rev-parse', 'refs/heads/master'])).trim();
}

async function run(
  home: string,
  overrides: Partial<Parameters<typeof approveCommand>[0]> = {},
): Promise<{ code: number; out: string; err: string; notices: unknown[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const notices: unknown[] = [];
  const code = await approveCommand({
    home,
    hostId: 'synthetic',
    changeId: 'ready-thing',
    isTTY: true,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    notify: async (_home, body) => {
      notices.push(body);
    },
    ...overrides,
  });
  return { code, out: out.join('\n'), err: err.join('\n'), notices };
}

/** Runs approve expecting a refusal; asserts master did not move and returns the output. */
async function refused(
  s: Setup,
  overrides: Partial<Parameters<typeof approveCommand>[0]> = {},
): Promise<{ code: number; out: string; err: string }> {
  const before = await master(s.repo.root);
  const result = await run(s.home, overrides);
  expect(result.code).not.toBe(0);
  expect(await master(s.repo.root)).toBe(before);
  expect(result.out).not.toContain('Signed and verified');
  expect(result.notices).toEqual([]);
  return result;
}

describe('approveCommand: success', () => {
  it('prints what is signed, lands a verified commit and keeps the owner’s work untouched', async () => {
    const s = await setup();
    // Owner's uncommitted work in the checkout.
    writeFileIn(s.repo.root, PROPOSAL, 'work in progress\n');
    writeFileIn(s.repo.root, 'scratch-notes.txt', 'untracked\n');
    const statusBefore = await gitIn(s.repo.root, ['status', '--porcelain']);
    const tipBefore = await master(s.repo.root);

    const result = await run(s.home);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);

    expect(result.out).toContain('You are signing');
    expect(result.out).toContain('Change ready-thing: Ready thing');
    expect(result.out).toContain(`Base: master at ${tipBefore}`);
    expect(result.out).toContain('Draft: none');
    expect(result.out).toContain('Gates: none yet');
    expect(result.out).toMatch(/Statement [0-9a-f]{12}/);
    expect(result.out).toContain('Owner steps (you do these by hand):');
    expect(result.out).toContain('- Owner: create the Supabase project');
    expect(result.out).toContain('(normalized: cp-openspec-tasks/v1)');
    expect(result.out).toContain('Signing as Counterpoint Test <test@counterpoint.invalid>');
    expect(result.out).toContain(SUCCESS);

    // Every input digest, in full, as committed in the statement.
    const statement = JSON.parse(await gitIn(s.repo.root, ['show', `master:${APPROVAL}`])) as {
      inputs: { files: { digest: string }[]; combined: string };
    };
    expect(statement.inputs.files).toHaveLength(5);
    for (const file of statement.inputs.files) expect(result.out).toContain(file.digest);

    // One new commit on master that adds only the approval file; nothing pushed, owner's work kept.
    const tipAfter = await master(s.repo.root);
    expect((await gitIn(s.repo.root, ['rev-parse', `${tipAfter}^`])).trim()).toBe(tipBefore);
    expect(
      (
        await gitIn(s.repo.root, ['diff-tree', '--no-commit-id', '--name-status', '-r', tipAfter])
      ).trim(),
    ).toBe(`A\t${APPROVAL}`);
    expect(await gitIn(s.repo.root, ['status', '--porcelain'])).toBe(statusBefore);
    expect(result.notices).toEqual([{ hostId: 'synthetic', family: 'approval' }]);
  });

  it('commits with the change in the message', async () => {
    const s = await setup();
    expect((await run(s.home)).code).toBe(0);
    const subject = await gitIn(s.repo.root, ['log', '-1', '--format=%s', 'master']);
    expect(subject.trim()).toBe('counterpoint: approve change ready-thing');
  });

  it('re-signing after an input changed replaces the approval file and is on-runway again', async () => {
    const s = await setup();
    expect((await run(s.home)).code).toBe(0);
    const original = await gitIn(s.repo.root, ['show', `master:${PROPOSAL}`]);
    await commitChange(s.repo.root, PROPOSAL, `${original}\nA new reason.\n`);

    const again = await run(s.home);
    expect(again.code).toBe(0);
    expect(again.out).toContain(SUCCESS);
    const tip = await master(s.repo.root);
    expect(
      (
        await gitIn(s.repo.root, ['diff-tree', '--no-commit-id', '--name-status', '-r', tip])
      ).trim(),
    ).toBe(`M\t${APPROVAL}`);

    const trust = readTrust(s.home);
    if (!trust.ok) throw new Error('trust');
    const state = await approvalState({
      hostId: 'synthetic',
      root: s.repo.root,
      baseBranch: 'master',
      changeId: 'ready-thing',
      reader: createGitFileReader(s.repo.root),
      adapter: createOpenSpecAdapter(),
      trust,
      tmpDir: makeScratchDir('atmp'),
    });
    expect(state.state).toBe('on-runway');
  });
});

describe('approveCommand: refusals before anything is signed', () => {
  it('refuses a malformed host id or change id', async () => {
    const s = await setup();
    const badHost = await refused(s, { hostId: 'Bad Host!' });
    expect(badHost.code).toBe(2);
    expect(badHost.err).toContain('Invalid host id');
    const badChange = await refused(s, { changeId: 'Bad_Change' });
    expect(badChange.code).toBe(2);
    expect(badChange.err).toContain('Invalid change id');
  });

  it('refuses an unknown project', async () => {
    const s = await setup();
    const result = await refused(s, { hostId: 'nope' });
    expect(result.err).toContain('Unknown project "nope". Registered: synthetic.');
  });

  it('refuses without a trusted key', async () => {
    const s = await setup({ trust: false });
    const result = await refused(s);
    expect(result.err).toContain(
      'No approval key is trusted yet. Run "counterpoint init-key", then "counterpoint trust-key ~/.ssh/counterpoint_approval.pub".',
    );
  });

  it('refuses without an integrity baseline', async () => {
    const s = await setup({ baseline: false });
    const result = await refused(s);
    expect(result.err).toContain(
      'No integrity baseline for synthetic yet. Run "counterpoint trust synthetic", review the list, then approve again.',
    );
  });

  it('refuses when the integrity snapshot changed, listing the change', async () => {
    const s = await setup();
    writeFileIn(s.repo.root, '.git/hooks/pre-commit', '#!/bin/sh\nexit 0\n');
    const result = await refused(s);
    expect(result.err).toContain(
      "Signing would be refused: synthetic's .git/config (or hooks) changed since Counterpoint last checked.",
    );
    expect(result.err).toContain('hooks pre-commit');
  });

  it.each([
    [
      'no-proposal',
      'Not ready to approve. no-proposal has no proposal.md yet. Run /opsx:propose in synthetic, commit, then come back.',
    ],
    [
      'no-tasks',
      'Not ready to approve. no-tasks has no tasks.md yet. You sign the exact tasks the builder will run. Run /opsx:propose or add tasks in synthetic, commit, then come back.',
    ],
    ['built-thing', 'built-thing is already built. Approval is not offered.'],
    ['old-thing', 'old-thing is already built. Approval is not offered.'],
    ['broken-yaml', "Couldn't read broken-yaml: openspec/changes/broken-yaml/.openspec.yaml"],
    ['no-such-change', "no-such-change is not a change in synthetic's planning on master."],
  ])('refuses change %s with a specific message', async (changeId, message) => {
    const s = await setup();
    const result = await refused(s, { changeId });
    expect(result.err).toContain(message);
    expect(result.out).not.toContain('You are signing');
  });

  it('refuses without a terminal', async () => {
    const s = await setup();
    const result = await refused(s, { isTTY: false });
    expect(result.err).toContain(
      'counterpoint approve needs a terminal: you type your passphrase there.',
    );
  });

  it('refuses when the approval path is occupied in the checkout', async () => {
    const s = await setup();
    writeFileIn(s.repo.root, APPROVAL, '{"mine": true}\n');
    let signed = false;
    const result = await refused(s, {
      sign: async () => {
        signed = true;
        return '';
      },
    });
    expect(signed).toBe(false);
    expect(result.err).toContain(
      `A file already exists at ${APPROVAL} in your checkout. Move it, then approve again.`,
    );
  });
});

describe('approveCommand: refusals at signing time', () => {
  it('refuses when the base moved while signing', async () => {
    const s = await setup();
    let raced = '';
    const result = await run(s.home, {
      sign: async (payload) => {
        raced = await commitChange(s.repo.root, 'unrelated.txt', 'moved\n');
        return signPayload({ payload, privateKeyPath: key.privateKeyPath });
      },
    });
    expect(result.code).not.toBe(0);
    expect(result.err).toContain(
      'master moved while you were signing. Run the command again to sign the current version.',
    );
    expect(await master(s.repo.root)).toBe(raced);
    expect(await gitIn(s.repo.root, ['ls-tree', '--name-only', 'master', '.counterpoint/'])).toBe(
      '',
    );
  });

  it('refuses a signature that does not verify against the trusted key and lands nothing', async () => {
    const s = await setup();
    const before = await master(s.repo.root);
    const result = await run(s.home, {
      sign: (payload) => signPayload({ payload, privateKeyPath: otherKey.privateKeyPath }),
    });
    expect(result.code).not.toBe(0);
    expect(result.err).toContain(
      'The signature did not verify against your trusted key. Nothing was changed.',
    );
    expect(await master(s.repo.root)).toBe(before);
  });

  it('reports a signing failure and changes nothing', async () => {
    const s = await setup();
    const before = await master(s.repo.root);
    const result = await run(s.home, {
      sign: async () => {
        throw new Error('ssh-keygen could not sign (exit 255): incorrect passphrase');
      },
    });
    expect(result.code).not.toBe(0);
    expect(result.err).toContain('Signing failed. Nothing was changed.');
    expect(await master(s.repo.root)).toBe(before);
  });
});

// Large synthetic OpenSpec hosts for the heavy-data cases (long lists, long text, long diffs,
// and the Mission card cap): N changes in the same shape as a real host, each with a
// proposal, one spec delta, tasks and metadata, committed on `master` in a scratch repository.
// Change N depends on change N-1 and all share one created date, so the order is change-01 …
// change-NN.
//
// The scratch home gets an unprotected throwaway key trusted through the library (the
// trust-key command refuses unprotected keys) and an integrity baseline, exactly like the e2e
// tests. `approveAll` signs every change through the same library path the CLI uses
// (prepareApproval, then signAndLand with ssh-keygen and the trusted key, then a check of the
// signature against it); `driftAll` makes every approval change since signing in one commit.
//
// Everything lives in scratch directories (makeScratchDir: the repo's `.tmp/` or
// CP_TEST_SCRATCH). Nothing here touches ~/.ssh, ssh-agent, the Keychain, the global git config,
// the real Counterpoint home or a real host repository.
import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { notifyApproval } from '../../src/cli/approve.ts';
import { adapterFor } from '../../src/compose.ts';
import { signAndLand } from '../../src/core/approvals/commit.ts';
import { snapshotIntegrity, writeBaseline } from '../../src/core/approvals/integrity.ts';
import { prepareApproval } from '../../src/core/approvals/prepare.ts';
import { signPayload, verifySignature } from '../../src/core/approvals/ssh.ts';
import {
  OWNER_PRINCIPAL,
  readPublicKey,
  writeTrust,
} from '../../src/core/approvals/trust-store.ts';
import { createGitFileReader } from '../../src/core/git/reader.ts';
import { homePaths } from '../../src/core/host/home.ts';
import { hostIdFromName } from '../../src/core/ids.ts';
import { makeThrowawayKey } from './keys.ts';
import { commitAll, initScratchRepo, makeScratchDir, writeFileIn } from './scratch.ts';

export const LARGE_HOST_BRANCH = 'master';

export interface BuildLargeHostOptions {
  /** An empty directory for the repository; default a new scratch dir. */
  dir?: string;
  /** The Counterpoint home to trust the key and save the baseline in; default a new scratch dir. */
  home?: string;
  /** How many changes (1 to 99). */
  changes: number;
  /** change-01 gets a 300-character title. */
  longTitle?: boolean;
  /** change-01 gets a 300-character "Why". */
  longWhy?: boolean;
  /** change-01's spec delta sits under a deeply nested capability path. */
  deepPath?: boolean;
  /** change-01 gets long owner steps. */
  longOwnerSteps?: boolean;
}

export interface LargeHost {
  root: string;
  home: string;
  hostId: string;
  hostName: string;
  baseBranch: string;
  /** `change-01` … `change-NN`, in build order. */
  changeIds: string[];
  /** The proposal titles, by change id. */
  titles: Map<string, string>;
  /** Signs every change that is not on the runway yet, through the library. Returns the new tip. */
  approveAll(): Promise<string>;
  /**
   * One commit that edits every change's proposal; `bigDiffChange`'s proposal is rewritten to
   * 1,000 lines, one of them 400 characters long. Returns the new tip.
   */
  driftAll(options?: { bigDiffChange?: string }): Promise<string>;
}

const WORDS = [
  'runway',
  'signed',
  'approval',
  'kitchen',
  'ticket',
  'station',
  'service',
  'printer',
  'section',
  'counter',
  'expo',
  'pass',
];

/** Deterministic words up to exactly `length` characters (no trailing space). */
export function filler(length: number, seed = 0): string {
  let text = '';
  let index = seed;
  while (text.length < length) {
    text += `${WORDS[index % WORDS.length]} `;
    index += 1;
  }
  return text.slice(0, length).replace(/\s$/, 'x');
}

export const changeId = (n: number): string => `change-${String(n).padStart(2, '0')}`;

function changeTitle(n: number, options: BuildLargeHostOptions): string {
  if (n === 1 && options.longTitle === true) {
    return `Long Title ${filler(300 - 'Long Title '.length, 3)}`;
  }
  return `Part ${String(n).padStart(2, '0')} ${WORDS[n % WORDS.length]} ${WORDS[(n * 7) % WORDS.length]}`;
}

const DEEP_CAPABILITY = Array.from(
  { length: 24 },
  (_, i) => `level-${String(i + 1).padStart(2, '0')}-${WORDS[i % WORDS.length]}`,
).join('/');

function proposalText(title: string, why: string, extra = ''): string {
  return `# ${title}

## Why

${why}

## What Changes

- Deliver this part of the large host.${extra}
`;
}

function bigProposalText(id: string, title: string): string {
  const lines = [
    `# ${title}`,
    '',
    '## Why',
    '',
    `Part ${id} changed a lot.`,
    '',
    '## What Changes',
    '',
  ];
  for (let i = 1; lines.length < 999; i += 1) {
    lines.push(i === 500 ? `- ${filler(398, 5)}` : `- Changed decision ${i} for part ${id}.`);
  }
  return `${lines.join('\n')}\n`;
}

function tasksText(id: string, n: number, options: BuildLargeHostOptions): string {
  const owner =
    n === 1 && options.longOwnerSteps === true
      ? `- [ ] 1.2 Owner: ${filler(260, 2)}\n- [ ] 1.3 Owner: ${filler(240, 6)}\n`
      : '';
  return `# Tasks

## 1. Build

- [ ] 1.1 Build ${id} end to end with its tests
${owner}`;
}

function specText(id: string): string {
  return `## ADDED Requirements

### Requirement: ${id}
The large host SHALL deliver ${id}.

#### Scenario: Delivered
- **WHEN** ${id} is built
- **THEN** it works
`;
}

const CONFIG = `schema: spec-driven

context: |
  A generated host with many changes, in the same shape as a real one.
`;

export async function buildLargeHost(options: BuildLargeHostOptions): Promise<LargeHost> {
  if (!Number.isInteger(options.changes) || options.changes < 1 || options.changes > 99) {
    throw new Error('changes must be an integer from 1 to 99.');
  }
  const root = options.dir ?? makeScratchDir('lh');
  mkdirSync(root, { recursive: true });
  const home = options.home ?? makeScratchDir('home');
  const hostName = basename(root);
  const hostId = hostIdFromName(hostName);
  const baseBranch = LARGE_HOST_BRANCH;

  const changeIds = Array.from({ length: options.changes }, (_, i) => changeId(i + 1));
  const titles = new Map(changeIds.map((id, i) => [id, changeTitle(i + 1, options)]));
  const whyOf = (id: string, n: number) =>
    n === 1 && options.longWhy === true ? filler(300, 7) : `Deliver part ${id} of the large host.`;
  const dirOf = (id: string) => `openspec/changes/${id}`;

  await initScratchRepo(root, { branch: baseBranch });
  writeFileIn(root, 'openspec/config.yaml', CONFIG);
  for (const [index, id] of changeIds.entries()) {
    const n = index + 1;
    const dir = dirOf(id);
    const depends = index === 0 ? '' : `x-depends-on: [${changeIds[index - 1]}]\n`;
    writeFileIn(
      root,
      `${dir}/.openspec.yaml`,
      `schema: spec-driven\ncreated: 2026-11-01\n${depends}`,
    );
    writeFileIn(root, `${dir}/proposal.md`, proposalText(titles.get(id) as string, whyOf(id, n)));
    writeFileIn(root, `${dir}/tasks.md`, tasksText(id, n, options));
    const capability = n === 1 && options.deepPath === true ? DEEP_CAPABILITY : `part-${id}`;
    writeFileIn(root, `${dir}/specs/${capability}/spec.md`, specText(id));
  }
  await commitAll(root, `large host with ${options.changes} changes`);
  // The throwaway key and the integrity baseline, in the scratch home only.
  const key = await makeThrowawayKey(makeScratchDir('keys'), { name: 'approval' });
  const trust = await writeTrust(home, {
    publicKeyPath: key.publicKeyPath,
    confirmed: readPublicKey(key.publicKeyPath),
  });
  writeBaseline(home, hostId, await snapshotIntegrity(join(root, '.git')));

  const adapter = adapterFor({ adapter: 'openspec' });
  if (adapter === null) throw new Error('The OpenSpec adapter is not composed.');
  const tmpDir = homePaths(home).tmpDir;
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });

  /** ssh-keygen with the trusted key, then the same check against it the CLI makes. */
  const sign = async (payload: Uint8Array): Promise<string> => {
    const signature = await signPayload({ payload, privateKeyPath: trust.privateKeyPath });
    const check = await verifySignature({
      allowedSignersPath: trust.allowedSignersPath,
      principal: OWNER_PRINCIPAL,
      namespace: 'git',
      signature,
      payload,
      tmpDir,
    });
    if (!check.ok || check.fingerprint !== trust.fingerprint) {
      throw new Error('The signature did not verify against the trusted throwaway key.');
    }
    return signature;
  };

  let tip = '';

  async function approveAll(): Promise<string> {
    const reader = createGitFileReader(root);
    for (const id of changeIds) {
      const prepared = await prepareApproval({
        hostId,
        baseBranch,
        changeId: id,
        reader,
        adapter: adapter as NonNullable<typeof adapter>,
      });
      if (!prepared.ok) throw new Error(`${id} could not be prepared: ${prepared.reason}.`);
      const landed = await signAndLand({
        root,
        baseBranch,
        itemPath: prepared.itemPath,
        fileBytes: prepared.bytes,
        message: `counterpoint: approve change ${id}\n\nStatement ${prepared.fingerprint}\nInputs ${prepared.statement.inputs.combined}\n`,
        ident: { name: 'Counterpoint Test', email: 'test@counterpoint.invalid' },
        sign,
        expectedTip: prepared.tip,
      });
      if (!landed.ok) throw new Error(`${id} did not land: ${landed.reason}.`);
      tip = landed.commit;
    }
    await notifyApproval(home, { hostId, family: 'approval' });
    return tip;
  }

  async function driftAll(drift: { bigDiffChange?: string } = {}): Promise<string> {
    for (const [index, id] of changeIds.entries()) {
      const title = titles.get(id) as string;
      writeFileIn(
        root,
        `${dirOf(id)}/proposal.md`,
        id === drift.bigDiffChange
          ? bigProposalText(id, title)
          : proposalText(
              title,
              whyOf(id, index + 1),
              `\n- Part ${id} changed after it was signed.`,
            ),
      );
    }
    tip = await commitAll(root, 'edit every change after signing');
    return tip;
  }

  return { root, home, hostId, hostName, baseBranch, changeIds, titles, approveAll, driftAll };
}

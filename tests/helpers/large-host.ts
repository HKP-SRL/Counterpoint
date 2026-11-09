// Large synthetic GSD hosts for the heavy-data cases (UI-SPEC E1, E3, E4, E6 and E7 backstops,
// and the Mission card cap): N phases in the same shape as a real host, each with a CONTEXT and
// one PLAN, committed on `master` in a scratch repository.
//
// The scratch home gets an unprotected throwaway key trusted through the library (the
// trust-key command refuses unprotected keys) and an integrity baseline, exactly like the e2e
// tests. `approveAll` signs every phase through the same library path the CLI uses
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
import { OWNER_PRINCIPAL, writeTrust } from '../../src/core/approvals/trust-store.ts';
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
  /** How many phases (1 to 99). */
  phases: number;
  /** Phase 01 gets a 300-character name (and a long directory slug). */
  longName?: boolean;
  /** Phase 01's plan gets a 300-character objective. */
  longObjective?: boolean;
  /** Phase 01's plan lists a deeply nested `files_modified` path. */
  deepPath?: boolean;
  /** Phase 01's plan gets long `user_setup` entries. */
  longUserSetup?: boolean;
}

export interface LargeHost {
  root: string;
  home: string;
  hostId: string;
  hostName: string;
  baseBranch: string;
  /** `01` … `NN`, in roadmap order. */
  phaseIds: string[];
  /** The names in the roadmap, by phase id. */
  names: Map<string, string>;
  /** Signs every phase that is not on the runway yet, through the library. Returns the new tip. */
  approveAll(): Promise<string>;
  /**
   * One commit that changes every phase's CONTEXT; `bigDiffPhase`'s CONTEXT is rewritten to
   * 1,000 lines, one of them 400 characters long. Returns the new tip.
   */
  driftAll(options?: { bigDiffPhase?: string }): Promise<string>;
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

export const phaseId = (n: number): string => String(n).padStart(2, '0');

function slugOf(name: string, max: number): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/, '') || 'phase'
  );
}

function phaseName(n: number, options: BuildLargeHostOptions): string {
  if (n === 1 && options.longName === true) {
    return `Long Name ${filler(300 - 'Long Name '.length, 3)}`;
  }
  return `Part ${phaseId(n)} ${WORDS[n % WORDS.length]} ${WORDS[(n * 7) % WORDS.length]}`;
}

const DEEP_PATH = `src/${Array.from({ length: 24 }, (_, i) => `level-${String(i + 1).padStart(2, '0')}-${WORDS[i % WORDS.length]}`).join('/')}/deeply-nested-module-with-a-long-name.ts`;

function contextText(id: string, name: string, extra = ''): string {
  return `# Phase ${id}: ${name} - Context

**Gathered:** 2026-11-09
**Status:** Ready for planning

<decisions>
## Implementation Decisions

- **D-01:** Part ${id} does one thing.${extra}
</decisions>
`;
}

function bigContextText(id: string, name: string): string {
  const lines = [`# Phase ${id}: ${name} - Context`, '', '<decisions>'];
  for (let i = 1; lines.length < 999; i += 1) {
    lines.push(
      i === 500
        ? `- ${filler(398, 5)}`
        : `- **D-${String(i).padStart(3, '0')}:** Changed decision ${i} for part ${id}.`,
    );
  }
  lines.push('</decisions>');
  return `${lines.join('\n')}\n`;
}

function planText(id: string, n: number, options: BuildLargeHostOptions): string {
  const first = n === 1;
  const files = [`src/part-${id}/index.ts`];
  if (first && options.deepPath === true) files.push(DEEP_PATH);
  const setup =
    first && options.longUserSetup === true
      ? `user_setup:
  - service: ${filler(120, 1)}
    why: "${filler(260, 2)}"
    env_vars:
      - name: LARGE_HOST_TOKEN
        source: "${filler(80, 4)}"
  - service: second-service-with-a-long-name
    why: "${filler(240, 6)}"
`
      : '';
  const objective =
    first && options.longObjective === true
      ? filler(300, 7)
      : `Build part ${id} end to end with its tests.`;
  return `---
phase: ${id}-part
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
${files.map((file) => `  - ${file}`).join('\n')}
autonomous: true
requirements: [LH-${id}]
${setup}---

<objective>
${objective}
</objective>

<tasks>
<task type="auto">
  <name>Task 1: Build part ${id}</name>
</task>
</tasks>
`;
}

function roadmapText(ids: string[], names: Map<string, string>): string {
  const list = ids.map((id) => `- [ ] **Phase ${Number(id)}: ${names.get(id)}** - Part ${id}`);
  const details = ids.map(
    (id, index) => `### Phase ${id}: ${names.get(id)}

**Goal**: Deliver part ${id} of the large host.
**Depends on**: ${index === 0 ? 'Nothing (first phase)' : `Phase ${ids[index - 1]}`}
**Requirements**: LH-${id}
**Plans**: 0/1 plans executed

- [ ] ${id}-01-PLAN.md — Build part ${id}
`,
  );
  return `# Roadmap: Large

## Overview

A generated roadmap with many phases, in the same shape as a real host.

## Phases

${list.join('\n')}

## Phase Details

${details.join('\n')}`;
}

export async function buildLargeHost(options: BuildLargeHostOptions): Promise<LargeHost> {
  if (!Number.isInteger(options.phases) || options.phases < 1 || options.phases > 99) {
    throw new Error('phases must be an integer from 1 to 99.');
  }
  const root = options.dir ?? makeScratchDir('lh');
  mkdirSync(root, { recursive: true });
  const home = options.home ?? makeScratchDir('home');
  const hostName = basename(root);
  const hostId = hostIdFromName(hostName);
  const baseBranch = LARGE_HOST_BRANCH;

  const phaseIds = Array.from({ length: options.phases }, (_, i) => phaseId(i + 1));
  const names = new Map(phaseIds.map((id, i) => [id, phaseName(i + 1, options)]));
  const dirs = new Map(
    phaseIds.map((id) => [
      id,
      `.planning/phases/${id}-${slugOf(names.get(id) as string, id === '01' ? 140 : 40)}`,
    ]),
  );

  await initScratchRepo(root, { branch: baseBranch });
  writeFileIn(root, '.planning/ROADMAP.md', roadmapText(phaseIds, names));
  for (const [index, id] of phaseIds.entries()) {
    const dir = dirs.get(id) as string;
    writeFileIn(root, `${dir}/${id}-CONTEXT.md`, contextText(id, names.get(id) as string));
    writeFileIn(root, `${dir}/${id}-01-PLAN.md`, planText(id, index + 1, options));
  }
  await commitAll(root, `large host with ${options.phases} phases`);

  // The throwaway key and the integrity baseline, in the scratch home only.
  const key = await makeThrowawayKey(makeScratchDir('keys'), { name: 'approval' });
  const trust = await writeTrust(home, { publicKeyPath: key.publicKeyPath });
  writeBaseline(home, hostId, await snapshotIntegrity(join(root, '.git')));

  const adapter = adapterFor({ adapter: 'gsd' });
  if (adapter === null) throw new Error('The GSD adapter is not composed.');
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
    for (const id of phaseIds) {
      const prepared = await prepareApproval({
        hostId,
        baseBranch,
        phaseId: id,
        reader,
        adapter: adapter as NonNullable<typeof adapter>,
      });
      if (!prepared.ok) throw new Error(`Phase ${id} could not be prepared: ${prepared.reason}.`);
      const landed = await signAndLand({
        root,
        baseBranch,
        itemPath: prepared.itemPath,
        fileBytes: prepared.bytes,
        message: `counterpoint: approve phase ${id}\n\nStatement ${prepared.fingerprint}\nInputs ${prepared.statement.inputs.combined}\n`,
        ident: { name: 'Counterpoint Test', email: 'test@counterpoint.invalid' },
        sign,
        expectedTip: prepared.tip,
      });
      if (!landed.ok) throw new Error(`Phase ${id} did not land: ${landed.reason}.`);
      tip = landed.commit;
    }
    await notifyApproval(home, { hostId, family: 'approval' });
    return tip;
  }

  async function driftAll(drift: { bigDiffPhase?: string } = {}): Promise<string> {
    for (const id of phaseIds) {
      const dir = dirs.get(id) as string;
      const name = names.get(id) as string;
      writeFileIn(
        root,
        `${dir}/${id}-CONTEXT.md`,
        id === drift.bigDiffPhase
          ? bigContextText(id, name)
          : contextText(id, name, `\n- **D-02:** Part ${id} changed after it was signed.`),
      );
    }
    tip = await commitAll(root, 'change every phase after signing');
    return tip;
  }

  return { root, home, hostId, hostName, baseBranch, phaseIds, names, approveAll, driftAll };
}

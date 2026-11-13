// Large synthetic OpenSpec hosts for the heavy-data cases (long lists, long text, long diffs,
// and the Mission card cap): N changes in the same shape as a real host, each with a
// proposal, one spec delta, tasks and metadata, committed on `master` in a scratch repository.
// Change N depends on change N-1 and all share one created date, so the order is change-01 …
// change-NN.
//
// Approving them is the console's one click (`Approve all`); the helper only builds the host.
//
// Everything lives in scratch directories (makeScratchDir: the repo's `.tmp/` or
// CP_TEST_SCRATCH). Nothing here touches the global git config, the real Counterpoint home or a
// real host repository.
import { mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import { hostIdFromName } from '../../src/core/ids.ts';
import { commitAll, initScratchRepo, makeScratchDir, writeFileIn } from './scratch.ts';

export const LARGE_HOST_BRANCH = 'master';

export interface BuildLargeHostOptions {
  /** An empty directory for the repository; default a new scratch dir. */
  dir?: string;
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
  hostId: string;
  hostName: string;
  baseBranch: string;
  /** `change-01` … `change-NN`, in build order. */
  changeIds: string[];
  /** The proposal titles, by change id. */
  titles: Map<string, string>;
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
  return { root, hostId, hostName, baseBranch, changeIds, titles };
}

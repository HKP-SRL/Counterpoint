// Planning fixtures for tests, materialized into scratch git repositories so tests read them the
// way the adapter does in production: from a commit, never the working tree.
//
// - `cena`: a byte-exact snapshot of Cena's committed `openspec/` (tests/fixtures/openspec/cena,
//   see its PROVENANCE.md), copied in as is.
// - `synthetic`: a small OpenSpec host built here (SYNTHETIC_FILES) that covers every status: a
//   built change, a ready change with an owner step and a dependency, a change with no tasks, a
//   change with no proposal, a change with malformed metadata, an archived change and a directory
//   whose name is not a change id. Further edge cases (dependency chains and cycles, symlinks,
//   oversized files) are built per test with `materializeOpenSpecHost` and the commit helpers.
import { cpSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitAll, initScratchRepo, makeScratchDir, writeFileIn } from './scratch.ts';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'openspec');

export interface FixtureRepo {
  root: string;
  commit: string;
}

/** The ids of the synthetic host's changes, by role. */
export const SYNTHETIC = {
  built: 'built-thing',
  ready: 'ready-thing',
  noTasks: 'no-tasks',
  noProposal: 'no-proposal',
  broken: 'broken-yaml',
  archived: 'old-thing',
} as const;

export const SYNTHETIC_CONFIG = `schema: spec-driven

context: |
  A hand-authored host in the same shape as a real one, covering every case the adapter handles.

rules:
  tasks:
    - A step the owner must do by hand starts with "Owner:".
`;

const READY_PROPOSAL = `# Ready thing

## Why

A change that has its proposal and its tasks, ready to approve.

## What Changes

- Add the ready thing.

## Impact

- The menu.
`;

const READY_TASKS = `# Tasks

## 1. Setup

- [ ] 1.1 Set up the ready thing
- [x] 1.2 Write the first test
- [ ] 1.3 Owner: create the Supabase project

## 2. Finish

- [ ] 2.1 Finish the ready thing
`;

/** The synthetic OpenSpec host, by repository path. */
export const SYNTHETIC_FILES: Readonly<Record<string, string>> = {
  'openspec/config.yaml': SYNTHETIC_CONFIG,
  'openspec/specs/menu/spec.md': '# menu Specification\n\n## Purpose\nThe menu.\n',

  'openspec/changes/built-thing/.openspec.yaml': 'schema: spec-driven\ncreated: 2026-10-01\n',
  'openspec/changes/built-thing/proposal.md':
    '# Built thing\n\n## Why\n\nEvery task is already done.\n',
  'openspec/changes/built-thing/tasks.md':
    '# Tasks\n\n- [x] 1.1 Build the one thing\n- [X] 1.2 Test it\n',

  'openspec/changes/ready-thing/.openspec.yaml':
    'schema: spec-driven\ncreated: 2026-10-03\nx-depends-on: [built-thing]\n',
  'openspec/changes/ready-thing/proposal.md': READY_PROPOSAL,
  'openspec/changes/ready-thing/design.md':
    '## Context\n\nA design for the ready thing.\n\n## Decisions\n\n1. Keep it small.\n',
  'openspec/changes/ready-thing/tasks.md': READY_TASKS,
  'openspec/changes/ready-thing/specs/menu/spec.md':
    '## ADDED Requirements\n\n### Requirement: Ready thing\nThe menu SHALL show the ready thing.\n\n#### Scenario: Shown\n- **WHEN** the diner opens the menu\n- **THEN** the ready thing is shown\n',

  'openspec/changes/no-tasks/.openspec.yaml': 'schema: spec-driven\ncreated: 2026-10-04\n',
  'openspec/changes/no-tasks/proposal.md': '# No tasks yet\n\n## Why\n\nProposed, not planned.\n',

  'openspec/changes/no-proposal/.openspec.yaml': 'schema: spec-driven\ncreated: 2026-10-05\n',
  'openspec/changes/no-proposal/tasks.md': '# Tasks\n\n- [ ] 1.1 Something\n',

  'openspec/changes/broken-yaml/.openspec.yaml': 'schema: spec-driven\ncreated: [unclosed\n',
  'openspec/changes/broken-yaml/proposal.md':
    '# Broken yaml\n\n## Why\n\nIts metadata does not parse.\n',
  'openspec/changes/broken-yaml/tasks.md': '# Tasks\n\n- [ ] 1.1 Never read\n',

  'openspec/changes/archive/2026-09-01-old-thing/.openspec.yaml':
    'schema: spec-driven\ncreated: 2026-08-20\n',
  'openspec/changes/archive/2026-09-01-old-thing/proposal.md':
    '# Old thing\n\n## Why\n\nFinished and archived.\n',
  'openspec/changes/archive/2026-09-01-old-thing/tasks.md': '# Tasks\n\n- [x] 1.1 Done\n',

  'openspec/changes/Not_A_Change/proposal.md': '# Ignored\n',
};

/** Writes `files` into a fresh scratch repo and commits them on `branch` (default `master`). */
export async function materializeOpenSpecHost(
  files: Readonly<Record<string, string | Uint8Array>>,
  options: { branch?: string; label?: string } = {},
): Promise<FixtureRepo> {
  const label = options.label ?? 'host';
  const root = makeScratchDir(`fx-${label.slice(0, 12)}`);
  await initScratchRepo(root, { branch: options.branch ?? 'master' });
  for (const [path, content] of Object.entries(files)) writeFileIn(root, path, content);
  const commit = await commitAll(root, `fixture ${label}`);
  return { root, commit };
}

/**
 * Materializes a named fixture: `synthetic` (built from SYNTHETIC_FILES) or a snapshot directory
 * under tests/fixtures/openspec/{name}, copied in as is.
 */
export async function materializeFixtureRepo(
  name: string,
  options: { branch?: string } = {},
): Promise<FixtureRepo> {
  if (name === 'synthetic') {
    return materializeOpenSpecHost(SYNTHETIC_FILES, { ...options, label: name });
  }
  const root = makeScratchDir(`fx-${name.slice(0, 12)}`);
  await initScratchRepo(root, { branch: options.branch ?? 'master' });
  cpSync(join(FIXTURES, name), root, { recursive: true });
  const commit = await commitAll(root, `fixture ${name}`);
  return { root, commit };
}

/** The bytes of a snapshot fixture file, as committed. */
export function fixturePath(name: string, relPath: string): string {
  return join(FIXTURES, name, relPath);
}

/** Writes (or, with null, deletes) one file and commits. Returns the new commit sha. */
export async function commitChange(
  root: string,
  relPath: string,
  content: string | Uint8Array | null,
): Promise<string> {
  if (content === null) {
    rmSync(join(root, relPath), { force: true });
  } else {
    writeFileIn(root, relPath, content);
  }
  return commitAll(root, `change ${relPath}`);
}

/** Commits a symbolic link at `relPath` pointing at `target`. Returns the new commit sha. */
export async function commitSymlink(
  root: string,
  relPath: string,
  target: string,
): Promise<string> {
  const link = join(root, relPath);
  mkdirSync(dirname(link), { recursive: true });
  rmSync(link, { force: true });
  symlinkSync(target, link);
  return commitAll(root, `symlink ${relPath}`);
}

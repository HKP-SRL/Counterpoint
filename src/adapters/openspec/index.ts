// The OpenSpec framework adapter: recognises an OpenSpec host and turns its committed `openspec/`
// content into a ChangeSnapshot. Reads go only through the core GitFileReader at a commit, never
// the working tree (host-planning: Committed content only), so the `openspec` CLI (which reads the
// working tree) is not used.
//
// Every directory under `openspec/changes/` with a change-id name is one active change; every
// `archive/<date>-<id>/` directory is one archived change. A change's files are read
// independently: a symlink, an oversized or non-UTF-8 file or malformed metadata marks only that
// change unreadable. Archived changes are done, so only their listing and proposal are read.
//
// A commit id names immutable content, so a snapshot that read cleanly is memoized per adapter by
// commit (a small LRU, cloned on the way out). A snapshot with anything unreadable is never kept:
// the host runtime re-reads such a tip once after a debounce and must see a fresh read.
import {
  AmbiguousChangeError,
  type ChangeFacts,
  type ChangeSnapshot,
  type FrameworkAdapter,
  type GitFileReader,
  type UnreadableFile,
} from '../../core/framework/port.ts';
import { approvalInputs } from './inputs.ts';
import {
  type ChangeDir,
  CONFIG_NAME,
  DESIGN_NAME,
  listActiveChanges,
  listArchivedChanges,
  METADATA_NAME,
  OPENSPEC_DIR,
  PROPOSAL_NAME,
  SPECS_NAME,
  SYMLINK_MODE,
  TASKS_NAME,
  walkTree,
} from './layout.ts';
import { parseMetadata, reasonFrom } from './metadata.ts';
import { orderChanges } from './order.ts';
import { parseProposal } from './proposal.ts';
import { countTasks, normalizeTasks, openBuildTasks, tickedTasks } from './tasks.ts';

const ADAPTER_ID = 'openspec';

async function detect(reader: GitFileReader, commit: string): Promise<boolean> {
  const entries = await reader.list(commit, OPENSPEC_DIR);
  return entries.some(
    (entry) => entry.name === CONFIG_NAME && entry.type === 'blob' && entry.mode !== SYMLINK_MODE,
  );
}

type TextResult = { text: string | null } | { unreadable: UnreadableFile };

async function readText(reader: GitFileReader, commit: string, path: string): Promise<TextResult> {
  try {
    const bytes = await reader.read(commit, path);
    if (bytes === null) return { text: null };
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch (error) {
    const reason =
      error instanceof TypeError ? 'Not valid UTF-8 text.' : reasonFrom(error as Error);
    return { unreadable: { file: path, reason } };
  }
}

/** The capability paths under `specs/`: each directory holding a `spec.md`, relative to specs/. */
function capabilityPaths(specsDir: string, paths: readonly string[]): string[] {
  const found = new Set<string>();
  for (const path of paths) {
    if (!path.startsWith(`${specsDir}/`) || !path.endsWith('/spec.md')) continue;
    found.add(path.slice(specsDir.length + 1, -'/spec.md'.length));
  }
  return [...found].sort();
}

async function readChange(
  reader: GitFileReader,
  commit: string,
  dir: ChangeDir,
): Promise<ChangeFacts> {
  const facts: ChangeFacts = {
    id: dir.id,
    dir: dir.path,
    archived: dir.archived,
    archivedOn: dir.archivedOn,
    title: dir.id,
    why: null,
    created: null,
    dependsOn: [],
    artifacts: { proposal: false, design: false, tasks: false, specs: [] },
    tasks: { total: 0, done: 0, ownerSteps: [] },
    unreadable: null,
  };
  const at = (name: string) => `${dir.path}/${name}`;

  // Active changes are walked in full (every file is an approval input, and a symlink anywhere
  // makes the change unapprovable); archived ones are only listed.
  const listed = await reader.list(commit, dir.path);
  const entries = dir.archived ? [] : await walkTree(reader, commit, dir.path, listed);
  const top = new Set(listed.map((entry) => entry.name));
  facts.artifacts.proposal = top.has(PROPOSAL_NAME);
  facts.artifacts.design = top.has(DESIGN_NAME);
  facts.artifacts.tasks = top.has(TASKS_NAME);
  if (!dir.archived) {
    facts.artifacts.specs = capabilityPaths(
      at(SPECS_NAME),
      entries.map((entry) => entry.path),
    );
    const link = entries.find((entry) => entry.mode === SYMLINK_MODE);
    if (link) facts.unreadable = { file: link.path, reason: 'Symbolic links are not read.' };
  }

  if (facts.artifacts.proposal) {
    const proposal = await readText(reader, commit, at(PROPOSAL_NAME));
    if ('unreadable' in proposal) facts.unreadable ??= proposal.unreadable;
    else if (proposal.text !== null) {
      const parsed = parseProposal(proposal.text);
      facts.title = parsed.title ?? dir.id;
      facts.why = parsed.why;
    }
  }
  if (dir.archived) return facts;

  if (top.has(METADATA_NAME)) {
    const metadata = await readText(reader, commit, at(METADATA_NAME));
    if ('unreadable' in metadata) facts.unreadable ??= metadata.unreadable;
    else if (metadata.text !== null) {
      const parsed = parseMetadata(metadata.text);
      if (parsed.ok) {
        facts.created = parsed.metadata.created;
        facts.dependsOn = parsed.metadata.dependsOn;
      } else {
        facts.unreadable ??= { file: at(METADATA_NAME), reason: parsed.reason };
      }
    }
  }

  if (facts.artifacts.tasks) {
    const tasks = await readText(reader, commit, at(TASKS_NAME));
    if ('unreadable' in tasks) facts.unreadable ??= tasks.unreadable;
    else if (tasks.text !== null) facts.tasks = countTasks(tasks.text);
  }
  return facts;
}

async function readSnapshot(reader: GitFileReader, commit: string): Promise<ChangeSnapshot> {
  let dirs: ChangeDir[];
  try {
    dirs = [
      ...(await listActiveChanges(reader, commit)),
      ...(await listArchivedChanges(reader, commit)),
    ];
  } catch (error) {
    return {
      framework: ADAPTER_ID,
      commit,
      changes: [],
      unreadable: { file: `${OPENSPEC_DIR}/changes`, reason: reasonFrom(error) },
    };
  }

  // A name carried by more than one folder is ambiguous: every folder of that name is unreadable.
  const byId = new Map<string, string[]>();
  for (const dir of dirs) byId.set(dir.id, [...(byId.get(dir.id) ?? []), dir.path]);

  const changes: ChangeFacts[] = [];
  for (const dir of dirs) {
    const same = byId.get(dir.id) ?? [];
    try {
      const facts = await readChange(reader, commit, dir);
      if (same.length > 1) {
        facts.unreadable = {
          file: dir.path,
          reason: new AmbiguousChangeError(dir.id, same).message,
        };
      }
      changes.push(facts);
    } catch (error) {
      // A listing failure inside one change affects only that change.
      changes.push({
        id: dir.id,
        dir: dir.path,
        archived: dir.archived,
        archivedOn: dir.archivedOn,
        title: dir.id,
        why: null,
        created: null,
        dependsOn: [],
        artifacts: { proposal: false, design: false, tasks: false, specs: [] },
        tasks: { total: 0, done: 0, ownerSteps: [] },
        unreadable: { file: dir.path, reason: reasonFrom(error) },
      });
    }
  }
  return { framework: ADAPTER_ID, commit, changes: orderChanges(changes), unreadable: null };
}

const SNAPSHOT_CACHE_MAX = 64;
const COMMIT_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export function createOpenSpecAdapter(): FrameworkAdapter {
  const cache = new Map<string, ChangeSnapshot>();

  async function snapshot(reader: GitFileReader, commit: string): Promise<ChangeSnapshot> {
    const hit = cache.get(commit);
    if (hit !== undefined) {
      // Refresh its place in the LRU order.
      cache.delete(commit);
      cache.set(commit, hit);
      return structuredClone(hit);
    }
    const fresh = await readSnapshot(reader, commit);
    const clean = fresh.unreadable === null && fresh.changes.every((c) => c.unreadable === null);
    if (clean && COMMIT_RE.test(commit)) {
      cache.set(commit, structuredClone(fresh));
      while (cache.size > SNAPSHOT_CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
    }
    return fresh;
  }

  return {
    id: ADAPTER_ID,
    detect,
    snapshot,
    approvalInputs,
    isPlanningPath: (path) => path === 'openspec' || path.startsWith('openspec/'),
    tasksPath: (change) => (change.artifacts.tasks ? `${change.dir}/tasks.md` : null),
    tickedTasks,
    openTasks: openBuildTasks,
    sameApartFromTicks: (before, after) => normalizeTasks(before) === normalizeTasks(after),
    buildInstructions,
  };
}

/**
 * The builder's instructions for an OpenSpec change. The host's own OpenSpec skills and commands
 * load in builder sessions (`--setting-sources user,project`), so the builder uses them.
 */
function buildInstructions(change: ChangeFacts): string {
  const tasks = change.artifacts.tasks ? `${change.dir}/tasks.md` : null;
  return [
    `This repository plans with OpenSpec. Implement the change "${change.id}" (folder ${change.dir}/).`,
    'Read its proposal.md, design.md (if present) and the spec deltas under specs/, then implement it',
    "with the repository's OpenSpec apply workflow (the openspec-apply-change skill, or the",
    `/opsx:apply command) for this change.`,
    tasks === null
      ? 'The change has no task list; implement what the proposal and specs describe.'
      : `Work through ${tasks} in order and tick each task's checkbox there as soon as it is done.`,
    'Tasks whose text starts with "Owner:" are for the owner: skip them.',
    'Do not edit any other file under openspec/: planning changes go through the owner.',
  ].join('\n');
}

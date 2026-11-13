// The host's Counterpoint config, `.counterpoint/config.yaml` (gates: Gate commands from the
// approved base).
//
// It is always read from a commit through the hardened git reader, never from a working tree: a
// build reads it at the commit the build started from (the base-branch tip then). A builder that
// edits the file in its worktree changes nothing about how its own change is judged.
//
// Counterpoint ships no knowledge of any test tool: gates and services are commands (argument
// arrays, never shell strings) the host names. The shape is strict: an unknown or misspelt key is
// an error, so a typo can never silently drop a gate. Two keys of earlier versions, the gate
// `ports` and the top-level `protected`, are still accepted and ignored, so a committed config
// keeps loading.
//
//   gates:                      # run in order; exit code 0 is the only pass
//     - name: types
//       command: [pnpm, tsc, --noEmit]
//     - name: related
//       command: [pnpm, vitest, related, --run, '{changed}']   # the changed files, one each
//       paths: ['**/*.ts', '**/*.tsx']   # narrow {changed}; none left: the gate is skipped
//     - name: unit
//       command: [pnpm, vitest, run]
//       when: final             # every (default): every attempt; final: once, after the rest pass
//       timeout: 20m            # Ns, Nm, Nh or integer seconds; default 10m
//       testLock: true          # take the machine-wide test lock
//       services: [supabase]    # services to start (and reset) before this gate
//       testCount: 'Tests\s+(\d+) passed'   # zero-test guard: first group is the count
//   services:                   # run from the worktree with the owner's environment
//     supabase:
//       start: [supabase, start]
//       reset: [supabase, db, reset]
//       env:                    # KEY=value lines from `command`, renamed by `map`
//         command: [supabase, status, -o, env]
//         map: { NEXT_PUBLIC_SUPABASE_URL: API_URL }
//         file: .env.local      # also written into the worktree while gates run
//   attempts: 3                 # failed gate rounds before the change parks
//   tests:
//     budget: 30                # % of a change's added lines that should be tests (advice only)
//   preview:
//     command: [pnpm, dev, --port, '{port}']
//     ports: [54321]
//   worktree:
//     clone: [node_modules]     # git-ignored folders copied (APFS clone) from your checkout
//   drafts:                     # hi-fi design drafts (design-drafts D-3); without it, low-fi only
//     render: [node, scripts/render-draft.ts, '{entry}', '{out}']
//     entry: draft.tsx          # the file name a hi-fi session writes, one per state
//     guide: docs/drafts.md     # how to write a draft entry in this project
import { isAbsolute, normalize } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import type { GitFileReader } from '../framework/port.ts';

export const COUNTERPOINT_CONFIG_PATH = '.counterpoint/config.yaml';

/** The host config could not be read or does not match the schema. The message is one line. */
export class HostConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostConfigError';
  }
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The config document at `commit` as a mapping, or null when the file is missing or empty.
 * Parsed with `yaml`'s core schema (no custom tags, no timestamps), duplicate keys refused.
 */
export async function readConfigDocument(
  reader: GitFileReader,
  commit: string,
): Promise<Record<string, unknown> | null> {
  const bytes = await reader.read(commit, COUNTERPOINT_CONFIG_PATH);
  if (bytes === null) return null;

  let document: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    document = parse(text, { schema: 'core', uniqueKeys: true, maxAliasCount: 100 });
  } catch (error) {
    const first = ((error as Error).message ?? '').split('\n')[0] ?? '';
    throw new HostConfigError(`${COUNTERPOINT_CONFIG_PATH} could not be parsed: ${first}`);
  }
  if (document === null || document === undefined) return null;
  if (!isMapping(document)) {
    throw new HostConfigError(`${COUNTERPOINT_CONFIG_PATH} must be a mapping at the top level.`);
  }
  return document;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const MAX_DURATION_MS = 6 * 60 * 60 * 1000;

/** `90s`, `20m`, `1h` or integer seconds, as milliseconds (1 s to 6 h). */
const Duration = z
  .union([z.number().int(), z.string().regex(/^\d{1,5}[smh]$/, 'Use Ns, Nm or Nh.')])
  .transform((value, ctx) => {
    let ms: number;
    if (typeof value === 'number') {
      ms = value * 1000;
    } else {
      const amount = Number(value.slice(0, -1));
      const unit = value.at(-1);
      ms = amount * (unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : 1000);
    }
    if (ms < 1000 || ms > MAX_DURATION_MS) {
      ctx.addIssue({ code: 'custom', message: 'Must be between 1 second and 6 hours.' });
      return z.NEVER;
    }
    return ms;
  });

/** A command as an argument array; the first element is the program. No shell. */
const Argv = z
  .array(
    z
      .string()
      .min(1)
      .max(4096)
      .refine((arg) => !arg.includes('\0'), 'No NUL bytes.'),
  )
  .min(1)
  .max(64)
  .refine((argv) => !(argv[0] ?? '').startsWith('-'), 'The program must not start with a dash.');

const Port = z.number().int().min(1).max(65_535);

/** A repository-relative path or glob: no leading slash, no `..` segment, no backslash. */
const RepoPath = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (path) =>
      !isAbsolute(path) &&
      !path.includes('\\') &&
      !path.includes('\0') &&
      !path.split('/').includes('..') &&
      normalize(path) !== '.',
    'Must be a path inside the repository.',
  );

const TestCount = z
  .string()
  .min(1)
  .max(512)
  .superRefine((source, ctx) => {
    let re: RegExp;
    try {
      re = new RegExp(source);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Not a valid regular expression.' });
      return;
    }
    // A pattern needs at least one capture group: the number of tests run.
    const groups = new RegExp(`${re.source}|`).exec('')?.length ?? 1;
    if (groups < 2) ctx.addIssue({ code: 'custom', message: 'Needs a capture group.' });
  });

/** The placeholder a gate command may hold: the change's added and modified files, one each. */
export const CHANGED_PLACEHOLDER = '{changed}';

const Gate = z
  .strictObject({
    name: z.string().regex(NAME_RE, 'Lowercase letters, digits and dashes.'),
    command: Argv,
    /** `every` attempt (the default), or once as a `final` gate after the others pass. */
    when: z.enum(['every', 'final']).default('every'),
    /** Narrows `{changed}` to the files matching any of these patterns. */
    paths: z.array(RepoPath).min(1).max(32).optional(),
    timeout: Duration.prefault(600),
    testLock: z.boolean().default(false),
    services: z.array(z.string().regex(NAME_RE)).max(8).default([]),
    testCount: TestCount.optional(),
    /** Accepted and ignored (gates had a network allow-list while they ran sandboxed). */
    ports: z.unknown().optional(),
  })
  .refine(
    (gate) =>
      gate.command.every(
        (arg) => arg === CHANGED_PLACEHOLDER || !arg.includes(CHANGED_PLACEHOLDER),
      ),
    { path: ['command'], message: `${CHANGED_PLACEHOLDER} must be an argument of its own.` },
  )
  .transform(({ ports: _ignored, ...gate }) => gate);

const ServiceEnv = z.strictObject({
  command: Argv,
  /** Target name → source name in the command's output. */
  map: z.record(z.string().regex(ENV_NAME_RE), z.string().regex(ENV_NAME_RE)),
  file: RepoPath.optional(),
});

const Service = z.strictObject({
  start: Argv,
  reset: Argv.optional(),
  env: ServiceEnv.optional(),
  timeout: Duration.prefault(300),
});

/** A folder copied into new worktrees: inside the repository, never git or agent state. */
const ClonePath = RepoPath.refine(
  (path) =>
    !['.git', '.claude', '.counterpoint'].includes(path.split('/')[0] ?? '') &&
    !/[*?[\]{}]/.test(path),
  'Not a folder that may be cloned (no globs, no .git, .claude or .counterpoint).',
);

const Worktree = z.strictObject({
  clone: z.array(ClonePath).max(16).default([]),
});

const Preview = z.strictObject({
  command: Argv.refine(
    (argv) => argv.some((arg) => arg.includes('{port}')),
    'The preview command must contain {port}.',
  ),
  ports: z.array(Port).max(16).default([]),
});

/** The placeholders a drafts render command holds: the entry file and the output folder. */
export const ENTRY_PLACEHOLDER = '{entry}';
export const OUT_PLACEHOLDER = '{out}';

/** Hi-fi drafts (design-drafts D-3): the host renders an entry; Counterpoint packs the page. */
const Drafts = z.strictObject({
  render: Argv.refine(
    (argv) => argv.includes(ENTRY_PLACEHOLDER) && argv.includes(OUT_PLACEHOLDER),
    `The render command needs ${ENTRY_PLACEHOLDER} and ${OUT_PLACEHOLDER}, each as an argument of its own.`,
  ),
  /** A file name (no folder): what the hi-fi session writes for each state. */
  entry: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, 'A file name, without a folder.'),
  guide: RepoPath.optional(),
  timeout: Duration.prefault(120),
});

/** The test budget (gates: Test budget): advice for builders, never a gate. */
const Tests = z.strictObject({
  budget: z.number().int().min(0).max(100).default(30),
});

const HostConfigSchema = z
  .strictObject({
    gates: z.array(Gate).max(32).nullish(),
    services: z.record(z.string().regex(NAME_RE), Service).nullish(),
    attempts: z.number().int().min(1).max(10).default(3),
    tests: Tests.nullish(),
    preview: Preview.nullish(),
    /** Accepted and ignored (paths that used to be flagged on a branch's diff). */
    protected: z.unknown().optional(),
    worktree: Worktree.nullish(),
    drafts: Drafts.nullish(),
  })
  .superRefine((config, ctx) => {
    const names = new Set<string>();
    for (const [index, gate] of (config.gates ?? []).entries()) {
      if (names.has(gate.name)) {
        ctx.addIssue({ code: 'custom', path: ['gates', index, 'name'], message: 'Duplicate.' });
      }
      names.add(gate.name);
      for (const service of gate.services) {
        if (config.services?.[service] === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['gates', index, 'services'],
            message: `Unknown service ${service}.`,
          });
        }
      }
    }
  });

export type GateConfig = z.output<typeof Gate>;
export type ServiceConfig = z.output<typeof Service>;
export type PreviewConfig = z.output<typeof Preview>;
export type DraftsConfig = z.output<typeof Drafts>;

/** The test budget when the host config sets none (gates: Test budget). */
export const DEFAULT_TEST_BUDGET = 30;

export interface HostConfig {
  gates: GateConfig[];
  services: Record<string, ServiceConfig>;
  attempts: number;
  tests: { budget: number };
  preview: PreviewConfig | null;
  worktree: { clone: string[] };
  /** Hi-fi drafts; null: the host renders none (low-fi only). */
  drafts: DraftsConfig | null;
}

/** The defaults for a host with no config file: no gates, three attempts. */
export const EMPTY_HOST_CONFIG: Readonly<HostConfig> = Object.freeze({
  gates: [],
  services: {},
  attempts: 3,
  tests: { budget: DEFAULT_TEST_BUDGET },
  preview: null,
  worktree: { clone: [] },
  drafts: null,
});

/** Parses a config document (already read as YAML). Throws HostConfigError naming the key. */
export function parseHostConfig(document: Record<string, unknown> | null): HostConfig {
  if (document === null) {
    return {
      ...EMPTY_HOST_CONFIG,
      gates: [],
      services: {},
      tests: { budget: DEFAULT_TEST_BUDGET },
      worktree: { clone: [] },
    };
  }
  const parsed = HostConfigSchema.safeParse(document);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue === undefined || issue.path.length === 0 ? '' : `${issue.path.join('.')}: `;
    throw new HostConfigError(
      `${COUNTERPOINT_CONFIG_PATH}: ${where}${issue?.message ?? 'invalid config'}`,
    );
  }
  const config = parsed.data;
  return {
    gates: config.gates ?? [],
    services: config.services ?? {},
    attempts: config.attempts,
    tests: { budget: config.tests?.budget ?? DEFAULT_TEST_BUDGET },
    preview: config.preview ?? null,
    worktree: { clone: config.worktree?.clone ?? [] },
    drafts: config.drafts ?? null,
  };
}

/** The host config at `commit` (the commit a build started from). */
export async function readHostConfig(reader: GitFileReader, commit: string): Promise<HostConfig> {
  return parseHostConfig(await readConfigDocument(reader, commit));
}

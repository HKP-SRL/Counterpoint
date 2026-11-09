// GSD phase-directory reader: CONTEXT presence, PLAN files and their frontmatter, SUMMARY presence.
//
// PLAN files are written by agents, so they are untrusted input. Frontmatter is found with
// remark-frontmatter and parsed with the `yaml` package (no JavaScript front-matter engine, no
// gray-matter), then validated with zod. Any read, YAML or validation failure marks the phase
// unreadable with the file and a one-line reason; it never throws and never affects other phases.
import remarkFrontmatter from 'remark-frontmatter';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import {
  comparePhaseNumbers,
  type GitFileReader,
  type PlanFacts,
  parsePhaseNumber,
  type UnreadableFile,
  type UserSetupItem,
} from '../../core/framework/port.ts';

export interface PhaseDirectoryFacts {
  hasContext: boolean;
  plans: PlanFacts[];
  unreadable: UnreadableFile | null;
}

const CONTEXT_RE = /^\d+(\.\d+)?-CONTEXT\.md$/;
const PLAN_RE = /^(\d+(?:\.\d+)?)-(\d+)-PLAN\.md$/;
const SYMLINK_MODE = '120000';
const OBJECTIVE_MAX = 300;
const REASON_MAX = 200;

const frontmatterParser = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']);

const envVarSchema = z.union([z.string(), z.looseObject({ name: z.string() })]);

const userSetupSchema = z.looseObject({
  service: z.string(),
  why: z.string().nullish(),
  env_vars: z.array(envVarSchema).nullish(),
});

const planFrontmatterSchema = z.looseObject({
  wave: z.number().int().nullish(),
  depends_on: z
    .array(z.union([z.string(), z.number()]))
    .nullish()
    .transform((list) => (list ?? []).map(String)),
  autonomous: z.boolean().default(true),
  files_modified: z.array(z.string()).nullish(),
  user_setup: z.array(userSetupSchema).nullish(),
});

/** A short, single-line reason that names no absolute path. */
function reasonFrom(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split('\n').find((line) => line.trim() !== '') ?? 'unknown error';
  return firstLine
    .replace(/(^|[\s"'(])\/[^\s"')]+/g, '$1<path>')
    .trim()
    .slice(0, REASON_MAX);
}

function zodReason(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid frontmatter.';
  const at = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
  return `Invalid frontmatter: ${at}${issue.message}`;
}

/** Collapses whitespace and caps the text at OBJECTIVE_MAX characters. */
function clip(text: string): string | null {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed === '') return null;
  return collapsed.length <= OBJECTIVE_MAX
    ? collapsed
    : `${collapsed.slice(0, OBJECTIVE_MAX - 1).trimEnd()}…`;
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/** The first paragraph inside the first `<objective>` block that is not inside a code fence. */
export function extractObjective(body: string): string | null {
  let fence: string | null = null;
  let collecting = false;
  const collected: string[] = [];

  for (const line of body.split(/\r?\n/)) {
    if (!collecting) {
      const marker = FENCE_RE.exec(line)?.[1];
      if (marker !== undefined) {
        if (fence === null) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
        continue;
      }
      if (fence !== null) continue;
      const open = line.indexOf('<objective>');
      if (open < 0 || line.slice(0, open).trim() !== '') continue;
      collecting = true;
      const rest = line.slice(open + '<objective>'.length);
      const close = rest.indexOf('</objective>');
      if (close >= 0) return clip(rest.slice(0, close));
      if (rest.trim() !== '') collected.push(rest);
      continue;
    }
    const close = line.indexOf('</objective>');
    const part = close >= 0 ? line.slice(0, close) : line;
    if (part.trim() === '') {
      if (collected.length > 0 || close >= 0) break;
      continue;
    }
    collected.push(part);
    if (close >= 0) break;
  }

  return collecting ? clip(collected.join(' ')) : null;
}

function toUserSetup(items: z.infer<typeof userSetupSchema>[] | null | undefined): UserSetupItem[] {
  return (items ?? []).map((item) => ({
    service: item.service,
    why: item.why ?? null,
    envVars: (item.env_vars ?? []).map((v) => (typeof v === 'string' ? v : v.name)),
  }));
}

interface ParsedPlan {
  facts?: Omit<PlanFacts, 'id' | 'file' | 'hasSummary'>;
  reason?: string;
}

/** Parses one PLAN file's bytes; `fallbackObjective` comes from the roadmap's plan row. */
export function parsePlan(bytes: Uint8Array, fallbackObjective: string | null): ParsedPlan {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { reason: 'Not valid UTF-8 text.' };
  }

  const first = frontmatterParser.parse(text).children[0];
  if (first?.type !== 'yaml' || first.position?.end.offset === undefined) {
    return { reason: 'Missing frontmatter.' };
  }

  let data: unknown;
  try {
    data = parseYaml(first.value, { logLevel: 'error', uniqueKeys: true, maxAliasCount: 50 });
  } catch (error) {
    return { reason: `Invalid YAML: ${reasonFrom(error)}` };
  }

  const result = planFrontmatterSchema.safeParse(data);
  if (!result.success) return { reason: reasonFrom(new Error(zodReason(result.error))) };
  const fm = result.data;
  const body = text.slice(first.position.end.offset);

  return {
    facts: {
      wave: fm.wave ?? null,
      dependsOn: fm.depends_on,
      autonomous: fm.autonomous,
      objective: extractObjective(body) ?? (fallbackObjective ? clip(fallbackObjective) : null),
      filesModified: fm.files_modified ?? [],
      userSetup: toUserSetup(fm.user_setup),
    },
  };
}

function planOrder(a: RegExpExecArray, b: RegExpExecArray): number {
  const byPhase = comparePhaseNumbers(
    parsePhaseNumber(a[1] as string) ?? [],
    parsePhaseNumber(b[1] as string) ?? [],
  );
  return byPhase !== 0
    ? byPhase
    : Number.parseInt(a[2] as string, 10) - Number.parseInt(b[2] as string, 10);
}

/**
 * Reads one phase directory at `commit`. `planRowText` maps a plan file name to its roadmap row
 * text, used when the plan has no `<objective>` block.
 */
export async function readPhaseDirectory(
  reader: GitFileReader,
  commit: string,
  dirPath: string,
  planRowText: ReadonlyMap<string, string> = new Map(),
): Promise<PhaseDirectoryFacts> {
  const entries = (await reader.list(commit, dirPath)).filter((entry) => entry.type === 'blob');
  const names = new Set(entries.map((entry) => entry.name));
  let unreadable: UnreadableFile | null = null;

  let hasContext = false;
  for (const entry of entries.filter((e) => CONTEXT_RE.test(e.name))) {
    if (entry.mode === SYMLINK_MODE) {
      unreadable ??= { file: entry.path, reason: 'Symbolic links are not read.' };
    } else {
      hasContext = true;
    }
  }

  const planEntries = entries
    .map((entry) => ({ entry, match: PLAN_RE.exec(entry.name) }))
    .filter((item): item is { entry: (typeof entries)[number]; match: RegExpExecArray } =>
      Boolean(item.match),
    )
    .sort((a, b) => planOrder(a.match, b.match));

  const plans: PlanFacts[] = [];
  for (const { entry, match } of planEntries) {
    const id = `${match[1]}-${match[2]}`;
    let parsed: ParsedPlan;
    try {
      const bytes = await reader.read(commit, entry.path);
      parsed =
        bytes === null
          ? { reason: 'File not found.' }
          : parsePlan(bytes, planRowText.get(entry.name) ?? null);
    } catch (error) {
      parsed = { reason: reasonFrom(error) };
    }
    if (!parsed.facts) {
      unreadable ??= { file: entry.path, reason: parsed.reason ?? 'Unreadable.' };
      continue;
    }
    plans.push({
      id,
      file: entry.path,
      ...parsed.facts,
      hasSummary: names.has(`${id}-SUMMARY.md`),
    });
  }

  return { hasContext, plans, unreadable };
}

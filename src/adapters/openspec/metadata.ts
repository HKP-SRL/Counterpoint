// `.openspec.yaml`: a change's metadata (openspec-host-adapter design decision 3).
//
// The file is written by agents, so it is untrusted input: it is parsed as data with the `yaml`
// package (unique keys, bounded aliases, no custom tags) and validated with zod. `created` is kept
// only when it is a `YYYY-MM-DD` date, else null. `x-depends-on` is a Counterpoint convention
// (OpenSpec reserves `x-` keys for tools and ignores them): a list of change ids. A parse or
// validation failure marks only that change unreadable.
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { CHANGE_ID_MAX, isChangeId } from '../../core/ids.ts';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const REASON_MAX = 200;

const dependsOnSchema = z
  .array(z.string().max(CHANGE_ID_MAX).refine(isChangeId, 'not a change name'))
  .max(100);

const metadataSchema = z.looseObject({
  created: z.unknown().optional(),
  'x-depends-on': z.union([dependsOnSchema, z.null()]).optional(),
});

export interface ChangeMetadata {
  created: string | null;
  dependsOn: string[];
}

export type MetadataResult = { ok: true; metadata: ChangeMetadata } | { ok: false; reason: string };

/** A short, single-line reason that names no absolute path. */
export function reasonFrom(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split('\n').find((line) => line.trim() !== '') ?? 'unknown error';
  return firstLine
    .replace(/(^|[\s"'(])\/[^\s"')]+/g, '$1<path>')
    .trim()
    .slice(0, REASON_MAX);
}

function validDate(value: unknown): string | null {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  if (typeof text !== 'string') return null;
  const match = DATE_RE.exec(text);
  if (!match) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : text;
}

export function parseMetadata(text: string): MetadataResult {
  let data: unknown;
  try {
    data = parseYaml(text, { logLevel: 'error', uniqueKeys: true, maxAliasCount: 50 });
  } catch (error) {
    return { ok: false, reason: `Invalid YAML: ${reasonFrom(error)}` };
  }
  if (data === null || data === undefined)
    return { ok: true, metadata: { created: null, dependsOn: [] } };

  const result = metadataSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const at = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return {
      ok: false,
      reason: reasonFrom(new Error(`Invalid metadata: ${at}${issue?.message ?? 'not a mapping'}`)),
    };
  }
  return {
    ok: true,
    metadata: {
      created: validDate(result.data.created),
      dependsOn: [...new Set(result.data['x-depends-on'] ?? [])],
    },
  };
}

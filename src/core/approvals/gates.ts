// The gate-config digest slot of an approval (signed-approvals: Statement format).
//
// Gates are commands in the host's own Counterpoint config, `.counterpoint/config.yaml`, under the
// `gates` key. Their real shape belongs to a later change; the approval only binds a digest of
// whatever the `gates` value is at the base tip: sha256 of its canonical JSON. A missing file, an
// empty file, or a missing or null `gates` key is the `{ state: 'absent', digest: null }`
// sentinel, so the slot exists from day one and filling it later changes no schema. Edits to
// other keys of the file (or comments, or formatting) do not change the digest.
//
// The file is read from the commit (never the working tree) and parsed with `yaml`'s core schema
// (no custom tags, no timestamps, duplicate keys refused). A value canonical JSON cannot express
// (a float, for example) is an error naming its key path: an approval never signs a digest that
// depends on how a number happens to print.
import { parse } from 'yaml';
import type { GitFileReader } from '../framework/port.ts';
import { CanonicalJsonError, canonicalJson } from './canonical.ts';
import { sha256Digest } from './digest.ts';
import { GATES_ABSENT, type GatesSlot } from './statement.ts';

export const COUNTERPOINT_CONFIG_PATH = '.counterpoint/config.yaml';

/** The host config could not be read as a gates source. The message is one line. */
export class GatesConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatesConfigError';
  }
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The `gates` value of the host config at `commit`, parsed exactly as the digest parses it, or
 * null when it is absent (missing or empty file, missing or null `gates` key).
 */
export async function gatesValue(reader: GitFileReader, commit: string): Promise<unknown | null> {
  const bytes = await reader.read(commit, COUNTERPOINT_CONFIG_PATH);
  if (bytes === null) return null;

  let document: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    document = parse(text, { schema: 'core', uniqueKeys: true, maxAliasCount: 100 });
  } catch (error) {
    const first = ((error as Error).message ?? '').split('\n')[0] ?? '';
    throw new GatesConfigError(`${COUNTERPOINT_CONFIG_PATH} could not be parsed: ${first}`);
  }

  if (document === null || document === undefined) return null;
  if (!isMapping(document)) {
    throw new GatesConfigError(`${COUNTERPOINT_CONFIG_PATH} must be a mapping at the top level.`);
  }
  const gates = Object.hasOwn(document, 'gates') ? document.gates : undefined;
  return gates === undefined || gates === null ? null : gates;
}

/** The gates slot for the commit `tip`: absent, or present with the digest of the `gates` value. */
export async function gatesDigest(reader: GitFileReader, tip: string): Promise<GatesSlot> {
  const gates = await gatesValue(reader, tip);
  if (gates === null) return { ...GATES_ABSENT };

  try {
    return { state: 'present', digest: sha256Digest(canonicalJson(gates, 'gates')) };
  } catch (error) {
    if (error instanceof CanonicalJsonError) {
      throw new GatesConfigError(`${COUNTERPOINT_CONFIG_PATH}: ${error.message}`);
    }
    throw error;
  }
}

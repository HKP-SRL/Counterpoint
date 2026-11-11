// The gate-config digest slot of an approval (signed-approvals: Statement format).
//
// Gates are commands in the host's own Counterpoint config, `.counterpoint/config.yaml`, under the
// `gates` key. Their shape is checked where a run reads them (host-config.ts); the approval only
// binds a digest of whatever the `gates` value is at the base tip: sha256 of its canonical JSON.
// A missing file, an empty file, or a missing or null `gates` key is the
// `{ state: 'absent', digest: null }` sentinel, so the slot exists from day one and filling it
// later changes no schema. Edits to other keys of the file (or comments, or formatting) do not
// change the digest. A run reads the whole file at the signed base commit, so the other keys are
// fixed by the signature too.
//
// The file is read from the commit (never the working tree) and parsed with `yaml`'s core schema
// (no custom tags, no timestamps, duplicate keys refused). A value canonical JSON cannot express
// (a float, for example) is an error naming its key path: an approval never signs a digest that
// depends on how a number happens to print.
import type { GitFileReader } from '../framework/port.ts';
import {
  COUNTERPOINT_CONFIG_PATH,
  HostConfigError,
  readConfigDocument,
} from '../host/host-config.ts';
import { CanonicalJsonError, canonicalJson } from './canonical.ts';
import { sha256Digest } from './digest.ts';
import { GATES_ABSENT, type GatesSlot } from './statement.ts';

export { COUNTERPOINT_CONFIG_PATH };

/** The host config could not be read as a gates source. The message is one line. */
export class GatesConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatesConfigError';
  }
}

/**
 * The `gates` value of the host config at `commit`, parsed exactly as the digest parses it, or
 * null when it is absent (missing or empty file, missing or null `gates` key).
 */
export async function gatesValue(reader: GitFileReader, commit: string): Promise<unknown | null> {
  let document: Record<string, unknown> | null;
  try {
    document = await readConfigDocument(reader, commit);
  } catch (error) {
    if (error instanceof HostConfigError) throw new GatesConfigError(error.message);
    throw error;
  }
  if (document === null) return null;
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

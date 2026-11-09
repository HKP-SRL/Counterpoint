// Gate-config digest (stub for the RED step).
import type { GitFileReader } from '../framework/port.ts';

export const COUNTERPOINT_CONFIG_PATH = '';
export class GatesConfigError extends Error {}
export async function gatesDigest(
  _reader: GitFileReader,
  _tip: string,
): Promise<{ state: 'absent'; digest: null } | { state: 'present'; digest: string }> {
  return { state: 'absent', digest: null };
}

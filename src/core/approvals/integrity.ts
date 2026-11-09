// RED stub: API only.
export const RISKY_CONFIG_KEYS: readonly string[] = [];

export interface IntegritySnapshot {
  schema: 'counterpoint/integrity/v1';
  config: Record<string, string[]>;
  hooks: Record<string, string>;
  info: Record<string, string>;
  configWorktree: string | null;
}

export interface IntegrityChange {
  area: 'config' | 'hooks' | 'info' | 'config.worktree';
  name: string;
  before: string | null;
  after: string | null;
}

export async function snapshotIntegrity(_gitCommonDir: string): Promise<IntegritySnapshot> {
  return { schema: 'counterpoint/integrity/v1', config: {}, hooks: {}, info: {}, configWorktree: null };
}

export function compareIntegrity(
  _baseline: IntegritySnapshot,
  _current: IntegritySnapshot,
): { ok: true } | { ok: false; changes: IntegrityChange[] } {
  return { ok: true };
}

export function readBaseline(_home: string, _hostId: string): IntegritySnapshot | null {
  return null;
}

export function writeBaseline(_home: string, _hostId: string, _snapshot: IntegritySnapshot): void {}

export type IntegrityState =
  | { state: 'ok' }
  | { state: 'no-baseline' }
  | { state: 'changed'; changes: IntegrityChange[] };

export async function checkIntegrity(
  _home: string,
  _host: { id: string; gitCommonDir: string },
): Promise<IntegrityState> {
  return { state: 'ok' };
}

export function INTEGRITY_REFUSAL(_hostName: string): string {
  return '';
}

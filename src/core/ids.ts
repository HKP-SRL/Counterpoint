// Identifier rules. Every host id and phase id is checked against these patterns before it is
// used in a path, an argv array or a displayed command (RESEARCH Pitfall 8).

/** Host ids: lowercase slug, 1-32 characters, never starting with a dash. */
export const HOST_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Phase ids: two-digit integer phase, optional decimal sub-phase (`02`, `01.1`, `10.12`). */
export const PHASE_ID_RE = /^\d{2}(\.\d+)?$/;

// Sandbox-probe artifact names: the one source of truth for the probe (01-04) and the
// integrity snapshot (01-08), which must recognise exactly the names the probe creates.

/** A probe nonce: 16 random bytes as lowercase hex. */
export const PROBE_NONCE_RE = /^[0-9a-f]{32}$/;
/** A probe canary file name. */
export const PROBE_CANARY_RE = /^\.cp-canary-[0-9a-f]{32}$/;
/** A probe artifact inside a repository's git dir (`hooks/`, `info/`). */
export const PROBE_GIT_ARTIFACT_RE = /^cp-[0-9a-f]{32}(-w)?$/;
/** The probe's outside-workdir canary directory, directly under the user's home. */
export const PROBE_OUTSIDE_DIR_RE = /^\.cp-outside-[0-9a-f]{32}$/;
/** A probe file inside the outside-workdir canary directory (Write target or Edit target). */
export const PROBE_OUTSIDE_ARTIFACT_RE = /^cp-[0-9a-f]{32}-(w|e)$/;

const ECHO_LIMIT = 40;

export class InvalidIdError extends Error {
  readonly kind: 'host' | 'phase';

  constructor(kind: 'host' | 'phase', value: unknown) {
    super(`Invalid ${kind} id ${preview(value)}.`);
    this.name = 'InvalidIdError';
    this.kind = kind;
  }
}

/** A safe, bounded rendering of a rejected value: at most 40 input characters, escaped. */
function preview(value: unknown): string {
  if (typeof value !== 'string') return `(${value === null ? 'null' : typeof value})`;
  return JSON.stringify(value.slice(0, ECHO_LIMIT));
}

export function isHostId(value: unknown): value is string {
  return typeof value === 'string' && HOST_ID_RE.test(value);
}

export function isPhaseId(value: unknown): value is string {
  return typeof value === 'string' && PHASE_ID_RE.test(value);
}

export function assertHostId(value: unknown): string {
  if (!isHostId(value)) throw new InvalidIdError('host', value);
  return value;
}

export function assertPhaseId(value: unknown): string {
  if (!isPhaseId(value)) throw new InvalidIdError('phase', value);
  return value;
}

/** The approval item id for a phase: `phase-{phaseId}`. */
export function approvalItemId(phaseId: string): string {
  return `phase-${assertPhaseId(phaseId)}`;
}

/**
 * Derives a host id from a display name (usually the repo directory name): lowercase, accents
 * stripped, anything outside `[a-z0-9-]` becomes `-`, dashes collapsed and trimmed, at most 32
 * characters. Falls back to `host` when nothing usable is left. The result always matches
 * HOST_ID_RE.
 */
export function hostIdFromName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 32)
    .replace(/-+$/, '');
  return slug === '' ? 'host' : slug;
}

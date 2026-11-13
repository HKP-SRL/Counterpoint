// A project's run settings (build-runs: Run settings page): the model, effort level, context
// budget and per-session limits every builder session of a run uses. The owner edits them on the
// console's Settings page; the daemon stores them per host (migration 3). Until the owner saves,
// the defaults apply. A run copies the settings at its start and keeps them until it ends.
import { z } from 'zod';
import { EFFORT_LEVELS } from '../agent/claude-argv.ts';
import type { Store } from '../core/store/db.ts';

export const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._[\]-]{0,99}$/;

export const HostSettings = z.strictObject({
  /** A model alias or id, e.g. `opus`. */
  model: z.string().regex(MODEL_RE, 'Not a model name.'),
  effort: z.enum(EFFORT_LEVELS),
  /** The context budget as a percentage of the model's window. */
  budgetPercent: z.number().int().min(10).max(90),
  /** Turns one builder session may take (`--max-turns`). */
  maxTurns: z.number().int().min(10).max(2000),
  /** Estimated cost one builder session may reach, in USD (`--max-budget-usd`). */
  maxBudgetUsd: z.number().int().min(1).max(500),
  /** Builder sessions per attempt before the gates run anyway. */
  sessionsPerAttempt: z.number().int().min(1).max(20),
  /** The model design-draft sessions use (design-drafts D-2), at low effort. */
  draftModel: z.string().regex(MODEL_RE, 'Not a model name.').default('sonnet'),
});
export type HostSettings = z.infer<typeof HostSettings>;

export const DEFAULT_HOST_SETTINGS: HostSettings = {
  model: 'opus',
  effort: 'high',
  budgetPercent: 40,
  maxTurns: 400,
  maxBudgetUsd: 50,
  sessionsPerAttempt: 8,
  draftModel: 'sonnet',
};

/**
 * Completes run settings recorded before a field existed (a run started by an older version and
 * resumed after a crash) with the defaults.
 */
export function withDefaults(partial: Partial<HostSettings>): HostSettings {
  return { ...DEFAULT_HOST_SETTINGS, ...partial };
}

/** The host's saved settings, or the defaults. A stored value that no longer validates reads as the defaults. */
export function readHostSettings(
  db: Store,
  hostId: string,
): { settings: HostSettings; saved: boolean } {
  const row = db.prepare('SELECT settings FROM host_settings WHERE host_id = ?').get(hostId);
  if (row === undefined || typeof row.settings !== 'string') {
    return { settings: DEFAULT_HOST_SETTINGS, saved: false };
  }
  try {
    const parsed = HostSettings.safeParse(
      withDefaults(JSON.parse(row.settings) as Partial<HostSettings>),
    );
    return parsed.success
      ? { settings: parsed.data, saved: true }
      : { settings: DEFAULT_HOST_SETTINGS, saved: false };
  } catch {
    return { settings: DEFAULT_HOST_SETTINGS, saved: false };
  }
}

export function writeHostSettings(
  db: Store,
  hostId: string,
  settings: z.input<typeof HostSettings>,
  now: number = Date.now(),
): void {
  db.prepare(
    `INSERT INTO host_settings (host_id, settings, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (host_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`,
  ).run(hostId, JSON.stringify(HostSettings.parse(settings)), now);
}

/** Parses a settings request; the error names the first bad field. */
export function parseHostSettings(
  input: unknown,
): { ok: true; settings: HostSettings } | { ok: false; error: string } {
  const parsed = HostSettings.safeParse(input);
  if (parsed.success) return { ok: true, settings: parsed.data };
  const issue = parsed.error.issues[0];
  return {
    ok: false,
    error: `Invalid settings${issue === undefined ? '' : `: ${issue.path.join('.')} ${issue.message}`}.`,
  };
}

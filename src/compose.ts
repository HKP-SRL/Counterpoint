// The composition root (host-planning: Framework adapter boundary). This is the only module that
// names concrete framework adapters (Biome enforces it: `only src/compose.ts may import the
// OpenSpec adapter`); core, the daemon, the CLI and the server reach adapters only through what
// this module hands them.
import { createOpenSpecAdapter } from './adapters/openspec/index.ts';
import type { FrameworkAdapter } from './core/framework/port.ts';
import { resolveBase } from './core/git/base-ref.ts';
import { createGitFileReader } from './core/git/reader.ts';

/** The framework id stored on a host whose base tip no composed adapter recognises. */
export const NO_FRAMEWORK = 'none';

/** Every composed framework adapter, in detection order. */
export const FRAMEWORK_ADAPTERS: readonly FrameworkAdapter[] = Object.freeze([
  createOpenSpecAdapter(),
]);

/** The composed adapter for a registered host, or null for `none` (or an id no longer composed). */
export function adapterFor(host: { adapter: string }): FrameworkAdapter | null {
  return FRAMEWORK_ADAPTERS.find((adapter) => adapter.id === host.adapter) ?? null;
}

/**
 * Returns the framework adapter id for a repository at its base branch: the id of the first
 * composed adapter whose `detect` recognises the committed tip of the base branch (as the base-ref
 * resolver reads it: the remote base as last fetched, else the local branch), else `none`. Only committed content counts (host-planning: Host detection): an uncommitted or
 * other-branch planning config does not.
 * Hosts registered earlier pick up their framework the next time they register (upsert).
 */
export async function detectFramework(root: string, baseBranch: string): Promise<string> {
  const reader = createGitFileReader(root);
  const { tip } = await resolveBase(root, baseBranch);
  if (tip === null) return NO_FRAMEWORK;
  for (const adapter of FRAMEWORK_ADAPTERS) {
    if (await adapter.detect(reader, tip)) return adapter.id;
  }
  return NO_FRAMEWORK;
}

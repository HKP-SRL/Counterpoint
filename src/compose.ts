// The composition root (ADPT-02). This is the only module that names concrete framework
// adapters; core and the server receive framework knowledge only through what this module hands
// them.
import type { FrameworkAdapter } from './core/framework/port.ts';

// RED stub: no adapter composed yet.
export const FRAMEWORK_ADAPTERS: readonly FrameworkAdapter[] = [];

export function adapterFor(_host: { adapter: string }): FrameworkAdapter | null {
  return null;
}

/**
 * Returns the framework adapter id for a repository at its base branch.
 *
 * No framework adapter is composed yet, so every repository is `none`. Once adapters exist, this
 * asks each composed adapter's `detect` at the base tip; callers do not change.
 */
export async function detectFramework(_root: string, _baseBranch: string): Promise<string> {
  return 'none';
}

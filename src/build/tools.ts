// The programs a run needs before its first session (build-runs: Tools checked before the first
// session). `claude` runs every session, `git` makes worktrees and commits, `gh` opens pull
// requests. They are looked up on the run's PATH (the owner's login shell's), so a program the
// owner installed since Counterpoint started is found with no restart. One that cannot be run
// ends the run before any session, and Needs You names it.
import { canRun } from './services.ts';

export const RUN_TOOLS = ['claude', 'git', 'gh'] as const;

/** The run tools that cannot be run with `env`'s PATH, in order. */
export function missingRunTools(env: Readonly<Record<string, string | undefined>>): string[] {
  const path = env.PATH ?? '';
  return RUN_TOOLS.filter((program) => !canRun(program, path));
}

/** The run's stop reason for missing tools: which, and how to fix it. */
export function describeMissingTools(programs: readonly string[]): string {
  const which = programs.map((program) => `"${program}"`).join(', ');
  const check = programs.map((program) => `"command -v ${program}"`).join(' and ');
  const one = programs.length === 1;
  return (
    `The run needs ${which}, which ${one ? 'is' : 'are'} not on your login shell's PATH. Install ` +
    `${one ? 'it' : 'them'} or add ${one ? 'it' : 'them'} to your shell's PATH (in a new ` +
    `terminal, ${check} should print a path), then start a new run. No restart is needed.`
  );
}

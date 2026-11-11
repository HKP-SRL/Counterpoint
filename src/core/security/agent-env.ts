// The environment an agent process (`claude -p`) is started with.
//
// The parent environment is reduced to an explicit allow-list (AGENT_ENV_ALLOW). Nothing else
// crosses: no SSH_AUTH_SOCK / SSH_ASKPASS (would let an agent use the owner's keys), no GH_TOKEN /
// GITHUB_TOKEN, no ANTHROPIC_API_KEY, no COUNTERPOINT_* variables, no NODE_OPTIONS.
//
// The subprocess scrub (`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`) is set to `0`: the owner's opt-out
// (owner decision 2026-11-10). On claude 2.1.321 the scrub forced `--permission-mode auto` down
// to `default` in every session (seen live), so agents never ran in the auto
// mode the owner chose. What the scrub gave, and the Counterpoint-owned replacement for each:
// - sandbox auto-allow off: the launch profile sets `sandbox.autoAllowBashIfSandboxed: false`
//   explicitly (sandbox-settings.ts, replacement 1);
// - filesystem isolation that holds even when a settings source sets
//   `sandbox.filesystem.disabled`: doctor's sandbox isolation settings check (replacement 2);
// - credential stripping of the environments of the subprocesses Claude Code starts (Bash
//   commands, hooks, stdio MCP servers): the probe's credential-env row (replacement 3).
//
// Because only the allow-list crosses from the parent, anything credential-shaped in an agent's
// Bash environment came from Claude Code itself; that is what the credential-env row looks for.

export const AGENT_ENV_ALLOW = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'SHELL',
] as const;

/** Copies only the allow-listed variables from `parentEnv` and opts out of the subprocess scrub. */
export function agentEnv(parentEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of AGENT_ENV_ALLOW) {
    const value = parentEnv[key];
    if (typeof value === 'string') env[key] = value;
  }
  env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = '0';
  return env;
}

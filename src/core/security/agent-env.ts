// The environment an agent process (`claude -p`) is started with.
//
// `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` strips credentials from the environment of commands the
// agent runs, but it leaves GitHub tokens in place (RESEARCH residuals), so the parent
// environment is also reduced to an explicit allow-list. Nothing else crosses: no
// SSH_AUTH_SOCK / SSH_ASKPASS (would let an agent use the owner's keys), no GH_TOKEN /
// GITHUB_TOKEN, no ANTHROPIC_API_KEY, no COUNTERPOINT_* variables, no NODE_OPTIONS.

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

/** Copies only the allow-listed variables from `parentEnv` and turns the subprocess scrub on. */
export function agentEnv(parentEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of AGENT_ENV_ALLOW) {
    const value = parentEnv[key];
    if (typeof value === 'string') env[key] = value;
  }
  env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = '1';
  return env;
}

// STUB (RED): replaced in the GREEN commit.
export const AGENT_ENV_ALLOW: readonly string[] = [];
export function agentEnv(parent: NodeJS.ProcessEnv): Record<string, string> {
  return { ...(parent as Record<string, string>) };
}

// STUB (RED): replaced in the GREEN commit.
import type { AgentSettings } from '../core/security/sandbox-settings.ts';
export interface ClaudeArgvInput {
  settings: AgentSettings;
  model: string;
  maxTurns: number;
  maxBudgetUsd: number;
  allowedTools: readonly string[];
  prompt: string;
  addDirs?: readonly string[];
}
export function buildClaudeArgv(_input: ClaudeArgvInput): string[] {
  return [];
}

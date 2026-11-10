// The argument array for a headless `claude -p` session (RESEARCH "recommended agent launch
// profile"). Every flag here is mandatory:
// - `--setting-sources user`: a project `.claude/settings.json` hook planted by an agent ran
//   unsandboxed in `-p` mode during research; only the owner's user settings load.
// - `--strict-mcp-config`: only MCP servers passed explicitly (none in Phase 1).
// - `--permission-mode auto` + `--permission-prompts none` (owner decision, 2026-11-10): the
//   permission rules decide first; a call no rule covers goes to Claude Code's auto-mode
//   classifier; anything that would still fall back to a prompt is denied automatically, so
//   nothing waits for a human. The guarantees `counterpoint doctor` proves never rest on the
//   classifier: they rest on the deny rules, the Seatbelt sandbox and
//   `permissions.blockWritesOutsideWorkingDirectories` (sandbox-settings.ts).
// - `--output-format stream-json --verbose`: the machine-readable event stream.
// - `--no-session-persistence`, `--max-turns`, `--max-budget-usd`: bounded, throwaway sessions.
// The prompt goes directly after `-p` because `--allowedTools` and `--add-dir` are variadic and
// would swallow a trailing positional argument.
import { isAbsolute } from 'node:path';
import type { AgentSettings } from '../core/security/sandbox-settings.ts';

/** The one permission mode every agent session launches with (probe sessions and builders). */
export const AGENT_PERMISSION_MODE = 'auto';

export interface ClaudeArgvInput {
  settings: AgentSettings;
  /** A model alias or id, e.g. `haiku`. */
  model: string;
  maxTurns: number;
  maxBudgetUsd: number;
  /** Explicit tool allow-list, e.g. `['Bash', 'Read']`. */
  allowedTools: readonly string[];
  prompt: string;
  /** Extra directories (absolute). Phase 1 passes none. */
  addDirs?: readonly string[];
}

export function buildClaudeArgv(input: ClaudeArgvInput): string[] {
  const { settings, model, maxTurns, maxBudgetUsd, allowedTools, prompt } = input;
  const addDirs = input.addDirs ?? [];

  if (typeof prompt !== 'string' || prompt.trim() === '' || prompt.startsWith('-')) {
    throw new Error('The prompt must be non-empty text that does not start with a dash.');
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(model) || model.startsWith('-')) {
    throw new Error('Invalid model name.');
  }
  if (!Number.isInteger(maxTurns) || maxTurns < 1) {
    throw new Error('maxTurns must be a positive integer.');
  }
  if (!Number.isFinite(maxBudgetUsd) || maxBudgetUsd <= 0) {
    throw new Error('maxBudgetUsd must be a positive number.');
  }
  if (allowedTools.length === 0) throw new Error('allowedTools must not be empty.');
  for (const tool of allowedTools) {
    if (tool === '' || tool.startsWith('-')) throw new Error(`Invalid tool name ${tool}.`);
  }
  for (const dir of addDirs) {
    if (!isAbsolute(dir)) throw new Error('Every --add-dir must be an absolute path.');
  }

  const argv = [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--model',
    model,
    '--max-turns',
    String(maxTurns),
    '--max-budget-usd',
    String(maxBudgetUsd),
    '--settings',
    JSON.stringify(settings),
    '--setting-sources',
    'user',
    '--strict-mcp-config',
    '--permission-mode',
    AGENT_PERMISSION_MODE,
    '--permission-prompts',
    'none',
  ];
  for (const dir of addDirs) argv.push('--add-dir', dir);
  argv.push('--allowedTools', ...allowedTools);
  return argv;
}

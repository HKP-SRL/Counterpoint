// The argument array for a headless `claude -p` session (agent-sandbox: One launch profile for
// every agent session). Every flag here is mandatory:
// - `--setting-sources user,project` (owner decision on spike 3.5 of first-unattended-run): builders
//   need the host's own CLAUDE.md/AGENTS.md, skills, commands and agents, which only the project
//   source loads. It also loads the repository's committed `.claude/settings.json`, permissions and
//   hooks included. A project hook planted by an agent ran unsandboxed in `-p` mode during
//   research, so: agents cannot write `.claude/` in their working folder (deny rule, also an OS
//   write-deny); doctor judges the committed file like the user settings (no isolation widening);
//   and its hooks and other execution-capable keys are part of the host's integrity baseline,
//   accepted only at a terminal. `local` stays out (an uncommitted file nobody reviewed).
// - `--strict-mcp-config`: only MCP servers passed explicitly (none so far).
// - `--permission-mode auto` + `--permission-prompts none` (owner decision, 2026-11-10): the
//   permission rules decide first; a call no rule covers goes to Claude Code's auto-mode
//   classifier; anything that would still fall back to a prompt is denied automatically, so
//   nothing waits for a human. The guarantees `counterpoint doctor` proves never rest on the
//   classifier: they rest on the deny rules, the Seatbelt sandbox and
//   `permissions.blockWritesOutsideWorkingDirectories` (sandbox-settings.ts).
// - `--output-format stream-json --verbose`: the machine-readable event stream.
// - `--no-session-persistence`, `--max-turns`, `--max-budget-usd`: bounded, throwaway sessions.
// The prompt goes directly after `-p` because `--allowedTools` and `--add-dir` are variadic and
// would swallow a trailing positional argument. With `streamInput` (builder sessions) there is no
// positional prompt: `--input-format stream-json` makes claude read user messages from stdin,
// one JSON line each, so the orchestrator can send the first prompt and, later, a wrap-up message
// mid-session (spike 5.1 of first-unattended-run).
import { isAbsolute } from 'node:path';
import type { AgentSettings } from '../core/security/sandbox-settings.ts';

/** The setting sources every agent session loads (probe sessions and builders). */
export const AGENT_SETTING_SOURCES = 'user,project';

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
  /** The prompt. Required unless `streamInput` is set (then the prompt goes over stdin). */
  prompt?: string;
  /** Read user messages from stdin (`--input-format stream-json`) instead of a prompt argument. */
  streamInput?: boolean;
  /** Extra directories (absolute). Nothing passes any yet. */
  addDirs?: readonly string[];
}

export function buildClaudeArgv(input: ClaudeArgvInput): string[] {
  const { settings, model, maxTurns, maxBudgetUsd, allowedTools, prompt } = input;
  const addDirs = input.addDirs ?? [];
  const streamInput = input.streamInput === true;

  if (streamInput) {
    if (prompt !== undefined) throw new Error('A streaming session takes its prompt over stdin.');
  } else if (typeof prompt !== 'string' || prompt.trim() === '' || prompt.startsWith('-')) {
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
    ...(streamInput ? ['--input-format', 'stream-json'] : [prompt as string]),
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
    AGENT_SETTING_SOURCES,
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

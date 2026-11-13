// The argument array for a headless `claude -p` session (owner-identity: Sessions run as the
// owner; design D-1, D-3). Every session is a plain headless Claude Code session acting as the
// owner, with no settings profile, sandbox or tool list from Counterpoint:
// - `--setting-sources user,project`: the owner's own settings, and the host's CLAUDE.md/AGENTS.md,
//   skills, commands and agents, which only the project source loads. `local` stays out: the
//   worktree has no uncommitted settings file of the owner's.
// - `--strict-mcp-config`: no MCP servers (D-3). The owner's account has many connectors; loading
//   them would add their tool lists to every session and could hang a headless start on a sign-in.
// - `--permission-mode auto` + `--permission-prompts none` (owner decisions 2026-11-10 and
//   2026-11-12): Claude Code's auto-mode classifier reviews each action, and anything that would
//   still wait for a person is denied at once, so a session never waits.
// - `--output-format stream-json --verbose`: the machine-readable event stream.
// - `--no-session-persistence`, `--max-turns`, `--max-budget-usd`: bounded, throwaway sessions.
// - `--effort` only when given (builder sessions pass the project's setting).
// The prompt goes directly after `-p` because `--allowedTools` and `--add-dir` are variadic and
// would swallow a trailing positional argument. With `streamInput` (builder sessions) there is no
// positional prompt: `--input-format stream-json` makes claude read user messages from stdin,
// one JSON line each, so the orchestrator can send the first prompt and, later, a wrap-up message
// mid-session (spike 5.1 of first-unattended-run).
import { isAbsolute } from 'node:path';

/** The effort levels `claude --effort` accepts. */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** The setting sources every agent session loads. */
export const AGENT_SETTING_SOURCES = 'user,project';

/** The one permission mode every agent session launches with. */
export const AGENT_PERMISSION_MODE = 'auto';

export interface ClaudeArgvInput {
  /** A model alias or id, e.g. `haiku`. */
  model: string;
  /** The effort level (`--effort`); left out, claude uses its own default. */
  effort?: EffortLevel;
  maxTurns: number;
  maxBudgetUsd: number;
  /** Tools allowed without the classifier, e.g. `['Bash', 'Read']`. None by default. */
  allowedTools?: readonly string[];
  /** The prompt. Required unless `streamInput` is set (then the prompt goes over stdin). */
  prompt?: string;
  /** Read user messages from stdin (`--input-format stream-json`) instead of a prompt argument. */
  streamInput?: boolean;
  /** Extra directories (absolute). Nothing passes any yet. */
  addDirs?: readonly string[];
}

export function buildClaudeArgv(input: ClaudeArgvInput): string[] {
  const { model, maxTurns, maxBudgetUsd, prompt } = input;
  const allowedTools = input.allowedTools ?? [];
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
  if (input.effort !== undefined && !(EFFORT_LEVELS as readonly string[]).includes(input.effort)) {
    throw new Error('Invalid effort level.');
  }
  if (!Number.isInteger(maxTurns) || maxTurns < 1) {
    throw new Error('maxTurns must be a positive integer.');
  }
  if (!Number.isFinite(maxBudgetUsd) || maxBudgetUsd <= 0) {
    throw new Error('maxBudgetUsd must be a positive number.');
  }
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
    ...(input.effort === undefined ? [] : ['--effort', input.effort]),
    '--max-turns',
    String(maxTurns),
    '--max-budget-usd',
    String(maxBudgetUsd),
    '--setting-sources',
    AGENT_SETTING_SOURCES,
    '--strict-mcp-config',
    '--permission-mode',
    AGENT_PERMISSION_MODE,
    '--permission-prompts',
    'none',
  ];
  for (const dir of addDirs) argv.push('--add-dir', dir);
  if (allowedTools.length > 0) argv.push('--allowedTools', ...allowedTools);
  return argv;
}

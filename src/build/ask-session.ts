// The ask tool in builder sessions (owner-inbox D-5, D-6; ask-the-owner: An ask tool for every
// session, Waiting and assuming).
//
// Each builder session gets its own capability, minted when it starts and revoked when it ends.
// The session loads `counterpoint mcp ask` through an MCP config file in the run folder (owner-only,
// outside the worktree), with the capability and Counterpoint's home in that server's environment.
//
// An answer reaches the builder in one of two ways: the session that asked reads it (it waited, or
// called check_answer), or, once that session has ended, the change's next session gets it in its
// prompt. Every answered builder card leaves a note for the change's next session, so an answer
// the session missed is not lost.
//
// The owner's interactive sessions get the same tool once, from a setup card: answering it writes
// the setup key file and adds `counterpoint mcp ask` as a user-scope MCP server of the owner's
// Claude Code (`claude mcp add-json --scope user`).
import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { resolveClaudeBinary } from '../agent/runner.ts';
import { writeFileAtomic0600 } from '../core/fs/atomic.ts';
import {
  ASK_WAIT_CAP_MS,
  askKeyPath,
  mintAskCapability,
  mintInteractiveKey,
  revokeAskCapability,
} from '../core/store/ask.ts';
import { addChangeNote, type CardRow, reopenCard } from '../core/store/cards.ts';
import type { Store } from '../core/store/db.ts';
import { listRunChanges } from '../core/store/runs.ts';
import { getAgentSession } from '../core/store/sessions.ts';
import type { CardDesk } from '../server/cards.ts';

/** How to start `counterpoint mcp ask`. */
export interface AskServer {
  command: string;
  args: readonly string[];
}

const SERVER_NAME = 'counterpoint';
/** The ask tool's names as Claude Code knows them; they need no classifier review. */
export const ASK_TOOLS = [`mcp__${SERVER_NAME}__ask_owner`, `mcp__${SERVER_NAME}__check_answer`];
/** Above the ask tool's longest wait, so Claude Code never cuts a waiting call. */
export const ASK_TOOL_TIMEOUT_MS = ASK_WAIT_CAP_MS + 60_000;

/** The card's session for a builder session (its agent session row). */
export function builderSessionKey(agentSessionId: number): string {
  return `builder-${agentSessionId}`;
}

/** The agent session row behind a builder card's session, or null for any other session. */
export function builderSessionOf(key: string | null): number | null {
  const match = /^builder-(\d{1,15})$/.exec(key ?? '');
  return match === null ? null : Number(match[1]);
}

export interface BuilderAsk {
  mcpConfig: string;
  tools: readonly string[];
  /** Extra environment for the session. */
  env: Record<string, string>;
  /** Revokes the capability and removes the config file (the session ended). */
  close(): void;
}

/** Mints the session's capability and writes its MCP config file into `dir` (the change's run folder). */
export function openBuilderAsk(input: {
  db: Store;
  home: string;
  server: AskServer;
  dir: string;
  agentSessionId: number;
  hostId: string;
  runId: string;
  change: string;
}): BuilderAsk {
  const sessionId = builderSessionKey(input.agentSessionId);
  const capability = mintAskCapability(input.db, {
    sessionId,
    kind: 'builder',
    hostId: input.hostId,
    runId: input.runId,
    change: input.change,
  });
  const mcpConfig = join(input.dir, `ask-mcp-${input.agentSessionId}.json`);
  const config = {
    mcpServers: {
      [SERVER_NAME]: {
        type: 'stdio',
        command: input.server.command,
        args: [...input.server.args],
        env: { COUNTERPOINT_ASK_CAPABILITY: capability, COUNTERPOINT_HOME: input.home },
      },
    },
  };
  try {
    writeFileAtomic0600(mcpConfig, `${JSON.stringify(config, null, 2)}\n`);
  } catch (error) {
    revokeAskCapability(input.db, sessionId);
    throw error;
  }
  return {
    mcpConfig,
    tools: ASK_TOOLS,
    env: { MCP_TOOL_TIMEOUT: String(ASK_TOOL_TIMEOUT_MS) },
    close: () => {
      revokeAskCapability(input.db, sessionId);
      rmSync(mcpConfig, { force: true });
    },
  };
}

/** What the next session on the change reads about an answered question. */
export function answerNote(card: CardRow): string {
  const picked = card.options[card.answer ?? -1]?.label ?? '';
  const lines = [`You asked the owner: "${card.question}". The owner answered: ${picked}.`];
  if (card.note !== null && card.note !== '') lines.push(`The owner's note: ${card.note}`);
  return lines.join('\n');
}

/**
 * Called with every answered card. For a builder's question: leaves the answer for the change's
 * next session and, once the asking session has ended, says where the answer went.
 */
export function onBuilderAnswer(db: Store, desk: CardDesk, card: CardRow): void {
  const agentSessionId = builderSessionOf(card.sessionId);
  if (agentSessionId === null || card.hostId === null || card.change === null) return;
  addChangeNote(db, {
    hostId: card.hostId,
    change: card.change,
    text: answerNote(card),
    cardId: card.id,
  });
  const session = getAgentSession(db, agentSessionId);
  if (session !== undefined && session.endedAt === null) return; // the session itself reads it
  const row =
    card.runId === null
      ? undefined
      : listRunChanges(db, card.runId).find((change) => change.change === card.change);
  const recommended = card.options[card.recommended]?.label ?? '';
  let outcome: string;
  if (row?.state === 'green') {
    // The answer is kept for the change's next build (D-6). Turning a different answer into a
    // revision of the open PR belongs to `pr-revisions`.
    outcome =
      card.answer === card.recommended
        ? 'The PR was built on this answer.'
        : `Recorded. The PR was built on "${recommended}".`;
  } else if (row?.state === 'parked') {
    outcome = `${card.change} builds again in the next run with this answer.`;
  } else {
    outcome = `The next session on ${card.change} gets this answer.`;
  }
  desk.outcome(card, outcome);
}

/** The setup card's key: raised once, whatever the owner answers. */
export const ASK_SETUP_KEY = 'setup:ask-tool';

/** Raises the one-time setup card for interactive sessions, unless the tool is already set up. */
export function raiseAskSetupCard(desk: CardDesk, home: string): void {
  if (existsSync(askKeyPath(home))) return;
  desk.raise({
    hostId: null,
    key: ASK_SETUP_KEY,
    kind: 'setup',
    source: 'machine',
    question: 'Let your Claude Code sessions ask you here?',
    why: 'Their questions then come to Needs You instead of the terminal.',
    options: [
      {
        label: 'Set it up',
        consequence: 'Adds the ask tool to Claude Code for your user. New sessions get it.',
        action: { type: 'add-ask-tool' },
      },
      { label: 'Not now', consequence: 'Sessions keep asking in the terminal.' },
    ],
    recommended: 0,
    reversible: true,
    blocking: false,
  });
}

/**
 * The `add-ask-tool` action: a new setup key in the owner-only file, and `counterpoint mcp ask` as
 * the owner's user-scope MCP server `counterpoint`, replacing an earlier entry of that name.
 */
export async function setUpInteractiveAsk(input: {
  db: Store;
  desk: CardDesk;
  card: CardRow;
  home: string;
  server: AskServer;
  env: Record<string, string>;
}): Promise<string> {
  try {
    writeFileAtomic0600(askKeyPath(input.home), `${mintInteractiveKey(input.db)}\n`);
    const claude = resolveClaudeBinary(input.env);
    const run = (args: string[]) =>
      execa(claude, args, {
        env: input.env,
        extendEnv: false,
        cwd: input.env.HOME ?? homedir(),
        stdin: 'ignore',
        timeout: 60_000,
        reject: false,
      });
    await run(['mcp', 'remove', '--scope', 'user', SERVER_NAME]);
    const entry = {
      type: 'stdio',
      command: input.server.command,
      args: [...input.server.args],
      env: { COUNTERPOINT_HOME: input.home },
    };
    const added = await run([
      'mcp',
      'add-json',
      '--scope',
      'user',
      SERVER_NAME,
      JSON.stringify(entry),
    ]);
    if (added.exitCode !== 0) {
      const line = `${added.stderr}\n${added.stdout}`.split('\n').find((l) => l.trim() !== '');
      throw new Error(`claude mcp add-json failed${line === undefined ? '' : `: ${line.trim()}`}`);
    }
  } catch (error) {
    reopenCard(input.db, input.card.id); // pick it again once the cause is fixed
    throw error;
  }
  input.desk.doneForYou(
    null,
    `Added the ask tool to your Claude Code sessions (undo: claude mcp remove --scope user ${SERVER_NAME}).`,
  );
  return 'Set up. New Claude Code sessions ask you here.';
}

// `counterpoint mcp ask` (owner-inbox D-5; ask-the-owner): a stdio MCP server with two tools,
// `ask_owner` and `check_answer`, that turn a Claude Code session's questions into cards in Needs
// You. It talks to the daemon over the control socket with its session's ask capability, which
// allows only the `/control/ask/` calls: post a card, wait on it, read it, list the session's
// cards, and say the session ended (when its input ends: an interactive session's unanswered cards
// then close as "Session ended").
//
// The protocol is MCP over stdio: one JSON-RPC 2.0 message per line. Calls run concurrently, so a
// waiting `ask_owner` never blocks a ping or another call. One `ask_owner` waits at most 10
// minutes, then returns "still open" with the card id. A builder never waits: the daemon returns
// its card at once and the recommendation is assumed. An interactive session is also told to put
// a waiting question in its reply, since the owner may be reading the chat.
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { z } from 'zod';
import {
  ASK_WAIT_CAP_MS,
  ASK_WAIT_REQUEST_MS,
  type AskCardView,
  AskInput,
  CARD_ONLY,
} from '../core/store/ask.ts';
import type { ControlResponse } from './control-client.ts';

/**
 * One request to the daemon's `/control/ask/` routes, carrying the session's capability.
 * `onlyIfOpen`: an interactive session that never opened sends nothing (answers 204).
 */
export type AskTransport = (
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  options?: { timeoutMs?: number; signal?: AbortSignal; onlyIfOpen?: boolean },
) => Promise<ControlResponse>;

/** What a session reads when the interactive setup key no longer works. */
export const NOT_SET_UP =
  "Counterpoint's ask tool isn't set up for this session. Ask in your reply instead; the owner can set it up from Needs You.";

/**
 * The transport of an interactive session: the first call opens the session with the setup key
 * (`open`), which returns the session's own capability; every call then carries that capability.
 */
export function sessionTransport(
  open: () => Promise<ControlResponse>,
  withCapability: (capability: string) => AskTransport,
): AskTransport {
  let session: Promise<AskTransport | ControlResponse> | undefined;
  return async (method, path, body, options) => {
    if (options?.onlyIfOpen === true && session === undefined) return { status: 204, body: null };
    session ??= open().then((res) => {
      const capability = isRecord(res.body) ? res.body.capability : undefined;
      if (res.status === 201 && typeof capability === 'string') return withCapability(capability);
      session = undefined; // try again on the next call
      return { status: res.status === 401 ? 401 : 503, body: { error: NOT_SET_UP } };
    });
    let opened: AskTransport | ControlResponse;
    try {
      opened = await session;
    } catch (error) {
      session = undefined;
      throw error;
    }
    return typeof opened === 'function' ? opened(method, path, body, options) : opened;
  };
}

export interface AskMcpOptions {
  transport: AskTransport;
  version: string;
  /** The owner's own interactive session (not a builder): the owner may be reading the chat. */
  interactive?: boolean;
  /** The longest one `ask_owner` waits (default 10 minutes). */
  waitCapMs?: number;
  /** The longest one wait request to the daemon holds (default 60 s). */
  waitRequestMs?: number;
  now?: () => number;
  /** Sends a notification to the client (progress while a call waits). */
  notify?: (message: Record<string, unknown>) => void;
}

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;

const CheckInput = z.strictObject({
  card: z
    .string()
    .regex(/^c-[0-9a-f]{16}$/)
    .optional()
    .describe('The card id ask_owner returned. Leave out to list all your cards.'),
});

function inputSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

const TOOLS = [
  {
    name: 'ask_owner',
    description: `Ask the owner a decision only they can make. It appears as a card in their inbox. ${CARD_ONLY} Ask only what changes the outcome. Give 2 to 4 options, each with its consequence, and recommend one. If the choice is reversible, keep working on your recommendation: it is noted as assumed. Set wait only when you can't go on without the answer; a wait ends after at most 10 minutes.`,
    inputSchema: inputSchema(AskInput),
  },
  {
    name: 'check_answer',
    description: "Read the owner's answer to a card you asked, or list your cards.",
    inputSchema: inputSchema(CheckInput),
  },
];

type JsonRpcId = string | number;
type Reply = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function errorReply(id: JsonRpcId | null, code: number, message: string): Reply {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function text(value: string, isError = false): Reply {
  return { content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) };
}

function errorOf(res: ControlResponse, fallback: string): string {
  const error = isRecord(res.body) ? res.body.error : undefined;
  return typeof error === 'string' && error !== '' ? error : fallback;
}

function cardOf(res: ControlResponse): AskCardView | undefined {
  const card = isRecord(res.body) ? res.body.card : undefined;
  return isRecord(card) && typeof card.card === 'string'
    ? (card as unknown as AskCardView)
    : undefined;
}

const waiting = (card: AskCardView) => card.state === 'open' || card.state === 'deferred';

/** What an interactive session is told while its question waits. */
export const IN_CHAT_TOO =
  'The owner may be reading the chat: also put this question in your reply in one line, with numbered options.';

/** What the session reads about one card. */
export function describeCard(card: AskCardView): string {
  if (card.answer !== null) {
    const note = card.note === null ? '' : `\nTheir note: ${card.note}`;
    return `The owner answered card ${card.card}: "${card.answer.label}".${note}`;
  }
  if (card.state === 'resolved') return `Card ${card.card} was closed without an answer.`;
  const recommended = card.options[card.recommended] ?? '';
  if (card.reversible) {
    return `Card ${card.card} is waiting for the owner. Go on with your recommendation, "${recommended}", and note it as assumed. Check later with check_answer and adjust if the answer differs.`;
  }
  return `Card ${card.card} is waiting for the owner. Don't take this step until it is answered: work on what doesn't depend on it, then check with check_answer.`;
}

export function createAskMcp(options: AskMcpOptions) {
  const now = options.now ?? Date.now;
  const waitCapMs = options.waitCapMs ?? ASK_WAIT_CAP_MS;
  const waitRequestMs = options.waitRequestMs ?? ASK_WAIT_REQUEST_MS;
  const inFlight = new Map<JsonRpcId, AbortController>();

  async function waitFor(
    card: AskCardView,
    signal: AbortSignal,
    progressToken: unknown,
  ): Promise<AskCardView> {
    const started = now();
    const deadline = started + waitCapMs;
    let current = card;
    while (waiting(current) && !signal.aborted) {
      const remaining = deadline - now();
      if (remaining <= 0) break;
      const ms = Math.min(remaining, waitRequestMs);
      const res = await options.transport(
        'POST',
        `/control/ask/cards/${encodeURIComponent(current.card)}/wait`,
        { ms },
        { timeoutMs: ms + 15_000, signal },
      );
      const next = res.status === 200 ? cardOf(res) : undefined;
      if (next === undefined) break;
      current = next;
      // A builder's wait returns at once: it never waits (the daemon says so).
      if (isRecord(res.body) && res.body.waits === false) break;
      if (isId(progressToken) && waiting(current)) {
        options.notify?.({
          jsonrpc: '2.0',
          method: 'notifications/progress',
          params: { progressToken, progress: now() - started, message: 'Waiting for the owner' },
        });
      }
    }
    return current;
  }

  async function askOwner(args: unknown, signal: AbortSignal, progressToken: unknown) {
    const parsed = AskInput.safeParse(args);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return text(
        `Not a valid question${issue === undefined ? '' : `: ${issue.path.join('.') || 'question'} ${issue.message}`}`,
        true,
      );
    }
    const res = await options.transport('POST', '/control/ask/cards', parsed.data);
    const card = res.status === 201 ? cardOf(res) : undefined;
    if (card === undefined) return text(errorOf(res, "Couldn't post the question."), true);
    // The owner may be at the terminal of their own session: an open question goes in the chat too.
    const reply = (current: AskCardView) =>
      text(
        options.interactive === true && waiting(current)
          ? `${describeCard(current)}\n${IN_CHAT_TOO}`
          : describeCard(current),
      );
    // Builders never wait: the daemon answers `waits: false` and the recommendation is assumed.
    const waits = parsed.data.wait && !(isRecord(res.body) && res.body.waits === false);
    if (!waits) return reply(card);
    try {
      return reply(await waitFor(card, signal, progressToken));
    } catch {
      return text(
        `Card ${card.card} is posted, but Counterpoint stopped answering while you waited. Check later with check_answer.`,
      );
    }
  }

  async function checkAnswer(args: unknown) {
    const parsed = CheckInput.safeParse(args ?? {});
    if (!parsed.success)
      return text('Give the card id ask_owner returned, like c-0123456789abcdef.', true);
    if (parsed.data.card !== undefined) {
      const res = await options.transport(
        'GET',
        `/control/ask/cards/${encodeURIComponent(parsed.data.card)}`,
      );
      const card = res.status === 200 ? cardOf(res) : undefined;
      if (card === undefined) return text(errorOf(res, 'No such card for this session.'), true);
      return text(describeCard(card));
    }
    const res = await options.transport('GET', '/control/ask/cards');
    const list = isRecord(res.body) && Array.isArray(res.body.cards) ? res.body.cards : undefined;
    if (res.status !== 200 || list === undefined) {
      return text(errorOf(res, "Couldn't list your cards."), true);
    }
    if (list.length === 0) return text('You have asked nothing yet.');
    return text((list as AskCardView[]).map(describeCard).join('\n'));
  }

  async function callTool(id: JsonRpcId, params: Record<string, unknown>): Promise<Reply> {
    const controller = new AbortController();
    inFlight.set(id, controller);
    try {
      const meta = isRecord(params._meta) ? params._meta : {};
      if (params.name === 'ask_owner') {
        return await askOwner(params.arguments, controller.signal, meta.progressToken);
      }
      if (params.name === 'check_answer') return await checkAnswer(params.arguments);
      return text(`No tool named ${String(params.name)}.`, true);
    } catch {
      return text("Counterpoint's daemon didn't answer. Try again later.", true);
    } finally {
      inFlight.delete(id);
    }
  }

  /** Handles one JSON-RPC message; returns the reply, or null for a notification. */
  async function handle(message: unknown): Promise<Reply | null> {
    if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      const id = isRecord(message) && isId(message.id) ? message.id : null;
      return errorReply(id, -32600, 'Invalid request');
    }
    const params = isRecord(message.params) ? message.params : {};
    if (!isId(message.id)) {
      if (message.method === 'notifications/cancelled' && isId(params.requestId)) {
        inFlight.get(params.requestId)?.abort();
      }
      return null;
    }
    const id = message.id;
    switch (message.method) {
      case 'initialize': {
        const asked = params.protocolVersion;
        const protocolVersion = PROTOCOL_VERSIONS.find((v) => v === asked) ?? PROTOCOL_VERSIONS[0];
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'counterpoint', version: options.version },
            instructions:
              options.interactive === true
                ? 'Ask the owner through ask_owner, and also put the question in your reply in one line with numbered options. Ask only what changes the outcome.'
                : 'Ask the owner through ask_owner, never in your reply text. Ask only what changes the outcome.',
          },
        };
      }
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
      case 'tools/call':
        return { jsonrpc: '2.0', id, result: await callTool(id, params) };
      default:
        return errorReply(id, -32601, 'Method not found');
    }
  }

  /** Ends every waiting call (the client went away). */
  function abortAll(): void {
    for (const controller of inFlight.values()) controller.abort();
  }

  /**
   * Tells the daemon the session ended (its client went away): an interactive session's unanswered
   * cards close as "Session ended". Never opens a session that asked nothing.
   */
  async function end(): Promise<void> {
    await options
      .transport('POST', '/control/ask/end', {}, { timeoutMs: 5_000, onlyIfOpen: true })
      .catch(() => undefined);
  }

  return { handle, abortAll, end };
}

/** Serves the MCP over a line stream until the input ends. */
export async function serveAskMcp(
  input: Readable,
  output: Writable,
  build: (notify: (message: Record<string, unknown>) => void) => ReturnType<typeof createAskMcp>,
): Promise<void> {
  const write = (message: Record<string, unknown>) => {
    output.write(`${JSON.stringify(message)}\n`);
  };
  const mcp = build(write);
  const pending = new Set<Promise<void>>();
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  for await (const line of lines) {
    if (line.trim() === '') continue;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      write(errorReply(null, -32700, 'Parse error'));
      continue;
    }
    const task = mcp
      .handle(message)
      .then((reply) => {
        if (reply !== null) write(reply);
      })
      .catch(() => {});
    pending.add(task);
    void task.finally(() => pending.delete(task));
  }
  mcp.abortAll();
  await Promise.allSettled(pending);
  await mcp.end();
}

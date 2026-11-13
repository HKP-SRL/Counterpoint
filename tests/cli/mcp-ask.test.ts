// The ask tool (owner-inbox D-5; ask-the-owner): `counterpoint mcp ask` over the control app's
// `/control/ask/` routes, in process. Posting, waiting, the wait cap, and the capability's limits:
// another session's card, a sixth card, an action on an agent's card, the rest of the control API.
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAskMcp, NOT_SET_UP, serveAskMcp, sessionTransport } from '../../src/cli/mcp-ask.ts';
import { detectFramework } from '../../src/compose.ts';
import {
  ASK_OPEN_LIMIT,
  ASK_WAIT_CAP_MS,
  type AskGrant,
  mintAskCapability,
  mintInteractiveKey,
  revokeAskCapability,
} from '../../src/core/store/ask.ts';
import { getCard, listSessionCards } from '../../src/core/store/cards.ts';
import { openStore, type Store, upsertHost } from '../../src/core/store/db.ts';
import { EventBus } from '../../src/core/store/events.ts';
import { CardDesk } from '../../src/server/cards.ts';
import { createControlApp, hashToken } from '../../src/server/control.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

const TOKEN = 'control-token-for-tests';
let db: Store;
let desk: CardDesk;
let control: ReturnType<typeof createControlApp>;

function grant(sessionId: string): AskGrant {
  return { sessionId, kind: 'builder', hostId: 'h1', runId: 'run-1', change: 'add-menu' };
}

/** The owner's own interactive session (as `POST /control/ask/session` opens one). */
function interactive(sessionId: string): AskGrant {
  return { sessionId, kind: 'interactive', hostId: 'h1', runId: null, change: null };
}

function transportFor(bearer: string) {
  return async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const res = await control.request(`http://counterpoint.control${path}`, {
      method,
      headers: {
        authorization: `Bearer ${bearer}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: await res.json() };
  };
}

function mcpFor(
  bearer: string,
  extra: { waitCapMs?: number; waitRequestMs?: number; interactive?: boolean } = {},
) {
  return createAskMcp({ transport: transportFor(bearer), version: 'test', ...extra });
}

const QUESTION = {
  question: 'Which date format for the menu?',
  why: 'Diners see it on every page.',
  options: [
    { label: 'ISO', consequence: 'Plain and sortable.' },
    { label: 'Local', consequence: 'Friendlier.' },
    { label: 'Relative', consequence: 'Needs a clock.' },
  ],
  recommended: 1,
  reversible: true,
};

let nextId = 1;
async function call(mcp: ReturnType<typeof createAskMcp>, name: string, args: unknown) {
  const reply = await mcp.handle({
    jsonrpc: '2.0',
    id: nextId++,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  const result = (reply as { result: { content: { text: string }[]; isError?: boolean } }).result;
  return { text: result.content[0]?.text ?? '', isError: result.isError === true };
}

const cardIdIn = (text: string) => /c-[0-9a-f]{16}/.exec(text)?.[0] ?? '';

beforeAll(() => {
  db = openStore(makeScratchDir('ask-home'));
  upsertHost(db, {
    id: 'h1',
    root: '/tmp/h1',
    gitCommonDir: '/tmp/h1/.git',
    baseBranch: 'main',
    adapter: 'openspec',
  });
  desk = new CardDesk({ store: db, bus: new EventBus() });
  control = createControlApp({
    store: db,
    bus: new EventBus(),
    tokenHash: hashToken(TOKEN),
    port: 4999,
    onStop: () => {},
    detectFramework,
    desk,
  });
});

afterAll(() => {
  db.close();
  removeScratchDirs();
});

describe('mcp ask: protocol', () => {
  it('initializes and lists both tools with object input schemas', async () => {
    const mcp = mcpFor('unused');
    const init = (await mcp.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't' } },
    })) as { result: { protocolVersion: string; capabilities: unknown } };
    expect(init.result.protocolVersion).toBe('2025-06-18');
    expect(init.result.capabilities).toEqual({ tools: {} });
    const list = (await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })) as {
      result: { tools: { name: string; inputSchema: { type: string; required: string[] } }[] };
    };
    expect(list.result.tools.map((tool) => tool.name)).toEqual(['ask_owner', 'check_answer']);
    expect(list.result.tools[0]?.inputSchema.type).toBe('object');
    expect(list.result.tools[0]?.inputSchema.required).not.toContain('wait');
    expect(await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    expect(await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'resources/list' })).toMatchObject({
      error: { code: -32601 },
    });
  });

  it('serves line-delimited JSON-RPC over stdio until the input ends', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')));
    const served = serveAskMcp(input, output, () => mcpFor('unused'));
    input.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    input.write('not json\n');
    input.end();
    await served;
    const lines = chunks
      .join('')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines).toContainEqual({ jsonrpc: '2.0', id: 1, result: {} });
    expect(lines).toContainEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    });
  });
});

describe('mcp ask: posting and waiting', () => {
  it('posts a card naming the run, change and session; a reversible question goes on as assumed', async () => {
    const capability = mintAskCapability(db, grant('s-post'));
    const { text, isError } = await call(mcpFor(capability), 'ask_owner', QUESTION);
    expect(isError).toBe(false);
    expect(text).toContain('Go on with your recommendation, "Local"');
    const card = getCard(db, cardIdIn(text));
    expect(card).toMatchObject({
      hostId: 'h1',
      source: 'session',
      kind: 'ask',
      runId: 'run-1',
      change: 'add-menu',
      sessionId: 's-post',
      state: 'open',
      recommended: 1,
      reversible: true,
      blocking: false,
    });
    expect(card?.options.every((option) => option.action === undefined)).toBe(true);
  });

  it('waits for the answer and returns it with the note', async () => {
    const capability = mintAskCapability(db, interactive('s-wait'));
    const mcp = mcpFor(capability, { interactive: true });
    const pending = call(mcp, 'ask_owner', { ...QUESTION, wait: true });
    let card = listSessionCards(db, 's-wait')[0];
    for (let i = 0; card === undefined && i < 50; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      card = listSessionCards(db, 's-wait')[0];
    }
    expect(card?.blocking).toBe(true);
    const answered = await desk.answer(card?.id ?? '', { option: 2, note: 'Keep it short' });
    expect(answered.outcome).toBe('Not read yet');
    const { text } = await pending;
    expect(text).toContain('"Relative"');
    expect(text).toContain('Their note: Keep it short');
    // Answered: no need to repeat it in the chat.
    expect(text).not.toContain('reading the chat');
    expect(getCard(db, card?.id ?? '')?.outcome).toBe('Read by the session');
    const later = await call(mcp, 'check_answer', { card: card?.id });
    expect(later.text).toContain('"Relative"');
  });

  it('never makes a builder wait: its recommendation is assumed at once', async () => {
    const capability = mintAskCapability(db, grant('s-builder-wait'));
    const started = Date.now();
    const { text } = await call(mcpFor(capability), 'ask_owner', { ...QUESTION, wait: true });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(text).toContain('Go on with your recommendation, "Local"');
    expect(text).not.toContain('reading the chat');
    // Reversible and nobody waits on it: it blocks nothing, so it does not notify.
    expect(getCard(db, cardIdIn(text))).toMatchObject({ state: 'open', blocking: false });
    // Its wait route answers at once too.
    const res = await transportFor(capability)(
      'POST',
      `/control/ask/cards/${cardIdIn(text)}/wait`,
      { ms: 60_000 },
    );
    expect(res.body).toMatchObject({ waits: false, card: { state: 'open' } });
  });

  it("notifies for an interactive session's question and tells it to ask in the chat too", async () => {
    const capability = mintAskCapability(db, interactive('s-chat'));
    const { text } = await call(mcpFor(capability, { interactive: true }), 'ask_owner', QUESTION);
    expect(text).toContain('Go on with your recommendation');
    expect(text).toContain(
      'The owner may be reading the chat: also put this question in your reply in one line, with numbered options.',
    );
    expect(getCard(db, cardIdIn(text))).toMatchObject({ blocking: true, runId: null });
  });

  it('says "Not read yet" until check_answer reads the answer', async () => {
    const capability = mintAskCapability(db, grant('s-read'));
    const { text } = await call(mcpFor(capability), 'ask_owner', QUESTION);
    const id = cardIdIn(text);
    expect((await desk.answer(id, { option: 0 })).outcome).toBe('Not read yet');
    await call(mcpFor(capability), 'check_answer', {});
    expect(getCard(db, id)?.outcome).toBe('Read by the session');
  });

  it("closes an interactive session's unanswered cards as Session ended when its input ends", async () => {
    const capability = mintAskCapability(db, interactive('s-ends'));
    const mcp = mcpFor(capability, { interactive: true });
    const first = cardIdIn((await call(mcp, 'ask_owner', QUESTION)).text);
    const second = cardIdIn((await call(mcp, 'ask_owner', QUESTION)).text);
    await desk.answer(second, { option: 0 });
    const input = new PassThrough();
    const served = serveAskMcp(input, new PassThrough(), () => mcp);
    input.end();
    await served;
    expect(getCard(db, first)).toMatchObject({ state: 'resolved', outcome: 'Session ended' });
    expect(getCard(db, second)).toMatchObject({ state: 'answered', outcome: 'Not read yet' });
    // Its capability ended with it.
    expect((await call(mcp, 'check_answer', {})).isError).toBe(true);
  });

  it("keeps a builder's unanswered cards answerable when its input ends", async () => {
    const capability = mintAskCapability(db, grant('s-builder-ends'));
    const mcp = mcpFor(capability);
    const id = cardIdIn((await call(mcp, 'ask_owner', QUESTION)).text);
    const input = new PassThrough();
    const served = serveAskMcp(input, new PassThrough(), () => mcp);
    input.end();
    await served;
    expect(getCard(db, id)?.state).toBe('open');
  });

  it('stops waiting at the cap and says the card is still open', async () => {
    expect(ASK_WAIT_CAP_MS).toBe(10 * 60_000);
    const capability = mintAskCapability(db, interactive('s-timeout'));
    const mcp = mcpFor(capability, { waitCapMs: 60, waitRequestMs: 20 });
    const started = Date.now();
    const reversible = await call(mcp, 'ask_owner', { ...QUESTION, wait: true });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(reversible.text).toMatch(/Card c-[0-9a-f]{16} is waiting for the owner\. Go on/);
    const irreversible = await call(mcp, 'ask_owner', {
      ...QUESTION,
      reversible: false,
      wait: true,
    });
    expect(irreversible.text).toContain("Don't take this step until it is answered");
    expect(getCard(db, cardIdIn(irreversible.text))).toMatchObject({
      state: 'open',
      blocking: true,
    });
  });
});

describe('mcp ask: the capability reaches only its own cards', () => {
  it("refuses another session's card", async () => {
    const mine = mintAskCapability(db, grant('s-mine'));
    const theirs = mintAskCapability(db, grant('s-theirs'));
    const posted = await call(mcpFor(theirs), 'ask_owner', QUESTION);
    const id = cardIdIn(posted.text);
    const read = await call(mcpFor(mine), 'check_answer', { card: id });
    expect(read.isError).toBe(true);
    expect(read.text).toBe('No such card for this session.');
    const wait = await transportFor(mine)('POST', `/control/ask/cards/${id}/wait`, { ms: 0 });
    expect(wait.status).toBe(404);
    const list = await call(mcpFor(mine), 'check_answer', {});
    expect(list.text).not.toContain(id);
  });

  it('refuses a sixth waiting card with a message to proceed on assumptions', async () => {
    const capability = mintAskCapability(db, grant('s-flood'));
    const mcp = mcpFor(capability);
    for (let i = 0; i < ASK_OPEN_LIMIT; i += 1) {
      expect((await call(mcp, 'ask_owner', QUESTION)).isError).toBe(false);
    }
    const sixth = await call(mcp, 'ask_owner', QUESTION);
    expect(sixth.isError).toBe(true);
    expect(sixth.text).toContain('proceed on your assumptions');
    expect(listSessionCards(db, 's-flood')).toHaveLength(ASK_OPEN_LIMIT);
    // Once one is answered, there is room again.
    await desk.answer(listSessionCards(db, 's-flood')[0]?.id ?? '', { option: 0 });
    expect((await call(mcp, 'ask_owner', QUESTION)).isError).toBe(false);
  });

  it("refuses an action on an agent's card", async () => {
    const capability = mintAskCapability(db, grant('s-action'));
    const res = await transportFor(capability)('POST', '/control/ask/cards', {
      ...QUESTION,
      options: [
        { label: 'Run it', consequence: 'Runs.', action: { type: 'resume-run', runId: 'run-1' } },
        { label: 'No', consequence: 'Nothing.' },
      ],
      recommended: 0,
    });
    expect(res.status).toBe(400);
    expect(listSessionCards(db, 's-action')).toHaveLength(0);
  });

  it('reaches nothing else, and nothing once revoked', async () => {
    const capability = mintAskCapability(db, grant('s-scope'));
    expect((await transportFor(capability)('GET', '/control/status')).status).toBe(401);
    expect((await transportFor(capability)('POST', '/control/stop')).status).toBe(401);
    expect((await transportFor(TOKEN)('GET', '/control/ask/cards')).status).toBe(401);
    expect((await transportFor('nope')('GET', '/control/ask/cards')).status).toBe(401);
    revokeAskCapability(db, 's-scope');
    const after = await call(mcpFor(capability), 'ask_owner', QUESTION);
    expect(after.isError).toBe(true);
  });
});

describe('mcp ask: interactive sessions open their own capability with the setup key', () => {
  const interactive = (key: string, cwd: string) => {
    const keyed = transportFor(key);
    return createAskMcp({
      version: 'test',
      transport: sessionTransport(
        () => keyed('POST', '/control/ask/session', { cwd }),
        transportFor,
      ),
    });
  };

  it('each session posts and reads only its own cards, in the project it runs in', async () => {
    const root = makeScratchDir('ask-project');
    mkdirSync(join(root, 'src'));
    upsertHost(db, {
      id: 'h2',
      root: realpathSync(root),
      gitCommonDir: `${root}/.git`,
      baseBranch: 'main',
      adapter: 'openspec',
    });
    const key = mintInteractiveKey(db);
    const first = interactive(key, join(root, 'src'));
    const second = interactive(key, '/');
    const asked = await call(first, 'ask_owner', QUESTION);
    const card = getCard(db, cardIdIn(asked.text));
    expect(card).toMatchObject({ hostId: 'h2', source: 'session', runId: null, change: null });
    expect(card?.sessionId).toMatch(/^interactive-[0-9a-f]{16}$/);
    // Outside every project: a card for every inbox, and a session of its own.
    const other = getCard(db, cardIdIn((await call(second, 'ask_owner', QUESTION)).text));
    expect(other?.hostId).toBeNull();
    expect(other?.sessionId).not.toBe(card?.sessionId);
    expect((await call(second, 'check_answer', { card: card?.id })).isError).toBe(true);
    expect((await call(first, 'check_answer', { card: card?.id })).isError).toBe(false);
  });

  it('the key itself reaches no card, a session cannot open another, and a new key ends the old one', async () => {
    const key = mintInteractiveKey(db);
    const keyed = transportFor(key);
    expect((await keyed('POST', '/control/ask/cards', QUESTION)).status).toBe(401);
    expect((await keyed('GET', '/control/ask/cards')).status).toBe(401);
    const opened = await keyed('POST', '/control/ask/session', { cwd: '/' });
    const capability = (opened.body as { capability: string }).capability;
    expect(
      (await transportFor(capability)('POST', '/control/ask/session', { cwd: '/' })).status,
    ).toBe(401);

    mintInteractiveKey(db);
    const stale = await call(interactive(key, '/'), 'ask_owner', QUESTION);
    expect(stale).toEqual({ text: NOT_SET_UP, isError: true });
  });
});

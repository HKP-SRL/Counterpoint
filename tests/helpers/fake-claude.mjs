#!/usr/bin/env node
// A stand-in for `claude -p --input-format stream-json --output-format stream-json`, for testing
// the streaming runner without a real session. It follows what spike 5.1 observed on claude
// 2.1.322: one `system/init` and one `result` per turn, usage on every assistant event, an
// `interrupt` control request answered at once and ending the turn with `error_during_execution`,
// and closing stdin letting the current turn finish before exit 0.
//
// A user message containing `SLOW` makes the turn wait 30 s (like a long tool call) unless it is
// interrupted; a message sent during it ends the turn (delivered mid-turn). `CHILD` starts a background `sleep 60` in the same process group and reports its
// pid. `ESCAPE` starts a node process in a group of its own that inherits the tag and holds this
// process's stdout (a dev server a builder started), and reports its pid. `HANG` ignores SIGTERM
// for the rest of the process. `SUBAGENT` interleaves a subagent's messages (`parent_tool_use_id`
// set, 3000 tokens of its own context) with the main thread's. Every turn reports the
// `CP_AGENT_RUN` tag it sees, its working folder, its arguments and a few variables.
import { spawn } from 'node:child_process';

// `claude auth status --json`, like claude 2.1.325: `loggedIn` with account fields beside it.
// FAKE_CLAUDE_LOGIN=out reports no login, =garbled prints something that is not JSON.
if (process.argv[2] === 'auth' && process.argv[3] === 'status') {
  const login = process.env.FAKE_CLAUDE_LOGIN ?? 'in';
  process.stdout.write(
    login === 'garbled'
      ? 'Logged in as someone\n'
      : `${JSON.stringify({ loggedIn: login === 'in', email: 'owner@example.com' })}\n`,
  );
  process.exit(login === 'out' ? 1 : 0);
}

let turn = 0;
let busy = null; // { abort(): void } while a turn waits
let inputEnded = false;
let buffer = '';

const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

function endTurn(subtype) {
  out({
    type: 'result',
    subtype,
    num_turns: 1,
    modelUsage: { 'fake-model': { contextWindow: 200000 } },
    result: subtype === 'success' ? `done ${turn}` : '',
  });
  busy = null;
  if (inputEnded) process.exit(0);
}

function startTurn(text) {
  turn += 1;
  out({ type: 'system', subtype: 'init', model: 'fake-model', permissionMode: 'auto' });
  out({
    type: 'system',
    subtype: 'fake_env',
    tag: process.env.CP_AGENT_RUN ?? null,
    cwd: process.cwd(),
    argv: process.argv.slice(2),
    ghToken: process.env.GH_TOKEN ?? null,
    scrub: process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB ?? null,
    counterpointHome: process.env.COUNTERPOINT_HOME ?? null,
  });
  const id = `msg_${turn}`;
  const usage = {
    input_tokens: 10,
    cache_read_input_tokens: 1000 * turn,
    cache_creation_input_tokens: 5,
  };
  out({
    type: 'assistant',
    message: { id, usage, content: [{ type: 'thinking' }] },
    parent_tool_use_id: null,
  });
  if (text.includes('SUBAGENT')) {
    const sub = { input_tokens: 0, cache_read_input_tokens: 2990, cache_creation_input_tokens: 10 };
    out({
      type: 'assistant',
      message: { id: `${id}_sub`, usage: sub, content: [{ type: 'text', text: 'fork' }] },
      parent_tool_use_id: 'toolu_fork',
    });
  }
  out({
    type: 'assistant',
    message: { id, usage, content: [{ type: 'text', text: text.slice(0, 40) }] },
    parent_tool_use_id: null,
  });
  if (text.includes('HANG')) process.on('SIGTERM', () => {});
  if (text.includes('ESCAPE')) {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      detached: true,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.unref();
    out({ type: 'system', subtype: 'fake_escaped', pid: child.pid });
  }
  if (text.includes('CHILD')) {
    const child = spawn('sleep', ['60'], { stdio: 'ignore' });
    out({ type: 'system', subtype: 'fake_child', pid: child.pid });
  }
  if (text.includes('SLOW')) {
    const timer = setTimeout(() => endTurn('success'), 30_000);
    busy = {
      abort() {
        clearTimeout(timer);
        endTurn('error_during_execution');
      },
      deliver(message) {
        clearTimeout(timer);
        out({ type: 'system', subtype: 'fake_delivered', text: message.slice(0, 80) });
        endTurn('success');
      },
    };
    return;
  }
  endTurn('success');
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let at = buffer.indexOf('\n');
  while (at >= 0) {
    const line = buffer.slice(0, at);
    buffer = buffer.slice(at + 1);
    at = buffer.indexOf('\n');
    if (line.trim() === '') continue;
    const message = JSON.parse(line);
    if (message.type === 'control_request' && message.request?.subtype === 'interrupt') {
      out({
        type: 'control_response',
        response: { subtype: 'success', request_id: message.request_id },
      });
      busy?.abort();
    } else if (message.type === 'user') {
      const text = String(message.message?.content ?? '');
      // Like claude 2.1.322 (spike 5.1): a message sent mid-turn lands in the same turn.
      if (busy !== null) busy.deliver(text);
      else startTurn(text);
    }
  }
});
process.stdin.on('end', () => {
  inputEnded = true;
  if (busy === null) process.exit(0);
});

#!/usr/bin/env node
// A stand-in for `claude -p --input-format stream-json --output-format stream-json`, for testing
// the streaming runner without a real session. It follows what spike 5.1 observed on claude
// 2.1.322: one `system/init` and one `result` per turn, usage on every assistant event, an
// `interrupt` control request answered at once and ending the turn with `error_during_execution`,
// and closing stdin letting the current turn finish before exit 0.
//
// A user message containing `SLOW` makes the turn wait 30 s (like a long tool call) unless it is
// interrupted. `CHILD` starts a background `sleep 60` in the same process group and reports its
// pid. `HANG` ignores SIGTERM for the rest of the process. Every turn reports the
// `CP_AGENT_RUN` tag it sees.
import { spawn } from 'node:child_process';

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
  out({ type: 'system', subtype: 'fake_env', tag: process.env.CP_AGENT_RUN ?? null });
  const id = `msg_${turn}`;
  const usage = {
    input_tokens: 10,
    cache_read_input_tokens: 1000 * turn,
    cache_creation_input_tokens: 5,
  };
  out({ type: 'assistant', message: { id, usage, content: [{ type: 'thinking' }] } });
  out({
    type: 'assistant',
    message: { id, usage, content: [{ type: 'text', text: text.slice(0, 40) }] },
  });
  if (text.includes('HANG')) process.on('SIGTERM', () => {});
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
      startTurn(String(message.message?.content ?? ''));
    }
  }
});
process.stdin.on('end', () => {
  inputEnded = true;
  if (busy === null) process.exit(0);
});

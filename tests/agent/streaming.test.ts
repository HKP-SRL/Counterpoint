import { chmodSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildClaudeArgv } from '../../src/agent/claude-argv.ts';
import {
  AGENT_TAG_ENV,
  type AgentSession,
  ClaudeCliRunner,
  type KnownStreamEvent,
  parseStreamJson,
  type StreamEvent,
} from '../../src/agent/runner.ts';
import { assistantFill, ContextMeter, initModel, resultWindows } from '../../src/agent/usage.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = resolve(HERE, '..', 'helpers', 'fake-claude.mjs');
const FIXTURES = resolve(HERE, '..', 'fixtures', 'stream-json');
chmodSync(FAKE, 0o755);

afterAll(() => {
  removeScratchDirs();
});

function fixture(name: string): StreamEvent[] {
  return parseStreamJson(readFileSync(join(FIXTURES, name), 'utf8'));
}

describe('context meter on real streams (claude 2.1.322)', () => {
  it('counts each message id once and follows the latest fill', () => {
    const meter = new ContextMeter();
    const fills: number[] = [];
    for (const event of fixture('streaming-interrupt.jsonl')) {
      const fill = meter.observe(event);
      if (fill !== null) fills.push(fill);
    }
    // Two messages, each printed twice (thinking, then tool use or text).
    expect(fills).toHaveLength(2);
    expect(meter.latest).toBe(fills[1]);
    expect(meter.peak).toBe(Math.max(...fills));
    expect(meter.latest).toBeGreaterThan(20_000);
  });

  it('reads the window from every turn result, never from init', () => {
    const events = fixture('streaming-interrupt.jsonl');
    const results = events.filter((event) => event.type === 'result');
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(resultWindows(result).get('claude-haiku-5-5')).toBe(1_000_000);
    }
    const init = events.find((event) => initModel(event) !== null);
    expect(init && initModel(init)).toBe('claude-haiku-5-5');
    expect(init && resultWindows(init).size).toBe(0);
  });

  // Seen live (run 20261113-1030, session 14): a fork peaked at 459k while the main thread peaked
  // at 410k, and the wrap-up fired on the fork's value.
  it("counts only the main thread's messages, never a subagent's", () => {
    const main = (id: string, tokens: number): StreamEvent => ({
      type: 'assistant',
      message: { id, usage: { input_tokens: tokens } },
      parent_tool_use_id: null,
    });
    const sub = (id: string, tokens: number): StreamEvent => ({
      type: 'assistant',
      message: { id, usage: { input_tokens: tokens } },
      parent_tool_use_id: 'toolu_fork',
    });
    const meter = new ContextMeter();
    const fills = [
      main('m1', 300_000),
      sub('s1', 459_316),
      main('m2', 409_618),
      sub('s2', 120_000),
      main('m2', 409_618),
    ].map((event) => meter.observe(event));
    expect(fills).toEqual([300_000, null, 409_618, null, null]);
    expect(meter.latest).toBe(409_618);
    expect(meter.peak).toBe(409_618);
    expect(assistantFill(sub('s3', 1))).toBeNull();
  });

  it('ignores malformed usage', () => {
    expect(assistantFill({ type: 'assistant', message: { id: 'x' } })).toBeNull();
    expect(
      assistantFill({
        type: 'assistant',
        message: { id: 'x', usage: { input_tokens: -5, cache_read_input_tokens: 'a' } },
      }),
    ).toEqual({ id: 'x', tokens: 0 });
    expect(resultWindows({ type: 'result', modelUsage: { m: { contextWindow: 1.5 } } }).size).toBe(
      0,
    );
  });
});

describe('buildClaudeArgv', () => {
  const base = { model: 'haiku', maxTurns: 5, maxBudgetUsd: 1 };

  it('launches a plain headless session as the owner: no profile, auto mode, prompts denied', () => {
    expect(buildClaudeArgv({ ...base, effort: 'high', streamInput: true })).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
      '--model',
      'haiku',
      '--effort',
      'high',
      '--max-turns',
      '5',
      '--max-budget-usd',
      '1',
      '--setting-sources',
      'user,project',
      '--strict-mcp-config',
      '--permission-mode',
      'auto',
      '--permission-prompts',
      'none',
    ]);
  });

  it('adds a tool list only when one is given', () => {
    expect(buildClaudeArgv({ ...base, prompt: 'hi', allowedTools: ['Read'] }).slice(-2)).toEqual([
      '--allowedTools',
      'Read',
    ]);
  });

  it('reads input from stdin and takes no prompt argument', () => {
    const argv = buildClaudeArgv({ ...base, streamInput: true });
    expect(argv.slice(0, 3)).toEqual(['-p', '--input-format', 'stream-json']);
  });

  it('refuses a prompt argument on a streaming session', () => {
    expect(() => buildClaudeArgv({ ...base, streamInput: true, prompt: 'hi' })).toThrow(/stdin/);
  });

  it('still needs a prompt without streaming input', () => {
    expect(() => buildClaudeArgv(base)).toThrow(/prompt/);
  });
});

describe('sign-in check (fake claude)', () => {
  const runnerWith = (login: string) =>
    new ClaudeCliRunner({ binary: FAKE, env: { ...process.env, FAKE_CLAUDE_LOGIN: login } });

  it("reads claude's own login state, and says it cannot tell when the answer is not JSON", async () => {
    expect(await runnerWith('in').signedIn()).toBe(true);
    expect(await runnerWith('out').signedIn()).toBe(false);
    expect(await runnerWith('garbled').signedIn()).toBeNull();
    expect(await new ClaudeCliRunner({ binary: '/nonexistent/claude' }).signedIn()).toBeNull();
  });
});

describe('streaming session (fake claude)', () => {
  const runner = new ClaudeCliRunner({ binary: FAKE });

  async function start(
    tag = 'tag-0123456789',
  ): Promise<{ session: AgentSession; events: KnownStreamEvent[] }> {
    const dir = makeScratchDir('cp-stream');
    const events: KnownStreamEvent[] = [];
    const session = await runner.start({
      argv: [],
      cwd: dir,
      timeoutMs: 20_000,
      rawLogPath: join(dir, 'logs', 'raw.jsonl'),
      processTag: tag,
      onEvent: (event) => events.push(event as KnownStreamEvent),
    });
    return { session, events };
  }

  function waitFor(events: KnownStreamEvent[], test: (e: KnownStreamEvent) => boolean) {
    return expect.poll(() => events.some(test), { timeout: 5000 }).toBe(true);
  }

  it('delivers events live, tags the process and ends when input closes', async () => {
    const { session, events } = await start();
    session.send('first');
    await waitFor(events, (e) => e.type === 'result');
    session.send('second');
    await waitFor(events, (e) => e.type === 'result' && e.result === 'done 2');
    session.endInput();
    const end = await session.done;
    expect(end).toMatchObject({ exitCode: 0, killed: false, timedOut: false });
    expect(end.result?.type).toBe('result');
    expect(events.find((e) => e.subtype === 'fake_env')?.tag).toBe('tag-0123456789');
    expect(AGENT_TAG_ENV).toBe('CP_AGENT_RUN');
    expect(() => session.send('late')).toThrow(/no longer takes input/);
  });

  it('writes the raw stream to the log as it arrives', async () => {
    const dir = makeScratchDir('cp-stream');
    const log = join(dir, 'raw.jsonl');
    const session = await runner.start({
      argv: [],
      cwd: dir,
      timeoutMs: 20_000,
      rawLogPath: log,
      processTag: 'tag-logcheck01',
    });
    session.send('one');
    session.endInput();
    await session.done;
    const logged = parseStreamJson(readFileSync(log, 'utf8'));
    expect(logged.some((e) => e.type === 'result')).toBe(true);
  });

  it('interrupts a running turn and keeps the session usable', async () => {
    const { session, events } = await start();
    session.send('SLOW work');
    await waitFor(events, (e) => e.type === 'assistant');
    expect(await session.interrupt()).toBe(true);
    await waitFor(events, (e) => e.subtype === 'error_during_execution');
    session.send('after');
    await waitFor(events, (e) => e.type === 'result' && e.subtype === 'success');
    session.endInput();
    expect((await session.done).exitCode).toBe(0);
  });

  it('lets the current turn finish when input closes mid-turn', async () => {
    const { session, events } = await start();
    session.send('SLOW work');
    await waitFor(events, (e) => e.type === 'assistant');
    session.endInput();
    // The fake's slow turn lasts 30 s; nothing ends it but the kill below.
    await new Promise((r) => setTimeout(r, 300));
    expect(events.some((e) => e.type === 'result')).toBe(false);
    session.kill(200);
    const end = await session.done;
    expect(end.killed).toBe(true);
  });

  it('kills the whole process group, children included', async () => {
    const { session, events } = await start();
    session.send('CHILD SLOW');
    await waitFor(events, (e) => e.subtype === 'fake_child');
    const childPid = events.find((e) => e.subtype === 'fake_child')?.pid as number;
    expect(() => process.kill(childPid, 0)).not.toThrow();
    session.kill(200);
    await session.done;
    await expect
      .poll(
        () => {
          try {
            process.kill(childPid, 0);
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 5000 },
      )
      .toBe(false);
  });

  it('escalates to SIGKILL when SIGTERM is ignored', async () => {
    const { session, events } = await start();
    session.send('HANG SLOW');
    await waitFor(events, (e) => e.type === 'assistant');
    session.kill(300);
    const end = await session.done;
    expect(end.signal).toBe('SIGKILL');
  });

  it('kills the session at its timeout', async () => {
    const dir = makeScratchDir('cp-stream');
    const session = await runner.start({
      argv: [],
      cwd: dir,
      timeoutMs: 500,
      rawLogPath: join(dir, 'raw.jsonl'),
      processTag: 'tag-timeout001',
    });
    session.send('SLOW');
    const end = await session.done;
    expect(end).toMatchObject({ timedOut: true, killed: true });
  });

  it('refuses a malformed process tag', async () => {
    await expect(
      runner.start({
        argv: [],
        cwd: '/',
        timeoutMs: 1000,
        rawLogPath: '/dev/null',
        processTag: 'bad tag;rm',
      }),
    ).rejects.toThrow(/tag/);
  });
});

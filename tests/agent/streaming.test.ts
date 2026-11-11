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

describe('buildClaudeArgv with streaming input', () => {
  const base = {
    settings: { permissions: { deny: [] }, sandbox: {} } as never,
    model: 'haiku',
    maxTurns: 5,
    maxBudgetUsd: 1,
    allowedTools: ['Bash'],
  };

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

describe('streaming session (fake claude)', () => {
  const runner = new ClaudeCliRunner({ binary: FAKE });

  function start(tag = 'tag-0123456789'): { session: AgentSession; events: KnownStreamEvent[] } {
    const dir = makeScratchDir('cp-stream');
    const events: KnownStreamEvent[] = [];
    const session = runner.start({
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
    const { session, events } = start();
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
    const session = runner.start({
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
    const { session, events } = start();
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
    const { session, events } = start();
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
    const { session, events } = start();
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
    const { session, events } = start();
    session.send('HANG SLOW');
    await waitFor(events, (e) => e.type === 'assistant');
    session.kill(300);
    const end = await session.done;
    expect(end.signal).toBe('SIGKILL');
  });

  it('kills the session at its timeout', async () => {
    const dir = makeScratchDir('cp-stream');
    const session = runner.start({
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

  it('refuses a malformed process tag', () => {
    expect(() =>
      runner.start({
        argv: [],
        cwd: '/',
        timeoutMs: 1000,
        rawLogPath: '/dev/null',
        processTag: 'bad tag;rm',
      }),
    ).toThrow(/tag/);
  });
});

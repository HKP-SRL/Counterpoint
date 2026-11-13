// Live check of the streaming runner on the owner's real `claude`, launched as builders are.
// Gated by COUNTERPOINT_LIVE=1 (signed-in claude, a few cents of haiku).
//
// It answers: does a session started through `runner.start` deliver usage live, take a message
// mid-turn, answer an interrupt, and do its Bash commands inherit the `CP_AGENT_RUN` tag that
// crash recovery sweeps for?
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildClaudeArgv } from '../../src/agent/claude-argv.ts';
import { ClaudeCliRunner, type KnownStreamEvent } from '../../src/agent/runner.ts';
import { ContextMeter, resultWindows } from '../../src/agent/usage.ts';
import { initScratchRepo, makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

const LIVE = process.env.COUNTERPOINT_LIVE === '1';

afterAll(() => {
  if (LIVE) removeScratchDirs();
});

describe.skipIf(!LIVE)('streaming session (live claude)', () => {
  it('streams usage, takes a mid-turn message, interrupts, and tags Bash', async () => {
    const root = makeScratchDir('cp-live-stream');
    const workdir = join(root, 'work');
    mkdirSync(workdir);
    await initScratchRepo(workdir);
    const argv = buildClaudeArgv({
      model: 'haiku',
      maxTurns: 20,
      maxBudgetUsd: 0.5,
      streamInput: true,
    });

    const events: KnownStreamEvent[] = [];
    const meter = new ContextMeter();
    let fillsSeenBeforeFirstResult = 0;
    let sawResult = false;
    const runner = new ClaudeCliRunner();
    if (runner.start === undefined) throw new Error('The CLI runner streams.');
    const tag = `live-${Date.now()}`;
    const session = await runner.start({
      argv,
      cwd: workdir,
      timeoutMs: 180_000,
      rawLogPath: join(root, 'raw.jsonl'),
      processTag: tag,
      onEvent: (event) => {
        events.push(event as KnownStreamEvent);
        if (meter.observe(event) !== null && !sawResult) fillsSeenBeforeFirstResult += 1;
        if (event.type === 'result') sawResult = true;
      },
    });

    session.send(
      'Run exactly this Bash command: `printf "%s" "$CP_AGENT_RUN" > tag.txt; sleep 3`. Then run `sleep 3` four more times, one call at a time. Then reply DONE.',
    );
    // Mid-turn: once the first tool call is out, tell it to stop.
    await expect
      .poll(() => events.some((e) => JSON.stringify(e).includes('"tool_use"')), { timeout: 60_000 })
      .toBe(true);
    session.send('Stop now. Run no more commands. Reply with the single word WRAPPED.');
    await expect.poll(() => sawResult, { timeout: 90_000 }).toBe(true);
    const first = events.find((e) => e.type === 'result');
    expect(String(first?.result ?? '')).toContain('WRAPPED');
    expect(fillsSeenBeforeFirstResult).toBeGreaterThan(0);
    expect(first && resultWindows(first).size).toBeGreaterThan(0);

    // Interrupt a second, slow turn.
    const before = events.length;
    session.send('Run the Bash command `sleep 20`, then reply LATE.');
    await expect
      .poll(() => events.slice(before).some((e) => JSON.stringify(e).includes('"tool_use"')), {
        timeout: 60_000,
      })
      .toBe(true);
    expect(await session.interrupt()).toBe(true);
    await expect
      .poll(() => events.slice(before).some((e) => e.type === 'result'), { timeout: 30_000 })
      .toBe(true);
    session.endInput();
    const end = await session.done;
    // Evidence first, kept outside the scratch dirs.
    const evidence = join(process.cwd(), '.tmp', 'live-stream');
    mkdirSync(evidence, { recursive: true });
    copyFileSync(join(root, 'raw.jsonl'), join(evidence, 'raw.jsonl'));
    writeFileSync(
      join(evidence, 'end.json'),
      JSON.stringify({ ...end, result: undefined }, null, 2),
    );
    // The last turn was the interrupted one: claude exits 1 when its final turn ended in
    // `error_during_execution` (0 when a successful turn followed the interrupt, spike 5.1).
    expect((end.result as KnownStreamEvent | null)?.subtype).toBe('error_during_execution');
    expect(end.exitCode).toBe(1);

    const { readFileSync } = await import('node:fs');
    const seen = readFileSync(join(workdir, 'tag.txt'), 'utf8');
    writeFileSync(join(root, 'tag-seen.txt'), seen);
    expect(seen).toBe(tag);
  }, 300_000);
});

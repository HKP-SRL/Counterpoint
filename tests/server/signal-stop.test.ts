// The daemon on SIGTERM / SIGINT (daemon-lifecycle: Stop on a signal): the run's clean point and
// report first, within a time limit; then the run's live processes are ended; then it exits.
import { spawn } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { AGENT_TAG_ENV } from '../../src/agent/runner.ts';
import { GATE_TAG_ENV } from '../../src/build/gate-runner.ts';
import { endLiveProcesses } from '../../src/build/live-processes.ts';
import { openStore, upsertHost } from '../../src/core/store/db.ts';
import { insertGateResult, insertRun, insertRunChange } from '../../src/core/store/runs.ts';
import { insertAgentSession, setAgentSessionPid } from '../../src/core/store/sessions.ts';
import { stopForSignal } from '../../src/server/signal-stop.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

afterAll(() => {
  removeScratchDirs();
});

/** A run that reaches its end after the owner's stop, after its processes are ended, or never. */
function fakeRun(endsAfter: 'stop' | 'end-processes' | 'never' | 'no-run') {
  const calls: string[] = [];
  const logged: string[] = [];
  let running = endsAfter !== 'no-run';
  let finish: () => void = () => {};
  const idle = new Promise<void>((resolve) => {
    finish = () => {
      running = false;
      resolve();
    };
  });
  return {
    calls,
    logged,
    input: {
      orchestrator: {
        running: () => (running ? { runId: 'run-1', hostId: 'cena' } : null),
        stop: () => {
          calls.push('stop the run');
          if (endsAfter === 'stop') setTimeout(finish, 10);
          return true;
        },
        idle: () => (running ? idle : Promise.resolve()),
      },
      endProcesses: async () => {
        calls.push('end its processes');
        if (endsAfter === 'end-processes') setTimeout(finish, 10);
        return 2;
      },
      stop: async (reason: string) => {
        calls.push(`exit (${reason})`);
      },
      log: (event: string) => logged.push(event),
      cleanPointMs: 100,
      wrapUpMs: 100,
    },
  };
}

describe('stopping on a signal', () => {
  it('stops the run at its clean point, then exits', async () => {
    const run = fakeRun('stop');
    await stopForSignal({ signal: 'SIGTERM', ...run.input });
    expect(run.calls).toEqual(['stop the run', 'exit (SIGTERM)']);
  });

  it("ends the run's processes when the clean point does not come in time", async () => {
    const run = fakeRun('end-processes');
    await stopForSignal({ signal: 'SIGTERM', ...run.input });
    expect(run.calls).toEqual(['stop the run', 'end its processes', 'exit (SIGTERM)']);
    expect(run.logged).not.toContain('run-left-for-recovery');
  });

  it('exits within the limit even when the run never ends; recovery finishes it', async () => {
    const run = fakeRun('never');
    const started = Date.now();
    await stopForSignal({ signal: 'SIGINT', ...run.input });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(run.calls).toEqual(['stop the run', 'end its processes', 'exit (SIGINT)']);
    expect(run.logged).toContain('run-left-for-recovery');
  });

  it('exits at once when no run is going', async () => {
    const run = fakeRun('no-run');
    await stopForSignal({ signal: 'SIGTERM', ...run.input });
    expect(run.calls).toEqual(['exit (SIGTERM)']);
  });
});

describe("ending the run's live processes", () => {
  it('sweeps every open session and gate by its tag and kills a tagged group leader', async () => {
    const home = makeScratchDir('cp-signal');
    const db = openStore(home);
    upsertHost(db, {
      id: 'cena',
      root: '/x',
      gitCommonDir: '/x/.git',
      baseBranch: 'master',
      adapter: 'openspec',
    });
    insertRun(db, { id: 'run-1', hostId: 'cena', settings: {}, stopAt: null });
    const runChangeId = insertRunChange(db, { runId: 'run-1', change: 'qr-menu', position: 0 });
    const leader = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      detached: true,
      stdio: 'ignore',
    });
    const exited = new Promise((resolve) => leader.once('exit', resolve));
    const sessionId = insertAgentSession(db, {
      hostId: 'cena',
      runChangeId,
      kind: 'builder',
      number: 1,
      model: 'opus',
      claudeVersion: '2.1.330',
      processTag: 'a'.repeat(32),
      rawLogPath: '/dev/null',
    });
    setAgentSessionPid(db, sessionId, leader.pid as number);
    insertGateResult(db, {
      runChangeId,
      attempt: 1,
      gate: 'unit',
      processTag: 'b'.repeat(32),
      logPath: '/dev/null',
    });
    const swept: string[] = [];
    const found = await endLiveProcesses(db, async (name, tag) => {
      swept.push(`${name}=${tag}`);
      return name === AGENT_TAG_ENV
        ? { found: [{ pid: leader.pid as number, command: 'claude' }], error: null }
        : { found: [], error: null };
    });
    expect(found).toBe(1);
    expect(swept).toEqual([
      `${AGENT_TAG_ENV}=${'a'.repeat(32)}`,
      `${GATE_TAG_ENV}=${'b'.repeat(32)}`,
    ]);
    await expect(exited).resolves.not.toBeUndefined();
  });
});

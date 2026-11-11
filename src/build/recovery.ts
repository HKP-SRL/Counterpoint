// Crash and reboot recovery at daemon start (build-runs: Crash and reboot recovery).
//
// A run the daemon did not end (killed, crashed, the machine rebooted) is reconciled before
// anything else starts:
// 1. every agent session and gate the store has no end for is ended: the owner's processes are
//    swept for its tag (`CP_AGENT_RUN` / `CP_GATE_RUN`), and only a process that carries the tag is
//    signalled. A stored pid alone is never signalled: after a reboot it may belong to anything;
// 2. a change cut off mid-build gets its worktree's changes committed as
//    `cp: <change> session <n> (interrupted)`, with a handoff Counterpoint writes when the session
//    left none, so the next session continues from there;
// 3. the run is returned for the orchestrator to resume (or end, when its stop time has passed).
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_TAG_ENV, killGroup } from '../agent/runner.ts';
import { findChange } from '../core/framework/port.ts';
import { runGit } from '../core/git/run.ts';
import { hostDir } from '../core/host/home.ts';
import type { Store } from '../core/store/db.ts';
import {
  activeRun,
  builderSessionCount,
  finishGateResult,
  listRunChanges,
  openGateResults,
  runChangeTicks,
  updateRunChange,
} from '../core/store/runs.ts';
import { endAgentSession, openAgentSessions } from '../core/store/sessions.ts';
import { generatedHandoff } from './builder-session.ts';
import { GATE_TAG_ENV } from './gate-runner.ts';
import type { RunHost } from './orchestrator.ts';
import { sweepTagged } from './process-sweep.ts';
import { commitSession } from './session-commit.ts';

export interface RecoveryReport {
  /** The run to resume, or null. */
  runId: string | null;
  sessionsEnded: number;
  gatesEnded: number;
  processesEnded: number;
  committed: string[];
}

/** Ends whatever still carries `tag`; returns how many processes it found. */
async function endTagged(
  name: string,
  tag: string,
  pid: number | null,
  sweep: typeof sweepTagged,
): Promise<number> {
  const swept = await sweep(name, tag, { graceMs: 1000 });
  // The group leader goes with its group, but only when it carried our tag.
  if (pid !== null && swept.found.some((p) => p.pid === pid)) killGroup(pid, 'SIGKILL');
  return swept.found.length;
}

export async function recoverRuns(input: {
  home: string;
  db: Store;
  host: (hostId: string) => RunHost | null;
  log?: (event: string, fields?: Record<string, unknown>) => void;
  /** For tests. */
  sweep?: typeof sweepTagged;
  commit?: typeof commitSession;
}): Promise<RecoveryReport> {
  const { db } = input;
  const sweep = input.sweep ?? sweepTagged;
  const report: RecoveryReport = {
    runId: null,
    sessionsEnded: 0,
    gatesEnded: 0,
    processesEnded: 0,
    committed: [],
  };

  for (const session of openAgentSessions(db)) {
    report.processesEnded += await endTagged(AGENT_TAG_ENV, session.processTag, session.pid, sweep);
    endAgentSession(db, session.id, {
      reason: 'interrupted',
      peakContextTokens: session.peakContextTokens,
    });
    report.sessionsEnded += 1;
  }
  for (const gate of openGateResults(db)) {
    report.processesEnded += await endTagged(GATE_TAG_ENV, gate.processTag, gate.pid, sweep);
    finishGateResult(db, gate.id, {
      verdict: 'fail',
      reason: 'stopped',
      exitCode: null,
      signal: null,
      tail: 'Interrupted: Counterpoint stopped while this gate ran.',
      survivors: [],
      durationMs: 0,
    });
    report.gatesEnded += 1;
  }

  const run = activeRun(db);
  if (run === undefined) return report;
  report.runId = run.id;
  const runtime = input.host(run.hostId);
  for (const change of listRunChanges(db, run.id)) {
    if (change.state !== 'building' || change.worktree === null || change.baseCommit === null)
      continue;
    if (runtime === null || runtime.adapter === null || !existsSync(change.worktree)) continue;
    try {
      const snapshot = await runtime.adapter.snapshot(runtime.reader, change.baseCommit);
      const facts = findChange(snapshot.changes, change.change);
      if (facts === undefined || facts === null) continue;
      const number = builderSessionCount(db, change.id);
      const changeDir = join(hostDir(input.home, run.hostId), 'runs', run.id, change.change);
      const committed = await (input.commit ?? commitSession)({
        worktree: change.worktree,
        change: facts,
        adapter: runtime.adapter,
        changeDir,
        session: Math.max(1, number),
        interrupted: true,
      });
      if (committed.ticked.length > 0)
        updateRunChange(db, change.id, { taskTicks: committed.ticked });
      let handoffPath = committed.handoff?.path ?? null;
      if (handoffPath === null && number > 0) {
        const files =
          committed.commit === null
            ? []
            : (
                await runGit(change.worktree, [
                  'diff-tree',
                  '--no-commit-id',
                  '--name-only',
                  '-r',
                  '-z',
                  committed.commit,
                ])
              ).stdout
                .split('\0')
                .filter((path) => path !== '');
        handoffPath = join(changeDir, `session-${number}-handoff.md`);
        writeFileSync(
          handoffPath,
          generatedHandoff({
            session: number,
            reason: 'Counterpoint stopped (a crash or a restart) while it ran',
            changedFiles: files,
            ticked: runChangeTicks(db, change.id),
          }),
          { mode: 0o600 },
        );
      }
      if (handoffPath !== null) updateRunChange(db, change.id, { handoffPath });
      if (committed.commit !== null) report.committed.push(change.change);
    } catch (error) {
      input.log?.('recovery-commit-failed', {
        change: change.change,
        message: (error as Error).message,
      });
    }
  }
  input.log?.('recovered', { ...report });
  return report;
}

// Ending the build lane's live processes while the daemon still runs (a signal's time limit ran
// out before the run reached its clean point; server/signal-stop.ts).
//
// Every agent session and gate the store has no end for is ended the way crash recovery ends them
// (recovery.ts): the owner's processes are swept for its tag, and its process group is killed only
// when its leader carried the tag. The rows are left open: the run's own code records each end
// as its session or gate returns, and recovery at the next start ends any it did not.
import { AGENT_TAG_ENV, killGroup } from '../agent/runner.ts';
import type { Store } from '../core/store/db.ts';
import { openGateResults } from '../core/store/runs.ts';
import { openAgentSessions } from '../core/store/sessions.ts';
import { GATE_TAG_ENV } from './gate-runner.ts';
import { sweepTagged } from './process-sweep.ts';

/** Ends every open session's and gate's processes; returns how many processes it found. */
export async function endLiveProcesses(
  db: Store,
  sweep: typeof sweepTagged = sweepTagged,
): Promise<number> {
  const live = [
    ...openAgentSessions(db).map((s) => ({ name: AGENT_TAG_ENV, tag: s.processTag, pid: s.pid })),
    ...openGateResults(db).map((g) => ({ name: GATE_TAG_ENV, tag: g.processTag, pid: g.pid })),
  ];
  let found = 0;
  for (const { name, tag, pid } of live) {
    if (tag === '') continue;
    const swept = await sweep(name, tag, { graceMs: 1000 });
    if (pid !== null && swept.found.some((p) => p.pid === pid)) killGroup(pid, 'SIGKILL');
    found += swept.found.length;
  }
  return found;
}

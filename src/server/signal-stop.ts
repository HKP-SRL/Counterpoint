// Stopping the daemon on SIGTERM or SIGINT (daemon-lifecycle: Stop on a signal).
//
// `counterpoint stop` falls back to SIGTERM when the control channel does not answer, and the
// system sends it at logout or shutdown. A signal takes the same path as the owner's stop: the run
// stops at its next clean point (its work committed, the run ended and its report written), then
// the daemon exits. A signal cannot wait as long as the owner's stop does, so it has a time limit:
// past it, the run's live sessions and gates are ended (their work is still committed as they
// return), the run gets a short while more to record its end, and the daemon exits regardless. A
// run that still did not end is resumed or ended by crash recovery at the next start.
import type { Orchestrator } from '../build/orchestrator.ts';

/** How long a signal waits for the run's clean point before ending its processes. */
export const SIGNAL_CLEAN_POINT_MS = 20_000;
/** After that, how long the run gets to record its end and write its report. */
export const SIGNAL_WRAP_UP_MS = 10_000;

/** True when `promise` settles within `ms`. */
function within(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    const done = () => {
      clearTimeout(timer);
      resolve(true);
    };
    promise.then(done, done);
  });
}

export async function stopForSignal(input: {
  signal: NodeJS.Signals;
  orchestrator: Pick<Orchestrator, 'running' | 'stop' | 'idle'>;
  /** Ends the run's live sessions and gates (build/live-processes.ts). */
  endProcesses: () => Promise<number>;
  /** The daemon's own stop: closes everything and exits. */
  stop: (reason: string) => Promise<void>;
  log?: (event: string, fields?: Record<string, unknown>) => void;
  cleanPointMs?: number;
  wrapUpMs?: number;
}): Promise<void> {
  if (input.orchestrator.running() !== null) {
    input.log?.('stopping-run-first', { reason: input.signal });
    input.orchestrator.stop();
    const clean = await within(
      input.orchestrator.idle(),
      input.cleanPointMs ?? SIGNAL_CLEAN_POINT_MS,
    );
    if (!clean) {
      const ended = await input.endProcesses().catch(() => 0);
      input.log?.('run-processes-ended', { reason: input.signal, processes: ended });
      const recorded = await within(input.orchestrator.idle(), input.wrapUpMs ?? SIGNAL_WRAP_UP_MS);
      if (!recorded) input.log?.('run-left-for-recovery', { reason: input.signal });
    }
  }
  await input.stop(input.signal);
}

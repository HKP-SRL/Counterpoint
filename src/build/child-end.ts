// When a child process counts as ended (gates: Exit code is the only verdict; first-unattended-run
// design 3.3).
//
// Node fires `close` only once every holder of the child's stdout and stderr has let go. A
// descendant that left the process group (a detached dev server, a database the command started)
// inherits those pipes and keeps them open after the command exits, and the group kill does not
// reach it. Waiting for `close` alone then waits forever, and a Stop can never free the run.
//
// So a child counts as ended at its `exit`: the pipes get a short drain time to deliver what is
// already in them, and are then cut. The caller kills what is left of the group and sweeps the
// tag; cutting the pipes means nothing that escaped can keep the caller reading.
import type { ChildProcess } from 'node:child_process';

/** How long the pipes may stay open after the command exits before they are cut. */
export const DEFAULT_DRAIN_MS = 2000;

export interface ChildEnd {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  /** False when something still held the pipes after the drain time (or the end was forced). */
  drained: boolean;
}

export interface ChildEndWatch {
  ended: Promise<ChildEnd>;
  /**
   * Ends the wait now with what is known, cutting the pipes: for a process that cannot be made to
   * exit (or never started), so the caller is never stuck.
   */
  giveUp(): void;
}

export function watchChildEnd(child: ChildProcess, drainMs = DEFAULT_DRAIN_MS): ChildEndWatch {
  let exit: { exitCode: number | null; signal: NodeJS.Signals | null } | null = null;
  let drainTimer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;
  let resolveEnded: (end: ChildEnd) => void = () => {};
  const ended = new Promise<ChildEnd>((resolve) => {
    resolveEnded = resolve;
  });
  const settle = (drained: boolean) => {
    if (settled) return;
    settled = true;
    if (drainTimer !== null) clearTimeout(drainTimer);
    if (!drained) {
      // Whatever still holds the pipes keeps its end; ours is closed, so nothing more is read.
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.stdin?.destroy();
    }
    resolveEnded({ exitCode: exit?.exitCode ?? null, signal: exit?.signal ?? null, drained });
  };
  child.once('exit', (exitCode, signal) => {
    exit = { exitCode, signal };
    drainTimer = setTimeout(() => settle(false), drainMs);
  });
  child.once('close', (exitCode, signal) => {
    exit ??= { exitCode, signal };
    settle(true);
  });
  return { ended, giveUp: () => settle(false) };
}

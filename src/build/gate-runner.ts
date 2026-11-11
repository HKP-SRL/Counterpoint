// One gate command, run under the gate sandbox and judged by its exit code only (gates: Exit code
// is the only verdict; Gate output kept; Zero-test guard).
//
// The command comes from the host config read at the approved base, never from the worktree. It
// runs builder-written code, so:
// - under `srt` with the gate profile (build/gate-sandbox.ts): writes only the worktree and the
//   gate's own temp dir, reads nothing protected, reaches only the loopback ports the gate lists;
// - with a reduced environment: an allow-list from the daemon's own, `CI=1`, no colors, and the
//   gate's tag `CP_GATE_RUN=<id>`, plus the service environment and the test-lock marker the caller
//   passes. No token or socket of the owner's crosses;
// - detached, in its own process group, with no stdin. On timeout or stop the whole group gets
//   SIGTERM, then SIGKILL after a grace period; when the command ends, anything left in its group
//   is killed, and the owner's processes are swept for its tag (process-sweep.ts). What the sweep
//   found is recorded with the result.
// Output (stdout and stderr together) streams to the gate's log file as it arrives; the last lines,
// stripped of terminal sequences, are kept with the result.
//
// The verdict: exit code 0 is the only pass, and with a test-count pattern the last count printed
// must be above zero. Every other ending fails with its own reason: `spawn`, `stopped`, `timeout`,
// `signal` (srt or the command died from a signal; the wrapper reports a command's signal as
// 128+n), `exit-code`, `no-test-count` or `zero-tests`.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { dirname, join } from 'node:path';
import { killGroup } from '../agent/runner.ts';
import type { GateConfig } from '../core/host/host-config.ts';
import type { ProtectedPaths } from '../core/security/sandbox-settings.ts';
import type { GateEnd, GateFailReason, GateSurvivor } from '../core/store/runs.ts';
import { buildGateSandboxSettings, gateArgv } from './gate-sandbox.ts';
import { sweepTagged } from './process-sweep.ts';

export const GATE_TAG_ENV = 'CP_GATE_RUN';
/** Parent variables a gate may inherit. Nothing else crosses. */
export const GATE_ENV_ALLOW = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'SHELL',
] as const;
const TAIL_LINES = 60;
const KEEP_BYTES = 256 * 1024;
const DEFAULT_KILL_GRACE_MS = 5000;

export interface GateRunInput {
  gate: GateConfig;
  worktree: string;
  /** A private folder for this gate run, outside the worktree: the profile and the temp dir. */
  scratchDir: string;
  logPath: string;
  protectedPaths: Omit<ProtectedPaths, 'workdir'>;
  consolePort: number;
  /** Service environment and the test-lock marker. */
  env?: Readonly<Record<string, string>>;
  parentEnv?: NodeJS.ProcessEnv;
  /** Aborts the gate (the run is stopping). */
  signal?: AbortSignal;
  /** The gate's tag; random when absent. Record it before the gate starts (crash recovery). */
  processTag?: string;
  killGraceMs?: number;
  /** Called once the process exists (record the pid for crash recovery). */
  onStart?: (pid: number) => void;
  /** For tests: the tag sweep. */
  sweep?: typeof sweepTagged;
}

export interface GateRunResult extends GateEnd {
  processTag: string;
  /** The last test count the pattern matched, when the gate has one. */
  testCount: number | null;
}

export function newGateTag(): string {
  return randomBytes(16).toString('hex');
}

const ESC = '\u001b';
const BEL = '\u0007';
const char = (code: number) => String.fromCharCode(code);
/** CSI, OSC (ended by BEL or ST) and two-byte escape sequences. */
const TERMINAL_SEQUENCE = new RegExp(
  `${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}[@-_]`,
  'g',
);
/** Control characters other than newline and tab. */
const CONTROL_CHARACTER = new RegExp(
  `[${char(0)}-${char(8)}${char(11)}-${char(31)}${char(127)}]`,
  'g',
);

/** Removes terminal escape sequences and control characters except newline and tab. */
export function stripTerminal(text: string): string {
  return text.replace(TERMINAL_SEQUENCE, '').replace(/\r\n?/g, '\n').replace(CONTROL_CHARACTER, '');
}

/** The last `lines` lines of `text`, without a trailing empty line. */
export function lastLines(text: string, lines = TAIL_LINES): string {
  const all = text.replace(/\n+$/, '').split('\n');
  return all.slice(-lines).join('\n');
}

/** The last count `pattern` (first capture group) matches in `output`, or null. */
export function lastTestCount(pattern: string, output: string): number | null {
  let count: number | null = null;
  for (const match of output.matchAll(new RegExp(pattern, 'g'))) {
    const value = Number.parseInt(match[1] ?? '', 10);
    if (Number.isFinite(value)) count = value;
    if (match[0] === '') break;
  }
  return count;
}

function signalName(code: number): string | null {
  const n = code - 128;
  if (n < 1 || n > 64) return null;
  for (const [name, value] of Object.entries(osConstants.signals)) if (value === n) return name;
  return null;
}

/** The gate's environment: the allow-list, CI markers, the caller's extras, then the tag. */
export function gateEnv(
  parentEnv: NodeJS.ProcessEnv,
  extra: Readonly<Record<string, string>>,
  tag: string,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of GATE_ENV_ALLOW) {
    const value = parentEnv[key];
    if (typeof value === 'string') env[key] = value;
  }
  return {
    ...env,
    CI: '1',
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    ...extra,
    [GATE_TAG_ENV]: tag,
  };
}

export async function runGate(input: GateRunInput): Promise<GateRunResult> {
  const tag = input.processTag ?? newGateTag();
  const graceMs = input.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const started = Date.now();
  const tmpDir = join(input.scratchDir, 'tmp');
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  mkdirSync(dirname(input.logPath), { recursive: true, mode: 0o700 });
  const settingsPath = join(input.scratchDir, 'gate-settings.json');
  rmSync(settingsPath, { force: true });
  writeFileSync(
    settingsPath,
    JSON.stringify(
      buildGateSandboxSettings({
        protectedPaths: input.protectedPaths,
        workdir: input.worktree,
        tmpDir,
        ports: input.gate.ports,
        consolePort: input.consolePort,
      }),
    ),
    { mode: 0o600, flag: 'wx' },
  );
  const log = openSync(input.logPath, 'a', 0o600);
  let kept = '';
  const keep = (chunk: string) => {
    writeSync(log, chunk);
    kept = (kept + chunk).slice(-KEEP_BYTES);
  };

  const argv = gateArgv(settingsPath, input.gate.command, { TMPDIR: tmpDir });
  let stopped = false;
  let timedOut = false;
  let spawnError: string | null = null;
  let pid: number | undefined;

  const ended = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
    (resolveEnded) => {
      let settled = false;
      const resolve = (value: { exitCode: number | null; signal: NodeJS.Signals | null }) => {
        if (settled) return;
        settled = true;
        resolveEnded(value);
      };
      const child = spawn(argv[0] as string, argv.slice(1), {
        cwd: input.worktree,
        env: gateEnv(input.parentEnv ?? process.env, input.env ?? {}, tag),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
      pid = child.pid;
      const end = (why: 'timeout' | 'stopped') => {
        if (pid === undefined || stopped || timedOut) return;
        if (why === 'timeout') timedOut = true;
        else stopped = true;
        killGroup(pid, 'SIGTERM');
        setTimeout(() => {
          if (pid !== undefined) killGroup(pid, 'SIGKILL');
        }, graceMs).unref();
      };
      const timer = setTimeout(() => end('timeout'), input.gate.timeout);
      timer.unref();
      const onAbort = () => end('stopped');
      if (input.signal?.aborted) queueMicrotask(onAbort);
      else input.signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', keep);
      child.stderr?.on('data', keep);
      const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
        clearTimeout(timer);
        input.signal?.removeEventListener('abort', onAbort);
        resolve({ exitCode, signal });
      };
      child.on('error', (error) => {
        spawnError = error.message;
        // A process that never started emits no `close`.
        if (pid === undefined) finish(null, null);
      });
      child.on('close', finish);
      if (pid !== undefined) input.onStart?.(pid);
    },
  );

  // Whatever is left in the group goes with it; then the tag sweep for what left the group.
  if (pid !== undefined) killGroup(pid, 'SIGKILL');
  const swept = await (input.sweep ?? sweepTagged)(GATE_TAG_ENV, tag, { graceMs: 1000 });
  const survivors: GateSurvivor[] = swept.found.map(({ pid: p, command }) => ({
    pid: p,
    command,
  }));
  if (survivors.length > 0) {
    keep(
      `\n[counterpoint] ended ${survivors.length} process(es) that left the gate's process group: ${survivors.map((s) => `${s.pid} ${s.command}`).join('; ')}\n`,
    );
  }
  if (swept.error !== null)
    keep(`\n[counterpoint] the process sweep could not run: ${swept.error}\n`);
  closeSync(log);
  rmSync(input.scratchDir, { recursive: true, force: true });

  const output = stripTerminal(kept);
  let reason: GateFailReason | null = null;
  let signal: string | null = ended.signal;
  let testCount: number | null = null;
  if (spawnError !== null || pid === undefined) reason = 'spawn';
  else if (stopped) reason = 'stopped';
  else if (timedOut) reason = 'timeout';
  else if (ended.signal !== null) reason = 'signal';
  else if (ended.exitCode !== 0) {
    const name = ended.exitCode === null ? null : signalName(ended.exitCode);
    reason = name === null ? 'exit-code' : 'signal';
    signal = name;
  } else if (input.gate.testCount !== undefined) {
    testCount = lastTestCount(input.gate.testCount, output);
    if (testCount === null) reason = 'no-test-count';
    else if (testCount === 0) reason = 'zero-tests';
  }
  const tail = lastLines(
    spawnError !== null
      ? `${output}\n[counterpoint] the gate could not start: ${spawnError}`
      : output,
  );
  return {
    verdict: reason === null ? 'pass' : 'fail',
    reason,
    exitCode: ended.exitCode,
    signal,
    tail,
    survivors,
    durationMs: Date.now() - started,
    processTag: tag,
    testCount,
  };
}

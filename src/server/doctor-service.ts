// Doctor inside the daemon (doctor: Doctor and risk withdrawal from the console; build-runs: a claude
// update never stops a run).
//
// Two callers: the console's Run doctor button and a run whose last doctor report checked another
// claude version. Both go through here, so at most one probe runs on the machine at a time, and
// the probe's sessions go through the governor (usage-limit pauses apply; probes are exempt from
// the doctor gate itself, since doctor is what clears it). Each run uses the claude installed now.
// Progress goes out as `doctor` events (phase names only); the new report replaces the stored one
// when it is done, and a final `doctor` event tells open Trust pages to reload it.
import type { AgentRunner } from '../agent/runner.ts';
import { type Governor, governedRunner } from '../build/governor.ts';
import { readAcceptedRisks } from '../core/security/accepted-risks.ts';
import { reportVerdict } from '../core/security/doctor-report.ts';
import { getHost, type Store } from '../core/store/db.ts';
import { type DoctorPhase, type RunDoctorInput, runDoctor } from '../doctor/run.ts';

export interface DoctorStatus {
  hostId: string;
  phase: DoctorPhase | 'waiting';
  startedAt: number;
  source: 'console' | 'run';
}

export interface DoctorService {
  /** The probe running now, or null. */
  status(): DoctorStatus | null;
  /**
   * Starts doctor for a host. Refused (`busy`) while another doctor runs; a run that needs the same
   * host's doctor waits for the one already going instead.
   */
  start(
    hostId: string,
    source: 'console' | 'run',
  ):
    | { ok: true; done: Promise<{ passed: boolean; detail: string }> }
    | { ok: false; error: string };
}

export function createDoctorService(options: {
  home: string;
  store: Store;
  governor: Governor;
  runnerFactory: () => AgentRunner;
  setInstalledVersion: (version: string | null) => void;
  publish: (hostId: string, payload: Record<string, unknown>) => void;
  log?: (event: string, fields?: Record<string, unknown>) => void;
  /** For tests. */
  runDoctor?: (input: RunDoctorInput) => ReturnType<typeof runDoctor>;
  now?: () => number;
}): DoctorService {
  const now = options.now ?? Date.now;
  let current: (DoctorStatus & { done: Promise<{ passed: boolean; detail: string }> }) | null =
    null;

  const execute = async (hostId: string): Promise<{ passed: boolean; detail: string }> => {
    const host = getHost(options.store, hostId);
    if (host === undefined) return { passed: false, detail: `Unknown project ${hostId}.` };
    const runner = options.runnerFactory();
    options.setInstalledVersion((await runner.version?.()) ?? null);
    try {
      const { report } = await (options.runDoctor ?? runDoctor)({
        home: options.home,
        host,
        runner: governedRunner(options.governor, runner, { hostId, kind: 'probe' }),
        onProgress: (phase) => {
          if (current !== null) current.phase = phase;
          options.publish(hostId, { phase });
        },
      });
      const accepted = readAcceptedRisks(options.home);
      const verdict = reportVerdict(report, accepted.ok ? accepted.risks : []);
      return {
        passed: verdict !== 'fail',
        detail:
          verdict === 'fail'
            ? 'Doctor did not pass. See the Trust page.'
            : verdict === 'accepted-risk'
              ? 'Boxed in, with an accepted risk.'
              : 'Boxed in.',
      };
    } catch (error) {
      options.log?.('doctor-failed', { hostId, message: (error as Error).message });
      return { passed: false, detail: `Doctor could not run: ${(error as Error).message}` };
    }
  };

  return {
    status() {
      if (current === null) return null;
      const { done: _done, ...status } = current;
      return status;
    },
    start(hostId, source) {
      if (current !== null) {
        if (current.hostId === hostId && source === 'run') return { ok: true, done: current.done };
        return { ok: false, error: `Doctor is already running for ${current.hostId}.` };
      }
      const entry = {
        hostId,
        phase: 'waiting' as DoctorStatus['phase'],
        startedAt: now(),
        source,
        done: Promise.resolve({ passed: false, detail: '' }),
      };
      current = entry;
      options.publish(hostId, { phase: 'waiting' });
      entry.done = execute(hostId).finally(() => {
        if (current === entry) current = null;
        options.publish(hostId, { done: true });
      });
      return { ok: true, done: entry.done };
    },
  };
}

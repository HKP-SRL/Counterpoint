// Confirming a pid is the Counterpoint daemon before `stop` signals it (daemon-lifecycle: Stop never
// signals an unrelated process; WR-08). Every start passes a random `--instance` id on the
// daemon's command line and records it in daemon.json; a pid counts as the daemon only when its
// command line carries `__daemon` and that exact id.
import { execa } from 'execa';

/** The shape of an instance id: 16 random bytes, hex. */
export const INSTANCE_RE = /^[0-9a-f]{32}$/;

/**
 * True only when process `pid` is the Counterpoint daemon of the recorded start: its command line
 * (read with `ps`, which runs nothing of the process) holds `__daemon` and exactly that start's
 * `--instance` id. A recycled pid never carries the id.
 */
export async function isRecordedDaemon(pid: number, instance: string): Promise<boolean> {
  const result = await execa('/bin/ps', ['-o', 'args=', '-p', String(pid)], {
    reject: false,
    stdin: 'ignore',
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
    extendEnv: false,
    timeout: 5_000,
  });
  if (result.exitCode !== 0) return false;
  const args = String(result.stdout).trim().split(/\s+/);
  const at = args.indexOf('--instance');
  return args.includes('__daemon') && at >= 0 && args[at + 1] === instance;
}

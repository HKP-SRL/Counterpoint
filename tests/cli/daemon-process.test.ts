// isRecordedDaemon: a pid counts as the daemon only when its command line holds `__daemon` and the
// recorded start's exact `--instance` id (daemon-lifecycle: Stop never signals an unrelated process).
import { type ChildProcess, spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { isRecordedDaemon } from '../../src/cli/daemon-process.ts';

const ID = '0123456789abcdef0123456789abcdef';
const children: ChildProcess[] = [];

function sleeper(...args: string[]): number {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)', ...args], {
    stdio: 'ignore',
  });
  children.push(child);
  return child.pid as number;
}

afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
});

describe('isRecordedDaemon', () => {
  it('confirms a process carrying __daemon and the recorded instance id', async () => {
    expect(await isRecordedDaemon(sleeper('__daemon', '--port', '0', '--instance', ID), ID)).toBe(
      true,
    );
  });

  it('refuses another instance id, a process without __daemon, and a dead pid', async () => {
    const other = 'f'.repeat(32);
    expect(await isRecordedDaemon(sleeper('__daemon', '--instance', other), ID)).toBe(false);
    expect(await isRecordedDaemon(sleeper('--instance', ID), ID)).toBe(false);
    const gone = sleeper('__daemon', '--instance', ID);
    children.at(-1)?.kill('SIGKILL');
    await new Promise((resolve) => children.at(-1)?.once('exit', resolve));
    expect(await isRecordedDaemon(gone, ID)).toBe(false);
  });

  it('refuses an id that only appears as a prefix', async () => {
    expect(await isRecordedDaemon(sleeper('__daemon', '--instance', `${ID}0`), ID)).toBe(false);
  });
});

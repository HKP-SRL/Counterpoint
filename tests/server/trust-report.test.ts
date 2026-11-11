// readDoctorReport never follows a symlink and never blocks on a FIFO planted at the report path
// (IN-02): both read as unreadable, at once.
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterAll, describe, expect, it } from 'vitest';
import { hostDir } from '../../src/core/host/home.ts';
import { readDoctorReport } from '../../src/server/routes/trust.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

afterAll(removeScratchDirs);

function reportPath(home: string): string {
  const dir = hostDir(home, 'cena');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, 'doctor.json');
}

describe('readDoctorReport', () => {
  it('reads absent when there is no report', () => {
    expect(readDoctorReport(makeScratchDir('trh'), 'cena')).toEqual({ kind: 'absent' });
  });

  it('reads unreadable for a symlink', () => {
    const home = makeScratchDir('trh');
    const target = join(makeScratchDir('trt'), 'r.json');
    writeFileSync(target, '{}');
    symlinkSync(target, reportPath(home));
    expect(readDoctorReport(home, 'cena')).toEqual({ kind: 'unreadable' });
  });

  it('reads unreadable for a FIFO without blocking', async () => {
    const home = makeScratchDir('trh');
    await execa('mkfifo', [reportPath(home)]);
    expect(readDoctorReport(home, 'cena')).toEqual({ kind: 'unreadable' });
  }, 5_000);
});

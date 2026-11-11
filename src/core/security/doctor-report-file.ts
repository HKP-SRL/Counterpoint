// The stored doctor report, `hosts/{id}/doctor.json` in the Counterpoint home, read safely.
//
// The report lives in the 0700 home that agent sandboxes deny (agents cannot plant a pass). It is
// opened with O_NOFOLLOW (a symlink planted in its place is refused) and O_NONBLOCK (a FIFO there
// must not hang the daemon, IN-02), must be a regular file of bounded size, and must parse as the
// `counterpoint/doctor/v1` schema for this host; anything else is `unreadable`, never a verdict.
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { hostDir } from '../host/home.ts';
import { type DoctorReport, DoctorReport as DoctorReportSchema } from './doctor-report.ts';

export const DOCTOR_REPORT_FILE = 'doctor.json';

/** A doctor report is a few kilobytes; anything far larger is not one. */
const MAX_REPORT_BYTES = 1024 * 1024;

export type ReadReportResult =
  | { kind: 'absent' }
  | { kind: 'unreadable' }
  | { kind: 'report'; report: DoctorReport };

/** Reads and validates `hosts/{hostId}/doctor.json`. Never follows a symlink or blocks on a FIFO. */
export function readDoctorReport(home: string, hostId: string): ReadReportResult {
  const file = join(hostDir(home, hostId), DOCTOR_REPORT_FILE);
  let fd: number;
  try {
    // O_NONBLOCK: a FIFO planted at this path must not hang the daemon on open (IN-02).
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'absent' };
    return { kind: 'unreadable' };
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_REPORT_BYTES) return { kind: 'unreadable' };
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const read = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(buffer.subarray(0, offset).toString('utf8'));
    } catch {
      return { kind: 'unreadable' };
    }
    const parsed = DoctorReportSchema.safeParse(raw);
    if (!parsed.success || parsed.data.hostId !== hostId) return { kind: 'unreadable' };
    return { kind: 'report', report: parsed.data };
  } catch {
    return { kind: 'unreadable' };
  } finally {
    closeSync(fd);
  }
}

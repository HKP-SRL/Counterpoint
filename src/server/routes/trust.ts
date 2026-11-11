// GET /api/hosts/:hostId/doctor (doctor: Trust page): the last `counterpoint doctor` report for a
// host, read from `hosts/{id}/doctor.json` in the Counterpoint home. The route is read-only: the
// console never runs the probe, so the Trust page has no privileged action.
//
// The report lives in the 0700 home that agent sandboxes deny (agents cannot plant a pass). It is
// opened with O_NOFOLLOW (a symlink planted in its place is refused), must be a regular file of
// bounded size, and must parse as the `counterpoint/doctor/v1` schema for this host; anything else
// is reported as `unreadable`, never as a verdict.
//
// The verdict is three-way (doctor: Owner-recorded accepted risk): `pass`, `accepted-risk` or
// `fail`. The owner's accepted-risk record is read on every request (an unreadable record counts as
// none), so a `counterpoint revoke-risk` applies at once without a doctor rerun; `acceptedRisks`
// lists the entries that applied to this report. The route only reads: nothing here writes the
// record.
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { hostDir } from '../../core/host/home.ts';
import { HOST_ID_RE } from '../../core/ids.ts';
import { readAcceptedRisks } from '../../core/security/accepted-risks.ts';
import {
  appliedAcceptedRisks,
  type DoctorReport,
  DoctorReport as DoctorReportSchema,
  isReportStale,
  reportVerdict,
} from '../../core/security/doctor-report.ts';
import { getHost, type Store } from '../../core/store/db.ts';

export const DOCTOR_REPORT_FILE = 'doctor.json';

/** A doctor report is a few kilobytes; anything far larger is not one. */
const MAX_REPORT_BYTES = 1024 * 1024;

export interface TrustRoutesOptions {
  /** The Counterpoint home holding `hosts/{id}/doctor.json`. */
  home: string;
  store: Store;
  now?: () => Date;
}

export type ReadReportResult =
  | { kind: 'absent' }
  | { kind: 'unreadable' }
  | { kind: 'report'; report: DoctorReport };

/** Reads and validates `hosts/{hostId}/doctor.json`. Never follows a symlink. */
export function readDoctorReport(home: string, hostId: string): ReadReportResult {
  const file = join(hostDir(home, hostId), DOCTOR_REPORT_FILE);
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
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

export function mountTrustRoutes(app: Hono, options: TrustRoutesOptions): void {
  const now = options.now ?? (() => new Date());

  app.get('/api/hosts/:hostId/doctor', (c) => {
    const hostId = c.req.param('hostId');
    if (!HOST_ID_RE.test(hostId)) return c.json({ error: 'invalid host id' }, 400);
    if (getHost(options.store, hostId) === undefined) return c.json({ error: 'not found' }, 404);

    const result = readDoctorReport(options.home, hostId);
    if (result.kind === 'absent') return c.json({ report: null });
    if (result.kind === 'unreadable') return c.json({ report: null, error: 'unreadable' });
    const accepted = readAcceptedRisks(options.home);
    const recorded = accepted.ok ? accepted.risks : [];
    return c.json({
      report: result.report,
      stale: isReportStale(result.report, now()),
      verdict: reportVerdict(result.report, recorded),
      acceptedRisks: appliedAcceptedRisks(result.report, recorded).map(
        ({ id, target, subStep, reason, recordedAt }) => ({
          id,
          target,
          subStep,
          reason,
          recordedAt,
        }),
      ),
    });
  });
}

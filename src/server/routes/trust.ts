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
import type { Hono } from 'hono';
import { HOST_ID_RE } from '../../core/ids.ts';
import { readAcceptedRisks } from '../../core/security/accepted-risks.ts';
import {
  appliedAcceptedRisks,
  isReportStale,
  reportVerdict,
} from '../../core/security/doctor-report.ts';
import { readDoctorReport } from '../../core/security/doctor-report-file.ts';
import { getHost, type Store } from '../../core/store/db.ts';

export interface TrustRoutesOptions {
  /** The Counterpoint home holding `hosts/{id}/doctor.json`. */
  home: string;
  store: Store;
  now?: () => Date;
}

export {
  DOCTOR_REPORT_FILE,
  type ReadReportResult,
  readDoctorReport,
} from '../../core/security/doctor-report-file.ts';

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

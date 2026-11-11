// The doctor gate in front of every agent spawn (build-runs: No agent spawns while doctor fails).
//
// A spawn for a host is allowed only while that host's last stored doctor report has the verdict
// `pass`, or `accepted-risk` with a risk the owner still has on record. The report must also have
// been made with the claude version that will run the session: the probe proves a statement about
// one binary, and an updated claude can change what its sandbox and refusals do (design: Risks,
// "Claude Code version"). The accepted-risk record is read on every call, so withdrawing a risk
// applies at once.
import { readAcceptedRisks } from '../core/security/accepted-risks.ts';
import { reportVerdict } from '../core/security/doctor-report.ts';
import { readDoctorReport } from '../core/security/doctor-report-file.ts';
import type { DoctorGate } from './governor.ts';
import { normalizeClaudeVersion } from './windows.ts';

export function doctorGate(options: {
  home: string;
  /** The claude version sessions will run with (`claude --version`), or null when unknown. */
  claudeVersion: () => string | null;
}): DoctorGate {
  return (hostId) => {
    const fix = `Run doctor for ${hostId} (Trust page, or \`counterpoint doctor ${hostId}\`).`;
    const read = readDoctorReport(options.home, hostId);
    if (read.kind === 'absent')
      return { ok: false, reason: `Doctor has not run for ${hostId}. ${fix}` };
    if (read.kind === 'unreadable') {
      return { ok: false, reason: `The doctor report for ${hostId} could not be read. ${fix}` };
    }
    const accepted = readAcceptedRisks(options.home);
    const verdict = reportVerdict(read.report, accepted.ok ? accepted.risks : []);
    if (verdict === 'fail') {
      return { ok: false, reason: `The last doctor run for ${hostId} did not pass. ${fix}` };
    }
    const current = options.claudeVersion();
    const checked = read.report.claudeVersion;
    if (
      current === null ||
      checked === null ||
      normalizeClaudeVersion(current) !== normalizeClaudeVersion(checked)
    ) {
      return {
        ok: false,
        reason: `The last doctor run for ${hostId} checked claude ${checked ?? 'unknown'}, but sessions would run claude ${current ?? 'unknown'}. ${fix}`,
        rerun: current !== null && checked !== null,
      };
    }
    return { ok: true };
  };
}

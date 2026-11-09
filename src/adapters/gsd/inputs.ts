// RED stub: replaced by the D-02 approval-input rule.
import {
  type ApprovalInput,
  type GitFileReader,
  PhaseNotFoundError,
} from '../../core/framework/port.ts';

export async function approvalInputs(
  _reader: GitFileReader,
  _commit: string,
  phaseId: string,
): Promise<ApprovalInput[]> {
  throw new PhaseNotFoundError(phaseId);
}

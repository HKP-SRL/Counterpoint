// Stub for the RED step.
import { type FrameworkAdapter, PhaseNotFoundError } from '../../core/framework/port.ts';

export function createGsdAdapter(): FrameworkAdapter {
  return {
    id: 'gsd',
    detect: async () => false,
    snapshot: async (_reader, commit) => ({ framework: 'gsd', commit, phases: [], unreadable: null }),
    approvalInputs: async (_reader, _commit, phaseId) => {
      throw new PhaseNotFoundError(phaseId);
    },
  };
}

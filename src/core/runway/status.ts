// Stub for the RED step.
import type { PhaseFacts, UserSetupItem } from '../framework/port.ts';

export type PhaseStatus = 'unreadable' | 'built' | 'on-runway' | 'changed' | 'ready' | 'not-planned';
export type NotReadyReason = 'no-context' | 'no-plans';
export type StatusOverlay = 'on-runway' | 'changed';

export function derivePhaseStatus(
  _phase: PhaseFacts,
  _overlay?: StatusOverlay | null,
): { status: PhaseStatus; notReadyReason: NotReadyReason | null } {
  return { status: 'not-planned', notReadyReason: null };
}

export function phasePrerequisites(_phase: PhaseFacts): {
  userSetup: UserSetupItem[];
  nonAutonomous: number;
  total: number;
} {
  return { userSetup: [], nonAutonomous: 0, total: 0 };
}

// Phase status and prerequisites, derived from adapter facts only (framework-agnostic: this
// module knows the port types, never a framework's files).
//
// Precedence: unreadable > built (every plan has its completion record) > overlay (on-runway /
// changed, from verified approvals) > ready (context and at least one plan, D-01) > not-planned.
// A built phase is never offered for approval.
import type { PhaseFacts, UserSetupItem } from '../framework/port.ts';

export type PhaseStatus =
  | 'unreadable'
  | 'built'
  | 'on-runway'
  | 'changed'
  | 'ready'
  | 'not-planned';
export type NotReadyReason = 'no-context' | 'no-plans';
export type StatusOverlay = 'on-runway' | 'changed';

export interface DerivedStatus {
  status: PhaseStatus;
  /** Set only for `not-planned`. */
  notReadyReason: NotReadyReason | null;
}

type StatusFacts = Pick<PhaseFacts, 'unreadable' | 'hasContext' | 'plans'>;

export function derivePhaseStatus(
  phase: StatusFacts,
  overlay?: StatusOverlay | null,
): DerivedStatus {
  if (phase.unreadable !== null) return { status: 'unreadable', notReadyReason: null };
  if (phase.plans.length > 0 && phase.plans.every((plan) => plan.hasSummary)) {
    return { status: 'built', notReadyReason: null };
  }
  if (overlay) return { status: overlay, notReadyReason: null };
  if (!phase.hasContext) return { status: 'not-planned', notReadyReason: 'no-context' };
  if (phase.plans.length === 0) return { status: 'not-planned', notReadyReason: 'no-plans' };
  return { status: 'ready', notReadyReason: null };
}

export interface PhasePrerequisites {
  /** One entry per service across all plans; env vars merged in first-seen order. */
  userSetup: UserSetupItem[];
  /** Plans that stop for a human (k of `total`). */
  nonAutonomous: number;
  total: number;
}

export function phasePrerequisites(phase: Pick<PhaseFacts, 'plans'>): PhasePrerequisites {
  const byService = new Map<string, UserSetupItem>();
  for (const plan of phase.plans) {
    for (const item of plan.userSetup) {
      const existing = byService.get(item.service);
      if (!existing) {
        byService.set(item.service, { ...item, envVars: [...new Set(item.envVars)] });
        continue;
      }
      existing.why ??= item.why;
      for (const name of item.envVars) {
        if (!existing.envVars.includes(name)) existing.envVars.push(name);
      }
    }
  }
  return {
    userSetup: [...byService.values()],
    nonAutonomous: phase.plans.filter((plan) => !plan.autonomous).length,
    total: phase.plans.length,
  };
}

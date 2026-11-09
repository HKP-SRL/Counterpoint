// RED stub (01-05 Task 1): the real evaluator lands in the GREEN commit.
import type { ProbeTarget, ProbeTargetId } from '../core/security/doctor-report.ts';
import type { ProbePlan, ProbeStep } from './probe.ts';
import type { StreamEvent } from './runner.ts';

export const MATCHER_CLAUDE_VERSION = '0.0.0';

export type StepClass =
  | 'reached'
  | 'denied-rule'
  | 'denied-os'
  | 'denied-mode'
  | 'skipped'
  | 'unknown';

export function classifyStep(
  _step: ProbeStep,
  _events: readonly StreamEvent[],
  _expectedValue?: string,
): StepClass {
  return 'unknown';
}

export interface EvaluateProbeOptions {
  claudeVersion: string | null;
  leftovers: readonly string[];
  skippedTargets?: readonly ProbeTargetId[];
  hostName?: string;
}

export function evaluateProbe(
  _plan: ProbePlan,
  _treatment: readonly StreamEvent[],
  _control: readonly StreamEvent[],
  _options: EvaluateProbeOptions,
): ProbeTarget[] {
  return [];
}

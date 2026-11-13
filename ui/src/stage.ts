// Where a change stands in the build lane (runway: Where each runway change stands), as the
// changes API sends it: up next or building in the run going now, parked, on hold, its PR open or
// closed, or waiting on a dependency that is not built. The console shows it instead of "On
// runway" or "Ready to approve", and says what the owner can do about it.
//
// Reasons and change names come from the store and the host's planning files: React text only.
import { isChangeId } from './ids';

export type HoldWhy = 'left-parked' | 'replan' | 'question';

export type ChangeStage =
  | { kind: 'queued' }
  | { kind: 'building' }
  | { kind: 'held'; why: HoldWhy; reason: string | null }
  | { kind: 'parked'; reason: string | null }
  | { kind: 'pr-open'; prUrl: string }
  | { kind: 'pr-closed'; prUrl: string }
  | { kind: 'waits'; on: string[] };

export type StageVariant = 'neutral' | 'warning' | 'purple';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const isPrUrl = (value: unknown): value is string =>
  typeof value === 'string' && /^https:\/\/[^\s]+$/.test(value);

/** The stage from the API; anything that does not fit is no stage. */
export function parseStage(value: unknown): ChangeStage | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case 'queued':
    case 'building':
      return { kind: value.kind };
    case 'held': {
      const why = value.why;
      if (why !== 'left-parked' && why !== 'replan' && why !== 'question') return null;
      return { kind: 'held', why, reason: textOrNull(value.reason) };
    }
    case 'parked':
      return { kind: 'parked', reason: textOrNull(value.reason) };
    case 'pr-open':
    case 'pr-closed':
      return isPrUrl(value.prUrl) ? { kind: value.kind, prUrl: value.prUrl } : null;
    case 'waits': {
      const on = Array.isArray(value.on) ? value.on.filter(isChangeId) : [];
      return on.length === 0 ? null : { kind: 'waits', on };
    }
    default:
      return null;
  }
}

/** Dark cockpit: grey when normal, amber when it needs the owner, purple while it builds. */
export function stageLook(stage: ChangeStage): { label: string; variant: StageVariant } {
  switch (stage.kind) {
    case 'queued':
      return { label: 'Up next', variant: 'neutral' };
    case 'building':
      return { label: 'Building', variant: 'purple' };
    case 'held':
      return { label: 'On hold', variant: 'warning' };
    case 'parked':
      return { label: 'Parked', variant: 'warning' };
    case 'pr-open':
      return { label: 'PR open', variant: 'neutral' };
    case 'pr-closed':
      return { label: 'PR closed', variant: 'neutral' };
    case 'waits':
      return { label: `Waits on ${stage.on.join(', ')}`, variant: 'neutral' };
  }
}

/**
 * The change can be retried from its page: parked, or on hold after a park. One held by its
 * builder's question is freed by the answer in Needs You instead.
 */
export function canRetry(stage: ChangeStage | null): boolean {
  if (stage === null) return false;
  return stage.kind === 'parked' || (stage.kind === 'held' && stage.why !== 'question');
}

/** What the change page says about the stage: a title and one or two sentences. */
export function stageBanner(
  changeId: string,
  stage: ChangeStage,
): { title: string; description: string } {
  switch (stage.kind) {
    case 'queued':
      return {
        title: 'Up next in the run',
        description: `The run going now builds ${changeId} after the changes before it.`,
      };
    case 'building':
      return { title: 'Building now', description: `The run going now is building ${changeId}.` };
    case 'held':
      return {
        title: 'On hold',
        description:
          stage.why === 'question'
            ? `${changeId}'s builder asked something that cannot be undone. No run builds it until you answer in Needs You.`
            : `${stage.why === 'replan' ? 'You chose to re-plan it' : 'You left it parked'}. No run builds it until you click Retry.${stage.reason === null ? '' : ` Why it parked: ${stage.reason}`}`,
      };
    case 'parked':
      return {
        title: 'Parked',
        description: `${stage.reason ?? 'Its last build parked.'} Run leaves it out until you retry it; Retry builds it in the next run with the failure as a note.`,
      };
    case 'pr-open':
      return {
        title: 'Its PR is open',
        description: `Its latest build is green. Run does not build ${changeId} again while its PR is open: review and merge it, or close it. You can still pick it in the run form to rebuild it.`,
      };
    case 'pr-closed':
      return {
        title: 'Its PR was closed',
        description: `Its last build PR was closed without merging. Run builds ${changeId} again.`,
      };
    case 'waits':
      return {
        title: `Waits on ${stage.on.join(', ')}`,
        description: `${changeId} builds on ${stage.on.length === 1 ? 'that change' : 'those changes'}, so no run builds it until ${stage.on.length === 1 ? 'it is' : 'they are'} built (its PR merged, or every task checked). You can approve it now.`,
      };
  }
}

/**
 * Why a Built change is built, in one sentence (host-planning: Change detail): archived, every task
 * checked, or its build PR merged (then its open owner steps are still listed).
 */
export function builtText(
  changeId: string,
  builtBy: 'archived' | 'tasks' | 'merged' | null,
  ownerSteps: number,
): string {
  if (builtBy === 'archived') {
    return `${changeId} is archived, so there is nothing left to run. Approval is not offered.`;
  }
  if (builtBy === 'merged') {
    const steps =
      ownerSteps === 0
        ? ''
        : ` ${ownerSteps === 1 ? '1 owner step is' : `${ownerSteps} owner steps are`} still open below.`;
    return `Its build PR merged, so there is nothing left to build. Approval is not offered.${steps}`;
  }
  return `Every task in ${changeId} is checked, so there is nothing left to run. Approval is not offered.`;
}

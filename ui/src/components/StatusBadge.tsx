// Change status badge (host-planning: Change statuses). Status is never carried by color
// alone: every badge pairs its variant with an icon and a word.
//
// Icons come from the theme's icon registry only (no second icon set, Registry Safety). The
// registry has exact matches for circle-check (`success`), triangle-alert (`warning`), check and
// circle-x (`error`); it has no circle-dashed or circle-dot, so `Not ready` uses `clock` (not
// started yet), `Ready to approve` uses `info` and `Owner steps left` uses `wrench` (only the owner
// can do what is left).
import { Badge, type BadgeVariant } from '@astryxdesign/core/Badge';
import type { IconName } from '@astryxdesign/core/Icon';
import { Icon } from '@astryxdesign/core/Icon';
import { type ChangeStage, stageLook } from '../stage';

export type ChangeStatus =
  | 'unreadable'
  | 'built'
  | 'owner-steps'
  | 'on-runway'
  | 'ready'
  | 'not-planned';

interface StatusLook {
  label: string;
  variant: BadgeVariant;
  icon: IconName;
}

export const CHANGE_STATUS: Readonly<Record<ChangeStatus, StatusLook>> = {
  'not-planned': { label: 'Not ready', variant: 'neutral', icon: 'clock' },
  ready: { label: 'Ready to approve', variant: 'info', icon: 'info' },
  'on-runway': { label: 'On runway', variant: 'success', icon: 'success' },
  'owner-steps': { label: 'Owner steps left', variant: 'neutral', icon: 'wrench' },
  built: { label: 'Built', variant: 'neutral', icon: 'check' },
  unreadable: { label: "Couldn't read", variant: 'error', icon: 'error' },
};

export function isChangeStatus(value: unknown): value is ChangeStatus {
  return typeof value === 'string' && Object.hasOwn(CHANGE_STATUS, value);
}

export function StatusBadge({ status }: { status: ChangeStatus }) {
  const look = CHANGE_STATUS[status];
  return (
    <Badge variant={look.variant} label={look.label} icon={<Icon icon={look.icon} size="xsm" />} />
  );
}

const STAGE_ICON: Readonly<Record<ChangeStage['kind'], IconName>> = {
  queued: 'clock',
  building: 'wrench',
  held: 'warning',
  parked: 'warning',
  'pr-open': 'externalLink',
  'pr-closed': 'externalLink',
  waits: 'clock',
};

/** The change's build-lane stage when it has one (runway: Where each runway change stands), else its status. */
export function ChangeBadge({
  status,
  stage,
}: {
  status: ChangeStatus;
  stage: ChangeStage | null;
}) {
  if (stage === null) return <StatusBadge status={status} />;
  const look = stageLook(stage);
  return (
    <Badge
      variant={look.variant}
      label={look.label}
      icon={<Icon icon={STAGE_ICON[stage.kind]} size="xsm" />}
    />
  );
}

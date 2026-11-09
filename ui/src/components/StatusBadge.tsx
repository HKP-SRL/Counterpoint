// Phase status badge (UI-SPEC "Color" phase status vocabulary). Status is never carried by color
// alone: every badge pairs its variant with an icon and a word.
//
// Icons come from the theme's icon registry only (no second icon set, Registry Safety). The
// registry has exact matches for circle-check (`success`), triangle-alert (`warning`), check and
// circle-x (`error`); it has no circle-dashed or circle-dot, so `Not planned` uses `clock` (not
// started yet) and `Ready to approve` uses `info`.
import { Badge, type BadgeVariant } from '@astryxdesign/core/Badge';
import type { IconName } from '@astryxdesign/core/Icon';
import { Icon } from '@astryxdesign/core/Icon';

export type PhaseStatus =
  | 'unreadable'
  | 'built'
  | 'on-runway'
  | 'changed'
  | 'ready'
  | 'not-planned';

interface StatusLook {
  label: string;
  variant: BadgeVariant;
  icon: IconName;
}

export const PHASE_STATUS: Readonly<Record<PhaseStatus, StatusLook>> = {
  'not-planned': { label: 'Not planned', variant: 'neutral', icon: 'clock' },
  ready: { label: 'Ready to approve', variant: 'info', icon: 'info' },
  'on-runway': { label: 'On runway', variant: 'success', icon: 'success' },
  changed: { label: 'Changed since signed', variant: 'warning', icon: 'warning' },
  built: { label: 'Built', variant: 'neutral', icon: 'check' },
  unreadable: { label: "Couldn't read", variant: 'error', icon: 'error' },
};

export function isPhaseStatus(value: unknown): value is PhaseStatus {
  return typeof value === 'string' && Object.hasOwn(PHASE_STATUS, value);
}

export function StatusBadge({ status }: { status: PhaseStatus }) {
  const look = PHASE_STATUS[status];
  return <Badge variant={look.variant} label={look.label} icon={<Icon icon={look.icon} />} />;
}

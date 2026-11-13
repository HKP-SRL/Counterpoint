// The build hold of design drafts (design-drafts D-12): what a held change's run row says, and the
// Needs You card raised from it. One card per held change and run; it is not blocking, so it never
// notifies at night.
import type { NewCard } from '../core/store/cards.ts';

export const DRAFTS_HOLD_KIND = 'drafts-hold';
/** How a held change's run row starts its reason (run-cards.ts raises the hold card from it). */
export const HOLD_REASON = 'Waiting for sign-off: ';

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
};

/** The skip reason of a held change. */
export function holdReason(waiting: readonly string[]): string {
  return `${HOLD_REASON}${nameList(waiting)}.`;
}

/** The hold card (D-12): one per held change and run, naming the screens that wait. */
export function holdCard(hostId: string, runId: string, change: string, reason: string): NewCard {
  const names = reason.startsWith(HOLD_REASON)
    ? reason.slice(HOLD_REASON.length).replace(/\.$/, '')
    : 'its screens';
  return {
    hostId,
    key: `drafts-hold:${runId}:${change}`,
    kind: DRAFTS_HOLD_KIND,
    source: 'run',
    runId,
    change,
    question: clip(`Sign off ${names} to build ${change}`, 500),
    why: `${change} has design drafts. It builds once every screen is signed off and its pages are on the base branch.`,
    options: [
      {
        label: 'Open drafts',
        consequence: 'Its drafts page; the next run builds it once every screen is signed off.',
      },
      {
        label: 'Drop drafts',
        consequence: 'Its drafts are deleted and it builds without them in the next run.',
        action: { type: 'drop-drafts', change },
      },
    ],
    recommended: 0,
    reversible: true,
    blocking: false,
  };
}

/** "Home", "Home and Settings", "Home, Menu and Settings". */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

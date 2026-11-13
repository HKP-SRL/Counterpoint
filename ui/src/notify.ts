// Browser notifications for cards that block work (owner-inbox D-9; needs-you: Notified when a card
// blocks work). Only once the owner allowed them (asked from a click, never on load), only while
// the console's tab is in the background, at most one a minute (cards arriving meanwhile are
// merged), and one tag so open tabs replace each other's notification instead of stacking.
// Cards from every project notify, whichever project the console shows; a click opens the
// project the (first) card is in.
import { useEffect, useRef, useSyncExternalStore } from 'react';

export const NOTIFY_INTERVAL_MS = 60_000;
const TAG = 'counterpoint-needs-you';

export type BlockingCard = {
  id: string;
  question: string;
  blocking: boolean;
  state: string;
  /** The project the card is in; null for the machine's cards. */
  hostId?: string | null;
};

/**
 * The open blocking cards not in `seen`, and the ids now seen. With no `seen` yet (the first
 * snapshot after the page loaded), nothing is new: those cards were there before.
 */
export function newBlockingCards(
  seen: ReadonlySet<string> | null,
  cards: readonly BlockingCard[],
): { fresh: BlockingCard[]; seen: Set<string> } {
  const next = new Set(seen ?? []);
  const fresh: BlockingCard[] = [];
  for (const card of cards) {
    if (next.has(card.id)) continue;
    next.add(card.id);
    if (seen !== null && card.blocking && card.state === 'open') fresh.push(card);
  }
  return { fresh, seen: next };
}

/** The text of one notification for `cards` (one question, or how many). */
export function notificationText(cards: readonly Pick<BlockingCard, 'question'>[]): string {
  return cards.length === 1 ? (cards[0]?.question ?? '') : `${cards.length} questions need you`;
}

const supported = () => typeof window !== 'undefined' && 'Notification' in window;

// The permission is page-wide; a tiny external store re-renders the button after a click.
const listeners = new Set<() => void>();
const permission = (): NotificationPermission | 'unsupported' =>
  supported() ? Notification.permission : 'unsupported';

export function useNotificationPermission(): {
  permission: NotificationPermission | 'unsupported';
  ask: () => Promise<void>;
} {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    permission,
    permission,
  );
  return {
    permission: value,
    ask: async () => {
      if (!supported()) return;
      await Notification.requestPermission();
      for (const listener of listeners) listener();
    },
  };
}

function show(text: string, onClick: () => void): void {
  if (!supported() || Notification.permission !== 'granted') return;
  try {
    const notification = new Notification('Counterpoint', { body: text, tag: TAG });
    notification.onclick = () => {
      window.focus();
      onClick();
      notification.close();
    };
  } catch {
    // some browsers allow notifications only from a service worker; the tab title still counts
  }
}

/**
 * Notifies new blocking cards, of every project, while the tab is in the background. `open` runs
 * when the owner clicks the notification, with the first card it names.
 */
export function useBlockingNotifications(
  cards: readonly BlockingCard[] | undefined,
  open: (card: BlockingCard) => void = () => undefined,
): void {
  const seen = useRef<Set<string> | null>(null);
  const last = useRef(Number.NEGATIVE_INFINITY);
  const pending = useRef<BlockingCard[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (cards === undefined) return;
    const { fresh, seen: ids } = newBlockingCards(seen.current, cards);
    seen.current = ids;
    if (fresh.length === 0 || permission() !== 'granted') return;
    if (document.visibilityState === 'visible') return;
    const flush = () => {
      timer.current = undefined;
      const batch = pending.current;
      pending.current = [];
      if (batch.length === 0) return;
      last.current = Date.now();
      const first = batch[0] as BlockingCard;
      show(notificationText(batch), () => openRef.current(first));
    };
    pending.current = [...pending.current, ...fresh];
    if (timer.current !== undefined) return;
    const wait = last.current + NOTIFY_INTERVAL_MS - Date.now();
    if (wait <= 0) flush();
    else timer.current = setTimeout(flush, wait);
  }, [cards]);
}

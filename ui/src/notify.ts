// Browser notifications for cards that block work (owner-inbox D-9; needs-you: Notified when a card
// blocks work). Only once the owner allowed them (asked from a click, never on load), only while
// the console's tab is in the background, at most one a minute (cards arriving meanwhile are
// merged), and one tag so open tabs replace each other's notification instead of stacking.
import { useEffect, useRef, useSyncExternalStore } from 'react';

export const NOTIFY_INTERVAL_MS = 60_000;
const TAG = 'counterpoint-needs-you';

export type BlockingCard = { id: string; question: string; blocking: boolean; state: string };

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

function show(text: string): void {
  if (!supported() || Notification.permission !== 'granted') return;
  try {
    const notification = new Notification('Counterpoint', { body: text, tag: TAG });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // some browsers allow notifications only from a service worker; the tab title still counts
  }
}

/** Notifies new blocking cards of `hostId`'s Needs You while the tab is in the background. */
export function useBlockingNotifications(
  hostId: string,
  cards: readonly BlockingCard[] | undefined,
): void {
  const seen = useRef<{ hostId: string; ids: Set<string> } | null>(null);
  const last = useRef(Number.NEGATIVE_INFINITY);
  const pending = useRef<BlockingCard[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (cards === undefined) return;
    const previous = seen.current?.hostId === hostId ? seen.current.ids : null;
    const { fresh, seen: ids } = newBlockingCards(previous, cards);
    seen.current = { hostId, ids };
    if (fresh.length === 0 || permission() !== 'granted') return;
    if (document.visibilityState === 'visible') return;
    const flush = () => {
      timer.current = undefined;
      const batch = pending.current;
      pending.current = [];
      if (batch.length === 0) return;
      last.current = Date.now();
      show(notificationText(batch));
    };
    pending.current = [...pending.current, ...fresh];
    if (timer.current !== undefined) return;
    const wait = last.current + NOTIFY_INTERVAL_MS - Date.now();
    if (wait <= 0) flush();
    else timer.current = setTimeout(flush, wait);
  }, [hostId, cards]);
}

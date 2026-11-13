// One-click approvals in the console (approvals: Approve in one click; Withdraw in one click).
// Approve, Approve all and Withdraw are guarded POSTs that take effect at once; on success the
// changes, the change detail and the runway are refetched right away (the watcher's `approval` and
// `runway` events follow for every other open console). A refusal shows in the daemon's words.
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { apiPostAnswer, queryKeys } from './api';

export interface ApprovalActions {
  approve(changeId: string): Promise<void>;
  withdraw(changeId: string): Promise<void>;
  /** Builds a parked or held change again in the next run. */
  retry(changeId: string): Promise<void>;
  approveAll(): Promise<void>;
  /** The change id (or `all`) a click is in flight for, or null. */
  pending: string | null;
  /** The last refusal, in the daemon's words, or null. */
  error: string | null;
}

export function useApprovalActions(hostId: string): ApprovalActions {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = useCallback(
    async (what: string, path: string) => {
      setPending(what);
      setError(null);
      try {
        const answer = await apiPostAnswer(path, {});
        if (!answer.ok) {
          setError(
            typeof answer.body.error === 'string'
              ? answer.body.error
              : "Counterpoint didn't take that.",
          );
        }
        await Promise.all(
          [
            queryKeys.changes(hostId),
            queryKeys.change(hostId),
            queryKeys.runway(hostId),
            queryKeys.run(hostId),
          ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
        );
      } catch {
        setError("Counterpoint's daemon didn't answer.");
      } finally {
        setPending(null);
      }
    },
    [hostId, queryClient],
  );

  const base = `/api/hosts/${encodeURIComponent(hostId)}`;
  return {
    approve: (changeId) => act(changeId, `${base}/changes/${encodeURIComponent(changeId)}/approve`),
    withdraw: (changeId) =>
      act(changeId, `${base}/changes/${encodeURIComponent(changeId)}/withdraw`),
    retry: (changeId) => act(changeId, `${base}/changes/${encodeURIComponent(changeId)}/retry`),
    approveAll: () => act('all', `${base}/approve-all`),
    pending,
    error,
  };
}

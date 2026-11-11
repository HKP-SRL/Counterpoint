// Change order (openspec-host-adapter design decision 4; host-planning: Change order).
//
// Active changes come in dependency order (Kahn's algorithm): a change is listed only after every
// active change it depends on. Among the changes that are free to go next, ties break on `created`
// ascending (no date last), then on the id. A dependency on an unknown or archived change counts
// as satisfied. When only changes caught in a cycle are left, the cycle is broken at its member
// that comes first by `created`, then id, and ordering carries on, so changes that depend on a
// cycle still come after it. Archived changes follow the active ones, newest archive date first,
// then by id.
import type { ChangeFacts } from '../../core/framework/port.ts';

type Orderable = Pick<ChangeFacts, 'id' | 'created' | 'dependsOn' | 'archived' | 'archivedOn'>;

function byCreatedThenId(a: Orderable, b: Orderable): number {
  if (a.created !== b.created) {
    if (a.created === null) return 1;
    if (b.created === null) return -1;
    return a.created < b.created ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function byArchiveNewestFirst(a: Orderable, b: Orderable): number {
  const da = a.archivedOn ?? '';
  const db = b.archivedOn ?? '';
  if (da !== db) return da < db ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function orderChanges<T extends Orderable>(changes: readonly T[]): T[] {
  const active = changes.filter((change) => !change.archived);
  const archived = changes.filter((change) => change.archived).sort(byArchiveNewestFirst);

  const ids = new Set(active.map((change) => change.id));
  const waitingOn = new Map<string, Set<string>>(
    active.map((change) => [
      change.id,
      new Set(change.dependsOn.filter((dep) => ids.has(dep) && dep !== change.id)),
    ]),
  );

  /** True when `start` waits, directly or through others, on itself. */
  const inCycle = (start: string): boolean => {
    const seen = new Set<string>();
    const stack = [...(waitingOn.get(start) ?? [])];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (id === start) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(waitingOn.get(id) ?? []));
    }
    return false;
  };

  const ordered: T[] = [];
  let pending = [...active];
  while (pending.length > 0) {
    let free = pending.filter((change) => (waitingOn.get(change.id)?.size ?? 0) === 0);
    // Only cycles are left: release the first cycle member by created, then id.
    if (free.length === 0) free = pending.filter((change) => inCycle(change.id));
    const next = free.sort(byCreatedThenId)[0] as T;
    ordered.push(next);
    pending = pending.filter((change) => change !== next);
    for (const waits of waitingOn.values()) waits.delete(next.id);
  }
  return [...ordered, ...archived];
}

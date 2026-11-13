// Earlier approvals carry over (approvals: Earlier approvals carry over; design D-4).
//
// Before one-click approval, an approval was a signed file `.counterpoint/approvals/<change>.json`
// committed to the host's base branch. On the first daemon start after the upgrade, each host
// registered before it gets those files read once at its base tip: every open change (readable,
// not archived, not built) with a file is recorded as approved. Signatures are not checked. The
// files stay in the repository and have no effect afterwards: a file added later approves nothing.
import { type FrameworkAdapter, findChange, type GitFileReader } from '../framework/port.ts';
import { isChangeId } from '../ids.ts';
import { approveChange, finishCarryOver, pendingCarryOver } from '../store/approvals.ts';
import type { Store } from '../store/db.ts';
import { isBuilt } from './status.ts';

/** Where earlier versions committed approvals. */
export const LEGACY_APPROVALS_DIR = '.counterpoint/approvals';

const APPROVAL_FILE_RE = /^(.+)\.json$/;

export interface CarryOverHost {
  hostId: string;
  baseBranch: string;
  reader: GitFileReader;
  adapter: FrameworkAdapter | null;
}

/** Carries one host's approval files over; returns the changes recorded as approved. */
export async function carryOverHost(
  db: Store,
  host: CarryOverHost,
  now: number = Date.now(),
): Promise<string[]> {
  const tip = await host.reader.resolve(`refs/heads/${host.baseBranch}`);
  const approved: string[] = [];
  if (tip !== null && host.adapter !== null) {
    const names = (await host.reader.list(tip, LEGACY_APPROVALS_DIR))
      .filter((entry) => entry.type === 'blob')
      .map((entry) => APPROVAL_FILE_RE.exec(entry.name)?.[1])
      .filter((id): id is string => id !== undefined && isChangeId(id));
    if (names.length > 0) {
      const snapshot = await host.adapter.snapshot(host.reader, tip);
      for (const change of names) {
        const facts = findChange(snapshot.changes, change);
        if (facts === undefined || facts === null) continue;
        if (facts.archived || facts.unreadable !== null || isBuilt(facts)) continue;
        approveChange(db, { hostId: host.hostId, change, baseCommit: tip, carriedOver: true }, now);
        approved.push(change);
      }
    }
  }
  finishCarryOver(db, host.hostId, now);
  return approved;
}

/**
 * Carries over every host still pending. A host that cannot be read now stays pending and is
 * tried again at the next start; the others are not held back by it.
 */
export async function carryOverApprovals(
  db: Store,
  host: (hostId: string) => CarryOverHost | null,
  log: (event: string, fields: Record<string, unknown>) => void = () => {},
): Promise<void> {
  for (const hostId of pendingCarryOver(db)) {
    const found = host(hostId);
    if (found === null) {
      finishCarryOver(db, hostId);
      continue;
    }
    try {
      const approved = await carryOverHost(db, found);
      if (approved.length > 0) log('approvals-carried-over', { hostId, changes: approved });
    } catch (error) {
      log('approvals-carry-over-failed', { hostId, message: (error as Error).message });
    }
  }
}

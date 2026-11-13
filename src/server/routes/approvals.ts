// The console's approval API (approvals: Approve in one click; Withdraw in one click; runway).
//
//   POST /api/hosts/:hostId/changes/:changeId/approve    approve a Ready to approve change
//   POST /api/hosts/:hostId/changes/:changeId/withdraw   take an approved change off the runway
//   POST /api/hosts/:hostId/approve-all                  approve every Ready to approve change
//   GET  /api/hosts/:hostId/runway                       the runway at the base tip, build order
//
// Every write is a guarded POST (session cookie, exact Origin, JSON body: mutationGuard and
// sessionGuard on every /api write, so a cross-site page cannot approve anything). An approval
// takes effect at once; open consoles hear of it through the watcher's `approval` and `runway`
// events.
import type { Hono } from 'hono';
import { HOST_ID_RE, isChangeId } from '../../core/ids.ts';
import type { ApprovalViews } from '../approval-views.ts';
import type { HostRuntime, HostRuntimes } from '../hosts.ts';

export interface ApprovalRoutesOptions {
  runtimes: HostRuntimes;
  approvals: ApprovalViews;
  /** Called after an approval or withdrawal (the daemon nudges the watcher). */
  onApprovalChanged?: (hostId: string) => void;
}

export function mountApprovalRoutes(app: Hono, options: ApprovalRoutesOptions): void {
  const { runtimes, approvals } = options;
  const changed = (hostId: string) => {
    try {
      options.onApprovalChanged?.(hostId);
    } catch {
      // the console refetches on its own
    }
  };

  /** The host runtime and change id, or the error response for malformed or unknown ids. */
  const target = (c: { req: { param(name: string): string } }) => {
    const hostId = c.req.param('hostId');
    const changeId = c.req.param('changeId');
    if (!HOST_ID_RE.test(hostId)) return { error: 'invalid host id', status: 400 as const };
    if (!isChangeId(changeId)) return { error: 'invalid change id', status: 400 as const };
    const runtime = runtimes.get(hostId);
    if (runtime === null) return { error: 'not found', status: 404 as const };
    return { runtime, changeId };
  };

  app.post('/api/hosts/:hostId/changes/:changeId/approve', async (c) => {
    const found = target(c);
    if ('error' in found) return c.json({ error: found.error }, found.status);
    const result = await approvals.approve(found.runtime, found.changeId);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    changed(found.runtime.host.id);
    return c.json({ approved: true, changed: result.approved });
  });

  app.post('/api/hosts/:hostId/changes/:changeId/withdraw', (c) => {
    const found = target(c);
    if ('error' in found) return c.json({ error: found.error }, found.status);
    const withdrawn = approvals.withdraw(found.runtime, found.changeId);
    if (withdrawn) changed(found.runtime.host.id);
    return c.json({ withdrawn });
  });

  const hostOf = (hostId: string): HostRuntime | null =>
    HOST_ID_RE.test(hostId) ? runtimes.get(hostId) : null;

  app.post('/api/hosts/:hostId/approve-all', async (c) => {
    const runtime = hostOf(c.req.param('hostId'));
    if (runtime === null) return c.json({ error: 'not found' }, 404);
    const approved = await approvals.approveAll(runtime);
    if (approved.length > 0) changed(runtime.host.id);
    return c.json({ approved });
  });

  app.get('/api/hosts/:hostId/runway', async (c) => {
    const runtime = hostOf(c.req.param('hostId'));
    if (runtime === null) return c.json({ error: 'not found' }, 404);
    const runway = await approvals.runway(runtime);
    return c.json({
      hostId: runtime.host.id,
      tip: runway.tip,
      count: runway.count,
      taskCount: runway.taskCount,
      items: runway.onRunway.map((entry) => ({
        changeId: entry.changeId,
        title: entry.title ?? entry.changeId,
        taskCount: entry.taskCount,
        approvedAt: entry.approvedAt,
      })),
    });
  });
}

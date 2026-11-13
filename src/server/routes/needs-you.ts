// The Needs You API (needs-you: One inbox). Read-only, behind the session guard like every /api
// route.
//
//   GET /api/hosts/:hostId/needs-you   { runItems } newest first
//
// The items come from the host's latest run in the store (src/core/runway/run-items.ts): parked
// changes with their reason or question, notes the run left, and a run that ended on something
// only the owner can fix. A later run replaces them.
import type { Hono } from 'hono';
import { HOST_ID_RE } from '../../core/ids.ts';
import { runNeedsYou } from '../../core/runway/run-items.ts';
import type { Store } from '../../core/store/db.ts';
import type { HostRuntimes } from '../hosts.ts';

export interface NeedsYouRoutesOptions {
  runtimes: HostRuntimes;
  store: Store;
}

export function mountNeedsYouRoutes(app: Hono, options: NeedsYouRoutesOptions): void {
  app.get('/api/hosts/:hostId/needs-you', (c) => {
    const hostId = c.req.param('hostId');
    if (!HOST_ID_RE.test(hostId)) return c.json({ error: 'invalid host id' }, 400);
    const runtime = options.runtimes.get(hostId);
    if (runtime === null) return c.json({ error: 'not found' }, 404);
    return c.json({
      hostId: runtime.host.id,
      baseBranch: runtime.host.baseBranch,
      runItems: runNeedsYou(options.store, runtime.host.id),
    });
  });
}

// The Needs You API (MISN-02, APPR-02, D-04). Read-only, behind the session guard like every
// /api route.
//
//   GET /api/hosts/:hostId/needs-you                     { items } newest first
//   GET /api/hosts/:hostId/needs-you/:itemId             { item, lead, changes, command } or
//                                                        404 { state: 'gone', resolved }
//   GET /api/hosts/:hostId/needs-you/:itemId/diff?path=  { path, diff, truncated } or
//                                                        { path, error: 'diff-failed' }
//
// Everything is recomputed from git at the base tip through the approval views (cached per tip);
// nothing here is stored, dismissed or hidden. An item that resolved (re-signed, or inputs back to
// the signed state) is simply no longer there: 404 `gone`, with `resolved: true` when the phase's
// approval is on the runway again.
//
// The diff endpoint is not a file reader (T-01-52): the host id, the item id and the requested
// path are validated before any git call, and the path must be one of the item's change rows
// (the gate-config row included). Diffs come from git and travel as plain text (T-01-50, T-01-54).
import { mkdirSync } from 'node:fs';
import type { Hono } from 'hono';
import { homePaths } from '../../core/host/home.ts';
import { HOST_ID_RE } from '../../core/ids.ts';
import { changedInputDiff, changeView } from '../../core/runway/needs-you.ts';
import type { ApprovalViews } from '../approval-views.ts';
import type { HostRuntime, HostRuntimes } from '../hosts.ts';

export interface NeedsYouRoutesOptions {
  runtimes: HostRuntimes;
  /** The Counterpoint home; diff scratch files live in its private tmp directory. */
  home: string;
  approvals: ApprovalViews;
}

/** Needs You item ids in Phase 1: `phase-{NN}` with an optional decimal sub-phase. */
export const NEEDS_YOU_ITEM_ID_RE = /^phase-\d{2}(\.\d+)?$/;

const MAX_DIFF_PATH = 1024;

export function mountNeedsYouRoutes(app: Hono, options: NeedsYouRoutesOptions): void {
  const { runtimes, home, approvals } = options;
  let tmpDir: string | null = null;
  const scratch = (): string => {
    if (tmpDir === null) {
      const dir = homePaths(home).tmpDir;
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      tmpDir = dir;
    }
    return tmpDir;
  };

  /** The host runtime, or the error response for a malformed or unknown host id. */
  const runtimeFor = (hostId: string): HostRuntime | 'invalid' | 'unknown' => {
    if (!HOST_ID_RE.test(hostId)) return 'invalid';
    return runtimes.get(hostId) ?? 'unknown';
  };

  /** The item, its changed approval and its change view; null when it is not an item now. */
  const resolveItem = async (runtime: HostRuntime, itemId: string) => {
    const snapshot = await approvals.needsYou(runtime);
    const item = snapshot.items.find((candidate) => candidate.id === itemId);
    const changed = snapshot.changed.find((candidate) => candidate.phaseId === item?.phaseId);
    if (item === undefined || changed === undefined || snapshot.tip === null) return null;
    const view = changeView({
      item,
      statement: changed.statement,
      changes: changed.changes,
      gatesChange: changed.gatesChange,
      tip: snapshot.tip,
      baseBranch: runtime.host.baseBranch,
      hostId: runtime.host.id,
    });
    return { item, changed, view, tip: snapshot.tip };
  };

  const gone = async (runtime: HostRuntime, phaseId: string) => {
    const state = await approvals.state(runtime, phaseId).catch(() => null);
    return { state: 'gone' as const, resolved: state?.state === 'on-runway' };
  };

  app.get('/api/hosts/:hostId/needs-you', async (c) => {
    const runtime = runtimeFor(c.req.param('hostId'));
    if (runtime === 'invalid') return c.json({ error: 'invalid host id' }, 400);
    if (runtime === 'unknown') return c.json({ error: 'not found' }, 404);
    const snapshot = await approvals.needsYou(runtime);
    return c.json({
      hostId: runtime.host.id,
      baseBranch: runtime.host.baseBranch,
      tip: snapshot.tip,
      items: snapshot.items,
    });
  });

  app.get('/api/hosts/:hostId/needs-you/:itemId', async (c) => {
    const runtime = runtimeFor(c.req.param('hostId'));
    const itemId = c.req.param('itemId');
    if (runtime === 'invalid') return c.json({ error: 'invalid host id' }, 400);
    if (!NEEDS_YOU_ITEM_ID_RE.test(itemId)) return c.json({ error: 'invalid item id' }, 400);
    if (runtime === 'unknown') return c.json({ error: 'not found' }, 404);

    const found = await resolveItem(runtime, itemId);
    if (found === null) return c.json(await gone(runtime, itemId.slice('phase-'.length)), 404);
    return c.json({
      hostId: runtime.host.id,
      item: found.item,
      lead: found.view.lead,
      changes: found.view.changes,
      command: found.view.command,
    });
  });

  app.get('/api/hosts/:hostId/needs-you/:itemId/diff', async (c) => {
    const runtime = runtimeFor(c.req.param('hostId'));
    const itemId = c.req.param('itemId');
    const path = c.req.query('path');
    if (runtime === 'invalid') return c.json({ error: 'invalid host id' }, 400);
    if (!NEEDS_YOU_ITEM_ID_RE.test(itemId)) return c.json({ error: 'invalid item id' }, 400);
    if (typeof path !== 'string' || path === '' || path.length > MAX_DIFF_PATH) {
      return c.json({ error: 'invalid path' }, 400);
    }
    if (runtime === 'unknown' || runtime.adapter === null) {
      return c.json({ error: 'not found' }, 404);
    }

    const found = await resolveItem(runtime, itemId);
    if (found === null) return c.json(await gone(runtime, itemId.slice('phase-'.length)), 404);
    // Only paths on this item's change list are ever diffed (T-01-52).
    if (!found.view.changes.some((row) => row.path === path)) {
      return c.json({ error: 'path is not one of this item’s changes' }, 400);
    }

    try {
      const result = await changedInputDiff({
        root: runtime.host.root,
        reader: runtime.reader,
        adapter: runtime.adapter,
        statement: found.changed.statement,
        changes: found.changed.changes,
        gatesChange: found.changed.gatesChange,
        tip: found.tip,
        phaseId: found.item.phaseId,
        path,
        tmpDir: scratch(),
      });
      return c.json(result);
    } catch {
      // One file's diff failing never affects the others; the page shows it inside that file.
      return c.json({ path, error: 'diff-failed' });
    }
  });
}

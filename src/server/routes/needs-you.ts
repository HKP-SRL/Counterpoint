// The Needs You API (needs-you: One inbox; Change view reads like a PR review). Read-only, behind
// the session guard like every /api route.
//
//   GET /api/hosts/:hostId/needs-you                     { items } newest first
//   GET /api/hosts/:hostId/needs-you/:itemId             { item, lead, changes, command } or
//                                                        404 { state: 'gone', resolved }
//   GET /api/hosts/:hostId/needs-you/:itemId/diff?path=  { path, diff, truncated } or
//                                                        { path, error: 'diff-failed' }
//
// Everything is recomputed from git at the base tip through the approval views (cached per tip);
// nothing here is stored, dismissed or hidden. An item that resolved (re-signed, or inputs back to
// the signed state) is simply no longer there: 404 `gone`, with `resolved: true` when the change's
// approval is on the runway again.
//
// The diff endpoint is not a file reader (it must not become a way to read arbitrary files): the
// host id, the item id and the requested path are validated before any git call, and the path must
// be one of the item's change rows (the gate-config row included). Diffs come from git and travel
// as plain text (never rendered as HTML, never a path outside the repo).
import { mkdirSync } from 'node:fs';
import type { Hono } from 'hono';
import { homePaths } from '../../core/host/home.ts';
import { HOST_ID_RE, isChangeId } from '../../core/ids.ts';
import { changedInputDiff, driftView } from '../../core/runway/needs-you.ts';
import type { ApprovalViews } from '../approval-views.ts';
import type { HostRuntime, HostRuntimes } from '../hosts.ts';

export interface NeedsYouRoutesOptions {
  runtimes: HostRuntimes;
  /** The Counterpoint home; diff scratch files live in its private tmp directory. */
  home: string;
  approvals: ApprovalViews;
}

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

  /** The item, its changed approval and its drift view; null when it is not an item now. */
  const resolveItem = async (runtime: HostRuntime, itemId: string) => {
    const snapshot = await approvals.needsYou(runtime);
    const item = snapshot.items.find((candidate) => candidate.id === itemId);
    const changed = snapshot.changed.find((candidate) => candidate.changeId === item?.changeId);
    if (item === undefined || changed === undefined || snapshot.tip === null) return null;
    const view = driftView({
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

  const gone = async (runtime: HostRuntime, changeId: string) => {
    const state = await approvals.state(runtime, changeId).catch(() => null);
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
    if (!isChangeId(itemId)) return c.json({ error: 'invalid item id' }, 400);
    if (runtime === 'unknown') return c.json({ error: 'not found' }, 404);

    const found = await resolveItem(runtime, itemId);
    if (found === null) return c.json(await gone(runtime, itemId), 404);
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
    if (!isChangeId(itemId)) return c.json({ error: 'invalid item id' }, 400);
    if (typeof path !== 'string' || path === '' || path.length > MAX_DIFF_PATH) {
      return c.json({ error: 'invalid path' }, 400);
    }
    if (runtime === 'unknown' || runtime.adapter === null) {
      return c.json({ error: 'not found' }, 404);
    }

    const found = await resolveItem(runtime, itemId);
    if (found === null) return c.json(await gone(runtime, itemId), 404);
    // Only paths on this item's change list are ever diffed (no arbitrary file reads).
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
        changeId: found.item.changeId,
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

// The console's approval API (signed-approvals: Console prepares, terminal signs; runway).
//
//   POST /api/hosts/:hostId/changes/:changeId/approval   preview only: recompute the statement
//        at the base tip and return what a signature would bind plus the terminal command. It
//        refuses exactly when `counterpoint approve` would (no trusted key, no or changed integrity
//        baseline, change not ready / built / unreadable / unknown) and never shows a command then.
//        It writes nothing: signing happens only in the owner's terminal, which re-derives the
//        statement itself (recompute, then print). Guarded by the session cookie, the exact
//        Origin and a JSON body (mutationGuard + sessionGuard on every /api write, so a
//        cross-site page cannot trigger it).
//   GET  /api/hosts/:hostId/runway   the runway recomputed from git at the base tip.
//
// The command is assembled only from the validated host and change ids (no injected arguments).
import type { Hono } from 'hono';
import { checkIntegrity, type IntegrityState } from '../../core/approvals/integrity.ts';
import { prepareApproval } from '../../core/approvals/prepare.ts';
import { readTrust } from '../../core/approvals/trust-store.ts';
import { HOST_ID_RE, isChangeId } from '../../core/ids.ts';
import type { ApprovalViews } from '../approval-views.ts';
import type { HostRuntimes } from '../hosts.ts';

export interface ApprovalRoutesOptions {
  runtimes: HostRuntimes;
  /** The Counterpoint home (trusted key, integrity baselines). */
  home: string;
  approvals: ApprovalViews;
}

/** `counterpoint approve {host} {change}`; both ids have already matched the strict id rules. */
export function approveCommandLine(hostId: string, changeId: string): string {
  if (!HOST_ID_RE.test(hostId) || !isChangeId(changeId)) {
    throw new Error('refusing to build a command from an unvalidated id');
  }
  return `counterpoint approve ${hostId} ${changeId}`;
}

export function mountApprovalRoutes(app: Hono, options: ApprovalRoutesOptions): void {
  const { runtimes, home, approvals } = options;

  app.post('/api/hosts/:hostId/changes/:changeId/approval', async (c) => {
    const hostId = c.req.param('hostId');
    const changeId = c.req.param('changeId');
    if (!HOST_ID_RE.test(hostId)) return c.json({ error: 'invalid host id' }, 400);
    if (!isChangeId(changeId)) return c.json({ error: 'invalid change id' }, 400);
    const runtime = runtimes.get(hostId);
    if (runtime === null) return c.json({ error: 'not found' }, 404);

    // 1. The trusted key.
    const trust = readTrust(home);
    if (!trust.ok) {
      return c.json(
        { refused: trust.error === 'no-trusted-key' ? 'no-trusted-key' : 'trust-unusable' },
        409,
      );
    }

    // 2. The integrity of the host's execution-capable git surface.
    let integrity: IntegrityState;
    try {
      integrity = await checkIntegrity(home, runtime.host);
    } catch {
      return c.json({ refused: 'integrity-unreadable' }, 409);
    }
    if (integrity.state === 'no-baseline') return c.json({ refused: 'no-baseline' }, 409);
    if (integrity.state === 'changed') {
      return c.json({ refused: 'integrity-changed', changes: integrity.changes }, 409);
    }

    // 3. The statement at the local base tip.
    if (runtime.adapter === null) return c.json({ refused: 'no-framework' }, 409);
    const prepared = await prepareApproval({
      hostId,
      baseBranch: runtime.host.baseBranch,
      changeId,
      reader: runtime.reader,
      adapter: runtime.adapter,
    });
    if (!prepared.ok) {
      switch (prepared.reason) {
        case 'not-found':
          return c.json({ refused: 'not-found' }, 404);
        case 'not-ready':
          return c.json({ refused: 'not-ready', reason: prepared.notReadyReason }, 409);
        case 'built':
          return c.json({ refused: 'built' }, 409);
        case 'unreadable':
          return c.json(
            { refused: 'unreadable', file: prepared.file, reason: prepared.detail },
            409,
          );
        case 'no-base':
          return c.json({ refused: 'no-base' }, 409);
        case 'gates-config':
          return c.json({ refused: 'gates-config', reason: prepared.detail }, 409);
      }
    }

    const { statement } = prepared;
    return c.json({
      prepared: {
        change: prepared.change,
        baseBranch: runtime.host.baseBranch,
        tip: prepared.tip,
        inputs: prepared.inputs.map((input) => ({
          label: input.label,
          path: input.path,
          kind: input.kind,
          digest: input.digest,
        })),
        combined: statement.inputs.combined,
        draft: { state: 'none' },
        gates: { state: statement.gates.state, digest: statement.gates.digest },
        fingerprint: prepared.fingerprint,
        ownerSteps: prepared.ownerSteps,
        itemPath: prepared.itemPath,
        command: approveCommandLine(hostId, changeId),
      },
    });
  });

  app.get('/api/hosts/:hostId/runway', async (c) => {
    const hostId = c.req.param('hostId');
    if (!HOST_ID_RE.test(hostId)) return c.json({ error: 'invalid host id' }, 400);
    const runtime = runtimes.get(hostId);
    if (runtime === null) return c.json({ error: 'not found' }, 404);

    const runway = await approvals.runway(runtime);
    const view = await runtime.view().catch(() => null);
    const changes = view?.snapshot?.changes ?? [];
    const unreadable = new Set(
      changes
        .filter((change) => !change.archived && change.unreadable !== null)
        .map((change) => change.id),
    );
    // Runway order is build order: the position of each change in the snapshot.
    const position = new Map(
      changes.filter((change) => !change.archived).map((change, index) => [change.id, index]),
    );
    const at = (id: string) => position.get(id) ?? Number.MAX_SAFE_INTEGER;
    const items = [...runway.onRunway]
      .sort((a, b) => at(a.changeId) - at(b.changeId) || (a.changeId < b.changeId ? -1 : 1))
      .map((entry) => ({
        changeId: entry.changeId,
        title: entry.title ?? entry.changeId,
        taskCount: entry.taskCount,
        signedAt: entry.signedAt,
        commit: entry.commit,
        unreadable: unreadable.has(entry.changeId),
      }));
    return c.json({
      hostId,
      tip: runway.tip,
      count: runway.count,
      taskCount: runway.taskCount,
      changedCount: runway.changed.length,
      items,
    });
  });
}

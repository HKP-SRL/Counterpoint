// The console's approval API (APPR-01 console half, MISN-01).
//
//   POST /api/hosts/:hostId/phases/:phaseId/approval   preview only: recompute the statement at
//        the base tip and return what a signature would bind plus the terminal command. It refuses
//        exactly when `counterpoint approve` would (no trusted key, no or changed integrity
//        baseline, phase not ready / built / unreadable / unknown) and never shows a command then.
//        It writes nothing: signing happens only in the owner's terminal, which re-derives the
//        statement itself (RESEARCH Pattern 4). Guarded by the session cookie, the exact Origin
//        and a JSON body (01-03 mutationGuard + sessionGuard on every /api write, T-01-47).
//   GET  /api/hosts/:hostId/runway   the runway recomputed from git at the base tip.
//
// The command is assembled only from the validated host and phase ids (RESEARCH Pitfall 8).
import type { Hono } from 'hono';
import { checkIntegrity, type IntegrityState } from '../../core/approvals/integrity.ts';
import { prepareApproval } from '../../core/approvals/prepare.ts';
import { readTrust } from '../../core/approvals/trust-store.ts';
import { comparePhaseNumbers } from '../../core/framework/port.ts';
import { HOST_ID_RE, PHASE_ID_RE } from '../../core/ids.ts';
import type { ApprovalViews } from '../approval-views.ts';
import type { HostRuntimes } from '../hosts.ts';

export interface ApprovalRoutesOptions {
  runtimes: HostRuntimes;
  /** The Counterpoint home (trusted key, integrity baselines). */
  home: string;
  approvals: ApprovalViews;
}

/** `counterpoint approve {host} {phase}`; both ids have already matched the strict id rules. */
export function approveCommandLine(hostId: string, phaseId: string): string {
  if (!HOST_ID_RE.test(hostId) || !PHASE_ID_RE.test(phaseId)) {
    throw new Error('refusing to build a command from an unvalidated id');
  }
  return `counterpoint approve ${hostId} ${phaseId}`;
}

const phaseTuple = (phaseId: string): number[] => phaseId.split('.').map(Number);

export function mountApprovalRoutes(app: Hono, options: ApprovalRoutesOptions): void {
  const { runtimes, home, approvals } = options;

  app.post('/api/hosts/:hostId/phases/:phaseId/approval', async (c) => {
    const hostId = c.req.param('hostId');
    const phaseId = c.req.param('phaseId');
    if (!HOST_ID_RE.test(hostId)) return c.json({ error: 'invalid host id' }, 400);
    if (!PHASE_ID_RE.test(phaseId)) return c.json({ error: 'invalid phase id' }, 400);
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
      phaseId,
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
        phase: prepared.phase,
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
        prerequisites: prepared.prerequisites,
        itemPath: prepared.itemPath,
        command: approveCommandLine(hostId, phaseId),
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
    const unreadable = new Set(
      (view?.snapshot?.phases ?? [])
        .filter((phase) => phase.unreadable !== null)
        .map((phase) => phase.id),
    );
    const items = [...runway.onRunway]
      .sort((a, b) => comparePhaseNumbers(phaseTuple(a.phaseId), phaseTuple(b.phaseId)))
      .map((entry) => ({
        phaseId: entry.phaseId,
        name: entry.name ?? '',
        planCount: entry.planCount,
        signedAt: entry.signedAt,
        commit: entry.commit,
        unreadable: unreadable.has(entry.phaseId),
      }));
    return c.json({
      hostId,
      tip: runway.tip,
      count: runway.count,
      planCount: runway.planCount,
      changedCount: runway.changed.length,
      items,
    });
  });
}

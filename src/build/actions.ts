// The action catalog (owner-inbox D-2; question-cards: Counterpoint carries out the answer). Each
// action is a server-side operation with typed parameters, attached to an option only by
// Counterpoint's own code. Picking the option runs it with no further step for the owner; the
// returned line is the card's outcome.
//
// - refresh-environment-and-resume: read the owner's login shell again; if what the run missed is
//   now found, resume (else say what is still missing and leave the card open to pick again).
// - retry-parked: leave the failure, the card's answer and the owner's note for the change's next
//   builder session. The change is still on the runway, so the next run builds it.
// - resume-run: start a run of the changes the stopped run did not build.
// - set-git-identity: the owner's name and email in their global git config.
// - restart-into-install: hand over to the daemon's restarter (D-10).
// - drop-drafts: delete a change's design drafts, which ends its hold (design-drafts D-12).
// - add-ask-tool: the one-time setup of the ask tool for the owner's interactive sessions.
// - tick-owner-step, perform-owner-step, land-owner-step, discard-owner-step: owner steps
//   (owner-steps.ts): Done ticks the step through a planning write, Do it for me runs it in a
//   worktree, Land it lands the result, Discard drops it.

import { execa } from 'execa';
import { gitBinary } from '../core/git/run.ts';
import { addChangeNote, type CardAction, type CardRow, reopenCard } from '../core/store/cards.ts';
import type { Store } from '../core/store/db.ts';
import { getRun, listRunChanges } from '../core/store/runs.ts';
import type { ActionRunner, CardDesk } from '../server/cards.ts';
import type { Orchestrator } from './orchestrator.ts';
import type { OwnerEnv } from './owner-env.ts';
import { stopCause } from './run-cards.ts';
import { canRun } from './services.ts';
import { missingRunTools } from './tools.ts';

export interface ActionContext {
  db: Store;
  desk: CardDesk;
  orchestrator: Pick<Orchestrator, 'start' | 'running'>;
  /** Reads the owner's login environment now. */
  ownerEnv: () => Promise<OwnerEnv>;
  /** Restarts the daemon into the installed Counterpoint (D-10). */
  restart?: (when: 'after-run' | 'now') => Promise<string>;
  /** Sets up the ask tool for interactive sessions (ask-session.ts). */
  addAskTool?: (card: CardRow) => Promise<string>;
  /** Drop a change's design drafts (design-drafts D-12): its hold ends. */
  dropDrafts?: (hostId: string, change: string) => Promise<boolean>;
  /** Owner steps (group 4). */
  ownerSteps?: (action: CardAction, card: CardRow, note: string | null) => Promise<string>;
  now?: () => number;
}

/** The changes a stopped run did not get to, still worth building. */
function unbuilt(db: Store, runId: string): string[] {
  return listRunChanges(db, runId)
    .filter(
      (change) =>
        change.state === 'queued' || change.state === 'building' || change.state === 'stopped',
    )
    .map((change) => change.change);
}

async function resumeRun(context: ActionContext, runId: string): Promise<string> {
  const run = getRun(context.db, runId);
  if (run === undefined) throw new Error('That run is no longer in the store.');
  if (context.orchestrator.running() !== null) return 'A run is already going; nothing to resume.';
  const now = (context.now ?? Date.now)();
  const stopAt = run.stopAt !== null && run.stopAt > now ? run.stopAt : null;
  const changes = unbuilt(context.db, runId);
  let result = await context.orchestrator.start(run.hostId, {
    changes: changes.length > 0 ? changes : null,
    stopAt,
  });
  // A change that left the runway since: build what is on it now.
  if (!result.ok && result.status === 409 && changes.length > 0 && /runway/.test(result.error)) {
    result = await context.orchestrator.start(run.hostId, { changes: null, stopAt });
  }
  if (!result.ok) throw new Error(result.error);
  return `Resumed: run ${result.runId} started.`;
}

async function refreshAndResume(
  context: ActionContext,
  card: CardRow,
  runId: string,
): Promise<string> {
  const owner = await context.ownerEnv();
  if (owner.fallback !== null) {
    reopenCard(context.db, card.id);
    return `Still can't read your login shell: ${owner.fallback}`;
  }
  const run = getRun(context.db, runId);
  const cause = stopCause(run?.endDetail ?? '');
  const path = owner.env.PATH ?? '';
  const missing = [
    ...missingRunTools(owner.env),
    ...(cause.kind === 'missing-program'
      ? cause.programs.filter((program) => !canRun(program, path))
      : []),
  ];
  if (missing.length > 0) {
    reopenCard(context.db, card.id);
    return `Still not on your login shell's PATH: ${[...new Set(missing)].join(', ')}. Install it, then pick this again.`;
  }
  context.desk.doneForYou(card.hostId, 'Re-read your login environment.');
  if (run === undefined || run.state !== 'ended' || run.endReason === 'finished') {
    return 'Re-read your environment; the next run uses it.';
  }
  return resumeRun(context, runId);
}

function retryNote(card: CardRow, note: string | null, reason: string | null): string {
  const lines: string[] = [];
  if (card.kind === 'builder-question') {
    const picked = card.options[card.answer ?? -1]?.label ?? '';
    lines.push(`You asked the owner: "${card.question}". The owner answered: ${picked}.`);
  } else {
    lines.push(`This change parked in an earlier run: ${reason ?? card.why}`);
  }
  if (note !== null && note !== '') lines.push(`The owner's note: ${note}`);
  return lines.join('\n');
}

export function createActionRunner(context: ActionContext): ActionRunner {
  return async (action, { card, note }) => {
    switch (action.type) {
      case 'resume-run':
        return resumeRun(context, action.runId);
      case 'refresh-environment-and-resume':
        return refreshAndResume(context, card, action.runId);
      case 'retry-parked': {
        if (card.hostId === null) throw new Error('This card has no project.');
        const row = listRunChanges(context.db, action.runId).find(
          (change) => change.change === action.change,
        );
        addChangeNote(context.db, {
          hostId: card.hostId,
          change: action.change,
          text: retryNote(card, note, row?.reason ?? null),
          cardId: card.id,
        });
        return context.orchestrator.running() === null
          ? 'Queued for the next run with your answer.'
          : 'Queued: the next run that builds it gets your answer.';
      }
      case 'set-git-identity': {
        for (const [key, value] of [
          ['user.name', action.name],
          ['user.email', action.email],
        ] as const) {
          // The owner's own global config, as their `git config --global` would write it.
          await execa(gitBinary(), ['config', '--global', key, value], {
            stdin: 'ignore',
            timeout: 15_000,
          });
        }
        context.desk.doneForYou(
          card.hostId,
          `Set your git identity to ${action.name} <${action.email}>.`,
        );
        return `Commits now carry ${action.name} <${action.email}>.`;
      }
      case 'restart-into-install':
        if (context.restart === undefined) throw new Error('Restarting is not available.');
        return context.restart(action.when);
      case 'add-ask-tool':
        if (context.addAskTool === undefined) throw new Error('Setting up is not available.');
        return context.addAskTool(card);
      case 'drop-drafts': {
        if (card.hostId === null) throw new Error('This card has no project.');
        if (context.dropDrafts === undefined) throw new Error('Drafts are not available.');
        const dropped = await context.dropDrafts(card.hostId, action.change);
        return dropped
          ? `Dropped the drafts of ${action.change}; the next run builds it without them.`
          : `${action.change} has no drafts now; the next run builds it.`;
      }
      case 'tick-owner-step':
      case 'perform-owner-step':
      case 'land-owner-step':
      case 'discard-owner-step':
        if (context.ownerSteps === undefined) throw new Error('Owner steps are not available.');
        return context.ownerSteps(action, card, note);
      case 'later':
        // The desk defers the card instead of answering it; nothing to run.
        return 'Later: it stays here.';
    }
  };
}

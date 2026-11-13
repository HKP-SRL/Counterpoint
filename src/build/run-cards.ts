// What the host's latest run left for the owner, as question cards (owner-inbox 2.4; needs-you:
// Every item can be answered; Options for a parked change).
//
// - A change parked on a gate or a stuck builder: retry with the failure as a note (recommended),
//   re-plan it, or leave it parked.
// - A change parked on the builder's ask-first questions: one card per question, the builder's
//   options and recommendation; any answer retries the change with the answer as a note.
// - A run that stopped on something only the owner can fix: named by its root cause ("not logged
//   in", not the "no context window" it led to), with Counterpoint's fix where the catalog has one
//   (re-read the environment and resume) and otherwise the one step only the owner can take. A
//   sign-in that kept failing while claude holds a login may be an outage: resume, nothing more.
// - A note the run left (its login shell could not be read): re-read the environment.
//
// The cards are recomputed from the store: each has a key, so raising it again finds the same card,
// and a card whose cause is gone (a later run replaced it) resolves itself.
import type { CardOption, NewCard } from '../core/store/cards.ts';
import type { Store } from '../core/store/db.ts';
import { type ChangeQuestion, latestRun, listRunChanges } from '../core/store/runs.ts';
import { HOLD_REASON, holdCard } from '../drafts/hold.ts';
import type { CardDesk } from '../server/cards.ts';
import { OUTAGE_PREFIX } from './auth-failures.ts';
import { SERVICE_DOWN_PREFIX } from './gates.ts';

const clip = (text: string, max = 300): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
};

/** Why a run stopped, by root cause. */
export type StopCause =
  | { kind: 'sign-in-outage' }
  | { kind: 'not-logged-in' }
  | { kind: 'service-down'; service: string }
  | { kind: 'missing-program'; programs: string[] }
  | { kind: 'account'; what: string }
  | { kind: 'config' }
  | { kind: 'other' };

/**
 * The root cause in a run's stop reason. A session that says it is not logged in is named so even
 * when it surfaced as a failed context-window calibration.
 */
export function stopCause(detail: string): StopCause {
  // First: its last output lines may say anything (gates.ts describeServiceDown).
  const service = new RegExp(`^${SERVICE_DOWN_PREFIX} "([^"]{1,100})" would not start`).exec(
    detail,
  );
  if (service !== null) return { kind: 'service-down', service: service[1] as string };
  // A sign-in that kept failing while claude holds a login (auth-failures.ts): also before the
  // phrase checks, since its detail quotes the failure ("authentication_failed", "Failed to
  // authenticate").
  if (detail.startsWith(OUTAGE_PREFIX)) return { kind: 'sign-in-outage' };
  if (
    /not logged in|please run \/login|not signed in|authentication[_ ]failed|oauth/i.test(detail)
  ) {
    return { kind: 'not-logged-in' };
  }
  if (/not on your login shell's PATH|not an executable file|could not be found/i.test(detail)) {
    const programs = [...detail.matchAll(/"([^"\s]{1,100})"/g)]
      .map((match) => match[1] as string)
      .filter((name) => !name.startsWith('command -v'));
    return { kind: 'missing-program', programs: [...new Set(programs)] };
  }
  if (/credit|spend limit|billing|account (is )?on hold/i.test(detail)) {
    return { kind: 'account', what: clip(detail, 200) };
  }
  if (/host config cannot be read|config\.ya?ml/i.test(detail)) return { kind: 'config' };
  return { kind: 'other' };
}

const LEAVE_STOPPED: CardOption = {
  label: 'Leave the run stopped',
  consequence: 'Nothing builds until you start a run.',
};

function stoppedCard(hostId: string, runId: string, detail: string): NewCard {
  const cause = stopCause(detail);
  const resume = (label: string): CardOption => ({
    label,
    consequence: 'Counterpoint starts the changes this run did not build.',
    action: { type: 'resume-run', runId },
  });
  const base = {
    hostId,
    key: `run-stopped:${runId}`,
    kind: 'run-stopped',
    source: 'run' as const,
    runId,
    recommended: 0,
    reversible: true,
    blocking: true,
  };
  switch (cause.kind) {
    case 'sign-in-outage':
      return {
        ...base,
        question: 'Sign-in failed, maybe an outage. Resume?',
        why: clip(detail.slice(OUTAGE_PREFIX.length)),
        options: [resume('Resume the run'), LEAVE_STOPPED],
      };
    case 'not-logged-in':
      return {
        ...base,
        question: 'Claude Code is not logged in. Log in, then resume the run?',
        why: 'Every agent session fails until you do: run `claude` in a terminal and type /login.',
        options: [resume("I've logged in: resume the run"), LEAVE_STOPPED],
      };
    case 'missing-program': {
      const names = cause.programs.length === 0 ? 'a program' : cause.programs.join(', ');
      return {
        ...base,
        question: `The run can't find ${names}. Re-read your environment and resume?`,
        why: clip(
          `Install it or put it on your shell's PATH first; no restart is needed. ${detail}`,
        ),
        options: [
          {
            label: 'Re-read my environment and resume',
            consequence: 'Counterpoint reads your login shell again and resumes if it is found.',
            action: { type: 'refresh-environment-and-resume', runId },
          },
          LEAVE_STOPPED,
        ],
      };
    }
    case 'service-down':
      return {
        ...base,
        question: `The ${cause.service} service won't start. Resume once it's running?`,
        why: clip(detail),
        options: [resume("It's running: resume the run"), LEAVE_STOPPED],
      };
    case 'account':
      return {
        ...base,
        question: 'Your Claude account stopped the run. Resume once it is sorted?',
        why: cause.what,
        options: [resume("It's sorted: resume the run"), LEAVE_STOPPED],
      };
    case 'config':
      return {
        ...base,
        question: "The project's Counterpoint config can't be read. Resume once it is fixed?",
        why: clip(detail),
        options: [resume("I've fixed it: resume the run"), LEAVE_STOPPED],
      };
    default:
      return {
        ...base,
        question: 'The run stopped. Resume it?',
        why: clip(detail),
        options: [resume('Resume the run'), LEAVE_STOPPED],
      };
  }
}

/**
 * How a change held back by an irreversible question its builder asked in Needs You starts its
 * parked reason (after "Not built: "). The question's own card is what the owner answers, so no
 * parked card is raised for it; the answer reaches the change's next session.
 */
export const ASKED_PARK = 'Waits on your answer to ';

export function askParkWhy(count: number): string {
  return `${ASKED_PARK}${count === 1 ? 'a question' : `${count} questions`} its builder asked in Needs You.`;
}

function parkedOnAsk(reason: string | null): boolean {
  return (reason ?? '').replace(/^Not built: /, '').startsWith(ASKED_PARK);
}

function parkedCard(hostId: string, runId: string, change: string, reason: string): NewCard {
  return {
    hostId,
    key: `parked:${runId}:${change}`,
    kind: 'parked',
    source: 'change',
    runId,
    change,
    question: `${change} parked. Retry it?`,
    why: clip(reason),
    options: [
      {
        label: 'Retry with this note',
        consequence:
          'It builds again in the next run; its first session gets the failure and your note.',
        action: { type: 'retry-parked', runId, change },
      },
      {
        label: 'Re-plan it',
        consequence: 'It stays parked; open the change and revise its plan.',
      },
      { label: 'Leave it parked', consequence: 'Nothing happens until you retry it.' },
    ],
    recommended: 0,
    reversible: true,
    blocking: true,
  };
}

function questionCard(
  hostId: string,
  runId: string,
  change: string,
  question: ChangeQuestion,
  index: number,
): NewCard | null {
  const labels = question.options.slice(0, 4);
  if (labels.length < 2) return null;
  const recommended =
    question.recommended !== null && question.recommended < labels.length
      ? question.recommended
      : 0;
  const waiting =
    question.waiting.length > 0 ? ` Waiting on it: ${question.waiting.join(', ')}.` : '';
  return {
    hostId,
    key: `question:${runId}:${change}:${index}`,
    kind: 'builder-question',
    source: 'change',
    runId,
    change,
    question: clip(question.text, 500),
    why: clip(`${change} asked before doing something it cannot undo.${waiting}`),
    options: labels.map((label) => ({
      label: clip(label, 120),
      consequence: 'The change builds again in the next run with this answer.',
      action: { type: 'retry-parked' as const, runId, change },
    })),
    recommended,
    reversible: false,
    blocking: true,
  };
}

function noticeCard(hostId: string, runId: string, notice: string, index: number): NewCard {
  const shell = /login shell/i.test(notice);
  return {
    hostId,
    key: `notice:${runId}:${index}`,
    kind: 'notice',
    source: 'run',
    runId,
    question: shell
      ? "Your login shell couldn't be read. Re-read it now?"
      : clip(`${notice} Look into it?`, 500),
    why: shell
      ? clip(`${notice} Tools your shell adds may be missing.`)
      : 'Nothing stopped; it may matter for the next run.',
    options: shell
      ? [
          {
            label: 'Re-read my environment',
            consequence: 'Counterpoint reads your login shell again and resumes if the run ended.',
            action: { type: 'refresh-environment-and-resume', runId },
          },
          { label: 'Ignore it', consequence: 'The next run reads your login shell again anyway.' },
        ]
      : [
          { label: 'Got it', consequence: 'Nothing changes.' },
          { label: 'Ignore it', consequence: 'Nothing changes.' },
        ],
    recommended: 0,
    reversible: true,
    blocking: false,
  };
}

/** The cards the host's latest run calls for now. */
export function runCards(db: Store, hostId: string): NewCard[] {
  const run = latestRun(db, hostId);
  if (run === undefined) return [];
  const cards: NewCard[] = [];
  if (run.state === 'ended' && (run.endReason === 'error' || run.endReason === 'refused')) {
    cards.push(stoppedCard(hostId, run.id, run.endDetail ?? 'The run stopped on an error.'));
  }
  run.notices.forEach((notice, index) => {
    cards.push(noticeCard(hostId, run.id, notice, index));
  });
  for (const change of listRunChanges(db, run.id)) {
    // A change its design drafts held (design-drafts D-12): one card per change and run.
    if (change.state === 'skipped' && (change.reason ?? '').startsWith(HOLD_REASON)) {
      cards.push(holdCard(hostId, run.id, change.change, change.reason ?? ''));
      continue;
    }
    if (change.state !== 'parked') continue;
    const asked = change.questions
      .map((question, index) => questionCard(hostId, run.id, change.change, question, index))
      .filter((card): card is NewCard => card !== null);
    if (asked.length > 0) cards.push(...asked);
    else if (!parkedOnAsk(change.reason)) {
      cards.push(parkedCard(hostId, run.id, change.change, change.reason ?? 'Parked.'));
    }
  }
  return cards;
}

const RUN_PREFIXES = ['run-stopped:', 'parked:', 'question:', 'notice:', 'drafts-hold:'] as const;

/**
 * Raises the cards the latest run calls for and resolves the ones it no longer does (a later run
 * replaced them). Cheap enough to run on every read of Needs You and every run event.
 */
export function syncRunCards(desk: CardDesk, hostId: string): void {
  const cards = runCards(desk.store, hostId);
  const keep = new Set(cards.map((card) => card.key ?? ''));
  for (const card of cards) {
    try {
      desk.raise(card);
    } catch {
      // a card the model refuses (text too long, say) is left out, never a failed read
    }
  }
  for (const prefix of RUN_PREFIXES) {
    desk.resolveMissing(hostId, prefix, keep, 'A later run replaced it.');
  }
}

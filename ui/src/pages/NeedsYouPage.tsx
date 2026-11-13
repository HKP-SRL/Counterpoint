// Needs You (`/h/{hostId}/needs-you`, needs-you: One inbox; Builder questions in Needs You): what
// the host's last build run left for the owner, newest first as the server serves it:
// - a change that parked because its remaining tasks wait on an ask-first question shows the
//   question, its options and the one the builder recommends, and the tasks that wait on it;
// - any other parked change shows its reason, the failing gate's last lines and every attempt;
// - a note the run left while it went on (it could not read the login shell, say);
// - a run that stopped on something only the owner can fix, with what to do.
// A `run` event refetches the list (live.ts). Nothing here is dismissed or hidden: a later run
// replaces it.
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Kbd } from '@astryxdesign/core/Kbd';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useToast } from '@astryxdesign/core/Toast';
import { VStack } from '@astryxdesign/core/VStack';
import { keepPreviousData, queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  apiGet,
  apiPostAnswer,
  hostsQuery,
  needsYouCountsQuery,
  queryKeys,
  type WaitingElsewhere,
  waitingElsewhere,
} from '../api';
import { isChangeId } from '../ids';
import {
  enterAction,
  type FocusSince,
  focusAfterAnswer,
  type InboxCardKeys,
  type InboxFocus,
  type InboxKeyAction,
  inboxKey,
  isSettling,
  noteKey,
  resolveFocus,
} from '../inbox-keys';
import { useNotificationPermission } from '../notify';

export type RunAttempt = {
  attempt: number;
  gate: string;
  verdict: 'pass' | 'fail' | 'skipped' | 'not-run' | null;
  reason: string | null;
  exitCode: number | null;
  tail: string | null;
  logPath: string;
};

/** A question the builder asked before doing something it cannot undo. */
export type BuilderQuestion = {
  /** The task it is about, as the builder named it. */
  task: string | null;
  text: string;
  options: string[];
  /** Index into `options` of the builder's recommendation, or null. */
  recommended: number | null;
  /** Tasks that wait on the answer. */
  waiting: string[];
};

export type RunItem = {
  id: string;
  kind: 'parked' | 'run-stopped' | 'notice';
  kindLabel: string;
  changeId: string | null;
  reason: string;
  at: number;
  attempts: RunAttempt[];
  questions: BuilderQuestion[];
  action: string;
};

/**
 * One option on a card: its label, its consequence, whether Counterpoint acts on it, and whether
 * picking it merges into the base branch (never picked with Enter).
 */
export type CardOption = {
  label: string;
  consequence: string;
  acts: boolean;
  merges: boolean;
  /** Picking it defers the card (an owner step's Later): the card then has no Later button. */
  later: boolean;
};

/** The planning write an answer started, while it lands as a small PR (D-12). */
export type CardWrite = {
  id: string;
  state: 'pending' | 'landing' | 'waiting' | 'blocked' | 'merged';
  prUrl: string | null;
  reason: string | null;
};

/** A question card (question-cards: Card contents). */
export type QuestionCard = {
  id: string;
  /** The project the card is in; null for a card in every project's inbox. */
  hostId: string | null;
  kind: string;
  source: 'run' | 'change' | 'session' | 'machine';
  runId: string | null;
  change: string | null;
  /** The session that asked ("builder session 2"), for a session's card. */
  session: string | null;
  /** The folder an interactive session runs in, when the server knows it. */
  folder: string | null;
  question: string;
  why: string;
  options: CardOption[];
  recommended: number;
  reversible: boolean;
  blocking: boolean;
  state: 'open' | 'deferred' | 'answered' | 'resolved';
  answer: number | null;
  note: string | null;
  outcome: string | null;
  write: CardWrite | null;
  /** The diff a Land it card shows (an owner step Counterpoint did, D-8). */
  diff: string | null;
  /** The merged build PR a step after the build links to. */
  prUrl: string | null;
  createdAt: number;
  /** When the question was asked, if the server says; else createdAt. */
  askedAt: number | null;
};

export type DoneForYou = { id: number; text: string; at: number };

export type NeedsYouSnapshot = {
  hostId: string;
  baseBranch: string;
  /** Waiting on the owner: blocking first, then newest; deferred ones last. */
  cards: QuestionCard[];
  /** Answered cards whose planning write has not merged yet. */
  landing: QuestionCard[];
  answered: QuestionCard[];
  doneForYou: DoneForYou[];
  /** The details behind the run's cards (gate output, attempts). */
  runItems: RunItem[];
};

/** Everything that needs the owner now (Later takes a card out of the count), and blocked writes. */
export function needsYouCount(snapshot: NeedsYouSnapshot): number {
  return (
    snapshot.cards.filter((card) => card.state === 'open').length +
    snapshot.landing.filter((card) => card.write?.state === 'blocked').length
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
const CARD_STATES = ['open', 'deferred', 'answered', 'resolved'] as const;
const WRITE_STATES = ['pending', 'landing', 'waiting', 'blocked', 'merged'] as const;
const PR_URL_RE = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/pull\/\d+$/;

function parseWrite(value: unknown): CardWrite | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  const state = WRITE_STATES.find((s) => s === value.state);
  if (state === undefined) return null;
  return {
    id: value.id,
    state,
    prUrl: typeof value.prUrl === 'string' && PR_URL_RE.test(value.prUrl) ? value.prUrl : null,
    reason: typeof value.reason === 'string' ? value.reason : null,
  };
}
const CARD_SOURCES = ['run', 'change', 'session', 'machine'] as const;

function parseCard(value: unknown): QuestionCard | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.question !== 'string') {
    return null;
  }
  const options = Array.isArray(value.options)
    ? value.options.filter(isRecord).map((o) => ({
        label: str(o.label),
        consequence: str(o.consequence),
        acts: o.acts === true,
        merges: o.merges === true,
        later: o.later === true,
      }))
    : [];
  if (options.length < 2) return null;
  const state = CARD_STATES.find((s) => s === value.state) ?? 'open';
  const answer =
    typeof value.answer === 'number' && value.answer < options.length ? value.answer : null;
  return {
    id: value.id,
    hostId: typeof value.hostId === 'string' ? value.hostId : null,
    kind: str(value.kind),
    source: CARD_SOURCES.find((s) => s === value.source) ?? 'machine',
    runId: typeof value.runId === 'string' ? value.runId : null,
    change: typeof value.change === 'string' && isChangeId(value.change) ? value.change : null,
    session: typeof value.session === 'string' ? value.session : null,
    folder: typeof value.folder === 'string' && value.folder !== '' ? value.folder : null,
    question: value.question,
    why: str(value.why),
    options,
    recommended: Math.min(count(value.recommended), options.length - 1),
    reversible: value.reversible === true,
    blocking: value.blocking === true,
    state,
    answer,
    note: typeof value.note === 'string' ? value.note : null,
    outcome: typeof value.outcome === 'string' ? value.outcome : null,
    write: parseWrite(value.write),
    diff: typeof value.diff === 'string' && value.diff !== '' ? value.diff : null,
    prUrl: typeof value.prUrl === 'string' && PR_URL_RE.test(value.prUrl) ? value.prUrl : null,
    createdAt: count(value.createdAt),
    askedAt: count(value.askedAt) || null,
  };
}

const parseCards = (value: unknown): QuestionCard[] =>
  Array.isArray(value) ? value.map(parseCard).filter((c): c is QuestionCard => c !== null) : [];

const KIND_LABEL = { parked: 'Parked', 'run-stopped': 'Run stopped', notice: 'Note' } as const;

function parseQuestion(value: unknown): BuilderQuestion | null {
  if (!isRecord(value) || typeof value.text !== 'string') return null;
  const options = strings(value.options);
  const recommended =
    typeof value.recommended === 'number' &&
    Number.isInteger(value.recommended) &&
    value.recommended >= 0 &&
    value.recommended < options.length
      ? value.recommended
      : null;
  return {
    task: typeof value.task === 'string' ? value.task : null,
    text: value.text,
    options,
    recommended,
    waiting: strings(value.waiting),
  };
}

function parseRunItem(value: unknown): RunItem | null {
  if (!isRecord(value)) return null;
  if (value.kind !== 'parked' && value.kind !== 'run-stopped' && value.kind !== 'notice') {
    return null;
  }
  if (typeof value.id !== 'string' || typeof value.reason !== 'string') return null;
  const attempts = Array.isArray(value.attempts)
    ? value.attempts.filter(isRecord).map(
        (a): RunAttempt => ({
          attempt: count(a.attempt),
          gate: str(a.gate),
          verdict:
            a.verdict === 'pass' ||
            a.verdict === 'fail' ||
            a.verdict === 'skipped' ||
            a.verdict === 'not-run'
              ? a.verdict
              : null,
          reason: typeof a.reason === 'string' ? a.reason : null,
          exitCode: typeof a.exitCode === 'number' ? a.exitCode : null,
          tail: typeof a.tail === 'string' ? a.tail : null,
          logPath: str(a.logPath),
        }),
      )
    : [];
  return {
    id: value.id,
    kind: value.kind,
    kindLabel: str(value.kindLabel) || KIND_LABEL[value.kind],
    changeId:
      typeof value.changeId === 'string' && isChangeId(value.changeId) ? value.changeId : null,
    reason: value.reason,
    at: count(value.at),
    attempts,
    questions: Array.isArray(value.questions)
      ? value.questions.map(parseQuestion).filter((q): q is BuilderQuestion => q !== null)
      : [],
    action: str(value.action),
  };
}

async function fetchNeedsYou(hostId: string, signal?: AbortSignal): Promise<NeedsYouSnapshot> {
  const body = await apiGet(`/api/hosts/${encodeURIComponent(hostId)}/needs-you`, signal);
  const raw = isRecord(body) ? body : {};
  return {
    hostId,
    baseBranch: str(raw.baseBranch),
    cards: parseCards(raw.cards),
    landing: parseCards(raw.landing),
    answered: parseCards(raw.answered),
    doneForYou: Array.isArray(raw.doneForYou)
      ? raw.doneForYou
          .filter(isRecord)
          .map((d) => ({ id: count(d.id), text: str(d.text), at: count(d.at) }))
      : [],
    runItems: Array.isArray(raw.runItems)
      ? raw.runItems.map(parseRunItem).filter((item): item is RunItem => item !== null)
      : [],
  };
}

/** The inbox for a host; shared by this page, the SideNav badge and the Mission card. */
export const needsYouQuery = (hostId: string) =>
  queryOptions({
    queryKey: queryKeys.needsYou(hostId),
    queryFn: ({ signal }) => fetchNeedsYou(hostId, signal),
    placeholderData: keepPreviousData,
  });

/** The failing gate's last lines (plain text, never HTML) and every attempt, behind a disclosure. */
function GateDetails({ item }: { item: RunItem }) {
  const failing = [...item.attempts].reverse().find((a) => a.verdict === 'fail');
  if (item.attempts.length === 0) return null;
  return (
    <Collapsible trigger={<Text type="supporting">Gate output</Text>}>
      <VStack gap={2}>
        {failing?.tail != null && failing.tail !== '' ? (
          <CodeBlock code={failing.tail} isWrapped={false} />
        ) : null}
        <List aria-label="Attempts">
          {item.attempts.map((a) => (
            <ListItem
              key={`${a.attempt}-${a.gate}`}
              label={
                <Text type="supporting" hasTabularNumbers>
                  {`Attempt ${a.attempt} · gate ${a.gate} · ${attemptText(a)}`}
                </Text>
              }
              description={
                a.logPath === '' ? undefined : (
                  <Text type="code" color="secondary" wordBreak="break-all">
                    {a.logPath}
                  </Text>
                )
              }
            />
          ))}
        </List>
      </VStack>
    </Collapsible>
  );
}

const KIND_BADGE: Record<string, { label: string; variant: 'warning' | 'error' | 'info' }> = {
  parked: { label: 'Parked', variant: 'warning' },
  'builder-question': { label: 'Question', variant: 'warning' },
  'run-stopped': { label: 'Run stopped', variant: 'error' },
  notice: { label: 'Note', variant: 'info' },
  ask: { label: 'Question', variant: 'info' },
  'drafts-hold': { label: 'Drafts', variant: 'info' },
};

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** When a question was asked: the time today, else the day and the time. */
export function askedText(at: number, now: number): string {
  if (at <= 0) return '';
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date(now).toDateString()) return `asked ${time}`;
  return `asked ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`;
}

/** The last segment of a folder path: the folder's name. */
const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/**
 * Where a card came from, after its change link (if any): for a session's card the session, the
 * project and folder it runs in (without a change) and when it asked; else the run or the Mac.
 * `project` is the name of the card's project, if known.
 */
export function originParts(card: QuestionCard, project: string | null, now: number): string[] {
  const parts: string[] = [];
  if (card.source === 'session') {
    const session = card.session ?? 'a Claude Code session';
    if (card.change === null) {
      parts.push(capitalized(session));
      if (card.hostId === null) parts.push('outside your projects');
      else if (project !== null) parts.push(project);
      if (card.folder !== null) parts.push(`folder ${folderName(card.folder)}`);
    } else {
      parts.push(session);
      if (card.runId !== null) parts.push(`run ${card.runId}`);
    }
    const asked = askedText(card.askedAt ?? card.createdAt, now);
    if (asked !== '') parts.push(asked);
  } else if (card.change === null) {
    parts.push(card.source === 'run' ? 'The run' : 'This Mac');
  }
  if (!card.reversible) parts.push('hard to undo');
  return parts;
}

/** What the keyboard needs to know about a card. */
export function cardKeys(card: QuestionCard): InboxCardKeys {
  return {
    id: card.id,
    options: card.options.length,
    recommended: card.recommended,
    merging: card.options.flatMap((option, index) => (option.merges ? [index] : [])),
  };
}

/** The key that picks an option: Enter for the recommended one, unless it merges; else its digit. */
export function optionKey(card: QuestionCard, index: number): string {
  const enter = enterAction(cardKeys(card));
  return enter.type === 'answer' && enter.option === index ? 'Enter' : String(index + 1);
}

const isMac = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

/** The note field's hint: what Enter sends, and the Cmd (Ctrl) digits for the options. */
export function noteHint(card: QuestionCard, mac: boolean): string {
  const command = mac ? '⌘' : 'Ctrl+';
  const digits = `${command}1–${command}${card.options.length}`;
  return enterAction(cardKeys(card)).type === 'answer'
    ? `Enter sends it with the recommended option, ${digits} with another.`
    : `${digits} sends it with that option.`;
}

/**
 * One card: where it came from, the question, why it matters, and its options as buttons with
 * their key (the recommended one preselected for Enter, unless it merges into the base), Later,
 * and an optional note.
 */
export function CardBlock(props: {
  hostId: string;
  /** The name of the card's project, if known. */
  project: string | null;
  card: QuestionCard;
  detail: RunItem | undefined;
  isFocused: boolean;
  isBusy: boolean;
  isNoteOpen: boolean;
  note: string;
  onFocus: () => void;
  onNote: (value: string) => void;
  onOpenNote: () => void;
  onAnswer: (option: number) => void;
  /** Enter in the note field: the recommended option, or a hint when that one needs its digit. */
  onNoteEnter: () => void;
  onLater: () => void;
}) {
  const { card } = props;
  const badge = KIND_BADGE[card.kind];
  const origin = originParts(card, props.project, Date.now());
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut to focus the card; the keyboard has J/K
    // biome-ignore lint/a11y/useKeyWithClickEvents: the page's keys act on the focused card
    <div onClick={props.onFocus} aria-current={props.isFocused ? 'true' : undefined}>
      <Card
        padding={4}
        elevation="none"
        variant={props.isFocused ? 'muted' : 'default'}
        aria-label={card.question}
      >
        <VStack gap={3}>
          <VStack gap={1} hAlign="start">
            <HStack gap={2} vAlign="center">
              {badge === undefined ? null : <Badge variant={badge.variant} label={badge.label} />}
              {card.state === 'deferred' ? <Badge label="Later" /> : null}
              <Text type="supporting" color="secondary" hasTabularNumbers>
                {card.change === null ? null : (
                  <Link href={`/h/${props.hostId}/changes/${card.change}`}>{card.change}</Link>
                )}
                {card.change !== null && origin.length > 0 ? ' · ' : ''}
                {origin.join(' · ')}
              </Text>
            </HStack>
            <Text weight="semibold">{card.question}</Text>
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Text type="supporting" color="secondary">
                {card.why}
              </Text>
              {card.prUrl === null ? null : (
                <Link href={card.prUrl} target="_blank" rel="noreferrer">
                  {`PR #${card.prUrl.split('/').pop()}`}
                </Link>
              )}
              {card.kind === 'drafts-hold' && card.change !== null ? (
                <Link href={`/h/${props.hostId}/changes/${card.change}/drafts`}>Open drafts</Link>
              ) : null}
            </HStack>
            {card.outcome === null ? null : <Text type="supporting">{card.outcome}</Text>}
          </VStack>
          {card.diff === null ? null : (
            <CodeBlock code={card.diff} isDiff isWrapped={false} maxHeight={360} size="sm" />
          )}
          <VStack gap={2}>
            {card.options.map((option, index) => (
              <HStack key={option.label} gap={2} vAlign="center">
                <Button
                  label={option.label}
                  size="sm"
                  variant={index === card.recommended ? 'secondary' : 'ghost'}
                  isDisabled={props.isBusy}
                  endContent={props.isFocused ? <Kbd keys={optionKey(card, index)} /> : undefined}
                  onClick={() => props.onAnswer(index)}
                />
                <Text type="supporting" color="secondary">
                  {option.consequence}
                </Text>
              </HStack>
            ))}
          </VStack>
          <HStack gap={2} vAlign="center">
            {card.state === 'deferred' || card.options.some((option) => option.later) ? null : (
              <Button
                label="Later"
                size="sm"
                variant="ghost"
                isDisabled={props.isBusy}
                endContent={props.isFocused ? <Kbd keys="L" /> : undefined}
                onClick={props.onLater}
              />
            )}
            {props.isNoteOpen ? null : (
              <Button
                label="Add a note"
                size="sm"
                variant="ghost"
                endContent={props.isFocused ? <Kbd keys="N" /> : undefined}
                onClick={props.onOpenNote}
              />
            )}
          </HStack>
          {props.isNoteOpen ? (
            <TextInput
              label="Note with your answer"
              description={noteHint(card, isMac())}
              value={props.note}
              hasAutoFocus
              onChange={(value) => props.onNote(value)}
              onEnter={props.onNoteEnter}
              onKeyDown={(event) => {
                const action = noteKey(
                  { key: event.key, command: event.metaKey || event.ctrlKey },
                  cardKeys(card),
                );
                if (action?.type !== 'answer') return;
                event.preventDefault();
                props.onAnswer(action.option);
              }}
            />
          ) : null}
          {props.detail === undefined ? null : <GateDetails item={props.detail} />}
        </VStack>
      </Card>
    </div>
  );
}

const WRITE_WORDS: Record<CardWrite['state'], string> = {
  pending: 'Landing',
  landing: 'Landing',
  waiting: 'Waiting for checks',
  blocked: 'Blocked',
  merged: 'Done',
};

/**
 * Answers whose planning write is landing as a small PR (D-12): Landing or Waiting for checks with
 * the PR link, or blocked with why, Retry and Cancel. Nothing here asks again.
 */
function LandingList(props: {
  cards: QuestionCard[];
  busy: string | null;
  onWrite: (card: QuestionCard, verb: 'retry' | 'cancel') => void;
}) {
  if (props.cards.length === 0) return null;
  return (
    <VStack gap={2}>
      <Heading level={3}>Landing</Heading>
      <List aria-label="Landing">
        {props.cards.map((card) => {
          const write = card.write;
          if (write === null) return null;
          const blocked = write.state === 'blocked';
          return (
            <ListItem
              key={card.id}
              label={<Text>{card.question}</Text>}
              description={
                <HStack gap={2} vAlign="center" wrap="wrap">
                  {blocked ? (
                    <Badge variant="warning" label="Blocked" />
                  ) : (
                    <Text type="supporting" color="secondary">
                      {WRITE_WORDS[write.state]}
                    </Text>
                  )}
                  {blocked && write.reason !== null ? (
                    <Text type="supporting">{write.reason}</Text>
                  ) : null}
                  {write.prUrl === null ? null : (
                    <Link href={write.prUrl} target="_blank" rel="noreferrer">
                      PR
                    </Link>
                  )}
                </HStack>
              }
              endContent={
                blocked ? (
                  <HStack gap={2}>
                    <Button
                      label="Retry"
                      size="sm"
                      variant="secondary"
                      isLoading={props.busy === write.id}
                      isDisabled={props.busy !== null}
                      onClick={() => props.onWrite(card, 'retry')}
                    />
                    <Button
                      label="Cancel"
                      size="sm"
                      variant="ghost"
                      isDisabled={props.busy !== null}
                      onClick={() => props.onWrite(card, 'cancel')}
                    />
                  </HStack>
                ) : undefined
              }
            />
          );
        })}
      </List>
    </VStack>
  );
}

/** What was answered lately, and what happened next. */
function AnsweredList({ cards }: { cards: QuestionCard[] }) {
  if (cards.length === 0) return null;
  return (
    <VStack gap={2}>
      <Heading level={3}>Answered</Heading>
      <List aria-label="Answered">
        {cards.map((card) => (
          <ListItem
            key={card.id}
            label={<Text>{card.question}</Text>}
            description={
              <Text type="supporting" color="secondary">
                {[card.answer === null ? 'Closed' : card.options[card.answer]?.label, card.outcome]
                  .filter((part) => part != null && part !== '')
                  .join(' · ')}
              </Text>
            }
          />
        ))}
      </List>
    </VStack>
  );
}

/** Decisions Counterpoint took without asking (D-7). */
function DoneForYouList({ entries }: { entries: DoneForYou[] }) {
  if (entries.length === 0) return null;
  return (
    <VStack gap={2}>
      <Heading level={3}>Done for you</Heading>
      <List aria-label="Done for you">
        {entries.map((entry) => (
          <ListItem
            key={entry.id}
            label={<Text>{entry.text}</Text>}
            description={
              <Text type="supporting" color="secondary" hasTabularNumbers>
                {new Date(entry.at).toLocaleString()}
              </Text>
            }
          />
        ))}
      </List>
    </VStack>
  );
}

/** A gate's outcome in an attempt, in words: passed, failed (why), skipped or not run. */
export function attemptText(a: Pick<RunAttempt, 'verdict' | 'reason' | 'exitCode'>): string {
  if (a.verdict === 'pass') return 'passed';
  if (a.verdict === 'skipped') return 'skipped (no matching files changed)';
  if (a.verdict === 'not-run') return 'not run (an earlier gate failed)';
  const exit = a.exitCode !== null && a.verdict === 'fail' ? ` (exit ${a.exitCode})` : '';
  return `${a.reason ?? 'failed'}${exit}`;
}

/** Skeleton rows at the final card height. */
export function NeedsYouLoading({ rows = 3 }: { rows?: number }) {
  return (
    <VStack gap={2} aria-busy="true" aria-label="Loading Needs You">
      {Array.from({ length: rows }, (_, index) => index).map((index) => (
        <Skeleton key={`row-${index}`} index={index} width="100%" height={76} />
      ))}
    </VStack>
  );
}

/** The other projects with items waiting; the project open comes from the address if not given. */
function useWaitingElsewhere(hostId?: string): WaitingElsewhere[] {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const current = hostId ?? /^\/h\/([^/]+)/.exec(pathname)?.[1] ?? '';
  const hosts = useQuery(hostsQuery).data ?? [];
  const counts = useQuery(needsYouCountsQuery).data;
  return waitingElsewhere(counts, hosts, current);
}

const needsYouHref = (hostId: string) => `/h/${hostId}/needs-you`;

/** One line on what waits in other projects: "2 wait in Cena." */
export function elsewhereText(elsewhere: readonly WaitingElsewhere[]): string {
  const first = elsewhere[0];
  if (first === undefined) return '';
  if (elsewhere.length > 1) return `Items wait in ${elsewhere.length} other projects.`;
  return `${first.count === 1 ? '1 item waits' : `${first.count} items wait`} in ${first.name}.`;
}

/** Links to the other projects' inboxes, each with its count. */
function ElsewhereLinks({ elsewhere }: { elsewhere: readonly WaitingElsewhere[] }) {
  return (
    <HStack gap={3} vAlign="center" wrap="wrap">
      {elsewhere.map((entry) => (
        <Link key={entry.id} href={needsYouHref(entry.id)}>
          {`Open ${entry.name} (${entry.count})`}
        </Link>
      ))}
    </HStack>
  );
}

/** The empty inbox; when another project has items waiting, it names it with a link. */
export function NeedsYouEmptyView({
  headingLevel = 2,
  elsewhere,
}: {
  headingLevel?: 2 | 3;
  elsewhere: readonly WaitingElsewhere[];
}) {
  if (elsewhere.length === 0) {
    return (
      <EmptyState
        headingLevel={headingLevel}
        title="Nothing needs you"
        description="When a run needs an answer or a fix from you, it shows up here."
      />
    );
  }
  return (
    <EmptyState
      headingLevel={headingLevel}
      title="Nothing needs you here"
      description={elsewhereText(elsewhere)}
      actions={<ElsewhereLinks elsewhere={elsewhere} />}
    />
  );
}

export function NeedsYouEmpty({
  headingLevel = 2,
  hostId,
}: {
  headingLevel?: 2 | 3;
  hostId?: string;
}) {
  return <NeedsYouEmptyView headingLevel={headingLevel} elsewhere={useWaitingElsewhere(hostId)} />;
}

/** Under a non-empty inbox: what also waits in other projects, one quiet line. */
export function AlsoWaiting({ elsewhere }: { elsewhere: readonly WaitingElsewhere[] }) {
  if (elsewhere.length === 0) return null;
  return (
    <HStack gap={3} vAlign="center" wrap="wrap">
      <Text type="supporting" color="secondary">
        {`Also waiting: ${elsewhereText(elsewhere)}`}
      </Text>
      <ElsewhereLinks elsewhere={elsewhere} />
    </HStack>
  );
}

/** True when the key press belongs to a field or an open dialog, not to the inbox. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[role="dialog"], [role="alertdialog"]') !== null) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

const CONTROLS =
  'button, a[href], summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="option"]';

/** True when focus is on a button, link or other control: Enter and Space are its own. */
function isControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(CONTROLS) !== null;
}

export function NeedsYouPage({ hostId }: { hostId: string }) {
  const query = useQuery(needsYouQuery(hostId));
  const queryClient = useQueryClient();
  const toast = useToast();
  // keepPreviousData can briefly hold another host's items while switching; never show them.
  const snapshot = query.data?.hostId === hostId ? query.data : undefined;
  const cards = snapshot?.cards ?? [];
  const ids = useMemo(() => cards.map((card) => card.id), [cards]);
  // The focus follows a card, not a position: a card arriving live never takes it (inbox-keys).
  const [focus, setFocus] = useState<InboxFocus>({ id: null, index: 0 });
  const current = resolveFocus(ids, focus);
  // The list as it is when an answer comes back (a card may have arrived meanwhile).
  const latestIds = useRef(ids);
  latestIds.current = ids;
  const since = useRef<FocusSince>({ id: null, at: 0, byOwner: false });
  useLayoutEffect(() => {
    // The card in focus changed by itself (it left, or the owner answered): answers wait a moment.
    if (since.current.id !== current.id) {
      since.current = { id: current.id, at: Date.now(), byOwner: false };
    }
    if (current.id !== focus.id || current.index !== focus.index) {
      setFocus({ id: current.id, index: current.index });
    }
  }, [current.id, current.index, focus.id, focus.index]);
  /** The owner moved the focus (J/K, a click): no wait. */
  const moveFocus = useCallback(
    (index: number) => {
      const id = ids[index] ?? null;
      since.current = { id, at: 0, byOwner: true };
      setFocus({ id, index });
    },
    [ids],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const notifications = useNotificationPermission();
  const elsewhere = useWaitingElsewhere(hostId);
  const projects = useQuery(hostsQuery).data;

  useEffect(() => {
    document.title = 'Needs You · Counterpoint';
    // The navigation link clicked to get here keeps the focus; Enter belongs to the inbox now.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('nav') !== null && isControl(active)) {
      active.blur();
    }
  }, []);

  const act = useCallback(
    async (cardId: string, path: 'answer' | 'later', body: unknown) => {
      setBusy(cardId);
      try {
        const result = await apiPostAnswer(
          `/api/hosts/${encodeURIComponent(hostId)}/cards/${encodeURIComponent(cardId)}/${path}`,
          body,
        );
        const card = isRecord(result.body.card) ? parseCard(result.body.card) : null;
        if (!result.ok) {
          toast({ body: str(result.body.error) || "Couldn't record that. Try again." });
        } else if (path === 'later') {
          toast({ body: 'Later. It stays here.' });
        } else {
          const picked = card?.answer === null ? null : card?.options[card?.answer ?? -1]?.label;
          toast({ body: card?.outcome ?? `Answered: ${picked ?? 'done'}.` });
        }
        setNoteFor(null);
        setNote('');
        // The card that takes its place gets the focus; a deferred card moves to the end.
        if (result.ok) setFocus(focusAfterAnswer(latestIds.current, cardId));
      } finally {
        setBusy(null);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.needsYou(hostId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.needsYouCounts }),
        ]);
      }
    },
    [hostId, queryClient, toast],
  );

  const [writeBusy, setWriteBusy] = useState<string | null>(null);
  const onWrite = useCallback(
    async (card: QuestionCard, verb: 'retry' | 'cancel') => {
      const write = card.write;
      if (write === null || writeBusy !== null) return;
      setWriteBusy(write.id);
      try {
        const result = await apiPostAnswer(
          `/api/hosts/${encodeURIComponent(hostId)}/writes/${encodeURIComponent(write.id)}/${verb}`,
          {},
        );
        const after = isRecord(result.body.card) ? parseCard(result.body.card) : null;
        if (!result.ok) toast({ body: str(result.body.error) || "Couldn't do that. Try again." });
        else if (verb === 'cancel') toast({ body: 'Cancelled. The question is back.' });
        else toast({ body: after?.outcome ?? 'Trying again.' });
      } finally {
        setWriteBusy(null);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.needsYou(hostId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.needsYouCounts }),
        ]);
      }
    },
    [hostId, queryClient, toast, writeBusy],
  );

  const answer = useCallback(
    (card: QuestionCard, option: number) => {
      if (busy !== null) return;
      void act(
        card.id,
        'answer',
        noteFor === card.id && note.trim() !== '' ? { option, note } : { option },
      );
    },
    [act, busy, note, noteFor],
  );

  /** Enter on an option that merges into the base does nothing but say which digit picks it. */
  const needsDigit = useCallback(
    (card: QuestionCard, option: number, inNote: boolean) => {
      const label = card.options[option]?.label ?? 'This option';
      const base = snapshot?.baseBranch || 'the base branch';
      const key = `${inNote ? (isMac() ? '⌘' : 'Ctrl+') : ''}${option + 1}`;
      toast({ body: `"${label}" merges into ${base}. Press ${key} to pick it.` });
    },
    [snapshot?.baseBranch, toast],
  );

  const run = useCallback(
    (action: InboxKeyAction, inNote = false) => {
      const card = cards.find((c) => c.id === ('cardId' in action ? action.cardId : ''));
      if (action.type === 'focus') moveFocus(action.index);
      else if (action.type === 'note') setNoteFor(action.cardId);
      else if (action.type === 'later') void act(action.cardId, 'later', {});
      else if (card === undefined) return;
      else if (action.type === 'needs-digit') needsDigit(card, action.option, inNote);
      else answer(card, action.option);
    },
    [act, answer, cards, moveFocus, needsDigit],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = inboxKey(
        {
          key: event.key,
          modified: event.metaKey || event.ctrlKey || event.altKey,
          typing: isTyping(event.target),
          onControl: isControl(event.target),
          settling: isSettling(since.current, Date.now()),
        },
        cards.map(cardKeys),
        current.index,
      );
      if (action === null || busy !== null) return;
      event.preventDefault();
      // Moving through the inbox takes the keys back from a button or link that kept the focus.
      if (action.type === 'focus' && isControl(document.activeElement)) {
        (document.activeElement as HTMLElement).blur();
      }
      run(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, cards, current.index, run]);

  const errorBanner = query.isError ? (
    <Banner
      status="error"
      title="Couldn't load Needs You"
      description={
        snapshot === undefined
          ? "Counterpoint's daemon didn't answer."
          : "Counterpoint's daemon didn't answer. The last items it sent are still shown."
      }
      endContent={
        <Button
          label="Try loading Needs You again"
          variant="secondary"
          isLoading={query.isFetching}
          onClick={() => void query.refetch()}
        />
      }
    />
  ) : null;

  let body = null;
  if (snapshot === undefined) {
    body = query.isError ? null : <NeedsYouLoading />;
  } else {
    body = (
      <VStack gap={6}>
        {cards.length === 0 ? (
          <NeedsYouEmptyView elsewhere={elsewhere} />
        ) : (
          <VStack gap={3}>
            {cards.map((card, index) => (
              <CardBlock
                key={card.id}
                hostId={hostId}
                project={projects?.find((project) => project.id === card.hostId)?.name ?? null}
                card={card}
                detail={snapshot.runItems.find(
                  (item) =>
                    item.kind === 'parked' &&
                    item.changeId === card.change &&
                    card.kind === 'parked',
                )}
                isFocused={card.id === current.id}
                isBusy={busy === card.id}
                isNoteOpen={noteFor === card.id}
                note={noteFor === card.id ? note : ''}
                onFocus={() => moveFocus(index)}
                onNote={setNote}
                onOpenNote={() => {
                  moveFocus(index);
                  setNoteFor(card.id);
                }}
                onAnswer={(option) => answer(card, option)}
                onNoteEnter={() => run(enterAction(cardKeys(card)), true)}
                onLater={() => void act(card.id, 'later', {})}
              />
            ))}
            <AlsoWaiting elsewhere={elsewhere} />
          </VStack>
        )}
        <LandingList
          cards={snapshot.landing}
          busy={writeBusy}
          onWrite={(card, verb) => void onWrite(card, verb)}
        />
        <AnsweredList cards={snapshot.answered} />
        <DoneForYouList entries={snapshot.doneForYou} />
      </VStack>
    );
  }

  return (
    <Layout
      header={
        <LayoutHeader>
          <HStack gap={4} vAlign="center" justify="between" wrap="wrap">
            <Heading level={2} accessibilityLevel={1}>
              Needs You
            </Heading>
            {notifications.permission === 'default' ? (
              <Button
                label="Notify me here"
                variant="ghost"
                onClick={() => void notifications.ask()}
              />
            ) : null}
          </HStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent>
          <VStack gap={6}>
            {errorBanner}
            {body}
          </VStack>
        </LayoutContent>
      }
    />
  );
}

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
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiGet, queryKeys } from '../api';
import { isChangeId } from '../ids';

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

export type NeedsYouSnapshot = {
  hostId: string;
  baseBranch: string;
  runItems: RunItem[];
};

/** Everything that needs the owner. */
export function needsYouCount(snapshot: NeedsYouSnapshot): number {
  return snapshot.runItems.length;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

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

function QuestionBlock({ question }: { question: BuilderQuestion }) {
  return (
    <VStack gap={2}>
      <Text weight="semibold">{question.text}</Text>
      {question.options.length > 0 ? (
        <List aria-label="Options">
          {question.options.map((option, index) => (
            <ListItem
              key={option}
              label={<Text>{option}</Text>}
              endContent={
                index === question.recommended ? (
                  <Badge variant="info" label="Recommended" />
                ) : undefined
              }
            />
          ))}
        </List>
      ) : null}
      {question.waiting.length > 0 ? (
        <Text type="supporting" color="secondary">
          {`Waiting on it: ${question.waiting.join(', ')}`}
        </Text>
      ) : null}
    </VStack>
  );
}

function badgeOf(kind: RunItem['kind']): {
  variant: 'warning' | 'error' | 'info';
  icon: 'warning' | 'error' | 'info';
} {
  if (kind === 'parked') return { variant: 'warning', icon: 'warning' };
  if (kind === 'notice') return { variant: 'info', icon: 'info' };
  return { variant: 'error', icon: 'error' };
}

/**
 * One item: a question with its options, or the reason with the failing gate's last lines (plain
 * text, never HTML) and every attempt, then what to do.
 */
export function RunItemBlock({ hostId, item }: { hostId: string; item: RunItem }) {
  const failing = [...item.attempts].reverse().find((a) => a.verdict === 'fail');
  const badge = badgeOf(item.kind);
  return (
    <Card
      padding={4}
      elevation="none"
      aria-label={`${item.kindLabel}: ${item.changeId ?? 'the run'}`}
    >
      <VStack gap={3}>
        <VStack gap={1} hAlign="start">
          <Badge
            variant={badge.variant}
            label={item.kindLabel}
            icon={<Icon icon={badge.icon} size="xsm" />}
          />
          <Text weight="semibold">
            {item.changeId === null ? (
              item.kind === 'notice' ? (
                'The run'
              ) : (
                'The run stopped'
              )
            ) : (
              <Link href={`/h/${hostId}/changes/${item.changeId}`}>{item.changeId}</Link>
            )}
          </Text>
          {item.questions.length === 0 ? <Text>{item.reason}</Text> : null}
        </VStack>
        {item.questions.map((question) => (
          <QuestionBlock key={`${question.task ?? ''}-${question.text}`} question={question} />
        ))}
        {failing?.tail != null && failing.tail !== '' ? (
          <VStack gap={1}>
            <Text type="supporting" color="secondary">
              {`Last lines of gate ${failing.gate} (attempt ${failing.attempt}):`}
            </Text>
            <CodeBlock code={failing.tail} isWrapped={false} />
          </VStack>
        ) : null}
        {item.attempts.length > 0 ? (
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
        ) : null}
        <Text type="supporting" color="secondary">
          {item.action}
        </Text>
      </VStack>
    </Card>
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

export function NeedsYouEmpty({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  return (
    <EmptyState
      headingLevel={headingLevel}
      title="Nothing needs you"
      description="When a run needs an answer or a fix from you, it shows up here."
    />
  );
}

export function NeedsYouPage({ hostId }: { hostId: string }) {
  const query = useQuery(needsYouQuery(hostId));
  // keepPreviousData can briefly hold another host's items while switching; never show them.
  const snapshot = query.data?.hostId === hostId ? query.data : undefined;

  useEffect(() => {
    document.title = 'Needs You · Counterpoint';
  }, []);

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
  } else if (needsYouCount(snapshot) === 0) {
    body = <NeedsYouEmpty />;
  } else {
    body = (
      <VStack gap={4}>
        {snapshot.runItems.map((item) => (
          <RunItemBlock key={item.id} hostId={hostId} item={item} />
        ))}
      </VStack>
    );
  }

  return (
    <Layout
      header={
        <LayoutHeader>
          <Heading level={2} accessibilityLevel={1}>
            Needs You
          </Heading>
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

// Needs You (`/h/{hostId}/needs-you`, needs-you: One inbox; a long list grows with the page):
// one inbox of what genuinely needs the owner, newest first as the server serves it. So far the
// only kind is "approved version changed": an approved change whose committed files or gate
// config moved on after signing. Each row links to its drift view.
//
// Nothing here dismisses, snoozes or hides an item: the server recomputes the list from git, and
// an item disappears only when the change is re-signed or its files return to the signed state.
// `needs-you` and `approval` events refetch the list (live.ts). The row component takes a `kind`
// so later changes add parked items, PRs and council cards; the Mission card reuses it.
//
// Above them, what the last build run left for the owner (needs-you: Parked changes in Needs You;
// Run-stopping errors in Needs You): a parked change with its failing gate's last lines and every
// attempt, and a run that stopped on an error with what to do. A `run` event refetches them.
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
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { VStack } from '@astryxdesign/core/VStack';
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiGet, hostsQuery, queryKeys } from '../api';
import { isChangeId } from '../ids';

/** Needs You item ids are change ids (src/server/routes/needs-you.ts). */
export const isNeedsYouItemId = isChangeId;

export type NeedsYouKind = 'approved-version-changed';

export type NeedsYouItem = {
  id: string;
  kind: NeedsYouKind;
  /** The kind's visible name, e.g. `Approved version changed`. */
  kindLabel: string;
  changeId: string;
  title: string;
  changedCount: number;
  gatesChanged: boolean;
  signedAt: string;
  changedAt: string;
  unreadable: boolean;
};

export type RunAttempt = {
  attempt: number;
  gate: string;
  verdict: 'pass' | 'fail' | null;
  reason: string | null;
  exitCode: number | null;
  tail: string | null;
  logPath: string;
};

export type RunItem = {
  id: string;
  kind: 'parked' | 'run-stopped';
  kindLabel: string;
  changeId: string | null;
  reason: string;
  at: number;
  attempts: RunAttempt[];
  action: string;
};

export type NeedsYouSnapshot = {
  hostId: string;
  baseBranch: string;
  items: NeedsYouItem[];
  runItems: RunItem[];
};

/** Everything that needs the owner: approval items and what the last run left. */
export function needsYouCount(snapshot: NeedsYouSnapshot): number {
  return snapshot.items.length + snapshot.runItems.length;
}

function parseRunItem(value: unknown): RunItem | null {
  if (!isRecord(value)) return null;
  if (value.kind !== 'parked' && value.kind !== 'run-stopped') return null;
  if (typeof value.id !== 'string' || typeof value.reason !== 'string') return null;
  const attempts = Array.isArray(value.attempts)
    ? value.attempts.filter(isRecord).map(
        (a): RunAttempt => ({
          attempt: count(a.attempt),
          gate: str(a.gate),
          verdict: a.verdict === 'pass' || a.verdict === 'fail' ? a.verdict : null,
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
    kindLabel: str(value.kindLabel) || (value.kind === 'parked' ? 'Parked' : 'Run stopped'),
    changeId:
      typeof value.changeId === 'string' && isChangeId(value.changeId) ? value.changeId : null,
    reason: value.reason,
    at: count(value.at),
    attempts,
    action: str(value.action),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** One item from the server; null for anything that does not have the expected shape. */
export function parseNeedsYouItem(value: unknown): NeedsYouItem | null {
  if (!isRecord(value)) return null;
  if (!isNeedsYouItemId(value.id) || !isChangeId(value.changeId)) return null;
  if (value.kind !== 'approved-version-changed') return null;
  if (typeof value.signedAt !== 'string') return null;
  return {
    id: value.id,
    kind: value.kind,
    kindLabel: str(value.kindLabel) || 'Approved version changed',
    changeId: value.changeId,
    title: str(value.title) || `${value.changeId} changed since you signed it`,
    changedCount: count(value.changedCount),
    gatesChanged: value.gatesChanged === true,
    signedAt: value.signedAt,
    changedAt: str(value.changedAt),
    unreadable: value.unreadable === true,
  };
}

async function fetchNeedsYou(hostId: string, signal?: AbortSignal): Promise<NeedsYouSnapshot> {
  const body = await apiGet(`/api/hosts/${encodeURIComponent(hostId)}/needs-you`, signal);
  const raw = isRecord(body) ? body : {};
  return {
    hostId,
    baseBranch: str(raw.baseBranch),
    items: Array.isArray(raw.items)
      ? raw.items.map(parseNeedsYouItem).filter((item): item is NeedsYouItem => item !== null)
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

export function filesChangedText(n: number): string {
  return n === 1 ? '1 file changed' : `${n} files changed`;
}

/** What changed, for the row's Supporting line: input files, the gate config, or both. */
export function changedSummary(item: Pick<NeedsYouItem, 'changedCount' | 'gatesChanged'>): string {
  if (item.gatesChanged && item.changedCount === 0) return 'gate config changed';
  if (item.gatesChanged) return `${filesChangedText(item.changedCount)} + gate config`;
  return filesChangedText(item.changedCount);
}

/** The icon each kind shows before its row (from the theme's icon registry). */
const KIND_ICON = { 'approved-version-changed': 'warning' } as const;

/**
 * One Needs You row: the kind's icon, the kind name as a visible warning Badge above the title,
 * the title on one line (full text in a Tooltip), and the Supporting line. Links to the item.
 */
export function NeedsYouRow({
  hostId,
  hostName,
  item,
}: {
  hostId: string;
  hostName: string;
  item: NeedsYouItem;
}) {
  return (
    <ListItem
      href={`/h/${hostId}/needs-you/${item.id}`}
      align="first-line"
      startContent={<Icon icon={KIND_ICON[item.kind]} size="sm" color="warning" />}
      label={
        <VStack gap={1} hAlign="start">
          <Badge variant="warning" label={item.kindLabel} />
          <Text weight="semibold" maxLines={1} hasTruncateTooltip>
            {item.title}
          </Text>
        </VStack>
      }
      description={
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {`${hostName} · ${changedSummary(item)} · signed `}
          <Timestamp value={item.signedAt} hasTooltip />
        </Text>
      }
      endContent={
        item.unreadable ? (
          <Badge variant="error" label="Couldn't read" icon={<Icon icon="error" size="xsm" />} />
        ) : undefined
      }
    />
  );
}

/**
 * What the last run left: a parked change shows its reason, the failing gate's last lines (plain
 * text, never HTML) and every attempt; a stopped run says why and what to do.
 */
export function RunItemBlock({ hostId, item }: { hostId: string; item: RunItem }) {
  const failing = [...item.attempts].reverse().find((a) => a.verdict === 'fail');
  const parked = item.kind === 'parked';
  return (
    <Card
      padding={4}
      elevation="none"
      aria-label={`${item.kindLabel}: ${item.changeId ?? 'the run'}`}
    >
      <VStack gap={3}>
        <VStack gap={1} hAlign="start">
          <Badge
            variant={parked ? 'warning' : 'error'}
            label={item.kindLabel}
            icon={<Icon icon={parked ? 'warning' : 'error'} size="xsm" />}
          />
          <Text weight="semibold">
            {item.changeId === null ? (
              'The run stopped'
            ) : (
              <Link href={`/h/${hostId}/changes/${item.changeId}`}>{item.changeId}</Link>
            )}
          </Text>
          <Text>{item.reason}</Text>
        </VStack>
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
                    {`Attempt ${a.attempt} · gate ${a.gate} · ${a.verdict === 'pass' ? 'passed' : (a.reason ?? 'failed')}${a.exitCode !== null && a.verdict === 'fail' ? ` (exit ${a.exitCode})` : ''}`}
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

/** Skeleton rows at the final row height (badge, title and Supporting line). */
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
      description="If a change you approved is edited after signing, it will show up here with what changed."
    />
  );
}

export function NeedsYouPage({ hostId }: { hostId: string }) {
  const hosts = useQuery(hostsQuery);
  const hostName = hosts.data?.find((candidate) => candidate.id === hostId)?.name ?? hostId;
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
        {snapshot.items.length > 0 ? (
          <List hasDividers={snapshot.items.length > 1} aria-label="Needs You items">
            {snapshot.items.map((item) => (
              <NeedsYouRow key={item.id} hostId={hostId} hostName={hostName} item={item} />
            ))}
          </List>
        ) : null}
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

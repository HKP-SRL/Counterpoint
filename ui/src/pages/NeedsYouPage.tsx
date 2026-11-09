// Needs You (`/h/{hostId}/needs-you`, MISN-02, UI-SPEC "Screens and Layout" Needs You and E6):
// one inbox of what genuinely needs the owner, newest first as the server serves it. In Phase 1
// the only kind is "approved version changed": an approved phase whose committed inputs or gate
// config moved on after signing. Each row links to its change view.
//
// Nothing here dismisses, snoozes or hides an item: the server recomputes the list from git, and
// an item disappears only when the phase is re-signed or its inputs return to the signed state.
// `needs-you` and `approval` events refetch the list (live.ts). The row component takes a `kind`
// so later phases add parked items, PRs and council cards; the Mission card (01-15) reuses it.
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { VStack } from '@astryxdesign/core/VStack';
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiGet, hostsQuery, queryKeys } from '../api';

/** Needs You item ids in Phase 1 (src/server/routes/needs-you.ts). */
export const NEEDS_YOU_ITEM_ID_RE = /^phase-\d{2}(\.\d+)?$/;
const PHASE_ID_RE = /^\d{2}(\.\d+)?$/;

export type NeedsYouKind = 'approved-version-changed';

export type NeedsYouItem = {
  id: string;
  kind: NeedsYouKind;
  /** The kind's visible name, e.g. `Approved version changed`. */
  kindLabel: string;
  phaseId: string;
  title: string;
  changedCount: number;
  gatesChanged: boolean;
  signedAt: string;
  changedAt: string;
  unreadable: boolean;
};

export type NeedsYouSnapshot = {
  hostId: string;
  baseBranch: string;
  items: NeedsYouItem[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** One item from the server; null for anything that does not have the expected shape. */
export function parseNeedsYouItem(value: unknown): NeedsYouItem | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || !NEEDS_YOU_ITEM_ID_RE.test(value.id)) return null;
  if (typeof value.phaseId !== 'string' || !PHASE_ID_RE.test(value.phaseId)) return null;
  if (value.kind !== 'approved-version-changed') return null;
  if (typeof value.signedAt !== 'string') return null;
  return {
    id: value.id,
    kind: value.kind,
    kindLabel: str(value.kindLabel) || 'Approved version changed',
    phaseId: value.phaseId,
    title: str(value.title) || `Phase ${value.phaseId} changed since you signed it`,
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
      description="If a phase you approved changes after signing, it will show up here with what changed."
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
  } else if (snapshot.items.length === 0) {
    body = <NeedsYouEmpty />;
  } else {
    body = (
      <List hasDividers={snapshot.items.length > 1} aria-label="Needs You items">
        {snapshot.items.map((item) => (
          <NeedsYouRow key={item.id} hostId={hostId} hostName={hostName} item={item} />
        ))}
      </List>
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

// Phases (`/h/{hostId}/phases`, ADPT-01, UI-SPEC "Screens and Layout" Phases and E3): every
// roadmap phase of the host in numeric order, with status (the page's focal point), plans,
// setup and approval. Data is a snapshot from GET /api/hosts/{id}/phases, refetched when a
// `phase` or `approval` event arrives; a refresh keeps the current rows on screen.
//
// Every string here comes from the host's planning files (agent-written, untrusted) and renders
// as React text only.
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Table, type TableColumn, type TablePlugin } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { Token } from '@astryxdesign/core/Token';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { VStack } from '@astryxdesign/core/VStack';
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { apiGet, queryKeys } from '../api';
import { isPhaseStatus, type PhaseStatus, StatusBadge } from '../components/StatusBadge';

// ---------------------------------------------------------------------------------------------
// API shapes (GET /api/hosts/{id}/phases and /phases/{phaseId}); shared with Phase detail.

export type UserSetupRow = { service: string; why: string | null };
export type UnreadableFile = { file: string; reason: string };

/** A phase's approval as the server verified it from git at the base tip (never stored). */
export type ApprovalFacts =
  | { state: 'on-runway' | 'changed'; signedAt: string; commit: string }
  | { state: 'invalid'; reason: string };

export type PhaseRow = {
  id: string;
  name: string;
  status: PhaseStatus;
  notReadyReason: 'no-context' | 'no-plans' | null;
  planCount: number;
  nonAutonomousCount: number;
  userSetup: UserSetupRow[];
  unreadable: UnreadableFile | null;
  approval: ApprovalFacts | null;
  /** D-03: the owner's checkout has uncommitted edits to this approved phase's inputs. */
  uncommittedEdits: boolean;
};

export type PhasesSnapshot = {
  hostId: string;
  hostName: string;
  baseBranch: string;
  tip: string | null;
  phases: PhaseRow[];
};

const PHASE_ID_RE = /^\d{2}(\.\d+)?$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const strOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

function parseUnreadable(value: unknown): UnreadableFile | null {
  return isRecord(value) ? { file: str(value.file), reason: str(value.reason) } : null;
}

const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** The approval facts of a row; anything that does not fit is treated as no approval. */
export function parseApproval(value: unknown): ApprovalFacts | null {
  if (!isRecord(value)) return null;
  if (value.state === 'on-runway' || value.state === 'changed') {
    if (typeof value.signedAt !== 'string' || Number.isNaN(Date.parse(value.signedAt))) return null;
    if (typeof value.commit !== 'string' || !SHA_RE.test(value.commit)) return null;
    return { state: value.state, signedAt: value.signedAt, commit: value.commit };
  }
  if (value.state === 'invalid') return { state: 'invalid', reason: str(value.reason) };
  return null;
}

/** Validates one phase row from the API; rows that do not fit are dropped. */
export function parsePhaseRow(value: unknown): PhaseRow | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !PHASE_ID_RE.test(value.id)) return null;
  if (!isPhaseStatus(value.status)) return null;
  const reason = value.notReadyReason;
  return {
    id: value.id,
    name: str(value.name),
    status: value.status,
    notReadyReason: reason === 'no-context' || reason === 'no-plans' ? reason : null,
    planCount: count(value.planCount),
    nonAutonomousCount: count(value.nonAutonomousCount),
    userSetup: Array.isArray(value.userSetup)
      ? value.userSetup.filter(isRecord).map((item) => ({
          service: str(item.service),
          why: strOrNull(item.why),
        }))
      : [],
    unreadable: parseUnreadable(value.unreadable),
    approval: parseApproval(value.approval),
    uncommittedEdits: value.uncommittedEdits === true,
  };
}

async function fetchPhases(hostId: string, signal?: AbortSignal): Promise<PhasesSnapshot> {
  const body = await apiGet(`/api/hosts/${encodeURIComponent(hostId)}/phases`, signal);
  const raw = isRecord(body) ? body : {};
  return {
    hostId,
    hostName: str(raw.hostName),
    baseBranch: str(raw.baseBranch),
    tip: strOrNull(raw.tip),
    phases: Array.isArray(raw.phases)
      ? raw.phases.map(parsePhaseRow).filter((row): row is PhaseRow => row !== null)
      : [],
  };
}

export const phasesQuery = (hostId: string) =>
  queryOptions({
    queryKey: queryKeys.phases(hostId),
    queryFn: ({ signal }) => fetchPhases(hostId, signal),
    placeholderData: keepPreviousData,
  });

// ---------------------------------------------------------------------------------------------
// Wording.

export function plansText(n: number): string {
  if (n === 0) return 'No plans';
  return n === 1 ? '1 plan' : `${n} plans`;
}

export function setupItemText(item: UserSetupRow): string {
  return item.why === null || item.why === '' ? item.service : `${item.service}: ${item.why}`;
}

/**
 * The D-03 soft hint: the owner's checkout has uncommitted edits to an approved phase. Purely
 * informational; the approval and the runway only follow what is committed on the base branch.
 */
export function UncommittedHint({ baseBranch }: { baseBranch: string }) {
  return (
    <HStack gap={1} vAlign="start">
      <Icon icon="info" size="xsm" color="secondary" />
      <Text type="supporting" color="secondary">
        {`Uncommitted edits to this approved phase. The approval only follows what is committed on ${baseBranch}.`}
      </Text>
    </HStack>
  );
}

type Filter = 'all' | 'ready' | 'on-runway' | 'changed';

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ready', label: 'Ready to approve' },
  { value: 'on-runway', label: 'On runway' },
  { value: 'changed', label: 'Changed' },
];

const isFilter = (value: string): value is Filter => FILTERS.some((f) => f.value === value);

function matches(filter: Filter, row: PhaseRow): boolean {
  return filter === 'all' || row.status === filter;
}

// ---------------------------------------------------------------------------------------------

const ROW_HEIGHT = 52;

function LoadingRows() {
  return (
    <VStack gap={2} aria-busy="true" aria-label="Loading phases">
      {[0, 1, 2, 3, 4].map((index) => (
        <Skeleton key={index} index={index} width="100%" height={ROW_HEIGHT} />
      ))}
    </VStack>
  );
}

export function PhasesPage({ hostId }: { hostId: string }) {
  const query = useQuery(phasesQuery(hostId));
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    document.title = 'Phases · Counterpoint';
  }, []);

  // keepPreviousData can briefly hold another host's rows while switching; never show them.
  const data = query.data?.hostId === hostId ? query.data : undefined;
  const phases = data?.phases ?? [];
  const hostName = data?.hostName ?? '';

  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: 0, ready: 0, 'on-runway': 0, changed: 0 };
    for (const row of phases) {
      result.all += 1;
      if (row.status === 'ready' || row.status === 'on-runway' || row.status === 'changed') {
        result[row.status] += 1;
      }
    }
    return result;
  }, [phases]);

  const visible = phases.filter((row) => matches(filter, row));
  const detailHref = (row: PhaseRow) => `/h/${hostId}/phases/${row.id}`;

  const columns: TableColumn<PhaseRow>[] = [
    {
      key: 'phase',
      header: 'Phase',
      renderCell: (row) => (
        <Link href={detailHref(row)} label={`Phase ${row.id}: ${row.name}`}>
          <HStack gap={2} vAlign="center">
            <Text type="code" hasTabularNumbers>
              {row.id}
            </Text>
            <Text maxLines={1} hasTruncateTooltip>
              {row.name}
            </Text>
          </HStack>
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      renderCell: (row) =>
        row.uncommittedEdits ? (
          <VStack gap={1} hAlign="start">
            <StatusBadge status={row.status} />
            <UncommittedHint baseBranch={data?.baseBranch ?? ''} />
          </VStack>
        ) : (
          <StatusBadge status={row.status} />
        ),
    },
    {
      key: 'plans',
      header: 'Plans',
      renderCell: (row) => (
        <VStack gap={1}>
          <Text hasTabularNumbers>{plansText(row.planCount)}</Text>
          {row.nonAutonomousCount > 0 ? (
            <Text type="supporting" color="secondary" hasTabularNumbers>
              {`${row.nonAutonomousCount} not autonomous`}
            </Text>
          ) : null}
        </VStack>
      ),
    },
    {
      key: 'setup',
      header: 'Setup',
      renderCell: (row) =>
        row.userSetup.length === 0 ? null : (
          <Tooltip
            content={
              <VStack gap={1}>
                {row.userSetup.map((item) => (
                  <Text key={item.service}>{setupItemText(item)}</Text>
                ))}
              </VStack>
            }
          >
            <Token
              label="Setup needed"
              size="sm"
              description={row.userSetup.map(setupItemText).join('; ')}
            />
          </Tooltip>
        ),
    },
    {
      key: 'approval',
      header: 'Approval',
      // Verified from git at the base tip by the server (01-13); never a stored flag.
      renderCell: (row) =>
        row.status === 'on-runway' && row.approval?.state === 'on-runway' ? (
          <Text>
            {'On runway · signed '}
            <Timestamp value={row.approval.signedAt} hasTooltip />
          </Text>
        ) : (
          <Text color="secondary">—</Text>
        ),
    },
  ];

  // The whole row opens Phase detail; the Phase cell's link is the keyboard path.
  const rowLink: TablePlugin<PhaseRow> = {
    transformBodyRow: (props, row) => ({
      ...props,
      htmlProps: {
        ...props.htmlProps,
        style: { ...props.htmlProps.style, cursor: 'pointer' },
        onClick: (event) => {
          props.htmlProps.onClick?.(event);
          if (event.defaultPrevented) return;
          void navigate({ to: '/h/$hostId/phases/$phaseId', params: { hostId, phaseId: row.id } });
        },
      },
    }),
  };

  const errorBanner = query.isError ? (
    <Banner
      status="error"
      title="Couldn't load phases"
      description="Counterpoint's daemon didn't answer."
      endContent={
        <Button
          label="Try loading phases again"
          variant="secondary"
          isLoading={query.isFetching}
          onClick={() => void query.refetch()}
        />
      }
    />
  ) : null;

  let body: ReactNode;
  if (data === undefined) {
    body = query.isError ? null : <LoadingRows />;
  } else if (phases.length === 0) {
    body = (
      <EmptyState
        headingLevel={2}
        title={`No phases in ${hostName}'s roadmap`}
        description={`Counterpoint reads ${hostName}'s .planning/ROADMAP.md and found no phases. Check the path with "counterpoint status".`}
      />
    );
  } else {
    // The source line also keeps the Table off the top edge of the content area, where Astryx's
    // edge compensation would pull its header row under the page header.
    body = (
      <VStack gap={4}>
        <Text type="supporting" color="secondary">
          {data.tip === null
            ? `Read from ${hostName}'s .planning/ROADMAP.md.`
            : `Read from ${data.baseBranch} at ${data.tip.slice(0, 7)} (committed content only).`}
        </Text>
        <Table<PhaseRow>
          data={visible}
          columns={columns}
          idKey="id"
          hasHover
          plugins={{ rowLink }}
          emptyState={
            <VStack gap={2} hAlign="center" padding={6}>
              <Text>No phases match this filter</Text>
              <Link onClick={() => setFilter('all')}>Show all phases</Link>
            </VStack>
          }
        />
      </VStack>
    );
  }

  return (
    <Layout
      header={
        <LayoutHeader>
          <HStack gap={4} vAlign="center" justify="between" wrap="wrap">
            <Heading level={2} accessibilityLevel={1}>
              Phases
            </Heading>
            <SegmentedControl
              label="Filter phases by status"
              value={filter}
              onChange={(value) => {
                if (isFilter(value)) setFilter(value);
              }}
            >
              {FILTERS.map((option) => (
                <SegmentedControlItem
                  key={option.value}
                  value={option.value}
                  label={`${option.label} (${counts[option.value]})`}
                />
              ))}
            </SegmentedControl>
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

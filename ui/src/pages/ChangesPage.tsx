// Changes (`/h/{hostId}/changes`, host-planning: Active changes listed; Archived changes are
// done; long titles wrap): every
// active OpenSpec change of the host in build order (dependencies first), with status (the page's
// focal point), task progress, owner steps, artifacts, dependencies and approval; then the
// archived changes as Built, newest first, capped at DONE_LIST_CAP until `Show all`. Data is a
// snapshot from GET /api/hosts/{id}/changes, refetched when a `planning` or `approval` event
// arrives; a refresh keeps the current rows on screen.
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
import { List, ListItem } from '@astryxdesign/core/List';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Table, type TableColumn, type TablePlugin } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { apiGet, queryKeys } from '../api';
import { type ChangeStatus, isChangeStatus, StatusBadge } from '../components/StatusBadge';
import { isChangeId } from '../ids';

// ---------------------------------------------------------------------------------------------
// API shapes (GET /api/hosts/{id}/changes and /changes/{changeId}); shared with Change detail.

export type UnreadableFile = { file: string; reason: string };

/** A change's approval as the server verified it from git at the base tip (never stored). */
export type ApprovalFacts =
  | { state: 'on-runway' | 'changed'; signedAt: string; commit: string }
  | { state: 'invalid'; reason: string };

export type Artifacts = { proposal: boolean; design: boolean; tasks: boolean; specs: string[] };

export type ChangeRow = {
  id: string;
  title: string;
  archived: boolean;
  archivedOn: string | null;
  dependsOn: string[];
  status: ChangeStatus;
  notReadyReason: 'no-proposal' | 'no-tasks' | null;
  artifacts: Artifacts;
  tasks: { total: number; done: number };
  ownerStepCount: number;
  unreadable: UnreadableFile | null;
  approval: ApprovalFacts | null;
  /** The owner's checkout has uncommitted edits to this approved change's files. */
  uncommittedEdits: boolean;
  uncommittedNotCheckable: string[];
};

export type ChangesSnapshot = {
  hostId: string;
  hostName: string;
  baseBranch: string;
  tip: string | null;
  changes: ChangeRow[];
};

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

function parseArtifacts(value: unknown): Artifacts {
  const raw = isRecord(value) ? value : {};
  return {
    proposal: raw.proposal === true,
    design: raw.design === true,
    tasks: raw.tasks === true,
    specs: Array.isArray(raw.specs)
      ? raw.specs.filter((spec): spec is string => typeof spec === 'string')
      : [],
  };
}

/** Validates one change row from the API; rows that do not fit are dropped. */
export function parseChangeRow(value: unknown): ChangeRow | null {
  if (!isRecord(value) || !isChangeId(value.id)) return null;
  if (!isChangeStatus(value.status)) return null;
  const reason = value.notReadyReason;
  const tasks = isRecord(value.tasks) ? value.tasks : {};
  return {
    id: value.id,
    title: str(value.title) || value.id,
    archived: value.archived === true,
    archivedOn: strOrNull(value.archivedOn),
    dependsOn: Array.isArray(value.dependsOn)
      ? value.dependsOn.filter((dep): dep is string => typeof dep === 'string')
      : [],
    status: value.status,
    notReadyReason: reason === 'no-proposal' || reason === 'no-tasks' ? reason : null,
    artifacts: parseArtifacts(value.artifacts),
    tasks: { total: count(tasks.total), done: count(tasks.done) },
    ownerStepCount: count(value.ownerStepCount),
    unreadable: parseUnreadable(value.unreadable),
    approval: parseApproval(value.approval),
    uncommittedEdits: value.uncommittedEdits === true,
    uncommittedNotCheckable: Array.isArray(value.uncommittedNotCheckable)
      ? value.uncommittedNotCheckable.filter((p): p is string => typeof p === 'string')
      : [],
  };
}

async function fetchChanges(hostId: string, signal?: AbortSignal): Promise<ChangesSnapshot> {
  const body = await apiGet(`/api/hosts/${encodeURIComponent(hostId)}/changes`, signal);
  const raw = isRecord(body) ? body : {};
  return {
    hostId,
    hostName: str(raw.hostName),
    baseBranch: str(raw.baseBranch),
    tip: strOrNull(raw.tip),
    changes: Array.isArray(raw.changes)
      ? raw.changes.map(parseChangeRow).filter((row): row is ChangeRow => row !== null)
      : [],
  };
}

export const changesQuery = (hostId: string) =>
  queryOptions({
    queryKey: queryKeys.changes(hostId),
    queryFn: ({ signal }) => fetchChanges(hostId, signal),
    placeholderData: keepPreviousData,
  });

// ---------------------------------------------------------------------------------------------
// Wording.

/** Task progress as OpenSpec counts it: `3/8 tasks`, or `No tasks`. */
export function tasksText(tasks: { total: number; done: number }): string {
  if (tasks.total === 0) return 'No tasks';
  return `${tasks.done}/${tasks.total} ${tasks.total === 1 ? 'task' : 'tasks'}`;
}

export function ownerStepsText(n: number): string {
  return n === 1 ? '1 owner step' : `${n} owner steps`;
}

/** The artifacts present, in OpenSpec's order: proposal, specs, design, tasks. */
export function artifactsText(artifacts: Artifacts): string {
  const parts: string[] = [];
  if (artifacts.proposal) parts.push('Proposal');
  if (artifacts.specs.length > 0) {
    parts.push(artifacts.specs.length === 1 ? '1 spec' : `${artifacts.specs.length} specs`);
  }
  if (artifacts.design) parts.push('Design');
  if (artifacts.tasks) parts.push('Tasks');
  return parts.length === 0 ? '—' : parts.join(' · ');
}

/** The not-ready copy (design decision 8), shared with the approval dialog's refusal. */
export function notReadyText(
  changeId: string,
  hostName: string,
  reason: 'no-proposal' | 'no-tasks' | null,
): string {
  return reason === 'no-tasks'
    ? `${changeId} has no tasks.md yet. You sign the exact tasks the builder will run. Run /opsx:propose or add tasks in ${hostName}, commit, then come back.`
    : `${changeId} has no proposal.md yet. Run /opsx:propose in ${hostName}, commit, then come back.`;
}

/**
 * The uncommitted-edits soft hint (runway: Uncommitted edits do not change the runway): the
 * owner's checkout has uncommitted edits to an approved change. Purely
 * informational; the approval and the runway only follow what is committed on the base branch.
 */
export function UncommittedHint({
  baseBranch,
  notCheckable = [],
}: {
  baseBranch: string;
  notCheckable?: readonly string[];
}) {
  const text =
    notCheckable.length === 0
      ? `Uncommitted edits to this approved change. The approval only follows what is committed on ${baseBranch}.`
      : `Uncommitted edits can't be checked: a content filter applies to ${notCheckable.join(', ')}. The approval only follows what is committed on ${baseBranch}.`;
  return (
    <HStack gap={1} vAlign="start">
      <Icon icon="info" size="xsm" color="secondary" />
      <Text type="supporting" color="secondary">
        {text}
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

function matches(filter: Filter, row: ChangeRow): boolean {
  return filter === 'all' || row.status === filter;
}

/** Archived changes shown before `Show all`: a long archive never buries the active work. */
export const DONE_LIST_CAP = 20;

// ---------------------------------------------------------------------------------------------

const ROW_HEIGHT = 52;

function LoadingRows() {
  return (
    <VStack gap={2} aria-busy="true" aria-label="Loading changes">
      {[0, 1, 2, 3, 4].map((index) => (
        <Skeleton key={index} index={index} width="100%" height={ROW_HEIGHT} />
      ))}
    </VStack>
  );
}

function DoneList({ hostId, rows }: { hostId: string; rows: ChangeRow[] }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? rows : rows.slice(0, DONE_LIST_CAP);
  return (
    <VStack gap={2}>
      <Text type="label" weight="semibold" hasTabularNumbers>
        {`Done (${rows.length})`}
      </Text>
      <List hasDividers={shown.length > 1} aria-label="Archived changes">
        {shown.map((row) => (
          <ListItem
            key={`${row.archivedOn ?? ''}-${row.id}`}
            href={`/h/${hostId}/changes/${row.id}`}
            label={
              <HStack gap={2} vAlign="center">
                <Text maxLines={1} hasTruncateTooltip>
                  {row.title}
                </Text>
                <Text type="code" color="secondary" textWrap="nowrap">
                  {row.id}
                </Text>
              </HStack>
            }
            description={
              <Text type="supporting" color="secondary" hasTabularNumbers>
                {row.archivedOn === null ? 'Archived' : `Archived ${row.archivedOn}`}
              </Text>
            }
            endContent={<StatusBadge status={row.status} />}
          />
        ))}
      </List>
      {rows.length > shown.length ? (
        <Link onClick={() => setShowAll(true)}>
          {`Show all ${rows.length} archived changes (${rows.length - shown.length} more)`}
        </Link>
      ) : null}
    </VStack>
  );
}

export function ChangesPage({ hostId }: { hostId: string }) {
  const query = useQuery(changesQuery(hostId));
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    document.title = 'Changes · Counterpoint';
  }, []);

  // keepPreviousData can briefly hold another host's rows while switching; never show them.
  const data = query.data?.hostId === hostId ? query.data : undefined;
  const all = data?.changes ?? [];
  const hostName = data?.hostName ?? '';
  const active = useMemo(() => all.filter((row) => !row.archived), [all]);
  const archived = useMemo(() => all.filter((row) => row.archived), [all]);
  const knownIds = useMemo(() => new Set(active.map((row) => row.id)), [active]);

  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: 0, ready: 0, 'on-runway': 0, changed: 0 };
    for (const row of active) {
      result.all += 1;
      if (row.status === 'ready' || row.status === 'on-runway' || row.status === 'changed') {
        result[row.status] += 1;
      }
    }
    return result;
  }, [active]);

  const visible = active.filter((row) => matches(filter, row));
  const detailHref = (id: string) => `/h/${hostId}/changes/${id}`;

  const columns: TableColumn<ChangeRow>[] = [
    {
      key: 'change',
      header: 'Change',
      renderCell: (row) => (
        <Link href={detailHref(row.id)} label={`${row.title} (${row.id})`}>
          <VStack gap={0.5}>
            <Text maxLines={1} hasTruncateTooltip>
              {row.title}
            </Text>
            {/* nowrap: in a narrow column the name never breaks letter by letter. */}
            <Text type="code" color="secondary" textWrap="nowrap">
              {row.id}
            </Text>
          </VStack>
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
            <UncommittedHint
              baseBranch={data?.baseBranch ?? ''}
              notCheckable={row.uncommittedNotCheckable}
            />
          </VStack>
        ) : (
          <StatusBadge status={row.status} />
        ),
    },
    {
      key: 'tasks',
      header: 'Tasks',
      renderCell: (row) => (
        <VStack gap={1}>
          <Text hasTabularNumbers>{tasksText(row.tasks)}</Text>
          {row.ownerStepCount > 0 ? (
            <Token label={ownerStepsText(row.ownerStepCount)} size="sm" />
          ) : null}
        </VStack>
      ),
    },
    {
      key: 'artifacts',
      header: 'Artifacts',
      renderCell: (row) => <Text color="secondary">{artifactsText(row.artifacts)}</Text>,
    },
    {
      key: 'depends',
      header: 'Depends on',
      renderCell: (row) =>
        row.dependsOn.length === 0 ? (
          <Text color="secondary">—</Text>
        ) : (
          <VStack gap={0.5}>
            {row.dependsOn.map((dep) =>
              knownIds.has(dep) ? (
                <Link key={dep} href={detailHref(dep)}>
                  <Text type="code">{dep}</Text>
                </Link>
              ) : (
                <Text key={dep} type="code" color="secondary">
                  {dep}
                </Text>
              ),
            )}
          </VStack>
        ),
    },
    {
      key: 'approval',
      header: 'Approval',
      // Verified from git at the base tip by the server; never a stored flag.
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

  // The whole row opens Change detail; the Change cell's link is the keyboard path.
  const rowLink: TablePlugin<ChangeRow> = {
    transformBodyRow: (props, row) => ({
      ...props,
      htmlProps: {
        ...props.htmlProps,
        style: { ...props.htmlProps.style, cursor: 'pointer' },
        onClick: (event) => {
          props.htmlProps.onClick?.(event);
          if (event.defaultPrevented) return;
          void navigate({
            to: '/h/$hostId/changes/$changeId',
            params: { hostId, changeId: row.id },
          });
        },
      },
    }),
  };

  const errorBanner = query.isError ? (
    <Banner
      status="error"
      title="Couldn't load changes"
      description="Counterpoint's daemon didn't answer."
      endContent={
        <Button
          label="Try loading changes again"
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
  } else if (all.length === 0) {
    body = (
      <EmptyState
        headingLevel={2}
        title={`No changes in ${hostName} yet`}
        description={`Counterpoint reads the committed openspec/changes/ folder of ${hostName} and found none. Run /opsx:propose in ${hostName}, commit, then come back.`}
      />
    );
  } else {
    // The source line also keeps the Table off the top edge of the content area, where Astryx's
    // edge compensation would pull its header row under the page header.
    body = (
      <VStack gap={6}>
        <VStack gap={4}>
          <Text type="supporting" color="secondary">
            {data.tip === null
              ? `Read from ${hostName}'s openspec/changes/.`
              : `Read from ${data.baseBranch} at ${data.tip.slice(0, 7)} (committed content only). Dependencies first.`}
          </Text>
          <Table<ChangeRow>
            data={visible}
            columns={columns}
            idKey="id"
            hasHover
            plugins={{ rowLink }}
            emptyState={
              <VStack gap={2} hAlign="center" padding={6}>
                <Text>
                  {active.length === 0 ? 'No active changes' : 'No changes match this filter'}
                </Text>
                {active.length === 0 ? null : (
                  <Link onClick={() => setFilter('all')}>Show all changes</Link>
                )}
              </VStack>
            }
          />
        </VStack>
        {archived.length > 0 ? <DoneList hostId={hostId} rows={archived} /> : null}
      </VStack>
    );
  }

  return (
    <Layout
      header={
        <LayoutHeader>
          <HStack gap={4} vAlign="center" justify="between" wrap="wrap">
            <Heading level={2} accessibilityLevel={1}>
              Changes
            </Heading>
            <SegmentedControl
              label="Filter changes by status"
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

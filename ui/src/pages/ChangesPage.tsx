// Changes (`/h/{hostId}/changes`, host-planning: Active changes listed; Archived changes are
// done; long titles wrap): every
// active OpenSpec change of the host in build order (dependencies first), with status (the page's
// focal point), task progress, owner steps, artifacts, dependencies and approval; then the
// archived changes as Built, newest first, capped at DONE_LIST_CAP until `Show all`. Data is a
// snapshot from GET /api/hosts/{id}/changes, refetched when a `planning` or `approval` event
// arrives; a refresh keeps the current rows on screen.
//
// Approving is one click (approvals: Approve in one click): `Approve` on a Ready to approve row,
// `Approve all` in the header, and `Withdraw` on an On runway row. A change in the build lane shows
// where it stands instead of its status (runway: Where each runway change stands): Building,
// Parked, On hold, PR open (with the PR), PR closed, or Waits on a change that is not built.
//
// Every string here comes from the host's planning files (agent-written, untrusted) and renders
// as React text only.
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
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
import { useApprovalActions } from '../approvals';
import { ChangeBadge, type ChangeStatus, isChangeStatus } from '../components/StatusBadge';
import { isChangeId } from '../ids';
import { type ChangeStage, parseStage } from '../stage';

// ---------------------------------------------------------------------------------------------
// API shapes (GET /api/hosts/{id}/changes and /changes/{changeId}); shared with Change detail.

export type UnreadableFile = { file: string; reason: string };

/** A change's approval: the owner approved it, and it is on the runway. */
export type ApprovalFacts = { state: 'on-runway'; approvedAt: number };

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
  /** Where it stands in the build lane, or null. */
  stage: ChangeStage | null;
  /** Why it shows Built: archived, every task checked, or its build PR merged. */
  builtBy: 'archived' | 'tasks' | 'merged' | null;
  /** Its latest build PR, if it has one. */
  prUrl: string | null;
  /** The change's design drafts, when started (design-drafts D-12). */
  drafts: { held: boolean; waiting: string[] } | null;
};

/** Which base the changes were read from, and how its fetch went (host API `base`). */
export type BaseFacts = {
  /** `origin/master`, or the local branch when local only. */
  ref: string;
  remote: string | null;
  localOnly: boolean;
  fetchedAt: number | null;
  error: string | null;
  failedAt: number | null;
  localAhead: number;
};

export type ChangesSnapshot = {
  hostId: string;
  hostName: string;
  baseBranch: string;
  tip: string | null;
  base: BaseFacts | null;
  changes: ChangeRow[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const strOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

const timeOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;

function parseBase(value: unknown): BaseFacts | null {
  if (!isRecord(value) || typeof value.ref !== 'string') return null;
  return {
    ref: value.ref,
    remote: strOrNull(value.remote),
    localOnly: value.localOnly === true,
    fetchedAt: timeOrNull(value.fetchedAt),
    error: strOrNull(value.error),
    failedAt: timeOrNull(value.failedAt),
    localAhead: count(value.localAhead),
  };
}

/** "just now", "12 min ago", "3 h ago". */
function ago(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}

/** "09:14" today, else the date too. */
function clock(at: number, now: number): string {
  const date = new Date(at);
  const sameDay = date.toDateString() === new Date(now).toDateString();
  return sameDay
    ? date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * The line under the source line, only when something is off (D-6): the latest fetch failed, the
 * host has no remote, or the local base branch has commits that are not on the remote.
 */
export function baseNotes(baseBranch: string, base: BaseFacts | null, now: number): string[] {
  if (base === null) return [];
  const notes: string[] = [];
  if (base.error !== null) {
    const when = base.failedAt === null ? '' : ` ${ago(base.failedAt, now)}`;
    const shown =
      base.fetchedAt === null
        ? `Showing ${base.ref} as last fetched.`
        : `Showing ${base.ref} as fetched at ${clock(base.fetchedAt, now)}.`;
    notes.push(`Last fetch failed${when}: ${base.error.replace(/\.$/, '')}. ${shown}`);
  }
  if (base.localOnly) {
    notes.push(
      base.remote === null
        ? `Local only: ${baseBranch} has no remote, so it is read from this computer.`
        : `Local only: ${base.remote} has no ${baseBranch} yet, so it is read from this computer.`,
    );
  } else if (base.localAhead > 0) {
    const commits = base.localAhead === 1 ? '1 commit' : `${base.localAhead} commits`;
    notes.push(
      `${baseBranch} has ${commits} not on ${base.remote ?? 'the remote'}; ${base.localAhead === 1 ? 'it is' : 'they are'} not built.`,
    );
  }
  return notes;
}

function parseUnreadable(value: unknown): UnreadableFile | null {
  return isRecord(value) ? { file: str(value.file), reason: str(value.reason) } : null;
}

/** The approval facts of a row; anything that does not fit is treated as no approval. */
export function parseApproval(value: unknown): ApprovalFacts | null {
  if (!isRecord(value) || value.state !== 'on-runway') return null;
  return { state: 'on-runway', approvedAt: count(value.approvedAt) };
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
    stage: parseStage(value.stage),
    builtBy:
      value.builtBy === 'archived' || value.builtBy === 'tasks' || value.builtBy === 'merged'
        ? value.builtBy
        : null,
    prUrl:
      isRecord(value.pr) && typeof value.pr.url === 'string' && value.pr.url.startsWith('https://')
        ? value.pr.url
        : null,
    drafts: parseDrafts(value.drafts),
  };
}

function parseDrafts(value: unknown): ChangeRow['drafts'] {
  if (!isRecord(value)) return null;
  return {
    held: value.held === true,
    waiting: Array.isArray(value.waiting)
      ? value.waiting.filter((name): name is string => typeof name === 'string')
      : [],
  };
}

/** A change's status, with "Waiting for sign-off" when its design drafts hold it. */
export function ChangeStatusBadges({
  row,
}: {
  row: Pick<ChangeRow, 'status' | 'stage' | 'drafts'>;
}) {
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      <ChangeBadge status={row.status} stage={row.stage} />
      {row.drafts?.held === true ? <Badge variant="warning" label="Waiting for sign-off" /> : null}
    </HStack>
  );
}

async function fetchChanges(hostId: string, signal?: AbortSignal): Promise<ChangesSnapshot> {
  const body = await apiGet(`/api/hosts/${encodeURIComponent(hostId)}/changes`, signal);
  const raw = isRecord(body) ? body : {};
  return {
    hostId,
    hostName: str(raw.hostName),
    baseBranch: str(raw.baseBranch),
    tip: strOrNull(raw.tip),
    base: parseBase(raw.base),
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

/** The not-ready copy, shared with Change detail. */
export function notReadyText(
  changeId: string,
  hostName: string,
  reason: 'no-proposal' | 'no-tasks' | null,
): string {
  return reason === 'no-tasks'
    ? `${changeId} has no tasks.md yet. The builder works from its tasks. Run /opsx:propose or add tasks in ${hostName}, commit, then come back.`
    : `${changeId} has no proposal.md yet. Run /opsx:propose in ${hostName}, commit, then come back.`;
}

type Filter = 'all' | 'ready' | 'on-runway';

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ready', label: 'Ready to approve' },
  { value: 'on-runway', label: 'On runway' },
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
            endContent={<ChangeStatusBadges row={row} />}
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
  const actions = useApprovalActions(hostId);

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
    const result: Record<Filter, number> = { all: 0, ready: 0, 'on-runway': 0 };
    for (const row of active) {
      result.all += 1;
      if (row.status === 'ready' || row.status === 'on-runway') result[row.status] += 1;
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
        row.stage?.kind === 'pr-open' || row.stage?.kind === 'pr-closed' ? (
          // biome-ignore lint/a11y/noStaticElementInteractions: only stops the row's click
          // biome-ignore lint/a11y/useKeyWithClickEvents: the link inside takes the keyboard
          <span onClick={(event) => event.stopPropagation()}>
            <HStack gap={2} vAlign="center" wrap="wrap">
              <ChangeStatusBadges row={row} />
              <Link href={row.stage.prUrl} target="_blank" rel="noreferrer">
                Open the PR
              </Link>
            </HStack>
          </span>
        ) : (
          <ChangeStatusBadges row={row} />
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
      // A click on a button here acts on the change; it never opens the row.
      renderCell: (row) => {
        if (row.status === 'ready') {
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: only stops the row's click
            // biome-ignore lint/a11y/useKeyWithClickEvents: the button inside takes the keyboard
            <span onClick={(event) => event.preventDefault()}>
              <Button
                label="Approve"
                variant="primary"
                size="sm"
                isLoading={actions.pending === row.id}
                onClick={() => void actions.approve(row.id)}
              />
            </span>
          );
        }
        if (row.status === 'on-runway' && row.approval !== null) {
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: only stops the row's click
            // biome-ignore lint/a11y/useKeyWithClickEvents: the button inside takes the keyboard
            <span onClick={(event) => event.preventDefault()}>
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Text type="supporting" color="secondary">
                  {'Approved '}
                  <Timestamp value={new Date(row.approval.approvedAt).toISOString()} hasTooltip />
                </Text>
                <Button
                  label="Withdraw"
                  variant="ghost"
                  size="sm"
                  isLoading={actions.pending === row.id}
                  onClick={() => void actions.withdraw(row.id)}
                />
              </HStack>
            </span>
          );
        }
        return <Text color="secondary">—</Text>;
      },
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
          <VStack gap={1}>
            <Text type="supporting" color="secondary">
              {data.tip === null
                ? `Read from ${hostName}'s openspec/changes/.`
                : `Read from ${data.base?.ref ?? data.baseBranch} at ${data.tip.slice(0, 7)}. Dependencies first.`}
            </Text>
            {baseNotes(data.baseBranch, data.base, Date.now()).map((note) => (
              <Text key={note} type="supporting">
                {note}
              </Text>
            ))}
          </VStack>
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
            {counts.ready > 0 ? (
              <Button
                label={`Approve all (${counts.ready})`}
                variant="primary"
                isLoading={actions.pending === 'all'}
                onClick={() => void actions.approveAll()}
              />
            ) : null}
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
            {actions.error === null ? null : <Banner status="error" title={actions.error} />}
            {body}
          </VStack>
        </LayoutContent>
      }
    />
  );
}

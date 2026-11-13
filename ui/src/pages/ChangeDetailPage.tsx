// Change detail (`/h/{hostId}/changes/{changeId}`, host-planning: Change detail; long titles, paths
// and owner steps wrap): the change's title and why, why it is or is not approvable, its owner
// steps (shown prominently, they never block approval), dependencies, artifacts, task progress,
// the base-branch tip and the approval state, all read at the base branch tip.
//
// `Approve` is the page's one primary action, rendered only for Ready to approve: one click puts
// the change on the runway (approvals: Approve in one click). An On runway change offers
// `Withdraw` instead, and `Retry` while it is parked or on hold. Where it stands in the build lane
// (building, parked, on hold, PR open with its link, waiting on a dependency) shows in its badge
// and a banner; a Built change says why it is built and keeps its open owner steps.
// Every string comes from the host's planning files (untrusted) and renders as React text only.
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { VStack } from '@astryxdesign/core/VStack';
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';
import { ApiError, apiGet, queryKeys } from '../api';
import { useApprovalActions } from '../approvals';
import { OwnerStepsBanner } from '../components/OwnerStepsBanner';
import { ChangeBadge } from '../components/StatusBadge';
import { builtText, canRetry, stageBanner } from '../stage';
import {
  type ChangeRow,
  ChangeStatusBadges,
  changesQuery,
  notReadyText,
  parseChangeRow,
  tasksText,
} from './ChangesPage';

type ChangeDetail = ChangeRow & {
  hostId: string;
  hostName: string;
  baseBranch: string;
  tip: string | null;
  why: string | null;
  ownerSteps: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const strOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

async function fetchChange(
  hostId: string,
  changeId: string,
  signal?: AbortSignal,
): Promise<ChangeDetail> {
  const body = await apiGet(
    `/api/hosts/${encodeURIComponent(hostId)}/changes/${encodeURIComponent(changeId)}`,
    signal,
  );
  const row = parseChangeRow(body);
  if (row === null || !isRecord(body)) throw new ApiError(502);
  return {
    ...row,
    hostId,
    hostName: str(body.hostName),
    baseBranch: str(body.baseBranch),
    tip: strOrNull(body.tip),
    why: strOrNull(body.why),
    ownerSteps: Array.isArray(body.ownerSteps)
      ? body.ownerSteps.filter((step): step is string => typeof step === 'string')
      : [],
  };
}

const changeQuery = (hostId: string, changeId: string) =>
  queryOptions({
    queryKey: queryKeys.change(hostId, changeId),
    queryFn: ({ signal }) => fetchChange(hostId, changeId, signal),
    placeholderData: keepPreviousData,
  });

function ReasonBanners({ change }: { change: ChangeDetail }) {
  const host = change.hostName;
  const banners: ReactNode[] = [];

  if (change.status === 'unreadable' && change.unreadable !== null) {
    banners.push(
      <Banner
        key="unreadable"
        status="error"
        title={`Couldn't read ${change.id}`}
        description={`${change.unreadable.file} could not be parsed: ${change.unreadable.reason}. Other changes are unaffected. Fix the file in ${host}; this page refreshes on its own.`}
      />,
    );
  } else if (change.status === 'built') {
    banners.push(
      <Banner
        key="built"
        status="info"
        title="Already built"
        description={
          <>
            {builtText(change.id, change.builtBy, change.ownerSteps.length)}
            {change.builtBy === 'merged' && change.prUrl !== null ? (
              <>
                {' '}
                <Link href={change.prUrl} target="_blank" rel="noreferrer">
                  Open the PR
                </Link>
              </>
            ) : null}
          </>
        }
      />,
    );
  } else if (change.status === 'owner-steps') {
    banners.push(
      <Banner
        key="owner-steps-left"
        status="info"
        title="Only owner steps are left"
        description={`Every other task in ${change.id} is checked, so there is nothing to build. It shows Built once the owner steps below are checked too. Approval is not offered.`}
      />,
    );
  } else if (change.status === 'not-planned') {
    banners.push(
      <Banner
        key="not-ready"
        status="info"
        title="Not ready to approve"
        description={notReadyText(change.id, host, change.notReadyReason)}
      />,
    );
  }

  if (change.drafts?.held === true) {
    banners.push(
      <Banner
        key="drafts"
        status="warning"
        title="Waiting for sign-off"
        description={`It builds once every screen is signed off and on the base branch. Waiting: ${change.drafts.waiting.join(', ')}.`}
      />,
    );
  }

  // Where it stands in the build lane, and what the owner can do about it.
  if (change.stage !== null) {
    const { title, description } = stageBanner(change.id, change.stage);
    const prUrl =
      change.stage.kind === 'pr-open' || change.stage.kind === 'pr-closed'
        ? change.stage.prUrl
        : null;
    banners.push(
      <Banner
        key="stage"
        status={change.stage.kind === 'parked' || change.stage.kind === 'held' ? 'warning' : 'info'}
        title={title}
        description={
          prUrl !== null ? (
            <>
              {description}{' '}
              <Link href={prUrl} target="_blank" rel="noreferrer">
                Open the PR
              </Link>
            </>
          ) : (
            description
          )
        }
      />,
    );
  }

  // Owner steps are shown prominently, but approval stays allowed (host-planning "Change detail").
  // A built change keeps them until they are ticked or it is archived (owner-steps: Owner steps of
  // built changes stay cards).
  if (change.ownerSteps.length > 0 && !change.archived) {
    banners.push(<OwnerStepsBanner key="owner-steps" steps={change.ownerSteps} />);
  }

  return banners.length === 0 ? null : <VStack gap={4}>{banners}</VStack>;
}

function artifactList(change: ChangeDetail): string[] {
  const parts: string[] = [];
  if (change.artifacts.proposal) parts.push('proposal.md');
  for (const spec of change.artifacts.specs) parts.push(`specs/${spec}/spec.md`);
  if (change.artifacts.design) parts.push('design.md');
  if (change.artifacts.tasks) parts.push('tasks.md');
  return parts;
}

function DependsOn({ hostId, change }: { hostId: string; change: ChangeDetail }) {
  // Known dependencies link to their change; unknown or archived ones are shown as written.
  const list = useQuery(changesQuery(hostId));
  if (change.dependsOn.length === 0) return <Text>—</Text>;
  const rows = list.data?.hostId === hostId ? list.data.changes : [];
  return (
    <VStack gap={0.5}>
      {change.dependsOn.map((dep) => {
        const known = rows.find((row) => row.id === dep && !row.archived);
        return known === undefined ? (
          <Text key={dep} type="code">
            {dep}
          </Text>
        ) : (
          <Link key={dep} href={`/h/${hostId}/changes/${dep}`}>
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Text type="code">{dep}</Text>
              <ChangeBadge status={known.status} stage={known.stage} />
            </HStack>
          </Link>
        );
      })}
    </VStack>
  );
}

function LoadingDetail() {
  return (
    <VStack gap={6} aria-busy="true" aria-label="Loading change">
      <Skeleton width={360} height={28} />
      <VStack gap={2}>
        <Skeleton width="60%" height={20} />
        <Skeleton width="40%" height={20} />
        <Skeleton width="30%" height={20} />
      </VStack>
      <VStack gap={2}>
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} index={index} width="100%" height={44} />
        ))}
      </VStack>
    </VStack>
  );
}

function ApprovalFactsItems({ change }: { change: ChangeDetail }) {
  const approval = change.approval;
  if (approval === null) return null;
  return (
    <MetadataListItem label="Approved">
      <Timestamp value={new Date(approval.approvedAt).toISOString()} hasTooltip />
    </MetadataListItem>
  );
}

export function ChangeDetailPage({ hostId, changeId }: { hostId: string; changeId: string }) {
  const query = useQuery(changeQuery(hostId, changeId));
  const change =
    query.data?.hostId === hostId && query.data.id === changeId ? query.data : undefined;
  const actions = useApprovalActions(hostId);

  useEffect(() => {
    document.title = `${changeId} · Counterpoint`;
  }, [changeId]);

  const notFound = query.error instanceof ApiError && query.error.status === 404;
  const errorBanner = query.isError ? (
    <Banner
      status="error"
      title={notFound ? `${changeId} isn't a change here` : "Couldn't load this change"}
      description={
        notFound
          ? 'It may have been renamed or removed on the base branch.'
          : "Counterpoint's daemon didn't answer."
      }
      endContent={
        <Button
          label="Try loading this change again"
          variant="secondary"
          isLoading={query.isFetching}
          onClick={() => void query.refetch()}
        />
      }
    />
  ) : null;

  const header =
    change === undefined ? (
      query.isError ? (
        <Heading level={2} accessibilityLevel={1}>
          {changeId}
        </Heading>
      ) : (
        <Skeleton width={320} height={28} />
      )
    ) : (
      <VStack gap={2}>
        <HStack gap={4} vAlign="center" justify="between" wrap="wrap">
          <HStack gap={4} vAlign="center" wrap="wrap">
            <Heading level={2} accessibilityLevel={1}>
              {change.title}
            </Heading>
            <ChangeStatusBadges row={change} />
          </HStack>
          <HStack gap={2} vAlign="center">
            {change.archived ? null : (
              <Button
                label="Drafts"
                variant="secondary"
                href={`/h/${hostId}/changes/${change.id}/drafts`}
              />
            )}
            {change.status === 'ready' ? (
              <Button
                label="Approve"
                variant="primary"
                isLoading={actions.pending === change.id}
                onClick={() => void actions.approve(change.id)}
              />
            ) : null}
            {change.status === 'on-runway' && canRetry(change.stage) ? (
              <Button
                label="Retry"
                variant="primary"
                isLoading={actions.pending === change.id}
                onClick={() => void actions.retry(change.id)}
              />
            ) : null}
            {change.status === 'on-runway' ? (
              <Button
                label="Withdraw"
                variant="secondary"
                isLoading={actions.pending === change.id}
                onClick={() => void actions.withdraw(change.id)}
              />
            ) : null}
          </HStack>
        </HStack>
        <Text type="code" color="secondary">
          {change.id}
        </Text>
        {actions.error === null ? null : <Banner status="error" title={actions.error} />}
      </VStack>
    );

  let body: ReactNode = null;
  if (change === undefined) {
    body = query.isError ? null : <LoadingDetail />;
  } else {
    const artifacts = artifactList(change);
    body = (
      <VStack gap={6}>
        <ReasonBanners change={change} />
        {change.why === null ? null : (
          <VStack gap={2}>
            <Text type="label" weight="semibold">
              Why
            </Text>
            <Text style={{ whiteSpace: 'pre-wrap' }}>{change.why}</Text>
          </VStack>
        )}
        <MetadataList>
          <MetadataListItem label="Depends on">
            <DependsOn hostId={hostId} change={change} />
          </MetadataListItem>
          <MetadataListItem label="Artifacts">
            {artifacts.length === 0 ? (
              <Text>—</Text>
            ) : (
              <VStack gap={0.5}>
                {artifacts.map((artifact) => (
                  <Text key={artifact} type="code" wordBreak="break-all">
                    {artifact}
                  </Text>
                ))}
              </VStack>
            )}
          </MetadataListItem>
          <MetadataListItem label="Tasks">
            <Text hasTabularNumbers>{tasksText(change.tasks)}</Text>
          </MetadataListItem>
          {change.archivedOn === null ? null : (
            <MetadataListItem label="Archived">
              <Text hasTabularNumbers>{change.archivedOn}</Text>
            </MetadataListItem>
          )}
          <MetadataListItem label="Base branch tip">
            {change.tip === null ? (
              <Text>—</Text>
            ) : (
              <Tooltip content={<Text type="code">{change.tip}</Text>}>
                <Text type="code" aria-label={`${change.baseBranch} at ${change.tip}`}>
                  {`${change.baseBranch} @ ${change.tip.slice(0, 7)}`}
                </Text>
              </Tooltip>
            )}
          </MetadataListItem>
          <ApprovalFactsItems change={change} />
        </MetadataList>
      </VStack>
    );
  }

  return (
    <Layout
      header={<LayoutHeader>{header}</LayoutHeader>}
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

// Change detail (`/h/{hostId}/changes/{changeId}`, host-planning: Change detail; long titles, paths
// and owner steps wrap): the change's title and why, why it is or is not approvable, its owner
// steps (shown prominently, they never block approval), dependencies, artifacts, task progress, and
// exactly which files a signature would bind (every file in the change directory), all read at the
// base branch tip (host-planning: Committed content only).
//
// `Approve change` is the page's one primary action, rendered only for Ready to approve;
// it opens the approval dialog, which previews and hands over the terminal command (no signing in
// the browser). A Changed-since-signed change offers `Review changes` (its Needs You drift view)
// instead, and an approved change with uncommitted edits shows the soft hint under the header
// (runway: Uncommitted edits do not change the runway).
// Approval facts (signed at, commit) are the server's verification from git.
// Every string comes from the host's planning files (untrusted) and renders as React text only.
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Table, type TableColumn } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { VStack } from '@astryxdesign/core/VStack';
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { ApiError, apiGet, queryKeys } from '../api';
import { ApprovalDialog } from '../components/ApprovalDialog';
import { OwnerStepsBanner } from '../components/OwnerStepsBanner';
import { StatusBadge } from '../components/StatusBadge';
import {
  type ChangeRow,
  changesQuery,
  notReadyText,
  parseChangeRow,
  tasksText,
  UncommittedHint,
} from './ChangesPage';

type InputRow = {
  path: string;
  label: string;
  kind: string;
  digest: string;
};

type ChangeDetail = ChangeRow & {
  hostId: string;
  hostName: string;
  baseBranch: string;
  tip: string | null;
  why: string | null;
  ownerSteps: string[];
  inputs: InputRow[];
  inputsError: string | null;
};

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const strOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function parseInput(value: unknown): InputRow | null {
  if (!isRecord(value) || typeof value.path !== 'string') return null;
  if (typeof value.digest !== 'string' || !DIGEST_RE.test(value.digest)) return null;
  return { path: value.path, label: str(value.label), kind: str(value.kind), digest: value.digest };
}

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
    inputs: Array.isArray(body.inputs)
      ? body.inputs.map(parseInput).filter((input): input is InputRow => input !== null)
      : [],
    inputsError: strOrNull(body.inputsError),
  };
}

const changeQuery = (hostId: string, changeId: string) =>
  queryOptions({
    queryKey: queryKeys.change(hostId, changeId),
    queryFn: ({ signal }) => fetchChange(hostId, changeId, signal),
    placeholderData: keepPreviousData,
  });

/** The 12-hex short digest shown in the UI; the full value is in a Tooltip. */
function shortDigest(digest: string): string {
  return digest.slice(7, 19);
}

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
          change.archived
            ? `${change.id} is archived, so there is nothing left to run. Approval is not offered.`
            : `Every task in ${change.id} is checked, so there is nothing left to run. Approval is not offered.`
        }
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

  // Owner steps are shown prominently, but approval stays allowed (host-planning "Change detail").
  if (change.ownerSteps.length > 0 && change.status !== 'built') {
    banners.push(<OwnerStepsBanner key="owner-steps" steps={change.ownerSteps} />);
  }

  return banners.length === 0 ? null : <VStack gap={4}>{banners}</VStack>;
}

const inputColumns: TableColumn<InputRow>[] = [
  {
    key: 'file',
    header: 'File',
    renderCell: (input) => (
      <Text type="code" wordBreak="break-all">
        {input.path}
      </Text>
    ),
  },
  {
    key: 'digest',
    header: 'Digest',
    renderCell: (input) => (
      <Tooltip content={<Text type="code">{input.digest}</Text>}>
        <Text type="code" aria-label={input.digest}>
          {shortDigest(input.digest)}
        </Text>
      </Tooltip>
    ),
  },
];

function InputsCard({ change }: { change: ChangeDetail }) {
  const files = change.inputs.length;
  return (
    <Card padding={4} elevation="none" aria-label="Covered files">
      <VStack gap={4}>
        <VStack gap={1}>
          <Text type="label" weight="semibold">
            Covered files
          </Text>
          <Text type="supporting" color="secondary" hasTabularNumbers>
            {`An approval signs ${files === 1 ? 'this file' : `these ${files} files`} as committed at the base branch tip. Ticking task boxes in tasks.md does not count as a change.`}
          </Text>
        </VStack>
        {change.inputsError === null ? (
          <Table<InputRow> data={change.inputs} columns={inputColumns} idKey="path" />
        ) : (
          <Banner
            status="error"
            title="Couldn't read this change's files"
            description={change.inputsError}
          />
        )}
      </VStack>
    </Card>
  );
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
              <StatusBadge status={known.status} />
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
  if (approval.state === 'invalid') {
    return (
      <MetadataListItem label="Approval">
        <Text>{`not verified (${approval.reason})`}</Text>
      </MetadataListItem>
    );
  }
  return (
    <MetadataListItem label="Signed">
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Timestamp value={approval.signedAt} hasTooltip />
        <Tooltip content={<Text type="code">{approval.commit}</Text>}>
          <Text type="code" aria-label={`commit ${approval.commit}`}>
            {approval.commit.slice(0, 7)}
          </Text>
        </Tooltip>
      </HStack>
    </MetadataListItem>
  );
}

export function ChangeDetailPage({ hostId, changeId }: { hostId: string; changeId: string }) {
  const query = useQuery(changeQuery(hostId, changeId));
  const change =
    query.data?.hostId === hostId && query.data.id === changeId ? query.data : undefined;
  const [approving, setApproving] = useState(false);

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
            <StatusBadge status={change.status} />
          </HStack>
          {change.status === 'ready' ? (
            <Button label="Approve change" variant="primary" onClick={() => setApproving(true)} />
          ) : null}
          {change.status === 'changed' ? (
            // The Needs You item for this change (its drift view), where the owner re-signs.
            <Button
              label="Review changes"
              variant="secondary"
              href={`/h/${hostId}/needs-you/${change.id}`}
            />
          ) : null}
        </HStack>
        <Text type="code" color="secondary">
          {change.id}
        </Text>
        {/* Uncommitted-edits soft hint (shared with the Changes row), reading:
            `Uncommitted edits to this approved change. The approval only follows what is committed on {base}.` */}
        {change.uncommittedEdits ? <UncommittedHint baseBranch={change.baseBranch} /> : null}
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
        <InputsCard change={change} />
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
            {change !== undefined ? (
              // Mounted with the page, so it stays open after the change leaves Ready (it just
              // landed) and returns focus to `Approve change` on close.
              <ApprovalDialog
                hostId={hostId}
                hostName={change.hostName}
                changeId={change.id}
                changeTitle={change.title}
                isOpen={approving}
                onOpenChange={setApproving}
                currentTip={change.tip}
                approval={change.approval}
              />
            ) : null}
          </VStack>
        </LayoutContent>
      }
    />
  );
}

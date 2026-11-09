// Phase detail (`/h/{hostId}/phases/{phaseId}`, UI-SPEC "Screens and Layout" Phase detail and
// E4): why the phase is or is not approvable (D-01), what setup it needs, its plans, and exactly
// which inputs a signature would bind (D-02), all read at the base branch tip (D-03).
//
// `Approve phase` (01-13) is the page's one primary action, rendered only for Ready to approve; it
// opens the approval dialog, which previews and hands over the terminal command (no signing in
// the browser). A Changed-since-signed phase offers `Review changes` (its Needs You change view)
// instead, and an approved phase with uncommitted edits shows the D-03 soft hint under the header.
// Approval facts (signed at, commit) are the server's verification from git.
// Every string comes from the host's planning files (untrusted) and renders as React text only.
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
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
import { StatusBadge } from '../components/StatusBadge';
import {
  type PhaseRow,
  parsePhaseRow,
  plansText,
  setupItemText,
  UncommittedHint,
} from './PhasesPage';

type PlanRow = {
  id: string;
  wave: number | null;
  objective: string | null;
  autonomous: boolean;
  filesCount: number;
};

type InputRow = {
  path: string;
  label: string;
  kind: string;
  digest: string;
};

type PhaseDetail = PhaseRow & {
  hostId: string;
  hostName: string;
  baseBranch: string;
  tip: string | null;
  goal: string | null;
  dependsOn: string | null;
  plans: PlanRow[];
  inputs: InputRow[];
  inputsError: string | null;
};

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const strOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

function parsePlan(value: unknown): PlanRow | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  return {
    id: value.id,
    wave: typeof value.wave === 'number' ? value.wave : null,
    objective: strOrNull(value.objective),
    autonomous: value.autonomous !== false,
    filesCount: count(value.filesCount),
  };
}

function parseInput(value: unknown): InputRow | null {
  if (!isRecord(value) || typeof value.path !== 'string') return null;
  if (typeof value.digest !== 'string' || !DIGEST_RE.test(value.digest)) return null;
  return { path: value.path, label: str(value.label), kind: str(value.kind), digest: value.digest };
}

async function fetchPhase(
  hostId: string,
  phaseId: string,
  signal?: AbortSignal,
): Promise<PhaseDetail> {
  const body = await apiGet(
    `/api/hosts/${encodeURIComponent(hostId)}/phases/${encodeURIComponent(phaseId)}`,
    signal,
  );
  const row = parsePhaseRow(body);
  if (row === null || !isRecord(body)) throw new ApiError(502);
  return {
    ...row,
    hostId,
    hostName: str(body.hostName),
    baseBranch: str(body.baseBranch),
    tip: strOrNull(body.tip),
    goal: strOrNull(body.goal),
    dependsOn: strOrNull(body.dependsOn),
    plans: Array.isArray(body.plans)
      ? body.plans.map(parsePlan).filter((plan): plan is PlanRow => plan !== null)
      : [],
    inputs: Array.isArray(body.inputs)
      ? body.inputs.map(parseInput).filter((input): input is InputRow => input !== null)
      : [],
    inputsError: strOrNull(body.inputsError),
  };
}

const phaseQuery = (hostId: string, phaseId: string) =>
  queryOptions({
    queryKey: queryKeys.phase(hostId, phaseId),
    queryFn: ({ signal }) => fetchPhase(hostId, phaseId, signal),
    placeholderData: keepPreviousData,
  });

/** The 12-hex short digest shown in the UI; the full value is in a Tooltip. */
function shortDigest(digest: string): string {
  return digest.slice(7, 19);
}

function presentText(k: number, n: number): string {
  return n === 1
    ? `${k} of 1 plan needs you present (not autonomous).`
    : `${k} of ${n} plans need you present (not autonomous).`;
}

function ReasonBanners({ phase }: { phase: PhaseDetail }) {
  const nn = phase.id;
  const host = phase.hostName;
  const banners: ReactNode[] = [];

  if (phase.status === 'unreadable' && phase.unreadable !== null) {
    banners.push(
      <Banner
        key="unreadable"
        status="error"
        title={`Couldn't read Phase ${nn}`}
        description={`${phase.unreadable.file} could not be parsed: ${phase.unreadable.reason}. Other phases are unaffected. Fix the file in ${host}; this page refreshes on its own.`}
      />,
    );
  } else if (phase.status === 'built') {
    banners.push(
      <Banner
        key="built"
        status="info"
        title="Already built"
        description={`Every plan in Phase ${nn} has a summary, so there is nothing left to run. Approval is not offered.`}
      />,
    );
  } else if (phase.status === 'not-planned') {
    banners.push(
      <Banner
        key="not-ready"
        status="info"
        title="Not ready to approve"
        description={
          phase.notReadyReason === 'no-plans'
            ? `Phase ${nn} has context but no plans yet. You sign the exact plans the builder will run. Run /gsd-plan-phase ${nn} in ${host}, then come back.`
            : `Phase ${nn} has no CONTEXT.md yet. Run /gsd-discuss-phase ${nn} and /gsd-plan-phase ${nn} in ${host}, then come back.`
        }
      />,
    );
  }

  // Prerequisites are shown prominently, but approval stays allowed (CONTEXT discretion).
  if (phase.userSetup.length > 0 || phase.nonAutonomousCount > 0) {
    banners.push(
      <Banner
        key="setup"
        status="warning"
        title="Setup needed before the builder can run this"
        description={
          <VStack gap={2}>
            {phase.userSetup.length > 0 ? (
              <VStack as="ul" gap={1}>
                {phase.userSetup.map((item) => (
                  <li key={item.service}>
                    <Text>{setupItemText(item)}</Text>
                  </li>
                ))}
              </VStack>
            ) : null}
            {phase.nonAutonomousCount > 0 ? (
              <Text hasTabularNumbers>
                {presentText(phase.nonAutonomousCount, phase.planCount)}
              </Text>
            ) : null}
          </VStack>
        }
      />,
    );
  }

  return banners.length === 0 ? null : <VStack gap={4}>{banners}</VStack>;
}

const planColumns: TableColumn<PlanRow>[] = [
  {
    key: 'plan',
    header: 'Plan',
    renderCell: (plan) => <Text type="code">{plan.id}</Text>,
  },
  {
    key: 'wave',
    header: 'Wave',
    renderCell: (plan) => (
      <Text hasTabularNumbers>{plan.wave === null ? '—' : String(plan.wave)}</Text>
    ),
  },
  {
    key: 'objective',
    header: 'Objective',
    renderCell: (plan) => <Text>{plan.objective ?? '—'}</Text>,
  },
  {
    key: 'autonomous',
    header: 'Autonomous',
    renderCell: (plan) => <Text>{plan.autonomous ? 'Yes' : 'No'}</Text>,
  },
  {
    key: 'files',
    header: 'Files',
    renderCell: (plan) => <Text hasTabularNumbers>{String(plan.filesCount)}</Text>,
  },
];

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

function InputsCard({ phase }: { phase: PhaseDetail }) {
  const files = phase.inputs.length;
  return (
    <Card padding={4} elevation="none" aria-label="Inputs">
      <VStack gap={4}>
        <VStack gap={1}>
          <Text type="label" weight="semibold">
            Inputs
          </Text>
          <Text type="supporting" color="secondary" hasTabularNumbers>
            {`An approval signs ${files === 1 ? 'this file' : `these ${files} files`} as committed at the base branch tip.`}
          </Text>
        </VStack>
        {phase.inputsError === null ? (
          <Table<InputRow> data={phase.inputs} columns={inputColumns} idKey="path" />
        ) : (
          <Banner
            status="error"
            title="Couldn't read this phase's inputs"
            description={phase.inputsError}
          />
        )}
      </VStack>
    </Card>
  );
}

function LoadingDetail() {
  return (
    <VStack gap={6} aria-busy="true" aria-label="Loading phase">
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

function ApprovalFactsItems({ phase }: { phase: PhaseDetail }) {
  const approval = phase.approval;
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

export function PhaseDetailPage({ hostId, phaseId }: { hostId: string; phaseId: string }) {
  const query = useQuery(phaseQuery(hostId, phaseId));
  const phase = query.data?.hostId === hostId && query.data.id === phaseId ? query.data : undefined;
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    document.title = `Phase ${phaseId} · Counterpoint`;
  }, [phaseId]);

  const notFound = query.error instanceof ApiError && query.error.status === 404;
  const errorBanner = query.isError ? (
    <Banner
      status="error"
      title={notFound ? `Phase ${phaseId} isn't in this roadmap` : "Couldn't load this phase"}
      description={
        notFound
          ? 'It may have been renumbered or removed on the base branch.'
          : "Counterpoint's daemon didn't answer."
      }
      endContent={
        <Button
          label="Try loading this phase again"
          variant="secondary"
          isLoading={query.isFetching}
          onClick={() => void query.refetch()}
        />
      }
    />
  ) : null;

  const header =
    phase === undefined ? (
      query.isError ? (
        <Heading level={2} accessibilityLevel={1}>
          {`Phase ${phaseId}`}
        </Heading>
      ) : (
        <Skeleton width={320} height={28} />
      )
    ) : (
      <VStack gap={2}>
        <HStack gap={4} vAlign="center" justify="between" wrap="wrap">
          <HStack gap={4} vAlign="center" wrap="wrap">
            <Heading level={2} accessibilityLevel={1}>
              {`Phase ${phase.id}: ${phase.name}`}
            </Heading>
            <StatusBadge status={phase.status} />
          </HStack>
          {phase.status === 'ready' ? (
            <Button label="Approve phase" variant="primary" onClick={() => setApproving(true)} />
          ) : null}
          {phase.status === 'changed' ? (
            // The Needs You item for this phase (its change view), where the owner re-signs.
            <Button
              label="Review changes"
              variant="secondary"
              href={`/h/${hostId}/needs-you/phase-${phase.id}`}
            />
          ) : null}
        </HStack>
        {/* D-03 soft hint (shared with the Phases row), reading:
            `Uncommitted edits to this approved phase. The approval only follows what is committed on {base}.` */}
        {phase.uncommittedEdits ? <UncommittedHint baseBranch={phase.baseBranch} /> : null}
      </VStack>
    );

  let body: ReactNode = null;
  if (phase === undefined) {
    body = query.isError ? null : <LoadingDetail />;
  } else {
    body = (
      <VStack gap={6}>
        <ReasonBanners phase={phase} />
        <MetadataList>
          <MetadataListItem label="Goal">
            <Text>{phase.goal ?? '—'}</Text>
          </MetadataListItem>
          <MetadataListItem label="Depends on">
            <Text>{phase.dependsOn ?? '—'}</Text>
          </MetadataListItem>
          <MetadataListItem label="Plans">
            <Text hasTabularNumbers>{String(phase.planCount)}</Text>
          </MetadataListItem>
          <MetadataListItem label="Base branch tip">
            {phase.tip === null ? (
              <Text>—</Text>
            ) : (
              <Tooltip content={<Text type="code">{phase.tip}</Text>}>
                <Text type="code" aria-label={`${phase.baseBranch} at ${phase.tip}`}>
                  {`${phase.baseBranch} @ ${phase.tip.slice(0, 7)}`}
                </Text>
              </Tooltip>
            )}
          </MetadataListItem>
          <ApprovalFactsItems phase={phase} />
        </MetadataList>
        {phase.plans.length === 0 ? (
          <Text>No plans yet</Text>
        ) : (
          <VStack gap={2}>
            <Text type="label" weight="semibold">
              {plansText(phase.plans.length)}
            </Text>
            <Table<PlanRow> data={phase.plans} columns={planColumns} idKey="id" />
          </VStack>
        )}
        <InputsCard phase={phase} />
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
            {phase !== undefined ? (
              // Mounted with the page, so it stays open after the phase leaves Ready (it just
              // landed) and returns focus to `Approve phase` on close.
              <ApprovalDialog
                hostId={hostId}
                hostName={phase.hostName}
                phaseId={phase.id}
                phaseName={phase.name}
                isOpen={approving}
                onOpenChange={setApproving}
                currentTip={phase.tip}
                approval={phase.approval}
              />
            ) : null}
          </VStack>
        </LayoutContent>
      }
    />
  );
}

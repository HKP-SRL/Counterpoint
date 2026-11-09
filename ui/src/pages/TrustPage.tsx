// Trust (`/h/{hostId}/trust`, FOUND-03 display, UI-SPEC "Trust" and E8): the last
// `counterpoint doctor` report. The verdict Banner comes first (the page's focal point), then the
// Tools, Signing key and Sandbox probe tables. Read-only: the console never runs the probe, so
// this page has no privileged action; re-running is the terminal command it shows.
//
// The verdict is never all-pass unless every check passed and every probe target was blocked:
// anything `Not checked`, failed, reachable or missing counts against it. The page renders the
// stored report truthfully, whatever it says.
import { Badge, type BadgeVariant } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import type { IconName } from '@astryxdesign/core/Icon';
import { Icon } from '@astryxdesign/core/Icon';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Table, type TableColumn } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { VStack } from '@astryxdesign/core/VStack';
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';
import { apiGet, hostsQuery, queryKeys } from '../api';

// ---------------------------------------------------------------------------------------------
// API shape (GET /api/hosts/{id}/doctor), validated before use.

type CheckResult = 'pass' | 'fail' | 'not-checked';
type ProbeResult = 'blocked' | 'reachable' | 'not-checked';

type CheckRow = {
  id: string;
  label: string;
  result: CheckResult;
  detail: string;
  fix: string | null;
};
type ProbeRow = { id: string; label: string; mode: 'read' | 'write'; result: ProbeResult };

type Report = {
  checkedAt: string;
  tools: CheckRow[];
  signingKey: CheckRow[];
  integrity: CheckRow | null;
  probe: ProbeRow[];
};

type DoctorAnswer = {
  hostId: string;
  report: Report | null;
  stale: boolean;
  verdict: 'pass' | 'fail';
  unreadable: boolean;
};

/** The seven probe targets, in the Trust page's order (src/core/security/doctor-report.ts). */
const PROBE_TARGETS: readonly { id: string; label: string; mode: 'read' | 'write' }[] = [
  { id: 'signing-key', label: 'Signing key', mode: 'read' },
  { id: 'ssh', label: '~/.ssh', mode: 'read' },
  { id: 'gh', label: 'gh credentials', mode: 'read' },
  { id: 'state', label: 'Counterpoint state', mode: 'read' },
  { id: 'git-config', label: '{host} .git/config', mode: 'write' },
  { id: 'git-hooks', label: '.git/hooks', mode: 'write' },
  { id: 'git-info', label: '.git/info', mode: 'write' },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function parseCheck(value: unknown): CheckRow | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  const result: CheckResult =
    value.result === 'pass' || value.result === 'fail' ? value.result : 'not-checked';
  return {
    id: value.id,
    label: str(value.label) || value.id,
    result,
    detail: str(value.detail),
    fix: typeof value.fix === 'string' && value.fix !== '' ? value.fix : null,
  };
}

function parseChecks(value: unknown): CheckRow[] {
  return Array.isArray(value)
    ? value.map(parseCheck).filter((row): row is CheckRow => row !== null)
    : [];
}

function parseProbe(value: unknown): ProbeRow | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  const result: ProbeResult =
    value.result === 'blocked' || value.result === 'reachable' ? value.result : 'not-checked';
  return {
    id: value.id,
    label: str(value.label) || value.id,
    mode: value.mode === 'write' ? 'write' : 'read',
    result,
  };
}

function parseReport(value: unknown): Report | null {
  if (!isRecord(value) || typeof value.checkedAt !== 'string') return null;
  if (Number.isNaN(Date.parse(value.checkedAt))) return null;
  return {
    checkedAt: value.checkedAt,
    tools: parseChecks(value.tools),
    signingKey: parseChecks(value.signingKey),
    integrity: parseCheck(value.integrity),
    probe: Array.isArray(value.probe)
      ? value.probe.map(parseProbe).filter((row): row is ProbeRow => row !== null)
      : [],
  };
}

async function fetchDoctor(hostId: string, signal?: AbortSignal): Promise<DoctorAnswer> {
  const body = await apiGet(`/api/hosts/${encodeURIComponent(hostId)}/doctor`, signal);
  const raw = isRecord(body) ? body : {};
  const report = parseReport(raw.report);
  return {
    hostId,
    report,
    stale: raw.stale === true,
    verdict: raw.verdict === 'pass' ? 'pass' : 'fail',
    unreadable: raw.error === 'unreadable' || (raw.report != null && report === null),
  };
}

const doctorQuery = (hostId: string) =>
  queryOptions({
    queryKey: queryKeys.doctor(hostId),
    queryFn: ({ signal }) => fetchDoctor(hostId, signal),
    placeholderData: keepPreviousData,
  });

// ---------------------------------------------------------------------------------------------
// Wording.

const CHECK_LOOK: Record<CheckResult, { label: string; variant: BadgeVariant; icon: IconName }> = {
  pass: { label: 'Pass', variant: 'success', icon: 'success' },
  fail: { label: 'Fail', variant: 'error', icon: 'error' },
  'not-checked': { label: 'Not checked', variant: 'neutral', icon: 'clock' },
};

// Probe rows never say Pass/Fail: a pass means blocked, which would read backwards.
const PROBE_LOOK: Record<ProbeResult, { label: string; variant: BadgeVariant; icon: IconName }> = {
  blocked: { label: 'Blocked', variant: 'success', icon: 'success' },
  reachable: { label: 'Reachable', variant: 'error', icon: 'error' },
  'not-checked': { label: 'Not checked', variant: 'neutral', icon: 'clock' },
};

function ResultBadge({ look }: { look: { label: string; variant: BadgeVariant; icon: IconName } }) {
  return (
    <Badge variant={look.variant} label={look.label} icon={<Icon icon={look.icon} size="xsm" />} />
  );
}

/** Every probe target in order; a target missing from the report reads `Not checked`. */
function probeRows(report: Report, hostName: string): ProbeRow[] {
  return PROBE_TARGETS.map((target) => {
    const found = report.probe.filter((row) => row.id === target.id);
    const result: ProbeResult =
      found.length === 0
        ? 'not-checked'
        : found.some((row) => row.result === 'reachable')
          ? 'reachable'
          : found.every((row) => row.result === 'blocked')
            ? 'blocked'
            : 'not-checked';
    return {
      id: target.id,
      label: target.label.replace('{host}', hostName),
      mode: target.mode,
      result,
    };
  });
}

function allChecks(report: Report): CheckRow[] {
  return [...report.tools, ...report.signingKey, ...(report.integrity ? [report.integrity] : [])];
}

/** How old a stale report is, in whole hours (under two days) or days. */
export function ageText(checkedAt: string, now: number = Date.now()): string {
  const hours = Math.max(0, Math.floor((now - Date.parse(checkedAt)) / 3_600_000));
  if (hours < 48) return hours === 1 ? '1 hour' : `${hours} hours`;
  const days = Math.floor(hours / 24);
  return `${days} days`;
}

export function reachableText(n: number): string {
  return n === 1 ? '1 target was reachable' : `${n} targets were reachable`;
}

function VerdictBanner({ answer, hostName }: { answer: DoctorAnswer; hostName: string }) {
  const report = answer.report;
  if (report === null) return null;
  const probes = probeRows(report, hostName);
  const reachable = probes.filter((row) => row.result === 'reachable').length;
  const notPassing =
    allChecks(report).filter((check) => check.result !== 'pass').length +
    probes.filter((row) => row.result !== 'blocked').length +
    (report.tools.length === 0 ? 1 : 0) +
    (report.signingKey.length === 0 ? 1 : 0);
  const checked = <Timestamp value={report.checkedAt} />;

  if (reachable > 0) {
    return (
      <Banner
        status="error"
        title="Agent sandbox is not confining sessions"
        description={`${reachableText(reachable)}. Approvals still work, but builds will refuse to start until this passes.`}
      />
    );
  }
  if (answer.verdict === 'pass' && notPassing === 0) {
    return (
      <Banner
        status="success"
        title="Agents are boxed in"
        description={
          <>
            Checked {checked}. A headless claude session could not read your signing key, ~/.ssh, gh
            credentials or Counterpoint's state, and could not write {hostName}'s .git/config, hooks
            or info.
          </>
        }
      />
    );
  }
  const n = Math.max(notPassing, 1);
  return (
    <Banner
      status="warning"
      title={n === 1 ? '1 check did not pass' : `${n} checks did not pass`}
      description={
        <>Checked {checked}. Fix what is listed below, then run "counterpoint doctor" again.</>
      }
    />
  );
}

const checkColumns = (firstHeader: string, detailHeader: string): TableColumn<CheckRow>[] => [
  {
    key: 'label',
    header: firstHeader,
    renderCell: (row) => <Text>{row.label}</Text>,
  },
  {
    key: 'detail',
    header: detailHeader,
    renderCell: (row) => (
      <VStack gap={1}>
        <Text wordBreak="break-word">{row.detail === '' ? '—' : row.detail}</Text>
        {row.result !== 'pass' && row.fix !== null ? (
          <Text type="supporting" color="secondary" wordBreak="break-word">
            {`Fix: ${row.fix}`}
          </Text>
        ) : null}
      </VStack>
    ),
  },
  {
    key: 'result',
    header: 'Result',
    renderCell: (row) => <ResultBadge look={CHECK_LOOK[row.result]} />,
  },
];

const probeColumns: TableColumn<ProbeRow>[] = [
  {
    key: 'target',
    header: 'Target',
    renderCell: (row) => (
      <VStack gap={1}>
        <Text>{row.label}</Text>
        <Text type="supporting" color="secondary">
          {row.mode === 'read' ? 'cannot read' : 'cannot write'}
        </Text>
      </VStack>
    ),
  },
  {
    key: 'result',
    header: 'Result',
    renderCell: (row) => <ResultBadge look={PROBE_LOOK[row.result]} />,
  },
];

function TableCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card padding={4} elevation="none" aria-label={title}>
      <VStack gap={4}>
        <Text type="label" weight="semibold">
          {title}
        </Text>
        {children}
      </VStack>
    </Card>
  );
}

function DoctorCommand() {
  return <CodeBlock code="counterpoint doctor" language="bash" hasCopyButton isWrapped={false} />;
}

function LoadingRows() {
  return (
    <VStack gap={2} aria-busy="true" aria-label="Loading checks">
      <Skeleton width="100%" height={64} />
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} index={index} width="100%" height={44} />
      ))}
    </VStack>
  );
}

export function TrustPage({ hostId }: { hostId: string }) {
  const query = useQuery(doctorQuery(hostId));
  const hosts = useQuery(hostsQuery);
  const hostName = hosts.data?.find((host) => host.id === hostId)?.name ?? hostId;

  useEffect(() => {
    document.title = 'Trust · Counterpoint';
  }, []);

  const answer = query.data?.hostId === hostId ? query.data : undefined;

  const errorBanner = query.isError ? (
    <Banner
      status="error"
      title="Couldn't load checks"
      description="Counterpoint's daemon didn't answer."
      endContent={
        <Button
          label="Try loading checks again"
          variant="secondary"
          isLoading={query.isFetching}
          onClick={() => void query.refetch()}
        />
      }
    />
  ) : null;

  let body: ReactNode = null;
  if (answer === undefined) {
    body = query.isError ? null : <LoadingRows />;
  } else if (answer.report === null) {
    body = answer.unreadable ? (
      <VStack gap={4}>
        <Banner
          status="error"
          title="Couldn't read the last check"
          description={'The saved doctor report is not valid. Run "counterpoint doctor" again.'}
        />
        <DoctorCommand />
      </VStack>
    ) : (
      <EmptyState
        headingLevel={2}
        title="Not checked yet"
        description={'Run "counterpoint doctor" in a terminal. The result appears here.'}
        actions={<DoctorCommand />}
      />
    );
  } else {
    const report = answer.report;
    const keyRows = [...report.signingKey, ...(report.integrity ? [report.integrity] : [])];
    body = (
      <VStack gap={6}>
        <VerdictBanner answer={answer} hostName={hostName} />
        {answer.stale ? (
          <Banner
            status="warning"
            title={`This check is ${ageText(report.checkedAt)} old`}
            description={'Run "counterpoint doctor" again.'}
          />
        ) : null}
        <TableCard title="Tools">
          <Table<CheckRow>
            data={report.tools}
            columns={checkColumns('Tool', 'Version')}
            idKey="id"
            emptyState={<Text color="secondary">Not checked</Text>}
          />
        </TableCard>
        <TableCard title="Signing key">
          <Table<CheckRow>
            data={keyRows}
            columns={checkColumns('Check', 'Detail')}
            idKey="id"
            emptyState={<Text color="secondary">Not checked</Text>}
          />
        </TableCard>
        <TableCard title="Sandbox probe">
          <Table<ProbeRow> data={probeRows(report, hostName)} columns={probeColumns} idKey="id" />
        </TableCard>
        <VStack gap={2}>
          <Text type="supporting" color="secondary">
            Run this again in a terminal to refresh the result:
          </Text>
          <DoctorCommand />
        </VStack>
      </VStack>
    );
  }

  return (
    <Layout
      header={
        <LayoutHeader>
          <Heading level={2} accessibilityLevel={1}>
            Trust
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

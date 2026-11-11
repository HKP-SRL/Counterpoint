// Trust (`/h/{hostId}/trust`, doctor: Trust page; long evidence wraps): the last
// `counterpoint doctor` report. The verdict Banner comes first (the page's focal point), then the
// Tools, Signing key and Sandbox probe tables. The Sandbox probe card starts with the two session
// checks, Agent permission mode and Sandbox isolation settings, then lists the eleven probe targets
// (the build-lane rows worktree-git and gate-sandbox last). Read-only: the console
// never runs the probe, so this page has no privileged action; re-running is the terminal command
// it shows.
//
// The verdict is never all-pass unless every check passed and every probe target was blocked:
// anything `Not checked`, failed, reachable or missing (a session check included) counts against
// it. The page renders the stored report truthfully, whatever it says.
//
// The owner's accepted risk (doctor: Owner-recorded accepted risk): when the server says
// `accepted-risk` and names the applied gh-keychain entry, every check passed and gh credentials is
// the only probe row that is not Blocked (and it is Reachable), the verdict reads as its own
// warning, `Agents are boxed in, with one accepted risk`, with the owner's reason, the date and the
// revoke command; the gh row keeps `Reachable` and adds an `Accepted risk` Badge. Anything else
// falls back to the existing verdicts, so the console never shows a better verdict than the server
// computed.

import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Badge, type BadgeVariant } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import type { IconName } from '@astryxdesign/core/Icon';
import { Icon } from '@astryxdesign/core/Icon';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Table, type TableColumn } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { useToast } from '@astryxdesign/core/Toast';
import { VStack } from '@astryxdesign/core/VStack';
import { keepPreviousData, queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { apiGet, hostsQuery, queryKeys } from '../api';
import { type DoctorStatus, doctorStatusQuery, errorText, runDoctor, withdrawRisk } from '../run';

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

export type Report = {
  checkedAt: string;
  tools: CheckRow[];
  signingKey: CheckRow[];
  integrity: CheckRow | null;
  probe: ProbeRow[];
  /** The Agent permission mode check; null when the report does not carry it. */
  agentMode: CheckRow | null;
  /** The Sandbox isolation settings check; null when the report does not carry it. */
  sandboxIsolation: CheckRow | null;
};

/** An accepted risk the server applied to this report (its `acceptedRisks`). */
export type AppliedRisk = { id: string; reason: string; recordedAt: string };

export type DoctorAnswer = {
  hostId: string;
  report: Report | null;
  stale: boolean;
  /** The server's verdict; any value other than these three reads `fail`. */
  verdict: 'pass' | 'accepted-risk' | 'fail';
  /** The accepted risks the server applied; malformed means none. */
  acceptedRisks: AppliedRisk[];
  unreadable: boolean;
};

/**
 * The eleven probe targets, in the Trust page's order (src/core/security/doctor-report.ts):
 * the nine session rows, then the build-lane rows `worktree-git` and `gate-sandbox`. A report
 * without one of them shows that row `Not checked`.
 */
const PROBE_TARGETS: readonly { id: string; label: string; mode: 'read' | 'write' }[] = [
  { id: 'signing-key', label: 'Signing key', mode: 'read' },
  { id: 'ssh', label: '~/.ssh', mode: 'read' },
  { id: 'gh', label: 'gh credentials', mode: 'read' },
  { id: 'state', label: 'Counterpoint state', mode: 'read' },
  { id: 'git-config', label: '{host} .git/config', mode: 'write' },
  { id: 'git-hooks', label: '.git/hooks', mode: 'write' },
  { id: 'git-info', label: '.git/info', mode: 'write' },
  { id: 'outside-workdir', label: 'Files outside the working folder', mode: 'write' },
  { id: 'credential-env', label: 'Credentials in the shell environment', mode: 'read' },
  { id: 'worktree-git', label: '{host} git state from a worktree', mode: 'write' },
  { id: 'gate-sandbox', label: 'Gate sandbox', mode: 'write' },
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
    // Extra fields (expected, effective, sources) are ignored; only the check row is shown.
    agentMode: parseCheck(value.agentMode),
    sandboxIsolation: parseCheck(value.sandboxIsolation),
  };
}

/**
 * The applied accepted risks: each entry needs a non-empty string id and reason and a parsable
 * recordedAt. Anything malformed (a non-array, or any bad entry) reads as none, so a malformed
 * answer can never make the verdict look better.
 */
function parseAcceptedRisks(value: unknown): AppliedRisk[] {
  if (!Array.isArray(value)) return [];
  const risks: AppliedRisk[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return [];
    const { id, reason, recordedAt } = entry;
    if (typeof id !== 'string' || id === '') return [];
    if (typeof reason !== 'string' || reason === '') return [];
    if (typeof recordedAt !== 'string' || Number.isNaN(Date.parse(recordedAt))) return [];
    risks.push({ id, reason, recordedAt });
  }
  return risks;
}

async function fetchDoctor(hostId: string, signal?: AbortSignal): Promise<DoctorAnswer> {
  const body = await apiGet(`/api/hosts/${encodeURIComponent(hostId)}/doctor`, signal);
  const raw = isRecord(body) ? body : {};
  const report = parseReport(raw.report);
  return {
    hostId,
    report,
    stale: raw.stale === true,
    verdict:
      raw.verdict === 'pass' ? 'pass' : raw.verdict === 'accepted-risk' ? 'accepted-risk' : 'fail',
    acceptedRisks: parseAcceptedRisks(raw.acceptedRisks),
    unreadable: raw.error === 'unreadable' || (raw.report != null && report === null),
  };
}

/** The last doctor report for a host; shared by this page and the Mission Trust card. */
export const doctorQuery = (hostId: string) =>
  queryOptions({
    queryKey: queryKeys.doctor(hostId),
    queryFn: ({ signal }) => fetchDoctor(hostId, signal),
    placeholderData: keepPreviousData,
  });

// ---------------------------------------------------------------------------------------------
// Wording.

export type ResultLook = { label: string; variant: BadgeVariant; icon: IconName };

export const CHECK_LOOK: Record<CheckResult, ResultLook> = {
  pass: { label: 'Pass', variant: 'success', icon: 'success' },
  fail: { label: 'Fail', variant: 'error', icon: 'error' },
  'not-checked': { label: 'Not checked', variant: 'neutral', icon: 'clock' },
};

// Probe rows never say Pass/Fail: a pass means blocked, which would read backwards.
export const PROBE_LOOK: Record<ProbeResult, ResultLook> = {
  blocked: { label: 'Blocked', variant: 'success', icon: 'success' },
  reachable: { label: 'Reachable', variant: 'error', icon: 'error' },
  'not-checked': { label: 'Not checked', variant: 'neutral', icon: 'clock' },
};

/** The owner's accepted risk: a warning Badge with its icon, so never colour-only. */
export const ACCEPTED_RISK_LOOK: ResultLook = {
  label: 'Accepted risk',
  variant: 'warning',
  icon: 'warning',
};

/** The one accepted risk the console knows; it covers only gh's Keychain lookup. */
const GH_KEYCHAIN = 'gh-keychain';

export function ResultBadge({ look }: { look: ResultLook }) {
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
  return [
    ...report.tools,
    ...report.signingKey,
    ...(report.integrity ? [report.integrity] : []),
    ...(report.agentMode ? [report.agentMode] : []),
    ...(report.sandboxIsolation ? [report.sandboxIsolation] : []),
  ];
}

const NOT_RECORDED = 'Not recorded in this report. Run "counterpoint doctor" again.';

/** The Sandbox probe card's two session checks; one a report does not carry reads Not checked. */
function sessionCheckRows(report: Report): CheckRow[] {
  return [
    report.agentMode ?? {
      id: 'agent-mode',
      label: 'Agent permission mode',
      result: 'not-checked',
      detail: NOT_RECORDED,
      fix: null,
    },
    report.sandboxIsolation ?? {
      id: 'sandbox-isolation',
      label: 'Sandbox isolation settings',
      result: 'not-checked',
      detail: NOT_RECORDED,
      fix: null,
    },
  ];
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

/**
 * The verdict of a report, shared by the Trust page's Banner and the Mission Trust card so both
 * always use the same words. Never all-pass unless every check passed and every probe target was
 * blocked: anything `Not checked`, failed, reachable or missing counts against it.
 */
export type TrustVerdict =
  | { kind: 'reachable'; reachable: number; title: string; badge: ResultLook }
  | { kind: 'pass'; title: string; badge: ResultLook }
  | { kind: 'accepted-risk'; risk: AppliedRisk; title: string; badge: ResultLook }
  | { kind: 'not-passing'; notPassing: number; title: string; badge: ResultLook };

export function trustVerdict(answer: DoctorAnswer, report: Report, hostName: string): TrustVerdict {
  const probes = probeRows(report, hostName);
  const reachable = probes.filter((row) => row.result === 'reachable').length;
  const checks = allChecks(report);
  // Checks that did not pass, including a missing group or session check.
  const checksNotPassing =
    checks.filter((check) => check.result !== 'pass').length +
    (report.tools.length === 0 ? 1 : 0) +
    (report.signingKey.length === 0 ? 1 : 0) +
    (report.agentMode === null ? 1 : 0) +
    (report.sandboxIsolation === null ? 1 : 0);
  const notPassing = checksNotPassing + probes.filter((row) => row.result !== 'blocked').length;

  // The owner's accepted risk: only when the server applied it, every check passed, and gh
  // credentials is the one probe row not Blocked and it is Reachable. Otherwise the
  // existing verdicts below apply unchanged.
  const risk = answer.acceptedRisks.find((entry) => entry.id === GH_KEYCHAIN);
  const notBlocked = probes.filter((row) => row.result !== 'blocked');
  if (
    answer.verdict === 'accepted-risk' &&
    risk !== undefined &&
    checksNotPassing === 0 &&
    notBlocked.length === 1 &&
    notBlocked[0]?.id === 'gh' &&
    notBlocked[0].result === 'reachable'
  ) {
    return {
      kind: 'accepted-risk',
      risk,
      title: 'Agents are boxed in, with one accepted risk',
      badge: ACCEPTED_RISK_LOOK,
    };
  }

  if (reachable > 0) {
    return {
      kind: 'reachable',
      reachable,
      title: 'Agent sandbox is not confining sessions',
      badge: PROBE_LOOK.reachable,
    };
  }
  if (answer.verdict === 'pass' && notPassing === 0) {
    return { kind: 'pass', title: 'Agents are boxed in', badge: CHECK_LOOK.pass };
  }
  const n = Math.max(notPassing, 1);
  // `Fail` when anything failed outright; `Not checked` when the only gaps are unchecked rows.
  const failed = checks.some((check) => check.result === 'fail');
  return {
    kind: 'not-passing',
    notPassing: n,
    title: n === 1 ? '1 check did not pass' : `${n} checks did not pass`,
    badge: failed ? CHECK_LOOK.fail : CHECK_LOOK['not-checked'],
  };
}

/** What a running doctor is doing, in plain words. */
const PHASE_TEXT: Record<DoctorStatus['phase'], string> = {
  waiting: 'waiting for the usage pause to end',
  tools: 'checking claude, git and gh',
  'signing-key': 'checking the approval key',
  integrity: 'checking the git config baseline',
  probe: 'probing the sandbox with short claude sessions (about two minutes)',
  report: 'writing the report',
};

/**
 * Run doctor from the console (doctor: Doctor and risk withdrawal from the console): a guarded
 * POST, at most one probe at a time on the machine; its phase shows while it runs and the new report
 * replaces the old one when it is done (a `doctor` event refetches both).
 */
function RunDoctor({ hostId }: { hostId: string }) {
  const toast = useToast();
  const client = useQueryClient();
  const status = useQuery(doctorStatusQuery);
  const [asking, setAsking] = useState(false);
  const running = status.data ?? null;
  const here = running !== null && running.hostId === hostId;

  const start = async () => {
    setAsking(true);
    try {
      const answer = await runDoctor(hostId);
      if (!answer.ok) toast({ body: errorText(answer.body, "Doctor didn't start.") });
      await client.invalidateQueries({ queryKey: queryKeys.doctorStatus });
    } finally {
      setAsking(false);
    }
  };

  return (
    <HStack gap={3} vAlign="center" wrap="wrap">
      <Button
        label="Run doctor"
        variant="secondary"
        isLoading={asking}
        isDisabled={running !== null}
        onClick={() => void start()}
      />
      {running === null ? null : (
        <HStack gap={2} vAlign="center" aria-live="polite">
          <Spinner size="sm" />
          <Text type="supporting" color="secondary">
            {here
              ? `Doctor is ${PHASE_TEXT[running.phase]}.`
              : `Doctor is running for ${running.hostId}; one probe runs at a time.`}
          </Text>
        </HStack>
      )}
    </HStack>
  );
}

/**
 * Withdrawing the accepted risk only makes the verdict stricter, so the console may do it, after
 * a confirm. Recording a risk stays a terminal act (`counterpoint accept-risk`).
 */
function WithdrawRisk() {
  const toast = useToast();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const withdraw = async () => {
    setBusy(true);
    try {
      const answer = await withdrawRisk('gh-keychain');
      toast({
        body: answer.ok
          ? 'Accepted risk withdrawn. Doctor now fails while gh credentials are reachable.'
          : errorText(answer.body, "The risk couldn't be withdrawn."),
      });
      await client.invalidateQueries({ queryKey: ['host'] });
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button label="Withdraw this risk" variant="secondary" onClick={() => setOpen(true)} />
      <AlertDialog
        isOpen={open}
        onOpenChange={setOpen}
        title="Withdraw the accepted risk?"
        description="From now on doctor fails while gh credentials in your Keychain are reachable, and runs refuse to start. Accepting it again is done in a terminal with counterpoint accept-risk gh-keychain."
        actionLabel="Withdraw"
        actionVariant="destructive"
        isActionLoading={busy}
        onAction={() => void withdraw()}
      />
    </>
  );
}

function VerdictBanner({ answer, hostName }: { answer: DoctorAnswer; hostName: string }) {
  const report = answer.report;
  if (report === null) return null;
  const verdict = trustVerdict(answer, report, hostName);
  const checked = <Timestamp value={report.checkedAt} />;

  if (verdict.kind === 'reachable') {
    return (
      <Banner
        status="error"
        title={verdict.title}
        description={`${reachableText(verdict.reachable)}. Approvals still work, but builds will refuse to start until this passes.`}
      />
    );
  }
  if (verdict.kind === 'accepted-risk') {
    // The owner's reason is rendered as React text only, never as HTML.
    return (
      <Banner
        status="warning"
        title={verdict.title}
        description={
          <>
            Checked {checked}. A headless claude session could not read your signing key, ~/.ssh,
            gh's config files or Counterpoint's state, and could not write {hostName}'s .git/config,
            hooks or info, or files outside its working folder. It could read your macOS Keychain,
            so gh credentials kept there are reachable by agents. You accepted this risk on{' '}
            <Timestamp value={verdict.risk.recordedAt} />: "{verdict.risk.reason}". You can withdraw
            it here or with "counterpoint revoke-risk gh-keychain".
          </>
        }
        endContent={<WithdrawRisk />}
      />
    );
  }
  if (verdict.kind === 'pass') {
    return (
      <Banner
        status="success"
        title={verdict.title}
        description={
          <>
            Checked {checked}. A headless claude session could not read your signing key, ~/.ssh, gh
            credentials or Counterpoint's state, could not write {hostName}'s .git/config, hooks or
            info, or files outside its working folder, and found no credentials in its shell
            environment other than the sandbox's own local proxy login.
          </>
        }
      />
    );
  }
  return (
    <Banner
      status="warning"
      title={verdict.title}
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

/**
 * The probe table's columns. With the accepted-risk verdict (`riskApplied`), the gh credentials
 * row keeps its `Reachable` Badge, adds `Accepted risk`, and says what was and was not reached.
 */
const probeColumns = (riskApplied: boolean): TableColumn<ProbeRow>[] => {
  const covered = (row: ProbeRow) => riskApplied && row.id === 'gh' && row.result === 'reachable';
  return [
    {
      key: 'target',
      header: 'Target',
      renderCell: (row) => (
        <VStack gap={1}>
          <Text>{row.label}</Text>
          <Text type="supporting" color="secondary" wordBreak="break-word">
            {covered(row)
              ? 'config files cannot be read · Keychain reachable (accepted risk)'
              : row.mode === 'read'
                ? 'cannot read'
                : 'cannot write'}
          </Text>
        </VStack>
      ),
    },
    {
      key: 'result',
      header: 'Result',
      renderCell: (row) =>
        covered(row) ? (
          <HStack gap={2} vAlign="center" wrap="wrap">
            <ResultBadge look={PROBE_LOOK[row.result]} />
            <ResultBadge look={ACCEPTED_RISK_LOOK} />
          </HStack>
        ) : (
          <ResultBadge look={PROBE_LOOK[row.result]} />
        ),
    },
  ];
};

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

export function DoctorCommand() {
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
    const riskApplied = trustVerdict(answer, report, hostName).kind === 'accepted-risk';
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
          <Table<CheckRow>
            data={sessionCheckRows(report)}
            columns={checkColumns('Check', 'Detail')}
            idKey="id"
          />
          <Table<ProbeRow>
            data={probeRows(report, hostName)}
            columns={probeColumns(riskApplied)}
            idKey="id"
          />
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
          <HStack gap={4} vAlign="center" hAlign="between" wrap="wrap">
            <Heading level={2} accessibilityLevel={1}>
              Trust
            </Heading>
            <RunDoctor hostId={hostId} />
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

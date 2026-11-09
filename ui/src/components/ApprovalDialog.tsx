// The approval dialog (APPR-01 console half; UI-SPEC "Approval dialog", Interaction Contract 3-4,
// E5). It previews exactly what a signature would bind and hands the owner the one-line terminal
// command; it never signs and never sees a key or passphrase. Signing happens only in the owner's
// terminal (`counterpoint approve`), which re-derives and prints the statement itself.
//
// Every open asks the server to prepare the statement again (a privileged POST: session cookie,
// exact Origin, JSON body); a previous statement is never reused. While open it follows the phase
// (refetched on `phase` / `approval` events): a verified on-runway approval flips it to landed;
// a base tip that moved first makes it stale (no usable command until it is prepared again).
// Refusals show only the error Banner, never a command.
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { HStack } from '@astryxdesign/core/HStack';
import { useAnnounce, useClipboard } from '@astryxdesign/core/hooks';
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Table, type TableColumn } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { useToast } from '@astryxdesign/core/Toast';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { VStack } from '@astryxdesign/core/VStack';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, goSignedOut } from '../api';
import type { ApprovalFacts } from '../pages/PhasesPage';
import { plansCountText, runwayQuery } from '../runway';

// ---------------------------------------------------------------------------------------------
// The prepare API.

type PreparedInput = { label: string; path: string; kind: string; digest: string };

type Prerequisites = {
  userSetup: { service: string; why: string | null }[];
  nonAutonomous: number;
  total: number;
};

export type Prepared = {
  phase: { id: string; name: string; planCount: number };
  baseBranch: string;
  tip: string;
  inputs: PreparedInput[];
  gates: { state: 'absent' } | { state: 'present'; digest: string };
  fingerprint: string;
  prerequisites: Prerequisites;
  itemPath: string;
  command: string;
};

export type Refusal = {
  refused: string;
  reason?: string;
  file?: string;
};

type PrepareResult = { ok: true; prepared: Prepared } | { ok: false; refusal: Refusal };

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const FINGERPRINT_RE = /^[0-9a-f]{12}$/;
const ITEM_PATH_RE = /^\.counterpoint\/approvals\/phase-\d{2}(\.\d+)?\.json$/;
const HOST_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const PHASE_ID_RE = /^\d{2}(\.\d+)?$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

function parseInput(value: unknown): PreparedInput | null {
  if (!isRecord(value) || typeof value.path !== 'string') return null;
  if (typeof value.digest !== 'string' || !DIGEST_RE.test(value.digest)) return null;
  return { label: str(value.label), path: value.path, kind: str(value.kind), digest: value.digest };
}

/**
 * Validates the prepared statement. The command must be exactly the ID-only form built from this
 * dialog's own validated ids, so nothing the server or planning text says can widen it.
 */
function parsePrepared(value: unknown, hostId: string, phaseId: string): Prepared | null {
  if (!isRecord(value) || !isRecord(value.phase)) return null;
  const expected = `counterpoint approve ${hostId} ${phaseId}`;
  if (!HOST_ID_RE.test(hostId) || !PHASE_ID_RE.test(phaseId) || value.command !== expected) {
    return null;
  }
  if (typeof value.tip !== 'string' || !SHA_RE.test(value.tip)) return null;
  if (typeof value.fingerprint !== 'string' || !FINGERPRINT_RE.test(value.fingerprint)) return null;
  if (typeof value.itemPath !== 'string' || !ITEM_PATH_RE.test(value.itemPath)) return null;
  const inputs = Array.isArray(value.inputs) ? value.inputs.map(parseInput) : [];
  if (inputs.length === 0 || inputs.some((input) => input === null)) return null;
  const gates = isRecord(value.gates) ? value.gates : {};
  const prerequisites = isRecord(value.prerequisites) ? value.prerequisites : {};
  return {
    phase: {
      id: phaseId,
      name: str(value.phase.name),
      planCount: count(value.phase.planCount),
    },
    baseBranch: str(value.baseBranch),
    tip: value.tip,
    inputs: inputs as PreparedInput[],
    gates:
      gates.state === 'present' && typeof gates.digest === 'string' && DIGEST_RE.test(gates.digest)
        ? { state: 'present', digest: gates.digest }
        : { state: 'absent' },
    fingerprint: value.fingerprint,
    prerequisites: {
      userSetup: Array.isArray(prerequisites.userSetup)
        ? prerequisites.userSetup.filter(isRecord).map((item) => ({
            service: str(item.service),
            why: typeof item.why === 'string' ? item.why : null,
          }))
        : [],
      nonAutonomous: count(prerequisites.nonAutonomous),
      total: count(prerequisites.total),
    },
    itemPath: value.itemPath,
    command: expected,
  };
}

async function prepareApproval(
  hostId: string,
  phaseId: string,
  signal: AbortSignal,
): Promise<PrepareResult> {
  const res = await fetch(
    `/api/hosts/${encodeURIComponent(hostId)}/phases/${encodeURIComponent(phaseId)}/approval`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: '{}',
      signal,
    },
  );
  if (res.status === 401) {
    goSignedOut('none');
    throw new ApiError(401);
  }
  if (res.status === 403) {
    goSignedOut('blocked');
    throw new ApiError(403);
  }
  if (res.status === 200) {
    const body = (await res.json()) as unknown;
    const prepared = isRecord(body) ? parsePrepared(body.prepared, hostId, phaseId) : null;
    if (prepared === null) throw new ApiError(502);
    return { ok: true, prepared };
  }
  if (res.status === 409 || res.status === 404) {
    const body = (await res.json().catch(() => null)) as unknown;
    if (isRecord(body) && typeof body.refused === 'string') {
      return {
        ok: false,
        refusal: {
          refused: body.refused,
          ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
          ...(typeof body.file === 'string' ? { file: body.file } : {}),
        },
      };
    }
  }
  throw new ApiError(res.status);
}

// ---------------------------------------------------------------------------------------------
// Wording (UI-SPEC Copywriting Contract).

const NO_TRUSTED_KEY =
  'No approval key is trusted yet. Run "counterpoint init-key", then "counterpoint trust-key ~/.ssh/counterpoint_approval.pub".';

export function refusalText(refusal: Refusal, host: string, phaseId: string): string {
  switch (refusal.refused) {
    case 'integrity-changed':
      return `Signing would be refused: ${host}'s .git/config (or hooks) changed since Counterpoint last checked. Review the change in ${host}, then prepare the approval again.`;
    case 'integrity-unreadable':
      return `Signing would be refused: Counterpoint couldn't read its baseline for ${host}'s .git/config and hooks. Run "counterpoint trust ${host}" in a terminal, then prepare the approval again.`;
    case 'no-baseline':
      return `Signing would be refused: Counterpoint has no baseline for ${host}'s .git/config and hooks yet. Run "counterpoint trust ${host}" in a terminal, then prepare the approval again.`;
    case 'no-trusted-key':
      return NO_TRUSTED_KEY;
    case 'trust-unusable':
      return 'The trusted approval key can\'t be used. Run "counterpoint trust-key" again, then prepare the approval again.';
    case 'not-ready':
      return refusal.reason === 'no-plans'
        ? `Not ready to approve. Phase ${phaseId} has context but no plans yet. Run /gsd-plan-phase ${phaseId} in ${host}, then come back.`
        : `Not ready to approve. Phase ${phaseId} has no CONTEXT.md yet. Run /gsd-discuss-phase ${phaseId} and /gsd-plan-phase ${phaseId} in ${host}, then come back.`;
    case 'built':
      return `Phase ${phaseId} is already built. Approval is not offered.`;
    case 'unreadable':
      return `Couldn't read Phase ${phaseId}: ${refusal.file ?? 'a file'} could not be parsed${refusal.reason === undefined ? '' : `: ${refusal.reason}`}.`;
    case 'not-found':
      return `Phase ${phaseId} isn't in ${host}'s planning on the base branch any more.`;
    case 'gates-config':
      return `Couldn't read the gate config${refusal.reason === undefined ? '' : `: ${refusal.reason}`}.`;
    case 'no-base':
      return `The base branch of ${host} doesn't resolve to a commit.`;
    default:
      return `Counterpoint can't prepare an approval for ${host} right now.`;
  }
}

function presentText(k: number, n: number): string {
  return n === 1
    ? `${k} of 1 plan needs you present (not autonomous).`
    : `${k} of ${n} plans need you present (not autonomous).`;
}

function setupText(item: { service: string; why: string | null }): string {
  return item.why === null || item.why === '' ? item.service : `${item.service}: ${item.why}`;
}

/** First 12 hex of a `sha256:` digest; the full value is in the Tooltip and the statement. */
function shortDigest(digest: string): string {
  return digest.slice(7, 19);
}

// ---------------------------------------------------------------------------------------------

type InputRow = { id: string; file: ReactNode; digest: string | null; note: string | null };

const inputColumns: TableColumn<InputRow>[] = [
  { key: 'file', header: 'File', renderCell: (row) => row.file },
  {
    key: 'digest',
    header: 'Digest',
    renderCell: (row) =>
      row.digest === null ? (
        <Text color="secondary">{row.note ?? '—'}</Text>
      ) : (
        <Tooltip content={<Text type="code">{row.digest}</Text>}>
          <Text type="code" aria-label={row.digest}>
            {shortDigest(row.digest)}
          </Text>
        </Tooltip>
      ),
  },
];

function inputRows(prepared: Prepared): InputRow[] {
  const rows: InputRow[] = prepared.inputs.map((input) => ({
    id: input.path,
    file: (
      <VStack gap={0.5}>
        <Text type="code" wordBreak="break-all">
          {input.path}
        </Text>
        {input.kind === 'roadmap-section' ? (
          <Text type="supporting" color="secondary" wordBreak="break-all">
            {input.label}
          </Text>
        ) : null}
      </VStack>
    ),
    digest: input.digest,
    note: null,
  }));
  rows.push({ id: '__draft', file: <Text>Draft: none yet</Text>, digest: null, note: '—' });
  rows.push(
    prepared.gates.state === 'present'
      ? { id: '__gates', file: <Text>Gates</Text>, digest: prepared.gates.digest, note: null }
      : { id: '__gates', file: <Text>Gates: no gate config yet</Text>, digest: null, note: '—' },
  );
  return rows;
}

function LoadingBody() {
  return (
    <VStack gap={4} aria-busy="true" aria-label="Preparing the approval">
      <Skeleton width="70%" height={20} />
      <Skeleton width="50%" height={20} />
      <VStack gap={2}>
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} index={index} width="100%" height={36} />
        ))}
      </VStack>
      <Skeleton width="100%" height={44} />
    </VStack>
  );
}

export interface ApprovalDialogProps {
  hostId: string;
  /** The host's display name, used in refusal copy. */
  hostName: string;
  phaseId: string;
  phaseName: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** The base tip the phase was last read at (refetched live). */
  currentTip: string | null;
  /** The phase's verified approval now (refetched live). */
  approval: ApprovalFacts | null;
}

type PrepareState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'refused'; refusal: Refusal }
  | { status: 'ready'; prepared: Prepared };

export function ApprovalDialog({
  hostId,
  hostName,
  phaseId,
  phaseName,
  isOpen,
  onOpenChange,
  currentTip,
  approval,
}: ApprovalDialogProps) {
  const [state, setState] = useState<PrepareState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const navigate = useNavigate();
  const toast = useToast();
  const announce = useAnnounce();
  const { copy } = useClipboard({ announce: 'Command copied' });
  const copyRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const announcedLanded = useRef(false);
  const runway = useQuery({ ...runwayQuery(hostId), enabled: isOpen });

  // Prepare on every open and on `Prepare approval again`; never reuse an earlier statement.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the re-prepare trigger.
  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    setState({ status: 'loading' });
    announcedLanded.current = false;
    prepareApproval(hostId, phaseId, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        setState(
          result.ok
            ? { status: 'ready', prepared: result.prepared }
            : { status: 'refused', refusal: result.refusal },
        );
      },
      () => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      },
    );
    return () => controller.abort();
  }, [hostId, phaseId, isOpen, attempt]);

  const prepared = state.status === 'ready' ? state.prepared : null;
  const landed = prepared !== null && approval?.state === 'on-runway';
  // The runway figure must describe the tip the approval landed at, not an earlier one.
  const runwayFresh =
    runway.data !== undefined && runway.data.hostId === hostId && runway.data.tip === currentTip;
  const landedCount = landed && runwayFresh ? (runway.data?.count ?? null) : null;
  const stale = prepared !== null && !landed && currentTip !== null && currentTip !== prepared.tip;

  useEffect(() => {
    if (landed && !runwayFresh && !runway.isFetching) void runway.refetch();
  }, [landed, runwayFresh, runway.isFetching, runway.refetch]);

  useEffect(() => {
    if (landedCount === null || announcedLanded.current) return;
    announcedLanded.current = true;
    announce(`Signed. Runway is now ${landedCount}.`, 'polite');
  }, [landedCount, announce]);

  // Focus `Copy command` once the command is there (the dialog's own initial focus runs while
  // the button is still loading), or the refusal Banner's action when signing would be refused.
  useEffect(() => {
    if (prepared !== null && !landed && !stale) copyRef.current?.focus();
  }, [prepared, landed, stale]);
  useEffect(() => {
    if (state.status === 'refused' || state.status === 'error') retryRef.current?.focus();
  }, [state.status]);

  const onCopy = useCallback(async () => {
    if (prepared === null) return;
    if (await copy(prepared.command)) toast({ body: 'Command copied' });
  }, [copy, prepared, toast]);

  const close = () => onOpenChange(false);
  const prepareAgain = () => setAttempt((n) => n + 1);

  let body: ReactNode;
  if (state.status === 'loading') {
    body = <LoadingBody />;
  } else if (state.status === 'error') {
    body = (
      <Banner
        status="error"
        title="Couldn't prepare the approval"
        description="Counterpoint's daemon didn't answer."
        endContent={
          <Button
            ref={retryRef}
            label="Prepare approval again"
            variant="secondary"
            onClick={prepareAgain}
          />
        }
      />
    );
  } else if (state.status === 'refused') {
    body = (
      <Banner
        status="error"
        title="Approval refused"
        description={refusalText(state.refusal, hostName, phaseId)}
        endContent={
          <Button
            ref={retryRef}
            label="Prepare approval again"
            variant="secondary"
            onClick={prepareAgain}
          />
        }
      />
    );
  } else {
    const p = state.prepared;
    const prereq = p.prerequisites;
    const itemName = p.itemPath.slice('.counterpoint/approvals/'.length, -'.json'.length);
    body = (
      <VStack gap={5}>
        {landedCount !== null ? (
          <Banner status="success" title={`Signed. Runway is now ${landedCount}.`} />
        ) : null}
        {stale ? (
          <Banner
            status="warning"
            title="The base branch moved"
            description={`${p.baseBranch} moved since this was prepared. Prepare the approval again so you sign the current version.`}
            endContent={
              <Button label="Prepare approval again" variant="secondary" onClick={prepareAgain} />
            }
          />
        ) : null}
        {prereq.userSetup.length > 0 || prereq.nonAutonomous > 0 ? (
          <Banner
            status="warning"
            title="Setup needed before the builder can run this"
            description={
              <VStack gap={2}>
                {prereq.userSetup.length > 0 ? (
                  <VStack as="ul" gap={1}>
                    {prereq.userSetup.map((item) => (
                      <li key={item.service}>
                        <Text>{setupText(item)}</Text>
                      </li>
                    ))}
                  </VStack>
                ) : null}
                {prereq.nonAutonomous > 0 ? (
                  <Text hasTabularNumbers>{presentText(prereq.nonAutonomous, prereq.total)}</Text>
                ) : null}
              </VStack>
            }
          />
        ) : null}
        <MetadataList title="What you're signing">
          <MetadataListItem label="Phase">
            <Text>{`${p.phase.id}: ${p.phase.name}`}</Text>
          </MetadataListItem>
          <MetadataListItem label="Base branch">
            <Tooltip content={<Text type="code">{p.tip}</Text>}>
              <Text type="code" aria-label={`${p.baseBranch} at ${p.tip}`}>
                {`${p.baseBranch} @ ${p.tip.slice(0, 7)}`}
              </Text>
            </Tooltip>
          </MetadataListItem>
          <MetadataListItem label="Plans">
            <Text hasTabularNumbers>{plansCountText(p.phase.planCount)}</Text>
          </MetadataListItem>
        </MetadataList>
        <Table<InputRow> data={inputRows(p)} columns={inputColumns} idKey="id" />
        {stale || landed ? null : (
          <VStack gap={3}>
            <Text>
              {`Run this in your terminal. It asks for your passphrase, then signs a commit on ${p.baseBranch} that adds only .counterpoint/approvals/${itemName}.json. Your uncommitted work is not touched.`}
            </Text>
            <CodeBlock
              code={p.command}
              language="bash"
              hasCopyButton
              isWrapped={false}
              onCopy={() => toast({ body: 'Command copied' })}
            />
            <Text type="supporting" color="secondary">
              {`Statement ${p.fingerprint}`}
            </Text>
          </VStack>
        )}
        {stale ? null : (
          <Text color={landedCount === null ? 'secondary' : 'primary'}>
            {landedCount === null
              ? 'Waiting for the signed commit…'
              : `Signed. Runway is now ${landedCount}.`}
          </Text>
        )}
      </VStack>
    );
  }

  const showCopy = state.status === 'loading' || (state.status === 'ready' && !landed);

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="info" width={640}>
      <Layout
        header={<DialogHeader title={`Approve Phase ${phaseId}: ${phaseName}`} />}
        content={<LayoutContent>{body}</LayoutContent>}
        footer={
          <LayoutFooter hasDivider>
            <HStack gap={2} justify="end" wrap="wrap">
              <Button label="Close approval" variant="secondary" onClick={close} />
              {landed ? (
                <Button
                  label="Back to phases"
                  variant="primary"
                  onClick={() => {
                    close();
                    void navigate({ to: '/h/$hostId/phases', params: { hostId } });
                  }}
                />
              ) : showCopy ? (
                <Button
                  ref={copyRef}
                  label="Copy command"
                  variant="primary"
                  data-autofocus="true"
                  isLoading={state.status === 'loading'}
                  isDisabled={stale}
                  onClick={() => void onCopy()}
                />
              ) : null}
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

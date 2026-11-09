// The approved-version-changed change view (`/h/{hostId}/needs-you/{itemId}`, D-04, UI-SPEC
// "Screens and Layout" Change view and E7). It should feel like reviewing a PR: which inputs
// changed since signing, the real diff between the content at the approval's recorded base commit
// and the base branch tip now, then the one-line command to sign the new version.
//
// Diffs are made by git on the server and shown as plain text in a CodeBlock (never HTML); each
// file's diff is fetched only when its Collapsible first opens. Signing happens only in the
// owner's terminal (no sign button). When the item resolves while the page is open (re-signed, or
// the inputs went back to the signed state) a `needs-you` event refetches it and the page flips
// to `This phase matches what you signed again`.
import { Badge, type BadgeVariant } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Table, type TableColumn } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { useToast } from '@astryxdesign/core/Toast';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { VStack } from '@astryxdesign/core/VStack';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ApiError, apiGet, queryKeys } from '../api';
import { runwayQuery } from '../runway';
import { type NeedsYouItem, parseNeedsYouItem } from './NeedsYouPage';

/** The gate-config row's path in the change list (src/core/runway/needs-you.ts). */
const GATES_ROW_PATH = '.counterpoint/config.yaml#gates';
const GATES_ROW_TEXT = 'Gate config · .counterpoint/config.yaml (gates)';
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const HOST_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const PHASE_ID_RE = /^\d{2}(\.\d+)?$/;

type ChangeKind = 'modified' | 'added' | 'removed' | 'unreadable';

type ChangeRow = {
  path: string;
  label: string;
  kind: string;
  change: ChangeKind;
  signedDigest: string | null;
  nowDigest: string | null;
};

type ChangeDetail = {
  item: NeedsYouItem;
  lead: {
    signedAt: string;
    signedBase: string;
    tip: string;
    baseBranch: string;
    changedCount: number;
    gatesChanged: boolean;
  };
  changes: ChangeRow[];
  /** Null when the server's command is not the ID-only form built from validated ids. */
  command: string | null;
};

type ItemResult = { state: 'item'; detail: ChangeDetail } | { state: 'gone' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const digestOrNull = (value: unknown): string | null =>
  typeof value === 'string' && DIGEST_RE.test(value) ? value : null;

const CHANGE_KINDS: readonly ChangeKind[] = ['modified', 'added', 'removed', 'unreadable'];

function parseChange(value: unknown): ChangeRow | null {
  if (!isRecord(value) || typeof value.path !== 'string' || value.path === '') return null;
  const change = CHANGE_KINDS.find((kind) => kind === value.change);
  if (change === undefined) return null;
  return {
    path: value.path,
    label: str(value.label) || value.path,
    kind: str(value.kind),
    change,
    signedDigest: digestOrNull(value.signedDigest),
    nowDigest: digestOrNull(value.nowDigest),
  };
}

function parseDetail(hostId: string, body: unknown): ChangeDetail | null {
  if (!isRecord(body) || !isRecord(body.lead)) return null;
  const item = parseNeedsYouItem(body.item);
  if (item === null) return null;
  const lead = body.lead;
  if (typeof lead.signedBase !== 'string' || !COMMIT_RE.test(lead.signedBase)) return null;
  if (typeof lead.tip !== 'string' || !COMMIT_RE.test(lead.tip)) return null;
  // Pitfall 8: show a command only when it is exactly the ID-only form of validated ids.
  const expected =
    HOST_ID_RE.test(hostId) && PHASE_ID_RE.test(item.phaseId)
      ? `counterpoint approve ${hostId} ${item.phaseId}`
      : null;
  return {
    item,
    lead: {
      signedAt: str(lead.signedAt),
      signedBase: lead.signedBase,
      tip: lead.tip,
      baseBranch: str(lead.baseBranch),
      changedCount: count(lead.changedCount),
      gatesChanged: lead.gatesChanged === true,
    },
    changes: Array.isArray(body.changes)
      ? body.changes.map(parseChange).filter((row): row is ChangeRow => row !== null)
      : [],
    command: expected !== null && body.command === expected ? expected : null,
  };
}

async function fetchItem(
  hostId: string,
  itemId: string,
  signal?: AbortSignal,
): Promise<ItemResult> {
  try {
    const body = await apiGet(
      `/api/hosts/${encodeURIComponent(hostId)}/needs-you/${encodeURIComponent(itemId)}`,
      signal,
    );
    const detail = parseDetail(hostId, body);
    if (detail === null) throw new Error('The change view answer was not understood.');
    return { state: 'item', detail };
  } catch (error) {
    // 404: the item is not in Needs You now (resolved, or never was one).
    if (error instanceof ApiError && error.status === 404) return { state: 'gone' };
    throw error;
  }
}

// Under the needs-you prefix, so `needs-you` and `approval` events refetch it (live.ts).
const itemQuery = (hostId: string, itemId: string) =>
  queryOptions({
    queryKey: [...queryKeys.needsYou(hostId), 'item', itemId] as const,
    queryFn: ({ signal }) => fetchItem(hostId, itemId, signal),
  });

type DiffResult = { state: 'diff'; diff: string; truncated: boolean } | { state: 'failed' };

async function fetchDiff(
  hostId: string,
  itemId: string,
  path: string,
  signal?: AbortSignal,
): Promise<DiffResult> {
  const body = await apiGet(
    `/api/hosts/${encodeURIComponent(hostId)}/needs-you/${encodeURIComponent(itemId)}/diff?path=${encodeURIComponent(path)}`,
    signal,
  );
  if (!isRecord(body) || typeof body.diff !== 'string') return { state: 'failed' };
  return { state: 'diff', diff: body.diff, truncated: body.truncated === true };
}

// A diff is fixed by what it compares: the signed base commit and the content now (its digest).
// The key carries both and sits outside the live-invalidated needs-you prefix, so a diff is
// fetched once per content and a new edit (a new digest from the refetched item) fetches anew.
const diffQuery = (
  hostId: string,
  itemId: string,
  row: ChangeRow,
  signedBase: string,
  enabled: boolean,
) =>
  queryOptions({
    queryKey: [
      'host',
      hostId,
      'needs-you-diff',
      itemId,
      row.path,
      signedBase,
      row.nowDigest ?? 'none',
    ] as const,
    queryFn: ({ signal }) => fetchDiff(hostId, itemId, row.path, signal),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });

const sha7 = (sha: string): string => sha.slice(0, 7);
const hex12 = (digest: string | null): string =>
  digest === null ? '—' : digest.slice('sha256:'.length, 'sha256:'.length + 12);

export function inputFilesChangedText(k: number): string {
  return k === 1 ? '1 input file changed' : `${k} input files changed`;
}

/** The end of the lead line: input files, the gate config, or both. */
export function leadChangeText(lead: { changedCount: number; gatesChanged: boolean }): string {
  if (lead.gatesChanged && lead.changedCount === 0) return 'The gate config changed.';
  if (lead.gatesChanged) {
    return `${inputFilesChangedText(lead.changedCount)} and the gate config changed.`;
  }
  return `${inputFilesChangedText(lead.changedCount)}.`;
}

const CHANGE_LOOK: Readonly<Record<ChangeKind, { label: string; variant: BadgeVariant }>> = {
  modified: { label: 'Modified', variant: 'warning' },
  added: { label: 'Added', variant: 'info' },
  removed: { label: 'Removed', variant: 'error' },
  unreadable: { label: "Couldn't read", variant: 'error' },
};

const rowText = (row: ChangeRow): string =>
  row.path === GATES_ROW_PATH ? GATES_ROW_TEXT : row.path;

/** An inline error: the error icon plus the words (never color alone). */
function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <HStack gap={2} vAlign="center">
      <Icon icon="error" size="sm" color="error" />
      <Text>{children}</Text>
    </HStack>
  );
}

function DigestText({ digest }: { digest: string | null }) {
  if (digest === null) return <Text type="code">—</Text>;
  return (
    <Tooltip content={<Text type="code">{digest}</Text>}>
      <Text type="code" aria-label={digest}>
        {hex12(digest)}
      </Text>
    </Tooltip>
  );
}

const changeColumns: TableColumn<ChangeRow>[] = [
  {
    key: 'file',
    header: 'File',
    renderCell: (row) => (
      <Text type="code" wordBreak="break-all">
        {rowText(row)}
      </Text>
    ),
  },
  {
    key: 'change',
    header: 'Change',
    renderCell: (row) => (
      <Badge variant={CHANGE_LOOK[row.change].variant} label={CHANGE_LOOK[row.change].label} />
    ),
  },
  {
    key: 'digests',
    header: 'Signed digest → Now digest',
    renderCell: (row) => (
      <Text type="code">
        <DigestText digest={row.signedDigest} />
        {' → '}
        <DigestText digest={row.nowDigest} />
      </Text>
    ),
  },
];

function DiffBody({
  hostId,
  itemId,
  row,
  signedBase,
  isOpen,
}: {
  hostId: string;
  itemId: string;
  row: ChangeRow;
  signedBase: string;
  isOpen: boolean;
}) {
  // Fetched on first open and kept afterwards; a new edit changes the key (see diffQuery).
  const [opened, setOpened] = useState(isOpen);
  useEffect(() => {
    if (isOpen) setOpened(true);
  }, [isOpen]);
  const query = useQuery(diffQuery(hostId, itemId, row, signedBase, opened));

  if (query.isError || query.data?.state === 'failed') {
    return (
      <ErrorLine>
        {
          "Couldn't compute this diff. The other files are unaffected; reload the page to try again."
        }
      </ErrorLine>
    );
  }
  if (query.data === undefined) {
    return <Skeleton width="100%" height={120} />;
  }
  if (query.data.diff === '') {
    return (
      <Text type="supporting" color="secondary">
        No line differences.
      </Text>
    );
  }
  return (
    <VStack gap={2}>
      {query.data.truncated ? (
        <Text type="supporting" color="secondary">
          This diff is long, so only its first 5,000 lines are shown.
        </Text>
      ) : null}
      <CodeBlock code={query.data.diff} isDiff maxHeight={480} isWrapped={false} />
    </VStack>
  );
}

function FileDiff({
  hostId,
  itemId,
  row,
  signedBase,
  defaultIsOpen,
}: {
  hostId: string;
  itemId: string;
  row: ChangeRow;
  signedBase: string;
  defaultIsOpen: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultIsOpen);
  const trigger =
    row.path === GATES_ROW_PATH ? (
      <Text type="code" wordBreak="break-all">
        Gate config
      </Text>
    ) : (
      <Text type="code" wordBreak="break-all">
        {row.path}
      </Text>
    );
  return (
    <Collapsible trigger={trigger} isOpen={isOpen} onOpenChange={setIsOpen}>
      <DiffBody hostId={hostId} itemId={itemId} row={row} signedBase={signedBase} isOpen={isOpen} />
    </Collapsible>
  );
}

function ChangeLoading() {
  return (
    <VStack gap={4} aria-busy="true" aria-label="Loading the change view">
      <Skeleton width={480} height={20} />
      <VStack gap={2}>
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} index={index} width="100%" height={44} />
        ))}
      </VStack>
    </VStack>
  );
}

function Gone({ hostId, resolved }: { hostId: string; resolved: boolean }) {
  return (
    <EmptyState
      headingLevel={2}
      title={resolved ? 'This phase matches what you signed again' : 'This item no longer exists'}
      {...(resolved ? { description: 'Nothing left to review.' } : {})}
      actions={<Link href={`/h/${hostId}/needs-you`}>Back to Needs You</Link>}
    />
  );
}

function ChangeDetailView({
  hostId,
  itemId,
  detail,
}: {
  hostId: string;
  itemId: string;
  detail: ChangeDetail;
}) {
  const toast = useToast();
  const { lead, changes } = detail;
  return (
    <VStack gap={6}>
      <Text hasTabularNumbers>
        {'Signed '}
        <Timestamp value={lead.signedAt} type="inherit" hasTooltip />
        {` at ${sha7(lead.signedBase)}. ${lead.baseBranch} is now at ${sha7(lead.tip)}. ${leadChangeText(lead)}`}
      </Text>
      <Table<ChangeRow> data={changes} columns={changeColumns} idKey="path" />
      <VStack gap={3}>
        {changes.map((row, index) => (
          <FileDiff
            key={row.path}
            hostId={hostId}
            itemId={itemId}
            row={row}
            signedBase={lead.signedBase}
            defaultIsOpen={index === 0}
          />
        ))}
      </VStack>
      {/* A plain stack, not Astryx `Section` (a Layout-level container that bleeds out of
          LayoutContent's inset); the heading names the part. */}
      <VStack gap={3} role="region" aria-label="Sign the new version">
        <VStack gap={3}>
          <Heading level={3} accessibilityLevel={2}>
            Sign the new version
          </Heading>
          <Text>Review what changed, then run:</Text>
          {detail.command === null ? (
            <ErrorLine>
              {
                "The command from Counterpoint's daemon was not in the expected form, so it is not shown."
              }
            </ErrorLine>
          ) : (
            <CodeBlock
              code={detail.command}
              language="bash"
              hasCopyButton
              isWrapped={false}
              onCopy={() => toast({ body: 'Command copied' })}
            />
          )}
        </VStack>
      </VStack>
    </VStack>
  );
}

export function ChangeViewPage({ hostId, itemId }: { hostId: string; itemId: string }) {
  const query = useQuery(itemQuery(hostId, itemId));
  const runway = useQuery(runwayQuery(hostId));
  const seenItem = useRef(false);
  const result = query.data;
  if (result?.state === 'item') seenItem.current = true;
  const phaseId = itemId.slice('phase-'.length);
  // Resolved: this view showed the item and it went away, or the phase is on the runway now.
  const resolved =
    seenItem.current ||
    (runway.data?.hostId === hostId && runway.data.items.some((i) => i.phaseId === phaseId));

  const title =
    result?.state === 'item'
      ? result.detail.item.title
      : result?.state === 'gone'
        ? resolved
          ? 'Matches what you signed'
          : 'Needs You item'
        : `Phase ${phaseId} changed since you signed it`;

  useEffect(() => {
    document.title = `${title} · Counterpoint`;
  }, [title]);

  const errorBanner = query.isError ? (
    <Banner
      status="error"
      title="Couldn't load this change"
      description={
        result === undefined
          ? "Counterpoint's daemon didn't answer."
          : "Counterpoint's daemon didn't answer. What it last sent is still shown."
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

  let body = null;
  if (result === undefined) {
    body = query.isError ? null : <ChangeLoading />;
  } else if (result.state === 'gone') {
    body = <Gone hostId={hostId} resolved={resolved} />;
  } else {
    body = <ChangeDetailView hostId={hostId} itemId={itemId} detail={result.detail} />;
  }

  return (
    <Layout
      header={
        <LayoutHeader>
          <Heading level={2} accessibilityLevel={1} wordBreak="break-word">
            {result?.state === 'item' ? result.detail.item.title : 'Needs You'}
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

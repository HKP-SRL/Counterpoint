// Mission (`/h/{hostId}`): the host's headline page (runway: Runway is the Mission headline;
// needs-you: Approved version changed).
//
// 1. A warning Banner when approvals changed since signing, linking to Needs You.
// 1b. The Run card (components/RunCard.tsx): start, follow and stop a build run.
// 2. The runway card (full width, first): how many changes are signed, verified at the base tip
//    and not yet built, i.e. approved work ahead of the builder. The figure is recomputed from
//    git by the server on every read; `runway` and `approval` events refetch it and the new number
//    is announced politely.
// 3. A Grid (two columns from `lg`, one below) with the Needs You card (the five newest items, the
//    same row as the inbox) and the Trust card (the last doctor report's one-line verdict, with
//    the Trust page's own words).
// 4. The host facts.
//
// Every card keeps its last good data on screen when a refresh fails, and only the first load
// shows Skeletons.
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { useAnnounce, useMediaQuery } from '@astryxdesign/core/hooks';
import { Icon } from '@astryxdesign/core/Icon';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { VStack } from '@astryxdesign/core/VStack';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef } from 'react';
import { hostsQuery } from '../api';
import { RunCard } from '../components/RunCard';
import { changesText, type RunwaySnapshot, runwayQuery, tasksCountText } from '../runway';
import { NeedsYouEmpty, NeedsYouLoading, NeedsYouRow, needsYouQuery } from './NeedsYouPage';
import { ageText, doctorQuery, ResultBadge, trustVerdict } from './TrustPage';

const TABULAR = { fontVariantNumeric: 'tabular-nums' } as const;

/** The Needs You card shows at most this many rows; the rest are one link away. */
export const NEEDS_YOU_CARD_ROWS = 5;

/** The `lg` width breakpoint (Astryx default map), where the cards go side by side. */
const LG_QUERY = '(min-width: 1024px)';

export function changedBannerText(k: number): string {
  return k === 1
    ? '1 approved change was edited since you signed it'
    : `${k} approved changes were edited since you signed them`;
}

function RunwayLoading() {
  return (
    <VStack gap={3} aria-busy="true" aria-label="Loading the runway">
      <Skeleton width={56} height={36} />
      <Skeleton width={320} height={20} />
      <VStack gap={2}>
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} index={index} width="100%" height={44} />
        ))}
      </VStack>
    </VStack>
  );
}

function RunwayFigure({ hostId, runway }: { hostId: string; runway: RunwaySnapshot }) {
  const items = runway.items;
  return (
    <VStack gap={4}>
      <VStack gap={1}>
        <Heading level={2} type="display-3" style={TABULAR}>
          {String(runway.count)}
        </Heading>
        {runway.count === 0 ? (
          <Text type="supporting" color="secondary">
            Nothing approved yet. Open a ready change and approve it to start your runway.
          </Text>
        ) : (
          <Text type="supporting" color="secondary" hasTabularNumbers>
            {`${changesText(runway.count)} on the runway · ${tasksCountText(runway.taskCount)} approved and ready ahead of the builder`}
          </Text>
        )}
      </VStack>
      {runway.count === 0 ? (
        <Link href={`/h/${hostId}/changes`}>Browse changes</Link>
      ) : (
        // Grows with the page: no inner scroll and no cap, however long the runway.
        <List hasDividers={items.length > 1} aria-label="Changes on the runway">
          {items.map((item) => (
            <ListItem
              key={item.changeId}
              href={`/h/${hostId}/changes/${item.changeId}`}
              label={
                <HStack gap={2} vAlign="center">
                  <Text maxLines={1} hasTruncateTooltip>
                    {item.title}
                  </Text>
                  <Text type="code" color="secondary" textWrap="nowrap">
                    {item.changeId}
                  </Text>
                </HStack>
              }
              description={
                <Text type="supporting" color="secondary" hasTabularNumbers>
                  {`${tasksCountText(item.taskCount)} · signed `}
                  <Timestamp value={item.signedAt} hasTooltip />
                </Text>
              }
              // A change whose files can't be read keeps its row (it still counts until its
              // files change) and says so.
              endContent={
                item.unreadable ? (
                  <Badge
                    variant="error"
                    label="Couldn't read"
                    icon={<Icon icon="error" size="xsm" />}
                  />
                ) : undefined
              }
            />
          ))}
        </List>
      )}
    </VStack>
  );
}

function CardTitle({ children }: { children: ReactNode }) {
  return (
    <Text type="label" weight="semibold">
      {children}
    </Text>
  );
}

function NeedsYouCard({ hostId, hostName }: { hostId: string; hostName: string }) {
  const query = useQuery(needsYouQuery(hostId));
  // keepPreviousData can briefly hold another host's items while switching; never show them.
  const snapshot = query.data?.hostId === hostId ? query.data : undefined;
  const allHref = `/h/${hostId}/needs-you`;

  let body: ReactNode = null;
  if (snapshot === undefined) {
    body = query.isError ? null : <NeedsYouLoading rows={2} />;
  } else if (snapshot.items.length === 0 && snapshot.runItems.length === 0) {
    body = <NeedsYouEmpty headingLevel={3} />;
  } else if (snapshot.items.length === 0) {
    // Only what the last run left (parked changes, a stopped run): the inbox shows them in full.
    body = (
      <VStack gap={2}>
        <Text>
          {snapshot.runItems.length === 1
            ? 'The last run left 1 item for you.'
            : `The last run left ${snapshot.runItems.length} items for you.`}
        </Text>
        <Link href={allHref}>Open Needs You</Link>
      </VStack>
    );
  } else {
    // The server serves the items newest first; the card shows the first five.
    const shown = snapshot.items.slice(0, NEEDS_YOU_CARD_ROWS);
    body = (
      <VStack gap={3}>
        <List hasDividers={shown.length > 1} aria-label="Newest Needs You items">
          {shown.map((item) => (
            <NeedsYouRow key={item.id} hostId={hostId} hostName={hostName} item={item} />
          ))}
        </List>
        {snapshot.items.length > NEEDS_YOU_CARD_ROWS ? (
          <Link href={allHref}>View all Needs You items</Link>
        ) : null}
      </VStack>
    );
  }

  return (
    <Card padding={5} elevation="none" aria-label="Needs You">
      <VStack gap={3}>
        <CardTitle>Needs You</CardTitle>
        {query.isError ? (
          <Banner
            status="error"
            title="Couldn't load Needs You"
            description={
              snapshot === undefined
                ? "Counterpoint's daemon didn't answer."
                : "Counterpoint's daemon didn't answer. The last items it sent are still shown."
            }
            endContent={
              <Button
                label="Try loading Needs You again"
                variant="secondary"
                isLoading={query.isFetching}
                onClick={() => void query.refetch()}
              />
            }
          />
        ) : null}
        {body}
      </VStack>
    </Card>
  );
}

function TrustLoading() {
  return (
    <VStack gap={2} aria-busy="true" aria-label="Loading checks">
      <Skeleton width="80%" height={24} />
      <Skeleton width="50%" height={20} />
    </VStack>
  );
}

function TrustCard({ hostId, hostName }: { hostId: string; hostName: string }) {
  const query = useQuery(doctorQuery(hostId));
  const answer = query.data?.hostId === hostId ? query.data : undefined;
  const trustLink = <Link href={`/h/${hostId}/trust`}>Open Trust</Link>;

  let body: ReactNode = null;
  if (answer === undefined) {
    body = query.isError ? null : <TrustLoading />;
  } else if (answer.report === null) {
    body = answer.unreadable ? (
      <VStack gap={2}>
        <HStack gap={2} vAlign="start">
          <Icon icon="error" size="sm" color="error" />
          <Text weight="semibold">Couldn't read the last check</Text>
        </HStack>
        <Text type="supporting" color="secondary">
          The saved doctor report is not valid. Run "counterpoint doctor" again.
        </Text>
        {trustLink}
      </VStack>
    ) : (
      <VStack gap={2}>
        <Text weight="semibold">Not checked yet</Text>
        <Text type="supporting" color="secondary">
          Run "counterpoint doctor" in a terminal. The result appears here.
        </Text>
        {trustLink}
      </VStack>
    );
  } else {
    const report = answer.report;
    const verdict = trustVerdict(answer, report, hostName);
    body = (
      <VStack gap={2}>
        {/* The verdict wraps inside the card and is never truncated, however long. */}
        <HStack gap={2} vAlign="start" wrap="wrap">
          <ResultBadge look={verdict.badge} />
          <Text weight="semibold">{verdict.title}</Text>
        </HStack>
        <Text type="supporting" color="secondary">
          {'Checked '}
          <Timestamp value={report.checkedAt} hasTooltip />
        </Text>
        {answer.stale ? (
          <HStack gap={2} vAlign="start">
            <Icon icon="warning" size="sm" color="warning" />
            <Text>
              {`This check is ${ageText(report.checkedAt)} old. Run "counterpoint doctor" again.`}
            </Text>
          </HStack>
        ) : null}
        {trustLink}
      </VStack>
    );
  }

  return (
    <Card padding={5} elevation="none" aria-label="Trust">
      <VStack gap={3}>
        <CardTitle>Trust</CardTitle>
        {query.isError ? (
          <Banner
            status="error"
            title="Couldn't load checks"
            description={
              answer === undefined
                ? "Counterpoint's daemon didn't answer."
                : "Counterpoint's daemon didn't answer. The last result it sent is still shown."
            }
            endContent={
              <Button
                label="Try loading checks again"
                variant="secondary"
                isLoading={query.isFetching}
                onClick={() => void query.refetch()}
              />
            }
          />
        ) : null}
        {body}
      </VStack>
    </Card>
  );
}

export function MissionPage({ hostId }: { hostId: string }) {
  const hosts = useQuery(hostsQuery);
  const host = hosts.data?.find((candidate) => candidate.id === hostId);
  const hostName = host?.name ?? hostId;
  const query = useQuery(runwayQuery(hostId));
  // keepPreviousData can briefly hold another host's runway while switching; never show it.
  const runway = query.data?.hostId === hostId ? query.data : undefined;
  const announce = useAnnounce();
  const lastCount = useRef<{ hostId: string; count: number } | null>(null);
  const isWide = useMediaQuery(LG_QUERY, true);

  useEffect(() => {
    document.title = 'Mission · Counterpoint';
  }, []);

  // Later updates replace the number in place and are announced; the first load is not.
  useEffect(() => {
    if (runway === undefined) return;
    const previous = lastCount.current;
    lastCount.current = { hostId, count: runway.count };
    if (previous !== null && previous.hostId === hostId && previous.count !== runway.count) {
      announce(`Runway is now ${runway.count}`, 'polite');
    }
  }, [runway, hostId, announce]);

  const errorBanner = query.isError ? (
    <Banner
      status="error"
      title="Couldn't load the runway"
      description="Counterpoint's daemon didn't answer."
      endContent={
        <Button
          label="Try loading the runway again"
          variant="secondary"
          isLoading={query.isFetching}
          onClick={() => void query.refetch()}
        />
      }
    />
  ) : null;

  // Directly above the runway card whenever an approval changed since signing.
  const changedBanner =
    runway !== undefined && runway.changedCount > 0 ? (
      <Banner
        status="warning"
        title={changedBannerText(runway.changedCount)}
        description={<Link href={`/h/${hostId}/needs-you`}>Review what changed in Needs You</Link>}
      />
    ) : null;

  return (
    <Layout
      header={
        <LayoutHeader>
          <Heading level={2} accessibilityLevel={1}>
            Mission
          </Heading>
        </LayoutHeader>
      }
      content={
        <LayoutContent>
          <VStack gap={6}>
            {errorBanner}
            {changedBanner}
            <RunCard hostId={hostId} />
            <Card padding={5} elevation="none" aria-label="Runway">
              <VStack gap={3}>
                <Text type="label" weight="semibold">
                  Runway
                </Text>
                {runway === undefined ? (
                  query.isError ? null : (
                    <RunwayLoading />
                  )
                ) : (
                  <RunwayFigure hostId={hostId} runway={runway} />
                )}
              </VStack>
            </Card>
            <Grid columns={isWide ? 2 : 1} gap={6} align="start">
              <NeedsYouCard hostId={hostId} hostName={hostName} />
              <TrustCard hostId={hostId} hostName={hostName} />
            </Grid>
            {host === undefined ? (
              <Skeleton width={320} height={48} />
            ) : (
              <MetadataList>
                <MetadataListItem label="Folder">
                  <Text type="code" wordBreak="break-all">
                    {host.root}
                  </Text>
                </MetadataListItem>
                <MetadataListItem label="Base branch">
                  <Text type="code">{host.baseBranch}</Text>
                </MetadataListItem>
              </MetadataList>
            )}
          </VStack>
        </LayoutContent>
      }
    />
  );
}

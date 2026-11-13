// Mission (`/h/{hostId}`): the host's headline page (runway: Runway is the Mission headline).
//
// 1. The Run card (components/RunCard.tsx): start, follow and stop a build run.
// 2. The runway card (full width): how many approved changes are readable and not yet built,
//    i.e. approved work ahead of the builder, each with Withdraw. `runway` and `approval` events
//    (and the owner's own clicks) refetch it, and the new number is announced politely.
// 3. The Needs You card: what the last run left for the owner, one link away.
// 4. The host facts.
//
// Every card keeps its last good data on screen when a refresh fails, and only the first load
// shows Skeletons.
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { useAnnounce } from '@astryxdesign/core/hooks';
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
import { useApprovalActions } from '../approvals';
import { RunCard } from '../components/RunCard';
import { changesText, type RunwaySnapshot, runwayQuery, tasksCountText } from '../runway';
import { NeedsYouEmpty, NeedsYouLoading, needsYouCount, needsYouQuery } from './NeedsYouPage';

const TABULAR = { fontVariantNumeric: 'tabular-nums' } as const;

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
  const actions = useApprovalActions(hostId);
  return (
    <VStack gap={4}>
      {actions.error === null ? null : <Banner status="error" title={actions.error} />}
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
                  {item.waitingForSignOff ? (
                    <Badge variant="warning" label="Waiting for sign-off" />
                  ) : null}
                </HStack>
              }
              description={
                <Text type="supporting" color="secondary" hasTabularNumbers>
                  {`${tasksCountText(item.taskCount)} · approved `}
                  <Timestamp value={new Date(item.approvedAt).toISOString()} hasTooltip />
                </Text>
              }
              endContent={
                <Button
                  label="Withdraw"
                  variant="ghost"
                  size="sm"
                  isLoading={actions.pending === item.changeId}
                  onClick={() => void actions.withdraw(item.changeId)}
                />
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

function NeedsYouCard({ hostId }: { hostId: string }) {
  const query = useQuery(needsYouQuery(hostId));
  // keepPreviousData can briefly hold another host's items while switching; never show them.
  const snapshot = query.data?.hostId === hostId ? query.data : undefined;
  const allHref = `/h/${hostId}/needs-you`;

  let body: ReactNode = null;
  if (snapshot === undefined) {
    body = query.isError ? null : <NeedsYouLoading rows={2} />;
  } else if (needsYouCount(snapshot) === 0) {
    body = <NeedsYouEmpty headingLevel={3} />;
  } else {
    // The first question; the inbox answers them all from the keyboard.
    const waiting = needsYouCount(snapshot);
    body = (
      <VStack gap={2}>
        <Text>{snapshot.cards[0]?.question}</Text>
        <Text type="supporting" color="secondary">
          {waiting === 1 ? '1 question waits on you.' : `${waiting} questions wait on you.`}
        </Text>
        <Link href={allHref}>Open Needs You</Link>
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

export function MissionPage({ hostId }: { hostId: string }) {
  const hosts = useQuery(hostsQuery);
  const host = hosts.data?.find((candidate) => candidate.id === hostId);
  const query = useQuery(runwayQuery(hostId));
  // keepPreviousData can briefly hold another host's runway while switching; never show it.
  const runway = query.data?.hostId === hostId ? query.data : undefined;
  const announce = useAnnounce();
  const lastCount = useRef<{ hostId: string; count: number } | null>(null);

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
            <NeedsYouCard hostId={hostId} />
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

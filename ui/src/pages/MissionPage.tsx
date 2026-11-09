// Mission (`/h/{hostId}`): the host's headline page. Runway is the headline (MISN-01, UI-SPEC
// "Screens and Layout" Mission, E1): the first, full-width card shows how many phases are signed,
// verified at the base tip and not yet built, i.e. approved work ahead of the builder. The figure
// is recomputed from git by the server on every read; `runway` and `approval` events refetch it
// and the new number is announced politely. The Needs You and Trust cards and the
// changed-since-signed banner are added in 01-15. The host facts sit below the card.
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
import { useEffect, useRef } from 'react';
import { hostsQuery } from '../api';
import { phasesText, plansCountText, type RunwaySnapshot, runwayQuery } from '../runway';

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
  return (
    <VStack gap={4}>
      <VStack gap={1}>
        <Heading level={2} type="display-3" style={TABULAR}>
          {String(runway.count)}
        </Heading>
        {runway.count === 0 ? (
          <Text type="supporting" color="secondary">
            Nothing approved yet. Open a planned phase and approve it to start your runway.
          </Text>
        ) : (
          <Text type="supporting" color="secondary" hasTabularNumbers>
            {runway.planCount === 1
              ? `${phasesText(runway.count)} · 1 plan approved and ready ahead of the builder`
              : `${phasesText(runway.count)} · ${runway.planCount} plans approved and ready ahead of the builder`}
          </Text>
        )}
      </VStack>
      {runway.count === 0 ? (
        <Link href={`/h/${hostId}/phases`}>Browse phases</Link>
      ) : (
        <List hasDividers={items.length > 1} aria-label="Phases on the runway">
          {items.map((item) => (
            <ListItem
              key={item.phaseId}
              href={`/h/${hostId}/phases/${item.phaseId}`}
              label={
                <HStack gap={2} vAlign="center">
                  <Text type="code" hasTabularNumbers>
                    {item.phaseId}
                  </Text>
                  <Text maxLines={1} hasTruncateTooltip>
                    {item.name}
                  </Text>
                </HStack>
              }
              description={
                <Text type="supporting" color="secondary" hasTabularNumbers>
                  {`${plansCountText(item.planCount)} · signed `}
                  <Timestamp value={item.signedAt} hasTooltip />
                  {item.unreadable ? " · Couldn't read" : ''}
                </Text>
              }
            />
          ))}
        </List>
      )}
    </VStack>
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
      title="Couldn't load phases"
      description="Counterpoint's daemon didn't answer."
      endContent={
        <Button
          label="Try loading phases again"
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

// Mission (`/h/{hostId}`): the host's headline page. The runway card (01-13) and the Needs You
// and Trust cards (01-15) are added to this page's content stack later.
import { Heading } from '@astryxdesign/core/Heading';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { hostsQuery } from '../api';

export function MissionPage({ hostId }: { hostId: string }) {
  const hosts = useQuery(hostsQuery);
  const host = hosts.data?.find((candidate) => candidate.id === hostId);

  useEffect(() => {
    document.title = 'Mission · Counterpoint';
  }, []);

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

// Preview (`/h/{hostId}/preview/{changeId}`, pull-requests: Preview link). For a host without
// preview deploys, a green change's PR and run report link here. Nothing runs until the owner
// presses Start: the daemon then runs the host config's preview command in the change's
// worktree, as the owner, on a free loopback port. The page follows it over SSE (`run`
// events), links to it once its port is open, and offers Stop. Output is shown as plain text.
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { queryKeys } from '../api';
import { errorText, type PreviewStatus, previewQuery, startPreview, stopPreview } from '../run';

const LOOK: Record<
  PreviewStatus['state'],
  { label: string; variant: 'neutral' | 'purple' | 'warning' }
> = {
  stopped: { label: 'Not running', variant: 'neutral' },
  starting: { label: 'Starting', variant: 'purple' },
  running: { label: 'Running', variant: 'purple' },
  exited: { label: 'Stopped on its own', variant: 'warning' },
};

function Controls({
  hostId,
  changeId,
  preview,
}: {
  hostId: string;
  changeId: string;
  preview: PreviewStatus;
}) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const live = preview.state === 'starting' || preview.state === 'running';

  const act = async (start: boolean) => {
    setBusy(true);
    setRefusal(null);
    try {
      const answer = start
        ? await startPreview(hostId, changeId)
        : await stopPreview(hostId, changeId);
      if (!answer.ok) setRefusal(errorText(answer.body, "The preview didn't start."));
      await client.invalidateQueries({ queryKey: queryKeys.preview(hostId, changeId) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <VStack gap={4}>
      {refusal !== null ? (
        <Banner status="error" title="The preview didn't start" description={refusal} />
      ) : null}
      <HStack gap={3} vAlign="center" wrap="wrap">
        <Badge variant={LOOK[preview.state].variant} label={LOOK[preview.state].label} />
        {preview.state === 'running' && preview.url !== null ? (
          <Link href={preview.url} target="_blank">
            {`Open ${preview.url}`}
          </Link>
        ) : null}
        {preview.state === 'starting' ? (
          <Text color="secondary">{`Waiting for it to open port ${preview.port ?? ''}…`}</Text>
        ) : null}
      </HStack>
      {preview.state === 'exited' && preview.reason !== null ? (
        <Text color="secondary">{preview.reason}</Text>
      ) : null}
      <HStack gap={3}>
        {live ? (
          <Button
            label="Stop the preview"
            variant="secondary"
            isLoading={busy}
            onClick={() => void act(false)}
          />
        ) : (
          <Button
            label="Start the preview"
            variant="primary"
            isLoading={busy}
            onClick={() => void act(true)}
          />
        )}
      </HStack>
    </VStack>
  );
}

export function PreviewPage({ hostId, changeId }: { hostId: string; changeId: string }) {
  const query = useQuery(previewQuery(hostId, changeId));
  const preview = query.data;

  useEffect(() => {
    document.title = `Preview ${changeId} · Counterpoint`;
  }, [changeId]);

  let body: ReactNode;
  if (preview !== undefined) {
    body = (
      <VStack gap={6}>
        <Card padding={5} elevation="none" aria-label="Preview">
          <Controls hostId={hostId} changeId={changeId} preview={preview} />
        </Card>
        <Text type="supporting" color="secondary">
          The preview runs the change's code from its worktree as you, like a gate, on a local port.
          It keeps running until you stop it or Counterpoint stops.
        </Text>
        {preview.tail.trim() !== '' ? (
          <VStack gap={2}>
            <Text type="label" weight="semibold">
              Last output
            </Text>
            <CodeBlock code={preview.tail} language="text" isWrapped />
          </VStack>
        ) : null}
      </VStack>
    );
  } else if (query.isError) {
    body = (
      <Banner
        status="error"
        title="Couldn't load the preview"
        description="Counterpoint's daemon didn't answer, or this change was never built."
      />
    );
  } else {
    body = (
      <VStack gap={2} aria-busy="true" aria-label="Loading the preview">
        <Skeleton width="40%" height={28} />
        <Skeleton width="100%" height={80} />
      </VStack>
    );
  }

  return (
    <Layout
      header={
        <LayoutHeader>
          <VStack gap={1}>
            <Heading level={2} accessibilityLevel={1}>
              Preview
            </Heading>
            <HStack gap={2} vAlign="center">
              <Link href={`/h/${hostId}/changes/${changeId}`}>{changeId}</Link>
              <Text color="secondary">{`branch cp/${changeId}`}</Text>
            </HStack>
          </VStack>
        </LayoutHeader>
      }
      content={<LayoutContent>{body}</LayoutContent>}
    />
  );
}

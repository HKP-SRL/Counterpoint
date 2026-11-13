// Run report (`/h/{hostId}/runs/{runId}`, run-report: Report at the end of every run): what the
// run left for the morning, in the order the owner needs it. Why it ended, then Ready to merge
// (PR and preview), Not for merge (planning edits), Parked (the last failing gate's lines),
// Not built, Waiting on you, Assumed decisions and Flags. The daemon builds it from the store on
// each request (so a preview found after the run shows up); `run` events refetch it. Everything
// builder-written is shown as plain text.
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Card } from '@astryxdesign/core/Card';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { VStack } from '@astryxdesign/core/VStack';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';
import {
  effortLabel,
  gatesText,
  type ReportChange,
  type RunReport,
  runReportQuery,
  testShareText,
} from '../run';

const ENDED: Record<NonNullable<RunReport['endReason']>, string> = {
  finished: 'The run finished: every chosen change was built or parked.',
  stopped: 'The run was stopped.',
  'stop-time': 'The run reached its stop time.',
  error: 'The run stopped on an error.',
  refused: 'The run was refused.',
};

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <Card padding={5} elevation="none" aria-label={title}>
      <VStack gap={3}>
        <HStack gap={2} vAlign="center">
          <Text type="label" weight="semibold">
            {title}
          </Text>
          {count === undefined ? null : <Badge variant="neutral" label={String(count)} />}
        </HStack>
        {children}
      </VStack>
    </Card>
  );
}

function None({ text = 'None.' }: { text?: string }) {
  return <Text color="secondary">{text}</Text>;
}

function ChangeLinks({ hostId, change }: { hostId: string; change: ReportChange }) {
  return (
    <HStack gap={3} vAlign="center" wrap="wrap">
      {change.prUrl !== null ? <Link href={change.prUrl}>Pull request</Link> : null}
      {change.previewUrl !== null ? (
        <Link href={change.previewUrl}>Preview</Link>
      ) : (
        <Text type="supporting" color="secondary">
          No preview
        </Text>
      )}
      <Link href={`/h/${hostId}/changes/${change.change}`}>{change.change}</Link>
    </HStack>
  );
}

/** The last attempt's gates (skipped and not run shown as such) and the test share. */
function GateLines({ change }: { change: ReportChange }) {
  const lines = [gatesText(change), testShareText(change)].filter(
    (line): line is string => line !== null,
  );
  if (lines.length === 0) return null;
  return (
    <VStack gap={0.5}>
      {lines.map((line) => (
        <Text key={line} type="supporting" color="secondary">
          {line}
        </Text>
      ))}
    </VStack>
  );
}

function Changes({ hostId, changes }: { hostId: string; changes: ReportChange[] }) {
  if (changes.length === 0) return <None />;
  return (
    <List hasDividers={changes.length > 1}>
      {changes.map((change) => (
        <ListItem
          key={change.change}
          label={<Text weight="semibold">{change.title}</Text>}
          description={
            <VStack gap={1}>
              <ChangeLinks hostId={hostId} change={change} />
              <GateLines change={change} />
            </VStack>
          }
        />
      ))}
    </List>
  );
}

function Plain({ text }: { text: string }) {
  return (
    <VStack gap={1}>
      {text.split('\n').map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines of one fixed text
        <Text key={index} color="secondary">
          {line === '' ? ' ' : line}
        </Text>
      ))}
    </VStack>
  );
}

function Report({ hostId, report }: { hostId: string; report: RunReport }) {
  const s = report.settings;
  const builder = [
    s.model,
    s.effort === null ? null : `${effortLabel(s.effort).toLowerCase()} effort`,
    s.budgetPercent === null ? null : `${s.budgetPercent}% context budget`,
  ]
    .filter((part) => part !== null)
    .join(' · ');
  const failed = report.endReason === 'error' || report.endReason === 'refused';
  return (
    <VStack gap={5}>
      <Banner
        status={failed ? 'error' : report.endReason === null ? 'info' : 'success'}
        title={report.endReason === null ? 'The run is still going.' : ENDED[report.endReason]}
        description={report.endDetail ?? undefined}
      />
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Text type="supporting" color="secondary">
          Started
        </Text>
        <Timestamp value={new Date(report.startedAt).toISOString()} hasTooltip />
        {report.endedAt !== null ? (
          <>
            <Text type="supporting" color="secondary">
              · ended
            </Text>
            <Timestamp value={new Date(report.endedAt).toISOString()} hasTooltip />
          </>
        ) : null}
        {builder !== '' ? <Text type="supporting" color="secondary">{`· ${builder}`}</Text> : null}
      </HStack>

      <Section title="Ready to merge" count={report.ready.length}>
        <Changes hostId={hostId} changes={report.ready} />
      </Section>

      {report.notForMerge.length > 0 ? (
        <Section title="Not for merge" count={report.notForMerge.length}>
          <Text color="secondary">
            Green, but the branch edits planning files: the PR stays a draft.
          </Text>
          <Changes hostId={hostId} changes={report.notForMerge} />
        </Section>
      ) : null}

      <Section title="Parked" count={report.parked.length}>
        {report.parked.length === 0 ? (
          <None />
        ) : (
          <VStack gap={4}>
            {report.parked.map((change) => (
              <VStack key={change.change} gap={2}>
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Text weight="semibold">{change.title}</Text>
                  <Link href={`/h/${hostId}/changes/${change.change}`}>{change.change}</Link>
                </HStack>
                {change.reason !== null ? <Text color="secondary">{change.reason}</Text> : null}
                <GateLines change={change} />
                {change.lastFailure !== null ? (
                  <>
                    <Text type="supporting" color="secondary">
                      {`Last failing gate: ${change.lastFailure.gate}, attempt ${change.lastFailure.attempt}${change.lastFailure.exitCode === null ? '' : `, exit ${change.lastFailure.exitCode}`}`}
                    </Text>
                    {change.lastFailure.tail !== null && change.lastFailure.tail.trim() !== '' ? (
                      <CodeBlock
                        code={change.lastFailure.tail.trim().split('\n').slice(-15).join('\n')}
                        language="text"
                        isWrapped
                      />
                    ) : null}
                  </>
                ) : null}
              </VStack>
            ))}
            <Link href={`/h/${hostId}/needs-you`}>Every gate attempt is in Needs You</Link>
          </VStack>
        )}
      </Section>

      {report.notBuilt.length > 0 ? (
        <Section title="Not built" count={report.notBuilt.length}>
          <List hasDividers={report.notBuilt.length > 1}>
            {report.notBuilt.map((change) => (
              <ListItem
                key={change.change}
                label={change.change}
                description={change.reason ?? undefined}
              />
            ))}
          </List>
        </Section>
      ) : null}

      <Section title="Waiting on you" count={report.waiting.length}>
        {report.waiting.length === 0 ? (
          <None text="Nothing." />
        ) : (
          <List>
            {report.waiting.map((item) => (
              <ListItem key={item} label={item} />
            ))}
          </List>
        )}
      </Section>

      <Section title="Assumed decisions">
        {report.assumptions.length === 0 ? (
          <None text="The builder recorded none." />
        ) : (
          <VStack gap={4}>
            {report.assumptions.map((a) => (
              <VStack key={a.change} gap={2}>
                <Text weight="semibold">{a.change}</Text>
                <Plain text={a.text} />
              </VStack>
            ))}
          </VStack>
        )}
      </Section>

      {report.flags.length > 0 ? (
        <Section title="Flags">
          <List>
            {report.flags.flatMap(({ change, flags }) =>
              flags.map((flag, index) => (
                <ListItem
                  // biome-ignore lint/suspicious/noArrayIndexKey: flags of one change, in order
                  key={`${change}-${index}`}
                  label={`${change}: ${flag.kind === 'protected-path' ? (flag.category ?? 'protected path') : flag.kind}`}
                  description={[flag.path, flag.status].filter(Boolean).join(' · ') || undefined}
                />
              )),
            )}
          </List>
        </Section>
      ) : null}
    </VStack>
  );
}

export function RunReportPage({ hostId, runId }: { hostId: string; runId: string }) {
  const query = useQuery(runReportQuery(hostId, runId));

  useEffect(() => {
    document.title = 'Run report · Counterpoint';
  }, []);

  let body: ReactNode;
  if (query.data !== undefined) {
    body = <Report hostId={hostId} report={query.data} />;
  } else if (query.isError) {
    body = (
      <Banner
        status="error"
        title="Couldn't load the run report"
        description="Counterpoint's daemon didn't answer, or this run does not exist."
      />
    );
  } else {
    body = (
      <VStack gap={2} aria-busy="true" aria-label="Loading the run report">
        <Skeleton width="60%" height={28} />
        <Skeleton width="100%" height={120} />
      </VStack>
    );
  }

  return (
    <Layout
      header={
        <LayoutHeader>
          <VStack gap={1}>
            <Heading level={2} accessibilityLevel={1}>
              Run report
            </Heading>
            <Text color="secondary" hasTabularNumbers>{`Run ${runId}`}</Text>
          </VStack>
        </LayoutHeader>
      }
      content={<LayoutContent>{body}</LayoutContent>}
    />
  );
}

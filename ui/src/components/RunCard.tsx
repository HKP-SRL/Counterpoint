// The Run card on Mission (build-runs: Start and stop a run from the console). The owner's one
// place to start, follow and stop a build run.
//
// While a run goes: a purple "In flight" chip (purple is the console's one "live" hue), a sentence
// answering "can I walk away?", what it is doing now, each change's state and a Stop button (a
// decision: the run stops at its next clean point). Holding on a usage limit is described as
// normal, never as a warning.
// Otherwise: the last run's outcome (parked changes and stopped runs in the dark-cockpit colors)
// and the launch form: the runway changes to build (all by default, in build order) and an
// optional stop time. The model, effort and context budget come from the project's Settings page;
// the form shows them in one line (budget as tokens once the model's window is known: "40% of 1M =
// 400k tokens") with a link there. Start is a guarded POST; a refusal (a change
// that left the runway) is shown in the daemon's own words.
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { TimeInput } from '@astryxdesign/core/TimeInput';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { useToast } from '@astryxdesign/core/Toast';
import { VStack } from '@astryxdesign/core/VStack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { queryKeys } from '../api';
import {
  activityText,
  budgetQuery,
  effortLabel,
  errorText,
  nextOccurrence,
  overBudgetText,
  type RunAnswer,
  type RunChangeView,
  type RunView,
  runQuery,
  settingsQuery,
  startRun,
  stopRun,
} from '../run';

type BadgeLook = { label: string; variant: 'neutral' | 'warning' | 'error' | 'purple' };

/** Dark cockpit: grey when normal (done included), color only for exceptions; purple = live. */
const CHANGE_LOOK: Record<RunChangeView['state'], BadgeLook> = {
  queued: { label: 'Up next', variant: 'neutral' },
  building: { label: 'Building', variant: 'purple' },
  green: { label: 'Green', variant: 'neutral' },
  parked: { label: 'Parked', variant: 'warning' },
  skipped: { label: 'Skipped', variant: 'warning' },
  stopped: { label: 'Not finished', variant: 'neutral' },
};

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ChangeRows({ hostId, run }: { hostId: string; run: RunView }) {
  return (
    <List hasDividers={run.changes.length > 1} aria-label="Changes in this run">
      {run.changes.map((change) => {
        const look = CHANGE_LOOK[change.state];
        return (
          <ListItem
            key={change.change}
            label={
              <HStack gap={2} vAlign="center">
                <Link href={`/h/${hostId}/changes/${change.change}`}>{change.change}</Link>
                {change.attempts > 0 ? (
                  <Text type="supporting" color="secondary" hasTabularNumbers>
                    {`${change.attempts} failed ${change.attempts === 1 ? 'attempt' : 'attempts'}`}
                  </Text>
                ) : null}
              </HStack>
            }
            description={
              change.reason === null && change.notForMerge !== true ? undefined : (
                <Text type="supporting" color="secondary">
                  {change.notForMerge === true
                    ? "Its branch edits planning files, so the PR stays a draft and isn't offered for merge."
                    : change.reason}
                </Text>
              )
            }
            endContent={
              <HStack gap={2} vAlign="center">
                {change.prUrl !== null ? <Link href={change.prUrl}>Pull request</Link> : null}
                {change.previewUrl !== null ? <Link href={change.previewUrl}>Preview</Link> : null}
                {change.notForMerge === true ? (
                  <Badge variant="warning" label="Not for merge" />
                ) : null}
                {/* Over the test budget: a mark on the row, never a failure (gates: Test budget). */}
                {change.overBudget === true &&
                change.testShare !== undefined &&
                change.testShare !== null ? (
                  <Badge variant="warning" label={overBudgetText(change.testShare)} />
                ) : null}
                <Badge variant={look.variant} label={look.label} />
              </HStack>
            }
          />
        );
      })}
    </List>
  );
}

function InFlight({ hostId, run }: { hostId: string; run: RunView }) {
  const toast = useToast();
  const client = useQueryClient();
  const [stopping, setStopping] = useState(false);
  const holding = run.hold !== null && run.state === 'running';
  const title =
    run.state === 'stopping'
      ? 'Stopping at the next clean point.'
      : holding
        ? 'Holding. You can still walk away.'
        : 'You can walk away.';
  const sub = holding
    ? `Usage limit: it resumes on its own at ${clock(run.hold?.until ?? Date.now())} and nothing is lost.`
    : run.now !== null
      ? activityText(run.now)
      : 'Starting.';

  const stop = async () => {
    setStopping(true);
    try {
      const answer = await stopRun(hostId);
      toast({
        body: answer.ok
          ? 'The run stops at its next clean point: the current session finishes its task first.'
          : errorText(answer.body, "The run couldn't be stopped."),
      });
      await client.invalidateQueries({ queryKey: queryKeys.run(hostId) });
    } finally {
      setStopping(false);
    }
  };

  return (
    <VStack gap={4}>
      <HStack gap={4} vAlign="start" wrap="wrap">
        <VStack gap={2} style={{ flex: '1 1 320px', minWidth: 0 }} aria-live="polite">
          <HStack gap={2}>
            <Badge
              variant={holding ? 'neutral' : 'purple'}
              label={run.state === 'stopping' ? 'Stopping' : holding ? 'Holding' : 'In flight'}
            />
          </HStack>
          <Heading level={3} type="display-3">
            {title}
          </Heading>
          <Text color="secondary">{sub}</Text>
          <Text type="supporting" color="secondary" hasTabularNumbers>
            {[
              `${run.settings.model}`,
              run.settings.effort === undefined
                ? null
                : `${effortLabel(run.settings.effort).toLowerCase()} effort`,
              run.budgetLabel ?? `${run.settings.budgetPercent}% of the context window per session`,
              run.stopAt === null ? 'no stop time' : `stops by ${clock(run.stopAt)}`,
            ]
              .filter((part) => part !== null)
              .join(' · ')}
          </Text>
        </VStack>
        <Button
          label="Stop"
          variant="secondary"
          isLoading={stopping}
          isDisabled={run.state === 'stopping'}
          onClick={() => void stop()}
        />
      </HStack>
      <ChangeRows hostId={hostId} run={run} />
    </VStack>
  );
}

function LastRun({ hostId, run }: { hostId: string; run: RunView }) {
  const green = run.changes.filter((c) => c.state === 'green').length;
  const parked = run.changes.filter((c) => c.state === 'parked').length;
  const counts = [
    `${green} green`,
    parked > 0 ? `${parked} parked` : null,
    run.changes.length - green - parked > 0
      ? `${run.changes.length - green - parked} not built`
      : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
  const ended =
    run.endedAt === null ? null : (
      <Timestamp value={new Date(run.endedAt).toISOString()} hasTooltip />
    );
  if (run.endReason === 'error' || run.endReason === 'refused') {
    return (
      <Banner
        status="error"
        title="The last run stopped. It needs you."
        description={
          <>
            {run.endDetail ?? 'It stopped on an error.'} Nothing is lost: each change's branch keeps
            its work. <Link href={`/h/${hostId}/needs-you`}>Open Needs You</Link> ·{' '}
            <Link href={`/h/${hostId}/runs/${run.id}`}>Read the run report</Link>
          </>
        }
      />
    );
  }
  const reason =
    run.endReason === 'stop-time'
      ? 'reached its stop time'
      : run.endReason === 'stopped'
        ? 'was stopped'
        : 'finished';
  return (
    <VStack gap={2}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Text type="supporting" color="secondary" hasTabularNumbers>
          Last run {reason} {ended}: {counts}.
        </Text>
        <Link href={`/h/${hostId}/runs/${run.id}`}>Read the run report</Link>
      </HStack>
      {parked > 0 ? (
        <Banner
          status="warning"
          title={parked === 1 ? '1 change parked' : `${parked} changes parked`}
          description={
            <Link href={`/h/${hostId}/needs-you`}>See the failing gates in Needs You</Link>
          }
        />
      ) : null}
      <ChangeRows hostId={hostId} run={run} />
    </VStack>
  );
}

function Launch({ hostId, answer }: { hostId: string; answer: RunAnswer }) {
  const toast = useToast();
  const client = useQueryClient();
  const ids = answer.runway.map((entry) => entry.changeId);
  const [chosen, setChosen] = useState<string[]>(ids);
  const [stopAt, setStopAt] = useState<string | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const settings = useQuery(settingsQuery(hostId)).data?.settings;
  const budgetAnswer = useQuery({
    ...budgetQuery(hostId, settings?.model ?? '', settings?.budgetPercent ?? 0),
    enabled: settings !== undefined,
  });
  const idsKey = ids.join(',');

  // A change that joins or leaves the runway joins or leaves the choice.
  useEffect(() => {
    setChosen(idsKey === '' ? [] : idsKey.split(','));
  }, [idsKey]);

  if (answer.runway.length === 0) {
    return (
      <Text color="secondary">
        Nothing on the runway to build. Approve a ready change and it shows up here.
      </Text>
    );
  }

  const start = async () => {
    setStarting(true);
    setRefusal(null);
    try {
      const result = await startRun(hostId, {
        changes: chosen.length === ids.length ? null : chosen,
        stopAt: stopAt === undefined ? null : nextOccurrence(stopAt),
      });
      if (!result.ok) {
        setRefusal(errorText(result.body, "The run didn't start."));
        return;
      }
      toast({ body: 'Run started. You can walk away.' });
      await client.invalidateQueries({ queryKey: queryKeys.run(hostId) });
    } finally {
      setStarting(false);
    }
  };

  const settingsText =
    settings === undefined
      ? 'Loading the settings…'
      : [
          settings.model,
          `${effortLabel(settings.effort).toLowerCase()} effort`,
          `${budgetAnswer.data?.label ?? `${settings.budgetPercent}% of the context window`} per session`,
        ].join(' · ');

  return (
    <VStack gap={4}>
      {refusal !== null ? (
        <Banner status="error" title="The run didn't start" description={refusal} />
      ) : null}
      <CheckboxList
        label="Changes to build"
        description="In build order: changes another one depends on go first."
        value={chosen}
        onChange={setChosen}
      >
        {answer.runway.map((entry) => (
          <CheckboxListItem
            key={entry.changeId}
            value={entry.changeId}
            label={entry.title ?? entry.changeId}
            description={`${entry.changeId} · ${entry.taskCount} ${entry.taskCount === 1 ? 'task' : 'tasks'}`}
          />
        ))}
      </CheckboxList>
      <HStack gap={4} wrap="wrap" vAlign="end">
        <TimeInput
          label="Stop by"
          description="No new session starts after it. Leave empty to build everything."
          value={stopAt as never}
          onChange={(value) => setStopAt(value ?? undefined)}
          hasClear
        />
      </HStack>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {settingsText}
        </Text>
        <Link href={`/h/${hostId}/settings`}>Change in Settings</Link>
      </HStack>
      <HStack gap={3} vAlign="center">
        <Button
          label="Start the run"
          variant="primary"
          isLoading={starting}
          isDisabled={chosen.length === 0}
          onClick={() => void start()}
        />
        {chosen.length === 0 ? (
          <Text type="supporting" color="secondary">
            Pick at least one change.
          </Text>
        ) : null}
      </HStack>
    </VStack>
  );
}

export function RunCard({ hostId }: { hostId: string }) {
  const query = useQuery(runQuery(hostId));
  const answer = query.data?.hostId === hostId ? query.data : undefined;
  const run = answer?.run ?? null;
  const live = run !== null && run.state !== 'ended';

  let body: ReactNode;
  if (answer === undefined) {
    body = query.isError ? null : (
      <VStack gap={2} aria-busy="true" aria-label="Loading the run">
        <Skeleton width="60%" height={28} />
        <Skeleton width="100%" height={44} />
      </VStack>
    );
  } else if (live && run !== null) {
    body = <InFlight hostId={hostId} run={run} />;
  } else {
    body = (
      <VStack gap={5}>
        {run !== null ? <LastRun hostId={hostId} run={run} /> : null}
        <Launch hostId={hostId} answer={answer} />
      </VStack>
    );
  }

  return (
    <Card padding={5} elevation="none" aria-label="Run">
      <VStack gap={3}>
        <HStack gap={2} vAlign="center">
          <Text type="label" weight="semibold">
            Run
          </Text>
          {answer?.claudeVersion != null ? (
            <Text type="supporting" color="secondary">
              {`claude ${answer.claudeVersion.split(' ')[0] ?? ''}`}
            </Text>
          ) : null}
        </HStack>
        {query.isError ? (
          <Banner
            status="error"
            title="Couldn't load the run"
            description="Counterpoint's daemon didn't answer."
            endContent={
              <Button
                label="Try loading the run again"
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

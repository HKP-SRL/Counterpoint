// Settings (`/h/{hostId}/settings`, build-runs: Run settings page): the project's run settings,
// every builder session of a run uses them. The model, effort and context budget (shown as tokens
// once the model's window is known), then the limits per session. Save is a guarded POST; until
// the owner saves, the defaults apply. A run going keeps the settings it started with, so the page
// says so while one runs. Other open consoles refetch on the `settings` event.
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { useToast } from '@astryxdesign/core/Toast';
import { VStack } from '@astryxdesign/core/VStack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { queryKeys } from '../api';
import {
  budgetQuery,
  effortLabel,
  errorText,
  type HostSettings,
  runQuery,
  type SettingsAnswer,
  saveSettings,
  settingsQuery,
} from '../run';

const MODELS = [
  { value: 'fable', label: 'Fable' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
];
const budgetOption = (n: number) => ({ value: String(n), label: `${n}% of the context window` });
const BUDGETS = [20, 30, 40, 50, 60, 70].map(budgetOption);

function sameSettings(a: HostSettings, b: HostSettings): boolean {
  return (
    a.model === b.model &&
    a.effort === b.effort &&
    a.budgetPercent === b.budgetPercent &&
    a.maxTurns === b.maxTurns &&
    a.maxBudgetUsd === b.maxBudgetUsd &&
    a.sessionsPerAttempt === b.sessionsPerAttempt
  );
}

type Option = { value: string; label: string };

/** Adds the current value when a list does not offer it (e.g. a model id saved elsewhere). */
function withCurrent(options: Option[], current: Option): Option[] {
  return options.some((option) => option.value === current.value) ? options : [...options, current];
}

function SettingsForm({ hostId, answer }: { hostId: string; answer: SettingsAnswer }) {
  const toast = useToast();
  const client = useQueryClient();
  const [draft, setDraft] = useState<HostSettings>(answer.settings);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const budget = useQuery(budgetQuery(hostId, draft.model, draft.budgetPercent));
  const run = useQuery(runQuery(hostId)).data?.run ?? null;
  const running = run !== null && run.state !== 'ended';
  const dirty = !sameSettings(draft, answer.settings);

  // Saved elsewhere (another console, or this one after Save): show it unless mid-edit.
  const savedKey = JSON.stringify(answer.settings);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync only when the saved value changes
  useEffect(() => {
    setDraft((current) => (sameSettings(current, answer.settings) ? current : answer.settings));
  }, [savedKey]);

  const set = <K extends keyof HostSettings>(key: K, value: HostSettings[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true);
    setRefusal(null);
    try {
      const result = await saveSettings(hostId, draft);
      if (!result.ok) {
        setRefusal(errorText(result.body, "The settings weren't saved."));
        return;
      }
      toast({
        body: running
          ? 'Saved. The run going keeps its settings; the next run uses these.'
          : 'Saved. The next run uses these settings.',
      });
      await client.invalidateQueries({ queryKey: queryKeys.settings(hostId) });
    } finally {
      setSaving(false);
    }
  };

  const budgetText =
    budget.data?.label ??
    `${draft.budgetPercent}% of the context window (shown in tokens once ${draft.model}'s window is known)`;

  return (
    <VStack gap={6}>
      {refusal !== null ? (
        <Banner status="error" title="The settings weren't saved" description={refusal} />
      ) : null}
      {running ? (
        <Banner
          status="info"
          title="A run is going"
          description="It keeps the settings it started with. What you save here applies to the next run."
        />
      ) : null}
      <Card padding={5} elevation="none" aria-label="Builder">
        <VStack gap={4}>
          <Text type="label" weight="semibold">
            Builder
          </Text>
          <HStack gap={4} wrap="wrap" vAlign="end">
            <Selector
              label="Model"
              options={withCurrent(MODELS, { value: draft.model, label: draft.model })}
              value={draft.model}
              onChange={(value) => set('model', value)}
            />
            <Selector
              label="Effort"
              options={withCurrent(
                answer.effortLevels.map((level) => ({ value: level, label: effortLabel(level) })),
                { value: draft.effort, label: effortLabel(draft.effort) },
              )}
              value={draft.effort}
              onChange={(value) => set('effort', value)}
            />
            <Selector
              label="Context budget"
              options={withCurrent(BUDGETS, budgetOption(draft.budgetPercent))}
              value={String(draft.budgetPercent)}
              onChange={(value) => set('budgetPercent', Number(value))}
            />
          </HStack>
          <Text type="supporting" color="secondary" hasTabularNumbers>
            {`Budget: ${budgetText}. At the budget a session finishes its task, writes a handoff and a fresh one continues.`}
          </Text>
        </VStack>
      </Card>
      <Card padding={5} elevation="none" aria-label="Limits per session">
        <VStack gap={4}>
          <Text type="label" weight="semibold">
            Limits per session
          </Text>
          <HStack gap={4} wrap="wrap" vAlign="start">
            <NumberInput
              label="Turns"
              description="A session stops after this many turns."
              value={draft.maxTurns}
              min={10}
              max={2000}
              isIntegerOnly
              onChange={(value) => set('maxTurns', value)}
            />
            <NumberInput
              label="Estimated cost"
              description="A session stops when its estimated cost reaches this."
              units="USD"
              value={draft.maxBudgetUsd}
              min={1}
              max={500}
              isIntegerOnly
              onChange={(value) => set('maxBudgetUsd', value)}
            />
            <NumberInput
              label="Sessions per attempt"
              description="After this many sessions with build tasks still open, the change parks."
              value={draft.sessionsPerAttempt}
              min={1}
              max={20}
              isIntegerOnly
              onChange={(value) => set('sessionsPerAttempt', value)}
            />
          </HStack>
        </VStack>
      </Card>
      <HStack gap={3} vAlign="center" wrap="wrap">
        <Button
          label="Save"
          variant="primary"
          isLoading={saving}
          isDisabled={!dirty}
          onClick={() => void save()}
        />
        <Button
          label="Use the defaults"
          variant="secondary"
          isDisabled={sameSettings(draft, answer.defaults)}
          onClick={() => setDraft(answer.defaults)}
        />
        <Text type="supporting" color="secondary">
          {dirty
            ? 'Not saved yet.'
            : answer.saved
              ? 'Saved. The next run uses these.'
              : 'The defaults apply until you save.'}
        </Text>
      </HStack>
    </VStack>
  );
}

export function SettingsPage({ hostId }: { hostId: string }) {
  const query = useQuery(settingsQuery(hostId));
  const answer = query.data?.hostId === hostId ? query.data : undefined;

  useEffect(() => {
    document.title = 'Settings · Counterpoint';
  }, []);

  let body: ReactNode = null;
  if (answer !== undefined) {
    body = <SettingsForm hostId={hostId} answer={answer} />;
  } else if (query.isError) {
    body = (
      <Banner
        status="error"
        title="Couldn't load the settings"
        description="Counterpoint's daemon didn't answer."
        endContent={
          <Button
            label="Try loading the settings again"
            variant="secondary"
            isLoading={query.isFetching}
            onClick={() => void query.refetch()}
          />
        }
      />
    );
  } else {
    body = (
      <VStack gap={2} aria-busy="true" aria-label="Loading the settings">
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
              Settings
            </Heading>
            <Text color="secondary">How builders work on this project's runs.</Text>
          </VStack>
        </LayoutHeader>
      }
      content={<LayoutContent>{body}</LayoutContent>}
    />
  );
}

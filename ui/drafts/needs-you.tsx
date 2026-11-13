// A hi-fi draft entry (design-drafts 1.1, docs/drafts.md): the Needs You card list, drawn with the
// console's own Astryx components and sample data, the way NeedsYouPage lays its cards out.
// Render it with `node scripts/render-draft.ts ui/drafts/needs-you.tsx <out>`.
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Kbd } from '@astryxdesign/core/Kbd';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

export const title = 'Needs You';

interface SampleCard {
  id: string;
  badge: { label: string; variant: 'warning' | 'error' | 'info' } | null;
  change: string | null;
  from: string;
  question: string;
  why: string;
  options: { label: string; consequence: string }[];
  recommended: number;
}

const CARDS: SampleCard[] = [
  {
    id: 'parked',
    badge: { label: 'Parked', variant: 'warning' },
    change: 'quiet-console',
    from: 'run 2026-11-13',
    question: 'The unit gate failed twice on quiet-console. Retry with the failure as a note?',
    why: 'FAIL tests/server/needs-you.test.ts › groups cards by change (expected 3, got 2).',
    options: [
      {
        label: 'Retry with the failure',
        consequence: 'The next run builds it with the failing test as a note.',
      },
      { label: 'Re-plan it', consequence: 'It stays parked until its plan changes.' },
      { label: 'Leave it parked', consequence: 'Nothing builds it until you retry.' },
    ],
    recommended: 0,
  },
  {
    id: 'owner-step',
    badge: null,
    change: 'design-drafts',
    from: 'owner step',
    question: "Add the drafts section to Counterpoint's .counterpoint/config.yaml",
    why: 'A step of design-drafts only you can sign off.',
    options: [
      { label: 'Done', consequence: 'Counterpoint ticks it in a small PR and merges it.' },
      {
        label: 'Do it for me',
        consequence: 'Counterpoint does it in its own worktree and shows you the result first.',
      },
    ],
    recommended: 0,
  },
  {
    id: 'restart',
    badge: { label: 'Note', variant: 'info' },
    change: null,
    from: 'This Mac',
    question: 'A new Counterpoint is installed. Restart into it?',
    why: 'Counterpoint 0.1.0 is running; the installed copy is newer.',
    options: [
      { label: 'After the run', consequence: 'It restarts once the run ends.' },
      { label: 'Now', consequence: 'The run stops at its next clean point first.' },
    ],
    recommended: 0,
  },
];

function CardBlock({ card, focused }: { card: SampleCard; focused: boolean }) {
  return (
    <div data-cp-id={`card-${card.id}`}>
      <Card padding={4} elevation="none" variant={focused ? 'muted' : 'default'}>
        <VStack gap={3}>
          <VStack gap={1} hAlign="start">
            <HStack gap={2} vAlign="center">
              {card.badge === null ? null : (
                <Badge variant={card.badge.variant} label={card.badge.label} />
              )}
              <Text type="supporting" color="secondary">
                {card.change === null ? card.from : <Link href="#">{card.change}</Link>}
              </Text>
            </HStack>
            <div data-cp-id={`question-${card.id}`} style={{ display: 'contents' }}>
              <Text weight="semibold">{card.question}</Text>
            </div>
            <Text type="supporting" color="secondary">
              {card.why}
            </Text>
          </VStack>
          <div data-cp-id={`options-${card.id}`} style={{ display: 'contents' }}>
            <VStack gap={2}>
              {card.options.map((option, index) => (
                <HStack key={option.label} gap={2} vAlign="center">
                  <Button
                    label={option.label}
                    size="sm"
                    variant={index === card.recommended ? 'secondary' : 'ghost'}
                    endContent={
                      focused ? (
                        <Kbd keys={index === card.recommended ? 'Enter' : String(index + 1)} />
                      ) : undefined
                    }
                  />
                  <Text type="supporting" color="secondary">
                    {option.consequence}
                  </Text>
                </HStack>
              ))}
            </VStack>
          </div>
          <HStack gap={2} vAlign="center">
            <Button
              label="Later"
              size="sm"
              variant="ghost"
              endContent={focused ? <Kbd keys="L" /> : undefined}
            />
            <Button
              label="Add a note"
              size="sm"
              variant="ghost"
              endContent={focused ? <Kbd keys="N" /> : undefined}
            />
          </HStack>
        </VStack>
      </Card>
    </div>
  );
}

export default function NeedsYouDraft() {
  return (
    <Layout
      header={
        <LayoutHeader>
          <div data-cp-id="header">
            <Heading level={2} accessibilityLevel={1}>
              Needs You
            </Heading>
          </div>
        </LayoutHeader>
      }
      content={
        <LayoutContent>
          <div data-cp-id="cards">
            <VStack gap={3}>
              {CARDS.map((card, index) => (
                <CardBlock key={card.id} card={card} focused={index === 0} />
              ))}
            </VStack>
          </div>
        </LayoutContent>
      }
    />
  );
}

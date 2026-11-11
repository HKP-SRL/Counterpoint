// Owner steps (host-planning "Change detail"): the unchecked tasks whose text starts with
// `Owner:`, steps only the owner can do by hand. Shown prominently on the change detail page and
// in the approval dialog; they never block approval. The text comes from the host's tasks.md
// (untrusted) and renders as React text only.
import { Banner } from '@astryxdesign/core/Banner';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

/** Unchecked `Owner:` tasks: steps only the owner can do, shared with the approval dialog. */
export function OwnerStepsBanner({ steps }: { steps: readonly string[] }) {
  return (
    <Banner
      status="warning"
      title={
        steps.length === 1 ? 'One step only you can do' : `${steps.length} steps only you can do`
      }
      description={
        <VStack as="ul" gap={1}>
          {/* The server sends each step once, so the text is a unique key. */}
          {steps.map((step) => (
            <li key={step}>
              <Text>{step}</Text>
            </li>
          ))}
        </VStack>
      }
    />
  );
}

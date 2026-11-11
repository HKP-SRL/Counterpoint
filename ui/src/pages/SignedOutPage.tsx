// Signed-out and blocked screens (`/signed-out`, fixed console copy). Rendered without
// AppShell, centered on the body background. The `reason` query value only selects one of three
// fixed variants and is never rendered; a missing or unknown reason is "not signed in".
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { VStack } from '@astryxdesign/core/VStack';
import { useEffect } from 'react';

interface Variant {
  title: string;
  description: string;
}

const NOT_SIGNED_IN: Variant = {
  title: "This browser isn't signed in",
  description: 'Run "counterpoint open" in a terminal to get a fresh sign-in link.',
};

const USED_LINK: Variant = {
  title: 'This sign-in link was already used',
  description: 'Sign-in links work once. Run "counterpoint open" for a new one.',
};

const BLOCKED: Variant = {
  title: 'Request blocked',
  description:
    'Counterpoint only accepts requests from its own console at 127.0.0.1. Open the console from the link "counterpoint open" prints.',
};

export function signedOutVariant(reason: string | undefined): Variant {
  if (reason === 'used') return USED_LINK;
  if (reason === 'blocked') return BLOCKED;
  return NOT_SIGNED_IN;
}

export function SignedOutPage({ reason }: { reason: string | undefined }) {
  const variant = signedOutVariant(reason);

  useEffect(() => {
    document.title = `${variant.title} · Counterpoint`;
  }, [variant.title]);

  return (
    <VStack as="main" hAlign="center" vAlign="center" minHeight="100dvh" padding={6}>
      <EmptyState
        headingLevel={1}
        title={variant.title}
        description={variant.description}
        actions={
          <CodeBlock code="counterpoint open" language="bash" hasCopyButton isWrapped={false} />
        }
      />
    </VStack>
  );
}

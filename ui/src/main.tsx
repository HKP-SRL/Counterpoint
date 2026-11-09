import './styles.css';
import { AppShell } from '@astryxdesign/core/AppShell';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { TopNav } from '@astryxdesign/core/TopNav';
import { Theme } from '@astryxdesign/core/theme';
import { VStack } from '@astryxdesign/core/VStack';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

interface HostSummary {
  id: string;
  name: string;
  root: string;
  baseBranch: string;
}

type HostsState =
  | { status: 'loading' }
  | { status: 'ready'; hosts: HostSummary[] }
  | { status: 'error' };

function isHostSummary(value: unknown): value is HostSummary {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.name === 'string' && typeof v.root === 'string';
}

function useHosts(): HostsState {
  const [state, setState] = useState<HostsState>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/hosts', { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as { hosts?: unknown };
        const hosts = Array.isArray(body.hosts) ? body.hosts.filter(isHostSummary) : [];
        setState({ status: 'ready', hosts });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      });
    return () => controller.abort();
  }, []);
  return state;
}

function Hosts() {
  const state = useHosts();
  if (state.status === 'loading') return <Text color="secondary">Loading repositories…</Text>;
  if (state.status === 'error') {
    return (
      <Text color="secondary">
        Couldn't load repositories. Counterpoint's daemon didn't answer.
      </Text>
    );
  }
  if (state.hosts.length === 0) {
    return (
      <Text color="secondary">
        No repositories yet. Run counterpoint inside a git repository to add it.
      </Text>
    );
  }
  return (
    <VStack gap={2}>
      {state.hosts.map((host) => (
        <Text key={host.id} weight="semibold">
          {host.name}
        </Text>
      ))}
    </VStack>
  );
}

function App() {
  return (
    <Theme theme={neutralTheme} mode="system">
      <AppShell height="fill" topNav={<TopNav label="Counterpoint" heading="Counterpoint" />}>
        <VStack gap={4}>
          <Heading level={1}>Repositories</Heading>
          <Hosts />
        </VStack>
      </AppShell>
    </Theme>
  );
}

const rootElement = document.getElementById('root');
if (rootElement === null) throw new Error('The console page has no #root element.');
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

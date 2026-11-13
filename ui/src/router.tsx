// Console routes (local-console: Host-scoped navigation), code-based TanStack Router:
//   /                → the last-used host (localStorage `counterpoint.lastHost`) or the first one
//   /h/$hostId       → AppFrame (AppShell chrome) around the host's pages; Mission is its index
//   /h/$hostId/changes[/$changeId] → Changes and Change detail
//   /h/$hostId/needs-you → Needs You
//   /h/$hostId/trust → the Mission page (an old link: the Trust page is gone)
//   /h/$hostId/settings → Settings (the project's run settings)
//   /h/$hostId/preview/$changeId → a green change's local preview, started on demand
//   /h/$hostId/runs/$runId → a run's report
//   /signed-out      → signed-out, used-link and blocked screens, without AppShell
// Host ids from the address bar are checked against the slug rule and against GET /api/hosts
// before use; an unknown id goes back to `/`.
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { VStack } from '@astryxdesign/core/VStack';
import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useRouter,
} from '@tanstack/react-router';
import { type ComponentProps, type MouseEvent, useEffect } from 'react';
import { hostsQuery } from './api';
import { HOST_ID_RE, isChangeId } from './ids';
import { ChangeDetailPage } from './pages/ChangeDetailPage';
import { ChangesPage } from './pages/ChangesPage';
import { MissionPage } from './pages/MissionPage';
import { NeedsYouPage } from './pages/NeedsYouPage';
import { PreviewPage } from './pages/PreviewPage';
import { RunReportPage } from './pages/RunReportPage';
import { SettingsPage } from './pages/SettingsPage';
import { SignedOutPage } from './pages/SignedOutPage';
import { AppFrame } from './shell/AppFrame';

export const LAST_HOST_KEY = 'counterpoint.lastHost';

function readLastHost(): string | null {
  try {
    const value = window.localStorage.getItem(LAST_HOST_KEY);
    return value !== null && HOST_ID_RE.test(value) ? value : null;
  } catch {
    return null;
  }
}

function writeLastHost(hostId: string): void {
  try {
    window.localStorage.setItem(LAST_HOST_KEY, hostId);
  } catch {
    // Storage unavailable: `/` falls back to the first host.
  }
}

export interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
});

function NoProjects() {
  useEffect(() => {
    document.title = 'Counterpoint';
  }, []);
  return (
    <VStack hAlign="center" vAlign="center" minHeight="100dvh" padding={6}>
      <EmptyState
        headingLevel={1}
        title="No projects yet"
        description={'Run "counterpoint" inside a project to add it.'}
      />
    </VStack>
  );
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  loader: async ({ context }) => {
    const hosts = await context.queryClient.ensureQueryData(hostsQuery);
    const last = readLastHost();
    const target = hosts.find((host) => host.id === last) ?? hosts[0];
    if (target !== undefined) {
      throw redirect({ to: '/h/$hostId', params: { hostId: target.id }, replace: true });
    }
    return null;
  },
  component: NoProjects,
});

const hostRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/h/$hostId',
  beforeLoad: ({ params }) => {
    if (!HOST_ID_RE.test(params.hostId)) throw redirect({ to: '/', replace: true });
  },
  loader: async ({ context, params }) => {
    const hosts = await context.queryClient.ensureQueryData(hostsQuery);
    if (!hosts.some((host) => host.id === params.hostId)) {
      throw redirect({ to: '/', replace: true });
    }
    writeLastHost(params.hostId);
    return null;
  },
  component: HostLayout,
});

function HostLayout() {
  const { hostId } = hostRoute.useParams();
  return (
    <AppFrame hostId={hostId}>
      <Outlet />
    </AppFrame>
  );
}

const missionRoute = createRoute({
  getParentRoute: () => hostRoute,
  path: '/',
  component: MissionRoute,
});

function MissionRoute() {
  const { hostId } = hostRoute.useParams();
  return <MissionPage hostId={hostId} />;
}

const changesRoute = createRoute({
  getParentRoute: () => hostRoute,
  path: '/changes',
  component: ChangesRoute,
});

function ChangesRoute() {
  const { hostId } = hostRoute.useParams();
  return <ChangesPage hostId={hostId} />;
}

const changeRoute = createRoute({
  getParentRoute: () => hostRoute,
  path: '/changes/$changeId',
  beforeLoad: ({ params }) => {
    if (!isChangeId(params.changeId)) {
      throw redirect({
        to: '/h/$hostId/changes',
        params: { hostId: params.hostId },
        replace: true,
      });
    }
  },
  component: ChangeRoute,
});

function ChangeRoute() {
  const { hostId, changeId } = changeRoute.useParams();
  return <ChangeDetailPage key={`${hostId}/${changeId}`} hostId={hostId} changeId={changeId} />;
}

const needsYouRoute = createRoute({
  getParentRoute: () => hostRoute,
  path: '/needs-you',
  component: NeedsYouRoute,
});

function NeedsYouRoute() {
  const { hostId } = hostRoute.useParams();
  return <NeedsYouPage hostId={hostId} />;
}

// The Trust page is gone (run-as-owner): an old link lands on Mission.
const trustRoute = createRoute({
  getParentRoute: () => hostRoute,
  path: '/trust',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/h/$hostId', params: { hostId: params.hostId }, replace: true });
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => hostRoute,
  path: '/settings',
  component: SettingsRoute,
});

function SettingsRoute() {
  const { hostId } = hostRoute.useParams();
  return <SettingsPage key={hostId} hostId={hostId} />;
}

const previewRoute = createRoute({
  getParentRoute: () => hostRoute,
  path: '/preview/$changeId',
  beforeLoad: ({ params }) => {
    if (!isChangeId(params.changeId)) {
      throw redirect({ to: '/h/$hostId', params: { hostId: params.hostId }, replace: true });
    }
  },
  component: PreviewRoute,
});

function PreviewRoute() {
  const { hostId, changeId } = previewRoute.useParams();
  return <PreviewPage key={`${hostId}/${changeId}`} hostId={hostId} changeId={changeId} />;
}

const runReportRoute = createRoute({
  getParentRoute: () => hostRoute,
  path: '/runs/$runId',
  beforeLoad: ({ params }) => {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(params.runId)) {
      throw redirect({ to: '/h/$hostId', params: { hostId: params.hostId }, replace: true });
    }
  },
  component: RunReportRoute,
});

function RunReportRoute() {
  const { hostId, runId } = runReportRoute.useParams();
  return <RunReportPage key={`${hostId}/${runId}`} hostId={hostId} runId={runId} />;
}

const signedOutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signed-out',
  // The reason only picks one of three fixed copy variants; it is never rendered.
  validateSearch: (search: Record<string, unknown>): { reason?: string } =>
    typeof search.reason === 'string' ? { reason: search.reason } : {},
  component: SignedOutRoute,
});

function SignedOutRoute() {
  const { reason } = signedOutRoute.useSearch();
  return <SignedOutPage reason={reason} />;
}

const routeTree = rootRoute.addChildren([
  indexRoute,
  hostRoute.addChildren([
    missionRoute,
    changesRoute,
    changeRoute,
    needsYouRoute,
    trustRoute,
    settingsRoute,
    previewRoute,
    runReportRoute,
  ]),
  signedOutRoute,
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, scrollRestoration: true });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

/**
 * The link component Astryx renders for every `href` (via LinkProvider): a plain anchor whose
 * same-origin, unmodified left clicks go through the router instead of a full page load.
 */
export function RouterLink({ href, onClick, target, ref, ...rest }: ComponentProps<'a'>) {
  const router = useRouter();
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || href === undefined) return;
    if (!href.startsWith('/') || href.startsWith('//')) return;
    if (target !== undefined && target !== '_self') return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    void router.navigate({ href });
  };
  return <a ref={ref} href={href} target={target} onClick={handleClick} {...rest} />;
}

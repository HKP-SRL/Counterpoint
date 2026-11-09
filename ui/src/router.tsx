// Console routes (UI-SPEC "Screens and Layout"), code-based TanStack Router:
//   /                → the last-used host (localStorage `counterpoint.lastHost`) or the first one
//   /h/$hostId       → AppFrame (AppShell chrome) around the host's pages; Mission is its index
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
import { MissionPage } from './pages/MissionPage';
import { SignedOutPage } from './pages/SignedOutPage';
import { AppFrame } from './shell/AppFrame';

/** Host ids: lowercase slug, 1-32 characters, never starting with a dash (src/core/ids.ts). */
const HOST_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

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
  hostRoute.addChildren([missionRoute]),
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

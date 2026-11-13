// The console chrome (local-console: Host-scoped navigation): TopNav with the wordmark, host
// switcher, live-updates dot and theme menu; SideNav `Main`; below the `md` width AppShell moves
// the SideNav into its mobile drawer. Items: Mission, Changes, Needs You (with its count badge),
// Settings. While Needs You has items the tab title reads `({n}) {Page} · Counterpoint`. The frame
// owns the page's one live stream: while it is down the dot pulses warning and the
// `Live updates paused` Banner sits at the top of the content until the stream is back.
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { AppShell } from '@astryxdesign/core/AppShell';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@astryxdesign/core/DropdownMenu';
import { HStack } from '@astryxdesign/core/HStack';
import { useAnnounce } from '@astryxdesign/core/hooks';
import { IconButton } from '@astryxdesign/core/IconButton';
import { SideNav, SideNavItem } from '@astryxdesign/core/SideNav';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { TopNav, TopNavHeading } from '@astryxdesign/core/TopNav';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { VStack } from '@astryxdesign/core/VStack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { type HostSummary, hostsQuery } from '../api';
import { useConnectionState, useLiveEvents } from '../live';
import { useBlockingNotifications } from '../notify';
import { needsYouQuery, needsYouCount as needsYouTotal } from '../pages/NeedsYouPage';
import { stopCounterpoint } from '../run';
import { parseThemePreference, useThemeChoice } from '../theme';

function HostSwitcher({
  hosts,
  current,
}: {
  hosts: HostSummary[];
  current: HostSummary | undefined;
}) {
  const navigate = useNavigate();
  const label =
    current === undefined
      ? 'Choose a project'
      : `Project ${current.name}, base branch ${current.baseBranch}`;
  return (
    <DropdownMenu
      button={{
        label,
        variant: 'ghost',
        children:
          current === undefined ? undefined : (
            <HStack gap={2} vAlign="center" maxWidth={320}>
              <Text weight="semibold" maxLines={1} hasTruncateTooltip>
                {current.name}
              </Text>
              <Text type="supporting" color="secondary" maxLines={1} hasTruncateTooltip>
                {current.baseBranch}
              </Text>
            </HStack>
          ),
      }}
      items={hosts.map((host) => ({
        id: host.id,
        label: host.name,
        description: host.baseBranch,
        onClick: () => {
          void navigate({ to: '/h/$hostId', params: { hostId: host.id } });
        },
      }))}
    />
  );
}

function ThemeMenu() {
  const { preference, choose } = useThemeChoice();
  return (
    <DropdownMenu
      hasChevron={false}
      renderTrigger={(trigger) => (
        <IconButton
          {...trigger}
          label="Theme"
          tooltip="Theme"
          variant="ghost"
          icon={<Text aria-hidden="true">◐</Text>}
        />
      )}
    >
      <DropdownMenuRadioGroup
        label="Theme"
        value={preference}
        onChange={(value) => {
          choose(parseThemePreference(value));
        }}
      >
        <DropdownMenuRadioItem value="light" label="Light" />
        <DropdownMenuRadioItem value="dark" label="Dark" />
        <DropdownMenuRadioItem value="system" label="System" />
      </DropdownMenuRadioGroup>
    </DropdownMenu>
  );
}

/**
 * Stop Counterpoint (daemon-lifecycle: Stop Counterpoint from the console), behind a confirm: a run
 * going first stops at its next clean point and writes its report, then the daemon exits and this
 * console closes. Starting it again is a terminal act (`counterpoint`), like the sign-in link.
 */
function CounterpointMenu({ onStopping }: { onStopping: (withRun: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const stop = async () => {
    setBusy(true);
    try {
      const answer = await stopCounterpoint();
      if (answer.ok) onStopping(answer.body.run === true);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <DropdownMenu
        hasChevron={false}
        renderTrigger={(trigger) => (
          <IconButton
            {...trigger}
            label="Counterpoint"
            tooltip="Counterpoint"
            variant="ghost"
            icon={<Text aria-hidden="true">⏻</Text>}
          />
        )}
      >
        <DropdownMenuItem
          label="Stop Counterpoint…"
          variant="destructive"
          onClick={() => setOpen(true)}
        />
      </DropdownMenu>
      <AlertDialog
        isOpen={open}
        onOpenChange={setOpen}
        title="Stop Counterpoint?"
        description="A run that is going stops at its next clean point first: the current session finishes its task and hands off, and the run report is written. Then Counterpoint stops and this console closes. Start it again in a terminal with counterpoint."
        actionLabel="Stop Counterpoint"
        actionVariant="destructive"
        isActionLoading={busy}
        onAction={() => void stop()}
      />
    </>
  );
}

/** The SideNav count: hidden at 0 or while loading, exact 1-99, `99+` above (full count spoken). */
function NeedsYouCount({ count }: { count: number | null }) {
  if (count === null || count === 0) return null;
  return (
    <>
      <Badge variant="warning" label={count > 99 ? '99+' : String(count)} aria-hidden="true" />
      <VisuallyHidden>{count === 1 ? ', 1 item' : `, ${count} items`}</VisuallyHidden>
    </>
  );
}

const TITLE_COUNT_RE = /^\(\d+\) /;

/**
 * Keeps the browser tab title as `({n}) {Page} · Counterpoint` while Needs You has items. Pages
 * set their own `{Page} · Counterpoint` title; this only adds or removes the count prefix,
 * including after a page changes its title later.
 */
function useTitleCount(count: number | null): void {
  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(TITLE_COUNT_RE, '');
      const next = count !== null && count > 0 ? `(${count}) ${base}` : base;
      if (document.title !== next) document.title = next;
    };
    apply();
    const element = document.querySelector('title');
    let observer: MutationObserver | null = null;
    if (element !== null) {
      observer = new MutationObserver(apply);
      observer.observe(element, { childList: true, characterData: true, subtree: true });
    }
    return () => {
      observer?.disconnect();
      document.title = document.title.replace(TITLE_COUNT_RE, '');
    };
  }, [count]);
}

export function AppFrame({ hostId, children }: { hostId: string; children: ReactNode }) {
  const hosts = useQuery(hostsQuery).data ?? [];
  const current = hosts.find((host) => host.id === hostId);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const missionPath = `/h/${hostId}`;
  const changesPath = `${missionPath}/changes`;
  const onChanges = pathname === changesPath || pathname.startsWith(`${changesPath}/`);
  const needsYouPath = `${missionPath}/needs-you`;
  const onNeedsYou = pathname === needsYouPath || pathname.startsWith(`${needsYouPath}/`);
  const settingsPath = `${missionPath}/settings`;
  const queryClient = useQueryClient();
  useLiveEvents(queryClient);
  const connected = useConnectionState() === 'connected';
  const [stopping, setStopping] = useState<null | { withRun: boolean }>(null);

  // The Needs You count for the badge and the tab title: unknown (hidden) until it arrives.
  const needsYou = useQuery(needsYouQuery(hostId));
  const needsYouCount = needsYou.data?.hostId === hostId ? needsYouTotal(needsYou.data) : null;
  useTitleCount(needsYouCount);
  // A new card that blocks work notifies in the browser once the owner allowed it (D-9).
  useBlockingNotifications(
    hostId,
    needsYou.data?.hostId === hostId ? needsYou.data.cards : undefined,
  );

  // New items are announced politely; the first count and decreases are not.
  const announce = useAnnounce();
  const lastCount = useRef<{ hostId: string; count: number } | null>(null);
  useEffect(() => {
    if (needsYouCount === null) return;
    const previous = lastCount.current;
    lastCount.current = { hostId, count: needsYouCount };
    if (previous !== null && previous.hostId === hostId && needsYouCount > previous.count) {
      announce(
        needsYouCount === 1 ? '1 item needs you' : `${needsYouCount} items need you`,
        'polite',
      );
    }
  }, [needsYouCount, hostId, announce]);

  return (
    <AppShell
      height="fill"
      contentPadding={6}
      topNav={
        <TopNav
          label="Counterpoint"
          heading={<TopNavHeading heading="Counterpoint" />}
          startContent={<HostSwitcher hosts={hosts} current={current} />}
          endContent={
            <HStack gap={2} vAlign="center">
              <StatusDot
                variant={connected ? 'success' : 'warning'}
                isPulsing={!connected}
                label={connected ? 'Live updates connected' : 'Live updates reconnecting'}
              />
              <ThemeMenu />
              <CounterpointMenu onStopping={(withRun) => setStopping({ withRun })} />
            </HStack>
          }
        />
      }
      sideNav={
        <SideNav aria-label="Main">
          <SideNavItem
            label="Mission"
            href={missionPath}
            isSelected={pathname === missionPath || pathname === `${missionPath}/`}
          />
          <SideNavItem label="Changes" href={changesPath} isSelected={onChanges} />
          <SideNavItem
            label="Needs You"
            href={needsYouPath}
            isSelected={onNeedsYou}
            endContent={<NeedsYouCount count={needsYouCount} />}
          />
          <SideNavItem
            label="Settings"
            href={settingsPath}
            isSelected={pathname === settingsPath}
          />
        </SideNav>
      }
    >
      <VStack gap={6}>
        {stopping === null ? null : (
          <Banner
            status="info"
            title="Counterpoint is stopping"
            description={
              stopping.withRun
                ? 'The run stops at its next clean point first, then Counterpoint stops and this console closes. Start it again in a terminal with counterpoint.'
                : 'This console closes in a moment. Start it again in a terminal with counterpoint.'
            }
          />
        )}
        {connected || stopping !== null ? null : (
          <Banner
            status="warning"
            title="Live updates paused"
            description="Reconnecting to Counterpoint. What you see may be out of date."
          />
        )}
        {children}
      </VStack>
    </AppShell>
  );
}

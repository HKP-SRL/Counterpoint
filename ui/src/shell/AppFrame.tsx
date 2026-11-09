// The console chrome (UI-SPEC "AppShell chrome"): TopNav with the wordmark, host switcher,
// live-updates dot and theme menu; SideNav `Main`; below the `md` width AppShell moves the
// SideNav into its mobile drawer. Needs You (01-15) goes between Phases and Trust.
// The frame owns the page's one live stream: while it is down the dot pulses warning and the
// `Live updates paused` Banner sits at the top of the content until the stream is back.
import { AppShell } from '@astryxdesign/core/AppShell';
import { Banner } from '@astryxdesign/core/Banner';
import {
  DropdownMenu,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@astryxdesign/core/DropdownMenu';
import { HStack } from '@astryxdesign/core/HStack';
import { IconButton } from '@astryxdesign/core/IconButton';
import { SideNav, SideNavItem } from '@astryxdesign/core/SideNav';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { TopNav, TopNavHeading } from '@astryxdesign/core/TopNav';
import { VStack } from '@astryxdesign/core/VStack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { type HostSummary, hostsQuery } from '../api';
import { useConnectionState, useLiveEvents } from '../live';
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

export function AppFrame({ hostId, children }: { hostId: string; children: ReactNode }) {
  const hosts = useQuery(hostsQuery).data ?? [];
  const current = hosts.find((host) => host.id === hostId);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const missionPath = `/h/${hostId}`;
  const phasesPath = `${missionPath}/phases`;
  const onPhases = pathname === phasesPath || pathname.startsWith(`${phasesPath}/`);
  const trustPath = `${missionPath}/trust`;
  const queryClient = useQueryClient();
  useLiveEvents(queryClient);
  const connected = useConnectionState() === 'connected';

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
          <SideNavItem label="Phases" href={phasesPath} isSelected={onPhases} />
          <SideNavItem label="Trust" href={trustPath} isSelected={pathname === trustPath} />
        </SideNav>
      }
    >
      <VStack gap={6}>
        {connected ? null : (
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

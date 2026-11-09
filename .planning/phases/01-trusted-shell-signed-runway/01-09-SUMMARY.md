---
phase: 01-trusted-shell-signed-runway
plan: 09
subsystem: ui
tags: [react, astryx, tanstack-router, tanstack-query, sse, eventsource, theme, csp, playwright-core]

# Dependency graph
requires:
  - phase: 01-03
    provides: "GET /login one-time exchange, cp_session cookie, 401 signed-out / 403 blocked JSON, CONSOLE_CSP (script-src 'self'), GET /api/events with Last-Event-ID replay and the ready frame, POST /control/notify"
  - phase: 01-02
    provides: "Vite/React/Astryx console build to dist/ui, GET /api/hosts, the CLI start/stop/open and the e2e harness"
provides:
  - "ui/src/theme.ts: THEME_STORAGE_KEY, THEME_OPTIONS, parseThemePreference, isDark, themeOptionAfter, useThemePreference, ThemePreferenceContext, useThemeChoice"
  - "ui/public/theme-init.js: external first-paint theme script (data-theme before React mounts)"
  - "ui/src/router.tsx: routes /, /h/$hostId (layout, Mission index), /signed-out; createAppRouter(queryClient); RouterLink for Astryx LinkProvider; localStorage counterpoint.lastHost"
  - "ui/src/shell/AppFrame.tsx: AppShell chrome (TopNav Counterpoint, host switcher, live StatusDot, Theme menu; SideNav Main with Mission; Live updates paused Banner)"
  - "ui/src/api.ts: apiGet, apiPost, queryKeys, ApiError, isFinalApiError, goSignedOut, fetchHosts, hostsQuery, HostSummary"
  - "ui/src/live.ts: useLiveEvents, useConnectionState, FAMILY_TO_KEYS, EVENT_FAMILIES, keysForEvent, eventHostId"
  - "ui/src/pages/MissionPage.tsx and ui/src/pages/SignedOutPage.tsx (signedOutVariant)"
  - "tests/e2e/shell.e2e.test.ts: 10 browser checks against the real daemon"
affects: [01-11, 01-13, 01-14, 01-15, 01-16]

actuals:
  tokens: 12250   # chars/4 over the added lines of the plan diff (48,997 chars)
  tasks: 2
  commits: 3      # MEASURED: git rev-list --count 2ef6dac..HEAD before the SUMMARY commit
plan_head_before: 2ef6dac0da7d2eace1c7fcec4f3f64544b0ebe83
plan_head_after: a436190f05bce5e12d74a5143d21858235ca6dc4

tech-stack:
  added: []
  patterns:
    - "Host-scoped query keys live under ['host', hostId, …]; the host list is ['hosts'], so invalidating one family never sweeps another; phase(hostId) without an id is the prefix of every phase"
    - "Server text renders only as React text through Astryx components; no dangerouslySetInnerHTML, no custom StyleX, no hex"
    - "Pages get route params as props from thin route components in router.tsx, so pages and the frame never import the router (no cycles)"
    - "Astryx links route through RouterLink: same-origin, unmodified left clicks call router.navigate({ href })"
    - "Theme: the hook resolves System to light/dark itself and passes the explicit mode to <Theme>, so data-theme always matches what theme-init.js set at first paint"
    - "e2e text locators use exact matches: Astryx EmptyState and useAnnounce mirror copy into polite live regions"

key-files:
  created:
    - ui/public/theme-init.js
    - ui/src/theme.ts
    - ui/src/router.tsx
    - ui/src/shell/AppFrame.tsx
    - ui/src/pages/MissionPage.tsx
    - ui/src/pages/SignedOutPage.tsx
    - ui/src/api.ts
    - ui/src/live.ts
    - ui/tests/theme.test.ts
    - tests/e2e/shell.e2e.test.ts
  modified:
    - ui/index.html
    - ui/src/main.tsx
    - tests/e2e/skeleton.e2e.test.ts

key-decisions:
  - "System mode is resolved in the hook (matchMedia listener only in System) and Theme receives light or dark; theme-init.js sets the same data-theme plus an inline color-scheme, which the hook removes on mount so a later choice is never overridden"
  - "A 401 or 403 leaves via window.location.replace to /signed-out?reason=none|blocked: a full load drops the EventSource and Back does not loop into another 401"
  - "When the EventSource closes for good, one GET /api/hosts decides: 401/403 route to signed-out, anything else reopens the stream with ?lastEventId= after 1-3 s; while the browser is still retrying itself it resends Last-Event-ID"
  - "Connection state starts optimistic (connected) so the nav renders immediately; it turns reconnecting on the first stream error"
  - "The theme IconButton shows a ◐ text glyph: the theme-neutral icon registry has no sun/moon/contrast icon and lucide-react may not be imported directly (UI-SPEC Registry Safety). Accessible name and tooltip are both Theme"
  - "SideNav has no label prop in Astryx 0.7.11; aria-label=\"Main\" is spread after its default label and names the landmark"
  - "QueryClient defaults: staleTime Infinity, no refetch on focus or reconnect, no retry on 4xx; only SSE invalidation refreshes data"

patterns-established:
  - "Later pages mount as children of the /h/$hostId layout route and add SideNavItems in AppFrame"
  - "Later live data adds a query key in api.ts queryKeys and, if a new family appears, a FAMILY_TO_KEYS row"

requirements-completed: [FOUND-02]  # FOUND-06 is also declared by a sibling plan without a SUMMARY yet; requirements.ready-ids reported it blocked, so it stays Pending

coverage:
  - id: D1
    description: "Theme preference logic: only light/dark/system accepted (anything else is system), isDark resolves System against the OS, arrow/Home/End movement through the options"
    requirement: FOUND-06
    verification:
      - kind: unit
        ref: "ui/tests/theme.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Signing in through the printed link lands on /h/{hostId} with the AppShell chrome: TopNav Counterpoint, host switcher showing the host and master, SideNav Main, Mission heading announced as level 1, tab title Mission · Counterpoint; the URL no longer carries the code"
    requirement: FOUND-02
    verification:
      - kind: e2e
        ref: "tests/e2e/shell.e2e.test.ts#signs in through the printed link and shows the AppShell chrome for the host"
        status: pass
    human_judgment: false
  - id: D3
    description: "One EventSource; the dot reports connected; no /api/hosts request in a quiet window (no polling); a host event over /control/notify invalidates the host list, which refetches"
    requirement: FOUND-02
    verification:
      - kind: e2e
        ref: "tests/e2e/shell.e2e.test.ts#reports live updates connected and refetches only when an event arrives"
        status: pass
    human_judgment: false
  - id: D4
    description: "Dark chosen from the Theme menu sets data-theme=dark and localStorage counterpoint.theme, survives a reload, and is applied by /theme-init.js alone when the app bundle is blocked (first paint, CSP-safe)"
    requirement: FOUND-06
    verification:
      - kind: e2e
        ref: "tests/e2e/shell.e2e.test.ts#switches to Dark from the theme menu; the choice persists and applies before first paint"
        status: pass
    human_judgment: false
  - id: D5
    description: "System mode follows prefers-color-scheme live (light → dark → light without reload)"
    requirement: FOUND-06
    verification:
      - kind: e2e
        ref: "tests/e2e/shell.e2e.test.ts#follows the system setting live in System mode"
        status: pass
    human_judgment: false
  - id: D6
    description: "At a 360px viewport the navigation (Mission link and host switcher) is reachable through AppShell's mobile drawer"
    verification:
      - kind: e2e
        ref: "tests/e2e/shell.e2e.test.ts#reaches the navigation through the mobile drawer at 360px"
        status: pass
    human_judgment: false
  - id: D7
    description: "No console message reports a Content Security Policy violation across sign-in, theme switching, reload and the mobile drawer"
    requirement: FOUND-02
    verification:
      - kind: e2e
        ref: "tests/e2e/shell.e2e.test.ts#raises no Content Security Policy violation"
        status: pass
    human_judgment: false
  - id: D8
    description: "Signed-out screens with the exact UI-SPEC copy: a reused link shows This sign-in link was already used (no cookie set); a browser without a session is routed by the 401 to This browser isn't signed in; reason=blocked shows Request blocked; an unknown reason falls back and is never rendered"
    requirement: FOUND-02
    verification:
      - kind: e2e
        ref: "tests/e2e/shell.e2e.test.ts#shows the used-link screen when the same sign-in link is opened again"
        status: pass
      - kind: e2e
        ref: "tests/e2e/shell.e2e.test.ts#sends a browser without a session to the not-signed-in screen"
        status: pass
      - kind: e2e
        ref: "tests/e2e/shell.e2e.test.ts#words the blocked reason from fixed copy and falls back for an unknown one"
        status: pass
    human_judgment: false
  - id: D9
    description: "Stopping the daemon shows the Live updates paused Banner and the dot reads Live updates reconnecting; restarting it on the same port routes the open tab to the signed-out screen (sessions cleared on start)"
    requirement: FOUND-02
    verification:
      - kind: e2e
        ref: "tests/e2e/shell.e2e.test.ts#pauses live updates when the daemon stops, and signs out once it is back"
        status: pass
    human_judgment: false
  - id: D10
    description: "The console looks right in both themes (identical layout, only tokens change), the ◐ theme glyph reads as a theme control, and long host names truncate with a tooltip in the switcher"
    requirement: FOUND-06
    verification: []
    human_judgment: true
    rationale: "No test compares the light and dark renders or judges the glyph; the 01-15 backstop screenshots cover the heavy screens in both modes"

duration: 15min
completed: 2026-11-09
status: complete
---

# Phase 1 Plan 09: Console Shell, Theme and Live Client Summary

**The console now opens into an Astryx AppShell: a TopNav with the Counterpoint wordmark, a host switcher showing the host and its base branch, a live-updates dot and a Light/Dark/System theme menu, plus a `Main` SideNav. An external `/theme-init.js` applies the stored theme before first paint under the strict `script-src 'self'` CSP. TanStack Router serves `/`, `/h/$hostId` and `/signed-out`. The API client sends any 401 to the not-signed-in screen and any 403 to `Request blocked`. One EventSource turns server event families into TanStack Query invalidations, and the paused banner and signed-out handoff appear when the daemon goes away and comes back.**

## Performance

- **Duration:** about 15 min
- **Started:** 2026-11-09T16:56:07Z
- **Completed:** 2026-11-09T17:11:00Z
- **Tasks:** 2 (Task 1 as RED then GREEN)
- **Files:** 10 created, 3 modified

## Accomplishments

- **Shell (E9).** AppShell `height="fill"` `contentPadding={6}`. TopNav `label="Counterpoint"` with the wordmark, the host switcher (ghost DropdownMenu button; host name and the base branch as supporting text, each one line with a truncation tooltip; menu items navigate to `/h/{id}`), the StatusDot (`Live updates connected` / pulsing `Live updates reconnecting`) and the `Theme` IconButton. SideNav `Main` with `Mission` marked selected. Below the `md` width, Astryx's drawer carries the switcher and the nav; the e2e checks this at 360px.
- **Theme (FOUND-06).** Choices are stored in `localStorage` `counterpoint.theme`. The hook reconciles the choice on mount, on `pageshow` and on cross-tab `storage` events, and listens to `prefers-color-scheme` only in System mode. It passes an explicit light or dark mode to `<Theme>`. `/theme-init.js` reads only localStorage, accepts only the three values and swallows every error. The e2e proves first paint by blocking the app bundle and still finding `data-theme="dark"`.
- **Routing.** `/` goes to the last-used host if it is still registered, otherwise to the first host, otherwise to the `No projects yet` EmptyState. `/h/$hostId` is checked against the slug rule and against `GET /api/hosts`; an unknown host goes back to `/`. `/signed-out` renders without AppShell. Mission shows the host folder (code text) and base branch, and the tab title is `Mission · Counterpoint`.
- **API and live clients (FOUND-02, client side).** Requests are same-origin with credentials, and writes are always JSON. A 401 goes to `reason=none` and a 403 to `reason=blocked`. `FAMILY_TO_KEYS` covers `host`, `phase`, `approval`, `runway`, `needs-you` and `doctor`. The `ready` frame and `open` mark the stream connected; errors mark it reconnecting; both changes are announced politely. In the e2e a `host` event from `/control/notify` triggers exactly the host-list refetch, and nothing is fetched during a quiet window.
- **Signed-out screens (E10).** Centered EmptyState with a copyable `counterpoint open` CodeBlock (no wrapping). The `reason` only selects one of three fixed variants and is never rendered.

## Task Commits

1. **Task 1: Theme logic and first-paint script, router, AppShell chrome and the Mission route frame**
   - RED `2df3d10` (test): `theme.ts` stub throws; 9 of 11 fail.
   - GREEN `5eca343` (feat).
2. **Task 2: API and live clients, signed-out screens, live-updates banner, proven in the browser** - `a436190` (feat)

**Plan metadata:** the docs commit that adds this SUMMARY.

## Files Created/Modified

- `ui/src/theme.ts`: pure preference logic, `useThemePreference`, and the context the Theme menu reads
- `ui/public/theme-init.js`: first-paint script (copied to `dist/ui/theme-init.js` by Vite)
- `ui/index.html`: loads `/theme-init.js` synchronously in `<head>`; no inline script
- `ui/src/main.tsx`: ThemePreferenceContext → `Theme` (neutral, resolved mode) → `LinkProvider component={RouterLink}` → `QueryClientProvider` → `RouterProvider`
- `ui/src/router.tsx`: route tree, host checks, `counterpoint.lastHost`, `RouterLink`
- `ui/src/shell/AppFrame.tsx`: chrome, live stream owner, paused Banner
- `ui/src/pages/MissionPage.tsx`: Mission frame (later plans add the runway, Needs You and Trust cards)
- `ui/src/pages/SignedOutPage.tsx`: three copy variants
- `ui/src/api.ts`: HTTP client, query keys, host list query
- `ui/src/live.ts`: EventSource client, family-to-key map, connection store
- `ui/tests/theme.test.ts`: 11 unit tests
- `tests/e2e/shell.e2e.test.ts`: 10 browser checks
- `tests/e2e/skeleton.e2e.test.ts`: now checks the switcher and the Mission heading instead of the old `Repositories` heading

## Decisions Made

See `key-decisions` in the frontmatter. The two with the widest effect:

- **Resolved theme mode.** Astryx removes `data-theme` in `system` mode and relies on `color-scheme: light dark`. Passing the resolved mode instead keeps `data-theme` identical to what `theme-init.js` set at first paint, and the System listener still follows the OS live.
- **Leaving on 401/403 with a full load.** `location.replace` drops the EventSource with the page and keeps Back from returning to a page that would 401 again.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] api.ts and SignedOutPage.tsx moved into the Task 1 commit**
- **Found during:** Task 1
- **Issue:** The Task 1 router needs the host list (for `/` and the host check) and a component for `/signed-out`. Both files were listed under Task 2, so a Task 1 commit without them would not build.
- **Fix:** Wrote both files in their final form and committed them with Task 1. Task 2 added the live client, the banner wiring and the e2e. Every Task 2 acceptance check still holds.
- **Files modified:** ui/src/api.ts, ui/src/pages/SignedOutPage.tsx
- **Verification:** each commit typechecks and builds; both task checks pass
- **Committed in:** 5eca343

**2. [Rule 1 - Bug] The 01-02 skeleton e2e asserted the old page**
- **Found during:** Task 1
- **Issue:** It looked for the `Repositories` heading and an exact host-name text node. The heading is now `Mission`, and Astryx's truncation measurer renders the host name twice, which breaks Playwright's strict mode.
- **Fix:** The test checks the switcher by its accessible name and the Mission heading's `aria-level="1"`. Playwright's role engine reports the native `h2` level, so the announced level is read from `aria-level`.
- **Files modified:** tests/e2e/skeleton.e2e.test.ts
- **Verification:** skeleton e2e 7/7
- **Committed in:** 5eca343

**3. [Rule 3 - Blocking] Extensionless imports in UI code**
- **Found during:** Task 1
- **Issue:** The ui tsconfig does not enable `allowImportingTsExtensions`, so the RED test's `'../src/theme.ts'` import would not typecheck.
- **Fix:** UI modules and the unit test use extensionless relative imports (bundler resolution).
- **Files modified:** ui/tests/theme.test.ts
- **Committed in:** 5eca343

### Other notes (no behaviour change)

- **Sign-in at 360px.** The plan says nav moves into the drawer "below 360px". Astryx's default breakpoint is `md`, so the drawer is already active at 360px; that is what the e2e checks.
- **Prior art not read.** `git -C /Volumes/Dock/Projects/HKP/Cena show …` is outside this worktree and is blocked by the isolation layer (01-03 hit the same limit). The theme logic was written from the plan's behaviour bullets, which name the same functions.
- **RED evidence.** `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` for `ui/tests/theme.test.ts > parseThemePreference > falls back to system for anything else, including near misses and markup` (TAP from `--reporter=tap-flat`; exit 1; the stub throws `not implemented`).

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 bug).
**Impact on plan:** Only commit grouping and a test update; no scope change. No packages were added and the lockfile is unchanged.

## TDD Gate Compliance

Task 1 (`tdd="true"`) has `test(01-09)` `2df3d10` followed by `feat(01-09)` `5eca343`, which descends from it. No refactor commit was needed. Semantic check: the target test ran and failed because the stub threw, not because of an import, syntax or setup error. The two tests that passed in RED check constants (`THEME_STORAGE_KEY`, `THEME_OPTIONS`) that the stub already exported. Task 2 is `type="auto"` without TDD.

## Issues Encountered

- `pnpm test` without `CP_TEST_SCRATCH` fails 19 tests in `tests/cli/lifecycle.test.ts`, `tests/core/approvals/verify.test.ts` and `tests/core/security/sandbox-settings.test.ts`. These are scratch paths too long for this deep worktree (the known Unix-socket limit) and are untouched by this plan. With `CP_TEST_SCRATCH=/Volumes/Dock/Dev/Caches/cp-test-0109` the suite is 438 passed, 1 skipped.
- Vite warns that the main chunk is 972 kB (307 kB gzip), up from 554 kB, because TanStack Router and Query and more Astryx components now load. Code-splitting is left for later, as in 01-02.

## Known Stubs

None that block this plan. The SideNav lists only `Mission` and the Mission page shows only the host facts; the plan states that 01-11, 01-13, 01-14 and 01-15 add `Phases`, `Needs You`, `Trust` and the runway, Needs You and Trust cards. No placeholder copy or mock data is rendered, so nothing was added to `.planning/WINDOWS.md`.

## User Setup Required

None. To try it by hand: `pnpm build:ui`, then `COUNTERPOINT_HOME=<existing dir> node src/cli/main.ts` inside a git repo.

## Next Phase Readiness

- **New pages** mount as children of `hostRoute` in `router.tsx` (pass params as props from a small route component) and add a `SideNavItem` in `AppFrame`.
- **Live data:** use `queryKeys.*` from `api.ts` with `useQuery`; the families in `FAMILY_TO_KEYS` already invalidate `phases`, `phase`, `runway`, `needsYou` and `doctor`. Writes go through `apiPost` (JSON, same-origin).
- **Announcements:** `useAnnounce` from `@astryxdesign/core/hooks`, as in `live.ts`.
- **e2e:** reuse the `cli()` and `signInLink()` helpers. Match copy with `{ exact: true }`, because Astryx mirrors EmptyState and announcement text into live regions. Run with `CP_TEST_SCRATCH` set to a short path.

---
*Phase: 01-trusted-shell-signed-runway*
*Completed: 2026-11-09*

## Self-Check: PASSED

- All 13 key files exist on disk.
- Commits 2df3d10, 5eca343 and a436190 are on this branch (`git log 2ef6dac..HEAD`).
- Acceptance criteria re-run: theme.ts contains `counterpoint.theme` and `prefers-color-scheme`; index.html references `/theme-init.js` with zero `<script>` tags; AppFrame has `label="Counterpoint"`, `label="Main"` (as `aria-label="Main"`), `label="Theme"` and `Live updates paused`; live.ts has `EventSource` and `invalidateQueries`; SignedOutPage has all three headings.
- Plan verification: `pnpm typecheck` 0; `pnpm lint` 0; `CP_TEST_SCRATCH=… pnpm test` 438 passed, 1 skipped; `CP_TEST_SCRATCH=… pnpm test:e2e` 17/17 on two consecutive runs; no daemons left running.

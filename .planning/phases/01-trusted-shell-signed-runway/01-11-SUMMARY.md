---
phase: 01-trusted-shell-signed-runway
plan: 11
subsystem: ui
tags: [hono, react, astryx, tanstack-query, sse, gsd-adapter, doctor]

requires:
  - phase: 01-03
    provides: guard chain, SSE stream, EventBus and publishEvent
  - phase: 01-06
    provides: framework port, git file reader, derivePhaseStatus / phasePrerequisites
  - phase: 01-07
    provides: approvalInputs (D-02) and compose.ts adapterFor
  - phase: 01-08
    provides: sha256Digest
  - phase: 01-04
    provides: DoctorReport schema, reportVerdict, isReportStale
  - phase: 01-09
    provides: console shell, router, apiGet, queryKeys, useLiveEvents
provides:
  - Per-host runtimes (createHostRuntimes) with snapshot cache by base tip and debounced re-read of newly unreadable phases
  - Base-tip watcher (startWatcher) that publishes `phase` events
  - GET /api/hosts/:hostId/phases, /phases/:phaseId, /doctor
  - Phases, Phase detail and Trust pages; StatusBadge; SideNav Phases and Trust
affects: [01-12, 01-13, 01-14, 01-15]

actuals:
  tokens: 25600
  tasks: 3
  commits: 5
plan_head_before: 2d217cfd6328e9084a7d06102fab5fe489528230
plan_head_after: 38a663c52af4a781ba9e141fe5f1ec00cf7fe408

tech-stack:
  added: []
  patterns:
    - "Server reaches the adapter only through compose.ts adapterFor (runtime per host)"
    - "Polling watcher publishes ids-only `phase` events; pages refetch through FAMILY_TO_KEYS"
    - "Page-local API parsers validate every field before rendering (untrusted planning text)"

key-files:
  created:
    - src/server/hosts.ts
    - src/server/watcher.ts
    - src/server/routes/phases.ts
    - src/server/routes/trust.ts
    - ui/src/components/StatusBadge.tsx
    - ui/src/pages/PhasesPage.tsx
    - ui/src/pages/PhaseDetailPage.tsx
    - ui/src/pages/TrustPage.tsx
    - tests/server/phases.test.ts
    - tests/e2e/phases.e2e.test.ts
  modified:
    - src/server/app.ts
    - src/server/daemon.ts
    - ui/src/router.tsx
    - ui/src/shell/AppFrame.tsx

key-decisions:
  - "Watcher baseline on a host's first poll is the tip the console was last served (HostRuntime.servedTip), so a move between page load and first poll still pushes a phase event"
  - "Newly unreadable phase: last good PhaseFacts served while one re-read runs after debounceMs (1 s); the retry's result is final and publishes `phase` with settled: true"
  - "A doctor report is shown only if it is a regular file (O_NOFOLLOW), under 1 MiB, valid counterpoint/doctor/v1 and for this host; otherwise `unreadable`, never a verdict"
  - "Status icons come from the theme registry only: Not planned uses `clock`, Ready to approve uses `info` (the registry has no circle-dashed / circle-dot)"
  - "Repository integrity check is listed in the Signing key table (it guards signing); the Trust page verdict is all-pass only when the server says pass and nothing is failed, reachable or not checked"

patterns-established:
  - "New host pages: route under hostRoute with a small component passing params; SideNavItem in AppFrame"
  - "List pages: keepPreviousData query, Skeleton only on first load, error Banner with retry above the last good data"

requirements-completed: [ADPT-01, FOUND-03, FOUND-06]

coverage:
  - id: D1
    description: "Phases API lists every roadmap phase in tuple order with core-derived status, plan counts and prerequisites; 400/404 on bad or unknown ids"
    requirement: ADPT-01
    verification:
      - kind: integration
        ref: "tests/server/phases.test.ts#GET /api/hosts/:hostId/phases"
        status: pass
    human_judgment: false
  - id: D2
    description: "Phase detail API returns goal, plans and the six D-02 inputs with sha256 digests of committed bytes (bytes never sent)"
    requirement: ADPT-01
    verification:
      - kind: integration
        ref: "tests/server/phases.test.ts#returns goal, plans and the six D-02 inputs with sha256 digests of the committed bytes"
        status: pass
    human_judgment: false
  - id: D3
    description: "Base-tip watcher pushes a phase event within 3 s of a base-branch commit; newly unreadable phase keeps its last good parse until the debounced retry"
    requirement: ADPT-01
    verification:
      - kind: integration
        ref: "tests/server/phases.test.ts#base-tip watcher"
        status: pass
      - kind: e2e
        ref: "tests/e2e/phases.e2e.test.ts#updates the Inputs digest without a reload when the base branch moves"
        status: pass
    human_judgment: false
  - id: D4
    description: "Phases and Phase detail pages render the synthetic host (order, badges, filter, banners, plans, 12-hex inputs)"
    requirement: FOUND-06
    verification:
      - kind: e2e
        ref: "tests/e2e/phases.e2e.test.ts#phases and trust pages"
        status: pass
    human_judgment: false
  - id: D5
    description: "Trust API and page render the stored doctor verdict truthfully (empty, pass, stale, reachable; symlink/malformed/other-host refused)"
    requirement: FOUND-03
    verification:
      - kind: integration
        ref: "tests/server/phases.test.ts#GET /api/hosts/:hostId/doctor"
        status: pass
      - kind: e2e
        ref: "tests/e2e/phases.e2e.test.ts#shows Not checked yet on Trust, then each stored verdict as it is written"
        status: pass
    human_judgment: false
  - id: D6
    description: "Visual fit of the three pages in light and dark (spacing, truncation, long text) per UI-SPEC backstop rows"
    verification: []
    human_judgment: true
    rationale: "UI-SPEC backstop rows (40 phases, 300-character names, 360px) need a held-out visual check; screenshots were taken during execution but no visual assertion exists"

duration: 23min
completed: 2026-11-09
status: complete
---

# Phase 1 Plan 11: Phases, Phase detail and Trust Summary

**The console now lists every GSD phase of a host with core-derived status, plans and setup needs, opens a phase to show why it can or cannot be approved and the exact inputs a signature binds (with 12-hex digests), refreshes within about 2 s of a commit to the base branch, and shows the last `counterpoint doctor` verdict on a read-only Trust page.**

## Performance

- **Duration:** 23 min
- **Started:** 2026-11-09T17:13:47Z
- **Completed:** 2026-11-09T17:36:54Z
- **Tasks:** 3
- **Files modified:** 14

## Accomplishments

- **Host runtimes and watcher (D-03).** Each registered host gets a reader and adapter, reached only through `compose.ts`. Its snapshot is cached by the `refs/heads/{base}` tip. The watcher polls every 2 s, refreshes the snapshot when the tip moves, and publishes `phase` `{ hostId, tip }`. If a phase that read fine becomes unreadable, the console keeps showing its last good facts until one re-read runs after 1 s. Whatever that re-read finds is final, and it publishes `{ tip, settled: true }`.
- **Phases API (ADPT-01, D-01, D-02).** Rows are sorted by tuple number. Each row carries `derivePhaseStatus` / `phasePrerequisites` output, plan counts, user setup and the unreadable file. Detail adds goal, depends-on, plans (wave, objective, autonomous, files count) and the inputs sorted by path with `sha256Digest`. When the adapter refuses an input (for example a symlink), detail returns `inputsError`. `hostId` and `phaseId` are checked with the strict id regexes: malformed ids get 400, unknown ids get 404.
- **Trust API (T-01-40).** Reads `hosts/{id}/doctor.json` with `O_NOFOLLOW`, as a regular file under 1 MiB. It must parse as the zod schema for this host and is returned with `verdict` and `stale`. Anything else returns `{ report: null, error: 'unreadable' }`.
- **Pages (FOUND-06).** Phases has the status filter with counts (0 is shown), the table (Phase link, StatusBadge, Plans wording, Setup token, Approval `—`), the empty, filter-empty, loading and error states, and the whole row opens detail. Phase detail has the reason, built, couldn't-read and prerequisite banners (`{k} of {n} plans need you present (not autonomous).`), the MetadataList with the base tip sha, the plans table or `No plans yet`, and the Inputs card. Trust shows the verdict banner, the stale banner, the Tools, Signing key and Sandbox probe tables (Pass/Fail/Not checked and Blocked/Reachable/Not checked, each with an icon and a word), and `Not checked yet` with a copyable `counterpoint doctor` command. SideNav now reads Mission, Phases, Trust.

## Task Commits

1. **Task 1 RED: failing tests for the phases API and watcher**: `41b7f7b` (test)
2. **Task 1 GREEN: per-host runtimes, base-tip watcher and the phases API**: `6321ea2` (feat)
3. **Task 2: Phases and Phase detail pages**: `65a8e23` (feat)
4. **Rule 1 fix found in Task 3: watcher first-poll baseline**: `1fdf231` (fix)
5. **Task 3: Trust API and page, e2e browse test**: `38a663c` (feat)

## Files Created/Modified

- `src/server/hosts.ts`: `createHostRuntimes` / `HostRuntimes`, snapshot cache, debounced re-read, `servedTip`
- `src/server/watcher.ts`: `startWatcher`, base-tip polling, `phase` events
- `src/server/routes/phases.ts`: `mountPhaseRoutes`
- `src/server/routes/trust.ts`: `mountTrustRoutes`, `readDoctorReport`
- `src/server/app.ts`: mounts both route groups; new `runtimes` and `home` options
- `src/server/daemon.ts`: one shared runtimes set; watcher starts after the store and stops on shutdown
- `ui/src/components/StatusBadge.tsx`: status vocabulary (label, variant, icon)
- `ui/src/pages/PhasesPage.tsx`, `PhaseDetailPage.tsx`, `TrustPage.tsx`: the three pages
- `ui/src/router.tsx`, `ui/src/shell/AppFrame.tsx`: routes and SideNav items
- `tests/server/phases.test.ts` (14 tests), `tests/e2e/phases.e2e.test.ts` (7 tests)

## Decisions Made

See `key-decisions` in the frontmatter. In short:
- The watcher compares a host's first poll with the tip the console was served, not with nothing.
- Built phases keep the `Already built` banner and are never offered for approval (UI-SPEC Open Item 1 as adopted).
- The doctor route never turns an invalid, symlinked or other-host file into a verdict.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Watcher missed a base-tip move that happened before its first poll of a host**
- **Found during:** Task 3 (e2e)
- **Issue:** The first poll of a host only recorded a baseline. The e2e registered the host, loaded pages and committed to `master` inside the first 2 s window. The commit became the baseline, no `phase` event was sent, and the open page stayed stale (the run failed 5 times in a row).
- **Fix:** `HostRuntime.servedTip()` returns the tip of the snapshot last served. On the first poll the watcher compares against it.
- **Files modified:** src/server/hosts.ts, src/server/watcher.ts (plus a regression test in tests/server/phases.test.ts)
- **Verification:** the new unit test fails without the fix and passes with it. The e2e passes, and so does the full e2e project (24/24).
- **Committed in:** `1fdf231` (test in `38a663c`)

**2. [Rule 1 - Bug] Phases table header row clipped under the page header**
- **Found during:** Task 3 (screenshots)
- **Issue:** When the Table is the first block of `LayoutContent`, Astryx's edge compensation (-16px margin) pulls it into the clipped scroll area, cutting off the top of the header row.
- **Fix:** A Supporting source line (`Read from {base} at {sha7} (committed content only).`) now sits above the table. It also states D-03 on the page.
- **Files modified:** ui/src/pages/PhasesPage.tsx
- **Committed in:** `38a663c`

**3. [Rule 1 - Bug] Badge icons were larger than the badge text**
- **Fix:** Status and result icons use `size="xsm"`.
- **Files modified:** ui/src/components/StatusBadge.tsx, ui/src/pages/TrustPage.tsx
- **Committed in:** `38a663c`

**4. [Rule 2 - Missing critical] Doctor route unit tests and other-host check**
- **Issue:** The plan's e2e covers the verdict copy, but not the T-01-40 refusals.
- **Fix:** The route rejects a report whose `hostId` is another host's. Unit tests cover absent, pass, stale, reachable, symlink, malformed and other-host reports, plus 400/404.
- **Committed in:** `38a663c`

### Other notes (no behaviour change)

- **Icons.** The theme registry has no circle-dashed or circle-dot, and Registry Safety forbids importing lucide-react directly. `Not planned` therefore uses `clock` and `Ready to approve` uses `info`. The other four map exactly.
- **Signatures.** `createHostRuntimes({ store, debounceMs })` does not take `home`, because nothing in it needs the home. `mountTrustRoutes(app, { home, store })` takes the store so it can answer 404 for an unknown host.
- **RED commit** carried load-only stubs for `hosts.ts` and `watcher.ts`, so the target test failed on its assertion and not on an import.
- **Phase API types** for the UI live in `PhasesPage.tsx` and are exported to Phase detail. This stays inside the plan's file list instead of adding a new module.

---

**Total deviations:** 4 auto-fixed (3 bugs, 1 missing critical).
**Impact on plan:** All four were needed for correctness or the security mitigation. No scope creep, no new packages, lockfile unchanged.

## TDD Gate Compliance

Task 1 (`tdd="true"`): `test(01-11)` `41b7f7b`, then `feat(01-11)` `6321ea2`, which descends from it. No refactor commit was needed.

- **RED evidence:** `vitest run --project unit tests/server/phases.test.ts --reporter=tap-flat` exited 1. `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` for target `tests/server/phases.test.ts > GET /api/hosts/:hostId/phases > lists every roadmap phase in numeric tuple order with core-derived status`.
- **Semantic assessment:** The target ran and failed on its assertion (`expected 404 to be 200`: the route did not exist yet), not on an import, syntax or fixture error. 8 of 9 tests failed. The one that passed (`requires a session`) checks an existing guard.

## Known Stubs

- `ui/src/pages/PhasesPage.tsx` Approval column renders `—` for every row. This is intentional per the plan: 01-13 adds `On runway · signed {Timestamp}` and the On runway / Changed overlays. It is not added to WINDOWS.md because it is planned work, not a defect.

## Issues Encountered

- The worktree isolation layer blocks shell commands that mention `git` in compound or scripted forms. The commit ledger was kept in the session scratchpad instead of under the git dir.
- The live machine's doctor verdict is not exercised here. Tests use fixture reports; the Trust page renders whatever report is stored.

## User Setup Required

None.

## Next Phase Readiness

- 01-13 (approval) can add `Approve phase` on Phase detail (only when status is `ready`), the On runway / Changed overlay through `derivePhaseStatus(phase, overlay)` in `routes/phases.ts`, and the Approval column. Use `HostRuntimes.get(id)` for the reader, adapter and tip.
- 01-15 (Needs You, Mission cards) can reuse `readDoctorReport` for the Mission Trust card and should add the Needs You SideNav item between Phases and Trust.
- Run tests with `CP_TEST_SCRATCH` set to a short Dock path from deep worktrees.

---
*Phase: 01-trusted-shell-signed-runway*
*Completed: 2026-11-09*

## Self-Check: PASSED

- All 10 created files exist on disk. Commits 41b7f7b, 6321ea2, 65a8e23, 1fdf231 and 38a663c are on this branch (`git rev-list 2d217cf..HEAD` = 5 before this summary commit).
- Acceptance criteria re-run: `derivePhaseStatus` and `sha256Digest` are in routes/phases.ts. `grep -rn "adapters/gsd" src/server src/core` is empty, and across `src` it matches only src/compose.ts. watcher.ts has `refs/heads/` and `'phase'`. trust.ts has `doctor.json` and `O_NOFOLLOW`. Every required copy string is present in the pages, and AppFrame has `Phases`.
- Plan verification: `pnpm test` 518 passed and 1 skipped. `pnpm test:e2e` passed 24/24 (3 files). `pnpm typecheck` 0, `pnpm lint` 0, `pnpm build:ui` 0.
- REQUIREMENTS.md: ADPT-01 and FOUND-06 are marked complete. FOUND-03 is held by the shared-ID gate until its other declaring plans finish.

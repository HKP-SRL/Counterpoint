---
phase: 01-trusted-shell-signed-runway
plan: 13
subsystem: approvals-console
tags: [hono, react, astryx, tanstack-query, sse, runway, approval-dialog, playwright, tdd]

requires:
  - phase: 01-12
    provides: "prepareApproval, approvalState, computeRunway, approveCommand (counterpoint approve)"
  - phase: 01-11
    provides: "createHostRuntimes, startWatcher, mountPhaseRoutes, Phases / Phase detail pages"
  - phase: 01-08
    provides: "readTrust, writeTrust, checkIntegrity, writeBaseline, snapshotIntegrity"
  - phase: 01-03
    provides: "mutationGuard + sessionGuard on /api writes, POST /control/notify, publishEvent"
  - phase: 01-09
    provides: "apiGet, queryKeys.runway, useLiveEvents (approval -> phase, phases, runway)"
provides:
  - "POST /api/hosts/:hostId/phases/:phaseId/approval: preview only (inputs, slots, 12-hex fingerprint, prerequisites, ID-only command); refusals as 409/404"
  - "GET /api/hosts/:hostId/runway: count, planCount, changedCount, items (phaseId, name, planCount, signedAt, commit, unreadable)"
  - "Phases API rows carry `approval` and the on-runway / changed overlay; invalid approvals keep the base status"
  - "src/server/approval-views.ts: createApprovalViews (states, state, runway, trust), in-memory cache keyed by host:tip:item:fingerprint"
  - "Watcher: `approval` and `runway` events, `nudge(hostId)`; control notify (approval) nudges; /control/status reports runway per host"
  - "ui/src/components/ApprovalDialog.tsx, ui/src/runway.ts (runwayQuery), Mission runway card"
affects: [01-14, 01-15, 01-16]

actuals:
  tokens: 22000   # chars/4 over the added lines of the realized diff (88,061 chars)
  tasks: 3
  commits: 4      # MEASURED: git rev-list --count 72e2bd9..HEAD before the SUMMARY commit
plan_head_before: 72e2bd97669d6213656efdb286c270e664758d32
plan_head_after: 1b8c87268e96ffc09d8c5fb7e052c43358152c77

tech-stack:
  added: []
  patterns:
    - "Approval views are the only path from the server to approval truth: every state is approvalState / computeRunway output; the cache key includes the tip and the trusted fingerprint and a result is kept only if the tip did not move while computing"
    - "The watcher serializes checks per host (poll and nudge never overlap) and records a baseline on the first look before publishing approval/runway deltas"
    - "The dialog validates the prepared statement and accepts the command only if it equals the ID-only form built from its own validated ids"

key-files:
  created:
    - src/server/approval-views.ts
    - src/server/routes/approvals.ts
    - ui/src/components/ApprovalDialog.tsx
    - ui/src/runway.ts
    - tests/server/approvals.test.ts
    - tests/e2e/approve.e2e.test.ts
  modified:
    - src/server/routes/phases.ts
    - src/server/watcher.ts
    - src/server/control.ts
    - src/server/app.ts
    - src/server/daemon.ts
    - ui/src/pages/PhaseDetailPage.tsx
    - ui/src/pages/PhasesPage.tsx
    - ui/src/pages/MissionPage.tsx
    - tests/cli/lifecycle.test.ts

key-decisions:
  - "Approval state and runway are computed by one shared ApprovalViews object (daemon-wide); routes, the watcher and /control/status all read through it, so the cache cannot drift between them"
  - "An unexpected error inside approvalState (invalid reason `error`) is shown fail-closed but never cached, so a transient git failure is not pinned to a tip"
  - "Refusal codes beyond the plan: trust-unusable (trusted key files present but unusable), integrity-unreadable (baseline cannot be read), no-framework, no-base, gates-config, unreadable; the dialog has a sentence for each and never shows a command"
  - "A stale dialog hides the command block entirely (not only the Copy button) so a stale statement never offers a usable command; `Prepare approval again` re-prepares in place"
  - "The landed line waits for a runway snapshot whose tip equals the phase's tip, so `Signed. Runway is now {N}.` never shows a figure from before the approval"
  - "/control/status adds `runway` (also 0) per host, waiting at most 2 s; `counterpoint status` therefore prints `runway 0` for a host with nothing approved (lifecycle test updated)"
  - "APPR-01, APPR-02 and MISN-01 not marked complete: requirements.ready-ids still blocks them on sibling plans (01-14..01-16)"

patterns-established:
  - "Shared page queries live in small ui/src modules (runway.ts) rather than inside a page, when a component and a page both need them"

requirements-completed: []  # plan declares APPR-01, APPR-02, MISN-01; requirements.ready-ids reports all three blocked by sibling plans

coverage:
  - id: D1
    description: "Prepare preview API: inputs with digests, draft none, gates slot, 12-hex fingerprint, prerequisites, item path and `counterpoint approve {host} {phase}`; deterministic per tip; writes nothing"
    requirement: APPR-01
    verification:
      - kind: integration
        ref: "tests/server/approvals.test.ts#recomputes the statement at the base tip and returns inputs, slots, fingerprint and the command"
        status: pass
      - kind: integration
        ref: "tests/server/approvals.test.ts#is deterministic for the same tip"
        status: pass
    human_judgment: false
  - id: D2
    description: "Prepare is guarded (403 without/with a foreign Origin, 401 without session) and refuses exactly as signing would: no-trusted-key, no-baseline, integrity-changed (with changes), not-ready (no-context / no-plans), built, 404 unknown, 400 malformed"
    requirement: APPR-01
    verification:
      - kind: integration
        ref: "tests/server/approvals.test.ts#is guarded / refuses with no trusted key / no integrity baseline / integrity changed / not ready, built or unknown"
        status: pass
    human_judgment: false
  - id: D3
    description: "Runway API and phases overlay recomputed from git: runway 1 with the phase row after a signed approval lands; Changed and runway 0 after an input edit, back On runway on revert; invalid (no-trusted-key) keeps the base status"
    requirement: APPR-02
    verification:
      - kind: integration
        ref: "tests/server/approvals.test.ts#serves runway 1 with the phase row and overlays On runway on the phases API"
        status: pass
      - kind: integration
        ref: "tests/server/approvals.test.ts#goes Changed when a signed input changes, and back On runway when it is reverted"
        status: pass
      - kind: integration
        ref: "tests/server/approvals.test.ts#fails closed without a trusted key"
        status: pass
    human_judgment: false
  - id: D4
    description: "Watcher appends approval and runway events within 3 s of a landed approval; control notify (approval) nudges an immediate re-check; /control/status carries runway per host"
    requirement: MISN-01
    verification:
      - kind: integration
        ref: "tests/server/approvals.test.ts#appends approval and runway events within 3 s of a signed approval landing"
        status: pass
      - kind: integration
        ref: "tests/server/approvals.test.ts#re-checks at once on a control approval nudge and reports runway in /control/status"
        status: pass
      - kind: integration
        ref: "tests/server/approvals.test.ts#a nudge publishes the runway change without waiting for the next poll"
        status: pass
    human_judgment: false
  - id: D5
    description: "Console approval end to end: dialog lists 6 inputs + Draft + Gates rows and the command, Copy command copies it with the `Command copied` toast and has initial focus, the real CLI signs in a pty, the open dialog flips to `Signed. Runway is now 1.`, Mission shows 1 and the Phase 02 row, Phases shows `On runway · signed`, `counterpoint status` prints runway 1, checkout untouched"
    requirement: APPR-01
    verification:
      - kind: e2e
        ref: "tests/e2e/approve.e2e.test.ts#previews what Phase 02 would sign and hands over the one-line command"
        status: pass
      - kind: e2e
        ref: "tests/e2e/approve.e2e.test.ts#flips to landed when the real CLI signs in a terminal, without touching the checkout"
        status: pass
      - kind: e2e
        ref: "tests/e2e/approve.e2e.test.ts#shows the runway headline at 1 with the Phase 02 row, and On runway on Phases"
        status: pass
    human_judgment: false
  - id: D6
    description: "Stale and refused dialog states: base tip moves → warning banner, Copy disabled, command hidden, re-prepare works; .git/config change → only the integrity refusal, no command; focus returns to Approve phase"
    requirement: APPR-01
    verification:
      - kind: e2e
        ref: "tests/e2e/approve.e2e.test.ts#marks the dialog stale and disables Copy command when the base tip moves first"
        status: pass
      - kind: e2e
        ref: "tests/e2e/approve.e2e.test.ts#shows only the integrity refusal, and no command, after .git/config changes"
        status: pass
    human_judgment: false
  - id: D7
    description: "Mission runway card zero state (figure 0, Nothing approved yet line, Browse phases link) and populated state (1 phase · 2 plans line, runway row)"
    requirement: MISN-01
    verification:
      - kind: e2e
        ref: "tests/e2e/approve.e2e.test.ts#leads Mission with an empty runway"
        status: pass
    human_judgment: false
  - id: D8
    description: "Visual fit of the dialog and runway card (640 px dialog with inner scroll, one-line CodeBlock, long names, 40 runway rows, light/dark, Skeleton first load, error banner keeping last data)"
    verification: []
    human_judgment: true
    rationale: "UI-SPEC E1 overflow / E5 overflow and loading/error looks are visual; no screenshot or visual assertion covers them"

duration: 17min
completed: 2026-11-09
status: complete
---

# Phase 1 Plan 13: Console approval and the runway headline Summary

**On a Ready phase the owner clicks `Approve phase`; the dialog asks the server to recompute the statement at the base tip, shows the inputs with 12-hex digests, the Draft and Gates rows, the statement fingerprint and `counterpoint approve {host} {phase}`. When the owner runs that command in a terminal, the open dialog flips to `Signed. Runway is now N.` and the Mission page, which now leads with the runway figure, goes up by one. Phase statuses and the runway are recomputed from git at the base tip, never stored.**

## Performance

- **Duration:** 17 min
- **Started:** 2026-11-09T18:11:13Z
- **Completed:** 2026-11-09T18:27:14Z
- **Tasks:** 3
- **Files modified:** 15

## Accomplishments

- **Prepare preview (APPR-01).** `POST /api/hosts/:hostId/phases/:phaseId/approval` sits behind the existing session, Origin and JSON guards. It checks the trusted key, then the integrity baseline, then calls `prepareApproval` at the local base tip. On success it returns the phase, base and tip, the inputs (label, path, kind, digest), `draft: none`, the gates slot, the fingerprint, the prerequisites, the item path and the command, which is built only from the validated ids. On refusal it returns 409 (or 404) with a code and no command. It writes nothing.
- **Runway and status overlay (APPR-02, MISN-01).** `GET /api/hosts/:hostId/runway` reads from `computeRunway`. Each phases row now carries `approval`. `on-runway` and `changed` drive the status overlay; `invalid` keeps the base status (fail closed). All of it goes through one `ApprovalViews` object. Its in-memory cache is keyed by host, tip, item and trusted fingerprint, starts empty with the daemon, and never decides authority.
- **Live events.** Every pass, the watcher recomputes the runway (a cache hit when nothing moved). It publishes `approval` `{hostId, tip}` when any approval state changes and `runway` `{hostId, count}` when the count changes. `nudge(hostId)` runs the same check at once, and `POST /control/notify` with family `approval` calls it. `/control/status` reports `runway` per host, so `counterpoint status` prints `runway N`.
- **Approval dialog.** Built per the UI-SPEC: Skeletons and a loading `Copy command` while preparing; the prerequisites banner; a `What you're signing` MetadataList; the Inputs table with Draft and Gates rows; the intro sentence; a one-line bash CodeBlock with copy; `Statement {fingerprint}`; and the waiting line that becomes the landed banner. Copying fires the `Command copied` toast and an announcement. A stale statement gets a warning banner, a disabled Copy and no command. A refusal gets only the error banner. There is no sign button.
- **Pages.** Phase detail shows `Approve phase` only when the phase is Ready, plus Signed (timestamp, commit sha7) or `Approval: not verified ({reason})`. The Phases Approval column reads `On runway · signed {Timestamp}`, and its filters count real rows. Mission leads with the Runway card: a display-3 figure, the phases/plans line, the runway rows, and the zero, loading and error states.

## Task Commits

1. **Task 1 RED: failing tests for prepare, runway, overlay and events**: `1f0c837` (test)
2. **Task 1 GREEN: prepare and runway APIs, overlay, approval/runway events**: `b06ad9e` (feat)
3. **Task 2: approval dialog, Approve phase, On runway column**: `6760cef` (feat)
4. **Task 3: Mission runway headline and the end-to-end approval test**: `1b8c872` (feat)

## TDD Gate Compliance

- RED `1f0c837`: `tests/server/approvals.test.ts` was committed with stubs only (`approval-views.ts` returning empty values, `watcher.nudge` a no-op). The classifier check `check tdd-red-evidence` on `vitest -t "recomputes the statement" --reporter=tap-flat` returned `RED_EVIDENCE_OK` (target_test_failed). Semantic assessment: the target ran and failed on its planned first assertion (`expected 404 to be 200`, because the route was not mounted), not on a load or syntax error. The full-file TAP report was rejected as malformed because Vitest prints multi-line YAML for some failures, so the run was repeated with the target filter as the reference allows.
- GREEN `b06ad9e`: all 14 tests pass.
- No refactor commit.

## Files Created/Modified

- `src/server/approval-views.ts`: `createApprovalViews`, with states, state, runway and trust recomputed from git and the tip-keyed cache
- `src/server/routes/approvals.ts`: `mountApprovalRoutes`, `approveCommandLine`
- `src/server/routes/phases.ts`: approval overlay and `approval` facts
- `src/server/watcher.ts`: approval and runway events, per-host serialized checks, `nudge`
- `src/server/control.ts`: `nudge` and `runwayCount` options; runway in status
- `src/server/app.ts`, `src/server/daemon.ts`: wiring of one shared `ApprovalViews`
- `ui/src/components/ApprovalDialog.tsx`, `ui/src/runway.ts`: dialog and shared runway query
- `ui/src/pages/PhaseDetailPage.tsx`, `PhasesPage.tsx`, `MissionPage.tsx`: entry point, column, headline
- `tests/server/approvals.test.ts` (14 tests), `tests/e2e/approve.e2e.test.ts` (7 tests), `tests/cli/lifecycle.test.ts` (status line now ends `runway 0`)

## Decisions Made

See `key-decisions` in the frontmatter. The main ones:
- One daemon-wide `ApprovalViews` is shared by the routes, the watcher and the control app.
- Error verdicts are never cached.
- A stale statement hides the command entirely.
- The landed figure waits for a runway snapshot taken at the phase's current tip.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] New shared module `src/server/approval-views.ts` and wiring in `src/server/daemon.ts`**
- **Found during:** Task 1
- **Issue:** The phases route, the runway route, the watcher and `/control/status` all need the same verified states and the same cache keyed by host, tip, item and fingerprint. The daemon has to hand the watcher's `nudge` and the runway counter to the control app. Neither file is in `files_modified`.
- **Fix:** One `createApprovalViews({ home })`, created by the daemon and passed to `createApp`, `startWatcher` and `createControlApp` (as `nudge` and `runwayCount` options).
- **Files modified:** src/server/approval-views.ts (new), src/server/daemon.ts
- **Committed in:** 1f0c837 (stub), b06ad9e

**2. [Rule 3 - Blocking] New `ui/src/runway.ts`**
- **Found during:** Task 2
- **Issue:** The dialog needs the runway count for `Signed. Runway is now {N}.` and the Mission page needs the full runway. A page module was the wrong home for a query both use.
- **Fix:** `runwayQuery`, `phasesText` and `plansCountText` live in `ui/src/runway.ts`.
- **Committed in:** 6760cef

**3. [Rule 1 - Intended behavior change] `counterpoint status` lifecycle test**
- **Found during:** Task 1 (full unit run)
- **Issue:** The 01-10 test expected the status line to end at the port. The CLI already prints `runway N` when the daemon reports it, which the UI-SPEC CLI contract requires, so the old expectation was out of date.
- **Fix:** The test now expects `…  runway 0` for the unapproved scratch repository.
- **Files modified:** tests/cli/lifecycle.test.ts
- **Committed in:** b06ad9e

**4. [Rule 2 - Missing critical] Extra refusal codes and fail-closed caching**
- **Found during:** Task 1
- **Issue:** The plan lists the main refusals only. The following could otherwise surface as a 500 or show a command: trusted key files present but unusable, an unreadable baseline, a host with no framework, no base branch, an unparseable gate config, and an unreadable phase. Separately, a cached `invalid (error)` could pin a transient failure to a tip.
- **Fix:** These get refusal codes `trust-unusable`, `integrity-unreadable`, `no-framework`, `no-base`, `gates-config` and `unreadable` (each with dialog copy), and error verdicts are never cached.
- **Committed in:** b06ad9e, 6760cef

**5. [Rule 2 - Missing critical] Dialog validates the server's command**
- **Found during:** Task 2
- **Issue:** Pitfall 8 says the displayed command must contain only validated ids.
- **Fix:** The dialog rejects a prepared response unless its `command` equals `counterpoint approve {hostId} {phaseId}` built from the dialog's own ids, which are checked with the same id regexes.
- **Committed in:** 6760cef

---

**Total deviations:** 5 (2 blocking structure, 1 intended test update, 2 missing-critical).
**Impact on plan:** No new packages; the lockfile is unchanged. Each structural addition is a small module needed to keep a single source of approval truth.

## Issues Encountered

- With stdin from a Node pipe, `/usr/bin/script` failed with `tcgetattr/ioctl: Operation not supported on socket`, because Node pipes are sockets on macOS. Giving `script` `/dev/null` as stdin works: it still gives the child its own pty, and the CLI sees `isTTY` true.
- A Vitest `tap-flat` report with multi-line failure YAML is rejected by the RED classifier. Filtering to the target test produced a valid report.

## Known Stubs

None. The RED stubs were replaced in the GREEN commit.

## Threat Flags

None beyond the plan's register. The only new endpoint is the preview POST (T-01-47). It sits behind the existing session, Origin and JSON guards and writes nothing. The cache (T-01-48) is in-memory, keyed by tip and trusted fingerprint, and holds only verifier output.

## User Setup Required

None. A real approval on Cena stays the owner's manual step in 01-16.

## Next Phase Readiness

- **01-14 (change view):** `phase.approval.state === 'changed'` is now in the phases API. `ApprovalViews.state(runtime, phaseId)` returns the full `changes` / `gatesChange`. The dialog's landed and stale logic can be reused for "Sign the new version".
- **01-15 (Needs You, Trust card):** `runway.changedCount` is on `GET /runway` for the changed-since-signed banner above the Runway card. The Mission page already sets aside room below the card.

---
*Phase: 01-trusted-shell-signed-runway*
*Completed: 2026-11-09*

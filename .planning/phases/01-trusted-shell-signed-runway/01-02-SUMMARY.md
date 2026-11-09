---
phase: 01-trusted-shell-signed-runway
plan: 02
subsystem: infra
tags: [walking-skeleton, daemon, node-sqlite, hono, unix-socket, commander, vite, astryx, playwright-core]

# Dependency graph
requires:
  - phase: 01-01
    provides: "requireHome/homePaths/readConfig, registerHost(store, { cwd, base, detectFramework }), runGit, scratch helpers, toolchain"
provides:
  - "src/core/store/db.ts: openStore (WAL, user_version migrations), openStoreReadOnly, upsertHost, listHosts, getHost, hostRegistryStore"
  - "SQLite migration 1: STRICT tables hosts, login_codes, sessions, events"
  - "src/compose.ts: composition root with detectFramework (returns none until 01-07)"
  - "src/server/control.ts: createControlApp (bearer SHA-256 + timingSafeEqual; GET /control/status, POST /control/hosts, POST /control/stop), hashToken"
  - "src/server/app.ts: createApp (exact Host allowlist 127.0.0.1:{port}, GET /api/hosts, static SPA + index fallback, 503 when unbuilt), resolveUiDir, packageRoot"
  - "src/server/daemon.ts: runDaemon (BEGIN EXCLUSIVE lock, 0600 token, HTTP on 127.0.0.1, 0600 control socket, daemon.json, start-result.json), socketAnswers"
  - "src/cli/main.ts: counterpoint default start (--port, --base, --no-open), stop, hidden __daemon, --version"
  - "src/cli/control-client.ts: controlRequest, isDaemonRunning, DaemonUnreachableError"
  - "ui/: Vite 8 + React 19 + Astryx console (Theme + AppShell + TopNav) listing hosts from /api/hosts"
  - "tests/e2e/global-setup.ts (pnpm build:ui once) and tests/e2e/skeleton.e2e.test.ts"
affects: [01-03, 01-04, 01-07, 01-09, 01-16]

actuals:
  tokens: 11400   # chars/4 over the 14 files changed (45,659 chars)
  tasks: 1
  commits: 1      # MEASURED: git rev-list --count 1e574a8..HEAD before the SUMMARY commit
plan_head_before: 1e574a8b586b04e18c9e2a2129fb5faebd0ff1ca
plan_head_after: 391c52fd5917285783197b98b4b08f1c18d713df

tech-stack:
  added: []
  patterns:
    - "Daemon boot order: lock, token, HTTP bind, then control socket last, so 'the socket answers' means fully up"
    - "CLI re-enters itself as the daemon: spawn(process.execPath, [cli file, '__daemon', '--port', n]) detached with an allow-listed env and stdio to logs/daemon.log"
    - "Control channel = HTTP over the 0600 Unix socket with a bearer token read from the 0600 token file; never argv/env"
    - "Daemon is the only SQLite writer; host rows written via hostRegistryStore(db) adapter for core's registerHost"
    - "Daemon writes run/start-result.json for failures the CLI must word (port-in-use)"
    - "UI built by Vite to dist/ui; server resolves it from the @hkp/counterpoint package root, never the cwd"

key-files:
  created:
    - src/core/store/db.ts
    - src/compose.ts
    - src/server/control.ts
    - src/server/app.ts
    - src/server/daemon.ts
    - src/cli/main.ts
    - src/cli/control-client.ts
    - ui/tsconfig.json
    - ui/vite.config.ts
    - ui/index.html
    - ui/src/styles.css
    - ui/src/main.tsx
    - tests/e2e/global-setup.ts
    - tests/e2e/skeleton.e2e.test.ts
  modified: []

key-decisions:
  - "HTTP binds before the control socket opens (plan listed the socket first): the CLI treats an answering socket as 'up', so a port-in-use failure can never look like a successful start"
  - "Daemon sets umask 0o077 and creates the token with O_EXCL ('wx'), so run/, logs/, state.db, token, daemon.json and the socket are owner-only from creation"
  - "Missing or invalid home exits 2; port in use and failed starts exit 1; a base-branch refusal still prints the running line and then the refusal, exit 1"
  - "Running outside a git repository starts the daemon and registers nothing (the plan's flagged FOUND-01 assumption)"
  - "createApp takes the actually bound port; the daemon creates the app after listen (port 0 → ephemeral), answering 503 for the instant before"
  - "--no-open is accepted and is a no-op until the sign-in flow (01-03)"

patterns-established:
  - "e2e tests drive the real CLI with node src/cli/main.ts, a scratch COUNTERPOINT_HOME and an allow-listed env"
  - "e2e browser checks use playwright-core with the system Chrome (CP_CHROME_PATH override); no browser download"

requirements-completed: []  # FOUND-01 declared by this plan; left Pending because sibling plans (01-16 proves the npx path) also declare it and have no SUMMARY yet (requirements.ready-ids reported it blocked)

coverage:
  - id: D1
    description: "counterpoint in a git repo starts one background daemon, registers the repo as a host row in SQLite and prints Counterpoint is running at http://127.0.0.1:{port}/; GET /api/hosts returns it"
    requirement: FOUND-01
    verification:
      - kind: e2e
        ref: "tests/e2e/skeleton.e2e.test.ts#starts one background daemon, registers the repo and prints the console URL"
        status: pass
    human_judgment: false
  - id: D2
    description: "The Vite-built Astryx page served at / shows the registered host's name"
    requirement: FOUND-01
    verification:
      - kind: automated_ui
        ref: "tests/e2e/skeleton.e2e.test.ts#serves the Astryx console, which shows the registered host"
        status: pass
    human_judgment: false
  - id: D3
    description: "HTTP bound to 127.0.0.1 only; any Host header other than 127.0.0.1:{port} (including localhost) gets 403"
    requirement: FOUND-01
    verification:
      - kind: e2e
        ref: "tests/e2e/skeleton.e2e.test.ts#answers 403 to a Host header other than 127.0.0.1:{port}"
        status: pass
    human_judgment: false
  - id: D4
    description: "Second start while running prints Counterpoint is already running at … and starts no second daemon (same pid)"
    requirement: FOUND-01
    verification:
      - kind: e2e
        ref: "tests/e2e/skeleton.e2e.test.ts#does not start a second daemon while one runs"
        status: pass
    human_judgment: false
  - id: D5
    description: "Missing COUNTERPOINT_HOME is refused with the UI-SPEC copy, non-zero exit, and the directory is not created"
    requirement: FOUND-01
    verification:
      - kind: e2e
        ref: "tests/e2e/skeleton.e2e.test.ts#refuses a missing home and creates nothing"
        status: pass
    human_judgment: false
  - id: D6
    description: "Port already in use prints the UI-SPEC copy and exits 1"
    requirement: FOUND-01
    verification:
      - kind: e2e
        ref: "tests/e2e/skeleton.e2e.test.ts#refuses a port that is already in use"
        status: pass
    human_judgment: false
  - id: D7
    description: "counterpoint stop stops the daemon with the UI-SPEC copy; a second stop prints Counterpoint is not running. and exits 0"
    requirement: FOUND-01
    verification:
      - kind: e2e
        ref: "tests/e2e/skeleton.e2e.test.ts#stops the daemon, and a second stop says it is not running"
        status: pass
    human_judgment: false
  - id: D8
    description: "Typecheck (root + ui projects), Biome lint and the unit suite stay green"
    verification:
      - kind: other
        ref: "pnpm typecheck && pnpm lint && pnpm test"
        status: pass
    human_judgment: false
  - id: D9
    description: "Console page looks right in a real browser (theme, layout, font) for the owner"
    verification: []
    human_judgment: true
    rationale: "Visual quality of the Astryx page is not asserted by any test; the e2e only checks the host name and heading render"

duration: 8min
completed: 2026-11-09
status: complete
---

# Phase 1 Plan 02: Walking Skeleton Summary

**`counterpoint` starts one detached daemon behind a `BEGIN EXCLUSIVE` SQLite lock. The daemon writes the current repo as a `hosts` row, serves an Astryx (Vite 8 / React 19) console on 127.0.0.1 with an exact Host allowlist, and is controlled over a 0600 Unix socket with a bearer token. `counterpoint stop` shuts it down. A missing home, a taken port and a second start all get the UI-SPEC copy.**

## Performance

- **Duration:** about 8 min
- **Started:** 2026-11-09T16:17:28Z
- **Completed:** 2026-11-09T16:25:05Z
- **Tasks:** 1
- **Files created:** 14

## Accomplishments

- The full tracer path works end to end: CLI, detached daemon, SQLite migration and host row, HTTP on 127.0.0.1, then the Vite-built Astryx page rendering the host from `GET /api/hosts`. Headless system Chrome checks it in the e2e test.
- Single instance comes from `BEGIN EXCLUSIVE` on `run/daemon.lock.db` with `timeout: 0`. Liveness is "the control socket answers", never a pid file. A manual `kill -9` check showed the kernel releases the lock: `stop` then printed `Counterpoint is not running.` and the next start logged `stale-socket-removed` and came up cleanly.
- Control socket security: `run/` is 0700, and the socket and token are 0600 (checked with `stat`). The token is 32 random bytes in hex; the daemon keeps only its SHA-256 and compares with `timingSafeEqual`. The token never appears in the daemon log (checked with grep).
- The CLI wording matches the UI-SPEC CLI Surface Contract for running, already running, missing home, port in use, stop and stop-when-stopped.

## Task Commits

1. **Task 1: End-to-end "counterpoint starts, registers this repo and the console shows it"** - `391c52f` (feat)

**Plan metadata:** recorded in the docs commit that adds this SUMMARY.

## Files Created/Modified

- `src/core/store/db.ts` - node:sqlite store, `PRAGMA user_version` migrations, migration 1 STRICT tables, host repository and the `HostRegistryStore` adapter
- `src/compose.ts` - composition root; `detectFramework` returns `none` for now
- `src/server/control.ts` - control-socket Hono app with bearer auth, status, host registration (zod body, 422 with registry copy) and stop
- `src/server/app.ts` - console Hono app: Host allowlist, `/api/hosts`, static `dist/ui` with SPA fallback, 503 `Console not built. Run pnpm build:ui.`; `resolveUiDir`/`packageRoot`
- `src/server/daemon.ts` - daemon boot and shutdown (lock, token, HTTP, socket, daemon.json, start-result.json, SIGTERM/SIGINT)
- `src/cli/main.ts` - commander CLI: start/attach, stop (with SIGTERM then SIGKILL fallback when the socket is dead but the lock is held), hidden `__daemon`
- `src/cli/control-client.ts` - HTTP over the Unix socket with the bearer token from the token file
- `ui/tsconfig.json`, `ui/vite.config.ts`, `ui/index.html`, `ui/src/styles.css`, `ui/src/main.tsx` - Astryx console (CSS order reset, astryx, theme-neutral, then self-hosted Figtree 400/500/600/700)
- `tests/e2e/global-setup.ts` - builds the UI once per e2e run
- `tests/e2e/skeleton.e2e.test.ts` - 7 ordered e2e cases covering every must-have truth

## Decisions Made

- **Boot order.** The HTTP server binds before the control socket opens. The plan lists the socket first, but the CLI decides "started" by the socket answering. Binding HTTP first means a port-in-use failure is reported through `start-result.json` before any socket exists, so a failed start can never look like a successful one.
- **Owner-only from creation.** The daemon sets `umask 0o077` and creates the token with `O_EXCL`. Nothing the daemon writes is readable by others, even in the short gap before the explicit `chmod`.
- **Exit codes.** A missing or invalid home exits 2. A taken port or a failed start exits 1. A base-branch refusal while registering still prints the running line (the daemon is up), then the refusal, and exits 1.
- **Outside a git repo.** The daemon starts, nothing is registered, and the URL is printed (the plan's flagged FOUND-01 assumption).
- **`--no-open`.** The flag is accepted but does nothing yet. Opening the browser and the sign-in link arrive in 01-03.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] playwright-core types need the DOM lib**
- **Found during:** Task 1 (typecheck)
- **Issue:** With `skipLibCheck: false` and `lib: ["ES2024"]`, `tsc` reported hundreds of `Cannot find name 'HTMLElement'/'SVGElement'` errors inside `playwright-core/types/types.d.ts`.
- **Fix:** Added `/// <reference lib="dom" />` at the top of `tests/e2e/skeleton.e2e.test.ts` only. The root tsconfig is unchanged.
- **Files modified:** tests/e2e/skeleton.e2e.test.ts
- **Verification:** `pnpm typecheck` exits 0.
- **Committed in:** 391c52f

**2. [Rule 2 - Missing critical] Readiness ordering and private file modes**
- **Found during:** Task 1 (daemon)
- **Issue:** If the socket opened first, as listed, a start that later hit `EADDRINUSE` could briefly answer as running. A default umask would also leave a window where new files had group/other bits.
- **Fix:** Bind HTTP first, open the control socket last, and set `process.umask(0o077)` plus `O_EXCL` token creation.
- **Files modified:** src/server/daemon.ts
- **Verification:** The e2e port-in-use case exits 1 with the copy. `stat` shows the socket and token at 0600 and `run/`, `logs/` at 0700.
- **Committed in:** 391c52f

**3. [Rule 1 - Bug] Host allowlist literal**
- **Found during:** Task 1 (acceptance criteria)
- **Issue:** The allowlist was written as `127.0.0.1:${options.port}`, which failed the criterion that requires the literal `127.0.0.1:${port}`. Behaviour was identical.
- **Fix:** Destructured `port` from the options.
- **Files modified:** src/server/app.ts
- **Verification:** `grep -F` matches; e2e still passes 7/7.
- **Committed in:** 391c52f

---

**Total deviations:** 3 auto-fixed (1 blocking, 1 missing-critical, 1 bug).
**Impact on plan:** None changes scope. No packages were added; the lockfile is unchanged.

## Issues Encountered

- `biome ci` flagged import order and line wrapping in three new files; `biome check --write` fixed them (formatting only).
- Vite warns that the single JS chunk is 554 kB (178 kB gzip), as research predicted. Code-splitting is left for later.

## Known Stubs

| File | Line | Stub | Resolved by |
|------|------|------|-------------|
| src/compose.ts | 11 | `detectFramework` always returns `none` (no adapter is composed yet; the plan specifies this) | 01-07 (adapter `detect` at the base tip) |
| src/cli/main.ts | 210 | `--no-open` accepted but the browser is never opened; no sign-in link is printed yet | 01-03 (sign-in flow) |

Neither stub blocks this plan's goal. Both are named in the plan as arriving later. `.planning/WINDOWS.md` does not exist, so nothing was added to the ledger.

## User Setup Required

None. To run the skeleton by hand: `pnpm build:ui && COUNTERPOINT_HOME=<existing dir> node src/cli/main.ts --no-open` inside a git repo, then `node src/cli/main.ts stop`.

## Next Phase Readiness

- 01-03 can add `/login`, sessions (the tables already exist), `/control/login-code`, the Origin and content-type guard on non-GET `/api/*`, and browser opening on top of `createApp` / `createControlApp` / `start()`.
- 01-07 swaps the body of `detectFramework` in `src/compose.ts`; callers do not change.
- e2e note: from a deep agent worktree, run e2e with `CP_TEST_SCRATCH=/Volumes/Dock/Dev/Caches/cp-test`. Otherwise the scratch-home socket path exceeds 103 bytes and `homePaths` throws.

---
*Phase: 01-trusted-shell-signed-runway*
*Completed: 2026-11-09*

## Self-Check: PASSED

- All 14 key files exist on disk (`git show --stat 391c52f`).
- Commit 391c52f is on this branch (`git rev-list 1e574a8..HEAD`).
- Acceptance criteria re-run: every grep passes (BEGIN EXCLUSIVE, `hostname: '127.0.0.1'`, `127.0.0.1:${port}`, `/api/hosts`, `__daemon`, `detached: true`, `detectFramework` in control.ts and exported from compose.ts, `astryx.css` and `latin-600.css` present and `fonts.css` absent in styles.css).
- Plan verification: `pnpm typecheck` 0, `pnpm lint` 0, `pnpm test` 111/111, `CP_TEST_SCRATCH=/Volumes/Dock/Dev/Caches/cp-test pnpm test:e2e` 7/7; no daemon processes left behind.

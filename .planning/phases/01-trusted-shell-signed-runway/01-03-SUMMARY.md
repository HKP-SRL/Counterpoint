---
phase: 01-trusted-shell-signed-runway
plan: 03
subsystem: auth
tags: [one-time-login, session-cookie, loopback-guard, csp, sse, last-event-id, outbox, hono, node-sqlite, commander]

# Dependency graph
requires:
  - phase: 01-02
    provides: "createApp/createControlApp/runDaemon, openStore with login_codes/sessions/events tables, controlRequest/isDaemonRunning, CLI start/stop"
provides:
  - "src/core/security/login.ts: mintLoginCode, consumeLoginCode (single conditional UPDATE), createSession, validateSession, clearAllSessions, deleteStaleLoginCodes, SESSION_COOKIE, LOGIN_CODE_TTL_MS, SESSION_TTL_MS"
  - "src/core/security/guard.ts: hostGuard, mutationGuard, sseGuard, sessionGuard, securityHeaders, CONSOLE_CSP, hostCheckedServer, PortGetter"
  - "src/core/store/events.ts: EVENT_FAMILIES, appendEvent, listEventsSince, latestEventSeq, EventBus, publishEvent, isEventFamily"
  - "src/server/sse.ts: mountEvents (GET /api/events), DEFAULT_HEARTBEAT_MS"
  - "HTTP: GET /login?code=, GET /api/events (SSE); every /api/* behind the session check"
  - "Control socket: POST /control/login-code, POST /control/notify; POST /control/hosts now emits a host event"
  - "CLI: counterpoint init, counterpoint status, counterpoint open [--no-open]; start prints and opens the sign-in link"
  - "createApp now requires a bus (EventBus) and takes an optional heartbeatMs; createControlApp requires the same bus"
affects: [01-04, 01-07, 01-09, 01-13, 01-14, 01-16]

actuals:
  tokens: 17500   # chars/4 over the added lines of the plan diff (69,957 chars)
  tasks: 3
  commits: 6      # MEASURED: git rev-list --count fbf0412..HEAD before the SUMMARY commit
plan_head_before: fbf04122fbf2aba2c2b0b163bbbe3e05f46309a7
plan_head_after: 7ad992d74e1238f96f662d430b821d33c493b4ae

tech-stack:
  added: []
  patterns:
    - "Guard chain order in createApp: hostGuard → securityHeaders → mutationGuard(/api/*) → mountEvents (route-level sseGuard + sessionGuard) → sessionGuard(/api/*) → routes"
    - "Transport-level Host check: serve({ createServer: hostCheckedServer }) so a missing or malformed Host is a 403 before the HTTP adapter parses it"
    - "Secrets (sign-in codes, session ids) are 32 random bytes base64url; only sha256 hex is stored; format-checked before hashing"
    - "Outbox + bus: publishEvent appends to SQLite then emits; SSE id = seq; subscribe before replay and buffer, so nothing is lost mid-replay"
    - "API routes added after createApp stay reachable: the /api 404 catch-all is GET-only and the 'console not built' 503 only applies to page GETs"
    - "Lifecycle CLI tests drive node src/cli/main.ts against scratch homes with --no-open; they never open a browser"

key-files:
  created:
    - src/core/security/login.ts
    - src/core/security/guard.ts
    - src/core/store/events.ts
    - src/server/sse.ts
    - tests/server/login.test.ts
    - tests/server/guard.test.ts
    - tests/server/sse.test.ts
    - tests/cli/lifecycle.test.ts
  modified:
    - src/server/app.ts
    - src/server/control.ts
    - src/server/daemon.ts
    - src/cli/main.ts
    - tests/e2e/skeleton.e2e.test.ts

key-decisions:
  - "hostCheckedServer wraps the daemon's http.Server (requireHostHeader: false plus an exact Host check) because @hono/node-server and Node itself answer a missing or malformed Host with 400 before any middleware runs; every wrong Host is now 403 blocked"
  - "Only a real GET consumes a sign-in code; HEAD /login answers 405 so link previews or prefetch cannot burn the owner's link"
  - "/login redirects to the most recently created host (created_at, then id); with no host it redirects to /"
  - "SSE without Last-Event-ID starts after the newest event (the client has a fresh snapshot); after any replay a 'ready' frame carries the newest seq as its id so the browser reconnects from the right place"
  - "mountEvents applies sseGuard then sessionGuard itself and is mounted before the shared session guard, so a foreign Origin gets 403 before the session is checked (same order as writes)"
  - "POST /control/notify takes a strict { hostId, family } body (extra keys rejected), so payloads can never carry file contents"
  - "init checks the control-socket path length before creating anything and refuses a home path that exists as a file"

patterns-established:
  - "Raw node:http with setHost: false for Host-header tests; fetch cannot set or omit Host"
  - "Test-only API routes mount on the app returned by createApp (app.post('/api/__test/echo'))"
  - "SSE tests parse frames from a raw node:http stream and wait on predicates, never fixed sleeps"

requirements-completed: []  # FOUND-01 and FOUND-02 are declared here and also by 01-09 / 01-16, which have no SUMMARY yet; left Pending as 01-02 did

coverage:
  - id: D1
    description: "Sign-in codes: 32-byte base64url, only sha256 stored, 5-minute expiry, single use; two concurrent consumes of one code yield exactly one success"
    requirement: FOUND-02
    verification:
      - kind: unit
        ref: "tests/server/login.test.ts#lets exactly one of two concurrent consumes of one code succeed"
        status: pass
      - kind: unit
        ref: "tests/server/login.test.ts#mints a 32-byte base64url code and stores only its sha256 with a 5-minute expiry"
        status: pass
    human_judgment: false
  - id: D2
    description: "GET /login with a fresh code sets cp_session=…; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200 (no Secure) and 302s to /h/{hostId}; a used, unknown, missing or expired code 302s to /signed-out?reason=used without a cookie; two concurrent requests with one code create one session"
    requirement: FOUND-02
    verification:
      - kind: integration
        ref: "tests/server/login.test.ts#GET /login"
        status: pass
    human_judgment: false
  - id: D3
    description: "Sessions hashed at rest with a 12 h expiry; tampered, unknown and expired values rejected; a restarted daemon has signed every browser out"
    requirement: FOUND-02
    verification:
      - kind: unit
        ref: "tests/server/login.test.ts#sessions"
        status: pass
      - kind: integration
        ref: "tests/cli/lifecycle.test.ts#a restarted daemon has signed every browser out"
        status: pass
    human_judgment: false
  - id: D4
    description: "counterpoint start and open print 'Sign-in link (works once): http://127.0.0.1:{port}/login?code={code}', minted over the control socket; open refuses when not running; the printed link signs in once"
    requirement: FOUND-01
    verification:
      - kind: integration
        ref: "tests/cli/lifecycle.test.ts#counterpoint status, open and the sign-in link"
        status: pass
    human_judgment: false
  - id: D5
    description: "counterpoint init creates only the final home directory (0700), refuses a missing parent with nothing created, reports an existing home as ready; status prints '{host}  running on 127.0.0.1:{port}' or 'not running'"
    requirement: FOUND-01
    verification:
      - kind: integration
        ref: "tests/cli/lifecycle.test.ts#counterpoint init"
        status: pass
      - kind: integration
        ref: "tests/cli/lifecycle.test.ts#status prints one line per host with its port"
        status: pass
    human_judgment: false
  - id: D6
    description: "Over a real 127.0.0.1 socket: any Host other than 127.0.0.1:{port} (localhost, IPv6 loopback, evil.example, localhost.evil.example, localhost@evil.example, other port, no port, missing) gets 403 blocked; a non-loopback interface refuses the connection"
    requirement: FOUND-02
    verification:
      - kind: integration
        ref: "tests/server/guard.test.ts#Host allowlist"
        status: pass
      - kind: integration
        ref: "tests/server/guard.test.ts#refuses a connection on a non-loopback interface"
        status: pass
    human_judgment: false
  - id: D7
    description: "Non-GET /api/*: missing, localhost, https, null, other-port or foreign Origin → 403; Sec-Fetch-Site other than same-origin → 403; non-JSON body → 415; checked before the session (403 not 401); every unsafe method covered"
    requirement: FOUND-02
    verification:
      - kind: integration
        ref: "tests/server/guard.test.ts#mutation guard on non-GET /api/*"
        status: pass
    human_judgment: false
  - id: D8
    description: "Every /api/* request (GET and SSE included) without a valid session answers 401 { error: 'signed-out' }; console pages including /signed-out are served without a session"
    requirement: FOUND-02
    verification:
      - kind: integration
        ref: "tests/server/guard.test.ts#session on every /api/* request"
        status: pass
    human_judgment: false
  - id: D9
    description: "HTML responses carry the exact CONSOLE_CSP, Referrer-Policy no-referrer, X-Frame-Options DENY and nosniff; the Astryx console still renders under that CSP in headless Chrome"
    requirement: FOUND-02
    verification:
      - kind: integration
        ref: "tests/server/guard.test.ts#security headers"
        status: pass
      - kind: e2e
        ref: "tests/e2e/skeleton.e2e.test.ts#serves the Astryx console, which shows the registered host"
        status: pass
    human_judgment: false
  - id: D10
    description: "Events outbox and GET /api/events: Last-Event-ID (header or lastEventId query) replays later events first, then live ones; heartbeat comments; 401 without a session; 403 for a foreign Origin or cross-site fetch; listeners removed when the client goes away"
    requirement: FOUND-02
    verification:
      - kind: integration
        ref: "tests/server/sse.test.ts#GET /api/events"
        status: pass
      - kind: unit
        ref: "tests/server/sse.test.ts#events outbox"
        status: pass
    human_judgment: false
  - id: D11
    description: "POST /control/notify appends and emits a valid { hostId, family } event (202 with seq); unknown family, invalid host id, extra fields or a missing family → 400; the bearer token is required"
    requirement: FOUND-02
    verification:
      - kind: integration
        ref: "tests/server/sse.test.ts#POST /control/notify"
        status: pass
    human_judgment: false
  - id: D12
    description: "The 01-02 walking-skeleton e2e still passes, now signing in through the printed one-time link before reading /api/hosts"
    requirement: FOUND-01
    verification:
      - kind: e2e
        ref: "tests/e2e/skeleton.e2e.test.ts"
        status: pass
    human_judgment: false
  - id: D13
    description: "Starting without --no-open opens the sign-in link in the owner's default browser (/usr/bin/open on macOS) and lands on the console signed in"
    requirement: FOUND-01
    verification: []
    human_judgment: true
    rationale: "Every automated test passes --no-open so no test ever opens the owner's browser; the open path is only checked by hand"

duration: 17min
completed: 2026-11-09
status: complete
---

# Phase 1 Plan 03: Sign-in, Request Guard and Live Events Summary

**The console now has an owner credential and a full request guard. The CLI asks the daemon, over the token-protected socket, for a single-use 32-byte sign-in code. `GET /login` swaps the code for a hashed, 12-hour `HttpOnly; SameSite=Strict` session. Every `/api` request passes an exact-Host, exact-Origin, JSON-only and session guard; wrong Hosts are refused even before the HTTP adapter parses the request. An SQLite events outbox feeds `GET /api/events` (SSE) with `Last-Event-ID` replay and heartbeats. `init`, `status` and `open` complete the lifecycle commands.**

## Performance

- **Duration:** about 17 min
- **Started:** 2026-11-09T16:29:21Z
- **Completed:** 2026-11-09T16:46:30Z
- **Tasks:** 3 (each as a RED then GREEN commit)
- **Files:** 8 created, 5 modified

## Accomplishments

- **Sign-in (D-07).** `counterpoint` and `counterpoint open` print `Sign-in link (works once): http://127.0.0.1:{port}/login?code=…` and open it unless `--no-open`. The code is minted only by `POST /control/login-code` on the 0600 socket. A code is used up by a single conditional `UPDATE … WHERE used_at IS NULL AND expires_at > ?`, so concurrent requests cannot both win. This is proven at the function level and through two simultaneous HTTP requests.
- **Request guard (FOUND-02).** Every rejection path in the plan is proven over a real 127.0.0.1 socket with raw `node:http` (table-driven rows). Hosts: `localhost`, IPv6 loopback, `evil.example`, `localhost.evil.example`, `localhost@evil.example`, another port, no port, and no Host at all. Origins: missing, `localhost`, `https`, `null`, foreign. `Sec-Fetch-Site` values `cross-site`, `same-site` and `none`. Non-JSON bodies get 415. A test also walks `app.routes` and confirms every GET `/api` route answers 401 without a session.
- **CSP.** The RESEARCH CSP (`style-src 'self' 'unsafe-inline'` for Astryx, strict scripts) is on every response. The headless-Chrome e2e confirms the console still renders under it.
- **Live events.** `publishEvent` appends to the outbox and emits on one shared bus. The SSE stream subscribes before it replays, so events written during the replay are buffered rather than lost. After the replay it sends a `ready` frame carrying the newest seq, and it unsubscribes when the client disconnects.
- **Lifecycle.** `init` creates only the final directory with mode 0700 and refuses a missing parent. `status` prints `{host}  running on 127.0.0.1:{port}` (it will add runway and needs-you counts once the daemon reports them). A restarted daemon clears every session.

## Task Commits

1. **Task 1: One-time sign-in link, sessions, init/status/open**
   - RED `6a286cc` (test). Stub `login.ts` throws; 35 of 37 fail.
   - GREEN `776e2c1` (feat).
2. **Task 2: Request guard and security headers over a real socket**
   - RED `3e3122e` (test). Pass-through `guard.ts`; 27 of 38 fail.
   - GREEN `c288ee2` (feat).
3. **Task 3: Live-events outbox and SSE with Last-Event-ID replay**
   - RED `f9b8820` (test). Stub `events.ts` and `sse.ts`; 15 of 18 fail.
   - GREEN `7ad992d` (feat).

**Plan metadata:** the docs commit that adds this SUMMARY.

## Files Created/Modified

- `src/core/security/login.ts`: sign-in codes and sessions (hashed, expiring, single use), `clearAllSessions`, `deleteStaleLoginCodes`
- `src/core/security/guard.ts`:
  - `hostGuard`, `mutationGuard`, `sseGuard`, `sessionGuard`, `securityHeaders`, `CONSOLE_CSP`
  - `hostCheckedServer`, the transport-level Host check
  - the WR-01 note: the Host check stops browsers; only the bind stops LAN clients
- `src/core/store/events.ts`: `EVENT_FAMILIES`, `appendEvent`, `listEventsSince`, `latestEventSeq`, `EventBus`, `publishEvent`
- `src/server/sse.ts`: `mountEvents` for `GET /api/events` (replay, buffer, `ready` frame, heartbeat, abort cleanup)
- `src/server/app.ts`:
  - the guard chain and `GET /login`
  - `mountEvents`, with the `bus` and `heartbeatMs` options
  - a GET-only `/api` 404, and the 503 for an unbuilt console now applies only to page GETs
- `src/server/control.ts`: `POST /control/login-code`, `POST /control/notify` (strict zod body), a `host` event on registration
- `src/server/daemon.ts`:
  - clears sessions and stale codes on start
  - serves through `hostCheckedServer`
  - creates one `EventBus` shared by both apps
- `src/cli/main.ts`:
  - sign-in link printing, and opening via `/usr/bin/open` or `xdg-open` (argument array, URL regex-checked first)
  - the `open`, `status` and `init` commands
- `tests/server/login.test.ts`, `tests/server/guard.test.ts`, `tests/server/sse.test.ts`, `tests/cli/lifecycle.test.ts`: new suites, 93 tests in total
- `tests/e2e/skeleton.e2e.test.ts`: signs in through the printed link before `/api/hosts`; the browser lands on `/h/{hostId}`

## Decisions Made

See `key-decisions` in the frontmatter. The two with the widest effect:

- **Transport-level Host check.** `@hono/node-server` (`buildUrl` raises `RequestError`) and Node's `requireHostHeader` both answer a missing or malformed Host with **400** before Hono runs. The must-have requires 403 for those cases too. `hostCheckedServer` turns off Node's check and applies the exact `127.0.0.1:{port}` comparison first. `hostGuard` stays as the app-level check, so `app.request()` tests and any other server still get it.
- **SSE start point.** A connection without `Last-Event-ID` starts after the newest event instead of replaying the whole history. The `ready` frame then sets the browser's `lastEventId`, so a later reconnect replays exactly what was missed even if no event arrived in between.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Missing or malformed Host answered 400, not 403**
- **Found during:** Task 2 (guard tests)
- **Issue:** The adapter and Node's HTTP parser reject these requests before any middleware runs, so `hostGuard` alone could not produce the required 403.
- **Fix:** Added `hostCheckedServer` (`requireHostHeader: false` plus the exact Host check). The daemon and the socket tests pass it to `serve({ createServer })`.
- **Files modified:** src/core/security/guard.ts, src/server/daemon.ts
- **Verification:** The `missing Host` and `localhost@evil.example` rows answer 403 `{ error: 'blocked' }`.
- **Committed in:** c288ee2

**2. [Rule 2 - Missing critical] HEAD /login would have used up the code**
- **Found during:** Task 1
- **Issue:** Hono routes HEAD to GET handlers, so a link preview or prefetch could burn the owner's single-use link.
- **Fix:** `/login` answers 405 to anything but a real GET.
- **Files modified:** src/server/app.ts
- **Verification:** `login.test.ts#does not consume the code on a HEAD request`
- **Committed in:** 776e2c1

**3. [Rule 2 - Missing critical] SSE reconnect point when the client sent no Last-Event-ID**
- **Found during:** Task 3
- **Issue:** The plan only defined replay after a given id. A stream that had seen no events would reconnect without an id and lose anything written in between.
- **Fix:**
  - Without an id, the stream starts after the newest seq.
  - A `ready` frame with that seq follows the replay.
  - Live events are buffered during the replay.
- **Files modified:** src/server/sse.ts
- **Verification:** `sse.test.ts#without Last-Event-ID streams only new events` and the replay-then-live test
- **Committed in:** 7ad992d

**4. [Rule 3 - Blocking] Routes mounted after createApp were unreachable**
- **Found during:** Task 2
- **Issue:** The plan's guard test mounts `app.post('/api/__test/echo')` on the returned app. 01-02's `app.all('/api/*')` 404 and the 503 middleware answered first.
- **Fix:**
  - The `/api` 404 catch-all is GET-only.
  - The 503 "console not built" response only applies to page GETs outside `/api`.
- **Files modified:** src/server/app.ts
- **Verification:** The echo route answers 200 to a valid request; GETs of unknown `/api` paths still return JSON 404.
- **Committed in:** c288ee2

**5. [Rule 2 - Missing critical] init could create an unusable home**
- **Found during:** Task 1
- **Issue:** The plan did not cover a socket path over 103 bytes or a path that exists as a file.
- **Fix:** `init` runs `homePaths(home)` first (exit 2 with the socket-length message) and refuses an existing non-directory with exit 2.
- **Files modified:** src/cli/main.ts
- **Verification:** typecheck; the existing lifecycle cases still pass.
- **Committed in:** 776e2c1

**6. [Rule 1 - Bug, test only] Race in the SSE cleanup test**
- **Found during:** Task 3 GREEN
- **Issue:** The test read the listener count while the previous test's stream was still closing, then waited for that stale value.
- **Fix:** The test waits for exactly one listener (its own), then for zero. An isolated script confirmed that abort detection itself works.
- **Files modified:** tests/server/sse.test.ts
- **Verification:** sse + guard suites passed 5 runs in a row (56/56 each).
- **Committed in:** 7ad992d

### Other notes (no behaviour change)

- **Key link `control.ts → appendEvent`.** `/control/notify` calls `publishEvent`, which is `appendEvent` followed by the bus emit. The route comment names both. The plan's literal pattern `appendEvent` therefore appears in control.ts only in that comment; the call path is real.
- **Login unit tests use a scratch-file store** (`openStore(makeScratchDir(...))`), not a `:memory:` one. `db.ts` has no in-memory opener and is not in this plan's file list.
- **Wording the contract left open:**
  - `status` with no registered repositories prints `running on 127.0.0.1:{port}, no repositories registered yet`.
  - `init` prints `Created the Counterpoint home at "{path}".` when it creates the home.
- **RED evidence.** All three RED runs return `RED_EVIDENCE_OK` from `gsd-tools check tdd-red-evidence`. For Task 2, Vitest's `tap-flat` reporter writes invalid YAML for the CSP assertion (escaped quotes), so the target test was rerun on its own with `-t`, as the TDD reference allows. The Host rows were also renamed from `{port}`-style titles to plain words.

---

**Total deviations:** 6 auto-fixed (4 missing-critical, 1 blocking, 1 test-only bug).
**Impact on plan:** All are correctness or security tightenings inside the planned files. No packages were added; the lockfile is unchanged.

## TDD Gate Compliance

Each `tdd="true"` task has a `test(01-03)` commit followed by a `feat(01-03)` commit that descends from it: `6a286cc`→`776e2c1`, `3e3122e`→`c288ee2`, `f9b8820`→`7ad992d`. No refactor commits were needed.

| Task | Target test | Why it failed (RED) | Verdict |
|------|-------------|---------------------|---------|
| 1 | `login.test.ts > login codes > lets exactly one of two concurrent consumes of one code succeed` | The stub `consumeLoginCode` throws `not implemented` | `RED_EVIDENCE_OK` |
| 2 | `guard.test.ts > mutation guard on non-GET /api/* > rejects a missing Origin with 403` | The pass-through stub let the request reach the 404 catch-all | `RED_EVIDENCE_OK` |
| 3 | `sse.test.ts > GET /api/events > replays events after Last-Event-ID first, then streams live ones` | The stub `appendEvent` throws; no stream exists | `RED_EVIDENCE_OK` |

Semantic check: in each case the named test ran and failed on the planned behaviour, not on an import, syntax or setup error. In each RED run the tests that passed covered behaviour 01-02 already shipped: its inline Host check, SPA pages, the 127.0.0.1 bind, the control bearer check and the cookie-name constant.

## Issues Encountered

- The isolation layer refused writes to the shared git dir, so the per-plan ledger file could not be written. The plan base `fbf0412` comes from the branch-check assertion, and `commits: 6` is measured with `git rev-list --count fbf0412..HEAD`.
- The Cena prior-art `guard.ts` could not be read (`git -C` outside the worktree is blocked). The port follows PATTERNS.md's excerpt and the WR-01 note.

## Known Stubs

None. The 01-02 stub "`--no-open` accepted but the browser is never opened" is resolved: start and open now open the link. `.planning/WINDOWS.md` does not exist, so nothing was added to the ledger.

## User Setup Required

None. To try it by hand: `pnpm build:ui`, then `COUNTERPOINT_HOME=<existing dir> node src/cli/main.ts` inside a git repo. The browser opens signed in. Use `node src/cli/main.ts open` for a fresh link and `node src/cli/main.ts stop` to stop.

## Next Phase Readiness

- **Later API routes** (`/api/hosts/:hostId/...`) get the guard chain automatically when registered inside `createApp` before the SPA fallback. Routes added after `createApp` still work for non-GET methods.
- **Nudging the console:** 01-07, 01-13 and 01-14 call `POST /control/notify { hostId, family }` and the open consoles get the event. Inside the daemon, use `publishEvent(store, bus, …)`.
- **Status counts:** 01-13 and 01-14 can add `runway` and `needsYou` numbers to each `/control/status` host entry; `counterpoint status` appends them as soon as they are present.
- **UI (01-09):** consume `GET /api/events` with `EventSource`, treat `event: ready` as "connected", show `/signed-out` on 401 and the `Request blocked` screen on 403.
- **Running tests from a worktree:** set `CP_TEST_SCRATCH` to a short path; scratch homes also hold Unix sockets.

---
*Phase: 01-trusted-shell-signed-runway*
*Completed: 2026-11-09*

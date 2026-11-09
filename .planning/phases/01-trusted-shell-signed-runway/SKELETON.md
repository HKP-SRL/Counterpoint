# Walking Skeleton — Counterpoint

**Phase:** 1
**Generated:** 2026-11-09

## Capability Proven End-to-End

The owner runs `counterpoint` inside a git repository; a background daemon bound to `127.0.0.1` registers that repository as a host in SQLite, and the Astryx console served by the daemon shows that host (plans 01-01 tracer, then 01-02 sign-in and 01-06 shell add the one-time sign-in link, the live-updates dot and the Light/Dark/System theme toggle).

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime | Node >= 24, ESM, TypeScript 7 with erasable syntax only; source runs directly through Node's built-in type stripping (`node src/cli/main.ts`) in dev and tests; tsdown bundles `dist/cli.mjs` for the package (01-12) | No transpile step in the inner loop; `node:sqlite` needs Node 24; TS 7 for `tsc --noEmit`; Biome because typescript-eslint cannot run on TS 7 |
| Process model | One background daemon per machine (D-05, D-06), started by `counterpoint`, controlled over a Unix socket (`run/daemon.sock`, dir 0700, socket 0600) with a bearer token from the 0600 `token` file; single instance via `node:sqlite` `BEGIN EXCLUSIVE` on `run/daemon.lock.db`; the CLI re-enters itself as the daemon through a hidden `__daemon` command | Crash-only: the kernel releases the lock on any death; liveness is "the socket answers", never a pid file |
| HTTP | Hono 4.13.17 + `@hono/node-server` 2.1.6, `serve({ hostname: '127.0.0.1' })`, default port 4170, exact Host allowlist `127.0.0.1:{port}` | The bind is the real LAN boundary (prototype WR-01); Host check stops DNS rebinding |
| Data layer | `node:sqlite` (WAL, STRICT tables, `PRAGMA user_version` migrations) owned by the daemon as the single writer; the CLI opens it read-only; files under `COUNTERPOINT_HOME` for logs, reports, trust material | Approvals are authority in git, never in the DB (derive, don't store) |
| Home | `COUNTERPOINT_HOME`, else `~/Library/Application Support/Counterpoint` (macOS) / XDG data dir (Linux); refuse to start and create nothing if missing; only `counterpoint init` creates it (D-08) | Owner's machine keeps app data on `/Volumes/Dock` |
| Auth | One-time sign-in code (32 random bytes, stored as SHA-256, 5 min, single use) exchanged for an `HttpOnly; SameSite=Strict` session cookie (12 h, hashed at rest, cleared on daemon start) (D-07, 01-02) | Agents run as the same OS user; the code is minted only over the token-protected socket |
| Live updates | SSE `/api/events` with `id:` = `events.seq`, `Last-Event-ID` replay, 25 s heartbeat; snapshots over HTTP via TanStack Query invalidated by SSE families (01-02, 01-06) | Reconnect for free; no polling in the browser |
| UI | React 19.3.1 + `@astryxdesign/core` 0.7.11 + `theme-neutral` 0.7.11 (prebuilt CSS, no StyleX plugin, no Tailwind/shadcn), TanStack Router + Query, Vite 8 build to `dist/ui`, served as a static SPA by the daemon | Locked owner decision (Astryx) |
| Git access | Every host-repo git call goes through `src/core/git/run.ts`: absolute git binary, argument arrays, clean env (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`, `GIT_OPTIONAL_LOCKS=0`), `-c core.hooksPath=/dev/null -c core.fsmonitor=false` | Repo-controlled hooks and fsmonitor executed in research tests |
| Framework boundary | Core defines the port (`src/core/framework/port.ts`); `src/adapters/gsd/*` implements it; `src/compose.ts` is the only importer of the GSD adapter; Biome `noRestrictedImports` overrides enforce it (ADPT-02) | Core never knows the SDD framework |
| Deployment | Local only. Dev: `pnpm build:ui && node src/cli/main.ts`. Package: `@hkp/counterpoint` (private, unpublished) with `bin: { counterpoint }`, packed with `pnpm pack` and installed globally under the npm prefix on `/Volumes/Dock/Dev` so `npx @hkp/counterpoint` resolves locally (01-12) | Owner decision this session; public release is v2 |
| Directory layout | `src/core/{approvals,runway,security,store,git,host,framework}`, `src/adapters/gsd`, `src/agent`, `src/doctor`, `src/server`, `src/cli`, `src/compose.ts`, `ui/{src,public,tests}`, `tests/{core,adapters,agent,doctor,server,cli,boundary,e2e,helpers,fixtures}` | Modular monolith with the adapter boundary in the import graph |
| Tests | Vitest 5 projects `unit` (node) and `e2e` (playwright-core driving the owner's system Chrome at `/Volumes/Dock/Applications/Google Chrome.app`); scratch dirs under the repo's `.tmp/` (on Dock) | No browser download; no internal-disk scratch |

## Stack Touched in Phase 1

- [ ] Project scaffold (package.json, pnpm, TS 7, Biome with the boundary rule, Vitest unit + e2e projects) — 01-01
- [ ] Routing — `GET /api/hosts` and the SPA route `/` (01-01), then `/login`, `/api/events`, `/h/{hostId}`, `/signed-out` (01-02, 01-06)
- [ ] Database — `hosts` row written on registration and read by `GET /api/hosts` (01-01)
- [ ] UI — Astryx page renders the registered host from the API (01-01); sign-in, theme toggle and live-updates dot (01-02, 01-06)
- [ ] Deployment — documented local full-stack run: `pnpm build:ui && node src/cli/main.ts` in a git repo; packaged global install in 01-12

## Out of Scope (Deferred to Later Slices)

- Running builds, gates, PRs, worktrees, the quota governor, the `AgentRunner` used for builds (Phase 2) — Phase 1 only spawns `claude -p` for the doctor's sandbox probe
- Merge approvals, parallel builds, honest counters (Phase 3)
- Drafts and the draft digest (Phase 4; the statement keeps an empty `draft` slot)
- Council, cards, decision write-back (Phases 5-6)
- Public npm release, Touch ID signing, no-framework adapter (v2)

## Subsequent Slice Plan

- Phase 2: an approved Cena phase builds overnight in its own worktree, judged by gate exit codes, ending in a green PR with a preview link (CLI first)
- Phase 3: console mission control, parallel builds, rebase on conflict, merge only by the owner's signed merge commit
- Phase 4: design drafts in Cena's design system and the structural visual gate
- Phase 5: council question cards and decisions written back through the adapter
- Phase 6: council meetings and deduplicated backlog filing

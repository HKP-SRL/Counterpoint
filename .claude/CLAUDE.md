## Project

**Counterpoint**

Counterpoint is a local mission-control tool for **fully autonomous spec-driven development with Claude Code**, led by its owner. The owner plans, decides and signs off designs well ahead of time in a planning lane; an autonomous build lane turns approved work into gated, per-feature pull requests with preview links, during the day or overnight. A council of role "seats" (product, design, tech, QA, and customer personas like a restaurant's Cook) works alongside both lanes: it meets at key steps, debates among itself, and turns what it finds into cards, backlog items and review notes for the owner — without ever blocking the lane.

It reads planning truth from the host project's SDD framework through adapters (OpenSpec first), runs as its own local server (`npx counterpoint`), and is built for the owner's own use on **Cena** first, as an open-source project to publish later as `@hkp/counterpoint`.

**Core Value:** **The owner can approve work and walk away, and come back to green, reviewable per-feature PRs with preview links — plus only the questions that genuinely need them.** Runway (approved, ready-to-build work ahead of the builder) is the headline metric; the system succeeds as it needs the owner *less*.

### Constraints

- **Agent runtime**: Claude Code only — spawn the owner's own `claude -p` binary and parse `stream-json` behind one swappable `AgentRunner` port (Agent SDK only as a later second implementation); sessions run non-`--bare` so subscription login and hooks work
- **UI**: Counterpoint's console is React 19 + Astryx (`@astryxdesign/core`, MIT, beta 0.7.x, StyleX prebuilt CSS + themes) — no shadcn, no Tailwind; served as a prebuilt SPA by the local server, live updates over SSE
- **Framework coupling**: core never knows which SDD framework is used — everything framework-specific goes through an adapter
- **Acts as the owner**: agent sessions, gates and services run with the owner's rights, login environment, tools and network — no sandbox. Approving is one click in the console; nothing is signed. Work reaches the base branch only through a PR the owner merges (decided 2026-11-12, `run-as-owner`)
- **Isolation**: builds never touch the owner's checkout — worktrees only
- **UI**: local server, host-agnostic, loopback-only
- **Context windows**: no hard-coded window sizes; budgets follow the model
- **Packaging**: npm package `@hkp/counterpoint` (owner's org); one package as a modular monolith with the adapter boundary enforced by import rules — split out an adapter package only when a second adapter exists
- **Install locations (owner's machine)**: tools, caches and app data live on `/Volumes/Dock`, never the internal disk

## Technology Stack

## Headline Decisions (read this first)

| # | Question | Decision |
|---|----------|----------|
| 1 | CLI + local web UI + live updates | One Node >=24 process: **Hono 4 + `@hono/node-server` 2** serving a prebuilt **Vite 8 / React 19 / Tailwind 4 / shadcn** SPA. **SSE** (not WebSocket) for server-to-UI push, plain `POST` for commands. Bound to `127.0.0.1` with Host/Origin checks. |
| 2 | Driving Claude Code | **Spawn the owner's own `claude -p` and read its `stream-json` events**, behind one internal `AgentRunner` port (`src/agent/`). Not the Agent SDK; the SDK is only a possible later second implementation of the same port. Context budget is enforced by the orchestrator from per-message usage, not by a model-obeyed hook. See section 2. |
| 3 | Git, PRs | Shell out to the real `git` and `gh` with **execa 10** (argument arrays, no shell). No git library. (Signature checks were removed 2026-11-12.) |
| 4 | State store | **SQLite via built-in `node:sqlite`** (WAL, STRICT tables, FTS5) for runs, items, approvals, attempts, gate results, events, council. **Files** for logs, screenshots, diffs. **Git** (host repo) for planning (specs, decisions, approved mocks). |
| 5 | Gates | Child processes in their own process group, judged by exit code only, output streamed to a log file plus a tail kept in SQLite. Machine-wide test lock = SQLite exclusive lock (the owner's existing `test-lock.ts` technique). |
| 6 | Visual gate | **`playwright-core` screenshots + `pixelmatch` 8** (with `pngjs`) as the exit-code check, **structural landmark comparison** as the second check, **vision-model review as advisory only**. Pixel diff needs hi-fi mocks. |
| 7 | Persona browser agents | **`@playwright/mcp` (exact-pinned) headless + isolated**, passed to the persona's `claude` session via `--mcp-config`. **Not** Claude in Chrome (needs a headed, logged-in real Chrome; unusable unattended). Computer use is not needed. |
| 8 | Element-pinned mock comments | **Build a small in-house overlay** (vanilla TS, Shadow DOM, injected by the mock server). Nothing off the shelf fits: Agentation is React-only and PolyForm Shield, Stagewise is an AGPL IDE, react-grab copies context but has no persistent comments, Vercel comments only work on Vercel deploys. |
| 9 | Reading `openspec/` | **Parse the host's committed `openspec/` natively** from git blobs at the base tip: `yaml` + zod for `.openspec.yaml`, **unified + remark-parse + remark-gfm** for proposals, task checkboxes and spec requirements, and position-exact splicing for write-back. The `openspec` CLI reads the working tree, so it is a dev-time tool only. **Do not use gray-matter.** |

## Recommended Stack

### Runtime and Language

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| Node.js | `>=24` in `engines` (develop on 24, CI on 24 and 26) | Runtime for CLI, server, orchestrator | 24 (Krypton) and 26 (Lithium) are both LTS as of 2026-10-28 per nodejs.org. 24 is the oldest line that carries `node:sqlite` at "release candidate" (Stability 1.2) without a flag. Node 22 is in maintenance and dropping it lets us use ESM-only deps that now require >=22. The owner's Cena repo already pins Node 26. | HIGH |
| TypeScript | 7.0.2 (`~7.0`) | Typecheck | 7.0 is `latest` on npm (the native-compiler line). Use it for `tsc --noEmit` and editor feedback. **Caveat:** `typescript-eslint` declares `typescript <6.1.0`, so ESLint+typescript-eslint cannot run on TS 7. That is why lint is Biome (below). `tsdown` accepts `^7`. | MEDIUM-HIGH |
| pnpm | 12.x (dev only) | Package manager | Matches the owner's existing repos. End users get npm via `npx`. | HIGH |

### Core Technologies

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| `claude` CLI (the owner's own install, not a dependency) | whatever the owner has | Run headless Claude Code sessions: builder, council seats, persona agents | See section 2. Spawned with `claude -p --output-format stream-json` through `AgentRunner`; usage, context window, rate limits and errors come from typed stream events. Judge sessions by protocol fields, never by claude's wording, because Claude Code updates almost daily. | HIGH |
| `zod` | 4.6.7 | Schemas for config, DB rows, API payloads, MCP tool inputs | One validation library serves everything. | HIGH |
| `@modelcontextprotocol/sdk` | 1.32.2 | Not yet a dependency. Counterpoint's own MCP endpoint for council seat tools | Council seats need tools like `file_backlog_item` and `post_pin_comment`. Counterpoint's server exposes them as an MCP endpoint and each session gets it through `--mcp-config`. Add it when the council lands. | MEDIUM |
| Hono | 4.13.17 | HTTP API, SSE, static file serving, mock serving + HTML injection | Web-standard Request/Response, tiny, `streamSSE()` helper built in, `hono/csrf` and `hono/secure-headers` middleware. Hono v5 is only a release candidate (`next` tag); v4 is `latest`. | HIGH |
| `@hono/node-server` | 2.1.6 | Node adapter | `latest` is 2.1.6 (Nov 2) and includes three security fixes (path backslashes, WebSocket host handling, upgrade socket errors). Peer range is `hono ^4 \|\| ^5.0.0-0`. | HIGH |
| `node:sqlite` (built in) | Node 24/26 | Durable local state | See "State store" below. The owner's `speckit-auto/test-lock.ts` already uses `DatabaseSync`, so there is existing in-house experience. FTS5 verified working locally (for searchable council transcripts). | MEDIUM-HIGH |
| execa | 10.2.1 | Spawn `git`, `gh`, gate commands, `ssh-keygen` | ESM, Node >=22, argument-array API (no shell injection), `timeout`, `cancelSignal`, `forceKillAfterDelay`, combined output. | HIGH |
| commander | 15.1.0 | CLI parsing (`start`, `stop`, `doctor`, `approve`, `verify`, `report`) | Mature, typed, Node >=22.12. The CLI is small; no need for a framework. | HIGH |
| Vite | 8.3.7 | Build the UI bundle (shipped prebuilt inside the npm package); dev server with proxy to the Hono API | Current major; `@vitejs/plugin-react` 6.x targets Vite 8. | HIGH |
| React | 19.3.1 | UI | Matches Cena; the owner's prototype console was React. | HIGH |
| Tailwind CSS | 4.3.5 | UI styling | Matches Cena's shadcn setup so the console's design vocabulary can be reused. | HIGH |
| shadcn (CLI) | 4.23.0 | Copy-in UI primitives (Radix-based) | Components are copied into the repo, so there is no runtime UI-kit dependency and the dark/light mission theme from the prototype ports directly. | MEDIUM-HIGH |
| TanStack Query | 5.107.1 | Server state in the UI; SSE events invalidate queries | One pattern for "snapshot over HTTP, deltas over SSE". | HIGH |
| TanStack Router | 1.170.46 | Typed routes and typed search params (filters, selected item) | Peer-light (React only). React Router 8.5.1 is a fine alternative; this is a low-stakes pick. | MEDIUM |
| tsdown | 0.23.7 | Bundle the CLI/server to ESM `dist/` and emit `.d.ts` | Rolldown-based successor to tsup; supports TS `^7`. It is 0.x, so pin and keep the config tiny. | MEDIUM |
| Vitest | 5.1.0 | Unit and integration tests | Supports Node `^22.12 \|\| ^24 \|\| >=26` and Vite 8. | HIGH |
| Biome | 2.6.6 | Lint + format (replaces ESLint + Prettier) | Does not depend on the TypeScript compiler API, so it is unaffected by TS 7. One binary, fast. | MEDIUM-HIGH |

### Browser, Visual and Persona Layer

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| `playwright-core` | 1.65.0 | Programmatic screenshots of mocks and built screens; layout metrics | Library API only; do **not** use `@playwright/test` as a runner for this. Browsers install to a cache path we control (`PLAYWRIGHT_BROWSERS_PATH`, set to `/Volumes/Dock/Dev/Caches/ms-playwright` on the owner's machine). | HIGH |
| `pixelmatch` | 8.0.0 | Pixel diff (the exit-code visual check) | Pure JS, zero native binary, in-memory buffers, returns mismatch count. v8 adds `windowSize` (max mismatches in any N-by-N window) and `ignoreMask`, which are exactly what "localized drift" and "dynamic region" need. Inputs must be same-size. | MEDIUM-HIGH |
| `pngjs` | 7.0.0 | Decode/encode PNGs for pixelmatch | Stable, no native deps. Last published 2023, which is fine for a PNG codec. | HIGH |
| `@playwright/mcp` | 0.0.84, **exact pin** | Browser tools for persona agents (Cook, waiter, diner) | Maintained by Microsoft, accessibility-snapshot based (no vision model required), flags `--headless --isolated --output-dir --viewport-size --allowed-origins`. The 0.0.x version number means pin it. | MEDIUM-HIGH |
| `@medv/finder` | 4.0.2 | Generate a stable CSS selector for a clicked element in the pin overlay | MIT, small. `css-selector-generator` 3.9.4 is the actively maintained alternative; either works. | MEDIUM |

### State, Files and Process Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `yaml` | 2.9.1 | Parse/emit YAML (council config, frontmatter) | Always; used instead of gray-matter's bundled js-yaml. |
| `unified` | 11.0.5 | Markdown processing pipeline | OpenSpec adapter parsing and write-back. |
| `remark-parse` | 11.0.0 | Markdown to mdast | Same. |
| `remark-frontmatter` | 5.0.0 | Recognise `---` frontmatter nodes | Same. |
| `remark-gfm` | 4.0.1 | Tables and task lists (`- [ ]`) in plans | Same. |
| `unist-util-visit` | 5.2.0 | Walk mdast | Same. |
| `chokidar` | 6.0.0 | Watch `openspec/` for owner edits and push SSE updates | Optional; `fs.watch` is enough on macOS for a few directories, but chokidar normalises atomic-save behaviour. Requires Node >=22.22. |
| `pino` | 10.4.0 | Structured logs | Orchestrator and server logs (separate from gate logs). Add `pino-pretty` 13.2.0 as a dev dependency. |
| `p-queue` | 10.0.0 | Concurrency limits (N parallel worktree builds, 1 test lock holder) | In-process scheduling only; durable state still lives in SQLite. |
| `@floating-ui/dom` | 1.8.0 | Position the pin popovers in the comment overlay | Only if the overlay UI needs anchored popovers. |
| `lit` | 3.3.3 | Optional: build the overlay as a custom element | Only if plain DOM code gets unwieldy; the overlay should stay under roughly 20 KB. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Biome 2.6.6 | Lint, format, import-order | Use its restricted-imports rule (or `dependency-cruiser` 18.7.2) to enforce the **core must not import `adapters/openspec`** boundary. |
| `tsx` 4.23.15 | Run TS directly in dev | Dev only. Never in the published artifact. |
| `@types/node` 26.6.6 | Node typings | Pin to the major you develop on. |
| `publint` / `@arethetypeswrong/cli` | Check the package before the first publish | Cheap insurance when the public release comes. |

## 1. Local server, UI and live updates

- **Packaging.** Vite builds the SPA in CI into `dist/ui`; the npm package ships it. `npx @alex-profir/counterpoint` runs a server that does `serveStatic` on that folder. No Vite or React at runtime for users.
- **SSE, not WebSocket.** Every live feature (gate row lighting up, log tail, meeting turns, runway counter, run status) is server-to-UI. Commands (start/stop, pick an option, interject into a meeting, pin a comment) are ordinary `POST`s. SSE gives free reconnection and `Last-Event-ID` replay. Make the SSE `id:` the autoincrement `events.id` from SQLite and a reconnecting UI resumes exactly where it left off with no extra protocol. Hono's `streamSSE()` (`writeSSE({id, event, data})`, `stream.aborted`) covers it. WebSocket would add a protocol, heartbeat and reconnect logic for no gain. `@hono/node-ws` 1.3.1 exists if a bidirectional need appears later (for example a live terminal).
- **Loopback security (carry the prototype's lessons forward).** The Cena guard in `lib/factory/guard.ts` documents the key point: a Host-header check does not stop non-browser LAN clients, only the socket bind does. So: `serve({ hostname: '127.0.0.1' })` (never `0.0.0.0`, never `localhost` which can resolve to `::1` and v4 differently), plus a Host allowlist (`127.0.0.1:<port>`, `localhost:<port>`) against DNS rebinding, plus an Origin check on every non-GET (`hono/csrf`), plus `hono/secure-headers`. Start/Stop need a token. Bootstrap it by printing a URL with a one-time code that the server exchanges for an `HttpOnly; SameSite=Strict` cookie; keep the raw token in a `0600` file under the Counterpoint home, outside every worktree.
- **Agents run as the owner (2026-11-12).** No sandbox: sessions can read the token and reach the console, as the owner's own Claude Code sessions can. The loopback bind, Host/Origin checks and sign-in stay; they guard against web pages, not agents. History: the first slices treated agents as the threat model and sandboxed them; that stopped 4 of 7 Cena runs and was removed (`docs/decisions.md`, Direction).
- **Mock serving.** Mocks are served from a separate path or port from the console UI so that mock JavaScript cannot touch console cookies (use a different port on `127.0.0.1`, which is a different origin).
- **Keep the machine awake.** Wrap long runs with `caffeinate -i -w <pid>` on macOS (the prior art does the same).

## 2. Orchestrating headless Claude Code: the `claude` CLI

Counterpoint spawns the owner's own `claude -p` and reads `stream-json` (decided in `docs/decisions.md`; argv in `src/agent/claude-argv.ts`). Why not the Agent SDK:
- **It already does everything we need**, as the table shows.
- **It runs the owner's Claude Code as is**: their login, settings, skills and hooks. Counterpoint acts as the owner.
- **Terms.** Anthropic restricts third-party products built on the Agent SDK from offering claude.ai login. Running each user's own `claude` avoids that for the public release.
- **Churn.** The SDK is 0.x and ships almost daily.

| Need | How Counterpoint does it (`claude -p` + stream-json) | Agent SDK equivalent, if we ever swap |
|------|------------------------------------------------------|---------------------------------------|
| Per-message token usage | Latest `assistant` event's `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`, counted once per `message.id` (`src/agent/usage.ts`) | Typed `SDKAssistantMessage.message.usage` |
| Window size for the budget | `result.modelUsage[model].contextWindow`, one `result` per turn; never assumed | Same field, plus `query.getContextUsage()` mid-run |
| Stop at N% and hand off | `--input-format stream-json`: the orchestrator writes a wrap-up message to stdin; a `control_request` `interrupt`; killing the process group as a last resort | `interrupt()` and `streamInput()` |
| Usage-limit wait | Structured `rate_limit_event` (`status`, `resetsAt`), `system/api_retry`, result error values (`src/build/governor.ts`); no text matching | Same events, typed |
| Custom tools for council seats | Counterpoint's server exposes an MCP endpoint; sessions get it via `--mcp-config` (not built yet) | `createSdkMcpServer` in-process |
| Cost and turn caps | `--max-budget-usd`, `--max-turns` | `maxBudgetUsd`, `maxTurns` |
| Permissions | `--permission-mode auto` + `--permission-prompts none`, so a session never waits | `canUseTool`, in-process `hooks` |
| Settings and MCP | `--setting-sources user,project` (non-`--bare`), `--strict-mcp-config` | `settingSources`, `strictMcpConfig` |
| Install weight | None (the owner's `claude`) | 5 MB JS **plus a ~322 MB platform binary** unless pointed at the user's `claude` |

Swap to the SDK (a second `AgentRunner` implementation) only if the CLI stops exposing something we need, and re-read Anthropic's terms first.

## 3. Git worktrees and PRs

- **Why not a library.** `isomorphic-git` (1.44.12) is a reimplementation of git that is not known to cover linked worktrees or SSH-signature verification (unverified; not worth testing); `simple-git` (4.0.2) is only a string-building wrapper around the same binary and adds an API surface with a history of command-injection fixes. Plain argument arrays against real git give exact parity with what the owner sees in the terminal, and the prior art (`worktree.sh`) is already expressed in git commands.
- **Worktrees.** `git worktree add -b <branch> <path> <base>` into a sibling directory outside the repo (`<repo>-worktrees/<phase>`, as `speckit-auto` does; owner may relocate under `/Volumes/Dock`). List with `git worktree list --porcelain -z`. Use `git worktree lock --reason` while a run holds it and `git worktree prune`/`remove` on cleanup. Never run builder git commands in the owner's checkout.
- **Rebase on conflict.** `git fetch` then `git rebase <base>`; a non-zero exit with unmerged paths hands the worktree to a resolver session, then gates re-run; N failures parks the item.
- **PRs.** `gh pr create --head <branch> --base <default> --title ... --body-file ...`, `gh pr view --json number,url,headRefOid,mergeable,statusCheckRollup`, `gh pr merge --squash`/`--merge` only after verification. `gh` reuses the owner's existing auth, so Counterpoint stores no GitHub token. `gh` 2.102.0 is installed locally.

## 4. Durable state: SQLite vs files

| Data | Where | Why |
|------|-------|-----|
| Runs, work items, attempts, parking state, gate results, usage figures, run settings, council cards/threads/meetings/turns, pin comments, `events` outbox | **SQLite** | Relational queries ("what is parked", "gate pass rate", "runway length"), transactional state transitions, crash recovery, and an autoincrement `events` table that doubles as the SSE replay log. Plain files make multi-writer updates (builder, server, council all writing) racy; the prototype's `factory/*.yaml` is exactly what PROJECT.md retired. |
| Gate logs, persona screenshots, diff images, raw agent `stream-json` event streams | **Files** under `<home>/hosts/<host-id>/runs/<run>/...`; SQLite stores path, size, tail | Large and append-only; the UI needs "last lines one click away", which is a stored tail plus a file link. |
| Specs, decisions, approved mocks, backlog items | **The host git repo** (via the adapter) | They must be versioned and reviewable. Counterpoint reads planning truth, it does not own it. |
| Seat definitions, host settings | **Config file in the host repo** (YAML parsed with `yaml`, validated with `zod`) | Reviewable, per-host, committed. |

## 5. Running gates

- Spawn with `detached: true` (new process group), `stdin: 'ignore'`, `env: { CI: '1', FORCE_COLOR: '0', NO_COLOR: '1', ... }`, an explicit `timeout`, and `cancelSignal`. On timeout or stop, kill the **group** (`process.kill(-pid, 'SIGTERM')`, then `SIGKILL` after a grace period) so dev servers and test runners started by the gate do not orphan. A pass is exactly `exitCode === 0`; anything else (non-zero, signal, timeout) is a fail with a distinct stored reason.
- Pipe stdout+stderr to `<run>/<item>/<gate>.log` as it arrives (for the UI's live tail via SSE) and keep the last N lines in the `gate_results` row for "failing gate's last lines one click away". Strip ANSI for the stored tail (`strip-ansi` 7.2.0); render the log file as plain text in the UI, never as HTML. The prototype's `LogTail` rendering as plain React text was the right call (injection hardening).
- **Gate definitions are commands in the host's config**, not logic in Counterpoint. Counterpoint ships no knowledge of vitest/eslint.
- **Single test lock.** Reuse the owner's proven mechanism: SQLite `BEGIN EXCLUSIVE` on a file in a well-known location; the kernel drops the lock when the holder exits, so crashes cannot leave a stale lock (from `speckit-auto/test-lock.ts`). Gate runner acquires it for DB/e2e gates; pass the "held" marker to child processes so nested runs do not deadlock. Because `speckit-auto` already uses this lock, sharing the same file path lets old and new tooling coexist.
- Do **not** use `node-pty` (1.1.0, native addon) unless a gate genuinely needs a TTY; it complicates `npx` installs.

## 6. Visual gate: built screen versus approved HTML mock

## 7. Driving a browser as a persona agent

- Snapshot mode (accessibility tree) is the default and needs no vision capability, which keeps persona sessions cheap and works with a "Cook who finds the UI hard to use" prompt: the persona reasons over roles, labels and tab order, which is where usability problems show up. Add `--caps=vision` only for seats that must judge visual layout.
- Microsoft's own README recommends the Playwright **CLI with skills** for most coding agents because it is more token-efficient, and keeps MCP for "specialized agentic loops that need persistent state and rich page introspection, such as exploratory automation". A persona wandering an app is that second case, so MCP is right here. `--allowed-origins` is documented as *not* a security boundary; enforce the real boundary with the SDK sandbox network allowlist.
- **Claude in Chrome is the wrong tool for the unattended path.** Per the official docs it needs a headed Chrome/Edge window with the extension, a `/login` claude.ai session (API keys and `setup-token` tokens disable it), asks for per-site permission, shares the owner's logged-in browser state, and the extension's service worker goes idle and drops the connection on long sessions. Use it only as a manual owner tool, not for overnight personas.
- **Computer use** (macOS native apps) is not needed; every Counterpoint surface is a browser. Do not enable it for any seat.
- Persona findings are advisory cards: store screenshots as files, findings as rows, never as gate failures.

## 8. Serving and commenting on standalone HTML mocks

| Tool | What it is | Verdict for Counterpoint |
|------|-----------|--------------------------|
| **Agentation** 3.1.2 (+ `agentation-mcp` 1.3.2) | React toolbar: click elements, write notes, copy structured markdown or sync to a local MCP server. Requires React 18+. | **Do not embed.** React-only (mocks are standalone HTML), and **PolyForm Shield 1.0.0** forbids using it to build a competing product, which an open-source mission-control tool could arguably be. Study its output shape (selector, position, note) and emulate. |
| **react-grab** 0.2.0 (MIT) | Hover an element in a running React app, Ctrl+C copies component stack and source location for an agent. | Useful *idea* (primitives `getElementAtPoint`, `data-react-grab-ignore`), but it copies context to the clipboard; it has **no persistent comments, threads or variants**. Could inform the picker only. |
| **Stagewise** (`@stagewise/toolbar` 0.6.3; `stagewise` 0.12.0) | Has become an open-source **agentic IDE** (AGPL-3.0, own agent, account service sunsets end of Nov 2026). | **Avoid.** AGPL, product pivoted away from an embeddable toolbar, and it brings its own agent, conflicting with "Claude Code only". |
| **Onlook** (0.0.8 on npm; Apache-2.0) | Visual editor for Next.js + Tailwind that syncs edits to code. | Wrong shape: it edits a *running app's* code, not standalone mocks; hosted product still waitlist. Not embeddable. |
| **Vercel toolbar comments** | Element-pinned comments on Vercel preview deployments (also exposed through the Vercel MCP). | Proprietary and only on Vercel deploys. Good for commenting on the **host's real preview deploy**; not for local mocks. Do not depend on it. |
| **tldraw** 5.6.0 ("make real") | Infinite-canvas SDK; production use needs a license key (free hobby tier shows a "made with tldraw" watermark and is discretionary). | Great for low-fi wireframing, wrong for pinning comments on pixel-exact HTML. Licensing friction for an open-source tool. Skip. |
| **Excalidraw** (`@excalidraw/excalidraw` 0.18.1, MIT) | Embeddable whiteboard. | Same: sketching, not element-pinned review of HTML. Optional later for a low-fi "rough layout" round. |
| **Penpot** (`@penpot/mcp` 2.15.4) | Self-hostable design tool with an MCP server. | A design tool, not an HTML mock reviewer; the signed-off artifact must be committed HTML the visual gate can render. Heavy to run locally. Skip for v1. |
- **Delivery.** The mock server (a Hono route) serves the standalone HTML file from the host repo and **injects** `<script src="/__cp/pins.js">` before `</body>`. The file on disk stays pristine and committable.
- **Overlay.** Vanilla TypeScript compiled to one IIFE, UI in a **Shadow DOM** so mock CSS cannot leak in and vice versa (and `data-cp-ignore` on its own nodes). Hover-highlight picker; on click capture: `data-cp-id` if present, else a generated selector (`@medv/finder` 4.0.2), text snippet, `outerHTML` excerpt, bounding box, scroll offset, viewport width, and optionally a cropped screenshot taken server-side by Playwright. POST to `/api/mocks/:mock/pins`; SSE broadcasts so the owner sees seat pins appear live.
- **Agent hand-off.** A revise session receives `{selector, snippet, note, viewport}` and edits only that region; the pin stores the revision SHA so it can be marked resolved or re-anchored. Selector breakage after a redraw is expected; fall back to `data-cp-id` then text-content match, then show the pin as "detached" instead of dropping it.
- **Variants** (2-3 side by side) are separate HTML files rendered in a grid of iframes by the console, each with its own pin overlay; "more like B" is a new generation round anchored on B's file.
- **Do not** apply `html-to-image` 1.11.13 style client-side screenshots for evidence; server-side Playwright crops are exact and need no mock cooperation.

## 9. Reading OpenSpec's `openspec/` content

- **Layout.** `openspec/config.yaml` (detection, project context and rules), `openspec/specs/<capability>/spec.md` (current behaviour), `openspec/changes/<name>/` (work: `.openspec.yaml` with `schema`, `created`, optional `goal`, plus Counterpoint's `x-depends-on`; `proposal.md`, optional `design.md`, `tasks.md` with `- [ ]` checkbox tasks, and `specs/<capability>/spec.md` deltas), and `openspec/changes/archive/<YYYY-MM-DD>-<name>/` (finished work). OpenSpec ignores keys prefixed `x-`, which is why Counterpoint's own metadata uses that prefix.
- **Read from git, natively.** The adapter reads committed blobs at the base-branch tip through `GitFileReader`, never the working tree, so it does not call the `openspec` CLI (which reads the working tree). Parse `.openspec.yaml` with `yaml` and validate with zod; parse markdown with `unified` + `remark-parse` + `remark-gfm` + `unist-util-visit` where line scanning is not enough. Treat `openspec validate --strict` as the format reference, and treat host content as untrusted input (agents write it).
- **Write-back = surgical splice, not round-trip.** Council decisions "written back through the adapter and committed" (into a change's `design.md`) must produce a minimal diff. `remark-stringify` re-serialises the whole document and will reformat tables, bullets and emphasis. Instead locate the target node via mdast `position.start.offset/end.offset` and splice the original string. Add a round-trip test over the real Cena `openspec/` files.
- **Do not use `gray-matter`** 4.0.3: last published 2023, bundles `js-yaml` 3, and its default engines include a JavaScript front-matter engine. Use `yaml`.
- Writes go to a **worktree/branch**, committed, never straight into the owner's checkout.

## Installation

# Runtime (published dependencies)

# UI (bundled at build time; devDependencies of the package)

# Tooling

# One-time machine setup (owner's machine keeps caches on the Dock volume)

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `claude -p` + stream-json | Agent SDK (TS) | Only if the CLI stops exposing something we need. It would be a second `AgentRunner` implementation; re-read Anthropic's third-party login terms first. |
| Hono | Fastify 5.12.8 | If you need its plugin ecosystem or schema-first validation. Heavier and Node-specific; Hono's Web-standard API and built-in SSE fit this tool better. |
| SSE | WebSocket (`ws` 8.22.2 / `@hono/node-ws`) | If a true bidirectional stream appears (embedded terminal, collaborative editing). Not needed for v1. |
| `node:sqlite` | `better-sqlite3` 13.0.3 | If `node:sqlite` shows a regression or lacks a needed API; the `db/` wrapper makes this a one-module swap. |
| Hand-written SQL | Drizzle ORM 1.0 (`rc`) / Kysely 0.29.8 | Reconsider when Drizzle 1.0 is stable *and* has a documented `node:sqlite` driver, or if schema churn becomes painful. |
| execa + `git` | `simple-git` 4.0.2 / `isomorphic-git` | Never for this project: wrappers add surface without capability; isomorphic-git lacks worktree and SSH-signature support. |
| `gh` CLI | Octokit | If Counterpoint ever runs where `gh` cannot be installed. Octokit would add token storage, which we want to avoid. |
| pixelmatch 8 | `odiff-bin` 4.5.0 | When screens/viewports grow into the hundreds per run, or you want `ignoreRegions` and `failOnLayoutDiff` out of the box. |
| In-house pins overlay | Agentation | Only if licensing is cleared with its author and mocks become React components rather than standalone HTML. |
| Playwright MCP | Playwright CLI + skills | For deterministic scripted persona flows where token cost matters more than exploratory freedom. |
| Biome | ESLint 10.14.0 + typescript-eslint | Not while typescript-eslint caps TypeScript at `<6.1.0`. Revisit when it supports TS 7. |
| tsdown | tsup 9.0.0 | If tsdown 0.x breaks; tsup is the older, no-longer-recommended bundler. Low switching cost. |
| TanStack Router | React Router 8.5.1 | If the team prefers it; either is fine for roughly six views. |
| remark + `yaml` | `marked` 18 / `markdown-it` 15 | Only for rendering HTML in the UI. They do not give a position-bearing AST for write-back. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `gray-matter` 4.0.3 | Unmaintained since 2023, old `js-yaml`, default JS front-matter engine can execute code; `openspec/` content is agent-written | `remark-frontmatter` + `yaml` |
| Shell-string process spawning (`exec`, `execa` with `shell: true`, template-string commands) | Injection via branch names, phase titles, comment text | `execFile`-style argument arrays through execa |
| A hard-coded context window (the prior art's `CONTEXT_WINDOW_TOKENS=1000000`) | Violates "budgets follow the model"; wrong for other models | `result.modelUsage[model].contextWindow` from the stream |
| Model-obeyed "please stop" hooks as the only budget enforcement | The model can ignore or mis-time it | Orchestrator-owned wrap-up message over stream-json stdin, then `interrupt` / process-group kill |
| Parsing "limit reached" text for waits | Brittle across CLI versions and locales | Structured `rate_limit_event` and `api_retry` events (regex only as fallback) |
| Binding to `0.0.0.0` or relying on a Host check alone | Host check does not stop non-browser LAN clients (the prototype's own WR-01 note) | Bind `127.0.0.1` + Host allowlist + Origin check + token |
| Claude in Chrome for persona agents | Needs a headed, logged-in real Chrome, claude.ai login only, per-site prompts, drops long connections | Playwright MCP headless + isolated |
| Embedding Agentation, Stagewise or Onlook | React-only plus PolyForm Shield; AGPL IDE; Next/Tailwind code editor | Small in-house overlay |
| Vision-model verdict as a gate | Non-deterministic; violates "gates are commands judged by exit code" | Pixel + structural checks decide, model annotates |
| `@playwright/test` `toHaveScreenshot` for mock-vs-build | Compares against its own stored baseline, not an external reference | `playwright-core` + `pixelmatch` |
| Drizzle 0.45 / Prisma for the store | Drizzle 1.0 not stable, no first-class `node:sqlite`; Prisma is heavy and native | Thin repositories over `node:sqlite` |
| `remark-stringify` round-tripping for write-back | Rewrites the whole document, creating noisy diffs in the host's planning files | Offset-based string splicing guided by mdast positions |
| `node-pty` for gates | Native addon, complicates `npx`; gates are exit-code-judged and need no TTY | `execa` with piped output |
| Putting runtime state in the host repo as YAML/JSON (`factory/*.yaml` style) | Explicitly out of scope; races, noisy git history | SQLite store plus files |

## Stack Patterns by Variant

- Use `gh pr view --json statusCheckRollup` or the deployment status API to find the preview URL and put it in the PR and the inbox.
- Because PROJECT.md says to prefer the host's own preview, and Vercel toolbar comments then work for free on that URL (still not a dependency).
- Counterpoint starts the host's dev/preview command from the feature worktree with a free port (lock-file allocation like `speckit-auto` does, from 4174 upward) and serves it on loopback only.
- Because worktree-per-feature needs per-feature ports, and previews must not collide with the console port.
- If the CLI stops exposing something we need, add an Agent SDK implementation of `AgentRunner`.
- Because the port and the internal event schema are designed so both can emit the same events.
- Mask dynamic regions, raise that screen's `windowSize` budget, and lean on the structural check.
- Because both signals are per-screen configurable, not global.
- For the public release, keep requiring a user-supplied `claude`, never perform logins, and re-read Anthropic's current terms for third-party tools.
- Because the Agent SDK overview restricts third-party offering of claude.ai login and rate limits.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@hono/node-server@2.1.6` | `hono@^4 \|\| ^5.0.0-0` | Use Hono 4.13.x now. |
| `vitest@5.1.0` | `vite@^6.4 \|\| ^7 \|\| ^8`, Node `^22.12 \|\| ^24 \|\| >=26` | Matches Vite 8.3.7. |
| `@vitejs/plugin-react@6.3.0` | `vite@^8` only | Do not mix with Vite 7. |
| `tsdown@0.23.7` | `typescript@^5 \|\| ^6 \|\| ^7`, Node `^22.18 \|\| ^24.11 \|\| >=26` | Fine with TS 7. |
| `typescript-eslint` | `typescript <6.1.0` | **Incompatible with TS 7.** Hence Biome. |
| `execa@10.2.1`, `commander@15.1.0`, `p-queue@10.0.0`, `chokidar@6.0.0` | Node >=22 (chokidar >=22.22, commander >=22.12) | All satisfied by `engines >=24`. |
| `node:sqlite` | Node 22.5+ (flagless from 22.13), RC in 24/26 | Document the floor as Node 24. |
| `pixelmatch@8.0.0` | `pngjs@7.0.0` | Inputs must be same dimensions; pass `Uint8Array`/`Buffer` RGBA. |
| `@playwright/mcp@0.0.84` | bundles `playwright 1.65.0-alpha-*` | May pull a different Playwright than your `playwright-core@1.65.0`; browser downloads can then double. Set one `PLAYWRIGHT_BROWSERS_PATH` and check `npx playwright-core install` reports no second download. |

## Open Items to Verify in Change-Level Research

## Sources

- npm registry (`npm view`, queried 2026-11-09): versions, `engines`, `peerDependencies`, `dist-tags`, licences for every package listed (HIGH).
- `@anthropic-ai/claude-agent-sdk@0.3.319` published type definitions (`sdk.d.ts`): `Options`, `Query` (`getContextUsage`, `interrupt`, `streamInput`, `close`), `ModelUsage.contextWindow`, `SDKContextUsage`, `SDKRateLimitEvent`, `SDKAPIRetryMessage`, `SDKResultError.subtype`, `HOOK_EVENTS`, `SandboxFilesystemConfig.denyRead`, `pathToClaudeCodeExecutable`, `settingSources`, `strictMcpConfig`, `createSdkMcpServer` (HIGH).
- https://code.claude.com/docs/en/agent-sdk/overview: SDK vs CLI, login/branding restrictions, terms (HIGH).
- https://code.claude.com/docs/en/agent-sdk/cost-tracking: usage dedupe by message id, placeholder `output_tokens`, `modelUsage` includes subagents, estimates not billing (HIGH).
- https://code.claude.com/docs/en/agent-sdk/hooks: in-process hooks, `onFailure`, events list (HIGH).
- https://code.claude.com/docs/en/headless: `claude -p`, stream-json, `--bare`, `--permission-prompts none`, SIGTERM behaviour, `api_retry` fields (HIGH).
- https://code.claude.com/docs/en/chrome: Claude in Chrome prerequisites and limitations (HIGH).
- https://github.com/microsoft/playwright-mcp: flags, snapshot versus vision, CLI-versus-MCP guidance (MEDIUM-HIGH, README fetched, version from npm).
- https://github.com/mapbox/pixelmatch and https://github.com/dmtrKovalenko/odiff: APIs and options as summarised from READMEs (MEDIUM).
- https://hono.dev/docs/helpers/streaming and https://github.com/honojs/node-server/releases: `streamSSE`, node-server 2.1.x changes (MEDIUM-HIGH).
- https://nodejs.org (dist index, `node:sqlite` docs): Node 24/26 LTS, `node:sqlite` Stability 1.2 release candidate; local experiments for FTS5 and exclusive locking (HIGH).
- Local experiment (scratch repo, git 2.50.1, ed25519 keys): `verify-commit` exit codes, `%G?`/`%GF` output, "No principal matched" behaviour (HIGH).
- https://github.com/benjitaylor/agentation, https://github.com/aidenybai/react-grab, https://github.com/stagewise-io/stagewise, https://github.com/onlook-dev/onlook, https://tldraw.dev (licence-key docs): mock-commenting tool survey (MEDIUM; READMEs fetched, some details not stated on the pages).
- Prior art read-only: `/Volumes/Dock/Projects/HKP/CV/tools/speckit-auto` (`context-budget.sh`, `env.sh`, `gates.sh`, `run.sh`, `worktree.sh`, `test-lock.ts`) and Cena branch `ccr-61ff69b1-hgtpdm` (`lib/factory/guard.ts`, `lib/factory/signature.ts`, `app/__mission/*`) (HIGH for what they do).
- OpenSpec 1.17.0 CLI and its `spec-driven` schema, inspected locally (`openspec init`, `new change`, `validate --strict`, change-metadata schema): change layout and the `x-` prefix for tool metadata (HIGH).

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
## Project Skills

- **Sketch findings for Counterpoint** (design decisions, CSS patterns, visual direction) → `Skill("sketch-findings-counterpoint")`
## Spec-Driven Workflow (OpenSpec)

Planning lives in `openspec/`: current behaviour in `openspec/specs/`, work in `openspec/changes/<name>/`, finished work in `openspec/changes/archive/`. Research, decisions, backlog and sketches live in `docs/`.

- `/opsx:explore` to think something through before committing to a change
- `/opsx:propose <name>` to create a change (proposal, spec deltas, design, tasks)
- `/opsx:ff <name>` to fast-forward an existing change: generate every missing planning artifact in one go
- `/opsx:apply` to implement a change's tasks, ticking them in `tasks.md`
- `/opsx:verify` to check an implemented change against its specs, design and tasks before archiving
- `/opsx:archive` when a change is done (merges its spec deltas into `openspec/specs/`)

Feature work starts from a change; small fixes and doc edits can go in directly. Run `openspec validate --all --strict` after editing anything under `openspec/`. Dependencies between changes go in `.openspec.yaml` as `x-depends-on: [<change>, ...]`; tasks only the owner can do start with `Owner:`.

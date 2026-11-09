# Stack Research

**Domain:** Local "mission control" for autonomous spec-driven development with Claude Code: npm-distributed Node/TypeScript CLI, loopback-only web UI, background build orchestrator driving headless Claude Code sessions, multi-agent council, design-mock review, signed-approval merge flow.
**Researched:** 2026-11-09
**Overall confidence:** HIGH on the runtime, orchestration and git/signing layers (checked against the installed SDK type definitions, current official docs and live experiments). MEDIUM on the mock-commenting and visual-gate layers (design choices with no off-the-shelf winner).

**How versions were verified:** every version below was read from the npm registry on 2026-11-09 (`npm view`). SDK behaviour was read from the published `@anthropic-ai/claude-agent-sdk@0.3.319` type definitions (`sdk.d.ts`) and the official docs at code.claude.com. The git signing behaviour was tested in a scratch repo on this machine (git 2.50.1, `ssh-keygen`). Node, `node:sqlite` and Playwright claims come from nodejs.org and the registry. Context7 MCP tools were not exposed in this session; official docs, type definitions and registry metadata were used instead.

---

## Headline Decisions (read this first)

| # | Question | Decision |
|---|----------|----------|
| 1 | CLI + local web UI + live updates | One Node >=24 process: **Hono 4 + `@hono/node-server` 2** serving a prebuilt **Vite 8 / React 19 / Tailwind 4 / shadcn** SPA. **SSE** (not WebSocket) for server-to-UI push, plain `POST` for commands. Bound to `127.0.0.1` with Host/Origin checks. |
| 2 | Driving Claude Code | **Claude Agent SDK for TypeScript (`@anthropic-ai/claude-agent-sdk`, exact-pinned)** behind one internal `AgentRunner` port, pointed at the owner's own `claude` binary via `pathToClaudeCodeExecutable`. Not raw `claude -p` spawning. Context budget is enforced by the orchestrator from per-message usage, not by a model-obeyed hook. |
| 3 | Git, signing, PRs | Shell out to the real `git` and `gh` with **execa 10** (argument arrays, no shell). No git library. Signature check = `git -c gpg.ssh.allowedSignersFile=<outside-agent-reach> verify-commit` plus a pinned key fingerprint. |
| 4 | State store | **SQLite via built-in `node:sqlite`** (WAL, STRICT tables, FTS5) for runs, items, attempts, gate results, events, council. **Files** for logs, screenshots, diffs. **Git** (host repo) for anything the owner signs (specs, decisions, approved mocks). |
| 5 | Gates | Child processes in their own process group, judged by exit code only, output streamed to a log file plus a tail kept in SQLite. Machine-wide test lock = SQLite exclusive lock (the owner's existing `test-lock.ts` technique). |
| 6 | Visual gate | **`playwright-core` screenshots + `pixelmatch` 8** (with `pngjs`) as the exit-code check, **structural landmark comparison** as the second check, **vision-model review as advisory only**. Pixel diff needs hi-fi mocks. |
| 7 | Persona browser agents | **`@playwright/mcp` (exact-pinned) headless + isolated**, passed to the SDK via `mcpServers`. **Not** Claude in Chrome (needs a headed, logged-in real Chrome; unusable unattended). Computer use is not needed. |
| 8 | Element-pinned mock comments | **Build a small in-house overlay** (vanilla TS, Shadow DOM, injected by the mock server). Nothing off the shelf fits: Agentation is React-only and PolyForm Shield, Stagewise is an AGPL IDE, react-grab copies context but has no persistent comments, Vercel comments only work on Vercel deploys. |
| 9 | Parsing `.planning/` | **Call the host's `gsd-tools` JSON queries first** (they already emit structured roadmap/phase/plan data), with **unified + remark-parse + remark-frontmatter + `yaml`** as the fallback and for position-exact write-back. **Do not use gray-matter.** |

---

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
| `@anthropic-ai/claude-agent-sdk` | **0.3.319, exact pin** (no caret) | Run headless Claude Code sessions: builder, council seats, persona agents | See "SDK vs spawning the CLI" below. Typed message stream, live `getContextUsage()`, in-process hooks, in-process MCP tools, `interrupt()`, `resume`/`fork`, structured rate-limit events. It is 0.x and ships very frequently (patch 319 on the 0.3 line), so pin exactly and wrap it. | HIGH on capability, MEDIUM on API stability |
| `zod` | 4.6.7 | Schemas for config, DB rows, API payloads, SDK tool definitions | The SDK requires zod `^4` as a peer dependency, so one validation library serves everything. | HIGH |
| `@anthropic-ai/sdk` | 1.6.0 | **Peer dependency of the Agent SDK** (`>=0.93.0`) | Required to install; Counterpoint code should not call it directly. | HIGH |
| `@modelcontextprotocol/sdk` | 1.32.2 | **Peer dependency of the Agent SDK** (`^1.29.0`); also used to define Counterpoint's own in-process MCP tools | Council seats need tools like `file_backlog_item` and `post_pin_comment`; `createSdkMcpServer` + `tool()` define them in-process with no extra server. | HIGH |
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
| `unified` | 11.0.5 | Markdown processing pipeline | GSD adapter fallback parser and write-back. |
| `remark-parse` | 11.0.0 | Markdown to mdast | Same. |
| `remark-frontmatter` | 5.0.0 | Recognise `---` frontmatter nodes | Same. |
| `remark-gfm` | 4.0.1 | Tables and task lists (`- [ ]`) in plans | Same. |
| `unist-util-visit` | 5.2.0 | Walk mdast | Same. |
| `chokidar` | 6.0.0 | Watch `.planning/` for owner edits and push SSE updates | Optional; `fs.watch` is enough on macOS for a few directories, but chokidar normalises atomic-save behaviour. Requires Node >=22.22. |
| `pino` | 10.4.0 | Structured logs | Orchestrator and server logs (separate from gate logs). Add `pino-pretty` 13.2.0 as a dev dependency. |
| `p-queue` | 10.0.0 | Concurrency limits (N parallel worktree builds, 1 test lock holder) | In-process scheduling only; durable state still lives in SQLite. |
| `@floating-ui/dom` | 1.8.0 | Position the pin popovers in the comment overlay | Only if the overlay UI needs anchored popovers. |
| `lit` | 3.3.3 | Optional: build the overlay as a custom element | Only if plain DOM code gets unwieldy; the overlay should stay under roughly 20 KB. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Biome 2.6.6 | Lint, format, import-order | Use its restricted-imports rule (or `dependency-cruiser` 18.7.2) to enforce the **core must not import `adapters/gsd`** boundary from PROJECT.md. |
| `tsx` 4.23.15 | Run TS directly in dev | Dev only. Never in the published artifact. |
| `@types/node` 26.6.6 | Node typings | Pin to the major you develop on. |
| `publint` / `@arethetypeswrong/cli` | Check the package before the first publish | Cheap insurance when the public release comes. |

---

## 1. Local server, UI and live updates

**Recommendation: one Node process, Hono API, prebuilt React SPA, SSE.**

- **Packaging.** Vite builds the SPA in CI into `dist/ui`; the npm package ships it. `npx @alex-profir/counterpoint` runs a server that does `serveStatic` on that folder. No Vite or React at runtime for users.
- **SSE, not WebSocket.** Every live feature (gate row lighting up, log tail, meeting turns, runway counter, run status) is server-to-UI. Commands (start/stop, pick an option, interject into a meeting, pin a comment) are ordinary `POST`s. SSE gives free reconnection and `Last-Event-ID` replay. Make the SSE `id:` the autoincrement `events.id` from SQLite and a reconnecting UI resumes exactly where it left off with no extra protocol. Hono's `streamSSE()` (`writeSSE({id, event, data})`, `stream.aborted`) covers it. WebSocket would add a protocol, heartbeat and reconnect logic for no gain. `@hono/node-ws` 1.3.1 exists if a bidirectional need appears later (for example a live terminal).
- **Loopback security (carry the prototype's lessons forward).** The Cena guard in `lib/factory/guard.ts` documents the key point: a Host-header check does not stop non-browser LAN clients, only the socket bind does. So: `serve({ hostname: '127.0.0.1' })` (never `0.0.0.0`, never `localhost` which can resolve to `::1` and v4 differently), plus a Host allowlist (`127.0.0.1:<port>`, `localhost:<port>`) against DNS rebinding, plus an Origin check on every non-GET (`hono/csrf`), plus `hono/secure-headers`. Start/Stop need a token. Bootstrap it by printing a URL with a one-time code that the server exchanges for an `HttpOnly; SameSite=Strict` cookie; keep the raw token in a `0600` file under the Counterpoint home, outside every worktree.
- **Agents are the threat model.** Agents run as the same OS user and can `curl 127.0.0.1`. The token alone does not stop them. Run agent sessions with the SDK's `sandbox` option (filesystem `denyRead` for the token file, `~/.ssh`, and the Counterpoint home; network restrictions so they cannot reach the Counterpoint port). This is a first-class requirement (PROJECT.md: "Start/Stop protected by a local token agents cannot read"), not hardening.
- **Mock serving.** Mocks are served from a separate path or port from the console UI so that mock JavaScript cannot touch console cookies (use a different port on `127.0.0.1`, which is a different origin).
- **Keep the machine awake.** Wrap long runs with `caffeinate -i -w <pid>` on macOS (the prior art does the same).

## 2. Orchestrating headless Claude Code: SDK vs spawning the CLI

**Recommendation: the Agent SDK, wrapped by an `AgentRunner` port, configured to use the owner's installed `claude`.**

What the SDK is: a library that **runs the Claude Code binary** and speaks the same stream-json protocol that `claude -p --output-format stream-json` emits (the official overview says exactly this). So the choice is not "different agent", it is "typed, bidirectional control channel versus a one-way text stream you parse yourself".

| Need | `claude -p` + stream-json | Agent SDK (TS) |
|------|---------------------------|----------------|
| Per-message token usage | Parse JSON lines yourself | Typed `SDKAssistantMessage.message.usage` (dedupe by `message.id`; input/cache tokens are accurate, per-step `output_tokens` is a placeholder) |
| Window size for the budget | Only at the end, in `result.modelUsage[model].contextWindow` | `modelUsage[model].contextWindow` after the first turn result **and** `query.getContextUsage({detail:'summary'})` live, mid-run |
| Stop at N% and hand off | A shell hook that asks the model nicely (prior art: `context-budget.sh`), no way to inject a turn | `interrupt()` and `streamInput()` to inject the wrap-up turn, or a `PostToolUse` callback in-process |
| Usage-limit wait | Regex on stderr text (prior art: `retry_wait`) | Structured `rate_limit_event` (`status`, `resetsAt`, `rateLimitType: five_hour \| seven_day`), `system/api_retry` (`attempt`, `retry_delay_ms`, `error_status`), result `subtype` values (`error_max_turns`, `error_max_budget_usd`) |
| Custom tools for council seats | Separate MCP server process | `createSdkMcpServer` in-process |
| Cost cap per session | `--max-budget-usd` | `maxBudgetUsd` |
| Approve/deny tools programmatically | `--permission-prompt-tool` | `canUseTool`, in-process `hooks` (`PreToolUse`, `PostToolUse`, `Stop`, `PreCompact`, `SubagentStop`, ...), `onFailure: "block"` for fail-closed guards |
| Isolation | `--bare`, settings flags | `settingSources: []`, `strictMcpConfig`, `sandbox`, `managedSettings`, `allowedTools`/`disallowedTools` |
| Install weight | None (uses user's `claude`) | 5 MB JS **plus a ~322 MB platform binary** (optional dependency) unless you point at the user's `claude` |

**Why not raw `claude -p`:** the owner's own `speckit-auto` shows the cost: a bash hook parsing transcript JSONL with `jq` to estimate context use, a hard-coded `CONTEXT_WINDOW_TOKENS=1000000` (contradicting "no hard-coded window sizes"), and a regex over error text to detect usage limits. All three become typed fields with the SDK.

**Configuration that matters:**

1. `pathToClaudeCodeExecutable`: resolve the owner's `claude` (`which claude`, version-check it in `doctor`) and pass it. This keeps auth, settings and version identical to the interactive Claude Code the owner already uses, and avoids downloading the ~322 MB bundled binary for `npx` users (platform packages are optional dependencies; `npm install --omit=optional` or an `.npmrc` setting can skip them).
2. **Auth and terms.** Anthropic's SDK overview says: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." Running the owner's own installed, already-logged-in `claude` on the owner's own machine (as `speckit-auto` does today with `claude -p`) is the same thing the CLI does. A *published* Counterpoint must not log users in itself, must not ship credentials, and should document that it drives the user's own `claude` or an API key they provide. **Flag for the pre-publish phase: re-read the terms then.** (Branding: the SDK page forbids presenting a product as "Claude Code"; name seats and UI accordingly.)
3. **Context budget (the headline mechanism).** Compute in-process, never trust the model to self-report:
   - Used = last **main-loop** assistant message (`parent_tool_use_id` empty): `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`, deduped by `message.id`. This is the same formula `context-budget.sh` and the status line use.
   - Window = `modelUsage[<model>].contextWindow` from the latest `result` (streaming-input mode emits a result per turn); before the first result use `getContextUsage().rawMaxTokens`. **Trap:** `SDKContextUsage.raw_max_tokens` is "the resolved autocompact window", which can be a *smaller compaction-policy window* (the type docs mention a 200K boundary on 1M-window models). Use the model's `contextWindow` as the denominator and treat `raw_max_tokens` as a cross-check. Verify both values on a real 1M-window session early (Phase research flag).
   - At the threshold (default 40%, per-run adjustable, shown with the token figure): finish the current tool call, then `streamInput()` a fixed "finish the task in progress, write the handoff, commit, stop" turn and end the session when that turn's result arrives. The *orchestrator* owns the handoff step; the model only does the writing. Start the next session fresh (new session, not `resume`) seeded from the handoff file.
   - One-shot steps that nothing can continue (plan, analyze) must not be cut short (the prior art already encodes this rule).
4. **Rate limits and backoff.** Subscribe to `rate_limit_event` (`resetsAt` is a number; confirm its unit, seconds vs milliseconds, against a real event) for usage-limit waits (reset time + 2 minutes, per PROJECT.md), and to `system/api_retry` plus assistant `error` values (`rate_limit`, `overloaded`, `server_error`, `authentication_failed`, `billing_error`) for API-error backoff. Keep a tail-regex fallback for older `claude` versions.
5. **Permissions for unattended runs.** Use an explicit `allowedTools` list plus `permissionMode: 'auto'` or `'dontAsk'`, and pass `permission-prompts none` semantics (deny, do not wait) so a session never blocks on a prompt nobody will answer. Default mode can differ by Claude Code version, so always set it.
6. **Per-seat isolation.** Council seats and persona agents get `settingSources: []` (or `['project']` only when they need CLAUDE.md), `strictMcpConfig: true`, and a minimal tool set. The builder keeps default setting sources so it picks up the host's own `.claude/` commands and skills (e.g. `/gsd-execute-phase`).
7. **Cost accounting.** Use `total_cost_usd` and `modelUsage` from the result message for run reports (subagent spend is included there, but **not** in `usage`). They are client-side estimates, not billing data.
8. **Stopping.** Prefer `interrupt()` then `close()`; the docs say SIGTERM leaves the turn unfinished and records no result. On SIGKILL fallback, kill the process group.

**Fallback runner.** Keep a second `AgentRunner` implementation that spawns `claude -p --output-format stream-json --verbose` and maps lines to the same internal event type. It costs little, proves the port is clean, and is the escape hatch if an SDK release breaks. Do not build it in phase 1; do keep the port narrow enough that it is possible.

**Pinning policy:** exact version in `package.json`, a single module (`agent/sdk-runner.ts`) imports the SDK, an integration smoke test (one cheap real session) runs before bumping. The SDK's own hooks docs gate features by SDK version (for example `onFailure` needs 0.3.317), which confirms the churn.

## 3. Git worktrees, signed-commit verification, PRs

**Recommendation: shell out to `git` and `gh` through execa. No git library, no Octokit.**

- **Why not a library.** `isomorphic-git` (1.44.12) is a reimplementation of git that is not known to cover linked worktrees or SSH-signature verification (unverified; not worth testing); `simple-git` (4.0.2) is only a string-building wrapper around the same binary and adds an API surface with a history of command-injection fixes. Plain argument arrays against real git give exact parity with what the owner sees in the terminal, and the prior art (`worktree.sh`) is already expressed in git commands.
- **Worktrees.** `git worktree add -b <branch> <path> <base>` into a sibling directory outside the repo (`<repo>-worktrees/<phase>`, as `speckit-auto` does; owner may relocate under `/Volumes/Dock`). List with `git worktree list --porcelain -z`. Use `git worktree lock --reason` while a run holds it and `git worktree prune`/`remove` on cleanup. Never run builder git commands in the owner's checkout.
- **Rebase on conflict.** `git fetch` then `git rebase <base>`; a non-zero exit with unmerged paths hands the worktree to a resolver session, then gates re-run; N failures parks the item.
- **PRs.** `gh pr create --head <branch> --base <default> --title ... --body-file ...`, `gh pr view --json number,url,headRefOid,mergeable,statusCheckRollup`, `gh pr merge --squash`/`--merge` only after verification. `gh` reuses the owner's existing auth, so Counterpoint stores no GitHub token. `gh` 2.102.0 is installed locally.
- **Signed approval verification (tested locally against git 2.50.1 with real ed25519 keys):**
  - `git -c gpg.ssh.allowedSignersFile=<path> verify-commit <sha>` exits **0** only for a good signature by a principal listed in the file. A cryptographically valid signature from an *unlisted* key printed `No principal matched.` and exited **1**.
  - `git log -1 --format='%G?|%GF|%GK|%GS' <sha>` returns `G` (good, trusted), `U` (good signature, untrusted), `N` (none), and `%GF`/`%GK` give the SHA256 key fingerprint even when untrusted. Always pass `-c log.showSignature=false` so a user-level `log.showSignature=true` cannot inject text (the prototype's `signature.ts` hit this).
  - **Do not rely on repo config.** An agent that can write inside a worktree can edit `.git/config` (or `config.worktree`). Always pass `-c gpg.ssh.allowedSignersFile=<Counterpoint-home>/allowed_signers` on the command line, keep that file outside every worktree and deny agent reads/writes via the sandbox, **and** assert that `%GF` equals the pinned owner fingerprint. Use `GIT_CONFIG_NOSYSTEM=1` and an explicit `GIT_CONFIG_GLOBAL` for these verification calls.
  - **Bind approval to content.** Verify the commit is an ancestor of the PR head or equals it, and that the approved SHA/tree hash recorded in the signed commit (use a trailer such as `Approves: <sha>`) matches what is about to merge. A signed approval of an earlier head must not authorise a later push.
  - **Key handling.** Signing happens in the owner's terminal with a passphrase-protected key that is not added to `ssh-agent` or the macOS keychain ("never cached"). Counterpoint only prepares the command (for example `git commit --allow-empty -S -m ... --trailer ...`) and verifies the result. The SDK sandbox `denyRead` should cover `~/.ssh` for every agent session.

## 4. Durable state: SQLite vs files

**Recommendation: SQLite (`node:sqlite`) for operational state; files for blobs; git for signed truth.**

| Data | Where | Why |
|------|-------|-----|
| Runs, work items, attempts, parking state, gate results, usage figures, run settings, council cards/threads/meetings/turns, pin comments, `events` outbox | **SQLite** | Relational queries ("what is parked", "gate pass rate", "runway length"), transactional state transitions, crash recovery, and an autoincrement `events` table that doubles as the SSE replay log. Plain files make multi-writer updates (builder, server, council all writing) racy; the prototype's `factory/*.yaml` is exactly what PROJECT.md retired. |
| Gate logs, persona screenshots, diff images, raw SDK event streams | **Files** under `<home>/hosts/<host-id>/runs/<run>/...`; SQLite stores path, size, tail | Large and append-only; the UI needs "last lines one click away", which is a stored tail plus a file link. |
| Specs, decisions, approved mocks, approval commits, backlog items | **The host git repo** (via the adapter) | The owner signs these; they must be versioned and reviewable. Counterpoint reads planning truth, it does not own it. |
| Seat definitions, host settings | **Config file in the host repo** (YAML parsed with `yaml`, validated with `zod`) | Reviewable, per-host, committed. |

**Which SQLite binding.** Use `node:sqlite` (`DatabaseSync`). Reasons: zero install cost for `npx` (no native addon download or compile), the owner's own `test-lock.ts` already uses it, FTS5 works (verified), and Node 24/26 are the supported floor. Its status is "release candidate" (Stability 1.2), so wrap it in one `db/` module with a small repository interface. `better-sqlite3` 13.0.3 (Node >=22) is the drop-in fallback if a node:sqlite regression bites; it is mature but needs a prebuilt binary per platform. Settings: `PRAGMA journal_mode=WAL; foreign_keys=ON; busy_timeout=5000;`, STRICT tables, `user_version`-based migrations (a hand-rolled runner of about 40 lines; do not add a migration library).

**Query layer.** Hand-written SQL plus zod row parsing. Do **not** adopt Drizzle yet: `latest` is still 0.45.4 and the 1.0 line is `rc.5`; Kysely 0.29.8 has no built-in `node:sqlite` dialect. A thin typed repository per aggregate is enough for roughly 15 tables.

**Concurrency.** One writer process (the Counterpoint server). Keep transactions short. Use the same in-process event emitter to push to SSE after commit.

## 5. Running gates

**Recommendation: execa-spawned child in its own process group, judged by exit code, output teed to a file.**

- Spawn with `detached: true` (new process group), `stdin: 'ignore'`, `env: { CI: '1', FORCE_COLOR: '0', NO_COLOR: '1', ... }`, an explicit `timeout`, and `cancelSignal`. On timeout or stop, kill the **group** (`process.kill(-pid, 'SIGTERM')`, then `SIGKILL` after a grace period) so dev servers and test runners started by the gate do not orphan. A pass is exactly `exitCode === 0`; anything else (non-zero, signal, timeout) is a fail with a distinct stored reason.
- Pipe stdout+stderr to `<run>/<item>/<gate>.log` as it arrives (for the UI's live tail via SSE) and keep the last N lines in the `gate_results` row for "failing gate's last lines one click away". Strip ANSI for the stored tail (`strip-ansi` 7.2.0); render the log file as plain text in the UI, never as HTML. The prototype's `LogTail` rendering as plain React text was the right call (injection hardening).
- **Gate definitions are commands in the host's config**, not logic in Counterpoint. Counterpoint ships no knowledge of vitest/eslint.
- **Single test lock.** Reuse the owner's proven mechanism: SQLite `BEGIN EXCLUSIVE` on a file in a well-known location; the kernel drops the lock when the holder exits, so crashes cannot leave a stale lock (from `speckit-auto/test-lock.ts`). Gate runner acquires it for DB/e2e gates; pass the "held" marker to child processes so nested runs do not deadlock. Because `speckit-auto` already uses this lock, sharing the same file path lets old and new tooling coexist.
- Do **not** use `node-pty` (1.1.0, native addon) unless a gate genuinely needs a TTY; it complicates `npx` installs.

## 6. Visual gate: built screen versus approved HTML mock

**Recommendation: a layered gate where the deterministic layers decide pass/fail and the model layer only annotates.**

1. **Capture (deterministic).** `playwright-core` Chromium, fixed viewport list per screen (for example 390x844 and 1280x800), `deviceScaleFactor: 1`, `page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css', fullPage: true })`, fonts awaited via `document.fonts.ready`, `prefers-reduced-motion`, a fixed clock and locale, and `mask` locators for known dynamic regions. The **built screen must render the same fixture data as the mock** (intercept the host's data calls with `page.route` or seed fixtures); otherwise every diff is a data diff. Fixture-mode capture is a host-integration concern to settle in phase research.
2. **Pixel diff (exit-code check).** `pixelmatch` 8 with `threshold` about 0.1, `includeAA: false`, and `windowSize` so drift is judged by the worst local window rather than a global percentage that a large screen can hide in. Fail when mismatch exceeds the per-screen budget. Different image sizes are an immediate **layout drift** failure (pixelmatch requires equal dimensions). Write the diff PNG next to the log.
3. **Structural check (more robust than pixels).** Tag key elements in the mock with `data-cp-id`; in the same Playwright session compare each landmark's `boundingBox()`, computed font size/weight and colour tokens between mock and build within tolerances. This catches "the button moved 40 px" even when anti-aliasing noise is high and survives minor font rendering differences. It also reuses the identifiers the pin-comment overlay already needs.
4. **Vision-model review (advisory).** A short seat session (SDK, `Read` allowed on the three PNGs: mock, build, diff) classifies drift as cosmetic, intentional-looking or real, and writes a card. It **must not** decide pass/fail: it is non-deterministic and PROJECT.md requires gates to be commands judged by exit code.

**Consequence for the fidelity question:** a pixel gate only works if the mock is hi-fi (real tokens, real typography, real spacing). Low-fi wireframes can only support the structural and vision layers. So: hi-fi HTML mocks built from the host's own design tokens (for Cena, the Tailwind/shadcn token set) if the visual gate is to bind the builder; use low-fi only for the first "which layout" variant round, where nothing is being gated yet.

**`odiff-bin` 4.5.0** (Zig, 5-7x faster than pixelmatch per its README, `ignoreRegions`, `failOnLayoutDiff`, diff-mask output, native binary via optional platform packages) is a good upgrade if screen counts grow. At roughly tens of screenshots per feature, speed is irrelevant, and a pure-JS dependency is the better `npx` story. Keep the comparer behind a one-function interface so swapping is trivial. **Do not** use `resemblejs` 5.0.0 (last release 2023) or `looks-same` 10.0.1 (no advantage over pixelmatch for this use and a heavier dependency tree), and do not use Playwright Test's `toHaveScreenshot` baselines (they compare against a stored snapshot of the *build*, not against an external mock).

## 7. Driving a browser as a persona agent

**Recommendation: Playwright MCP, headless and isolated, attached per seat session through the SDK.**

```ts
mcpServers: {
  browser: {
    command: 'node',
    args: [playwrightMcpBin, '--headless', '--isolated',
           '--viewport-size', '390x844',
           '--output-dir', runDir,
           '--allowed-origins', 'http://127.0.0.1:4173'],
  },
},
strictMcpConfig: true,
allowedTools: ['mcp__browser__*', 'Read'],
```

- Snapshot mode (accessibility tree) is the default and needs no vision capability, which keeps persona sessions cheap and works with a "Cook who finds the UI hard to use" prompt: the persona reasons over roles, labels and tab order, which is where usability problems show up. Add `--caps=vision` only for seats that must judge visual layout.
- Microsoft's own README recommends the Playwright **CLI with skills** for most coding agents because it is more token-efficient, and keeps MCP for "specialized agentic loops that need persistent state and rich page introspection, such as exploratory automation". A persona wandering an app is that second case, so MCP is right here. `--allowed-origins` is documented as *not* a security boundary; enforce the real boundary with the SDK sandbox network allowlist.
- **Claude in Chrome is the wrong tool for the unattended path.** Per the official docs it needs a headed Chrome/Edge window with the extension, a `/login` claude.ai session (API keys and `setup-token` tokens disable it), asks for per-site permission, shares the owner's logged-in browser state, and the extension's service worker goes idle and drops the connection on long sessions. Use it only as a manual owner tool, not for overnight personas.
- **Computer use** (macOS native apps) is not needed; every Counterpoint surface is a browser. Do not enable it for any seat.
- Persona findings are advisory cards: store screenshots as files, findings as rows, never as gate failures.

## 8. Serving and commenting on standalone HTML mocks

**Findings on the existing tools (versions from npm, 2026-11-09):**

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

**Recommendation: build a small in-house "pins" overlay.** It is genuinely small, and it must integrate with the council (personas pin comments too), variants, redraw and the visual gate, none of which any tool above supports.

- **Delivery.** The mock server (a Hono route) serves the standalone HTML file from the host repo and **injects** `<script src="/__cp/pins.js">` before `</body>`. The file on disk stays pristine and committable.
- **Overlay.** Vanilla TypeScript compiled to one IIFE, UI in a **Shadow DOM** so mock CSS cannot leak in and vice versa (and `data-cp-ignore` on its own nodes). Hover-highlight picker; on click capture: `data-cp-id` if present, else a generated selector (`@medv/finder` 4.0.2), text snippet, `outerHTML` excerpt, bounding box, scroll offset, viewport width, and optionally a cropped screenshot taken server-side by Playwright. POST to `/api/mocks/:mock/pins`; SSE broadcasts so the owner sees seat pins appear live.
- **Agent hand-off.** A revise session receives `{selector, snippet, note, viewport}` and edits only that region; the pin stores the revision SHA so it can be marked resolved or re-anchored. Selector breakage after a redraw is expected; fall back to `data-cp-id` then text-content match, then show the pin as "detached" instead of dropping it.
- **Variants** (2-3 side by side) are separate HTML files rendered in a grid of iframes by the console, each with its own pin overlay; "more like B" is a new generation round anchored on B's file.
- **Do not** apply `html-to-image` 1.11.13 style client-side screenshots for evidence; server-side Playwright crops are exact and need no mock cooperation.

## 9. Parsing GSD's `.planning/` markdown

**Recommendation: use GSD's own CLI as the primary reader, remark as the fallback and the writer.**

- **Discovery:** the host project's installed `gsd-tools` (for Cena at `.claude/gsd-core/bin/gsd-tools.cjs`; package `@opengsd/gsd-core`, 1.20.1 here) already returns structured JSON. Verified read-only against Cena: `gsd-tools roadmap analyze --cwd <host>` returns phases with `number`, `name`, `goal`, `mode`, `depends_on`, `plan_count`, `summary_count`, `has_context`, `disk_status`; `phases list` and `phase-plan-index <n>` return directories and per-plan `id`, `wave`, `depends_on`, `autonomous`, `objective`, `files_modified`. The GSD adapter should call these via execa (with `--cwd`, `--raw`, `--pick`) so Counterpoint tracks GSD's own parsing rather than re-deriving it. Treat the output as a versioned contract: record the `VERSION`, validate with zod, and fail `doctor` on a mismatch.
- **Fallback / content-level parsing:** `unified` 11.0.5 + `remark-parse` 11.0.0 + `remark-frontmatter` 5.0.0 + `remark-gfm` 4.0.1 + `yaml` 2.9.1 + `unist-util-visit` 5.2.0, for sections the CLI does not expose (for example the Decisions block inside a phase CONTEXT.md) and for hosts with GSD but without `gsd-tools`.
- **Write-back = surgical splice, not round-trip.** Council decisions "written back through the adapter and committed" must produce a minimal diff. `remark-stringify` re-serialises the whole document and will reformat tables, bullets and emphasis. Instead locate the target node via mdast `position.start.offset/end.offset` and splice the original string. Add a round-trip test over the real Cena `.planning/` files.
- **Do not use `gray-matter`** 4.0.3: last published 2023, bundles `js-yaml` 3, and its default engines include a JavaScript front-matter engine. `.planning/` files are written by agents, so treat them as untrusted input. Use `yaml` for frontmatter.
- Writes go to a **worktree/branch**, committed, never straight into the owner's checkout.

---

## Installation

```bash
# Runtime (published dependencies)
npm install @anthropic-ai/claude-agent-sdk@0.3.319 --save-exact
npm install @anthropic-ai/sdk@1.6.0 @modelcontextprotocol/sdk@1.32.2 zod@4.6.7
npm install hono@4.13.17 @hono/node-server@2.1.6 commander@15.1.0 execa@10.2.1 yaml@2.9.1 pino@10.4.0 p-queue@10.0.0
npm install playwright-core@1.65.0 pixelmatch@8.0.0 pngjs@7.0.0 @playwright/mcp@0.0.84 --save-exact
npm install unified@11.0.5 remark-parse@11.0.0 remark-frontmatter@5.0.0 remark-gfm@4.0.1 unist-util-visit@5.2.0
npm install chokidar@6.0.0 strip-ansi@7.2.0

# UI (bundled at build time; devDependencies of the package)
npm install -D vite@8.3.7 @vitejs/plugin-react@6.3.0 react@19.3.1 react-dom tailwindcss@4.3.5 \
  @tanstack/react-query@5.107.1 @tanstack/react-router@1.170.46 @medv/finder@4.0.2

# Tooling
npm install -D typescript@~7.0.2 tsdown@0.23.7 vitest@5.1.0 @biomejs/biome@2.6.6 tsx@4.23.15 @types/node@26.6.6 pino-pretty@13.2.0

# One-time machine setup (owner's machine keeps caches on the Dock volume)
export PLAYWRIGHT_BROWSERS_PATH=/Volumes/Dock/Dev/Caches/ms-playwright
npx playwright-core install chromium
```

`counterpoint doctor` should verify: Node >=24; `git` >= 2.34 (SSH signing); `gh` authenticated; `claude` present and above a minimum version; `ssh-keygen` present; Playwright Chromium installed at the configured path; allowed_signers file present and outside any worktree; state directory on the intended volume.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Agent SDK (TS) | Raw `claude -p` spawning | If an SDK release breaks the build lane and a fix is not available, or the ~322 MB binary dependency becomes a problem even with `--omit=optional`. Keep the fallback runner designed for, not built. |
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
| `gray-matter` 4.0.3 | Unmaintained since 2023, old `js-yaml`, default JS front-matter engine can execute code; `.planning/` content is agent-written | `remark-frontmatter` + `yaml` |
| Shell-string process spawning (`exec`, `execa` with `shell: true`, template-string commands) | Injection via branch names, phase titles, comment text | `execFile`-style argument arrays through execa |
| Repo-local git config for `gpg.ssh.allowedSignersFile` | Agents in the worktree can rewrite it and approve themselves | `-c` flags on the command line, file outside worktrees, pinned fingerprint |
| A hard-coded context window (the prior art's `CONTEXT_WINDOW_TOKENS=1000000`) | Violates "budgets follow the model"; wrong for other models | `modelUsage[model].contextWindow` / `getContextUsage()` |
| Model-obeyed "please stop" hooks as the only budget enforcement | The model can ignore or mis-time it | Orchestrator-owned wrap-up turn via `interrupt()` / `streamInput()` |
| Parsing "limit reached" text for waits | Brittle across CLI versions and locales | Structured `rate_limit_event` and `api_retry` events (regex only as fallback) |
| Binding to `0.0.0.0` or relying on a Host check alone | Host check does not stop non-browser LAN clients (the prototype's own WR-01 note) | Bind `127.0.0.1` + Host allowlist + Origin check + token |
| Claude in Chrome for persona agents | Needs a headed, logged-in real Chrome, claude.ai login only, per-site prompts, drops long connections | Playwright MCP headless + isolated |
| Embedding Agentation, Stagewise or Onlook | React-only plus PolyForm Shield; AGPL IDE; Next/Tailwind code editor | Small in-house overlay |
| Vision-model verdict as a gate | Non-deterministic; violates "gates are commands judged by exit code" | Pixel + structural checks decide, model annotates |
| `@playwright/test` `toHaveScreenshot` for mock-vs-build | Compares against its own stored baseline, not an external reference | `playwright-core` + `pixelmatch` |
| Drizzle 0.45 / Prisma for the store | Drizzle 1.0 not stable, no first-class `node:sqlite`; Prisma is heavy and native | Thin repositories over `node:sqlite` |
| `remark-stringify` round-tripping for write-back | Rewrites the whole document, creating noisy diffs in the host's planning files | Offset-based string splicing guided by mdast positions |
| `node-pty` for gates | Native addon, complicates `npx`; gates are exit-code-judged and need no TTY | `execa` with piped output |
| Caching the signing key (ssh-agent, keychain) | Violates "approval key never cached"; lets an agent sign | Passphrase typed in the owner's terminal per approval |
| Putting runtime state in the host repo as YAML/JSON (`factory/*.yaml` style) | Explicitly out of scope; races, noisy git history | SQLite store plus files |

## Stack Patterns by Variant

**If the host has a Vercel (or similar) preview deploy:**
- Use `gh pr view --json statusCheckRollup` or the deployment status API to find the preview URL and put it in the PR and the inbox.
- Because PROJECT.md says to prefer the host's own preview, and Vercel toolbar comments then work for free on that URL (still not a dependency).

**If the host has no preview deploy:**
- Counterpoint starts the host's dev/preview command from the feature worktree with a free port (lock-file allocation like `speckit-auto` does, from 4174 upward) and serves it on loopback only.
- Because worktree-per-feature needs per-feature ports, and previews must not collide with the console port.

**If an SDK release breaks the build lane:**
- Switch `AgentRunner` to the CLI stream-json implementation.
- Because the port and the internal event schema are designed so both can emit the same events.

**If the pixel gate proves too noisy on a screen:**
- Mask dynamic regions, raise that screen's `windowSize` budget, and lean on the structural check.
- Because both signals are per-screen configurable, not global.

**If published to npm for other users:**
- Make the SDK's bundled platform binary optional, require a user-supplied `claude`, never perform logins, and re-read Anthropic's current terms for third-party tools.
- Because the SDK overview restricts third-party offering of claude.ai login and rate limits.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@anthropic-ai/claude-agent-sdk@0.3.319` | `zod@^4`, `@anthropic-ai/sdk@>=0.93.0`, `@modelcontextprotocol/sdk@^1.29.0` (all peers) | Install all three explicitly; npm 7+ auto-installs peers but pin them. Engines `>=18.14.0`, optional platform binaries `0.3.319` (darwin-arm64 about 322 MB unpacked). |
| `@hono/node-server@2.1.6` | `hono@^4 \|\| ^5.0.0-0` | Use Hono 4.13.x now. |
| `vitest@5.1.0` | `vite@^6.4 \|\| ^7 \|\| ^8`, Node `^22.12 \|\| ^24 \|\| >=26` | Matches Vite 8.3.7. |
| `@vitejs/plugin-react@6.3.0` | `vite@^8` only | Do not mix with Vite 7. |
| `tsdown@0.23.7` | `typescript@^5 \|\| ^6 \|\| ^7`, Node `^22.18 \|\| ^24.11 \|\| >=26` | Fine with TS 7. |
| `typescript-eslint` | `typescript <6.1.0` | **Incompatible with TS 7.** Hence Biome. |
| `execa@10.2.1`, `commander@15.1.0`, `p-queue@10.0.0`, `chokidar@6.0.0` | Node >=22 (chokidar >=22.22, commander >=22.12) | All satisfied by `engines >=24`. |
| `node:sqlite` | Node 22.5+ (flagless from 22.13), RC in 24/26 | Document the floor as Node 24. |
| `pixelmatch@8.0.0` | `pngjs@7.0.0` | Inputs must be same dimensions; pass `Uint8Array`/`Buffer` RGBA. |
| `@playwright/mcp@0.0.84` | bundles `playwright 1.65.0-alpha-*` | May pull a different Playwright than your `playwright-core@1.65.0`; browser downloads can then double. Set one `PLAYWRIGHT_BROWSERS_PATH` and check `npx playwright-core install` reports no second download. |

## Open Items to Verify in Phase-Level Research

1. **Context denominator on a real 1M-window model.** Compare `modelUsage[model].contextWindow`, `getContextUsage().rawMaxTokens` and the model's actual limit; confirm which one the 40% budget should use. (SDK type docs warn the window can be a smaller compaction window.)
2. **`rate_limit_event.resetsAt` unit** (seconds vs milliseconds) and behaviour on API-key versus subscription auth; confirm an end-to-end "wait until reset + 2 min" flow.
3. **Sandbox coverage on macOS:** prove `denyRead` actually blocks an agent's `cat ~/.ssh/...` and the Counterpoint token file, and that network rules block `curl 127.0.0.1:<console port>`.
4. **`node:sqlite` under sustained write load** with WAL and multiple readers (SSE replay while the builder writes).
5. **Fixture-mode rendering of host screens** so mock-vs-build compares like with like (Cena: Next.js 16 + Supabase).
6. **Terms review for a public release** (SDK/CLI use, branding, no login brokering).
7. **Whether `gsd-tools` JSON output is stable enough to treat as a contract**, or only `.planning/` markdown is.

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
- `gsd-tools roadmap analyze|phases list|phase-plan-index` run read-only against Cena: GSD CLI output shape (HIGH).

---
*Stack research for: Counterpoint (local mission control for autonomous SDD with Claude Code)*
*Researched: 2026-11-09*

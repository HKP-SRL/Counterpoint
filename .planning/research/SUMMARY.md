# Project Research Summary

**Project:** Counterpoint
**Domain:** Local mission control for autonomous spec-driven development (SDD) with Claude Code: build lane (worktree per GSD phase, exit-code gates, PRs, preview links), design sign-off (standalone mocks, element pins, visual gate), signed approvals, and an advisory multi-seat council
**Researched:** 2026-11-09
**Confidence:** MEDIUM overall (HIGH on runtime, git and storage layers; MEDIUM on council, visual gate, sandbox behaviour under `claude -p`)

## Executive Summary

Counterpoint is a single-owner, loopback-only local daemon with a prebuilt web console. It drives headless Claude Code sessions to turn approved GSD phases into gated, reviewable PRs, and it runs an advisory council beside the work. Experts building this kind of tool converge on a modular monolith: one Node 24+ process, an append-only SQLite event log (`node:sqlite`, WAL), blobs as files, git as the source of truth for plans and approvals, and server-sent events to a React SPA. Orchestration basics (worktrees, boards, PR creation, "send failing CI to the agent") are commoditising fast, and several vendors have shut down or been acquired in 2026. Counterpoint should borrow those basics and spend its effort on what no surveyed tool does: a runway metric, cryptographic human approval, exit-code-only gates, council cards that proceed on a logged recommended assumption, and comparing a built screen against a signed-off draft.

The recommended approach is vertical slicing. Prove one unattended run on one Cena QR-menu phase (CLI only, no UI beyond read-only views) before adding the console inbox, design drafts, council, or persona agents. Build the trust layer (key separation, approval verification, loopback guard, sandbox profile) before any automated merge exists, and build the runner's failure handling (usage-limit waits, fail-closed context budget, structured handoff, crash reconciliation) before adding more agents. Use the owner's installed `claude` binary through one `AgentRunner` port that consumes `stream-json`. For design fidelity, explore in low-fi "wire" mode and sign off a hi-fi draft rendered with the host's real tokens and fixtures. The visual gate should be structural first, with pixel diffs added only after a flakiness spike.

The key risks are: (1) the agent gaming its own gates (editing test config, skipping tests, updating baselines), which requires runner-owned gate definitions and a protected-path integrity check; (2) fail-open budget and limit handling that silently runs sessions into auto-compaction; (3) approval forgery through same-OS-user access to keys and config, which the design can only make costly, not impossible; (4) scope, since v1 as written contains about ten subsystems and no one has yet shown an overnight run; and (5) unverified platform behaviour, above all whether Claude Code's sandbox actually confines `claude -p` sessions. That last point is the first spike and gates the trust model.

## Decisions Needed From the Owner

These conflicts or deviations from PROJECT.md were found during synthesis. The roadmap should not lock them until the owner confirms.

| # | Question | Options from research | Recommendation |
|---|----------|----------------------|----------------|
| D1 | Agent runtime: Claude Agent SDK or spawn `claude` and parse `stream-json`? | STACK.md recommends the SDK (exact-pinned `@anthropic-ai/claude-agent-sdk@0.3.319`, pointed at the owner's `claude` binary). ARCHITECTURE.md recommends spawning `claude -p --output-format stream-json --verbose` directly. | **Spawn the CLI for v1**, behind a single `AgentRunner` port that emits one internal event type. Rationale: the event fields both documents need (`rate_limit_event`, `api_retry`, `result.modelUsage`, `system/init`) all appear in stream-json; the SDK is 0.x and releases very often; the SDK overview restricts third-party products from offering claude.ai login or rate limits, which is a publication question the CLI path avoids; and the owner already runs `claude -p` by hand. Keep the SDK as a second `AgentRunner` implementation to adopt only if mid-run wrap-up injection (`streamInput`) proves necessary. |
| D2 | Where do approvals live? PROJECT.md says "a signed git commit". | STACK.md verifies against the host repo with `-c` flags. ARCHITECTURE.md proposes a separate Counterpoint-owned `approvals.git` outside every repo, with an optional read-only mirror to host refs. | **Use a separate `approvals.git` as the authority.** The host repo's `.git/config` and hooks are shared with every worktree, so a builder could influence verification. The commit is still a signed git commit, but not in the host repo, which is a deviation from the literal PROJECT.md wording. **Owner must confirm.** |
| D3 | How does the GSD adapter read `.planning/`? | STACK.md: call the host's `gsd-tools` JSON verbs first, with remark as fallback. ARCHITECTURE.md: parse natively and do not shell out to `gsd-tools`. | **Parse natively** with frozen fixtures from Cena as the contract. `gsd-tools` install paths vary per runtime and its verbs are not a published contract (STACK.md lists this as an open item). Use `gsd-tools` only as an optional cross-check in `doctor`. |
| D4 | Do unanswered council cards always proceed on the recommendation? | PROJECT.md: yes, always logged as "assumed" and overturnable. PITFALLS.md: irreversible choices (schema, auth, public routes, data model, pricing, privacy) should park that item instead. | **Classify every card by reversibility at creation.** Reversible cards proceed as PROJECT.md says. Irreversible cards park only the dependent work item; the builder works on other runway. Owner to confirm the classification rule. |
| D5 | Parallel feature PRs all touch `.planning/STATE.md` and `ROADMAP.md`. | PITFALLS.md: keep bookkeeping out of feature branches and let one serialized bookkeeper or a planning worktree apply updates to base. ARCHITECTURE.md: a `Landing` service writes planning patches through a planning branch. | **Accept Landing as a constraint.** Builds never write planning files; planning writes go through one serialized path. |
| D6 | One PR per phase when a phase has 17 plans (Cena phase 01). | ARCHITECTURE.md flags PR size and the 12-session cap in prior art. | Keep plans as first-class `steps` in the model so checkpoint commits or stacked PRs can be added later without a model change. Owner to accept one PR per phase for v1 and watch review cost. |
| D7 | Design fidelity. | Explore low-fi, sign off hi-fi (FEATURES.md, STACK.md, PITFALLS.md agree). | **Confirm:** explore in "wire" mode (system font, neutral palette, real components and layout). Sign off a "full" render using the host's tokens and fixtures. The signed full render is the visual-gate reference. |
| D8 | Signing key protection. | PROJECT.md: passphrase, never cached. PITFALLS.md also suggests a FIDO2 `ed25519-sk` key with touch required. | Passphrase-only key for v1, never in ssh-agent or Keychain, plus a startup self-check. FIDO2 or Touch ID is an optional hardening (PROJECT.md already lists Touch ID as later). |
| D9 | Scope of v1. | PITFALLS.md and ARCHITECTURE.md both warn against building all subsystems before an overnight run works. | **Confirm the slice order in Implications for Roadmap.** Cut from v1 for now: variants side by side, "More like B" breadcrumbs, live watch and interject, gamification beyond runway and a few honest counters. |

## Key Findings

### Recommended Stack

One Node process: Hono 4 with `@hono/node-server` 2 serves a prebuilt Vite 8 / React 19 / Tailwind 4 / shadcn SPA from `dist/ui`. Bind `127.0.0.1` only, add a Host allowlist, Origin checks on non-GET requests, and a one-time code exchanged for an `HttpOnly; SameSite=Strict` cookie. Use SSE for server-to-UI push, where the SSE `id:` is the SQLite `events.seq` so reconnects resume exactly. Commands are plain POSTs.

**Core technologies:**
- **Node.js >= 24 (LTS):** runtime; the oldest line with `node:sqlite` available without a flag (still RC, Stability 1.2).
- **`node:sqlite` (`DatabaseSync`):** durable operational state (WAL, STRICT tables, FTS5 for transcripts). Wrap in a `db/` module as an easy swap to `better-sqlite3` if needed. The owner's `test-lock.ts` already uses it.
- **Hono 4 + `@hono/node-server` 2:** HTTP, SSE, static files, mock serving. Hono 5 is still a release candidate.
- **execa 10:** spawns `git`, `gh`, gate commands and `ssh-keygen` with argument arrays and no shell. Never `shell: true`.
- **`claude` CLI via `AgentRunner` (see D1):** the owner's installed binary, not a bundled one. The port keeps the SDK as an alternative.
- **zod 4 + `yaml`:** validate config, DB rows and API payloads, and parse per-host config. Do not use `gray-matter`.
- **Vite 8, React 19, Tailwind 4, shadcn, TanStack Query/Router:** UI. Built at publish time, not at runtime.
- **Playwright (`playwright-core` 1.65) + `pixelmatch` 8 + `pngjs` 7:** deterministic screenshots and pixel diffs for the visual gate. Set `PLAYWRIGHT_BROWSERS_PATH` onto the Dock volume.
- **`@playwright/mcp` (exact pin, headless, isolated):** browser tools for persona agents. Not Claude in Chrome, which needs a headed, logged-in browser and cannot run unattended.
- **Biome 2 (lint/format), Vitest 5, tsdown:** tooling. TypeScript 7 is fine with Biome, but `typescript-eslint` does not yet support TS 7.
- **In-house pins overlay (vanilla TS, Shadow DOM, injected by the mock server):** no existing tool fits (Agentation is React-only and PolyForm Shield; Stagewise is AGPL and pivoted to an IDE; react-grab has no persistent comments; Vercel comments only work on Vercel deploys).

**Critical version and platform requirements:**
- Exact-pin anything in the 0.x range (SDK if adopted, `@playwright/mcp`, tsdown, chokidar 6).
- Peer ranges to respect: `@hono/node-server` needs Hono `^4 || ^5.0.0-0`; SDK needs zod `^4`.
- Install caches on the Dock volume. Keep the pnpm store on the same volume as worktrees (cross-volume hardlinks fail).
- Gate `counterpoint doctor` on: Node >= 24, git >= 2.34 (SSH signing), `gh` authenticated, `claude` present at a supported version, `ssh-keygen`, Chromium installed, allowed-signers file outside any worktree, state directory on the intended volume.

### Expected Features

**Must have (table stakes; users expect these from any agent board, and the rest of the design depends on them):**
- Isolated git worktree per work item, with lifecycle (create, lock, rebase, prune on merge or abandon).
- One work item = one branch = one PR, with the PR body generated from phase artifacts.
- Run status model: queued, running, waiting on you, parked, gates failing, ready for approval, merged. Derived from run state on disk, not from agent output.
- Live session log with stop control (SSE tail, process-group kill).
- Per-item gate row with the failing gate's last lines one click away.
- Failure feedback loop to the builder, bounded retries, then park.
- Preview link on each PR: host deploy when one exists, otherwise a Counterpoint-served local preview.
- Usage-limit wait, API-error backoff, stop time, single test lock (port from prior art, do not rewrite).
- Needs-attention notification (one inbox, one local notification channel).
- Resume or retry after crash or reboot.
- Run report at the end of each run.
- Element-pinned comments on drafts, batched into one revision round; threads with resolve and reopen; whole-screen redraw with steering note; draft version history.
- Mock data only, with frozen deterministic fixtures. These are also the gate's fixtures.
- Council: named seats with a one-line "when to involve me" description; chair, agenda and bounded rounds; full transcript plus minutes; human can observe and interject; outputs as discrete items (cards, backlog, review notes); visible cost per meeting.

**Should have (differentiators; the product's reason to exist):**
- **Runway as the headline metric** (approved, unblocked work ahead of the builder). No surveyed tool measures owner independence.
- **Signed approval gate** (prepared command, verified signature, merge only after verification). The highest-risk, highest-differentiation feature.
- **Exit-code-only gates** ("done" never counts). Mostly discipline; the visible part is the gate row lighting up.
- **Context-budget handoff** at an adjustable share of the model's window, with the token figure displayed.
- **Parking with an attempt counter and a "Needs You" inbox**, including last failing output, attempts and a suggested question.
- **Rebase onto the owner's pushes, re-gate, park on failure.**
- **Visual gate against the signed-off draft** (new: comparing build against an approved mock has no prior art found).
- **Variants side by side with "More like B"** (v1.x, see Implications).
- **Persona pre-comments on drafts**, advisory and labelled as synthetic.
- **Council cards with the recommended option; unanswered cards proceed as "assumed", overturnable.** Pick, More like B, None fit (reframe), Later.
- **Council files backlog items** with evidence, tagged `council`, deduplicated and capped.
- **Dissent preserved** in cards (minority report field that cannot be deleted by the chair).
- **Independent first pass, then one anonymised cross-critique, then chair synthesis.**
- **Post-build persona review** by driving the running app (drive seats) or reading artifacts (reader seats). Advisory only.
- **Metrics that resist gaming:** runway length, rounds-to-converge, first-attempt gate pass rate, merged-without-intervention. Each should be paired with a counter-metric (see PITFALLS).

**Defer (v2+ or explicit anti-features for v1):**
- Multi-vendor agents (Claude Code only; anti-feature).
- Cloud-hosted execution (anti-feature; competes with funded vendors).
- Kanban board as planning source of truth (anti-feature; Counterpoint reads the plan, never owns it).
- Auto-merge when gates are green (anti-feature; violates signed approval).
- Agent self-reported completion as a gate (anti-feature).
- Council as a blocking gate, or persona opinions failing work items (anti-feature).
- Free-flow debate as the default meeting mode (anti-feature; opt-in only).
- LLM-chosen next speaker (anti-feature; use deterministic turn order).
- Majority vote or numeric consensus score (anti-feature).
- Numeric persona "usability scores" (anti-feature).
- Visual drag-and-drop design editor (anti-feature).
- Figma or Penpot import or round-trip (v2+).
- Real-time multi-user collaboration, accounts or roles (anti-feature; single owner).
- Pixel-exact zero-tolerance visual gate (anti-feature; flake).
- Built-in code editor (anti-feature; open the worktree in the owner's editor).
- Cross-provider billing dashboards (anti-feature).
- Touch ID or hardware-key signing (v2+, see D8).
- Public npm release (explicitly deferred).
- No-framework adapter (explicitly deferred).

### Architecture Approach

Use one npm package, `@alex-profir/counterpoint`, as a modular monolith with lint-enforced boundaries: `core/` never imports from `adapters/gsd`; `compose.ts` is the only place that wires the adapter into core. The daemon is the single writer. The CLI talks to it over a Unix socket. The Governor is the single chokepoint through which every agent spawn passes, holding global usage-limit state, class priorities (builder > owner-interactive > design > council-async > persona > meeting), concurrency caps and named leases (test lock, DB, browser, ports).

**Major components:**
1. **Framework adapter (`adapters/gsd`)**: pure function over a git ref. Parses plan into work items, steps, dependencies and prerequisites. Produces patches for decisions and backlog. Holds no state, runs no git. Frozen Cena fixtures are its contract tests.
2. **Planning model (`core/runway`)**: work item identity, derived status, runway computation, readiness (approved AND deps met AND prerequisites satisfied). Derived, never stored as authoritative.
3. **Approvals and trust (`core/approvals`)**: canonical approval statement, `prepare`, `verify`, trust anchor outside all repos, digest binding. `approved(item)` is a function recomputed from git, trust anchor and current content digests. The database caches it only.
4. **Build orchestrator (`build/`)**: worktree lifecycle, session loop with fresh sessions and handoffs, gate runner (exit code only), parking and retries, rebase-on-conflict, publisher (push, PR, preview), run report.
5. **Design drafts (`design/`)**: draft store with versions and variants, isolated draft origin (different port, sandboxed iframe, CSP), pin overlay, redraw jobs, signed-off baseline, visual gate command.
6. **Council engine (`council/`)**: seat registry, router, threads, meetings as a state machine, cards and rounds, decision ledger, persona QA, outputs. Stateless turns over a DB message log, not long-lived seat sessions.
7. **Governor (`core/governor`)**: see above.
8. **Agent runtime (`agent/`)**: spawns `claude` with per-session `--settings`, environment allow-list, stream-json parsing, usage and budget tracking, rate-limit extraction. The only module that knows the CLI's wire format.
9. **Store (`core/store`)**: SQLite schema and migrations, `append(event)` plus projectors in one transaction, blob references. JSONL export for backup.
10. **Server and UI**: thin HTTP and SSE layer with auth and Host/Origin guard; SPA is a read-only mirror of projections that sends commands back.

**Key patterns:**
- **Derive, don't store** for approval, readiness and runway. Recompute from git plus digests, so editing the spec or pinning a draft silently invalidates approval.
- **Approve by digest.** Runway approval binds spec, draft and config digests. Merge approval binds PR head SHA and the assumptions manifest. Merge uses `--match-head-commit`.
- **Propose by file, dispose by daemon.** Agents write handoffs and schema-validated output; the daemon validates and ingests. No agent-to-daemon network channel in v1.
- **Command, then events and projection in one transaction.** Projectors are deterministic and rebuildable from `events`.
- **Fresh-session continuity.** State lives in git, the handoff file, the ledger snapshot and SQLite. Restart, usage-limit wait, budget handoff and crash all take the same path. Crash-only: the daemon can be killed at any point and reconciles on boot.
- **Council never blocks the builder.** Builder reads a ledger snapshot at session start; unanswered cards become `assumed(recommended)` when dependent work starts; overturns become rework, not blockades.
- **Hostile content isolation.** Draft HTML is agent-authored and treated as hostile; it runs on a separate origin, with no cookie or API access.

**Security boundary (agents run as the same OS user):** the achievable guarantee is that an agent we spawn cannot obtain or use authority, and anything it can reach is non-authoritative. Key assets: signing key (passphrase-only, never cached, sandbox `denyRead`); trust anchor (outside repos, sandbox `denyWrite`); start/stop and privileged calls (cookie or Unix socket, never in env or argv); merge and push credential (daemon-owned, not in agent reach); state DB (not reachable and not authoritative). Hooks, permissions and deny rules are supplied through non-overridable settings, not an in-tree `.claude/settings.json`. Residual risk must be stated in the README: an agent that escapes the sandbox, or a compromised owner terminal, can reach same-user secrets. This is not OS-level separation. Tier 3 (separate macOS user) is the stronger option, only if untrusted projects are ever built.

### Critical Pitfalls

1. **Gate gaming (agent changes the instruments that judge it).** Runner must execute gate definitions from Counterpoint-owned config at the approved base commit, not from the worktree's `package.json`. Before each gate run, diff protected paths (test and lint configs, gate scripts, baseline images, `.github/`, `.claude/`, `CLAUDE.md`, lockfile policy) and park with `gate-config-touched` on any change. Also compare test count, skip/only/todo counts and suppression comments against base. A zero-test run fails regardless of exit code. Progress for stall detection is new commits that pass an incrementally re-run gate, not ticked checkboxes. *Prevent in P-Gates before any gate is trusted.*

2. **Silent no-op and false-success sessions.** Never infer success from exit code. Require a terminal `result` with a success subtype, empty or explained `permission_denials`, at least one new commit or declared no-op, and a post-condition artifact check. Record `error_max_turns` and `error_max_budget_usd` as first-class outcomes. Repeated denials are a park reason. *P-Runner.*

3. **Fail-open context budget and lossy handoff.** Do not parse the undocumented transcript JSONL. Measure from stream-json `usage` on main-loop assistant messages (input + cache creation + cache read, deduplicated by message id). Take the window from `modelUsage[model].contextWindow`, never a hard-coded number. Fail closed: if usage cannot be read for N events, stop and flag. Confirm the hook fired by checking `hook_started` events. Handoff must be structured (done, next, decisions made, tried and failed, open questions, gate state, files in flight), mostly machine-derived. The first action of every new session is to re-run gates; do not trust the handoff's "green". *P-Runner.*

4. **Cost explosion from council seats x rounds x cards, plus persona screenshots.** Keep a cost ledger from `result` events, keyed by lane, activity, seat and card. Pre-flight estimate before "all seats" or "call a meeting". Default bounds: two rounds, early exit when stable, three seats by default, per-seat output caps. Council and persona seats use a cheaper model tier than the builder. Do not copy the prior art's pin-everything-to-Opus. Persona runs use step caps, accessibility-tree observation first, and re-run only on material UI change. *P-Runner ledger, P-Council bounds.*

5. **Council starves the builder through shared quota, and resume thundering herd.** One governor pauses all lanes on any limit, resumes once with jitter, builder first. Classify errors from structured data (`api_retry` categories, `rate_limit_event`), not regex. Never retry on auth, billing or spend-limit errors; surface those in Needs You. Do not stack a wrapper retry on `CLAUDE_CODE_RETRY_WATCHDOG`. Use absolute wake timestamps re-checked on a timer, and reconcile after OS sleep. Store all times in UTC. *P-Runner governor; P-Council share before unattended council.*

6. **Orphans and lost state when the server dies.** Event log written before each side effect; children in their own process group with pid and start time recorded; on boot, reconcile running sessions to `interrupted`, kill orphans by pid and start time, reset worktrees to last commit, clear stale locks. The test lock must be kernel-released (SQLite `BEGIN EXCLUSIVE`, as in the owner's `test-lock.ts`). Idempotency keys so replays do not open duplicate PRs or post duplicate cards. *P-Runner first slice.*

7. **Same-OS-user "secrets agents cannot read" is not enforceable by file modes or flags.** Layered controls only: passphrase key never added to ssh-agent or Keychain (startup self-check fails if `ssh-add -L` lists it or `UseKeychain`/`AddKeysToAgent` would load it); sandbox `denyRead` covering `~/.ssh`, `~/.config/gh` and the Counterpoint home (the Claude Code sandbox leaves `~/.ssh` readable by default, and Read/Edit tools and hooks sit outside the Bash sandbox, so `permissions.deny` twins are needed); server-side ruleset requiring the Counterpoint approval status; agents hold no push or merge credential; explicit env allow-list (never inherit `SSH_AUTH_SOCK`, `GH_TOKEN`, `ANTHROPIC_API_KEY`, service-role keys or `COUNTERPOINT_*`); the signing command is a fixed form containing only IDs, and the script re-derives and prints what is being signed. *P-Trust, before any automated merge.*

8. **Signature verification that accepts the wrong thing.** Verify with command-line `-c` config (`gpg.format=ssh`, `gpg.ssh.allowedSignersFile` pointing at an owner-controlled path, `gpg.ssh.program` pinned) and pinned `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM`, ideally in a fresh clone or the separate approvals repo, never the agent's worktree. Use `-c log.showSignature=false`. The approval payload is structured and recomputed from live state: kind (runway or merge), item, base SHA, PR head SHA, digests, assumptions hash, nonce and expiry. Any head change after approval moves the item back to "awaiting approval". Test adversarially: wrong key, wrong namespace, tampered message, amended commit, config-injected program, expired approval, approval for another PR, replayed approval. *P-Trust, before P-Git merge automation.*

9. **Rebase-on-conflict that drops the owner's work or breaks semantics.** Never rebase in place; rebase a throwaway branch, verify, then push with `--force-with-lease=<expected sha>`. Post-rebase checks by code: `git range-diff`, assert upstream changes survive unless the plan declares ownership, regenerate lockfiles with the package manager, disable `rerere`. Re-run all gates including visual and DB after any base movement. Cap resolution attempts at one or two, then park. Keep resolution as a labelled commit. *P-Git.*

10. **Parallel worktrees falsely green (ports, dev servers, DB, env files, test lock).** Allocate ports from a Counterpoint registry and use strict ports so dev servers fail instead of drifting. Every app exposes a health endpoint returning worktree id and git SHA; gates assert the SHA. Set `reuseExistingServer: false` in gate profiles. Per-worktree Supabase project id and port block, or serialize one DB behind the lock with reset-to-fixtures. Create `.env.local` from a template with dummy values, never copy the owner's real secrets. Test lock: watchdog for holders over budget, no env-var bypass the agent can set, per-gate-class locks, builder priority. *P-Gates and P-Runner.*

11. **"Proceed on recommended default" becomes silent wrong decisions.** Classify each card by reversibility and blast radius (see D4). Assumptions ledger with ids, dependent commits and expiry, stored separately from the "locked decisions" section of host files (never written into CONTEXT.md as owner decisions). PR description lists assumptions; the merge approval enumerates them. Overturn shows the dependent commits and offers re-plan from here. Randomise or neutralise option order. Track override rate. *P-Council, P-Adapter, P-Git.*

12. **Council debate that converges, flatters or never ends.** Blind first round; anonymised reveal; at most one rebuttal round. Structured fields per claim (evidence pointer, confidence, strongest objection). Claims without evidence are demoted. Designated dissenter seat; minority views preserved verbatim. Mechanical stop conditions (turns, tokens, wall clock, no new evidence). Thread guards (depth limit, TTL, one open thread per seat pair). Dedupe cards against decisions by fingerprint; cap per meeting and per day. Occasionally run a single-seat baseline to check the council adds value. Same-model seats with identical context are the conformity case, so seat differentiation must come from information and tools, not persona prompts. *P-Council, P-Inbox.*

13. **Visual gate flaky or permanently red against low-fi mocks.** Only hi-fi mocks built from host tokens and shared fixtures support pixel comparison. Low-fi can only support structural checks. Deterministic capture: pinned browser, `document.fonts.ready`, fixed viewport and device scale, animations disabled (CSS and JS), frozen clock and locale, seeded fixtures used by both mock and built screen, masks for volatile regions. State mapping: unmapped states (loading, empty, error) are out of gate scope. Baselines are content-hashed, referenced from the signed approval, and the builder cannot update them. Require a re-run before a visual failure parks an item; track flake rate per screen. LLM visual judgement is advisory only. *P-Design (contract), P-Gates (determinism).*

14. **Loopback server reachable by browsers and agents.** Binding 127.0.0.1 is not enough. Validate Host against an exact allowlist on every request, including WebSocket and SSE upgrades. Validate Origin on every state-changing request and on WS and SSE. Require a custom header and JSON content type so mutating requests need a preflight. Per-session CSRF token and `HttpOnly; SameSite=Strict` cookie via a one-time code printed to the owner's terminal. No `Access-Control-Allow-Origin: *`. Drafts and previews on a different origin from the control API. Several MCP SDKs shipped CVEs for missing Host and Origin validation in 2025 (verify exact versions before citing). *P-Trust, before start and approve controls are exposed in the UI.*

15. **Agent-authored content as an injection and self-modification channel.** The agent branch can edit `.claude/settings.json`, hooks, `CLAUDE.md`, skills and `.mcp.json`, and `claude -p` without `--bare` runs project hooks with no trust dialog. Supply hooks and permissions through non-overridable settings outside the worktree. Add `.claude/**`, `CLAUDE.md`, `.mcp.json` and `.github/**` to the protected-path check. Give builders their own `CLAUDE_CONFIG_DIR`. Run Counterpoint's own git with `-c core.fsmonitor=false -c core.hooksPath=/dev/null`. Treat card evidence, app content and PR comments as data in prompts, never promoted to host files without owner action. Persona sessions get browser-only tools, no Bash, no secrets.

16. **Previews and drafts touching shared state.** Host Vercel previews on each push can hit shared Supabase or staging data. Preview environments need their own DB or branch and dummy third-party keys. Never run branch migrations against shared databases from unattended runs. Push previews once per gate-green state, not per commit. Local previews have TTL and teardown on merge or close.

17. **Writing into `.planning/` corrupts it or collides with the owner.** GSD parsers and multiple GSD agents depend on the exact layout. Use surgical edits inside Counterpoint-owned regions or new files, never whole-file rewrites. Compare-and-swap on the blob hash read earlier. Write only through the planning worktree and fast-forward, never into the owner's checkout; if the owner's checkout has uncommitted `.planning/` changes, queue and notify. Allocate backlog IDs at commit time against latest base. Contract tests on fixtures from pinned GSD versions; run GSD's own health check after each write; refuse to write outside the tested GSD version range. *P-Adapter.*

18. **Scope creep: ten subsystems before the first overnight run works.** The core value depends on the build lane's robustness, while council and design features are the most fun to demo. Slice vertically and prove each slice with a real overnight run on Cena's QR-menu roadmap before starting the next (see Implications). Pre-decide the v1 cut list. Pair every metric with a counter-metric (first-pass rate with gate-touch rate; resolved cards with override rate). *Roadmap-level.*

Additional moderate pitfalls to plan for: parking policy must classify environmental versus product failures so environmental ones do not consume attempts (P-Runner); permission-mode mismatch (`auto` is a classifier, not a boundary; prefer `dontAsk` with an exact allowlist derived from observed denials, plus explicit deny rules); CLI version drift (pin and record the Claude Code version per run, replay captured stream-json fixtures, including usage-limit, max-turns and permission-denied fixtures); persona testing can only observe what a browser sees (score task completion and dead ends, not taste); pin drift on redraws (stable `data-cp-id` assigned at draft creation and preserved; pins that cannot re-anchor show as "detached", not dropped); report truthfulness (run report generated from ledger, gates and approvals with SHAs; anything not re-verified since base moved is labelled stale); macOS friction (BSD `date`, `caffeinate -dims`, detect `/Volumes/Dock` disappearing mid-run, network git outside the sandbox); log retention (redact on write, restrict by OS user).

## Implications for Roadmap

Research supports a slice-by-slice roadmap where the unattended build lane is proven first and the council and design layers come after. The owner's stated core value ("approve and walk away, come back to green PRs") lives in the build lane; the most fun-to-build features (council meetings, variants) are the most at risk of scope creep.

**Suggested phase structure (one candidate sequence; roadmapper may renumber):**

### Phase 1: Foundations and loopback shell
**Rationale:** Everything else writes events and goes through the guard. Cheapest time to get boundaries, storage and security right.
**Delivers:** `COUNTERPOINT_HOME` layout on the Dock volume; per-host config loader (zod); `node:sqlite` event store with projector harness and migrations; daemon shell; loopback guard (Host allowlist, Origin on non-GET, one-time code to cookie, token file outside all worktrees); Unix socket for CLI; UI shell with SSE `Last-Event-ID` replay; import-boundary lint (`core` never imports `adapters/gsd`); `doctor` skeleton.
**Addresses:** Live status foundation; start/stop token requirement (partial).
**Avoids:** Pitfall 14 (loopback exposure), Pitfall 18 (boundaries before features).

### Phase 2: GSD adapter and read-only runway
**Rationale:** Proves "reads, never owns". Gives every later phase real data. Riskiest parser is tested early against Cena fixtures.
**Delivers:** `PlanSnapshot` from frozen Cena `.planning/` trees (phase `01-multi-tenant-foundation` with 17 plans, decimal phase `01.1`); work items, dependencies, prerequisites (`autonomous: false`, `user_setup`) surfaced as needs-owner items; runway skeleton; read-only runway and items UI; `gsd-tools` cross-check in `doctor` only (D3).
**Uses:** `yaml`, `unified` / `remark-parse` / `remark-frontmatter` / `remark-gfm` for body sections; zod for validation.
**Implements:** Framework adapter and planning model.
**Avoids:** Pitfall 17 (read path first; write-back deferred), Pitfall 11 (no assumed decisions written into host files yet).

### Phase 3: Agent runtime, Governor and platform spikes
**Rationale:** The platform risks surface here, and everything agentic depends on them. Can run in parallel with Phase 2 once Phase 1 lands.
**Delivers:** `AgentRunner` port; `claude -p --output-format stream-json --verbose` implementation with `--settings` per session; stream-json parser mapping to internal events; usage and budget tracker (fail-closed); rate-limit and `api_retry` classification; Governor with global `limitedUntil`, class priorities and named leases (including test lock); recorded stream-json fixtures for session limit, weekly limit, Opus limit, spend limit, auth failure, 529, max-turns and permission-denied; spikes for sandbox under `-p`, context denominator, `rate_limit_event.resetsAt` unit.
**Uses:** execa; Node process groups.
**Implements:** Agent runtime, Governor.
**Avoids:** Pitfall 2 (no false success), Pitfall 3 (fail-open budget), Pitfall 5 (quota starvation), Pitfall 21 (CLI drift).

### Phase 4: Approvals and trust
**Rationale:** Security-critical and defines the builder's input. Build before the builder so no "skip approval" path ever exists. Also the runway approval point that gates Phase 5.
**Delivers:** Canonical approval statement (kinds: runway and merge); `counterpoint sign` CLI that recomputes digests itself, prints what will be signed, and prompts for the passphrase on the TTY; separate `approvals.git` (pending D2); verifier with `-c` pinned config and fingerprint pin; adversarial fixture suite; `approved()` recomputed on use, with "approved version changed" inbox item; key self-check (never in ssh-agent or Keychain); sandbox profile builder (`denyRead` for keys, token, DB; `denyWrite` for trust anchor and host git config).
**Avoids:** Pitfall 7 (same-user secrets, layered), Pitfall 8 (verification accepts wrong things), Pitfall 15 (in-tree settings loosening).

### Phase 5: Build lane, slice 1 (one phase, CLI first)
**Rationale:** This is the core value. Prove one overnight run on one Cena phase before anything else. No UI beyond read-only views.
**Delivers:** Worktree per phase under `<repo>-worktrees/<phase>` on `cp/<phase>`; session loop with fresh sessions, structured handoff, context budget at 40% (adjustable per run), progress from files not claims; gate runner (Counterpoint-owned definitions, exit code only, process group, timeout, log file and tail in SQLite); protected-path and test-count integrity checks; zero-test guard; parking after N attempts with environmental failures not counted; usage-limit wait and crash reconciliation; stop time; run report from ledger; trailer `Counterpoint-Run:` on commits; cost ledger from `result` events.
**Addresses:** Build lane table stakes; gate and parking differentiators; run report; usage-limit and stop-time requirements.
**Avoids:** Pitfalls 1, 2, 3, 4, 6, 10 (worktree part), 19, 24.
**Exit criterion:** an unattended overnight run on a real Cena phase reaches a parked or green state with no false success, no orphan processes and a correct run report. Only then continue.

### Phase 6: PRs, preview, rebase and merge
**Rationale:** Completes the "come back to PRs" loop. Requires approvals (Phase 4) and the build lane (Phase 5).
**Delivers:** Daemon pushes with its own credential, builder never pushes; `gh pr create` with generated body and assumptions section; host deploy preview link when available, else local preview on an allocated port with SHA health check; rebase on a throwaway branch with `--force-with-lease`, range-diff checks, re-gate all; merge approval bound to PR head SHA, merged with `--match-head-commit`; host branch-protection recipe printed by `init` (verify on Cena before this phase); cleanup rule (only when last PR merged and tree clean; dry-run for first N runs).
**Uses:** `gh` (no Octokit, no stored token); `git` via execa.
**Avoids:** Pitfall 9 (rebase), Pitfall 14 (preview origin), Pitfall 16 (preview DB), Pitfall 28 (cleanup).

### Phase 7: Owner surfaces: Needs You inbox and mission view
**Rationale:** Only after the overnight loop works (PITFALLS: UI before proof is a warning sign). Surfaces what Phases 5 and 6 already produce.
**Delivers:** Tiered Needs You inbox (blockers first, digest the rest); gate row with last failing lines, flake history and gate-touch flags; live log tail and stop control; start and stop with token; macOS notification; runway headline.
**Addresses:** Needs-attention notification; live log and stop; mission view.
**Avoids:** UX pitfalls around inbox noise and rubber-stamping.

### Phase 8: Design drafts and sign-off (structural gate first)
**Rationale:** Part of the build lane but not needed for the first unattended run. Fidelity decision (D7) is settled here. The signed draft becomes runway approval point one.
**Delivers:** Draft store with versions; wire and full render modes from one artifact; isolated draft origin (sandboxed iframe, CSP, postMessage overlay); in-house pins overlay (Shadow DOM, `data-cp-id` with fallback to CSS path and text snippet, detached state); element-pinned comments batched into one revision round; whole-screen redraw with steering note; draft version history; sign-off copies the chosen full render into the host (`.counterpoint/drafts/`) and enters the runway digest; visual gate structural tier only (landmarks, order, bounding boxes, computed tokens), deterministic capture.
**Uses:** `playwright-core`, Hono for mock serving, `@medv/finder`.
**Avoids:** Pitfall 13 (fidelity and contract), Pitfall 23 (pin drift), Pitfall 16 (draft preview origin).

### Phase 9: Council cards (single round) with ledger and write-back
**Rationale:** The owner's signature interaction. Needs the adapter write path (Phase 2 read; write-back starts here), Governor classes (Phase 3) and the builder's snapshot read (Phase 5).
**Delivers:** Seats config (per host, zod-validated, with defaults); single-shot card generation with `--json-schema` output and read-only tools; card model with recommended option, reversibility class and `neededBy`; Pick, More like B (as a child round), None fit (reframe), Later; assumed and overturned semantics; decision write-back through a Landing service (planning worktree, serialized, GSD format per fixtures) and committed; builder `context.json` snapshot at session start; assumptions listed in PR and merge approval.
**Addresses:** Council planning cards, assumed semantics, Pick and decision write-back.
**Avoids:** Pitfall 11 (proceed on default), Pitfall 17 (write-back), Pitfall 12 (blind single round, dissent field), Pitfall 4 (cost bounds).

### Phase 10: Council meetings, threads, router and backlog filing
**Rationale:** Heaviest agent spend. Needs Governor classes proven and the single-round card model stable.
**Delivers:** Async threads (depth limit, TTL, one open thread per seat pair); structured meetings as a state machine (agenda, chair, deterministic turn order, caps on turns, tokens and wall clock, minutes, schema-validated outputs); live watch and interject (SSE; interjection counts against budget); router (deterministic first, optional cheap LLM call, owner's "all seats" override with pre-flight cost estimate); council backlog filing via adapter with `council` tag, evidence refs, dedupe by fingerprint, per-meeting and per-day caps, one summary inbox item.
**Avoids:** Pitfall 12 (debate failure modes), Pitfall 5 (council share of quota), Pitfall 17 (backlog spam).

### Phase 11: Visual pixel tier, variants and persona pre-comments
**Rationale:** Pixel comparison needs the flakiness spike result and a stable hi-fi draft pipeline. Variants and persona pre-comments need draft anchors and seats.
**Delivers:** `pixelmatch` tier with per-screen tolerance and masks, advisory until the flake rate is acceptable; re-run before parking on visual failure; variants side by side (wire mode grid of iframes, each with its own pins); persona pre-comments on drafts, labelled as synthetic and advisory.
**Avoids:** Pitfall 13 (flake), Pitfall 22 (persona limits).

### Phase 12: Post-build persona review and gamification
**Rationale:** Needs running previews reliable (Phase 6), seats (Phase 10) and browser tooling. Gamification last, because it is a Goodhart risk.
**Delivers:** Drive seats (Cook, waiter, diner) via `@playwright/mcp` headless and isolated, browser-only tools, step caps, a11y-tree first; reader seats (tech, compliance) on artifacts; findings as advisory cards with evidence and re-run reproduction; per-seat accept and dismiss rate; runway and metrics panel paired with counter-metrics.
**Avoids:** Pitfall 15 (persona tool scope), Pitfall 22, Pitfall 18 (metrics Goodhart).

### Phase Ordering Rationale

- **Trust before automation:** Phase 4 precedes any path that can merge (Phase 6). The builder in Phase 5 may run only against an approval verified in Phase 4.
- **Runner failure handling before more agents:** Phase 3 (Governor, budget, classification) precedes Phase 5 and any council work, because quota and fail-open budgets are the first bottleneck.
- **Overnight proof gates UI and council:** Phase 5's exit criterion must hold before Phases 7 onward. This is the main defence against Pitfall 18.
- **Council after a working build lane:** Cards (Phase 9) need the builder's snapshot read and Landing; meetings (Phase 10) need proven Governor classes. Persona review (Phase 12) needs previews and seats.
- **Design is parallel-capable:** Phase 8 can run alongside Phase 9 once Phase 5 lands, but the visual pixel tier waits for the flakiness spike.

### Research Flags

Phases likely needing deeper research during planning (`/gsd-plan-phase --research-phase <N>`):
- **Phase 3:** Sandbox behaviour under `claude -p` (does `denyRead` hold for Bash and the Read tool?); context denominator on a real 1M-window model (`modelUsage.contextWindow` vs `getContextUsage().rawMaxTokens`); `rate_limit_event.resetsAt` unit and presence on subscription vs API-key auth; stream-json fixtures for every limit type. These are the top three spikes.
- **Phase 4:** macOS key handling (passphrase-only, never in ssh-agent; whether a FIDO2 or Touch ID option is worth adding); managed-settings precedence (`/Library/Application Support/ClaudeCode/`) versus `--settings` and session settings; verifier edge cases against git 2.50 behaviour.
- **Phase 5:** Process-group kill semantics on macOS; which gate commands need `excludedCommands` escape hatches (Docker and Supabase are incompatible with the sandbox); one-PR-per-phase size at 17 plans; GSD unit of session (phase or plan).
- **Phase 8:** Fidelity spike on Cena (same fixtures, same viewport, structural tier plus masked pixel tier; measure false positives over 20 runs); stable `data-cp-id` contract across 5 revisions; fixture-mode rendering of Next.js 16 and Supabase screens.
- **Phase 9:** Landing strategy for planning commits while the owner works on master; GSD write formats for `NN-CONTEXT.md` decision entries (with reversibility notes) and `BACKLOG.md` versus `999.x` phases; whether `commit_docs` can be disabled in feature worktrees.
- **Phase 10:** Protocol bounds (rounds, tokens, cost per card) measured in dry runs; router accuracy against owner-labelled activities.
- **Phase 12:** Persona reliability under `@playwright/mcp`; token cost per screen walk; whether Playwright MCP and the CLI-with-skills path differ materially.

Phases with standard, well-documented patterns (skip research-phase):
- **Phase 1:** Hono SSE, loopback guard and cookie flow, `node:sqlite` event store with projector pattern. Verified in STACK.md with official docs.
- **Phase 6:** `git worktree`, `gh pr create` and `gh pr merge --match-head-commit`, squash-merge-aware cleanup from prior art. Exception: the host branch-protection recipe should be verified against Cena's repo settings.
- **Phase 7:** Standard inbox, live tail and tiered notifications.
- **Phase 2:** Adapter contract tests on frozen fixtures; the research gap is in format drift, not method.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH on runtime, storage, git, gates; MEDIUM on SDK API stability and visual layer | Versions read from the npm registry on 2026-11-09. SDK behaviour checked against published type definitions. Git signing behaviour tested locally on git 2.50.1 with real ed25519 keys. Visual-layer tools are design choices with no off-the-shelf winner. |
| Features | MEDIUM | Competitor facts come mostly from third-party blogs and search snippets; several vendor claims are MEDIUM or LOW (e.g. Copilot trailer). Council evidence rests on 2025-2026 preprints, read partly in snippets, and is directional. Fidelity studies are small. Anti-features are well supported by the same sources. |
| Architecture | MEDIUM-HIGH | Prior art (`speckit-auto`, Cena prototype) read first-hand, which is HIGH for what those tools do. Claude Code platform facts from official docs fetched 2026-11-09 are MEDIUM because the sandbox-under-`-p` behaviour is not stated in the docs. Governor, Landing, approvals-repo placement and the security model are original proposals, flagged as such. |
| Pitfalls | MEDIUM | Claude Code flag and permission behaviour is confirmed against official docs. Debate and reward-hacking findings are directional single-task studies. Git, worktree, pnpm and Supabase items are engineering judgement, tagged `[JUDGMENT]` in the source and to be verified in their owning phase. |

**Overall confidence:** MEDIUM. The stack and state design are solid enough to start Phase 1 now. The trust model, the sandbox under `claude -p` and the fidelity contract for the visual gate are not yet proven and must be spiked before their phases are planned in detail.

### Gaps to Address

- **Sandbox coverage under `claude -p`:** unverified whether `denyRead` and `permissions.deny` hold for Bash, Read and Edit, and whether `allowLocalBinding` blocks `curl 127.0.0.1:<console port>`. Handling: 30-minute probe at the start of Phase 3; if it fails, wrap the whole `claude` process (`srt`, research preview) or accept a documented weaker boundary. Blocks the trust model.
- **Context denominator:** `modelUsage.contextWindow` may only appear at the end of a `result`; `getContextUsage().raw_max_tokens` may be a smaller compaction window. Handling: spike on a real 1M-window session in Phase 3; probe-call fallback per model.
- **`rate_limit_event` shape:** `resetsAt` unit (seconds or milliseconds) and whether it is present on rejection are unconfirmed; the official docs do not show a fixture for a subscription limit. Handling: capture real events during a forced limit in Phase 3; regex fallback behind the same interface, classified as "unknown limit text: bounded wait and notify".
- **Hardware-touch and agent-loaded keys:** one report suggests agent-loaded FIDO2 keys may not prompt visibly. Handling: test in Phase 4 only if D8 is taken.
- **Fixture-mode rendering of host screens:** mock and build must render identical fixtures for the visual gate to be meaningful. Handling: spike on Cena in Phase 8; the host's data calls may need `page.route` interception or a gate-only route.
- **Visual gate false-positive rate:** no prior art for build-versus-mock comparison. Handling: measure over 20 runs in Phase 8 before enabling pixel gating (Phase 11).
- **GSD write formats and version stability:** `NN-CONTEXT.md` decision entries, `BACKLOG.md` versus `999.x`, and whether the `gsd-tools` JSON is stable enough to rely on. Handling: golden-file tests on Cena trees in Phase 2 and Phase 9; refuse writes outside the tested GSD version range.
- **Claude Code native overlap:** cloud sessions, routines, auto-fix PRs, teleport and agent teams may cover some scope. Research search returned conflicting flag names. Handling: re-check current Claude Code docs before locking Phases 6 and 9 to make sure Counterpoint is not duplicating a native feature.
- **Council effectiveness:** the evidence that multi-agent debate improves accuracy is weak; the evidence for failure modes is stronger. Handling: keep council features behind flags until accepted-card and override rates justify them; run single-seat baselines.
- **Host branch protection:** the `counterpoint/approval` required status and the ruleset recipe for Cena's `master` are not verified. Handling: verify against Cena's repo settings before Phase 6.
- **Publication terms:** the SDK overview restricts third-party claude.ai login and rate limits. The CLI-first choice (D1) reduces this, but a pre-publish terms review is still needed. Handling: scheduled for pre-publication, not Phase 1.
- **Cost model:** `total_cost_usd` and `modelUsage` are client-side estimates. Handling: use for relative budgeting only, not as billing; the ledger should say so.
- **Persona driving reliability:** no measured data on `@playwright/mcp` token cost per screen walk. Handling: measure in Phase 12; keep persona findings advisory regardless.

## Sources

### Primary (HIGH confidence)
- npm registry, queried 2026-11-09 (`npm view`): versions, engines, peer dependencies, dist-tags, licences for all packages named in STACK.md.
- `@anthropic-ai/claude-agent-sdk@0.3.319` published type definitions (`sdk.d.ts`): `Options`, `Query` (`getContextUsage`, `interrupt`, `streamInput`, `close`), `ModelUsage.contextWindow`, `SDKContextUsage`, `SDKRateLimitEvent`, `SDKAPIRetryMessage`, `SDKResultError.subtype`, `HOOK_EVENTS`, `SandboxFilesystemConfig.denyRead`, `pathToClaudeCodeExecutable`, `settingSources`, `strictMcpConfig`, `createSdkMcpServer`.
- Local git experiments (scratch repo, git 2.50.1, ed25519 keys): `verify-commit` exit codes, `%G?`/`%GF` output, "No principal matched" behaviour.
- Node.js documentation: `node:sqlite` (Stability 1.2), Node 24 and 26 LTS status.
- Claude Code documentation, fetched 2026-11-09: https://code.claude.com/docs/en/agent-sdk/overview, `.../agent-sdk/cost-tracking`, `.../agent-sdk/hooks`, `.../headless`, `.../cli-reference`, `.../sandboxing`, `.../hooks`, `.../permission-modes`, `.../errors`, `.../managed-settings`, `.../agent-teams`, `.../chrome`.
- Hono docs (`streamSSE`) and `honojs/node-server` releases.
- Prior art, read first-hand: `/Volumes/Dock/Projects/HKP/CV/tools/speckit-auto/` (`run.sh`, `gates.sh`, `checks.sh`, `context-budget.sh`, `env.sh`, `expect.sh`, `tasks-status.sh`, `worktree.sh`, `test-lock.ts`, `README.md`); Cena `.planning/` (`ROADMAP.md`, `BACKLOG.md`, `STATE.md`, `config.json`, phase `01-multi-tenant-foundation`); Cena branch `ccr-61ff69b1-hgtpdm` (`lib/factory/guard.ts`, `lib/factory/signature.ts`, `app/__mission/*`, `proxy.ts`, `factory/*.yaml` as ideas only).
- Owner documents: `/Volumes/Dock/Projects/HKP/Counterpoint/.planning/PROJECT.md` and `VISION.md`.
- `gsd-tools roadmap analyze`, `phases list`, `phase-plan-index` run read-only against Cena (output shape).

### Secondary (MEDIUM confidence)
- Official product docs for mock-commenting and design tools: Vercel toolbar comments (https://vercel.com/docs/comments), Lovable visual edit, Stagewise docs, react-grab, Agentation, v0 design mode, Claude Design support article (not fully read).
- Playwright MCP README (https://github.com/microsoft/playwright-mcp); `pixelmatch` and `odiff` READMEs; Playwright visual regression community posts.
- Competitor landscape (third-party): crystl.dev, nimbalyst, conductor.build checks tab, siliconangle (Meta acquires Conductor, 2026-11-04; timelines conflict across outlets), Vibe Kanban shutdown notice (https://vibekanban.com/blog/shutdown), GitHub Copilot cloud agent session tracking docs.
- Multi-agent research: DeliberationBench (arXiv 2601.08835, preprint), "The Cost of Consensus" (arXiv 2605.00914), Council Mode (arXiv 2604.02923), MAST failure taxonomy (arXiv 2503.13657, NeurIPS 2025 D&B), Karpathy `llm-council`, AutoGen speaker-selection docs.
- Reward hacking and debate-dynamics studies: EvilGenie (https://alphaxiv.org/abs/2511.21654), ImpossibleBench (lesswrong), "Can LLM Agents Really Debate?" (arXiv 2511.07784), "Peacemaker or Troublemaker" (arXiv 2509.23055), "An Empirical Study of Group Conformity" (arXiv 2506.01332), "Not All Flips Are Conformity" (arXiv 2606.00820).
- Fidelity studies: UBC thesis (open.library.ubc.ca item 1.0437959), Cambridge fidelity study (different population).
- Security advisories for missing Host and Origin validation in MCP SDK local servers (CVE-2025-66414 TypeScript SDK, CVE-2025-66416 Python SDK; verify versions against GitHub advisories before citing).
- Yubico FIDO2 SSH guide (https://developers.yubico.com/SSH/Securing_SSH_with_FIDO2.html).

### Tertiary (LOW confidence, needs validation)
- Terragon and Jules/Roo Code shutdown reports (secondary sources only).
- Copilot `Agent-Logs-Url` commit trailer (third-party report; verify against GitHub docs before relying on it).
- Synthetic-user validity commentary (zurb, userbrain; single secondary sources).
- CrewAI hierarchical process, MetaGPT and ChatDev role mechanics (from training knowledge, not re-verified).
- Anthropic `sandbox-runtime` (`srt`) research preview (https://github.com/anthropic-experimental/sandbox-runtime): maturity unverified.
- Multi-agent cost compounding second-hand summary (augmentcode guide).

---
*Research completed: 2026-11-09*
*Ready for roadmap: yes, once owner confirms D1 through D9. D1, D2 and D4 change phase content.*

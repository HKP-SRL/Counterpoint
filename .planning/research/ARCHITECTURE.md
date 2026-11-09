# Architecture Research

**Domain:** Local mission-control for autonomous spec-driven development with Claude Code (build lane + planning lane + advisory council)
**Researched:** 2026-11-09
**Overall confidence:** MEDIUM-HIGH (prior art read first-hand = HIGH; Claude Code / Node platform facts from official docs fetched this session = MEDIUM, single-source items flagged LOW; component design is synthesis and is marked as such)

---

## 0. Decisions at a Glance

| # | Question | Recommendation | Confidence |
|---|----------|----------------|------------|
| 1 | Single package vs core + adapters | **One package** (`@alex-profir/counterpoint`), modular monolith, boundaries enforced by lint (`eslint-plugin-boundaries` or `dependency-cruiser`), adapter contract exported as a subpath (`/adapter`). Split out an `adapter-api` package only when a 2nd adapter exists. | HIGH |
| 2 | Process model | **One long-lived local daemon per host** (`npx counterpoint`) = HTTP+SSE server + UI + orchestrators. Single writer to state. CLI verbs talk to it over a Unix socket. | HIGH |
| 3 | Event log vs DB | **SQLite (`node:sqlite`, WAL) holding an append-only `events` table as system of record for operational history, with projections updated in the same transaction.** Git holds approvals, plan truth and signed-off artifacts. Big blobs (stream-json, transcripts, screenshots) are files referenced by path+sha. Not full event sourcing, not YAML files. | MEDIUM-HIGH |
| 4 | Where "approved" lives | **A signed commit in a Counterpoint-owned approvals repo** (outside any agent-writable tree). `isApproved()` is a pure function recomputed from git + trust anchor + current content digests. The DB only caches it. | MEDIUM-HIGH |
| 5 | Agent runtime | **Spawn the `claude` CLI directly** (`-p --output-format stream-json --verbose`), not the Agent SDK. Parse `rate_limit_event`, `system/api_retry`, `result.modelUsage`. Agents *propose* via files / `--json-schema` output; the daemon *disposes*. | MEDIUM |
| 6 | Council vs builder | **Decision ledger + snapshot-at-session-boundary.** Builder never awaits the council; council never writes into a build worktree. Unanswered cards resolve to `assumed(recommended)` when the builder reaches dependent work. | HIGH (design) |
| 7 | Security boundary | **Not "hide the key from the same OS user" but "make the key useless without a human, and make everything agents can reach non-authoritative":** passphrase-only key, trust anchor outside repos, approvals re-verified at use time, agents sandboxed (Claude Code sandbox + permission denies), daemon holds all push/merge credentials, privileged API on a Unix socket + cookie. Residual risk stated honestly (section 5). | MEDIUM |
| 8 | Shared quota / resources | **A `Governor`** every spawn goes through: global usage-limit pause, priority classes (builder > owner-initiated > council), concurrency caps, named leases (test lock, DB, browser, ports). | HIGH (design) |

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ OWNER SURFACES                                                                        │
│  Browser UI (SPA, 127.0.0.1)         Terminal: `counterpoint sign <id>`  (passphrase) │
│  Needs-You inbox · Runway · Gate rows · Drafts+pins · Council cards · Live meeting    │
└───────────────┬───────────────────────────────────────────────────▲──────────────────┘
        REST + SSE (cookie, Host/Origin guard)                 Unix socket (CLI only)
┌───────────────▼───────────────────────────────────────────────────┴──────────────────┐
│ DAEMON (single process, single writer)                                               │
│ ┌────────────────────────────── server / command bus ───────────────────────────┐   │
│ │ authN (owner cookie, scoped session capabilities) · validate · append events   │   │
│ └──┬─────────────┬──────────────┬──────────────┬───────────────┬────────────────┘   │
│    │             │              │              │               │                     │
│ ┌──▼─────┐  ┌────▼─────┐  ┌─────▼─────┐  ┌─────▼──────┐  ┌─────▼──────┐             │
│ │Planning│  │  Build   │  │  Design   │  │  Council   │  │ Approvals  │             │
│ │ Model  │  │Orchestr. │  │  Drafts   │  │  Engine    │  │ & Trust    │             │
│ │(runway,│  │(worktree,│  │(store,    │  │(seats,     │  │(statement, │             │
│ │ items) │  │ sessions,│  │ pins,     │  │ router,    │  │ verify,    │             │
│ │        │  │ gates,   │  │ variants, │  │ threads,   │  │ trust      │             │
│ │        │  │ publish) │  │ visual    │  │ meetings,  │  │ anchor)    │             │
│ │        │  │          │  │ gate)     │  │ cards,     │  │            │             │
│ │        │  │          │  │           │  │ personas)  │  │            │             │
│ └──┬─────┘  └────┬─────┘  └─────┬─────┘  └─────┬──────┘  └─────┬──────┘             │
│    │             │              │              │               │                     │
│ ┌──▼─────────────▼──────────────▼──────────────▼───────────────▼──────────────────┐  │
│ │ GOVERNOR  (usage-limit pause · priority · concurrency · leases: test/db/browser) │  │
│ └───────────────────────────────┬──────────────────────────────────────────────────┘  │
│ ┌───────────────────────────────▼──────────────────────────────────────────────────┐  │
│ │ AGENT RUNTIME  spawn `claude -p` · sandbox profile · stream-json parse · budget  │  │
│ └───────────────────────────────┬──────────────────────────────────────────────────┘  │
│ ┌───────────────────────────────▼──────────────────────────────────────────────────┐  │
│ │ STORE: SQLite events + projections │ blob files │ git adapters (host, approvals) │  │
│ └──────────────────────────────────────────────────────────────────────────────────┘  │
│ ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│ │ FRAMEWORK ADAPTER (interface in core; GSD implementation in adapters/gsd)        │  │
│ └──────────────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────┬───────────────────────────────────────┬──────────────┘
                                │ sandboxed child processes             │ reads/writes
                ┌───────────────▼─────────────┐           ┌─────────────▼──────────────┐
                │ claude sessions (builder,   │           │ HOST REPO (Cena)           │
                │ design agent, seats,        │──files───▶│ .planning/ (GSD truth)     │
                │ personas) + gate commands   │  in wt    │ counterpoint.config.yaml   │
                └─────────────────────────────┘           │ worktrees (build) ─────────│
                                                          └────────────────────────────┘
        $COUNTERPOINT_HOME (outside host repo; denied to agents):
          db.sqlite · approvals.git · trust/ · run/ (socket, token) · logs/ · drafts-wip/
          locks/  (the one exception: readable+writable by sandboxed sessions, low integrity)
```

### Component Responsibilities

| Component | Owns | Talks to | Must NOT |
|-----------|------|----------|----------|
| **Framework Adapter** (`adapters/gsd`) | Parsing host plan into `PlanSnapshot` (work items, steps, deps, spec refs); *producing patches* for decisions/backlog; build invocation text; step-progress detection; prerequisites (`user_setup`, `autonomous:false`) | Host repo files (read at a git ref; write = return patch) | Hold state, run git, know about approvals, council, or UI |
| **Planning Model** (`core/runway`, `core/workitems`) | `WorkItem` identity, derived status, runway computation, dependency ordering, inbox urgency (= runway position) | Adapter, Approvals, Store | Persist derived facts (approval, deps) as authoritative columns |
| **Approvals & Trust** (`core/approvals`) | Canonical approval *statement*, `prepare`, `verify`, trust anchor, revocation, digest binding | `approvals.git`, `ssh-keygen`, Adapter (digests), Store (cache) | Ever read the private key; trust a DB flag; read config from an agent-writable path |
| **Build Orchestrator** (`build/`) | Worktree lifecycle, session loop, handoffs, gate runner, parking/retry, rebase-on-conflict, publisher (push, PR, preview), run report, run controller (start/stop/stop-time) | Governor, Agent Runtime, Adapter, Planning Model, Council Ledger (read snapshot only) | Await the council; merge without `verify()`; run host commands outside the sandbox profile |
| **Design Drafts** (`design/`) | Draft store (versions, variants), isolated draft origin, pin overlay, redraw/variant jobs, signed-off baseline, visual-gate command | Agent Runtime (design agent), Approvals (digest), Build (gate row) | Serve drafts from the UI origin; let draft JS reach the daemon API |
| **Council Engine** (`council/`) | Seat registry, router, threads, meetings (state machine), cards + rounds, decision ledger, persona QA, outputs (cards/backlog/review notes) | Governor, Agent Runtime, Adapter (write-back), Store | Write to build worktrees; hold a lease the builder needs; fail a work item |
| **Governor** (`core/governor`) | Global "limited until T", priority queue, concurrency caps, named leases (incl. the host-wide test lock), caffeinate | Agent Runtime, Build, Council, Design | Know what a "card" or "gate" is |
| **Agent Runtime** (`agent/`) | `spawn claude`, per-session `--settings` (sandbox, hooks, permissions), env allow-list, stream-json parsing, usage/budget tracking, rate-limit extraction | Governor, Store (session events) | Make product decisions; read secrets |
| **Store** (`core/store`) | SQLite schema/migrations, `append(event)`+projectors in one tx, blob refs, JSONL export | — | Be reachable by agents |
| **Server** (`server/`) | HTTP, SSE (`Last-Event-ID` = event `seq`), static UI, owner cookie auth, Host/Origin guard, Unix-socket API for CLI | Command bus | Contain business logic |
| **CLI** (`cli/`) | `serve`, `sign`, `init`, `doctor`, `harden`, `with-lock` | Unix socket; `ssh-keygen` (sign only) | Write the DB directly |
| **UI** (`ui/`) | SPA: Needs You, runway, gate rows, drafts, cards, meetings, metrics | Server (REST+SSE) | Hold secrets beyond the session cookie |

### Recommended Project Structure

```
counterpoint/                         # ONE npm package: @alex-profir/counterpoint
├── package.json                      # bin: counterpoint · exports: ".", "./adapter", "./test-lock"
├── src/
│   ├── core/                         # no imports from sibling top-level dirs
│   │   ├── domain/                   # WorkItem, Runway, Card, Decision, Approval, Finding types
│   │   ├── events/                   # event type registry (zod), append(), projectors
│   │   ├── store/                    # node:sqlite schema + migrations + repos
│   │   ├── approvals/                # statement canonicalization, verify, trust anchor
│   │   ├── governor/                 # priority, limits, leases, test-lock (kernel-released)
│   │   ├── runway/                   # isApproved(), runway(), readiness()
│   │   └── security/                 # token, origin guard, env allow-list, sandbox profile builder
│   ├── adapters/
│   │   ├── api.ts                    # FrameworkAdapter interface (public via ./adapter)
│   │   └── gsd/                      # parser (frontmatter+markdown), patch writer, buildInvocation
│   ├── agent/                        # claude spawn, stream-json, settings builder, hooks/ (budget hook)
│   ├── build/                        # worktrees, session loop, gates, parking, rebase, publish, preview
│   ├── design/                       # drafts, draft origin server, pin overlay, visual gate
│   ├── council/                      # seats, router, threads, meetings, cards, ledger, personas
│   ├── server/                       # http, sse, auth, routes (thin) + unix socket
│   ├── cli/
│   └── compose.ts                    # the ONLY place that wires adapters/* into core
├── ui/                               # SPA source; built into dist/ui (no framework server at runtime)
└── test/fixtures/gsd/                # frozen copies of real Cena .planning/ trees for adapter tests
```

### Structure Rationale

- **Single package, hard internal boundaries.** v1 has one adapter and one author. `npx` needs one install, versions never drift, and the "core never knows the framework" rule is enforced by an import-boundary lint rule, which is stronger than a package boundary nobody checks. `exports` subpaths make a later split mechanical.
- **`compose.ts` is the only importer of `adapters/gsd`.** Everything else sees `FrameworkAdapter`. This is the machine-checkable form of PROJECT.md's "framework coupling" constraint.
- **UI is prebuilt static assets.** `npx counterpoint` cold start must be seconds; no Next.js dev server at runtime (the Cena prototype's `app/__mission` lived inside the host's Next app, which is exactly what PROJECT.md rules out, and it needed a `proxy.ts` matcher exclusion to even load).
- **`test/fixtures/gsd/`** freezes real Cena `.planning/` trees (phase `01-multi-tenant-foundation` with 17 plans + gap-closure rounds, decimal phase `01.1`). The adapter is the riskiest integration (format drift); fixtures are its contract tests.

---

## 1. The Framework Adapter Boundary

Observed GSD facts (read from `/Volumes/Dock/Projects/HKP/Cena/.planning`, HIGH): phases live in `phases/<NN[.N]>-<slug>/`; each `NN-MM-PLAN.md` has YAML frontmatter (`wave`, `depends_on`, `autonomous`, `requirements`, `files_modified`, `user_setup`, `must_haves`); `NN-MM-SUMMARY.md` appears when a plan finishes; `NN-CONTEXT.md` holds `<decisions>` as `D-NN` entries with reversibility notes; `ROADMAP.md` carries per-phase wave/checkbox rows; `STATE.md` has frontmatter; Cena's backlog is `.planning/BACKLOG.md` (`## Open` + `###` entries with Raised/Status/Severity bullets) while the GSD `add-backlog` workflow uses `999.x` phases in ROADMAP.md. The adapter must be configurable for either.

```typescript
// src/adapters/api.ts  (exported at "@alex-profir/counterpoint/adapter")
export interface FrameworkAdapter {
  readonly id: string;                                   // "gsd"
  detect(host: HostRef): Promise<boolean>;

  /** Pure read at a git ref. Digests let approvals bind to exact content. */
  snapshot(host: HostRef, ref: GitRef): Promise<PlanSnapshot>;
  // PlanSnapshot = { workItems: WorkItemDef[] }
  // WorkItemDef  = { id, title, order, dependsOn[], specRefs: {path, blobSha}[],
  //                  steps: Step[], prerequisites: Prereq[], needsOwner: Step[] /* autonomous:false */ }

  /** How a fresh builder session is told to work on this item. Framework-specific. */
  buildInvocation(item: WorkItemDef, ctx: SessionCtx): { prompt: string; allowedSkills?: string[] };
  /** Done-ness from files, never from the agent's claim (GSD: PLAN has matching SUMMARY). */
  progress(worktree: string, item: WorkItemDef): StepProgress;

  /** Writes are PATCHES. Core applies and commits them (see Landing). */
  recordDecision(item: WorkItemDef, d: Decision): FilePatch[];     // GSD: append D-NN to NN-CONTEXT.md
  fileBacklogItem(b: BacklogItem): FilePatch[];                     // tagged "council", with evidence
  readBacklog(host: HostRef, ref: GitRef): Promise<BacklogItem[]>;
  readDecisions(item: WorkItemDef, ref: GitRef): Promise<Decision[]>;
}
```

**Design rules**

1. **Adapters are pure functions over a git ref plus patch producers.** They never run git, never hold state. That makes them trivially testable against frozen fixtures and keeps "Counterpoint reads, never owns the plan" mechanical.
2. **Parse natively; do not shell out to `gsd-tools`.** The `gsd-tools` verbs exist (`roadmap`, `phase-plan-index`, `state-snapshot`) but its install location varies per runtime and the verbs are not a published contract. Native frontmatter + heading parsing with fixture tests is a smaller dependency than a moving CLI. (MEDIUM: verbs observed locally, stability not verified.)
3. **"Approved" is not "buildable".** Cena's plan 01-01 has `autonomous: false` and `user_setup` (docker, `supabase start`, Google OAuth client). The adapter must surface `prerequisites` and `needsOwner` steps so runway readiness is `approved ∧ deps met ∧ prerequisites satisfied`, and a plan with human checkpoints becomes a Needs-You item rather than a doomed session.
4. **Work item = one GSD phase** (PROJECT.md decision); plans/waves are `steps` (internal progress only). Flag: Cena phase 01 had 17 plans (31 across two phases). One PR per phase can be very large and exceed `speckit-auto`'s 12-session cap; keep `steps` first-class so checkpoint commits or stacked PRs can be added later without a model change.

---

## 2. State: Event Log vs DB vs Git (the answer)

**Three stores, each authoritative for one kind of fact:**

| Fact | Authoritative store | Why |
|------|--------------------|-----|
| Plan, specs, decisions, backlog | **Host git** (via adapter) | "Read the plan, don't own it." |
| Approvals (runway, merge) | **`approvals.git`** signed commits | Must survive total loss of the DB; must be unforgeable by agents |
| Signed-off drafts, config digest | Host git (`.counterpoint/drafts/…`, `counterpoint.config.yaml`) | Visual gate and builder need them in the worktree; digests are bound into approvals |
| Runs, sessions, gate results, parking, cards, threads, meetings, pins, findings, inbox, metrics | **SQLite: `events` (append-only) + projections** | Needs queries, transactions, ordering, live subscription |
| Stream-json logs, transcripts, screenshots, diffs | Files under `$COUNTERPOINT_HOME/logs|blobs` | Too large for rows; events carry `{path, sha256}` |

**Why SQLite + event table (and not the alternatives)**

- *YAML/JSON files (the Cena prototype's `factory/*.yaml`)*: no atomic multi-row updates, no queries for the inbox/metrics, torn writes on crash, and files inside the repo are reachable by agents. PROJECT.md already rules the contract out.
- *Pure event sourcing with async reducers*: complexity without payoff on a one-user tool. Instead **append the event and update projections in one SQLite transaction** ("event-sourced-lite"). Projections are rebuildable from `events` (a `counterpoint doctor --rebuild`), which is the only property of ES this project needs; it also makes gamification (rounds-to-converge, first-attempt gate pass rate, merged-without-intervention) a SQL view over history rather than counters that must be incremented in the right places.
- *Postgres/server DB*: violates zero-install `npx`.
- *`node:sqlite`*: built in, zero native build. Stability is "1.2 release candidate" since v25.7.0, no flag since 22.13/23.4, and Node 26 is listed LTS (MEDIUM, nodejs.org API docs). The prior-art `test-lock.ts` already uses it (HIGH). Set `engines.node >= 24` and expect an experimental warning on 24. `better-sqlite3` is the fallback if the module regresses (native build cost accepted only then).
- **Do not store token deltas as events.** Persist only semantic events (`session.started`, `gate.finished`, `card.answered`…) and point at the raw stream file.

```sql
-- the only shape that matters; projections are ordinary tables
CREATE TABLE events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,   -- also the SSE Last-Event-ID
  ts         TEXT NOT NULL,
  type       TEXT NOT NULL,                       -- 'gate.finished', 'card.assumed', …
  subject    TEXT NOT NULL,                       -- 'workitem:phase-02', 'card:c41'
  actor      TEXT NOT NULL,                       -- 'owner' | 'builder' | 'seat:cook' | 'system'
  payload    TEXT NOT NULL,                       -- JSON, zod-validated per type
  cause_seq  INTEGER                              -- causation chain (card → decision → landing)
);
```

`actor = 'owner'` may only be minted by the authenticated owner channel (cookie/Unix socket). An agent-supplied payload can never set it.

**Crash-only design.** Sessions are fresh by design and state lives in git + handoff + DB, so the daemon can be killed at any point: on start it reconciles (`sessions` still `running` → `interrupted`, orphaned pids killed, worktree reset to last commit, next session starts from the handoff). Write each `claude` stream to a log file as it arrives (tee), so a restart can tail what exists instead of losing it. This turns the usual hard problem (resumable long runs) into the normal path.

---

## 3. Where "Approved" Lives (given approvals are signed commits)

**Rule: approval is evidence in git, and `approved?` is a function, never a stored flag.**

```
approved(item) =  ∃ commit A in approvals.git such that
                    gitSignature(A) valid against trust/allowed_signers      (owner pubkey, outside any repo)
                  ∧ A.statement.kind == "runway"
                  ∧ A.statement.item == item.id
                  ∧ A.statement.digests == currentDigests(item)             (spec blobs + signed-off draft + config)
                  ∧ ¬revoked(A) ∧ ¬expired(A)
```

**Statement** (canonical JSON in the commit tree, so the signature covers it):

```json
{ "v":1, "kind":"runway|merge", "host":"cena", "item":"phase-02",
  "baseSha":"…", "specDigest":"sha256:…", "draftDigest":"sha256:…", "configDigest":"sha256:…",
  "prHeadSha":"…(merge only)", "assumptionsDigest":"sha256:…(merge only)",
  "createdAt":"…", "nonce":"…" }
```

**Consequences (all desirable, all derived):**

- Owner edits the spec/CONTEXT or a pin changes the draft after approving → `specDigest` no longer matches → the item *falls out of the runway* and appears in Needs You as "approved version changed". No bookkeeping code; recomputation does it.
- Merge approval binds `prHeadSha`; the daemon merges with `--match-head-commit <sha>`, so a force-push after approval cannot be merged on a stale approval.
- Merge approval also binds the **assumptions manifest** (cards the builder proceeded on, section 6), so the owner signs exactly what they saw.
- Config (gates, locked paths, seats) is read from the *approved base commit*, not from the worktree, and its digest is in the statement. An agent that edits `counterpoint.config.yaml` in its branch changes nothing the runner uses, and the diff check flags it.

**Where the commit goes: a Counterpoint-owned `approvals.git`, not the host repo.** Rationale:

1. The host repo's `.git/config` and `.git/hooks` are shared with every worktree. A builder that can write them could set `core.sshCommand`/`gpg.ssh.program`/a hook that runs *when the owner later signs in their checkout*, capturing the passphrase prompt or running code outside the sandbox. A private repo has no agent-writable config.
2. It avoids Counterpoint committing to `master` in the checkout the owner is working in.
3. Signing runs `/usr/bin/ssh-keygen -Y sign` / `git commit -S` with `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null`, `-c gpg.format=ssh -c gpg.ssh.program=/usr/bin/ssh-keygen -c core.hooksPath=/dev/null`, scrubbed `SSH_ASKPASS*`/`GIT_*` env, in a repo nobody else writes.

PROJECT.md's wording ("signed git commit") is satisfied; if the owner prefers visibility in the host history, mirror to `refs/counterpoint/approvals/*` in the host repo as a *read-only copy* (never consulted for verification). The Cena prototype's approach (`git log -1 --format='%G? %GF' -- <file>` against an `owner_key` written in the repo's `factory.yaml`) is the pattern *not* to carry over: the trust anchor lived in an agent-writable file, and verification relied on repo-level git signature config (read from `lib/factory/signature.ts`, HIGH).

**Signing UX flow (WYSIWYS: what you see is what you sign):**

```
UI "Approve"  → daemon builds statement draft, stores pending/<id>.json, shows:
                    npx counterpoint sign 7f3a
terminal      → CLI asks daemon (Unix socket) for pending/<id>
              → CLI RECOMPUTES digests itself from git at baseSha (does not trust the daemon's numbers)
              → prints human summary (item, files changed since last approval, assumptions list)
              → ssh-keygen prompts passphrase on /dev/tty (never cached, never in ssh-agent)
              → signed commit written to approvals.git → CLI tells daemon "verify <commit>"
daemon        → verify (trust anchor) → append approval.verified → item enters runway / merge proceeds
```

Touch ID later (1Password SSH agent) is a drop-in at the `ssh-keygen` step; the statement and verifier do not change.

---

## 4. The Build Orchestrator

### Session loop (per work item)

```
runway order, deps met, approved(item) re-verified NOW
  └─ lease worktree  <repo>-worktrees/<item>  on branch cp/<item>   (daemon runs git with hardened -c flags)
       └─ loop (≤ maxSessions):
            ├─ snapshot = ledger.snapshot(item)  → write wt/.counterpoint/context.json (untracked via info/exclude)
            ├─ governor.acquire(class=builder)              ── waits if "limited until T"
            ├─ agent.run(cwd=wt, prompt=adapter.buildInvocation(item, handoff, snapshot), budgetPct)
            │     outcome ∈ handoff | claimed-done | usage-limit(resetsAt) | api-retry-exhausted | crash | no-progress
            ├─ usage-limit → governor.pauseUntil(resetsAt + 120s)   (structured, not regex-scraped)
            └─ progress = adapter.progress(wt, item)  — file truth, not the agent's "done"
       └─ gates (sandboxed, in order, exit code only) → events gate.started/finished{exit, tailRef}
            fail → feed last N lines to a fix session; attempts++ ; attempts > N → PARK → Needs You
       └─ rebase onto base tip; conflict → resolver session → re-gate; still red → PARK
       └─ publish: daemon pushes (its own credential), opens PR, attaches preview link,
                   assumptions manifest in PR body → inbox: "PR awaiting signed approval"
       └─ persona QA (async, advisory) ; run report
```

### Context budget (follows the model, adjustable per run, token figure shown)

- Prior art (HIGH): a `PostToolUse` command hook parses `transcript_path`, computes `input + cache_creation + cache_read` of the last main-chain assistant message, compares to `CONTEXT_WINDOW_TOKENS` (default 1,000,000, hard-coded) and returns `{decision:"block", reason:"…write handoff, commit, stop"}` once per session via a marker file.
- Counterpoint improvement: **the daemon owns the arithmetic.** It sees every `assistant` stream event with `usage`, learns each model's window from `result.modelUsage[model].contextWindow` (cached per model in the DB; a one-time cheap probe call for an unseen model), computes `budgetTokens = pct × window`, and when crossed touches a per-session marker. The shipped hook becomes ~10 lines: if marker exists and not yet fired, emit the same `decision:block`. No transcript parsing in the hook, no hard-coded window, the UI shows "40% of 1M = 400k". (MEDIUM; the stream-json `usage`-per-assistant-message and `modelUsage.contextWindow` fields are documented in the SDK reference; the in-session accuracy vs the status-line formula needs a spike. SDK `getContextUsage()` also exists but we do not use the SDK, see below.)
- Hooks passed through `--settings` **do not run under `--bare`**, and `--bare` never reads OAuth/keychain credentials (needs `ANTHROPIC_API_KEY`). Builder sessions therefore run non-bare; restrict inherited config with `--setting-sources` instead. Same for council seats on a subscription login.
- Only sessions a later session can continue get cut short (prior art `CONTEXT_BUDGET_COMMANDS`); one-shot steps never do.

### Why spawn the CLI, not the Agent SDK

Both expose the same events. The SDK reference states Anthropic does not allow third-party developers to offer claude.ai login or rate limits in products built on the SDK (LOW-MEDIUM: policy text on the SDK overview page). Counterpoint will be published open source; a thin orchestrator over the user's *own* installed `claude` binary (the project's stated model: `claude -p`) avoids that question entirely and keeps parity with what the owner runs by hand. The structured fields we need all appear in `--output-format stream-json`: `system/init`, `system/api_retry{attempt,retry_delay_ms,error}`, `rate_limit_event{status,resetsAt,utilization}`, `result{modelUsage,total_cost_usd,structured_output,permission_denials}`. Prior art scraped the TUI text with regexes (`retry_wait` in `run.sh`); this replaces regexes with fields. Keep the regex fallback behind the same interface because the event surface is versioned by Claude Code releases (feature-detect via `system/init.capabilities`).

### Other pieces carried over from prior art (HIGH, read first-hand)

| Prior-art mechanism | Counterpoint equivalent | Change |
|---|---|---|
| `retry_wait`: reset time + 2 min, 30-min recheck if unnamed, backoff 60s→900s | `Governor.pauseUntil` driven by `rate_limit_event.resetsAt` / `api_retry` | structured fields; regex only as fallback |
| `with_resume` capped at 30 | `maxResumes` per work item | per-item, visible in UI |
| `worktree.sh` locking via `git worktree lock --reason "pid=… port=…"`, free port from 4174 | DB `leases` rows + `git worktree lock` as belt-and-braces; port allocator | liveness by pid check at startup reconcile |
| `clean`: remove worktree/branch only if the last PR is **merged** (squash-merge aware via `gh pr list`), tip is ancestor of merged head, nothing uncommitted | same rule in `build/cleanup.ts` | publisher records merged head SHA |
| `test-lock.ts`: SQLite `BEGIN EXCLUSIVE` on a file; kernel releases on death; holder file; waiters time out at 180 min; env marker for re-entrancy | Governor lease `test`, same mechanism, file at `$COUNTERPOINT_HOME/locks/test.lock` | lock dir is the *one* path sandboxed sessions may read/write (host vitest setup takes it); expose `@alex-profir/counterpoint/test-lock` + `counterpoint with-lock -- <cmd>` |
| `gates.sh`: exit-code judgement of owner prerequisites | gate row in config; first failure stops the attempt | adds `needs: [leases]`, `timeout`, `required` |
| `env.sh`: pin model/effort for sessions *and subagents* (`ANTHROPIC_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL(_FORCE)`), `--permission-mode auto --permission-prompts none` | per-role model table in config (builder, design agent, seat, router, minutes) | permission mode is convenience, **not** the security boundary |
| `run.sh` cap of 12 implement sessions; stop when two sessions in a row tick no task | `maxSessions`, `no-progress` outcome from `adapter.progress` | |
| Cena prototype `run.yaml`: `stop_by`, `max_attempts`, `max_sessions_per_slice`, `lanes: 1` | Run settings (UI form, per-run override) | stored in DB, not a repo YAML |
| Cena prototype `locked:` / `append_only:` path lists fail a slice that touches them | `lockedPaths`/`appendOnly` in the *approved* config, checked on every diff | this is the tamper check for config/spec/design |
| Cena prototype guard: loopback `Host` allowlist + same-origin `Origin` on non-GET, production → 404, noted weakness "Host check ≠ socket bind" | bind `127.0.0.1` only, same Host/Origin checks, plus cookie; privileged CLI path on Unix socket | the prototype's own WR-01 comment is the lesson |

### Publisher and preview

- `GitHost` interface (GitHub first via `gh`/REST): `push`, `openPR`, `setStatus`, `mergeIfHeadMatches`, `deployments(pr)`. The **daemon** pushes and opens PRs with *its own* credential; builder sessions never push.
- `PreviewProvider`: `hostDeploy` (read the PR's deployment/check URL, e.g. Vercel) else `local` (start the host's preview command in the worktree on an allocated port, shown as a link). Local preview URL is only valid on the owner's machine, which is fine for the stated use.
- Enforce "merge only after verified signed approval" on the **host side** as well: protect the base branch with a required status check `counterpoint/approval` that only the daemon's credential can set after `verify()`. Counterpoint cannot be stronger than the host's branch protection, so `counterpoint init` should print the recommended rule. (MEDIUM; design, GitHub rule specifics not researched here.)

---

## 5. Security Boundary (agents run as the same OS user)

**Reframe.** Same-UID isolation cannot hide files from a process that is not confined. The achievable guarantee is: *an agent we spawn can neither obtain nor use anything that confers authority, and anything it can reach is non-authoritative.* Four assets, four mechanisms:

| Asset | Threat | Mechanism |
|-------|--------|-----------|
| **Signing private key** | Agent reads it, or tricks the owner into signing something else | Dedicated ed25519 key with passphrase, **never in ssh-agent**; useless without a human at a TTY. Also in sandbox `denyRead` and `Read(...)` deny. Sign CLI recomputes digests and prints the diff (WYSIWYS). Poisonable env/config neutralized (section 3). |
| **Trust anchor** (owner public key / allowed signers) | Agent writes its own key there, or edits an in-repo `owner_key` | Lives in `$COUNTERPOINT_HOME/trust/`, outside every repo; sandbox `denyWrite`; created by `counterpoint init` run by the owner. |
| **Start/stop + other privileged calls** | Agent calls the daemon's HTTP API (it can reach loopback: persona/preview sessions need `network.allowLocalBinding` on macOS, which opens *all* localhost ports) | Privileged routes need the owner cookie (one-time login URL printed to the owner's terminal, exchanged for `HttpOnly; SameSite=Strict`) **or** the Unix socket in `$COUNTERPOINT_HOME/run/` (sandbox does not get `allowUnixSockets`, and the dir is `denyRead`). Token never in env or argv of any child. Sessions get *scoped capabilities* only (post a proposal as seat X) if an MCP channel is ever added; otherwise they get none. |
| **Merge/push authority** | Agent runs `gh pr merge` with the owner's login | Daemon owns a dedicated credential kept in `$COUNTERPOINT_HOME`; sandbox `denyRead` on `~/.config/gh`, `~/.ssh`, keychain-backed credential helpers where possible; branch protection with required `counterpoint/approval` status (above). |
| **State DB / event log** | Agent forges `approval.verified`, edits runway | Not reachable (`denyRead`+`denyWrite`), **and** non-authoritative: approvals are re-verified from git at use time; `actor:'owner'` only from authenticated channels. |

### Concrete agent launch profile (Tier 1, v1 default)

Built per session by `core/security/sandbox-profile.ts` and passed with `--settings` (inline JSON is documented):

```jsonc
{
  "sandbox": {
    "enabled": true, "failIfUnavailable": true, "allowUnsandboxedCommands": false,
    "filesystem": {
      "denyRead":  ["~/Library/…/counterpoint/{db,approvals.git,trust,run,logs}", "~/.ssh", "~/.config/gh", "<keysDir>"],
      "denyWrite": ["<hostRepo>/.git/config", "<hostRepo>/.git/hooks", "$COUNTERPOINT_HOME", "<hostRepo>/counterpoint.config.yaml"],
      "allowWrite": ["<worktree>", "<hostRepo>/.git/objects", "<hostRepo>/.git/refs/heads/cp", "<hostRepo>/.git/worktrees/<item>", "$COUNTERPOINT_HOME/locks"]
    },
    "network": { "allowLocalBinding": true /* only for preview/persona/gate sessions */ }
  },
  "permissions": { "deny": ["Read(//…/counterpoint/**)", "Edit(//…/counterpoint/**)", "Read(~/.ssh/**)", "Read(~/.config/gh/**)"] }
}
```

Notes that affect the design (official docs, fetched this session, MEDIUM):

- Sandbox `denyRead/denyWrite` constrain **Bash and its children**. The built-in **Read/Edit tools follow permission rules**, so every path needs a `permissions.deny` twin.
- Sandbox "protected paths" cover `.git/hooks` and `.git/config` **only in the working directory**. A `git worktree` shares the *main* repo's `.git`, which is outside the cwd, so Counterpoint must `denyWrite` those two explicitly (above). Alternative with stronger isolation and slightly more disk/fetch cost: build in a dedicated **clone** per item so the agent's `.git` is its own and disposable. Decide in the build-orchestrator phase; default recommendation: worktrees + explicit denies, clone as the fallback if the spike shows gaps.
- The doc does not state whether the sandbox applies to `claude -p`; it does accept `--settings` inline sandbox config. **Spike required** (see Open Decisions): run a `-p` session with a `touch ~/probe` and a `cat ~/.ssh/…` and confirm denial.
- `--permission-mode auto` (a classifier) is what prior art used for unattended runs. It is a safety net, not an enforcement boundary; the sandbox is.
- **The daemon runs untrusted-influenced code itself**: gate commands (`pnpm test` runs scripts the agent can edit in `package.json`), and `git` in agent-writable trees (hooks, `core.fsmonitor`, `diff.external`). Run gates and any git command inside the same sandbox profile (`@anthropic-ai/sandbox-runtime` / `srt` is the standalone form of Claude Code's sandbox; research-preview, MEDIUM-LOW), and always pass `-c core.hooksPath=/dev/null -c core.fsmonitor=false` plus env scrub. Skipping this reopens the hole the sandbox closes.
- Env: spawn children with an **allow-list** (`PATH`, `HOME`, `LANG`, `TMPDIR`, model/effort pins). Never `COUNTERPOINT_*`, tokens, or `SSH_AUTH_SOCK`. Same-UID processes can read each other's env via `ps eww` on macOS, so secrets must not be in env or argv *of the daemon either*.
- Drafts are agent-authored HTML/JS and must be treated as hostile: separate origin (different port), `<iframe sandbox="allow-scripts">` without `allow-same-origin`, CSP `connect-src 'none'`, pin overlay injected by the draft server and talking to the parent only via `postMessage`.

### Tiers

| Tier | What | When |
|------|------|------|
| **1 (v1)** | Everything above | Default; protects against prompt injection, runaway agents, accidents |
| **2** | `counterpoint harden`: root-owned `managed-settings.json` at `/Library/Application Support/ClaudeCode/` enforcing sandbox + credential denies so session/user-level settings cannot loosen them (documented lock semantics) | After the owner trusts the system; one-time `sudo` |
| **3** | Run agent sessions as a separate macOS user | Only if real untrusted code/projects are ever built |

**Residual risk (state it in the README):** an agent that escapes the sandbox, any non-sandboxed process the owner runs, and a compromised owner terminal can still reach same-UID secrets. The design ensures the key is still passphrase-gated, approvals are digest-bound and re-verified, and merge needs a credential the agent cannot read; it does not claim OS-level separation.

---

## 6. Council ↔ Builder Without Blocking

**Contract (the whole mechanism in four rules):**

1. **The builder reads a snapshot; it never waits.** At every session start the orchestrator calls `ledger.snapshot(item)` and writes `.counterpoint/context.json` into the worktree (untracked). It lists, per decision key relevant to this item: `answered` (owner pick), `assumed` (council-recommended, unanswered), `deferred`. Sessions end at handoffs, so the builder re-syncs at natural boundaries, not mid-thought.
2. **The council never writes into a worktree or takes a builder lease.** Its outputs are DB rows (cards, findings, notes) and *patches routed through Landing* to the host's planning files.
3. **Unanswered = assumed.** Each card carries `recommended` and `neededBy: WorkRef[]` (work item + optional step). When the builder starts an item/step that a card is `neededBy` and the card is still `open`, the ledger flips it to `assumed(recommended)` and emits `card.assumed`. This is also the urgency signal: inbox cards sort by "needed in N runway items".
4. **Overturn is rework, not a blockade.** If the owner later answers differently: `card.overturned` → (PR open) a rework note is queued into that item's next session and the PR is labelled; (already merged) a backlog item/new work item is filed. The merge approval statement includes `assumptionsDigest`, so a PR depending on an overturned assumption cannot be approved for merge until reworked, and the *owner* sees one clear reason in Needs You.

```
Council turn ─▶ card.raised(recommended=B, neededBy=[phase-04]) ─▶ Needs-You
                                                                    │ owner Pick/More-like/Reframe/Later
Builder starts phase-04 ── ledger.snapshot ──▶ open? → assumed(B)   │ (may arrive any time)
   │                                                 answered → use answer
   └─ PR body lists "assumed: D-31 (B)" ──▶ merge approval binds assumptionsDigest
Late answer ≠ B ─▶ card.overturned ─▶ rework note (PR open) / backlog item (merged)
```

**Cards as data:** `card(id, subject, options[{id,title,tradeoffs}], recommended, raised_by[], status, parent_card_id, anchor_option, steering_note, needed_by[])`. "More like B →" creates a child round (`parent_card_id`, `anchor_option=B`, optional steering note); the breadcrumb is the parent chain; "back up" re-activates an ancestor as a new branch (nothing is deleted). "Pick" emits `decision.recorded` → Landing → `adapter.recordDecision` patch → commit.

**Landing (the one service that writes planning files).** Decisions, council-filed backlog items and signed-off drafts all end up as commits in the host repo. Writing them in the owner's live checkout would break "builds never touch the owner's checkout" in spirit and collide with their uncommitted work. Recommendation: a Counterpoint-owned **planning worktree** on a `cp/planning` branch receives patches; `Landing` fast-forwards the base branch only when that is safe (owner checkout clean or on another branch), otherwise raises one "land planning changes" Needs-You item. Builders branch from base after landing, which is why the snapshot overlay file (not CONTEXT.md edits) carries decisions *into* a running build. (MEDIUM; needs a spike on Cena's workflow, listed in Open Decisions.)

### Council Engine internals

- **A turn is a fresh, short, stateless `claude -p` call** with `--json-schema` structured output and a read-only tool set (`--tools` restriction, `--strict-mcp-config`, `--setting-sources` limited; not `--bare` on a subscription). Threads and meetings are **orchestrated message logs in the DB**, not long-lived sessions. This is what makes live watch, owner interjection, cost caps, retries and usage-limit waits trivial: an interjection is just an `owner.note` event appended before the next turn's context is assembled.
- **Claude Code "agent teams" are not the base.** They are experimental, disabled by default, interactive-only (no `-p`), tied to one session's lifetime, and not resumable. Use own orchestration; revisit if they stabilize.
- **Router:** deterministic first (activity kind → default seat set from config, tag/path matching on the subject), optional cheap LLM routing call returning seat ids; the owner's "all seats" override bypasses it.
- **Meeting state machine:** `agenda → chair opens → rounds of turns (chair selects next speaker; caps: turns, tokens, wall-clock) → chair closes → minutes writer → output extraction (schema-validated cards / backlog items / review notes) → publish`. Raw transcript always kept; minutes are a derived blob.
- **Seat kinds:** `reviewer` (artifacts: diff, screenshots, flows; read-only) and `driver` (persona; drives the running preview in a browser, needs `allowLocalBinding` and the `browser`/`db` leases). Findings are `finding.raised` → advisory card; **no code path lets a finding mutate gate state** (enforce by type: gate events are only emitted by the gate runner).
- **Backlog filing:** `adapter.fileBacklogItem` patch tagged `council` with evidence refs (thread/transcript link, file:line). Dedupe by content fingerprint, per-meeting cap, one summary Needs-You item. This is the noise-control that keeps "council files straight into the backlog" from burying the owner.
- **Cost guard:** every meeting/thread has a budget; Governor class `council` is lowest and is paused first. The shared Claude plan quota is the real constraint, so builder runs must never starve because seats were chatty.

---

## Architectural Patterns

### Pattern 1: Derive, don't store (approval, readiness, runway)
**What:** `isApproved`, `ready`, `runway` are functions of git + digests + events. Projections cache them with the inputs' hashes.
**When:** any fact whose truth can change by someone editing a file elsewhere.
**Trade-offs:** slightly more recompute (cheap at tens of items); eliminates a whole class of stale-flag bugs and agent-forgery.

### Pattern 2: Propose by file, dispose by daemon
**What:** Agents emit handoff files and schema-validated JSON (`--json-schema`, or files under `wt/.counterpoint/out/`); the daemon validates and ingests. No agent→daemon network channel in v1.
**When:** every agent output (cards, findings, handoffs, draft revisions).
**Trade-offs:** one more ingest step; removes the largest attack/complexity surface.

### Pattern 3: Command → events + projection in one transaction
```typescript
// core/store/command.ts
export function execute(db: Database, cmd: Command): Event[] {
  return db.transaction(() => {
    const events = decide(cmd, readModel(db));       // pure
    for (const e of events) { const seq = append(db, e); project(db, e, seq); }
    return events;
  });
}
```
**When:** all state changes. **Trade-offs:** projectors must be deterministic and rebuildable (tested by replaying fixtures).

### Pattern 4: Governor-mediated spawning
**What:** nothing calls `spawn(claude)` except via `governor.run(class, fn)`; the governor holds `limitedUntil`, class priorities (`builder` > `owner-interactive` > `design` > `council-async` > `persona` > `meeting`), concurrency caps and named leases.
**Trade-offs:** one chokepoint; makes "council can't starve the builder" and "usage-limit wait is global" true by construction.

### Pattern 5: Fresh-session continuity (handoff as the unit of resumption)
**What:** state that matters is in git + `handoff.md` + ledger snapshot; sessions are disposable. Restart, usage-limit wait, context budget, and crash all take the same path.
**Trade-offs:** each session pays re-orientation tokens (prior art measured ~80k before the first task, so keep the budget well above that).

### Pattern 6: Approve-by-digest
**What:** approvals bind content hashes; any change invalidates. See section 3.

### Pattern 7: Hostile-content isolation for drafts
**What:** drafts served from a separate origin and sandboxed iframe, overlay via `postMessage`. Pins anchor to `data-cp-id` attributes the design agent is instructed to stamp (fallback: CSS path + text snippet + rect), so pins survive redraws.

---

## Data Flow

### Request / Command Flow

```
Browser ──REST──▶ server ──▶ command bus ──▶ decide() ──▶ events + projections (1 tx)
   ▲                                                         │
   └─────────────── SSE (id: seq) ◀── event notifier ◀───────┘
CLI ──Unix socket──▶ same command bus (privileged commands: prepare/verify approval, start/stop)
```

### State Management

```
git (host, approvals.git)   SQLite events ─▶ projections ─▶ SSE ─▶ UI store (read-only mirror)
        ▲                          ▲                                   │ commands
        └──── adapter/landing ─────┴─────────────── command bus ◀──────┘
```

### Key Data Flows

1. **Plan → runway:** adapter snapshot (base tip) → `WorkItemDef[]` → for each: digests → `approved()` → readiness (deps, prerequisites) → runway = ordered ready+approved items not yet built. Recomputed on `plan.changed` (fs watch/`git` ref change) and on `approval.verified`.
2. **Approve into runway:** UI prepares statement → owner runs `counterpoint sign` → signed commit → `verify` → `approval.verified` → runway grows (headline metric updates via SSE).
3. **Build:** orchestrator loop (section 4) emits `session.*`, `gate.*`, `pr.opened`; gate row in the UI is a projection of `gate.finished` events for the current attempt.
4. **Council card → decision → build:** `card.raised` → Needs-You → owner action → `decision.recorded` → Landing patch+commit → ledger snapshot picks it up at the next session.
5. **Meeting:** `meeting.opened` → N × (`turn.requested` → agent call → `turn.recorded`) → SSE to watching UI; `owner.note` interjects; `meeting.closed` → outputs → inbox.
6. **Draft:** design agent writes `drafts-wip/<screen>/vN/` → draft server renders → pins (`pin.added{dataCpId, selector, rect, text}`) → redraw/variant job → sign-off copies the chosen version into the host repo (`.counterpoint/drafts/`), digest enters the runway statement → visual gate renders the draft baseline and the built route at the same viewport/fixtures and exits non-zero on drift.
7. **Merge:** owner approves PR (statement binds `prHeadSha` + `assumptionsDigest`) → verify → daemon sets `counterpoint/approval` status → merges only if head matches → cleanup rule frees the worktree.
8. **Metrics:** SQL views over `events` (runway length over time, rounds-to-converge, first-attempt pass rate, merged-without-intervention).

---

## Suggested Build Order (dependency-driven)

| # | Phase theme | Delivers | Depends on | Why here |
|---|-------------|----------|------------|----------|
| 0 | **Foundations** | `COUNTERPOINT_HOME` layout (on `/Volumes/Dock/Dev/...`, honours the owner's install rule), config loader, event store + projector harness, daemon shell, loopback guard + cookie + Unix socket, UI shell + SSE, boundary lint | none | Everything else writes events and goes through the guard; cheapest time to get the boundaries right |
| 1 | **GSD adapter + planning model (read-only)** | `PlanSnapshot` from Cena fixtures, work items, deps, prerequisites, runway skeleton, read-only runway/items UI | 0 | Proves "reads, never owns"; gives every later phase real data; riskiest parser tested early |
| 2 | **Approvals & trust** | statement, `sign` CLI, `approvals.git`, `verify`, digest invalidation, "approved version changed" inbox item | 0, 1 | Small, security-critical, and defines the builder's input; build it before the builder so no "skip approval" dev path ever exists |
| 3 | **Agent runtime + Governor** | `claude` spawn, sandbox/permission profile, stream-json parse, rate-limit pause, budget hook, test-lock lease, **sandbox-in-`-p` spike** | 0 | The platform risks (sandbox, usage events, context window) surface here; everything agentic depends on it |
| 4 | **Build orchestrator** | worktrees, session loop, handoff, gate runner + gate row, parking, retries, stop time, run report | 1, 2, 3 | Core Value; first real Cena run |
| 5 | **Publisher + merge** | push, PR, preview link, rebase-on-conflict, merge approval + host status check, cleanup | 2, 4 | Completes the "walk away, come back to PRs" loop |
| 6 | **Design drafts + visual gate** | draft store/origin, pins, redraw, variants, sign-off baseline, visual gate | 2, 4 (gate row) | Part of the build lane but optional for the first unattended run; fidelity decision gates it |
| 7 | **Council: cards + ledger + write-back** | seats config, single-shot card generation, Needs-You cards (Pick/More like/Reframe/Later), Landing, assumed/overturn, builder snapshot | 1, 3, 4 | Signature interaction; first needs the Landing and ledger |
| 8 | **Council: threads, meetings, router, backlog filing** | async threads, structured meetings, live watch + interject, router, council-filed backlog | 7 | Heaviest agent spend; needs Governor classes proven |
| 9 | **Persona QA** | driver/reviewer seats on previews, advisory findings | 5, 8 | Needs preview + seats + browser/db leases |
| 10 | **Mission polish & gamification** | metric views, run-report UX, theme | all | Mostly SQL views by now |

Parallelizable: 3 alongside 1–2 (after 0); 6 alongside 7 once 4 lands. Hardening Tier 2 (`harden`) can ship any time after 3.

---

## Scaling Considerations (a one-owner local tool)

| Concern | v1 (1 host, owner only) | If it grows |
|---------|------------------------|-------------|
| Concurrent agent sessions | 1–2 builders + 1–2 council; Governor caps; one test lock across all | Raise caps; lanes (>1) already modelled by `lanes` in the prototype run config |
| Event volume | 10³–10⁵ semantic events/day; no token deltas | Archive old `events` to JSONL by month |
| SQLite | single writer daemon, WAL, readers via SSE | Fine for this workload; only a multi-user server would change it |
| Disk | worktrees + `node_modules` per feature are the real cost (prior art ran `npm ci` per worktree) | pnpm store sharing; clean-on-merge rule |
| Hosts | one daemon per host (`hostId` namespaces state) | multi-host daemon is a later composition change, not a model change |

**First bottleneck:** the shared Claude plan quota (builder and council both draw on it), not CPU. Governor priorities and per-meeting budgets exist for this reason. **Second:** the single test lock serializing gates across worktrees; accepted by the owner (parallel test runs can bring the machine down).

---

## Anti-Patterns

### Anti-Pattern 1: Approval as a database flag or a repo file the agent can write
**What people do:** `approved: true` in YAML/DB (Cena prototype: `Status: Approved` greps in `gates.sh`, `owner_key` in `factory.yaml`).
**Why it's wrong:** any agent that can write the file/row can approve its own work.
**Do this instead:** signed commit + trust anchor outside repos + recompute at use time.

### Anti-Pattern 2: Trusting "done" from the agent or "green" from the agent's own run
**What people do:** accept `claimed-done` or an agent-run test summary.
**Do this instead:** `adapter.progress()` from files and gate exit codes from the daemon's sandboxed runner; gate/config paths are `locked` in the diff check.

### Anti-Pattern 3: Council as a synchronous dependency
**What people do:** builder polls/waits on open questions, or a meeting "blocks" a phase.
**Do this instead:** ledger snapshot + `assumed(recommended)` + overturn-as-rework (section 6).

### Anti-Pattern 4: Long-lived council seat sessions
**What people do:** keep one chatty session per seat.
**Why it's wrong:** unbounded context, no clean interjection, no resumption, can't pause for usage limits.
**Do this instead:** stateless turns over a DB message log.

### Anti-Pattern 5: UI as routes inside the host app
**Why it's wrong:** couples to the host's stack and env (the prototype needed a middleware exclusion and could not run without Supabase env). **Instead:** standalone daemon on `127.0.0.1`.

### Anti-Pattern 6: Parsing human-oriented CLI text for control flow
**Do this instead:** stream-json fields (`rate_limit_event.resetsAt`, `api_retry.error`); keep a regex fallback behind the same interface and feature-detect.

### Anti-Pattern 7: The daemon running agent-influenced code unsandboxed
**What people do:** gate commands and `git` inside agent-writable trees run as the owner with full access.
**Do this instead:** same sandbox profile for gates/git, hardened `-c` flags, env allow-list.

### Anti-Pattern 8: Hard-coded context windows, model names, and ports
**Do this instead:** learn window from `modelUsage.contextWindow`; model table in config; port allocator.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Claude Code CLI | `spawn claude -p --output-format stream-json --verbose --settings <inline>` | Version-gate on `system/init.capabilities`; pin via `claude --version` check in `doctor`; subscription login means no `--bare` |
| GitHub | `gh` / REST behind `GitHost`; daemon-owned credential | PR list for cleanup, deployments for preview URL, required status check for merge; rate limits are not an issue at this volume |
| Vercel (host preview) | Read the PR's deployment/check URL via GitHost | Optional; local preview is the fallback |
| `ssh-keygen` / `git` | Absolute paths, scrubbed env, hardened `-c` flags | Only the sign/verify path touches the key |
| Playwright (visual gate, personas) | Executed as a gate command / driver tool inside the sandbox profile | Needs `allowLocalBinding` and the `browser` lease; detail belongs to the stack/fidelity research |
| Host DB services (Cena: local Supabase) | Named lease `db`; `prerequisites` in adapter | Cena's RLS suite shares one local stack, so gates and personas must not run concurrently with it |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| UI ↔ server | REST commands, SSE events (`Last-Event-ID`) | UI is a read-only mirror of projections |
| CLI ↔ daemon | Unix socket | Privileged; not reachable from sandboxed sessions |
| core ↔ adapters | `FrameworkAdapter` only; wired in `compose.ts` | Enforced by import-boundary lint |
| build ↔ council | Ledger snapshot (builder reads), events (both append); never direct calls | The non-blocking contract |
| build/council/design ↔ agent runtime | `governor.run(class, …)` | Single chokepoint for quota and leases |
| daemon ↔ sessions | Files in worktree + stream-json out; no network API in v1 | "Propose by file" |
| daemon ↔ host repo | Adapter patches → Landing → commits; builds only in worktrees | Owner checkout untouched by builds |

---

## Open Decisions and Research Flags (for roadmap)

| # | Question | Recommendation / what to spike | Phase |
|---|----------|-------------------------------|-------|
| 1 | Does Claude Code's sandbox apply under `claude -p`, and do `denyRead`/`permissions.deny` hold for both Bash and Read/Edit? | 30-minute probe before building on it; if not, fall back to `srt` wrapping the whole `claude` process | 3 |
| 2 | Worktree vs dedicated clone for builds (shared `.git/config`/`hooks` exposure) | Default worktree + explicit `denyWrite`; switch to clone if the probe shows gaps | 4 |
| 3 | Context-window accuracy: stream `usage` sum vs the status-line formula; where `modelUsage.contextWindow` first appears (only at `result`?) | Spike with a real Opus session; probe-call fallback per model | 3 |
| 4 | `rate_limit_event` shape on a subscription (Max) login vs API key; is `resetsAt` always present when `rejected`? | Capture real events during a forced limit; keep regex fallback | 3 |
| 5 | Landing strategy for planning-file commits while the owner works on the base branch | Prototype planning-worktree + safe fast-forward on Cena | 7 |
| 6 | GSD write formats: appending `D-NN` to `NN-CONTEXT.md` (with reversibility notes), `BACKLOG.md` vs `999.x` | Adapter golden-file tests; make backlog target configurable | 1/7 |
| 7 | One PR per phase when a phase has 17 plans | Keep `steps` first-class; add checkpoint commits/stacked PRs later without model change | 4/5 |
| 8 | Visual gate mechanics (draft baseline vs built screen; pixel vs structural; hi-fi vs low-fi) | Belongs to the draft-fidelity research; architecture only requires "a gate command with an exit code and a baseline artifact" | 6 |
| 9 | Host adoption of the test lock (vitest `globalSetup`) | Ship `./test-lock` export + `with-lock` wrapper; `counterpoint init` prints the snippet | 3 |
| 10 | Auto-meeting triggers | Out of architecture scope; the engine takes an `Activity` from any trigger and never sits in front of work | 8 |
| 11 | Branch-protection recipe for the required `counterpoint/approval` check | Verify GitHub settings against Cena's repo before phase 5 | 5 |

---

## Sources

**First-hand (HIGH):**
- `/Volumes/Dock/Projects/HKP/Counterpoint/.planning/PROJECT.md`, `/Volumes/Dock/Projects/HKP/Counterpoint/VISION.md`
- `/Volumes/Dock/Projects/HKP/CV/tools/speckit-auto/{run.sh,gates.sh,context-budget.sh,env.sh,worktree.sh,test-lock.ts,README.md}` (retry_wait, with_resume, worktree locks/cleanup, 40% budget hook, kernel-released SQLite test lock)
- `/Volumes/Dock/Projects/HKP/Cena/.planning/{ROADMAP.md,BACKLOG.md,STATE.md,config.json}`, `phases/01-multi-tenant-foundation/{01-CONTEXT.md,01-0x-PLAN.md}`
- Cena branch `ccr-61ff69b1-hgtpdm`: `proxy.ts`, `lib/factory/{guard.ts,signature.ts}`, `app/__mission/_lib/server.ts`, `factory/{factory,run}.yaml` (ideas only; contract not reused)

**Official documentation fetched 2026-11-09 (MEDIUM; cross-checked across pages unless noted):**
- Claude Code sandboxing: https://code.claude.com/docs/en/sandboxing (filesystem deny/allow, protected paths, `allowLocalBinding`, unix sockets, `--settings` inline, managed lock; headless applicability not stated)
- Claude Code hooks: https://code.claude.com/docs/en/hooks (input fields, PostToolUse/Stop `decision:block`, no usage field)
- Claude Code CLI reference: https://code.claude.com/docs/en/cli-reference (`--output-format stream-json`, `--json-schema`, `--max-turns`, `--settings`, `--setting-sources`, `--tools`, `--permission-prompts`, `--bare`)
- Run Claude Code programmatically: https://code.claude.com/docs/en/headless (`system/api_retry`, `system/init`, `--bare` semantics, SIGTERM behavior)
- Agent SDK TypeScript reference: https://code.claude.com/docs/en/agent-sdk/typescript (`SDKRateLimitEvent`, `ModelUsage.contextWindow`, `getContextUsage`); Agent SDK overview note on third-party claude.ai login (LOW-MEDIUM, single page)
- Agent teams: https://code.claude.com/docs/en/agent-teams (experimental, interactive-only)
- Managed settings paths: https://code.claude.com/docs/en/managed-settings (macOS `/Library/Application Support/ClaudeCode/managed-settings.json`)
- Node.js `node:sqlite`: https://nodejs.org/api/sqlite.html (Stability 1.2 RC; v26.x listed LTS)

**Web search (LOW-MEDIUM, corroborating only):**
- Anthropic sandbox runtime (`@anthropic-ai/sandbox-runtime`, `srt`), research preview: https://github.com/anthropic-experimental/sandbox-runtime
- Node 24/26 release status: https://nodejs.org/en/blog/announcements/evolving-the-nodejs-release-schedule
- Vibe Kanban technical overview (worktree-per-task + SQLite + pluggable executors; third-party description, maintenance status unverified): https://quochuydev.github.io/tech-research/researching/vibe-kanban-overview.html

**Design synthesis (reasoned, not sourced):** approvals repo placement, derive-don't-store approval, Governor, decision ledger/assumed-overturn, Landing, and the attack analysis in section 5 are original recommendations from this research and should be treated as proposals to validate in the phase spikes above.

---
*Architecture research for: local mission-control for autonomous spec-driven development with Claude Code*
*Researched: 2026-11-09*

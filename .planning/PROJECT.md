# Counterpoint

## What This Is

Counterpoint is a local mission-control tool for **fully autonomous spec-driven development with Claude Code**, led by its owner. The owner plans, decides and signs off designs well ahead of time in a planning lane; an autonomous build lane turns approved work into gated, per-feature pull requests with preview links, during the day or overnight. A council of role "seats" (product, design, tech, QA, and customer personas like a restaurant's Cook) works alongside both lanes: it meets at key steps, debates among itself, and turns what it finds into cards, backlog items and review notes for the owner — without ever blocking the lane.

It reads planning truth from the host project's SDD framework through adapters (GSD first), runs as its own local server (`counterpoint`; `npx @hkp/counterpoint` once published), and is built for the owner's own use on **Cena** first, as an open-source project to publish later as `@hkp/counterpoint`.

## Core Value

**The owner can approve work and walk away, and come back to green, reviewable per-feature PRs with preview links — plus only the questions that genuinely need them.** Runway (approved, ready-to-build work ahead of the builder) is the headline metric; the system succeeds as it needs the owner *less*.

## Requirements

### Validated

- ✓ Human approval is a signed git commit in the **host repo's normal history**, by a key agents cannot use (passphrase-only, never in ssh-agent/Keychain; startup self-check) — Phase 1 (APPR-01, FOUND-03; `counterpoint doctor` is the self-check)
- ✓ Runway approval = owner-signed commit on the base branch adding `.counterpoint/approvals/<item>.json` (statement binding hashes of spec, signed-off draft and gate config); touches only that file, never the owner's uncommitted work — Phase 1 (APPR-01, APPR-02; the draft binding reads `state none` until drafts exist in Phase 4)
- ✓ UI prepares the approval and shows a one-line command the owner runs in a terminal; signing and verification call `ssh-keygen -Y sign/verify` directly with a clean environment (never via git's config-driven signing or repo hooks); the owner's public key lives outside the repo — Phase 1 (APPR-04)
- ✓ Approval is recomputed, never stored: if the spec/draft/config changes after signing, hashes stop matching and the item drops off the runway into Needs You — Phase 1 (APPR-02; proven live on Cena)
- ✓ Agents are sandboxed away from the shared `.git/config`, `.git/hooks`, `.git/info`; an integrity check refuses to sign if they changed unexpectedly — Phase 1 (FOUND-04, APPR-04; one accepted risk: gh's Keychain credential; review findings CR-01 and WR-05 are Phase 2's first work)
- ✓ Runway shown as the headline metric (empty = builder starves, long = owner can step away) — Phase 1 (MISN-01)
- ✓ Framework-agnostic core with an adapter interface; GSD adapter reads `.planning/` natively (ROADMAP, phases, CONTEXT, PLANs; frozen Cena fixtures as the contract) — Phase 1 (ADPT-01, ADPT-02; a Biome import rule enforces the boundary)

### Active

**Build lane (the first priority)**
- [ ] Builder runs approved GSD phases autonomously in fresh `claude -p` sessions, each phase in its own git worktree, so runs never touch the owner's checkout
- [ ] One GSD phase = one feature = one branch/worktree/PR; plans and waves are internal steps
- [ ] Context budget: a session hands off (finish task, write handoff, commit, stop) at a share of the model's context window — default 40%, follows the model's window, adjustable per run in the UI with the token figure shown
- [ ] Gates are commands judged by exit code (typecheck · lint · unit · DB · flows…); an agent saying "done" never counts
- [ ] Gate row visible per work item, lighting up as gates pass; failing gate's last lines one click away
- [ ] Visual gate: built screens are compared against the signed-off design draft — structural checks (landmark regions via `data-cp-id`) first, tolerant/masked pixel diff added only after a flakiness spike; drift is flagged
- [ ] Gate integrity: gate definitions are owned by Counterpoint and read from the approved base, not the worktree; protected-path check flags edits to tests/configs/baselines; zero-test guard
- [ ] Parking after N failed attempts; parked items land in Needs You
- [ ] Usage-limit waits (reset time + 2 min), API-error backoff, stop time, single shared test lock
- [ ] On conflict with the owner's latest pushes, the builder rebases onto the base branch, resolves, re-runs gates, and parks if it can't
- [ ] Each finished feature opens its own PR with a preview link — the host's own preview deploy (e.g. Vercel) when one exists, a Counterpoint-served local preview otherwise
- [ ] Run report at the end of a run (what merged-ready, what parked, what's waiting on the owner)
- [ ] Start/Stop protected by a local token agents cannot read (the owner credential and request guard shipped in Phase 1, FOUND-02; the run controls it protects arrive in Phase 2)

**Design sign-off (part of the build lane)**
- [ ] Screen drafts are local, standalone mocks (HTML) with fixture data, rendered in the **host's own design system** (tokens/components), reviewable before implementation
- [ ] Explore in low-fi "wire" mode (neutral palette, real layout/components); sign off a hi-fi "full" render with the host's tokens and fixtures — the signed full render is the visual-gate reference
- [ ] Owner can pin comments on individual elements of a draft (in-house overlay injected by the mock server, anchored on stable `data-cp-id`s that survive redraws); an agent revises that part
- [ ] Owner can redraw a whole draft with a steering note
- [ ] Owner can request 2–3 variants side by side and pick or say "more like B"
- [ ] Council personas pin their own comments on drafts before the owner sees them
- [ ] A signed-off draft becomes the reference the visual gate checks the build against

**Approval & signing**
- [ ] Merge approval = the owner's signed merge commit (`--no-ff`) of the exact PR head; the summary shown before signing lists the assumptions the builder proceeded on

**Council**
- [ ] Seats defined per host in a Counterpoint config file, with defaults, and easy to add more
- [ ] Each council activity can involve the relevant seats (router-chosen) or all seats — owner chooses
- [ ] Seats discuss among themselves: async threads for quick clarifications, structured meetings (agenda, chair, turns, minutes) for bigger topics
- [ ] Meeting outputs are the owner's inbox: cards, backlog items, review notes; minutes and full transcript available
- [ ] Owner can call a meeting on any topic or screen, and read minutes and the full transcript
- [ ] Default meeting protocol: independent blind pass per seat → one anonymised critique round → chair synthesis; deterministic turn order; hard caps on rounds, tokens and wall time; dissent kept on the card as a minority report
- [ ] Seats differ by the evidence and tools they get (e.g. tech reads the diff), not only by persona prompt
- [ ] Council question cards for planning decisions: options with trade-offs; Pick, "More like B →" (new round anchored on B, optional steering note, breadcrumb trail with back-up), "None fit, reframe", Later
- [ ] Picked answers become decisions written back through the adapter (GSD: phase CONTEXT decisions) and committed
- [ ] Every card carries the council's recommended option and a reversibility class. Reversible: if unanswered when the build reaches dependent work, the builder proceeds on it, logged in an assumptions ledger as "assumed" and overturnable (overturn = rework, not a block). Irreversible (DB schema, auth, data model, public routes, privacy, pricing): only the dependent work item parks; the builder continues with other runway
- [ ] Council never blocks the owner or the build lane; approving, drafting and building never wait on a meeting
- [ ] Council can file backlog items directly into the host's backlog via the adapter (tagged "council", with evidence and severity, deduped against the existing backlog, capped per meeting, bulk-dismissable), with a summary in the owner's inbox — e.g. a critical root issue from three phases ago
- [ ] When the council meets automatically (phase kickoff, design review, post-build, conflict escalation) is still open — to be settled in discussion/planning, with the rule that meetings run alongside, never in front of, the work

**Mission view & inbox**
- [ ] One "Needs You" inbox: council cards, parked work, seat conflicts, persona findings, PRs awaiting signed approval (the inbox and its "approved version changed" source shipped in Phase 1; the other sources arrive with their phases)
- [ ] A few honest counters beside runway (e.g. first-attempt gate pass rate, items merged without intervention), each paired with a counter-metric so it can't reward failure modes
- [ ] One quota governor in front of every agent spawn: builder has priority, council spend capped to a share, all lanes pause together on a usage limit

**Adapters**
- [ ] GSD adapter reads the host's backlog and writes decisions and backlog items back through the adapter (the read side for ROADMAP, phases, CONTEXT and PLANs is validated)
- [ ] Builds never write planning files; all planning writes (decisions, backlog, approvals, bookkeeping) go through one serialized path

### Out of Scope

- Public npm release in v1 — develop and prove on Cena first; publish once stable as `@hkp/counterpoint` (still built as a standalone, open-sourceable project; re-check Claude Code terms before publishing)
- Live watch of council meetings and interjecting into a running meeting — deferred past v1 (scope)
- Post-build persona review (seats driving the running app in a browser / reviewing artifacts) — deferred past v1 (scope); persona *pre-comments on drafts* stay in v1
- Full gamification beyond runway and a few honest counters — deferred past v1 (scope)
- A separate approvals repository — approvals live in the host repo's normal history
- shadcn/ui and Tailwind for Counterpoint's own UI — the console uses Astryx
- "No framework" (plain markdown/YAML) adapter in v1 — the adapter boundary stays in the core, but only GSD ships
- Multi-vendor agent runtimes — Claude Code only, by principle
- Becoming a second spec system — Counterpoint reads the host's plan, never owns it
- UI as routes inside the host app — Counterpoint is its own local server so it works with any stack
- Auto-merge without the owner — merges only follow a verified signed approval
- Council blocking the lane or failing work items on persona opinion — persona findings are advisory
- Reusing the Cena prototype's spec or its `factory/*.yaml` file contract — it was built without the owner's acknowledgement; reuse components and ideas only
- Spec-Kit-specific parts of `speckit-auto`

## Context

- **First host: Cena** (`/Volumes/Dock/Projects/HKP/Cena`) — tiered restaurant OS (QR menu first), Next.js 16 + React 19 + Supabase + shadcn, pnpm, vitest, GSD `.planning/` with ROADMAP, BACKLOG, phases. Default branch `master`. Counterpoint's first real run targets Cena's **QR-menu roadmap**.
- **Prior art to reuse, not copy wholesale:**
  - `CV/tools/speckit-auto` (`/Volumes/Dock/Projects/HKP/CV/tools/speckit-auto`): `run.sh`, `gates.sh`, `checks.sh`, `context-budget.sh` (40% hook), `retry_wait`, `with_resume`, worktree locks, test lock, `env.sh` pinning subagents to Opus.
  - Cena branch `ccr-61ff69b1-hgtpdm`: mission-control console prototype (`app/__mission`), loopback/origin guard, signature check, run-settings and models forms, light/dark console theme.
- **Morning-after picture (owner's own words, distilled):** approved work items are built; some carry questions or refinement; gates are green, or a gate carries a council question (e.g. the Cook found the approved UI hard to use while testing it); multiple features each have their own PR and an easy preview link to try quickly.
- **Research done (2026-11-09, `.planning/research/`):** no existing mock-commenting tool fits (licensing/shape), so pins are an in-house overlay; no surveyed tool compares build vs approved mock or offers variants + "More like B" — both are differentiators; free-flow debate drifts to conformity, hence the structured blind-pass protocol; key risks are gate gaming, fail-open budget/limit handling, same-OS-user access to keys/config, council starving the builder's quota, and scope.
- **Cena is moving to Astryx** (owner's intent). Drafts always follow the host's own design system, so once Cena is on Astryx its drafts and Counterpoint's console share one system. The migration itself is Cena work.
- With GSD, council planning cards are a better front-end for what `discuss-phase` already does (grey areas → decisions).

## Constraints

- **Agent runtime**: Claude Code only — spawn the owner's own `claude -p` binary and parse `stream-json` behind one swappable `AgentRunner` port (Agent SDK only as a later second implementation); sessions run non-`--bare` so subscription login and hooks work
- **UI**: Counterpoint's console is React 19 + Astryx (`@astryxdesign/core`, MIT, beta 0.7.x, StyleX prebuilt CSS + themes) — no shadcn, no Tailwind; served as a prebuilt SPA by the local server, live updates over SSE
- **Framework coupling**: core never knows which SDD framework is used — everything framework-specific goes through an adapter
- **Security**: signing key and start/stop token must be unusable/unreadable by agents; approval key never cached
- **Isolation**: builds never touch the owner's checkout — worktrees only
- **UI**: local server, host-agnostic, loopback-only
- **Context windows**: no hard-coded window sizes; budgets follow the model
- **Packaging**: npm package `@hkp/counterpoint` (owner's org); one package as a modular monolith with the adapter boundary enforced by import rules — split out an adapter package only when a second adapter exists
- **Install locations (owner's machine)**: tools, caches and app data live on `/Volumes/Dock`, never the internal disk

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Build lane first; design sign-off is part of it | Owner wants to approve and walk away; reviewing mocks before build is where changes are cheapest | — Pending |
| One GSD phase = one feature = one PR | Matches how the owner thinks of features; plans/waves stay internal | — Pending |
| Persona findings are advisory cards, never gate failures | Taste/usability opinions shouldn't stall merges | — Pending |
| Personas test by seat: some drive the app, some review artifacts (post-v1) | Customer personas need hands-on use; tech/compliance read artifacts | — Pending |
| Preview: host's deploy preview when available, local fallback | Works with Vercel-style hosts and any stack | — Pending |
| Merge only after owner's signed approval | "The owner approves, agents satisfy" | — Pending |
| Signing via prepared command run in terminal | Simplest path that keeps the key out of agents' reach; Touch ID / FIDO2 could come later | ✓ Good — Phase 1: the owner signed Cena approvals from the printed command |
| Conflicts: builder rebases, re-gates, parks on failure | Keeps day runs moving while owner works on master | — Pending |
| Drafts are standalone local mocks; signed-off draft drives a visual gate | Easy to comment on elements; binding on the builder | — Pending |
| Council planning cards ship in v1 (full rounds/breadcrumbs/reframe) | Signature interaction | — Pending |
| Council never blocks; unanswered cards proceed on the recommended option | Owner must not wait on meetings for an "ok" | — Pending |
| Council files backlog items straight into the host backlog | Catch root issues (even from past phases) without owner triage overhead | — Pending |
| Seats in per-host config; relevant-few or all seats per activity, owner's choice | Control cost and noise | — Pending |
| Defer public npm release and no-framework adapter | Prove on Cena first | — Pending |
| Package name `@hkp/counterpoint` | Owner's npm org | ✓ Good — Phase 1; until the public release (PLAT-V2-02) the start command is the installed `counterpoint` (npm 12's npx does not resolve an unpublished scoped package) |
| Console UI on Astryx, no shadcn/Tailwind | Owner's design-system choice; Cena migrating to Astryx too | ✓ Good — Phase 1: console in light and dark, reviewed by the owner on Cena |
| Drafts rendered in the host's own design system | Visual gate compares like with like | — Pending |
| Explore low-fi "wire", sign off hi-fi "full" render | Only a hi-fi render with host tokens + fixtures can drive a visual gate | — Pending |
| Approvals in host repo history: signed commit adding `.counterpoint/approvals/<item>.json`; merge approval = owner's signed merge commit | No extra repo; visible in normal history; signing via `ssh-keygen` directly avoids repo hooks/config | ✓ Good (runway half) — Phase 1: Cena approval commits add only the approval file and verify with `ssh-keygen -Y`; merge approval comes in Phase 3 |
| Cards classified by reversibility; irreversible ones park the item instead of proceeding | Prevent silent wrong decisions on schema/auth/data/privacy | — Pending |
| Spawn `claude` CLI + stream-json behind an AgentRunner port | Typed limit/usage fields; SDK is 0.x and churns; avoids third-party-login terms issue | ✓ Good — Phase 1: the live sandbox probe runs headless `claude -p` through the runner |
| GSD adapter parses `.planning/` natively | gsd-tools JSON verbs aren't a published contract | ✓ Good — Phase 1: Cena's phases read from committed `.planning/` against frozen fixtures |
| Builds never write planning files; one serialized planning-write path | Parallel PRs would all conflict on STATE/ROADMAP | — Pending |
| v1 keeps variants + "More like B"; defers live watch/interject, post-build persona review, full gamification | Prove an overnight run before widening | — Pending |
| Approval statement format `counterpoint/approval/v1` (RESEARCH Item 4, sorted keys, no prepared block) | Owner picked the minimal format; a hand-edited statement is invalid, not misleading | ✓ Good — Phase 1 |
| Agent sessions run in Claude Code auto permission mode, not dontAsk; no deterministic guarantee rests on the classifier | Owner runs auto daily; headless default denies every unlisted call, so builders would stall | ✓ Good — Phase 1: live proof in auto mode; the probe evaluator counts only deterministic refusals |
| Opt out of the subprocess env scrub (`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0`) with three Counterpoint-owned replacements: `autoAllowBashIfSandboxed: false`, doctor fails if any settings source turns isolation off, a credential-env probe row | On claude 2.1.321 the scrub forced auto to default mode | ⚠️ Revisit — Phase 2 first work: WR-01 (bare `Bash` in `--allowedTools` may make replacement 1 inert) and CR-01 (settings check misses `allowWrite` / `additionalDirectories` widenings) |
| Agent Write/Edit confined to the session folder (allow-only-workdir grant plus `blockWritesOutsideWorkingDirectories`) | `allowWrite: []` confines only Bash | ✓ Good — Phase 1; a Bash outside-write probe step is still missing (CR-01) |
| gh's Keychain reachability is a recorded per-machine accepted risk (`counterpoint accept-risk gh-keychain`), printed on every doctor run | Sandboxed Bash can read the macOS Keychain; every gh config-file step is blocked | ✓ Accepted — Phase 1: verdict reads "boxed in, with one accepted risk", never a plain pass |
| Credential-env row: deny `CLAUDE_CODE_MESSAGING_TOKEN`; the sandbox's own loopback proxy login (proxy URLs, `CLOUDSDK_PROXY_PASSWORD` with a loopback address) is a named exception | None is a protected target; Claude Code sets the proxy login after deny entries apply; a non-loopback host is a real finding | ✓ Good — Phase 1 (01-26 rerun clean) |
| Live-plan stop rules narrowed: only a protected-target failure stops a plan; other live surprises become recorded findings | Three sandbox re-plans in one phase ("going in circles") | ✓ Adopted — Phase 1 |
| Phase 1 closes with the code review open; CR-01, WR-02, WR-04, WR-05, WR-06 (and verifying WR-01) are Phase 2's first work, before any unattended builder runs | Trust fixes belong before the first overnight run, not behind it | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-11-10 after Phase 1*

# Counterpoint

## What This Is

Counterpoint is a local mission-control tool for **fully autonomous spec-driven development with Claude Code**, led by its owner. The owner plans, decides and signs off designs well ahead of time in a planning lane; an autonomous build lane turns approved work into gated, per-feature pull requests with preview links, during the day or overnight. A council of role "seats" (product, design, tech, QA, and customer personas like a restaurant's Cook) works alongside both lanes: it meets at key steps, debates among itself, and turns what it finds into cards, backlog items and review notes for the owner — without ever blocking the lane.

It reads planning truth from the host project's SDD framework through adapters (GSD first), runs as its own local server (`npx counterpoint`), and is built for the owner's own use on **Cena** first, as an open-source project to publish later.

## Core Value

**The owner can approve work and walk away, and come back to green, reviewable per-feature PRs with preview links — plus only the questions that genuinely need them.** Runway (approved, ready-to-build work ahead of the builder) is the headline metric; the system succeeds as it needs the owner *less*.

## Requirements

### Validated

(None yet — ship to validate)

### Active

**Build lane (the first priority)**
- [ ] Builder runs approved GSD phases autonomously in fresh `claude -p` sessions, each phase in its own git worktree, so runs never touch the owner's checkout
- [ ] One GSD phase = one feature = one branch/worktree/PR; plans and waves are internal steps
- [ ] Context budget: a session hands off (finish task, write handoff, commit, stop) at a share of the model's context window — default 40%, follows the model's window, adjustable per run in the UI with the token figure shown
- [ ] Gates are commands judged by exit code (typecheck · lint · unit · DB · flows…); an agent saying "done" never counts
- [ ] Gate row visible per work item, lighting up as gates pass; failing gate's last lines one click away
- [ ] Visual gate: built screens are compared against the signed-off design draft; drift is flagged
- [ ] Parking after N failed attempts; parked items land in Needs You
- [ ] Usage-limit waits (reset time + 2 min), API-error backoff, stop time, single shared test lock
- [ ] On conflict with the owner's latest pushes, the builder rebases onto the base branch, resolves, re-runs gates, and parks if it can't
- [ ] Each finished feature opens its own PR with a preview link — the host's own preview deploy (e.g. Vercel) when one exists, a Counterpoint-served local preview otherwise
- [ ] Run report at the end of a run (what merged-ready, what parked, what's waiting on the owner)
- [ ] Start/Stop protected by a local token agents cannot read

**Design sign-off (part of the build lane)**
- [ ] Screen drafts are local, standalone mocks (HTML or similar) with mock data, reviewable before implementation — fidelity (low-fi vs hi-fi) to be decided by research
- [ ] Owner can pin comments on individual elements of a draft; an agent revises that part
- [ ] Owner can redraw a whole draft with a steering note
- [ ] Owner can request 2–3 variants side by side and pick or say "more like B"
- [ ] Council personas pin their own comments on drafts before the owner sees them
- [ ] A signed-off draft becomes the reference the visual gate checks the build against

**Approval & signing**
- [ ] Human approval is a signed git commit by a key agents cannot use (passphrase, never cached)
- [ ] Two approval points: approving work into the runway (spec + design) and approving a finished feature for merge
- [ ] UI prepares the approval and shows a one-line command the owner runs in a terminal to sign; Counterpoint verifies the signature before acting (merge happens only after a verified signed approval)

**Council**
- [ ] Seats defined per host in a Counterpoint config file, with defaults, and easy to add more
- [ ] Each council activity can involve the relevant seats (router-chosen) or all seats — owner chooses
- [ ] Seats discuss among themselves: async threads for quick clarifications, structured meetings (agenda, chair, turns, minutes) for bigger topics
- [ ] Meeting outputs are the owner's inbox: cards, backlog items, review notes; minutes and full transcript available
- [ ] Owner can watch a meeting live, interject a note into a running meeting, and call a meeting on any topic or screen
- [ ] Council question cards for planning decisions: options with trade-offs; Pick, "More like B →" (new round anchored on B, optional steering note, breadcrumb trail with back-up), "None fit, reframe", Later
- [ ] Picked answers become decisions written back through the adapter (GSD: phase CONTEXT decisions) and committed
- [ ] Every card carries the council's recommended option; if unanswered when the build reaches dependent work, the builder proceeds on it, logged as "assumed" and overturnable
- [ ] Council never blocks the owner or the build lane; approving, drafting and building never wait on a meeting
- [ ] Council can file backlog items directly into the host's backlog via the adapter (tagged "council", with evidence), with a summary in the owner's inbox — e.g. a critical root issue from three phases ago
- [ ] Post-build persona review: some seats drive the running app in character (browser, screenshots — e.g. Cook, waiter, diner), others review artifacts (diff, screenshots, flows — e.g. tech, compliance); findings are advisory cards, never failing the work item
- [ ] When the council meets automatically (phase kickoff, design review, post-build, conflict escalation) is still open — to be settled in discussion/planning, with the rule that meetings run alongside, never in front of, the work

**Mission view & inbox**
- [ ] Runway shown as the headline metric (empty = builder starves, long = owner can step away)
- [ ] One "Needs You" inbox: council cards, parked work, seat conflicts, persona findings, PRs awaiting signed approval
- [ ] Gamification on what matters: runway length, questions resolved, rounds-to-converge, first-attempt gate pass rate, items merged without intervention

**Adapters**
- [ ] Framework-agnostic core with an adapter interface; GSD adapter reads `.planning/` (ROADMAP, phases, CONTEXT, PLANs, backlog) and writes decisions/backlog back through it

### Out of Scope

- Public npm release in v1 — develop and prove on Cena first; publish once stable (still built as a standalone, open-sourceable project)
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
- **Research asks from the owner:** survey existing tools for commenting on / iterating mock UI (element-pinned comments, variants, redraw); survey existing multi-agent council / debate tools where agents discuss among themselves; recommend draft fidelity (low-fi vs hi-fi) in light of the visual gate.
- With GSD, council planning cards are a better front-end for what `discuss-phase` already does (grey areas → decisions).

## Constraints

- **Agent runtime**: Claude Code only (`claude -p` sessions, subagents) — principle, no multi-vendor abstraction
- **Framework coupling**: core never knows which SDD framework is used — everything framework-specific goes through an adapter
- **Security**: signing key and start/stop token must be unusable/unreadable by agents; approval key never cached
- **Isolation**: builds never touch the owner's checkout — worktrees only
- **UI**: local server, host-agnostic, loopback-only
- **Context windows**: no hard-coded window sizes; budgets follow the model
- **Packaging**: intended scoped npm package (e.g. `@alex-profir/counterpoint`); single package vs core + adapter packages decided during research/planning
- **Install locations (owner's machine)**: tools, caches and app data live on `/Volumes/Dock`, never the internal disk

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Build lane first; design sign-off is part of it | Owner wants to approve and walk away; reviewing mocks before build is where changes are cheapest | — Pending |
| One GSD phase = one feature = one PR | Matches how the owner thinks of features; plans/waves stay internal | — Pending |
| Persona findings are advisory cards, never gate failures | Taste/usability opinions shouldn't stall merges | — Pending |
| Personas test by seat: some drive the app, some review artifacts | Customer personas need hands-on use; tech/compliance read artifacts | — Pending |
| Preview: host's deploy preview when available, local fallback | Works with Vercel-style hosts and any stack | — Pending |
| Merge only after owner's signed approval | "The owner approves, agents satisfy" | — Pending |
| Signing via prepared command run in terminal | Simplest path that keeps the key out of agents' reach; Touch ID could come later | — Pending |
| Conflicts: builder rebases, re-gates, parks on failure | Keeps day runs moving while owner works on master | — Pending |
| Drafts are standalone local mocks; signed-off draft drives a visual gate | Easy to comment on elements; binding on the builder | — Pending |
| Council planning cards ship in v1 (full rounds/breadcrumbs/reframe) | Signature interaction | — Pending |
| Council never blocks; unanswered cards proceed on the recommended option | Owner must not wait on meetings for an "ok" | — Pending |
| Council files backlog items straight into the host backlog | Catch root issues (even from past phases) without owner triage overhead | — Pending |
| Seats in per-host config; relevant-few or all seats per activity, owner's choice | Control cost and noise | — Pending |
| Defer public npm release and no-framework adapter | Prove on Cena first | — Pending |

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
*Last updated: 2026-11-09 after initialization*

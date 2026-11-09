# Counterpoint — vision

> Working name. Independent voices that each keep their own line and resolve into one harmony: council seats arguing, agents building in parallel, and the owner as composer who signs off the result.

Status: brainstorm captured on 2026-11-09, before any planning. Input for `/gsd-new-project`.

## What it is

A tool for **fully autonomous spec-driven development** that the owner *leads* from a mission view. Planning and building are separate activities: you plan, decide and draft screens far ahead; the build runs on its own, during the day or overnight, as you choose.

It is its own public project (open source, published as a scoped npm package, e.g. `@alex-profir/counterpoint`). Its first host is **Cena** (`/Volumes/Dock/Projects/HKP/Cena`), because Cena already has real data and a real roadmap.

## Principles

1. **Agnostic to the SDD framework.** The core never knows which spec framework is used. Frameworks plug in through adapters. **GSD is the first adapter**; "no framework" (a plain markdown/YAML list) should also work.
2. **Read the plan, don't own it.** Counterpoint reads planning truth from the host's framework (for GSD: `.planning/` ROADMAP, phases, CONTEXT, PLANs). It never becomes a second spec system.
3. **Claude Code only.** Designed for Claude Code as the agent runtime; no multi-vendor abstraction.
4. **The owner approves, agents satisfy.** Human approval is a signed git commit by a key agents cannot use (passphrase or Touch ID, never cached).
5. **An external judge.** Gates are commands judged by exit code. An agent saying "done" never counts.
6. **Host-agnostic UI.** The UI is Counterpoint's own local server (e.g. `npx counterpoint`), not routes inside the host app, so it works with any stack.

## Core loop

```
 PLANNING LANE (owner leads)                      BUILD LANE (autonomous, day or night)
 ─────────────────────────────────────────        ──────────────────────────────────────
 Spec ─▶ Screen draft ─▶ Council ─▶ ✍ Approve ─▶ Work items ─▶ Build ─▶ Gates ─▶ Merged
          (mock data)   (cards to you) (signed)        │            ▲        │
                                                       └── RUNWAY ──┘     parked ─▶ Needs you
```

- **Runway**: how much approved, ready-to-build work sits ahead of the builder. Empty runway = the builder starves, plan more. Long runway = you can step away. The headline metric.
- **Gates, clearly visible**: every work item shows its gate row (typecheck · lint · unit · DB · flows…) lighting up as each passes; the failing gate's last lines one click away.
- **Needs you**: one inbox of council cards, parked work and seat conflicts.

## Council cards (the signature interaction)

The council (role "seats", e.g. product, design, tech, QA, compliance, customer voices) finds the questions worth the owner's time and turns each into a card:

```
┌ Question (raised by Tech + QA) ─────────────────────────┐
│ Kitchen tickets when Wi-Fi drops?                        │
│  A Queue on device, sync later   ── trade-offs ──        │
│  B Block ordering, show banner   ── trade-offs ──        │
│  C Fall back to printed tickets  ── trade-offs ──        │
│ [Pick]   [More like B →]   [None fit, reframe]   [Later] │
└──────────────────────────────────────────────────────────┘
```

- **Pick**: the answer becomes a decision written back through the framework adapter (GSD: the phase CONTEXT decisions) and committed.
- **More like B →**: none fits, but B is closest. The council generates a new round anchored on B, optionally with a steering note ("B, but don't block the waiter"). A breadcrumb trail (A/B/C → B → B2 …) shows how you converged and lets you back up.
- **None fit, reframe**: the question itself was wrong; the council reframes it.
- With GSD this is a better front-end for what `discuss-phase` already does (grey areas → decisions).

## Gamification — on what matters, not points

Runway length, questions resolved, rounds-to-converge, first-attempt gate pass rate, work items merged without intervention. The score rises as the system needs you *less*.

## Build engine

- Each work item runs in **fresh `claude -p` sessions**, in its own git worktree (so day runs never touch the owner's checkout).
- **Context budget**: when a session's context passes a set share of the model's window, it finishes the task in progress, writes a handoff, commits and stops; the next fresh session continues from the handoff. Default **40%**. The budget **follows the model's context window** (no hard-coded 1M) and is **adjustable in the UI per run**, with the token figure shown ("40% of 1M = 400k tokens").
- Parking after N failed attempts, usage-limit waits (reset time + 2 min), API-error backoff, a stop time, a single shared test lock, a run report, draft PR at the end.
- Start/Stop protected by a local token agents cannot read.

## Prior art to reuse (not copy wholesale)

- **CV repo `tools/speckit-auto`** (`/Volumes/Dock/Projects/HKP/CV/tools/speckit-auto`): `retry_wait`, `with_resume`, worktree locks, test lock, `context-budget.sh` (40% hook), env pinning subagents to Opus. Drop everything Spec-Kit-specific.
- **Cena branch `ccr-61ff69b1-hgtpdm`**: a mission-control console prototype (`app/__mission`), loopback/origin guard, signature check, run-settings and models forms, light/dark console theme. Built by a cloud session **without the owner's acknowledgement** — reuse components and ideas, not its spec or its `factory/*.yaml` file contract.

## Open questions

- Approving and deciding from the UI vs. signing in a terminal: prepare-and-show-command, a local passphrase helper, or a Touch ID key (1Password SSH agent) signing on click.
- How GSD plans map to buildable work items (phase → plans → tasks/waves) and where "approved" lives.
- Day-mode concurrency: the owner working in the main checkout while builds run in worktrees — merge/conflict policy.
- Which Cena scope Counterpoint builds first (the QR-menu roadmap vs. the ordering/kitchen tier the prototype targeted).
- Council cost: seats × rounds × cards; how many seats per question by default.
- Package layout: CLI + local web UI + adapters (`@alex-profir/counterpoint`, `…-gsd`?) or a single package.

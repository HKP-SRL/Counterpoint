---
gsd_state_version: "1.0"
current_phase: 01
current_phase_name: Trusted Shell & Signed Runway
status: executing
stopped_at: Phase 1 UI-SPEC approved
last_updated: "2026-11-10T11:53:46.877Z"
last_activity: 2026-11-10
last_activity_desc: Phase 01 execution started
state_head: 5f823afa121429a023bd693b310622478cd526d5
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 24
  completed_plans: 16
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-11-09)

**Core value:** The owner can approve work and walk away, and come back to green, reviewable per-feature PRs with preview links, plus only the questions that genuinely need them.
**Current focus:** Phase 01 — Trusted Shell & Signed Runway

## Current Position

Phase: 01 (Trusted Shell & Signed Runway) — READY TO EXECUTE
Plan: 16 of 24
Status: Ready to execute — scrub gap re-planned (01-24..01-26 new; 01-21 superseded; 01-22, 01-23, 01-19, 01-20, 01-16 revised); next wave 11 = 01-24
Last activity: 2026-11-10 — Phase 01 execution started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: -
- Trend: -

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Six coarse vertical slices. The build lane is proven on Cena (Phases 1–3) before design sign-off (Phase 4) and the council (Phases 5–6).
- [Roadmap]: The trust layer (sandbox, key checks, `ssh-keygen` verification, loopback guard) ships in Phase 1, before any merge path, which first appears in Phase 3.
- [Roadmap]: Phase 2 is CLI first. One unattended overnight run on a Cena QR-menu phase ending in a green PR is the exit gate for later phases.
- [Roadmap]: The variants / "More like B" round model is built once in Phase 4 (drafts) and reused by council cards in Phase 5.
- [Owner]: Approvals live in the host repo's normal history (research D2 rejected). The console uses Astryx. The package is `@hkp/counterpoint`.
- [Phase 01]: [Owner] Approval statement format frozen as RESEARCH Item 4 (counterpoint/approval/v1, no prepared block)
- [Phase 01]: [Owner] Keychain reachability (WINDOWS.md #1) accepted and documented; doctor gets an explicit recorded exception for the gh credentials row (to implement in a Phase 1 gap plan)
- [Phase 01]: [Owner] Write/Edit tools writing outside the sandbox (WINDOWS.md #2) to be fixed by a Phase 1 gap-closure plan before 01-16
- [Phase 01]: [Owner] Agent sessions run in Claude Code auto permission mode (classifier decides unlisted calls), not dontAsk; deterministic guarantees (deny rules, outside-workdir file writes) must not rest on the classifier — Owner runs Claude on auto daily and does not want the runner to stop on unlisted commands; prefers a classifier. 01-18 live probe showed dontAsk is not what runs anyway (CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1 forced default mode on claude 2.1.321).
- [Phase 01]: [Owner] Opt out of the scrub (2026-11-10, after 01-21's halt): agentEnv sets CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0 so agent sessions can run in auto mode, with Counterpoint-owned replacements for what the scrub gave: launch settings set sandbox.autoAllowBashIfSandboxed: false explicitly; doctor/probe fail if any settings source disables filesystem isolation; a new probe row fails if a sandboxed Bash step's environment holds any token- or credential-shaped variable Claude Code injected. The re-plan's first live step must prove SCRUB=0 actually yields permissionMode auto before any evaluator work. Option 3 (default mode + explicit allow lists) rejected: headless default denies every unlisted call, so builders would stall.

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1]: Unverified whether Claude Code's sandbox confines headless `claude -p` (Bash and Read/Edit). This is the first spike, and the trust model depends on it.
- [Phase 2]: Unverified context-window denominator on 1M models and `rate_limit_event` shape and reset unit. Spike before the budget and limit handling.
- [Phase 3]: Branch-protection recipe for Cena's `master` not yet verified.
- [Phase 4]: Fixture-mode rendering of Cena screens and `data-cp-id` stability across redraws are unproven. Spike before the visual gate.
- [Phase 1] 01-18 halted on claude 2.1.321 (CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1 forced dontAsk to default) and is superseded by gap plans 01-21..01-23 (auto mode + permissions.blockWritesOutsideWorkingDirectories + deterministic-only evaluator + doctor effective-mode check). Likely owner-decision gate: 01-21's live tracer stops if the scrub also forces auto to default; 01-22, 01-23, 01-19, 01-20 and 01-16 then wait for the owner's choice (layer-preserving launch variant / opt out of the scrub / default mode). Halted worktree .claude/worktrees/agent-a333676a91bb722f1 (branch worktree-agent-a333676a91bb722f1) stays until 01-23 merges (it reads c3f8034), then is removed. Evidence: /Volumes/Dock/Dev/Caches/cp-test-0118/evidence-01-18-live/.
- [Phase 1] 01-21 halted at Task 1 step 4(a) (2026-11-10): on claude 2.1.321 the scrub forced --permission-mode auto to default in every session and every layer-preserving variant (WINDOWS.md ledger #3). Outside Write/Edit were refused by permissions.blockWritesOutsideWorkingDirectories (reason_type `other`, not `rule`); git-hooks/git-info by the deny rule; control met the attribution rule. Owner chose option 2 (opt out of the scrub with replacement checks). Re-planned 2026-11-10 (8e79f41, ca8326d, 206d681, 5f823af): 01-21 superseded by 01-24 (SCRUB=0 + autoAllowBashIfSandboxed false, live auto proof first, then the deterministic-only evaluator), 01-25 (doctor sandbox-isolation settings check, by-effect reading confirmed by owner), 01-26 (ninth probe row credential-env); WINDOWS #3 closes in 01-23, scoped (replacement 2 proven on the launch source there, on the owner's real settings in 01-16); owner accepted the plan-size warnings. 01-24 cherry-picks e5e59f3. 01-21's launch-profile work (e5e59f3) and halted SUMMARY (f41c4a4) sit unmerged on worktree-agent-a1ce4d71c120d2428 (.claude/worktrees/agent-a1ce4d71c120d2428), kept for the re-plan. Evidence: /Volumes/Dock/Dev/Caches/cp-test-0121/evidence-01-21-live/.

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| *(none)* | | | | |

## Session Continuity

Last session: 2026-11-09T13:21:22.361Z
Stopped at: Phase 1 UI-SPEC approved
Resume file: .planning/phases/01-trusted-shell-signed-runway/01-UI-SPEC.md

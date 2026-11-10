---
gsd_state_version: "1.0"
current_phase: 01
current_phase_name: Trusted Shell & Signed Runway
status: executing
stopped_at: Phase 1 UI-SPEC approved
last_updated: "2026-11-10T20:03:37.446Z"
last_activity: 2026-11-10
last_activity_desc: Phase 01 execution started
state_head: ecd22bf25f0a1d421a9c6994cd4b396b6ed433e3
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 24
  completed_plans: 24
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-11-09)

**Core value:** The owner can approve work and walk away, and come back to green, reviewable per-feature PRs with preview links, plus only the questions that genuinely need them.
**Current focus:** Phase 01 — Trusted Shell & Signed Runway

## Current Position

Phase: 01 (Trusted Shell & Signed Runway) — EXECUTING
Plan: 24 of 24
Status: Ready to execute
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
- [Phase 01]: [Owner] Credential-env row scoped to the real requirement (2026-11-10, after 01-26's halt): 01-26's live listing (SCRUB=0, auto mode) found 14 credential-shaped variables in sandboxed Bash — CLAUDE_CODE_MESSAGING_TOKEN, CLOUDSDK_PROXY_PASSWORD, and 12 proxy URLs with user:password (likely the sandbox network proxy's own per-session login). None is a protected target (signing key, ~/.ssh, start/stop token, gh credentials). Decision: deny CLAUDE_CODE_MESSAGING_TOKEN and CLOUDSDK_PROXY_PASSWORD in the launch profile via `sandbox.credentials.envVars` (mode deny); the listing additionally records, as a shape only (never a value), whether each proxy URL's host is a loopback address; if every one is loopback, the owner records them as a named exception ("the sandbox's own proxy login, local only", like the Keychain one); any non-loopback proxy host is a real finding. Re-plan only 01-26's step 3 and Task 2, reusing 1fc2492.
- [Phase 01]: [Owner] Stop rules narrowed for the remaining gap plans (2026-11-10): a live fact that is a protected-target failure (a protected path readable/writable, an outside-workdir write accepted, a confinement claim resting on the classifier or the mode) still stops the plan. Any other unexpected live fact is recorded as a finding in the SUMMARY (and WINDOWS.md where relevant) for owner review, and the plan continues. Owner: "we're going in circles" — three sandbox re-plans in this phase.
- [Phase 01]: [Owner] CLOUDSDK_PROXY_PASSWORD joins the sandbox-proxy-login exception (2026-11-10, after 01-26's rerun halt): the rerun showed CLAUDE_CODE_MESSAGING_TOKEN removed by the deny entry and all 12 proxy URLs loopback, but CLOUDSDK_PROXY_PASSWORD still present despite its deny entry (Claude Code sets the CLOUDSDK_PROXY_* gcloud proxy config — ADDRESS, PORT, TYPE, USERNAME, PASSWORD — after deny entries apply, like the proxy URLs). Decision: drop it from CREDENTIAL_ENV_DENY and add it to the `sandbox-proxy-login` exception, conditioned on CLOUDSDK_PROXY_ADDRESS having host class loopback (the listing classes that address the same way as the proxy URLs; never records the value). A non-loopback address, or the password present without the address, fails the row. CLAUDE_CODE_MESSAGING_TOKEN stays denied.

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1]: Unverified whether Claude Code's sandbox confines headless `claude -p` (Bash and Read/Edit). This is the first spike, and the trust model depends on it.
- [Phase 2]: Unverified context-window denominator on 1M models and `rate_limit_event` shape and reset unit. Spike before the budget and limit handling.
- [Phase 3]: Branch-protection recipe for Cena's `master` not yet verified.
- [Phase 4]: Fixture-mode rendering of Cena screens and `data-cp-id` stability across redraws are unproven. Spike before the visual gate.
- [Phase 1] 01-18 halted on claude 2.1.321 (CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1 forced dontAsk to default) and is superseded by gap plans 01-21..01-23 (auto mode + permissions.blockWritesOutsideWorkingDirectories + deterministic-only evaluator + doctor effective-mode check). Likely owner-decision gate: 01-21's live tracer stops if the scrub also forces auto to default; 01-22, 01-23, 01-19, 01-20 and 01-16 then wait for the owner's choice (layer-preserving launch variant / opt out of the scrub / default mode). 01-23 merged 2026-11-10 (nine-row live proof in auto mode, WINDOWS #2/#3 fixed); the 01-18 worktree is removed. Evidence: /Volumes/Dock/Dev/Caches/cp-test-0118/evidence-01-18-live/.
- [Phase 1] 01-21 halted at Task 1 step 4(a) (2026-11-10): on claude 2.1.321 the scrub forced --permission-mode auto to default in every session and every layer-preserving variant (WINDOWS.md ledger #3). Outside Write/Edit were refused by permissions.blockWritesOutsideWorkingDirectories (reason_type `other`, not `rule`); git-hooks/git-info by the deny rule; control met the attribution rule. Owner chose option 2 (opt out of the scrub with replacement checks). Re-planned 2026-11-10 (8e79f41, ca8326d, 206d681, 5f823af): 01-21 superseded by 01-24 (SCRUB=0 + autoAllowBashIfSandboxed false, live auto proof first, then the deterministic-only evaluator), 01-25 (doctor sandbox-isolation settings check, by-effect reading confirmed by owner), 01-26 (ninth probe row credential-env); WINDOWS #3 closes in 01-23, scoped (replacement 2 proven on the launch source there, on the owner's real settings in 01-16); owner accepted the plan-size warnings. 01-24 cherry-picks e5e59f3. 01-21's launch-profile work (e5e59f3) and halted SUMMARY (f41c4a4) sit unmerged on worktree-agent-a1ce4d71c120d2428 (.claude/worktrees/agent-a1ce4d71c120d2428), kept for the re-plan. Evidence: /Volumes/Dock/Dev/Caches/cp-test-0121/evidence-01-21-live/.
- [Phase 1] 01-24 and 01-25 merged (2026-11-10; gates green: 885 unit, 44 e2e); 01-21's worktree removed. 01-26 halted at Task 1 step 2 under stop rule (e) (credential-shaped env in sandboxed Bash); owner decided the scoped fix above. 01-26 completed 2026-11-10 after two owner decisions (rerun2 clean: one deny entry, 13 excepted loopback proxy entries, ninth row, MATCHER_REVISION 4, WINDOWS #4 waived); its halted worktrees are removed. Evidence: /Volumes/Dock/Dev/Caches/cp-test-0126/evidence-01-26-live/.

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| *(none)* | | | | |

## Session Continuity

Last session: 2026-11-09T13:21:22.361Z
Stopped at: Phase 1 UI-SPEC approved
Resume file: .planning/phases/01-trusted-shell-signed-runway/01-UI-SPEC.md

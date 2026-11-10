---
phase: 01-trusted-shell-signed-runway
verified: 2026-11-10T20:45:00Z
status: passed
score: 6/6 must-haves verified
covered_files: [".planning/phases/01-trusted-shell-signed-runway/01-01-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-01-SUMMARY.md",".planning/phases/01-trusted-shell-signed-runway/01-02-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-02-SUMMARY.md",".planning/phases/01-trusted-shell-signed-runway/01-03-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-03-SUMMARY.md",".planning/phases/01-trusted-shell-signed-runway/01-04-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-04-SUMMARY.md",".planning/phases/01-trusted-shell-signed-runway/01-05-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-05-SUMMARY.md",".planning/phases/01-trusted-shell-signed-runway/01-06-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-06-SUMMARY.md",".planning/phases/01-trusted-shell-signed-runway/01-07-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-07-SUMMARY.md",".planning/phases/01-trusted-shell-signed-runway/01-08-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-08-SUMMARY.md",".planning/phases/01-trusted-shell-signed-runway/01-09-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-09-SUMMARY.md",".planning/phases/01-trusted-shell-signed-runway/01-10-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-10-SUMMARY.md",".planning/phases/01-trusted-shell-signed-runway/01-11-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-11-SUMMARY.md",".planning/phases/01-trusted-shell-signed-runway/01-12-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-12-SUMMARY.md",".planning/phases/01-trusted-shell-signed-runway/01-13-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-13-SUMMARY.md",".planning/phases/01-trusted-shell-signed-runway/01-14-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-14-SUMMARY.md",".planning/phases/01-trusted-shell-signed-runway/01-15-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-15-SUMMARY.md",".planning/phases/01-trusted-shell-signed-runway/01-16-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-16-SUMMARY.md",".planning/phases/01-trusted-shell-signed-runway/01-17-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-17-SUMMARY.md",".planning/phases/01-trusted-shell-signed-runway/01-18-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-19-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-19-SUMMARY.md",".planning/phases/01-trusted-shell-signed-runway/01-20-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-20-SUMMARY.md",".planning/phases/01-trusted-shell-signed-runway/01-21-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-22-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-22-SUMMARY.md",".planning/phases/01-trusted-shell-signed-runway/01-23-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-23-SUMMARY.md",".planning/phases/01-trusted-shell-signed-runway/01-24-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-24-SUMMARY.md",".planning/phases/01-trusted-shell-signed-runway/01-25-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-25-SUMMARY.md",".planning/phases/01-trusted-shell-signed-runway/01-26-PLAN.md",".planning/phases/01-trusted-shell-signed-runway/01-26-SUMMARY.md","biome.json","package.json","scripts/backstop.ts","scripts/host-phases.ts","src/adapters/gsd/index.ts","src/adapters/gsd/inputs.ts","src/adapters/gsd/layout.ts","src/adapters/gsd/normalize.ts","src/adapters/gsd/plans.ts","src/adapters/gsd/roadmap.ts","src/agent/claude-argv.ts","src/agent/env-listing.ts","src/agent/probe-evaluator.ts","src/agent/probe.ts","src/agent/runner.ts","src/cli/approve.ts","src/cli/control-client.ts","src/cli/doctor.ts","src/cli/main.ts","src/cli/risk.ts","src/cli/trust.ts","src/compose.ts","src/core/approvals/canonical.ts","src/core/approvals/commit.ts","src/core/approvals/digest.ts","src/core/approvals/gates.ts","src/core/approvals/integrity.ts","src/core/approvals/prepare.ts","src/core/approvals/ssh.ts","src/core/approvals/statement.ts","src/core/approvals/trust-store.ts","src/core/approvals/verify.ts","src/core/framework/port.ts","src/core/git/diff.ts","src/core/git/plumbing.ts","src/core/git/reader.ts","src/core/git/run.ts","src/core/host/home.ts","src/core/host/registry.ts","src/core/ids.ts","src/core/runway/needs-you.ts","src/core/runway/runway.ts","src/core/runway/status.ts","src/core/security/accepted-risks.ts","src/core/security/agent-env.ts","src/core/security/doctor-report.ts","src/core/security/guard.ts","src/core/security/login.ts","src/core/security/sandbox-isolation.ts","src/core/security/sandbox-settings.ts","src/core/store/db.ts","src/core/store/events.ts","src/doctor/run.ts","src/doctor/settings-sources.ts","src/doctor/signing-key.ts","src/doctor/tools.ts","src/server/app.ts","src/server/approval-views.ts","src/server/control.ts","src/server/daemon.ts","src/server/hosts.ts","src/server/routes/approvals.ts","src/server/routes/needs-you.ts","src/server/routes/phases.ts","src/server/routes/trust.ts","src/server/sse.ts","src/server/watcher.ts","tsdown.config.ts","ui/public/theme-init.js","ui/src/api.ts","ui/src/components/ApprovalDialog.tsx","ui/src/components/StatusBadge.tsx","ui/src/live.ts","ui/src/main.tsx","ui/src/pages/ChangeViewPage.tsx","ui/src/pages/MissionPage.tsx","ui/src/pages/NeedsYouPage.tsx","ui/src/pages/PhaseDetailPage.tsx","ui/src/pages/PhasesPage.tsx","ui/src/pages/SignedOutPage.tsx","ui/src/pages/TrustPage.tsx","ui/src/router.tsx","ui/src/runway.ts","ui/src/shell/AppFrame.tsx","ui/src/styles.css","ui/src/theme.ts","vitest.config.ts"]
covered_digest: "v4:sha256:4f705ba3680fd27671fee67eaa1710cbd976393d94ab4d5a88b733ba55ac29d6"
behavior_unverified: 0
overrides_applied: 2
overrides:
  - must_have: "The probe shows that a headless claude -p session cannot read gh credentials"
    reason: "Sandboxed agent Bash can read macOS Keychain items, so gh's keyring credential is reachable through the Keychain lookup only (every gh config-file step is blocked). The owner accepted this residual in the STATE.md [Owner] decision 'Keychain reachability (WINDOWS.md #1) accepted and documented; doctor gets an explicit recorded exception for the gh credentials row', WINDOWS.md #1 is waived citing it, and the owner recorded it on their own machine with `counterpoint accept-risk gh-keychain` (2026-11-10). Doctor prints the accepted risk on every run and applies it only when the Keychain lookup is the only reached gh step; the verdict reads 'Agents are boxed in, with one accepted risk', never a plain pass."
    accepted_by: "owner (built from the STATE.md [Owner] Keychain decision and the owner's recorded `counterpoint accept-risk gh-keychain`; explicitly confirmed by the owner in the STATE.md [Owner] decision 'FOUND-01 start command (2026-11-10)', commit 44e4372)"
    accepted_at: "2026-11-10T00:00:00Z"
  - must_have: "01-16: the tarball installs globally under the npm prefix on /Volumes/Dock, so `npx @hkp/counterpoint` resolves locally with no publishing; in the demo the owner's own `npx @hkp/counterpoint` inside Cena registers host cena"
    reason: "npm 12's npx does not resolve a globally installed, unpublished scoped package (E404 outside the Counterpoint repo). The owner chose the installed `counterpoint` command (global install from the local tarball) as the one-command start until the public release (PLAT-V2-02), when `npx @hkp/counterpoint` works with no change. FOUND-01 and ROADMAP SC1 are reworded to match, and the 01-16 SUMMARY's npx claims are corrected (commit 44e4372). This plan-level truth keeps the old wording; it is carried by this override."
    accepted_by: "owner (STATE.md [Owner] decision 'FOUND-01 start command (2026-11-10)', commit 44e4372)"
    accepted_at: "2026-11-10T00:00:00Z"
re_verification:
  previous_status: gaps_found
  previous_score: 5/6
  gaps_closed:
    - "Owner starts Counterpoint in the Cena repo with one command and opens the Astryx console (FOUND-01 / SC1): closed by the owner's decision rewording FOUND-01 and SC1 to the installed `counterpoint` command, which started Counterpoint in Cena for the whole demo"
  gaps_remaining: []
  regressions: []
---

# Phase 1: Trusted Shell & Signed Runway Verification Report

**Phase Goal:** The owner can run Counterpoint against Cena, see proof that agents are boxed in, browse Cena's GSD phases, and sign phases into a runway that recomputes itself from git
**Verified:** 2026-11-10T20:45:00Z
**Status:** passed
**Re-verification:** Yes. The first pass the same day found one gap (`npx @hkp/counterpoint` returns E404). The owner then decided it (commit 44e4372), and this pass re-checks against the reworded requirement.

**Code review:** pending. A separate reviewer is writing 01-REVIEW.md; this verification does not include its findings.

**MVP-mode note (warning):** ROADMAP marks Phase 1 `**Mode:** mvp`, but the goal is not written as a user story (`gsd-tools query user-story.validate` returns `valid: false`: it lacks "As a ..., I want to ..., so that ..."). The agent contract says to refuse MVP-mode verification in that case. The orchestrator explicitly asked for verification against the stated goal, so this report checks the goal and the five ROADMAP success criteria, with a user-flow table derived from the goal's four clauses. To make future runs clean, either reformat the goal with `/gsd-mvp-phase 01` or drop the `mvp` mode for this phase.

## User Flow Coverage

Derived from the goal: "run Counterpoint against Cena -> see proof agents are boxed in -> browse Cena's GSD phases -> sign phases into a runway that recomputes itself from git".

| Step | Expected | Evidence | Status |
|------|----------|----------|--------|
| Run Counterpoint against Cena | One command (`counterpoint`, installed from the local tarball) in Cena starts the daemon and opens the console at a loopback URL | Installed bin at /Volumes/Dock/Dev/nvm/versions/node/v24.21.0/bin/counterpoint, `counterpoint --version` = 0.1.0 (re-run by the verifier). The owner started Counterpoint with it in Cena and opened the console with a sign-in link (runway 0) | VERIFIED |
| See proof agents are boxed in | `counterpoint doctor cena` shows the tools, key and probe rows; the Trust page shows the verdict | Owner's doctor output: every tool and key row PASS, Agent permission mode PASS (auto), Sandbox isolation settings PASS, 8 probe rows BLOCKED, gh REACHABLE through the Keychain only with the accepted risk, exit 0 | VERIFIED (1 override) |
| Browse Cena's GSD phases | Phases list with status, plans and prerequisites | Owner saw 01 and 01.1 Built, 02 Ready to approve, 03-08 Not planned | VERIFIED |
| Sign a phase into the runway | Signed commit adding only the approval file; runway +1 | Cena 94708af adds only `.counterpoint/approvals/phase-02.json`, signed by SHA256:yQNt...z6U, one parent | VERIFIED |
| Runway recomputes from git | Drift drops the item into Needs You; re-sign restores it | Cena bb2237f (edit to 02-CONTEXT.md) gave `runway 0 needs you 1`; the 6bddb6a re-sign gave `runway 1 needs you 0`; e2e needs-you suite green | VERIFIED |

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP success criteria are the contract) | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1a / FOUND-01 (reworded 44e4372): Owner runs `counterpoint` (installed from the local tarball; `npx @hkp/counterpoint` once published, PLAT-V2-02) in the Cena repo and opens the console | VERIFIED | Global install from the tarball under the Dock prefix; `counterpoint --version` prints 0.1.0. The owner's demo started Counterpoint in Cena with this command, signed in through the one-time link and used the console throughout. `npx @hkp/counterpoint` still returns E404 outside the repo, which the reworded requirement assigns to PLAT-V2-02 |
| 2 | SC1b / FOUND-02 / FOUND-06: Astryx console in light and dark at a loopback-only URL; unexpected Host or Origin, cross-site posts and privileged calls without the owner credential are rejected | VERIFIED | `serve({ hostname: '127.0.0.1' })` in src/server/daemon.ts:184. The exact Host is checked at the socket (`hostCheckedServer`) and again in middleware. Writes need the exact Origin, same-origin Sec-Fetch-Site and a JSON body, and every /api call needs a session (src/core/security/guard.ts). tests/server/guard.test.ts, login.test.ts and sse.test.ts pass. Astryx `<Theme theme={neutralTheme} mode>` (ui/src/main.tsx:32), with the external `/theme-init.js` allowed by the CSP. The owner confirmed the theme persists across reload, and both guard curls returned 403 |
| 3 | SC2 / FOUND-03 / FOUND-04: `counterpoint doctor` reports claude/git/gh, the signing key (passphrase, not in ssh-agent or Keychain) and a live probe showing an agent cannot read the signing key, ~/.ssh, gh credentials or Counterpoint state, and cannot write .git/config, hooks or info | PASSED (override) | Code: nine `PROBE_TARGET_IDS` (src/core/security/doctor-report.ts:41). The one launch profile has Read+Edit deny twins, denyRead/denyWrite, `allowWrite: []`, `blockWritesOutsideWorkingDirectories` and `autoAllowBashIfSandboxed: false` (src/core/security/sandbox-settings.ts). The agent environment is an allow-list (src/core/security/agent-env.ts), and the evaluator counts only deterministic refusals (MATCHER_REVISION 4). Live: the owner's doctor run on claude 2.1.322 shows every row PASS or BLOCKED except gh, which is REACHABLE through the Keychain lookup only. Override: that residual is the owner's recorded accepted risk, now explicitly confirmed (see frontmatter) |
| 4 | SC3 / ADPT-01 / ADPT-02: Console lists Cena's phases with status, plans and prerequisites parsed natively from `.planning/` through the GSD adapter; a lint rule fails the build if core imports the adapter | VERIFIED | biome.json overrides (`core must not import adapters`, `only src/compose.ts may import the GSD adapter`). tests/boundary/boundary.test.ts lints scratch projects with the real biome.json and passes. `pnpm build` = `pnpm lint && ...`, and `pnpm lint` is clean (139 files). No `adapters` import exists under src/core. The owner saw Cena's phase list with the correct statuses |
| 5 | SC4 / APPR-01 / APPR-04 / MISN-01: Approve shows a one-line command; passphrase; signed commit on master adding only the approval file; uncommitted work untouched; verified with `ssh-keygen -Y` against a key outside the repo; runway +1; refused if .git/config or hooks changed | VERIFIED | Cena 94708af: one parent, one file `.counterpoint/approvals/phase-02.json` (113 lines), signed by the trusted fingerprint. The owner saw runway go from 0 to 1. Signing calls `/usr/bin/ssh-keygen -Y sign/verify` with a fixed env (src/core/approvals/ssh.ts). The integrity refusal is in src/cli/approve.ts:238-246. tests/cli/approve.test.ts covers the refusals for a missing trusted key, a missing baseline, changed integrity, no TTY, an occupied approval path, a moved base and a bad signature. tests/e2e/approve.e2e.test.ts passes (run by the verifier) |
| 6 | SC5 / APPR-02 / MISN-02 (Phase 1 part): If the approved phase's spec or gate config changes after signing, the item leaves the runway and shows in Needs You as "approved version changed" | VERIFIED | The runway is recomputed from git on every read and never stored (src/core/runway/runway.ts). Live on Cena: the bb2237f edit gave `runway 0 needs you 1` with the diff, and the 6bddb6a re-sign gave `runway 1 needs you 0`. tests/e2e/needs-you.e2e.test.ts (run by the verifier, green) covers the visible `Approved version changed` label, a gates-only change as its own `Gate config` row, a revert with no re-sign, and the soft hint for uncommitted edits |

**Score:** 6/6 truths verified (1 through an override; 0 present but behavior-unverified)

I checked the plan-level must_haves of the 24 active plans as supporting detail.
- `verify.artifacts` passes on every active plan except one deliberate removal (see Required Artifacts).
- `verify.key-links` fails on 01-16, 01-17, 01-19, 01-20 and 01-22 to 01-26. These are format failures: the `from` field names a symbol, not a bare path. I checked each of those links by grep, and each is wired. Examples: `runSandboxProbe` in src/doctor/run.ts, `evaluateProbe` and `buildControlSettings` in src/agent/probe.ts, `agentEnv` in src/agent/runner.ts, `judgeAgentMode` / `judgeSandboxIsolation` / `readSettingsSources` in src/doctor/run.ts, `reportVerdict` in src/server/routes/trust.ts, `trustVerdict` in ui/src/pages/TrustPage.tsx.
- 01-16's first and third truths still name `npx @hkp/counterpoint`. They are carried by the second override.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | ----------- | ------ | ------- |
| src/server/daemon.ts, src/server/app.ts | Loopback daemon serving dist/ui | VERIFIED | Binds 127.0.0.1; serves `dist/ui` |
| src/core/security/guard.ts, login.ts | Host/Origin/CSRF/session guard, one-time sign-in | VERIFIED | Wired into the app.ts guard chain |
| src/core/security/sandbox-settings.ts, agent-env.ts, sandbox-isolation.ts | One launch profile, env allow-list, settings-source check | VERIFIED | Used by src/agent/probe.ts and src/doctor/run.ts |
| src/agent/probe.ts, probe-evaluator.ts, env-listing.ts | Differential live probe, nine rows | VERIFIED | Frozen live fixtures under tests/fixtures/stream-json/ |
| src/doctor/*.ts, src/cli/doctor.ts, src/cli/risk.ts | doctor, accept-risk/revoke-risk | VERIFIED | Commands registered in src/cli/main.ts |
| src/adapters/gsd/*, src/core/framework/port.ts, src/compose.ts | GSD adapter behind a core port | VERIFIED | Only compose.ts imports the adapter |
| src/core/approvals/*, src/cli/approve.ts | Statement, plumbing commit, ssh-keygen sign/verify, integrity | VERIFIED | Real Cena commits verified |
| src/core/runway/*, src/server/routes/*, src/server/watcher.ts | Runway, status, Needs You, base-tip watcher | VERIFIED | e2e green |
| ui/src/pages/* | Mission, Phases, Phase detail, Needs You, Change view, Trust, Signed out | VERIFIED | The owner viewed them on Cena |
| package.json bin + dist/cli.mjs (01-16) | Global install reachable as the one start command | VERIFIED | Reachable as `counterpoint` (the reworded FOUND-01); npx deferred to PLAT-V2-02 by the owner |
| src/agent/probe-evaluator.ts export `isUnlistedPathDenial` (01-17 artifact) | 01-17's scoped mode-denial acceptance | Removed on purpose | 01-24's truth requires deleting 01-17's scoped mode-denial acceptance (MATCHER_REVISION 3). Not a gap |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| `counterpoint` (in Cena) | global dist/cli.mjs | npm global bin | WIRED | Used for the whole owner demo |
| src/core/** | src/adapters/** | Biome noRestrictedImports | WIRED (blocked as intended) | The boundary test passes with the real biome.json |
| src/doctor/run.ts | src/agent/probe.ts -> probe-evaluator.ts | runSandboxProbe -> evaluateProbe | WIRED | Confirmed by grep |
| src/agent/runner.ts | src/core/security/agent-env.ts | agentEnv | WIRED | Scrub set to `0`, allow-list only |
| src/server/watcher.ts | runway / Needs You | SSE `phase`/`approval`/`runway` events | WIRED | Drift appeared in the console within seconds on Cena; e2e green |
| src/server/routes/trust.ts | ui/src/pages/TrustPage.tsx | reportVerdict -> trustVerdict | WIRED | The owner saw the Trust page rows |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| Mission runway card | runway count | Recomputed from git at the base tip (src/core/runway/runway.ts) | Yes: 0 -> 1 -> 0 -> 1 on real Cena commits | FLOWING |
| Phases page | phase list | GSD adapter over committed `.planning/` through GitFileReader | Yes: Cena phases 01 to 08 | FLOWING |
| Needs You | changed approvals + diff | Runway changes + `git diff --no-index` | Yes: the bb2237f drift showed with its diff | FLOWING |
| Trust page | doctor verdict | Stored doctor.json + live accepted-risk record | Yes: the owner's run rendered | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Unit suite (run once) | `pnpm test` | 33 files passed, 4 skipped (env-gated live probes); 1093 tests passed, 5 skipped | PASS |
| Lint + typecheck | `pnpm lint`, `pnpm typecheck` | Clean | PASS |
| Approve + drift end to end (scratch homes, port 0) | `vitest run --project e2e tests/e2e/needs-you.e2e.test.ts tests/e2e/approve.e2e.test.ts` | 2 files, 20 tests passed | PASS |
| Installed start command | `counterpoint --version` | `0.1.0` | PASS |
| npx outside the repo (informational, PLAT-V2-02) | `npx --no @hkp/counterpoint -- --version` (cwd: scratch dir) | `npm error 404 ... '@hkp/counterpoint@*' could not be found` | Expected until the public release |
| Cena approval commits | `git -C Cena log --format='%h %G? %GF'` / `show --stat` | 94708af and 6bddb6a each change only `.counterpoint/approvals/phase-02.json` and are signed SHA256:yQNt...z6U; bb2237f is the unsigned drift edit | PASS |

I did not rerun the live probe tests (`COUNTERPOINT_LIVE_PROBE=1`) because they spawn real `claude` sessions. The live proof is the owner's own doctor run on 2026-11-10, plus the refrozen 01-23 fixtures that the evaluator tests replay.

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes exist, and no plan declares one, so Step 7c does not apply. The "sandbox probe" in this phase is a product feature. It is verified above through the owner's doctor run and the fixture-replay tests.

### Requirements Coverage

Every ID in the phase list appears in the `requirements` field of at least one active plan. REQUIREMENTS.md maps no other ID to Phase 1, so there are no orphans.

| Requirement | Source Plan(s) | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| FOUND-01 | 01-01, 01-02, 01-03, 01-16 | One command (`counterpoint`, installed from the local tarball; npx with PLAT-V2-02) starts Counterpoint and opens a loopback console | SATISFIED | Installed bin used for the owner's demo in Cena |
| FOUND-02 | 01-03, 01-09 | Host/Origin allowlist, CSRF, SSE origin check, owner credential for privileged actions | SATISFIED | guard.ts, login.ts, control-socket token; tests; owner's curls returned 403 |
| FOUND-03 | 01-04, 01-05, 01-10, 01-11, 01-16, 01-17, 01-19, 01-20, 01-22 to 01-26 | `counterpoint doctor` pass/fail for tools, key and live sandbox | SATISFIED | Owner's doctor run, exit 0 |
| FOUND-04 | 01-04, 01-05, 01-10, 01-17, 01-19, 01-20, 01-22 to 01-26 | Agents cannot read the key, ~/.ssh, gh creds or state, and cannot write .git/config, hooks or info | SATISFIED (override) | Every row Blocked except gh through the Keychain, an owner-accepted risk |
| FOUND-06 | 01-09, 01-11 | Astryx console, light and dark | SATISFIED | Astryx Theme + theme-init.js; owner confirmed |
| ADPT-01 | 01-06, 01-07, 01-11 | GSD phases with status, plans and prerequisites | SATISFIED | Owner saw Cena's list; parse and status tests |
| ADPT-02 | 01-06, 01-07 | Core reaches the framework only through an adapter; import rules enforce it | SATISFIED | biome.json overrides + boundary test; build runs lint |
| APPR-01 | 01-08, 01-12, 01-13, 01-16 | Console prepares the approval and shows a one-line command; signed commit adds only the approval file | SATISFIED | Cena 94708af, 6bddb6a |
| APPR-02 | 01-12, 01-13, 01-14, 01-15 | Approval binds the spec, the draft slot and the gate config; a change takes the item off the runway and into Needs You | SATISFIED | Cena drift demo; e2e gate-config case |
| APPR-04 | 01-08, 01-10, 01-12 | `ssh-keygen -Y` with a clean env and a key outside the repo; refused on an integrity change | SATISFIED | ssh.ts, integrity.ts, approve.ts, approve tests |
| MISN-01 | 01-12, 01-13, 01-15 | Runway is the headline metric | SATISFIED | Mission runway card; owner saw 0 -> 1 |
| MISN-02 | 01-14, 01-15 | Needs You inbox (Phase 1 part: approved items whose content changed) | SATISFIED (Phase 1 scope) | Needs You + change view; REQUIREMENTS.md maps the other item kinds to Phases 2, 3, 5 and 6 |

### Decision Coverage

All trackable CONTEXT.md decisions are honored by shipped artifacts (8/8, `check.decision-coverage-verify`).

### Test Quality Audit

| Test File | Linked Req | Active | Skipped | Circular | Assertion Level | Verdict |
|-----------|-----------|--------|---------|----------|-----------------|---------|
| tests/server/guard.test.ts | FOUND-02 | yes | 1 (LAN-interface case, skipped when the machine has no LAN address) | no | Value (status codes + bodies) | OK |
| tests/boundary/boundary.test.ts | ADPT-02 | yes | 0 | no | Behavioral (lints scratch projects with the real biome.json) | OK |
| tests/agent/probe-evaluator.test.ts | FOUND-03/04 | yes | 0 | no: fixtures are recorded live claude streams (an external source) | Value | OK |
| tests/agent/*.live.test.ts, tests/doctor/doctor.live.test.ts | FOUND-03/04 | env-gated | skipped without COUNTERPOINT_LIVE_PROBE=1 | no | Behavioral | OK: not the only proof; fixture replay and the owner's live doctor run cover these |
| tests/cli/approve.test.ts, tests/core/approvals/*.test.ts | APPR-01/04 | yes | 0 | no | Behavioral | OK |
| tests/e2e/approve.e2e.test.ts, needs-you.e2e.test.ts | APPR-01/02, MISN-01/02 | yes | 0 | no | Behavioral | OK (20/20, run by the verifier) |

**Disabled tests on requirements:** 0 blocking. **Circular patterns detected:** 0. **Insufficient assertions:** 0.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| src/adapters/gsd/normalize.ts | 4 | `TBD` | Info | Describes ROADMAP content (the `**Plans**:` line moving from TBD), not a debt marker |
| .planning/phases/01-trusted-shell-signed-runway/01-16-PLAN.md | 98, 103 | Verify command with no pinned cwd | Info | `npx --no @hkp/counterpoint --version` passes falsely when run from the repo root. Moot now that FOUND-01 names the installed bin; future plans should run install checks from a directory outside the repo |

There are no TODO, FIXME, XXX, HACK or placeholder markers in src/, ui/src/ or scripts/. The false npx claim in the 01-16 SUMMARY that the first pass flagged is fixed by its Correction section (44e4372).

### Human Verification Required

None outstanding.
- The owner ran the 01-16 end-of-phase `<human-check>` demo on 2026-11-10 against Cena. It covered: start and sign-in, theme persistence, `counterpoint trust cena`, `counterpoint doctor cena`, phase browsing, approval 94708af, the drift edit bb2237f -> Needs You -> the re-sign 6bddb6a, and the guard curls returning 403.
- The owner directly looked at the screenshots for the 01-15 `verification: backstop` truths (held-out overflow and long-text visual tests) and said they "looked right". That meets the backstop evidence rule.

### Warnings (not blocking)

- **MVP user-story format:** see the note at the top. The goal is not written as a user story, although Phase 1 is in mvp mode.
- **Key-link noise:** the `verify.key-links` failures listed above come from the `from` fields naming symbols. I checked every one by hand and each is wired.
- **claude 2.1.322:** the owner runs one patch past the probe matcher's `MATCHER_CLAUDE_VERSION` 2.1.321. The doctor run was clean because the version-distrust rule only acts on an unrecognised message. If a future Claude Code changes its messages, rows will read `Not checked`, never a false Blocked.
- **Accepted-risk reason text:** the gh-keychain risk on the owner's machine is recorded with the reason "just because". The override relies on the substantive STATE.md [Owner] decision. The owner may want to record a descriptive reason (`counterpoint revoke-risk gh-keychain`, then `accept-risk` again).

### Gaps Summary

No open gaps. The first pass found one gap: `npx @hkp/counterpoint` returns E404 outside the Counterpoint repo on npm 12. The owner closed it by decision (STATE.md [Owner] "FOUND-01 start command (2026-11-10)", commit 44e4372). FOUND-01 and ROADMAP SC1 now name the installed `counterpoint` command, and the npx form comes with PLAT-V2-02. The installed command verifiably started Counterpoint in Cena for the whole demo. The two overrides cover the gh Keychain residual and 01-16's old npx wording. The owner has explicitly confirmed both.

---

_Verified: 2026-11-10T20:45:00Z_
_Verifier: Claude (gsd-verifier)_

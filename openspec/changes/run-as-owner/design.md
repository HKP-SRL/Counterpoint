# Design

## Context

See proposal.md for the why. What the code looks like today:

- About 8,850 of 24,650 source lines are the trust layer: the sandbox profile and environment allow-list (`src/core/security`), signed approvals (`src/core/approvals`), doctor and its live probe (`src/doctor`, `src/agent/probe*`), and the gate sandbox, protected paths and doctor gate in `src/build`. In the console, the Trust page, the drift view and the approval dialog are 1,755 of 5,075 lines.
- The build lane itself works. On Cena, builder sessions took 24 to 49 minutes per change and a full gate round about one minute. Time goes into sessions, not gates, so the test policy matters more today than gate tiers. Tiers pay off as a suite grows: the CV repo's full run went from 11 to 75 minutes in three days.
- The CV repo's unattended loop is the working model: `claude -p --permission-mode auto --permission-prompts none`, the owner's environment, no sandbox, approval as one line of text.

## Goals / Non-Goals

**Goals:**
- A run on Cena goes from one-click approval to a green pull request with no terminal step and no stop on a machine problem.
- The code gets smaller: the trust layer is deleted, not switched off.
- Gate time and test volume are things the owner can see and steer.

**Non-Goals:**
- Answering questions from the console as cards. That is `owner-inbox`; here a question parks its change and shows in Needs You.
- Redesigning the console pages. This change only removes Trust, the drift view and the approval dialog.
- A scheduled full run on the base branch, parallel builds, merging from the console.
- Changing the console's loopback bind, Host and Origin checks, or sign-in. They guard against web pages, not agents, and they cost the owner nothing.

## Decisions

**D-1. No sandbox, and no replacement wall.**
Sessions launch as `claude -p` in auto mode with prompts denied, in the change's worktree, loading user and project settings, with no settings profile from Counterpoint. Gates run as plain child processes in their own process group.
*Alternatives:* keep the sandbox behind an off-by-default switch (two paths to keep working, and only one would ever run); keep deny rules for the Counterpoint home (with the signing key gone, nothing there is worth a wall).

**D-2. One environment per run, from the owner's login shell.**
At run start Counterpoint runs `$SHELL -l -i -c 'env -0'` from `$HOME` with stdin closed, no TTY, `TERM=dumb` and a 10-second limit, and uses the result for every session, gate and service of that run. Only `COUNTERPOINT_*` variables are left out, to avoid confusing a nested command. A timeout falls back to the daemon's environment and adds a Needs You item. Interactive mode is needed because the owner's PATH lives in `~/.zshrc`.
*Alternatives:* a longer allow-list (the list has already been wrong three times); asking for a restart (failed twice on 2026-11-11).

**D-3. Sessions do not get the owner's MCP servers.**
`--strict-mcp-config` stays. The owner's account has many connectors; loading them would add their tool lists to every session's context and could hang a headless start on a sign-in.
*Alternative:* load everything, as "act as the owner" suggests. Deferred until a build needs one; then the host config lists it.

**D-4. Approvals live in Counterpoint's store.**
One row per host and change: the time and the base commit it was given at. The runway is the approved changes that are readable and not built.
*Alternatives:* a plain commit that adds an approval file to the base branch (every click becomes a write to the host repository, which can fail or conflict); a status line in the change's own files (framework-specific, and also a write).
*Carry-over:* a store migration reads `.counterpoint/approvals/*.json` at each host's base tip once and records open changes as approved. Signatures are not checked. The files stay in the repository and are ignored afterwards.

**D-5. A build starts from the base-branch tip.**
The branch point and the host config are read at the tip when the change's build starts, and recorded on the run. The config is still never read from the worktree, so a builder cannot change how its own change is judged by editing it.

**D-6. What is deleted, and what stays.**
- Deleted: `src/core/security` (except the console's request guard and sign-in), `src/core/approvals`, `src/doctor`, `src/agent/probe*.ts`, `src/agent/env-listing.ts`, `src/build/gate-sandbox.ts`, `protected-paths.ts`, `doctor-gate.ts`, their tests, and the `@anthropic-ai/sandbox-runtime` dependency.
- CLI commands removed: `doctor`, `accept-risk`, `revoke-risk`, `init-key`, `trust-key`, `trust`, `approve`.
- Console: `TrustPage`, `DriftViewPage`, `ApprovalDialog` and the approved-version-changed items.
- Stays: worktrees and `worktree.clone` (still the fastest way to get `node_modules`), commits made by Counterpoint, pull-request delivery, exit-code gates in process groups, service handling, the test lock, the zero-test guard, the governor's usage-limit pauses, crash recovery.
- Host config: the gate `ports` key and the top-level `protected` key stay accepted and are ignored, so Cena's committed config keeps loading.
- Home folder: `trust/` and each host's `doctor.json` and `integrity.json` are left on disk and no longer read.

**D-7. Ask-first is a short built-in list.**
The builder prompt names four classes: spending money, deleting or changing data that is not local, changing a production system or a live credential, publishing publicly. Everything else is decide-and-log, in the existing `.cp-assumptions.md`. A question goes in the existing `.cp-blocked.md` with the task, 2 to 4 options and a recommended one; the orchestrator already parks on that file.
*Alternative:* let the builder judge what is worth asking (that is how it came to ask about a package install).

**D-8. Two gate tiers, set per gate.**
`when: every | final`, default `every`. An attempt runs the `every` gates in config order, then the `final` gates if all passed. Any failure ends the attempt and goes back to the builder. Green means every gate passed on the same commit.
*Alternative:* a third `nightly` tier with a scheduled run on the base branch. Not now: Cena's full suite takes 40 seconds, and the tier would need a scheduler. It goes to the backlog.

**D-9. `{changed}` is expanded by Counterpoint, and the command stays the host's.**
The list is `git diff --name-only --diff-filter=AM <base> HEAD` in the worktree, narrowed by the gate's optional `paths` patterns. An empty list skips the gate with its own stored state, shown as skipped. Counterpoint still knows no test tool.

**D-10. The test budget is measured and never enforced.**
Share = added lines in test files ÷ added lines, leaving out lock files and planning files. Test files are found by the path conventions the protected-path check already used. Config: `tests.budget`, a percentage, default 30. The builder is told the policy and the budget. The share goes in the pull request body and, when over budget, on the change's row.
*Alternative:* fail a gate when over budget. Rejected: the retry would spend a session deleting tests, which costs more than the tests did.

**D-11. The roadmap after this change.**

| Order | Change | What the owner gets |
|---|---|---|
| 1 | `run-as-owner` | Runs that do not stop on walls, one-click approval, fast gates |
| 2 | `owner-inbox` (trimmed) | Questions as cards, one at a time, Enter accepts the recommended answer, a notification |
| 3 | `quiet-console` (new) | A one-line home, merge in one click, far less text |
| 4 | `one-screen-plans` (new) | A one-screen brief per change; large changes are split |
| 5 | `design-drafts` (was `design-drafts-visual-gate`) | 2–3 variants with real data, pinned comments, sign-off, a design-rules file per host |
| 6 | `pr-revisions` | Send a pull request back with pinned notes |
| 7 | `council-lite` (replaces both council changes) | The top three findings at plan time and after the build |

Dropped: `passkey-approvals`, `morning-review-signed-merge`, `council-meetings-backlog`. To the backlog: the visual gate, the scheduled full run, parallel builds with rebase, the owner's MCP servers in sessions.

## Risks / Trade-offs

- **An unattended session has the owner's full rights.** It could edit files outside its worktree, use the owner's `gh` login to push or merge, or act on text it read on the web. → Auto mode's classifier still reviews each action; sessions start in the worktree and are told to stay there; work reaches the base branch only through a pull request the owner merges. This is the risk the owner accepts in daily Claude Code use. Branch protection on GitHub is a one-time option if the owner wants a hard stop on the base branch.
- **An agent can reach the console.** With no sandbox, a session can read the control token and could approve a change or start a run. → Accepted for the same reason. Nothing an approval unlocks goes further than a pull request.
- **Fewer tests let a regression through.** → The full suite still runs before every pull request. The policy keeps tests where a bug is expensive. The budget is advice, and the plan can always ask for a test.
- **The test share is a crude measure.** → It is one number meant to show a trend, never a verdict.
- **Reading the login shell can hang or print noise.** → A 10-second limit, a fallback to the daemon's environment, and stderr ignored.
- **Two builds of the same change may branch from different commits.** → The base commit is recorded per build and shown in the run report.

## Migration Plan

1. Archive `first-unattended-run`, so the main specs hold `build-runs`, `gates`, `pull-requests`, `run-report` and `planning-writes`. Its two open owner steps are overtaken: Cena's config is committed, and the owner started runs from the console on 2026-11-11.
2. Build in the order of tasks.md: run as owner, approvals, removal, never-stop rules, gates, test budget.
3. Update Cena's two config files through a pull request, reinstall, restart, and run one change end to end.
4. Rollback is a git revert and a reinstall of the previous package. The store migration only adds a table; the old approval files stay in Cena's history.

## Open Questions

- Whether 30% is the right default budget. Cena's Astryx change measured 44%. One or two runs under the new policy will show; changing it is one line in the host config.

# Run as Owner

## Why

Counterpoint spent its first slices protecting the owner from its own agents, and that protection is what stops the runs. On 2026-11-11, 4 of 7 runs on Cena died on Counterpoint's own walls: a stripped environment, a stale PATH, a sandbox that cannot reach Supabase or install a package. The 3 that got through went green in 24 to 49 minutes. No run stopped on a real product question.

The owner already runs Claude Code in auto mode all day, and the CV repo's unattended runs worked that way with no sandbox. The owner's direction (2026-11-12): drop the sandbox, stop interrupting, and stop spending build time on tests nobody needs.

## What Changes

- **BREAKING: sessions run as the owner.** Builder sessions are plain headless Claude Code sessions in auto mode, in the change's worktree, with the owner's environment, tools and network. They can install a package and start the local database. Gates run as ordinary commands.
- **BREAKING: approving is one click.** Approve, Approve all and Withdraw in the console. No key, no passphrase, no terminal. An approval stays with the change when its plan is revised.
- **BREAKING: the trust layer is removed.** Doctor and its live probe, the Trust page, the signing key and key pinning, the integrity baseline, accepted risks, signed statements, the "approved version changed" review, protected-path flags and the gate sandbox all go. That is about a third of the source.
- **A run never stops for something it can do itself.**
  - The builder decides open questions, logs each as assumed, and keeps going.
  - It asks first only before something that cannot be undone outside its worktree: spending money, changing data that is not local, touching production or live credentials, publishing publicly. Then only that task waits; the rest is built and the queue goes on.
  - A run ends only when its queue is done, the owner stops it, or no session can run at all.
- **Fast gates.** A gate runs on every attempt or once as a final gate. A gate can take only the changed files. On Cena: types, lint and related tests on every attempt; build and the full suite once before the pull request.
- **Test policy and budget.** Builders write tests only where the plan asks or where a bug would cost money, data or access. Each change shows what share of it is tests; over budget is marked, never failed. Cena's Astryx change was 44% tests.
- **The roadmap is replaced.** After this change: answer cards, a quiet console, one-screen plans, design drafts, PR revisions, council lite. `passkey-approvals`, `morning-review-signed-merge` and `council-meetings-backlog` are dropped. The order and what each gives the owner are in design.md.

What stays: one worktree and branch per change, never the owner's checkout; one pull request per change, merged only by the owner; gates judged by exit code; the console on loopback with its sign-in.

## Capabilities

### New Capabilities
- `owner-identity`: Counterpoint acts as the owner. Sessions, gates and services run with the owner's permissions, login environment, tools and network; commits carry the owner's identity. Taken over from the `owner-inbox` draft, without its secrets wall.
- `approvals`: one-click approval and withdrawal in the console, and what an approval means.

### Modified Capabilities
- `agent-sandbox`: removed entirely.
- `doctor`: removed entirely.
- `key-trust`: removed entirely.
- `signed-approvals`: removed entirely; replaced by `approvals`.
- `runway`: the runway is the approved changes not yet built; nothing is verified from signatures.
- `needs-you`: the approved-version-changed items and their review view go; a builder's ask-first question appears with its options.
- `host-planning`: no Changed since signed status; the change detail loses the covered files and digests.
- `local-console`: the Trust page leaves the navigation.
- `build-runs`: no doctor gate; builds start from the base-branch tip; builders install, use the network and start services; decide-and-log and ask-first rules; the reasons a run may end.
- `gates`: no protected-path check; every-attempt and final gates; the changed-files placeholder; the test policy and budget.
- `pull-requests`: the body also shows the test share and the existing tests the change edited or deleted.

## Impact

- **Removed code:** `src/core/security` (sandbox profile, environment allow-list, accepted risks), `src/core/approvals`, `src/doctor`, the probe in `src/agent`, the gate sandbox, protected paths and the doctor gate in `src/build`; the CLI commands `doctor`, `trust`, `trust-key`, `init-key`, `approve` and `accept-risk`; the Trust page, drift view and approval dialog. The `@anthropic-ai/sandbox-runtime` dependency goes.
- **Changed code:** the session launch arguments, the run's environment, the orchestrator's stop and park rules, the builder prompt, the gate round, the host config schema, the runway and change statuses, the PR body.
- **Security:** an unattended session has the owner's full rights, as the owner's own Claude Code sessions do. Nothing hard stops an agent from touching files outside its worktree, using the owner's `gh` login or reaching the console. This replaces the hard constraint in `openspec/config.yaml` and `.claude/CLAUDE.md` that agents are the threat model. See design.md, Risks.
- **Cena:** its `.counterpoint/config.yaml` gets gate tiers and loses the sandbox workarounds; its planning rule "every task says how it is verified" is reworded so it stops producing a test per task.
- **Other changes:** depends on `first-unattended-run`, which is archived first. `owner-inbox` loses its `owner-identity` and `agent-sandbox` parts and then depends on this change.

# Backlog

Work deliberately deferred past the first milestone (the eight changes from `trusted-shell-signed-runway` to `council-meetings-backlog`). When one of these is picked up, it becomes an OpenSpec change. Decisions and out-of-scope items are in `docs/decisions.md`.

## Deferred features

### Council
- **Live meeting watch.** The owner can watch a council meeting live.
- **Interjection.** The owner can add a note to a running meeting; it is picked up at the next turn.
- **Post-build persona review.**
  - Some seats drive the running app in character (headless browser, screenshots). Others review artifacts.
  - Findings are advisory cards with evidence, labelled as synthetic.
  - Use headless, isolated Playwright MCP, never Claude in Chrome.
- **PR review seat.** A tech and security seat reads every PR's diff and leaves advisory review notes (auth rules, data access, architecture drift). The owner does not read code, so gates plus previews are not enough on their own. Candidate to bring into v1. The owner can turn a review note into a revision note.

### Gates
- **Pixel-diff tier for the visual gate.** A tolerant, masked pixel diff (pixelmatch), enabled once a spike shows an acceptable false-positive rate. Until then, the structural landmark comparison decides.

### Build lane
- **Run trailer.** Agent commits carry a `Counterpoint-Run:` trailer linking to the run log.
- **Quick changes.** A small instruction ("rename this button", "bump this config") becomes a minimal change, signed and built in minutes, without a full proposal, design and tasks. It reuses the revision-round machinery from `pr-revisions` for work not tied to an open PR, including follow-ups after a merge.
- **Notifications.** A macOS notification when something lands in Needs You. More useful in daytime runs, when PRs and finished revision rounds arrive one at a time.
- **Open in editor.** Open a change's worktree in the owner's editor from the console.

### Design drafts
- **Version history.** Full draft version history with side-by-side compare.

### Mission view
- **Gamification panel.** Runway length trend, questions resolved, rounds to converge and more. v1 has only the runway and a few honest counters.

### Platform
- **Self-hosting: Counterpoint builds Counterpoint.** After `first-unattended-run`, register this repository as a second host.
  - Add `.counterpoint/config.yaml` with gates (`pnpm lint`, `pnpm typecheck`, `pnpm test`, maybe `pnpm build`) and protected paths for the trust code (`src/core/security`, `src/core/approvals`, `src/doctor`, `src/agent`).
  - Check that every test gate uses a scratch home and port, so it can run next to the live daemon and inside the builder's sandbox. Live tests that start real `claude` sessions stay out of the gates.
  - Run the daemon from an installed copy only (see the `first-unattended-run` design).
  - A rehearsal run on a change outside the protected paths is a good first use.
- **"No framework" adapter.** A plain markdown or YAML list. The adapter boundary is already in core; only the OpenSpec adapter ships.
- **Public npm release.** Publish as `@hkp/counterpoint`, so `npx @hkp/counterpoint` works. Re-check the Claude Code terms before publishing. Run `publint` and `@arethetypeswrong/cli` first.
- **Preview-deploy comments.** Ingest comments left on the host's preview deploys. They are not an owner channel, so each one becomes a revision note only after the owner confirms it.

## Open gaps

- **Seat conflicts in Needs You.** The inbox is meant to collect seat conflicts, but no change covers them yet. Assign them when the council meetings work is designed, or drop them.
- **Automatic meeting points.** The default set of lifecycle points where the council meets on its own (for example change kickoff, design review, post-build, conflict escalation) is still open. Settle it in `council-meetings-backlog`. The rule: meetings run alongside the work, never in front of it.
- **Council cost defaults.** Seats × rounds × cards adds up. Decide the default number of seats per question and the per-meeting and per-day caps.
- **Backlog location on OpenSpec hosts.** Decide where council backlog items are written (see `council-cards-decisions`).
- **Branch protection on Cena.** Verify the branch-protection recipe for Cena's `master` before the signed-merge work is planned, including whether it requires signed commits. A passkey-approved merge carries no git signature of its own.

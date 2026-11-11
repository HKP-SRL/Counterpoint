# Backlog

Work deliberately deferred past the first milestone (the six changes from `trusted-shell-signed-runway` to `council-meetings-backlog`). When one of these is picked up, it becomes an OpenSpec change. Decisions and out-of-scope items are in `docs/decisions.md`.

## Deferred features

### Council
- **Live meeting watch.** The owner can watch a council meeting live.
- **Interjection.** The owner can add a note to a running meeting; it is picked up at the next turn.
- **Post-build persona review.**
  - Some seats drive the running app in character (headless browser, screenshots). Others review artifacts.
  - Findings are advisory cards with evidence, labelled as synthetic.
  - Use headless, isolated Playwright MCP, never Claude in Chrome.

### Gates
- **Pixel-diff tier for the visual gate.** A tolerant, masked pixel diff (pixelmatch), enabled once a spike shows an acceptable false-positive rate. Until then, the structural landmark comparison decides.

### Build lane
- **Run trailer.** Agent commits carry a `Counterpoint-Run:` trailer linking to the run log.
- **Notifications.** A macOS notification when something lands in Needs You.
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
- **Touch ID or FIDO2 signing on click.** This would replace the prepared terminal command.
- **Preview-deploy comments.** Ingest comments left on the host's preview deploys.

## Open gaps

- **Seat conflicts in Needs You.** The inbox is meant to collect seat conflicts, but no change covers them yet. Assign them when the council meetings work is designed, or drop them.
- **Automatic meeting points.** The default set of lifecycle points where the council meets on its own (for example change kickoff, design review, post-build, conflict escalation) is still open. Settle it in `council-meetings-backlog`. The rule: meetings run alongside the work, never in front of it.
- **Council cost defaults.** Seats × rounds × cards adds up. Decide the default number of seats per question and the per-meeting and per-day caps.
- **Backlog location on OpenSpec hosts.** Decide where council backlog items are written (see `council-cards-decisions`).
- **Branch protection on Cena.** Verify the branch-protection recipe for Cena's `master` before the signed-merge work is planned.

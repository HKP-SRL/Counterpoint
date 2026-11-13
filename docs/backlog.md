# Backlog

Work deliberately deferred past the roadmap in `docs/decisions.md` (Direction, 2026-11-12). When one of these is picked up, it becomes an OpenSpec change. Decisions and out-of-scope items are in `docs/decisions.md`.

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
- **Visual gate** (moved out of `design-drafts` 2026-11-12). Built screens are compared with the signed-off render by landmark regions (`data-cp-id`); drift fails the gate with a side-by-side image. A tolerant, masked pixel diff (pixelmatch) could follow once a spike shows an acceptable false-positive rate.
- **Scheduled full run** (2026-11-12). A third gate tier, run on a schedule against the base branch, for suites too slow for every pull request. Not needed while Cena's full suite takes about 40 seconds.

### Build lane
- **Parallel builds with rebase** (from the dropped `morning-review-signed-merge`). Several changes build at once, each worktree with its own ports and database. When the base branch moves and conflicts, the builder rebases, re-runs every gate, and parks the change if it cannot.
- **The owner's MCP servers in sessions** (2026-11-12). Sessions run with `--strict-mcp-config` and none of the owner's connectors, to keep context small and avoid a headless start hanging on a sign-in. When a build needs one, the host config lists it.
- **Quick changes.** A small instruction ("rename this button", "bump this config") becomes a minimal change, approved and built in minutes, without a full proposal, design and tasks. It reuses the revision-round machinery from `pr-revisions` for work not tied to an open PR, including follow-ups after a merge.
- **Notifications for news.** Blocking cards already notify (`owner-inbox`). Also notify when a PR is ready or a revision round lands, which matters most in daytime runs.
- **Open in editor.** Open a change's worktree in the owner's editor from the console.
- **A button for an out-of-date branch** (2026-11-13). When the base moves past an existing `cp/` branch, the change parks and fixing it takes a terminal step (merge the base in, or delete the branch). Needs You should offer both, or Counterpoint should merge the base in itself.
- **No rebuild over an open green PR** (2026-11-13). A change whose PR is open and green still shows on the runway as ready, and one click rebuilds it. It stays there until the PR merges and its tasks are ticked on the base branch.
- **Archive a change once every task is ticked on the base** (2026-11-13, `build-ticks-and-owner-steps`). A built change stays Built and unarchived after its last task, owner steps included, is ticked; its owner-step cards are gone by then. Archive it (merge its spec deltas) as a small planning write.
- **Context budget overshoot** (2026-11-13). A builder session handed off at 459k tokens against a 400k budget (40% of 1M). The wrap-up turn comes too late; check when usage is read and how much a single turn can add.

### Design drafts
- **Version history.** Full draft version history with side-by-side compare.

### Mission view
- **Gamification panel.** Runway length trend, questions resolved, rounds to converge and more. v1 has only the runway and a few honest counters.

### Platform
- **"No framework" adapter.** A plain markdown or YAML list. The adapter boundary is already in core; only the OpenSpec adapter ships.
- **Public npm release.** Publish as `@hkp/counterpoint`, so `npx @hkp/counterpoint` works. Re-check the Claude Code terms before publishing. Run `publint` and `@arethetypeswrong/cli` first.
- **Preview-deploy comments.** Ingest comments left on the host's preview deploys. They are not an owner channel, so each one becomes a revision note only after the owner confirms it.

## Open gaps

- **Council meetings** (dropped with `council-meetings-backlog`, 2026-11-12). Structured debate between seats, threads, minutes and automatic meeting points. `council-lite` covers the top findings at plan time and after the build instead.
- **Council cost defaults.** Seats × reviews × cards adds up. Decide the default seats per review and the council's share (see `council-lite`).
- **Backlog location on OpenSpec hosts.** Decide where council backlog items are written (see `council-lite`).
- **Branch protection on Cena.** An optional hard stop on `master`, since sessions run with the owner's `gh` login (`docs/decisions.md`, Standing risk). Check that it still lets the owner merge from the console once `quiet-console` adds that.

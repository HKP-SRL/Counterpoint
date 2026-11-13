## 1. Counterpoint acts as the owner

Moved to `run-as-owner` (2026-11-12).

## 2. Cards in Needs You

- [ ] 2.1 Card store, API and SSE events (D-1): source, question, why, 2–4 options with optional catalog action, recommended, reversible, blocking, state, answer, note, outcome. Verify: store and API tests, including refusal of 1 or 5 options and of an action on a non-Counterpoint source.
- [ ] 2.2 Needs You page on cards: blocking first, recommended option preselected, `1`–`4`, `Enter`, `L`, an optional note, an Answered list with outcomes, and the "Done for you" list (D-7); Astryx components, per the sketch findings for the keyboard inbox. Verify: UI tests for every key; a manual pass answering five cards without the mouse.
- [ ] 2.3 Action catalog (D-2): `refresh-environment-and-resume`, `retry-parked`, `resume-run`, `set-git-identity`, `restart-into-install`. Verify: one test per action, through the API, as the owner would pick it.
- [ ] 2.4 Existing items become cards with options: parked changes, builder questions and run-stopping problems (naming the root cause, for example "not logged in" rather than "no context window"). Verify: replay tests of a missing program, a login-shell timeout and a parked change, each ending in a card whose recommended option fixes it.
- [ ] 2.5 Unanswered rules (D-6): reversible blocking cards proceed as assumed (PR body and run report list them), irreversible ones park only their change, later answers become `pr-revisions` notes or backlog items. Verify: orchestrator tests for each path.

## 3. Ask the owner

- [ ] 3.1 `counterpoint mcp ask`, a stdio MCP server with `ask_owner` and `check_answer`, a per-session capability stored as a hash, at most 5 open cards, waits capped at 10 minutes (D-5). Verify: tests for posting, waiting, timeout and refusal of another session's card or of a sixth card.
- [ ] 3.2 Builders get the tool through `--mcp-config`; the builder prompt says to ask only what changes the outcome and to keep working on reversible questions; an answer arriving after a session ends goes into the next session's prompt. Verify: builder tests with a fake claude; a live run where a builder's question appears as a card.
- [ ] 3.3 Interactive Claude Code sessions: a one-time setup card writes the user-scope MCP entry, and Counterpoint's own `CLAUDE.md` tells sessions to ask through `ask_owner`. Verify: in a live interactive session, a question appears in Needs You and the answer returns to the session.

## 4. Owner steps

- [ ] 4.1 Unchecked `Owner:` steps of planned and runway changes appear as cards with Done, Later and, where possible, Do it for me; Done ticks the step through the planning-write path. Verify: adapter and card tests on a fixture host; the ticked step on the base branch.
- [ ] 4.2 Do it for me (D-8): the owner-step session runs as the owner in a fresh worktree, and a Land it card shows the diff and lands it with compare-and-swap. Verify: fixture test installing a pinned package from a local registry; the base branch unchanged until Land it.

## 5. Notification and self-maintenance

- [ ] 5.1 Local notifications for blocking cards (D-9): macOS notification with the question as an argument, browser notification when allowed, at most one per minute. Verify: tests that the question never reaches the AppleScript source; a manual check with the console closed.
- [ ] 5.2 Self-restart into a new install (D-10): idle restarts at once and keeps console sessions; during a run, a card asks; crash restarts still sign out. Verify: an install between runs leaves the console signed in; an install during a run shows the card.

## 6. Owner checks

- [ ] 6.1 Owner: decide the dependency source for builds after an owner step installs packages (design.md Open Questions) before task 4.2 is built. Verify: the decision is recorded in docs/decisions.md.
- [ ] 6.2 Owner: run Cena for a few days answering only through Needs You, and note anything that was not easy. Verify: the notes become cards for the next round of changes.

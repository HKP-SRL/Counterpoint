## Context

See proposal.md for the owner's direction and the five incidents behind it. The parts of today's system this change builds on:

- **Needs You** lists recomputed items: parked changes and run-stopping errors, and from `run-as-owner` a builder's ask-first question with its options. Items explain the problem and give a step. None takes an answer.
- **Acting as the owner** (`run-as-owner`): sessions, gates and services run with the owner's login-shell environment, read at each run start, and with no sandbox. Commits carry the owner's identity and a `Counterpoint-Run` trailer. Approving is one click.
- **Agents' tools.** Builders run with `--strict-mcp-config` and no MCP servers.
- **Council.** `council-lite` brings the top findings at plan time and after the build, as cards from this change.
- **The base is the remote** (`build-from-remote-base`): Counterpoint reads `origin/<base>` only. Planning writes still commit to the local base branch and push nothing, so they would never show.
- **PR delivery** pushes with the owner's credentials and runs `gh --repo` (`src/build/deliver.ts`). A per-host minute tick already asks `gh` for each PR's state.

## Goals / Non-Goals

**Goals:**
- No question reaches the owner through a terminal or a Claude Code transcript. Every one is a card in Needs You.
- Answering takes one key or click. Counterpoint carries the answer out.
- Problems that come from Counterpoint not acting as the owner disappear instead of becoming cards.

**Non-Goals:**
- No remote or phone access to the console. It stays loopback-only (see Open Questions).
- No council seats or debate. `council-lite` builds on these cards.

## Decisions

**D-1. This change owns the general card model; council extends it.**
A card is a stored row with:
- host and source (run, change, session or machine) plus a source reference;
- question, why it matters, and 2–4 options, each with a label, its consequence and an optional catalog action;
- the recommended option, reversibility, and whether it blocks work;
- state (open, deferred, answered, resolved), and the answer, note, time and outcome.

Cards stream over the existing SSE channel. `council-lite` adds its findings on top and declares `x-depends-on: [owner-inbox]`.
*Alternative:* let council own cards and add operational cards later. Rejected because the operational questions exist today and the council's do not yet.

**D-2. A fixed action catalog, attached only by Counterpoint.**
Actions are server-side operations with typed parameters:
- `refresh-environment-and-resume`
- `retry-parked` (with a note)
- `resume-run`
- `tick-owner-step` (Done on an owner step)
- `perform-owner-step`
- `land-owner-step`
- `discard-owner-step` (Discard on a Land it card)
- `restart-into-install`
- `set-git-identity`
- `add-ask-tool` (the one-time setup card for interactive sessions, D-5)

Only Counterpoint's own code paths create cards with actions. Cards from `ask_owner` have none.
*Why:* a tired owner pressing `Enter` must never run something an agent wrote.

**D-3, D-4.** Moved to `run-as-owner` (the owner's login environment, and no sandbox).

**D-5. The ask tool is a stdio MCP server shipped in the package, with a per-session capability.**
- **Builders:** for each session Counterpoint mints a random capability, stores only its hash, and passes `counterpoint mcp ask` to the session through `--mcp-config` with the capability in that server's environment. The MCP process talks to the daemon over the private control channel.
- **The capability allows four calls only:** post a card for this session, wait on it, read its answers, and list its open cards. At most 5 open cards per session.
- **Interactive sessions:** the one-time setup card writes the user-scope MCP entry (`claude mcp add --scope user counterpoint -- counterpoint mcp ask`). That server reads an interactive-ask key from an owner-only file in the Counterpoint home. The key can only open a session: each interactive session gets its own capability that way, and its cards go to the inbox of the project it runs in, or to every inbox. Builders never load user-scope MCP servers because of `--strict-mcp-config`.
- **Tools:**
  - `ask_owner({question, why, options[2-4], recommended, reversible, wait})`;
  - `check_answer({card})`.
  `wait` blocks at most 10 minutes per call (MCP calls must not hang a session indefinitely), then returns "still open" with the card id. Builders never wait (fix, 2026-11-13): a builder's `wait` returns at once with the recommendation assumed.
- **Fixes (2026-11-13):** an interactive session's cards always notify, and its tool replies tell it to repeat a waiting question in the chat; answered session cards say "Not read yet" until the session reads them; an interactive session whose MCP server's input ends closes its unanswered cards as "Session ended" and loses its capability.
- **Answers reach later sessions:** an answer arriving after a builder session ended is written into the next session's prompt for that change.

**D-6. The unanswered rules generalise council's.**
- A reversible blocking card lets dependent work proceed on the recommendation, logged as assumed in the PR body and the run report.
- A later answer is recorded and kept for the change's next build. The card says "Recorded" and names the option the PR was built on. Turning a different answer into a revision of the open PR, or a backlog item after merge, belongs to `pr-revisions` (owner, 2026-11-13).
- An irreversible card parks only its dependent change.
- Machine problems are neither: they stop what they must and wait.

**D-7. "Done for you" is the log of decisions not asked.**
When the principle decides (a refreshed environment, an owner identity used for a commit, a self-restart), Counterpoint records one line with the time and, where possible, an undo action. It is a list under Needs You, not cards: nothing waits on it.

**D-8. Owner steps "Do it for me" run as an owner-step session, and their result lands only on a second yes.**
- **The session:** a Claude Code session in a fresh worktree at the base tip, run as the owner like a builder. The session gets the step text as its whole task.
- **Landing:** the result is shown as a diff on a Land it card. Land it puts the result and the step's tick in one small PR, and the same click merges it (D-11). If the base moved and the diff no longer applies, nothing lands and the card offers Do it again.
- **How:** the worktree is detached at the remote base tip, beside the repository (`<repo>-worktrees/owner-step-<id>`), with the host's `worktree.clone` folders cloned in (D-13). The session uses the project's run settings and the same usage-limit governor as builders. Afterwards Counterpoint keeps what changed as text edits (each file's text on that base, and after) and removes the worktree. Deletions, binary, executable or larger-than-1 MiB files, and more than 63 files are refused, and the step card comes back saying why. A session that changed nothing gives the step card back with its last words. Do it again is the step card's Do it for me: Discard, a base that changed the same files, or a daemon that stopped mid-session put that card back.
- **Example:** the Astryx case becomes two cards, "Approve Astryx 0.7.12 and install it" and then "Land these 3 files".

**D-9. Notifications are local.**
macOS notifications use `osascript` with the question passed as an argument, never interpolated into the script. The console adds the tab-title count (already specified) and a browser Notification once the owner allows it. Only blocking cards notify, at most one notification per minute, merged.

**D-10. A planned self-restart keeps sessions.**
The daemon watches its installed package's version. When it changes and no run is active, it starts its successor with the login environment, hands over through the control channel, and exits. The successor keeps console sessions (stored as hashes in the store). Fix (2026-11-13): a crash restart keeps them too, and a session slides 12 hours ahead on each use, up to 30 days, since signing in again needs a terminal. During a run, a card asks.

**D-11. Planning writes land as small PRs that the same click merges** (owner, 2026-11-13).
Each write (Done on an owner step, Land it, later council and `pr-revisions` writes):
- is one commit as the owner, built with plumbing on the remote base as last fetched;
- is pushed to its own branch `cp-plan/<id>` and opened as a PR through the existing PR delivery (owner's push credentials, `gh --repo`, no token of our own);
- is merged at once with `gh pr merge` (squash if the repo allows it, else merge, else rebase), its branch deleted, then the base is fetched so the console shows it in seconds.

A write is stored as edits, not files: a tick, made again through the host's adapter on whatever base it lands on (so another edit to the same task list is kept), or a file's text before and after, which applies only where the file is still as it was.

The owner's checkout and local base branch are no longer touched; the owner pulls when they like. Writes still go one at a time per host, but a blocked one does not hold up the next. A host with no remote (`build-from-remote-base` D-5) has nowhere to open a PR, so its writes commit locally as today.
*Alternatives:* push straight to the remote base (fails on, or bypasses, branch protection, and puts commits on the base that no PR shows); keep writes local (the console reads the remote, so they never show, and the owner needs a terminal to push).

**D-12. What the owner sees while a write lands.**
The card that started the write shows Landing with a link to the PR, and does not ask again while the PR is open. It shows Done once the PR merged, also if the owner merged it on GitHub. Counterpoint reads `gh pr view --json state,mergeStateStatus,statusCheckRollup,reviewDecision,headRefOid` and acts:
- **Clean:** merge now. Usually seconds.
- **Required checks running:** the card says "Waiting for checks"; the minute tick merges once they pass. No second click.
- **Conflict, or the base must be up to date:** make the write again on the new base and push, up to 3 times.
- **Checks failed, review required, PR closed, push or `gh` failed:** the card says why in one line, links the PR, and offers Retry and Cancel. Cancel closes the PR and puts the card back as it was before the click.

Never `--admin` or any other bypass, and the merge names the commit Counterpoint pushed (`--match-head-commit`). A pending write is a stored row (what to write, branch, PR), so a restart picks it up on the next tick. Nothing the owner clicked is lost. Retry makes the write again on the current base (failed checks, closed PR, conflict, failed push) or looks at the PR again (review, `gh`). In Needs You these cards sit in a Landing list, between the open cards and Answered.
*Alternative:* GitHub auto-merge (`--auto`). It needs a repo setting that is off by default, and the minute tick already exists.

**D-13. Builds keep cloning dependencies from the owner's checkout; builders install the rest.**
Since `build-from-remote-base`, every build starts from the remote base, which is often ahead of the owner's checkout. So cloned dependencies can be behind in any build, not only after an owner step installs packages. Builders already install what a task needs (`run-as-owner`), and gates catch a mismatch.
*Alternatives:* refresh the owner's checkout (touches it); a Counterpoint-managed base worktree as the clone source (worth building only if installs get slow).

**Added beyond the plan** (while implementing 4.1, small and needed):
- The framework port gained `tickTask(tasks, task)`, so a tick made again on a moved base stays framework-neutral.
- The minute tick also merges a blocked write's PR once the owner unblocked it on GitHub (approved it, or re-ran its checks), as it already shows Done when the owner merged it there.
- A blocked write counts in the Needs You count and the tab title, since it waits on the owner.

**Added beyond the plan** (while implementing 4.2):
- A catalog action `tick-owner-step` for Done on an owner step (D-2 had no action that ticks).
- Owner-step cards are named by a hash of the step's text, so a step whose text changes is a new card; a step that comes back after it was ticked or left the plan reopens its old card.
- Until the open question on marking steps is settled, every owner step offers Do it for me, except one whose named paths are all under `.git/` or `.claude/`. Later is the recommended option (fix, 2026-11-13: Done merges to the base, and one `Enter` falsely ticked steps that wait for a build), so `Enter` neither ticks nor starts a session. A step listed after an open build task is no card until the change is built.

**Added beyond the plan** (while implementing 4.3):
- A planning write can carry a `code` flag, set only when Land it lands an owner-step result, so that write may touch files outside the planning (D-8 needs it), `.counterpoint/` included (the owner sees the diff first; design-drafts 7.1 and 7.2 need it). The `.git` and `.claude` paths stay refused.
- A catalog action `discard-owner-step` for Discard on a Land it card (D-2 had none), so the result is dropped and the step card comes back.

**Added beyond the plan** (while implementing 5.1):
- The browser asks to notify only from a click: a "Notify me here" button in the Needs You header, shown until the owner answered the browser's prompt.
- Browser notifications show only while the console's tab is in the background, under one tag so open tabs replace each other's; the macOS notification comes from the daemon either way.

**Added beyond the plan** (while implementing 5.2):
- A reinstall of the same version counts as a new install: the daemon watches package.json, its entry file and that file's folder, not the version alone, and waits until they stop changing.
- The old daemon stops only once its successor has loaded the new install and asked over the control channel. A successor that never asks leaves the old daemon running, and "Done for you" says so.
- "Restart now" during a run hands over at once: crash recovery ends the run's current session and resumes the run on the new install.
- A restart card an earlier daemon left open is closed at every start, since the daemon running is the newest install.

## Risks / Trade-offs

- [Card fatigue: agents ask too much] → 5 open cards per session. Reversible questions proceed on assumption by default, so they never block. The builder prompt says to ask only what changes the outcome.
- [Owner-step sessions act on the owner's behalf] → nothing lands without Land it, and the worktree is never the owner's checkout.
- [An MCP server with a capability in its environment] → a leaked capability can only post that session's cards, within the limit.
- [A write's PR waits on checks or a review] → the card shows it and links the PR; the write is kept until it merges or the owner cancels.
- [Each write runs the host's CI and preview deploys] → the PRs are tiny and usually pass fast; a host can skip planning-only paths in its CI.
- [The owner's local base branch falls behind after each write] → expected: the console reads the remote.

## Migration Plan

1. Cards and the action catalog. Existing Needs You items become cards with options.
2. The ask tool for builders, then the interactive setup card.
3. Planning writes as small PRs, then owner steps, then self-restart.

Rollback: each step is its own release. Cards fall back to the current read-only items if the card store is disabled.

## Open Questions

Settled 2026-11-13: how planning writes reach the remote base (D-11, D-12), and where builds get dependencies after an owner step installs packages (D-13).

- **Answering away from the Mac** (phone or another device). The console is loopback-only by design. Candidates: a Claude app push linking back once at the Mac, or an authenticated relay. Deferred until the owner wants it.
- **Whether `Owner:` steps should be written so Counterpoint can perform them** (a marker such as `Owner (Counterpoint can do):`), or whether the planning pass decides per step.

## Context

See proposal.md for the owner's direction and the five incidents behind it. The parts of today's system this change builds on:

- **Needs You** lists recomputed items: parked changes and run-stopping errors, and from `run-as-owner` a builder's ask-first question with its options. Items explain the problem and give a step. None takes an answer.
- **Acting as the owner** (`run-as-owner`): sessions, gates and services run with the owner's login-shell environment, read at each run start, and with no sandbox. Commits carry the owner's identity and a `Counterpoint-Run` trailer. Approving is one click.
- **Agents' tools.** Builders run with `--strict-mcp-config` and no MCP servers.
- **Council.** `council-lite` brings the top findings at plan time and after the build, as cards from this change.

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
- `perform-owner-step`
- `land-owner-step`
- `restart-into-install`
- `set-git-identity`

Only Counterpoint's own code paths create cards with actions. Cards from `ask_owner` have none.
*Why:* a tired owner pressing `Enter` must never run something an agent wrote.

**D-3, D-4.** Moved to `run-as-owner` (the owner's login environment, and no sandbox).

**D-5. The ask tool is a stdio MCP server shipped in the package, with a per-session capability.**
- **Builders:** for each session Counterpoint mints a random capability, stores only its hash, and passes `counterpoint mcp ask` to the session through `--mcp-config` with the capability in that server's environment. The MCP process talks to the daemon over the private control channel.
- **The capability allows four calls only:** post a card for this session, wait on it, read its answers, and list its open cards. At most 5 open cards per session.
- **Interactive sessions:** the one-time setup card writes the user-scope MCP entry (`claude mcp add --scope user counterpoint -- counterpoint mcp ask`). That server reads an interactive-ask capability from an owner-only file in the Counterpoint home. Builders never load user-scope MCP servers because of `--strict-mcp-config`.
- **Tools:**
  - `ask_owner({question, why, options[2-4], recommended, reversible, wait})`;
  - `check_answer({card})`.
  `wait` blocks at most 10 minutes per call (MCP calls must not hang a session indefinitely), then returns "still open" with the card id.
- **Answers reach later sessions:** an answer arriving after a builder session ended is written into the next session's prompt for that change.

**D-6. The unanswered rules generalise council's.**
- A reversible blocking card lets dependent work proceed on the recommendation, logged as assumed in the PR body and the run report.
- A later different answer becomes a `pr-revisions` note, or a backlog item after merge.
- An irreversible card parks only its dependent change.
- Machine problems are neither: they stop what they must and wait.

**D-7. "Done for you" is the log of decisions not asked.**
When the principle decides (a refreshed environment, an owner identity used for a commit, a self-restart), Counterpoint records one line with the time and, where possible, an undo action. It is a list under Needs You, not cards: nothing waits on it.

**D-8. Owner steps "Do it for me" run as an owner-step session, and their result lands only on a second yes.**
- **The session:** a Claude Code session in a fresh worktree at the base tip, run as the owner like a builder. The session gets the step text as its whole task.
- **Landing:** the result is shown as a diff on a Land it card. Land it commits it to the base branch with the owner's identity, through a compare-and-swap like planning writes, so a moved base is rebuilt on.
- **Example:** the Astryx case becomes two cards, "Approve Astryx 0.7.12 and install it" and then "Land these 3 files".

**D-9. Notifications are local.**
macOS notifications use `osascript` with the question passed as an argument, never interpolated into the script. The console adds the tab-title count (already specified) and a browser Notification once the owner allows it. Only blocking cards notify, at most one notification per minute, merged.

**D-10. A planned self-restart keeps sessions.**
The daemon watches its installed package's version. When it changes and no run is active, it starts its successor with the login environment, hands over through the control channel, and exits. The successor keeps console sessions (stored as hashes in the store), and a crash restart still expires them. During a run, a card asks.

## Risks / Trade-offs

- [Card fatigue: agents ask too much] → 5 open cards per session. Reversible questions proceed on assumption by default, so they never block. The builder prompt says to ask only what changes the outcome.
- [Owner-step sessions act on the owner's behalf] → nothing lands without Land it, and the worktree is never the owner's checkout.
- [An MCP server with a capability in its environment] → a leaked capability can only post that session's cards, within the limit.

## Migration Plan

1. Cards and the action catalog. Existing Needs You items become cards with options.
2. The ask tool for builders, then the interactive setup card.
3. Owner steps, then self-restart.

Rollback: each step is its own release. Cards fall back to the current read-only items if the card store is disabled.

## Open Questions

- **Where build worktrees get dependencies after an owner step installs packages.** `worktree.clone` copies from the owner's checkout, which an owner-step landing does not update. Options: refresh the owner's checkout (touches it, against "builds never touch the owner's checkout"), or keep a Counterpoint-managed base worktree with installed dependencies as the clone source. The second is recommended, but it changes the clone design.
- **Answering away from the Mac** (phone or another device). The console is loopback-only by design. Candidates: a Claude app push linking back once at the Mac, or an authenticated relay. Deferred until the owner wants it.
- **Whether `Owner:` steps should be written so Counterpoint can perform them** (a marker such as `Owner (Counterpoint can do):`), or whether the planning pass decides per step.

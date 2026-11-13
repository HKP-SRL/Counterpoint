# Owner Inbox

## Why

The owner's direction (2026-11-11): "It should not be treated as separate from me, it should be treated as me. Instead of me sitting at the computer answering claude in claude code, the questions are sent to a simple inbox where I can EASILY answer them."

The first unattended runs on Cena failed on exactly that gap, one problem at a time, and each fix needed a Claude Code session at the terminal:

- **Missing `USER`.** The daemon dropped it from its environment, so every agent session was "Not logged in", and the run stopped on a misleading "no context window" error.
- **Stale PATH.** The daemon kept the PATH of a terminal opened before the Supabase CLI was installed. A run spent three Opus sessions on a gate that could never pass. After the fix, the owner restarted from a stale terminal again.
- **`COREPACK_HOME` missing.** Sessions didn't get it, so `pnpm` broke inside build sessions. It was patched on 2026-11-11 by adding one more name to the allow-list; this change replaces the allow-list itself.
- **Vercel blocked the PR preview.** Commits by `Counterpoint <counterpoint@localhost>` match no GitHub account, so no preview link was made.
- **Astryx install.** The plan's own supply-chain step could only be done by hand in a terminal, and the run reported "blocked on the owner" without a way to answer.

Each of these was either something Counterpoint should never have asked (act as the owner and it doesn't happen), or a real question with an obvious answer that took a terminal session to give. Needs You today lists problems and says "fix the cause, then start a new run". It does not take answers.

## What Changes

- **Counterpoint acts as the owner.** Moved to `run-as-owner` (2026-11-12): the owner's identity, the login-shell environment read at each run start, and no sandbox. This change builds on it.
- **Every question is a card in Needs You, from any source.** Sources: run-stopping problems, parked changes, `Owner:` steps, and agent sessions. A card has:
  - the question, and one line on why it matters;
  - 2–4 options, each with its consequence;
  - one recommended option, preselected;
  - whether it is reversible;
  - an optional note.
  The owner answers with one click or one key (`1`–`4`, `Enter` for the recommended option).
- **Counterpoint carries out the answer.** Options from Counterpoint's own sources can carry actions from a fixed catalog: re-read the login environment and resume, retry a parked change, resume the run, do an owner step. Answers to agent questions go back to the session that asked. Agents can never attach actions.
- **Decisions that follow from "act as the owner" are not asked.** Counterpoint does them, for example re-reading the environment instead of asking for a restart, and logs what it did in Needs You's "Done for you" list.
- **An ask-the-owner tool.** An MCP tool, `ask_owner`, lets any Claude Code session ask through the inbox instead of the terminal. That covers builder sessions in runs and the owner's interactive sessions. A builder that asks a reversible question keeps working on the recommended option, which is logged as assumed. An irreversible question parks only that change. Each session's capability can only post its own cards and read their answers.
- **Owner steps done for the owner.** An `Owner:` step that Counterpoint can perform gets a "Do it for me" option. Example: "Approve Astryx 0.7.12 and install it". Counterpoint does the step in its own worktree, as the owner. The result lands on the base branch after a second one-click card showing the diff.
- **Planning writes land as small PRs** (owner, 2026-11-13). Counterpoint now reads the base only from the remote (`build-from-remote-base`), so Done on an owner step and Land it each open a small PR that the same click merges. The base still changes only through a PR, and branch protection keeps working. The card shows the PR while it lands, and says why with Retry if it cannot merge.
- **Notification.** A card that blocks work raises a local notification: a macOS notification, the browser tab title, and a browser notification if the console is open. The console stays loopback-only.
- **Self-maintenance.** After a new Counterpoint install, the daemon restarts into it by itself when no run is active, and asks with a card when one is.

This change **owns the general card model**. `council-lite` builds its findings on it.

## Capabilities

### New Capabilities
- `question-cards`: the card model (question, options, recommendation, reversibility, source), answering in one step, the fixed action catalog, the rules for unanswered cards, and the "Done for you" log of decisions taken without asking.
- `ask-the-owner`: the MCP tool sessions use to ask through the inbox, its per-session capability, and its wait and assume behaviour.
- `owner-steps`: `Owner:` steps shown as cards, and steps Counterpoint performs for the owner after a yes.

### Modified Capabilities
- `needs-you`: every item is an answerable card (parked changes, run-stopping problems, owner steps, agent questions), answered from the keyboard, with a local notification when a card blocks work.
- `daemon-lifecycle`: the daemon restarts itself into a newly installed version when no run is active.
- `planning-writes`: each write lands as a small PR that Counterpoint opens and merges on the owner's click, instead of a local commit. Hosts with no remote still commit locally.

## Impact

- **Code:** the daemon and orchestrator (the card store and action catalog, owner-step sessions); the planning-write path (a small PR per write, reusing PR delivery); the agent launch profile (`--mcp-config` with the ask tool); the console's Needs You page (cards, keyboard answering, "Done for you"); a small stdio MCP server shipped in the package.
- **Security:** ask capabilities are per session and can only post cards and read their answers. Only Counterpoint attaches actions to cards.
- **Order:** depends on `run-as-owner`. It lands before `council-lite`, which reuses its cards.
- **The owner:** fewer terminal steps. Registering the ask tool for interactive Claude Code sessions is a one-time setup, and the console offers it as a card.

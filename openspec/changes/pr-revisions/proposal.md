# PR Revisions

## Why

A change will rarely be right in one shot. Once the runway has cleared a change and its PR is open, the owner needs to change small things around it: a label, a spacing, an edge case the spec missed, a test that checks the wrong thing. The owner leads and does not write code, so without a way to send the PR back, the only options are re-planning the whole change or opening an editor.

Revisions are the second half of building the right thing, as important as the runway. The runway gets the right work started; revisions get each change right before it merges. They come after `design-drafts`, whose pin overlay they reuse.

## What Changes

- The owner writes revision notes in Counterpoint, on a change whose PR is open or that parked. A note is pinned to an element of the change's preview, or written as a general note on the change in the console. Notes collect into a batch and go out together as one revision round.
- Pins use the overlay built in `design-drafts` (in-house, Shadow DOM, anchored on `data-cp-id` with a text-match fallback), injected into the local preview Counterpoint serves for the change's worktree.
- Only the owner starts a round, by sending the batch from the console. The preview runs agent-written code on its own origin, so a pin made there is only a proposal: it is listed in the console's batch, and nothing builds until the owner sends that batch. Text written by agents (council cards, persona findings, PR comments) never joins a batch on its own; the owner can copy it into a note.
- A round runs in fresh builder sessions in the change's own worktree and branch, with the notes, the change's artifacts and the PR's diff as context, and changes only what the notes ask. The context budget, gates, test policy and zero-test guard apply exactly as in a build; a note cannot switch them off.
- Every gate re-runs on the new head. Counterpoint pushes only a green head. A failing round gets the usual bounded retries and then parks with its reason, while the PR keeps its last green head.
- A builder's question answered in Needs You after its PR was built, with another option than the PR was built on, joins the change's batch as a note while the PR is open, or becomes a backlog item after merge (moved here from `owner-inbox`, 2026-11-13). Until this lands, `owner-inbox` only records the answer for the change's next build.
- A note that asks for something outside the change is flagged to the owner instead of built. The owner can send it anyway or file it as a backlog item.
- Each round is recorded: its notes, which notes it addressed or flagged, its commits and gate results. The PR body and the run report list the rounds.
- A round the owner sends goes ahead of queued builds at the governor, so during the day the owner gets it back in minutes, not after the queue.
- Needs You shows the change again when its round lands green, and shows flagged notes and parked rounds with their reason.

## Capabilities

### New Capabilities
- `pr-revisions`: owner revision notes, revision rounds in the change's worktree, re-gating, flagged notes, round history and round priority.

### Modified Capabilities
- `needs-you`: finished rounds, flagged notes and parked rounds appear in the inbox.

## Impact

- Reuses the worktree, builder sessions, gate runner, governor and PR creation of the build lane, and the pin overlay from `design-drafts`. A change's worktree and branch must stay until the change merges.
- A round that deliberately changes a signed-off screen should update the signed-off render, so the next build follows the owner's note.
- Pins need Counterpoint's local preview, even for hosts with their own preview deploys, so an open PR keeps a running preview of its worktree.
- Open for design:
  - The cost of keeping a local preview running per open PR (ports, database, start on demand vs always on).
  - How a round that changes behaviour described in the change's spec deltas updates them through the planning-write path, so the archived spec describes what was built.
  - How a note's scope is judged. The judgement is a model's, so every flag is shown to the owner, who can override it.
  - Follow-ups after merge. A merged change takes no rounds; small follow-ups become quick changes (see `docs/backlog.md`).

# PR Revisions

## Why

A change will rarely be right in one shot. Once the runway has cleared a change and its PR is open, the owner needs to change small things around it: a label, a spacing, an edge case the spec missed, a test that checks the wrong thing. The owner leads and does not write code, so without a way to send the PR back, the only options are re-planning the whole change or opening an editor.

Revisions are the second half of building the right thing, as important as the runway. The runway gets the right work started; revisions get each change right before it merges. They come straight after `first-unattended-run`, because its first PRs will need them.

## What Changes

- The owner writes revision notes in Counterpoint, on a change whose PR is open or that parked. A note is pinned to an element of the change's preview, or written as a general note on the change in the console. Notes collect into a batch and go out together as one revision round.
- The pin overlay is built here, on the local preview Counterpoint serves for the change's worktree (in-house, Shadow DOM, anchored on `data-cp-id` with a text-match fallback). `design-drafts-visual-gate` reuses it for drafts.
- Only the owner starts a round, by sending the batch from the console. The preview runs agent-written code on its own origin, so a pin made there is only a proposal: it is listed in the console's batch, and nothing builds until the owner sends that batch. Text written by agents (council cards, persona findings, PR comments) never joins a batch on its own; the owner can copy it into a note.
- A round runs in fresh builder sessions in the change's own worktree and branch, with the notes, the change's artifacts and the PR's diff as context, and changes only what the notes ask. The sandbox, context budget, protected-path check and zero-test guard apply exactly as in a build; a note cannot switch them off.
- Every gate re-runs on the new head. Counterpoint pushes only a green head. A failing round gets the usual bounded retries and then parks with its reason, while the PR keeps its last green head.
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

- Reuses the worktree, builder sessions, gate runner, governor and PR creation from `first-unattended-run`. A change's worktree and branch must stay until the change merges (cleanup comes with the signed merge).
- `morning-review-signed-merge` builds on it: the merge summary lists every round, a change can show as in revision, and an honest counter tracks changes merged with no revision round, paired with rework filed after merge.
- `design-drafts-visual-gate` builds on it: drafts reuse the pin overlay. A round that deliberately changes a signed-off screen must update the signed render for the owner to sign again; otherwise the visual gate would fail on the owner's own note.
- Pins need Counterpoint's local preview, even for hosts with their own preview deploys, so an open PR keeps a running preview of its worktree.
- Open for design:
  - The cost of keeping a local preview running per open PR (ports, database, start on demand vs always on).
  - How a round that changes behaviour described in the change's spec deltas updates them through the planning-write path, and how that interacts with the change's runway approval, so the archived spec describes what was built.
  - How a note's scope is judged. The judgement is a model's, so every flag is shown to the owner, who can override it.
  - Follow-ups after merge. A merged change takes no rounds; small follow-ups become quick changes (see `docs/backlog.md`).

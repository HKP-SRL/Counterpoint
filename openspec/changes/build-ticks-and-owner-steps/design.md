# Design

## Context

See proposal.md for the why. What the code does today:

- **Session commits** keep the change's task list out of the branch. When the builder's list differs from `HEAD` only in ticked boxes, it stays uncommitted in the worktree, and the ticks are counted against `HEAD` and stored on the run change. Any other planning edit is put back (`src/build/session-commit.ts`).
- **The planning check** runs after the gates: any planning path changed between the build's base commit and the branch tip flags the change, and its PR opens as a draft (`src/build/branch-diff.ts`).
- **Delivery** pushes `cp/<change>` and opens or updates the PR. The body lists the recorded ticks (`src/build/deliver.ts`). A branch that exists is reused by a later build if it contains the base commit (`src/build/worktrees.ts`).
- **A merged build PR means built** (`build-from-remote-base` D-7): a minute tick asks `gh` for each latest PR's state (`src/build/pr-state.ts`).
- **Planning writes** land as small PRs through one lane. A tick is made again through the adapter (`tickTask`) on whatever base it lands on (`owner-inbox` D-11, D-12).
- **Owner-step cards** cover only planned and runway changes. Every step offers Do it for me until `owner-inbox`'s open question on marking steps is settled (`src/build/owner-steps.ts`).

Checked in a scratch repository: git treats ticks on neighbouring lines as a conflict. If the base ticks 13.3 and the branch ticks 13.2, the merge conflicts. It still conflicts when the branch's list is the base's new list plus the ticks.

## Goals / Non-Goals

**Goals:** a merged build PR leaves the base with its build tasks ticked, and a build PR never fails to merge because of its ticks.

**Non-Goals:** archiving a change (backlog); hiding after-the-build owner steps before the build; changing what Do it for me can do.

## Decisions

**D-1. The tick commit is made at delivery, after the gates and before the push.**
It is the branch's last commit before each push, and it holds the recorded ticks not yet ticked at the branch tip. Later sessions on the same branch (a parked change resumed, a change built again) see those ticks at `HEAD`. Session commits still keep tick-only edits out, but count ticks against the build's base commit, not `HEAD`. So the progress check ("ticked more than before") and the PR body stay right after a tick commit. The next delivery adds one more tick commit with the ticks since.
*Alternatives:* tick in each session commit (puts the builder's edit in the branch and trips the planning check); a separate planning write after the merge (two PRs; the owner chose one).

**D-2. Tick-only by construction, through the adapter.**
Counterpoint reads the task list at the branch tip and applies each recorded tick with the adapter's `tickTask`. It skips owner steps and any task no longer in the list. It commits that one file as the owner, with the subject `cp: <change> ticks` and the `Counterpoint-Run` trailer. If the result does not pass the adapter's `sameApartFromTicks` against the branch point, no commit is made and the change is flagged. Afterwards the worktree's uncommitted list is reset to the committed one. The planning check then accepts the change's own task list when it differs from the branch point only in ticks of build tasks. Anything else is still flagged, as today.
*Alternative:* commit the builder's own list (it can reword or untick tasks; the owner ruled it out).

**D-3. A tick that would conflict lands after the merge.**
- **At delivery:** a three-way merge of the task list alone (branch point, base as last fetched, branch with ticks), in a scratch folder, never a worktree. If it conflicts, no tick commit is made, and the run change is marked "ticks after merge".
- **While the PR is open:** on the minute PR tick, when the base's copy of the list changed, the same check runs. If it now conflicts, Counterpoint adds a commit that puts the list back as it was at the branch point. It builds that commit with plumbing, as planning writes are built, and pushes it. It does this only when the remote branch is still at the commit Counterpoint last pushed and no run holds the change; otherwise it tries again next minute.
- **After the merge:** for every build PR delivered by this version, Counterpoint lands any recorded tick missing on the base as one small planning write (one edit holding all the ticks, so the 64-edit cap does not bite). It drops ticks whose task is gone. The write shows in the Landing list and asks only if it is blocked. This also covers an owner who resolved a conflict on GitHub.
- **The PR body** says "Ticks: in this PR" or "Ticks: land on `<base>` after this PR merges".
- **Each delivery decides again**, so ticks taken out can come back in once nothing conflicts.

*Alternatives:* leave the conflict for the owner to fix on GitHub (a manual step every time an owner step next to a build task is ticked during a build); merge the base into the branch (changes what the gates passed); hold owner-step ticks for open build PRs inside the build PR (changes `owner-inbox`'s Done).

**D-4. The planning-writes rule names Counterpoint as the writer.**
"Builds never write planning files directly" now reads: builders never do. The only planning edit a build branch may carry is Counterpoint's own tick-only commit of the change's task list (see the spec delta). The after-merge write is a planning write like any other. Only its start differs: it is started by the owner's merge of the build PR, not by a click.

**D-5. Built changes keep owner-step cards.**
The card set also takes changes whose status is Built and that are not archived. A change counts as built by a merged PR or by every task being ticked; in the second case it has no open steps. When the change turns Built, its cards stay open instead of resolving with "No longer open in the plan".
- **Do it for me** is offered as on every other owner-step card, keeping `owner-inbox`'s interim rule. The session runs at the base tip, which now holds the merged build. A step it cannot do (a real-device check) comes back with its one line on what the owner must do.
- **The why line** reads "`<change>` is merged (PR #16). A step after the build only you can sign off." The console links the PR the way it links a landing write's PR.
- **The last step ticked** resolves its card, and nothing else happens. The change stays Built, and archiving it is the new backlog item.

*Alternative:* hide Do it for me on built changes (inconsistent until the marking question is settled).

**D-6. No catch-up for changes merged before this ships** (owner, 2026-11-13).
D-3's after-merge write covers only PRs delivered by this version. Cena's `owner-ui-on-astryx`, the only change affected, was caught up once by hand: Cena PR #17 ticks its 28 build tasks from Counterpoint's record.
*Alternatives:* a card per such change offering to tick them; landing them on their own at the first start.

## Added during apply

Small pieces the decisions needed, recorded here (2026-11-13):
- **Delivery takes earlier ticks back out too.** When the list now conflicts and an earlier delivery's tick commit is already on the branch, the delivery adds the commit that puts back the branch-point list, as the minute tick would (D-3).
- **The after-merge write rides on a card.** It is started with a `build-ticks` card created already answered, so it shows under Landing with Retry and Cancel like any write. Cancel closes that card; the ticks stay open on the base. It is one planning edit of a new kind, `ticks`, that drops tasks that are gone. The run change's column takes a third value, `base`, once the ticks were handed to the base, so the write starts only once.
- **"At Counterpoint's last push"** is the PR head (`gh pr view --json headRefOid`) equal to the local `cp/<change>` tip, which is what Counterpoint pushed. The take-out commit is pushed as a fast-forward only, then the local branch follows it.
- **Owner-step cards get their new why line.** A card is found by its key, so a change that turns Built has its open cards' why line rewritten.

## Risks / Trade-offs

- [The after-merge write lands with no click] → It carries only ticks the PR body listed, starts only on the owner's merge, and a blocked one asks with Retry and Cancel.
- [Taking ticks back out adds commits to an open PR] → Only when the PR would otherwise conflict; a squash merge hides them.
- [A builder ticks a task it did not finish] → No new trust: the same ticks were already listed in the PR body. Gates remain the check, and the owner now sees the ticks in the diff.
- [Old owner steps of long-merged changes sit in Needs You] → They are real open steps; Later defers them, and archiving ends them.
- [Build PRs now touch `tasks.md`] → A tick-only edit, valid for `openspec validate --strict`.

## Migration Plan

1. Build in the order of tasks.md. One nullable column on run changes (where the ticks are: in the PR, or to land after the merge); null on older rows means "delivered before this change".
2. Reinstall and restart with no run active.
3. Rollback: git revert and reinstall. First, on the stopped store, drop the column and set `user_version` back by one. Ticks already merged stay on the base.

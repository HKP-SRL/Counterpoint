# Design

## Context

See `proposal.md` for why, and the spec files for behavior. What shapes the approach:

- **The home's sources already exist:**
  - question cards, including run-stopping problems, parked changes, owner steps and Land it (`src/core/store/cards.ts`, `GET /needs-you`);
  - planning writes that are landing, waiting for checks or blocked, which the Needs You page shows with Retry and Cancel;
  - the run (`GET /run`);
  - the runway and approvals (`GET /runway`, `/changes`);
  - the build PRs (`run_changes.pr_url`, `pr_state`, and `head_commit`, the commit Counterpoint last pushed, which a fix in flight adds and sets at every push).

  Today the console reads them on separate pages.
- **Live updates come in fixed event families:** `host`, `planning`, `approval`, `runway`, `needs-you`, `run`, `settings`, plus `drafts` from `design-drafts`. An unknown family is refused. Cards and planning writes publish `needs-you`; a merged build PR publishes `planning`.
- **Planning writes already merge PRs** (`src/build/planning-lane.ts`): the merge method the repository allows (cached), the GitHub status read (`mergeStateStatus`, checks, review, `headRefOid`), `--match-head-commit` against the stored commit it pushed, Waiting for checks finished on the minute tick, blocked reasons, and `gh` run from a folder under the host's Counterpoint home, never the owner's checkout.
- **The keyboard inbox exists** (`ui/src/inbox-keys.ts`: `J`/`K`, `1`–`4`, `Enter`, `L`, `N`).
- **Drafts come first.** `design-drafts` lands before this change, and the owner drafts the Home screen with it. `x-drafts: [home]` in this change's `.openspec.yaml` holds the build until Home is signed off and on `main` (`design-drafts-follow-up`). The signed-off pages are the builder's reference for the look. This design fixes behavior and structure only.
- **The sketch findings** (`sketch-findings-counterpoint` skill) still apply for the palette, the dark-cockpit colors, purple for live, and keyboard-first. For the home they are superseded on modes, the hero figure, the flight path, stat tiles and sparklines. The quiet home has none of these.

## Goals / Non-Goals

**Goals:**
- One request gives the home its whole ordered list, so the order is decided in one place and tested there.
- Merging uses the same tested path as planning writes.
- Nothing the old pages offered is lost; it moves behind a click.
- Each waiting thing shows once.

**Non-Goals:**
- The home's visual details (from the signed-off drafts).
- A history of runs beyond the existing run report.
- Merging PRs that Counterpoint did not open.
- Showing GitHub's checks on the home. Merge handles them (D-5).

## Decisions

### D-1: One home endpoint, ordered on the server

- `GET /api/hosts/:hostId/home` returns `{ items, runway, history: { answered, doneForYou, landing } }`.
- **Items** are built by one pure function from the existing sources, one small function per kind. They are ordered as the spec says (kind first, then oldest first).
- **Live updates.** The console refetches it on `needs-you`, `run`, `approval`, `runway`, `planning` and `drafts` events. A merge state change (D-5) publishes a `run` event.
- **Alternative rejected:** the console combining the existing queries. The order would live in the UI, and the rows would jump around as each query lands.

### D-2: One item shape

```
{ kind, key, line, actions, details }

  kind     stopped | card | write | pr | drafts | step | approve | build | run
  line     one sentence, host text kept as data (rendered as React text)
  actions  [{ id, label, primary? }]     the buttons on the row
  details  what opens on click (gate tail, attempts, why, assumed decisions)
```

In the home's order:
- **`stopped`:** a run-stopping problem, a blocking card from the run, so it sorts first.
- **`card`:** cards keep their own model (options, consequences, recommended, reversible). Blocking cards sort with `write` items; other questions come after them.
- **`write`:** a blocked planning write: its one-line reason, a link to its PR, Retry and Cancel. It ranks with blocking cards, oldest first between them. Writes that are landing or waiting for checks are not items; they are in History (`landing`).
- **`pr`:** a green PR, meaning Counterpoint's gates passed on the change's latest build and its PR is open. GitHub's own checks are not read for the row; Merge deals with them.
- **`drafts`:** from the `design-drafts` store: a finished low-fi round or hi-fi revision waiting for the owner, or a change held for sign-off (D-9).
- **`step`:** an owner step (Done, Do it for me) or an owner-step result (Land it). It ranks after green PRs and drafts, because these rows merge something on GitHub when answered and never block a run.
- **`approve`:** a change ready to approve.
- **`build`** is the idle run row ("3 changes can build now"). **`run`** is the run in progress. Only one of the two shows.

**Can build now** (from the runway fix in flight): on the runway, not held for drafts, not waiting for a dependency, and without an open PR from its latest green build. A change with an open green PR shows on its `pr` row, not in the count, so Run never rebuilds it.

### D-3: The page

```
 +------------------------------------------------------------+
 | Home                                           [History]   |
 |                                                            |
 |  Run stopped: claude is not signed in.                     |  <- top line,
 |  [1 Sign in again (recommended)]  [2 Stop for today]       |     expanded
 |------------------------------------------------------------|
 |  design-drafts PR is green              [Preview] [Merge]  |  <- queue,
 |  Home: 3 drafts ready                   [Open]             |     one line
 |  Step: add the drafts section           [Details]          |     each
 |  quiet-console is planned               [Approve]          |
 |  2 changes can build now                [Run] [v]          |
 +------------------------------------------------------------+
```

- **The top line** is the first item, expanded. A card shows its options with their consequences, using the card component from Needs You. Other kinds show one sentence and their buttons.
- **Queue rows** are one line. Host text is cut with an ellipsis, never wrapped.
- **Details:** clicking a row's text, or `O`, opens its details in a Drawer.
- **History** opens a Drawer with the Answered list and "Done for you", moved from the Needs You page, and the planning writes that are landing or waiting for checks, each with its PR link.
- **All clear** is one line ("All clear. Runway 2.") with a link to Changes. The figure is the runway's size, held changes and changes waiting on a dependency included.
- Final spacing and sizes come from the signed-off drafts.

### D-4: Keys: Enter never merges

- The existing inbox keys are extended from cards to items:
  - `J`/`K` move the focus, and the top line is focused when the page opens.
  - On a `card`, `1`–`4`, `Enter`, `L` and `N` work as today.
- **`Enter` on other kinds** does the row's safe action: Approve, Run, Open drafts, Preview (on a PR), or opens the run report (on a run in progress).
- **`Enter` never picks an option that merges something on GitHub:** Merge, Done on an owner step, Land it, Retry on a write. On `step` and `write` rows, `Enter` opens the details; Done, Land it, Retry and Cancel need their digit. On a PR, `M` merges.
- **`O`** opens details.
- **Why:** merging is the owner's final check, so it must never be one stray Enter. Every Enter action can be undone: Approve can be withdrawn, Run can be stopped.

### D-5: Merge reuses the planning-write path

- **Shared module.** The merge-method lookup and the PR status read move out of `planning-lane.ts` into a shared module. Planning writes keep their behavior, and their tests prove it.
- **The flow.** `POST /api/hosts/:hostId/changes/:changeId/merge` (console session or control token, like run start):
  1. Reads the PR's status.
  2. Refuses with "The PR changed on GitHub since Counterpoint built it" unless `headRefOid` equals the change's stored `head_commit`, the commit Counterpoint pushed after its gates passed. The local `cp/<change>` branch is not used: any session can move it. Without a stored `head_commit` (a PR pushed by an older version), it refuses with "Rebuild to merge from here" and Open on GitHub.
  3. If mergeable, runs `gh pr merge <url> --repo … <method> --match-head-commit <head_commit>`.
  4. If checks are still running: Waiting for checks, and the minute tick merges once they pass.
  5. Otherwise, blocked with one line: checks failed, review needed, conflict, draft or closed.
- **Safety:**
  - Agents run as the owner and can read the control token, so the endpoint's guard does not keep them out. What is guaranteed: only the commit Counterpoint's gates passed is merged, and never past branch protection.
  - `gh` runs from the host's folder under the Counterpoint home, so it never touches the owner's checkout or local branches.
  - No `--admin`, so branch protection is never bypassed.
  - No `--delete-branch` on build PRs: the branch is the change's, and its worktree cleanup owns it.
- **Store.** A migration adds `merge_state` (`waiting`, `blocked` or `merged`) and `merge_reason` to `run_changes`. Each change of state publishes a `run` event. On success, `pr_state` becomes `merged` at once, so the change shows Built without waiting for the tick.

### D-6: The run row

- **Idle with work:** "N changes can build now [Run] [v]". Run posts the existing start request with the explicit list of changes that can build now (D-2), in build order, and no stop time. `[v]` opens a Popover with the change list and stop time from today's Run card.
- **During a run:** "Building quiet-console, 2 of 3 left. You can walk away. [Stop]". A usage-limit pause reads "Paused until 14:05 (usage limit)", in normal color.
- `RunCard.tsx` is split into the row and the Popover form. The settings line stays on Settings.

### D-7: Routes and navigation

- **`/h/$hostId` is Home.** `/h/$hostId/needs-you` and `/h/$hostId/trust` redirect there, and `MissionPage.tsx` and `NeedsYouPage.tsx` are removed.
- **Navigation:** Home (with the waiting count, hidden at zero), Changes, Settings. The tab title keeps `({n})`.
- **Host facts** (root, base branch, framework) move from Mission to Settings.

### D-8: Changes, one line each

- A List replaces the Table: title, status badge, one action (Approve, Withdraw or Open drafts). The row opens the change page.
- Approve all stays in the header.
- Built changes sit behind "Show built".
- Artifacts, task progress, dependencies and owner steps stay on the change page.

### D-9: Each waiting thing shows once

- **A held change** shows as one `drafts` row ("quiet-console waits for sign-off: Home [Open drafts]"). The hold card from `design-drafts` is left out of the home's `card` items, and the waiting count counts the change once.
- **A blocked sign-off** shows on that `drafts` row, with its reason, Retry and Cancel, and not as a `write` row.
- **A change with an open green PR** shows only as its `pr` row, not in the run row's count.
- **Alternative rejected:** dropping the drafts row and keeping the hold card. The card has no room for round progress, and the home would show the same change as a card and on Changes with different wording.

## Risks / Trade-offs

- [The builder follows the old sketch findings (hero, flight path) for the home] → The signed-off drafts are the builder's reference (design-drafts D-10), and this design says the quiet home drops those parts.
- [A merge goes through on a PR someone changed after the gates] → The head must equal the stored `head_commit`, and `--match-head-commit` makes GitHub refuse anything else.
- [Losing what the old pages showed] → Every item's details open on click. History holds Answered, Done for you and the landing writes, Settings holds the host facts, and the run report keeps the run detail.
- [One endpoint grows into a god function] → One pure function per kind, plus an ordering function, each tested on its own.
- [Keyboard slips] → `Enter` is always reversible, and nothing that merges is on `Enter`.

## Migration Plan

- One store migration (D-5). Old links redirect (D-7).
- Rollback: store migrations are forward-only. An older Counterpoint refuses a store newer than it knows, so going back needs the `state.db` saved before the upgrade.

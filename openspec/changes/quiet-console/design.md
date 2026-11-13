# Design

## Context

See `proposal.md` for why, and the spec files for behavior. What shapes the approach:

- **The home's sources already exist:**
  - question cards, including run-stopping problems, parked changes, owner steps and Land it (`src/core/store/cards.ts`, `GET /needs-you`);
  - the run (`GET /run`);
  - the runway and approvals (`GET /runway`, `/changes`);
  - the build PRs (`run_changes.pr_url`, `pr_state`).

  Today the console reads them on separate pages.
- **Planning writes already merge PRs** (`src/build/planning-lane.ts`): the merge method the repository allows (cached), the GitHub status read (`mergeStateStatus`, checks, review, `headRefOid`), `--match-head-commit`, Waiting for checks finished on the minute tick, blocked reasons, and `gh` run from a folder under the host's Counterpoint home, never the owner's checkout.
- **The keyboard inbox exists** (`ui/src/inbox-keys.ts`: `J`/`K`, `1`–`4`, `Enter`, `L`, `N`).
- **Drafts come first.** `design-drafts` lands before this change, and the owner drafts the Home screen with it. The signed-off pages are the builder's reference for the look. This design fixes behavior and structure only.
- **The sketch findings** (`sketch-findings-counterpoint` skill) still apply for the palette, the dark-cockpit colors, purple for live, and keyboard-first. For the home they are superseded on modes, the hero figure, the flight path, stat tiles and sparklines. The quiet home has none of these.

## Goals / Non-Goals

**Goals:**
- One request gives the home its whole ordered list, so the order is decided in one place and tested there.
- Merging uses the same tested path as planning writes.
- Nothing the old pages offered is lost; it moves behind a click.

**Non-Goals:**
- The home's visual details (from the signed-off drafts).
- A history of runs beyond the existing run report.
- Merging PRs that Counterpoint did not open.

## Decisions

### D-1: One home endpoint, ordered on the server

- `GET /api/hosts/:hostId/home` returns `{ items, runway, history: { answered, doneForYou } }`.
- **Items** are built by one pure function from the existing sources, one small function per kind. They are ordered as the spec says (kind first, then oldest first).
- **Live updates.** The console refetches it on `cards`, `run`, `approval`, `planning`, `pr` and `drafts` events.
- **Alternative rejected:** the console combining the existing queries. The order would live in the UI, and the rows would jump around as each query lands.

### D-2: One item shape

```
{ kind, key, line, actions, details }

  kind     stopped | card | pr | drafts | approve | build | run
  line     one sentence, host text kept as data (rendered as React text)
  actions  [{ id, label, primary? }]     the buttons on the row
  details  what opens on click (gate tail, attempts, why, assumed decisions)
```

- **Cards keep their own model** (options, consequences, recommended, reversible). They are wrapped as items of kind `card`. A run-stopping problem is a blocking card from the run, given kind `stopped` so it sorts first.
- **`build`** is the idle run row ("3 changes ready to build"). **`run`** is the run in progress. Only one of the two shows.
- **`drafts`** comes from the `design-drafts` store: a finished low-fi round or hi-fi revision waiting for the owner, or a held change waiting for sign-off.

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
 |  quiet-console is planned               [Approve]          |     each
 |  2 changes ready to build               [Run] [v]          |
 +------------------------------------------------------------+
```

- **The top line** is the first item, expanded. A card shows its options with their consequences, using the card component from Needs You. Other kinds show one sentence and their buttons.
- **Queue rows** are one line. Host text is cut with an ellipsis, never wrapped.
- **Details:** clicking a row's text, or `O`, opens its details in a Drawer.
- **History** opens a Drawer with the Answered list and "Done for you", moved from the Needs You page.
- **All clear** is one line ("All clear. Runway 0.") with a link to Changes.
- Final spacing and sizes come from the signed-off drafts.

### D-4: Keys: Enter is always the safe action

- The existing inbox keys are extended from cards to items:
  - `J`/`K` move the focus, and the top line is focused when the page opens.
  - On a card, `1`–`4`, `Enter`, `L` and `N` work as today.
- **`Enter` on other kinds** does the row's safe action: Approve, Run, Open drafts, Preview (on a PR), or opens the run report (on a run in progress).
- **`M` merges** the focused PR, and `Enter` never merges.
- **`O`** opens details.
- **Why:** merging is the owner's final check, so it must never be one stray Enter.

### D-5: Merge reuses the planning-write path

- **Shared module.** The merge-method lookup and the PR status read move out of `planning-lane.ts` into a shared module. Planning writes keep their behavior, and their tests prove it.
- **The flow.** `POST /api/hosts/:hostId/changes/:changeId/merge` (console session or control token, like run start):
  1. Reads the PR's status.
  2. Refuses with "The PR changed on GitHub since Counterpoint built it" unless `headRefOid` is the tip of the local `cp/<change>` branch Counterpoint pushed. Only the gated commit is merged.
  3. If mergeable, runs `gh pr merge <url> --repo … <method> --match-head-commit <head>`.
  4. If checks are still running: Waiting for checks, and the minute tick merges once they pass.
  5. Otherwise, blocked with one line: checks failed, review needed, conflict, draft or closed.
- **Safety:**
  - `gh` runs from the host's folder under the Counterpoint home, so it never touches the owner's checkout or local branches.
  - No `--admin`, so branch protection is never bypassed.
  - No `--delete-branch` on build PRs: the branch is the change's, and its worktree cleanup owns it.
- **Store.** A migration adds `merge_state` (`waiting`, `blocked` or `merged`) and `merge_reason` to `run_changes`. On success, `pr_state` becomes `merged` at once, so the change shows Built without waiting for the tick.

### D-6: The run row

- **Idle with work:** "N changes ready to build [Run] [v]". Run posts the existing start request with every change that can build now, in build order, and no stop time. Changes held by drafts are not counted. `[v]` opens a Popover with the change list and stop time from today's Run card.
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

## Risks / Trade-offs

- [The builder follows the old sketch findings (hero, flight path) for the home] → The signed-off drafts are the builder's reference (design-drafts D-10), and this design says the quiet home drops those parts.
- [A merge goes through on a PR someone changed after the gates] → The head must equal the pushed `cp/<change>` tip, and `--match-head-commit` makes GitHub refuse anything else.
- [Losing what the old pages showed] → Every item's details open on click. History holds Answered and Done for you, Settings holds the host facts, and the run report keeps the run detail.
- [One endpoint grows into a god function] → One pure function per kind, plus an ordering function, each tested on its own.
- [Keyboard slips] → `Enter` is always reversible (Approve can be withdrawn, Run can be stopped), and merge has its own key.

## Migration Plan

- One store migration (D-5). Old links redirect (D-7).
- Rollback: an older console ignores the new columns, and its own pages read the same sources.

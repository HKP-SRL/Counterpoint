# Quiet Console

## Why

The console asks the owner to read too much and look in too many places. The home stacks four cards: a run form, the runway, a Needs You summary and project facts. Needs You is a separate page. Changes is a seven-column table. Merging a finished change means going to GitHub. The owner has ADHD and wants one thing at a time (product reset, 2026-11-12: "an ADHD-friendly interface"). This is the third change on the roadmap: a one-line home, merge in one click, far less text.

## What Changes

- **The home is the inbox** (owner, 2026-11-13). The most urgent thing is one line on top, with its buttons. Below it is the queue: everything else waiting for the owner, one line each. The Mission and Needs You pages go away, and their old links open the home.
- **What comes first:** a stopped run, then cards that block work, questions, green PRs, drafts waiting for the owner, changes ready to approve, changes ready to build, and a run in progress. With nothing waiting, the home says "All clear".
- **Merge in one click** (owner, 2026-11-13): a green PR's row has Preview and Merge. If GitHub refuses, the row says why, with Open on GitHub.
- **Runs from a row.** "3 changes ready to build [Run]" builds them all in build order with the saved settings. A small menu picks changes and a stop time. While a run goes, its row says what it is building, with Stop.
- **Far less text.** Every row is one line, and details open on click. Changes shows one line per change: title, status and one action.
- **Navigation:** Home, Changes, Settings. The count of waiting items moves to Home.

Out: the home's exact look (it comes from drafting this screen with `design-drafts`, which this change depends on), one-screen plans (`one-screen-plans`), and notifications for news (backlog).

## Capabilities

### New Capabilities
- `console-home`: the home page as the owner's inbox: the top line, the queue, what comes first, acting from a row, and one line per row.

### Modified Capabilities
- `local-console`: navigation becomes Home, Changes, Settings; old Mission and Needs You links lead home; Changes shows one line per change.
- `needs-you`: question cards are shown on the home instead of their own page; the count sits on Home.
- `runway`: the runway is no longer the Mission headline; its size shows on the home, and Withdraw moves to Changes.
- `build-runs`: a run starts from the home's run row instead of the Run card form.
- `pull-requests`: a green PR can be merged from the console in one click.

## Impact

- **UI:** a new home page replaces `MissionPage.tsx` and `NeedsYouPage.tsx`. `RunCard.tsx` becomes the run row. `ChangesPage.tsx` is trimmed to one line per change. Routes redirect.
- **Server:** a guarded merge endpoint using `gh pr merge` with the repository's allowed method, reusing the merge-method lookup that planning writes already use. Like run start, it accepts only the console session or the control token.
- **Depends on** `design-drafts` (the home is drafted and signed off before it is built) and `owner-inbox` (cards).

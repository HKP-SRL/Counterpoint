# Tasks

## 1. Before the build

- [ ] 1.1 Owner: start drafts for the Home screen on this change's Drafts page, settle a direction in low-fi, refine it in hi-fi and sign it off. The change is held until then: `x-drafts: [home]` holds it until Home is signed off and its pages are on `main` (design-drafts-follow-up), so it can be approved before or after. Verify: the signed-off pages are in this change's `drafts/home/` folder on `main`.

## 2. Home data

- [ ] 2.1 Home items (D-1, D-2): one function per kind (stopped, card, write, pr, step, approve, build, run) over the existing sources, an ordering function, and `GET /api/hosts/:hostId/home` with `items`, `runway` and `history` (answered, done for you, landing writes), refetched on `needs-you`, `run`, `approval`, `runway`, `planning` and `drafts` events. `pr` is a change whose latest build passed Counterpoint's gates and whose PR is open; `build` counts the changes that can build now. Verify: unit tests that each pair of kinds orders as the spec says, blocked writes ranked with blocking cards, oldest first within a kind, only one of `build` and `run`, owner steps after drafts, landing and waiting writes only in `history`, a change with an open green PR not counted in `build`, and an empty list for All clear.
- [ ] 2.2 Drafts items (D-2, D-9): rows for a finished low-fi round or hi-fi revision waiting for the owner, and one row per change held for sign-off, from the design-drafts store; the hold card is left out of `card` items, and a blocked sign-off shows on the held change's row, not as a `write` row. Verify: unit tests for both rows, for one item per held change in the count, and for a blocked sign-off shown once.

## 3. Merge from the console

- [ ] 3.1 Shared merge helpers (D-5): move the merge-method lookup and the PR status read out of `planning-lane.ts`, with planning writes unchanged. Verify: the existing planning-write tests pass untouched.
- [ ] 3.2 Merge endpoint and states (D-5): migration for `merge_state` and `merge_reason`; the PR's head must equal the change's stored `head_commit`, and `--match-head-commit` gets that commit; no stored `head_commit` refuses with Open on GitHub; merge now, Waiting for checks finished on the minute tick, or blocked with one line; a `run` event on each state change; `gh` from the host's Counterpoint folder; no `--admin`, no `--delete-branch`; `pr_state` set to merged on success; console session or control token required. Verify: tests with a fake `gh` for clean merge, checks pending then passing, review required, checks failed, conflict, a commit pushed to the PR after the gates, the local `cp/<change>` moved by a session (the merge still uses the stored commit), no stored `head_commit`, and a request without a session refused.

## 4. Home page

- [ ] 4.1 Home page (D-3, D-9): top line expanded (card component reused), one-line queue rows with ellipsis, details in a Drawer, History Drawer with Answered, Done for you and the landing writes, the write row with its reason, PR link, Retry and Cancel, the All clear line with the runway's size. Built with Astryx, following the signed-off drafts of the Home screen. Verify: UI tests for top line, queue, details, History, a blocked write and All clear with held changes counted; a manual pass against the signed-off drafts.
- [ ] 4.2 Keys (D-4): extend the inbox keys to items: `J`/`K`, card keys as today, `Enter` as the safe action per kind, `Enter` opens details on `step` and `write` rows, digits for Done, Land it, Retry and Cancel, `M` merges a focused PR, `O` opens details. Verify: a UI test per key per kind, and tests that `Enter` never merges a PR, never ticks an owner step and never picks Land it.
- [ ] 4.3 Run row (D-6): "N changes can build now" with Run posting the explicit list of those changes, the `[v]` Popover with change list and stop time, the in-flight row with Stop, the usage-limit pause wording. Verify: UI tests for idle, menu start, in flight, paused and stopped, and a test that the posted list leaves out held changes, changes waiting on a dependency and changes with an open green PR.
- [ ] 4.4 Routes and navigation (D-7): Home at `/h/$hostId`, redirects from Needs You and Trust, navigation Home, Changes, Settings with the count on Home and in the tab title, host facts on Settings, `MissionPage.tsx`, `NeedsYouPage.tsx` and `RunCard.tsx` removed. Verify: router tests for each redirect and the count.

## 5. Changes page

- [ ] 5.1 One line per change (D-8): a List with title, status and one action, Approve all in the header, built changes behind Show built, the rest on the change page. Verify: UI tests for each status's one action and for Show built.

## 6. Owner check

- [ ] 6.1 Owner: use the quiet console for a day of runs (approve, run, answer, merge) and note anything that was not easy. Verify: the notes become cards or backlog items.

## Workflow follow-up

- Archive this change only after `owner-inbox` is archived: both change the needs-you "One inbox" requirement, and this change's version must land last.
- Archive it once every task, owner steps included, is ticked on `main`.

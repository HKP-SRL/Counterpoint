# Tasks

## 1. Before the build

- [ ] 1.1 Owner: before approving this change, start drafts for the Home screen on its Drafts page, settle a direction in low-fi, refine it in hi-fi and sign it off. The change does not build until the sign-off lands (design-drafts: drafts hold the build). Verify: the signed-off pages are in this change's `drafts/` folder on `main`.

## 2. Home data

- [ ] 2.1 Home items (D-1, D-2): one function per kind (stopped, card, pr, approve, build, run) over the existing sources, an ordering function, and `GET /api/hosts/:hostId/home` with `items`, `runway` and `history`, refetched on `cards`, `run`, `approval`, `planning` and `pr` events. Verify: unit tests that each pair of kinds orders as the spec says, oldest first within a kind, only one of `build` and `run`, and an empty list for All clear.
- [ ] 2.2 Drafts items (D-2): rows for a finished low-fi round or hi-fi revision waiting for the owner, and for a change held for sign-off, from the design-drafts store; held changes are not counted in the `build` row. Verify: unit tests for both rows and for the count.

## 3. Merge from the console

- [ ] 3.1 Shared merge helpers (D-5): move the merge-method lookup and the PR status read out of `planning-lane.ts`, with planning writes unchanged. Verify: the existing planning-write tests pass untouched.
- [ ] 3.2 Merge endpoint and states (D-5): migration for `merge_state` and `merge_reason`; head must equal the local `cp/<change>` tip; merge now, Waiting for checks finished on the minute tick, or blocked with one line; `gh` from the host's Counterpoint folder; no `--admin`, no `--delete-branch`; `pr_state` set to merged on success; console session or control token required. Verify: tests with a fake `gh` for clean merge, checks pending then passing, review required, checks failed, conflict, head moved on GitHub, and a request without a session refused.

## 4. Home page

- [ ] 4.1 Home page (D-3): top line expanded (card component reused), one-line queue rows with ellipsis, details in a Drawer, History Drawer with Answered and Done for you, All clear line. Built with Astryx, following the signed-off drafts of the Home screen. Verify: UI tests for top line, queue, details, History and All clear; a manual pass against the signed-off drafts.
- [ ] 4.2 Keys (D-4): extend the inbox keys to items: `J`/`K`, card keys as today, `Enter` as the safe action per kind, `M` merges a focused PR, `O` opens details. Verify: a UI test per key per kind, and a test that `Enter` on a PR row never merges.
- [ ] 4.3 Run row (D-6): Run with every change that can build now, the `[v]` Popover with change list and stop time, the in-flight row with Stop, the usage-limit pause wording. Verify: UI tests for idle, menu start, in flight, paused and stopped.
- [ ] 4.4 Routes and navigation (D-7): Home at `/h/$hostId`, redirects from Needs You and Trust, navigation Home, Changes, Settings with the count on Home and in the tab title, host facts on Settings, `MissionPage.tsx`, `NeedsYouPage.tsx` and `RunCard.tsx` removed. Verify: router tests for each redirect and the count.

## 5. Changes page

- [ ] 5.1 One line per change (D-8): a List with title, status and one action, Approve all in the header, built changes behind Show built, the rest on the change page. Verify: UI tests for each status's one action and for Show built.

## 6. Owner check

- [ ] 6.1 Owner: use the quiet console for a day of runs (approve, run, answer, merge) and note anything that was not easy. Verify: the notes become cards or backlog items.

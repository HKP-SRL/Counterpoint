# Tasks

## 1. Spike: speed and hi-fi rendering

- [x] 1.1 Hi-fi render of one console screen (D-3): write `scripts/render-draft.ts`, which renders a draft entry using the console's own Astryx components with sample data to `{out}/page.html` plus its styles, and a draft entry for the Needs You card list. Verify: the packed page opens with no scripts and looks like the live console's Needs You page; side-by-side screenshots and the render time in `docs/research/drafts-render.md`.
- [x] 1.2 Cena notes (Non-Goals): try rendering one Cena screen the same way in a throwaway clone of Cena outside both repositories. Record what worked and what Cena's render script needs (stubs, providers) in `docs/research/drafts-render.md`. Verify: the notes exist, and `git status` in the owner's Cena checkout is unchanged.
- [x] 1.3 Low-fi speed (D-2): time a low-fi session with the default draft model on one screen, three at once, with a first version of the wire stylesheet. Verify: first-draft and full-round times are recorded in the notes. If they miss the targets, the levers tried and the new targets are recorded in `design.md` (Goals).

## 2. Pack, map and serve

- [x] 2.1 Store migration (D-8): draft screens, rounds, drafts and marks, with SSE `drafts` events. Verify: store tests for each table's writes and state changes, and a restart that turns in-flight rounds into Failed.
- [x] 2.2 Packer (D-4): strip scripts, `on*` attributes, `<base>`, frames, embeds, `javascript:` and remote URLs; inline styles and fonts into `styles.css`; reject duplicate `data-cp-id`s. Verify: fixture tests, including a page with each kind of script and a font linked by relative URL.
- [x] 2.3 Element maps (D-6): headless Chromium at 390 and 1440 px, boxes and text per `data-cp-id`, page height, cached per width; browser lookup with a Needs You card when none is found; `playwright-core` moved to `dependencies`. Verify: tests on a fixture page, and a test of the card when no browser is found.
- [x] 2.4 Draft server (D-5): its own loopback port, Host allowlist, read-only, the CSP header, no cookies. Verify: tests that a page with a script gets the header, that a foreign Host is refused, and that a path outside the drafts folder is refused.

## 3. Low-fi rounds

- [x] 3.1 Screen list (D-2): one short session over the change's planning writes `screens.json` (screens, purposes, states, 3 directions), validated with zod. The owner can add, rename or drop a screen. Verify: fake-claude tests for a good list, a malformed one (shown as failed with Try again), and an edited list.
- [x] 3.2 Rounds (D-2): 3 sessions at once through the governor, each in its own scratch folder with its direction, the change's planning, the design rules and the wire stylesheet; each draft shows when ready, and a failed one offers Try again. Add the Draft model setting (default `sonnet`) to Settings. Verify: fake-claude tests that drafts arrive one by one, that one failure leaves the other two, and that the prompt holds the rules and the direction.
- [x] 3.3 Select and comment (spec: Select and comment parts): marks on any of the round's drafts; Next round sends them as excerpts plus notes to all 3 sessions. Verify: API tests, and a prompt test that A's header and C's list reach all 3 sessions.
- [x] 3.4 Lock and unlock (spec: Lock a direction): Lock ends low-fi and starts hi-fi; Unlock starts the next low-fi round from the locked draft. Verify: API tests for both.

## 4. Hi-fi

- [x] 4.1 Host config `drafts` section (D-3): `render`, `entry`, `guide`, parsed with zod at the base commit; without it, hi-fi is unavailable and the API says why. Verify: config tests for valid, missing and invalid sections.
- [x] 4.2 Hi-fi session and render (D-3): a detached worktree at Lock with `worktree.clone`; one entry per state; the render command run like a gate; render failures go back to the session up to 2 times; the worktree is removed at sign-off or unlock. Verify: tests with a fixture host whose render command writes a known page, and one whose render fails twice and then passes.
- [x] 4.3 Comments and revisions (D-7): comments collect until Send; a revision session changes only those parts; re-render; match by id, then by text, else Detached; Addressed when handled; the check for other parts with one retry, then "also changed". Verify: tests for addressed, detached and also-changed.

## 5. Console

- [x] 5.1 Drafts page, low-fi (D-13): screen tabs, 3 drafts side by side in sandboxed iframes with the element layer, hover outline, Select and Comment, marks list, Next round, Lock, keys `S` `C` `F` `Esc`, built with Astryx following the sketch findings. Verify: UI tests for each key and for a mark across two drafts, and a manual pass on a real change.
- [x] 5.2 Hi-fi view (D-13): state tabs, phone/desktop width, comments list with Addressed and Detached, Send, Unlock, Sign off, Drop drafts (with a confirmation), and the "also changed" notice. Verify: UI tests for each control.
- [x] 5.3 Full-screen (spec: Full-screen review): any draft at the chosen width, with the same layer and marks. Verify: UI test that a comment made full-screen joins the batch.

## 6. Sign-off, build reference and design rules

- [x] 6.1 Sign-off (D-9): one planning write of `styles.css`, the pages and `source.md` into the change's `drafts/` folder; earlier rounds stay in Counterpoint. Verify: a test with a local bare remote and a fake `gh` showing exactly those files on the base, and none from earlier rounds.
- [x] 6.2 Build reference (D-10): at build start, render the committed pages to PNGs in `.cp-drafts/` (excluded from commits) and add the Reference screens section to the builder prompt. Verify: prompt test, and a session-commit test that `.cp-drafts/` is never committed.
- [x] 6.3 Drafts hold the build (D-12): at build start, skip a change with unsigned screens or with a sign-off not yet merged; one card per held change and run, naming the screens and linking to Open drafts; "Waiting for sign-off" on the runway, the Changes page and the change page; Drop drafts ends the hold. Verify: orchestrator tests for held, signed-but-not-merged, signed-and-landed and dropped, and a test that a change without drafts builds as before.
- [x] 6.4 Design rules (D-11): read `.counterpoint/design-rules.md` at the base commit (8 KB cap) and give it to draft sessions and builder sessions. Verify: prompt tests with and without the file, and over the cap.
- [x] 6.5 Write `docs/drafts.md`: how a host sets up `drafts` (render contract, entry, guide) and Counterpoint's own guide for writing a draft entry with the console's components. Verify: following it renders the spike screen from 1.1.

## 7. Counterpoint on itself

- [ ] 7.1 Owner: add the `drafts` section to Counterpoint's `.counterpoint/config.yaml`, pointing at `scripts/render-draft.ts` and `docs/drafts.md` (Do it for me works). Verify: Counterpoint's Drafts page offers hi-fi.
- [ ] 7.2 Owner: land Counterpoint's `.counterpoint/design-rules.md` (Do it for me drafts it from the sketch findings). Verify: a builder prompt for Counterpoint shows the rules.
- [ ] 7.3 Owner: draft `quiet-console`'s home screen end to end (low-fi rounds, Lock, hi-fi comments, full-screen, Sign off). Note anything that was not easy. Verify: the signed-off pages are in `quiet-console`'s `drafts/` folder on `main`, and the notes become cards or backlog items.

## Workflow follow-up

- Archive the change once every task, owner steps included, is ticked on `main`.
- Update `pr-revisions`: it no longer reuses a pin overlay script from this change (D-6).

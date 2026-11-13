# Tasks

## 1. Drafts in the console's frames

- [ ] 1.1 Console policy (D-1): add `frame-src http://127.0.0.1:<draftPort>` from the running draft server's port; keep `frame-ancestors 'none'` and `X-Frame-Options: DENY`. Verify: a header test for `frame-src` with the draft port, and that `frame-ancestors 'none'` and `X-Frame-Options: DENY` are still sent.
- [ ] 1.2 Draft server headers (D-1): its own headers instead of `securityHeaders()`: the drafts policy with `frame-ancestors http://127.0.0.1:<consolePort>`, `nosniff`, `no-referrer`, no `X-Frame-Options`. Verify: header tests for each, including that `X-Frame-Options` is absent; an e2e check that the Drafts page shows a draft.

## 2. Sign-off per screen

- [ ] 2.1 Per-screen styles (D-2): the packer writes `styles.css` into each screen's folder and pages link it there; the sign-off write holds only that screen's folder. Verify: a sign-off test with a local bare remote and a fake `gh`: Home, then Settings, both land, and Home's files are unchanged by the second write.
- [ ] 2.2 `replace` edits (D-2): a planning-write edit kind that writes the file whatever the base holds, accepted only for a sign-off and only inside its screen's folder. Verify: signing off Home again after Unlock replaces its pages; a `replace` edit outside the screen's folder is refused.
- [ ] 2.3 Hold card shows the write (D-3): landing, waiting for checks with the PR link, and blocked with the screen, the reason, Retry, Cancel, Open drafts and Drop drafts; Cancel puts the screen back in hi-fi. Verify: tests for each state, and a Cancel test that the PR is closed and the screen can be signed off again.

## 3. Screens the plan names

- [ ] 3.1 Adapter (D-4): read `x-drafts` from `.openspec.yaml` into the change's facts as screen ids; a bad value makes the change unreadable. Verify: adapter tests for a valid list, a missing key, and a bad value.
- [ ] 3.2 Hold on named screens (D-4): at build start, hold a change whose named screens have no signed-off pages on the base; `draft_drops` migration; Drop drafts records the drop, and starting drafts again clears it. Verify: orchestrator tests for named-and-unstarted (held, card names the screen with Open drafts), named-and-landed (built), and dropped (built without drafts); a store test for the migration.
- [ ] 3.3 Screen list from the plan (D-4): starting drafts puts the named screens first, with their ids. Verify: a fake-claude test that the list starts with the named screens and keeps their ids.

## 4. Card actions

- [ ] 4.1 Catalog (D-5): `open-drafts`, `drop-drafts`, `retry-write`, `cancel-write`, `install-drafts-browser` and `retry-drafts-browser`, each with its schema and handler; `open-drafts` records nothing and leaves the card open. Verify: a test per action, and a test that an agent card still cannot carry any of them.
- [ ] 4.2 No-browser card (D-5): Install a browser (recommended) and Look again; both measure the waiting drafts. Verify: tests with a fake install command and a fake browser lookup, for both options.

## 5. Builder reference and render runner

- [ ] 5.1 Reference in the run folder (D-6): render the PNGs into the run's folder under the Counterpoint home, list them by absolute path in the Reference screens section, and change the worktree rule to allow reading them. Verify: a prompt test with the absolute paths; a test that the worktree holds no reference files and nothing is added to `info/exclude`.
- [ ] 5.2 Pinned render runner (D-7): the render command in `docs/drafts.md` and its samples calls only pinned tools; if the renderer needs a TSX runner, pin it exactly in `devDependencies`. Verify: `node_modules/.bin/tsx` appears in no doc or sample unless `tsx` is in `devDependencies`, and following `docs/drafts.md` renders the Needs You sample.
- [ ] 5.3 Spike notes (D-7): `docs/research/drafts-render.md` holds the measured low-fi times, the render time, and the targets they suggest. Verify: the file has all three.

## 6. After the build

- [ ] 6.1 Owner: plan Cena's render script (stubs, providers) as a Cena change, from the Cena notes in `docs/research/drafts-render.md`. Verify: the change exists in Cena's `openspec/changes/`.

## Workflow follow-up

- Archive this change after `design-drafts` is archived, once every task, the owner step included, is ticked on `main`.

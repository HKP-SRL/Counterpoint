# Design

## Context

See `proposal.md` for why, and the spec files for the behavior. `design-drafts` (its design's D-n are cited as "design-drafts D-n") is being built from its plan as it was when the build started, so its fixes live here. What the review found in the code:

- **Frames are blocked both ways.** The console's policy is `default-src 'self'` with no `frame-src`, so the draft origin cannot be framed in it. `securityHeaders()` also sends `X-Frame-Options: DENY` and `frame-ancestors 'none'`, so a draft server that reuses it refuses every frame (`src/core/security/guard.ts`).
- **Sign-off edits are `text` edits with a `before`.** A write whose `before` no longer matches the base is a conflict and never redone (`src/core/planning/writes.ts`). Two screens' sign-offs both write the shared `drafts/styles.css`, so the second one blocks forever. The planning lane shows a blocked write on the Needs You page only, and nothing ties it to the held change.
- **The hold needs a `draft_screens` row** (design-drafts D-12), so a change whose drafts were never started builds without them.
- **Cards take 2–4 options from a fixed action catalog** (`src/core/store/cards.ts`). It has no action to open drafts, drop them, or find a browser.
- **Builders cannot write planning files or leave the worktree.** The session commit restores planning files a builder edited, and the prompt says "Work in this worktree only". For a linked worktree, `info/exclude` is the owner checkout's `.git/info/exclude`.
- **Unknown keys in `.openspec.yaml` are ignored** (a loose schema in the adapter), and a bad known key makes the change unreadable.

## Goals / Non-Goals

**Goals:**
- Drafts render in the console with no header relaxed beyond the one origin each side needs.
- A screen's sign-off never waits on another screen's.
- Every drafts card can be answered in one step.
- The plan, not a guess, says which changes need drafts.

**Non-Goals:**
- Changing how drafts are made, reviewed or rendered.
- Rendering Cena screens (Cena work).

## Decisions

### D-1: Each side allows exactly the other

- **Console.** Its policy gains `frame-src http://127.0.0.1:<draftPort>`, read from the running draft server's port. It keeps `frame-ancestors 'none'` and `X-Frame-Options: DENY`: nothing frames the console.
- **Draft server.** It does not use `securityHeaders()`. Every response carries:
  - `Content-Security-Policy: default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; frame-ancestors http://127.0.0.1:<consolePort>`
  - `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`;
  - no `X-Frame-Options`, which cannot name an origin.
- `<iframe sandbox="">` stays (design-drafts D-5). The frame's opaque origin does not matter to `frame-ancestors`, which checks the console's origin.
- **Alternatives rejected:** serving drafts on the console origin puts agent-written HTML next to the console's session. `frame-src` without a port would allow the owner's own dev servers.

### D-2: Each screen signs off alone

- **Layout:** `<change.dir>/drafts/<screen>/styles.css`, `<screen>/<state>.html` and `<screen>/source.md`. Pages link the styles beside them. No file is shared between screens.
- **The write** holds only the screen's folder. It uses a new edit kind, `replace`, that writes the file whatever the base holds. Only sign-off uses it, only inside the screen's folder, so a second sign-off of the same screen replaces the first and never conflicts.
- **Size.** Screens of one host usually have the same styles, which git stores as one blob.
- Pages signed off before this change link a shared `drafts/styles.css`, which stays. The next sign-off of such a screen writes its own.
- **Alternative rejected:** one write per change, composed from the base at write time. A second screen's sign-off would still wait on the first one's write.

### D-3: The hold card shows the sign-off write

- The hold card (design-drafts D-12) reads each screen's sign-off write.
  - **Landing or waiting for checks:** the card says so, with the PR link. No extra option.
  - **Blocked:** the card names the screen and the write's one-line reason, and offers Retry (recommended), Cancel, Open drafts and Drop drafts.
- **Cancel** cancels the write as the planning lane does today (the PR is closed, the base is unchanged) and puts the screen back in hi-fi, ready to sign off again.

### D-4: The plan names its screens: `x-drafts`

- A change's `.openspec.yaml` may list screen ids: `x-drafts: [home, settings]` (lowercase ids, at most 20). The adapter reads it into the change's facts as a list of screen ids, so core knows the screens, not the key. A bad value makes the change unreadable, as a bad `x-depends-on` does.
- **Held** when a named screen has no signed-off pages on the base (no page in `<change.dir>/drafts/<screen>/`), or design-drafts D-12 holds it. This is checked at build start, as D-12's check is.
- **Starting drafts** puts the named screens first in the screen list, with their ids. The screen-list session adds purposes, states and directions, and may add screens.
- **Drop drafts** also records that the change's drafts were dropped (a migration adds `draft_drops`: host, change, time). This ends the hold for named screens too, until the owner starts drafts again.
- Older daemons ignore the key, so a plan can carry it before this change lands.
- **Alternatives rejected:**
  - Guessing from the plan whether a change has screens (design-drafts Non-Goals).
  - A marker in the proposal's text. The metadata file is where OpenSpec leaves room for tools.

### D-5: Catalog actions for drafts cards

The fixed catalog gains:
- `open-drafts {change}`: the console opens the change's Drafts page. Nothing is recorded, and the card stays open.
- `drop-drafts {change}`: the same as Drop drafts on the Drafts page. Its consequence says that landed pages stay in git. Not reversible.
- `retry-write {writeId}` and `cancel-write {writeId}`: the planning write's Retry and Cancel. A sign-off write's Cancel also does D-3's screen reset. `quiet-console` reuses both for its write rows.
- `install-drafts-browser`: runs `playwright-core install chromium` as the owner, with the owner's environment (so the owner's `PLAYWRIGHT_BROWSERS_PATH` applies), then measures the waiting drafts.
- `retry-drafts-browser`: looks for a browser again and measures the waiting drafts.

The no-browser card offers the last two, with installing recommended.

- **Alternative rejected:** a generic link option in the card model. One more catalog entry is smaller, and every action stays one Counterpoint implements and tests.

### D-6: The builder's reference lives in the run folder

- Reference PNGs are rendered into `<home>/hosts/<host>/runs/<run>/<change>/reference/<screen>/<state>-<width>.png`.
- The prompt's Reference screens section lists them by absolute path, plus each screen's committed HTML and `source.md`, which the worktree already holds.
- The build rule becomes "Work in this worktree only. The reference screens listed below are read-only files outside it."
- Nothing lands in the worktree, so nothing needs excluding, and the owner checkout's `.git/info/exclude` is never touched.

### D-7: Spike outputs and the render runner

- **Measurements** (render times, low-fi round times, and the targets they suggest) go in `docs/research/drafts-render.md`. A builder never edits `design.md`, because the session commit restores planning files. Changing a target is the owner's call, made in the plan.
- **Cena.** A render script for Cena (stubs, providers) is Cena work, planned in Cena from the notes, never in a Counterpoint build. Builders do not clone repositories outside their worktree.
- **The render command** calls only tools the package pins. design-drafts D-3's sample used `node_modules/.bin/tsx`, which is not a dependency. Either the renderer loads entries through Vite, which is already pinned (the spike did this: `node scripts/render-draft.ts`), or the TSX runner it needs is pinned exactly in `devDependencies`.

## Risks / Trade-offs

- [A draft's `frame-ancestors` names the console port, and a test daemon moves to another port] → Both headers read the live ports of their own daemon.
- [`replace` writes could overwrite a hand edit to a signed-off page] → Only sign-off uses it, only inside that screen's folder, and only when the owner clicks Sign off.
- [An `x-drafts` id that does not match the screen the owner drafts] → Named screens keep their ids in the screen list. A named screen with no pages keeps the change held, and the card names it.
- [Installing a browser downloads about 150 MB] → Only when the owner picks it, into the owner's own browsers path.

## Migration Plan

- One store migration (`draft_drops`). Store migrations are forward-only: an older Counterpoint refuses the upgraded store, so going back needs the `state.db` saved before the upgrade.
- Pages signed off with a shared `drafts/styles.css` keep working (D-2).
- Plans can add `x-drafts` at any time; it holds builds only once this change is installed.

## Open Questions

None.

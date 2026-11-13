# Design

## Context

See `proposal.md` for why, and `specs/design-drafts/spec.md` for the behavior. What shapes the approach:

- **Astryx styles are generated class names** (`x10l6tqk x13vifvy …`, one prebuilt `astryx.css` of about 264 KB). An agent cannot hand-write hi-fi Astryx HTML, so hi-fi drafts are rendered from real components. This is the same for Counterpoint's console and for Cena.
- **The CV repo's mockups** were made by rendering the real site and saving static pages with its own styles. They were exact, and they were reviewed as static pages. This design does the same, with an agent writing the screen.
- **Existing pieces to reuse:**
  - Owner-step sessions already run an agent in a detached worktree at the base commit, with `worktree.clone` folders and the governed runner (`src/build/owner-steps.ts`).
  - Local previews already run a host command as the owner on a free loopback port (`src/build/local-preview.ts`).
  - Planning writes already land text files on the base branch as small PRs (`text` edits, up to 1 MB each).
  - A change's folder is known to core as `ChangeFacts.dir`, so core needs no OpenSpec layout.
- **Approvals stay valid when planning files change** (approvals spec), so signing off a change that is already approved needs nothing extra.
- **`playwright-core` is already a dev dependency**, and a Playwright Chromium is in the owner's cache.
- **Self-hosted:** Counterpoint's builder builds this change in a worktree of Counterpoint, while the daemon runs from the installed copy. The builder must not edit `.counterpoint/`, so Counterpoint's own config and design rules are owner steps (Do it for me).

## Goals / Non-Goals

**Goals:**
- A low-fi round is fast: the first draft shows within about 30 seconds, all three within about 60.
- Hi-fi drafts look exactly like the host's real UI, because they are rendered by the host's own code.
- Drafts never run scripts, whether in the console, full-screen or in git.
- Core stays host-agnostic: rendering is a host command, like gates.

**Non-Goals:**
- Interactive drafts or prototypes.
- Rendering a Cena screen in this change. The spike only records what Cena needs, and Cena's render script is Cena work.
- Holding changes that never had drafts started. Counterpoint does not guess which changes have screens (D-12).

## Decisions

### D-1: Two pipelines, one output

```
 LOW-FI                                   HI-FI
 scratch folder in Counterpoint home      detached worktree at the base commit
 session writes page.html                 session writes the host's draft entry
 (wire stylesheet, no host code)          host render command -> page.html + css
          \                                       /
           +----------> pack + map <-------------+
                 strip scripts, inline styles,
                 element map at phone/desktop widths
                           |
                    draft served static
```

- Both end as one static page per state, plus an element map.
- Low-fi never touches the host's code, which is why it is fast.
- Hi-fi uses the host's real components.
- Alternative rejected: one pipeline that always renders through the host. It is too slow for exploring.

### D-2: Low-fi: three sessions at once, each with its own direction

- **Screen list.** Starting drafts runs one short session over the change's planning text (proposal, specs, design). It writes `screens.json`, validated with zod: each screen's id, name, purpose, the states it needs, and 3 one-line starting directions. The owner edits the list before round 1.
- **A round** is 3 sessions started at once, one per draft (A, B, C), each with its direction.
  - Each session writes `page.html` in its own scratch folder under `<home>/hosts/<host>/drafts/<change>/<screen>/r<n>/<letter>/`.
  - Each draft shows when its own session ends.
  - It uses Counterpoint's wire stylesheet: a small, neutral set of classes for boxes, rows, stacks, fields, buttons and tables, listed in the prompt.
  - It puts a `data-cp-id` on every meaningful part, uses real text from the change, and draws only the main state.
- **Later rounds.** All three sessions get the owner's selections, as HTML excerpts with their draft letter, and the comments. A keeps closest to the selections; B and C vary the parts nobody selected.
- **Model.** Uses the new Draft model setting (default `sonnet`) at low effort, with few turns.
- **Alternative rejected:** one session writing all three drafts. It is more coherent, but slower to the first draft and to the whole round.

### D-3: Hi-fi: the host renders, Counterpoint packs

- **Host config.** A new optional `drafts` section in `.counterpoint/config.yaml`, read at the base commit like gates:
  ```yaml
  drafts:
    render: [node_modules/.bin/tsx, scripts/render-draft.ts, '{entry}', '{out}']
    entry: draft.tsx        # the file name the hi-fi session writes
    guide: docs/drafts.md   # how to write a draft entry in this project
  ```
  Without it, hi-fi is unavailable for that host and the console says so; low-fi still works.
- **Worktree.** Lock makes a detached worktree at the base commit, the same way owner-step sessions do, including `worktree.clone`. It is kept until sign-off or unlock.
- **Session.** It gets the locked low-fi page, the host's guide, the design rules and the states. It writes one entry per state using the host's own components, the locked draft's text as sample data, and `data-cp-id` on parts.
- **Render.** Counterpoint runs `render` once per entry, like a gate: as the owner, in its own process group, with a timeout and a log. A failure goes back to the session with the log's last lines, up to 2 times; after that the screen shows the failure.
- **Contract:** the render writes `{out}/page.html` and the styles it links into `{out}/`. Anything outside `{out}` or remote is dropped by the packer.
- **Alternatives rejected:**
  - A renderer built into Counterpoint for React hosts: that puts host knowledge in core.
  - Running the host's dev server and snapshotting it: slow, per-host routing, and needs services.

### D-4: Pack: one inert page per state

The packer turns every page, low-fi or hi-fi, into a page that cannot run anything:
- It removes `<script>`, `on*` attributes, `<base>`, `<iframe>`, `<object>`, `<embed>`, forms' `action`, `javascript:` URLs and remote URLs.
- It inlines linked stylesheets into one `styles.css`, with fonts as `data:` URLs, so a page renders alone.
- It records the page's `data-cp-id`s and rejects duplicate ids.

### D-5: Serving: a separate, script-free origin

- A draft server on its own loopback port, with a Host allowlist, serves packed pages read-only.
- Every response carries `Content-Security-Policy: default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:` and no cookies.
- The console embeds drafts in `<iframe sandbox="">`, which blocks scripts again and gives the page an opaque origin.

### D-6: Pins from the console side: element maps

- Drafts run no scripts, so the overlay cannot live in the page.
- Counterpoint opens each packed page in headless Chromium (`playwright-core`) at phone (390 px) and desktop (1440 px) width. It records each `data-cp-id`'s box, its text snippet and the page height. The maps are cached per width.
- The console sizes the iframe to the page height, with no inner scroll, and lays a transparent layer of the same size over it. Hover outlines the smallest part under the pointer; a click opens Select / Comment.
- Side by side, the iframe and its layer are scaled together.
- Browser: Playwright's Chromium if installed, else the installed Google Chrome (`channel: 'chrome'`), else a Needs You card explains. `playwright-core` moves to `dependencies`.
- Alternative rejected: an overlay script injected into each draft (the old plan). It breaks "no scripts run", and the pin code would sit inside agent-written HTML.

### D-7: Comments on hi-fi: anchored by id, then text

- A comment stores the part's `data-cp-id`, text snippet, state page and width.
- A revision session gets the batch and is told to change only those parts and keep every `data-cp-id`.
- After the re-render, each comment is matched by id, then by text snippet. With no match it shows Detached. When the revision handled it, it shows Addressed.
- Counterpoint compares every part nobody commented on with the version before. If one changed, the session runs once more to restore it. If it still differs, the draft shows "also changed: …" so the owner sees it.

### D-8: Store and files

- **Migration** adds:
  - `draft_screens`: change, screen id, name, purpose, states, stage (`low`, `locked`, `hifi`, `signed`), locked draft;
  - `draft_rounds`: screen, number, stage, state;
  - `drafts`: round, letter or state, file folder, maps, state, error;
  - `draft_marks`: draft, part id, snippet, kind (`select` or `comment`), note, state (`open`, `sent`, `addressed`, `detached`).
- **Files** live under `<home>/hosts/<host>/drafts/` and are never in the host's git until sign-off.
- **Events.** Every change emits a `drafts` SSE event, and the console refetches.
- **Restart.** A round or revision in flight at a daemon restart shows Failed with Try again.

### D-9: Sign-off: text only in git

- Sign-off makes one planning write (existing `text` edits) into `<change.dir>/drafts/`:
  - `styles.css`: the packed styles, fonts inlined (about 400 KB);
  - `<screen>/<state>.html`: the packed pages;
  - `<screen>/source.md`: the hi-fi entries in code fences. The builder sees which components and props were used, and no host tool compiles them.
- Screenshots are not committed (D-10).
- Alternative rejected: committing PNGs. That needs binary planning writes and adds megabytes per change.

### D-10: The builder's reference

- At build start, if `<change.dir>/drafts/` exists at the base commit, Counterpoint renders each committed page to PNG at phone and desktop width into `<worktree>/.cp-drafts/`. That folder is added to the worktree's `info/exclude` and never committed.
- The builder prompt gets a section titled "Reference screens". It says the signed-off screens show how the screens must look, and lists the PNGs (the builder can read images), the HTML and `source.md` for each.

### D-11: Design rules

- `.counterpoint/design-rules.md`, read at the base commit, at most 8 KB, given verbatim to every draft session and every builder session as the project's design rules.
- No file means no rules section.
- Counterpoint's own file is an owner step: Do it for me drafts it from the sketch findings.

### D-12: Drafts hold the build

The owner decided this on 2026-11-13: "Don't start anything unless I signed it off."
- **When a change is held:** it has a `draft_screens` row, and a screen is not `signed` or its sign-off planning write has not merged. The pages must be on the base before the build, because a build reads the change at the base tip.
- **Checked at build start,** next to the approval check, which already happens then. A held change is skipped like a withdrawn one, so the run goes on with the others and can still end.
- **One card per held change and run:** "Sign off Home and Settings to build quiet-console", with Open drafts as the action. It is not blocking, so it sends no notification at night.
- **Listings:** the change shows "Waiting for sign-off" on the runway, the Changes page and its own page. It still counts on the runway, because it is approved work, but it shows that it is waiting.
- **Drop drafts:** on the Drafts page, with a confirmation. This deletes the screens and rounds from the store and ends the hold. Pages already landed stay in git.
- **Changes without drafts** build as before. Assumed: Counterpoint does not guess whether a change has screens. Holding every change with a UI would need that guess, or a flag in the plan.

### D-13: The Drafts page

Route `/h/$hostId/changes/$changeId/drafts`, opened from a Drafts button on the change page. Astryx components, following the sketch findings. These frames are the hand design of the page, the CV way.

```
 Low-fi round
 +----------------------------------------------------------------+
 | quiet-console > Drafts   [Home] [Settings] [+ screen]          |
 | Home - round 2                                   phone|desktop |
 | +----------------+ +----------------+ +----------------+       |
 | | A              | | B              | | C              |       |
 | |  (draft,       | |  (draft)       | |  (draft)       |       |
 | |   hover=part)  | |                | |                |       |
 | +-[Lock A] [^]---+ +-[Lock B] [^]---+ +-[Lock C] [^]---+       |
 | Marks: A header (select) . C list (select) . B "fewer cards"   |
 |                                            [Next round]        |
 +----------------------------------------------------------------+
   click a part -> [Select] [Comment ____]       [^] = full-screen

 Hi-fi
 +----------------------------------------------------------------+
 | Home - hi-fi   Waiting for sign-off   [Drop drafts]            |
 | [Main] [Empty] [Error] [Long text]     phone|desktop  [^]      |
 | +------------------------------------+  Comments               |
 | |                                    |  1 header: "tighter"    |
 | |  (rendered draft, real styles)     |  2 table: "add total"   |
 | |                                    |  [Send 2 comments]      |
 | +------------------------------------+  [Unlock]  [Sign off]   |
 +----------------------------------------------------------------+
```

- Keys: `S` selects the hovered part, `C` comments on it, `F` opens full-screen, `Esc` closes.
- Full-screen shows one draft at the chosen width, with the same layer and marks.

## Risks / Trade-offs

- [Low-fi misses the 30-second target, because `claude -p` start-up and output speed dominate] → The spike measures it first. Levers: a faster model, fewer turns, a shorter prompt. Drafts show one by one, so the wait feels shorter.
- [Host components that need app context (Next.js routing, Supabase hooks) do not render alone] → The render script is the host's to adapt (stubs, providers). The spike records what Cena needs. Low-fi works regardless.
- [Astryx components drop `data-cp-id` props] → The guide tells sessions to wrap such parts in `<div style="display:contents" data-cp-id=…>`. The map uses the children's combined box.
- [Revisions touch parts nobody commented on] → D-7's check, one retry, then "also changed" shown. It is never silent.
- [A ~400 KB `styles.css` per change in git] → Text, delta-compressed, once per change. Accepted, as CV did with larger PNGs.
- [Draft sessions spend usage next to a run] → They go through the governor like every spawn, and usage pauses apply. Low-fi sessions are small and use few turns.
- [Self-hosting: the builder edits the code of the daemon that runs it] → The daemon runs from the installed copy. Test gates use a scratch home and port.

## Migration Plan

- One store migration (D-8) and an optional host config section (D-3). Nothing changes for a host until the owner opens Drafts.
- Rollback: older versions ignore the new tables, and `drafts` folders in a change are plain files to them.

## Open Questions

- The wire stylesheet's exact vocabulary. It is tuned in the spike and has no effect on specs or tasks.

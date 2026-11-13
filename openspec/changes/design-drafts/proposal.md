# Design Drafts

## Why

Reviewing screens before they are built is where changes are cheapest. Builders left alone produce unusable UIs, such as a 20-field form built as 20 loose inputs. The owner wants to settle a screen's direction fast in low-fi, lock it, refine it in hi-fi, and have the builder build to the signed-off result (owner, 2026-11-13).

## What Changes

- **Drafts per screen.** The owner starts drafts for a change. Counterpoint lists the screens the change needs from its planning; the owner can add or drop one.
- **Static pages only.** Every draft is a static HTML page: no scripts, nothing that moves or responds to input. Each state (empty, error, long text) is its own page, not a toggle. Phone and desktop are frame widths, not separate drafts.
- **Low-fi first, to find the direction.** A round brings 3 low-fi drafts of a screen side by side: grey boxes, real text, real layout. They are made fast and show as each one is ready.
- **Select and comment parts.** On a low-fi draft the owner selects a part ("this direction") or comments on one ("change this"), across drafts too: A's header with C's list. The next round brings 3 new drafts built from those.
- **Lock.** The owner locks one low-fi draft as the direction. Unlocking goes back to low-fi rounds from it.
- **Hi-fi to refine.** The locked draft is rendered once more as one hi-fi draft, made from the host's own components, styles and sample data, plus a page for each state the screen needs. The owner comments on parts; the comments go out together, and only those parts change.
- **Full-screen.** Any draft opens full-screen at phone or desktop width, and selecting and commenting work there too.
- **Sign-off.** One click signs off the hi-fi pages. They land in the change's folder through a planning write and are given to the builder as the reference for those screens. Earlier rounds stay in Counterpoint, not in the host's git.
- **Drafts hold the build** (owner, 2026-11-13: "Don't start anything unless I signed it off"). A change with drafts does not build until every screen is signed off and its pages are on the base branch. A run skips it, and a card in Needs You says which screens wait. Dropping the drafts ends the hold. Changes without drafts build as before.
- **Design rules.** A design-rules file per host: layout and density rules that every draft and every builder session follows.

Out: hi-fi variants, comment threads (a comment is done once the next version handles it; if not, the owner comments again), a trail of earlier rounds (backlog: Version history), and the visual gate (backlog since 2026-11-12).

## Capabilities

### New Capabilities
- `design-drafts`: low-fi rounds, select and comment, lock, hi-fi refinement, full-screen review, sign-off as the builder's reference, and per-host design rules.

### Modified Capabilities
None.

## Impact

- **Self-hosted.** Counterpoint builds this change on itself (owner, 2026-11-13). Its own screens are designed by hand first, as CV did; its first real use is drafting `quiet-console`.
- **Spike first: hi-fi rendering.** Astryx styles are generated class names an agent cannot write by hand, so hi-fi drafts are rendered from the host's real components and saved as static pages, as the CV repo's mockups were. Prove it on one Counterpoint console screen and one Cena screen.
- **Speed.** Low-fi rounds never render or build the host. The design sets a time target and measures it.
- **Serving.** Drafts are served on a loopback origin separate from the console API.
- **Pins without scripts.** Drafts carry no scripts, so selecting and commenting are done from the console side. How is a design question. `pr-revisions` comments on a live, interactive preview and decides there what it reuses.
- **Open for design:** the design-rules file's format and where it lives in the host; how comments stay attached to the right part of a hi-fi draft across revisions.

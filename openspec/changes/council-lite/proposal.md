# Council Lite

## Why

The owner wants council feedback that is valuable for the product, with very little to read. The council should find the few things worth the owner's time at two moments, not hold meetings. It replaces `council-cards-decisions` and `council-meetings-backlog` (2026-11-12).

## What Changes

- Seats (product, design, tech, QA, and customer voices like Cena's Cook) are defined in the host's Counterpoint config, with defaults. Adding a seat is a config edit.
- Twice per change, at plan time and after the build, the seats review the change and the council brings back its top three findings, no more.
- Each finding is a card in Needs You, on the card model from `owner-inbox`: the question, the seats that raised it, 2-4 options with trade-offs, the recommended option, and whether it is reversible.
- A pick is written back as a decision into the change's design.md and committed.
- Unanswered reversible cards proceed on the recommended option, logged as assumed. A later different answer becomes a revision note (`pr-revisions`), or a backlog item if the change has merged. An unanswered irreversible card parks only its change.
- The council never blocks approving, drafting or building. At the governor, work the owner is waiting on goes first, then builds; council spend stays within a capped share.

Out: meetings, threads between seats, a minority report, "More like B" and "None fit, reframe" for council cards.

## Capabilities

### New Capabilities
- `council-seats`: per-host seat definitions, and the rule that the council never blocks.
- `council-findings`: the top three findings at plan time and after the build, as cards, and how unanswered ones affect the build.
- `decision-write-back`: decisions and backlog items written into the host's planning through the adapter.
- `quota-governor`: owner-waiting work first, then builds, then the council's capped share.

### Modified Capabilities
- `needs-you`: council findings appear in the inbox.

## Impact

- Builds on the cards from `owner-inbox`. Writes go through the serialized planning-write path; the adapter gains write support.
- Open for design: where an OpenSpec host's backlog lives (for example a proposal-only change, or a backlog file the host keeps), the exact format of decision entries in design.md (settle against frozen Cena fixtures), and the council's default share.

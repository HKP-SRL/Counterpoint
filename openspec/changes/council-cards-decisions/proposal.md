# Council Cards & Decisions

## Why

The council's signature interaction is the question card: the seats find the planning questions worth the owner's time and turn each into options with trade-offs. Picks must become committed decisions in the host's planning, and an unanswered card must never stop the build lane — the owner should not have to wait on the council for an "ok".

## What Changes

- Council seats (for example product, design, tech, QA, and customer voices like Cena's Cook) defined in a per-host Counterpoint config with defaults; adding a seat is a config edit. Per activity the owner chooses router-picked relevant seats or all seats.
- Question cards on a change: the question, raising seats, 2-4 options with trade-offs, the recommended option, a minority report and a reversibility class.
- Pick (written back as a decision into the change's design.md and committed), "More like B →" with a breadcrumb trail (reusing the round model from `design-drafts-visual-gate`), "None fit, reframe", and Later.
- Unanswered reversible cards: the builder proceeds on the recommended option, logged as "assumed" in the PR and merge summary; a later different answer becomes a rework note on the open PR, or a backlog item if already merged. Unanswered irreversible cards (DB schema, auth, data model, public routes, privacy, pricing) park only the dependent change.
- Council work never blocks approving, drafting or building; the builder keeps priority at the quota governor and council spend stays within a capped share.

## Capabilities

### New Capabilities
- `council-seats`: per-host seat definitions and seat selection per activity.
- `council-cards`: question cards, the owner's answers, and how unanswered cards affect the build.
- `decision-write-back`: decisions and backlog items written into the host's planning through the adapter.
- `quota-governor`: builder priority and the council's capped share of agent spend.

### Modified Capabilities
- `needs-you`: council cards appear in the inbox.

## Impact

- Writes go through the serialized planning-write path from `first-unattended-run`; the adapter gains write support.
- Open question for the design: where an OpenSpec host's backlog lives (for example a proposal-only change, or a backlog file the host keeps) and the exact format of decision entries in design.md; settle against frozen Cena fixtures.
- A decision written into an approved change's design.md changes a covered file, so that change drops off the runway until re-signed; the design must decide whether picks land before approval only, or are re-signed as a batch.

# Council Meetings & Backlog Filing

## Why

Cards answer questions the owner already has; meetings find the ones nobody has asked yet. The council should meet at set lifecycle points or when the owner calls it, debate in a bounded protocol that resists drifting to conformity, and turn what it finds into cards, review notes, persona pins on drafts and deduplicated backlog items — always alongside the work, never in front of it.

## What Changes

- Structured meetings: an independent blind pass per seat, one anonymised critique round, then chair synthesis; deterministic turn order; hard caps on rounds, tokens and wall time; dissent kept as a minority report.
- Async threads between seats for small clarifications; a stalled thread escalates to a meeting.
- The owner can call a meeting on any topic or screen and read its minutes and full transcript.
- Every meeting produces discrete outputs: cards, backlog items, review notes. Token cost per seat and per meeting is shown; per-meeting and per-day caps are enforced.
- Backlog filing straight into the host's backlog: tagged "council", with evidence and severity, deduplicated against existing items, capped per meeting; one bulk-dismissable summary in Needs You.
- Relevant personas pin their own comments on drafts before the owner reviews them.
- Automatic meetings at configured lifecycle points, never holding up approving, drafting or building. The default set of points is decided in this change's design.

## Capabilities

### New Capabilities
- `council-meetings`: the meeting protocol, threads, minutes and transcripts, outputs, costs and caps, automatic meetings and persona pins.
- `backlog-filing`: council backlog items filed into the host's backlog.

### Modified Capabilities
- `needs-you`: backlog-filing summaries appear in the inbox.

## Impact

- Reuses seats, the governor's capped share and the write-back path from `council-cards-decisions`, and the pin overlay from `design-drafts-visual-gate`.
- Deferred past v1: live watch of meetings and interjecting, post-build persona review, full gamification (see `docs/backlog.md`).

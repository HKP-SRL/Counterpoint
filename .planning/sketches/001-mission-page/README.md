---
sketch: 001
name: mission-page
question: "Does the Mission page need a board, and how should it answer 'can I walk away?' first?"
winner: "E"
tags: [layout, mission, board, dark-cockpit, launch, debrief, needs-you]
---

# Sketch 001: Mission page

## Design Question
The owner likes the idea of a board but suspects it is unnecessary. Agents move the work and the owner only makes decisions.
Which Mission page layout feels most like a solo dev's mission control? It must answer "can I walk away?" before anything else.

## How to View
open .planning/sketches/001-mission-page/index.html

Use the dark bar at the top to switch **Variant** and **State** (Idle, In flight, Holding, Landed, Alarm).
**Simulate night** advances the run on its own: plans finish, gates run, cards move to Review.
**Dark cockpit** toggles between "color only for exceptions" and "everything colored by status".
The bottom-right toolbar switches light/dark, viewport width and annotation mode.

## Winner
**E: Synthesis, vivid.** C's time-aware modes (Launch, In flight, Debrief, Stopped) built from B's parts, with a flight-path timeline of the night, one big number per mode, stat tiles with 7-night sparklines, and time-of-day ambience in the hero only (dusk, night, dawn). Status colors stay reserved for exceptions; purple is the single non-status "live" hue. A's kanban board was rejected: agents move the work, so a board is just a picture; the timeline shows the same flow in time, which is what mission control needs.

## Variants
- **A: Flight board.** Flight-state strip, then Needs You, then a read-only board (Planning, Runway, Building, Review, Merged). Cards move on their own; the only buttons are decisions (Approve, Merge, Retry).
- **B: No board.** A large flight-state strip with a mission clock (launch, now, stop), then a keyboard-driven Needs You inbox (J/K, Enter, L, A/B), live plan and gate rows, and side cards for Runway, Ready for review and Merged.
- **C: Launch / Debrief.** The page changes with the time of the run. Idle opens Tonight's flight (flight plan, settings, a Go/No-go checklist that gates Launch). In flight says "You can walk away" with Now and Up next. Landed opens While you were away (PRs, parked item with its failing lines, assumed decisions, council questions, honest counters). Alarm shows how to fix and Resume.
- **D: B+C synthesis (round 2).** C's modes (Launch, In flight, Debrief, Stopped) with B's parts (keyboard inbox, live plan and gate rows, session log). New: a hero that answers "can I walk away?" in words plus one big number (time left / runway / PRs ready); a **flight path** timeline of the night (done grey, building now in the one "live" purple, estimates as a light wash, hold, parked), with a "now" needle, a landing estimate, tooltips and a table view; stat tiles (context meter while flying, 7-night sparklines on the honest counters in the morning); council seats shown as initials.
- **E: Synthesis, vivid.** Same as D plus time-of-day ambience in the hero (dusk at launch, night in flight, dawn at debrief), a bigger figure, a glow on the live block and colored seat avatars. Still no status colors used for decoration.

## What to Look For
- At a glance, in each variant and state: can you tell whether you can walk away?
- Does the board (A) add understanding that B's lists don't? Or is it just a nicer picture?
- Dark cockpit: is the quiet grey calm, or does it hide too much? Flip the toggle and compare.
- Holding (usage limit) is deliberately not a warning. Does that feel right?
- C's Go/No-go: flip a check to No-go and see Launch disable. Is the checklist reassuring or ceremony?
- Debrief: is "While you were away" the screen you want at 7am?
- Phone width: B degrades best; A's board scrolls sideways.
- Round 2 (D/E): does the flight path make the night feel alive and readable? Is purple-for-live enough life, or does E's ambience feel better? Does the landing estimate ("lands ≈05:34") help you decide whether to walk away?

## Data used
Realistic Cena phases (3 QR menu browsing through 9 Staff roles), PRs #38 to #44, gates Typecheck, Lint, Unit tests, E2E, Build. Run 22:10 to 07:00. Everything is mocked; no backend.

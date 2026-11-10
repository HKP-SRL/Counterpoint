# Sketch Wrap-Up Summary

**Date:** 2026-11-10
**Sketches processed:** 1
**Design areas:** Mission layout & modes, Flight path & data viz, Color & theme, Interaction
**Skill output:** `./.claude/skills/sketch-findings-counterpoint/`

## Included Sketches
| # | Name | Winner | Design Area |
|---|------|--------|-------------|
| 001 | mission-page | E (Synthesis, vivid) | Mission layout & modes; Flight path & data viz; Color & theme; Interaction |

## Excluded Sketches
| # | Name | Reason |
|---|------|--------|
| (none) | | |

## Design Direction
Mission control for one person, calm and Linear-like, on Astryx neutral (Figtree, warm greys,
monochrome accent, light and dark). The Mission page answers "can I walk away?" first, then
what needs the owner, then how much runway is left. It follows the dark-cockpit rule: quiet grey
when normal, status color only for exceptions, and one non-status hue (Astryx purple) for
"live". There is no board. Agents move the work, the owner only decides, and the page changes
with the time of the run.

## Key Decisions
- **Layout:** one Mission page, five flight states mapped to four modes: Launch (idle), In flight
  (inflight and holding), Debrief (landed), Stopped (alarm). Each mode has a hero card (a chip,
  a sentence answering "can I walk away?", one big number, the flight path), then 3 to 4 stat
  tiles, then a 2fr / 1fr grid of flat cards. It collapses to one column below 980px and hides
  the side nav below 760px (container queries).
- **Flight path:** a timeline of the night from launch to the stop time. Done blocks are grey,
  the live block is purple, estimates are a light wash, and hold / parked / stopped get their own
  styles. It has a now needle, hourly axis, a landing-estimate caption, tooltips, focusable
  blocks and a table view.
- **Palette:** Astryx neutral. Yellow is used only for parked or changed work and red only for
  stopped or failed work. Done and passed are grey. `--color-live: light-dark(#980fb2, #d885eb)`
  and `--color-seg-done: light-dark(#8f8f8f, #8a8a8a)` were checked with the dataviz validator.
  Dusk, night and dawn gradients appear in the hero only, and never on the alarm.
- **Typography:** Figtree 14/20 base, 12 supporting, 20/28 headings, tabular numbers. The hero
  greeting is 28/36 and the figure is 60/64.
- **Spacing and shape:** 4px steps, 24px gaps, flat cards with a 12px radius, shadows only on
  overlays.
- **Interaction:** buttons only for decisions. Approve and merge are signed in the owner's
  terminal, through a dialog that shows the exact command. The Needs You inbox is
  keyboard-driven (J/K, Enter, L, A/B). Go/No-go must be all Go before Launch is enabled. Toasts
  confirm every decision. Motion is only for live things, and reduced motion is respected.
- **Honest counters** always come with their paired risk counter and a 7-night sparkline.
- **Rejected:** the kanban board (A), strip-only status (A/B), every card at once regardless of
  time (B), debrief as a separate page (C), "dark cockpit off" status coloring, and the calmer
  D without ambience.

## Open Questions
- **Where the redesign lands.** The current `ui/src/pages/MissionPage.tsx` follows
  `01-UI-SPEC.md` (runway card first, Needs You + Trust grid). The flight states need the
  autonomous build lane, which Phase 1 doesn't ship, so the hero, modes and flight path belong
  to the phase that adds runs. That phase's UI-SPEC should cite this skill.
- **Estimates.** The sketch used fixed numbers (26 min per plan + 20 min of gates). The real
  values need run history ("your last 7 nights") and a rule for the first night.
- **Go/No-go sources.** These are clickable in the sketch. In the app they must come from
  doctor/trust results, gh status, signatures, power state and the usage window.
- **Where the two new tokens live.** `--color-live` and `--color-seg-done` aren't in Astryx.
  Decide whether they become StyleX variables or CSS custom properties next to the theme import.
- **Untested:** the hero gradients in high-contrast and forced-colors modes; a run with many
  short phases (label fitting at density); and more than one host.

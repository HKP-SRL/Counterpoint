---
name: sketch-findings-counterpoint
description: Validated design decisions, CSS patterns, and visual direction from sketch experiments. Auto-loaded during UI implementation on Counterpoint, especially the Mission page (time-aware modes, flight-path timeline, dark-cockpit color rule, purple for live, Needs You keyboard inbox, Go/No-go launch, one-click approve and merge).
---

<context>
## Project: Counterpoint

Counterpoint's console should feel like mission control for one person: calm and Linear-like,
built on Astryx's neutral theme (Figtree, warm greys, monochrome accent, light and dark). Its
first job is to answer "can I walk away?". After that come what needs the owner, then how much
runway is left. "Dark cockpit": when everything is normal the page stays quiet and grey, and
color appears only for exceptions (parked items, stopped runs). Agents move the
work and the owner only makes decisions. A board is something you watch, never something you
drag, and buttons appear only for decisions (approve, merge, retry, pick). Round 2 added life
without spending status colors: motion where something is actually happening, a timeline of the
night, one big number per mode, and time-of-day ambience in the hero only. One non-status hue
(Astryx purple) means "live".

Reference points: Linear (triage inbox, keyboard-first, calm density, agents as delegates with
visible state, "respect requests to disengage"); aviation "dark cockpit" panels (quiet when
normal, lights only for exceptions); mission control (flight state, mission clock, Go/No-go
before launch, debrief after landing).

Sketch sessions wrapped: 2026-11-10
</context>

<design_direction>
## Overall Direction

- **Superseded for the home:** the planned `quiet-console` change replaces the Mission page's
  modes, hero figure, flight path, stat tiles and sparklines for the home
  (`openspec/changes/quiet-console/design.md`, Context). The colors, purple for live and the
  keyboard inbox still apply.
- **Stack:** the real console is React 19 + Astryx (`@astryxdesign/core` 0.7.x, theme-neutral,
  StyleX prebuilt CSS). No shadcn and no Tailwind. The sketches imitate Astryx in plain CSS; in
  `ui/`, use the Astryx components listed in each reference's "Mapping to Astryx" table and the
  real theme import in `ui/src/styles.css`.
- **Layout:** the Mission page has no board. It has one page with five flight states (idle →
  Launch, inflight / holding → In flight, landed → Debrief, alarm → Stopped). Every state has
  the same skeleton: a hero card (chip, a sentence answering "can I walk away?", one big number,
  the flight-path timeline), then a row of 3 to 4 stat tiles, then a 2fr / 1fr grid of flat cards
  that collapses to one column below 980px of container width.
- **Palette:** Astryx neutral, monochrome accent. Status colors are for exceptions only (yellow =
  parked, red = stopped or failed). Normal states are grey, including done and
  passed. Purple (`--color-live: light-dark(#980fb2, #d885eb)`) is the single non-status hue,
  meaning "happening now". Time-of-day gradients (dusk, night, dawn) appear in the hero only.
- **Typography:** Figtree, base 14/20, supporting 12, heading 20/28, and tabular numbers
  everywhere. The hero greeting is 28/36 weight 600 and the hero figure is 60/64 weight 600.
- **Spacing and shape:** 4px steps, 24px page gaps, 16px card padding; radii 6 / 10 / 12 /
  full; flat cards, shadows only on overlays.
- **Interaction:** buttons only for decisions; approve and merge are one click in the console,
  nothing is signed and only the owner merges (2026-11-12); Needs You is keyboard-first (J/K, Enter,
  L, A/B); Go/No-go must be all Go before Launch is enabled; toasts confirm every decision; motion
  only for live things, and none under reduced motion.
</design_direction>

<findings_index>
## Design Areas

| Area | Reference | Key Decision |
|------|-----------|--------------|
| Mission layout & modes | references/mission-layout.md | No board. Time-aware modes, each with a hero that answers "can I walk away?" in words plus one big number |
| Flight path & data viz | references/flight-path-dataviz.md | A timeline of the night (done grey, live purple, estimates as a wash, plus hold, parked and stopped) with a now needle, landing estimate and table view; paired honest counters with sparklines |
| Color & theme | references/color-theme.md | Dark cockpit: status colors only for exceptions; purple is the one "live" hue; ambience only in the hero |
| Interaction | references/interaction.md | Buttons only for decisions; one-click approve and merge; keyboard Needs You inbox; Go/No-go gates Launch |

## Theme

The winning theme file is at `sources/themes/default.css` (Astryx neutral values plus the two
sketch tokens `--color-live` and `--color-seg-done`). Self-hosted Figtree is in
`sources/themes/fonts/`.

## Source Files

Original sketch HTML files are preserved in `sources/` for complete reference. Open
`sources/001-mission-page/index.html` in a browser, choose variant **E**, and use the State
buttons (Idle, In flight, Holding, Landed, Alarm) and "Simulate night" to see every mode.
</findings_index>

<metadata>
## Processed Sketches

- 001-mission-page
</metadata>

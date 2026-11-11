# Mission Layout and Modes

## Design Decisions

**The Mission page has no board.** Agents move the work and the owner only makes decisions, so a
kanban board (Planning, Runway, Building, Review, Merged) would only be a picture of the work.
The flight-path timeline shows the same flow over time, which is what mission control needs.
See `flight-path-dataviz.md`.

**The page changes with the run.** There is one Mission route, and its body depends on the
flight state:

| Flight state | Mode | Hero sentence | Big figure | Body (left column / right column) |
|---|---|---|---|---|
| `idle` | Launch | "Good evening." (or "Stopped. It stays that way." after a manual stop) | runway change count, "on the runway · N tasks" | Flight plan + Settings (compact) / Go/No-go + "Before you go" (Needs You, no keys) |
| `inflight` | In flight | "You can walk away." | time left, "left until the 07:00 stop" | Needs You (keyboard) + Now / Up next + Ready for review |
| `holding` | In flight (same body) | "Holding. You can still walk away." | time until resume, "until it resumes at 03:12" | same as In flight |
| `landed` | Debrief | "Good morning." | PRs ready, "PRs ready for review" | Ready for review + Parked + Decisions the builder assumed / Questions from the council + Runway |
| `alarm` | Stopped | "Stopped. This one needs you." | none | How to fix / Meanwhile (Needs You without the alarm) + Up next |

**Reading order on every mode:** (1) can I walk away? (2) what needs me? (3) how much runway is
left? The hero answers (1) in words, the stat tiles and Needs You answer (2), the figure or the
Up next card answers (3).

**Hero card (top of the page, full width):**
- A status chip (Ready / In flight with a pulsing dot / Holding / Landed 06:40 / Stopped).
- A greeting-sized sentence (28px/36px, weight 600) that answers "can I walk away?" in words.
- One supporting line (secondary text, max 68ch) that says what is happening in plain language,
  for example "Building Kitchen display, task 3 of 8. Questions wait in Needs You;
  only irreversible work parks."
- On the right: one big number (60px/64px, weight 600 in the winning variant) with a 12px label
  under it, and the only hero action (Stop while flying, How to fix when stopped).
- The flight path sits inside the hero, under the text.

**Stat tiles row (under the hero):** 3 to 4 tiles in an auto-fit grid (min 210px). They change per
mode: Launch shows Estimated flight / Usage window / Last night; In flight shows Runway ahead /
Ready for review / Needs you / Context this session (with a meter); Debrief shows the three
honest counters with 7-night sparklines. Stopped shows no tiles.

**Body:** a two-column grid, 2fr / minmax(280px, 1fr), with 24px gaps. It collapses to one column
below 980px of container width. Each column is a vertical stack of cards with 24px gaps.

**Cards are flat:** 1px border, 12px radius (`--radius-container`), no shadow. Card header is
48px minimum with a 600-weight label, an optional supporting count (tabular numbers), and
right-aligned extras. Shadows are only for popovers, tooltips, dialogs and toasts.

**Copy tone:** plain, calm, specific times and counts. Examples kept from the sketch:
"Nothing needs you. Go do something else." · "Nothing after this one. It lands when this change
is done." · "Holding … It resumes on its own and nothing is lost." · "Kitchen display stopped at a clean
handoff; nothing is lost." Holding is described as normal, never as a warning.

**App shell:** top nav (56px: wordmark, host switcher with branch, Live indicator, theme toggle),
side nav (208px: Mission, Changes, Needs You with a count, Trust), main content padded 24px
(16px on narrow). The side nav hides below 760px of container width.

**Responsive:** the layout uses container queries on the frame, not viewport media queries.
Below 760px: the hero becomes one column with the figure left-aligned, the Now card's
tasks/gates grid stacks, stat tiles go two-up and hide sparklines, odd hour ticks on the flight
path hide, and keyboard hints are hidden.

## Mapping to Astryx (the real console)

The sketch reproduces the Astryx look in plain CSS. In `ui/` use the components instead (all
are exported by `@astryxdesign/core` 0.7.11; check props against the installed version):

| Sketch part | Astryx |
|---|---|
| `.shell`, `.topnav`, `.sidenav`, `.navitem` | `AppShell`, `TopNav` / `TopNavHeading`, `SideNav` / `SideNavItem` (already used in `ui/src/shell/AppFrame.tsx`) |
| `.card`, `.card-h`, `.card-b` | `Card` |
| `.cols` two-column body | `Grid` (the current Mission page already switches to two columns from `lg`) |
| `.stack` | `VStack` (gap 24) |
| `.chip` status chip | `Badge` or `Token` with an icon; the live variant needs the `--color-live` token |
| `.greet`, `.h2` | `Heading` |
| `.sup`, `.muted` | `Text` with secondary color / supporting size |
| `.nlist` / `.nrow` | `List` / `ListItem` (the Needs You row already exists as `NeedsYouRow`) |
| `.quiet-empty` | `EmptyState` or a single quiet `ListItem` |
| Settings selects | `Selector`; Flight plan checkboxes: `CheckboxInput` |

## HTML Structures

Hero (winning variant E):

```html
<section class="card hero" data-amb="night" aria-live="polite">
  <div class="hero-top">
    <div>
      <span class="chip live"><span class="dot"></span>In flight</span>
      <h1 class="greet">You can walk away.</h1>
      <div class="hero-sub">Building Kitchen display, task 3 of 8. Questions wait in Needs You; only irreversible work parks.</div>
    </div>
    <div class="hero-fig">
      <div class="fig">5h 02m</div>
      <div class="fig-l">left until the 07:00 stop</div>
      <div class="hero-act"><button class="btn secondary">Stop</button></div>
    </div>
  </div>
  <!-- flight path goes here, see flight-path-dataviz.md -->
</section>
```

Page skeleton per mode:

```html
<!-- hero -->
<div class="kpis"><!-- 3-4 .card.kpi tiles --></div>
<div class="cols">
  <div class="stack"><!-- primary cards --></div>
  <div class="stack"><!-- secondary cards --></div>
</div>
```

Card with header:

```html
<section class="card">
  <div class="card-h">
    <span class="label">Up next</span>
    <span class="end sup">lands ≈05:34</span>
  </div>
  <ul class="nlist">
    <li class="nrow"><span class="sup">1</span><span class="mono muted">allergen-filters</span>
      <div class="n-main"><div class="n-title">Allergen filters</div></div>
      <span class="sup">6 tasks · ≈1h 12m</span></li>
  </ul>
</section>
```

## CSS Patterns

```css
.hero { position: relative; padding: 20px 24px 16px; margin-bottom: 16px; overflow: hidden; transition: background .4s ease; }
.hero-top { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; align-items: start; }
.greet { font-size: 28px; line-height: 36px; font-weight: 600; margin: 12px 0 4px; letter-spacing: -0.01em; }
.hero-sub { color: var(--color-text-secondary); max-width: 68ch; }
.hero-fig { text-align: right; }
.fig { font-size: 60px; line-height: 64px; font-weight: 600; letter-spacing: -0.02em; } /* E; D used 52px/400 */
.fig-l { font-size: 12px; color: var(--color-text-secondary); }

.cols { display: grid; grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); gap: 24px; align-items: start; }
@container (max-width: 980px) { .cols { grid-template-columns: minmax(0, 1fr); } }
.stack { display: flex; flex-direction: column; gap: 24px; min-width: 0; }

.card { background: var(--color-background-card); border: 1px solid var(--color-border); border-radius: var(--radius-container); min-width: 0; }
.card-h { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 8px 16px; border-bottom: 1px solid var(--color-border); }
.card-h .end { margin-left: auto; }

#frame { container-type: inline-size; }
@container (max-width: 760px) {
  .hero-top { grid-template-columns: 1fr; }
  .hero-fig { text-align: left; }
  .greet { font-size: 24px; line-height: 32px; }
}
```

## What to Avoid

- **A kanban board on Mission (variant A).** Rejected: the owner can't drag anything, so it only
  pictures the work, it scrolls sideways on a phone, and it adds no understanding the timeline
  and lists don't already give.
- **A strip-only status line (A/B).** Too small to answer "can I walk away?" first. The answer
  needs a full sentence and one big number.
- **Fixed layouts that ignore the time of the run (B alone).** The owner needs a different page
  at 22:00 (launch), 02:00 (glance) and 07:00 (debrief). Showing every card at once buries the
  answer.
- **A separate debrief page (C's link-out).** Debrief is the Mission page's landed mode, not a
  different destination.
- **Alarm wording that blames or panics.** Always say what stopped, that nothing was lost, and
  the exact fix.

## Origin

Synthesized from sketch: 001 (winner E; parts from B and C)
Source files: `sources/001-mission-page/index.html` (functions `heroData`, `heroHTML`,
`kpisHTML`, `variantD`; open it and pick variant E, then step through the State buttons)

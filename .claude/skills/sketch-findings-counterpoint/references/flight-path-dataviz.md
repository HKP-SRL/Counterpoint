# Flight Path and Data Visualization

## Design Decisions

**Flight path = a timeline of the night, inside the hero.** One horizontal track from launch
(or the planned launch time when idle) to the stop time. Each block is a change or an event:

| Kind | Look | Meaning |
|---|---|---|
| `done` | solid grey (`--color-seg-done`) | change finished; tooltip has its PR number |
| `live` | solid purple (`--color-live`), slow breathing opacity, soft glow in E | building now; grows with "now" |
| `est` | grey at 24% (light wash), secondary text | estimated future changes, in runway order |
| `hold` | grey at 48% with a pause icon | usage-limit hold; resumes on its own |
| `parked` | warning yellow with an alert icon | change parked after failing gates |
| `stopped` | error red with an X icon | run stopped and needs the owner |

- **Needle:** a 2px vertical line in primary text color at "now", labeled "now 01:58" (or
  "landed 06:40" / "stopped 01:14"). The label flips to the left or right edge when the needle
  is within 8% / 12% of an end, so it never clips.
- **Axis:** one tick per hour, 12px tabular numbers, last tick right-aligned to the stop time.
  On narrow widths every other tick hides.
- **Legend:** only the kinds actually on the track, right-aligned in the header.
- **Caption (under the axis) answers "when does it land?"** per mode:
  - Idle: "If you launch at 22:10, it lands ≈04:12, 2h 48m before the 07:00 stop."
  - In flight: "Lands ≈05:34, before the 07:00 stop. Estimates come from your last 7 nights."
  - Holding: "Resumes 03:12, lands ≈06:10, still before 07:00."
  - Landed: "Flew 22:10–06:40 · 8h 30m · runway ran out."
  - Alarm: "Stopped at 01:14. Faded blocks show the rest of the night if you resume now."
  - Anything that won't fit before the stop is named: "Staff roles won't fit before 07:00."
- **Estimates:** minutes per task × tasks + a fixed gate time, "from your last 7 nights". In the
  sketch these were 26 min per unit of work and 20 min of gates. In the real build, derive them from history.
  Blocks that run past the stop are cut at the stop with a square right edge (`.cut`).
- **Labels fit themselves:** a block shows "5 Kitchen display", then just "5" when narrow,
  then nothing. Hover or focus always shows a tooltip with duration, change, range and state.
- **Accessibility:** every block is focusable (`tabindex=0`, `role=img`, `aria-label` = the
  tooltip text). A "Show as table" disclosure renders the same data as a table (Change, From,
  To, Duration, State).

**Stat tiles (KPIs):** label with a small icon (12px secondary), value 24px/32px weight 600 with
an optional unit, one supporting line. Optional extras:
- **Context meter** (In flight): 6px bar, purple on a 16% purple track. It turns warning yellow
  above 80%. The label says "of a 400k budget · hands off cleanly at the limit". The budget comes
  from the model's own window, never a hard-coded size.
- **Sparklines** (Debrief honest counters): 120×36 SVG, 2px grey line, a purple dot on the last
  night, a hover crosshair and a tooltip per night ("3 of 4 · First-attempt gate pass · Sun 8 Nov
  · last night"). They are focusable and have an `aria-label` that lists all 7 values.

**Honest counters always come in pairs**, so a good number can't hide a bad one:
- First-attempt gate pass, paired with "test or gate edits by the builder"
- Merged without intervention, paired with "reverted after merge"
- Questions asked, paired with "assumed decisions you changed"

**Now card (In flight):** tasks and gates side by side. Tasks are listed by their tasks.md text,
and gates as Typecheck, Lint, Unit tests, E2E, Build ("judged by exit code"). Each row is 28px
with an icon: done = check circle, running = spinning loader in purple, pending = empty circle
in disabled text, failed = X in error red. Under them is a 5-line session log in monospace on the
body background. The newest line slides in and shows in primary text.

**Up next card:** runway changes in order with tasks and an estimated duration each. The header
shows the landing estimate ("lands ≈05:34").

## Mapping to Astryx

| Sketch part | Astryx / implementation |
|---|---|
| Flight path track, segments, needle | Custom component (no Astryx equivalent); render with plain divs and percentages like the sketch, styled with StyleX and theme variables |
| Segment / sparkline tooltip | `Tooltip` (labels set as text, never HTML) |
| Table view | `Table` + `Collapsible` for the disclosure |
| Context meter | `ProgressBar` if it accepts a custom color; otherwise a small custom bar |
| Running gate icon | `Spinner` or `Icon` with spin; colored `--color-live` |
| Session log | `CodeBlock` or a plain `pre` (render as text, never HTML) |
| Times | `Timestamp` where absolute, tabular numbers everywhere |
| Sparkline | Custom SVG (follow the `dataviz` skill for marks and the accessible fallback) |

## HTML Structures

```html
<div class="fp">
  <div class="fp-head"><span class="label">Flight path</span>
    <span class="fp-legend"><span class="lg"><i class="done"></i>Done</span><span class="lg"><i class="live"></i>Building now</span><span class="lg"><i class="est"></i>Estimate</span></span></div>
  <div class="fp-track">
    <div class="seg done" data-seg="0" tabindex="0" role="img" aria-label="2h 10m, Table ordering, 22:10–00:20 · PR #41"
         style="left:0%;width:calc(24.5% - 2px)"><span class="seg-l full">4 Table ordering</span><span class="seg-l short">4</span></div>
    <div class="seg live" data-seg="1" tabindex="0" role="img" aria-label="…" style="left:24.8%;width:calc(17.9% - 2px)">…</div>
    <div class="seg est" …>…</div>
    <div class="needle" style="left:42.7%"><span>now 01:58</span></div>
  </div>
  <div class="fp-axis"><span class="tick" style="left:…">23:00</span>…<span class="tick end" style="left:100%">07:00</span></div>
  <div class="fp-cap"><span class="sup">Lands ≈05:34, before the 07:00 stop. Estimates come from your last 7 nights.</span>
    <button class="disclosure">Show as table</button></div>
</div>
```

Stat tile:

```html
<div class="card kpi">
  <div class="kpi-l"><svg class="ic sm">…</svg>Context, this session</div>
  <div class="kpi-row"><div class="kpi-v">152k</div><!-- optional sparkline svg --></div>
  <div class="sup">of a 400k budget · hands off cleanly at the limit</div>
  <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="38"><i style="width:38%"></i></div>
</div>
```

## CSS Patterns

```css
.fp { margin-top: 20px; }
.fp-track { position: relative; height: 28px; border-radius: 6px; background: var(--color-neutral); margin-top: 28px; }
.seg { position: absolute; top: 0; bottom: 0; border-radius: 4px; display: flex; align-items: center; padding: 0 8px;
       transition: filter .15s ease, left .6s ease, width .6s ease; }
.seg:hover, .seg:focus-visible { filter: brightness(1.1); }
.seg.done   { background: var(--color-seg-done); color: #111; }
.seg.live   { background: var(--color-live); color: light-dark(#fff, #111); animation: breathe 2.4s ease-in-out infinite alternate; }
.seg.est    { background: color-mix(in srgb, var(--color-seg-done) 24%, transparent); color: var(--color-text-secondary); }
.seg.hold   { background: color-mix(in srgb, var(--color-seg-done) 48%, transparent); color: var(--color-text-secondary); }
.seg.parked { background: var(--color-warning); color: #111; }
.seg.stopped{ background: var(--color-error); color: light-dark(#fff, #111); }
.seg.est.ghost { opacity: .5; }                       /* alarm: what resuming now would do */
.seg.cut { border-top-right-radius: 0; border-bottom-right-radius: 0; }
@keyframes breathe { from { opacity: .8; } to { opacity: 1; } }
/* E only */
.seg.live { box-shadow: 0 0 14px color-mix(in srgb, var(--color-live) 55%, transparent); }

.needle { position: absolute; top: -6px; bottom: -6px; width: 2px; margin-left: -1px; background: var(--color-text-primary);
          border-radius: 1px; transition: left .6s ease; pointer-events: none; }
.needle span { position: absolute; bottom: calc(100% + 2px); left: 50%; transform: translateX(-50%); font-size: 12px; font-weight: 600; white-space: nowrap; }
.tick { position: absolute; transform: translateX(-50%); font-size: 12px; color: var(--color-text-secondary); font-variant-numeric: tabular-nums; }
.tick::before { content: ''; position: absolute; top: -6px; left: 50%; width: 1px; height: 4px; background: var(--color-border-emphasized); }

.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; margin-bottom: 24px; }
.kpi { padding: 14px 16px; display: flex; flex-direction: column; gap: 2px; }
.kpi-v { font-size: 24px; line-height: 32px; font-weight: 600; }
.meter { height: 6px; border-radius: 3px; background: color-mix(in srgb, var(--color-live) 16%, transparent); overflow: hidden; margin-top: 8px; }
.meter i { display: block; height: 100%; background: var(--color-live); transition: width .6s ease; }
.meter.hot i { background: var(--color-warning); }      /* > 80% */
.spark .sp-line { fill: none; stroke: var(--color-seg-done); stroke-width: 2; }
.spark .sp-end  { fill: var(--color-live); stroke: var(--color-background-card); stroke-width: 2; }
```

Label fitting (run after render and on resize):

```js
document.querySelectorAll('.seg').forEach(seg => {
  seg.classList.remove('use-short', 'nolabel');
  const room = seg.clientWidth - 16;
  if (seg.querySelector('.full').scrollWidth <= room) return;
  seg.classList.add('use-short');
  if (seg.querySelector('.short').scrollWidth > room) seg.classList.add('nolabel');
});
```

## What to Avoid

- **Status colors on normal blocks.** Done is grey, not green. Building is purple, not blue.
  Green/blue for normal work was the "dark cockpit off" mode and was rejected.
- **A plain progress bar for the night (variant B's clock line / track).** It shows elapsed time
  but not what happened or when it lands. The flight path replaced it.
- **Estimates that look like facts.** Future blocks are always a light wash, prefixed "≈", and
  the caption says where the estimate comes from.
- **Single counters without their pair.** "Merged without intervention" alone invites gaming;
  every counter shows its paired risk counter.
- **Tooltip-only information.** Everything in a tooltip is also in the table view and the
  `aria-label`.
- **Rendering log lines or labels as HTML.** Use text content (the sketch builds tooltips with
  `textContent`).

## Origin

Synthesized from sketch: 001 (winner E; flight path introduced in round 2, variants D/E)
Source files: `sources/001-mission-page/index.html` (functions `makeSegments`, `flightSegments`,
`flightPathHTML`, `fitLabels`, `kpi`, `meter`, `spark`, `nowCard`, `upNextCard`)

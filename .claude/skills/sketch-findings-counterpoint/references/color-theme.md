# Color and Theme

## Design Decisions

**Base theme: Astryx neutral** (`@astryxdesign/theme-neutral` 0.7.x). Warm greys, monochrome accent
(near-black in light mode, near-white in dark), Figtree self-hosted, light and dark via
`light-dark()`, and a system default. The sketch theme `sources/themes/default.css` copies the
theme's own values as plain CSS variables, so sketches look like the real console. In `ui/`, keep
importing the real theme (`ui/src/styles.css`), not this file.

**Type scale:** base 14px / 20px line height, ratio 1.2, line heights snapped to 4px. Supporting
12px, heading 20px/28px, display 29px/36px. The Mission hero goes beyond the scale: greeting
28px/36px and figure 60px/64px. Numbers use tabular figures everywhere. Code and logs use the
system monospace stack at 12 to 13px.

**Spacing:** 4px steps (4, 8, 12, 16, 24, 32, 48). Cards pad 16px horizontally, page gaps are 24px.

**Shapes:** inner radius 6px (badges), element radius 10px (buttons, inputs, nav items), container
radius 12px (cards, dialogs), full for chips and avatars. Elements are 28px (small) or 32px tall.

**Dark cockpit (the core color rule):** when everything is normal, the page stays grey and quiet.
Status colors appear only for exceptions:
- warning yellow: parked items, the context meter above 80%
- error red: stopped runs, failed gates, No-go checks, the alarm hero
- green and blue are **not** used for normal states (passed gates, "on runway", "in flight").
  Done is grey and passed is a grey check.

**One non-status hue means "live": Astryx purple.**

```css
--color-live: light-dark(#980fb2, #d885eb);   /* building now, running gate, meter, sparkline end */
--color-seg-done: light-dark(#8f8f8f, #8a8a8a); /* finished work on the flight path and sparklines */
```

Both were checked with the dataviz validator against the card surfaces. Live and done stay
distinct for color-vision deficiencies and normal vision, and both reach at least 3:1 contrast
in light and dark. These are the only two tokens the sketch adds to the Astryx theme; the console
needs to define them (for example as StyleX variables or CSS custom properties on the theme root).

Where purple appears: the In flight chip (text + 14% purple background + pulsing halo), the live
flight-path block (+ glow in E), the running gate icon, the context meter, the sparkline end dot,
and the stat-tile icons in E. Nowhere else.

**Time-of-day ambience, hero only (what made E win over D):** the hero card's background becomes a
soft two-stop gradient that matches the time of the run. These are decoration colors from the
theme's background palette, mixed into the card color, and never status colors:
- `dusk` (Launch): orange → purple
- `night` (In flight, Holding): purple → blue
- `dawn` (Debrief): pink → orange
- Stopped/alarm: no ambience. It uses the alarm treatment (error border and a 30% red-tinted
  background).

In vivid mode the hero loses its border. The flight-path track becomes a translucent card color
so the gradient shows through, and the live chip becomes a translucent card-colored pill.

**Council seats as colored initials:** 24px circles with 10px weight-600 initials. Each seat gets
a decorative hue from the theme (Design = pink, QA = teal, Cook = orange). These are
identification colors, not status.

## CSS Patterns

```css
/* dark cockpit: quiet by default */
.badge { background: var(--color-neutral); color: var(--color-text-secondary); }
.badge.warning { background: var(--color-background-yellow); color: var(--color-text-warning); }
.badge.error   { background: var(--color-background-red);    color: var(--color-text-error); }
.grow.pass .g-ic { color: var(--color-text-secondary); }   /* not green */
.grow.fail .g-ic { color: var(--color-text-error); }
.synth .grow.run .g-ic { color: var(--color-live); }

/* live chip */
.chip { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px 0 8px; border-radius: var(--radius-full);
        background: var(--color-neutral); color: var(--color-text-secondary); font-size: 12px; font-weight: 600; }
.chip .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; position: relative; }
.chip.live { color: var(--color-live); background: color-mix(in srgb, var(--color-live) 14%, transparent); }
.chip.live .dot::after { content: ''; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid currentColor; opacity: 0; animation: halo 1.8s ease-out infinite; }
@keyframes halo { 0% { transform: scale(.6); opacity: .7; } 100% { transform: scale(1.7); opacity: 0; } }
.chip.alarm { color: var(--color-text-error); background: var(--color-background-red); }

/* alarm hero */
.hero.alarm { border-color: var(--color-text-error); background: color-mix(in srgb, var(--color-background-red) 30%, var(--color-background-card)); }

/* ambience (E) */
.hero:not(.alarm) { border-color: transparent; }
.hero[data-amb="dusk"]  { background: linear-gradient(115deg, color-mix(in srgb, var(--color-background-orange) 65%, var(--color-background-card)), color-mix(in srgb, var(--color-background-purple) 60%, var(--color-background-card))); }
.hero[data-amb="night"] { background: linear-gradient(115deg, color-mix(in srgb, var(--color-background-purple) 70%, var(--color-background-card)), color-mix(in srgb, var(--color-background-blue) 55%, var(--color-background-card))); }
.hero[data-amb="dawn"]  { background: linear-gradient(115deg, color-mix(in srgb, var(--color-background-pink) 60%, var(--color-background-card)), color-mix(in srgb, var(--color-background-orange) 60%, var(--color-background-card))); }
.fp-track { background: color-mix(in srgb, var(--color-background-card) 55%, transparent); }
.chip.live { background: color-mix(in srgb, var(--color-background-card) 70%, transparent); }

/* seat avatars */
.av { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-size: 10px; font-weight: 600; }
.av.pink   { background: var(--color-background-pink);   color: var(--color-text-pink); }
.av.teal   { background: var(--color-background-teal);   color: var(--color-text-teal); }
.av.orange { background: var(--color-background-orange); color: var(--color-text-orange); }
```

Theme tokens used most (all in `sources/themes/default.css`): `--color-background-body/-surface/-card`,
`--color-neutral` (hover and quiet fills), `--color-border`, `--color-border-emphasized`,
`--color-text-primary/-secondary/-disabled`, `--color-text-warning/-error`, `--color-accent` /
`--color-on-accent` (primary buttons, selected nav item, focus ring), `--color-warning`,
`--color-error`, and the `--color-background-{orange,purple,blue,pink,teal}` decoration palette.

## What to Avoid

- **"Dark cockpit off" (everything colored by status).** It was tried as a toggle: green for
  passed and on runway, blue for in flight, yellow for holding. It was rejected because the page
  was never quiet, so real exceptions stopped standing out.
- **Using a status color to mean "live".** Blue reads as info and green reads as success. Purple
  carries no status meaning in this theme, so it can safely mean "happening now".
- **Ambience outside the hero, or on the alarm.** The gradient is mood for the time of night,
  not a signal, so it stays in one place and disappears when something is actually wrong.
- **Holding styled as a warning.** A usage-limit hold is normal and self-resolving: grey pause
  icon, grey wash on the timeline, calm copy.
- **A colored accent or brand hue.** The accent stays monochrome; primary buttons are black on
  light and white on dark.
- **Shadows on cards.** Cards stay flat; `--shadow-high` is only for popovers, tooltips, dialogs
  and toasts.

## Origin

Synthesized from sketch: 001 (winner E over the calmer D)
Source files: `sources/themes/default.css` (theme + the two new tokens),
`sources/001-mission-page/index.html` (CSS blocks "Synthesis D/E" and "E · vivid")

# Interaction

## Design Decisions

**Buttons appear only for decisions.** The owner never moves work by hand. The only actions on
Mission are decisions: Launch, Stop, Resume, Approve, Merge, Retry tonight, Later, Keep or Change
an assumed decision, pick A or B, and Dismiss. Everything else (cards moving, plans finishing,
gates running) happens on its own and simply shows up.

**Signing happens in the owner's terminal, never in the browser.** Approve and Merge open a
dialog that explains what signing does and shows the exact command with a Copy button:
`counterpoint approve 6`, `counterpoint merge 41`. It also says "it asks for your passphrase".
Fixing auth works the same way (`claude /login`). Counterpoint never signs in for the owner.
Dialog copy, kept from the sketch:
- Approve: "Approving signs this exact version of the phase onto the runway … If the phase
  changes after you sign, it leaves the runway and shows up in Needs You."
- Merge: "Only your signed merge commit lands it … Gates re-run on the merge result before it lands."

**Needs You is a keyboard inbox (In flight, and wherever it carries key hints):**
- `J` / `K` move the focus row (inset 2px accent bar + neutral background)
- `Enter` runs the row's first action
- `L` = Later (snooze until tomorrow morning)
- `A` / `B` pick an option on a council question
- Keys are ignored while a dialog is open or an input has focus. The hints show in the card
  header as `Kbd` chips and hide on narrow widths.
- Each row has an icon (or a seat avatar), a one-line title, a one-line detail ("Phase 7 · not
  blocking · A: … · B: …"), and small buttons. The first action is secondary and the rest are
  ghost.
- A resolved row fades out (opacity 0 over about 180ms), then the list re-renders and a toast
  confirms what happened ("Picked A. Written to Phase 7 decisions as a signed-off choice.").
- Empty: "Nothing needs you. Go do something else."
- The Needs You count also shows in the side nav.

**Go/No-go gates Launch (Launch mode):** a checklist card with six checks: Sandbox probe, GitHub
CLI signed in, Runway signed and unchanged, Gate config approved, Mac stays awake, and Usage window
fresh. Each row shows GO or NO-GO (12px, weight 600, letter-spaced). A No-go row turns error red
and swaps its detail for the fix ("On battery. Plug in, or the Mac may sleep mid-run."). The
footer says why Launch is disabled ("1 No-go. Launch waits until every check is Go.") until
every check is Go and at least one phase is included. In the real app the checks come from
doctor/trust, not clicks.

**Flight plan (Launch mode):** runway phases with checkboxes to include or exclude them for
tonight, in build order, each with its plan count, signed time and ≈ duration. A phase that
changed after signing is listed separately as not included, with See change / Re-approve….

**Settings (Launch mode, compact):** one summary line in the card header ("Stop 07:00 · Opus 5.5
· 40% context per session (400k tokens)") with a Change button that expands three selects:
stop time, model and context budget. The budget is a percentage of the model's own window.

**Debrief actions:** Ready for review rows offer PR ↗, Preview ↗ and Merge…. Parked cards show
the failing gate's last lines inline in a log block, plus Open full log, Retry tonight and Later.
Assumed decisions offer Keep or Change… per row, and Keep all in the header.

**Motion is only for things that are actually happening:**
- live chip halo (1.8s), live block breathing (2.4s), running gate spinner (1.8s)
- needle, segment widths, meter and progress move with a 0.6s ease when time advances
- the newest session-log line slides in over 0.6s
- hover and focus transitions take 0.15s; hero background changes take 0.4s
- everything stops under `prefers-reduced-motion: reduce`

**Toasts** confirm every decision. They sit bottom-center, use the accent background and the
high shadow, 13px text, and disappear after about 2.6s. Example: "Phase 5 is green. PR #42
opened with a preview link."

**Live updates feel calm:** the page re-renders as the night advances (in the real app, from SSE).
The hero region is `aria-live="polite"`, so changes are announced without interrupting.

**Focus:** `:focus-visible` gives a 2px accent outline with a 3px offset on everything
clickable, including flight-path blocks and sparklines.

## Mapping to Astryx

| Sketch part | Astryx |
|---|---|
| Approve / Merge / How to fix dialogs | `Dialog` + `DialogHeader` (an `ApprovalDialog` already exists in `ui/src/components/`) |
| Command line with Copy | `CodeBlock` or `Code` + `useClipboard` |
| Key hints | `Kbd` |
| Toasts | `useToast` |
| Polite announcements | `useAnnounce` (already used on Mission for the runway figure) |
| Go/No-go rows | `List` / `ListItem` with `Icon`; Launch is a primary `Button` with `disabled` |
| Flight plan checkboxes | `CheckboxInput` |
| Settings selects | `Selector` |
| Small row buttons | `Button` (small size, secondary / ghost variants) |
| Session log disclosure | `Collapsible` |

## HTML Structures

Needs You row:

```html
<li class="nrow focus" data-row="q1">
  <span class="av pink" title="Design seat">DS</span>
  <div class="n-main">
    <div class="n-title">Design seat: Bill split empty state, A or B?</div>
    <div class="n-detail">Phase 7 · not blocking · A: illustration and "Split evenly" · B: plain list with totals</div>
  </div>
  <div class="n-act"><button class="btn sm secondary">A</button><button class="btn sm ghost">B</button><button class="btn sm ghost">Later</button></div>
</li>
```

Go/No-go:

```html
<section class="card">
  <div class="card-h"><span class="label">Go / No-go</span></div>
  <ul class="nlist">
    <li class="check"><span class="c-ic">✓</span><div class="n-main"><div class="n-title">Sandbox probe</div>
      <div class="n-detail">Agents can't read your keys or reach the console</div></div><span class="go">GO</span></li>
    <li class="check nogo"><span class="c-ic">✗</span><div class="n-main"><div class="n-title">Mac stays awake</div>
      <div class="n-detail">On battery. Plug in, or the Mac may sleep mid-run.</div></div><span class="go">NO-GO</span></li>
  </ul>
  <div class="launchbar"><span class="sup">1 No-go. Launch waits until every check is Go.</span>
    <button class="btn primary" disabled>Launch</button></div>
</section>
```

Signing dialog:

```html
<dialog>
  <div class="dlg-h"><h2 class="h2">Merge PR #41</h2></div>
  <div class="dlg-b">
    <p class="muted">Only your signed merge commit lands it. Run this in your terminal; it asks for your passphrase.</p>
    <div class="codeline"><span>counterpoint merge 41</span><button class="btn sm ghost">Copy</button></div>
    <p class="sup">Gates re-run on the merge result before it lands.</p>
  </div>
  <div class="dlg-f"><button class="btn secondary">Close</button></div>
</dialog>
```

## CSS Patterns

```css
.nrow { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--color-border); transition: background .15s ease, opacity .2s ease; }
.nrow.focus { background: var(--color-neutral); box-shadow: inset 2px 0 0 var(--color-accent); }
.nrow.leaving { opacity: 0; }
.n-title, .n-detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.n-detail { font-size: 12px; color: var(--color-text-secondary); }

.check { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--color-border); }
.check .go { margin-left: auto; font-size: 12px; font-weight: 600; letter-spacing: .06em; color: var(--color-text-secondary); }
.check.nogo .c-ic, .check.nogo .go { color: var(--color-text-error); }

.btn { height: 32px; padding: 0 12px; border-radius: var(--radius-element); border: 1px solid var(--color-border-emphasized);
       background: var(--color-background-surface); font-weight: 500; transition: all .15s ease; }
.btn.primary { background: var(--color-accent); color: var(--color-on-accent); border-color: transparent; }
.btn.ghost { border-color: transparent; background: transparent; color: var(--color-text-secondary); }
.btn.sm { height: 28px; padding: 0 8px; font-size: 13px; }
.btn:disabled { opacity: .4; cursor: not-allowed; }
:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 3px; }

.toast { background: var(--color-accent); color: var(--color-on-accent); padding: 8px 14px; border-radius: var(--radius-element);
         box-shadow: var(--shadow-high); font-size: 13px; animation: tin .18s ease; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
```

Keyboard triage:

```js
document.addEventListener('keydown', e => {
  if (dialogOpen || /input|select|textarea/i.test(e.target.tagName)) return;
  const n = needs[focus];
  if (e.key === 'j') focus = Math.min(focus + 1, needs.length - 1);
  else if (e.key === 'k') focus = Math.max(focus - 1, 0);
  else if (!n) return;
  else if (e.key === 'Enter') runAction(n, n.actions[0]);
  else if (e.key === 'l') later(n);
  else if ((e.key === 'a' || e.key === 'b') && n.kind === 'question') pick(n, e.key.toUpperCase());
});
```

## What to Avoid

- **Drag and drop, or any action that moves work by hand.** The owner decides; agents move.
- **Signing or merging with a browser click.** The approval key is never cached and agents can
  reach the console, so signing always happens in the owner's terminal with a passphrase.
- **Interrupting modals for questions.** Council questions wait in Needs You, marked "not
  blocking"; only irreversible work parks.
- **Ceremony without meaning.** Go/No-go checks are real preconditions (sandbox, gh, signatures,
  power, usage); each No-go names its fix.
- **Motion as decoration.** Nothing animates unless something is happening, and all motion
  respects reduced-motion.

## Origin

Synthesized from sketch: 001 (B's keyboard inbox and live rows, C's Launch/Debrief cards, inside winner E)
Source files: `sources/001-mission-page/index.html` (functions `needsHTML`, `needsCard`,
`goNoGoCard`, `flightPlanCard`, `settingsCard`, `act`, the keydown handler, `toast`, `openDlg`)

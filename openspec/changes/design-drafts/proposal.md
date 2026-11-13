# Design Drafts

## Why

Reviewing screens before they are built is where changes are cheapest. Builders left alone produce unusable UIs, such as a 20-field form built as 20 loose inputs. The owner should be able to steer standalone drafts in the host's own design system with pins, redraws and variants, sign one off, and have the builder build to it.

## What Changes

- Screen drafts for a change: standalone local HTML with real-looking data, in the host's own design system, served on an origin isolated from the console API; mobile/desktop and empty/loading/error/long-text toggles.
- Low-fi "wire" exploration, then a hi-fi "full" render with the host's tokens and fixtures.
- Element-pinned comments, batched into one revision that changes only the targeted parts; resolvable threads; whole redraws with a steering note. The in-house pin overlay (Shadow DOM, injected by the draft server, anchored on stable `data-cp-id`s) is built here, and `pr-revisions` reuses it.
- 2-3 variants side by side; pick one or "More like B" with an optional steering note, with a breadcrumb trail to back up.
- Sign-off in one click. The signed-off render is committed into the change's folder and given to the builder as the reference for that screen.
- A design-rules file per host: the layout and density rules every draft and every builder follows.

The visual gate (checking built screens against the signed-off render) moved to `docs/backlog.md` on 2026-11-12.

## Capabilities

### New Capabilities
- `design-drafts`: requesting, serving, commenting on, revising, choosing and signing off screen drafts.

### Modified Capabilities
None.

## Impact

- Draft server on a separate loopback port; pin overlay script; Playwright screenshots on the server side.
- Research spikes first: rendering Cena screens in fixture mode, and keeping `data-cp-id` stable across revisions.
- Depends on `run-as-owner`. Comes before `pr-revisions`, which reuses the pin overlay.
- Open for design: the design-rules file's format and where it lives in the host.

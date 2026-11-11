# Design Drafts & Visual Gate

## Why

Reviewing screens before they are built is where changes are cheapest, and a signed-off design is only binding if the build is checked against it. The owner should be able to steer standalone drafts in the host's own design system with pins, redraws and variants, sign off a hi-fi render as part of the runway approval, and have the build fail when it drifts from it.

## What Changes

- Screen drafts for a change: standalone local HTML with fixture data, in the host's own design system, served on an origin isolated from the console API; mobile/desktop and empty/loading/error/long-text toggles.
- Low-fi "wire" exploration, then a hi-fi "full" render with the host's tokens and fixtures.
- Element-pinned comments (an in-house overlay injected by the draft server, anchored on stable `data-cp-id`s), batched into one revision that changes only the targeted parts; resolvable threads; whole redraws with a steering note.
- 2-3 variants side by side; pick one or "More like B" with an optional steering note, with a breadcrumb trail to back up. This round model is built once here and reused by council cards.
- Signing off the full render joins the change's runway approval (the statement's draft slot).
- A structural visual gate: built screens are compared with the signed render by landmark regions; drift fails the gate with a side-by-side image. Pixel diff is deferred.

## Capabilities

### New Capabilities
- `design-drafts`: requesting, serving, commenting on, revising and choosing screen drafts.
- `visual-gate`: checking built screens against the signed-off render.

### Modified Capabilities
- `signed-approvals`: the approval statement binds the signed-off full render.

## Impact

- Draft server on a separate loopback port; pin overlay script; Playwright screenshots on the server side.
- Signed-off drafts are committed into the change's directory, so they are covered by the approval like every other file there.
- Research spikes first: rendering Cena screens in fixture mode, and keeping `data-cp-id` stable across revisions.
- Can be planned alongside `morning-review-signed-merge`; it needs only the gate runner from `first-unattended-run` and the approvals from the trusted shell.

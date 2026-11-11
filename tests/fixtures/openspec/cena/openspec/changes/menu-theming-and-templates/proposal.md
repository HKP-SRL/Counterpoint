## Why

Visual quality is Cena's differentiator. An owner must be able to make the menu look deliberately designed — by choosing a template and applying guardrailed brand controls — and every template must look intentional whether the venue has zero, some or a full set of photos, without any brand choice ever breaking legibility. Deep per-venue customisation is out of scope precisely because venues would make ugly menus.

## What Changes

- A set of well-designed diner menu templates an owner can choose from, applied to the live diner menu.
- Brand controls within guardrails: colour palette, font pairing, logo and cover image.
- Every template verified attractive in zero-photo, some-photo and full-photo states.
- No brand-control combination can produce an inaccessible menu: the venue-theme contrast guardrail from `design-system-migration` is enforced on every owner choice.
- First user-facing surface for "owner/manager can edit theming and venue settings" (ACCT-07), so far proven only at the database layer.
- The Cena dark ramp, left unwired by `design-system-migration`, is wired here if any dark surface ships, and its pairs join the contrast sweep first.

## Capabilities

### New Capabilities

- `menu-theming`: templates and guardrailed brand controls for the diner menu (THEME-01, THEME-02, THEME-03, THEME-04; re-tests ACCT-07 for theming as a user flow).

### Modified Capabilities

(none — builds on the venue token contract in `design-system`)

## Impact

- Depends on `live-menu-for-diners` (the diner render surface); can run in parallel with `rich-menu-content`. The zero/some/full-photo check uses the photo pipeline from `rich-menu-content` when available.
- Consumes the venue token namespace and contrast guardrail from `design-system-migration`; the diner menu stays Astryx-free; owner brand-control screens are built on Astryx.
- Logo and cover image storage in Supabase Storage, RLS-protected per venue.

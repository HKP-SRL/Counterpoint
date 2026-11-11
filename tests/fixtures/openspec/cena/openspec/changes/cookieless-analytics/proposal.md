## Why

Owners want to know how diners engage with their menu — which dishes get viewed, which languages are used, when the venue is busy — but a consent wall in front of the menu is exactly the friction Cena exists to remove. Analytics must therefore be aggregate and cookieless, with no personal identifiers, so no consent banner is ever needed (GDPR and ePrivacy).

## What Changes

- Record diner menu activity (menu opens, item views, language used, time) with no cookies, no local identifiers and no personal data.
- An owner-side dashboard showing aggregate dish views, language split and busy hours per venue.

## Capabilities

### New Capabilities

- `menu-analytics`: cookieless diner activity capture and the owner's aggregate insights (ANLY-01, ANLY-02).

### Modified Capabilities

(none)

## Impact

- Depends on `live-menu-for-diners` (the diner surface to instrument).
- Server-side event capture into Supabase (no third-party analytics such as GA4 — see docs/research/STACK.md); aggregates readable only by the venue's owner/managers via RLS.
- Owner dashboard built on Astryx; diner-side capture must not add measurable weight to the diner page.

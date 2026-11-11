## Why

The design system imported from claude.ai/design ("Cena Design System", project `07b799d4-de60-4b17-8aec-106904d0b264`) was authored from a one-sentence brief with no access to Cena's scope. Audited against the product brief it raised five blockers (`docs/research/DESIGN-SYSTEM.md`): it sold the all-or-nothing suite Cena positions against, had no diner surface at first, designed deferred tiers (service floor, ticketing, payments) and an unscoped one (reservations, "The Book"), and assumed a desktop-fixed back office. Its foundation — tokens, contrast discipline, interaction grammar, voice register — was strong. The repo still shipped the shadcn starter layer (Inter, a green accent, zinc neutrals), so every later change that renders UI would otherwise have invented its own vocabulary or been re-done after the fact.

This change adopts the foundation, rejects or re-authors the surfaces the import got wrong, and lands before any further UI work so later changes design against a system that matches what Cena is.

## What Changes

- Replace the shadcn visual layer with Cena's product brand: Szeged azure accent, napfeny gold under a ~5% cap, paprika for destructive, tisza neutrals, in three token files (`primitives`, `cena`, `venue`) behind one stylesheet entry point that declares no colour of its own.
- Self-host Newsreader, Instrument Sans and IBM Plex Mono (latin + latin-ext, roman only) and remove the Google Fonts CDN request; guard "no third-party font or asset request" in source and in compiled CSS, with one allow-listed origin for Google sign-in.
- Add a venue-themable `--venue-*` token namespace (no v1 consumer) and a WCAG AA contrast guardrail: a zero-dependency WCAG 2.1 contrast function, a 20-pair sweep over Cena's palette, and a total `resolveVenueTheme` that derives text colours.
- Bring the primitive set to nineteen — eight added (select, radio group, switch, field, tabs, tooltip, separator, tag) and eleven existing re-skinned — plus an icon wrapper pinning a 1.75 stroke; raise every interactive control to a universal 44px touch floor.
- Re-skin every surface shipped by `multi-tenant-foundation` — sign-up, sign-in, password reset, dashboard, venue create/edit, venue switcher, staff provisioning, device enrolment and the shared-tablet screens — with that change's test suite as the unchanged regression gate.
- Define the diner design vocabulary before any diner screen exists: the 14-category EU Annex II allergen set in hu/en/ro (the import shipped 7), a three-language diner copy deck with a timestamped last-good notice, and per-currency price formatting for RON, HUF and EUR.
- Define unverified-AI-field marking at token and primitive level as the owner-side pattern it is.
- Fold every un-contracted owner string into the copywriting contract and re-cut the voice lexicon to menu-tier words; guard both with a test.
- Archive the deferred Service kit and The Book to `docs/design-archive/`; record (not apply) corrections to the design project's own `readme.md`.
- Fix two venue defects left open by `multi-tenant-foundation`, in files this change re-skins: a EUR venue could not be created, and the venue switcher was stale after creating a venue.
- Close a post-implementation code review: an outage in which Tailwind compiled a planning document into invalid CSS, OS-driven dark toasts, reduced-motion gaps, and several smaller defects.

## Capabilities

### New Capabilities
- `design-system`: Cena token layer as the single styling source, self-hosted typefaces and asset privacy, the nineteen primitives on Radix behaviour, the 44px touch floor, the venue token contract and its AA guardrail, unverified-AI-field marking, and owner copy discipline.
- `diner-design-vocabulary`: the EU allergen vocabulary, the three-language diner copy deck and per-currency price display that every diner surface renders against.

### Modified Capabilities
- `venues`: a venue can be created when its only enabled language is locked (EUR venues), and the venue switcher lists a newly created venue at once.

## Impact

- Delivers no v1 requirement ID directly; it is an enabling change and a hard prerequisite for THEME-01..04. It supplies vocabulary consumed by DINE-01/02/04/05/06, MENU-09/10, LANG-05/06, THEME-03, ACCT-02 and INGEST-04/06 in later changes, and clears the currency blocker on ACCT-03.
- Code: `app/tokens/*.css`, `app/globals.css`, `app/layout.tsx`, `components/ui/*` (20 files), every page and component of the auth, dashboard and tablet route groups, `components/venue-form.tsx`, `actions/venues.ts`, `lib/copy.ts`, and new modules `lib/theme/contrast.ts`, `lib/theme/venue-tokens.ts`, `lib/format/money.ts`, `lib/allergens.ts`, `lib/diner-copy.ts`.
- Tests: seven files under `tests/theme/`, plus `tests/format/money.test.ts`, `tests/lib/allergens.test.ts`, `tests/lib/diner-copy.test.ts`, `tests/lib/copy-contract.test.ts`, `tests/venues/venue-eur-submission.test.tsx` and `tests/actions/create-venue-revalidation.test.ts`. Suite grew from 462 to 786 tests, all green.
- Dependencies: none added; `next-themes` removed.
- Docs: UI contract at `docs/design/ui-contract-design-system-migration.md` (parsed by `tests/theme/design-system-discipline.test.ts`); design archive at `docs/design-archive/`.

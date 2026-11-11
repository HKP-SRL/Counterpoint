## Context

Cena's repo shipped the shadcn starter layer: Inter, a `#16A34A` green accent, zinc neutrals and eleven Radix primitives behind the surfaces `multi-tenant-foundation` built (sign-up, sign-in, password reset, dashboard, venue create/edit, venue switcher, staff provisioning, device enrolment, and the shared-tablet screens). A full design system had meanwhile been authored in claude.ai/design ("Cena Design System", project `07b799d4-de60-4b17-8aec-106904d0b264`).

**Why the imported design was audited, and why parts of it were rejected.** The design system says of itself that it was written from one sentence — "a restaurant OS for independent restaurants, warm feeling, organic, almost Italian, we will be using Tailwind" — with no codebase, scope or screens supplied. The import audit (`docs/research/DESIGN-SYSTEM.md`, 2026-08-02) checked it against the product brief and found five blockers:

- **B-1** its positioning sold "one system covers the floor, the book and the back office" — the all-or-nothing suite Cena exists to attack;
- **B-2** no diner surface existed (resolved before implementation by a new `templates/qr-menu/` in the design project);
- **B-3** its Service kit designed table management, waiter ordering and payments, all deferred tiers;
- **B-4** "The Book" (reservations, waitlist, covers) is not a Cena product at all;
- **B-5** the back office was desktop-fixed while Cena requires mobile-first admin.

It also carried warnings that shaped this change: **W-2** fonts loaded from the Google Fonts CDN on the diner critical path, **W-3** one continental currency rule that is wrong for zero-decimal HUF, **W-4** a voice lexicon drawn from the deferred tiers, **W-5** hand-rolled primitives with no focus management or ARIA. The audit's own decisions — **D-1** archive Service and The Book, **D-2** re-skin Radix rather than adopt the design system's JSX primitives, **D-3** split product brand from venue theme — are cited with single-digit IDs to keep them apart from this change's D-01…D-14.

The verdict: adopt the foundation (tokens, contrast discipline, interaction grammar, voice register) nearly intact; reject or re-author the product surfaces. A live re-read on 2026-08-04, two days after the audit, found the brand had pivoted from terracotta to Szeged azure and the diner template now existed; the audit carries that delta at its top.

**The diner template was a spec, not code.** `QrMenu.dc.html` is written for another runtime (`<x-dc>`, `<sc-if>`, inline styles, no Tailwind). Its README claimed coverage of eleven requirement IDs; verified against its source, 1 held, 10 were partial, 0 were outright false. Its allergen list was 7 of the 14 EU categories while claiming "Allergens are the EU set". Its offline copy blamed the diner's connection for what is really a failed background regeneration. Its contrast reference implementation never linearised the blue channel (black on white measured 387.78:1). These findings are why every diner pattern was verified, then adopted or re-authored, rather than ported.

The surfaces' visual and interaction contract lives in `docs/design/ui-contract-design-system-migration.md`; `tests/theme/design-system-discipline.test.ts` parses its residue table, so that file is load-bearing.

The change's five success criteria are cited as SC1–SC5: **SC1** tokens are the single styling source, typefaces self-hosted for RO/HU, no third-party font or asset request; **SC2** every primitive carries the Cena language and the existing test suite passes unchanged; **SC3** every shipped surface renders in the system and is usable one-handed on a phone; **SC4** brand separated from a themable venue contract, with an automated AA guardrail; **SC5** a diner vocabulary for last-good state, language switch and allergens, with unverified-AI-field marking defined as the owner-side pattern it is.

## Goals / Non-Goals

**Goals:**
- Make the Cena tokens the single styling source, with self-hosted typefaces and no third-party font or asset request.
- Carry all nineteen primitives in the Cena language on unchanged Radix behaviour, at a universal 44px touch floor.
- Re-skin every surface `multi-tenant-foundation` shipped without changing the meaning of any existing test.
- Build the brand/venue token boundary and the AA contrast guardrail now, while nothing consumes the venue half.
- Give every later diner change one vocabulary — allergens, diner copy, prices — instead of inventing it under time pressure.
- Define unverified-AI-field marking once, at token and primitive level.

**Non-Goals:**
- Venue theming UI, venue font pairings beyond Cena's own, or any venue-branded diner surface (left to `menu-theming-and-templates`).
- Building any diner screen, route or QR payload (left to `live-menu-for-diners` and later changes).
- Wiring a dark UI.
- Re-authoring the design project's marketing, service or back-office kits; building a marketing site; a logo.
- Owner-side patterns beyond the unverified marker: per-language authoring (LANG-01..04) and the QR print sheet (DINE-01).
- Deciding the `.design-sync/` tooling direction.

## Decisions

### D-01 — Adopt the Szeged palette as Cena's product brand, as-is
Szeged azure (`#0B5FA5`) primary, napfeny gold accent under a ~5% per-screen cap and never a surface, paprika for destructive, tisza as the only neutral.
**Rationale:** the system was fully built, every pair AA-measured by hand, and it leans into Hungary, the sharper market wedge because it displaces paper rather than a competitor.
**Alternatives:** return to the original warm/Italian brief (re-author tokens, 21 guideline cards and both templates); keep the four-ramp structure but re-hue it warm; render specimens first. **Trade-off accepted knowingly:** a city-heraldry brand is an awkward anchor for later EU expansion. Reversal is costly.

### D-02 (revised 2026-08-04) — v1 renders every surface in Cena's design, the diner menu included
**Rationale:** owner/venue customisation of the UI is a later milestone; v1 ships one brand. The template's gold badge and azure button on the diner surface are therefore Cena's own colours doing their job, not violations.
**Superseded:** the original D-02 kept Cena azure off the diner surface entirely and gave the diner menu the venue's palette and font pairing inside Cena's structure (chosen over "venue owns it entirely" and "Cena frames, venue fills"). Reversed by the owner on 2026-08-04. The token boundary is still built (D-14).

### D-03 — Venue font choice, when it ships, is a curated set of 3–4 self-hosted pairings
Each pairing self-hosted, subset for `ă â î ș ț ő ű` and diacritic-verified. **Alternatives:** colour only (narrows THEME-02); 6–8 pairings (more bytes, more ways to look wrong); a Google Fonts picker, ruled out by SC1. v1 ships one pairing — Cena's own — so this constrains `menu-theming-and-templates`.

### D-04 — Keep the voice register verbatim; re-cut the lexicon; close the copy debt
Register: calm floor manager, second person, active present, sentence case, no emoji, errors say what happened then what to do, confirmations past tense with undo. Lexicon: drop covers, turns, the pass, fired, 86'd, the book, walk-in, close out. Close the owed copywriting-contract rows while every surface is open anyway.
**Alternatives:** re-cut the lexicon only (copy divergence survives); keep the lexicon (drift compounds). The owed rows turned out to be 40, not 6; all 40 were folded in and a test now keeps deck and contract in step.

### D-05 — Verify the diner template's coverage claims before relying on them
**Alternatives:** adopt wholesale (an unverified claim becomes settled fact); author fresh (largest scope). Result: 1 holds, 10 partial; the residue is tabled per requirement with an owning change in the UI contract.

### D-06 — Vocabulary scope is the diner surface plus unverified-field marking at token/primitive level
Unverified-AI marking is a legal release gate and cheap to define once; it is owner-side because an unverified field cannot be published. SC5's original wording placed it in the diner vocabulary; that drafting error was corrected. **Alternatives:** diner surface only; a full sweep of every owner pattern, designed against code that does not exist.

### D-07 — The last-good notice is timestamped and specific
"Saved menu from {HH:mm}. Prices and sold-out dishes may have changed." **Rationale:** a bare "Saved menu" cannot tell five minutes from five weeks, and the product brief's named risk is a diner ordering something gone for a month. The failure model is a stale prerender, not the diner's connection, so the copy promises no reconnect. **Alternatives:** quiet "Saved menu"; a prominent warning that makes the degraded state feel broken.

### D-08 — The zero-photo state is a different, typographic layout
No image slot, no wash, no stripe. **Rationale:** most independent restaurants have no photography, so this is the common case. "Some photos" is contracted as a per-section property. **Alternatives:** colour wash per item; the template's striped placeholder.

### D-09 — Self-host Cena's own pairing only: Newsreader, Instrument Sans, IBM Plex Mono
Through `next/font/google` with `latin` + `latin-ext`, roman only. **Rationale:** satisfies SC1 and removes the CDN request (W-2); Google's official `latin-ext` build avoids a custom subsetting pipeline and the OFL "Plex" reserved-name question; italics would double files on the diner critical path. **Alternatives:** all pairings now (unused until theming); defer fonts (under-delivers SC1). The single allow-listed external origin is Google Identity Services, which Google sign-in (ACCT-01) needs.

### D-10 — Keep dark tokens dormant, wire no dark UI, and never follow the device preference
**Rationale:** no criterion asks for dark mode. Dark is reachable only through an explicit class; no `prefers-color-scheme` rule touches a venue token. **In practice the dark ramp was not retrievable from the design project**, so no dark hex was invented and the `.dark` block maps to the same light tokens. Whether a Cena-branded diner menu should ever honour the device preference is open. **Alternatives:** dark owner admin now; strip dark mode out.

### D-11 — Correct the design project's positioning statement; leave its kits alone
Rewrite the readme's opening around tiered entry landing on the QR menu (B-1). **Rationale:** that readme briefs every future design pass. **Outcome:** the corrections were authored as reviewable repo text (`docs/design-archive/readme-corrections.md`) with the original kept as a rollback copy (`readme-ORIGINAL.md`); the cloud write-back was not applied, because a pre-flight showed the text could not be applied verbatim. It stays an owner decision.

### D-12 — Archive the deferred Service kit and The Book; defer the sync tooling
Seven Service kit files, `TheBook.jsx` and the service-states colour card copied byte-identical to `docs/design-archive/`. **Rationale:** they were the only copy outside a deletable cloud project. `.design-sync/` (whose config targets a deleted project) was left for a later decision once primitives existed. **Alternatives:** repoint or retire the sync now; take nothing.

### D-13 — Fix the two venue defects left open by `multi-tenant-foundation` inside the re-skin
**G-01-13** (blocker): an EUR venue could not be created — EUR seeds English as the only language, the form shows that last language disabled so it cannot be removed, and disabled controls are left out of form data, so validation rejected an empty language list. Fixed with a sibling hidden input carrying the value while the checkbox stays visibly disabled. **G-01-14** (major): venue creation redirected without refreshing the layout, so the switcher was stale; fixed by refreshing the root layout before the redirect (the dashboard route group has no URL of its own). **Rationale:** both lived in files this change re-skins; fixing then re-skinning is double work. Each fix carries a regression test observed failing first; "suite passes unchanged" is read as "no existing test changes meaning". ACCT-03 stays unticked until the owner walks the browser journey.

### D-14 — Build the brand/venue boundary and the contrast guardrail now
Tokens are namespaced Cena-fixed (`--cena-*`, plus structure tokens) versus venue-themable (`--venue-*`, hex only, no Cena ramp names, `@theme inline`). The WCAG AA sweep ships with Cena's palette as the only member of the curated set: a regression guard on Cena's own AA compliance, grown later by adding rows. **Rationale:** retrofitting a namespace means re-cutting every token consumer. **Alternatives:** defer both to the theming change.

### Further decisions taken while building
- **Four type roles, two weights.** Body 16/400, Label 14/600, Heading 20/600 serif, Display 28/600 serif. The template's eleven sizes collapse to four; raising its 10px allergen-chip type to 14px is the main accessibility fix.
- **No `subtle` ink.** The template's lowest-contrast token collapses into `--cena-ink-muted`; controls never sit on the chip surface (their border clears 3:1 only on paper and sunken).
- **Status colours are Cena-fixed forever** and permanent rows of the contrast sweep.
- **Universal 44px touch floor**, decided at the token layer rather than per surface; the checkbox's inherited hit expander turned out to reach only 40×32px and was corrected.
- **Nineteen primitives, not sixteen:** alert, avatar and dropdown menu also re-skinned; `IconButton` is `Button size="icon"`; `sonner` is the toast. Native `<select>` kept in the venue form (better one-handed; existing tests read it).
- **Glyphs through one icon wrapper at stroke 1.75**, carrying no client directive so server layouts stay on the server.
- **Contrast thresholds are non-uniform:** 4.5:1 text, 3:1 for control boundaries, focus rings and status rules, decorative rules exempt. `resolveVenueTheme` derives text colours rather than accepting them, so a below-AA set cannot be built.
- **Diner URL shape recorded, not built:** `/menu/[slug]/[lang]` static pages, `Accept-Language` negotiated by a 307, QR payload encoding the default language so the common case never redirects.
- **Prices via `Intl.NumberFormat`** with `narrowSymbol`, pinned by literal-string tests because ICU data shifts between Node majors.

### Code review fixes (2026-08-05)
A post-implementation review raised 2 critical, 9 warning and 7 info findings; all critical and warning findings were fixed and verified (build, dev-server route check, 786 tests):
- **CR-01** — Tailwind's automatic source detection scanned planning documents and compiled a prose string into invalid CSS; every route returned 500 in development while the build stayed green. Fixed fail-closed: `source(none)` plus an explicit `@source` allowlist of `app`, `components`, `lib`, `actions`.
- **CR-02** — the compiler's input was broader than the directories the quality gates police. A test now derives the expected source set from the gates' scanned set and bans `@source not`.
- **WR-01** — toasts followed the OS colour scheme through an unprovided theme hook; pinned to light and `next-themes` removed.
- **WR-02 / WR-03** — select, tooltip and button animated through `prefers-reduced-motion` or hard-coded durations; fixed and guarded by a test.
- **WR-04** — `<html lang="en">` is hard-coded in a three-language product; recorded in the root layout for the multilingual work to solve (only a root layout may render `<html>`).
- **WR-05 … WR-09** — discarded Supabase error channels (the switcher logs rather than throws, so a chrome fault cannot replace the dashboard shell), an unsubmittable zero-venue tablet form, destructive-dialog exits live during the pending transition, a leaked press-and-hold timer, and an error list keyed on a possibly-undefined value.
- **IN-01 … IN-07** were left open (see backlog).

## Risks / Trade-offs

- [Brand anchored in one city's heraldry] → accepted knowingly (D-01); reversal is costly.
- [Ramp hexes other than `#0B5FA5` were derived, not fetched] → any imported value may replace one only if the full sweep and oracle pins stay green.
- [Dark ramp never retrieved] → no dark UI is wired; dark pairs must join the sweep before any dark surface ships.
- [Translations not native-speaker reviewed; the tree-nut labels are narrower than Annex II's wording] → a pre-launch gate for the first RO/HU venue.
- [One-handed phone use and diacritic rendering at 1x are device properties no test exercises] → owed human checks.
- [The UI contract contradicts itself on the mono size role: Label/Body versus prices at Heading] → to resolve before the diner price row ships.
- [`resolveVenueTheme` has no direct unit test; the guardrail tests exercise the contrast function and the sweep] → add before theming relies on it.
- [`.design-sync/` previews are stale — Inter-only fonts, old project id] → owner decision to repoint or retire.
- [Nine tablet strings render without copy-deck entries or contract rows, invisible to the copy check] → backlog.

## Migration Plan

Value-level re-skin: the stylesheet entry point maps every shadcn semantic role onto a `--cena-*` token, so restyling some forty consumer files was mostly a one-file value change followed by per-surface layout work. No data migration. Rollback is a revert of the token and primitive commits; the design-project write-back (not applied) has a rollback copy.

## Open Questions

- Should a Cena-branded diner menu ever honour `prefers-color-scheme`?
- The diner list row's price for an item with several variant prices (lowest, a range, or "from").
- Unknown-venue / unknown-table diner copy, owned by `live-menu-for-diners`.
- Whether to apply, revise or retire the design-project readme corrections, and whether to repoint or retire `.design-sync/`.

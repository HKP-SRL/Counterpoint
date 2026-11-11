## 1. Design archive and readme corrections

- [x] 1.1 Archive the deferred Service kit (seven files), `TheBook.jsx` and the service-states colour card byte-identical into `docs/design-archive/`, with an index README naming the source project (design-system-migration D-12). Verified by file counts, required paths and the project id in the index.
- [x] 1.2 Capture the design project's pre-edit `readme.md` as `docs/design-archive/readme-ORIGINAL.md`, the rollback copy for any later write-back. Verified by the original positioning sentence being present in the copy.
- [x] 1.3 Author the replacement text for the three owed readme edits — tiered positioning (design-system-migration D-11), menu-tier lexicon (design-system-migration D-04), per-currency formatting (W-3) — as reviewable repo text in `docs/design-archive/readme-corrections.md`. Verified by structure and banned/required-term greps; editorial voice left to the owner.

## 2. Contrast function and price formatter

- [x] 2.1 Add `lib/theme/contrast.ts`, a zero-dependency WCAG 2.1 contrast ratio that linearises all three channels and rejects three-digit, `#`-less or non-hex input with an error naming the value. Verified by oracle pins (21.00, 4.542, 4.478), symmetry, identical-colour and rejection tests in `tests/theme/contrast-oracle.test.ts`.
- [x] 2.2 Add `lib/format/money.ts`, per-currency price display through `Intl.NumberFormat` (HUF zero-decimal, RON `narrowSymbol` "lei", EUR decimal comma) with a runtime refusal of unsupported codes. Verified by literal-string tests in `tests/format/money.test.ts`.

## 3. Copy deck reconciliation

- [x] 3.1 Fold every un-contracted owner string — 40, not the 6 originally counted — into the copywriting contract of the multi-tenant-foundation UI contract, and clear the "no contract row" exception comments from `lib/copy.ts` with every string value byte-identical. Verified by extracting and diffing all key/value pairs.
- [x] 3.2 Add `tests/lib/copy-contract.test.ts`: every deck string has a contract row, the ambiguous sign-in error is present byte-for-byte, and none of the eight dropped lexicon terms reaches a user-visible string. Verified by a deliberate probe string observed failing, then reverted.

## 4. Diner vocabulary

- [x] 4.1 Add `lib/allergens.ts`: the 14 Regulation (EU) No 1169/2011 Annex II categories in the regulation's order, labelled in hu/en/ro, with `peanuts` distinct from `nuts`. Verified test-first by `tests/lib/allergens.test.ts`.
- [x] 4.2 Add `lib/diner-copy.ts`: the three-language diner copy deck with the timestamped design-system-migration D-07 last-good notice, language-detection disclosure, allergen disclaimer and empty state, sold-out note, empty-filter state, strings lifted from the template, a per-language count line, and the English-only owner-side unverified-marker group. Verified test-first by `tests/lib/diner-copy.test.ts`.
- [x] 4.3 Record the diner URL shape decision (`/menu/[slug]/[lang]`, QR payload encoding the default language) in the module header without building any route. Verified by review of the header.

## 5. Typefaces, token layer and Button end to end

- [x] 5.1 Self-host Newsreader, Instrument Sans and IBM Plex Mono through `next/font` with latin + latin-ext, roman only, and remove the Google Fonts request. Verified by `pnpm build` and the compiled CSS referencing only local `.woff2` files.
- [x] 5.2 Add `app/tokens/primitives.css` and `app/tokens/cena.css` and map every semantic role in `app/globals.css` onto a `--cena-*` token, declaring no colour in the entry point. Verified by the full suite including `tests/lib/theme-width-scale.test.ts`.
- [x] 5.3 Re-skin `components/ui/button.tsx` at the 44px floor and the Label role. Verified by `tests/theme/touch-targets.test.ts`.
- [x] 5.4 Add the two asset-privacy tripwires (`tests/theme/no-third-party-assets.test.ts` over source, `tests/theme/build-assets.test.ts` over compiled CSS) with a one-entry allowlist for Google Identity Services. Verified by observing each tripwire fail before committing it green.

## 6. Venue token namespace and contrast guardrail

- [x] 6.1 Add `app/tokens/venue.css`: seven hex-only `--venue-*` tokens inside `@theme inline`, with no v1 consumer. Verified by `tests/theme/token-boundary.test.ts` (no ramp identifier, hex only, dark class-based).
- [x] 6.2 Add `lib/theme/venue-tokens.ts`: a 20-pair `CONTRAST_PAIRS` adjacency list with text and non-text thresholds, and a total `resolveVenueTheme` that derives text colours. Verified by `tests/theme/venue-contrast-guardrail.test.ts`, which reads the palette from `app/tokens/cena.css`, pins release-gate rows by identity and was observed refusing a degraded value.

## 7. Nine new primitives

- [x] 7.1 Vendor `select`, `radio-group`, `switch`, `field`, `tabs`, `tooltip` and `separator` from the shadcn registry as reviewed source and re-skin them, adding zero dependencies and leaving `label.tsx` byte-identical. Verified by an empty diff on `package.json`, the lockfile and `app/globals.css`, and the file's checksum.
- [x] 7.2 Hand-author `components/ui/icon.tsx` (Lucide at stroke 1.75, no client directive) and `components/ui/tag.tsx` (the napfeny unverified-AI marker plus allergen and dietary chip variants). Verified by build and typecheck.
- [x] 7.3 Correct the hit-area expander arithmetic to 14px per side and extend the touch-floor gate to measure it from source. Verified by the extended gate, which named the inherited 40×32px checkbox defect.

## 8. Re-skin the existing primitives

- [x] 8.1 Re-skin alert, avatar, badge, card, checkbox, dialog, dropdown menu, input, label and sonner, completing all nineteen, with one focus treatment (3px accent ring at 30% alpha) and measured tokens in place of opacity-derived colours. Verified by the unchanged behavioural suite.
- [x] 8.2 Route every in-primitive glyph through `Icon` and extend `tests/theme/touch-targets.test.ts` to the full interactive set (13 cases, 7 files), fixing two under-floor controls it found. Verified by that test.

## 9. Auth surfaces

- [x] 9.1 Re-skin sign-up, sign-in and password reset mobile-first at the 44px floor, top-anchoring the shells so 44px controls fit a 320×568 viewport, and raise both consent rows so the checkbox expander cannot reach the control below. Verified by the unchanged auth tests and build.
- [x] 9.2 Keep the three auth security controls unchanged — consent recorded before any Google surface can complete, the ambiguous shared error, and the single allow-listed Identity Services script origin — and note each in the file a careless edit would touch. Verified by diff gates showing no string value, ordering or client boundary moved.

## 10. Dashboard, venue switcher and venue pages

- [x] 10.1 Re-skin the dashboard shell (sidebar collapsing to a full-width band on a phone), the venue switcher across its server/client split with a doubly bounded scroll container, the three venue pages and the venue form, keeping native selects. Verified by the unchanged dashboard and venue tests.
- [x] 10.2 Retire the last 50%-alpha focus rings and route all nine files' glyphs through `Icon`; confirm the four venue copy rows were already wired. Verified by the discipline sweeps and the copy-contract test.

## 11. Staff provisioning and device enrolment

- [x] 11.1 Re-skin the staff roster, provisioning form and device registry for one-handed use at 320px, keeping the enrolment call to action outside every branch. Verified by the unchanged staff and device tests.
- [x] 11.2 Re-skin both destructive confirm dialogs with copy, confirm labels and element order byte-identical. Verified by a diff gate on dialog copy and text nodes.

## 12. Shared-tablet route group

- [x] 12.1 Re-skin the enrolment landing, enable-staff-mode flow, unlock screen and PIN pad on one shell (sunken field, paper where a hand touches), PIN digits at the Body role, 16px key gaps. Verified by the unchanged tablet tests.
- [x] 12.2 Hold the idle-relock timer, PIN and unenrol behaviour byte-identical and move the group's five glyph call sites onto `Icon`. Verified by diff gates filtered for timer and relock code, and zero bare glyphs under the tablet group.

## 13. Venue defects carried from multi-tenant-foundation

- [x] 13.1 G-01-13: let a EUR venue be created by submitting the locked last language through a sibling hidden input while the checkbox stays visibly disabled. Verified by `tests/venues/venue-eur-submission.test.tsx` (exact `["en"]`), observed failing first, with the existing language tests byte-identical.
- [x] 13.2 G-01-14: refresh the root layout before redirecting after venue creation so the switcher is fresh. Verified by `tests/actions/create-venue-revalidation.test.ts` comparing call order, observed failing first.
- [x] 13.3 Close out both defects and the owed copy rows in the multi-tenant-foundation acceptance record, leaving ACCT-03 unticked until its browser journey is walked. Verified by review of the record.

## 14. Discipline test and close-out

- [x] 14.1 Add `tests/theme/design-system-discipline.test.ts` (42 cases): no bare glyph anywhere, no raw ramp step outside `app/tokens/cena.css`, the UI contract's residue table still lists all eleven requirement IDs with an owner on every partial row, and the three named diner copy groups exist in all languages. Verified by four deliberate failures observed red.
- [x] 14.2 Correct the success-criterion wording that placed unverified-AI marking in the diner vocabulary, and write the close-out record into `.design-sync/NOTES.md`: three stale artifacts, the sync-direction decision now ready, four honest gaps with owners. Verified by review.
- [x] 14.3 Pre-flight the design-project readme write-back and leave it to the owner after finding the corrections cannot be applied verbatim. Verified by the rollback copy being unmodified.
- [x] 14.4 Apply the code review fixes CR-01, CR-02 and WR-01 … WR-09, including the `source(none)` allowlist and the reduced-motion and source-set guards. Verified by a reproduced baseline failure, a clean build with no CSS warning, a dev-server route check with no 500, 786 green tests and a negative control on the new guard.

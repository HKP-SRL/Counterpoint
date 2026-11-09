---
phase: 01-multi-tenant-foundation
plan: 09
subsystem: database
tags: [postgres, rls, grants, triggers, check-constraints, zod, gdpr, supabase]

requires:
  - phase: 01-multi-tenant-foundation
    provides: "0001_core_tenancy.sql — accounts/venues/venue_members, the RLS policies and the grant block this plan corrects; ensure_account and create_venue as the SECURITY DEFINER write paths"
  - phase: 01-multi-tenant-foundation
    provides: "01-05 — the D-25 release-gate matrix suite and tests/rls/setup.ts fixture harness whose assertions this plan inverts"
provides:
  - "public.accounts is unwritable from an authenticated session — the UPDATE grant is revoked and ensure_account is the only remaining write path"
  - "venues.account_id is immutable for every caller, service_role included, via a BEFORE UPDATE trigger"
  - "venues.enabled_languages and venues.country_code are constrained to real values at the database, matched by z.enum and a regex at the Zod boundary"
  - "SUPPORTED_LANGUAGE_CODES — the single language vocabulary the form, the schema and the CHECK all resolve to"
  - "An exhaustive behavioural drift pin over the whole two-letter ASCII space, so neither layer can widen alone"
affects: [phase-02-menu-builder, phase-04-translation, billing, plan-tier-enforcement]

tech-stack:
  added: []
  patterns:
    - "A column-level restriction is enforced by removing the grant and routing the write through a SECURITY DEFINER RPC — never by a row policy plus a UI restriction (D-11, CLAUDE.md)"
    - "An invariant that must bind privileged callers too is a trigger, not a policy — RLS does not apply to service_role"
    - "A defect in an applied migration is corrected by a new additive file; 0001 is never edited"
    - "Two-layer value rules (Zod + CHECK) are pinned to each other by a drift test, so widening one alone turns the suite red"

key-files:
  created:
    - supabase/migrations/0006_account_and_venue_authority.sql
    - supabase/migrations/0007_venue_value_domains.sql
    - tests/venues/venue-value-domains.test.ts
  modified:
    - lib/validation/venue.ts
    - tests/rls/venue-isolation-matrix.test.ts
    - tests/rls/owner-full-access.test.ts

key-decisions:
  - "option-a (USER DECISION at the Task 1 blocking checkpoint): revoke UPDATE on public.accounts from authenticated entirely and add NO replacement RPC now"
  - "WR-01 is fixed with a BEFORE UPDATE trigger rather than by revoking the venues UPDATE grant, because revoking would also remove the name/currency edit ACCT-07 is verified on"
  - "The language CHECK uses array containment (<@) rather than equality, so a venue may enable any subset of the supported set"
  - "The drift pin probes behaviour across the enumerable two-letter code space instead of parsing pg_get_constraintdef, because PostgREST cannot reach pg_constraint and neither workaround was acceptable"

patterns-established:
  - "Denial assertions are reproduced RED against the pre-fix schema before the migration is applied — a denial test that never observed the write succeeding proves nothing"
  - "Every denial of a capability carries a positive control beside it, so the fix's scope is visible to the next reader"
  - "Revoking a grant carries an explicit assertion that the legitimate write path still works, because denial tests pass just as happily against a table nobody can reach"

requirements-completed: [ACCT-01, ACCT-02, ACCT-03, ACCT-07, ACCT-08]

coverage:
  - id: D1
    description: "An owner cannot update any column of their own accounts row — terms_accepted_version and plan_tier are each probed separately with a service-role ground-truth re-read"
    requirement: ACCT-01
    verification:
      - kind: integration
        ref: "tests/rls/venue-isolation-matrix.test.ts#owner A reads their own account row, and cannot write ANY column of it (CR-04)"
        status: pass
      - kind: integration
        ref: "tests/rls/owner-full-access.test.ts#cannot write their own account row either — accounts is RPC-only (CR-04)"
        status: pass
      - kind: other
        ref: "psql: information_schema.column_privileges UPDATE on public.accounts for authenticated = 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "ensure_account still creates the account row and stamps consent after the revoke, because it is SECURITY DEFINER"
    requirement: ACCT-01
    verification:
      - kind: integration
        ref: "tests/rls/venue-isolation-matrix.test.ts#ensure_account still works after the revoke — the legitimate write path is intact"
        status: pass
    human_judgment: false
  - id: D3
    description: "An owner cannot re-point venues.account_id at another owner's account; the update raises and a service-role re-read shows the original value"
    requirement: ACCT-03
    verification:
      - kind: integration
        ref: "tests/rls/venue-isolation-matrix.test.ts#owner A cannot re-point venue A's account_id at owner B's account (WR-01)"
        status: pass
      - kind: other
        ref: "psql: pg_trigger venues_account_id_immutable present, not internal = 1"
        status: pass
    human_judgment: false
  - id: D4
    description: "ACCT-07's owner-edits-everything property is unchanged — venue rename, currency and languages, item price and direct availability toggle all still land"
    requirement: ACCT-07
    verification:
      - kind: integration
        ref: "tests/rls/owner-full-access.test.ts (full file, every case but the inverted account one byte-identical)"
        status: pass
      - kind: integration
        ref: "tests/rls/venue-isolation-matrix.test.ts#owner A still renames the same venue — the trigger pins account_id and nothing else"
        status: pass
    human_judgment: false
  - id: D5
    description: "Venue creation rejects unsupported language codes and malformed country codes at BOTH the Zod boundary and the database, and accepts an absent or empty countryCode for a EUR venue"
    requirement: ACCT-02
    verification:
      - kind: integration
        ref: "tests/venues/venue-value-domains.test.ts (17 tests)"
        status: pass
      - kind: other
        ref: "psql: pg_constraint venues_enabled_languages_supported + venues_country_code_iso = 2"
        status: pass
    human_judgment: false
  - id: D6
    description: "The Zod enum and the database CHECK cannot widen independently — the whole supported set is accepted and all 673 other two-letter codes are refused"
    requirement: ACCT-02
    verification:
      - kind: integration
        ref: "tests/venues/venue-value-domains.test.ts#the drift pin: the Zod enum and the database CHECK cannot widen alone"
        status: pass
    human_judgment: false
  - id: D7
    description: "ACCT-02 ordering edge — two venues sharing a created_at list in a stable order across repeated reads"
    requirement: ACCT-02
    verification:
      - kind: integration
        ref: "tests/venues/multi-venue.test.ts (pre-existing backstop, unchanged by this plan)"
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-07-28
status: complete
---

# Phase 01 Plan 09: Account and Venue Authority Summary

**Consent evidence and the billing parent stop being self-serve: the blanket UPDATE grant on `accounts` is revoked outright, `venues.account_id` is pinned by a trigger that binds even `service_role`, and venue language/country codes are constrained at both layers with an exhaustive drift pin holding the two together.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-07-28T11:16Z
- **Completed:** 2026-07-28T11:38Z
- **Tasks:** 4 of 4 (Task 1 resolved by user decision at a blocking checkpoint)
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments

- **CR-04 closed.** `grant select, update on table public.accounts to authenticated` was column-blind and `accounts_owner_all` pins only `owner_user_id` in its `WITH CHECK`, so an owner could PATCH their own row through PostgREST and rewrite `terms_accepted_version`, NULL `terms_accepted_at`, or set `plan_tier` to anything. Migration `0006` revokes UPDATE and re-states SELECT. `ensure_account` is SECURITY DEFINER and keeps working, so it becomes the only write path to the table reachable from a session — the doctrine every other table in this schema already followed.
- **WR-01 closed.** `venues_owner_all`'s `WITH CHECK` is keyed on `id`, not `account_id`, so `update venues set account_id = <victim's account>` passed both `USING` and `WITH CHECK`: the membership row was untouched and only the billing parent moved. A `BEFORE UPDATE` trigger now raises on any `account_id` change. It binds `service_role` too, which a policy would not.
- **WR-11 closed.** Neither layer constrained `enabled_languages` or `country_code`. Migration `0007` adds a containment CHECK over `{ro,hu,en}` and an anchored two-uppercase-letter regex; `lib/validation/venue.ts` gains `SUPPORTED_LANGUAGE_CODES` and switches both language fields to `z.enum` and `countryCode` to a matching regex.
- **Every assertion that previously proved the opposite was reproduced RED first.** The account update, the `account_id` re-point, the `klingon` language code and the one-character country code were each observed SUCCEEDING against the pre-migration schema before the fix landed.
- **The suite grew from 21 files / 210 tests to 22 / 230**, all green, with `tsc --noEmit`, `pnpm build` and `pnpm lint` clean and `lib/database.types.ts` showing no drift.

## Task Commits

1. **Task 1: Decide the shape of account writes after the blanket UPDATE grant is revoked** — no commit; a `checkpoint:decision` resolved by the user (see Decisions Made).
2. **Task 2: Consent evidence and the billing parent stop being self-serve** — `95c0742` (fix)
3. **Task 3: Venue language and country codes are constrained to real values at both layers** — `35fbee9` (feat)
4. **Task 4: Apply both migrations live and re-run the full gate** — no file delta. Both migrations were applied and verified during Tasks 2 and 3; the type regeneration this task specifies produced a byte-identical `lib/database.types.ts`, exactly as the plan predicted (neither migration adds a table, column or RPC, and the trigger function is not exposed to PostgREST). Its outcome is the verified live state recorded under Verification below.

## Files Created/Modified

- `supabase/migrations/0006_account_and_venue_authority.sql` — revokes UPDATE on `public.accounts` from `authenticated`, re-states the SELECT grant, and adds `public.venues_account_id_immutable()` plus its `BEFORE UPDATE` trigger on `public.venues`.
- `supabase/migrations/0007_venue_value_domains.sql` — adds `venues_enabled_languages_supported` (array containment over `{ro,hu,en}`) and `venues_country_code_iso` (NULL or `^[A-Z]{2}$`).
- `lib/validation/venue.ts` — exports `SUPPORTED_LANGUAGE_CODES` derived from `SUPPORTED_LANGUAGES`; `defaultLanguage` and `enabledLanguages` become `z.enum` over it; `countryCode` gains the two-uppercase-letter regex unioned with the empty-string literal (the EUR case). The file comment's claim that every rule has a DB-level counterpart is now true and lists the pairs.
- `tests/venues/venue-value-domains.test.ts` — new, 17 tests covering both layers of both value domains, the ACCT-02 empty/encoding/idempotency edges, and the drift pin.
- `tests/rls/venue-isolation-matrix.test.ts` — the account-update case is inverted into two separate `expectWriteDenied` probes; an `ensure_account`-still-works case and a WR-01 case with a rename positive control are added; the header matrix table and its "W column" note are corrected.
- `tests/rls/owner-full-access.test.ts` — the own-account-update case is inverted to a denial. Nothing else in the file changed.

## Decisions Made

**Task 1 — USER DECISION at a blocking `checkpoint:decision`. Selection, verbatim: `option-a`.**

option-a is *revoke UPDATE on `public.accounts` from `authenticated` entirely; add no replacement RPC now.* The rationale the user accepted: smallest possible surface; it matches the phase doctrine and `.claude/CLAUDE.md`'s "SECURITY DEFINER RPC as the only write path" rule; it was verified to break nothing in Phase 1; and it publishes no contract, so the later phase that genuinely needs an editable account field designs its RPC against a real requirement rather than a guessed one. **Accepted cost:** the first later phase needing an editable account field must ship a migration plus an RPC before it can start. Task 2 implemented this option and no other — no `update_account_profile()` and no narrowed column-list grant were shipped.

Other decisions:

- **WR-01 uses a trigger, not a grant revoke.** Revoking UPDATE on `venues` would also have closed WR-01, and would have taken away the `name`/`currency` edit ACCT-07 is verified on and `tests/rls/owner-full-access.test.ts` asserts as a positive control. A trigger pins `account_id` and nothing else — and, unlike a policy, it binds `service_role`, so no future privileged path can move a venue's billing parent by accident either.
- **The language CHECK uses containment (`<@`), not equality.** A Bucharest bistro running `ro`+`en` is the common case; demanding the full set would break it. `venues_enabled_languages_not_empty` from `0001` supplies the lower bound — worth noting because `<@` alone is satisfied by the empty array, and there is now a test asserting the two constraints still compose.
- **`accounts_owner_all` was left alone.** The grant was the over-broad part; the policy is correct for SELECT. So was `service_role`'s grant.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] The drift pin cannot read `pg_get_constraintdef` from the test suite**

- **Found during:** Task 3
- **Issue:** The plan specified reading `venues_enabled_languages_supported`'s definition via `pg_get_constraintdef` through `typedAdmin` and asserting each `SUPPORTED_LANGUAGE_CODES` member appears in the text. That is not reachable. `supabase/config.toml` exposes only `public` and `graphql_public` to PostgREST, so `pg_constraint` cannot be selected through any Supabase client, and the project has no direct Postgres driver in `dependencies` or `devDependencies`.
- **Fix:** The pin probes behaviour instead, in both directions. Forward: one `create_venue` call carrying the whole supported set must succeed (containment means a single missing member fails the array). Reverse: all 673 remaining two-letter lowercase ASCII codes are probed individually, batched 48-wide, and every one must be refused — with the default language held inside the supported set so `venues_default_language_is_enabled` cannot fire first and make the probes pass for the wrong reason.
- **Why not the literal instruction:** the two ways to restore it were adding a `pg` dependency for one assertion (and package installs are not auto-fixable), or publishing a catalog-reading RPC on the Data API — which is precisely the "ship an RPC nobody asked for" move the Task 1 decision had rejected minutes earlier. The behavioural probe is also strictly stronger: ISO 639-1 codes are exactly two lowercase ASCII letters, so the candidate space is finite and fully enumerated, which fixes the CHECK's effective vocabulary more tightly than a regex over generated SQL would.
- **Cost:** 1.4s of suite runtime.
- **Files modified:** `tests/venues/venue-value-domains.test.ts`
- **Verification:** the case was observed RED before `0007` (all 673 codes leaked) and green after (zero leaked).
- **Committed in:** `35fbee9` (part of the task commit)

---

**Total deviations:** 1 auto-fixed (1 × Rule 3).
**Impact on plan:** None on scope or outcome. The deviation changes the mechanism of one assertion, not what it guarantees, and the replacement is a stronger guarantee than the original. No scope creep.

**Carried-forward findings applied as instructed (not re-derived):** the `search_path` acceptance predicate was checked with the corrected `array['search_path=""']` literal (returns 1, as expected), and every `psql` invocation went through `docker exec -i supabase_db_cena psql -U postgres -d postgres` because `psql` is not installed on this host.

**Plan text confirmed rather than changed:** Task 2 asked whether `tests/rls/owner-full-access.test.ts`'s currency-and-languages case at line 177 used only supported codes, and whether `supabase/seed.sql` would survive the new constraints. Both were checked. The test sets `["en", "ro"]`; the seed creates `Bistro Central` (`{ro,en}`, `RO`) and `Kürtős Kávézó` (`{hu,en}`, `HU`). All pass, so neither needed the fix the plan held in reserve.

## Issues Encountered

None. Both migrations applied first time, and `lib/database.types.ts` showed no drift as predicted.

## Verification

Live catalog, read directly rather than trusting the CLI exit code:

| Check | Result |
|---|---|
| `supabase_migrations.schema_migrations` | `0001,0002,0003,0004,0005,0006,0007` |
| UPDATE on `public.accounts` for `authenticated` (column + table privileges) | `0` |
| SELECT on `public.accounts` for `authenticated` | `1` |
| `pg_trigger` `venues_account_id_immutable`, not internal | `1` |
| `pg_constraint` for the two new CHECKs | `2` |
| `pg_get_constraintdef` of `venues_enabled_languages_supported` | `CHECK ((enabled_languages <@ ARRAY['ro'::text, 'hu'::text, 'en'::text]))` |
| `venues_account_id_immutable()` `proconfig @> array['search_path=""']` | `1` |

Gate:

- `pnpm exec vitest run` — 22 files, 230 tests, all passing (baseline 21/210)
- `pnpm exec tsc --noEmit` — exit 0
- `pnpm build` — compiled successfully, 11 static pages generated
- `pnpm lint` — zero problems
- `git diff --exit-code lib/database.types.ts` — exit 0, no drift
- `git status --porcelain supabase/migrations/0001_core_tenancy.sql` — empty

## Known Stubs

None. No stub patterns, TODOs, FIXMEs, skipped tests or unrun `<verify>` blocks were introduced by this plan.

## Threat Flags

None. Both migrations narrow existing surface rather than adding any; neither introduces a network endpoint, an auth path, a file-access pattern or a schema change at a trust boundary that is not already in the plan's `<threat_model>`.

## Notes for the Next Phase

- **`public.accounts` has no client write path.** The first phase needing an owner-editable account field must ship a migration plus a narrow SECURITY DEFINER RPC naming only those columns, modelled on `toggle_item_availability`. This is the accepted cost of the option-a decision, recorded here so it is not discovered as a surprise. Do NOT re-widen the grant.
- **`venues.account_id` cannot be changed by anyone, `service_role` included.** A deliberate venue-transfer-between-accounts feature would need its own SECURITY DEFINER RPC that disables the trigger for the duration. No such feature exists in v1. This is also what makes a future plan-tier authorization decision safe to make: the billing parent cannot have been moved underneath it.
- **Adding a fourth language is a migration, not an array edit.** `venues_enabled_languages_supported` must be dropped and recreated, revalidating every existing venue, and `SUPPORTED_LANGUAGES` in `lib/validation/venue.ts` must change in the same commit. The drift pin in `tests/venues/venue-value-domains.test.ts` turns red if only one side moves — that is its purpose, not a nuisance.
- **`timezone` is deliberately the one field with no DB-level counterpart.** Its valid set is the IANA database, which moves; pinning it in a CHECK would turn an upstream tzdata release into a failed migration. This is documented in `lib/validation/venue.ts` so a later reader does not "fix" the asymmetry.

## Self-Check: PASSED

All claimed artifacts verified present on disk and all claimed commits verified in `git log`:

- `supabase/migrations/0006_account_and_venue_authority.sql` — FOUND
- `supabase/migrations/0007_venue_value_domains.sql` — FOUND
- `tests/venues/venue-value-domains.test.ts` — FOUND
- `lib/validation/venue.ts` — FOUND (`SUPPORTED_LANGUAGE_CODES` exported, 3 references)
- `tests/rls/venue-isolation-matrix.test.ts` — FOUND (modified)
- `tests/rls/owner-full-access.test.ts` — FOUND (modified)
- commit `95c0742` — FOUND
- commit `35fbee9` — FOUND

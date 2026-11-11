## 1. Walking skeleton: scaffold, core tenancy, owner signup to first venue

- [x] 1.1 Scaffold Next.js 16 + React 19 + Tailwind v4 + TypeScript with pnpm, shadcn primitives (neutral, CSS variables) and the green accent reserved for primary CTAs and focus; the session-refresh proxy uses `getUser()`
- [x] 1.2 Migration `0001_core_tenancy`: `accounts`, `venues`, `venue_members` and the `venue_role` enum; RLS enabled in the same migration with dual venue + role policies; explicit Data API grants and no INSERT/DELETE grant for `authenticated`
- [x] 1.3 Add `private.get_venue_role(venue_id, user_id)` as the single SECURITY DEFINER role lookup behind every policy
- [x] 1.4 Add the `ensure_account(terms_version)` and `create_venue(...)` RPCs; the venue and its owner membership are created in one transaction; errors raise P0001 so PostgREST shows the message
- [x] 1.5 Add CHECK constraints for venue name not blank, currency in RON/HUF/EUR, languages not empty and default language enabled; country and timezone are nullable
- [x] 1.6 Add typed Supabase clients (server, browser, `server-only` admin) and generate `lib/database.types.ts` from the live schema
- [x] 1.7 Build the combined `/signup` flow with the Terms checkbox, the `signUpOwner` and `createVenue` Server Actions, Zod schemas, the copy deck in `lib/copy.ts`, and the venue dashboard shell
- [x] 1.8 Set up a serialized Vitest harness with RLS fixtures and `expectWriteDenied`; the first isolation, signup-consent and cross-owner tests pass; seed `owner@cena.local` with two venues

## 2. Owner auth completeness: login, password reset, Google, venue switcher

- [x] 2.1 `/login` with email and password; a wrong password and an unknown account get the same message
- [x] 2.2 Password reset: `requestPasswordReset` gives the same answer whether or not the address exists, and the `auth/confirm` route redeems the emailed token behind an open-redirect guard; the custom recovery template uses the token hash
- [x] 2.3 Google One Tap with `signInWithIdToken`, a hashed nonce and FedCM; it does not start until consent is ticked; `ensureAccount` checks the consent version against the server's `TERMS_VERSION`
- [x] 2.4 The `/venues` landing page redirects to the first venue or shows venue creation; `VenueForm` and `FieldError` are shared
- [x] 2.5 Sidebar `VenueSwitcher`, scoped by RLS and hidden below two venues
- [x] 2.6 Tests: recovery read from the real local mailbox, no account enumeration, the Google consent gate, multi-venue isolation and ordering, long names stored intact; fix the seed's NULL GoTrue token columns and allow local redirect origins

## 3. Staff PIN profiles

- [x] 3.1 Migration `0002_staff_profiles`: pgcrypto, `staff_profiles` with a bcrypt `pin_hash`, soft delete, `failed_attempts` and `locked_until`; one owner-manage policy and no member SELECT policy
- [x] 3.2 SECURITY DEFINER RPCs with an internal role check and an empty `search_path`: `provision_staff_pin`, `verify_staff_pin` (returns a bare boolean, locks the row), `list_staff_for_pin` (id, name, is_active), `deactivate_staff_profile` (one message for "not found" and "not yours"), `staff_pin_lock_seconds`
- [x] 3.3 Exponential backoff: two free attempts, then 2s doubling to a 300s cap; the correct PIN is refused while locked
- [x] 3.4 Staff Server Actions and the signed, httpOnly, 30-minute `cena_staff` attribution cookie
- [x] 3.5 Tablet surface at `/` (name grid, PIN pad, lockout countdown) and the owner roster at `/venues/[venueId]/staff` with a provisioning form and a deactivate dialog
- [x] 3.6 Tests, including a direct-RPC abuse suite; record the default TRUNCATE/REFERENCES/TRIGGER grants as a deferred finding

## 4. Shared-tablet staff session: device account, registry, remote revoke, owner unlock

- [x] 4.1 Migration `0003_venue_devices`: device registry with a partial unique index for one active device per (venue, label), a unique `device_user_id`, an owner-only policy, and SELECT-only for `authenticated`
- [x] 4.2 Next-free `lib/devices.ts`:
  - `enrollDevice` revokes the previous device, then provisions, and cleans up on failure
  - `revokeDeviceById` is safe to repeat
  - `rotateDevicePassword`
  - `findActiveDeviceByUserId`
- [x] 4.3 Each device is a provisioned, non-anonymous auth account with a `staff` membership; its password stays under bcrypt's 72-byte limit
- [x] 4.4 Server Actions `enableStaffMode`, `revokeDevice` and `exitOwnerUnlock`; `actions/devices.ts` is the only importer of the admin client; a signed `cena_device_user` cookie
- [x] 4.5 UI:
  - `/enable-staff-mode`
  - `/unlock`
  - the `IdleRelock` timer
  - an "Unlock" link on the PIN screen
  - the device registry page with a revoke dialog
- [x] 4.6 Revoke works by deleting the membership and rotating the password; tests show the next query is denied while the token is still valid, and refresh and the old credentials both fail

## 5. Narrow toggle RPC and the role × venue release-gate suite

- [x] 5.1 Migration `0004`: the placeholder `rls_test_items` table, with owner ALL and member SELECT and no staff UPDATE policy
- [x] 5.2 `toggle_item_availability(item, available, staff?)`: one guarded UPDATE that sets only `is_available` and the attribution column, with the staff profile validated in the same WHERE
- [x] 5.3 `toggleItemAvailability` Server Action, which takes the staff id from the signed cookie and never from the form
- [x] 5.4 Write the permission matrix as the contract, mapping each cell to its assertion (now `docs/security/permission-matrix.md`)
- [x] 5.5 Suites, all signed in through the anon key, with before/after snapshots proving each write denial:
  - venue-isolation-matrix (5 tables × 4 principals + anon)
  - rpc-abuse-matrix
  - owner-full-access
  - staff-write-boundary
  - availability-toggle-edges (no-op, round trip, identical responses, concurrency)

## 6. Owner authority restored once a tablet is enrolled (CR-01)

- [x] 6.1 Add `lib/venue-authority.ts` `resolveVenueOwner`, which filters memberships on the full (venue_id, user_id) key
- [x] 6.2 Replace the three venue_id-only inline checks in `enableStaffMode`, `revokeDevice` and both owner pages
- [x] 6.3 A read fault throws: Server Actions turn it into retryable copy, and pages surface it as a 500 rather than a 404
- [x] 6.4 `venue-authority` tests: the owner resolves with 0, 1 and 3 devices, and a foreign owner, the venue's own device, anon and the throw path are all denied
- [x] 6.5 `cookie-codecs` tests: tampered, truncated, malformed, wrong-key, expired and cross-decoded values; the shared HMAC key (IN-01) is pinned as a known, accepted behaviour

## 7. Recovery grant, redirect origin, re-authentication, honest consent path (CR-03, WR-04, WR-14, WR-07/02/03)

- [x] 7.1 `lib/recovery-session.ts`: an HMAC grant with a `recovery` domain prefix, bound to one user, 900s TTL, constant-time compare and an injectable clock
- [x] 7.2 The confirm route creates the `cena_recovery` cookie (httpOnly, path `/reset-password`); `completePasswordReset` checks the grant before `updateUser`; the `?stage=set` parameter is removed
- [x] 7.3 `lib/site-origin.ts`: the reset-link origin comes only from `NEXT_PUBLIC_SITE_URL`, and production throws when it is unset
- [x] 7.4 Turn on `secure_password_change`; tests show GoTrue alone still allows the change, so the app-level grant is essential
- [x] 7.5 `signUpOwner` retries the consent RPC once and lets a stranded owner continue; first-version-wins consent is pinned by a test
- [x] 7.6 Tests: recovery gate (including the full mailbox journey), site origin, consent evidence

## 8. PIN backoff overflow fix (CR-02, WR-12)

- [x] 8.1 Migration `0005_pin_backoff_overflow` re-issues `verify_staff_pin` and `staff_pin_lock_seconds` with `least(300, 2 ^ least(16, n-2))::integer`, clamping before the cast
- [x] 8.2 `staff_pin_lock_seconds` ignores deactivated profiles
- [x] 8.3 Restate every function attribute and verify `prosecdef`, `search_path` and the EXECUTE grants in the live catalog
- [x] 8.4 Backoff tests at the 32- and 40-attempt boundaries, plus deactivated-profile and non-member cases, using fast-forwarded counters

## 9. Account and venue write authority (CR-04, WR-01, WR-11)

- [x] 9.1 Migration `0006`: revoke UPDATE on `accounts` from `authenticated`, so `ensure_account` is the only write path
- [x] 9.2 Migration `0006`: a `venues_account_id_immutable` BEFORE UPDATE trigger that binds every role, including `service_role`
- [x] 9.3 Migration `0007`: CHECKs `venues_enabled_languages_supported` and `venues_country_code_iso`; Zod enums come from `SUPPORTED_LANGUAGE_CODES`
- [x] 9.4 Invert the owner account-update tests to expect denial, with separate probes for the consent version and plan tier; `ensure_account` still works; venue rename is a positive control
- [x] 9.5 Value-domain tests, including a behavioural drift test across the whole two-letter code space

## 10. Device cookie lifecycle, honest failure paths, denial assertions that assert (WR-05/06/08/09/13)

- [x] 10.1 Next-free `lib/device-cookie-policy.ts` makes every device and staff cookie decision; cookies are cleared only when the browser is provably no longer the tablet
- [x] 10.2 `enableStaffMode` writes the device cookie only after the session swap succeeds; `revokeDevice` clears the current browser's cookies when it revokes itself
- [x] 10.3 `unenrollThisBrowser` action and control on both `/unlock` branches (local only, no server revoke)
- [x] 10.4 `enrollDevice` cleanup failures name the orphaned auth user; a failed rotation after a committed revoke is logged, not reported as a failure
- [x] 10.5 `expectDenialError` accepts only `42501` or `PGRST3xx` and replaces denial checks that asserted nothing
- [x] 10.6 Record the info-level review findings (IN-01..06, WR-a, IN-a, legal routes) as deferred items

## 11. Single-use recovery grant and the Server Action harness (re-verification blocker 1)

- [x] 11.1 Set `RECOVERY_COOKIE_PATH` from `PASSWORD_RESET_PATH`; set and clear go through one applier that uses the object form of delete, so the path is preserved
- [x] 11.2 Create a grant only for a redeemed `type=recovery` OTP; email, invite, magic-link and code exchange create none
- [x] 11.3 First Server Action harness: a cookie jar keyed on (name, path) that reproduces Next's delete behaviour, with a redirect sentinel
- [x] 11.4 Recovery-cookie lifecycle tests run the real `completePasswordReset` twice and refuse the replay; they were seen failing against the defect first

## 12. A transient registry fault no longer de-enrols the tablet (re-verification blocker 2)

- [x] 12.1 `exitOwnerUnlock` reads the registry error and classifies a new `registry-unreadable` outcome above the absent-row branch: the cookies are kept, and the owner is still signed out
- [x] 12.2 Replace the trailing `return []` with a `never` exhaustiveness check over the outcome union
- [x] 12.3 Exit-classification tests: a fault keeps the cookies (ten times in a row), and a successful read with no row clears them
- [x] 12.4 AST guard: every outcome needs a caller and an enumerated test

## 13. Venue-detail owner gate, honest landing read, rotation guidance (WR-02, WR-03, WR-04)

- [x] 13.1 Gate `/venues/[venueId]` with `resolveVenueOwner`, so the venue's own tablet session gets a 404; a route-family guard requires the gate on every page in the subtree
- [x] 13.2 Next-free `lib/venue-landing.ts` `resolveVenuesLanding` throws on a read error instead of inviting a duplicate venue
- [x] 13.3 `.env.example` explains that rotating `STAFF_SESSION_SECRET`, or its `SUPABASE_SECRET_KEY` fallback, forces every tablet to re-enrol
- [x] 13.4 Tests: the device principal is denied on repeat, two venues with byte-identical names stay distinct, and the landing decision table holds

## 14. A route to a second venue (G-01-7)

- [x] 14.1 Add the `/venues/new` route, a "Create venue" sidebar entry that is always shown, and a trailing create item in the switcher
- [x] 14.2 `lib/venue-routes.ts` (`VENUE_CREATE_PATH`, `isVenueIdSegment`) so both pathname readers treat `new` as not a venue id
- [x] 14.3 Move the first-venue and another-venue headings and bodies into `COPY.venues`
- [x] 14.4 AST guard that fails when a create or enrol link sits under a ternary, `&&`, `??` or `if`; tests drive the real `createVenue` for an owner who already has a venue

## 15. A visible Google sign-in control (G-01-12)

- [x] 15.1 `GoogleOneTap` renders Google's own button into its own container before `prompt()`, keeping the hashed-nonce binding
- [x] 15.2 Before consent, a disabled control with `COPY.consent.googleGate`; init or script failure shows `COPY.errors.googleUnavailable`
- [x] 15.3 Mount the control on `/signup` as well as `/login`, and restore the consent checkbox label
- [x] 15.4 Tests: affordance (jsdom, SHA-256 nonce match) and an AST coverage guard over the declared surfaces

## 16. Enrolment link survives a non-empty registry (G-01-6)

- [x] 16.1 Move the "Enable staff mode" link out of the empty-registry branch on the devices page
- [x] 16.2 Extend the unconditional-link guard to the devices page; it was seen failing before the move
- [x] 16.3 Re-enrol test: a venue whose only row is revoked accepts a replacement under the same label, and the revoked row is kept

## 17. Reconciling the evidence and the final review round

- [x] 17.1 Re-derive every recorded verification and acceptance claim against live source, commits and a full run (46 files / 442 tests): 24 claims, of which 13 were stale, 3 still true, 3 out of scope and 4 owed to a human
- [x] 17.2 Settle each ACCT requirement:
  - ACCT-02, -04 and -08 are satisfied
  - ACCT-01, -03 and -05 wait on browser walks
  - ACCT-06 and -07 are verified at the RLS layer only, until menu surfaces exist
- [x] 17.3 Fix the cold start: disable the optional local analytics container in `supabase/config.toml` so its failing health check no longer tears down the stack (G-01-1)
- [x] 17.4 Final code review of the gap-closure changes: all 2 critical, 8 warning and 8 info findings fixed:
  - a blocked Google library now shows the unavailable message
  - list reads go through `resolveVenueRows`
  - the switcher marks the current venue and guards an empty list
  - device and staff sessions are sent away from the owner dashboard
  - `accountSetupIncomplete` copy
  - the last language checkbox cannot be unticked
  - Google errors clear on consent toggle
  - the guard checks the module an import comes from
- [x] 17.5 Automated browser pass: enrolment reachability on revoked-only and active-plus-revoked registries passes, and the second-venue journey passes. It found G-01-13 and G-01-14 (fixed later by `design-system-migration`) and G-01-16 (parked).

## 18. Dashboard error boundary and venue read faults (follow-up)

- [x] 18.1 Test-coverage audit:
  - Server Action tests for the six actions nothing had run: sign-up, sign-in, venue creation, staff mode, revoke, un-enrol
  - both coverage guards rewritten to read the AST
  - failing tests for the two remaining read-fault gaps
- [x] 18.2 Add `app/(dashboard)/error.tsx` with a retry control, plus `COPY.errors.readFailedHeading`, `readFailed` and `retry`; it shows the digest, never the message
- [x] 18.3 Add the Next-free `lib/venue-page-read.ts` `resolveVenueRow`, which throws on a read error; all three `/venues/[venueId]` pages use it, and `notFound()` fires only on a clean empty read
- [x] 18.4 Tests: venue-page-read, route-error-boundary, and paired read-fault and contrast cases (38 files / 387 tests green)

## 19. Deterministic tiebreaker on positional list reads (follow-up)

- [x] 19.1 End the venues landing, venue switcher, enable-staff-mode venue list and staff roster reads with `.order("id", { ascending: true })` after `created_at`
- [x] 19.2 Order the device registry by `enrolled_at desc, id asc`; give the tablet's staff pick an `id asc` order where it had none
- [x] 19.3 Update the two test copies of these queries in the same change, without changing any assertion

## Context

Cena started with no code. This change built the base that every later feature relies on:
- owner accounts;
- the account-to-venue model;
- staff identity on a shared tablet;
- the two-role permission boundary;
- the row-level-security (RLS) mechanism;
- the test suite that proves isolation.

Menus, items, theming, translations and analytics were out of scope. This change only proves the permission boundary those features will use. It does that against a placeholder item table (`rls_test_items`), which the first real menu-items migration replaces.

The stack was fixed beforehand: Next.js (App Router, Server Actions), Supabase (Postgres, Auth, PostgREST) and Vercel. Migrations live in `supabase/migrations/`. Tests run under Vitest against a local Supabase stack, one file at a time.

The owner made the product decisions D-01 to D-25 in a discussion on 2026-07-24. Five rounds of build and review followed. The first build had five task groups; three gap-closure rounds followed it, then a final code review. Two small follow-up tasks are folded in at the end. The finding IDs used below come from those reviews and are cited in code comments:
- **CR-xx**: critical review finding.
- **WR-xx**: warning-level finding.
- **IN-xx**: info-level finding.
- **G-01-x**: gap found in acceptance testing.
- **T-…**: entry in the threat register.

Review rounds reused the same numbers, so each ID below is explained where it first appears.

## Goals / Non-Goals

**Goals:**
- A restaurant owner can sign up, log in and create a venue with no manual help.
- One owner account can hold many venues.
- Owners give staff a per-person identity without email, used on a shared in-restaurant tablet.
- No venue's data is visible or writable to another venue's principals.
- A limited-role staff member can change only item availability ("86" an item), never prices, content or settings.
- Every role × venue combination is proven by automated tests that go through the client SDK with the public key, before any feature writes data.

**Non-Goals:**
- Menu, category and item CRUD, the fast sold-out UI, and how sold-out state reaches diners (later changes).
- A "manager" role, which was dropped for v1. Table-level staff attribution, subscription billing and tier enforcement are also out.
- Fiscal or tax conventions, a rich multi-venue management UI, diner-side consent, owner sign-out, and a mobile layout for the owner dashboard (all recorded as backlog).
- Legal page content for `/legal/terms` and `/legal/privacy` (already in the backlog).

## Decisions

### Owner authentication
- **D-01: Email and password, plus Google, with password reset.** Owners are not technical, and re-logging in mid-service must be instant.
  - Rejected: magic link only (it forces a trip to the mailbox mid-service); Google only (not every owner has Google).
- **D-02: No email-verification gate.** Owners go from signup straight into venue setup.
  - Accepted cost: a mistyped email cannot recover its password until it is corrected.
  - Rejected: verifying before venue creation.
- **D-03: Long-lived "stay signed in" sessions**, using refresh tokens with rotation. These suit use on the restaurant floor.
- **D-21: Explicit Terms and Privacy consent at signup.** The account stores the accepted version and the time. Consent evidence is cheap to record now and hard to reconstruct later.
  - **First version wins:** recording consent again never re-stamps the version, because re-stamping would record consent to terms the owner never saw. Before `TERMS_VERSION` is bumped, a re-consent screen must be built.
  - Google sign-in cannot start before the agreement box is ticked, so Google is never a way around consent.
- **CR-04 (first review): consent evidence and plan tier were self-serve.** `UPDATE` on `accounts` is now fully revoked from `authenticated`, and `ensure_account` (SECURITY DEFINER) is the only write path. The owner chose this option at a checkpoint.
  - Rejected: column grants, and a replacement RPC.
  - Consequence: the first feature that needs an editable account field must add a migration with a narrow RPC, never a wider grant.
- **CR-03 (first review): the password reset was gated on a query parameter.** It is now gated on a server-held **recovery grant**:
  - an HMAC-signed cookie with a `recovery` domain prefix and a 15-minute lifetime;
  - bound to one user id, and checked against the session's user before `updateUser`;
  - created only when a `type=recovery` emailed token is redeemed, never for signup, invite or magic-link tokens or for code exchange.

  Binding to a user id matters because an unbound grant would authorise a password change on whichever account the shared tablet happens to be signed in as. GoTrue's `secure_password_change = true` is enabled, but tests showed it still let an ordinary session change the password. That makes the app-level grant essential, not an optional extra layer.
- **Recovery grant is single-use** (fixed in the second review round). A path-less cookie delete left the grant alive at `/reset-password`, where it could be replayed for 15 minutes. The cookie path is now a single constant, assigned from the reset route's path, and set and clear go through one applier that uses the object form of delete. The test that proves this uses a cookie jar keyed on (name, path), and it was seen failing against the defect first.
- **WR-04 (first review): the reset-link origin came from request headers.** It now comes only from `NEXT_PUBLIC_SITE_URL`, and a production deployment without that variable throws instead of guessing.
- **Google control visible on login and signup** (fixes G-01-12, "no visible Google sign-in"). Google's own `renderButton` is used rather than a hand-made button that calls `prompt()`, because the One Tap prompt may never appear. The hashed nonce and FedCM settings are preserved. Before the agreement is ticked, a disabled control with an explanation is shown. A blocked library shows a "Google sign-in isn't available" message instead of an empty section.

### Tenancy model and roles
- **Accounts → venues → `venue_members`.** An account is the billing root; `plan_tier` is reserved but not used yet. A venue belongs to one account. Membership rows carry a role.
- **D-15: The schema supports many venues per owner; the UI for it is minimal.** A switcher appears from the second venue onward, and a "Create venue" entry is always shown in the sidebar.
  - G-01-7 ("no route to a second venue"): the create form had been tied to the zero-venue path. It was fixed with a `/venues/new` route, and an AST guard fails when a create or enrol link ends up under a condition.
- **D-14: Country and timezone are captured at venue creation,** derived from the currency and editable by the owner. EUR deliberately derives nothing: the euro spans about 20 countries, and a wrong timezone would quietly break time-of-day scheduling later.
- **D-09 / D-10: Two roles in v1, `owner` and `staff`, stored in an extensible Postgres enum.** One `private.get_venue_role()` helper resolves them. Adding `manager` later means adding one enum value and updating policies.
  - Rejected: a third role with no demonstrated need, and a generic RBAC engine.
- **D-12: Identity follows the permission tier.** Owners have real email accounts. Staff are PIN profiles on the tablet.
- **WR-01 (first review): a venue's `account_id` could be changed.** It is now fixed by a `BEFORE UPDATE` trigger, not a grant revoke. Revoking the grant would also have removed the name and currency edits owners need, and a trigger also binds `service_role`, which a policy would not.
- **WR-11 (first review): open value domains.** Each value rule exists in two layers: a Zod enum at the action boundary and a CHECK constraint in the database. Supported languages are checked by containment (`<@ {ro,hu,en}`), and the country is null or two upper-case letters. A drift test checks the whole two-letter space by behaviour. Timezone has no database CHECK, because the IANA list changes.

### RLS approach
- **D-22: One policy expression checks both venue and role.** Every policy calls the `SECURITY DEFINER` helper `private.get_venue_role(venue_id, (select auth.uid()))`. Policies contain no inline joins, and `auth.uid()` is wrapped in a select so it is evaluated once.
- **D-23: RLS is enabled in the same migration that creates each table.** A table with no policy yet is treated as not ready for data.
- **D-24: The service-role key never reaches client code.** `lib/supabase/admin.ts` uses `server-only`, and `actions/devices.ts` is its only importer.
- **No `INSERT` or `DELETE` grant for `authenticated` on any table.** All creates and removes go through SECURITY DEFINER functions that re-check `auth.uid()` and the role. Every function sets `search_path = ''` and revokes `EXECUTE` from `public` and `anon`.
- **D-11: The availability carve-out is a function, not a policy.** RLS is row-level and cannot express "only this column", so staff get no `UPDATE` policy at all. `toggle_item_availability()` is a single `UPDATE` whose `WHERE` holds every check. It sets only `is_available` and the attribution column. For an unknown item, another venue's item, or a no-op, it returns identical responses, so it cannot be used to discover items.
- **Membership reads filter on the full (venue_id, user_id) key.** CR-01 (first review) was an owner check that filtered on `venue_id` alone. Because the owner can see every member, the read returned two rows as soon as a tablet was enrolled, and the owner got a 404 and lost the revoke control. The predicate now lives in one Next-free module, `lib/venue-authority.ts`, which tests can run.
  - A read fault **throws**. Only a resolved non-owner returns null.
- **WR-02 (second review): one page in the venue route family had no gate.** Every page under `/venues/[venueId]` now runs the owner predicate, and a structural guard checks that. The venue's own tablet session gets a 404 rather than the venue's settings.
- **D-25: The release gate.** Every test in `tests/rls/` signs in as a real principal through the public key. A `MATRIX` constant lists 5 tables × 4 principals plus anon. Every positive case is paired with a negative one, and every denial asserts a real error code (`42501` or `PGRST3xx`; added for WR-13 in the first review). The contract is in `docs/security/permission-matrix.md`.

### Staff PIN profiles and backoff
- **D-04 / D-05: Staff are owner-provisioned name + PIN profiles,** with no email or login. Each profile is a distinct identifier, recorded on the actions that person takes. This is the seam for future table-level attribution.
- **D-16 / D-17: 4-digit PINs, chosen from a name grid first.** Because the person is picked explicitly, PINs need not be unique.
- **D-19: PINs are hashed in the database** with pgcrypto bcrypt. The tablet's staff list is served by `list_staff_for_pin` (id and name only), and there is no member `SELECT` policy on `staff_profiles`. That is because a row-level read policy would also expose the hash.
- **D-18: Timed, escalating backoff instead of a hard lock.**
  - Two wrong PINs are free. After that the lock is 2^(n-2) seconds, capped at 300.
  - The correct PIN is refused while the profile is locked.
  - CR-02 (first review): the 33rd wrong PIN raised an integer overflow, which rolled back the lockout write and turned the throttle off for good. The value is now bounded twice: `least()` clamps before the integer cast, and the exponent is separately capped at 16.
  - Non-members always get a bare `false`, never an error, so the function cannot be used to probe.
- **D-20: Deactivate rather than delete.** The PIN stops working immediately, and the record stays so past attribution is kept.

### Shared-tablet device model
- **D-06: "Owner logs in, then enables staff mode."** The tablet becomes a **provisioned** auth account (not anonymous auth) with a `venue_members` row whose role is `staff`, so no policy needs a special case for devices. The PIN identity sits on top of that session at the application level, in a signed `cena_staff` cookie that lasts 30 minutes.
  - Device writes go through service-role Server Actions instead of RPCs, because they need the GoTrue Admin API.
  - There is one active device per (venue, label); re-enrolling under the same label supersedes the old device.
- **D-07: The owner can unlock full access on the tablet.** Unlocking and exiting work by rotating the device password and signing back in. An idle relock after 3 minutes means an owner session cannot be left unattended.
- **D-08: Remote revoke through a device registry.**
  - Revoking deletes the device's membership row, so it takes effect on the next query even with an unexpired token, and rotates the credential so refresh fails.
  - Revoked rows stay in the registry, which answers "was this device ever trusted here".
  - G-01-6 ("cannot enrol a replacement after revoke"): the enrolment link had been tied to the empty registry, which a revoked row keeps non-empty forever. The link now renders outside that branch.
- **Tablet cookies are cleared only when the browser is provably no longer this tablet** (first review WR-05/WR-06, second review blocker). A transient registry read fault keeps the device identity and still signs the owner out. A new `registry-unreadable` outcome handles this, and a `never` exhaustiveness check stops a new outcome from being silently ignored.
- **Local un-enrol** clears cookies only and does not revoke on the server, so it needs no authority check (accepted threat T-01G-31).

### Read faults and error surfaces
- **A read failure is never shown as absence.** `maybeSingle()` and list reads report "no row" and "the read failed" on the same null, so both channels are bound in Next-free helpers: `resolveVenueRow`, `resolveVenueRows` and `resolveVenuesLanding`. These throw on error.
- A dashboard error boundary (`app/(dashboard)/error.tsx`) shows a page-level "This page didn't load" screen with a retry button. It shows the error digest but never the error message.
- The boundary was built before the throws, so that a false 404 would not turn into Next's unstyled error page.
- WR-03 (second review): a failed venues read had invited the owner to create a duplicate venue, which could never be removed because there is no DELETE grant. It now throws.

### Migration discipline
- **A defect in an applied migration is fixed by a new additive migration, never by editing the original.** An edited file would let environments diverge while `schema_migrations` claims they match. Examples: `0005` fixes the backoff from `0002`; `0006` and `0007` tighten authority and value domains.
- **Every `create or replace` of a SECURITY DEFINER function restates all its attributes** (returns, language, security definer, `search_path`, grants), and the result is checked against `pg_proc`, not against the file. An omitted attribute reverts silently.
- **Decision logic lives in Next-free `lib/` modules** that receive their client as a parameter, so Vitest can run them. A check reachable only through a Server Action has no test, which is how CR-01 shipped behind a green suite. Server Actions are driven through a harness whose cookie jar behaves like a browser.

### Deterministic list ordering
- **Every list read whose result is picked by position ends with `.order("id", { ascending: true })`.** The id is always ascending, even under a descending primary sort such as `enrolled_at desc, id asc`. The id is a random uuid with no time meaning, and one uniform rule is easy to grep.
- Reads that do not depend on order (set membership, full iteration, `maybeSingle`) are excluded.
- Test copies of these queries change together with production.
- This closed a defect where venues with the same `created_at` could redirect to a different dashboard on each load.

### Review and gap-closure rounds (summary)
1. **First code review** (4 critical, 14 warnings), closed by task groups 6–10:
   - CR-01: owner authority broken by tablet enrolment.
   - CR-02: PIN backoff overflow.
   - CR-03: password reset gated on a query parameter.
   - CR-04: self-serve consent and plan tier.
   - Warnings on the redirect origin, re-authentication, the consent path, cookie lifecycle, honest failure paths, value domains, and denial assertions that asserted nothing.
   - Info findings were recorded for the backlog.
2. **Re-verification** (2 blockers it introduced, plus confirmed warnings), closed by task groups 11–13:
   - recovery grant replayable;
   - a transient fault de-enrolled the tablet;
   - venue-detail page ungated;
   - landing-read fault;
   - rotation guidance in `.env.example`.
3. **Test-coverage audit and follow-up** (task group 18):
   - tests now drive the six Server Actions that nothing had run (signup, sign-in, venue creation, staff mode, revoke, un-enrol), which closes the WR-10 residual;
   - both coverage guards became AST-based instead of substring checks;
   - the failing tests the audit wrote were made green by the dashboard error boundary and the venue-page read-fault fix.
4. **Acceptance-testing gaps G-01-7, G-01-12 and G-01-6**, closed by task groups 14–16. Task group 17 reconciled every recorded claim against the live code and test suite.
5. **Final code review of round 4** (2 critical, 8 warnings, 8 info, all fixed). Notable fixes:
   - device and staff sessions that open the owner dashboard are sent back to the tablet screen;
   - list reads go through `resolveVenueRows`;
   - the last language checkbox cannot be unticked;
   - Google errors clear when the agreement is toggled.
6. **Deterministic ordering** (task group 19), found while a human walked the tie-ordering check.

## Risks / Trade-offs

- **[Accepted] Owner can read their own staff's PIN hashes.** `authenticated` holds a column grant on `staff_profiles.pin_hash`, and only the row policy confines it to the owner. A bcrypt hash over a 4-digit space breaks offline in seconds, but the owner set those PINs anyway. Fix: one `revoke select (pin_hash)` (backlog).
- **[Accepted] Both cookie codecs share one HMAC key without domain separation.** A staff cookie decodes as a device cookie, and a recovery grant decodes as both. Swapping one for another leads to a refusal, not an escalation. The behaviour is pinned by a test. Fixing it forces every tablet to re-enrol (backlog).
- **[Accepted] Any session holder can POST `ensureAccount`** and stamp a consent row that looks valid (ASVS L1). Closing this needs a server-issued "terms presented" token.
- **[Accepted] Default Supabase grants** give `anon` and `authenticated` TRUNCATE, REFERENCES and TRIGGER on every public table. These are unreachable through PostgREST, but every new table inherits them. Revoking them should be the first migration of the menu work (backlog).
- **[Open] `revokeDevice` ignores the error on its registry read.** It fails closed, but a transient fault looks like "not your device" during the lost-tablet panic (backlog).
- **[Open] No automated test gate.** There is no `test` script in `package.json` and no CI, so roughly 40 mitigations are only checked when someone runs the suite (backlog).
- **[Trade-off] The final review's WR-08 fix (the last language checkbox cannot be unticked) introduced G-01-13.** Disabling the last language checkbox dropped it from the form submission, so a single-language (EUR) venue could not be created in the browser. The suite drives actions with constructed payloads and so missed it. G-01-13 and the stale switcher after creation (G-01-14) were fixed by `design-system-migration`.
- **[Trade-off] ACCT-06 and ACCT-07 are proven only at the database layer.** There is no menu, theming or settings surface yet, and the Settings nav item renders disabled. Later changes must re-test them as user flows.
- **[Owed] Human browser checks:**
  - the live Google round trip against a build that includes the visible control, plus the silent unauthorised-origin case (G-01-16, parked);
  - the owner's multi-currency journey, re-walked after the EUR fix.

## Migration Plan

Migrations `0001`–`0007` are applied in order. Seed data (`supabase/seed.sql`) gives `owner@cena.local` two venues. The production environment needs:
- `NEXT_PUBLIC_SITE_URL`;
- `STAFF_SESSION_SECRET`;
- the Google client id, with the JavaScript origin authorised in the Google Cloud console;
- the recovery email template applied in the hosted Supabase project.

Rotating `STAFF_SESSION_SECRET`, or `SUPABASE_SECRET_KEY` when it is the fallback, invalidates every tablet's 10-year device cookie. Plan the rotation for a time when someone can reach every tablet.

## Open Questions

- When the first editable account field arrives, which narrow RPC shape should it use? The `UPDATE` grant stays revoked.
- Should a device principal be limited to one membership row by a unique index (IN-05: the tablet currently takes the first staff membership it finds)?

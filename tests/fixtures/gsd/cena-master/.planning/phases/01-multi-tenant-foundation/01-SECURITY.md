---
phase: 01
slug: multi-tenant-foundation
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
block_on: high
created: 2026-07-29
register_authored_at_plan_time: true
threats_total: 85
threats_closed: 81
threats_open_below_threshold: 4
audit_method: live-catalog
suite_at_audit: 314 tests / 31 files passing
---

# Phase 01 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

The register was authored at plan time — all 13 PLAN files carried a parseable
`<threat_model>` block, so this audit **verified mitigations** rather than
constructing a register retroactively. 81 threats came from the plans; 4 further
surfaces were added from the implementation (3 by the auditor, 1 class already
flagged in SUMMARYs).

Evidence for database claims was read from the **live Postgres catalog**
(`supabase_db_cena`, migrations 0001–0007 applied), not from migration file text.
The full suite was executed during the audit: **314 tests across 31 files, all
passing**. This phase has a documented history of mitigations that were "closed in
form, defeated in effect" — the phrase appears twice in `01-VERIFICATION.md` — so
neither SUMMARY claims nor the verification report were taken at face value.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Browser → Server Action | Owner-supplied form input crosses into privileged mutations | Credentials, venue config, consent evidence |
| Client → PostgREST (anon key) | Any authenticated principal can issue direct table queries and RPC calls; RLS + in-RPC authority are the only gates | All tenant data |
| App code → secret key (`lib/supabase/admin.ts`) | A leak is a full RLS bypass | Service-role credential |
| Emailed link → `app/auth/confirm/route.ts` | An attacker-influenced URL arrives pre-trusted in the owner's inbox | Recovery OTP, redirect target |
| Shared floor tablet → `verify_staff_pin` | PIN attempts from a physical device anyone in the restaurant can pick up | 4-digit PIN over a 10,000-value space |
| Tablet browser → signed cookies | `cena_device_user`, `cena_staff`, `cena_recovery` live on a shared device; only the HMAC makes their contents trustworthy | Device identity, staff attribution, password-change authority |
| Server Action → service-role client | Everything past `resolveVenueOwner` in `actions/devices.ts` runs with RLS bypassed | Device provisioning, credential rotation |
| Migration file → live database | A replaced `SECURITY DEFINER` function runs as its owner; an omitted attribute is a silent privilege change | Function authority |
| npm registry → build | Third-party packages enter the trust base at install time | Whole trust base |
| Route family → future phases | Whatever gate a page has on the day a field is added is the gate that field ships behind | Venue configuration, and everything Phase 2 adds beside it |

---

## Threat Register

### Carrier threats — critical and high severity

These five decide whether the phase is safe to build on. Each was confirmed at
source or against the live catalog, not accepted from a summary.

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01H-01 | Elevation of Privilege | `cena_recovery` lifecycle, `actions/auth.ts` | critical | mitigate | `RECOVERY_COOKIE_PATH = PASSWORD_RESET_PATH` (`lib/recovery-session.ts:67`); single applier `:262-273` uses the **object** form of `delete`; both call sites (`app/auth/confirm/route.ts:133`, `actions/auth.ts:319`) go through it and neither spells a path. `tests/actions/recovery-cookie-lifecycle.test.ts:285` drives the real Server Action twice through a (name,path)-keyed jar and asserts the second call is refused; `:279` asserts no entry survives at **any** path | closed |
| T-01G-07 | Elevation of Privilege | reset-password page + `completePasswordReset` | critical | mitigate | `actions/auth.ts:304` gates the write on `assertRecoveryGrant(cookie, user.id)`; `lib/recovery-session.ts:163` enforces strict `grant.userId === sessionUserId`; `supabase/config.toml:250` sets `secure_password_change = true` so GoTrue independently requires re-authentication | closed |
| T-01G-15 | Elevation of Privilege | `verify_staff_pin` backoff arithmetic | critical | mitigate | Live function body: `least(c_max_lock_seconds, 2 ^ least(c_max_exponent, …))::integer` — cast **outside** `least`, exponent capped at 16. Empirically falsified: the fixed expression returns `300` at attempts 33 and 40, while the pre-0005 form `least(300,(2^(33-2))::integer)` raises `ERROR: integer out of range` | closed |
| T-01G-20 | Repudiation | `grant update on public.accounts to authenticated` | critical | mitigate | Live `information_schema.role_table_grants`: `authenticated` on `public.accounts` holds `REFERENCES, SELECT, TRIGGER, TRUNCATE` — **no UPDATE**. The `accounts_owner_all` policy still says `ALL`; the revoked grant is what holds the line | closed |
| T-01-02 / T-04-02 | Info Disclosure / EoP | `lib/supabase/admin.ts` secret key | high | mitigate | `import "server-only"` at `:1`; `actions/devices.ts:19` is the sole importer; `SUPABASE_SECRET_KEY` carries no `NEXT_PUBLIC_` prefix. The only `NEXT_PUBLIC_*` vars in source are URL, ANON_KEY, GOOGLE_CLIENT_ID, SITE_URL | closed |

### Plan 01-01 — core tenancy

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01-01 | Info Disclosure | venues / venue_members RLS | high | mitigate | RLS enabled on all 6 tables with dual venue+role policies via `private.get_venue_role()`; `private` schema has no USAGE grant to `anon` or `authenticated` | closed |
| T-01-03 | Elevation of Privilege | `create_venue` / `ensure_account` RPCs | high | mitigate | Both re-check `(select auth.uid())` internally; `anon` absent from every `proacl` in the live catalog | closed |
| T-01-04 | Tampering | `createVenue` Server Action input | medium | mitigate | Zod at the action boundary + CHECK constraints on `venues` | closed |
| T-01-05 | Spoofing | Owner session identity | medium | mitigate | Zero `getSession()` calls anywhere in source — `getUser()` throughout, which revalidates the JWT against the Auth server | closed |
| T-01-06 | Repudiation | Terms & Privacy consent | low | mitigate | `terms_accepted_version` + `terms_accepted_at` written by `ensure_account`; single-column overwrite (no consent history) remains accepted v1 debt | closed |
| T-01-SC | Tampering | npm installs | high | mitigate | Package Legitimacy Audit at `01-RESEARCH.md:142-156` — no `[SLOP]`; all `[SUS]` are `too-new` false positives | closed |

### Plan 01-02 — auth surfaces

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-02-01 | Info Disclosure | password-reset request | medium | mitigate | Uniform response regardless of account existence; asserted in `login-reset.test.ts` | closed |
| T-02-02 | Spoofing | Google One Tap token | high | mitigate | Hashed nonce bound to the request + `signInWithIdToken`; `config.toml:393` confirms `skip_nonce_check = false` — the protection depends on this staying false | closed |
| T-02-03 | Info Disclosure | VenueSwitcher venue list | high | mitigate | RLS-scoped membership read with no `account_id` filter; `multi-venue.test.ts` asserts both directions through the anon key | closed |
| T-02-04 | Repudiation | Google-owner consent | medium | mitigate | `create_venue` refuses without an `accounts` row; `ensure_account` refuses a blank version | closed |

### Plan 01-03 — staff profiles and PIN

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-03-01 | Info Disclosure | `staff_profiles.pin_hash` | high | mitigate | No member SELECT policy; roster served by `list_staff_for_pin` (id/name/is_active only); cross-tenant and staff-device vectors confirmed closed live and by `rpc-abuse-matrix`. **Caveat — see A-3:** the register's clause "pin_hash never selectable" is factually false; the row policy confines it, not a column grant | closed (see A-3) |
| T-03-02 | Elevation of Privilege | `provision_staff_pin` / `deactivate_staff_profile` | high | mitigate | Internal `get_venue_role = 'owner'` check inside each RPC; `anon` absent from `proacl`; direct-`.rpc()` denial proven for a foreign owner and the venue's own staff device | closed |
| T-03-03 | Spoofing / EoP | `verify_staff_pin` oracle + brute-force | high | mitigate | Internal membership gate returning bare `false`; exponential backoff with a cap; correct PIN refused while locked | closed |
| T-03-04 | Elevation of Privilege | search_path hijack | medium | mitigate | Live catalog: 9 `SECURITY DEFINER` functions, **all** with `proconfig = {search_path=""}` | closed |
| T-03-05 | Repudiation | staff action attribution | low | mitigate | `created_by` stamped on provision; verified `staff_profile_id` held in the signed cookie | closed |

### Plan 01-04 — device enrolment

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-04-01 | Info Disclosure | cross-venue device read (IDOR) | high | mitigate | Device holds a `venue_members` row for exactly one venue; asserted from the device's own session for read and write against both venues | closed |
| T-04-03 | Elevation of Privilege | stolen tablet retains access after revoke | high | mitigate | `venue_members` DELETE + credential rotation; test asserts denial while holding the same unexpired access token. **Register text stale:** it names `admin.signOut global`; `lib/devices.ts:216-220` explains why `signOut` needs a JWT the server does not hold. Effect achieved by a different mechanism | closed |
| T-04-04 | Elevation of Privilege | device inherits owner access / unattended session | medium | mitigate | `(tablet)` route group isolated from `(dashboard)`; device role strictly `staff`; `IdleRelock` bounds the owner session | closed |
| T-04-05 | Spoofing | anonymous-auth broad `authenticated` role | medium | mitigate | Provisioned account asserted `is_anonymous === false`; no `is_anonymous` anywhere in migrations or source | closed |
| T-04-06 | Elevation of Privilege | orphan half-provisioned principal | medium | mitigate | Reconciliation on failure + supersede-on-re-enrol; `venue_devices_one_active_per_label_idx` partial unique index as the DB backstop | closed |

### Plan 01-05 — RLS release gate

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-05-01 | Elevation of Privilege | staff blanket UPDATE grant | high | mitigate | No staff UPDATE policy exists in the live catalog; only `toggle_item_availability` touches `is_available` | closed |
| T-05-02 | Info Disclosure | cross-venue read/write (IDOR) | high | mitigate | Dual venue+role RLS; `venue-isolation-matrix` covers 5 tables × 4 principals for reads, writes and deletes, through the anon key | closed |
| T-05-03 | Elevation of Privilege | direct-RPC abuse | high | mitigate | Every RPC called directly by every principal in `rpc-abuse-matrix`; `anon` absent from every `proacl` | closed |
| T-05-04 | Info Disclosure | toggle RPC existence leak | medium | mitigate | Authorized no-op, unknown uuid and other-venue item return byte-identical `{data, error, status}` | closed |
| T-05-05 | Elevation of Privilege | toggle RPC search_path hijack | medium | mitigate | `set search_path = ''` confirmed live; fully-qualified refs | closed |
| T-05-06 | Repudiation | false confidence from service-role testing | high | mitigate | `signIn()` → `anonClient()` (`tests/rls/setup.ts:71,252`); `admin.*` appears only as fixture setup and as a read-back oracle. **Register text stale:** no grep guard exists; substance verified independently | closed |

### Plan 01-06 — device authority hardening

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01G-01 | Denial of Service | `assertVenueOwner` | high | mitigate | Filter on `(venue_id, user_id)` bounds the row count at 1; `venue_members_venue_user_unique` present; test proves the owner resolves at 1 and 3 enrolled devices | closed |
| T-01G-02 | Elevation of Privilege | `resolveVenueOwner` venueId parameter | high | mitigate | Predicate re-reads through the caller's own RLS-scoped client, never the admin client, so naming a foreign venue returns null before `admin.ts` is reached | closed |
| T-01G-03 | Spoofing | `decodeDeviceCookie` / `decodeStaffSession` | medium | mitigate | Tamper, truncation, wrong-key and expiry-boundary rejection proven for both codecs | closed |
| T-01G-04 | Repudiation | `lib/staff-session.ts` HMAC | medium | mitigate | Cookie cannot be minted without the server key. Residual is social — a staff member who observes a colleague's PIN | closed |
| T-01G-05 | Tampering | shared HMAC key across both cookies (IN-01) | low | **accept** | See Accepted Risks R-1 | closed (accepted) |
| T-01G-06 | Info Disclosure | `resolveVenueOwner` throw path | low | mitigate | Message caught and replaced with generic copy before reaching the browser | closed |

### Plan 01-07 — recovery grant and origin

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01G-08 | Spoofing | `requestOrigin` in `actions/auth.ts` | high | mitigate | Header reads removed entirely; production without `NEXT_PUBLIC_SITE_URL` throws rather than falling back | closed |
| T-01G-09 | Tampering | recovery grant cookie | medium | mitigate | HMAC-SHA256 with `timingSafeEqual`, domain prefix, hard expiry against an injectable clock, strict equality against the session's own user id | closed |
| T-01G-10 | Repudiation | `ensureAccount` consent evidence | medium | **accept** | See Accepted Risks R-2 | closed (accepted) |
| T-01G-11 | Repudiation | `ensure_account` version semantics | medium | mitigate | Comment made true; first-version-wins pinned by a test that reads the column back | closed |
| T-01G-12 | Denial of Service | `signUpOwner` consent failure | medium | mitigate | Retries the RPC; falls through on a re-submit that already holds a session for that address | closed |
| T-01G-13 | Info Disclosure | `signUpOwner` fall-through branch | low | mitigate | Fires only when `getUser()` already returns a session for the submitted address | closed |
| T-01G-14 | Denial of Service | `secure_password_change = true` | medium | mitigate | `login-reset.test.ts` green as a gate; full mailbox-to-new-password journey re-driven under the flag | closed |

### Plan 01-08 — PIN backoff overflow

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01G-16 | Denial of Service | `verify_staff_pin` contract | medium | mitigate | Tests assert `error` is null across all cases, restoring the never-raises invariant | closed |
| T-01G-17 | Info Disclosure | `staff_pin_lock_seconds` | low | mitigate | `deactivated_at` filter added; deactivated-profile case asserts 0 | closed |
| T-01G-18 | Elevation of Privilege | `create or replace function` attribute loss | high | mitigate | Live catalog confirms `prosecdef` and `proconfig = {search_path=""}` on all 9 SECURITY DEFINER functions — read from `pg_proc`, not trusted from the file | closed |
| T-01G-19 | Tampering | migration application | high | mitigate | Migrations 0001–0007 confirmed applied against the live database; catalog re-read rather than trusting a CLI exit code | closed |

### Plan 01-09 — account and venue authority

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01G-21 | Elevation of Privilege | `accounts.plan_tier` | high | mitigate | Same revoke as T-01G-20; separate `expectWriteDenied` probe pins it | closed |
| T-01G-22 | Tampering | `venues_owner_all` WITH CHECK keyed on `id` | high | mitigate | `venues_account_id_immutable` BEFORE UPDATE trigger enabled and raising in the live catalog — binds `service_role` too, which a policy would not | closed |
| T-01G-23 | Tampering | `venues.enabled_languages`, `country_code` | medium | mitigate | `venues_enabled_languages_supported` + `venues_country_code_iso` CHECKs present live; matching Zod enums with a drift test | closed |
| T-01G-24 | Denial of Service | the two new CHECK constraints | medium | mitigate | `seed.sql` fixed rather than the constraint weakened; both constraints verified present live | closed |
| T-01G-25 | Denial of Service | revoking the accounts UPDATE grant | medium | mitigate | Explicit case asserts `ensure_account` still succeeds and returns the same account id; `owner-full-access.test.ts` green as the ACCT-07 positive control | closed |

### Plan 01-10 — cookie lifecycle and denial assertions

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01G-26 | Denial of Service | `cena_device_user` lifecycle | high | mitigate | Decision moved into `deviceCookieDirectives`; clears both cookies for the outcomes that prove the browser is no longer a tablet; unit test asserts the directive arrays with `toEqual` | closed |
| T-01G-26b | Denial of Service | over-eager cookie clearing | medium | mitigate | Empty list returned for `no-session`, `rotation-failed`, `swap-back-failed`; asserted | closed |
| T-01G-27 | Elevation of Privilege | `enableStaffMode` cookie ordering | high | mitigate | `lib/device-cookie-policy.ts:94` returns `[]` for `swapFailed`, so no set-device directive exists on the failure path; unit-tested. **Register text stale:** the "awk gate retained as a secondary structural check" does not exist — the only `awk` in the repo is `scripts/vercel-env-sync.sh:165`. Primary mitigation verified | closed |
| T-01G-28 | Repudiation | `enrollDevice` reconcile | medium | mitigate | Compound error carrying the orphan's id so a human can find it | closed |
| T-01G-29 | Denial of Service | `revokeDeviceById` rotation | high | mitigate | Logs and continues because both real revocation steps have already committed; test forces the rotation failure and asserts the membership row is gone anyway | closed |
| T-01G-30 | Tampering | RLS denial assertions | high | mitigate | `expectDenialError` asserts a `42501` / `PGRST3xx` code at 17 sites, replacing the `if (error === null)` pattern that asserted nothing | closed |
| T-01G-31 | Info Disclosure | `unenrollThisBrowser` | low | **accept** | See Accepted Risks R-3 | closed (accepted) |
| T-01G-32 | Spoofing | shared HMAC key (IN-01) | low | **accept** | See Accepted Risks R-1 | closed (accepted) |

### Plan 01-11 — recovery cookie path

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01H-02 | Spoofing | grant minted for a non-recovery redemption | medium | mitigate | Mint gated on a redemption established as recovery; refuses to mint from the untyped `code` exchange; enumerated per-type in the suite | closed |
| T-01H-03 | Tampering | the cookie-store double itself | high | mitigate | Jar keys on (name, path), reproduces Next's delete normalisation, carries self-checks, and was required to be observed FAILING against the unmodified code before the fix landed | closed |
| T-01H-04 | Info Disclosure | stubbed GoTrue client in the harness | low | **accept** | See Accepted Risks R-4 | closed (accepted) |
| T-01H-05 | Repudiation | corrected comments at the three grant sites | low | mitigate | Each rewritten to name `RECOVERY_COOKIE_PATH` and the normalisation rule that makes the path load-bearing | closed |
| T-01H-SC | Tampering | npm installs | high | accept→closed | Closed on evidence rather than documentation: `git log -- pnpm-lock.yaml` shows a single touch, the `01-01` scaffold commit | closed |

### Plan 01-12 — `exitOwnerUnlock` read fault

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01I-01 | Denial of Service | discarded PostgREST error in `exitOwnerUnlock` | high | mitigate | Error destructured and classified as its own `registry-unreadable` outcome returning no directives; proven in BOTH directions through an injected jar — fault preserves, absent row clears | closed |
| T-01I-02 | Tampering | reusing `rotation-failed` for the read fault | medium | mitigate | Rejected explicitly; the new union member carries its own name and comment | closed |
| T-01I-03 | Spoofing | stale `cena_device_user` surviving genuine revocation | high | mitigate | Paired assertion — a read that SUCCEEDS and finds no live row still clears both cookies. Neither assertion accepted without the other | closed |
| T-01I-04 | Elevation of Privilege | owner session left on an unattended tablet | medium | mitigate | Recoverable branch preserves identity cookies but still signs the session out and redirects to `/login`; asserted directly | closed |
| T-01I-05 | Tampering | silent empty directive list | medium | mitigate | `return []` replaced with a `never`-typed assertion so the typecheck fails instead | closed |
| T-01I-06 | Repudiation | union surface with no caller and no test | medium | mitigate | Extraction is genuinely AST-based and asserts `>= 8` before the coverage loop (`device-cookie-outcome-coverage.test.ts:100-106`). Residual weakness: the coverage check itself is `contents.includes(...)`, so import-without-call would pass | closed (weak) |
| T-01I-SC | Tampering | npm installs | high | accept→closed | No package added; lockfile untouched since the scaffold commit | closed |

### Plan 01-13 — route-family gate and landing read

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01J-01 | Info Disclosure | `venues/[venueId]/page.tsx` | medium | mitigate | The shared predicate runs on the success path at `page.tsx:58`, `staff/page.tsx:54`, `staff/devices/page.tsx:53`, so the staff-device principal is denied the owner dashboard. **Adjudicated:** the unbound read above it (A-1) shadows the honest 500, not the gate — the disclosure vector itself is closed | closed |
| T-01J-02 | Denial of Service | `venues/page.tsx` | medium | mitigate | **Partially open — see Accepted Risks R-5.** Throw half present (`lib/venue-landing.ts:60-65`, page binds `error` at `venues/page.tsx:24,37`), so the destructive create-first invitation is genuinely closed. Boundary half absent | **open — below high threshold (non-blocking)** |
| T-01J-03 | Repudiation | `.env.example` rotation guidance | medium | mitigate | `.env.example:64-91` names all three signed values, the decode-to-null mechanism that forces re-enrolment, and the `SUPABASE_SECRET_KEY` fallback equivalence | closed |
| T-01J-04 | Elevation of Privilege | over-tightening the venue-detail gate | low | **accept** | See Accepted Risks R-6 | closed (accepted) |
| T-01J-05 | Tampering | vacuous structural guards | medium | mitigate | Both guards carry the declared minimum-extraction assertion before the loop (`venue-page-gate-coverage.test.ts:75-82` asserts `>= 3`). Residual weakness: coverage is a substring check, so import-without-call would pass. All three pages currently import **and** call | closed (weak) |
| T-01J-06 | Tampering | catalog gate with the wrong search_path literal | medium | mitigate | `array['search_path=""']` used, and the total `prosecdef` count recorded so a zero result cannot be misread as an empty population | closed |
| T-01J-SC | Tampering | npm installs | high | accept→closed | No package added; lockfile untouched since the scaffold commit | closed |

### Register additions — surfaces found in the implementation

The four surfaces flagged in SUMMARYs (`open-redirect`, `token-in-URL`,
`forgeable-client-identity`, `cookie-directed-privileged-operation`) were verified
and are closed — `route.ts:41-45` enforces a same-origin `next` and `:137` redirects
on `pathname` + `search` only; the staff cookie carries HMAC + constant-time verify
+ venue id + 30-min TTL; `exitOwnerUnlock` re-derives authority from the caller's
own RLS-scoped `venue_devices` read before the admin client is touched. They are now
named here rather than living only in a SUMMARY.

Three further surfaces were found during verification:

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| A-1 | Denial of Service | `venues/[venueId]/{page,staff/page,staff/devices/page}.tsx` | medium | **accept** | Unbound `error` on the venues read (`page.tsx:28`, `staff/page.tsx:34`, `staff/devices/page.tsx:33`) → a DB fault is reported to the legitimate owner as `notFound()`, ahead of the honest gate. T-01J-02's class at three further sites. See R-7 | **open — below high threshold (non-blocking)** |
| A-2 | Denial of Service | `actions/devices.ts:248-253` (`revokeDevice`) | medium | **accept** | Unbound `error` on the `venue_devices` read. Fail-**closed**, not the fail-open fleet de-enrolment T-01I-01 fixed, but it conflates "not your device" with "DB blip" on the D-08 lost-tablet valve. See R-8 | **open — below high threshold (non-blocking)** |
| A-3 | Info Disclosure | `staff_profiles.pin_hash` column grant | medium | **accept** | `has_column_privilege('authenticated','public.staff_profiles','pin_hash','SELECT')` = **true**. Cross-tenant and staff-device vectors are closed (verified live + `rpc-abuse-matrix`), but the venue's own owner can read bcrypt hashes over a 4-digit keyspace. Already tracked as IN-a. See R-9 | **open — below high threshold (non-blocking)** |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above `workflow.security_block_on` count toward `threats_open`*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-1 | T-01G-05, T-01G-32 | Both cookie codecs sign with one key and no type tag, so a `cena_staff` value verifies as a device cookie. Not exploitable — the composite string fails the uuid comparison in the `venue_devices` query and the caller falls through to sign-out. Documented at `deferred-items.md:82-107` (IN-01) and pinned by `tests/lib/cookie-codecs.test.ts:213-255` so the day it stops being true is visible | Alex Profir | 2026-07-29 |
| R-2 | T-01G-10 | Any session-holder can POST `ensureAccount` and stamp a valid-looking consent row. Accepted at ASVS L1: the caller must already hold a session, and the harm is a weaker consent record rather than account compromise. Closing it needs a server-issued "terms presented" token. Documented at `actions/auth.ts:368-379` | Alex Profir | 2026-07-29 |
| R-3 | T-01G-31 | `unenrollThisBrowser` clears cookies and signs out with no authority check. Reachable only from a browser that already holds the tablet, grants nothing, and does not revoke server-side — the registry row stays active and visible to the owner. Equivalent in effect to the user clearing their own cookies. Documented at `actions/devices.ts:472-477` | Alex Profir | 2026-07-29 |
| R-4 | T-01H-04 | `auth.getUser` and `auth.updateUser` are stubbed in the harness, so the suite makes no claim about GoTrue's own behaviour. The subject is the cookie effect; the grant codec and the gate run unmodified. Carried as a backstop truth for human confirmation. Documented at `tests/actions/recovery-cookie-lifecycle.test.ts:24-32` | Alex Profir | 2026-07-29 |
| R-5 | T-01J-02 | The destructive half is closed — `resolveVenuesLanding` throws on a non-null error, so a transient failure can no longer invite an irreversible duplicate venue. The compensating half was never built: no `error.tsx` or `global-error.tsx` exists anywhere under `app/`, so the fault lands on Next's unstyled built-in 500 rather than the boundary `01-13-SUMMARY.md` promises. Availability-only, no data exposure. **Remediation:** add `app/(dashboard)/error.tsx` and a `COPY.errors.readFailed` entry | Alex Profir | 2026-07-29 |
| R-6 | T-01J-04 | Applying `resolveVenueOwner` means a future `manager` role would 404 on the venue-detail page until the predicate is widened. v1 has exactly two roles (D-09), both sibling pages already carry the identical predicate so this page becomes consistent rather than exceptional, and widening is one shared function rather than three pages | Alex Profir | 2026-07-29 |
| R-7 | A-1 | Three `[venueId]` pages answer a database fault with `notFound()`, telling the legitimate owner their own venue does not exist — four lines above a comment forbidding exactly that. Availability and honesty, not exposure: the authorization gate still runs on the success path, so T-01J-01 stays closed. **Remediation:** bind the error channel and throw, preferably via a Next-free `lib/` helper so the correction carries a regression guard | Alex Profir | 2026-07-29 |
| R-8 | A-2 | `revokeDevice`'s `venue_devices` read discards its error and fails closed with generic copy. The owner can retry, and no privilege is granted by the failure. Accepted because the failure mode is a confusing message during the lost-tablet panic rather than a security boundary crossing. **Remediation:** bind and at minimum log the error | Alex Profir | 2026-07-29 |
| R-9 | A-3 | `authenticated` holds a column-level SELECT privilege on `staff_profiles.pin_hash`; the RLS row policy is what actually confines it, so only a venue's own owner reaches their own staff's bcrypt hashes. An owner provisions those PINs in the first place, so this grants no capability they did not already have. Recorded because the register's clause "pin_hash never selectable" is factually false and a future policy change would silently widen it. Already tracked as IN-a. **Remediation:** `revoke select (pin_hash) on public.staff_profiles from authenticated` — one line | Alex Profir | 2026-07-29 |

*Accepted risks do not resurface in future audit runs.*

---

## Stale Register Claims

Recorded so a future reader does not rely on a control that is not there. In each
case the threat is genuinely closed — the *stated mechanism* is what is wrong.

| Threat | Claim in the register | Reality |
|--------|----------------------|---------|
| T-01G-27 | "the line-ordering `awk` gate is retained as a secondary structural check" | No awk gate exists. The only `awk` in the repo is `scripts/vercel-env-sync.sh:165`. The primary mitigation — `lib/device-cookie-policy.ts:94` returning `[]` on `swapFailed` — is present and unit-tested |
| T-05-06 | "acceptance grep forbids service-role as an acting principal" | No such guard exists. Substance verified independently: `signIn()` → `anonClient()`, and `admin.*` appears only as fixture setup and as a read-back oracle |
| T-04-03 | "`admin.signOut` global" | Implementation deliberately uses `venue_members` DELETE + password rotation instead; `lib/devices.ts:216-220` explains that `signOut` needs a JWT the server does not hold. Effect achieved by a different mechanism |
| T-03-01 | "`pin_hash` never selectable" | Factually false — see A-3 / R-9. The row policy confines it, not a column grant |

---

## Systemic Finding — no automated test gate

`package.json` has **no `test` script**, and there is no CI configuration
(`.github/` is absent). Roughly 40 entries in this register rest on tests that
pass 314/314 today but that nothing runs automatically on a commit or a PR.

This is not a threat in the STRIDE sense and does not count toward `threats_open`,
but it is the highest-leverage single hardening action available to this phase:
adding a `test` script and a CI workflow would convert those 40 mitigations from
"passing when someone remembers to look" into "cannot regress silently".

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-29 | 85 | 81 | 4 (all below the `high` block threshold) | gsd-security-auditor (opus) |

**Method:** live Postgres catalog inspection (`supabase_db_cena`, migrations 0001–0007
applied) rather than migration file text; full suite executed (314 tests / 31 files,
all passing); source read directly rather than accepting SUMMARY or VERIFICATION
claims — both have been wrong in this phase before.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log (R-1 … R-9)
- [x] `threats_open: 0` confirmed — no open threat at or above the `high` block threshold
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-29

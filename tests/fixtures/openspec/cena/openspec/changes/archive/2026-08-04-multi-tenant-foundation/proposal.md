## Why

Cena had no code yet, and every later feature (menus, items, translations, analytics, AI ingestion) writes venue-scoped data. Venue and role scoping are the most expensive things to retrofit and the most likely to fail silently, so they had to exist and be proven before any feature wrote data on top. The owner story: "As a restaurant owner, I want to create my account and venue and invite staff with scoped roles myself, so that my team can work in Cena without any venue's data leaking to another and without limited-role staff changing prices, content, or settings."

## What Changes

- Stand up the Next.js + Supabase project, with typed Supabase clients, a serialized Vitest harness and versioned SQL migrations.
- Owner accounts: email and password signup with no email-verification gate, Terms and Privacy consent recorded per account, login, password reset, and a visible Google sign-in control on login and signup.
- An account-to-venues model. Each venue has a name, a currency (RON/HUF/EUR), enabled and default languages, and a country and timezone derived from the currency. The dashboard offers an always-visible "Create venue" entry, a venue switcher and a landing redirect.
- Staff identity without email: owner-provisioned name + 4-digit PIN profiles, stored hashed, deactivated rather than deleted.
- A shared in-restaurant tablet. The owner enrols it as a venue-scoped staff device. Staff identify by name, then PIN, with escalating backoff on wrong PINs. The owner can unlock the tablet for full access, with an idle relock, and can revoke it remotely from a device registry.
- Two roles, owner and staff, enforced by row-level security on every table. A single role-lookup function sits behind every policy. A narrow availability-toggle function is the only write path staff have.
- A role × venue release-gate test suite. It signs in as every principal through the public API key and asserts what each principal can and cannot read or write.
- Three review and gap-closure rounds after the first build:
  - restored owner authority once a tablet is enrolled;
  - made the recovery grant single-use;
  - fixed a PIN-backoff overflow;
  - locked account and venue write authority;
  - made tablet cookies survive transient faults;
  - made dashboard read faults visible instead of disguised;
  - added a route to a second venue and a reachable enrolment link;
  - made every positional list read deterministic.

## Capabilities

### New Capabilities
- `owner-auth`: owner signup, login, consent evidence, password reset with a single-use recovery grant, and Google sign-in.
- `venues`: venue creation and value domains, many venues per account, the switcher, the landing page, honest read-fault handling and stable list order.
- `staff-management`: owner-provisioned PIN profiles, owner-only management, hashed PIN storage and soft deactivation.
- `shared-tablet`: tablet enrolment, name-then-PIN identification, PIN backoff, remote revoke, owner unlock and relock, and fault-tolerant tablet identity.
- `tenant-isolation`: cross-venue invisibility, the staff availability-only boundary, attributed toggles, owner full access, and owner-only dashboard pages.

### Modified Capabilities
None. This is the first change.

## Impact

- **Database:** migrations `0001_core_tenancy` through `0007_venue_value_domains` create:
  - tables `accounts`, `venues`, `venue_members`, `staff_profiles`, `venue_devices` and the placeholder `rls_test_items`;
  - the `venue_role` enum and `private.get_venue_role()`;
  - the functions `ensure_account`, `create_venue`, `provision_staff_pin`, `verify_staff_pin`, `list_staff_for_pin`, `deactivate_staff_profile`, `staff_pin_lock_seconds` and `toggle_item_availability`;
  - the CHECK constraints and the immutable-`account_id` trigger.
- **App:**
  - routes: `(auth)` (signup, login, reset-password), `auth/confirm`, `(dashboard)` (venues, venue detail, staff, devices, `venues/new`, error boundary) and `(tablet)` (name grid and PIN, enable-staff-mode, unlock);
  - Server Actions in `actions/`;
  - Next-free decision modules in `lib/` (venue authority, recovery grant, cookie codecs and policy, venue landing and page reads, venue routes, site origin);
  - the copy deck in `lib/copy.ts`.
- **Configuration:**
  - `STAFF_SESSION_SECRET` and `NEXT_PUBLIC_SITE_URL`;
  - the Google client id;
  - `secure_password_change = true` and the recovery email template in Supabase Auth;
  - local analytics disabled in `supabase/config.toml`.
- **Tests:** 46 files and 442 tests at close. They include the role × venue isolation matrix, RPC abuse, staff write boundary, owner full access, Server Action harnesses with a path-aware cookie jar, and AST-based structural guards.
- **Durable docs:**
  - `docs/security/permission-matrix.md`
  - `docs/security/threat-register.md`
  - `docs/design/ui-contract-multi-tenant-foundation.md`

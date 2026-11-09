# Deferred items — phase 01

Out-of-scope discoveries logged rather than fixed, per the executor scope boundary.

## From plan 01-02

### `pnpm lint` fails on 774 problems, none of them in application code

- **Found during:** plan 01-02 final verification (`pnpm lint`).
- **What:** every one of the 585 errors and 189 warnings comes from `.claude/**`
  — GSD's own tooling scripts (`.claude/scripts/*.cjs`, `@typescript-eslint/no-require-imports`)
  and bundled agent/skill assets. Filtering the output to non-`.claude` paths returns
  **zero** problems, so `actions/`, `app/`, `components/`, `lib/`, `tests/` and
  `supabase/` are lint-clean.
- **Why not fixed here:** the files are not this project's source. `eslint-config-next`'s
  default `next lint` glob simply walks the repo root, and `.claude/` happens to live
  inside it because GSD is vendored rather than installed.
- **Suggested resolution:** add `.claude/**` (and `.planning/**`) to `ignores` in
  `eslint.config.mjs`, so `pnpm lint` becomes a usable gate. One line, but it touches
  a shared config file and no plan in phase 01 owns lint configuration.
- **Impact if left:** `pnpm lint` can never be added to a CI gate or to the phase
  verification set, because it is red on arrival and would stay red.
- **Status:** resolved before plan 01-03 (commit `eaf36b8` excludes the vendored
  tooling). `pnpm lint` is green and is now part of this plan's verification set.

## From plan 01-03

### `anon` and `authenticated` hold TRUNCATE, REFERENCES and TRIGGER on every public table

- **Found during:** plan 01-03 Task 3, auditing the grants on `staff_profiles`
  against the ones migration 0001 established.
- **What:** `information_schema.role_table_grants` shows `anon` with
  `REFERENCES, TRIGGER, TRUNCATE` on **all four** public tables — `accounts`,
  `venues`, `venue_members` and `staff_profiles` — and `authenticated` with the
  same plus the SELECT/UPDATE the migrations grant explicitly. Neither migration
  grants any of the three; they arrive from Supabase's stock
  `alter default privileges in schema public grant all on tables to anon, authenticated`,
  which runs before any project migration.
- **Why it is not exploitable today:** these roles are JWT identities reached only
  through PostgREST, which issues no `TRUNCATE` and no DDL. There is no request
  that can use them. It is a latent grant, not an open door — but `TRUNCATE`
  bypasses RLS entirely, so it would become one for any future path that reaches
  the database as `anon` or `authenticated` outside PostgREST.
- **Why not fixed here:** the condition is project-wide and predates this plan;
  narrowing it means a `revoke ... from anon, authenticated` sweep plus a change to
  the schema's default privileges, which is a migration no plan in phase 01 owns
  and which would silently affect every table added later.
- **Suggested resolution:** a small migration that revokes `truncate, references,
  trigger` on `public` tables from `anon` and `authenticated` and resets the
  default privileges, so new tables inherit the narrow shape rather than the
  broad one. Worth doing before phase 2 adds menu tables.
- **Confirmed again by plan 01-04:** `venue_devices` arrives with exactly the same
  three grants for both roles, straight from the default privileges, despite
  migration 0003 granting `authenticated` nothing but `SELECT`. This is the
  prediction the finding made, observed: **every new table inherits it**, so the
  cost of leaving it grows one table at a time. Five public tables now.
- **Confirmed a third time by plan 01-05, and this one is the argument for fixing
  it now:** `rls_test_items` arrives with `REFERENCES, TRIGGER, TRUNCATE` for both
  roles. **Six** public tables. What makes this instance different from the
  previous two is the table it landed on: `rls_test_items` is the first table
  whose whole purpose is a column-level carve-out — staff may change
  `is_available` and nothing else, enforced by having no staff UPDATE policy at
  all. `TRUNCATE` does not respect RLS, so the one grant nobody wrote is also the
  one grant that would erase the table the carve-out protects. It is still not
  reachable through PostgREST, and it is still not exploitable today. But the
  shape of the latent grant now directly contradicts the guarantee the table
  exists to demonstrate, and Phase 2 replaces this placeholder with the real
  `items` table — which will inherit the same three grants unless the default
  privileges are narrowed first.
- **Recommended sequencing:** do the revoke sweep as the FIRST migration of
  Phase 2, before the menu tables are created, so it is one migration over six
  known tables rather than a growing sweep over an unknown number.

## From the phase 01 code review (2026-07-27)

Recorded by plan 01-10, the gap-closure run. The user scoped that run to CR-01
through CR-04 and WR-01 through WR-14; everything below is an info-level finding
or a verification-report anti-pattern that no plan in that set closes. Each is
recorded rather than fixed, with the reason it is not fixed and what resolving it
would take.

### IN-01 — the device and staff cookies share one HMAC key with no domain separation

- **Found during:** the phase 01 code review, in `lib/device-session.ts` and
  `lib/staff-session.ts`.
- **What:** both codecs sign their payload with the same key and the same bare
  `HMAC-SHA256(payload)` construction, with no context label distinguishing the
  two cookies. A valid `cena_staff` value therefore verifies as a `cena_device_user`
  value and vice versa — the signature check cannot tell which cookie a given
  signed string was minted for.
- **Why it is not exploitable today:** a `cena_staff` payload is a composite
  string, not a bare uuid. Swapped into `cena_device_user` it decodes cleanly but
  then fails the uuid comparison in the `venue_devices` query, and every caller
  falls through to the sign-out path. The confusion produces a refusal, not an
  escalation.
- **Why not fixed here:** it is an info-level finding outside the CR/WR list the
  user scoped this run to, and changing the construction invalidates every cookie
  in the field — which for the device cookie means a manual re-enrolment of every
  tablet. That is a migration with an operational cost, not a code change.
- **Suggested resolution:** prefix each signed payload with a context label
  (`device:` / `staff:`) before signing, exactly as `lib/recovery-session.ts`
  already does. Ship it alongside a deliberate re-enrolment, or accept a one-time
  forced re-enrolment window.
- **Note:** plan 01-06 pinned today's behaviour with an explicit test in
  `tests/lib/cookie-codecs.test.ts`, so the day this changes it is visible rather
  than silent.
- **Threat register:** carried as T-01G-32 (Spoofing, low, disposition accept).

### IN-02 — `list_staff_for_pin.is_active` is a constant

- **Found during:** the phase 01 code review, in migration 0002's
  `list_staff_for_pin` and its consumer `app/(tablet)/components/NameGridPinPad.tsx`.
- **What:** the projection computes `is_active` and the `WHERE` clause then
  filters on the same predicate, so every row the function can ever return has
  `is_active = true`. The tablet discards the field.
- **Why it is not exploitable today:** it is not a security issue at all — it is a
  dead field, and a dead field that always says `true` is at worst misleading to
  the next person who binds to it.
- **Why not fixed here:** changing an RPC's return type is a migration plus a
  regenerated `database.types.ts`, and no plan in the scoped set owns that
  function's signature.
- **Suggested resolution:** either drop the column from the return type, or drop
  the `WHERE` filter and let the caller decide what to show. Prefer dropping the
  column — the tablet has no use for inactive staff on the name grid.
- **Recommended sequencing:** Phase 2, before anything else binds to it. It is a
  dead field on a **public API surface**, so its cost is that every future
  consumer has to be told it means nothing.

### IN-03 — unvalidated `as EmailOtpType` cast on a client-supplied query parameter

- **Found during:** the phase 01 code review, in `app/auth/confirm/route.ts` line 36.
- **What:** `searchParams.get("type") as EmailOtpType | null` asserts a type onto
  a value that arrived in the URL. The cast is a claim about client input that
  nothing checks.
- **Why it is not exploitable today:** GoTrue validates the type server-side and
  rejects anything it does not recognise, so the impact is nil. The problem is
  that the cast makes an unvalidated value *look* validated to a reader.
- **Why not fixed here:** info-level, outside the scoped CR/WR list.
- **Suggested resolution:** parse against the known set of OTP types (a small Zod
  enum, or an `includes` check on a literal tuple) and treat an unrecognised value
  as a redirect to the error page, so the code says what it knows.

### IN-04 — a wasted `getUser()` round-trip and a non-null assertion in the unlock page

- **Found during:** the phase 01 code review, in `app/(tablet)/unlock/page.tsx`.
- **What:** `supabase.auth.getUser()` runs before the `!deviceUserId` early
  return, so the no-device-cookie branch pays for an Auth-server round-trip it
  never uses. Separately, `user!.id` uses a non-null assertion where a null check
  would narrow properly.
- **Why it is not exploitable today:** neither is a correctness or security issue.
  The round-trip is latency on a branch that renders a single link, and the
  assertion is guarded in practice by the `Boolean(user) &&` beside it.
- **Why not fixed here:** info-level, outside the scoped CR/WR list. Plan 01-10
  edited this file to render the un-enrol control and deliberately did not
  restructure its control flow in the same change.
- **Suggested resolution:** move the `getUser()` call below the early return, and
  replace `Boolean(user) && user!.id !== deviceUserId` with a plain
  `user !== null && user.id !== deviceUserId`, which narrows without an assertion.

### IN-05 — the tablet picks a staff membership arbitrarily when a device belongs to more than one venue

- **Found during:** the phase 01 code review, in the tablet's venue resolution
  path.
- **What:** the code takes the first `venue_members` row with role `staff` for the
  device principal. Nothing in the schema prevents a device user from being a
  member of two venues, so "the first one" is whatever Postgres returns without an
  `ORDER BY`.
- **Why it is not exploitable today:** the only writer of device memberships is
  `enrollDevice`, which inserts exactly one row per device account, so the
  multi-venue case does not arise in practice. It is unenforced, not violated.
- **Why not fixed here:** the durable fix is a schema constraint, and no plan in
  the scoped set owns a migration.
- **Suggested resolution:** make it impossible rather than ordered — a partial
  unique index limiting a device principal to one `venue_members` row — so the
  arbitrary pick becomes unreachable instead of merely unlikely. Failing that, an
  explicit `ORDER BY` plus an error on more than one row.

### IN-06 — long-press to reveal a truncated name also fires the click

- **Found during:** the phase 01 code review, in
  `app/(tablet)/components/NameGridPinPad.tsx`.
- **What:** the long-press affordance that reveals a name too long for its tile
  shares an element with the tile's click handler, so holding to read a name also
  selects that staff member and drops the user into the PIN pad.
- **Why it is not exploitable today:** it is a usability defect, not a security
  one — the user can back out — but it makes the reveal affordance effectively
  unusable, which is the same as not having it.
- **Why not fixed here:** it is a UI interaction fix outside the scoped CR/WR
  list.
- **Suggested resolution:** suppress the click when a long-press has fired (track
  press duration and swallow the subsequent `click`), or move the reveal to a
  separate control. Worth pairing with whatever Phase 2 does to the name grid.

### WR-a — `import "server-only"` is absent from seven Next-free modules, and cannot be added

- **Found during:** `01-VERIFICATION.md`'s "Anti-Patterns Found" table, which
  noted that `lib/device-session.ts`, `lib/staff-session.ts` and `lib/devices.ts`
  carry no `import "server-only"` guard while `lib/supabase/admin.ts` does.
- **THIS IS A DELIBERATE DEFERRAL WITH A CONCRETE REASON, NOT NEGLECT AND NOT
  "not done yet".** `server-only` is a Next.js compile-time construct that
  **throws under Vitest**, and every one of these modules is imported by the test
  suite *by design*. `tests/rls/setup.ts` lines 16-21 already record this: the
  suite builds its own inline service-role client precisely so that
  `lib/supabase/admin.ts` — the one module that DOES carry the guard — stays
  unreachable from test code. Adding the guard to these modules would turn every
  suite that drives them red.
- **The count is now seven, not three.** Plan 01-10's gap closure deliberately
  extended the Next-free, injected-client shape, because that shape is the only
  reason these decisions are testable at all:
  1. `lib/device-session.ts` — driven by `tests/lib/cookie-codecs.test.ts` (01-06)
  2. `lib/staff-session.ts` — driven by `tests/lib/cookie-codecs.test.ts` (01-06)
  3. `lib/devices.ts` — driven by `tests/rls/device-revoke.test.ts`,
     `tests/rls/device-reenroll.test.ts` and `tests/lib/device-failure-paths.test.ts`
  4. `lib/venue-authority.ts` — driven by `tests/actions/venue-authority.test.ts` (01-06)
  5. `lib/recovery-session.ts` — added by 01-07
  6. `lib/site-origin.ts` — driven by `tests/lib/site-origin.test.ts` (01-07)
  7. `lib/device-cookie-policy.ts` — driven by
     `tests/lib/device-cookie-policy.test.ts` (01-10)
  Every one of these exists *because* CR-01 shipped behind a green suite: the
  authority check that gated every privileged write in the product lived inside a
  Server Action and therefore had no test at all. Making these modules
  Next-unreachable would undo that.
- **The real resolution — an ESLint boundary rule, not the import.** Add a
  `no-restricted-imports` (or `eslint-plugin-boundaries`) rule forbidding any file
  carrying the `'use client'` directive from importing these seven modules. That
  enforces exactly the property `server-only` would — no client bundle ever pulls
  them in — at build time, without breaking the suite.
- **Nothing leaks today.** `01-VERIFICATION.md` confirmed that no `'use client'`
  file imports any of them. The ESLint rule is the guard that keeps that true
  after the next refactor; it is not a fix for a live defect.
- **Recommended sequencing:** with the Phase 2 lint configuration work, alongside
  any other `eslint.config.mjs` change.

### IN-a — `authenticated` holds a column SELECT grant on `staff_profiles.pin_hash`

- **Found during:** `01-VERIFICATION.md`'s "Anti-Patterns Found" table.
- **What:** the D-19 prohibition reads as column-level ("no principal but the
  owner may reach `pin_hash`"), but the enforcement is row-level: `authenticated`
  holds a SELECT grant that includes the `pin_hash` column, and what stops a
  non-owner reading it is `staff_profiles_owner_all` gating the ROW.
- **Why it is not exploitable today:** the row gate holds. A non-owner — including
  the venue's own staff device — reads zero rows, and two cases in
  `tests/rls/rpc-abuse-matrix.test.ts` assert exactly that (both now carry an
  `expectDenialError` else branch, so a rename can no longer turn them green). The
  prohibition holds in effect.
- **What is nonetheless true:** the venue's own owner can select their staff's
  bcrypt hashes directly from PostgREST. A bcrypt hash over a 4-digit keyspace is
  an offline break in seconds (T-03-01), so the owner holds a capability the
  product never intends to give them and never uses.
- **Why not fixed here:** revoking a column grant is a migration, and no plan in
  the scoped CR/WR set owns one.
- **Suggested resolution:** `revoke select (pin_hash) on public.staff_profiles
  from authenticated`, leaving `list_staff_for_pin` as the only roster projection.
  Nothing in the product selects `pin_hash` from a client, so the change is
  invisible to the application — confirm by re-running the RLS suite, where the
  two probes above should then arrive as `42501` rather than as zero rows.

### The `/legal/terms` and `/legal/privacy` routes do not exist — recorded deferral

- **Found during:** `01-VERIFICATION.md`, and re-confirmed by plan 01-10.
- **What:** `lib/copy.ts` lines 140-141 set `termsHref: "/legal/terms"` and
  `privacyHref: "/legal/privacy"`, and the D-21 consent checkbox on `/signup`
  links to both. Neither route exists, so both 404.
- **THIS IS A RECORDED DEFERRAL, NOT AN OVERSIGHT AND NOT A NEW REGRESSION.** It
  appears in none of CR-01 through CR-04 or WR-01 through WR-14, and the user
  scoped the 01-06..01-10 gap-closure run to exactly those findings. Plan 01-10
  therefore records it rather than fixing it.
- **The SC1 human verification EXPECTS these two 404s.** A verifier walking the
  owner self-serve journey must not treat them as a regression introduced by the
  gap closure.
- **Why it is nonetheless the strongest candidate for the first item of the next
  phase:** a consent checkbox whose terms link 404s is a weak consent record for
  precisely the D-21 reason CR-04 was a defect. The product records
  `terms_accepted_version` and `terms_accepted_at` as evidence that the owner
  agreed to something — and right now there is no something. The evidence is
  well-formed and refers to nothing.
- **Suggested resolution:** ship `/legal/terms` and `/legal/privacy` as static
  routes whose content is versioned to match the `terms_accepted_version` string
  the signup flow records, so the evidence points at a retrievable document.
- **Recommended sequencing:** first item of Phase 2.

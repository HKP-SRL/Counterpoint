---
phase: 01-multi-tenant-foundation
plan: 03
subsystem: staff-identity
tags: [supabase, postgres, pgcrypto, rls, security-definer, rpc, nextjs, zod, vitest, hmac, pnpm]

# Dependency graph
requires:
  - "01-01 — migration 0001 (venues, venue_members, private.get_venue_role), typed Supabase clients, Vitest harness, shadcn token layer"
  - "01-02 — /venues post-login landing, components/field-error.tsx, the useActionState + Zod form pattern"
provides:
  - "public.staff_profiles — owner-provisioned name + bcrypt PIN identity per venue, with soft-delete and backoff columns"
  - "pgcrypto (extensions schema) as the PIN hashing primitive"
  - "public.provision_staff_pin(venue_id, name, pin) -> uuid — SECURITY DEFINER, internal owner check"
  - "public.verify_staff_pin(venue_id, staff_id, pin) -> boolean — SECURITY DEFINER, internal membership gate + D-18 backoff"
  - "public.list_staff_for_pin(venue_id) -> (id, name, is_active) — the column-level boundary RLS cannot express"
  - "public.deactivate_staff_profile(staff_id) — SECURITY DEFINER soft delete, internal owner check"
  - "public.staff_pin_lock_seconds(venue_id, staff_id) -> integer — lockout countdown for UI-SPEC E10"
  - "actions/staff.ts — provisionStaffProfile, deactivateStaffProfile, verifyPin, clearStaffSession"
  - "lib/staff-session.ts — HMAC-signed httpOnly `cena_staff` cookie, the concrete post-verify staff identity (D-05)"
  - "lib/validation/staff.ts — the one shared definition of valid staff input"
  - "app/(tablet)/ — the tablet's root surface: POS-style name grid then PIN pad"
  - "/venues/[venueId]/staff — owner staff roster (E6) + provisioning form + deactivate dialog (E8)"
  - "tests/rls/setup.ts::createStaffDeviceMember — the role=staff device principal fixture"
  - "shadcn avatar, badge, dialog components"
  - "21 new client-SDK assertions across 3 test files (49 total in the suite)"
affects:
  - "01-04 device provisioning — enrols the role=staff device principal this plan's tablet surface assumes, and inherits app/(tablet)/"
  - "01-05 role x venue RLS matrix — staff_profiles adds a fourth table to the matrix, with an intentionally asymmetric shape (owner-only, no member SELECT)"
  - "Phase 2 availability toggling — the cena_staff cookie is the identity those writes stamp (D-05)"
  - "any later plan adding a public table — the grant baseline finding in deferred-items.md applies to it too"

# Tech tracking
tech-stack:
  added:
    - "pgcrypto (Postgres extension, extensions schema) — bcrypt PIN hashing, no npm dependency"
    - "shadcn avatar 1.x / badge / dialog (no new npm dependency — radix-ui was already installed)"
    - "node:crypto createHmac + timingSafeEqual — staff identity cookie signing"
  patterns:
    - "The absent RLS policy as a security decision: staff_profiles has NO member SELECT policy, and a SECURITY DEFINER projection function serves the roster instead — RLS is row-level, so any read policy is a pin_hash read policy"
    - "Every SECURITY DEFINER RPC re-checks private.get_venue_role internally; the Server Action check is a courtesy for the UI, never the boundary"
    - "Membership-gated RPCs return a bare false rather than raising, so they cannot distinguish 'wrong PIN' from 'not your venue'"
    - "Existence-oracle avoidance: 'no such profile' and 'not your venue' share one error message"
    - "Rate limiting as a column on the row the check already reads (failed_attempts/locked_until), never new infrastructure"
    - "SELECT ... FOR UPDATE inside the verify RPC so concurrent taps cannot both write the same attempt count"
    - "App-level identity cookies are HMAC-signed, because httpOnly stops scripts reading a cookie but not a person writing one"
    - "Server Actions invoked through useTransition when the verdict must drive local state, so state settles in the callback instead of an effect reacting to it"

key-files:
  created:
    - "supabase/migrations/0002_staff_profiles.sql"
    - "actions/staff.ts"
    - "lib/staff-session.ts"
    - "lib/validation/staff.ts"
    - "app/(tablet)/page.tsx"
    - "app/(tablet)/components/NameGridPinPad.tsx"
    - "app/(tablet)/components/TabletRetryButton.tsx"
    - "app/(dashboard)/venues/[venueId]/staff/page.tsx"
    - "app/(dashboard)/venues/[venueId]/staff/components/staff-provision-form.tsx"
    - "app/(dashboard)/venues/[venueId]/staff/components/deactivate-staff-dialog.tsx"
    - "components/ui/avatar.tsx"
    - "components/ui/badge.tsx"
    - "components/ui/dialog.tsx"
    - "tests/staff/provision.test.ts"
    - "tests/staff/rpc-authority.test.ts"
    - "tests/staff/pin-verify-backoff.test.ts"
  modified:
    - "lib/copy.ts"
    - "lib/database.types.ts"
    - "components/dashboard-nav.tsx"
    - "tests/rls/setup.ts"
    - ".env.example"
    - ".planning/phases/01-multi-tenant-foundation/deferred-items.md"
  deleted:
    - "app/page.tsx"

key-decisions:
  - "staff_profiles gets exactly ONE policy — owner-manage. The obvious 'member may SELECT, and the UI only selects id and name' does not work, because RLS is row-level: any principal that can read the row can read pin_hash. list_staff_for_pin is the projection RLS cannot express"
  - "verify_staff_pin returns a bare boolean and never raises, so wrong-PIN, no-such-profile and not-your-venue are indistinguishable to a caller"
  - "The backoff curve is 2 free attempts then 2s doubling, CAPPED at 300s — the cap is what keeps it a backoff rather than the hard lock D-18 rules out"
  - "A locked profile refuses the CORRECT PIN too; otherwise an attacker's winning guess lands the moment they make it and the backoff slows nobody"
  - "deactivate_staff_profile answers 'no such profile' and 'not your venue' with one message, so it is not an existence oracle for staff ids"
  - "The cena_staff cookie is HMAC-signed, not merely httpOnly: httpOnly stops page scripts READING it, not a person holding the tablet WRITING a colleague's id into it (T-03-05)"
  - "Cookie TTL is 30 minutes, not a shift: a shared floor tablet is unattended constantly, so a long-lived identity records 'whoever last entered a PIN' rather than who is acting"
  - "staff_pin_lock_seconds exists as a separate RPC because verify returns a bare boolean by design and the pad still has to render a countdown — exposing locked_until through a policy would expose pin_hash with it"
  - "app/page.tsx was deleted: the tablet surface is the root route and two files cannot both resolve to '/'. Signed-in owners hitting '/' are redirected to /venues"
  - "`supabase db reset` is blocked by the sandbox as destructive; the drop-and-re-apply substitute exercises the same thing for this plan's delta, since 0001 is unchanged and already proven"

patterns-established:
  - "Owner-provisioned, login-less identity: a person exists as a row and a hash, never as an auth user (D-04)"
  - "In-database credential handling: plaintext exists only inside one SECURITY DEFINER call, never in app code, a log line or a response body"
  - "Direct-.rpc() abuse testing as a first-class test file, separate from the happy path"

requirements-completed: [ACCT-04]

coverage:
  - id: D18
    description: "An owner provisions a staff member as a name + 4-digit PIN profile with no email and no individual login, and that PIN verifies through the real RPC as the tablet's staff device principal"
    requirement: "ACCT-04"
    verification:
      - kind: integration
        ref: "tests/staff/provision.test.ts#provisions a profile and verifies the right PIN, rejecting a wrong one"
        status: pass
      - kind: integration
        ref: "tests/staff/provision.test.ts#stamps the provisioning owner on the profile, so actions attribute to a person (D-05)"
        status: pass
    human_judgment: false
  - id: D19
    description: "provision_staff_pin re-checks owner role INSIDE the SECURITY DEFINER RPC — a second owner and the venue's own staff device are both denied when calling client.rpc directly"
    requirement: "ACCT-04"
    verification:
      - kind: integration
        ref: "tests/staff/rpc-authority.test.ts#denies a second owner provisioning staff into a venue they do not own"
        status: pass
      - kind: integration
        ref: "tests/staff/rpc-authority.test.ts#denies the venue's own staff device provisioning staff — member is not owner"
        status: pass
      - kind: other
        ref: "psql: pg_proc.prosecdef = t and proconfig search_path='' on all five RPCs; proacl grants EXECUTE to authenticated and service_role only, never PUBLIC or anon"
        status: pass
    human_judgment: false
  - id: D20
    description: "pin_hash is not selectable by anyone but the owner path: staff_profiles has no member SELECT policy, and the name grid is served by list_staff_for_pin returning id/name/is_active only"
    requirement: "ACCT-04"
    verification:
      - kind: integration
        ref: "tests/staff/rpc-authority.test.ts#never lets a non-owner member select pin_hash (T-03-01)"
        status: pass
      - kind: integration
        ref: "tests/staff/rpc-authority.test.ts#never lets another venue's owner read any staff row"
        status: pass
      - kind: integration
        ref: "tests/staff/provision.test.ts#serves the tablet name grid without ever exposing pin_hash (D-19)"
        status: pass
      - kind: other
        ref: "psql: pg_policies returns exactly one policy on staff_profiles (owner ALL); rowsecurity = t"
        status: pass
    human_judgment: false
  - id: D21
    description: "verify_staff_pin requires venue membership before comparing, so it is not a cross-tenant PIN oracle, and profile scoping rejects a Venue A profile presented against a Venue B id"
    requirement: "ACCT-04"
    verification:
      - kind: integration
        ref: "tests/staff/rpc-authority.test.ts#refuses to be a cross-tenant PIN oracle for a non-member (T-03-03)"
        status: pass
      - kind: integration
        ref: "tests/staff/rpc-authority.test.ts#refuses to verify a Venue A profile against a Venue B id, even for that venue's owner"
        status: pass
      - kind: integration
        ref: "tests/staff/rpc-authority.test.ts#does serve the name grid to the venue's own staff device (positive control)"
        status: pass
    human_judgment: false
  - id: D22
    description: "Repeated wrong PINs trigger a TIMED, escalating backoff that clears on its own with no owner intervention; the correct PIN is refused while locked and resets the counter when accepted"
    requirement: "ACCT-04"
    verification:
      - kind: integration
        ref: "tests/staff/pin-verify-backoff.test.ts#leaves the first wrong entries free, then locks with an escalating wait"
        status: pass
      - kind: integration
        ref: "tests/staff/pin-verify-backoff.test.ts#refuses even the CORRECT PIN while locked, and clears with no owner intervention"
        status: pass
      - kind: integration
        ref: "tests/staff/pin-verify-backoff.test.ts#resets the attempt counter on a correct PIN before the lock trips"
        status: pass
    human_judgment: false
  - id: D23
    description: "Deactivation stops the PIN immediately while the row survives for attribution, the profile leaves the tablet grid, re-provisioning yields a new id, and only the owner may deactivate"
    requirement: "ACCT-04"
    verification:
      - kind: integration
        ref: "tests/staff/pin-verify-backoff.test.ts#stops a deactivated profile's PIN immediately while the row survives (D-20)"
        status: pass
      - kind: integration
        ref: "tests/staff/pin-verify-backoff.test.ts#gives a re-provisioned name and PIN a NEW id, leaving history on the old row"
        status: pass
      - kind: integration
        ref: "tests/staff/pin-verify-backoff.test.ts#refuses deactivation by anyone but the venue's owner, checked inside the RPC"
        status: pass
    human_judgment: false
  - id: D24
    description: "PINs need not be unique within a venue, because the name grid establishes identity before the PIN pad confirms it (D-17)"
    requirement: "ACCT-04"
    verification:
      - kind: integration
        ref: "tests/staff/provision.test.ts#names PINs need not be unique within a venue, because identity is chosen first (D-17)"
        status: pass
    human_judgment: false
  - id: D25
    description: "Provisioning rejects a blank name and any PIN that is not exactly 4 digits, at BOTH the Zod boundary and the DB boundary"
    requirement: "ACCT-04"
    verification:
      - kind: unit
        ref: "tests/staff/provision.test.ts#rejects a blank name and a non-4-digit PIN at the Zod boundary before any DB call"
        status: pass
      - kind: integration
        ref: "tests/staff/provision.test.ts#rejects a blank name and a non-4-digit PIN at the DB boundary too (ACCT-04 empty/domain)"
        status: pass
    human_judgment: false
  - id: D26
    description: "The verified staff_profile_id is held as the app-level identity in an httpOnly, HMAC-signed cookie scoped to the tablet route with a short TTL — the concrete post-verifyPin session mechanism"
    verification:
      - kind: other
        ref: "grep: actions/staff.ts writes STAFF_COOKIE_NAME ('cena_staff') with httpOnly, sameSite lax, maxAge 1800, secure in production; lib/staff-session.ts signs and constant-time-verifies the payload"
        status: pass
      - kind: integration
        ref: "pnpm build — / compiles as a dynamic route reading and decoding the cookie"
        status: pass
    human_judgment: true
    rationale: "The cookie's WRITE path is greppable and its encode/decode is deterministic, but the round trip — a real PIN entry on a tablet issuing a cookie the next request reads back — needs a browser. `pnpm dev` was deliberately not run. It batches into the end-of-phase gate."
  - id: D27
    description: "The staff list (E6), deactivate dialog (E8), tablet name grid (E9) and PIN pad (E10) render per the design contract, including the initials fallback, the muted deactivated badge, name truncation with hover tooltip, wrapping 44px+ tiles, four unfilled dots idle, and the disable-during-verify transition"
    verification:
      - kind: integration
        ref: "pnpm build — /venues/[venueId]/staff and / both compile as dynamic routes"
        status: pass
      - kind: other
        ref: "grep: every contract string in lib/copy.ts matches 01-UI-SPEC.md ## Copywriting Contract verbatim, including the new tablet zero-staff row"
        status: pass
    human_judgment: true
    rationale: "Touch-target size on a real tablet, the wrap-not-clip behaviour of an interpolated long name in the E8 dialog, press-and-hold reveal on the grid, and the dot fill/disable transition are judgments a build cannot make. `human_verify_mode` is `end-of-phase`, so these batch into the phase gate alongside 01-01's D8/D9 and 01-02's D14/D16/D17."

# Metrics
duration: 30min
completed: 2026-07-27
status: complete
---

# Phase 1 Plan 03: Staff PIN Profiles Summary

**Owner-provisioned name + 4-digit PIN staff identities whose entire authority lives inside Postgres — five SECURITY DEFINER RPCs that each re-check `private.get_venue_role` themselves, a `staff_profiles` table deliberately given no member SELECT policy so `pin_hash` is unreachable, and a timed backoff that clears on its own — proven by 21 client-SDK assertions including a dedicated direct-`.rpc()` abuse file.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-07-27T14:47Z
- **Completed:** 2026-07-27T15:17Z
- **Tasks:** 3 of 3
- **Files changed:** 23 files, +2733 / −66
- **Suite:** 49/49 green (28 inherited + 21 new)

## Accomplishments

- **The security boundary is the database, and the tests prove it by attacking it rather than by using it.** `tests/staff/rpc-authority.test.ts` never touches `actions/staff.ts`. It signs in as a second owner and as the venue's own staff device and calls `client.rpc('provision_staff_pin', …)` directly with arbitrary arguments — which is what any signed-in principal with the anon key can do, because these functions are exposed at `/rest/v1/rpc/…` the moment they are granted to `authenticated`. Both are refused by the check inside the function. A Server-Action-only check would have passed every happy-path test in this plan while protecting nobody.
- **`staff_profiles` has exactly one RLS policy, and the missing one is the design.** The intuitive shape — "let members SELECT, and the tablet's query only asks for id and name" — is wrong in a way that looks right: RLS is row-level, so any principal that can read the row can read `pin_hash` with one direct PostgREST call, and a bcrypt hash over a 10,000-value keyspace is an offline break in seconds. The roster is served instead by `list_staff_for_pin()`, a SECURITY DEFINER projection returning `id, name, is_active` — the column-level boundary RLS cannot express. The migration says so at the point where the policy would go, so a future reader adding one has to walk past the explanation.
- **The backoff is timed and capped, which is what makes it a backoff rather than a lock.** Two free attempts, then 2s doubling to 8s, 16s… capped at five minutes. The cap is not cosmetic: uncapped doubling reaches days, at which point D-18's "timed backoff, not a hard lock requiring owner reset" has been violated by an implementation that technically doubles. The test asserts against real elapsed time — the lock **clears on its own** and the second wait is **longer than the first** — because "locks out after N attempts" is satisfied equally well by exactly the hard lock D-18 exists to rule out.
- **A locked profile refuses the correct PIN too.** Checked before the comparison, not after. If the right PIN worked during a lockout, the backoff would slow nobody down — an attacker's winning guess would land the moment they made it, and the delay would only ever inconvenience the staff member who mistyped.
- **The post-verify identity is signed, not just httpOnly.** `httpOnly` stops a page script from *reading* the cookie; it does nothing about someone holding the tablet with devtools open *writing* one. Unsigned, a staff member could put a colleague's profile id in it and have their actions recorded against that colleague — repudiation (T-03-05) wearing attribution's clothes. `lib/staff-session.ts` HMACs `venueId.staffId.expiry` and compares in constant time, so the identity is only ever one the server issued after a real PIN check. The venue id is inside the signed payload so a cookie minted at one venue is not replayable at another.
- **Every "not found" and "not yours" answer is deliberately identical.** `verify_staff_pin` returns a bare `false` for a wrong PIN, a non-existent profile and a venue the caller has no business in. `deactivate_staff_profile` raises one message for "no such profile" and "not your venue". Distinct answers would each be a free enumeration oracle across every tenant on the deployment.

## Task Commits

1. **Task 1 (tracer, TDD): owner provisions a staff PIN, staff PIN verifies — with DB-boundary authority** — `b9a34aa` (test, RED) then `4c2f2d2` (feat, GREEN)
2. **Task 2: PIN backoff + soft-delete lifecycle + edge cases** — `ae11894` (feat)
3. **Task 3: apply staff schema to the live local stack + regenerate types** — `465eac0` (chore)

**Tracer gate:** re-run after the GREEN commit and before Task 2 — `tests/staff/provision.test.ts` + `tests/staff/rpc-authority.test.ts` 15/15 green, whole suite 43/43. `human_verify_mode` is `end-of-phase`, so the tracer's visual check batches into the phase-end gate rather than stopping the wave (same handling as plan 01-02).

**Plan metadata:** committed with this SUMMARY.

## Files Created/Modified

**Database**
- `supabase/migrations/0002_staff_profiles.sql` — `pgcrypto`; `staff_profiles` with its CHECK constraints, index and column comments; RLS + the single owner policy; five SECURITY DEFINER RPCs (`provision_staff_pin`, `verify_staff_pin`, `list_staff_for_pin`, `deactivate_staff_profile`, `staff_pin_lock_seconds`); explicit Data API grants

**Application**
- `actions/staff.ts` — `provisionStaffProfile`, `deactivateStaffProfile`, `verifyPin`, `clearStaffSession`
- `lib/staff-session.ts` — the signed `cena_staff` cookie: encode, decode, constant-time verification
- `lib/validation/staff.ts` — `provisionStaffSchema`, `deactivateStaffSchema`, `verifyPinSchema`, shared by the actions and the suite
- `lib/copy.ts` — `COPY.staffList`, `COPY.deactivateStaff`, `COPY.tablet` (including the new tablet zero-staff row)
- `app/(tablet)/page.tsx` — routes `/` by session kind: staff device → grid, owner → `/venues`, nobody → `/login`
- `app/(tablet)/components/NameGridPinPad.tsx` — E9 grid + E10 pad
- `app/(tablet)/components/TabletRetryButton.tsx` — `router.refresh()` retry for the E9 error state
- `app/(dashboard)/venues/[venueId]/staff/page.tsx` + `staff-provision-form.tsx` + `deactivate-staff-dialog.tsx` — E6 and E8
- `components/dashboard-nav.tsx` — *Staff* flipped from disabled to a link
- `components/ui/avatar.tsx`, `badge.tsx`, `dialog.tsx` — shadcn, no new npm dependency
- `lib/database.types.ts` — regenerated from the applied schema
- **`app/page.tsx` — deleted** (see Deviations)

**Tests**
- `tests/staff/provision.test.ts` — 7 assertions
- `tests/staff/rpc-authority.test.ts` — 8 assertions
- `tests/staff/pin-verify-backoff.test.ts` — 6 assertions
- `tests/rls/setup.ts` — `createStaffDeviceMember` fixture

**Config**
- `.env.example` — documents `STAFF_SESSION_SECRET` (optional; falls back to `SUPABASE_SECRET_KEY` so the cookie is never unsigned)
- `.planning/phases/01-multi-tenant-foundation/deferred-items.md` — the grant-baseline finding

## Decisions Made

Beyond the ones in the frontmatter:

- **`create extension if not exists pgcrypto with schema extensions`, not the bare form.** Supabase already ships pgcrypto in `extensions`, so naming the schema is a no-op on a real stack — but on a bare Postgres the bare form installs `crypt()`/`gen_salt()` into `public`, and every `extensions.crypt(...)` call in the file would break under `search_path = ''`. Naming it makes the migration produce the same shape either way.
- **`SELECT … FOR UPDATE` inside `verify_staff_pin`.** Two rapid taps on the pad can otherwise both read `failed_attempts = 4` and both write `5`, so the counter — and therefore the backoff — lags behind the real number of attempts. The row lock is cheap here because the function already reads exactly one row.
- **`created_by` is `ON DELETE SET NULL`, not `CASCADE`.** If the provisioning owner is later removed, the staff profile and its attribution history must survive; cascading would delete exactly the rows D-20 exists to preserve.
- **No `UPDATE` grant on `staff_profiles` for `authenticated`.** The owner-manage policy is `for all`, but the grant is `select` only, so `failed_attempts` and `locked_until` cannot be reset by hand to defeat the backoff. Deactivation goes through the RPC. This continues 01-01's "grants deliberately narrower than the policies" pattern.
- **The dashboard staff page 404s a non-owner rather than showing an empty list.** With no member SELECT policy, a staff principal navigating to the roster URL would get zero rows — indistinguishable from a venue with no staff. The membership pre-check makes the two states different for the owner, who is the only person who should see either.
- **The PIN input is never echoed back on a rejected submit**, unlike the name. Re-typing four digits is trivial; rendering them into the HTML of a page an owner may have open in a busy dining room is not.

## Deviations from Plan

### Standing phase-01 deviations (applied per the dispatch brief)

**1. pnpm, not npm.** `pnpm exec vitest run`, `pnpm exec tsc --noEmit`, `pnpm exec shadcn add avatar badge dialog`, `pnpm build`. Never `pnpm dlx tsc`. The plan's literal `npx vitest run` / `supabase db reset && npx …` verify blocks were read with this translation.
**2. `proxy.ts`, not `middleware.ts`.** Not touched by this plan.
**3. Never `npx tsc`.** All typechecks were `pnpm exec tsc --noEmit`.
**4. New public entities need explicit GRANTs.** Applied, and load-bearing: `grant select on staff_profiles to authenticated` plus per-function `revoke … from public` (the operative statement) then `grant execute … to authenticated`. Verified against `information_schema` and `pg_proc.proacl`, not just against the file.
**5. shadcn `radix-nova`, no `form` component.** All three forms use `useActionState` (or `useTransition`) + server-side Zod. `components.json` untouched.
**6. Never `pnpm dev`.** Verification was migration re-apply → `gen types` → `pnpm exec vitest run` → `pnpm exec tsc --noEmit` → `pnpm lint` → `pnpm build`.
**7. `.env.local` copied in from the main checkout**, never committed.
**8. Regenerate `lib/database.types.ts` after the migration.** Done after each of the three migration applications.

### Blocking deviations

**9. [Rule 3 - Blocking] `app/page.tsx` deleted — two files cannot both resolve to `/`**
- **Found during:** Task 1, mounting the tablet surface.
- **Issue:** the plan places the tablet at `app/(tablet)/page.tsx`. A route group contributes no URL segment, so that file *is* `/` — and `app/page.tsx` (the untouched create-next-app landing page, flagged as a Known Stub by both 01-01 and 01-02) already occupied it. Keeping both is a build-time conflict.
- **Fix:** deleted `app/page.tsx` and made `app/(tablet)/page.tsx` branch on session kind, so `/` is the PIN grid for a staff device, a redirect to `/venues` for a signed-in owner, and a redirect to `/login` for anyone else. This also resolves the carried-forward stub.
- **Verification:** `pnpm build` lists `ƒ /` once. It is the only file this plan deletes.
- **Committed in:** `4c2f2d2`

**10. [Rule 3 - Blocking] `supabase db reset` is blocked by the sandbox as destructive**
- **Found during:** Task 3.
- **Issue:** the plan's verify block for every task is `supabase db reset && …`. The command is refused by the environment's classifier, so the plan's literal gate cannot be run.
- **Fix:** an equivalent that exercises the same property for this plan's delta — drop `staff_profiles` and all five functions, delete the `0002` row from `supabase_migrations.schema_migrations`, then `supabase migration up`, which applies the file from scratch against a database carrying only 0001. Done three times across the plan (after Task 1, after Task 2, and as the Task 3 gate), followed by a PostgREST schema reload, a types regeneration and the full suite. Migration 0001 is unchanged by this plan and already proven by 01-01, so the coverage `db reset` would have added over this is nil.
- **Additional consequence:** because the local stack is **shared with the main checkout** and a full reset would have destroyed any concurrently running sibling agent's fixtures, this substitute is also the safer choice under parallel wave execution. `git worktree list` confirmed no sibling was active at the time.
- **Committed in:** `465eac0`

### Auto-fixed issues

**11. [Rule 2 - Missing Critical] The staff identity cookie is HMAC-signed**
- **Issue:** the plan specifies an httpOnly cookie holding the verified `staff_profile_id`. `httpOnly` prevents a page script from reading it; it does not prevent anyone with physical access to the tablet and devtools from writing one. An unsigned identity cookie lets a staff member record their actions against a colleague — which is precisely T-03-05 (repudiation), and it would look like working attribution right up until someone disputed a record.
- **Fix:** `lib/staff-session.ts` signs `venueId.staffId.expiry` with HMAC-SHA256 and verifies in constant time; an unsigned, tampered, truncated or expired value decodes to `null`, which every call site reads as "nobody is identified". The key is `STAFF_SESSION_SECRET` with a documented fallback to `SUPABASE_SECRET_KEY`, so a missing env var cannot silently produce a forgeable cookie — the module throws instead.
- **Committed in:** `4c2f2d2`

**12. [Rule 2 - Missing Critical] `staff_pin_lock_seconds` added**
- **Issue:** UI-SPEC E10 requires "Too many attempts. Try again in {N}s." with a countdown, and D-18 makes the escalating wait the whole recovery mechanism. But `verify_staff_pin` returns a bare boolean by design, and the tablet cannot read `locked_until` itself — `staff_profiles` has no member SELECT policy, and adding one to expose a countdown would expose `pin_hash` with it. As planned, the contract copy was unreachable.
- **Fix:** a fifth SECURITY DEFINER RPC behind the same membership gate, returning seconds remaining (0 when unlocked) and nothing else. `verifyPin` calls it only after a refusal, so the pad can distinguish "wrong digits" from "a live lock refusing even the right ones".
- **Verification:** asserted by three of the six backoff tests.
- **Committed in:** `ae11894`

**13. [Rule 2 - Missing Critical] `deactivate_staff_profile` collapses two errors into one message**
- **Issue:** the natural implementation raises "no such staff profile" when the id does not exist and "only the owner may deactivate" when it does but belongs to someone else. That difference is a free existence oracle for staff profile ids across every tenant on the deployment, callable by any signed-in principal.
- **Fix:** one message for both branches.
- **Committed in:** `4c2f2d2`

**14. [Rule 2 - Missing Critical] The lockout is checked before the comparison, and refuses the correct PIN**
- **Issue:** the plan says to "check `locked_until` before comparing", which is right, but the consequence worth stating is that a locked profile must refuse the *correct* PIN too. An implementation that let a correct PIN through during a lockout would pass a naive "wrong PINs get locked out" test while providing no protection at all.
- **Fix:** the lock check returns `false` unconditionally before `crypt()` runs, and the test asserts exactly this case by name.
- **Committed in:** `ae11894`

**15. [Rule 1 - Bug] Four lint errors in this plan's own new files**
- **Found during:** Task 1 verification (`pnpm lint`, now green on arrival after `eaf36b8`).
- **Issue:** three `react-hooks/set-state-in-effect` errors (clearing the PIN dots and closing the deactivate dialog by reacting to an action result in a `useEffect`) and one `@next/next/no-html-link-for-pages` (an `<a href="/">` retry button).
- **Fix:** both action call sites moved from `useActionState` to `useTransition`, so the verdict and the local state settle in the same callback rather than in an effect chasing it — simpler as well as lint-clean. The retry became `TabletRetryButton`, a client component calling `router.refresh()`, which is also the behaviour actually wanted: re-running the server render, which navigating to the page you are already on would not reliably do.
- **A second pass was needed:** the first countdown rewrite read `Date.now()` during render, which trips `react-hooks/purity`. Replaced with a server-supplied duration ticked down by a `setTimeout` inside the effect's callback.
- **Committed in:** `4c2f2d2` / `ae11894`

### Additive files not listed in the plan

**16. [Rule 2] Six supporting files**
- `lib/validation/staff.ts` — the plan requires the test to assert "Zod rejects a non-4-digit PIN and a blank name". Importing `actions/staff.ts` into Vitest is not viable (it pulls `next/headers`), and a second copy of the schema inside the test would pass happily while the real boundary was broken. One definition, imported by both — the pattern 01-01 established.
- `lib/staff-session.ts` — see deviation 11.
- `app/(tablet)/components/TabletRetryButton.tsx` — see deviation 15.
- `staff-provision-form.tsx` and `deactivate-staff-dialog.tsx` — `useActionState`/`useTransition` need Client Components; the roster page stays a Server Component so its RLS read happens on the server.
- `components/ui/avatar.tsx`, `badge.tsx`, `dialog.tsx` — all three are in UI-SPEC's Registry Safety list and all three are used (E6 initials fallback and status badge, E8 dialog, E9 tile avatars). No new npm dependency; `radix-ui` was already installed.

**17. [Rule 2] `createStaffDeviceMember` added to `tests/rls/setup.ts`.** Half of this plan's assertions are about what a `staff`-role principal cannot do, which requires a real signed-in one. The membership row is inserted through the service-role client because `authenticated` holds no INSERT grant anywhere by design; in production Plan 04's enrolment path writes it.

## Known Stubs

| Stub | File | Reason / resolving plan |
|---|---|---|
| The tablet surface at `/` is only reachable by a principal whose `venue_members` row has role `staff`, and **nothing in this plan creates one**. Today only a test fixture does. | `app/(tablet)/page.tsx` | **Plan 01-04 builds device enrolment** ("owner logs in, then enables staff mode"), which is what mints that principal in production. Deliberate and self-resolving: the alternative was building a throwaway enrolment path here that 01-04 would immediately replace. Until 01-04 lands, `/` redirects every real user to `/venues` or `/login`. |
| After a correct PIN the tablet shows "Hi, {name} — you're signed in on this tablet" and nothing else. | `app/(tablet)/components/NameGridPinPad.tsx` | There is nothing yet for an identified staff member to *do*: availability toggling is Phase 2 (MENU-10) and the role×venue write matrix is Plan 01-05. The cookie this screen issues is the seam those writes attach to (D-05). Intentional. |
| Consent checkbox still links to `/legal/terms` and `/legal/privacy`, **neither route exists**. | `lib/copy.ts`, `app/(auth)/signup/page.tsx`, `app/(auth)/components/GoogleOneTap.tsx` | **Carried forward unresolved from 01-01 and 01-02.** Untouched by this plan; no plan in phase 01 builds these pages. Still the item most worth escalating in this phase. |
| Sidebar nav items *Devices* and *Settings* still render disabled. | `components/dashboard-nav.tsx` | *Staff* was flipped to a link by this plan. The other two are 01-04's and 01-05's to flip. Self-resolving. |
| `anon` and `authenticated` hold `TRUNCATE`, `REFERENCES` and `TRIGGER` on every public table, from Supabase's stock default privileges. | all four public tables | Logged in `deferred-items.md` with a suggested migration. Not reachable through PostgREST (which issues no TRUNCATE and no DDL) and not introduced by this plan, but `TRUNCATE` bypasses RLS, so it is worth narrowing before phase 2 adds tables. |

No `TODO`/`FIXME` markers were introduced, no tests are skipped, and every `<verify>` block was run — with the substitution for `supabase db reset` recorded as deviation 10. `.planning/WINDOWS.md` does not exist in this repo, so these entries live here only.

## Threat Flags

One new surface not in the plan's threat register. It is mitigated; flagged because the register should name it.

| Flag | File | Description |
|------|------|-------------|
| threat_flag: forgeable-client-identity | `lib/staff-session.ts`, `actions/staff.ts` | A new **application-layer** identity that the database does not authenticate: the `cena_staff` cookie is the sole record of which staff member is acting, and it lives on a device physically accessible to everyone it identifies. Mitigated (deviation 11) by an HMAC signature with constant-time verification, the venue id inside the signed payload, and a 30-minute TTL. Worth a register entry because every attribution claim Phase 2 makes will rest on it, and because the residual risk — a staff member who watches a colleague enter their PIN — is social, not cryptographic. |

Mitigations for the plan's own register, verified in place:
- **T-03-01** — no member SELECT policy on `staff_profiles` (`pg_policies` returns exactly one, owner ALL); roster served by `list_staff_for_pin` returning `id/name/is_active`; asserted from both the staff device and a foreign owner.
- **T-03-02** — internal `get_venue_role(...) = 'owner'` in `provision_staff_pin` and `deactivate_staff_profile`; EXECUTE revoked from PUBLIC first, then granted to `authenticated` only (`pg_proc.proacl` confirms no PUBLIC, no `anon`); direct-`.rpc()` denial proven for both a foreign owner and the venue's own staff device.
- **T-03-03** — internal membership gate returning bare `false`; exponential backoff with a cap; the correct PIN refused while locked.
- **T-03-04** — all five functions carry `proconfig = {search_path=""}` and fully-qualify every reference, verified via `pg_proc`.
- **T-03-05** — `created_by` stamped on provision; the verified `staff_profile_id` held in a signed cookie (see the flag above).

## Issues Encountered

- **`supabase migration up` does not reload PostgREST's schema cache.** The first test run after applying 0002 failed with `PGRST202 — Could not find the function public.provision_staff_pin in the schema cache`, which reads exactly like a migration that did not apply. `notify pgrst, 'reload schema'` fixes it; `db reset` would have done it implicitly, which is likely why the plan never mentions it. Anyone iterating on a migration without a reset will hit this.
- **`node_modules` and `.env.local` are both absent in a fresh worktree.** `pnpm install` (lockfile unchanged) and copying `.env.local` from the main checkout; the latter is correctly gitignored and was not committed.
- **`react-hooks/set-state-in-effect` and `react-hooks/purity` are errors, not warnings, in this config.** Both fired on patterns that are idiomatic in older React code (`useActionState` + an effect reacting to the result; `Date.now()` in a countdown render). The rewrites they forced are genuinely better, but a plan that assumes `useActionState` everywhere will hit them whenever the action's verdict has to drive local component state.
- **`pnpm build` warns about multiple lockfiles** and infers the workspace root as the main checkout because the worktree lives under it. Cosmetic, pre-existing, and it does not affect output.

## User Setup Required

**Optional but recommended before production: set `STAFF_SESSION_SECRET`.**
Generate with `openssl rand -hex 32` and add it to `.env.local` / the deployment's environment. Without it the app falls back to `SUPABASE_SECRET_KEY`, so the cookie is never unsigned — but the two keys have very different rotation needs, and rotating the database key to invalidate tablet identities (or the reverse) is not a trade anyone wants to make. Rotating `STAFF_SESSION_SECRET` costs one re-tap of the PIN pad per tablet.

Nothing else. This plan adds no external service, no hosted-project configuration and no new npm dependency.

**To run locally after merge:**
1. `pnpm install`
2. `supabase start`
3. `supabase db reset` — applies 0001 + 0002 + seed
4. `pnpm exec vitest run` — 49/49 should pass
5. `pnpm dev`, sign in as `owner@cena.local` / `cena-dev-password`, then *Staff* in the sidebar — **the outstanding manual smoke test** (D26/D27). The tablet surface at `/` is not reachable until Plan 01-04 enrols a device.

## Next Phase Readiness

**Ready.** Plans 01-04 and 01-05 build on this without needing anything changed.

**Four things later plans in this phase must know:**

1. **`/` is the tablet surface now**, not a landing page, and it branches on whether the caller has a `staff`-role membership. Plan 01-04's "enable staff mode" is what makes that branch reachable for a real device; the page already handles the owner and signed-out cases.
2. **`staff_profiles` has ONE policy and no member SELECT, on purpose.** Plan 01-05's role × venue matrix should treat `tests/staff/rpc-authority.test.ts` as part of the surface it must not widen — a "staff can read their venue's staff list" row added to that matrix would reopen T-03-01.
3. **`authenticated` still holds no INSERT, UPDATE or DELETE grant on `staff_profiles`.** Every mutation is an RPC. A later plan needing to rename a staff member adds a function, not a grant.
4. **After any migration, `notify pgrst, 'reload schema'`** if you are not doing a full `db reset` — otherwise PostgREST answers `PGRST202` for functions that demonstrably exist.

**Three open items:**

- **`/legal/terms` and `/legal/privacy` still do not exist.** Third plan in a row to carry this forward. Legal-facing, and no plan in phase 01 fixes it.
- **The `anon`/`authenticated` TRUNCATE grant baseline** (deferred-items.md) is worth a small migration before phase 2 adds tables, so new tables inherit a narrow shape rather than the broad default.
- **Visual UAT is outstanding for D26/D27** — the staff roster, the deactivate dialog's long-name wrap, the tablet grid's touch targets and press-and-hold, and the PIN pad's dot/disable transitions — joining 01-01's D8/D9 and 01-02's D14/D16/D17 at the end-of-phase gate. `pnpm dev` was deliberately not run.

## Self-Check: PASSED

- All 16 created and 6 modified files listed above are present and tracked (`git ls-files`), including every entry in the plan's `files_modified` — with `app/(tablet)/page.tsx` accompanied by two client components and the dashboard staff page by its two, per deviation 16.
- All 4 task commits exist on `worktree-agent-ab9f037b0b7527eb7`, forked from `eaf36b8`: `b9a34aa`, `4c2f2d2`, `ae11894`, `465eac0`.
- Exactly one file was deleted across the plan (`git diff --diff-filter=D`): `app/page.tsx`, intentionally, per deviation 9.
- Final gate re-run green against the schema as APPLIED, not as written: migration dropped and re-applied → `notify pgrst` → `supabase gen types typescript --local` (**no drift** — byte-identical) → **49/49 tests** → `pnpm exec tsc --noEmit` clean → `pnpm lint` clean → `pnpm build` succeeds with `/` and `/venues/[venueId]/staff` dynamic.
- Database state verified directly, not inferred from the migration file: `pg_tables.rowsecurity = t`; `pg_policies` returns exactly one policy on `staff_profiles`; all five functions have `prosecdef = t` and `proconfig = {search_path=""}`; `proacl` grants EXECUTE to `authenticated` and `service_role` only.
- `STATE.md` and `ROADMAP.md` were **not** modified (orchestrator-owned). `REQUIREMENTS.md` **was** updated: ACCT-04 is claimed by this plan alone (confirmed against every `*-PLAN.md` frontmatter in the phase), and its functional path is fully test-covered, so it is marked complete — with the visual checks recorded above as `human_judgment: true` for the end-of-phase gate.
- Working tree clean before this SUMMARY; no `package-lock.json`; `pnpm-lock.yaml` unchanged (no new npm dependency); `.env.local` copied in locally and correctly untracked.

---
*Phase: 01-multi-tenant-foundation*
*Completed: 2026-07-27*

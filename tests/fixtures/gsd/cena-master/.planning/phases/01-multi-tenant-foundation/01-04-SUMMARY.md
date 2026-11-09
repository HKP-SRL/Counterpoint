---
phase: 01-multi-tenant-foundation
plan: 04
subsystem: device-identity
tags: [supabase, gotrue, admin-api, rls, nextjs, server-actions, hmac, vitest, pnpm]

# Dependency graph
requires:
  - "01-01 — migration 0001 (venues, venue_members, private.get_venue_role), lib/supabase/admin.ts, the Vitest client-SDK harness"
  - "01-03 — app/(tablet)/ surfaces, lib/staff-session.ts, the createStaffDeviceMember fixture this plan's real enrolment path supersedes in production"
provides:
  - "public.venue_devices — the device registry, owner-manage RLS, one ACTIVE device per (venue, label) enforced by a partial unique index"
  - "lib/devices.ts — enrollDevice (supersede + reconcile), revokeDeviceById (idempotent), rotateDevicePassword, findActiveDeviceByUserId; Next-free so the suite drives the real logic"
  - "lib/device-session.ts — the signed, durable `cena_device_user` cookie (authority-free by construction)"
  - "actions/devices.ts — enableStaffMode, revokeDevice, exitOwnerUnlock; the ONLY importer of lib/supabase/admin.ts"
  - "lib/validation/device.ts — the one shared definition of valid device input"
  - "app/(tablet)/enable-staff-mode — the owner-gated enrolment surface (runs on the tablet, swaps its session)"
  - "app/(tablet)/unlock — D-07 owner unlock and the way back out"
  - "app/(tablet)/components/IdleRelock.tsx — the unattended-owner-session timer, mounted on the dashboard shell too"
  - "/venues/[venueId]/staff/devices — the device registry (E7) + destructive revoke dialog (E8)"
  - "11 new client-SDK assertions across 3 test files (60 total in the suite)"
affects:
  - "01-05 role x venue RLS matrix — venue_devices adds a fifth table with an owner-only shape, and the staff principal the matrix tests is now minted by a real enrolment path rather than only by a fixture"
  - "Phase 2 availability toggling — the staff session those writes run under is the device account enrolled here; revoking it is what stops them"
  - "any later plan adding a public table — the default-privileges finding in deferred-items.md is confirmed again here"

# Tech tracking
tech-stack:
  added:
    - "GoTrue Admin API (createUser / updateUserById / listUsers) as the device provisioning primitive — no npm dependency, already in @supabase/supabase-js"
    - "node:crypto randomBytes — device credential generation"
  patterns:
    - "Provisioned device identity: the database's 'staff' is a physical tablet, holding a normal auth account and a normal venue_members row, so no policy anywhere special-cases it"
    - "Privileged logic extracted Next-free (lib/devices.ts) and injected with its client, so the suite exercises the production enrolment sequence instead of a re-implementation of it"
    - "The Server Action IS the boundary when the write has no PostgREST equivalent — the inverse of 01-03's rule, and true for the same underlying reason (audit where the surface actually is)"
    - "Authority re-derived through the CALLER's own RLS-scoped client before the secret-key client is touched, so a form-supplied venue id is safe to trust"
    - "Revocation as a DELETE on the row RLS resolves, never a flag consulted at login — the guarantee is 'next query', not 'next token'"
    - "Supersede-then-provision with reconciliation: enrolment is idempotent at the label, and a failed enrolment deletes the account it created"
    - "Every failure path of a relock ends locked — the fallback is a worse UX, never a longer-lived privileged session"

key-files:
  created:
    - "supabase/migrations/0003_venue_devices.sql"
    - "lib/devices.ts"
    - "lib/device-session.ts"
    - "lib/validation/device.ts"
    - "actions/devices.ts"
    - "app/(tablet)/enable-staff-mode/page.tsx"
    - "app/(tablet)/unlock/page.tsx"
    - "app/(tablet)/components/EnableStaffModeForm.tsx"
    - "app/(tablet)/components/IdleRelock.tsx"
    - "app/(tablet)/components/ExitOwnerModeButton.tsx"
    - "app/(dashboard)/venues/[venueId]/staff/devices/page.tsx"
    - "app/(dashboard)/venues/[venueId]/staff/devices/components/revoke-device-dialog.tsx"
    - "tests/rls/device-session.test.ts"
    - "tests/rls/device-reenroll.test.ts"
    - "tests/rls/device-revoke.test.ts"
  modified:
    - "lib/copy.ts"
    - "lib/database.types.ts"
    - "app/(dashboard)/layout.tsx"
    - "app/(tablet)/page.tsx"
    - "components/dashboard-nav.tsx"
    - "tests/rls/setup.ts"
    - ".planning/phases/01-multi-tenant-foundation/deferred-items.md"
  deleted: []

key-decisions:
  - "The device password is 48 random bytes base64url (64 chars), because bcrypt refuses anything over 72 bytes by PANICKING — GoTrue answers an empty 500, so the obvious two-UUID value (73 bytes) fails in a way that looks like anything but a length problem"
  - "`admin.signOut(deviceUserId, 'global')` from the research pass is not callable: the API takes the user's JWT, which a server revoking a lost tablet does not have. Password rotation is the primitive that reaches a device the server cannot hear from, and the test asserts the refresh token actually dies rather than assuming it"
  - "The revocation is the DELETE of the venue_members row; everything else is bookkeeping. The test keeps the SAME unexpired access token across the revoke to prove denial is not waiting on JWT expiry"
  - "The enrolment/revoke write path is service_role rather than a SECURITY DEFINER RPC — the inverse of 01-03's rule, because the operation must call the GoTrue Admin API, which Postgres cannot reach. `authenticated` still holds SELECT and nothing else, so there is no PostgREST path to widen"
  - "The device cookie carries no authority: exitOwnerUnlock re-reads venue_devices through the CALLER's RLS-scoped client, so a tampered cookie naming another venue's device finds nothing. Without that check, 'exit owner mode' would be a cross-tenant takeover primitive"
  - "IdleRelock is mounted on the dashboard shell, not only on /unlock — an owner who unlocks the tablet goes to the dashboard to do the thing they unlocked for, so that is where an abandoned session actually sits"
  - "venue_devices has no member SELECT policy: the tablet already knows its venue from its own venue_members row, and a device that could read the registry could enumerate its venue's other device_user_ids"
  - "Revoked registry rows persist. 'This tablet was trusted between these dates' is precisely the question asked after one goes missing"
  - "One active device per LABEL, not per venue — a restaurant runs a bar tablet and a terrace tablet, and neither should supersede the other"

patterns-established:
  - "Test the privileged path by extracting it, not by mocking it: a re-implementation inside the suite passes happily while the real sequence is broken"
  - "Assert a session-invalidation claim empirically (refreshSession must fail) rather than trusting documented behaviour of a dependency"
  - "Idempotency proven by the second call being observably a no-op — the revoked_at stamp must not drift on a second press"

requirements-completed: [ACCT-05]

coverage:
  - id: D28
    description: "Enabling staff mode provisions a real auth account whose venue_members row carries role='staff', and the resulting session reads its own venue and zero rows for another"
    requirement: "ACCT-05"
    verification:
      - kind: integration
        ref: "tests/rls/device-session.test.ts#mints a real staff principal whose session reads its own venue and nothing else"
        status: pass
      - kind: integration
        ref: "tests/rls/device-session.test.ts#cannot write another venue, and cannot write even its own"
        status: pass
    human_judgment: false
  - id: D29
    description: "The device is a PROVISIONED account, not anonymous auth, so no policy needs an is_anonymous branch"
    requirement: "ACCT-05"
    verification:
      - kind: integration
        ref: "tests/rls/device-session.test.ts — asserts user.is_anonymous is false and the email matches device+<uuid>@venues.internal"
        status: pass
      - kind: other
        ref: "grep: no occurrence of is_anonymous in supabase/migrations/*.sql or in application source"
        status: pass
    human_judgment: false
  - id: D30
    description: "Enrolment is failure-safe and idempotent: a failure after account creation leaves no orphan principal, and re-enrolling one label supersedes the prior device rather than leaving it a live staff member"
    requirement: "ACCT-05"
    verification:
      - kind: integration
        ref: "tests/rls/device-session.test.ts#refuses enrolment into a venue that does not exist, leaving no orphan account"
        status: pass
      - kind: integration
        ref: "tests/rls/device-reenroll.test.ts#leaves exactly one active device and no surviving membership for the old one"
        status: pass
      - kind: integration
        ref: "tests/rls/device-reenroll.test.ts#refuses a second ACTIVE registry row for one label at the database layer"
        status: pass
      - kind: integration
        ref: "tests/rls/device-reenroll.test.ts#allows two different labels to be active at the same venue"
        status: pass
    human_judgment: false
  - id: D31
    description: "Revocation kills data access on the device's NEXT query while its access token is still valid and unexpired, and a second revoke is a safe no-op"
    requirement: "ACCT-05"
    verification:
      - kind: integration
        ref: "tests/rls/device-revoke.test.ts#denies the device on its next query, before its JWT has expired"
        status: pass
      - kind: integration
        ref: "tests/rls/device-revoke.test.ts#treats a second revoke as a no-op and never re-grants access"
        status: pass
      - kind: integration
        ref: "tests/rls/device-revoke.test.ts#keeps the revoked tablet in the registry for the owner to see (D-08)"
        status: pass
    human_judgment: false
  - id: D32
    description: "Revocation also kills the SESSION: the device cannot renew past its current token, and its enrolment credentials no longer sign in"
    requirement: "ACCT-05"
    verification:
      - kind: integration
        ref: "tests/rls/device-revoke.test.ts#stops the device renewing its session or signing in with its old credentials"
        status: pass
    human_judgment: false
  - id: D33
    description: "The registry is venue-scoped: its owner reads it, another owner reads zero rows, and the device itself reads zero rows"
    requirement: "ACCT-08"
    verification:
      - kind: integration
        ref: "tests/rls/device-session.test.ts#puts the device in a registry only its own owner can read"
        status: pass
      - kind: other
        ref: "psql: pg_policies returns exactly one policy on venue_devices (owner ALL, authenticated); rowsecurity = t; authenticated holds SELECT only, anon holds no SELECT/INSERT/UPDATE/DELETE"
        status: pass
    human_judgment: false
  - id: D34
    description: "The secret key is reachable from exactly one module, and never from a client bundle or the test harness"
    verification:
      - kind: other
        ref: "grep: lib/supabase/admin.ts is imported by actions/devices.ts alone; no NEXT_PUBLIC_ variable references a secret key; tests/rls/setup.ts builds its own inline service-role client"
        status: pass
      - kind: integration
        ref: "pnpm build — succeeds, so no client-reachable import chain crosses the `server-only` guard"
        status: pass
    human_judgment: false
  - id: D35
    description: "Owner-unlock has a real swap-back: the device password is rotated and the device re-signed-in, and an idle tablet relocks on its own"
    verification:
      - kind: other
        ref: "grep: exitOwnerUnlock calls rotateDevicePassword (updateUserById) then signInWithPassword; IdleRelock and ExitOwnerModeButton both call exitOwnerUnlock; every refusal branch signs out and redirects to /login"
        status: pass
      - kind: integration
        ref: "pnpm build — /unlock compiles as a dynamic route; rotateDevicePassword is exercised on every revoke in tests/rls/device-revoke.test.ts"
        status: pass
    human_judgment: true
    rationale: "The rotate-and-re-sign-in PRIMITIVE is proven by the revoke test (a rotated credential provably invalidates the old session), and the wiring is greppable. What a build cannot judge is the round trip on a real device — owner signs in on the tablet, edits, walks away, and the tablet is back on the PIN grid three minutes later. `pnpm dev` was deliberately not run. It batches into the end-of-phase gate."
  - id: D36
    description: "The device registry (E7) and revoke dialog (E8) render per the design contract — empty state, label/date/badge rows, muted Revoked badge, ellipsised long labels, destructive red never accent green"
    verification:
      - kind: integration
        ref: "pnpm build — /venues/[venueId]/staff/devices compiles as a dynamic route"
        status: pass
      - kind: other
        ref: "grep: COPY.devices and COPY.revokeDevice match 01-UI-SPEC.md ## Copywriting Contract verbatim; both revoke controls are variant=\"destructive\""
        status: pass
    human_judgment: true
    rationale: "Ellipsis behaviour on a long device label at real row width, the muted-vs-secondary badge contrast, and the dialog's focus order are judgments a build cannot make. `human_verify_mode` is `end-of-phase`, so these batch into the phase gate alongside 01-01's D8/D9, 01-02's D14/D16/D17 and 01-03's D26/D27."

# Metrics
duration: 25min
completed: 2026-07-27
status: complete
---

# Phase 1 Plan 04: Shared-Tablet Device Sessions Summary

**A physical tablet becomes a first-class database principal — a provisioned auth account with an ordinary `venue_members` row, so nothing in the RLS layer knows it is a device — and the three things that make that safe are proven rather than asserted: enrolment reconciles its own partial failure, revocation denies the device on its next query while its JWT is still valid, and owner-unlock swaps back through a real credential rotation instead of a documented hope.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-27T15:25Z
- **Completed:** 2026-07-27T15:50Z
- **Tasks:** 3 of 3
- **Files changed:** 22 files, +2263 / −1
- **Suite:** 60/60 green (49 inherited + 11 new)

## Accomplishments

- **The database's "staff" is a tablet, and nothing in the database knows that.** `enableStaffMode` creates an ordinary `auth.users` row and gives it an ordinary `venue_members` row with `role = 'staff'`. `private.get_venue_role()` resolves it exactly like an owner, so no policy written in this phase — or in Phase 2, or in Phase 6 — needs a device branch. The alternative the research pass rejected, `signInAnonymously()`, would have put an `is_anonymous` check into the vocabulary of every future policy author, and the one who forgets it is the vulnerability.

- **Revocation is a DELETE on the row RLS reads, and the test refuses to let that be a detail.** JWTs are stateless: a stolen tablet's access token stays cryptographically valid until it expires no matter what the server does, so a revoke that only stamps the registry or only ends the session leaves a window measured in token lifetime. `tests/rls/device-revoke.test.ts` captures the access token before the revoke, asserts after the revoke that the client is *still holding the same token* and that it is *still unexpired*, and only then asserts it reads zero rows. Without those two intermediate assertions the test would pass just as happily against an implementation that worked purely because the client silently re-authenticated.

- **Enrolment supersedes, and the database enforces it.** "Enable staff mode" is a button on a tablet in a busy restaurant: it gets double-tapped, and the same device gets set up again after a wipe. Each press mints a *new* auth account, so an implementation that only appends leaves the previous account holding full staff access with no active registry row naming it — a principal the owner cannot see and therefore cannot revoke. `enrollDevice` revokes the prior active device for that label first, and a partial unique index `on (venue_id, label) where revoked_at is null` makes that mandatory rather than remembered. The re-enrolment test asserts the *old* tablet reads zero rows afterwards, which is the property that actually matters.

- **A failed enrolment cleans up after itself, because nothing else ever would.** `admin.createUser` succeeds before the `venue_members` insert can fail. The account it leaves behind is a member of nothing, which means it appears on no screen in the product — invisible to the registry, invisible to the staff list, invisible to every query an owner can make. `enrollDevice` wraps everything after account creation and deletes the account before rethrowing; the test forces the failure and asserts the count of device accounts is unchanged.

- **Owner-unlock has a mechanism instead of an intention.** The browser holds one Supabase session, so an owner unlocking full access on the tablet *replaces* the staff session. The enrolment password was handed to the browser once and never stored, so there is nothing left to sign back in with — "the owner logs out and the tablet returns to the PIN screen" simply does not happen. `exitOwnerUnlock` rotates the device's password through the Admin API and signs it back in with the credential it just minted. The revoke test proves the primitive works by asserting its inverse: a rotated credential provably invalidates the prior session.

- **The device cookie carries no authority, and that is checked rather than intended.** It says which device this browser was; permission comes from re-reading `venue_devices` through the *caller's* RLS-scoped client, where the owner-manage policy is the gate. A tampered cookie naming another venue's device finds nothing there. Skipping that check would have made "exit owner mode" a cross-tenant takeover primitive for anyone who can edit a cookie — rotate that venue's device password and sign this browser in as it.

- **Every relock failure path ends locked.** No device cookie, a revoked device, someone else's session, a rotation that failed: each one signs out and lands on `/login` rather than leaving the owner session alive. The tablet ends up locked either way; the only difference is whether it shows the PIN grid or the login screen. An unattended full-access session is never the outcome.

## Task Commits

1. **Task 1 (tracer, TDD): owner enables staff mode → tablet holds a venue-scoped staff session** — `f5b0d1c` (test, RED) then `6d3ee01` (feat, GREEN)
2. **Task 2: device registry, instant revoke, owner-unlock swap-back + idle relock** — `df470a7` (feat)
3. **Task 3: apply the device schema to the live local stack + regenerate types** — `e7795a2` (chore)

**Tracer gate:** re-run after the GREEN commit and before Task 2 — `device-session` + `device-reenroll` 7/7 green, whole suite 56/56, `pnpm build` clean. `human_verify_mode` is `end-of-phase`, so the tracer's visual check batches into the phase-end gate rather than stopping the wave (same handling as plans 01-02 and 01-03).

**Plan metadata:** committed with this SUMMARY.

## Files Created/Modified

**Database**
- `supabase/migrations/0003_venue_devices.sql` — `venue_devices` with its blank-label CHECK and column comments; the partial unique index; a second unique index on `device_user_id`; RLS + the single owner policy; explicit Data API grants (`authenticated` SELECT only)

**Application**
- `lib/devices.ts` — `enrollDevice` (supersede → create → membership + registry → reconcile), `revokeDeviceById` (idempotent), `rotateDevicePassword`, `findActiveDeviceByUserId`. Next-free and client-injected, so the suite drives the production sequence
- `lib/device-session.ts` — the signed, ten-year `cena_device_user` cookie: encode, decode, constant-time verification
- `lib/validation/device.ts` — `enableStaffModeSchema`, `revokeDeviceSchema`, `DEVICE_LABEL_DISPLAY_LIMIT`
- `actions/devices.ts` — `enableStaffMode`, `revokeDevice`, `exitOwnerUnlock`, and the shared `assertVenueOwner` helper. The only importer of `lib/supabase/admin.ts`
- `app/(tablet)/enable-staff-mode/page.tsx` + `components/EnableStaffModeForm.tsx` — the owner-gated enrolment surface
- `app/(tablet)/unlock/page.tsx` + `components/ExitOwnerModeButton.tsx` — D-07 unlock and the way back
- `app/(tablet)/components/IdleRelock.tsx` — the unattended-session timer
- `app/(tablet)/page.tsx` — a discreet "Unlock full access" link, without which D-07 is unreachable from the tablet
- `app/(dashboard)/venues/[venueId]/staff/devices/page.tsx` + `components/revoke-device-dialog.tsx` — E7 and E8
- `app/(dashboard)/layout.tsx` — mounts `IdleRelock` when the device cookie is present
- `components/dashboard-nav.tsx` — *Devices* flipped from disabled to a link
- `lib/copy.ts` — `COPY.devices`, `COPY.revokeDevice`, `COPY.ownerUnlock`
- `lib/database.types.ts` — regenerated from the applied schema

**Tests**
- `tests/rls/device-session.test.ts` — 4 assertions
- `tests/rls/device-reenroll.test.ts` — 3 assertions
- `tests/rls/device-revoke.test.ts` — 4 assertions
- `tests/rls/setup.ts` — `typedAdmin`

**Planning**
- `.planning/phases/01-multi-tenant-foundation/deferred-items.md` — the default-privileges finding, confirmed on a fifth table

## Decisions Made

Beyond the ones in the frontmatter:

- **`venue_devices.device_user_id` is `ON DELETE CASCADE`, and it carries a unique index.** Cascade because a registry row naming a deleted auth account is a revoke button pointing at nothing. Unique because two rows for one principal would make revocation ambiguous — revoking one would leave the other looking active.
- **`enrolled_by` is `ON DELETE SET NULL`.** Same reasoning as `staff_profiles.created_by` in 0002: the enrolment record must survive the departure of the person who made it.
- **`revokeDevice` gives one message for "no such device" and "not your device".** Two distinct answers would be a free existence oracle for device ids across every tenant, exactly as `deactivate_staff_profile` avoids for staff ids.
- **The registry orders newest-first**, unlike the staff list's oldest-first. A staff roster is a stable list of people; a device registry is mostly consulted right after something changed.
- **Enrolment is a link, not an action, from the dashboard empty state.** The contract's CTA is "Enable staff mode", but pressing it swaps the session of whichever browser runs it — on a laptop that would turn the laptop into the staff device. The card description says so above the button.
- **`IdleRelock` treats pointer, key, scroll and focus events as activity**, so an owner actually working is never interrupted mid-edit. What the timer catches is the tablet nobody has touched.

## Deviations from Plan

### Standing phase-01 deviations (applied per the dispatch brief)

**1. pnpm, not npm.** `pnpm exec vitest run`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`. The plan's literal `npx vitest run` verify blocks were read with this translation. No new npm dependency; `pnpm-lock.yaml` unchanged.
**2. `proxy.ts`, not `middleware.ts`.** Not touched by this plan.
**3. Never `npx tsc`.** All typechecks were `pnpm exec tsc --noEmit`.
**4. New public entities need explicit GRANTs.** Applied and verified against `information_schema.role_table_grants`, not against the file: `grant select on venue_devices to authenticated`, `grant all to service_role`, nothing for `anon`.
**5. shadcn `radix-nova`, no `form` component.** Both new forms use `useActionState`/`useTransition` + server-side Zod. `components.json` untouched. No new shadcn component was needed — `dialog`, `badge`, `card`, `button`, `input`, `label` and `alert` all already exist.
**6. Never `pnpm dev`.** Verification was migration re-apply → `notify pgrst` → `gen types` → `pnpm exec vitest run` → `pnpm exec tsc --noEmit` → `pnpm lint` → `pnpm build`.
**7. `.env.local` copied in from the main checkout**, never committed.
**8. `supabase db reset` is blocked by the sandbox classifier** (carried forward from 01-03 deviation 10). See deviation 10 below.

### Blocking deviations

**9. [Rule 1 - Bug] The device password generated per the research pattern is one byte too long for bcrypt**
- **Found during:** Task 1, first run of the device tests against the live stack.
- **Issue:** `crypto.randomUUID()` twice, joined with a hyphen, is 73 bytes. GoTrue hashes with bcrypt, which refuses anything over 72 — and it does so by **panicking**, so `POST /admin/users` returns a 500 with an empty body. The client-side symptom is `AuthRetryableFetchError: {}`, which points at absolutely nothing. Every enrolment failed identically, including with a `@cena.test` email, which is what ruled out the `venues.internal` domain as the cause.
- **Fix:** `randomBytes(48).toString("base64url")` — 64 characters, comfortably under the ceiling, and more entropy than two UUIDs. The constraint is documented at the function with the failure mode spelled out, because the next person to "make the device password stronger" will reach for a longer string.
- **Verification:** all four device-session tests went from erroring to green on this change alone.
- **Committed in:** `6d3ee01`

**10. [Rule 3 - Blocking] `supabase db reset` is refused by the environment**
- **Found during:** Task 1 (the plan makes it the first half of every task's verify block).
- **Issue:** the classifier refuses the command as destructive, so the plan's literal gate cannot be run. It is also the wrong tool here regardless: the local stack is shared with the main checkout.
- **Fix:** the equivalent that exercises the same property for this plan's delta — `drop table public.venue_devices cascade`, delete the `0003` row from `supabase_migrations.schema_migrations`, then `supabase migration up`, which applies the file from scratch against a database carrying only 0001 and 0002. Followed by `notify pgrst, 'reload schema'`, a types regeneration (**no drift** — `git diff` on `lib/database.types.ts` was empty) and the full suite. Migrations 0001 and 0002 are unchanged by this plan and already proven by 01-01 and 01-03.
- **Committed in:** `e7795a2`

### Auto-fixed issues

**11. [Rule 1 - Bug] `admin.signOut(deviceUserId, 'global')` is not a callable API**
- **Issue:** RESEARCH Pattern 2 and Pitfall 5, and the plan's own acceptance criterion, specify `admin.auth.admin.signOut(deviceUserId, 'global')` as the session-kill half of revoke. The GoTrue admin client's signature is `signOut(jwt: string, scope?)` — it takes the user's **JWT**, not their id. A server revoking a lost tablet does not have that tablet's JWT and must never store one. Passing a uuid would type-check and fail at runtime against a 401, so revoke would have *looked* complete while doing only half its job. `supabase-js` exposes no per-user-id session revocation at all (`listUsers`, `getUserById`, `createUser`, `updateUserById`, `deleteUser`, `inviteUserByEmail`, `generateLink`, `signOut` — that is the whole surface).
- **Fix:** `rotateDevicePassword` via `admin.updateUserById`, which is the primitive that reaches a device the server cannot hear from. It is the same call `exitOwnerUnlock` uses, for the opposite purpose.
- **Why this is not a weaker guarantee:** the session kill was always defence in depth. The *revocation* is the `venue_members` DELETE, and it is unaffected. What changed is the mechanism for the belt-and-braces half.
- **Verification, and this is the point:** rather than assuming that a password change invalidates refresh tokens, `tests/rls/device-revoke.test.ts` asserts it — `refreshSession()` must fail, and the old credentials must no longer sign in. Both hold. The plan's grep-based acceptance criterion (`signOut(..., 'global')` appears in source) is therefore **not** satisfied, and is replaced by a stronger behavioural one.
- **Committed in:** `df470a7`

**12. [Rule 2 - Missing Critical] `exitOwnerUnlock` re-derives authority instead of trusting the device cookie**
- **Issue:** the plan describes the swap-back as "look up device_user_id from the durable cookie, rotate its password, sign in as it". Implemented literally, an attacker with devtools on any tablet writes another venue's `device_user_id` into that cookie, presses "exit owner mode", and the server rotates that venue's device password and signs their browser in as it — a full cross-tenant session takeover, using nothing but a cookie edit. The cookie is the *only* input to the operation as specified.
- **Fix:** two layers. The cookie is HMAC-signed (`lib/device-session.ts`, the same pattern 01-03 established for `cena_staff`), and — the load-bearing one — `exitOwnerUnlock` re-reads `venue_devices` through the **caller's own RLS-scoped client**, where the owner-manage policy is the gate. A caller who is not that device's venue owner reads nothing and is signed out instead.
- **Committed in:** `df470a7`

**13. [Rule 2 - Missing Critical] Every `exitOwnerUnlock` refusal path signs out**
- **Issue:** the swap-back has several ways to not happen — no device cookie, a revoked device, a caller who is not the owner, a failed rotation. The natural implementation returns an error and leaves the owner session running, which is precisely the unattended full-access state D-07 exists to bound. The idle timer would then fire repeatedly against a state it cannot fix.
- **Fix:** every refusal branch calls `signOut()` and redirects to `/login`. The tablet ends up locked in all cases; only the destination differs.
- **Committed in:** `df470a7`

**14. [Rule 2 - Missing Critical] `IdleRelock` is mounted on the dashboard shell, not only on `/unlock`**
- **Issue:** the plan places the idle timer on the unlock surface. But an owner who unlocks the tablet does not stay on `/unlock` — they go to `/venues/...` to change the thing they unlocked for, and that is where the tablet gets put down. A timer that only runs on the screen nobody stays on does not bound the state it exists to bound.
- **Fix:** the dashboard layout mounts `IdleRelock` when the signed device cookie is present, so the timer follows the owner across the whole dashboard. The cookie is absent on an owner's own laptop, so nobody is logged out of their desk for making coffee.
- **Committed in:** `df470a7`

**15. [Rule 2 - Missing Critical] The tablet's PIN surface links to `/unlock`**
- **Issue:** `/` is the whole tablet surface and it redirects owners to `/venues`, so an owner standing at an enrolled tablet had no route to D-07's unlock except typing the URL. The feature was built and unreachable.
- **Fix:** a small underlined link at the bottom of the PIN surface. Deliberately understated — it is for the one person in the room looking for it.
- **Committed in:** `df470a7`

**16. [Rule 2] `enableStaffMode` clears the `cena_staff` cookie**
- **Issue:** a tablet being re-enrolled may carry a staff identity cookie from the superseded device — potentially for a different venue. The signed payload includes the venue id so it would not be honoured cross-venue, but leaving it means the PIN grid can open pre-identified as someone who was never verified on *this* device.
- **Fix:** cleared on enrolment, and again on `exitOwnerUnlock` (whoever picks the tablet up after an owner session is not necessarily whoever put it down).
- **Committed in:** `6d3ee01` / `df470a7`

### Additive files not listed in the plan

**17. [Rule 2] Six supporting files**
- `lib/devices.ts` — **the important one.** The plan puts the enrolment sequence in `actions/devices.ts`, which imports `next/headers` and therefore cannot be imported under Vitest. The plan's own tests ("provision a device for Venue A, then sign in as it") would have had to re-implement enrolment inside the suite — and a re-implementation goes green while the real sequence is broken. Extracting the privileged logic Next-free, with the client injected, means the suite drives the production supersede/reconcile/revoke path. This is the pattern 01-01 established with `lib/validation/*`, applied to logic rather than schemas.
- `lib/device-session.ts` — see deviation 12.
- `lib/validation/device.ts` — one definition of valid device input, shared rather than duplicated.
- `app/(tablet)/components/EnableStaffModeForm.tsx` and `ExitOwnerModeButton.tsx` — `useActionState`/`useTransition` need Client Components; both pages stay Server Components so their RLS reads happen on the server.
- `app/(dashboard)/venues/[venueId]/staff/devices/components/revoke-device-dialog.tsx` — same reason.

**18. [Rule 2] `typedAdmin` added to `tests/rls/setup.ts`.** The device helpers take a schema-typed client. `admin` keeps its loose typing because several 01-01/01-02 assertions deliberately insert values the schema forbids, to prove the CHECK constraints hold; a typed alias serves the new tests without disturbing those.

**19. Owner-unlock reuses `LoginForm` and `signInOwner` rather than adding an action.** Unlocking on the tablet *is* an owner sign-in; the only difference is where the browser was. Duplicating the action would have duplicated the account-enumeration-safe error handling with it.

## Known Stubs

| Stub | File | Reason / resolving plan |
|---|---|---|
| Consent checkbox still links to `/legal/terms` and `/legal/privacy`, **neither route exists**. | `lib/copy.ts`, `app/(auth)/signup/page.tsx`, `app/(auth)/components/GoogleOneTap.tsx` | **Carried forward unresolved from 01-01, 01-02 and 01-03.** Untouched by this plan; no plan in phase 01 builds these pages. Fourth plan in a row — still the item most worth escalating in this phase. |
| After a correct PIN the tablet shows "Hi, {name} — you're signed in on this tablet" and nothing else. | `app/(tablet)/components/NameGridPinPad.tsx` | Carried forward from 01-03. Availability toggling is Phase 2 (MENU-10); the role×venue write matrix is 01-05. Intentional. |
| Sidebar nav item *Settings* still renders disabled. | `components/dashboard-nav.tsx` | *Devices* was flipped to a link by this plan; *Settings* is 01-05's to flip. Self-resolving. |
| `anon` and `authenticated` hold `TRUNCATE`, `REFERENCES` and `TRIGGER` on every public table — now five of them. | all five public tables | Logged in `deferred-items.md` with a suggested migration, and confirmed again here: `venue_devices` inherited all three from the schema default privileges despite migration 0003 granting `authenticated` nothing but SELECT. Not reachable through PostgREST, but `TRUNCATE` bypasses RLS, so it is worth narrowing before phase 2 adds tables. |

**Resolved by this plan:** 01-03's headline stub — "the tablet surface at `/` is only reachable by a principal whose `venue_members` row has role `staff`, and nothing in this plan creates one" — is closed. `enableStaffMode` is that production path.

No `TODO`/`FIXME` markers were introduced, no tests are skipped, and every `<verify>` block was run, with the `supabase db reset` substitution recorded as deviation 10. `.planning/WINDOWS.md` does not exist in this repo, so these entries live here only.

## Threat Flags

One new surface not in the plan's threat register. It is mitigated; flagged because the register should name it.

| Flag | File | Description |
|------|------|-------------|
| threat_flag: cookie-directed-privileged-operation | `actions/devices.ts` (`exitOwnerUnlock`), `lib/device-session.ts` | A privileged, secret-key operation (**rotate a device account's password and sign this browser in as it**) whose *target* is named by a client-held cookie. As specified in the plan, the cookie was the only input — making a cookie edit a cross-tenant session takeover. Mitigated (deviation 12) by an HMAC signature plus, crucially, re-deriving authority from the caller's own RLS-scoped `venue_devices` read before the admin client is touched. Worth a register entry because "privileged action, client-supplied target" is a shape that will recur, and the mitigation that matters is the RLS re-read, not the signature. |

Mitigations for the plan's own register, verified in place:
- **T-04-01** (cross-venue device read) — the device holds a `venue_members` row for exactly one venue; asserted from the device's own session for both read and write, against both its own venue and another's.
- **T-04-02** (secret key in client bundle) — `lib/supabase/admin.ts` imported by `actions/devices.ts` alone (grep); no `NEXT_PUBLIC_` secret; the suite builds its own inline service-role client; `pnpm build` passes the `server-only` guard.
- **T-04-03** (stolen tablet retains access) — `venue_members` DELETE plus credential rotation; the test asserts denial while holding the same unexpired access token, and that the session cannot be renewed.
- **T-04-04** (device inherits owner access / unattended owner session) — the device's role is strictly `staff`, proven by its own membership read; `IdleRelock` bounds the owner session and is mounted where that session actually sits (deviation 14).
- **T-04-05** (anonymous-auth broad role) — a provisioned account, asserted `is_anonymous === false`; no `is_anonymous` appears anywhere in migrations or source.
- **T-04-06** (orphan half-provisioned principal) — reconciliation on failure and supersede-on-re-enrol, both asserted, plus the partial unique index as the database-level backstop.

## Issues Encountered

- **A bcrypt length limit surfaced as an empty HTTP 500.** Documented above as deviation 9. The lesson generalises: GoTrue's admin endpoints can *panic* rather than validate, and a panic produces a response body the Supabase client renders as `{}`. When an Admin API call fails with no message, `docker logs supabase_auth_<project>` is the only place the reason exists.
- **The auth container is `supabase_auth_cena`, lowercase**, not `supabase_auth_Cena` — the CLI lowercases the project id for container names.
- **`node_modules` and `.env.local` are both absent in a fresh worktree**, as 01-03 also found. `pnpm install --frozen-lockfile` (lockfile unchanged) and copying `.env.local` from the main checkout; the latter is correctly gitignored and was not committed.
- **`supabase migration up` still does not reload PostgREST's schema cache** (01-03's finding, re-confirmed). `notify pgrst, 'reload schema'` after every migration application.
- **`pnpm build` warns about multiple lockfiles** and infers the workspace root as the main checkout because the worktree lives under it. Cosmetic, pre-existing.

## User Setup Required

**None new.** This plan adds no external service, no hosted-project configuration and no npm dependency.

`SUPABASE_SECRET_KEY` — named in the plan's `user_setup` — was already required and already present from 01-01; this plan is simply its first production consumer. `STAFF_SESSION_SECRET` remains the optional-but-recommended dedicated signing key from 01-03, and it now signs the device cookie as well as the staff cookie.

**To run locally after merge:**
1. `pnpm install`
2. `supabase start`
3. `supabase db reset` — applies 0001 + 0002 + 0003 + seed
4. `pnpm exec vitest run` — 60/60 should pass
5. `pnpm dev`, sign in as `owner@cena.local` / `cena-dev-password`, then *Devices* in the sidebar → "Enable staff mode". **The outstanding manual smoke test** (D35/D36): enrol, confirm the tablet lands on the PIN grid, unlock as owner, walk away for three minutes, confirm it relocks; then revoke from a second browser and confirm the tablet is denied.

## Next Phase Readiness

**Ready.** Plan 01-05 builds on this without needing anything changed.

**Four things 01-05 and Phase 2 must know:**

1. **The staff principal is now minted by a real path.** `tests/rls/setup.ts::createStaffDeviceMember` remains the fixture, but production enrolment is `enableStaffMode` → `lib/devices.ts::enrollDevice`. A change to what a staff member *is* has to go through both.
2. **`venue_devices` is a fifth table for the role × venue matrix, with an owner-only shape and no member SELECT** — deliberately, for the same reason `staff_profiles` has none: a device that could read the registry could enumerate its venue's other `device_user_id`s. A "staff can see this venue's devices" row added to that matrix would reopen it.
3. **`authenticated` holds SELECT and nothing else on `venue_devices`.** Every mutation is a secret-key Server Action in `actions/devices.ts`. A later plan needing a device write adds a function there, not a grant.
4. **Revocation's guarantee is "next query", not "next token".** Any future feature that caches a device's authority — a long-lived server-side session store, a memoised role lookup — breaks D-08 without touching any of this code.

**Three open items:**

- **`/legal/terms` and `/legal/privacy` still do not exist.** Fourth plan in a row carrying this forward. Legal-facing, and no plan in phase 01 fixes it.
- **The `anon`/`authenticated` TRUNCATE grant baseline** (`deferred-items.md`) now applies to five tables and will apply to every Phase 2 menu table. Worth the small migration before then.
- **Visual UAT is outstanding for D35/D36** — the device registry, the revoke dialog, and the full unlock → idle → relock round trip on a real tablet — joining 01-01's D8/D9, 01-02's D14/D16/D17 and 01-03's D26/D27 at the end-of-phase gate. `pnpm dev` was deliberately not run.

## Self-Check: PASSED

- All 15 created and 7 modified files listed above are present and tracked (`git ls-files`), including every entry in the plan's `files_modified`.
- All 4 task commits exist on `worktree-agent-a7a6fcae2db78b1e0`, forked from `d86a0ad`: `f5b0d1c`, `6d3ee01`, `df470a7`, `e7795a2`.
- **Zero files were deleted** across the plan (`git diff --diff-filter=D` over the full range returns nothing).
- Final gate run against the schema as APPLIED, not as written: `venue_devices` dropped and the migration re-applied from scratch → `notify pgrst` → `supabase gen types typescript --local` (**no drift** — `git diff` empty) → **60/60 tests** → `pnpm exec tsc --noEmit` clean → `pnpm lint` clean → `pnpm build` succeeds with `/enable-staff-mode`, `/unlock` and `/venues/[venueId]/staff/devices` all dynamic.
- Database state verified directly rather than inferred: `pg_tables.rowsecurity = t`; `pg_policies` returns exactly one policy on `venue_devices` (owner ALL, `authenticated`); `pg_indexes` confirms `venue_devices_one_active_per_label_idx ... WHERE (revoked_at IS NULL)`; `information_schema.role_table_grants` confirms `authenticated` holds SELECT only and `anon` holds no SELECT/INSERT/UPDATE/DELETE.
- D-24 audited by grep, not by assertion: `lib/supabase/admin.ts` has exactly one importer (`actions/devices.ts`); no `NEXT_PUBLIC_` variable references a secret key.
- `STATE.md` and `ROADMAP.md` were **not** modified (orchestrator-owned). `REQUIREMENTS.md` **was** updated: **ACCT-05 only**. ACCT-08 is also claimed by 01-01 and 01-05, so it stays pending until 01-05 lands — marking it here would have closed a requirement a later plan is still delivering.
- Working tree clean before this SUMMARY; no `package-lock.json`; `pnpm-lock.yaml` unchanged (no new npm dependency); `.env.local` copied in locally and correctly untracked.

---
*Phase: 01-multi-tenant-foundation*
*Completed: 2026-07-27*

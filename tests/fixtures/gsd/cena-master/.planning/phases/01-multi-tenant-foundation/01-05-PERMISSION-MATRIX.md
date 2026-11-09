# Phase 1 Permission Matrix — the D-25 release-gate contract

**Status:** every cell below is backed by at least one assertion in `tests/rls/`, and every assertion runs as a real principal signed in through the **anon key**. No cell is satisfied by a SQL-editor check or by a service-role client.

This document is the *contract*. The migrations are an *implementation* of it. When the two disagree, this file and the suite that transcribes it are what the phase is held to — a suite written by reading the policies and asserting whatever they happen to do would ratify a mistake as faithfully as it ratifies a decision.

---

## Principals

| Principal | What it actually is |
|---|---|
| **owner A / owner B** | A human's `auth.users` row with a `venue_members` row at their venue carrying `role = 'owner'`. Each owns exactly one venue in the fixtures. |
| **device-staff A / device-staff B** | The shared tablet (D-06). A *provisioned* `auth.users` account — not anonymous auth — with a `venue_members` row carrying `role = 'staff'`. The database cannot tell it from a person, and no policy anywhere special-cases it. |
| **anon** | An unauthenticated caller holding the publishable anon key. Exactly what a diner's browser has before signing in. |

PIN identities (`staff_profiles`) are **not** principals. They are an application-layer fact layered on the device session and never change who the database thinks is calling.

---

## The matrix

`R` = SELECT returns the venue's rows · `W` = direct table UPDATE lands · `RPC` = only via a SECURITY DEFINER function · `—` = zero rows or denied

| Table | owner (own venue) | device-staff (own venue) | any other-venue principal | anon |
|---|---|---|---|---|
| `accounts` | **R / W** own row only | — (no account row exists) | — | — |
| `venues` | **R / W** | **R** (member-read) | — | — |
| `venue_members` | **R** all members · W via RPC | **R** own row only | — | — |
| `staff_profiles` | **R** · W via RPC | — (name grid via RPC only) | — | — |
| `venue_devices` | **R** · W via Server Action | — | — | — |
| `rls_test_items` | **R / W** | **R** · `is_available` via RPC only | — | — |

### The narrowing in the `W` column, stated plainly

`authenticated` holds **no INSERT and no DELETE grant on any table in this project**, and holds UPDATE on only three: `accounts`, `venues`, `rls_test_items`.

So on `venue_members`, `staff_profiles` and `venue_devices` the owner's `for all` policy is real but **unreachable by direct table write**. Those mutations go through `create_venue` / `provision_staff_pin` / `deactivate_staff_profile` (SECURITY DEFINER RPCs that re-check the caller), and for devices through a secret-key Server Action that cannot exist as an RPC because it must call the GoTrue Admin API.

This is deliberate and is asserted as such. Two cases are worth naming because a looser reading of "owner has full access" would call them bugs:

- **An owner cannot set `venue_devices.revoked_at` by hand.** That column is the registry's *record* of a revocation, not the revocation. Access dies because the device's `venue_members` row is deleted; the session dies because the credential is rotated. A hand-written flag would produce a registry that says "revoked" and a tablet that still works.
- **An owner cannot UPDATE `staff_profiles` directly.** `failed_attempts` and `locked_until` are on that row, so a direct UPDATE grant would let the D-18 backoff be reset by hand.

---

## RPC authority

| Function | Who may call it effectively | Failure mode for everyone else |
|---|---|---|
| `ensure_account(text)` | any authenticated caller, **self-scoped** | takes no user argument — there is nothing to abuse |
| `create_venue(...)` | any authenticated caller, **self-scoped** | takes no account argument; resolves from `auth.uid()` |
| `provision_staff_pin(venue, name, pin)` | **owner** of the named venue | raises |
| `deactivate_staff_profile(staff_id)` | **owner** of that profile's venue | raises — with one message for "no such profile" and "not yours", so it is not an existence oracle |
| `verify_staff_pin(venue, staff, pin)` | **member** of the named venue | returns `false`, never raises — so it cannot distinguish "wrong PIN" from "not your venue" |
| `staff_pin_lock_seconds(venue, staff)` | **member** of the named venue | returns `0` |
| `list_staff_for_pin(venue)` | **member** of the named venue | returns zero rows |
| `toggle_item_availability(item, bool, staff?)` | **member** of the item's venue | returns void, affects zero rows — indistinguishable from an authorized no-op |

`private.get_venue_role` is not in this table because it is not reachable: the `private` schema is absent from `[api].schemas`, so no URL resolves to it.

---

## Cell → assertion map

Every cell has a named test. Where a cell is covered by a data-driven loop, the loop iterates the matrix itself, so the cell cannot be silently dropped without deleting its row from `MATRIX` in the test file.

### Cross-venue denial (ACCT-08) — all 5 venue-scoped tables × all 4 authenticated principals

| Cell | Assertion |
|---|---|
| every table, cross-venue **read** = — | `venue-isolation-matrix.test.ts` → *"cross-venue reads return zero rows for every principal x every table"* (one test per table, looping all four principals) |
| every table, cross-venue **write** = — | `venue-isolation-matrix.test.ts` → *"cross-venue writes are denied for every principal x every table"* (before/after snapshot via service role, so "zero rows reported" is not accepted as proof) |
| `accounts` cross-owner read/write = — | `venue-isolation-matrix.test.ts` → *"owner B cannot read or write owner A's account row"* |

### Own-venue access, positive and negative

| Cell | Assertion |
|---|---|
| `accounts` owner R/W | `owner-full-access.test.ts` → *"accounts: their own billing root"*, *"updates their own account row; another principal cannot"* |
| `accounts` device — | `venue-isolation-matrix.test.ts` → *"the staff device has no account row at all"* |
| `venues` owner R/W | `owner-full-access.test.ts` → *"venues: their venue…"*, *"renames the venue; the staff device cannot"*, *"changes the venue's currency and languages"* |
| `venues` device R | `venue-isolation-matrix.test.ts` → *"venues: owner sees visible, staff device sees visible"* |
| `venue_members` owner R (all) | `venue-isolation-matrix.test.ts` → *"owner A sees both the owner and the device membership at Venue A"* |
| `venue_members` device R (own row only) | `venue-isolation-matrix.test.ts` → *"the device at Venue A sees ONLY its own row, never the owner's user_id"* |
| `venue_members` no direct W | `venue-isolation-matrix.test.ts` → *"venue_members: owner direct UPDATE is denied, staff is always denied"* (probe writes `role = 'owner'`, i.e. the escalation itself) |
| `staff_profiles` owner R | `owner-full-access.test.ts` → *"staff_profiles: the staff list…"* |
| `staff_profiles` device — | `venue-isolation-matrix.test.ts` → *"staff_profiles: owner sees visible, staff device sees none"* |
| `staff_profiles` W via RPC only | `owner-full-access.test.ts` → *"provisions and deactivates staff through the RPCs; the staff device cannot"* |
| `staff_profiles.pin_hash` unreadable | `rpc-abuse-matrix.test.ts` → *"the staff device cannot select pin_hash"*, *"another venue's owner cannot select pin_hash"*, *"list_staff_for_pin returns id/name/is_active and no hash"* |
| `venue_devices` owner R | `venue-isolation-matrix.test.ts` → *"owner A reads their own registry row"* |
| `venue_devices` device — | `venue-isolation-matrix.test.ts` → *"the device itself reads zero registry rows, including its own"* |
| `venue_devices` no hand-written revoke | `owner-full-access.test.ts` → *"cannot flag a device revoked by hand — even the owner goes through the action"* |
| `rls_test_items` owner R/W | `owner-full-access.test.ts` → *"rls_test_items: the menu"*, *"changes an item's price; the staff device cannot"*, *"toggles availability directly on the table"* |
| `rls_test_items` device R | `staff-write-boundary.test.ts` → *"lets the venue's staff device read its own venue's items"* |
| `rls_test_items` device: no direct UPDATE | `staff-write-boundary.test.ts` → *"refuses a direct price UPDATE from the same staff session"*, *"refuses a direct is_available UPDATE too"* |
| `rls_test_items` device: toggle via RPC | `staff-write-boundary.test.ts` → *"flips availability through toggle_item_availability and stamps who did it"* |
| no principal may DELETE, any table | `venue-isolation-matrix.test.ts` → *"{table}: DELETE is denied for the owner and the staff device"* (per table) |
| anon reaches nothing | `venue-isolation-matrix.test.ts` → *"reads zero rows from every tenant table"*, *"cannot call the toggle RPC"* |

### RPC abuse (the surface a table matrix cannot see)

| Cell | Assertion |
|---|---|
| `provision_staff_pin` owner-only | `rpc-abuse-matrix.test.ts` → *"refuses another venue's owner"*, *"refuses the venue's OWN staff device"*, *"refuses an unauthenticated caller"*, *"landed nothing"* |
| `deactivate_staff_profile` owner-only, no existence oracle | `rpc-abuse-matrix.test.ts` → *"refuses another venue's owner, and says nothing about whether the id exists"* (asserts the two error messages are **identical**) |
| `verify_staff_pin` member-only | `rpc-abuse-matrix.test.ts` → *"answers false to a non-member holding the CORRECT PIN"*, *"answers false for a foreign profile…"*, *"does verify for the venue's own device"* |
| `staff_pin_lock_seconds` member-only | `rpc-abuse-matrix.test.ts` → *"staff_pin_lock_seconds tells a non-member nothing"* |
| `list_staff_for_pin` member-only | `rpc-abuse-matrix.test.ts` → *"list_staff_for_pin returns id/name/is_active and no hash, to members only"* |
| `toggle_item_availability` member-only + attribution validated | `rpc-abuse-matrix.test.ts` → *"refuses a non-member, silently"*, *"refuses an unauthenticated caller outright"*, *"refuses to stamp a staff profile from another venue, and does not toggle either"* |
| `create_venue` / `ensure_account` self-scoped | `rpc-abuse-matrix.test.ts` → *"create_venue attaches the venue to the CALLER's account"*, *"ensure_account is idempotent and always returns the caller's own account"*, *"refuses an unauthenticated caller"* |
| refusals are targeted, not blanket | `rpc-abuse-matrix.test.ts` → *"the venue's own owner CAN do all of this"* |

### ACCT-06 behavioural edges

| Cell | Assertion |
|---|---|
| toggle to current value = no-op success | `availability-toggle-edges.test.ts` → *"treats a toggle to the value already stored as a successful no-op"* |
| sold-out → available round trip | `availability-toggle-edges.test.ts` → *"86s an item and brings it back"*, *"is repeatable: ten alternating toggles…"* |
| unknown / other-venue id leaks nothing | `availability-toggle-edges.test.ts` → *"gives a byte-identical answer for an authorized no-op, an unknown id, and another venue's item"* (compares the whole response object, not just `error`) |
| other venue's item untouched | `availability-toggle-edges.test.ts` → *"leaves the other venue's item untouched while saying nothing about it"* |
| deactivated profile cannot be stamped | `availability-toggle-edges.test.ts` → *"refuses to stamp a DEACTIVATED staff profile, and does not toggle either"* |
| unattributed toggle does not inherit | `availability-toggle-edges.test.ts` → *"accepts a toggle with no staff id and records it as unattributed"* |
| concurrent toggles stay consistent | `availability-toggle-edges.test.ts` → *"leaves a single consistent state when two staff toggle the same item at once"* (8 rounds; asserts availability and attribution came from the **same** call, not a torn pair) |

---

## Two invariants that keep this honest

1. **No assertion in `tests/rls/` acts through the service-role client.** `admin` / `typedAdmin` appear only in fixture setup and in ground-truth re-reads that verify what *actually* landed. Asserting isolation through a client that bypasses RLS is Pitfall 4 and is how a tenant suite goes green over an open boundary.

2. **Every positive has a paired negative and vice versa.** A migration that revoked every grant would make every refusal in this suite pass. `owner-full-access.test.ts` exists to make that failure mode impossible, and each of its writes is paired with the same write attempted by the venue's own staff device.

---

*Phase: 01-multi-tenant-foundation · Plan 05 · Requirements ACCT-06, ACCT-07, ACCT-08*

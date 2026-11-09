# Phase 1: Multi-Tenant Foundation - Pattern Map

**Mapped:** 2026-07-24
**Files analyzed:** 27 (from RESEARCH.md §Recommended Project Structure + CONTEXT.md decisions)
**Analogs found:** 0 / 27 — **repository is greenfield**

## Codebase State

Confirmed via `find` across the repo (excluding `.git`, `.planning`, `.claude`): no `package.json`, no `app/`, `lib/`, `supabase/`, or `tests/` directories, no `.ts`/`.tsx` files exist anywhere in the working tree. There is no prior code to extract analogs from for this phase or any phase before it — Phase 1 **is** the phase that establishes every pattern.

Because of this, this PATTERNS.md does not contain a `Pattern Assignments` section pointing at existing files (there are none). Instead, every file below is classified and pointed at the **canonical pattern in RESEARCH.md** that the planner should treat as the single source of truth for that file's shape. All patterns here are prescriptive first patterns, not descriptive analogs — the planner should treat the first file per role written in this phase as the analog for every subsequent phase.

## File Classification

| New File | Role | Data Flow | Canonical Pattern Source | Match Quality |
|----------|------|-----------|---------------------------|----------------|
| `app/(auth)/signup/page.tsx` | component (page) | request-response | RESEARCH.md §Recommended Project Structure, §Google One Tap example | no analog — first-of-kind |
| `app/(auth)/login/page.tsx` | component (page) | request-response | RESEARCH.md §Recommended Project Structure | no analog — first-of-kind |
| `app/(auth)/reset-password/page.tsx` | component (page) | request-response | Supabase Auth `resetPasswordForEmail`/`updateUser` (RESEARCH.md §Architectural Responsibility Map) | no analog — first-of-kind |
| `app/(dashboard)/venues/[venueId]/page.tsx` | component (page) | CRUD (read) | RESEARCH.md §Recommended Project Structure | no analog — first-of-kind |
| `app/(dashboard)/venues/[venueId]/staff/page.tsx` | component (page) | CRUD | RESEARCH.md §Recommended Project Structure | no analog — first-of-kind |
| `app/(dashboard)/venues/[venueId]/staff/devices/page.tsx` | component (page) | CRUD | RESEARCH.md §Recommended Project Structure (device registry) | no analog — first-of-kind |
| `app/(dashboard)/venues/[venueId]/settings/page.tsx` | component (page) | CRUD | RESEARCH.md §Recommended Project Structure | no analog — first-of-kind |
| `app/(tablet)/page.tsx` | component (page) | request-response | RESEARCH.md §Recommended Project Structure (name-grid/PIN pad) | no analog — first-of-kind |
| `app/(tablet)/enable-staff-mode/page.tsx` | component (page) | request-response | Pattern 2 (device provisioning) | no analog — first-of-kind |
| `app/(tablet)/unlock/page.tsx` | component (page) | request-response | D-07 owner-unlock | no analog — first-of-kind |
| `app/actions/auth.ts` | service (Server Action) | request-response | RESEARCH.md Code Example "Supabase server client" + Google One Tap example | no analog — first-of-kind |
| `app/actions/venues.ts` | service (Server Action) | CRUD | RESEARCH.md §Architectural Responsibility Map (venue creation) | no analog — first-of-kind |
| `app/actions/staff.ts` | service (Server Action) | CRUD | Pattern 4 (`provision_staff_pin`/`verify_staff_pin` RPCs) | no analog — first-of-kind |
| `app/actions/devices.ts` | service (Server Action) | event-driven | **Pattern 2** (full worked example, RESEARCH.md lines ~287-321) | no analog — first-of-kind, but RESEARCH.md gives a complete code example to copy directly |
| `app/middleware.ts` | middleware | request-response | RESEARCH.md Code Example "Middleware — must call `getUser()`" (full example) | no analog — first-of-kind, but RESEARCH.md gives a complete code example to copy directly |
| `lib/supabase/server.ts` | utility (client factory) | request-response | RESEARCH.md Code Example "Supabase server client for Next.js Server Actions" (full example) | no analog — first-of-kind, but RESEARCH.md gives a complete code example to copy directly |
| `lib/supabase/client.ts` | utility (client factory) | request-response | `@supabase/ssr` `createBrowserClient` (RESEARCH.md §Standard Stack) | no analog — first-of-kind |
| `lib/supabase/admin.ts` | utility (client factory) | request-response | Pattern 2 (`createAdminClient`, secret-key-only) | no analog — first-of-kind; **security-critical file, see Shared Patterns** |
| `supabase/migrations/*_accounts.sql` | migration | CRUD | RESEARCH.md §Recommended Project Structure | no analog — first-of-kind |
| `supabase/migrations/*_venues.sql` | migration | CRUD | RESEARCH.md §Recommended Project Structure, D-14 (country_code/timezone) | no analog — first-of-kind |
| `supabase/migrations/*_venue_members_and_role_helper.sql` | migration | CRUD | **Pattern 1** (full worked example, RESEARCH.md lines ~252-278) | no analog — first-of-kind, but RESEARCH.md gives a complete code example to copy directly |
| `supabase/migrations/*_staff_profiles.sql` | migration | CRUD | **Pattern 4** (full worked example, RESEARCH.md lines ~366-395) | no analog — first-of-kind, but RESEARCH.md gives a complete code example to copy directly |
| `supabase/migrations/*_venue_devices.sql` | migration | CRUD | Pattern 2 (device registry columns: `venue_id`, `device_user_id`, `label`, `enrolled_by`, `enrolled_at`) | no analog — first-of-kind |
| `supabase/migrations/*_rls_test_items_placeholder.sql` | migration | CRUD | **Pattern 3** (full worked example, RESEARCH.md lines ~330-357) | no analog — first-of-kind, but RESEARCH.md gives a complete code example to copy directly |
| `supabase/seed.sql` | config | batch | RESEARCH.md §Recommended Project Structure | no analog — first-of-kind |
| `tests/rls/setup.ts` | test | CRUD (fixtures) | RESEARCH.md §Validation Architecture, Wave 0 Gaps | no analog — first-of-kind |
| `tests/rls/venue-isolation.test.ts` | test | request-response | **RESEARCH.md Code Example "RLS test suite skeleton"** (full example, lines ~554-598) | no analog — first-of-kind, but RESEARCH.md gives a complete code example to copy directly |
| `tests/rls/staff-write-boundary.test.ts` | test | request-response | same skeleton as above, adapted to positive/negative assertions on `rls_test_items` | no analog — first-of-kind |
| `tests/rls/owner-full-access.test.ts` | test | request-response | same skeleton as above | no analog — first-of-kind |
| `vitest.config.ts` | config | — | RESEARCH.md §Wave 0 Gaps — `test.sequence.concurrent: false` required | no analog — first-of-kind |

## Pattern Assignments (from RESEARCH.md — treat as canonical, not descriptive)

### `supabase/migrations/*_venue_members_and_role_helper.sql` (migration, CRUD)

**Source:** RESEARCH.md Pattern 1 — this is the single most important pattern in the phase; every later table's RLS routes through it.

```sql
create schema if not exists private;
create type venue_role as enum ('owner', 'staff');

create or replace function private.get_venue_role(v_id uuid, u_id uuid)
returns venue_role
security definer
set search_path = ''
stable
as $$
  select role from public.venue_members
  where venue_id = v_id and user_id = u_id;
$$ language sql;

revoke execute on function private.get_venue_role(uuid, uuid) from anon, authenticated;

create policy "owner full access on venues"
  on public.venues for all
  using (private.get_venue_role(id, (select auth.uid())) = 'owner');

create policy "members can read their venues"
  on public.venue_members for select
  using (private.get_venue_role(venue_id, (select auth.uid())) is not null);
```

**Rule for every subsequent table in this phase (and every later phase):** RLS enabled in the same migration that creates the table (D-23); policy always calls `private.get_venue_role(venue_id, (select auth.uid()))`, never an inline join against `venue_members`.

---

### `app/actions/devices.ts` (service/Server Action, event-driven)

**Source:** RESEARCH.md Pattern 2 (device provisioning + session swap)

```typescript
'use server'
import { createAdminClient } from '@/lib/supabase/admin'   // secret key — server-only
import { createServerClient } from '@/lib/supabase/server' // anon key + cookies

export async function enableStaffMode(venueId: string, deviceLabel: string) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  // ...verify `user` is owner of venueId via get_venue_role before proceeding...

  const admin = createAdminClient()
  const deviceId = crypto.randomUUID()
  const email = `device+${deviceId}@venues.internal`
  const password = crypto.randomUUID()

  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { is_device: true, label: deviceLabel },
  })
  if (error) throw error

  await admin.from('venue_members').insert({
    venue_id: venueId, user_id: created.user.id, role: 'staff',
  })
  await admin.from('venue_devices').insert({
    venue_id: venueId, device_user_id: created.user.id, label: deviceLabel,
  })

  await supabase.auth.signInWithPassword({ email, password })
}
```

**Note (flagged MEDIUM confidence in RESEARCH.md, Open Question 1):** the "create device account then immediately `signInWithPassword` in the same Server Action to swap cookies" sequencing is assumed, not verified. Planner should schedule a spike task before locking the "Enable Staff Mode" task, with a redirect-based two-step fallback.

**Revoke counterpart (Pitfall 5 — build alongside):**
```typescript
// delete/deactivate venue_members row (RLS re-derives instantly) AND:
await admin.auth.admin.signOut(deviceUserId, 'global')
```

---

### `supabase/migrations/*_rls_test_items_placeholder.sql` + narrow RPC (migration, CRUD)

**Source:** RESEARCH.md Pattern 3 — the template for every future limited-role write (D-11), proven here against a placeholder table since real `items` arrive in Phase 2.

```sql
create table public.rls_test_items (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id),
  price numeric not null default 0,
  is_available boolean not null default true
);
alter table public.rls_test_items enable row level security;

create policy "owner full access" on public.rls_test_items for all
  using (private.get_venue_role(venue_id, (select auth.uid())) = 'owner');

create policy "staff read only" on public.rls_test_items for select
  using (private.get_venue_role(venue_id, (select auth.uid())) is not null);
-- deliberately NO staff UPDATE policy — the RPC below is the only staff write path

create or replace function public.toggle_item_availability(p_item_id uuid, p_is_available boolean)
returns void
security definer
set search_path = ''
as $$
  update public.rls_test_items
  set is_available = p_is_available
  where id = p_item_id
    and private.get_venue_role(venue_id, (select auth.uid())) is not null;
$$ language sql;
```

---

### `supabase/migrations/*_staff_profiles.sql` (migration, CRUD)

**Source:** RESEARCH.md Pattern 4 — PIN hashing/verification entirely inside Postgres.

```sql
create extension if not exists pgcrypto;

create or replace function public.provision_staff_pin(p_venue_id uuid, p_name text, p_pin text)
returns uuid
security definer
set search_path = ''
as $$
  insert into public.staff_profiles (venue_id, name, pin_hash, created_by)
  values (
    p_venue_id, p_name, crypt(p_pin, gen_salt('bf', 12)),
    (select auth.uid())
  )
  returning id;
$$ language sql;

create or replace function public.verify_staff_pin(p_venue_id uuid, p_staff_id uuid, p_pin text)
returns boolean
security definer
set search_path = ''
as $$
  select pin_hash = crypt(p_pin, pin_hash)
  from public.staff_profiles
  where id = p_staff_id and venue_id = p_venue_id and deactivated_at is null;
$$ language sql;
```

**Note:** planner must add `failed_attempts`/`locked_until` columns and backoff logic (D-18) inside `verify_staff_pin`, and a `deactivated_at` column for D-20 soft-delete — not shown in the base RESEARCH.md example, must be added at plan time.

---

### `lib/supabase/server.ts` (utility, request-response)

**Source:** RESEARCH.md Code Example, full copy-paste candidate.

```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )
}
```

---

### `app/middleware.ts` (middleware, request-response)

**Source:** RESEARCH.md Code Example, full copy-paste candidate. Critical rule: use `getUser()`, never `getSession()` (Anti-Pattern list).

```typescript
import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )
  await supabase.auth.getUser()
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

---

### `tests/rls/venue-isolation.test.ts` (test, request-response)

**Source:** RESEARCH.md Code Example "RLS test suite skeleton" — this is the D-25 release gate; `tests/rls/staff-write-boundary.test.ts` and `tests/rls/owner-full-access.test.ts` should follow the identical structure (service-role fixture setup in `beforeAll`, sign in as real seeded users via anon-key client, assert exactly what each principal can/cannot do).

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL!
const anonKey = process.env.SUPABASE_ANON_KEY!
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

describe('venue isolation', () => {
  let venueA: string, venueB: string
  let staffADeviceEmail: string

  beforeAll(async () => {
    // service-role fixture setup: create two venues, an owner for A, a device account for A's staff
  })

  it('staff device at venue A cannot read venue B data', async () => {
    const client = createClient(url, anonKey)
    await client.auth.signInWithPassword({ email: staffADeviceEmail, password: '...' })
    const { data } = await client.from('rls_test_items').select('*').eq('venue_id', venueB)
    expect(data).toHaveLength(0) // RLS silently filters, doesn't error
  })

  it('staff cannot update price via direct table UPDATE', async () => {
    const client = createClient(url, anonKey)
    await client.auth.signInWithPassword({ email: staffADeviceEmail, password: '...' })
    const { error } = await client.from('rls_test_items').update({ price: 999 }).eq('venue_id', venueA)
    expect(error).toBeTruthy()
  })

  it('staff CAN toggle availability via the RPC', async () => {
    const client = createClient(url, anonKey)
    await client.auth.signInWithPassword({ email: staffADeviceEmail, password: '...' })
    const { error } = await client.rpc('toggle_item_availability', { p_item_id: '...', p_is_available: false })
    expect(error).toBeNull()
  })
})
```

**Critical rule (D-25, Pitfall 4):** sign in through the client SDK/anon key only — never the service-role client and never the SQL editor — for any assertion in this suite. `admin` (service-role) is used only in `beforeAll`/`afterAll` fixture setup/teardown, never in the assertions themselves.

## Shared Patterns

### Auth session handling
**Source:** RESEARCH.md §Anti-Patterns — "Using `getSession()` for server-side auth checks"
**Apply to:** every Server Action and `middleware.ts` — always use `getUser()` or `getClaims()`, never `getSession()`, for any trustworthy identity check.

### Secret-key isolation
**Source:** D-24, Pitfall 3, RESEARCH.md §Structure Rationale
**Apply to:** `lib/supabase/admin.ts` must be the only file importing the secret key; only `app/actions/devices.ts` (and later a Phase-2+ ingestion worker) may import it. No `NEXT_PUBLIC_`-prefixed env var may hold it. Recommend the planner add a lint rule or file-location convention as a structural guard, per RESEARCH.md.

### RLS-in-creation-migration
**Source:** D-23, Pitfall 1
**Apply to:** every `supabase/migrations/*.sql` file in this phase — RLS must be enabled and policies attached in the same migration that creates the table. No table should ever exist mid-phase without RLS on.

### Narrowest-policy-by-default
**Source:** Pitfall 2
**Apply to:** every RLS policy — default to `= 'owner'` and only broaden to "any member" (`is not null`) with an explicit reason, since "any member can access" is the easy-to-reach-for mistake that later silently grants staff broader-than-intended access.

### Client-SDK-only testing
**Source:** D-25, Pitfall 4
**Apply to:** every file under `tests/rls/` — assertions must run through `@supabase/supabase-js` signed in as a real seeded user (owner, staff device) per role × venue combination. Service-role/admin client usage is confined to fixture setup/teardown only.

## No Analog Found

All 27 files in this phase have no analog — the repository is greenfield and Phase 1 is the first phase. This is expected and consistent with `.planning/phases/01-multi-tenant-foundation/01-CONTEXT.md` (`<code_context>` §Reusable Assets: "None — greenfield"). The planner should treat RESEARCH.md's Architecture Patterns 1-4 and the four full code examples (server client, middleware, device provisioning, RLS test skeleton) as the canonical patterns, and treat the first files actually written in this phase (e.g., the first migration, the first Server Action, the first test) as the analog baseline for Phase 2 onward.

## Metadata

**Analog search scope:** entire working tree (excluding `.git`, `.planning`, `.claude`) — confirmed empty of application source via `find`.
**Files scanned:** 0 source files found (greenfield confirmed).
**Pattern extraction date:** 2026-07-24

# Phase 1: Multi-Tenant Foundation - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 delivers the horizontal foundation every later phase writes on top of:

- **Owner accounts + auth** — a restaurant owner self-serves signup/login with no manual help.
- **Account → venue model** — an owner account can hold multiple venues (schema now, minimal UI); a venue captures name, currency, default language, plus country + timezone.
- **Staff identity + scoped roles** — the owner provisions staff as PIN profiles used on a shared in-restaurant tablet; two roles in v1 (owner = full, staff = availability/"86" toggle only).
- **Tenant + role isolation proven** — no venue's data leaks to another, and no staff member can change prices/content/settings, verified by an automated RLS test suite hitting the client SDK/anon key across every role × venue combination from the first migration.

**In scope:** auth, account/venue creation, staff PIN provisioning + the tablet "staff mode" session, the 2-role permission boundary, the RLS mechanism, and the RLS test suite (the phase's release gate).

**Out of scope (belongs to later phases):** any menu/category/item CRUD, the fast 86 *UI* itself (Phase 2), the sold-out toggle's diner-facing propagation (Phase 2), theming, translations, analytics. Phase 1 only proves the *permission boundary* those features will rely on — via RLS tests against placeholder/venue-scoped tables — not the features themselves.

</domain>

<decisions>
## Implementation Decisions

### Owner Authentication
- **D-01:** Owner sign-in is **email + password, plus Google one-tap** (Supabase Auth). A standard password-reset flow is included.
- **D-02:** **No email-verification gate.** New owners go straight from signup into venue setup; email verification is a soft nudge afterward, never a blocker to first value. (Accepted trade-off: a typo'd email can't recover a password until corrected.)
- **D-03:** **Long-lived "stay signed in" sessions.** Persistent refresh tokens so owners/staff rarely hit a login wall mid-service — matches mobile-first floor use.

### Staff Identity & the Tablet
- **D-04:** Staff are **owner-provisioned per-person profiles (name + PIN)**, created from the owner dashboard. **No emails, no individual auth logins for staff.** — **Reversibility:** one-way — this is the core identity architecture; converting staff into full auth users later is an auth migration touching every RLS policy and the tablet session model.
- **D-05:** Each staff profile is a **distinct identifier** stamped on the actions they take, so the app records *which* staff member acted (attribution), not just "some staff member." This identifier is the forward seam for future table-level attribution.
- **D-06:** A physical tablet becomes the venue's trusted staff device via **"owner logs in, then enables staff mode"**: the owner signs into the tablet once with their own credentials and switches it to staff mode; the device then holds a **venue-scoped `staff`-role session** and shows the PIN screen. The PIN is an app-level identity layered on top of that session — the database sees a single `staff` principal for the device (exactly staff's rights). — **Reversibility:** costly — the device-session-plus-PIN model is wired into how RLS resolves role; changing the enrollment mechanism later reworks the session/identity plumbing.
  - **Underlying mechanism (for researcher/planner to detail):** the device session should be a per-venue staff-device auth identity whose `venue_members` row has role `staff`, so it plugs directly into the research's `private.get_venue_role(venue_id, auth.uid())` pattern with no special-casing. Reconcile explicitly with the research assumption that *every* member is a real end-user auth account — here the "member" for staff is the device principal; PIN profiles are app-level records stamped on writes.
- **D-07:** **Owner/manager can also authenticate on the shared tablet** (their own email+password) to unlock full-access editing on the same in-restaurant device; the staff PIN screen is the default surface.
- **D-08:** **Lost/stolen/retired tablet → remote revoke.** The owner sees enrolled devices on their dashboard and can revoke a device, instantly killing that tablet's staff session. Requires a lightweight device registry. (Blast radius if a device is taken is low — staff can only 86 items — but revoke is the real safety valve given long-lived sessions.)

### Roles & Permissions
- **D-09:** **Two roles in v1: `owner` (full) and `staff` (availability toggle / "86" only).** "Manager" is intentionally dropped for v1 — no demonstrated need. — **Reversibility:** costly — the role model is checked in every RLS policy; restructuring it later re-audits all policies.
- **D-10:** Use the **extensible role enum + single `private.get_venue_role()` helper** the research recommends, so adding `manager` (or a future `waiter`) later is one enum value + policy updates, not a rework. Adding a role is a cheap forward move; the enum choice itself is the costly-to-restructure part (see D-09).
- **D-11:** Staff's one job is **"86 on the fly"** — flip an item sold-out fast, mid-service. The DB permission is `is_available`-only, enforced through the **narrow `toggle_item_availability()` RPC** (from research) so a row-level UPDATE grant can never be used to smuggle a price/content change. Owner does everything else. (The item tables this acts on arrive in Phase 2 — Phase 1 proves the boundary against them via RLS tests.)
- **D-12:** **Identity splits by permission tier:** full-access roles (owner) are real email+password accounts usable on any device; limited staff are PIN-only profiles on the shared tablet.

### Venue & Account Onboarding
- **D-13:** **Combined signup → first-venue onboarding.** Sign up and set up the first venue in one continuous flow, landing straight in the venue dashboard. Fewest steps to first value.
- **D-14:** **Capture country + timezone at venue creation now**, in addition to the required name + currency (RON/HUF/EUR) + default language. Auto-derive from currency/locale, let the owner override. Rationale: time-of-day menu scheduling (Phase 3) and busy-hours analytics (Phase 6) need timezone; fiscal work later needs country; research already reserves `venues.country_code`. — **Reversibility:** costly — capturing now is additive and cheap; *not* capturing means a schema change + backfill on `venues` once a dependent feature ships.
- **D-15:** **Multi-venue: schema full, UI minimal.** The `accounts → venues` relationship models many venues per owner properly; v1 UI centers on one venue with a lightweight switcher if more than one exists. Honors ACCT-03 ("data model supports it; UI may expose it minimally") without over-investing.

### PIN Security
- **D-16:** **4-digit PINs.** Fast/familiar; brute force is handled by throttling, not length, and staff blast radius is low.
- **D-17:** **Name-grid-then-PIN identification** (POS-style, à la Toast/Square): staff tap their name/avatar, then enter their PIN. Because the person is chosen explicitly, **PINs need not be unique within a venue** and attribution is never ambiguous.
- **D-18:** **Timed/exponential backoff** on repeated wrong PIN entries (escalating delays), rather than a hard lock requiring owner reset — no owner intervention needed to recover from fat-fingering.
- **D-19:** **PINs stored hashed at rest, never plaintext** (given/non-negotiable). — **Reversibility:** one-way — storing plaintext and later hashing would require every owner to reset every staff PIN.

### Staff Lifecycle
- **D-20:** **Deactivate (soft-delete), keep history.** When a staff member leaves, the owner deactivates the profile: their PIN stops working immediately, but the profile record persists so past attribution stays intact. Name/PIN may be freed for reuse or archived. No hard delete of people referenced by activity history.

### Consent / Legal
- **D-21:** **Explicit Terms + Privacy consent at owner signup** — an "I agree" checkbox that stores which version was accepted and when. GDPR-clean and cheap now; consent evidence is hard to reconstruct later. (This concerns the restaurant *owner's* personal data; the cookieless diner side is a separate Phase 6 concern.)

### Tenant Isolation & RLS (mechanism locked by research — carried forward, not re-litigated)
- **D-22:** Tenant isolation via a `venue_members` table + a private-schema `SECURITY DEFINER` `get_venue_role()` helper; **every RLS policy checks BOTH venue AND role in one expression.** No inline joins in policies; wrap `auth.uid()` as `(select auth.uid())`. — **Reversibility:** one-way — this is the foundational security boundary; retrofitting it after features exist means re-auditing every table.
- **D-23:** **RLS enabled on every table in its creation migration** — "no RLS policy yet" is treated as "not ready for data," never an acceptable intermediate state.
- **D-24:** **Service-role key never appears in any client-reachable code path.** All privileged server code re-derives the authenticated user context.
- **D-25:** **The RLS test suite is the phase's release gate.** Automated tests authenticate as each real role × venue combination *through the client SDK / anon key* (never the SQL editor, never service-role) and assert exactly what each principal can and cannot read/write — including that a staff/device session at Venue A cannot touch Venue B, and that staff cannot change anything but availability. This must exist and pass before any Phase 2 feature writes data.

### Claude's Discretion
- Exact Supabase Auth configuration details (token TTLs, provider setup, redirect URLs), migration file organization, and the specific test framework/harness for the RLS suite are left to research/planning — the research names the client-SDK-across-role×venue approach; the concrete tooling is the planner's call.
- Precise backoff curve for D-18 and device-registry schema shape for D-08 are implementation details.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Tenant isolation / RLS / roles (the heart of this phase)
- `.planning/research/ARCHITECTURE.md` §"Pattern 1: Tenant isolation via `venue_members` + SECURITY DEFINER role lookup" — the exact SQL pattern for the role helper and dual venue+role policies; wrap `auth.uid()` as `(select auth.uid())`.
- `.planning/research/ARCHITECTURE.md` §"Anti-Pattern 1: Inline joins inside RLS policies" — what NOT to do in policies.
- `.planning/research/ARCHITECTURE.md` §"Forward-Compatibility Seams" — `accounts.plan_tier` reserved, `venues.country_code`, extensible `venue_members.role` enum, and why a future role/waiter/tables tier attaches cheaply.
- `.planning/research/PITFALLS.md` §"Pitfall 9: Multi-tenant data isolation breaks quietly via Supabase RLS gaps" — the failure modes (RLS-off-by-default, venue-but-not-role scoping, SQL-editor false confidence) and the required test approach.
- `.planning/research/PITFALLS.md` §"Security Mistakes" — service-role key discipline, dual venue+role checks, client-SDK testing.
- `.planning/research/STACK.md` §6 "Auth & Multi-Tenancy" and "What NOT to Use" (SECURITY DEFINER RPC as the only staff write path; Postgres enum role + helper vs. generic RBAC engine).

### Project structure / stack
- `.planning/research/ARCHITECTURE.md` §"Recommended Project Structure" — Phase 1 establishes the Next.js + Supabase scaffold; follow this structure.
- `.planning/research/STACK.md` — locked stack (Next.js + Supabase + Vercel); Supabase CLI + `supabase db diff` for reviewable RLS/RPC migrations.

### Requirements / scope
- `.planning/ROADMAP.md` §"Phase 1: Multi-Tenant Foundation" — goal + the 5 success criteria (SC3/SC4 = the RLS isolation gate).
- `.planning/REQUIREMENTS.md` — ACCT-01 … ACCT-08 (the requirements this phase satisfies).
- `.planning/PROJECT.md` §Constraints + §Key Decisions — multi-currency/multi-country from the start; staff limited-rights rationale (menu freshness = retention).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **None — greenfield.** No `package.json`, no application code exists yet. Phase 1 stands up the initial Next.js + Supabase project scaffold from scratch (see ARCHITECTURE.md §Recommended Project Structure).

### Established Patterns (to be created this phase, per research — these become the patterns later phases reuse)
- `venue_members` + `private.get_venue_role()` SECURITY DEFINER helper → every future table's RLS routes through this one helper.
- `SECURITY DEFINER` RPC as the only write path for narrowly-scoped mutations (the `toggle_item_availability()` shape) → the template for any future limited-role write.
- "RLS enabled + dual venue+role policy in the same creation migration" → the checklist every later table follows.
- Supabase CLI migrations (`supabase db diff`) so RLS/RPC changes stay reviewable in version control, not applied ad hoc in the dashboard.

### Integration Points
- This phase defines `accounts`, `venues`, `venue_members`, the staff PIN-profile + device-registry tables, and the role enum. Every subsequent phase (menus, items, translations, analytics) FKs to `venues.id` and is gated by the RLS helper established here.
- Forward seams left intentionally: `tables` identity (for later table management + the "which staff handles which table" idea), `accounts.plan_tier` (billing), `venues.country_code` (fiscal). None built now; all are why the v1 schema is shaped this way.

</code_context>

<specifics>
## Specific Ideas

- **"86" is the operating verb.** Staff exist to 86 items (mark sold-out) fast, mid-service, from the floor. The role's whole justification is this one action; keep it frictionless.
- **Shared in-restaurant tablet, not per-staff phones.** The staff surface is one physical device on the floor with a POS-style PIN screen — explicitly modeled on Toast/Square (tap your name → enter PIN), not an email/password login per person.
- **Owner runs everything from their own login** (their phone/laptop) and can also drop into full-access mode on the shared tablet when needed.

</specifics>

<deferred>
## Deferred Ideas

- **Table-level staff attribution** ("know which staff member handles that table") — came up during the staff-identity discussion. Belongs to the deferred table-management / ordering tier. The per-staff PIN identity built in Phase 1 is the seam it will attach to; not built now.
- **"Manager" role** — dropped for v1 (no demonstrated need). Re-introduced later as one enum value + policy updates when a venue needs a second full-access person who isn't the owner.
- **Full multi-venue management UI** (first-class create/switch/manage flows) — schema supports many venues now; rich UI deferred until a real multi-venue customer needs it.
- **Subscription billing / tier enforcement** — `accounts.plan_tier` reserved but unused/unenforced in v1; pilot venues are free.
- **Fiscal / tax convention** (net vs gross pricing, RO ANAF / HU NAV) — `venues.country_code` captured now, but the tax-inclusive/exclusive convention is an explicit open gap for the future payments/fiscal milestone, not v1.
- **Diner-side cookieless consent** — separate concern; Phase 6. Phase 1's consent capture (D-21) is owner-facing only.

</deferred>

---

*Phase: 1-Multi-Tenant Foundation*
*Context gathered: 2026-07-24*

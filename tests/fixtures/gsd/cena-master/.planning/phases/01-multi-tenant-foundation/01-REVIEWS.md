---
phase: 1
reviewers: [cursor, claude]
reviewed_at: 2026-07-24T14:55:53Z
plans_reviewed: [01-01-PLAN.md, 01-02-PLAN.md, 01-03-PLAN.md, 01-04-PLAN.md, 01-05-PLAN.md]
---

# Cross-AI Plan Review — Phase 1: Multi-Tenant Foundation

> **Reviewer coverage note:** Two source-grounded reviews, gathered in two passes.
> **Cursor** (an independent model) reviewed at `2026-07-24T14:33:33Z`. **Claude** was
> added in this later pass (`/gsd-review --phase 1 --claude`) as a separate headless
> `claude -p` session. Claude runs the same model family as the executing environment,
> so it is a *fresh-context* reviewer rather than a fully independent one — weight
> Cursor's corroboration accordingly. **OpenCode** failed on a hard GitHub-Copilot
> license error in the first pass (documented below); `gemini` and `codex` are not
> installed on this machine.
>
> **What changed since the prior pass:** the two HIGH security findings — the
> venue-creation RLS bootstrap deadlock (Plan 01) and the app-layer-only authority on
> the staff `SECURITY DEFINER` RPCs (Plan 03) — are now raised **independently by both
> reviewers**, citing the same `file:line` evidence. The prior pass's "single-source,
> not cross-AI-confirmed" caveat is therefore **resolved for those items**. Where the
> reviewers diverge it is complementary coverage, not disagreement (see Divergent Views).

## Cursor Review

# Cross-AI Plan Review — Phase 1: Multi-Tenant Foundation

**Repo state:** Greenfield. Confirmed in `.planning/phases/01-multi-tenant-foundation/01-CONTEXT.md:99-101` and by absence of root `package.json` / `app/` / `supabase/` application trees. Claims below are verified against the five plans, `01-CONTEXT.md`, `01-RESEARCH.md`, `SKELETON.md`, `ROADMAP.md`, and `REQUIREMENTS.md` — not against implemented code (none exists yet).

---

### Overall Summary

The five plans form a coherent, security-first phase that correctly sequences scaffold → auth completeness → PIN profiles → device staff principal → D-25 RLS gate, and they stay aligned with locked decisions D-01–D-25. The architecture (venue_members + `private.get_venue_role`, narrow toggle RPC, device-as-staff, client-SDK tests) matches research Patterns 1–4. **Overall risk is HIGH until Plan 01/03 close two concrete privilege/bootstrap holes:** first-venue membership bootstrapping under the planned RLS shape, and `SECURITY DEFINER` staff RPCs that rely on Server Action checks instead of in-RPC authority. Fix those before execution; the rest is strong.

---

### 01-01-PLAN.md — Walking Skeleton

#### Summary
Plan 01 is the right walking skeleton: scaffold, migration 0001, signup→venue→dashboard, and the first client-SDK isolation test. Threat model and prohibitions match D-21–D-25. The critical gap is that the planned dual venue+role policies cannot authorize the first `venues` / `venue_members` inserts without an explicit bootstrap path the plan never specifies.

#### Strengths
- Goal-backward `must_haves` cover ACCT-01/02/03/08 plus edge probes (Unicode names, currency domain, multi-venue).
- Correctly mandates RLS in the same migration as table creation (D-23), `(select auth.uid())` wrapping, and `import 'server-only'` on `admin.ts` (`.planning/phases/01-multi-tenant-foundation/01-01-PLAN.md:165-167`, `:171-177`).
- Isolation proof is via anon-key Vitest, not SQL editor (aligns with Pitfall 4 in `01-RESEARCH.md:401-402`).
- Supply-chain human gate before first install is appropriate for greenfield.

#### Concerns
- **HIGH — First venue creation is RLS-impossible under the stated policies.** Policies are specified as owner-only via `private.get_venue_role(...) = 'owner'` on `venues` / `venue_members` (`01-01-PLAN.md:166`). For a brand-new venue there is no membership row yet, so `get_venue_role` is null and both INSERT `WITH CHECK`s fail. Plan 04 correctly uses the admin client to insert device `venue_members` (`01-04-PLAN.md:114`); Plan 01’s `createVenue` does not specify admin, a `SECURITY DEFINER` `create_venue` RPC, or a non–role-helper INSERT policy. The double-submit backstop (`01-01-PLAN.md:55-56`) assumes atomicity that the action text never defines (no transaction / single RPC).
- **HIGH — Scaffold command against a non-empty repo.** Task 2 runs `npx create-next-app@latest . ...` (`01-01-PLAN.md:165`) while the repo already contains `.planning/`, `.claude/`, `.git/`. `create-next-app` commonly refuses non-empty directories; the plan has no fallback (manual scaffold / `--force` policy).
- **MEDIUM — `get_venue_role` arity / callability drift.** Must-have text says `private.get_venue_role(venue_id)` (`01-01-PLAN.md:44`); artifacts correctly define `(v_id, u_id)` and revoke EXECUTE from anon/authenticated (`01-01-PLAN.md:123`, matching `01-RESEARCH.md:259-269`). Later plans tell Server Actions to “assert via `get_venue_role`,” but a revoked-EXECUTE private function cannot be `.rpc()`’d — callers must SELECT `venue_members` under RLS or use a public wrapper. Unspecified → implementer confusion / silent wrong checks.
- **MEDIUM — `enabled_languages` default `'{}'` vs domain rule.** Schema default empty array (`01-01-PLAN.md:166`) conflicts with “default language must be one of enabled languages” (`01-01-PLAN.md:49`) unless Zod always requires a non-empty array (stated in action, not constrained in SQL).
- **LOW — Validation artifact not wired.** `01-VALIDATION.md` is still a placeholder template (`01-VALIDATION.md:22-53`) despite RESEARCH’s filled test map (`01-RESEARCH.md:662-672`).

#### Suggestions
- Specify a single `SECURITY DEFINER` `create_venue(...)` (or admin-assisted bootstrap only for the membership pair) that inserts `venues` + owner `venue_members` atomically, with internal `auth.uid()` / account ownership checks — mirror Plan 04’s admin pattern for the chicken-and-egg case.
- Replace bare `create-next-app .` with an explicit non-empty-dir strategy.
- Align all docs on `(venue_id, user_id)` and document that app-layer role checks query `venue_members`, not the revoked private helper.

#### Risk Assessment
**HIGH** — without an explicit bootstrap mutation, the walking skeleton cannot pass its own acceptance criteria against real RLS.

---

### 01-02-PLAN.md — Owner Auth Completeness

#### Summary
Plan 02 correctly finishes ACCT-01/ACCT-03 (reset, Google One Tap, minimal switcher) with good anti-enumeration and RLS-scoped switcher tests. Consent-before-One-Tap and local email delivery are the main residual risks.

#### Strengths
- Uniform reset response / no enumeration oracle (`01-02-PLAN.md:37-41`, `:111-119`).
- Google flow cites hashed nonce + FedCM + `signInWithIdToken` per research (`01-02-PLAN.md:133-134`).
- VenueSwitcher scoped by membership and hidden for single-venue owners (D-15) (`01-02-PLAN.md:155-169`).
- No new migrations — correct boundary after Plan 01 schema.

#### Concerns
- **MEDIUM — Consent vs One Tap sequencing is fragile.** Prohibition requires Terms/Privacy evidence for Google owners (`01-02-PLAN.md:40`); Task 2 says “checkbox before enabling the One Tap prompt” (`01-02-PLAN.md:134`). FedCM/One Tap can prompt before app UI gates fire; first-time Google also needs an `accounts` row write that Plan 01 only puts on `signUpOwner`. No concrete “post-`signInWithIdToken` ensureAccount+consent” path or test.
- **MEDIUM — Password-reset tests vs local mailer.** `login-reset.test.ts` is expected to complete reset against local Supabase (`01-02-PLAN.md:112`) but the plan never mentions Inbucket / mail capture / redirect URL config. Easy false red or skipped path.
- **LOW — Wave ordering vs `depends_on`.** ROADMAP marks Wave 3 blocked on Wave 2 (`ROADMAP.md:50-52`), but `01-03` only depends on `01-01`. Technically fine to parallelize 02∥03; docs disagree.

#### Suggestions
- Make Google first-login a Server Action that upserts `accounts` with consent version/timestamp after ID token exchange (or block One Tap until consent is POSTed and stored).
- Document Inbucket (or magic-link injection via Admin API) for the reset integration test.
- Either update ROADMAP to allow 02∥03 or add `01-02` to Plan 03’s `depends_on` for honesty.

#### Risk Assessment
**MEDIUM** — auth UX is sound; consent/account provisioning for Google is the main correctness gap.

---

### 01-03-PLAN.md — Staff PIN Profiles

#### Summary
Plan 03 implements D-04/D-16–D-20 well (pgcrypto in-DB, name-grid→PIN, backoff, soft-delete) and correctly reuses `get_venue_role` in RLS. Security disposition for provisioning is wrong: it trusts the Server Action while shipping publicly callable `SECURITY DEFINER` RPCs without in-function authority checks (as copied from research).

#### Strengths
- PIN never leaves the RPC for hashing (`01-03-PLAN.md:24`, `:110-111`); matches Pattern 4 (`01-RESEARCH.md:360-394`).
- Backoff and soft-delete are in-RPC, not Redis (`01-03-PLAN.md:140-141`).
- Non-owner provisioning rejection is a first-class test (`01-03-PLAN.md:112-120`).
- Clear one-way reversibility notes for D-04/D-19.

#### Concerns
- **HIGH — `provision_staff_pin` / `deactivate_staff_profile` privilege escalation via PostgREST.** Migration SQL inserts with no `get_venue_role = 'owner'` guard inside the function (`01-03-PLAN.md:111`; same shape in `01-RESEARCH.md:371-384`, which only comments “caller must first verify”). `SECURITY DEFINER` typically bypasses RLS on the insert. Any authenticated client can `.rpc('provision_staff_pin', …)` for another venue. Threat T-03-02 claims mitigation via Server Action + RLS (`01-03-PLAN.md:192`) — **RLS does not protect this RPC path.**
- **HIGH — `pin_hash` confidentiality underspecified.** “view or column-select discipline” (`01-03-PLAN.md:111`) is not an enforceable artifact. A member-read policy on `staff_profiles` with PostgREST `select *` exposes bcrypt hashes → offline PIN cracking (4-digit space). Needs a view / column `REVOKE` / separate table, plus a negative test.
- **HIGH — `verify_staff_pin` is a cross-tenant PIN oracle.** Pattern 4 SQL only checks staff_id/venue_id/hash (`01-RESEARCH.md:386-394`); no check that `auth.uid()` is a member (device/owner) of that venue. Any signed-in user who learns UUIDs can probe PINs (backoff helps but is per-profile, not per-attacker).
- **MEDIUM — ACCT-06 claimed too early.** Frontmatter `requirements: [ACCT-04, ACCT-06]` (`01-03-PLAN.md:17`) but availability toggle is Plan 05. Mis-tags coverage.
- **MEDIUM — Tablet PIN UI before device session.** Plan 03 ships `(tablet)/` NameGridPinPad (`01-03-PLAN.md:96-97`) while D-06 device staff principal is Plan 04. Unclear which auth principal runs `verifyPin` in Wave 3 (owner session? anon?). Risk of building a throwaway auth path.

#### Suggestions
- Put `IF private.get_venue_role(p_venue_id, auth.uid()) IS DISTINCT FROM 'owner' THEN RAISE …` (or equivalent) **inside** every privileged staff RPC; revoke EXECUTE from roles that should not call them if appropriate.
- Require `get_venue_role(...) IS NOT NULL` (and ideally role in `('staff','owner')`) inside `verify_staff_pin`.
- Ship `staff_profiles_public` view (id, venue_id, name, deactivated_at) for reads; revoke SELECT on `pin_hash` from `authenticated`.
- Drop ACCT-06 from Plan 03 requirements; gate tablet verify UI behind Plan 04 or document “owner-session-only preview.”

#### Risk Assessment
**HIGH** — PIN crypto design is good; RPC authorization model as written would fail a real security review.

---

### 01-04-PLAN.md — Shared-Tablet Staff Session

#### Summary
Plan 04 is the phase’s novel piece and is well-specified: provisioned device user, `venue_members.role='staff'`, registry, instant revoke via membership delete + `admin.signOut(..., 'global')`, owner-unlock as session swap-back. Open Questions are acknowledged with fallbacks. Depends correctly on 01-01 + 01-03.

#### Strengths
- Device plugs into the same role helper with no special-casing (D-06) (`01-04-PLAN.md:28`, `:111`).
- Revoke is RLS-authoritative, not JWT-expiry-dependent (D-08, Pitfall 5) (`01-04-PLAN.md:137-143`).
- Secret-key discipline and anti-anonymous-auth stance match research anti-patterns (`01-04-PLAN.md:38`, `:198`).
- Cookie-swap ASSUMED risk (A1) has an explicit redirect two-step fallback (`01-04-PLAN.md:100`, `:114`).
- Client-SDK tests for isolation and instant revoke are the right release-gate building blocks.

#### Concerns
- **MEDIUM — Re-enrollment backstop without mechanism.** Must-have requires no orphaned device principals on double enable (`01-04-PLAN.md:33-34`) but Task 1 action does not specify unique constraint on `(venue_id, device_user_id)`, label-based upsert, or revoke-previous-on-reënroll.
- **MEDIUM — Owner-unlock acceptance is soft.** “Asserted or documented” (`01-04-PLAN.md:151`) lets documentation substitute for a test on a security-adjacent session swap (Q2 / A3 in `01-RESEARCH.md:616`, `:628-631`).
- **LOW — `admin.ts` exclusivity vs test harness.** SKELETON says only `actions/devices.ts` imports admin (`SKELETON.md:19`); Plan 01’s `tests/rls/setup.ts` must use the secret key for fixtures. Tighten the rule to “production app code + test setup only.”

#### Suggestions
- Specify re-enrollment: revoke prior device for that browser fingerprint/label, or unique active device per venue + explicit replace.
- Add an automated revoke→zero-rows test already planned; add an unlock→exit→device-session-restored integration assertion or mark unlock as manual-only in VALIDATION.
- Spike cookie swap (Open Question 1) as a blocking micro-task before Task 1 coding, as research recommended (`01-RESEARCH.md:623-626`).

#### Risk Assessment
**MEDIUM** — design is sound; residual risk is session-swap mechanics and re-enrollment edge cases, both partially anticipated.

---

### 01-05-PLAN.md — D-25 RLS Release Gate

#### Summary
Plan 05 correctly makes the phase’s raison d’être executable: placeholder `rls_test_items`, narrow `toggle_item_availability`, full role×venue matrix through the anon key. It depends on 01-01/03/04 (skips 02 — fine). Strongest plan for ACCT-06/07/08 once earlier auth holes are fixed.

#### Strengths
- Explicit “NO staff UPDATE policy” + positive/negative SDK assertions (`01-05-PLAN.md:21-22`, `:108-109`) match CLAUDE.md / Pattern 3.
- Matrix covers all tenant tables including staff_profiles and venue_devices (`01-05-PLAN.md:131`).
- Forbids service-role as acting principal (`01-05-PLAN.md:33`, `:146`).
- Cross-venue reads assert empty (not error) — matches PostgREST/RLS behavior (`01-05-PLAN.md:132`).
- Full-suite `npx vitest run` as phase gate (`01-05-PLAN.md:161-169`) matches D-25.

#### Concerns
- **MEDIUM — Toggle RPC existence leak backstop vs `RETURNS void`.** Backstop wants indistinguishable errors for missing/other-venue items (`01-05-PLAN.md:26-27`); a void RPC that raises vs silently no-ops can still leak. Spec should mandate identical success/no-op for unauthorized IDs (no distinct exception).
- **MEDIUM — Depends on Plan 03 RPC security being fixed.** Matrix will green-pass staff_profiles tests while `provision_staff_pin` remains directly exploitable if Plan 03 ships as written — release gate does not replace RPC authz tests for privileged mutations.
- **LOW — Concurrent toggle “consistency” assertion** (`01-05-PLAN.md:28-29`, `:137`) is underspecified for Vitest (no isolation level / retry guidance); easy flake.

#### Suggestions
- Add tests that call `provision_staff_pin` / `deactivate_staff_profile` as a non-owner via anon client and expect denial (closes Plan 03 hole in the gate).
- Define toggle unauthorized behavior as “returns without error and leaves zero rows changed.”
- Use a single DB transaction or advisory lock note for the concurrency case, or demote to manual/backstop-only.

#### Risk Assessment
**MEDIUM** (conditional **HIGH** if Plan 03 RPC authz is not fixed) — as a gate design this is excellent.

---

### Cross-Cutting Strengths
- Decisions D-09/D-10/D-11/D-22/D-25 are consistently applied across waves; manager deferred correctly despite ROADMAP “owner/manager” wording (`ROADMAP.md:35-37` vs `01-CONTEXT.md:38-39`).
- Migration numbering 0001→0004 and one-migration-per-wave against a shared local stack matches ROADMAP (`ROADMAP.md:41`).
- STRIDE registers per plan are concrete and mostly mapped to tests.
- Greenfield honesty: CONTEXT and RESEARCH Runtime State Inventory correctly state no app code yet.

### Cross-Cutting Concerns
| Severity | Issue | Evidence |
|----------|--------|----------|
| HIGH | Venue bootstrap under role-helper RLS | `01-01-PLAN.md:166` vs insert needs |
| HIGH | Staff `SECURITY DEFINER` RPCs without in-RPC authz | `01-03-PLAN.md:111`, `01-RESEARCH.md:371-384`, T-03-02 |
| HIGH | `pin_hash` / verify oracle exposure | `01-03-PLAN.md:111`, Pattern 4 verify SQL |
| MEDIUM | `01-VALIDATION.md` unfilled template | `01-VALIDATION.md:22-53` vs `01-RESEARCH.md:652-672` |
| MEDIUM | ROADMAP invite/manager language vs D-04/D-09 | `ROADMAP.md:28-37`, `REQUIREMENTS.md` ACCT-04 “invite” |
| MEDIUM | Wave 2→3 hard block vs plan `depends_on` | `ROADMAP.md:50-52` vs `01-03-PLAN.md:6` |

---

### Suggestions (priority order)
1. **Plan 01:** Add atomic `create_venue` SECURITY DEFINER (or documented admin bootstrap) that creates venue + owner membership; add a client-SDK test that succeeds under RLS with only the anon key for the owner path.
2. **Plan 03:** Move owner/membership checks into every staff RPC; lock down `pin_hash`; require venue membership on verify.
3. **Plan 05:** Extend the release gate with negative RPC abuse cases for provision/deactivate.
4. **Scaffold:** Fix non-empty-directory create-next-app strategy; fill `01-VALIDATION.md` from RESEARCH’s test map before Wave 1 starts.
5. **Docs:** Align ROADMAP/REQUIREMENTS “invite/manager” language with D-04/D-09 to avoid executor thrash.

---

### Overall Risk Assessment

**HIGH** — primarily due to Plan 01’s unspecified first-membership bootstrap and Plan 03’s Server-Action-only authority on `SECURITY DEFINER` RPCs. The intended architecture (Patterns 1–4, device-as-staff, D-25 client-SDK gate) is the right one and Plans 02/04/05 are largely execution-ready once those two holes and the scaffold/consent edge cases are closed. Do not start Wave 1 coding until Plan 01’s create-venue bootstrap path is written into the migration/task text.

---

## Claude Review

# Cross-AI Plan Review — Phase 1: Multi-Tenant Foundation (Plans 01-01 … 01-05)

**Verification note:** This is a greenfield repo — I confirmed on disk that none of the referenced implementation files exist yet (`package.json`, `supabase/`, `app/`, `lib/`, `tests/` all absent). Per review instruction #4, findings therefore cannot cite implementation code; they are verified against the planning artifacts on disk (`01-CONTEXT.md`, `01-RESEARCH.md`, `SKELETON.md`, `.planning/research/ARCHITECTURE.md`, ROADMAP/REQUIREMENTS/STATE — all read in full) and against documented Postgres/PostgREST semantics for the SQL the plans specify verbatim. Where a claim depends on runtime behavior I could not observe, I say so and mark it for implementation-time verification.

---

### Plan 01-01 — Walking Skeleton

#### Summary
A well-scoped tracer that stands up the scaffold, the core tenancy schema, and the first isolation test in one slice. The schema, policy pattern, and test-harness choices faithfully implement D-13/D-14/D-21/D-22/D-23 and the research's Pattern 1. However, the plan contains a **blocking RLS bootstrap deadlock in its own happy path**: under the exact policies it specifies, `createVenue` cannot insert the venue or the owner membership row — and the planned automated verification would not catch it, because test fixtures are created with the service-role key.

#### Strengths
- Migration 0001 is specified concretely enough to review as SQL (`01-01-PLAN.md:166`): enum, helper signature, `set search_path = ''`, `(select auth.uid())` wrapping, RLS-in-creation-migration, unique `(venue_id, user_id)` — all match D-22/D-23 and RESEARCH Pattern 1 (`01-RESEARCH.md:253-278`) exactly.
- Consent capture (D-21) is in the signup action with version + timestamp, and protected by an explicit prohibition.
- `lib/supabase/admin.ts` gets an `import 'server-only'` guard plus a grep-based acceptance criterion for `NEXT_PUBLIC_*SECRET` — a real, mechanical enforcement of D-24, stronger than the research asked for.
- Edge-probe truths (Unicode/diacritics names, duplicate names, currency domain, deterministic ordering) are unusually thorough for a skeleton plan.
- The supply-chain checkpoint (Task 1) correctly implements the research's instruction (`01-RESEARCH.md:156`) rather than skipping the gate.

#### Concerns
- **HIGH — `createVenue` is deadlocked by the plan's own RLS policies, and the planned tests won't detect it.** The only write policies specified for migration 0001 are: venues owner-full-access `using (private.get_venue_role(id,(select auth.uid())) = 'owner')`, member-read (SELECT) on `venue_members`, and an accounts policy (`01-01-PLAN.md:166`). In Postgres, a `FOR ALL` policy with no `WITH CHECK` applies its `USING` expression to INSERTs. At the moment `createVenue` inserts the venue, no `venue_members` row exists yet → `get_venue_role` returns NULL → INSERT denied. The follow-up `venue_members` insert is equally denied (member-read is SELECT-only; owner-full requires already being owner). So the flow "inserts venue + owner venue_members row in one flow" through the anon-key server client (`01-01-PLAN.md:167`) cannot succeed. Critically, `tests/rls/setup.ts` creates venues **via service-role fixtures** (`01-01-PLAN.md:167`), which bypass RLS — so `venue-isolation.test.ts` goes green while the walking skeleton's signup→venue flow fails at runtime. Neither RESEARCH Pattern 1 nor prior `.planning/research/ARCHITECTURE.md` (checked: no INSERT/bootstrap pattern exists anywhere — the only `with check` example is a staff-update policy at `ARCHITECTURE.md:118-122`) supplies an insert path; the gap flows from research into the plan unexamined.
- **MEDIUM — Task 2 is a mega-task.** Scaffold + migration + two pages + three Supabase clients + middleware + two Server Actions + Vitest harness + fixtures + tests in a single tracer task. If anything fails (likely, given the finding above), the deviation surface is the entire plan. Splitting "scaffold + clients" from "migration + actions + test" would cost little.
- **MEDIUM — signup/consent has no automated test anywhere in the phase.** The prohibition "never create an account without recording consent version" has no asserting test; RLS fixtures use `admin.createUser`, bypassing `signUpOwner` entirely. RESEARCH's own test map expects `tests/auth/signup.test.ts` for ACCT-01 (`01-RESEARCH.md:665`) — no plan creates it.
- **LOW — internal inconsistency in the helper signature:** must_haves say `private.get_venue_role(venue_id)` single-arg (`01-01-PLAN.md:44`); artifacts and Task 2 say two-arg `(v_id, u_id)` (`01-01-PLAN.md:123,166`). Trivial, but this is the single most-referenced symbol in the phase.
- **LOW — the `revoke execute ... from anon, authenticated` line likely doesn't do what it claims** (`01-01-PLAN.md:166`, inherited from `01-RESEARCH.md:269`). Function EXECUTE defaults to a grant to PUBLIC; revoking from specific roles does not remove the PUBLIC grant, so the revoke is a no-op — the *actual* protection is that the `private` schema isn't API-exposed by PostgREST. Conversely, if an implementer "fixes" it by revoking from PUBLIC, policy evaluation itself would fail with permission-denied for authenticated users (policy expressions run with the caller's privileges). Verify at implementation time; don't cargo-cult either direction.
- **LOW — no member-read policy on `venues`.** A staff/device session cannot SELECT its own venue's row (name, currency). This bites Plan 04's test ("device reads Venue A rows" — of which table?) and any tablet UI that shows the venue name. Decide intentionally and record it in the Plan 05 matrix.

#### Suggestions
- Add a `SECURITY DEFINER create_venue_with_owner(p_account_id, p_name, p_currency, …) returns uuid` RPC to migration 0001 that inserts the venue and the owner membership atomically, with an internal `owner_user_id = auth.uid()` check against `accounts`. This resolves the bootstrap deadlock **and** delivers the "double-submit never yields a venue lacking exactly one owner membership row" backstop truth transactionally — currently that truth has no mechanism behind it.
- Add one client-SDK test that creates a venue **as a signed-in owner through the anon key** (not via fixtures). This is the only automated proof that the actual production write path works under RLS.
- Add a small `tests/auth/signup.test.ts` asserting `terms_accepted_version/at` are populated by `signUpOwner`.
- Fix the one-arg/two-arg helper inconsistency.

#### Risk Assessment
**HIGH** until the bootstrap deadlock is resolved — it breaks the plan's primary success criterion (SC1: signup → venue with no manual help) and the planned verification is structurally blind to it. With the RPC fix, drops to LOW-MEDIUM.

---

### Plan 01-02 — Owner Auth Completeness

#### Summary
A reasonable, well-bounded plan for reset, Google One Tap, and the minimal switcher. The main weaknesses are two under-specified mechanisms — how a first-time Google user gets an `accounts` row + consent evidence, and how the reset test obtains the recovery token — both of which the executor will have to invent at the hardest point of the task.

#### Strengths
- The no-enumeration prohibition with a test asserting identical response shapes for registered vs. unregistered emails is a genuinely good, testable security requirement (T-02-01).
- The switcher is correctly RLS-scoped with a cross-owner negative test, and the render-nothing-for-one-venue rule honors D-15 precisely.
- Google One Tap implementation follows the research's nonce-hashing + FedCM example verbatim (`01-RESEARCH.md:514-552`), which is current guidance.

#### Concerns
- **MEDIUM — first-time Google sign-in has no specified `accounts`-row creation path.** Email signup creates the accounts row inside `signUpOwner`; `signInWithIdToken` fires in a client component, and no server action or callback is named that creates `accounts` + consent for a brand-new Google user. The plan's mitigation ("surface the consent checkbox before enabling the One Tap prompt") gates the *prompt*, but the *row write* is unassigned, and the acceptance criterion is soft ("asserted in code path / component wiring" — not a runnable check). A Google-first owner could exist with no `accounts` row, breaking `createVenue` (FK to accounts) and violating the plan's own consent prohibition.
- **MEDIUM — the reset test's hardest step is unplanned.** "Request + complete a reset" via the client SDK requires the recovery token from the emailed link. Against a local stack that means scraping Mailpit/Inbucket's API or using `admin.generateLink` as a fixture — neither is mentioned. Note that `generateLink` partially defeats the point (the emailed-link path goes unexercised); pick one deliberately.
- **LOW — Task 2's verify is weak:** `npm run build` + grep for `signInWithIdToken` proves wiring, not behavior. Acceptable given the OAuth round-trip needs real Google config (correctly pushed to `user_setup`), but the plan should say explicitly that One Tap E2E is a manual verification item so `verify-work` routes it to a human.

#### Suggestions
- Specify the Google-first-user flow concretely: e.g., a post-sign-in server action `ensureAccount(consentVersion)` that upserts the accounts row, invoked from the One Tap callback before any redirect; add a client-SDK test that a Google-provisioned user (fixture via `admin.createUser` with provider metadata) cannot create a venue until the accounts row exists.
- Specify the recovery-token retrieval mechanism (Mailpit HTTP API is the honest one for a local stack) in the task's `<action>`.

#### Risk Assessment
**MEDIUM.** Nothing here is architectural; both gaps are executor-improvisation risks in a plan marked `autonomous: true`, which is where improvisation goes unreviewed.

---

### Plan 01-03 — Staff PIN Profiles

#### Summary
The PIN lifecycle (pgcrypto hashing, backoff-in-RPC, soft-delete) is correctly designed and matches D-16–D-20. But the plan carries forward a serious authority gap from the research: **`provision_staff_pin` performs no internal owner check**, relying on the Server Action — exactly the app-layer-as-boundary anti-pattern this phase exists to eliminate — and the `pin_hash` column is readable by any venue member under the specified policy, which the plan itself acknowledges only with a hand-wave.

#### Strengths
- PIN plaintext confinement to SECURITY DEFINER RPCs (D-19) is architected correctly, with a grep acceptance check that app code never surfaces `pin_hash`.
- Backoff via `failed_attempts`/`locked_until` inside `verify_staff_pin` (D-18) matches the research's "Don't Hand-Roll" guidance — no new infrastructure, timestamp comparison in the existing RPC, with a test asserting the lock clears on time (no owner reset).
- Soft-delete semantics (D-20) are complete: immediate PIN kill, row persistence, and a backstop truth that re-provisioning never resurrects the old identifier.
- `deactivate_staff_profile` is specified with the owner check **inside** the RPC (`01-03-PLAN.md:141`) — the correct pattern.

#### Concerns
- **HIGH — `provision_staff_pin` is callable cross-tenant by any authenticated principal.** The RPC as specified (`01-03-PLAN.md:111`) inserts unconditionally; the owner check lives only in the Server Action (`01-03-PLAN.md:105,112`). This inherits the research's own comment — "caller (Server Action) must first verify … before invoking this RPC" (`01-RESEARCH.md:383-384`) — which contradicts the phase's core principle that the DB, not the app layer, is the boundary (D-22; RESEARCH "Key insight", `01-RESEARCH.md:415`). Public-schema functions are exposed via PostgREST with EXECUTE granted to PUBLIC by default, so a staff device session — or an owner of a *different* venue — can call `client.rpc('provision_staff_pin', {p_venue_id: <victim>, …})` directly and plant a PIN profile in another tenant's venue. The planned negative test exercises `provisionStaffProfile` (the action), so it **passes while the RPC is wide open**. This is precisely Pitfall 4's false-confidence shape, one layer up.
- **MEDIUM/HIGH — `pin_hash` is selectable by any venue member.** RLS is row-level (the plan repeats this itself in 01-05's prohibitions), so the member-read policy on `staff_profiles` exposes every column, and "read via a view or column-select discipline" (`01-03-PLAN.md:111`) is left undesigned. A 4-digit PIN space is 10,000 candidates; against an exfiltrated bf-cost-12 hash that's an offline brute-force of minutes-to-hours with zero rate limiting — the backoff in `verify_staff_pin` never runs. Any staff member can recover any colleague's PIN, breaking D-05 attribution integrity. Threat T-03-01 claims this is mitigated but names no mechanism, and no test asserts non-selectability.
- **MEDIUM — `verify_staff_pin` has no caller-membership check and no EXECUTE restriction.** As specified, anon and members of unrelated venues can drive PIN attempts against any venue's profiles (throttled by backoff, but cross-tenant probing shouldn't be possible at all, and anon shouldn't reach it).
- **MEDIUM — D-05 attribution is claimed but never lands anywhere.** `verifyPin` returns a boolean; the plan never specifies where the verified staff identity is held afterward (cookie? client state?) or how it stamps subsequent writes — and Plan 05's toggle RPC takes no staff identifier (see below). As planned, no write in Phase 1 records *which* staff member acted.
- **LOW —** Task 1 specifies `verify_staff_pin` as `language sql`; Task 2's check-increment-lock logic requires plpgsql. Both tasks edit the same not-yet-applied migration file — fine locally, just be deliberate.

#### Suggestions
- Move the owner check inside `provision_staff_pin` (mirror `deactivate_staff_profile`); add a membership check inside `verify_staff_pin`; `revoke execute … from public, anon; grant execute … to authenticated;` on both. Add **direct-RPC** negative tests (non-owner calls `provision_staff_pin` via `client.rpc`; cross-venue principal calls `verify_staff_pin`) — these belong in the D-25 matrix.
- Drop the member SELECT policy on `staff_profiles` entirely; serve the name grid via a SECURITY DEFINER function or view returning only `id, name, deactivated_at is null` for the caller's venue. Add "staff session cannot read pin_hash" as a matrix assertion.
- Decide and document the post-`verifyPin` app-session mechanism now (even one sentence: "verified staff_profile_id held in an httpOnly cookie scoped to the tablet route group, TTL n minutes") — Plan 04 and Phase 2 both build on it.

#### Risk Assessment
**HIGH** as written — two of the three findings are DB-boundary bypasses in the phase whose entire purpose is proving the DB boundary, and the planned tests are aimed at the wrong layer. All are cheap to fix at plan level.

---

### Plan 01-04 — Shared-Tablet Staff Session

#### Summary
The device-as-principal design is the phase's most novel piece and the plan handles its known unknowns well — the cookie-swap uncertainty is honestly carried from RESEARCH Open Question 1 with a fallback, and revocation semantics (RLS re-derivation + `admin.signOut`) are exactly right and tested pre-JWT-expiry. The one real hole is that **the "swap back to staff mode after owner-unlock" step has no possible mechanism as specified**, because the device credential is generated once and never retained.

#### Strengths
- Revoke is authoritative at the right layer: delete `venue_members` (instant, because RLS re-checks membership on every query) + `admin.signOut(…, 'global')` as defense-in-depth, with a test asserting denial **before** JWT expiry and a second-revoke no-op (matches Pitfall 5, `01-RESEARCH.md:447-451`).
- The provisioned-device-account choice (vs. anonymous auth) is carried through consistently, avoiding the `is_anonymous` policy-contamination trap (T-04-05, RESEARCH Anti-Patterns).
- The re-enrollment idempotency backstop ("never a dangling half-provisioned principal") anticipates a real failure mode of the create-user → insert-rows → sign-in sequence, which is not atomic across Auth and Postgres.
- Route-group isolation of `(tablet)` from `(dashboard)` is preserved as a prohibition, matching the research's structure rationale.

#### Concerns
- **MEDIUM — owner-unlock swap-back is mechanically impossible as specified.** The device password is a `crypto.randomUUID()` "never shown to any human" (RESEARCH Pattern 2, `01-RESEARCH.md:303`) and nothing stores it. Once the owner signs in on the tablet (replacing the device cookies), no credential exists to "re-enable the device staff session" (`01-04-PLAN.md:143`), and the acceptance criterion quietly hedges to "asserted **or documented**" (`01-04-PLAN.md:151`). A workable design exists — on exit, an owner-authenticated action rotates the device password via `admin.updateUserById` and re-runs `signInWithPassword` (requires the tablet to persist its `device_user_id` in a durable non-session cookie) — but it changes the registry/action shape and should be decided in the plan, not improvised.
- **MEDIUM — the enableStaffMode create→insert→sign-in sequence has no failure-path handling.** If `signInWithPassword` fails after `createUser` + inserts succeed (the exact composition RESEARCH flags as ASSUMED, A1), the tablet is left on an owner session with a live orphan staff principal. The idempotency backstop acknowledges the symptom; the task should specify the reconciliation (e.g., enableStaffMode revokes/supersedes any prior active device enrolled by this flow before creating a new one).
- **LOW/MEDIUM — no auto-relock after owner-unlock.** A floor tablet holding a full owner session after the owner walks away is the highest-blast-radius state this phase can produce. D-07 implies it; a short idle-timeout back to the PIN surface is cheap and unplanned.
- **LOW — "device reads Venue A rows" doesn't say which table.** Under Plan 01's policies the device can read `venue_members` and (after Plan 03) `staff_profiles`, but **not** `venues` (owner-only). The test will work, but pin the table down so the assertion is deliberate — and see the Plan 01 note about whether `venues` needs member-read.

#### Suggestions
- Specify the swap-back mechanism (password-rotation-on-exit is the clean one) and persist `device_user_id` client-side at enrollment.
- Make enableStaffMode explicitly supersede any prior active enrollment it created, and test the double-enable path (it's currently only a backstop truth).
- Add an idle auto-relock to the unlock page's scope, even if trivial.

#### Risk Assessment
**MEDIUM.** The security architecture is sound and testable; the risk is sequencing/UX rework when the swap-back and failure paths are discovered mid-execution of an `autonomous: true` plan.

---

### Plan 01-05 — Toggle RPC + D-25 Release Gate

#### Summary
The right capstone: narrow RPC, deliberately absent staff UPDATE policy, and a full role × venue matrix through the anon key, with a grep guard against service-role assertions. Two things keep it from being airtight: the expected-permission matrix the suite asserts is never written down anywhere, and the staff-write denial assertion has a known false-signal trap inherited from the research skeleton.

#### Strengths
- `toggle_item_availability` re-checks membership **inside** the RPC (`01-05-PLAN.md:109`) — unlike Plan 03's provision RPC, this one is correct, and it improves on prior research (`.planning/research/ARCHITECTURE.md:118-125` still showed a staff row-UPDATE policy; the plan drops it entirely per D-11).
- The "no staff UPDATE policy, comment it as intentional" instruction plus a grep acceptance criterion makes the deliberate absence auditable — absences are usually the thing reviews can't see.
- Explicit negative-assertion-per-table requirement (from Pitfall 2) and the anon-key-only prohibition (T-05-04) directly encode D-25's contract.
- Edge coverage (idempotent toggle, cross-venue zero-rows without existence leak, concurrent toggles) is proportionate — thorough without inventing complexity.

#### Concerns
- **MEDIUM — the expected role × table × operation matrix is implicit.** Task 2 says "assert the exact allowed reads/writes" for every principal and table, but that contract is defined nowhere — the test author derives it from whatever the migrations happen to allow. Concretely undecided cases: staff SELECT on `venues` (currently denied — intended?); staff SELECT on `venue_members` (member-read exposes all of a venue's membership rows including the owner's `user_id` — intended?); staff SELECT of `staff_profiles.pin_hash` (currently allowed — Plan 03 finding). A release gate that asserts emergent behavior ratifies bugs instead of catching them. Write the matrix as a table in the plan (or CONTEXT) first; the suite then transcribes it.
- **MEDIUM — the staff-price-UPDATE denial assertion has a false-signal trap.** With no staff UPDATE policy, PostgREST returns **success with zero rows affected**, not an error. The research skeleton the plan points to asserts `expect(error).toBeTruthy()` (`01-RESEARCH.md:584-589`), which would fail spuriously and invite a wrong "fix." Plan 05 hedges ("errors / affects zero rows", `01-05-PLAN.md:109`) — replace the hedge with the required assertion: `.update({price:999}).select()` returns `[]` **and** a re-read shows the original price. The same applies to every "cross-venue write denied" assertion in the matrix.
- **LOW — the toggle RPC has no staff-attribution parameter,** yet the plan calls it "the template every future limited-role write reuses." D-05 requires stamping which staff member acted; either add `p_staff_profile_id` now (validated as an active profile of the item's venue) or state explicitly that attribution attaches in Phase 2 — silence here bakes the seam shut.
- **LOW — `rls_test_items` ships in production migrations** with no stated disposal plan. Note that Phase 2 drops or supersedes it, so it doesn't linger as an attack-surface curio.
- **LOW —** Task 3's full-suite run includes Plan 02's Google-dependent build/test; confirm nothing requires `NEXT_PUBLIC_GOOGLE_CLIENT_ID` at test time or the gate breaks in clean environments.

#### Suggestions
- Add the explicit permission matrix table to the plan; make "suite matches the matrix" the acceptance criterion.
- Specify the zero-rows-affected assertion pattern once in `tests/rls/setup.ts` as a helper (`expectWriteDenied(...)`) so every negative write assertion is uniform and correct.
- Fold the Plan 03 findings into the matrix: direct-RPC provisioning denial, `pin_hash` unreadability, cross-tenant `verify_staff_pin` denial.

#### Risk Assessment
**MEDIUM** — the gate's architecture is right; the risk is that an unspecified expectation matrix plus one wrong-shaped assertion lets the gate go green around real holes (which is the one failure D-25 exists to prevent).

---

### Cross-Plan Observations

- **Dependency ordering is sound.** Migrations 0001→0004 map cleanly onto waves; `depends_on` graphs are correct; the sequential-wave constraint (one plan touching the shared local stack at a time) is justified. The shared-requirement-ID overlap (ACCT-01/03 in Plans 01 and 02) is handled by GSD's shared-ID gate.
- **A systemic pattern worth naming:** three of the significant findings (venue-creation bootstrap, provision RPC authority, pin_hash exposure) share one root cause — *the plans inherited research examples that place authority checks in the app layer or omit write paths entirely, in a phase whose thesis is that only the DB layer counts.* A one-line rule fixes the class: **every SECURITY DEFINER RPC re-checks `get_venue_role` internally, and every table's creation migration must specify its INSERT path, not just SELECT/broad policies.** Add it to the phase checklist alongside D-23.
- **Vitest config nit (LOW):** `sequence.concurrent: false` (`01-01-PLAN.md:167`, from `01-RESEARCH.md:680`) serializes tests *within* a file; cross-**file** parallelism is Vitest's default and is what risks fixture collisions in the Plan 05 full-suite run. Add `fileParallelism: false` (or rely strictly on the unique-per-run-ID discipline setup.ts promises — but then say so).
- **Consent versioning (LOW):** single `terms_accepted_version/at` columns overwrite on re-acceptance; GDPR evidence usually wants history. Acceptable for v1 — note it as accepted debt.
- **No over-engineering observed.** The plans consistently resist scope creep (no manager role, no RBAC engine, minimal switcher, placeholder table instead of premature item schema). Scope matches the phase boundary in `01-CONTEXT.md` well.

### Overall Risk Assessment

**MEDIUM-HIGH as written; LOW-MEDIUM after plan-level fixes.** The architecture is correct and unusually well-defended (release-gate suite, threat models per plan, negative assertions mandated, secret-key grep guards). But the two HIGH findings — the venue-creation RLS deadlock (Plan 01) and the unguarded `provision_staff_pin` RPC (Plan 03) — are both cases where *the specified mechanism fails or is bypassable, and the specified tests are aimed at a layer that won't detect it*. Since D-25's entire justification is preventing exactly that false-confidence shape, these should be fixed in the plans before Wave 1 executes; every fix is a small, local edit (one RPC added, two RPCs hardened, one policy removed, one matrix table written), not a redesign. With those amendments, the plans achieve all five phase success criteria.

---

## OpenCode Review

OpenCode review failed — hard authentication error, not a timeout (re-running will not help).

The OpenCode `build` agent routes to GitHub Copilot models, and the account is not
licensed to use Copilot:

```
APIError 403 Forbidden — "unauthorized: not licensed to use Copilot"
url: https://api.githubcopilot.com/chat/completions
```

To enable OpenCode as a reviewer, either activate a GitHub Copilot license for this
account or configure OpenCode with a different (non-Copilot) model provider via
`review.models.opencode`, then re-run `/gsd-review --phase 1 --opencode`.

---

## Consensus Summary

Two source-grounded reviews now cover this phase: **Cursor** (independent model) and
**Claude** (fresh headless session, same model family as the executing environment). Both
confirmed the greenfield repo state on disk and grounded findings in concrete `file:line`
evidence against the planning artifacts and documented Postgres/PostgREST semantics (no
implementation code exists yet). They **agree on every HIGH finding**, which is the cross-AI
corroboration the prior single-source pass explicitly asked for. Treat the Agreed Concerns as
the pre-Wave-1 fix list.

### Agreed Strengths
_(raised by both reviewers)_
- **Security-first sequencing** — scaffold → auth completeness → PIN profiles → device-as-staff principal → D-25 RLS gate, consistently aligned with locked decisions D-01–D-25.
- **RLS defined in the same migration as table creation** (D-23), `(select auth.uid())` wrapping, and `import 'server-only'` on `lib/supabase/admin.ts` with a grep guard against `NEXT_PUBLIC_*SECRET` (`01-01-PLAN.md:165-167`).
- **Isolation proven through anon-key client-SDK Vitest tests, not the SQL editor** — the correct D-25 gate shape (matches Pitfall 4, `01-RESEARCH.md:401-402`).
- **Device-as-staff reuses `get_venue_role` with no special-casing**, and revocation is RLS-authoritative (membership delete + `admin.signOut(..., 'global')`), not JWT-expiry-dependent (Plan 04, matches Pitfall 5).
- **`toggle_item_availability` re-checks membership inside the RPC** (`01-05-PLAN.md:109`) — the correct pattern, and an improvement over the research skeleton's staff row-UPDATE policy.
- **No over-engineering / scope creep** — manager role deferred, minimal switcher, placeholder `rls_test_items` instead of a premature item schema; scope matches the phase boundary.

### Agreed Concerns
_(raised by both reviewers — highest priority, resolve before Wave 1)_
- **HIGH — First-venue creation is deadlocked by the plan's own RLS policies (Plan 01).** Owner-only INSERT authority keyed on `private.get_venue_role(...)` cannot authorize the very first `venues` / `venue_members` insert — no membership row exists yet, so the helper returns NULL and both inserts are denied (`01-01-PLAN.md:166`). Claude adds the sting: the planned `venue-isolation.test.ts` creates fixtures with the **service-role key**, which bypasses RLS, so the suite goes green while the real signup→venue path fails at runtime. **Fix:** an atomic `SECURITY DEFINER create_venue(...)` RPC that inserts the venue + owner membership together with an internal `auth.uid()` ownership check, plus one anon-key client-SDK test that exercises the real write path.
- **HIGH — Staff `SECURITY DEFINER` RPCs lack in-function authority (Plan 03).** `provision_staff_pin` (and `deactivate_staff_profile`, per Cursor) guard only in the Server Action; the RPC inserts unconditionally (`01-03-PLAN.md:111`). Because public-schema functions are EXECUTE-granted to PUBLIC and exposed via PostgREST, any authenticated principal — including an owner of a *different* venue — can `client.rpc('provision_staff_pin', {p_venue_id: <victim>})` cross-tenant. Threat T-03-02's "RLS mitigates" claim does not hold for the direct-RPC path, and the planned negative test exercises the *action*, so it passes while the RPC is wide open. **Fix:** move `get_venue_role(...) = 'owner'` inside every privileged RPC; `revoke execute ... from public, anon`; add direct-`.rpc()` negative tests.
- **HIGH / MEDIUM-HIGH — `pin_hash` is selectable by any venue member (Plan 03).** RLS is row-level, so a member-read policy on `staff_profiles` exposes every column; "view or column-select discipline" (`01-03-PLAN.md:111`) is undesigned. A 4-digit PIN against an exfiltrated bcrypt hash is an offline brute-force of minutes, and the in-RPC backoff never runs. **Fix:** drop the member SELECT policy on `staff_profiles`; serve the name grid via a SECURITY DEFINER view returning only `id, name, deactivated_at`; assert `pin_hash` non-selectability in the matrix. (Cursor: HIGH; Claude: MEDIUM-HIGH.)
- **HIGH / MEDIUM — `verify_staff_pin` is a cross-tenant PIN oracle (Plan 03).** No `auth.uid()` membership check, so any signed-in principal who learns UUIDs can probe PINs against any venue (`01-RESEARCH.md:386-394`). **Fix:** require caller venue-membership inside the RPC; restrict EXECUTE. (Cursor: HIGH; Claude: MEDIUM.)
- **MEDIUM — First-time Google sign-in has no `accounts`-row + consent path (Plan 02).** `signInWithIdToken` fires client-side; no server action creates the `accounts` row or records consent for a brand-new Google owner (`01-02-PLAN.md:40,134`). A Google-first owner could exist with no `accounts` row, breaking the `createVenue` FK and violating the consent prohibition. **Fix:** a post-sign-in `ensureAccount(consentVersion)` server action invoked from the One Tap callback, plus a test.
- **MEDIUM — Password-reset test has no specified token/mailer mechanism (Plan 02).** Completing a reset against the local stack needs the recovery token — via Mailpit/Inbucket HTTP API or `admin.generateLink` — neither is named (`01-02-PLAN.md:112`). **Fix:** name the mechanism in the task (the Mailpit/Inbucket HTTP API is the honest one; `generateLink` skips the emailed-link path).
- **MEDIUM — Owner-unlock swap-back is under-specified (Plan 04).** The device password is a `crypto.randomUUID()` that is never stored, so after the owner signs in on the tablet there is no credential to restore the device staff session; the acceptance criterion hedges to "asserted **or** documented" (`01-04-PLAN.md:151`). Claude frames it as mechanically impossible as written. **Fix:** rotate the device password on exit via `admin.updateUserById` + re-`signInWithPassword`, persisting `device_user_id` in a durable cookie — decided in the plan, not improvised.
- **MEDIUM — The D-25 release gate depends on the Plan 03 fixes and needs direct-RPC abuse tests (Plan 05).** The role×table matrix asserts whatever the migrations happen to allow, so it green-passes `staff_profiles` while `provision_staff_pin` stays exploitable. **Fix:** fold the Plan 03 findings into the matrix as explicit negative RPC-abuse assertions.

### Divergent Views
No direct contradictions between the two reviewers — every divergence is a finding one caught and the other did not (complementary coverage). These are worth folding in because a single reviewer would have missed them.

**Cursor-only (Claude did not surface these):**
- **HIGH — `create-next-app@latest .` runs against a non-empty repo** (`.planning/`, `.claude/`, `.git/` already present) and will likely refuse the directory with no fallback specified (`01-01-PLAN.md:165`). A concrete Wave-1 execution blocker.
- `get_venue_role`'s revoked-EXECUTE grant vs. later plans telling Server Actions to "assert via `get_venue_role`" — a revoked private function cannot be `.rpc()`'d; callers must SELECT `venue_members` or use a public wrapper.
- `enabled_languages` SQL default `'{}'` conflicts with the "default language must be one of enabled languages" domain rule unless Zod always requires a non-empty array.
- Doc hygiene: `01-VALIDATION.md` is still a placeholder template; ROADMAP "invite/manager" wording vs. D-04/D-09; ACCT-06 mis-tagged in Plan 03's frontmatter.

**Claude-only (Cursor did not surface these):**
- **D-05 staff attribution never lands.** No Phase-1 write records *which* staff member acted — `toggle_item_availability` takes no `p_staff_profile_id`, and the post-`verifyPin` session mechanism is unspecified. Decide the attribution seam now (add the param, or state explicitly it attaches in Phase 2) before it is baked shut.
- **The staff-write-denial assertion has a false-signal trap.** With no staff UPDATE policy, PostgREST returns **success with zero rows affected**, not an error — but the research skeleton asserts `expect(error).toBeTruthy()` (`01-RESEARCH.md:584-589`), which fails spuriously and invites a wrong "fix." Replace with `.update(...).select()` returns `[]` **and** a re-read shows the original value; standardize as an `expectWriteDenied()` helper.
- Plan 01 Task 2 is a **mega-task** (scaffold + migration + pages + 3 clients + middleware + 2 actions + Vitest harness + fixtures + tests in one tracer) — the deviation surface is the whole plan if anything fails.
- **No idle auto-relock after owner-unlock (Plan 04)** — a floor tablet left on a live owner session is the highest-blast-radius state the phase can produce.
- `rls_test_items` ships in production migrations with no stated disposal plan (note that Phase 2 drops/supersedes it).
- **Systemic root-cause naming:** three of the significant findings share one cause — plans inherited research examples that place authority in the app layer or omit INSERT paths, in a phase whose thesis is that only the DB layer counts. Add a phase-checklist rule: *every `SECURITY DEFINER` RPC re-checks `get_venue_role` internally, and every table's creation migration specifies its INSERT path, not just SELECT/broad policies.*
- Vitest `sequence.concurrent: false` only serializes within a file; add `fileParallelism: false` (or rely explicitly on the unique-per-run-ID fixture discipline) to avoid cross-file collisions in the Plan 05 full-suite run.

### Bottom line
Both reviewers land on the same overall verdict: **MEDIUM-HIGH risk as written, dropping to LOW-MEDIUM after plan-level fixes.** The architecture is correct and unusually well-defended; the blocking items are the two HIGH security holes (both now independently corroborated) plus Cursor's `create-next-app` execution blocker. Every fix is a small, local edit — one RPC added, two RPCs hardened, one policy removed, one matrix table and one assertion-helper written, one scaffold strategy chosen — not a redesign. **Do not start Wave 1 until Plan 01's `create_venue` bootstrap path and Plan 03's in-RPC authority checks are written into the migration/task text.**

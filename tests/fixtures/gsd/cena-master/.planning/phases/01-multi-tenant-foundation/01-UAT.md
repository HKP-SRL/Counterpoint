---
status: partial
phase: 01-multi-tenant-foundation
mode: mvp
user_story: "As a restaurant owner, I want to create my account and venue and invite staff with scoped roles myself, so that my team can work in Cena without any venue's data leaking to another and without limited-role staff changing prices, content, or settings."
source: [01-01-SUMMARY.md, 01-02-SUMMARY.md, 01-03-SUMMARY.md, 01-04-SUMMARY.md, 01-05-SUMMARY.md, 01-06-SUMMARY.md, 01-07-SUMMARY.md, 01-08-SUMMARY.md, 01-09-SUMMARY.md, 01-10-SUMMARY.md, 01-11-SUMMARY.md, 01-12-SUMMARY.md, 01-13-SUMMARY.md]
started: 2026-07-29T17:57:14Z
updated: 2026-08-04T16:00:00Z
coverage_classification:
  auto_passed: 81
  human_checkpoints: 17
  legacy_summaries: [01-10-SUMMARY.md]
last_session:
  date: 2026-08-04
  mode: automated browser pass (Playwright + local Supabase stack)
  legs_walked: [test-7 owner self-serve journey, G-01-6 enrolment reachability]
  legs_blocked: [test-12 Google live round trip — unauthorised JS origin on the OAuth client]
  new_gaps: [G-01-13, G-01-14, G-01-16]
  new_gaps_retracted: [G-01-15]
  fixtures: "all created rows deleted; post-session DB re-read and confirmed identical to pre-session"
---

## Current Test

[testing paused — 2 items outstanding: test 26 pending, plus parked gap G-01-16]

Paused 2026-08-04 by user decision to move on to product-decision work, not
because the items resolved. See ## Parked Gaps. To resume: `/gsd-verify-work 01`.

Updated 2026-08-05: G-01-13 and G-01-14 were folded into Phase 01.1 and are now
`resolved`. G-01-16 is the one item still knowingly carried.

<!-- The checkpoint this session paused on, kept verbatim so resuming needs no re-derivation: -->

number: 12
name: Google Live Round Trip — BLOCKED ON GOOGLE CONSOLE CONFIG
expected: |
  A live sign-in against Google Identity Services with a real account, on both
  /login and /signup. Everything up to Google's own servers is now verified
  automated (2026-08-04, Playwright): the control renders on BOTH pages, the
  real client id is wired, and is_fedcm_supported=true.

  It cannot complete today. Google refuses the origin:
    [GSI_LOGGER]: The given origin is not allowed for the given client ID.
    403 on accounts.google.com/gsi/button
    FedCM get() rejects with NetworkError

  This is EXACTLY the item G-01-12 recorded as `user_config_to_confirm`.
  http://localhost:3000 must be added as an Authorised JavaScript origin on the
  OAuth client in the Google Cloud console. No code change can substitute.
awaiting: user action (Google console), then a re-run of this leg
sequence: "legs 1 and 3 of 3 WALKED 2026-08-04 (automated). Leg 2 blocked on config."

## Tests

<!-- ── SECTION 1 — USER-FLOW WALK-THROUGH (MVP mode: runs first, halts on failure) ── -->

### 1. Cold Start Smoke Test
section: user-flow
expected: Kill any running dev server. Stop/restart the local Supabase stack and `supabase db reset` so all 7 migrations replay from zero. Start with `pnpm dev`. Stack boots without errors, all 7 migrations apply, app compiles, localhost:3000 loads without a runtime error.
result: pass
reported: "it errored with supabase start --debug ... supabase_analytics_cena container is not ready: unhealthy / supabase_vector_cena container is not ready: unhealthy — containers then pruned, whole stack torn down"
resolved_by: >-
  55f3b69 "fix(01): an optional analytics container stops destroying the whole
  stack" (2026-07-30) — sets [analytics] enabled = false in supabase/config.toml,
  so the failure of an optional observability service can no longer prune the
  whole stack. The commit records the verification: a clean start, `db reset`
  applying migrations 0001-0007, dev ready, /signup and /login 200, / 307.
resolved_at: 2026-07-30
reconciled_by: "01-RECONCILIATION.md row 1 — config.toml re-read (enabled = false) and the live stack re-observed: nine healthy containers, no analytics or vector container present. The entry was simply never updated after the fix."

### 2. Owner Signs Up
section: user-flow
expected: Open /signup. The Terms & Privacy consent box is UNCHECKED by default and submit is blocked until you tick it. Fill email + password, tick consent, submit. No email-verification gate stops you — you land signed in on the dashboard.
result: pass

### 3. Owner Creates First Venue
section: user-flow
expected: From the dashboard, create a venue: name, currency (only RON/HUF/EUR offered), default language. Submit. The venue is created and you land on it. A blank/whitespace name is rejected inline before submit.
result: pass

### 4. Owner Provisions a Staff Member
section: user-flow
expected: Open the venue's staff page. Add a staff member with a name and a 4-digit PIN — no email, no separate login for them. They appear in the staff roster. A blank name or a non-4-digit PIN is rejected.
result: pass

### 5. Tablet Enrols and Staff Signs In by PIN
section: user-flow
expected: Enable staff mode / enrol this browser as a tablet for the venue. The tablet surface shows a name grid of active staff. Tap your staff member's name, enter their 4-digit PIN. Correct PIN admits them; a wrong PIN is refused with the same message as an unknown profile.
result: pass

### 6. Staff Can Toggle Availability But Nothing Else
section: user-flow
expected: As the signed-in staff device, mark an item sold-out and back. That works. Anything that would change a price, menu content, or a venue setting is either absent from the staff surface or refused — the staff device cannot change them.
result: skipped
reason: >-
  MIS-DERIVED CHECKPOINT — not a product defect. Phase 1 ships no menu surface;
  ROADMAP Phase 2 is "Owner hand-builds and publishes a simple menu". Migration
  0004 states rls_test_items "IS A PLACEHOLDER AND PHASE 2 SUPERSEDES IT",
  existing only so the ACCT-06 staff-write boundary could be proven before the
  real content schema is designed — it is never rendered to a user. There is
  correctly nothing to click, and the user confirmed nothing is visible in the
  owner surface either.

  The ACCT-06 property this checkpoint aimed at is covered automatically by the
  RLS matrix: 01-05 D37-D46 (staff never gets a blanket UPDATE grant; the only
  staff write path is toggle_item_availability; direct price and is_available
  UPDATEs from a staff session are both denied), all auto-passed.

  Re-test this as a user flow in Phase 2, when a real menu exists.
uncovered_note: "Gap G-01-6 surfaced during this test but belongs to ACCT-05 enrolment, not ACCT-06 — recorded separately below."

### 7. One Owner Holds Multiple Venues
section: user-flow
expected: Back as the owner, create a second venue. The venue switcher lists BOTH venues in a stable order. Switching between them shows each venue's own data.
result: pass
originally_reported: "Where do I create another venue? I cannot see the button"
original_severity: major
partial_pass: >-
  The SWITCHER half verified after a second venue was seeded directly: both
  venues list in a stable order with their currencies, and switching between
  them shows each venue's own name, staff list and device registry. So 01-02
  D15 holds — only the route to CREATING the second venue is missing.
resolved_by: >-
  Plan 01-14 — adds /venues/new (app/(dashboard)/venues/new/page.tsx),
  lib/venue-routes.ts, an unconditional sidebar create entry and a trailing
  "Create venue" item on the switcher. tests/venues/second-venue-route.test.ts
  and tests/lib/unconditional-cta-coverage.test.ts are green (2 files / 7 tests).
resolved_at: 2026-08-04
halves: >-
  The SWITCHER half was ALREADY verified (see partial_pass above). The CREATE
  half is what plan 01-14 added. Only the CREATE half is new evidence here.
result_basis: >-
  SUPERSEDED 2026-08-04 — the browser leg has now been walked. See below.
reconciled_by: "01-RECONCILIATION.md rows 2 and 22"
browser_leg_walked: 2026-08-04
browser_leg_method: >-
  Playwright against the running dev server (localhost:3000) with the local
  Supabase stack up, driven end to end as a new owner with no prior state.
browser_leg_evidence: |
  The journey test 7's `expected` describes now completes by clicking only —
  no typed URLs after /signup:

    signup (consent gate blocks submit until ticked; no email-verification wall)
    -> first venue "UAT Temp RON" created on the signup step-2 form
    -> sidebar "Create venue" -> /venues/new -> "UAT Temp HUF" (HUF)
    -> switcher's own trailing "Create venue" item -> "UAT Temp EUR" (EUR)
    -> switcher lists ALL THREE in stable created order with currencies:
         UAT Temp RON · RON | UAT Temp HUF · HUF | UAT Temp EUR · EUR
       followed by a separator and the "Create venue" item
    -> switching between them shows each venue's own name, currency and details
    -> session cleared, logged back in, switcher still lists all three and
       switching still works

  Both affordances plan 01-14 added are present and UNCONDITIONAL: the sidebar
  entry rendered on every dashboard page including /venues/new itself, and the
  switcher's trailing item rendered alongside the venue list.

  Signed-out access to a venue URL redirected away rather than rendering.
result_note: >-
  Test 7's OWN truth — "create a second venue; the switcher lists BOTH in a
  stable order; switching shows each venue's own data" — is satisfied. Moving
  to pass on that basis.

  It does NOT carry the whole of rollup item 1, which also names "venues in
  RON/HUF/EUR". The EUR leg FAILED for a reason unrelated to G-01-7 and is
  recorded as its own gap, G-01-13 — an EUR venue cannot be created at all
  through the form. The EUR venue above exists only because a second language
  was added by hand as a workaround.

  Two further defects surfaced during this same walk: G-01-14 (switcher stale
  after venue creation), which is open, and the absence of any sign-out, which
  the user DEFERRED on 2026-08-04 — it sits in ## Deferred Follow-Ups and is not
  an open gap.
fixtures: >-
  Three venues, two device rows and two auth users were created for this walk
  and ALL deleted afterward. Post-cleanup state re-read and confirmed identical
  to pre-session: 4 venues (Bistro Central, Kürtős Kávézó, My Venue, Terasa
  Centrala), 4 auth users, 5 venue_members, 2 venue_devices.

### 8. No Venue's Data Leaks to Another Owner
section: user-flow
expected: Sign up (or sign in) as a SECOND, unrelated owner. Their dashboard shows zero venues — none of the first owner's venues, staff, or devices are visible or reachable, including by typing the first owner's venue URL directly (that URL 404s).
result: pass
note: "Tenant isolation confirmed through the UI, matching the RLS-layer proof in 01-05 D41 (every role x venue combination) and 01-01 D5."

### 9. Outcome — The Story Holds End to End
section: user-flow
expected: Standing back: a restaurant owner set up their own account, venue, and staff with scoped roles start to finish with no manual help, and a second owner saw none of it. (The "limited-role staff cannot change prices/content/settings" half of the outcome is proven at the RLS layer — 01-05 D37-D46 — because Phase 1 ships no menu surface to demonstrate it through.)
result: pass
note: >-
  MVP Section 1 (user-flow walk-through) is COMPLETE and the user story holds.
  The two open gaps are both discoverability defects on repeat use (G-01-6,
  G-01-7); neither breaks the first-run flow the story describes.

<!-- ── SECTION 2 — TECHNICAL / HELD-OUT CHECKS (deferred: run only after Section 1 passes) ── -->

### 10. Signup + Venue-Create Forms Match the Design Contract
section: technical
coverage_id: 01-01/D8
expected: Per UI-SPEC E1/E3 — consent unchecked by default and blocking submit, inline Zod field errors plus a top-level alert, spinner and disable during submit. Visual hierarchy, spacing rhythm, and the accent colour appearing ONLY on the primary CTA.
result: pass

### 11. Dashboard Shell Matches the Design Contract
section: technical
coverage_id: 01-01/D9
expected: Per UI-SPEC E4 — server-rendered sidebar nav + header. On a short viewport the sidebar scrolls without clipping nav items. A venue name beyond ~28 characters truncates with an ellipsis in the header rather than wrapping or overflowing.
result: pass
reported: "It's not really mobile friendly, we should support that but it's a pass"
note: "Contract items all hold. Mobile responsiveness of the owner dashboard captured as a deferred follow-up, not a gap."

### 12. Google One Tap Live Round-Trip
section: technical
coverage_id: 01-02/D14
expected: With a real Google OAuth client id set and the provider enabled (client id AND secret) in Supabase Auth, One Tap completes a live sign-in with hashed nonce + FedCM. Without NEXT_PUBLIC_GOOGLE_CLIENT_ID it renders inertly and the build/suite still pass.
note: Requires user-supplied Google OAuth credentials — user confirmed they are configured.
result: issue
reported: "I've setted it up, but there's no UI to log in with google"
severity: major
resolved_by: >-
  Plan 01-15 — renders an explicit Google control on BOTH /login and /signup
  (previously One Tap only, on /login only), adds COPY.consent.googleGate and
  COPY.errors.googleUnavailable so a suppressed prompt is no longer silent, and
  preserves the hashed-nonce binding, use_fedcm_for_prompt and the
  consent-before-session ordering. tests/auth/google-affordance.test.tsx and
  tests/lib/google-affordance-coverage.test.ts are green (2 files / 10 tests).
resolved_at: 2026-08-04
result_basis: >-
  CODE-SIDE GAP CLOSED; LIVE ROUND TRIP NOW BLOCKED ON GOOGLE CONSOLE CONFIG.
  Stays `result: issue`. Updated 2026-08-04 after an automated browser pass.
browser_leg_walked: 2026-08-04 (partial — as far as automation can reach)
browser_leg_evidence: |
  VERIFIED AUTOMATED (Playwright, dev server):

    * "Continue with Google" renders on BOTH /login AND /signup. G-01-12's
      third `missing:` item ("offer Google on /signup too") is satisfied — the
      control was previously absent from /signup entirely.
    * The control is DISABLED until the Terms box is ticked, and
      COPY.consent.googleGate renders verbatim beneath it:
      "Accept the Terms of Service and Privacy Policy to continue with Google."
    * Ticking consent swaps Cena's placeholder for Google's OWN rendered GIS
      button, loaded from accounts.google.com/gsi/button with the real
      NEXT_PUBLIC_GOOGLE_CLIENT_ID and `is_fedcm_supported=true` — so the
      hashed-nonce/FedCM wiring the gap asked to preserve is intact.
    * `window.google.accounts.id` initialises; the GSI client script loads.

  BLOCKED — Google refuses the origin. Console, verbatim:

    [GSI_LOGGER]: The given origin is not allowed for the given client ID.
    Failed to load resource: 403 () @ accounts.google.com/gsi/button?...
    [GSI_LOGGER]: FedCM get() rejects with NetworkError: Error retrieving a token.

  This is the precise condition G-01-12 already recorded under
  `user_config_to_confirm`. It is a Google Cloud console setting, NOT a code
  defect: http://localhost:3000 is not an Authorised JavaScript origin on the
  OAuth client. Until it is, no live round trip can complete on any machine.
residual_found: >-
  NEW — recorded as G-01-16. When the origin is unauthorised, the product says
  NOTHING. No alert, no COPY.errors.googleUnavailable, no visible state change;
  the user gets a Google button that does nothing and only the browser console
  explains why. That is the same silent-failure class G-01-12 was opened for,
  still live for what is by far the likeliest misconfiguration.
deployed_report: |
  USER REPORTED 2026-08-04: "google login works on deployed."

  This is real and useful evidence, and it is NOT evidence that the G-01-12 fix
  works. The deployed build predates the fix. Verified rather than assumed:

    Vercel production deployment dpl_75CcXbxa8PW7suShpugSPLGndF3H
      githubCommitSha 7ef4aa438165acf1b709521576737800d2a4cc7d
      = origin/master, "chore(design-sync): add Avatar, Badge and Dialog"
      dated 2026-07-31

    Local master is FIFTY-FOUR commits ahead of that. Plan 01-15's commits
    (43ac2e1 "give Google sign-in a control that does not need the prompt",
    d190f64 "offer Google on /signup") are dated 2026-08-04 and
    `git merge-base --is-ancestor` confirms NEITHER is in origin/master.

    Reading the deployed commit's own source settles it:
      git show 7ef4aa4:app/(auth)/signup/page.tsx      -> 0 GoogleOneTap mounts
      git show 7ef4aa4:.../GoogleOneTap.tsx            -> 0 renderButton calls
      git show 7ef4aa4:.../GoogleOneTap.tsx            -> 1 continueWithGoogle
                                                          (the checkbox label)
      git show 7ef4aa4:lib/copy.ts                     -> 0 googleGate,
                                                          0 googleUnavailable

  So what works on deployed is the ORIGINAL One-Tap-via-consent-checkbox on
  /login only — precisely the implementation G-01-12 was filed against.

  WHAT THIS DOES ESTABLISH, and it is not nothing. Test 12's clause 1 — "One Tap
  completes a LIVE sign-in with hashed nonce + FedCM" — is now OBSERVED rather
  than assumed, for the first time in this phase. It proves the Supabase Auth
  provider is correctly configured with both client id and secret, the OAuth
  client works, the hashed-nonce/FedCM handshake completes against real Google
  infrastructure, and the deployed origin is authorised. Every doubt about the
  auth wiring itself is now retired.

  It also localises the failure I hit: localhost is blocked purely because
  http://localhost:3000 is not an Authorised JavaScript origin. Nothing is
  broken in the code or in Supabase.

  WHAT IT DOES NOT ESTABLISH — all four are the substance of G-01-12's fix and
  none of them is deployed:
    * the explicit "Continue with Google" control (deployed has no renderButton)
    * Google on /signup at all (deployed does not mount it there)
    * COPY.consent.googleGate (absent from the deployed copy deck)
    * COPY.errors.googleUnavailable, and therefore G-01-16 either way

  NOTE THE SHAPE OF "IT WORKS". It works by ticking a consent checkbox whose
  label ends "…then continue with google". That is exactly the UX G-01-12
  describes as "not what anyone looks for when they want to sign in with
  Google". "It works if you know to tick the checkbox" and "the affordance is
  wrong" are both true at once, which is why the report does not close the gap.
disposition: >-
  STAYS `result: issue`. Clause 1 is proven live on the PRE-FIX build; what is
  still owed is the same round trip against the FIXED build, on both /login and
  /signup. Two routes to that, both the user's call: push master and re-test on
  the new deployment (the deployed origin is already authorised), or add
  http://localhost:3000 as an Authorised JavaScript origin and re-test locally.
residual_not_closed: >-
  The ensureAccount consent residual is UNCHANGED by plan 01-15 and is not
  described as closed: ensureAccount is an exported Server Action reachable by
  direct POST and TERMS_VERSION is already in the client bundle, so a consent row
  can be stamped without the component running. Deferred (01-RECONCILIATION.md
  row 18).
reconciled_by: "01-RECONCILIATION.md rows 3, 18 and 23"

### 13. Long Venue Name Is a Display-Only Truncation
section: technical
coverage_id: 01-02/D16
expected: A venue name longer than the ~28-char display limit round-trips INTACT through storage and the switcher — the full name is still there when you edit it. Only the rendered header/switcher shows the ellipsis.
result: pass

### 14. Login Form and Both Reset Stages Match the Contract
section: technical
coverage_id: 01-02/D17
expected: Per UI-SPEC E2 — unfilled two-field card by default, submit spinner + disable, contract error copy. On a rejected submit, entered values are PRESERVED with per-field Zod messages. Both password-reset stages render per contract.
result: pass

### 15. Staff PIN Session Survives the Round Trip
section: technical
coverage_id: 01-03/D26
expected: A real PIN entry on the tablet issues an httpOnly, HMAC-signed cookie scoped to the tablet route with a short TTL, and the NEXT request reads that identity back — the staff member stays identified across navigation without re-entering the PIN.
result: pass

### 16. Staff and Tablet Surfaces Match the Design Contract
section: technical
coverage_id: 01-03/D27
expected: Per UI-SPEC E6/E8/E9/E10 — initials fallback, muted deactivated badge, name truncation with hover tooltip, wrapping (not clipping) of a long interpolated name in the deactivate dialog, real-tablet touch-target size on the name grid, press-and-hold reveal, and the PIN dot fill/disable transition.
result: pass
source: automated-ui
verified: 2026-08-03 via Playwright against a production build (`pnpm build && pnpm start`), 1024x768 touch viewport
evidence: |
  E6 staff list — initials fallback rendered ("I" for Iuliu, "AP" for a long
  two-part name); a deactivated member STAYS listed carrying an outline
  "Deactivated" badge against the filled zinc-100 "Active" badge, and loses its
  Deactivate button; a 38-char name truncated with ellipsis (scrollWidth 473 >
  clientWidth 283) with the full name in `title` for the hover tooltip.

  E8 deactivate dialog — copy is an EXACT match to the Copywriting Contract
  ("Deactivate {name}?" / "Their PIN will stop working immediately. This can't be
  undone, but their past activity stays on record."). The long interpolated name
  WRAPPED to two lines (height 32px at line-height 16px, white-space: normal,
  overflow-wrap: break-word) and was not clipped. Initial focus lands on Cancel,
  not on the destructive confirm; confirm is rgb(220,38,38) = #DC2626.

  E9 name grid — tiles 128x96, far above the 44px floor. A DEACTIVATED member
  correctly did NOT render in the grid (D-20). Press-and-hold reveal is wired at
  NameGridPinPad.tsx:119 (450ms hold drops the `truncate` class).

  E10 PIN pad — idle state is exactly four unfilled 12px dots, matching the
  contract's stated size; the first dot filled on the first key; all 12 keys are
  64x64; keys carry `disabled={pending || locked}` (NameGridPinPad.tsx:220/241/252)
  with a spinner swapped in at :256. A wrong PIN produced the contract's exact
  copy "Wrong PIN. Try again." in destructive red rgb(220,38,38).
fixtures: "A throwaway staff member and a device labelled UAT-TEMP-PLAYWRIGHT were created for this check and BOTH deleted afterward; Iuliu's failed_attempts was restored to 0. Registry left as found (Terasa revoked, Test 1234 active)."
observations: |
  Two cosmetic deviations, neither failing a stated E6/E8/E9/E10 clause:
  1. Name-grid tile background renders #FFFFFF; the Color table names zinc-100
     (#F4F4F5) for "staff name-grid tile background".
  2. The "Unlock full access" link on the tablet is 124x20 — under 44px. It is an
     owner escape hatch rather than a name-grid tile, so E9's 44px clause does not
     literally cover it, but it is a touch target on a tablet surface.

### 17. Owner-Unlock Swap-Back and Idle Relock
section: technical
coverage_id: 01-04/D35 + 01-12/D7
expected: An owner unlocks the tablet, does owner work, and the device is rotated and re-signed-in on the way back — the tablet returns to being the staff device, not the owner. Separately, leaving the tablet idle past the threshold relocks it to the PIN pad with no interaction.
result: pass
source: automated
verified: 2026-08-03 — full suite green (40 files / 411 tests)
covering_tests: |
  tests/tablet/idle-relock.test.tsx (added by bd49852) — the idle timer itself:
  armed at the threshold and not before, restarted by each of the four activity
  events, cleared on unmount. Before this file every OUTCOME of the relock was
  covered but nothing executed the timer.
  tests/actions/device-exit-classification.test.ts + tests/actions/device-lifecycle-actions.test.ts
  — the owner-unlock swap-back half (exitOwnerUnlock returns the tablet to the
  staff device rather than the owner).

### 18. Device Registry and Revoke Dialog Match the Contract
section: technical
coverage_id: 01-04/D36
expected: Per UI-SPEC E7/E8 — empty state, label/date/badge rows, muted Revoked badge, ellipsised long device labels at real row width, correct dialog focus order, and destructive red used for revoke — never the accent green.
result: pass
source: automated-ui
verified: 2026-08-03 via Playwright against a production build
evidence: |
  EMPTY STATE (checked at Terasa Centrala, zero devices) — an EXACT match to the
  Copywriting Contract: heading "No devices enrolled", body "Enable staff mode on
  a tablet in your restaurant to get started.", CTA "Enable staff mode" rendered
  as a Link to /enable-staff-mode in accent green rgb(22,163,74) = #16A34A, which
  the Color table lists as a permitted primary-CTA use of the accent.

  POPULATED ROWS (checked at My Venue) — label / enrolled date / status badge, with
  the destructive revoke control present on the ACTIVE row and absent on the
  revoked one. "Active" is a filled zinc-100 badge; "Revoked" is an outline badge
  with a transparent background — the muted treatment D-08 asks for.

  LONG LABEL AT REAL ROW WIDTH — a 65-char label held clientWidth at 283px while
  scrollWidth grew to 473px (text-overflow: ellipsis, white-space: nowrap,
  overflow: hidden, min-width: 0). The row was NOT pushed wider and the date,
  badge and revoke button all stayed within it.

  E8 REVOKE DIALOG — copy is an EXACT contract match ("Revoke this device?" /
  "Staff on this tablet will be signed out immediately and won't be able to toggle
  availability until re-enabled." / confirm "Revoke device"). Focus order is
  Cancel -> Revoke device -> Close, opening on Cancel rather than the destructive
  confirm. Confirm is rgb(220,38,38) = #DC2626, never the accent green. Cancelling
  left the registry byte-identical (verified in the DB).

### 19. Owner Sees Both Staff Surfaces With a Tablet Enrolled
section: technical
coverage_id: 01-06/D6
expected: As the owner in a browser, at a venue that HAS a tablet enrolled, open both /venues/[id]/staff and /venues/[id]/staff/devices. Both render — the staff roster and the device registry with a visible revoke control — rather than 404ing. (This is the CR-01 regression.)
result: pass
source: automated-ui
verified: 2026-08-03 via Playwright, signed in as the owner of My Venue (which holds one ACTIVE and one REVOKED device)
evidence: |
  CR-01 is closed. Both routes rendered for the owner at a venue with a tablet
  enrolled — neither 404'd:
    /venues/{id}/staff         -> roster listing Iuliu, plus the provisioning form
    /venues/{id}/staff/devices -> registry listing both devices, with a visible
                                  "Revoke device" control on the active row
  This is the exact condition CR-01 regressed on, exercised against the real
  authority predicate rather than a fixture (commit 0976c34 resolves owner
  authority on both staff pages via the shared predicate).

### 20. Failed Consent Write Is Recoverable From the Signup Form
section: technical
coverage_id: 01-07/D6
expected: With a transient consent-write (ensure_account) failure induced, the signup form retries once; and a re-submit that already holds a session for that address falls through rather than dead-ending the owner on a form they cannot get past.
result: pass
source: automated
verified: 2026-08-03 — full suite green (40 files / 411 tests)
covering_tests: |
  Both clauses are covered by fault-injecting tests in tests/actions/auth-actions.test.ts:
    :190 "retries the consent write EXACTLY ONCE and succeeds on the second attempt"
    :210 "fails LOUDLY, and stops at two attempts, when the consent write will not land"
    :232 "falls through to the consent write when the caller already holds a session for THAT email"
  and the two negative cases that keep the fall-through from becoming a hole:
    :253 "does NOT fall through for a caller holding a session for a DIFFERENT email"
    :276 "does NOT fall through for a caller holding no session at all"
  The induced-failure path is exercised directly, which is what this checkpoint
  asked a human to simulate by hand.

### 21. Reset-Password URL Is Not a Back Door for a Signed-In Owner
section: technical
coverage_id: 01-07/D7 + 01-11/D6
expected: A signed-in owner who has NOT redeemed a recovery link and simply TYPES /reset-password — or /reset-password?stage=set — sees the request stage, never the "Choose a new password" form.
result: pass
source: automated
verified: 2026-08-03 — full suite green (40 files / 411 tests)
covering_tests: |
  tests/auth/reset-stage-source.test.ts (added by bd49852, 21 assertions). It drives
  the real reset-password page and reads back WHICH form the returned element tree
  holds: ?stage=set cannot reach the set-password form with no grant, an EXPIRED
  grant, or a FORGED one; a valid grant still can. CR-03 was a render decision and
  every pre-existing recovery test sat below the page, so this closes the checkpoint
  at the layer the defect lived on.

### 22. Full GoTrue Recovery Journey Under secure_password_change
section: technical
coverage_id: 01-11/D7
expected: With secure_password_change = true, the complete recovery journey succeeds end to end; and an updateUser password change attempted from an ordinary NON-recovery password session is refused for want of recent authentication.
result: pass
source: automated + corrected expectation
verified: 2026-08-03 — full suite green (40 files / 411 tests)
expectation_correction: |
  Clause 2 STRUCK as mis-derived (user decision, 2026-08-03). The checkpoint's
  second clause asserted a GoTrue behaviour that does not exist; the security
  property it was aiming at is held by the app-layer grant gate in
  completePasswordReset, which is verified by test 21. Clause 1 stands as written
  and passes. Restated, the checkpoint this phase actually satisfies is:

    "With secure_password_change = true the complete recovery journey succeeds
     end to end; and a password change is refused for any session that cannot
     present a valid, unexpired, correctly-bound recovery grant."

  Both halves of THAT are proven — clause 1 by recovery-gate.test.ts:160, the
  restated second half by reset-stage-source.test.ts (no grant / expired grant /
  forged grant all fail to reach the set-password form).
finding: |
  SPLIT VERDICT — clause 1 passes; clause 2 is a FALSE PREMISE, and the repo has
  already measured and documented that.

  CLAUSE 1 — PROVEN. supabase/config.toml:250 sets secure_password_change = true,
  and tests/auth/recovery-gate.test.ts:160 ("redeems an emailed token, sets a new
  password, and kills the old one") drives the complete journey through the REAL
  local mailbox (Mailpit) rather than admin.generateLink: request reset -> read the
  emailed token -> verifyOtp -> updateUser -> sign in with the NEW password ->
  confirm the OLD password is now refused. It passes.

  CLAUSE 2 — THE EXPECTATION IS WRONG ABOUT GoTrue. tests/auth/recovery-gate.test.ts:214
  deliberately RECORDS rather than asserts what GoTrue does here, and the recorded
  observation (CLI v2.109.1) is that the password change is PERMITTED: a session
  minted seconds earlier by signInWithPassword already satisfies GoTrue's
  "recently authenticated" test. So secure_password_change does NOT by itself
  refuse an ordinary password session.

  WHY THIS IS NOT A DEFECT. That measurement is precisely why the app-layer gate in
  completePasswordReset is load-bearing rather than belt-and-braces — and that gate
  IS verified, by test 21 above (tests/auth/reset-stage-source.test.ts: no grant,
  expired grant and forged grant all fail to reach the set-password form). The test
  file states outright that anyone tempted to relax the grant check because "GoTrue
  requires reauthentication now" should read the measurement first.

  It is left un-asserted on purpose: which sessions count as "recent" is a property
  of whichever GoTrue build the installed CLI ships, so pinning it would turn a CLI
  bump into a red suite for a reason unrelated to Cena.

  DISPOSITION NEEDED: record as pass-with-corrected-expectation (clause 2 struck as
  mis-derived, the security property it aimed at being held by the app-layer grant),
  or keep open. Same shape as test 6, which was skipped as MIS-DERIVED.

### 23. Un-Enrol on a Revoked Tablet
section: technical
coverage_id: 01-12/D8
expected: On a tablet whose device has been revoked, the un-enrol control clears BOTH cookies and lands on the ordinary login page without a server-side revoke — and the three-minute sign-out loop does not resume afterward.
result: pass
source: automated
verified: 2026-08-03 — full suite green (40 files / 411 tests)
covering_tests: |
  tests/actions/device-lifecycle-actions.test.ts (extended by bd49852, 23 assertions):
  un-enrol on an already-REVOKED tablet, and the WR-05 loop does not resume —
  driving exitOwnerUnlock on the same cookie jar afterwards takes the
  no-device-cookie path rather than device-not-active. That second assertion is
  what makes "the loop does not resume" observable rather than assumed.

### 24. Tied Venues List in a Stable Order
section: technical
coverage_id: 01-13/E8
expected: For two venues that tie on created_at, the dashboard and the switcher return them in the SAME order across repeated live reads — the ordering is specified and stable, not arbitrary per query.
result: pass
source: automated
verified: 2026-08-03 — full suite green (40 files / 411 tests)
history: |
  This checkpoint FOUND A REAL DEFECT and is now closed by its fix. Converting it
  into tests/venues/multi-venue.test.ts (bd49852) produced a FAILING test: because
  venues.created_at defaults to now() — transaction START time — two venues can tie
  exactly, and all five position-selecting list reads ordered on that single
  non-unique column with nothing to break the tie.
  Fixed by b296bf6, which gave every list read a total order across
  venues/page.tsx, VenueSwitcher.tsx, staff/page.tsx, staff/devices/page.tsx,
  enable-staff-mode/page.tsx and (tablet)/page.tsx; 46aee48 mirrored the same
  tiebreaker into both test helper reads so the suite reads what production reads.
  The test now passes.

### 25. Racing Venue Creation Produces Two Distinct Venues
section: technical
coverage_id: 01-13/E9
expected: Two racing venue-creation submits produce two distinct venues (v1 makes no cross-request dedupe guarantee and none is claimed) — not one venue, not a corrupt row, not an error.
result: pass
source: automated
verified: 2026-08-03 — full suite green (40 files / 411 tests)
covering_tests: |
  tests/actions/create-venue-action.test.ts (extended by bd49852, 25 assertions):
  two CONCURRENT submits produce two distinct, WHOLE venues. The pre-existing
  replay case was sequential and therefore said nothing about writes in flight
  together, which is exactly the race this checkpoint names.

<!-- ── SECTION 3 — COVERAGE CHECK (goal-backward on the user story's outcome clause) ── -->

### 26. Coverage — Outcome Clause Is Observably Delivered
section: coverage
coverage_id: 01-13/E10
expected: Goal-backward roll-up of the four items 01-VERIFICATION.md carried as needing a human. The user story's outcome — "my team can work in Cena without any venue's data leaking to another and without limited-role staff changing prices, content, or settings" — is observably true in the running app, not merely asserted by tests.
result: [pending]
rollup: |
  01-VERIFICATION.md's `human_verification:` block lists NINE items (not four).
  RE-DERIVED 2026-08-04 by plan 01-17 from that block as annotated in this round.
  Item 1's PARTIAL reason is gone: the second venue is no longer reachable only
  by seeding a row. What replaces it is not a pass — it is an owed browser leg.

  | # | Item | State |
  |---|------|-------|
  | 1 | Full owner self-serve journey in a browser (signup, venues in RON/HUF/EUR, sign out, log back in, switcher from the 2nd venue) | owed — the blocker is gone: plan 01-14 added `/venues/new` with an unconditional sidebar entry and a switcher item, so the owner can now create the second and third venue from inside the product without typing a URL. Nobody has walked that journey yet, so it is owed rather than partial. Ledger row 22. |
  | 2 | Staff-device principal loads /venues/{venueId} -> 404 | CLOSED this session — see below |
  | 3 | Owner loads both staff pages with a tablet enrolled | CLOSED — UAT 19 |
  | 4 | Idle relock past the threshold | CLOSED — UAT 17 (idle-relock.test.tsx now executes the timer) |
  | 5 | Un-enrol on a revoked tablet | CLOSED — UAT 23 |
  | 6 | /reset-password back door for a signed-in owner | CLOSED — UAT 21 |
  | 7 | Stranded owner re-submits consent | CLOSED — UAT 20 |
  | 8 | Tie ordering stable across repeated reads | CLOSED — UAT 24 (defect found AND fixed) |
  | 9 | GoTrue recovery journey under secure_password_change | CLOSED — UAT 22 (clause 2 struck as mis-derived) |

  ITEM 2 CLOSED 2026-08-03. This was the last item proven only at the predicate
  layer (venue-authority.test.ts:141/:161) with the RENDERED page unobserved —
  exactly the gap 01-VERIFICATION.md flagged. Verified directly: enrolled a
  throwaway device at My Venue so the browser held the venue's OWN staff-device
  principal, then loaded /venues/{venueId}. Result: HTTP 404 with title
  "404: This page could not be found." and NO venue name, currency, language,
  country or timezone anywhere in the response body. The throwaway device row,
  its auth user and its venue_members row were all deleted afterward; the
  registry, staff roster and venue_members are byte-identical to their
  pre-session state.

  OUTCOME CLAUSE — where each half now rests (re-stated 2026-08-04):

  * "without any venue's data leaking to another" — OBSERVED in the running app,
    three ways, and unchanged by this round: a second unrelated owner sees zero
    venues and 404s on a typed URL (UAT 8); the venue's own staff-device
    principal 404s on the venue detail (item 2 above); and the full role x venue
    RLS matrix passes (01-05 D41). This half is settled.

  * "without limited-role staff changing prices, content, or settings" — held at
    the RLS layer ONLY (01-05 D37-D46: no blanket staff UPDATE grant, the sole
    staff write path is toggle_item_availability, direct price and is_available
    UPDATEs from a staff session are both denied). It is NOT observable in the
    running app because Phase 1 ships no menu surface to demonstrate it through —
    the reason UAT 6 was skipped as MIS-DERIVED. Re-test as a user flow in
    Phase 2, when a real menu exists.

    THIS ROUND CHANGED NOTHING HERE, deliberately. Plans 01-14 … 01-17 touched
    venue creation, the Google control, the enrolment CTA and the phase's own
    records — none of them a menu surface. The half stays exactly as strong as it
    was, and it must not be recorded as observed in the running app before a menu
    exists to observe it through. Upgrading it on the strength of a green RLS
    suite would be asserting a user-flow fact that no user flow has produced.

  WHY THIS TEST IS STILL [pending]. Not because the outcome is in doubt at the
  data layer, but because the roll-up's own item 1 is owed, and two further legs
  arrived with gap-closure round 3 — the Google live round trip (test 12) and
  enrolment reachability on a revoked-only registry (G-01-6). A roll-up that
  passed on unrun legs would convert three unwalked journeys into settled fact for
  every later phase, which is the single worst outcome available to this pass.
  Ledger rows 22, 23 and 24.

  | Owed leg | Where it is recorded | State |
  |----------|---------------------|-------|
  | Owner self-serve journey — signup, RON then HUF then EUR from inside the product, switcher from the second venue, sign out, log back in | rollup item 1; UAT test 7; ledger row 22 | WALKED 2026-08-04 — PARTIAL: see below |
  | Google live round trip on /login AND /signup, including the suppressed-prompt case | UAT test 12; ledger row 23 | PARTLY EVIDENCED — a live round trip is confirmed working on the DEPLOYED build, but that build predates the fix (see test 12 `deployed_report`). Still owed against the fixed build. |
  | Enrolment reachable from a registry holding only a REVOKED tablet | G-01-6; ledger row 24 | WALKED 2026-08-04 — PASSES |

  Terms and Privacy links 404 during the first leg. That is a RECORDED DEFERRAL,
  not a regression, and it must not be reported as a new finding.

  ── UPDATE 2026-08-04, automated browser pass (Playwright + local stack) ──

  LEG 3 (G-01-6) IS CLOSED. Both halves verified against a real rendered page,
  which is what the reachability guard could not do:
    * registry holding ONLY a revoked tablet -> "Enable staff mode" link to
      /enable-staff-mode IS rendered, and the revoked row correctly carries no
      revoke control;
    * registry holding an ACTIVE tablet alongside the revoked one -> the CTA is
      STILL rendered, so enrolling a second tablet is reachable too.
  That was the last thing G-01-6 was waiting on. ACCT-05's enrolment
  reachability is now observed, not merely structurally guarded.

  LEG 1 IS PART-WALKED, AND IT FOUND THREE DEFECTS. The G-01-7 half it was owed
  for PASSES outright — the sidebar and switcher create affordances both work,
  the switcher lists venues in stable order, and switching works across a
  re-login. But the leg as ROLLUP ITEM 1 states it does not complete:
    * "venues in RON/HUF/EUR" — EUR cannot be created at all (G-01-13, blocker).
      This is the one clause still genuinely failing.
    * "sign out, log back in" — no sign-out exists. DEFERRED by user decision
      2026-08-04, so this clause is now out of scope rather than failing; the
      "log back in" half was walked by clearing the session directly. See
      ## Deferred Follow-Ups.
    * and the switcher is stale immediately after creation (G-01-14).

  LEG 2 CANNOT RUN ON THIS MACHINE. Google refuses the origin outright, which is
  the `user_config_to_confirm` item G-01-12 already carried. Everything up to
  Google's boundary is verified; the round trip needs the console change first.
  The pass also found G-01-16 — that this failure is silent to the user.

  LEG 2 UPDATE, same day. The user reports Google login WORKS on the deployed
  app. Checked against Vercel and git rather than taken at face value: the
  production deployment is commit 7ef4aa4 (2026-07-31), fifty-four commits
  behind local, and neither of plan 01-15's commits is in it. The deployed build
  therefore has no Google control, no Google on /signup, and neither new copy
  key — it is the original One-Tap-via-checkbox on /login.

  The report still moves the phase forward: it proves a live hashed-nonce/FedCM
  round trip completes against real Google with the Supabase provider fully
  configured, which nothing in this phase had yet observed. It does not close
  the leg, because the thing the leg exists to check — the fix — is not what
  was tested. Full working in test 12's `deployed_report`.

  A DEPLOYMENT-DRIFT NOTE WORTH KEEPING. Everything Phase 1 verified this week
  lives in 54 unpushed local commits. Any future "works on deployed" or "broken
  on deployed" report is, until master is pushed, a statement about 2026-07-31
  code and must be checked against the deployed SHA before it is believed.

  WHAT THIS MEANS FOR THE OUTCOME CLAUSE. The isolation half is unchanged and
  still settled. The "limited-role staff" half is unchanged and still RLS-only,
  awaiting a Phase 2 menu surface. Nothing found this round weakens either. What
  the round changes is that rollup item 1 is no longer merely unrun — it is
  RUN AND FAILING on two of its named clauses, which is a stronger and more
  useful state than the ambiguity it replaced.

<!-- ── AUTOMATED — deterministically covered by passing tests; NOT presented to the user ── -->
<!-- 81 deliverables auto-passed via `uat classify-coverage` against each SUMMARY's `coverage:` block. -->
<!-- Source of record for each entry's covering tests is the `coverage:` block of the named SUMMARY. -->

### 27-107. Automated coverage (81 deliverables)
result: pass
source: automated
detail: |
  01-01: D1 D2 D3 D4 D5 D6 D7        (7 — ACCT-01/02/03/08 + migration 0001)
  01-02: D10 D11 D12 D13 D15         (5 — ACCT-01/03, reset + switcher)
  01-03: D18 D19 D20 D21 D22 D23 D24 D25  (8 — ACCT-04, PIN provisioning/authority/backoff)
  01-04: D28 D29 D30 D31 D32 D33 D34 (7 — ACCT-05/08, device enrol/revoke/registry)
  01-05: D37 D38 D39 D40 D41 D42 D43 D44 D45 D46 D47 D48 (12 — ACCT-06/07/08, staff write boundary + full isolation matrix)
  01-06: D1 D2 D3 D4 D5 D7           (6 — ACCT-04/05, venue-authority predicate + HMAC codecs)
  01-07: D1 D2 D3 D4 D5              (5 — ACCT-01, recovery grant)
  01-08: D1 D2 D3 D4 D5 D6           (6 — ACCT-04, PIN backoff CR-02)
  01-09: D1 D2 D3 D4 D5 D6 D7        (7 — ACCT-01/02/03/07, column-privilege lockdown)
  01-11: D1 D2 D3 D4 D5              (5 — ACCT-01, recovery cookie lifecycle)
  01-12: D1 D2 D3 D4 D5 D6           (6 — ACCT-05, device-exit classification)
  01-13: E1 E2 E3 E4 E5 E6 E7        (7 — ACCT-02/07/08, route-family gate + landing read)

## Notes

- **01-10-SUMMARY.md** classifies as `mode: legacy` (no structured `coverage:` block).
  Its deliverables are internal (device-cookie policy module, denial-shape test
  integrity); its one user-observable item, `unenrollThisBrowser`, is covered by
  test 23. Nothing dropped, nothing auto-passed from it.
- **Merged duplicates** (both ids retained above): 01-07/D7 + 01-11/D6 → test 21;
  01-04/D35 + 01-12/D7 → test 17.
- **01-VERIFICATION.md was stale, and the queued re-verification has now happened**
  (plan 01-17, 2026-08-04). It read `status: gaps_found` with `score: 7/11` and a
  three-item `regressions:` list. All three regressions are closed and were
  re-derived from source rather than from the commit messages: `f29ece0` (read
  fault ≠ absent venue — the three `[venueId]` pages now route through
  `resolveVenueRow`, which throws at `lib/venue-page-read.ts:86`), `8487bfd`
  (`app/(dashboard)/error.tsx` exists), and the two coverage guards are now
  AST-based (`import ts from "typescript"` in each). The WR-10 residual is closed
  too: all six previously-unexercised Server Actions are now driven by tests.
  `score` is re-derived to 10/11. **`status` deliberately stays `gaps_found`** —
  three human legs are owed and one truth (SC1) is behaviour-unverified until the
  first of them is walked. See `01-RECONCILIATION.md` rows 5-11 and its recorded
  status decision.

## Summary

total: 26
passed: 23
issues: 1
pending: 1
skipped: 1
blocked: 0
automated_passed: 81
open_gaps: 1
open_gap_ids: [G-01-16]
open_gap_state: "PARKED 2026-08-04 by user decision — carried knowingly, still owed, no fix plans spawned. G-01-13 and G-01-14 left this set on 2026-08-05, resolved by Phase 01.1 plan 01.1-13. See ## Parked Gaps for what the remaining one costs and when to revisit."
phase_completable: false
phase_incomplete_because: >-
  G-01-13 no longer holds: an EUR venue can be created, so ROADMAP Phase 1 SC1's
  currency clause is true again (Phase 01.1 plan 01.1-13, 2026-08-05). Test 26's
  roll-up nevertheless stays [pending] — unblocked on the CURRENCY leg only, its
  sign-in leg still owing a browser walk against a build carrying the G-01-12
  fix, which is where G-01-16 sits. ACCT-01 stays unticked for that reason;
  ACCT-03's currency blocker is cleared in code and pinned by a regression test
  but its owner-journey browser leg is still owed, and a gap resolved in code is
  not the same fact as an outcome observed by a person. Phase 1 must NOT be
  marked complete. This blocks neither Phase 01.1 nor product-decision work.
retracted_gaps: "G-01-15 (sign-out) — deferred by user decision 2026-08-04, moved to ## Deferred Follow-Ups. Not a blocking gap; must not spawn a fix plan (#1921)."
suite: "46 files / 442 tests passed — observed 2026-08-04 (plan 01-17). The 40 files / 411 tests figure recorded on 2026-08-03 predates plans 01-14 … 01-16 and is kept only inside dated session notes."
counters_recomputed: >-
  Recomputed 2026-08-04 (session 2, automated browser pass) by counting entries.
  passed 22 -> 23: test 7's browser leg was walked and its own stated truth
  holds. issues 2 -> 1: test 7 leaves the issue set; test 12 REMAINS an issue,
  now blocked on a Google console setting rather than on an unrun leg. pending 1:
  test 26. skipped 1: test 6. Arithmetic: 23 + 1 + 1 + 1 = 26.

  NOTE THE COUNTS ARE NOT THE HEADLINE. Four NEW gaps were opened this session
  (G-01-13 … G-01-16), one of them a blocker. Test 7 passing while G-01-13 is a
  blocker is not a contradiction: test 7's `expected` asks only for a second
  venue and a working switcher, both of which now hold. The EUR failure belongs
  to rollup item 1, which is wider than test 7.
section_1_user_flow: complete — story holds
section_2_technical: complete — all 16 resolved
section_3_coverage: >-
  test 26 still [pending]. Its three owed legs are no longer all unrun: leg 3
  (enrolment reachability) PASSES and is closed; leg 1 was walked, and after the
  sign-out clause was deferred (user decision 2026-08-04) exactly ONE of its
  clauses still fails — EUR venue creation, G-01-13, a blocker — with G-01-14
  surfaced alongside it; leg 2 is blocked on a Google console setting the user
  must make, with G-01-16 found on the way. The roll-up cannot pass while a
  blocker sits inside item 1.

<!-- Session 2026-08-03 — 9 checkpoints closed without needing a human:
     16, 18, 19 verified through the browser (Playwright, production build);
     17, 20, 21, 23, 24, 25 closed by tests that did not exist when this file
     was written. Full suite green: 40 files / 411 tests. -->

## Gap Reconciliation (2026-08-03)

Checked every `status: failed` gap against `*-PLAN.md` frontmatter `gap_ids` in the
phase dir, per the verify-work reconcile step:

| Gap | State | Basis |
|-----|-------|-------|
| G-01-1  | resolved (already) | 55f3b69 — analytics container no longer tears down the stack. The local stack has since been up 4 days healthy, with NO analytics/vector containers present. |
| G-01-6  | **still open** | No plan in the phase dir carries `gap_ids: [G-01-6]`. Re-confirmed live this session: at My Venue the registry is non-empty and the devices page offers NO enrolment affordance; the only "Enable staff mode" CTA in the product is the one on the EMPTY-state page, seen at Terasa Centrala. |
| G-01-7  | **still open** | No plan carries `gap_ids: [G-01-7]`. The venue switcher still lists venues only, with no create affordance. |
| G-01-12 | **still open** | No plan carries `gap_ids: [G-01-12]`. |

0 gaps newly resolved, 3 still open. None has a fix plan yet.

## Gap Reconciliation (2026-08-04)

Gap-closure round 3 landed (plans 01-14 … 01-17). Every row below was re-derived
against live source, a named commit or a real suite run before this table was
written — the per-row evidence is in `01-RECONCILIATION.md`, which is the licence
for each change. The 2026-08-03 table above is left exactly as it was: it is a
record of what was true on its date, not a draft of this one.

| Gap | State | Carried by | Basis |
|-----|-------|-----------|-------|
| G-01-1  | resolved (already) | 55f3b69, 2026-07-30 | Unchanged from the round above. Re-confirmed this round: `supabase/config.toml` reads `[analytics] enabled = false`, and the live stack shows nine healthy containers with NO analytics or vector container. UAT test 1 corrected from `issue`/`blocker` to `pass` — it had simply never been updated after the fix. Ledger row 1. |
| G-01-6  | **resolved (code)** | plan 01-16, `gap_ids: [G-01-6]` | The enrolment CTA is hoisted out of the `registry.length === 0` branch: ternary :95-:141, CTA at :166. Reachability half only — the revoked-only-registry browser check is owed. Ledger rows 4, 24. |
| G-01-7  | **resolved (code)** | plan 01-14, `gap_ids: [G-01-7]` | `/venues/new` exists with an unconditional sidebar entry and a switcher item; both requested regression guards green. The owner's own three-currency browser journey is owed. Ledger rows 2, 22. |
| G-01-12 | **resolved (code)** | plan 01-15, `gap_ids: [G-01-12]` | A Google control renders on `/login` AND `/signup`; suppressed prompts now surface copy instead of silence. The live round trip is owed. Ledger rows 3, 23. |

3 gaps newly resolved at the code layer, 0 still failing. **Three human legs
remain owed** (ledger rows 22-24) — the owner self-serve journey, the Google live
round trip, and enrolment reachability on a revoked-only registry. Those legs are
why UAT tests 7 and 12 stay `result: issue`, why test 26 stays `[pending]`, and
why ACCT-01, ACCT-03 and ACCT-05 stay unticked. A gap resolved in code is not the
same fact as an outcome observed by a person, and this table keeps the two apart.

## Gap Reconciliation (2026-08-04, session 2 — automated browser pass)

Ran at resume, per the verify-work reconcile step, before any testing. Every
`status: failed` gap was checked against `*-PLAN.md` frontmatter `gap_ids` in the
phase dir, and each matching plan checked for a `*-SUMMARY.md`:

| Gap | Plan carrying it | SUMMARY exists | State |
|-----|-----------------|----------------|-------|
| G-01-1  | 01-17 | yes | resolved (already recorded) |
| G-01-6  | 01-16, 01-17 | yes | resolved (already recorded) — and its owed browser half is now WALKED and PASSES, see below |
| G-01-7  | 01-14, 01-17 | yes | resolved (already recorded) — browser leg now walked, test 7 moves to pass |
| G-01-12 | 01-15, 01-17 | yes | resolved (already recorded) — code half confirmed in the browser; live round trip blocked on config |

4 resolved, 0 still failing at entry. No gap was re-diagnosed and no new fix plan
was spawned for them, which is the reconcile step working as intended.

**Then the owed legs were walked, and opened four NEW gaps.** These are fresh
findings from this session, not re-openings of the four above:

| New gap | Severity | Found during | One line |
|---------|----------|--------------|----------|
| G-01-13 | **blocker** | test 7 leg | An EUR venue cannot be created — the last-language `disabled` guard strips `enabledLanguages` from the form submission |
| G-01-14 | major | test 7 leg | The venue switcher is stale immediately after creating a venue — `createVenue` redirects without revalidating the layout |
| ~~G-01-15~~ | — | test 7 leg | No sign-out anywhere in the owner product. **RETRACTED same day** — deferred by user decision, moved to `## Deferred Follow-Ups`. Not an open gap. |
| G-01-16 | major | test 12 leg | An unauthorised Google origin fails silently — no `googleUnavailable` copy renders |

**3 open gaps**, not 4. G-01-15 is listed above only so the record shows what was
found and what became of it.

G-01-13 and G-01-14 are the same blind spot the phase already named in
`## Systemic Pattern`, one layer down: the suite drives Server Actions with
constructed payloads and never observes what the rendered form actually
serialises, nor what the cached layout actually shows after a redirect.

## Parked Gaps (2026-08-04 — user decision)

Three gaps found by the 2026-08-04 browser pass were **parked**, not fixed and not
deferred. The user chose to carry them knowingly and move on to product-decision
work.

**ONE OF THE THREE IS STILL PARKED.** G-01-13 and G-01-14 were folded into Phase
01.1 by the user decision recorded as D-13 in that phase's `01.1-CONTEXT.md` —
both lived in the very components 01.1 re-skins, so fixing them separately and
then re-skinning would have been duplicate work. Plan 01.1-13 landed both on
2026-08-05, each with its own NEW regression test, so the suite GREW rather than
an existing test changing meaning. Both entries below now read `status:
resolved`; G-01-16 keeps `status: parked`.

**Parked is a third state, and the distinction is load-bearing:**

| State | Meaning | Spawns a fix plan? |
|-------|---------|--------------------|
| `failed` | Open defect, awaiting a fix | Yes |
| **`parked`** | **Real defect, consciously carried, still owed** | **Not now — but it is NOT closed** |
| Deferred Follow-Up | Out of scope; not a defect against this phase | Never (#1921) |

| Gap | Sev | What it costs while parked |
|-----|-----|----------------------------|
| G-01-16 | major | Only bites on a misconfigured Google origin. Deployed is configured correctly, so no live owner hits it; the next new origin will. |

**What parking the remaining one costs at the phase level, stated plainly so
nobody has to re-derive it later:**

* Phase 1 is **not complete** and must not be recorded as complete. Its UAT
  status is `partial`.
* **ACCT-01, ACCT-03 and ACCT-05 stay unticked.** ACCT-01 because the Google leg
  is still unverified against a build containing its fix — the leg G-01-16 sits
  inside. ACCT-03's currency blocker (G-01-13) is now cleared in code and pinned
  by a regression test, and its switcher defect (G-01-14) with it, but the
  owner-journey browser leg is still owed, so it is not ticked on that basis:
  this file's standing rule is that a gap resolved in code is not the same fact
  as an outcome observed by a person. ACCT-05's enrolment reachability DID close
  in the 2026-08-04 session (G-01-6).
* Test 26, the outcome roll-up, stays `[pending]`. It is unblocked on the
  CURRENCY leg — no blocker sits inside rollup item 1 any more — and still open
  on the sign-in leg, which needs a browser walk. Unblocked is not passed.
* None of this blocks Phase 01.1 or product-decision work, which is why parking
  is a reasonable call rather than a shortcut.

**Revisit trigger — the cheapest honest moment for the one still parked:**
G-01-16 whenever the Google leg is finally walked on a fixed build.

(The other two triggers fired as written and are kept here as the record of why:
G-01-14 "during Phase 01.1 (it re-renders these surfaces anyway)" — which is
exactly what happened; G-01-13 "**before any milestone that claims EU-general or
EUR-market readiness**, and ideally sooner, since the fix is small and the
failure is total for that currency" — taken at the sooner end.)

## Gaps

- gap_id: G-01-1
  truth: "A cold start from this repo's committed config boots the local stack, applies all 7 migrations, and serves the app"
  status: resolved
  resolved_by: "55f3b69 fix(01): an optional analytics container stops destroying the whole stack"
  resolved_at: 2026-07-31
  reason: "User reported: supabase start fails health checks — supabase_analytics_cena and supabase_vector_cena unhealthy; CLI then prunes every container, leaving no stack at all"
  severity: blocker
  test: 1
  root_cause: "supabase/config.toml:448 sets [analytics] enabled = true. The Logflare analytics container fails its health check; vector is its log shipper and is reported unhealthy in consequence. The CLI treats this as a failed start and prunes EVERY container, so the failure of an optional observability service destroys the whole stack."
  artifacts:
    - path: "supabase/config.toml"
      issue: "[analytics] enabled = true — an optional local-dev service whose health-check failure tears down the entire stack"
  missing:
    - "Set [analytics] enabled = false so a cold start from the committed config is deterministic"
  reproduced: "Confirmed by experiment 2026-07-30: with enabled=false, supabase start boots clean, db reset applies all 7 migrations (0001-0007), pnpm dev is ready in 453ms with no errors, /signup and /login return 200 and / returns 307."
  debug_session: "inline (verify-work cold-start smoke test)"

- gap_id: G-01-6
  truth: "An owner can enrol a tablet as a staff device whenever they need one — including a replacement after revoking the previous tablet, and a second tablet alongside an existing one (ACCT-05, D-06)"
  status: resolved
  resolved_by: >-
    Plan 01-16 — hoists the enrolment CTA OUT of the empty-state branch in
    app/(dashboard)/venues/[venueId]/staff/devices/page.tsx. The
    `registry.length === 0` ternary now opens at :95 and closes at :141; the
    <Link href="/enable-staff-mode"> renders at :166, after it, under a comment
    headed "OUTSIDE THE BRANCH ABOVE, DELIBERATELY". It remains a Link rather
    than a Server Action button, for the reason already documented in the file.
  resolved_at: 2026-08-04
  resolution_scope: >-
    FULLY CLOSED as of 2026-08-04. The reachability half was structural only; the
    owed browser confirmation has now been run and PASSES.
  browser_leg_walked: 2026-08-04
  browser_leg_evidence: |
    Playwright against the running app, signed in as the venue's owner, with the
    registry seeded to each shape in turn (fixtures deleted afterward):

      REVOKED-ONLY REGISTRY — the exact scenario the gap was opened for. The page
      listed one row, "UAT-TEMP-REVOKED-TABLET", carrying the outline "Revoked"
      badge and NO revoke control, and beneath the list rendered
      <link "Enable staff mode" -> /enable-staff-mode>. The owner who revoked
      their only tablet can reach enrolment again.

      ACTIVE + REVOKED REGISTRY — the second clause of the gap's `missing:` list
      ("a venue with one ACTIVE tablet still offers a route to enrolling a
      second"). Both rows listed, the ACTIVE row carrying its "Revoke device"
      button and the revoked row not, and the "Enable staff mode" link STILL
      rendered below them.

    This is what the structural guard could not establish: that the CTA survives
    into the real rendered page for a non-empty registry, in both shapes.
    ACCT-05's enrolment reachability can now be ticked on observation.
  reconciled_by: "01-RECONCILIATION.md rows 4 and 24"
  reason: "User reported: I revoked the access to my tablet and now I cannot enroll another tablet as staff device. On the Devices tab it only shows my revoked tablet and no other button exists."
  severity: major
  test: 6
  root_cause: >-
    app/(dashboard)/venues/[venueId]/staff/devices/page.tsx:88 binds the enrolment
    CTA to the EMPTY STATE ONLY. `registry.length === 0` renders the empty state
    carrying `<Link href="/enable-staff-mode">` (line 101); the non-empty branch
    renders the device list with no enrolment affordance at all.

    Line 22 of the same file documents that revoked rows DELIBERATELY STAY in the
    registry ("A registry that removed a tablet on revoke would answer 'was this
    device ever trusted here, and until when' with silence"). That decision is
    right, but it means a revoked row keeps `registry.length` at 1 forever — so
    the empty state never renders again and the only link to enrolment is gone
    permanently.

    devices/page.tsx:101 is the ONLY reference to /enable-staff-mode anywhere in
    app/, components/ or lib/. Once the registry is non-empty there is no
    navigable route to enrolment in the product; the page still exists and still
    works, but only by typing the URL.

    Scope is wider than the revoke case: with one tablet ACTIVE the registry is
    likewise non-empty, so enrolling a SECOND tablet is also unreachable — even
    though tests/rls/device-reenroll.test.ts:128 ("allows two different labels to
    be active at the same venue") proves the data layer supports it.

    This strands the owner in precisely the scenario the revoke control exists
    for: revoke the lost tablet, then be unable to enrol its replacement.
  artifacts:
    - path: "app/(dashboard)/venues/[venueId]/staff/devices/page.tsx"
      issue: "Enrolment CTA (line 101) is reachable only via the registry.length === 0 branch at line 88; the non-empty branch offers no way to enrol"
  missing:
    - "Surface the 'Enable staff mode' CTA in the non-empty registry branch too, not only in the empty state"
    - "Keep it a Link (not a Server Action button) for the reason already documented at devices/page.tsx:94-99 — enrolment swaps the session of whichever browser runs it"
    - "Regression test: a venue whose registry holds only a REVOKED row still offers a route to enrolment"
    - "Regression test: a venue with one ACTIVE tablet still offers a route to enrolling a second"
  ruled_out:
    - "Database: venue_devices_one_active_per_label_idx is PARTIAL on `revoked_at is null`, and revokeDeviceById stamps revoked_at — the label is free for re-enrolment (verified against the live row for 'Terasa')"
    - "enrollDevice: lib/devices.ts:105 filters `.is('revoked_at', null)` when superseding, so a revoked row is correctly ignored"
    - "Owner authority: the owner's venue_members row for the venue survives the revoke (verified in the live DB)"
    - "Enrol page gate: app/(tablet)/enable-staff-mode/page.tsx renders the form for any caller holding an owner membership"
  debug_session: "inline (verify-work test 6)"

- gap_id: G-01-7
  truth: "One owner account can hold multiple venues — the owner can create a second venue from the product (ROADMAP Phase 1 Success Criterion 5, ACCT-03)"
  status: resolved
  resolved_by: >-
    Plan 01-14 — adds app/(dashboard)/venues/new/page.tsx as a route to venue
    creation that does not depend on owning zero venues, plus lib/venue-routes.ts,
    an unconditional sidebar create entry and a trailing "Create venue" item on
    the switcher. Both regression guards the `missing:` list below asked for
    exist and are green: tests/venues/second-venue-route.test.ts (an owner who
    already owns a venue can still reach creation) and
    tests/lib/unconditional-cta-coverage.test.ts (the affordance sits outside
    every conditional).
  resolved_at: 2026-08-04
  resolution_scope: >-
    CODE HALF. The owner's own browser walk of the three-currency journey is
    still owed (01-RECONCILIATION.md row 22, human-owed), which is why UAT test 7
    stays `result: issue` and ACCT-03 stays unticked.
  reconciled_by: "01-RECONCILIATION.md rows 2 and 22"
  reason: "User reported: Where do I create another venue? I cannot see the button"
  severity: major
  test: 7
  root_cause: >-
    `VenueForm` is mounted in exactly two places, and neither is reachable once
    the owner has a venue:

      1. app/(auth)/signup/page.tsx:62 — step 2 of the signup flow, for the
         owner's FIRST venue only.
      2. app/(dashboard)/venues/page.tsx:48 — reachable only on the zero-venue
         path. Line 24-28 reads the owner's venues with `.limit(1)`; line 39-43
         redirects to `/venues/{id}` whenever one exists. The form below the
         redirect therefore renders ONLY for an owner with no venues.

    app/(dashboard)/components/venue-switcher-menu.tsx renders the venue list and
    nothing else — no "Create venue" item, no separator, no trailing action.

    So an owner who has completed signup has no route in the product to create a
    second venue. The capability exists at every other layer: create_venue accepts
    it, the switcher renders it, and 01-01 D4 ("One owner holds multiple venues")
    plus 01-02 D15 ("The multi-venue switcher lists exactly the owner's venues")
    both auto-passed — because the suite creates venues directly through the RPC
    and never walks the owner's UI.

    This defeats ROADMAP Phase 1 Success Criterion 5 ("One owner account can hold
    multiple venues") as a user-reachable property.
  artifacts:
    - path: "app/(dashboard)/venues/page.tsx"
      issue: "Line 39-43 redirects away whenever a venue exists, so the VenueForm at line 48 renders only for a zero-venue owner"
    - path: "app/(dashboard)/components/venue-switcher-menu.tsx"
      issue: "Lists venues only — carries no 'Create venue' action, which is the natural home for one"
  missing:
    - "A route to venue creation that does not depend on owning zero venues — e.g. /venues/new, linked from a 'Create venue' item at the foot of the venue switcher"
    - "Regression test: an owner who already owns a venue can still reach venue creation"
    - "Regression test: the switcher exposes a create affordance alongside the venue list"
  related: "Same defect class as G-01-6 — see the systemic note below"
  debug_session: "inline (verify-work test 7)"

- gap_id: G-01-12
  truth: "An owner who has configured Google can actually sign in with Google — there is a visible, reliable control for it (ACCT-01, D-01)"
  status: resolved
  resolved_by: >-
    Plan 01-15 — an explicit Google control is now rendered on BOTH /login and
    /signup rather than a consent checkbox on /login alone, and a suppressed
    prompt is surfaced through COPY.errors.googleUnavailable instead of silence.
    All four `missing:` items below are addressed, and the three properties the
    root_cause asked to preserve (hashed-nonce binding, use_fedcm_for_prompt,
    consent-before-session ordering) are preserved.
  resolved_at: 2026-08-04
  resolution_scope: >-
    CODE HALF. The live Google round trip and the suppressed-prompt case are
    owed (01-RECONCILIATION.md row 23, human-owed), which is why UAT test 12
    stays `result: issue` and ACCT-01 stays unticked. The separate ensureAccount
    consent residual is NOT closed by this plan (row 18).
  reconciled_by: "01-RECONCILIATION.md rows 3, 18 and 23"
  reason: "User reported: I've setted it up, but there's no UI to log in with google"
  severity: major
  test: 12
  root_cause: >-
    Google sign-in is offered ONLY as an automatic One Tap prompt, with no button
    and no fallback.

    app/(auth)/components/GoogleOneTap.tsx:153-187 renders exactly one visible
    control: a CONSENT CHECKBOX whose label ends "...then continue with google".
    There is no button. Line 136 gates initialisation on that tick
    (`if (!scriptReady || !acceptedTerms) return;`), and ticking it calls
    `window.google.accounts.id.prompt()` — Google's floating One Tap prompt.

    Three consequences, all user-visible:

      1. NO RECOGNISABLE CONTROL. A checkbox is not what anyone looks for when
         they want to sign in with Google. `COPY.cta.continueWithGoogle` exists in
         the copy deck but is only interpolated into that checkbox label
         (GoogleOneTap.tsx:177) — it is never rendered as a CTA anywhere.
      2. SILENT FAILURE. If Google suppresses the prompt — FedCM restrictions,
         browser third-party settings, the too-many-dismissals cooldown, or an
         origin not registered as an authorised JavaScript origin in the Google
         console — ticking the box produces no prompt, no error and no feedback.
         The component only surfaces `error` for a FAILED sign-in
         (GoogleOneTap.tsx:155-159), never for a prompt that never appeared.
      3. ABSENT FROM SIGNUP. GoogleOneTap is mounted only at
         app/(auth)/login/page.tsx:29. /signup offers no Google path at all, even
         though that is where a new owner would reach for it and the component
         already handles first-time consent via `ensureAccount`.

    The implementation MATCHES its stated deliverable (01-02 D14: "Google One Tap
    is wired to Supabase Auth with a hashed nonce and FedCM"). What UAT surfaces
    is that the deliverable chose One-Tap-only, and One Tap alone is not a
    dependable way to offer Google sign-in. Nonce handling, FedCM and the consent
    ordering are all correct and should be preserved by any fix.
  artifacts:
    - path: "app/(auth)/components/GoogleOneTap.tsx"
      issue: "Only visible control is a consent checkbox (line 161-179); no button, and no feedback when the One Tap prompt fails to appear"
    - path: "app/(auth)/signup/page.tsx"
      issue: "No Google option at all — GoogleOneTap is mounted only on /login"
  missing:
    - "An explicit 'Continue with Google' button using the COPY.cta.continueWithGoogle string that already exists, as the primary control — keeping One Tap as an enhancement on top"
    - "Feedback when the prompt does not display, instead of silence (One Tap exposes a dismissed/skipped-moment callback)"
    - "Offer Google on /signup too, not only /login"
    - "Preserve the hashed-nonce binding, use_fedcm_for_prompt, and the consent-before-session ordering — all three are correct today"
  user_config_to_confirm:
    - "http://localhost:3000 is registered as an Authorised JavaScript origin on the OAuth client in the Google console — if it is not, the prompt cannot render regardless of the code"
  debug_session: "inline (verify-work test 12)"

- gap_id: G-01-13
  truth: "An owner can create a venue in any currency the product offers — RON, HUF or EUR (ACCT-03; ROADMAP Phase 1 SC1; rollup item 1's 'venues in RON/HUF/EUR')"
  status: resolved
  resolved_by: >-
    Phase 01.1 plan 01.1-13 (fold-in decision D-13) — 25c700b. A sibling hidden
    control carries the field name and code for exactly the disabled-and-checked
    case, so the value reaches FormData while the checkbox stays disabled and the
    WR-08 visible refusal survives; its guard is the same predicate as that
    disabled flag, so an enabled control never emits a duplicate. Pinned by a NEW
    test, tests/venues/venue-eur-submission.test.tsx, observed RED before the fix
    on exactly the two predicted assertions.
    tests/venues/venue-form-languages.test.tsx is byte-identical.
  resolved_at: 2026-08-05
  parked_at: 2026-08-04
  parked_by: "user decision — carry as a known gap and move on to product-decision work"
  parked_cost: >-
    (Historical — what this cost while it was parked, 2026-08-04 to 2026-08-05.)

    THIS ONE DEFEATS A ROADMAP SUCCESS CRITERION VERBATIM. Phase 1 SC1 reads "A
    new owner can sign up, log in, and create a venue with a name, currency
    (RON/HUF/EUR), and default language — with no manual help." A EUR venue
    cannot be created at all, so SC1 is false as written for a third of the
    currencies the product offers, and ACCT-03 cannot be ticked.

    (Corrected while parking: this entry previously cited SC5. SC5 is the
    multi-venue criterion behind G-01-7. SC1 is the one naming the currencies.)

    Cheap to fix and cheap to leave, for now — no diner-facing surface exists
    yet and RO is the first market, so RON and HUF both work. It becomes
    expensive at the moment a EUR-market venue tries to onboard, and it should
    not survive into any milestone that claims EU-general readiness.
  reason: "Found by automated browser walk 2026-08-04: selecting EUR and submitting is rejected every time with two errors that contradict what is on screen. No EUR venue can be created."
  severity: blocker
  test: 7
  found_during: "the owed browser leg for test 7"
  root_cause: >-
    THE LAST-LANGUAGE GUARD USES `disabled`, AND DISABLED CONTROLS ARE OMITTED
    FROM FormData. `components/venue-form.tsx:167`:

      disabled={enabledLanguages.length === 1 && enabledLanguages[0] === code}

    Whenever exactly ONE language is enabled, its checkbox is disabled, the
    browser therefore excludes it from the submission, and `enabledLanguages`
    arrives at the Server Action EMPTY. `createVenueSchema` then rejects with
    "Enable at least one language.", and — because the default language is not
    a member of an empty set — also "The default language must be one of the
    languages you enabled."

    EUR HITS THIS BY CONSTRUCTION. `lib/validation/venue.ts:59` sets
    CURRENCY_DEFAULTS.EUR = { countryCode: "", timezone: "", defaultLanguage: "en" },
    so `handleCurrencyChange` (venue-form.tsx:64) computes
    `Array.from(new Set(["en", "en"]))` = `["en"]` — a single language, disabled
    the instant it is derived. Selecting EUR therefore makes the form
    unsubmittable before the owner types anything.

    NOT EUR-SPECIFIC. Any route to one language reproduces it: on a default RON
    form, unchecking "English" leaves `["ro"]`, `ro` becomes disabled, and
    FormData carries no `enabledLanguages` at all.

    THE IRONY IS DOCUMENTED IN THE FILE ITSELF. The WR-08 comment at
    venue-form.tsx:77-89 explains the guard exists so the form cannot "post, and
    `createVenueSchema` rejects it after a round trip" — which is precisely what
    the guard's chosen mechanism now causes.
  reproduced: |
    Measured directly in the page, not inferred. With EUR selected:
      enabledLanguages inputs -> [ro:unchecked, hu:unchecked, en:CHECKED+DISABLED]
      new FormData(form).getAll('enabledLanguages') -> []
    Submitting stayed on /venues/new with both errors; the DB confirmed no EUR
    row was written. The RON-with-English-unchecked path gave the identical
    empty FormData.
  user_visible_symptom: >-
    After the failed submit the checkboxes re-render as ro+en CHECKED while the
    page still says "Enable at least one language." The owner is told to do
    something that already appears done, with no way to act on it.
  artifacts:
    - path: "components/venue-form.tsx"
      issue: "Line 167 disables the last enabled language checkbox; a disabled checkbox is not submitted, so enabledLanguages posts empty"
    - path: "lib/validation/venue.ts"
      issue: "Line 59 CURRENCY_DEFAULTS.EUR.defaultLanguage='en' yields a single-language set, putting every EUR venue into the broken state immediately"
  missing:
    - "Keep the last language non-removable WITHOUT `disabled` — e.g. readOnly + onChange refusal, or a parallel hidden input carrying the value so it still submits"
    - "Regression test: a single-language venue submits enabledLanguages with exactly that language (assert on FormData or the action's received payload, not on component state)"
    - "Regression test: selecting EUR and submitting creates a venue"
    - "Clear the stale field errors when the language set changes, so the form cannot show 'Enable at least one language' beside checked boxes"
  why_the_suite_missed_it: >-
    Same blind spot as G-01-6 and G-01-7. tests/actions/create-venue-action.test.ts
    drives the Server Action with a constructed payload, so it never observes what
    the BROWSER would actually serialise from the rendered form. The defect lives
    exactly in that gap — between rendered DOM and FormData.
  debug_session: "inline (verify-work test 7 browser leg, 2026-08-04)"

- gap_id: G-01-14
  truth: "After creating a venue, the venue switcher reflects reality — it appears once a second venue exists, and names the venue the owner is actually on"
  status: resolved
  resolved_by: >-
    Phase 01.1 plan 01.1-13 (fold-in decision D-13) — b55f0e5.
    `revalidatePath("/", "layout")` on the success path only, immediately before
    the redirect. Both arguments pinned: the (dashboard) group is invisible in
    the URL, so no path IS that layout, and the path alone would be a no-op here.
    Pinned by a NEW test, tests/actions/create-venue-revalidation.test.ts, which
    asserts the two calls' ORDER via invocationCallOrder rather than their count
    — a purge written after the throwing redirect runs never — plus three failure
    branches that must purge nothing.
  resolved_at: 2026-08-05
  parked_at: 2026-08-04
  parked_by: "user decision — carry as a known gap and move on to product-decision work"
  parked_cost: >-
    (Historical — what this cost while it was parked, 2026-08-04 to 2026-08-05.)

    Cosmetic-adjacent but misleading rather than merely ugly: the switcher can
    name a venue the owner is not on. Self-corrects on any reload and does not
    affect data, isolation or writes, so nothing can be silently corrupted by
    it. Worth folding into Phase 01.1, which re-renders these exact surfaces —
    fixing it there costs a one-line `revalidatePath` in a file that is being
    touched anyway.
  reason: "Found by automated browser walk 2026-08-04: the sidebar is not revalidated on venue creation, so the switcher is a step behind until a manual page reload."
  severity: major
  test: 7
  found_during: "the owed browser leg for test 7"
  root_cause: >-
    `actions/venues.ts` imports `redirect` (line 3) and calls it at line 98, but
    never calls `revalidatePath` — the import is absent from the file entirely.
    `VenueSwitcher` is rendered by `app/(dashboard)/layout.tsx:142`, a layout
    segment Next.js serves from the client router cache across the post-action
    redirect. The switcher therefore renders from the venue list as it was
    BEFORE the creation that just happened.
  reproduced: |
    Two distinct symptoms, both observed, both cleared by a hard reload:

      Creating the SECOND venue -> no switcher at all. `VenueSwitcher` returns
      null below two venues (VenueSwitcher.tsx:41) and the cached layout still
      believes there is one. The owner lands on their new venue with no way
      back to the first except the browser Back button.

      Creating the THIRD venue -> switcher shows the WRONG venue. Measured on
      the new EUR venue's page:
        h1              = "UAT Temp EUR"
        switcher button = "UAT Temp RON | RON"

    Switching between EXISTING venues updates correctly — the staleness is
    specific to creation, which is the one moment the owner is most likely to
    look at the switcher.
  artifacts:
    - path: "actions/venues.ts"
      issue: "Line 98 redirects after a successful insert with no revalidatePath, leaving the cached dashboard layout (which owns the switcher) stale"
  missing:
    - "revalidatePath('/', 'layout') — or the narrowest equivalent covering the dashboard layout segment — before the redirect in createVenue"
    - "Regression test: after creating a second venue the switcher is present; after creating a third it names the venue just created"
  debug_session: "inline (verify-work test 7 browser leg, 2026-08-04)"

- gap_id: G-01-16
  truth: "When Google sign-in cannot work, the owner is told — the failure is never silent (G-01-12's second half)"
  status: parked
  parked_at: 2026-08-04
  parked_by: "user decision — carry as a known gap and move on to product-decision work"
  parked_cost: >-
    Only bites when Google is misconfigured, and the deployed environment is
    configured correctly (confirmed live — see test 12 `deployed_report`), so no
    real owner is hitting it today. The cost is paid by whoever next sets up a
    new origin — a preview URL, a custom domain, another developer's localhost —
    and gets a Google button that does nothing with no explanation. Cheapest
    moment to fix it is alongside whatever finally verifies the Google leg on a
    build that HAS the fix, since that work is already in the file.
  reason: "Found by automated browser walk 2026-08-04: with an unauthorised JavaScript origin, GIS fails and Cena shows no message at all."
  severity: major
  test: 12
  found_during: "the owed Google leg for test 12"
  root_cause: >-
    `COPY.errors.googleUnavailable` is reachable from exactly two places, and
    neither covers this failure:

      GoogleOneTap.tsx:316-318 — fires only when `startOneTap()` REJECTS.
      GoogleOneTap.tsx:425     — the fallback button's `onError`.

    An unauthorised origin rejects neither. `initialize()` and `renderButton()`
    both succeed locally; the failure happens asynchronously INSIDE Google's
    iframe (HTTP 403) and surfaces only as GSI_LOGGER console output plus a
    FedCM NetworkError that GIS swallows. Nothing throws on Cena's side, so no
    state update runs and no copy renders.

    The One-Tap prompt-moment listener at :292-295 only records
    `isDismissedMoment`, which this is not.
  reproduced: |
    Ticked consent on /login with a real client id configured, then measured
    the page after the failure had landed:
      document.body.innerText.includes("Google sign-in isn't available") -> false
      [role=alert] elements                                              -> []
    while the console carried:
      [GSI_LOGGER]: The given origin is not allowed for the given client ID.
      403 @ accounts.google.com/gsi/button
      [GSI_LOGGER]: FedCM get() rejects with NetworkError
  distinction: >-
    The underlying misconfiguration is the USER'S to fix (see test 12 — add
    http://localhost:3000 as an Authorised JavaScript origin). What is Cena's to
    fix is the response to it. G-01-12 was opened because a failing Google
    surface was "indistinguishable from one nobody pressed"; for the likeliest
    real-world misconfiguration it still is.
  artifacts:
    - path: "app/(auth)/components/GoogleOneTap.tsx"
      issue: "googleUnavailable copy is bound to a promise rejection and a button onError; neither fires when GIS fails asynchronously inside its own iframe"
  missing:
    - "Detect the unauthorised-origin / button-load failure and surface COPY.errors.googleUnavailable — GIS exposes it via the intermediate iframe status; a timeout fallback after renderButton is the simple version"
    - "Regression test: a GIS failure that does not reject startOneTap still produces visible copy"
  debug_session: "inline (verify-work test 12 browser leg, 2026-08-04)"

## Deferred Follow-Ups

<!-- Future work, NOT current-phase blockers. These do not spawn gap plans (#1921). -->

- test: 7
  idea: "Owner sign-out — deferred (user decision, 2026-08-04)"
  deferred_at: 2026-08-04
  was_filed_as: "G-01-15 (major), opened by the 2026-08-04 automated browser pass and RETRACTED to here on the user's decision the same day. It never had a fix plan and must not spawn one."
  finding: >-
    There is no sign-out on the owner surface at any layer. The dashboard renders
    only the venue switcher, Overview, Staff, Devices and "Create venue"
    ("Settings" is inert text); no /logout or /signout route exists under app/;
    and `supabase.auth.signOut()` appears ONLY in actions/devices.ts for tablet
    lifecycle. A session can currently be ended only by clearing cookies or
    waiting for expiry.
  context: >-
    Deferring is defensible for v1 in a way the two other findings from this pass
    are not. An owner sets their venue up at a laptop they control, and the phase
    ships no account or profile surface for a sign-out control to live on — so
    this is missing scope rather than a broken flow, the same call already made
    for the owner dashboard's mobile layout above.

    ONE THING TO CARRY FORWARD, because it is a live inconsistency rather than
    absent scope: lib/copy.ts:105 tells the owner "Sign out and sign in again to
    complete it." That is the recovery path for an unrecorded Terms consent, so
    the one owner who most needs to sign out is told to do something the product
    does not offer. Whoever picks this up should either ship sign-out or reword
    that string; leaving both as they are is the only outcome worth avoiding.
  affects_rollup: >-
    Rollup item 1 (test 26) names "sign out, log back in" as part of the owner
    self-serve journey. With sign-out deferred, that clause cannot be walked as
    written. The 2026-08-04 pass covered the "log back in" half by clearing the
    session cookies directly and re-authenticating, which exercised login and the
    switcher's persistence across a new session — the part of the clause that
    carries product meaning. The roll-up should be read against that, not held
    open waiting for a control that is now deliberately out of scope.
  suggested_route: "/gsd-capture against a later phase that introduces owner account/profile UI"

- test: 11
  idea: "It's not really mobile friendly, we should support that but it's a pass"
  deferred_at: 2026-07-31
  context: >-
    The owner dashboard is desktop-first. Worth separating three surfaces before
    scoping this, because they have different obligations:

      * DINER menu (Phase 2) — mobile is the whole product. PROJECT.md makes it a
        hard constraint: the diner scans a QR at the table and browses on a phone
        on poor mobile data. This one cannot be deferred past Phase 2.
      * TABLET surfaces (this phase — PIN pad, name grid, unlock) — touch-sized
        already per UI-SPEC E9/E10; test 16 checks real touch targets.
      * OWNER dashboard (this phase) — the surface being reported here. An owner
        setting up their venue is plausibly at a laptop, so desktop-first is a
        defensible v1 call rather than an oversight.

    Suggested route: raise as a scoped item against the Phase 4 theming work
    (`/gsd-capture`), or fold into Phase 2 where mobile layout work is already
    unavoidable for the diner surface.

## Systemic Pattern

G-01-6 and G-01-7 are the same defect, found twice: **a create/enrol CTA bound to
an empty-state branch, so it disappears permanently once that state is no longer
empty.**

- G-01-6 — enrol CTA lives in `registry.length === 0`; a revoked row keeps the
  registry non-empty forever.
- G-01-7 — venue form lives on the zero-venue path; owning one venue redirects
  past it forever.

Both capabilities are proven at the data layer by passing tests (01-01 D4, 01-02
D15, device-reenroll.test.ts:128 "allows two different labels to be active at the
same venue") and are unreachable through the UI. The suite creates its fixtures
through RPCs and admin clients, so it exercises the SECOND-time path that the
product never offers. That is the blind spot: **first-run works, second-run has
no door.** Worth auditing every remaining empty-state CTA in the phase for the
same shape before closing these two.

**Audit done (2026-07-30).** Every `length === 0` branch in `app/` was checked.
Exactly two instances of the defect exist — `devices/page.tsx:88` and
`venues/page.tsx:39`. There is no third.

**`staff/page.tsx` is the in-repo model for the fix.** Its `roster.length === 0`
ternary at line 91 governs only the empty MESSAGE vs the roster list;
`<StaffProvisionForm>` sits at line 147 OUTSIDE the ternary and always renders.
That is why provisioning a second staff member works and why test 4 passed. Both
fixes should adopt this shape: the list-or-empty-message stays conditional, the
action does not.

## Copywriting Contract — additions from the gap round

Gap-closure round 3 added **six** user-visible strings to `lib/copy.ts`. Checked
2026-08-04: `grep` for all six key names in `01-UI-SPEC.md` `## Copywriting
Contract` returns **0**. None of them has a contract row yet.

The house rule is that a string with no contract row is a SIGNAL — that the design
has no screen for that state — and not licence to invent one inline. `lib/copy.ts`
already says so at :80-84 and names this plan as the place the signal gets
recorded. So it is written down here rather than absorbed. This section is the
record; `01-UI-SPEC.md` is a checker-approved artifact that plan 01-17 does not
own and has not edited.

| Key | Exact string | Added by | Contract row |
|-----|--------------|----------|--------------|
| `COPY.venues.createFirstHeading` | "Add your first venue" | 01-14 | none — pre-existing wording, previously a hardcoded default prop in `components/venue-form.tsx`; moved into `lib/copy.ts`, so it is newly *visible* to the contract rather than newly written |
| `COPY.venues.createFirstBody` | "You can add more venues later, and change any of this in settings." | 01-14 | none — same provenance as above |
| `COPY.venues.createAnotherHeading` | "Add another venue" | 01-14 | none — **genuinely new**, for a screen the contract has never described |
| `COPY.venues.createAnotherBody` | "Each venue keeps its own menu, staff and devices. You can change any of this in settings." | 01-14 | none — **genuinely new** |
| `COPY.consent.googleGate` | "Accept the Terms of Service and Privacy Policy to continue with Google." | 01-15 | none |
| `COPY.errors.googleUnavailable` | "Google sign-in isn't available right now. Use your email and password, or try again." | 01-15 | none — this is the string that ends G-01-12's second half, the silent failure where a suppressed One Tap prompt produced no prompt, no error and no feedback |

**What the contract does have:** a row for the venue-creation CTA ("Create
venue"). What it has never had is a row for the SCREEN hosting it — neither the
first-venue step nor the add-another one. That absence is the finding, and it is
why the four `COPY.venues` keys are listed here even though two of them are old
wording: the wording was always user-visible, it was simply never diffable against
the contract.

**Owed:** six rows in `01-UI-SPEC.md` `## Copywriting Contract`, added by whoever
next owns that artifact. Until then `lib/copy.ts` and the contract are knowingly
divergent rather than silently so — which is the whole point of writing it down.

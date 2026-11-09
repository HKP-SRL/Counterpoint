---
phase: 01-multi-tenant-foundation
verified: 2026-07-29T12:15:00Z
status: gaps_found
stale_note: >-
  RECONCILED 2026-08-04 by plan 01-17, against 01-RECONCILIATION.md. Every entry
  in the `gaps:` block below is now CLOSED at the code layer and every entry in
  `regressions:` is closed — each re-derived from source rather than accepted
  from a commit message (ledger rows 5-8). `status` nevertheless STAYS
  `gaps_found`, deliberately: the rule is that it may move only when no
  `human-owed` ledger row blocks it, and three do. Owed: the SC1 owner
  self-serve browser journey (row 22), the Google live round trip (row 23), and
  enrolment reachability on a revoked-only registry (row 24). Truth 1 remains
  behaviour-unverified until the first of those is walked. Moving this to
  `verified` on the strength of a green suite alone is threat T-01-17-01.
score: 10/11 must-haves verified
score_basis: >-
  Re-derived by counting the eleven truths against current evidence, NOT adjusted
  from 7/11. Truths 2-8 unchanged VERIFIED. Truth 9 closed by f29ece0 + 8487bfd
  (the three [venueId] pages route through resolveVenueRow, which throws at
  lib/venue-page-read.ts:86; app/(dashboard)/error.tsx exists). Truth 10 closed —
  both coverage guards are AST-based now. Truth 11 closed — all six named Server
  Actions are executed by tests. Truth 1 (SC1) is the single remaining
  shortfall: its recorded reason ("no test invokes signUpOwner, signInOwner or
  createVenue") is now FALSE, but the truth asserts a browser journey that is
  still unrun, so it stays behaviour-unverified rather than being upgraded.
behavior_unverified: 1
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/8
  gaps_closed:
    - "BLOCKER 1 — the recovery grant was replayable; the path-less delete expired a different cookie (ACCT-01, D-07)"
    - "BLOCKER 2 — exitOwnerUnlock conflated a failed venue_devices read with a revoked device and de-enrolled the tablet (ACCT-05)"
    - "WR-02 — the venue-detail page was ungated; the venue's own staff device principal rendered the owner dashboard"
    - "WR-03 — a failed venues read rendered as 'add your first venue', inviting an irreversible duplicate"
    - "WR-04 — .env.example understated the STAFF_SESSION_SECRET rotation blast radius"
    - "WR-10 (partial) — the two Server Actions that carried both blockers are now driven for real by the suite"
    - "ROUND 3 (2026-08-04, plan 01-17) — truth 9: the read-fault collapse on all three /venues/[venueId] pages, closed by f29ece0; the pages now read through `resolveVenueRow` (lib/venue-page-read.ts:86 throws on a bound error) instead of binding only `data`"
    - "ROUND 3 — truth 9's compensating half: `app/(dashboard)/error.tsx` now exists (8487bfd), so the throw-based design has the boundary three source comments and 01-13-SUMMARY.md:324 promised"
    - "ROUND 3 — truth 10: both structural coverage guards are now AST-based (`import ts from \"typescript\"` in tests/lib/venue-page-gate-coverage.test.ts and tests/lib/device-cookie-outcome-coverage.test.ts), so a deleted call site can no longer be satisfied by an import, a comment or prose"
    - "ROUND 3 — truth 11 / WR-10 residual: all six named Server Actions are now executed. signUpOwner, signInOwner, requestPasswordReset and ensureAccount via tests/actions/auth-actions.test.ts:63; createVenue via create-venue-action.test.ts:61 and second-venue-route.test.ts:62; enableStaffMode, exitOwnerUnlock, revokeDevice and unenrollThisBrowser via device-lifecycle-actions.test.ts:130; staff actions via staff-actions.test.ts:58"
  gaps_remaining:
    - "None at the code layer. The WR-10 residual that stood here — signUpOwner, signInOwner, createVenue, enableStaffMode, revokeDevice and unenrollThisBrowser executed by nothing — is closed; see the ROUND 3 entry in gaps_closed. What remains is not code but observation: three human legs (01-RECONCILIATION.md rows 22-24) and, resting on the first of them, truth 1 / SC1."
  regressions_closed:
    - "CLOSED by f29ece0 — 'The venues read on all three /venues/[venueId] pages still binds only `data`, so a database fault is reported to the legitimate owner as a 404 — on the page 01-13 edited, four lines above a comment forbidding exactly that, and it runs BEFORE the honest gate'. Re-derived, not accepted: each page carries three `resolveVenueRow` references and the helper throws on a bound error."
    - "CLOSED by 8487bfd — 'The \"fail loudly to the route error boundary\" design 01-13 shipped has no error boundary to fail to — no error.tsx or global-error.tsx exists anywhere in the repository'. `app/(dashboard)/error.tsx` now exists."
    - "CLOSED — 'Both new structural coverage guards are raw substring checks that the artifact's own import and comment satisfy, so deleting the thing each was written to protect leaves the guard green'. Both guards now parse the AST; both are green in the 46-file / 442-test run."
  regressions: []
  regressions_note: >-
    The three findings above are retained verbatim in `regressions_closed` rather
    than deleted. A regression that vanishes without a record reads as one that
    was never found, and each of these three was independently reproduced by the
    verifier before it was fixed.
gaps:
  - truth: "A read failure is never presented to the operator as an authoritative absent result, and the failure it is converted into reaches a route error boundary (01-13 truth 4 and its prohibition; ACCT-02, ACCT-07, ACCT-08)"
    status: resolved
    resolved_by: "f29ece0 (read fault stops being an absent venue) + 8487bfd (the designed throws get a boundary to fail to)"
    resolved_at: 2026-08-04
    resolution_evidence: >-
      Re-derived from source by plan 01-17, not accepted from the commit
      messages. All three /venues/[venueId] pages now read through
      `resolveVenueRow` (3 references each); `lib/venue-page-read.ts:86` is
      `if (result.error) { throw new Error(` — the error channel is bound and a
      fault throws rather than resolving to notFound(). `app/(dashboard)/error.tsx`
      exists, so the throw has a boundary. 01-RECONCILIATION.md rows 5 and 6.
    reason_retained: >-
      The full original finding is preserved below rather than deleted. It is the
      analysis that made the fix possible, and a resolved gap that has lost its
      analysis cannot be audited.
    reason: >-
      Two halves, one shipped and one not, plus a third that was claimed and does
      not exist.

      SHIPPED: `lib/venue-landing.ts:60-65` throws on a non-null error and
      `tests/lib/venue-landing.test.ts` drives both directions. The destructive
      create-first invitation is genuinely closed. That half holds.

      NOT SHIPPED: the identical collapse is still live on all three pages of the
      route family that plan 01-13 edited.
      `app/(dashboard)/venues/[venueId]/page.tsx:28` reads
      `const { data: venue } = await supabase.from("venues")...maybeSingle()` and
      `:34` answers `notFound()`. `maybeSingle()` resolves `data: null` ALONGSIDE
      the error, so a statement timeout, a JWT-expiry fault or any PostgREST
      failure tells the legitimate owner their own venue does not exist. The same
      shape is at `staff/page.tsx:34-42` and `staff/devices/page.tsx:33-41` —
      the two pages `resolveVenueOwner` was extracted for. Independently
      reproduced from source, not inherited from the review.

      Worse than a duplicated omission: this read runs FIRST, so it SHADOWS the
      honest branch. All three files carry the comment "DELIBERATELY NOT WRAPPED
      IN try/catch: `resolveVenueOwner` throws on a read fault by design, and that
      throw must reach the Next error boundary as a 500. Reporting a broken read
      as a 404 is precisely the lie CR-01 told the owner for the whole of this
      phase." On the venue-detail page that comment sits at line 54-57, twenty-six
      lines below the read that does exactly what it forbids. Any fault broad
      enough to break the `venue_members` read breaks the `venues` read too, and
      the `venues` read is first — so for the common fault the throw the phase
      now relies on is unreachable.

      CLAIMED AND ABSENT: `find . -name "error.tsx" -o -name "global-error.tsx"`
      returns nothing anywhere in the repository. `01-13-SUMMARY.md:324` states
      "the venues read failure surfaces through the existing route error boundary,
      which 01-UI-SPEC.md already designates for page-level query failures
      (E4/E6)". There is no such boundary. `lib/venue-landing.ts:23-25` rests the
      whole throw-rather-than-fall-back argument on "the fault reaches the route
      error boundary, where the owner is told the read failed and reloads — which
      costs them nothing". What the owner actually gets in production is Next's
      unstyled "Application error: a server-side exception has occurred" with a
      digest, no explanation and no reload affordance. The destructive half of
      WR-03 is closed; the compensating half was never built, so a five-second
      blip now hard-fails the owner's landing route.
    artifacts:
      - path: "app/(dashboard)/venues/[venueId]/page.tsx"
        issue: "Line 28 — `const { data: venue }` with no error binding; line 34 answers a read fault with notFound(), before the honest gate at line 58 is ever reached"
      - path: "app/(dashboard)/venues/[venueId]/staff/page.tsx"
        issue: "Lines 34-42 — same collapse, same shadowing of the resolveVenueOwner throw"
      - path: "app/(dashboard)/venues/[venueId]/staff/devices/page.tsx"
        issue: "Lines 33-41 — same collapse; this is the page holding the D-08 revoke control"
      - path: "app/(dashboard)/"
        issue: "No error.tsx. The throws in lib/venue-landing.ts and lib/venue-authority.ts land on Next's default unstyled error screen, not on the boundary three source comments and the SUMMARY promise"
      - path: "actions/devices.ts"
        issue: "Lines 248-257 — revokeDevice's venue_devices read still discards its error; the D-08 lost-tablet valve answers a transient fault with COPY.errors.generic, indistinguishable from 'not your device'"
    missing:
      - "Bind the error channel on the venues read in all three /venues/[venueId] pages and throw, mirroring resolveVenueOwner and resolveVenuesLanding — preferably as a Next-free lib/ helper so the correction carries a regression guard, since an inline `if (error) throw` in a Server Component is the shape of evidence this phase has now shipped a defect behind three times"
      - "Add app/(dashboard)/error.tsx (and a COPY.errors.readFailed entry, whose absence is itself the signal that the Copywriting Contract has no screen for this) before any of the throw-based design is relied on"
      - "Bind and at minimum log the error on revokeDevice's read, so the one remaining error-discarding read in the actions layer stops making the phase's stated rule a convention with an exception"
  - truth: "The new structural coverage guards turn the suite red when the thing they guard is removed — a page in the [venueId] family without the gate, or an outcome in the union with no call site (01-12 truth 5, 01-13 truth 2)"
    status: resolved
    resolved_by: "both guards rewritten onto the AST"
    resolved_at: 2026-08-04
    resolution_evidence: >-
      `grep -c 'import ts from "typescript"'` returns 1 for BOTH
      tests/lib/venue-page-gate-coverage.test.ts and
      tests/lib/device-cookie-outcome-coverage.test.ts — the substring checks this
      finding called vacuous are gone, and the `missing:` item below ("assert on
      the AST, not the text") is what was implemented. Both guards pass in the
      46-file / 442-test run. 01-RECONCILIATION.md row 7.
    reason_retained: >-
      Original finding preserved below. It records that the vacuity was proven by
      simulating the deletion against the real files rather than argued — which is
      the standard the replacement guards have to keep meeting.
    reason: >-
      Both guards are raw substring tests over whole file contents, comments and
      imports included, and both are satisfied by text that survives deleting the
      artifact. Verified by simulating the deletion against the real files rather
      than reasoning about it.

      `tests/lib/venue-page-gate-coverage.test.ts:86` is
      `!readFileSync(page).includes("resolveVenueOwner")`.
      `app/(dashboard)/venues/[venueId]/page.tsx` contains that string three times
      — line 6 (import), line 54 (inside the rationale comment), line 58 (the
      call). Removing lines 58-62 leaves 2 occurrences and the guard stays green.
      So the guard is vacuous for the exact page it was written for, and this
      codebase's convention of carrying rationale comments alongside the pattern
      they justify means a copy-pasted new page is likely to carry the comment
      too. Two further scope gaps: the walk matches `page.tsx` only, so a
      `route.ts`, `layout.tsx` or `opengraph-image.tsx` under `[venueId]` renders
      venue data unguarded; and a page that calls the gate and ignores the result
      also passes.

      `tests/lib/device-cookie-outcome-coverage.test.ts:90-93` is
      `contents.includes(outcome)`. `registry-unreadable` appears twice in
      `actions/devices.ts` — line 326 (prose) and line 401 (the call site plan
      01-12 added). Removing line 401 leaves 1 occurrence and the guard stays
      green, i.e. the guard cannot detect removal of the very call site it was
      written to pin. The file's own header argues against exactly this ("a
      hard-coded list is a second source of truth… deliberately does not fall back
      to a regular expression over the source") and then leans on a check strictly
      weaker than a regex. The third assertion, against the policy test file, is
      weaker still: the outcome names live in `describe`/`it` title strings there,
      so a deleted `expect` is invisible.

      This matters beyond tidiness because both plans state the guard AS the
      must-have — "turns the suite red instead of quietly inheriting the weaker
      one", "an outcome that exists in the type and nowhere else turns the suite
      red". The extraction side of the outcome guard is already AST-based, so the
      precedent and the `typescript` dependency are both in-repo.
    artifacts:
      - path: "tests/lib/venue-page-gate-coverage.test.ts"
        issue: "Line 86 — substring check satisfied by the import on line 6 and the comment on line 54 of the page it guards; walk is limited to page.tsx"
      - path: "tests/lib/device-cookie-outcome-coverage.test.ts"
        issue: "Lines 90-93 — substring check satisfied by the prose mention at actions/devices.ts:326; the policy-test assertion is satisfied by it() titles"
    missing:
      - "Assert on the AST, not the text: walk for a CallExpression whose callee is `resolveVenueOwner`, and for `deviceCookieDirectives({ outcome: \"...\" })` string-literal initialisers"
      - "Widen the route-family walk beyond page.tsx to every routable filename"
  - truth: "The Server Action layer that carries every phase-01 user journey is behaviourally covered (WR-10, carried forward)"
    status: resolved
    resolved_by: "tests/actions/auth-actions.test.ts, create-venue-action.test.ts, device-lifecycle-actions.test.ts, staff-actions.test.ts, tests/venues/second-venue-route.test.ts"
    resolved_at: 2026-08-04
    resolution_evidence: >-
      The finding's own measure was `grep -rn "@/actions/" tests/` returning two
      imports. Re-run: signUpOwner, signInOwner, requestPasswordReset and
      ensureAccount at auth-actions.test.ts:63; createVenue at
      create-venue-action.test.ts:61 and second-venue-route.test.ts:62;
      enableStaffMode, exitOwnerUnlock, revokeDevice and unenrollThisBrowser at
      device-lifecycle-actions.test.ts:130; staff actions at
      staff-actions.test.ts:58. All six actions this entry named as "executed by
      nothing" are now executed. 01-RECONCILIATION.md row 8.
    residual: >-
      This closes the COVERAGE claim only. It does not by itself close truth 1 /
      SC1, which additionally asserts a browser journey (01-RECONCILIATION.md
      row 22, human-owed).
    reason_retained: "Original finding preserved below."
    reason: >-
      Genuine and targeted progress. `tests/support/server-action-harness.ts`
      exists and is real: a jar keyed on (name, path) with browser-faithful path
      matching, longest-prefix get resolution, expiry/maxAge eviction and a
      redirect sentinel. Two Server Actions are now driven for real through it —
      `completePasswordReset` (`recovery-cookie-lifecycle.test.ts:85`) and
      `exitOwnerUnlock` (`device-exit-classification.test.ts:132`) — which are
      exactly the two that carried the previous round's blockers, and the jar's
      own self-check at `recovery-cookie-lifecycle.test.ts:163` reproduces the
      shipped defect, so the harness fails against the real bug rather than a
      hypothetical one.

      But `grep -rn "@/actions/" tests/` still returns exactly those two imports.
      `signUpOwner`, `signInOwner` and `createVenue` — the three actions SC1 is
      made of — are executed by nothing, which is why SC1 remains behaviour-
      unverified for the third verification in a row. `enableStaffMode`,
      `revokeDevice` and `unenrollThisBrowser` are likewise unexercised, and
      `revokeDevice` is where the one remaining error-discarding read lives.
    artifacts:
      - path: "tests/support/server-action-harness.ts"
        issue: "Real and reusable, but used by two suites only. Also contains a raw NUL byte at offset 5761 (`keyOf` uses a literal control character instead of `\\0`), so `git diff --stat 2a146a0..HEAD` reports it as `Bin 0 -> 10158 bytes` — the foundation of all future Server Action testing has no reviewable diff and no git blame, and any text-normalising step would silently repair it into a space that still works"
      - path: "actions/auth.ts"
        issue: "signUpOwner, signInOwner and requestPasswordReset unexercised"
      - path: "actions/venues.ts"
        issue: "createVenue unexercised; its accounts pre-check at :64 also binds only data"
      - path: "actions/devices.ts"
        issue: "enableStaffMode, revokeDevice and unenrollThisBrowser unexercised"
    missing:
      - "Drive signUpOwner, signInOwner and createVenue through the existing harness — that is the whole of SC1 and the only reason it cannot be scored"
      - "Replace the literal NUL in keyOf with the `\\0` escape so the harness is reviewable in git"
deferred: []
behavior_unverified_items:
  - truth: "A new owner can sign up, log in, and create a venue with a name, currency (RON/HUF/EUR), and default language — with no manual help (SC1, ACCT-01, ACCT-02)"
    test: >-
      In a browser against the local stack, with no developer assistance: sign up
      at /signup with email, password and the Terms checkbox; create a venue
      picking RON, then repeat for HUF and EUR; confirm country and timezone
      auto-derive for RON and HUF, stay blank for EUR, and remain overridable;
      sign out; log back in at /login; confirm the venue is still listed and the
      switcher appears only from the second venue onward.
    expected: >-
      Every step completes with no manual DB intervention; the venue reads back
      through RLS on the dashboard; the session survives logout and login. The
      Terms and Privacy links are EXPECTED to 404 — /legal/terms and
      /legal/privacy are a recorded deferral, not a new regression.
    why_human: >-
      Presence and wiring are proven and the database half is confirmed live,
      including the 0007 value domains and their catalog drift test. But this
      truth asserts a multi-step session state transition (signup → cookie write
      → redirect → read-back → logout → login) and, even after the harness landed
      in 01-11, no test invokes signUpOwner, signInOwner or createVenue. Declared
      a backstop truth by plans 01-10 and 01-13.
human_verification:
  - test: >-
      Complete the full owner self-serve journey in a browser: /signup with the
      Terms checkbox, create venues in RON, HUF and EUR, sign out, log back in.
    expected: >-
      Every step completes unaided; country/timezone auto-derive for RON and HUF
      and stay blank but overridable for EUR; the venue is still listed after
      re-login; the switcher appears only from the second venue.
    why_human: >-
      SC1. Multi-step session state transition with no Server Action test
      coverage. The Terms/Privacy 404 is a recorded deferral.
    state: >-
      OWED (item 1). Partly superseded: "no Server Action test coverage" is no
      longer true — signUpOwner, signInOwner and createVenue are all driven now
      (gaps_closed ROUND 3). What is still owed is the browser journey itself,
      and it is now wider than when this was written: create the second venue in
      HUF and the third in EUR FROM INSIDE THE PRODUCT, without typing a URL,
      which plan 01-14 made possible for the first time. Confirm the switcher
      appears from the second venue onward and lists all three in a stable order.
      01-RECONCILIATION.md row 22. This is the sole remaining blocker on truth 1.
  - test: >-
      As the venue's own staff device principal (an enrolled tablet), load
      /venues/{venueId} in a browser.
    expected: "A 404, not the venue's name, currency, languages, country and timezone."
    why_human: >-
      01-13 truth 1. The predicate is proven behaviourally against exactly this
      principal (tests/actions/venue-authority.test.ts:141 and :161, including the
      repeat), and the page calls it at :58 — but the rendered outcome of the
      Server Component itself is not observable from the suite.
    state: >-
      CLOSED (item 2) — 2026-08-03, recorded in 01-UAT.md test 26's rollup. A
      throwaway device was enrolled at My Venue so the browser held the venue's
      OWN staff-device principal; /venues/{venueId} returned HTTP 404 with no
      venue name, currency, language, country or timezone in the body. The
      throwaway device row, its auth user and its venue_members row were deleted
      afterward.
  - test: >-
      With a tablet enrolled at the venue, load /venues/{venueId}/staff and
      /venues/{venueId}/staff/devices as the owner in a browser.
    expected: >-
      Both render — the roster and the device registry with its revoke control —
      rather than 404.
    why_human: >-
      Declared backstop truth in plan 01-06. The predicate is proven behaviourally
      at 0, 1 and 3 enrolled devices; what remains unobserved is the rendered page.
    state: >-
      CLOSED (item 3) — UAT test 19, verified 2026-08-03 via Playwright against a
      production build as the owner of My Venue (one ACTIVE and one REVOKED
      device). Both routes rendered; neither 404'd. This is the CR-01 regression
      condition, exercised against the real authority predicate.
  - test: >-
      Unlock the tablet as the owner and leave it untouched past the idle
      threshold.
    expected: "The surface returns to the PIN pad with no interaction."
    why_human: >-
      D-07. IdleRelock is a client-side timer; its timing behaviour is not
      observable by grep or by any test in the suite. Judgment-tier prohibition in
      plan 01-10, re-declared as a backstop in plan 01-12.
    state: >-
      CLOSED (item 4) — UAT test 17. tests/tablet/idle-relock.test.tsx (bd49852)
      now executes the timer itself: armed at the threshold and not before,
      restarted by each of the four activity events, cleared on unmount. Before
      that file every OUTCOME of the relock was covered but nothing drove the
      timer, which is exactly what made this human-owed.
  - test: >-
      Press the un-enrol control on the /unlock screen of a tablet whose device
      has been revoked from the dashboard.
    expected: >-
      Both cookies clear and the browser returns to the ordinary login page,
      without a server-side revoke.
    why_human: >-
      D-08 backstop, plan 01-12. UnenrollBrowserButton is wired at
      app/(tablet)/unlock/page.tsx:58 and :74 to unenrollThisBrowser
      (actions/devices.ts), but the control is a browser interaction on a specific
      device state that no test reaches — and unenrollThisBrowser is one of the
      actions the harness does not yet drive.
    state: >-
      CLOSED (item 5) — UAT test 23. tests/actions/device-lifecycle-actions.test.ts
      drives un-enrol on an already-REVOKED tablet and asserts the WR-05 loop does
      not resume afterward. The trailing clause of why_human is also now stale:
      unenrollThisBrowser IS driven by the harness (device-lifecycle-actions.test.ts:130).
  - test: >-
      As a signed-in owner who has NOT redeemed a recovery link, navigate to
      /reset-password and to /reset-password?stage=set.
    expected: >-
      Neither URL renders the "Choose a new password" form; both show the request
      stage.
    why_human: >-
      D-07 backstop, plan 01-11. The query parameter no longer gates anything and
      the grant is now genuinely single-use, so the "run this BEFORE completing a
      reset" caveat from the previous verification NO LONGER APPLIES. The rendered
      outcome is still worth confirming.
    state: >-
      CLOSED (item 6) — UAT test 21. tests/auth/reset-stage-source.test.ts
      (bd49852, 21 assertions) drives the real reset-password page and reads back
      WHICH form the returned element tree holds: ?stage=set cannot reach the
      set-password form with no grant, an expired grant or a forged one; a valid
      grant still can. CR-03 was a render decision, so this closes the checkpoint
      at the layer the defect lived on.
  - test: >-
      As an owner stranded without an accounts row, re-submit the consent form
      (D6).
    expected: "ensure_account records consent and the owner proceeds to venue creation."
    why_human: >-
      Executor-reported open item, re-declared as a backstop in plan 01-13; a
      browser-only recovery path.
    state: >-
      CLOSED (item 7) — UAT test 20. The induced-failure path is now exercised
      directly rather than simulated by hand: tests/actions/auth-actions.test.ts
      :190 (retries the consent write exactly once and succeeds on the second),
      :210 (fails loudly and stops at two attempts), :232 (falls through when the
      caller already holds a session for THAT email), plus the two negative cases
      at :253 and :276 that keep the fall-through from becoming a hole.
  - test: >-
      Create two venues for one owner that tie on created_at, and reload the
      dashboard and the venue switcher repeatedly. Separately, read back
      rls_test_items and venue settings rows that tie on their ordering key.
    expected: "The order is stable across repeated reads."
    why_human: >-
      Backstop truths from plans 01-09, 01-10 and 01-13. Ordering under a tie is
      not inferable from the code, and no test pins it.
    state: >-
      CLOSED (item 8) — UAT test 24, and it FOUND A REAL DEFECT on the way.
      Converting it into tests/venues/multi-venue.test.ts produced a FAILING test:
      venues.created_at defaults to now() (transaction start), so two venues can
      tie exactly and all five position-selecting reads ordered on that single
      non-unique column. Fixed by b296bf6 (a total order on every list read),
      46aee48 (the same tiebreaker mirrored into both test helpers) and c8fd468.
      Re-confirmed 2026-08-04: `order("id"` present in both venues/page.tsx and
      VenueSwitcher.tsx. "No test pins it" is no longer true.
  - test: >-
      Drive the full GoTrue recovery journey on the local stack with
      secure_password_change = true, and separately attempt an updateUser password
      change from an ordinary (non-recovery) password session.
    expected: >-
      The recovery journey completes; the ordinary-session behaviour is whatever
      the CLI's GoTrue build reports.
    why_human: >-
      Declared backstop in plan 01-11 — the outcome depends on the shipped GoTrue
      build and is recorded rather than asserted. The measurement at
      tests/auth/recovery-gate.test.ts:226-250 is the reason the recovery grant
      exists at all.
    state: >-
      CLOSED (item 9) — UAT test 22, as a SPLIT VERDICT. Clause 1 is proven:
      recovery-gate.test.ts:160 drives the complete journey through the real local
      mailbox with secure_password_change = true. Clause 2 was STRUCK as
      mis-derived (user decision, 2026-08-03) — it asserted a GoTrue behaviour
      that does not exist; the security property it aimed at is held by the
      app-layer grant gate and is verified by item 6 above. Recorded as
      pass-with-corrected-expectation, not as a silent pass.
    human_verification_summary: >-
      Eight of nine CLOSED. One OWED: item 1, the SC1 owner self-serve journey.
      Two further legs owed outside this block — the Google live round trip
      (01-UAT.md test 12) and enrolment reachability on a revoked-only registry
      (G-01-6) — both arriving from gap-closure round 3, which postdates this
      block. Together those three are 01-RECONCILIATION.md rows 22-24 and they are
      why `status` stays `gaps_found`.
---

# Phase 1: Multi-Tenant Foundation Verification Report

**Phase Goal:** A restaurant owner can self-serve create their account and venue and invite staff with scoped roles, while the system guarantees no venue's data leaks to another and no limited-role staff member can change prices, content, or settings.
**Verified:** 2026-07-29T12:15:00Z
**Status:** gaps_found
**Re-verification:** Yes — after gap-closure round 2 (plans 01-11, 01-12, 01-13)

## Headline

Both blockers are genuinely closed, and closed at the right altitude. I re-derived each fix from source and from the installed framework rather than from the SUMMARY, and both hold under adversarial reading.

The recovery-replay fix is the stronger of the two. `RECOVERY_COOKIE_PATH` is *assigned* from `PASSWORD_RESET_PATH` rather than re-declared, both cookie sites go through one applier neither of which spells a path, and the applier uses the object form of `delete`. I confirmed against `next@16.2.12` that `ResponseCookies.delete({name, path})` desugars to `set({path, name, value:"", expires: Date(0)})` and that `normalizeCookie()` only overwrites the path when it is absent — so the object form preserves it and the string form does not. And the test that proves it drives the real `completePasswordReset` twice through a jar that reproduces the *old* behaviour as a self-check, which is what makes it evidence rather than decoration.

Three of the five roadmap success criteria that were verified last pass are still verified, and SC1 is unchanged at behaviour-unverified for the third pass running, for the same reason each time: the harness that would settle it now exists and does not yet drive the three actions SC1 is made of.

What does not hold is narrower than last time and sits in one place. **The phase's own declared rule — "a read failure is not an absent row" — is still not in force on the three pages of the `/venues/[venueId]` family, including the page plan 01-13 edited.** All three bind only `data` from a `venues` `maybeSingle()` and answer `notFound()`, and that read runs *before* the honest gate, so it shadows it. Each of the three carries, in its own body, a comment saying that reporting a broken read as a 404 "is precisely the lie CR-01 told the owner for the whole of this phase." And the throw-based design those comments justify has nothing to land on: there is no `error.tsx` or `global-error.tsx` anywhere in the repository, contradicting an explicit SUMMARY claim.

Separately, two of the three new structural guards can be deleted around. I simulated the deletion against the real files: removing the gate call from the venue-detail page leaves the guard green, and removing the `registry-unreadable` call site leaves its guard green. In both cases the guard's own must-have is phrased as "turns the suite red", and it does not.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A new owner can sign up, log in, and create a venue with a name, currency (RON/HUF/EUR), and default language — with no manual help (SC1) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Unchanged. Artifacts present and wired; the database half is confirmed (0007 value domains, single-sourced `SUPPORTED_LANGUAGE_CODES`, catalog drift test). The truth asserts a multi-step session state transition and `grep -rn "@/actions/" tests/` returns exactly two imports, neither of them `signUpOwner`, `signInOwner` or `createVenue`. The 01-11 harness makes this newly *cheap* to close and it was not closed. Backstop truth in plans 01-10 and 01-13. |
| 2 | An owner/manager can invite a staff member, who signs in and sees only the venues they belong to (SC2) | ✓ VERIFIED | `lib/venue-authority.ts` filters on both `venue_id` and `user_id` and rethrows the read error. `tests/actions/venue-authority.test.ts` (11 cases) drives the production enrol path at 0/1/3 devices, denies the venue's own device principal, repeats the denial, throws on a faulting read, and completes a revoke. Re-run this pass. |
| 3 | A user cannot read or modify any data belonging to a venue they are not a member of — tenant isolation proven via automated RLS tests across every role × venue combination (SC3) | ✓ VERIFIED | `venue-isolation-matrix.test.ts` re-run green this pass. Denial assertions are non-vacuous — `expectDenialError` asserts the error shape from `expectWriteDenied`'s `else` branch. |
| 4 | A limited-role staff member cannot edit prices, content, or settings (only availability), while an owner/manager can edit everything — proven by RLS tests (SC4) | ✓ VERIFIED | `staff-write-boundary.test.ts` and `owner-full-access.test.ts` re-run green this pass. The narrow `toggle_item_availability` RPC remains the only staff write path. WR-02's read disclosure on the venue detail page is now closed (truth 8). |
| 5 | One owner account can hold multiple venues (SC5) | ✓ VERIFIED | `multi-venue.test.ts` re-run green, now including a byte-identical-names case proving the WR-03 duplicate would have been permanent. `venues.account_id` immutable even to `service_role`. See IN-04 for one tautological assertion in this file — it does not carry the criterion. |
| 6 | A completed password reset cannot be replayed — the recovery authority dies with the change it authorised (ACCT-01, 01-11, D-07) | ✓ VERIFIED *(was ✗ FAILED)* | Independently re-derived. `RECOVERY_COOKIE_PATH = PASSWORD_RESET_PATH` (assignment, not a second literal); mint at `app/auth/confirm/route.ts:133` and clear at `actions/auth.ts:319` both go through `applyRecoveryCookieDirective`, neither spelling a path; the applier uses `store.delete({name, path})`. Confirmed in `next@16.2.12`: `ResponseCookies.delete` maps the object form to `set({...options, name, value:"", expires: Date(0)})`, and `normalizeCookie` fills `path="/"` **only when absent**. Behaviourally proven — `recovery-cookie-lifecycle.test.ts` runs the real action twice through a (name, path)-keyed jar and asserts refusal + no redirect on the second, no entry at `/reset-password` **and no entry at any path**, the grant preserved when `updateUser` fails, and no grant minted for `type=email/invite/magiclink`/code-exchange/failed-OTP. The jar's self-check at :163 reproduces the shipped defect, so the harness fails against the real bug. |
| 7 | A transient fault never costs the venue a manual tablet re-enrolment (ACCT-05, 01-12) | ✓ VERIFIED *(was ✗ FAILED)* | `actions/devices.ts:372` now binds `error: deviceReadError` and the `if (deviceReadError)` branch at :379 sits **above** the `!device` check. `registry-unreadable` is a real member of the owner-unlock-exit union returning `[]`, and the trailing `return []` fallback is replaced by a `const unhandledOutcome: never` assertion, so an unhandled outcome fails `tsc` rather than silently doing nothing. Behaviourally proven — `device-exit-classification.test.ts` drives the real `exitOwnerUnlock` and asserts both cookies survive a faulting read, survive ten consecutive faults, and are **cleared** in the contrast case where the read succeeds and finds no row. See WR-02 below for a permanent-fault caveat. |
| 8 | The venue-detail page is gated by the same predicate as its two siblings — the venue's own staff device principal gets a 404 (WR-02, 01-13) | ✓ VERIFIED | `app/(dashboard)/venues/[venueId]/page.tsx:58` calls `resolveVenueOwner` and `:60` answers `notFound()`. The predicate is proven against exactly this principal: `venue-authority.test.ts:141` ("returns null for the venue's own staff device principal") and `:161` ("keeps denying the device principal on every repeat"), both green. The rendered page is routed to human verification. |
| 9 | A read failure is never presented as an authoritative absent result, and the failure it becomes reaches a route error boundary (01-13 truth 4 + prohibition) | ✗ FAILED | `resolveVenuesLanding` throws correctly and is tested — that half holds. But all three `/venues/[venueId]` pages still bind only `data` from a `venues` `maybeSingle()` and 404 the legitimate owner on a database fault, and that read runs **first**, shadowing the honest gate below it. And `find` for `error.tsx`/`global-error.tsx` returns nothing repo-wide, so the throw lands on Next's unstyled default — contradicting `01-13-SUMMARY.md:324`. **BLOCKER.** |
| 10 | The new structural coverage guards turn the suite red when the thing they guard is removed (01-12 truth 5, 01-13 truth 2) | ✗ FAILED | Simulated against the real files. Deleting the gate call from `[venueId]/page.tsx` leaves 2 `resolveVenueOwner` occurrences (import + comment) → guard green. Deleting the `registry-unreadable` call site at `actions/devices.ts:401` leaves 1 occurrence (prose at :326) → guard green. Both must-haves are phrased as "turns the suite red". **BLOCKER.** |
| 11 | The Server Action layer that carries every phase-01 user journey is behaviourally covered (WR-10, carried forward) | ⚠️ PARTIAL | The harness is real and browser-faithful, and the two actions that carried both blockers are now driven for real. But `grep -rn "@/actions/" tests/` still returns exactly two imports. `signUpOwner`, `signInOwner`, `createVenue`, `enableStaffMode`, `revokeDevice` and `unenrollThisBrowser` remain executed by nothing — and `revokeDevice` holds the one remaining error-discarding read in the actions layer. |

**Score:** 7/11 truths verified (1 present, behavior-unverified; 2 failed; 1 partial)

### Prior Gap Closure

Each prior gap re-checked against source and the installed framework, not against the SUMMARY.

| Prior gap | Verdict | Independent evidence |
|---|---|---|
| BLOCKER 1 — recovery grant replayable | ✓ CLOSED | (name, path) discipline structurally enforced by assignment; object-form delete confirmed against `next@16.2.12`'s own `ResponseCookies.delete`/`normalizeCookie`; replay driven twice through a path-aware jar and refused. |
| BLOCKER 2 — transient fault de-enrols the tablet | ✓ CLOSED | Error bound, branch ordered above `!device`, dedicated `registry-unreadable` outcome, `never` exhaustiveness assertion, real action driven under a faulting read ten times with both cookies intact and a passing contrast case. |
| WR-02 — venue-detail page ungated | ✓ CLOSED | Gate present at :58; predicate denies the venue's own device principal on first and repeat calls. |
| WR-03 — failed venues read rendered as "add your first venue" | ⚠️ CLOSED IN THE MODULE, INCOMPLETE AT THE ROUTE | `resolveVenuesLanding` throws and is tested. But the compensating error boundary does not exist, and the same collapse is untouched on the three `[venueId]` pages. See truth 9. |
| WR-04 — rotation blast radius | ✓ CLOSED | `.env.example:84-91` now states that a deployment without a dedicated `STAFF_SESSION_SECRET` gets the same tablet-wide blast radius from rotating the database secret, and instructs planning the rotation "for a time when someone can reach every tablet". |
| WR-10 — Server Action coverage | ⚠️ PARTIAL | Two actions driven, six not. See truth 11. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `lib/recovery-session.ts` | Path constant + directives + applier | ✓ VERIFIED | 273L. `RECOVERY_COOKIE_PATH` assigned from `PASSWORD_RESET_PATH`; `recoveryGrantSetDirective`/`recoveryGrantClearDirective` both read it; `applyRecoveryCookieDirective` uses the object-form delete. Still Next-free. Comments now describe the mechanism rather than asserting the property. |
| `actions/auth.ts` | Gate + single-use clear | ✓ VERIFIED | Gate at :304, clear at :319 via the applier. `signUpOwner`/`signInOwner` still untested. |
| `app/auth/confirm/route.ts` | Mint only for redeemed recovery | ✓ VERIFIED | :133 mints via the applier, narrowed to `redeemedRecovery`; five negative cases green. See IN-03 for the unvalidated `EmailOtpType` cast. |
| `tests/support/server-action-harness.ts` | Path-aware jar + redirect sentinel | ⚠️ PRESENT, DEFECT | Genuinely browser-faithful (longest-prefix get, expiry/maxAge eviction, path matching) and its self-checks reproduce the old defect. But it holds a raw NUL byte at offset 5761, so git classifies it `Bin 0 -> 10158 bytes` — no diff, no blame, on the module every future Server Action test rests on. |
| `tests/actions/recovery-cookie-lifecycle.test.ts` | BLOCKER 1 regression | ✓ VERIFIED | Drives the real action and the real Route Handler; GoTrue is the only stub, and that boundary is stated. |
| `lib/device-cookie-policy.ts` | `registry-unreadable` + exhaustiveness | ✓ VERIFIED | Union has 8 owner-unlock-exit outcomes; `const unhandledOutcome: never` replaces the silent `return []`. |
| `actions/devices.ts` | Error binding on the exit read | ⚠️ PRESENT, PARTIAL | `exitOwnerUnlock` fixed. `revokeDevice:248` still binds only `data`. `applyCookieDirectives:70` still uses the string form of `delete` (correct only by coincidence — both tablet cookies happen to be set at `/`). |
| `tests/actions/device-exit-classification.test.ts` | BLOCKER 2 regression | ✓ VERIFIED | Six cases including the contrast (read succeeds → both cleared) that makes the preserving assertion mean something. |
| `lib/venue-landing.ts` | `resolveVenuesLanding` | ✓ VERIFIED | Error checked first, with the ordering trap named. Next-free. |
| `tests/lib/venue-landing.test.ts` | WR-03 regression | ✓ VERIFIED | Both directions driven. |
| `app/(dashboard)/venues/[venueId]/page.tsx` | Gate matching siblings | ⚠️ PRESENT, DEFECT | Gate correct at :58. The venues read at :28 binds only `data` and 404s a fault at :34, ahead of it. |
| `tests/lib/venue-page-gate-coverage.test.ts` | Route-family guard | ✗ VACUOUS | Substring check satisfied by the import and comment of the page it guards; empirically confirmed. |
| `tests/lib/device-cookie-outcome-coverage.test.ts` | Outcome guard | ⚠️ HALF-VACUOUS | Extraction side is AST-based and asserts a non-empty count; the verification side is a substring check satisfied by prose. |
| `app/(dashboard)/error.tsx` | Route error boundary | ✗ MISSING | Does not exist. No error boundary anywhere in the repository. |
| `.env.example` | Rotation blast radius | ✓ VERIFIED | :84-91. |
| Migration ledger | 0001–0007 | ✓ VERIFIED | Unchanged this round; no migrations in round 2. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `app/auth/confirm/route.ts` | `lib/recovery-session.ts` | `applyRecoveryCookieDirective(recoveryGrantSetDirective(...))` | ✓ WIRED | :133, the only mint site; no path literal at the call site. |
| `actions/auth.ts` | `lib/recovery-session.ts` | `applyRecoveryCookieDirective(recoveryGrantClearDirective())` | ✓ WIRED *(was NOT_WIRED)* | :319. Object-form delete at the same constant the mint wrote. |
| `tests/actions/recovery-cookie-lifecycle.test.ts` | `@/actions/auth` | the real `completePasswordReset` | ✓ WIRED | :85. |
| `actions/devices.ts` `exitOwnerUnlock` | `lib/device-cookie-policy.ts` | `deviceCookieDirectives({outcome:"registry-unreadable"})` | ✓ WIRED | :401, above the `!device` branch. |
| `tests/actions/device-exit-classification.test.ts` | `@/actions/devices` | the real `exitOwnerUnlock` | ✓ WIRED | :132. |
| `app/(dashboard)/venues/[venueId]/page.tsx` | `lib/venue-authority.ts` | `resolveVenueOwner` → `notFound()` | ✓ WIRED | :58, matching both siblings. |
| `app/(dashboard)/venues/page.tsx` | `lib/venue-landing.ts` | `resolveVenuesLanding` | ✓ WIRED | The only place the venues read becomes a destination. |
| `lib/venue-landing.ts` throw | route error boundary | Next error boundary | ✗ **NOT_WIRED** | No `error.tsx` exists. The throw reaches Next's unstyled default screen. Same for `resolveVenueOwner`'s throw from three pages. |
| `[venueId]` venues read | error channel | `const { data: venue }` | ✗ **NOT_WIRED** | Error discarded on all three pages; a fault becomes `notFound()`. |
| `actions/devices.ts` `applyCookieDirectives` | tablet cookie paths | `cookieStore.delete(name)` string form | ⚠️ PARTIAL | Correct only because both tablet cookies are set at `/`. `CookieDirective` carries no path, so the policy module cannot express one and the jar cannot see a drift. |
| `tests/lib/venue-page-gate-coverage.test.ts` | the gate call | `contents.includes("resolveVenueOwner")` | ✗ **NOT_WIRED** | Satisfied by the import and the comment; the call can be deleted with the guard green. |
| `tests/lib/device-cookie-outcome-coverage.test.ts` | the call site | `contents.includes(outcome)` | ✗ **NOT_WIRED** | Satisfied by prose at `actions/devices.ts:326`. |
| `lib/copy.ts:125-126` | `/legal/terms`, `/legal/privacy` | `termsHref`, `privacyHref` | ✗ NOT_WIRED | Recorded deferral, not counted as a gap. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `completePasswordReset` | recovery grant cookie | `cookies()` store via the applier | Yes on read **and on clear** — the clear now targets the (name, path) pair the mint wrote | ✓ FLOWING |
| `exitOwnerUnlock` | `device` + `deviceReadError` | PostgREST read | Both channels bound; `null` no longer carries two meanings | ✓ FLOWING |
| `resolveVenuesLanding` | `{data, error}` | PostgREST list read | Both channels bound; error checked first | ✓ FLOWING |
| `[venueId]` page `venue` | `venues` row | PostgREST `maybeSingle()` | **Error channel dropped** — a fault renders as "not found" | ⚠️ HOLLOW |
| `revokeDevice` `device` | `venue_devices` row | PostgREST `maybeSingle()` | Error channel dropped; fails closed with a generic message | ⚠️ HOLLOW |
| `resolveVenueOwner` throw | route error boundary | Next | No boundary exists to receive it | ✗ DISCONNECTED |
| `venue-page-gate-coverage` `ungated` | file contents | `readFileSync` substring | Matches import + comment, not the call | ⚠️ STATIC |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Round-2 closure suites | `pnpm exec vitest run tests/actions/recovery-cookie-lifecycle tests/actions/device-exit-classification tests/lib/venue-landing tests/lib/venue-page-gate-coverage tests/lib/device-cookie-outcome-coverage tests/lib/device-cookie-policy` | 6 files, 54/54 passed | ✓ PASS |
| SC2–SC5 release gate | `pnpm exec vitest run tests/rls/venue-isolation-matrix tests/rls/staff-write-boundary tests/rls/owner-full-access tests/venues/multi-venue tests/actions/venue-authority` | 5 files, 78/78 passed | ✓ PASS |
| Next object-form delete preserves path | read `node_modules/next/dist/compiled/@edge-runtime/cookies/index.js` at `next@16.2.12` | `delete(...args)` → `set({...options, name, value:"", expires: Date(0)})`; `normalizeCookie` sets `path="/"` **only when absent** | ✓ CONFIRMS FIX |
| `ResponseCookies.delete` accepts a path | `index.d.ts:191` | `delete(...args: [key: string] \| [options: Omit<ResponseCookie,'value'\|'expires'>])` | ✓ PASS |
| Error boundary exists | `find . -name "error.tsx" -o -name "global-error.tsx"` (repo-wide, node_modules pruned) | no matches | ✗ FAIL |
| Route-family guard catches gate removal | simulate deleting `[venueId]/page.tsx:58-62`, re-run the guard predicate | `includes("resolveVenueOwner")` still **true**, 2 occurrences remain | ✗ FAIL |
| Outcome guard catches call-site removal | simulate deleting `actions/devices.ts:401`, re-run `missingFrom` | `includes("registry-unreadable")` still **true**, 1 occurrence remains | ✗ FAIL |
| Actions executed by tests | `grep -rn "@/actions/" tests/` | 2 imports: `completePasswordReset`, `exitOwnerUnlock` | ⚠️ PARTIAL |
| Error-discarding `maybeSingle()` reads | `grep -rn "maybeSingle()" actions lib app` + destructuring inspection | 5 of 9 bind the error; 4 do not (`[venueId]/page.tsx:28`, `staff/page.tsx:34`, `staff/devices/page.tsx:33`, `actions/devices.ts:248`; plus `actions/venues.ts:64`) | ✗ FAIL |
| Cross-codec value validity (WR-03 review claim) | reconstruct the three codecs under one key and cross-decode | a `cena_staff` value decodes as a valid `cena_device_user`; a recovery grant decodes as both — confirmed empirically | ⚠️ CONFIRMS WARNING |
| Harness NUL byte | byte scan + `git diff --stat 2a146a0..HEAD` | 1 NUL at offset 5761; git reports `Bin 0 -> 10158 bytes` | ⚠️ CONFIRMS WARNING |
| Debt markers in phase source | `grep -rnE "\b(TBD\|FIXME\|XXX)\b"` over `actions lib app components tests supabase/migrations` | 0 matches | ✓ PASS |
| TODO/HACK/PLACEHOLDER | same paths | 0 matches | ✓ PASS |

Full-suite, build and `tsc --noEmit` gates were run once by the orchestrator before this pass (314/314 across 31 files, exit 0). Not re-run here, per the one-full-run rule.

### Probe Execution

No `scripts/*/tests/probe-*.sh` exist and no plan declares a probe. Step 7c: **SKIPPED (no probes declared or discoverable).**

### Requirements Coverage

All three round-2 executors left `requirements-completed: []` deliberately, pointing at their coverage blocks. Judged here against the code.

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ACCT-01 | 01-01, 01-02, 01-07, 01-09, 01-11 | Owner can sign up and log in without manual help | ? NEEDS HUMAN | The recovery-replay blocker that blocked this is closed and proven behaviourally. Consent evidence is correct and unrewritable. What remains is not a defect but an absence of evidence: signup and login are executed by no test, and SC1's browser journey is unrun. Abstaining rather than passing silently, per the plan's own instruction. |
| ACCT-02 | 01-01, 01-09, 01-13 | Create venue with name, currency (RON/HUF/EUR), enabled languages | ⚠️ PARTIAL | 0007 CHECKs, single-sourced `SUPPORTED_LANGUAGE_CODES` with a catalog drift test, blank/empty/encoding edges, and byte-identical-names proven distinct. But the venue-creation action itself is untested and the create-first landing decision, while now honest, fails into no error boundary. |
| ACCT-03 | 01-01, 01-02, 01-09, 01-13 | One owner account owns multiple venues | ✓ SATISFIED | `multi-venue.test.ts` green including both isolation directions; `account_id` immutable even to `service_role`; switcher wired. |
| ACCT-04 | 01-03, 01-06, 01-08 | Owner/manager can invite staff members to a venue | ✓ SATISFIED | CR-01 regression suite green; PIN backoff clamp verified past the former overflow boundary; `rpc-abuse-matrix` refuses every non-owner caller. |
| ACCT-05 | 01-04, 01-06, 01-10, 01-12 | Staff sign in and access only the venues they belong to | ⚠️ PARTIAL | The de-enrolment blocker is closed and proven under a ten-fault repeat. Two residuals: a *permanent* read fault is now a state the tablet cannot leave (WR-02), and the D-08 revoke valve still answers a transient fault with an indistinguishable generic error (WR-01). |
| ACCT-06 | 01-05, 01-10 | Staff can toggle availability but not edit prices, content, settings | ✓ SATISFIED | `staff-write-boundary.test.ts` green plus `availability-toggle-edges.test.ts`. |
| ACCT-07 | 01-05, 01-09, 01-10, 01-13 | Owner/manager can edit all content, theming, venue settings | ⚠️ PARTIAL | `owner-full-access.test.ts` green and the venue-detail page is now gated. But the owner's own venue pages report a database fault as "this venue does not exist", and the guard meant to keep the gate in place is vacuous. |
| ACCT-08 | 01-01, 01-04, 01-05, 01-09, 01-10, 01-13 | Tenant isolation — no cross-venue read or modify | ✓ SATISFIED | Matrix suite green with non-vacuous denial assertions; the last known role-boundary leak (WR-02) is closed and the denial proven idempotent across repeats. |

**No orphaned requirements.** All 8 ACCT IDs mapped to Phase 1 in REQUIREMENTS.md are claimed by at least one plan.

**Bookkeeping:** REQUIREMENTS.md now correctly shows all 8 checkboxes unticked and all 8 traceability rows reading `Gaps Found` — no longer ahead of the evidence. That is the right state and should stay until the gaps above close.

### Prohibition Check (round-2 plans)

| Prohibition | Plan | Tier | Status | Evidence |
|-------------|------|------|--------|----------|
| A password change MUST NOT be completable from a session that merely exists (D-07) | 01-11 | test | ✓ VERIFIED | Replay driven twice through the real action and refused; grant absent at every path afterward. |
| A comment MUST NOT assert a security property the code does not have | 01-11 | test | ✓ VERIFIED | The three comments now name `RECOVERY_COOKIE_PATH` as the mechanism; the constant is assigned, not re-declared. |
| A test double MUST NOT be simpler than the mechanism it stands in for | 01-11 | test | ✓ VERIFIED | The jar keys on (name, path), matches paths, honours longest-prefix get, and its own self-check reproduces the shipped defect. |
| A green suite MUST NOT stand as evidence for a layer it does not execute | 01-11 | test | ⚠️ PARTIALLY UPHELD | Upheld for `completePasswordReset` and `exitOwnerUnlock`. Six other actions remain unexecuted, including all three of SC1's. |
| A transient network error MUST NOT cost the venue a manual tablet re-enrolment | 01-12 | test | ✓ VERIFIED | Ten consecutive read faults leave both cookies intact; the contrast case clears them. |
| A transient network error MUST NOT silently convert an owner's laptop into the venue's staff tablet | 01-12 | test | ✓ VERIFIED | `deviceCookieDirectives` returns `[]` for a failed swap. |
| An exhaustively tested pure module MUST NOT stand as evidence for the caller that feeds it | 01-12 | test | ✓ VERIFIED | The caller is now driven directly. |
| A read failure MUST NOT be presented to the operator as an authoritative empty result | 01-13 | test | ✗ **VIOLATED** | Closed for `/venues`; live on all three `/venues/[venueId]` pages, where a fault is answered with `notFound()`. |
| An operator-facing rotation instruction MUST NOT understate what rotating will cost | 01-13 | test | ✓ VERIFIED | `.env.example:84-91`. |
| A later phase MUST NOT inherit a weaker authority gate by adding a field to the one page in a route family that has none | 01-13 | test | ⚠️ **UNVERIFIED — flagged** | The gate is present today, but the mechanism meant to keep it there is a substring check the page's own import and comment satisfy. The prohibition's forward-looking claim is not enforced. |
| An owner-unlock session MUST NOT persist unattended (D-07) | 01-10, 01-12 | judgment | ⚠️ UNVERIFIED — human review recommended | `IdleRelock` is a client-side timer; presence and wiring confirmed, timing behaviour unobservable. Routed to human verification. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `app/(dashboard)/venues/[venueId]/page.tsx` | 28-36 | Discarded PostgREST error on a `maybeSingle()` that gates rendering | 🛑 Blocker | A database fault tells the legitimate owner their venue does not exist, from the file 01-13 edited, ahead of the honest gate and 26 lines above a comment forbidding it. |
| `app/(dashboard)/venues/[venueId]/staff/page.tsx` | 34-42 | Same | 🛑 Blocker | Same, on the staff roster. |
| `app/(dashboard)/venues/[venueId]/staff/devices/page.tsx` | 33-41 | Same | 🛑 Blocker | Same, on the page holding the D-08 revoke control. |
| `app/` (whole tree) | — | No `error.tsx`/`global-error.tsx` | 🛑 Blocker | Three source comments, one module header and one SUMMARY claim rest on a boundary that does not exist. A five-second blip hard-fails the owner's landing route to Next's unstyled default. |
| `tests/lib/venue-page-gate-coverage.test.ts` | 86 | Substring guard satisfied by import + comment | 🛑 Blocker | The guard cannot see removal of the gate on the page it was written for; empirically confirmed. |
| `tests/lib/device-cookie-outcome-coverage.test.ts` | 90-93 | Substring guard satisfied by prose | ⚠️ Warning | Cannot see removal of the call site plan 01-12 added. Extraction side is sound. |
| `actions/devices.ts` | 248-257 | Discarded PostgREST error (`revokeDevice`) | ⚠️ Warning (WR-01) | Fails closed, so no privilege gain — but this is the D-08 lost-tablet valve, and a transient fault returns the same string as "not your device", with nothing suggesting a retry. The last error-discarding read in the actions layer, which turns the phase's rule into a convention with an exception. |
| `actions/devices.ts` / `lib/device-cookie-policy.ts` | 379-405 / 131-146 | Every read error classified as transient | ⚠️ Warning (WR-02) | A *permanent* fault (e.g. `22P02` from a non-UUID `device_user_id`) is now a state the tablet cannot leave: forced sign-out every three idle minutes forever, no branch clearing the cookie, `unenrollThisBrowser` the only escape and nothing routing to it. Reachable — `decodeDeviceCookie` verifies the HMAC but never validates UUID shape, and I confirmed empirically that a `cena_staff` value is a structurally valid `cena_device_user` value under the shared key. `device-exit-classification.test.ts:231` pins the unbounded loop as desired, so the suite cannot surface it. |
| `lib/recovery-session.ts` | 28-31, 70 | One-directional domain tag | ⚠️ Warning (WR-03) | The module header states type separation as an invariant. Confirmed empirically that the prefix stops staff→recovery replay but not recovery→staff or recovery→device: a grant decodes as a valid `cena_staff` and a valid `cena_device_user`. No escalation constructed (the availability RPC re-checks server-side), but a stated invariant that does not hold is what a later phase builds on without re-deriving. |
| `actions/devices.ts` | 61-88 (esp. 70) | String-form `cookieStore.delete(name)` on tablet cookies | ⚠️ Warning (WR-04) | The exact class 01-11 exists to forbid, in the applier's sibling. Correct only by coincidence (both tablet cookies are set at `/`). `CookieDirective` carries no path, so the policy cannot express one and the new jar — built to see path-scoped defects — seeds both at `/` and would not see this one. |
| `tests/support/server-action-harness.ts` | 132 (byte 5761) | Raw NUL byte in a template literal | ⚠️ Warning (WR-07) | git classifies the file binary: no diff, no blame, on the foundation of all future Server Action testing. A text-normalising step turning it into a space would leave `keyOf` working, so the corruption would be silent. |
| `app/(auth)/reset-password/page.tsx` | 46 | Stage decided from an unbound grant | ℹ️ Info (IN-01) | Not a hole — the action re-checks — but a grant minted for another account renders the set form and dead-ends. |
| `app/auth/confirm/route.ts` | 35 | `as EmailOtpType` cast with no validation | ℹ️ Info (IN-03) | Defence-in-depth only; GoTrue rejects unknown types. On the line that decides whether a password-change authority is minted. |
| `tests/venues/multi-venue.test.ts` | 101-104, 142-155 | Tautological assertion; order-coupled fixture mutation | ℹ️ Info (IN-04) | `expect(venues.length < 2).toBe(true)` cannot fail after `toHaveLength(1)`. The rename case mutates a venue an earlier test asserts on, passing only because Vitest runs in declaration order. |
| `tests/actions/venue-authority.test.ts` | 238-278 | Test named for three pages asserts nothing about any page | ℹ️ Info (IN-05) | Duplicates the case above it. The page-level claim belongs to the guard that does not deliver it. |
| `actions/devices.ts` | 74-78 | Partial application before a throw | ℹ️ Info (IN-06) | Latent: no current policy returns delete-before-set. |
| `lib/copy.ts` | 125-126 | Links to non-existent `/legal/terms`, `/legal/privacy` | ℹ️ Info | Recorded deferral. |

**Debt-marker gate:** 0 `TBD`/`FIXME`/`XXX` and 0 `TODO`/`HACK`/`PLACEHOLDER` across `actions`, `lib`, `app`, `components`, `tests` and `supabase/migrations`. ✓ PASS.

### Deferred Items

None. Phases 2 through 7 cover menu, content, theming, translation, analytics and AI ingestion. None touches dashboard read discipline, error boundaries, or Server Action coverage. All three gaps are actionable now.

### Human Verification Required

Nine items, listed in the frontmatter. In brief: the SC1 owner self-serve journey (still the only thing standing between ACCT-01/ACCT-02 and a pass); the venue-detail page's 404 for the venue's own device principal (new — the predicate is proven, the render is not); the owner's browser render of `/staff` and `/staff/devices` with a tablet enrolled; D-07 idle relock timing; the un-enrol control on a revoked tablet; the stranded-owner consent re-submit; `/reset-password` stage gating — note the "run this BEFORE completing a reset" caveat from the previous verification **no longer applies**, since the grant is now genuinely single-use; the three ordering-under-tie backstops; and the GoTrue `secure_password_change` measurement.

### Gaps Summary

**What round 2 achieved, and it is real.** Both blockers are closed, and both fixes were re-derived here from source and from the installed framework rather than accepted from the SUMMARY. The recovery fix is the better of the two: it does not patch the delete, it makes the two sides structurally incapable of disagreeing — one constant, assigned rather than copied, read by two directives neither of which takes a path argument, applied by one function. I confirmed against `next@16.2.12`'s own `ResponseCookies.delete` and `normalizeCookie` that the object form preserves the path and the string form does not, so the fix rests on the framework's actual behaviour and not on a belief about it. And the harness that proves it was, by the executor's account and by its own self-check at line 163, observed failing against the unmodified action first — which is the difference between a regression test and a decoration. The device fix is equally well-shaped: the error bound, the branch ordered above `!device` with the ordering trap named in a comment, a dedicated outcome rather than a reused one, and a `never` assertion replacing the silent `return []` so the union cannot grow a hole. The ten-fault repeat plus the passing contrast case is exactly the pair that makes "nothing was cleared" mean something.

**What does not hold, and why it is the same lesson again.** The phase has now stated its central rule three times — "`maybeSingle()` reports two facts on one null; bind both channels" — closed it in `lib/venue-authority.ts`, closed it in `exitOwnerUnlock`, closed it in `resolveVenuesLanding`, and left it open on the three pages the rule was written for. `app/(dashboard)/venues/[venueId]/page.tsx` is the page plan 01-13 edited; the defect is 26 lines above a comment in that same function calling this exact behaviour "precisely the lie CR-01 told the owner for the whole of this phase"; and because the venues read runs before the gate, it shadows the honest branch for any fault broad enough to hit both tables. The rule keeps being applied to the file under repair and not to the file next to it.

The error boundary is the sharper finding, because it is a SUMMARY claim the filesystem contradicts. `01-13-SUMMARY.md:324` says the venues read failure "surfaces through the existing route error boundary, which 01-UI-SPEC.md already designates for page-level query failures (E4/E6)". There is no error boundary anywhere in the repository. The destructive half of WR-03 — the create-first invitation that would have produced an undeletable duplicate — is genuinely closed, and that was the important half. But the compensating half the module header promises ("the owner is told the read failed and reloads — which costs them nothing") was never built, so `/venues` now hard-fails to Next's unstyled default on a blip, and `resolveVenueOwner`'s throw, newly reachable from three pages, lands in the same place. Absent `COPY.errors.readFailed` is the tell: the Copywriting Contract has no entry for a screen the design depends on.

The third gap is about what counts as proof. Two of the three new structural guards are raw substring tests over whole file contents. I did not take the review's word for this — I simulated the deletion against the real files. Removing the gate call from the venue-detail page leaves two `resolveVenueOwner` occurrences, from the import and the rationale comment, and the guard stays green; removing the `registry-unreadable` call site leaves the prose mention at line 326, and that guard stays green too. Both plans phrase the guard as the must-have — "turns the suite red" — and in this codebase, where rationale comments travel alongside the patterns they justify, a copy-pasted new page is the likeliest way a future ungated page arrives, and it would arrive carrying the very string that satisfies the check. The outcome guard's *extraction* side is already AST-based and asserts a non-empty count, so the technique and the `typescript` dependency are both already in-repo; only the verification side reaches for text.

**Two warnings worth carrying into the fix pass, both empirically confirmed here rather than accepted.** All three cookie codecs share one signing key and only the newest tags its domain, so a recovery grant decodes as a valid `cena_staff` value and as a valid `cena_device_user` value — I reconstructed all three and cross-decoded them. No escalation follows (the availability RPC re-checks the staff profile server-side), but combined with the new "every read error is transient" classification it yields a concrete non-self-healing state: a non-UUID `device_user_id` raises `22P02` forever, and the branch that used to clear the cookie no longer runs. And `tests/support/server-action-harness.ts` carries a literal NUL where `\0` was meant, so git treats the foundation of all future Server Action testing as binary — no diff, no blame, on the one file whose fidelity every new assertion depends on.

**Not counted as gaps:** the `anon`/`authenticated` TRUNCATE grants, the `rls_test_items` placeholder, the `deferred-items.md` entries, and the missing `/legal/terms` and `/legal/privacy` routes — all accepted and recorded.

---

_Verified: 2026-07-29T12:15:00Z_
_Verifier: Claude (gsd-verifier)_

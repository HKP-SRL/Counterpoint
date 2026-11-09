---
phase: 01-multi-tenant-foundation
plan: 02
subsystem: auth
tags: [nextjs, supabase, gotrue, auth, password-reset, google-one-tap, rls, zod, vitest, shadcn, pnpm]

# Dependency graph
requires:
  - "01-01 — Next.js 16 scaffold, typed Supabase clients, migration 0001 (accounts/venues/venue_members + ensure_account/create_venue RPCs), Vitest harness, shadcn token layer"
provides:
  - "actions/auth.ts::signInOwner — email+password sign-in, uniform failure copy"
  - "actions/auth.ts::requestPasswordReset — uniform response regardless of account existence (T-02-01)"
  - "actions/auth.ts::completePasswordReset — updateUser under a redeemed recovery session"
  - "actions/auth.ts::ensureAccount(consentVersion) — Google-path accounts row + consent, version checked against the server constant"
  - "app/auth/confirm/route.ts — server-side verifyOtp/exchangeCodeForSession for emailed auth links, open-redirect guarded"
  - "supabase/templates/recovery.html — recovery mail linking to /auth/confirm with .TokenHash instead of GoTrue's stock ConfirmationURL"
  - "/login (UI-SPEC E2) and /reset-password (both stages)"
  - "app/(auth)/components/GoogleOneTap.tsx — signInWithIdToken + hashed nonce + FedCM, inert without a client id"
  - "app/(dashboard)/components/VenueSwitcher.tsx (+ venue-switcher-menu.tsx) — RLS-scoped multi-venue dropdown, hidden below 2 venues"
  - "/venues — post-login landing: first venue, or venue creation for an owner with none"
  - "components/venue-form.tsx + components/field-error.tsx — E3 form and E1/E2/E3 inline error, shared by signup, /venues and the auth forms"
  - "tests/rls/setup.ts::createGoogleUser fixture"
  - "10 new client-SDK assertions across 3 test files (28 total in the suite)"
affects:
  - "01-03 staff PIN provisioning — inherits the /venues landing route and the shared VenueForm/FieldError components"
  - "01-04 device provisioning — inherits app/auth/confirm as the pattern for any future emailed link"
  - "01-05 role × venue RLS matrix — the switcher query is now a second consumer of the venues policies it must not widen"
  - "any later phase adding an emailed auth flow (invite, email change) — /auth/confirm already handles token_hash + code"

# Tech tracking
tech-stack:
  added:
    - "shadcn dropdown-menu component (no new npm dependency — radix-ui was already installed)"
  patterns:
    - "Emailed auth links land on a Route Handler, never a page: redeeming a token writes the session cookie and a Server Component may not set cookies during render"
    - "Custom GoTrue email template using {{ .TokenHash }} so the exchange is server-side, instead of the stock ConfirmationURL that returns the session in a URL fragment"
    - "Uniform-response actions: the non-enumerating branch is documented in-line as a do-not-add-an-error-branch guard rail"
    - "Consent gates the Google prompt rather than following it, so the social path cannot be the cheaper way to hold an account having agreed to nothing"
    - "Client-supplied consent version is checked against the server constant, never trusted"
    - "Tenant-scoped list components apply NO account filter — RLS is the boundary, and the test runs the component's exact query through the anon key"
    - "`next` / redirect targets validated to be same-origin relative paths before use"

key-files:
  created:
    - "app/(auth)/login/page.tsx"
    - "app/(auth)/reset-password/page.tsx"
    - "app/(auth)/components/login-form.tsx"
    - "app/(auth)/components/password-reset-forms.tsx"
    - "app/(auth)/components/GoogleOneTap.tsx"
    - "app/auth/confirm/route.ts"
    - "app/(dashboard)/venues/page.tsx"
    - "app/(dashboard)/components/VenueSwitcher.tsx"
    - "app/(dashboard)/components/venue-switcher-menu.tsx"
    - "components/field-error.tsx"
    - "components/venue-form.tsx"
    - "components/ui/dropdown-menu.tsx"
    - "supabase/templates/recovery.html"
    - "tests/auth/login-reset.test.ts"
    - "tests/auth/google-consent.test.ts"
    - "tests/venues/multi-venue.test.ts"
    - ".planning/phases/01-multi-tenant-foundation/deferred-items.md"
  modified:
    - "actions/auth.ts"
    - "lib/copy.ts"
    - "lib/validation/auth.ts"
    - "app/(auth)/signup/page.tsx"
    - "app/(dashboard)/layout.tsx"
    - "supabase/config.toml"
    - "supabase/seed.sql"
    - "tests/rls/setup.ts"
    - ".env.example"

key-decisions:
  - "The recovery email links to the APP (/auth/confirm?token_hash=…), not to GoTrue's /auth/v1/verify — the stock link hands the session back in a URL fragment or as a PKCE code, neither of which an SSR app can reliably act on"
  - "A custom GoTrue recovery template is therefore load-bearing, and it is LOCAL-ONLY: a hosted project must paste the same body into Authentication → Email Templates or its reset links revert to the fragment behaviour"
  - "content_path in [auth.email.template.*] resolves against the CLI's working directory (repo root), not against supabase/ — './templates/recovery.html' fails to start the stack"
  - "The reset page branches on ?stage=set (set by /auth/confirm after redeeming a token), not on session presence, so a signed-in owner is not handed a change-password form merely for visiting the URL"
  - "ensureAccount validates the submitted terms version against the server TERMS_VERSION — a consent version the browser chose is not consent evidence"
  - "Google One Tap gates the prompt behind the consent checkbox rather than recording consent after sign-in (D-21 parity)"
  - "The venue switcher is mounted in the dashboard shell sidebar, not the page header: the layout has no current-venue id and the venue page header already shows name + currency"
  - "The switcher deliberately applies no account_id filter; the multi-venue test asserts the boundary through the anon key instead (T-02-03)"
  - "/venues was added as the post-login landing route, because 'log in' has no single destination — an owner with no venue (the Google case) needs venue creation, not an empty dashboard"

patterns-established:
  - "Emailed-link auth: Route Handler + token_hash + custom template + open-redirect-guarded `next`"
  - "Non-enumerating auth surfaces: one shared error string, uniform success shape, asserted in test rather than described in prose"
  - "Consent parity across auth providers, enforced by a DB precondition (create_venue refuses without an accounts row) rather than by remembering to call something"

requirements-completed: []

coverage:
  - id: D10
    description: "An owner recovers a lost password end to end through the real emailed-link path — request, read the link from the mail server, redeem the token, set a new password, sign in with it — and the old password stops working"
    requirement: "ACCT-01"
    verification:
      - kind: integration
        ref: "tests/auth/login-reset.test.ts#recovers a lost password through the emailed link and signs in with the new one"
        status: pass
    human_judgment: false
  - id: D11
    description: "A password-reset request for an unregistered or typo'd email is indistinguishable from one for a real account — no account-enumeration oracle"
    requirement: "ACCT-01"
    verification:
      - kind: integration
        ref: "tests/auth/login-reset.test.ts#answers an unregistered email exactly as it answers a registered one (T-02-01)"
        status: pass
    human_judgment: false
  - id: D12
    description: "Owner sign-in works with email + password, and a wrong password produces the same message as an unknown account"
    requirement: "ACCT-01"
    verification:
      - kind: integration
        ref: "tests/auth/login-reset.test.ts#signs an owner in with email + password, and rejects a wrong password (E2)"
        status: pass
      - kind: unit
        ref: "tests/auth/login-reset.test.ts#rejects reset and login input at the Zod boundary before any auth call"
        status: pass
    human_judgment: false
  - id: D13
    description: "A first-time Google owner cannot create data before consent is recorded: create_venue refuses without an accounts row, ensure_account is the only way to get one, and it refuses a blank terms version"
    requirement: "ACCT-01"
    verification:
      - kind: integration
        ref: "tests/auth/google-consent.test.ts#refuses venue creation until ensure_account has recorded the accounts row + consent"
        status: pass
      - kind: integration
        ref: "tests/auth/google-consent.test.ts#refuses to record consent with no version, so the Google path cannot stamp an empty agreement"
        status: pass
    human_judgment: false
  - id: D14
    description: "Google One Tap is wired to Supabase Auth with a hashed nonce and FedCM, and renders inertly without NEXT_PUBLIC_GOOGLE_CLIENT_ID so build and the full suite run in a clean environment"
    verification:
      - kind: integration
        ref: "pnpm build with no Google client id present — /login compiles and prerenders as static"
        status: pass
      - kind: other
        ref: "grep: GoogleOneTap.tsx contains signInWithIdToken and use_fedcm_for_prompt; early `if (!clientId) return null`"
        status: pass
    human_judgment: true
    rationale: "The LIVE One Tap round-trip is unverifiable here — it needs a real Google OAuth client id plus the provider (client id AND secret) enabled in Supabase Auth. Both are user actions. See ## User Setup Required; this is the one truth in the plan that automated verification cannot reach."
  - id: D15
    description: "The multi-venue switcher lists exactly the owner's venues in created_at order, never another owner's, in both directions, and a single-venue owner's list is what hides the switcher (D-15)"
    requirement: "ACCT-03"
    verification:
      - kind: integration
        ref: "tests/venues/multi-venue.test.ts#shows owner A exactly their two venues, in created_at order"
        status: pass
      - kind: integration
        ref: "tests/venues/multi-venue.test.ts#never lists another owner's venue in owner A's switcher"
        status: pass
      - kind: integration
        ref: "tests/venues/multi-venue.test.ts#gives a single-venue owner exactly one row, which is what hides the switcher (D-15)"
        status: pass
    human_judgment: false
  - id: D16
    description: "A venue name longer than the ~28-character display limit round-trips intact through storage and the switcher query, so truncation is purely a display concern"
    requirement: "ACCT-03"
    verification:
      - kind: integration
        ref: "tests/venues/multi-venue.test.ts#still shows two rows after a venue is renamed to something very long (E5 long-text)"
        status: pass
    human_judgment: true
    rationale: "UI-SPEC records the E4/E5 ellipsis itself as `verification: backstop` — a held-out visual check. The test proves the data is not truncated; whether the CSS ellipsis actually renders needs eyes."
  - id: D17
    description: "The login form (E2) and both reset stages render per the design contract: unfilled two-field card by default, submit spinner + disable, contract error copy, values preserved with per-field Zod messages on a rejected submit"
    verification:
      - kind: integration
        ref: "pnpm build — /login prerenders static, /reset-password compiles as dynamic"
        status: pass
    human_judgment: true
    rationale: "Spacing rhythm, focal anchor, the accent appearing only on the primary CTA and the spinner transition are judgments a build cannot make. `pnpm dev` was deliberately not run (it never exits); human_verify_mode is end-of-phase, so this batches into the phase-end gate alongside plan 01-01's outstanding D8/D9."

# Metrics
duration: 30min
completed: 2026-07-27
status: complete
---

# Phase 1 Plan 02: Owner Auth Completion Summary

**Password recovery proven end to end against a real mailbox, Google One Tap with consent parity enforced by a database precondition rather than by remembering to call something, and an RLS-scoped multi-venue switcher — 10 new client-SDK assertions, 28 green in the suite.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-07-27T10:05Z
- **Completed:** 2026-07-27T10:35Z
- **Tasks:** 3 of 3
- **Files changed:** 25 files, +2144 / −219

## Accomplishments

- **Password recovery is proven through the real emailed link, not around it.** The test requests the reset through the anon key, polls Mailpit's HTTP API (`/api/v1/search`, `/api/v1/message/{id}`) for the mail GoTrue actually sent, pulls the token out of the link body, redeems it, sets a new password, signs in with it, and asserts the old password is dead. `admin.generateLink()` would have been one line and would have skipped exactly the two things that were broken: whether the mail sends at all, and whether the link inside it carries something the app can act on.
- **Both of those things *were* broken, and only this path found them.** The committed dev seed wrote `NULL` into GoTrue's token columns, so `/recover` for `owner@cena.local` returned HTTP 500 — the local dev account could not exercise password reset at all, while password *login* worked fine and hid it. And GoTrue's stock recovery template links to its own `/auth/v1/verify`, which returns the session in a URL fragment the server never sees. Both are fixed; see Deviations.
- **Consent parity for Google owners is structural, not procedural.** A Google owner never passes through `signUpOwner`, so at the instant their session exists they have a valid identity, no `accounts` row and no recorded agreement. Rather than trusting a future caller to remember `ensureAccount`, the guard is that `create_venue` refuses without an accounts row and `ensure_account` refuses a blank version — so the gate can only be satisfied, not forgotten. The test walks that in three ordered steps.
- **`ensureAccount` does not trust the version the browser sends.** The plan's signature is `ensureAccount(consentVersion)`; the implementation compares it to the server's `TERMS_VERSION` and refuses a mismatch. Consent evidence whose wording the client chose is not evidence — a browser could otherwise stamp an account with a version that was never displayed.
- **The venue switcher has no tenant filter, on purpose, and the test is what makes that safe.** There is no `.eq('account_id', …)` in `VenueSwitcher.tsx`; the `venues` RLS policies are the boundary. A filter there would look like belt-and-braces while quietly moving the boundary into the UI layer where a refactor can drop it. `tests/venues/multi-venue.test.ts` runs the component's byte-for-byte query as two different signed-in owners through the anon key, in both directions.
- **The suite still runs in a clean environment.** `GoogleOneTap` returns `null` without `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, so `pnpm build` and all 28 tests pass with no Google configuration anywhere — which is what the D-25 release gate needs, since a signed Google ID token can only come from Google.

## Task Commits

1. **Task 1 (tracer, TDD): end-to-end password reset** — `93c3989` (test, RED) then `d60b04d` (feat, GREEN)
2. **Task 2: Google One Tap + first-owner consent path** — `8def469` (feat)
3. **Task 3: minimal multi-venue switcher** — `91403a4` (feat)

**Tracer gate:** re-run after the GREEN commit and before any expansion task — `tests/auth/login-reset.test.ts` 4/4 green. `human_verify_mode` is `end-of-phase`, so the tracer's visual check batches into the phase-end gate rather than stopping the wave.

**Plan metadata:** committed with this SUMMARY.

## Files Created/Modified

**Auth flow**
- `actions/auth.ts` — added `signInOwner`, `requestPasswordReset`, `completePasswordReset`, `ensureAccount`, and a `requestOrigin()` helper that derives the reset redirect from the incoming request (so the same code works on localhost, a Vercel preview and production)
- `app/auth/confirm/route.ts` — redeems `token_hash`+`type` via `verifyOtp`, or `code` via `exchangeCodeForSession`; rejects any `next` that is not a same-origin relative path; on failure redirects to `/reset-password?expired=1` with no detail, so an expired and a forged link answer identically
- `supabase/templates/recovery.html` — the recovery mail, linking into the app with `{{ .TokenHash }}`
- `supabase/config.toml` — registers that template; widens `additional_redirect_urls`
- `lib/validation/auth.ts` — `signInOwnerSchema`, `requestPasswordResetSchema`, `completePasswordResetSchema`, and the route/stage constants shared by the action, the route handler and the page
- `lib/copy.ts` — `COPY.cta.logIn` / `requestPasswordReset` / `completePasswordReset` / `continueWithGoogle`, plus `COPY.passwordReset.*`

**UI**
- `app/(auth)/login/page.tsx` + `app/(auth)/components/login-form.tsx` — UI-SPEC E2
- `app/(auth)/reset-password/page.tsx` + `app/(auth)/components/password-reset-forms.tsx` — both stages on one route
- `app/(auth)/components/GoogleOneTap.tsx`
- `components/field-error.tsx`, `components/venue-form.tsx` — lifted out of the signup page so `/venues` and the auth forms share one treatment
- `app/(auth)/signup/page.tsx` — now composes `VenueForm` / `FieldError`; adds a link to `/login`
- `app/(dashboard)/layout.tsx` — mounts the switcher in the shell sidebar
- `app/(dashboard)/components/VenueSwitcher.tsx` (RSC) + `venue-switcher-menu.tsx` (client)
- `app/(dashboard)/venues/page.tsx` — post-login landing
- `components/ui/dropdown-menu.tsx` — shadcn, no new npm dependency

**Database / local stack**
- `supabase/seed.sql` — empty-string auth token columns (see Deviations)

**Tests**
- `tests/auth/login-reset.test.ts` — 4 assertions (recovery, enumeration, login, Zod)
- `tests/auth/google-consent.test.ts` — 2 assertions
- `tests/venues/multi-venue.test.ts` — 4 assertions
- `tests/rls/setup.ts` — `createGoogleUser` fixture

**Config**
- `.env.example` — documents `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (optional) and `NEXT_PUBLIC_SITE_URL` (optional), including the half of the Google setup that only Supabase Auth can hold

## Decisions Made

- **`/reset-password` branches on `?stage=set`, not on "is anyone signed in".** The confirm route appends the flag only after a token has been redeemed. Branching on session presence would hand a change-password form to any owner who merely navigated to the URL with a live session — a different feature, wearing recovery's clothes.
- **`/venues` exists because "log in" has no single destination.** An owner with venues wants their dashboard; an owner with none needs venue creation. A Google One Tap owner is exactly the second case, because Supabase Auth hands them a session without their ever seeing the signup screen — so without this route the social path dead-ends on an empty dashboard. This is why `VenueForm` was extracted rather than left inline in the signup page.
- **The switcher lives in the sidebar, not the page header.** The plan says "wire it into the venue dashboard header (`app/(dashboard)/layout.tsx`)", but the layout has no header — and no access to the current venue id, which the switcher's trigger needs. The venue page already owns a header showing that venue's name and currency, so a second bar above it would say the same thing twice. The sidebar placement keeps the plan's real property (server-rendered in the shell, no async load or error state per UI-SPEC E5) and drops only the literal position.
- **`createGoogleUser` gives its fixture a password.** A real Google user has none, and no test can mint a signed Google ID token. The password is how the test *acquires a session*; what is under test is the state a Google-first owner is actually in when their session first exists (provider metadata present, `accounts` row absent) and whether the product refuses to let them write. The fixture comment says so, because a future reader could otherwise mistake it for the flow being tested.
- **`created_at` ordering is asserted with a deliberate 15 ms gap between the two fixture inserts.** Two inserts inside the same millisecond would make the ordering assertion vacuous — it would pass on whatever order Postgres happened to return.

## Deviations from Plan

### Standing phase-01 deviations (applied, per the dispatch brief)

**1. pnpm, not npm.** `pnpm add` / `pnpm exec` throughout; `pnpm exec shadcn add dropdown-menu`, never `pnpm dlx tsc`. `pnpm-lock.yaml` unchanged (no new npm dependency was needed); no `package-lock.json` exists. The plan's literal `npx vitest run` / `npm run build` verify blocks were read as `pnpm exec vitest run` / `pnpm build`.
**2. `proxy.ts`, not `middleware.ts`.** Not touched by this plan — no change was needed.
**3. Never `npx tsc`.** All typechecks were `pnpm exec tsc --noEmit`.
**4. New public entities need explicit GRANTs.** N/A — this plan added no tables, no migration and no new RPC. It only calls `ensure_account` and `create_venue`, which already carry their grants from migration 0001.
**5. shadcn `radix-nova`, no `form` component.** Both reset forms, the login form and the extracted `VenueForm` use React 19 `useActionState` + server-side Zod, as plan 01-01 established. `components.json` untouched.
**6. Never `pnpm dev`.** Verification was `supabase db reset` → `supabase gen types typescript --local` → `pnpm exec vitest run` → `pnpm exec tsc --noEmit` → `pnpm build`.
**7. Regenerate `lib/database.types.ts` after any migration.** Regenerated anyway as a drift check; the file is byte-identical, which is the expected result for a plan with no schema change.

### Auto-fixed issues

**8. [Rule 1 - Bug] The dev seed produced an owner GoTrue answered HTTP 500 for**
- **Found during:** Task 1, probing `/auth/v1/recover` before writing the test.
- **Issue:** `supabase/seed.sql` inserted `auth.users` without `confirmation_token`, `recovery_token`, `email_change`, `email_change_token_new`, `email_change_token_current`, `phone_change`, `phone_change_token` or `reauthentication_token`, leaving them `NULL`. GoTrue scans those columns into Go `string`, not `*string`, so any code path that loads the user fails with `Scan error on column index 3, name "confirmation_token": converting NULL to string is unsupported` and returns 500. Password sign-in happens to avoid that path — which is why the seeded owner logged in perfectly while **password reset was completely broken for the only account a developer actually uses**.
- **Fix:** insert `''` for each, matching what GoTrue's own `admin.createUser` writes. Comment explains the mechanism so a future seed does not reintroduce it.
- **Verification:** `/recover` for `owner@cena.local` now returns 200 and the mail lands in Mailpit.
- **Committed in:** `d60b04d`

**9. [Rule 1 - Bug] GoTrue's stock recovery link cannot work in a server-rendered app**
- **Found during:** Task 1.
- **Issue:** the default template links to `{{ .ConfirmationURL }}` → `/auth/v1/verify`, which consumes the token and then bounces the browser to the app with the session either in the URL **fragment** (invisible to the server) or as a PKCE `code` whose verifier lives in whichever client requested the reset. The plan assumed the app could "branch on the recovery token in the URL"; with the stock template there is no token in the URL by the time the app sees it.
- **Fix:** `supabase/templates/recovery.html` links to `/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`, and `app/auth/confirm/route.ts` redeems it with `verifyOtp` server-side. The `code` branch is retained so a deployment that has not customised its templates still works.
- **Carry forward:** this is a **local-only** configuration. A hosted project needs the same body pasted into Authentication → Email Templates. Recorded under User Setup Required.
- **Committed in:** `d60b04d`

**10. [Rule 3 - Blocking] `content_path` resolves against the repo root, not `supabase/`**
- **Found during:** Task 1 — `supabase stop` refused to run: `Invalid config for auth.email.template.recovery.content_path: open templates/recovery.html: no such file or directory`.
- **Issue:** the config file's own commented examples are inconsistent (`./supabase/templates/invite.html` vs `./templates/password_changed_notification.html`). The path is resolved against the CLI's working directory.
- **Fix:** `./supabase/templates/recovery.html`, with a comment recording the trap.
- **Committed in:** `d60b04d`

**11. [Rule 3 - Blocking] `additional_redirect_urls` only allowed the https dev origin**
- **Found during:** Task 1 — the emailed link's `redirect_to` came back as bare `http://127.0.0.1:3000`, silently dropping the `/reset-password` path.
- **Issue:** the scaffold default was `["https://127.0.0.1:3000"]` (https, and no wildcard). GoTrue **silently falls back to `site_url`** for any `redirect_to` outside the allow-list, so a misconfiguration presents as a broken reset link rather than as an error.
- **Fix:** `http://127.0.0.1:3000/**`, `http://localhost:3000/**`, `https://127.0.0.1:3000/**`.
- **Committed in:** `d60b04d`

**12. [Rule 2 - Missing Critical] `ensureAccount` validates the consent version instead of trusting it**
- **Issue:** the plan's signature takes `consentVersion` from the caller and passes it to `ensure_account`. That action is invoked from a Client Component, so a browser could stamp an account with any string — including a version that was never shown. GDPR consent evidence the subject's own browser authored is not evidence.
- **Fix:** compare against the server-side `TERMS_VERSION` and refuse a mismatch. The plan's signature is preserved.
- **Committed in:** `d60b04d` (action) / `8def469` (caller)

**13. [Rule 2 - Missing Critical] Open-redirect guard on the confirm route's `next`**
- **Issue:** `/auth/confirm?next=…` forwards wherever `next` points. Unguarded, the recovery link becomes an open redirect that arrives **pre-trusted in the owner's inbox** — the highest-credibility delivery vector a phishing redirect can have.
- **Fix:** `next` must start with `/` and not `//`; anything else falls back to `/reset-password`.
- **Committed in:** `d60b04d`

**14. [Rule 2 - Missing Critical] Consent gates the Google prompt rather than following it**
- **Issue:** the plan says to "surface the Terms & Privacy consent checkbox alongside the One Tap prompt". Read literally — prompt first, record consent after — Google sign-in becomes the cheaper way to end up with an account having agreed to nothing, and it *works*, so nobody notices.
- **Fix:** One Tap is not initialised until the checkbox is ticked, and `ensureAccount` runs before any navigation. The cost is that a returning Google owner re-ticks the box each time; that was preferred over a path with weaker consent than email signup (D-21).
- **Committed in:** `8def469`

**15. [Rule 1 - Bug] Login had no destination for an owner with no venue**
- **Issue:** the plan's login form has nowhere to send an owner who has signed in but owns no venue — precisely the Google One Tap owner, who never sees the signup screen's venue step. Sending them to a `[venueId]` dashboard is impossible (there is no id) and `/signup` would show them the account form again.
- **Fix:** `/venues` redirects to their first venue (RLS-scoped, `created_at` order) or renders venue creation. Required extracting `VenueForm` and `FieldError` out of `app/(auth)/signup/page.tsx` — behaviour-identical, no logic changed, so both call sites share one form rather than a near-copy that drifts.
- **Committed in:** `d60b04d`

### Additive files not listed in the plan

**16. [Rule 2] Six supporting files**
- `app/auth/confirm/route.ts` — see deviation 9. A Route Handler, because redeeming the token **writes the session cookie** and `lib/supabase/server.ts`'s `setAll` deliberately swallows cookie writes during Server Component render.
- `supabase/templates/recovery.html` — see deviation 9.
- `app/(dashboard)/venues/page.tsx` — see deviation 15.
- `app/(dashboard)/components/venue-switcher-menu.tsx` — `VenueSwitcher` must be a Server Component to do an RLS read, and the Radix dropdown must be a Client Component. One file cannot be both.
- `app/(auth)/components/login-form.tsx`, `app/(auth)/components/password-reset-forms.tsx` — `useActionState` needs a Client Component; the pages stay server-rendered (`/reset-password` reads `searchParams`).
- `components/field-error.tsx`, `components/venue-form.tsx` — see deviation 15.

**17. [Rule 2] `.env.example` documents both halves of the Google setup.** The client id alone does nothing: Supabase Auth also needs the client id **and secret** to verify the ID token, and `skip_nonce_check` must stay `false` or the hashed nonce stops protecting anything. A developer given only `NEXT_PUBLIC_GOOGLE_CLIENT_ID` would get a prompt that fails at the exchange.

**18. [Rule 2] `NEXT_PUBLIC_SITE_URL` is optional, not required.** The reset redirect is derived from the incoming request headers, so localhost and Vercel previews work with no configuration; the env var is the override for a proxy whose public origin differs.

---

**Total deviations:** 18 — 7 standing phase-01 overrides, 4 Rule 1/3 bug and blocking fixes, 4 Rule 2 security/correctness additions, 3 additive-support entries.
**Impact on plan:** no scope creep. Every fix was required for correctness (seed 500, template path, redirect allow-list, missing post-login destination) or security (consent-version trust, open redirect, consent ordering). Two of the plan's literal instructions could not be followed as written and were satisfied in substance: "branch on the recovery token in the URL" (the stock template leaves no token for the app to see — deviation 9) and "wire the switcher into the venue dashboard header in layout.tsx" (that file has no header and no current-venue id — see Decisions).

## Known Stubs

| Stub | File | Reason / resolving plan |
|---|---|---|
| Google One Tap is present but **cannot function** without `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and the Google provider enabled in Supabase Auth. With neither set, `GoogleOneTap` renders `null` — so today `/login` offers email+password only. | `app/(auth)/components/GoogleOneTap.tsx` | Deliberate: a fake client id fails at the token exchange, which is strictly worse than not offering the option. **This is a user-setup gap, not a code gap** — the component, the nonce flow and the consent path are complete and the consent half is test-covered. See ## User Setup Required. Blocks the D-01 "sign in with Google" truth from being *observed*, not from being *built*. |
| The recovery email template is wired up for the **local stack only** (`supabase/config.toml`). A hosted project falls back to GoTrue's stock template, whose link returns the session in a URL fragment `/auth/confirm` cannot read. | `supabase/config.toml`, `supabase/templates/recovery.html` | Cannot be fixed from code — hosted email templates live in the dashboard. Listed under User Setup Required. Password reset would appear to "do nothing" in production until it is done. |
| Consent checkbox still links to `/legal/terms` and `/legal/privacy`, **neither route exists** — and Google One Tap now renders the same two dead links. | `lib/copy.ts`, `app/(auth)/signup/page.tsx`, `app/(auth)/components/GoogleOneTap.tsx` | **Carried forward unresolved from plan 01-01, and now worse: this plan added a second surface asking owners to agree to documents they cannot read.** No plan in phase 01 builds these pages. Needs a phase-01 follow-up or an explicit backlog item. |
| Sidebar nav items *Staff*, *Devices*, *Settings* still render disabled. | `components/dashboard-nav.tsx` | Unchanged from 01-01; plans 01-03/04/05 each flip one flag. Self-resolving. |
| `app/page.tsx` is still the default create-next-app landing page. | `app/page.tsx` | Unchanged from 01-01. No plan in phase 01 specifies a root page. |

No `TODO`/`FIXME` markers were introduced, no tests are skipped, and every `<verify>` block in the plan was run. `.planning/WINDOWS.md` does not exist in this repo, so these entries live here only — surfaced for the verifier and for `/gsd-ship`.

## Threat Flags

Two new surfaces were created that are **not** in the plan's threat register. Both are mitigated; flagged because the register should name them.

| Flag | File | Description |
|------|------|-------------|
| threat_flag: open-redirect | `app/auth/confirm/route.ts` | A new GET endpoint that forwards to a caller-supplied `next` parameter, reached from a link delivered by email. Mitigated (deviation 13): `next` must be a same-origin relative path. Worth a register entry because the phishing value of a redirect that arrives inside a legitimate Cena email is unusually high. |
| threat_flag: token-in-URL | `app/auth/confirm/route.ts`, `supabase/templates/recovery.html` | The recovery token now transits as a query parameter to the **app's** origin, so it appears in Next.js server logs and in any reverse-proxy access log. Previously it only reached GoTrue. Mitigated by single use and a one-hour expiry; worth naming because log retention is the residual risk, not interception. |

Mitigations for the plan's own register, verified in place:
- **T-02-01** — `requestPasswordReset` returns `status: "sent"` on every path except a malformed address, with an in-line guard-rail comment against adding an error branch; asserted by `login-reset.test.ts`. The login form shares one error string for wrong-password and unknown-account, also asserted.
- **T-02-02** — hashed nonce to Google, raw nonce to Supabase Auth (`signInWithIdToken`), `use_fedcm_for_prompt: true`. Note that this protection depends on `skip_nonce_check` staying `false` in `[auth.external.google]`, which `.env.example` calls out.
- **T-02-03** — the switcher reads through the caller's cookie-bound session with no `account_id` filter; `multi-venue.test.ts` asserts both directions of isolation through the anon key.
- **T-02-04** — `create_venue` refuses without an `accounts` row and `ensure_account` refuses a blank version, so the Google path cannot produce a tenant with no consent on record; both asserted.

## Issues Encountered

- **`[auth.rate_limit] email_sent = 2`/hour looked like it would break a repeatable reset test.** It does not: the limit applies only when `auth.email.smtp` is configured, and the local Mailpit capture bypasses it. Verified by sending three recovery mails in a row and counting three in the mailbox. **No config change was made** — worth recording, because raising it "just in case" would have silently diverged local from production.
- **`node_modules` was absent in the worktree**, so the first `pnpm exec vitest` failed with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL / Command "vitest" not found` — a confusing error for a missing install. `pnpm install` fixed it; `pnpm-lock.yaml` was unchanged, confirming the lockfile is complete.
- **`.env.local` does not exist in a fresh worktree** (correctly gitignored). Recreated from `supabase status` output; **not committed**.
- **The stack had to be stopped and restarted**, not just `db reset`, for the new `[auth.email.template.recovery]` block to take effect — `db reset` does not re-read GoTrue's config.
- **`pnpm lint` is red on arrival: 585 errors, 189 warnings, every one of them inside `.claude/**`** (GSD's own vendored `.cjs` tooling). Filtering to non-`.claude` paths returns zero problems, so all application code is lint-clean. Left alone as out of scope and logged to `deferred-items.md` with a one-line suggested fix (`ignores: [".claude/**"]` in `eslint.config.mjs`).

## User Setup Required

Two items, in priority order. Neither blocks the merge; the first blocks a truth from being *observed*, the second blocks production behaviour.

**1. Google OAuth — required before "sign in with Google" does anything (D-01).** Both halves are needed:
   - Google Cloud Console → APIs & Services → Credentials → **Create OAuth 2.0 Client ID** (type: Web application). Authorised JavaScript origin: your app origin (e.g. `http://localhost:3000`). Put the client ID in `.env.local` as `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
   - Give Supabase Auth the same client ID **and its secret**, so it can verify the ID token: locally in `supabase/config.toml` under `[auth.external.google]`, or hosted under Authentication → Providers → Google. Leave `skip_nonce_check = false` — that check is what makes the token non-replayable (T-02-02).

   Until this is done `/login` shows email+password only. **I did not invent a placeholder client id**: a fake one produces a prompt that fails at the exchange, which is a worse failure than the option being absent.

**2. Hosted recovery email template — required before password reset works in production.** Paste the body of `supabase/templates/recovery.html` into Authentication → Email Templates → Reset Password in the hosted project. Without it, hosted reset links go to GoTrue's `/auth/v1/verify` and return the session in a URL fragment that `/auth/confirm` cannot read — the owner lands on a page that appears to do nothing.

**To run locally after merge:**
1. `pnpm install`
2. `supabase start` (a full `stop`/`start` is needed after any `[auth.*]` config change — `db reset` alone does not re-read GoTrue's config)
3. Copy `.env.example` to `.env.local` and fill in the three Supabase values from `supabase status`
4. `supabase db reset`
5. `pnpm exec vitest run` — 28/28 should pass
6. `pnpm dev`, then visit `/login`, `/reset-password` and `/signup` — **the outstanding manual smoke test** (D14/D16/D17). Local dev sign-in: `owner@cena.local` / `cena-dev-password`. That owner has two venues, so the switcher is visible; reset mail lands at http://127.0.0.1:54324.

## Next Phase Readiness

**Ready.** Plans 01-03, 01-04 and 01-05 build on an unchanged schema — this plan added no migration — and on the same client factories and Vitest harness.

**Five things later plans in this phase must know:**

1. **`/venues` is the post-login landing route.** Anything that needs a "back to the dashboard" destination should use it rather than constructing a `[venueId]` URL it may not have.
2. **`components/venue-form.tsx` and `components/field-error.tsx` are the shared form pieces.** `FieldError` in particular: do not re-declare it locally, as the signup page originally did.
3. **`app/auth/confirm/route.ts` already handles `token_hash`+`type` and `code`.** Any later emailed-link flow (staff invite, email change) should add a template pointing at it rather than a second route — and will need the matching `[auth.email.template.*]` block, remembering that `content_path` resolves from the repo root.
4. **The `venues` RLS policies now have a second consumer** (the switcher, plus `/venues`), neither of which filters by `account_id`. Plan 01-05's role × venue matrix should treat `tests/venues/multi-venue.test.ts` as part of the surface it must not widen.
5. **A full `supabase stop && supabase start` is required after touching any `[auth.*]` config**; `db reset` will not pick it up, and the symptom is a stale template or rate limit rather than an error.

**Three open items:**

- **`/legal/terms` and `/legal/privacy` still do not exist**, and this plan added a second consent surface pointing at them. This is the one item I would escalate: it is legal-facing, it is now worse than it was after 01-01, and no plan in phase 01 fixes it.
- **The Google live round-trip is unverified** pending user setup (item 1 above). Everything around it — nonce flow, inert render, consent path — is built and, for the consent half, test-covered.
- **Visual UAT is outstanding for D14/D16/D17** (login form, both reset stages, switcher dropdown, long-name ellipsis), joining plan 01-01's D8/D9 at the end-of-phase gate. `pnpm dev` was deliberately not run.

## Self-Check: PASSED

- All 17 created and 9 modified files listed above are present and tracked (`git ls-files`), including every entry in the plan's `files_modified` — with `VenueSwitcher.tsx` accompanied by its client half and the auth pages by their form components, per deviation 16.
- All 4 task commits exist on `worktree-agent-a18905f89acf3ff56`, forked from `7c5d042`: `93c3989`, `d60b04d`, `8def469`, `91403a4`.
- No commit in this plan deleted a tracked file (`git diff --diff-filter=D` empty across `7c5d042..HEAD`).
- Working tree clean before this SUMMARY; no `package-lock.json`; `pnpm-lock.yaml` unchanged; `.env.local` created locally and correctly untracked.
- Final gate re-run green: `supabase db reset` → `supabase gen types typescript --local` (no drift) → **28/28 tests** → `tsc --noEmit` clean → `pnpm build` succeeds with `/login` static and `/auth/confirm`, `/reset-password`, `/venues` dynamic.
- Plan verification greps confirmed: `GoogleOneTap.tsx` contains `signInWithIdToken` and `use_fedcm_for_prompt`; `actions/auth.ts` contains `ensure_account`; `tests/auth/login-reset.test.ts` contains the mailer `api/v1` endpoints and no `generateLink`.
- `STATE.md` and `ROADMAP.md` were **not** modified (orchestrator-owned). `REQUIREMENTS.md` deliberately untouched: ACCT-01 and ACCT-03 are also claimed by plans 01-04 and 01-05, and ACCT-01's Google half is not observable until the user completes the OAuth setup — marking either complete here would be premature.

---
*Phase: 01-multi-tenant-foundation*
*Completed: 2026-07-27*

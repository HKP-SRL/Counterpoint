---
phase: 01-multi-tenant-foundation
reviewed: 2026-08-04T00:00:00Z
depth: standard
scope: gap-closure round 3 (plans 01-14, 01-15, 01-16) vs 5848ef8
files_reviewed: 18
files_reviewed_list:
  - app/(auth)/components/GoogleOneTap.tsx
  - app/(auth)/signup/page.tsx
  - app/(dashboard)/components/venue-switcher-menu.tsx
  - app/(dashboard)/layout.tsx
  - app/(dashboard)/venues/[venueId]/staff/devices/page.tsx
  - app/(dashboard)/venues/new/page.tsx
  - components/dashboard-nav.tsx
  - components/venue-form.tsx
  - lib/copy.ts
  - lib/venue-routes.ts
  - tests/actions/create-venue-action.test.ts
  - tests/auth/google-affordance.test.tsx
  - tests/lib/create-venue-affordance.test.tsx
  - tests/lib/google-affordance-coverage.test.ts
  - tests/lib/unconditional-cta-coverage.test.ts
  - tests/lib/venue-routes.test.ts
  - tests/rls/device-reenroll.test.ts
  - tests/venues/second-venue-route.test.ts
findings:
  critical: 2
  warning: 8
  info: 8
  total: 18
status: issues_found
---

# Phase 01: Code Review Report (gap-closure round 3 — plans 01-14, 01-15, 01-16)

**Reviewed:** 2026-08-04
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

This supersedes the 2026-07-29 review (round 2, plans 01-11..01-13, 1 critical +
8 warnings). That report's CR-01 (venue-detail page reporting a database fault as
a 404) and WR-08 (no route error boundary) were verified closed in current source
by commits `f29ece0` and `8487bfd` and are not re-reported. Plan 01-17 was
documentation-only and contributes no source files; its one consequence for this
code appears as WR-06.

## Summary

Round 3 closes three gaps: a route to a second venue (01-14), a clickable Google
control (01-15), and an enrolment CTA hoisted out of the empty-state branch
(01-16). Two of the three land cleanly at the layer they were aimed at.

The third does not. **G-01-12's "second half" — the silent failure — is not
closed.** `GoogleOneTap` still has three paths that produce a completely empty
Google section with no error, and after this change one of them is *worse* than
before: ticking consent replaces the visible disabled button with an empty
container, so the owner's action makes the only Google-related thing on the page
disappear. `01-UAT.md:761` asserts "a suppressed prompt is surfaced through
`COPY.errors.googleUnavailable` instead of silence"; that claim does not hold for
the two most likely real-world causes (a blocked or failed GSI script, and an
absent `window.google`). Neither is reachable in the test suite, because
`next/script` is mocked to fire `onReady` unconditionally and `window.google` is
installed in `beforeEach`.

Separately, the device registry page — the file 01-16 edited — still binds only
`data` on its `venue_devices` read, so a PostgREST fault renders "No devices
enrolled". That is the defect class this same file's header comment condemns
twenty lines above it, and it is round 2's CR-01 wearing a different table name.

**The instruction to apply round 2's vacuity lens hard paid off once.** The two
AST guards are genuinely non-vacuous — `unconditional-cta-coverage` and
`google-affordance-coverage` each carry a fixture pair differing in exactly one
structural property, which no substring check or regex can pass, and each asserts
its declared list is non-empty and on-disk before the coverage loop. But
`tests/lib/create-venue-affordance.test.tsx`'s "marks no venue as current on the
create route" asserts `aria-current`, an attribute `venue-switcher-menu.tsx` sets
on no element on any path. It is `null === null`. And the predicate it was
written to pin is behaviourally inert in that component to begin with, because
`venues.find(v => v.id === "new")` already returns `undefined` (WR-01).

Checks that came back clean, recorded because they were the four the brief asked
for:

1. **The nonce binding survives the `renderButton` path.** `renderButton` is
   called after the single `initialize()` that carries `nonce: hashedNonce`, with
   no second `initialize` anywhere, so the drawn button inherits the binding
   rather than opening an unbound path. `generateNonce` matches Supabase's
   documented split exactly — raw base64 of 32 CSPRNG bytes to
   `signInWithIdToken`, hex SHA-256 of that same string to Google — and
   `tests/auth/google-affordance.test.tsx:266` computes the digest rather than
   inferring it from two variable names.
2. **Consent genuinely gates initiation.** `initialize` runs only inside an
   effect guarded by `acceptedTerms`, so nothing reaches Google pre-consent. D-21
   holds at the component layer, and the header's own note that this is UI
   ordering rather than a server-side control remains accurate and honest.
3. **`isVenueIdSegment` correctly excludes `new` in both readers** and is
   equality-based rather than prefix-based (`newcastle-bistro` is pinned as a
   valid id). It is only *load-bearing* in `dashboard-nav.tsx`; see WR-01 for the
   switcher.
4. **`/venues/new` accepts no account or venue identifier.** No `params`, no
   `searchParams`, no account id in the form. Authentication comes from the
   `(dashboard)` layout's `getUser()`; authorization is re-derived server-side in
   `createVenue` and again inside `public.create_venue()`. There is nothing on
   this route to tamper with. The one residual is that the shell gates on
   authentication only (WR-03).

## Critical Issues

### CR-01: Ticking consent when Google Identity Services is unavailable produces an empty section with no error — G-01-12's reported symptom, reproduced

**File:** `app/(auth)/components/GoogleOneTap.tsx:148-152`, `267-281`, `323-349`

**Issue:** Three distinct paths lead to "the owner ticked the box and nothing
happened", which is verbatim the UAT test 12 report this plan exists to close:

1. **The GSI script fails to load.** `<Script>` at line 345 declares `onReady`
   and no `onError`. When the bundle is blocked (ad blocker, enterprise proxy,
   network filtering, Google outage, offline), Next fires `onError`, never
   `onReady`, so `scriptReady` stays `false` and the effect at line 267 returns
   at its first guard. No error is set. `grep -rn "onError" app/ components/`
   returns nothing.
2. **`window.google` is absent or partially initialised.** Line 149,
   `if (!clientId || !window.google) return;`, returns *normally*. Because
   `startOneTap` resolves rather than rejects, the `.catch` at line 274 never
   runs and `COPY.errors.googleUnavailable` is never shown.
3. **The container ref is null.** Line 152, `if (!container) return;` — the same
   silent normal return.

In all three, `acceptedTerms` is already `true`, so the render branch at line 323
has swapped the visible `<Button disabled>` plus its `COPY.consent.googleGate`
explanation for `<div ref={buttonContainerRef} />` — an **empty div**. The owner
ticks the box and the Google surface vanishes. That is strictly worse than the
pre-consent state this same plan added, and it is a regression of the exact
symptom being fixed.

The suite cannot see any of it. `tests/auth/google-affordance.test.tsx:83-102`
mocks `next/script` with a component that fires `onReady` unconditionally on
mount, and line 163 installs `window.google` in `beforeEach`, so paths 1 and 2
are unreachable in every test in the file. The one negative case that exists —
"surfaces copy when the Google surface cannot initialise" (line 305) — covers
only a synchronous `throw` from `initialize`, which is the least likely of the
four failure modes and the only one the component actually handles.

**Fix:**

```tsx
// 1. Fail loudly when the sequence cannot start, so the effect's rejection
//    handler surfaces COPY.errors.googleUnavailable.
const startOneTap = useCallback(async () => {
  if (!clientId) return; // inert-by-configuration; handled by the null render

  if (!window.google) {
    throw new Error("Google Identity Services global is absent");
  }

  const container = buttonContainerRef.current;
  if (!container) {
    throw new Error("Google button container was not mounted");
  }
  // ...unchanged from here
}, [clientId, router]);
```

```tsx
// 2. Surface a script that never arrives at all.
<Script
  src="https://accounts.google.com/gsi/client"
  strategy="afterInteractive"
  onReady={() => setScriptReady(true)}
  onError={() => setError(COPY.errors.googleUnavailable)}
/>
```

Add regression coverage for both, or CR-01 recurs the next time this file is
touched: one test rendering with `delete (window as any).google` that asserts
`COPY.errors.googleUnavailable`, and one that drives the mocked `Script`'s
`onError` instead of `onReady`. Until those exist, `01-UAT.md:761`'s claim about
G-01-12's second half is unevidenced.

---

### CR-02: The device registry reports a read fault as "No devices enrolled" — on the page holding the D-08 revoke control

**File:** `app/(dashboard)/venues/[venueId]/staff/devices/page.tsx:71-78`

**Issue:**

```ts
const { data: devices } = await supabase
  .from("venue_devices")
  .select("id, label, enrolled_at, revoked_at")
  // ...
const registry = devices ?? [];
```

The `error` channel is discarded. PostgREST sets `data: null` *alongside* an
error, so a statement timeout, a JWT-expiry fault or any transport failure
collapses to `registry = []`, which renders `COPY.devices.emptyHeading` — "No
devices enrolled" — to an owner whose venue has tablets.

This is the identical defect that this file's own header condemns at lines 35-39
("Binding only `data` here reported a PostgREST fault to the legitimate owner as
'no such venue', and did it ABOVE the honest gate below") and that
`lib/venue-page-read.ts` was written to prevent. The `venues` read on line 40 was
routed through `resolveVenueRow`; the `venue_devices` read eight lines below it
was not. Lines 56-58 then state the rule the registry read breaks: "DELIBERATELY
NOT WRAPPED IN try/catch: a read fault must reach the Next error boundary as a
500."

The cost matches the incident this page is designed for. An owner whose tablet
has gone missing opens the registry during a backend hiccup, is told they have no
devices, and therefore has no `RevokeDeviceDialog` to press — while believing the
product told them the truth about their own device list. Because revoked rows are
retained by design (D-08), "the registry is empty" is legitimate *only* for a
venue that has never enrolled anything, which makes the misreport maximally
misleading.

This line is pre-existing (unchanged by the 01-16 diff) but is live in current
source, in a file in this review's scope, and it directly undermines the
affordance 01-16 hoisted: the enrolment CTA is now always visible, but the list it
sits beneath can silently lie about being empty.
`app/(dashboard)/venues/[venueId]/staff/page.tsx:70` carries the same shape for
`staff` and should be fixed in the same pass.

**Fix:**

```ts
const { data: devices, error: registryError } = await supabase
  .from("venue_devices")
  .select("id, label, enrolled_at, revoked_at")
  .eq("venue_id", venueId)
  .order("enrolled_at", { ascending: false })
  .order("id", { ascending: true });

// DELIBERATELY NOT try/caught: a read fault must reach the route error boundary
// as a 500. Reporting a broken read as an empty registry is the same lie CR-01
// told, with a different table name — and on the page that answers "which
// tablets can I still revoke".
if (registryError) {
  throw new Error(
    `DevicesPage: could not read the device registry for venue ${venueId}: ` +
      `${registryError.code ?? "unknown"} ${registryError.message}`,
  );
}

const registry = devices ?? [];
```

Consider a `resolveVenueRows` sibling in `lib/venue-page-read.ts` so the list
reads inherit the same discipline and it stays testable without a renderer or a
database — the same argument that module's own header makes for the single-row
case.

## Warnings

### WR-01: `isVenueIdSegment` is inert in the switcher, and the test written to pin it asserts an attribute the component never sets

**File:** `app/(dashboard)/components/venue-switcher-menu.tsx:37-46`; `tests/lib/create-venue-affordance.test.tsx:155-183`

**Issue:** Two problems that mask each other.

First, the call is behaviourally a no-op. `activeId` feeds exactly one
expression: `venues.find((venue) => venue.id === activeId)`. If the predicate
were deleted and `activeId` were the literal `"new"`, `find` would still return
`undefined` (no venue id is the word `new`), `?? venues[0]` would still fire, and
the rendered output would be byte-identical. Contrast `dashboard-nav.tsx`, where
removing the predicate genuinely produces four links into `/venues/new/staff`.

Second, the test that claims to pin it asserts nothing:

```tsx
const row = screen.getByRole("menuitem", { name: new RegExp(venue.name) });
expect(row.getAttribute("aria-current")).toBeNull();
```

`grep -n "aria-current" app/(dashboard)/components/venue-switcher-menu.tsx`
returns nothing — the component sets it on no element, on any path. The assertion
is `null === null`, and it passes identically against a component that treats
`new` as a venue id, against one that marks every row current, and against one
with the predicate removed entirely. That is the failure mode round 2 recorded
twice (WR-05 "guard passes vacuously", WR-06 "substring vacuity"), reappearing in
the file written to prove the affordance is real.

The sibling assertions in the same file are fine: the `DashboardNav` pair has a
genuine control (four items at a real venue path) against a genuine negative
(`container.innerHTML === ""` at the create route), and the create-link
assertions check a resolved `href`.

**Fix:** Either give the switcher a real current-venue treatment and assert it in
both directions, or replace the vacuous test with one that can fail. The minimal
honest version asserts the observable difference between the two paths:

```tsx
it("labels the trigger with the CURRENT venue on a venue path", async () => {
  mockState.pathname = `/venues/${TWO_VENUES[1].id}`;
  render(<VenueSwitcherMenu venues={TWO_VENUES} />);
  // Non-vacuous: this is venues[1], NOT the venues[0] fallback the create-route
  // case asserts. Removing the predicate, or the fallback, breaks one of the two.
  expect(
    screen.getByRole("button", { name: "Switch venue" }).textContent,
  ).toContain(TWO_VENUES[1].name);
});
```

paired with the existing create-route case (which asserts `venues[0]`).

---

### WR-02: `VenueSwitcherMenu` dereferences `active.name` with no guard for an empty venue list

**File:** `app/(dashboard)/components/venue-switcher-menu.tsx:46`, `60-64`

**Issue:** `const active = venues.find(...) ?? venues[0];` is `undefined` when
`venues` is `[]`, and lines 60-64 then read `active.name` (twice) and
`active.currency` unguarded. That is a `TypeError` that takes down the entire
dashboard shell on every route, because the switcher is rendered from
`app/(dashboard)/layout.tsx`.

Unreachable in product today — `VenueSwitcher` returns `null` for
`venues.length < 2` — but the invariant lives in a *different file*, the prop is
a plain `SwitchableVenue[]`, and nothing enforces it: no runtime check, no
non-empty tuple type, no test. The long comment at lines 40-45 discusses the
`?? venues[0]` fallback in detail without noting that `venues[0]` can itself be
absent, which is the reading a maintainer will carry away.

**Fix:**

```tsx
const active = venues.find((venue) => venue.id === activeId) ?? venues[0];

// The parent (VenueSwitcher) returns null below two venues, so this is
// unreachable in product — but the invariant lives in another file, and a crash
// here takes down the whole dashboard shell on every route.
if (!active) return null;
```

Or encode it in the type: `venues: [SwitchableVenue, SwitchableVenue, ...SwitchableVenue[]]`,
so the compiler carries the invariant across the file boundary rather than a
comment carrying it.

---

### WR-03: The unconditional "Create venue" link is shown to every authenticated principal, including enrolled-device and staff sessions

**File:** `app/(dashboard)/layout.tsx:27-38`, `100-106`

**Issue:** The fix's stated property — "IT IS NOT WRAPPED IN ANY CONDITION, AND
THAT IS THE WHOLE FIX" — is the right answer to G-01-7. But the shell it now
lives in gates on authentication only:

```ts
const { data: { user } } = await supabase.auth.getUser();
if (!user) redirect("/signup");
```

`proxy.ts` is cookie refresh and says so explicitly ("This is cookie refresh, NOT
an authorization boundary"). An enrolled tablet holds a real Supabase session for
a device auth user, and a staff principal likewise. Navigating such a session to
any `/venues/…` path renders the owner dashboard shell — including the new
"Create venue" entry. Following it reaches `/venues/new` (no gate there, by
design), submits, and `createVenue` refuses at the accounts pre-check
(`actions/venues.ts:70`) with `COPY.errors.generic` — "Something went wrong.
Please try again."

No data is exposed and no venue is created; the RPC and RLS both hold, and
`tests/actions/create-venue-action.test.ts:218` pins exactly this refusal. But
the product now advertises a capability to a principal that cannot have it and
describes the authorization refusal as a transient fault, inviting a retry loop.
Before 01-14 the link did not exist, so the unconditional placement is what
newly exposes it.

The fix is emphatically **not** to reintroduce a condition around the link — that
would reopen G-01-7 and turn `tests/lib/unconditional-cta-coverage.test.ts` red,
correctly. Gate the shell instead.

**Fix:**

```ts
// The shell is the OWNER dashboard. A device or staff principal reaching it is
// not an authorization breach — RLS holds — but it advertises controls they
// cannot use and reports the refusal as a transient fault.
const { data: account } = await supabase
  .from("accounts")
  .select("id")
  .eq("owner_user_id", user.id)
  .maybeSingle();

if (!account) redirect("/tablet");
```

Bind the error channel on that read too (CR-02's rule). Separately, give
`createVenue`'s no-account branch copy that names the actual cause instead of
`COPY.errors.generic`.

---

### WR-04: The CTA guard's "binding check" accepts a same-named import from any module and never checks its value

**File:** `tests/lib/unconditional-cta-coverage.test.ts:84-121`

**Issue:** `constantIsBound` is documented as what "keeps the identifier branch
honest" against `href={SOMETHING_ELSE_RENAMED_TO_MATCH}`. It does less than that.
The import branch checks only that a named import specifier carries the matching
text:

```ts
if (ts.isImportDeclaration(statement)) {
  const bindings = statement.importClause?.namedBindings;
  // ... specifier.name.text === row.constant  ->  bound = true
```

The module specifier is never inspected and the imported value is never resolved.
`import { VENUE_CREATE_PATH } from "@/lib/somewhere-else";` — where that module
exports `"/venues"` or `"/legal/terms"` — satisfies the guard, which then reports
full coverage of a link pointing somewhere else entirely. The local-`const`
branch eleven lines below *does* check the initialiser text (line 112), so the
two halves of one function apply different standards to the same question.

Residual risk is small today because `tests/lib/venue-routes.test.ts:53` pins
`VENUE_CREATE_PATH === "/venues/new"` from `@/lib/venue-routes` — but that is a
different file asserting a different fact, and this guard's header claims the
property for itself.

**Fix:** Put the source module on the row and check it:

```ts
type CtaRow = { file: string; href: string; constant?: string; from?: string };

// inside the import branch of constantIsBound:
const specifier = statement.moduleSpecifier;
if (row.from && (!ts.isStringLiteral(specifier) || specifier.text !== row.from)) {
  continue;
}
```

with `{ ..., constant: "VENUE_CREATE_PATH", from: "@/lib/venue-routes" }` on the
layout row, and a third fixture in the guard-of-the-guard: same identifier, wrong
module, expected `matched: false`.

---

### WR-05: The headline G-01-12 assertion is satisfied by a permanently-disabled button; nothing asserts a usable control after consent

**File:** `tests/auth/google-affordance.test.tsx:174-191`

**Issue:** The test named "renders a control carrying the contract continue-with
CTA" — described in the file header as "the gap itself, made executable. It was
RED against the shipped component" — renders and immediately queries:

```tsx
screen.getByRole("button", { name: COPY.cta.continueWithGoogle })
```

*without* accepting terms. The only element that can satisfy it is the
pre-consent `<Button type="button" variant="outline" disabled>` at
`GoogleOneTap.tsx:336`. So the assertion passes against a component whose Google
control is never actionable — and the owner's complaint was "there's no UI to log
in with google", for which a permanently-disabled button is not a fix. The very
next test then asserts `control.disabled === true` on that same element, which
makes the pair mutually consistent but leaves the headline claim overstated.

After consent the component renders only `<div ref={buttonContainerRef} />`,
whose contents are drawn by real GSI and are absent under jsdom. No test in the
file asserts that anything clickable exists in the post-consent state; the
strongest post-consent claim is that `renderButton` was *called* with the
container. Given the environment that is the right thing to assert — but it means
assertion #1 and assertion #2 cover different states and neither covers "there is
something on the page the owner can press". CR-01 falls through that seam.

**Fix:** Retitle assertion #1 to what it proves (the pre-consent state is visible
and labelled — which the following test already covers more completely), and add
a post-consent structural assertion that the surface is present or explained:

```tsx
it("keeps a Google surface on the page after consent, or says why not", async () => {
  await act(async () => { render(<GoogleOneTap />); });
  await acceptTerms();

  // Either Google's container is mounted and renderButton was handed it...
  expect(screen.getByTestId("google-button-container")).toBeTruthy();
  expect(google.renderButton).toHaveBeenCalledTimes(1);
  // ...or the owner is told. Never neither — that is CR-01.
  expect(screen.queryByText(COPY.errors.googleUnavailable)).toBeNull();
});
```

plus the two negative cases named in CR-01.

---

### WR-06: `lib/copy.ts` forward-references a reconciliation that has already run and declined to happen

**File:** `lib/copy.ts:45-49`, `69-85`, `209-221`

**Issue:** Three comment blocks tell a future reader:

> NO CONTRACT ROW YET — plan 01-17 reconciles this against `01-UI-SPEC.md`
> `## Copywriting Contract`

Plan 01-17 has run (`01-17-SUMMARY.md` is on disk) and its own record states the
opposite of what these comments promise:

> "The six new COPY keys are recorded in 01-UAT.md rather than added to
> 01-UI-SPEC.md, which is a checker-approved artifact this plan does not own"
> — verification ref: `grep of all six in 01-UI-SPEC.md -> 0 contract rows`;
> `git status --porcelain 01-UI-SPEC.md -> empty (artifact not edited)`

Confirmed independently: `grep -in "google\|another venue" 01-UI-SPEC.md` returns
a single unrelated `next/font/google` line. So the comments now point at a
reconciliation that will never occur, in an artifact that has zero rows for these
keys — and the file's stated premise, "a reviewer can diff this file against
01-UI-SPEC.md instead of grepping JSX", is false for six of its strings. The
house rule the comment itself articulates ("a string with no contract row is a
SIGNAL") is recorded in the one place the signal cannot be acted on.

**Fix:** Point the comments at where the decision actually landed, so the
un-contracted status stays visible and the cross-reference is true:

```ts
/**
 * NO CONTRACT ROW, AND DELIBERATELY SO. Plan 01-17 reviewed these keys and
 * recorded them in `01-UAT.md` (## New COPY keys) rather than editing
 * `01-UI-SPEC.md`, which is a checker-approved artifact it does not own. They
 * remain un-contracted by design; the next milestone that owns the UI-SPEC
 * should fold them in.
 */
```

Apply to all three blocks (`errors.googleUnavailable`, `venues.*`,
`consent.googleGate`).

---

### WR-07: `error` is never cleared, so a transient Google failure sticks for the life of the page — and the `ensureAccount` branch strands a signed-in owner

**File:** `app/(auth)/components/GoogleOneTap.tsx:135`, `180-195`, `274-276`

**Issue:** `setError` has no counterpart anywhere in the component. Once set — by
a failed `signInWithIdToken`, a failed `ensureAccount`, or a thrown initialise —
the destructive `<Alert>` at line 293 renders for the rest of the page's life.
The owner unticks and re-ticks consent (the only control they have, and the
natural retry), the effect re-runs and Google re-initialises cleanly, and the
stale "Google sign-in isn't available right now" banner is still sitting above a
working button. Unlike `COPY.errors.readFailed`, this copy contains no reload
instruction, so nothing tells the owner how to clear it.

Compounding it: the `ensureAccount` failure branch at line 192 leaves the owner
**signed in** — `signInWithIdToken` has already written the session cookie — with
no `accounts` row and therefore no recorded consent. Any subsequent venue
creation then fails with `COPY.errors.generic`
(`tests/actions/create-venue-action.test.ts:218` pins precisely this state), and
neither message names the actual problem.

**Fix:**

```tsx
const startOneTap = useCallback(async () => {
  // A retry starts clean. A stale banner over a working button is its own bug
  // report, and the copy carries no reload instruction to clear it.
  setError(null);
  // ...
```

and the same in the effect's rejection handler. For the `ensureAccount` branch,
either sign the session back out before surfacing the error, or use copy that
names the state ("You're signed in, but we couldn't record your acceptance — try
again") so the follow-on venue-creation failure is not a second mystery.

---

### WR-08: Unchecking every menu language leaves the form in a state whose only outcome is a server error

**File:** `components/venue-form.tsx:72-85`, `155-173`

**Issue:** `toggleLanguage` falls back to the empty string when the enabled set
is emptied:

```ts
if (!next.includes(defaultLanguage)) {
  setDefaultLanguage(next[0] ?? "");
}
```

With nothing checked, `enabledLanguages` is `[]` and `defaultLanguage` is `""`.
The controlled `<select value="">` at line 160 then has **zero** `<option>`
children, because line 164 filters by `enabledLanguages.includes(code)` — React
logs a controlled-component warning and the field renders as an empty box with no
indication of what is wrong. The submit button remains enabled, the form posts,
and `createVenueSchema` rejects it after a round trip.

The comment at lines 79-81 claims the client keeps this consistent specifically
so the owner does not get "a worse version of the same message" from the DB. For
the all-unchecked case, that is exactly what happens.

**Fix:** Refuse the last uncheck rather than constructing an impossible state:

```ts
function toggleLanguage(code: string, checked: boolean) {
  const next = checked
    ? Array.from(new Set([...enabledLanguages, code]))
    : enabledLanguages.filter((language) => language !== code);

  // A venue with no menu languages is not a state the schema accepts, so it is
  // not a state this form should be able to reach.
  if (next.length === 0) return;

  setEnabledLanguages(next);
  if (!next.includes(defaultLanguage)) setDefaultLanguage(next[0]);
}
```

and disable the checkbox for the last remaining language, so the refusal is
visible rather than a dead click.

## Info

### IN-01: Header comment says "TWO THINGS" and then enumerates three

**File:** `app/(auth)/components/GoogleOneTap.tsx:20-61`
**Issue:** "TWO THINGS HERE ARE LOAD-BEARING AND EASY TO MISTAKE FOR CEREMONY"
is followed by items 1, 2 and 3; item 3 (the drawn button) was appended by 01-15
without updating the count. In a codebase that treats these blocks as the
contract, a miscount is a tell that the block was extended rather than re-read.
**Fix:** "THREE THINGS HERE ARE LOAD-BEARING…".

### IN-02: `dashboard-nav.tsx` documents an `enabledFrom` field that does not exist

**File:** `components/dashboard-nav.tsx:20-30`, `44`
**Issue:** The doc comment states "`enabledFrom` records which plan builds each
destination", and line 44 refers back to "the `enabledFrom` convention above".
`NAV_ITEMS` has no such key — it has `enabled: boolean` plus free-text comments.
A reader grepping for `enabledFrom` finds nothing, in a file whose comments are
the only record of the convention.
**Fix:** Rename the references to `enabled`, or add the `enabledFrom` field the
comment describes.

### IN-03: `segment` is shadowed inside the nav map

**File:** `components/dashboard-nav.tsx:49`, `58`
**Issue:** `const segment = pathname.match(...)` at line 49 is shadowed by the
destructured `{ label, segment, icon: Icon, enabled }` at line 58. No bug today —
the outer binding's last use is line 50 — but the two names mean different things
(a pathname segment vs. a nav sub-route), so a future edit inside the map that
reaches for "the segment" gets the wrong one silently.
**Fix:** Rename the outer binding to `pathSegment`.

### IN-04: `isVenueIdSegment("")` is unreachable from both call sites

**File:** `lib/venue-routes.ts:36-49`; `tests/lib/venue-routes.test.ts:25-27`
**Issue:** The empty-string branch is documented as covering "a trailing slash",
but both readers extract with `/^\/venues\/([^/]+)/`, whose `+` cannot capture an
empty string — `/venues/` simply fails to match and yields `undefined`. The
branch and its test are defensive-only, which is fine, but the comment asserts a
cause that cannot occur, and the test reads as coverage of a live path.
**Fix:** Reword to "defensive: no current caller can produce it, because both
extract with `[^/]+`".

### IN-05: The CTA detector stops at the first matching href

**File:** `tests/lib/unconditional-cta-coverage.test.ts:203-221`
**Issue:** `visit` short-circuits on `finding.matched`, so exactly one occurrence
per file is examined, in source order. Two consequences: a *second*, conditional
link to the same path added later is invisible; and a conditional one added
*earlier* in the file turns the guard red even though the unconditional link
still exists — a false positive a maintainer will be tempted to resolve by
deleting a row, the one action this file's comments forbid four separate times.
**Fix:** Collect all matches and pass the row if any occurrence has
`blockingAncestor === null`, listing the conditional ones as context rather than
as failures.

### IN-06: Dead assertion in `createVenueThroughAction`

**File:** `tests/venues/second-venue-route.test.ts:94-104`
**Issue:** The callback passed to `captureRedirect` throws on the non-redirect
path, and `captureRedirect` re-throws anything that is not a redirect digest
(`tests/support/server-action-harness.ts:245-254`). So it either returns a
non-null target or propagates — `expect(target).not.toBeNull()` on line 101 can
never fail, and its message ("did not redirect, so no venue was created") will
never be read.
**Fix:** Drop the assertion, or drop the inner `throw` and let the null check do
the work it was written for.

### IN-07: Magic 15ms sleeps carry the ordering premise

**File:** `tests/venues/second-venue-route.test.ts:148`, `165`, `193`, `195`, `218`
**Issue:** Five `await new Promise((resolve) => setTimeout(resolve, 15))` calls
separate creations so `created_at` (transaction-start `now()`) does not tie. The
value is unexplained at four of the five sites and the suite's determinism rests
on wall-clock behaviour under load. In practice `now()` has microsecond
resolution across separate transactions, so the sleeps are probably unnecessary
rather than insufficient — but if they *are* load-bearing, 15ms is not a margin.
**Fix:** Extract `const CREATED_AT_TIE_BREAK_MS = 15;` carrying the comment from
line 147, or drop the sleeps and assert the order against the ids the action
returned.

### IN-08: `formatEnrolledAt` throws on an unparseable timestamp

**File:** `app/(dashboard)/venues/[venueId]/staff/devices/page.tsx:180-185`
**Issue:** `new Date(value)` on a malformed value produces `Invalid Date`, and
`Intl.DateTimeFormat#format` then throws a `RangeError` that takes out the whole
page render — including the registry and the revoke controls. `enrolled_at` is
non-null in schema so this is not currently reachable, but the signature
(`value: string`) does not encode that and the function is called once per row.
**Fix:**

```ts
function formatEnrolledAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(parsed);
}
```

---

_Reviewed: 2026-08-04_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

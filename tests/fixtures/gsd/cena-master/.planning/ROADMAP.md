# Roadmap: Cena

## Overview

Cena v1 is a self-serve QR menu product for independent restaurants in Romania and Hungary. The journey starts with the one thing that is inherently horizontal and impossible to retrofit — a multi-tenant foundation with auth, venue+role scoping, and RLS proven from the first migration. From there every phase delivers an end-to-end, observable capability. First an owner builds a simple menu by hand and a diner reads it on their phone (the core value, minimally). Then the menu gains depth (photos, allergens, macros, variants), a design system (templates + guardrailed branding), multiple languages (author once, AI pre-fill, owner-locked edits), and cookieless analytics. AI menu ingestion — photo and PDF — ships **last**, not because it matters least (it is the #1 business feature that makes self-serve onboarding actually complete) but because it depends on the full menu, translation, media, and publish schema already existing to write validated data into. This is a sequencing constraint, not a priority demotion.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Multi-Tenant Foundation** - Auth, venues, staff roles, and RLS tenant+role isolation proven from the first migration
- [ ] **Phase 1.1: Design System Migration** *(INSERTED)* - Cena design system replaces the shadcn layer; product brand split from a themable venue contract; diner design vocabulary created
- [ ] **Phase 2: A Live Menu Diners Can Read** - Owner hand-builds and publishes a simple menu; a diner scans a table QR and reads it fast, with a last-good fallback on network loss
- [ ] **Phase 3: Rich Menu Content** - Photos, allergens, dietary tags, calories/macros, priced variants, and time-of-day scheduling; diners see the detail and filter by dietary need
- [ ] **Phase 4: Theming & Templates** - Curated templates plus guardrailed brand controls that stay attractive at zero, some, or full photos and never break legibility
- [ ] **Phase 5: Multilingual Menu** - Author once, one-button AI pre-fill of other languages with owner-locked edits; diner auto-detect plus manual switcher
- [ ] **Phase 6: Cookieless Analytics** - Owner sees dish views, language split, and busy hours with no cookies, no identifiers, and no consent banner
- [ ] **Phase 7: AI Menu Ingestion (Photo + PDF)** - Owner uploads a photo or PDF, reviews the AI draft in a correction UI, and cannot publish until every AI-filled allergen/macro field is confirmed

## Phase Details

### Phase 1: Multi-Tenant Foundation

**Goal**: As a restaurant owner, I want to create my account and venue and invite staff with scoped roles myself, so that my team can work in Cena without any venue's data leaking to another and without limited-role staff changing prices, content, or settings.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: ACCT-01, ACCT-02, ACCT-03, ACCT-04, ACCT-05, ACCT-06, ACCT-07, ACCT-08
**Success Criteria** (what must be TRUE):

  1. A new owner can sign up, log in, and create a venue with a name, currency (RON/HUF/EUR), and default language — with no manual help.
  2. An owner/manager can invite a staff member, who signs in and sees only the venues they belong to.
  3. A user cannot read or modify any data belonging to a venue they are not a member of — tenant isolation proven via automated RLS tests across every role × venue combination.
  4. A limited-role staff member cannot edit prices, content, or settings (only availability), while an owner/manager can edit everything — proven by RLS tests.
  5. One owner account can hold multiple venues.

**Rationale**: This is the unavoidable horizontal foundation. Venue + role scoping and RLS are the hardest, most expensive things to retrofit and a silent-failure risk, so they are proven here — via an automated RLS test suite through the client SDK — before any feature writes data on top.
**Plans**: 17/17 plans executed
**Wave 1**

- [x] 01-01-PLAN.md — Walking Skeleton: scaffold + core tenancy (accounts/venues/venue_members + get_venue_role + RLS) + owner signup→venue→dashboard + first isolation test

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Owner auth completeness: password reset, Google One Tap, minimal multi-venue switcher (ACCT-03)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — Staff PIN profiles: owner-provisioned name+PIN (pgcrypto), verify RPC with exponential backoff, soft-delete lifecycle

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-04-PLAN.md — Shared-tablet staff session: provisioned device account (role=staff), device registry, instant remote revoke, owner-unlock

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 01-05-PLAN.md — Narrow toggle RPC + placeholder table + the D-25 RLS release-gate suite (every role × venue combination, client SDK) — the phase release gate

**Gap closure** *(from 01-REVIEW.md and 01-VERIFICATION.md: 4 criticals, 14 warnings, plus the zero-coverage finding on `actions/*`. Sequential waves — every plan runs the suite against the one shared local Supabase stack, so none of them may run concurrently.)*

**Wave 1**

- [x] 01-06-PLAN.md — CR-01: owner authority restored through one tested predicate, plus the Server Action and cookie-codec coverage whose absence hid it (WR-10)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-07-PLAN.md — CR-03: password reset gated on a server-held recovery grant, not a query parameter; plus WR-04 redirect origin, WR-14 re-authentication, WR-07/WR-02/WR-03 consent path

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-08-PLAN.md — CR-02: the D-18 PIN backoff stops disabling itself at the 33rd attempt; WR-12 lock-countdown filter (migration 0005)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-09-PLAN.md — CR-04: consent evidence and plan tier stop being self-serve; WR-01 venue billing parent pinned; WR-11 venue value domains (migrations 0006, 0007)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 01-10-PLAN.md — WR-05/WR-06 device cookie lifecycle, WR-08/WR-09 honest failure paths, WR-13 denial assertions that assert, info findings recorded, phase gate closed

**Gap closure round 2** *(from the 2026-07-28 re-verification: 2 blockers introduced by round 1, the WR-10 residual, and the four confirmed warnings the user added to scope. Sequential waves — every plan runs the suite against the one shared local Supabase stack, so none of them may run concurrently.)*

**Wave 1**

- [x] 01-11-PLAN.md — BLOCKER: the recovery grant is not single-use (path-less delete against a path-scoped cookie); the first Server Action test harness, a browser-faithful cookie jar; WR-01 mint narrowed to `type=recovery`

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-12-PLAN.md — BLOCKER: a transient `venue_devices` read fault de-enrols the tablet; `registry-unreadable` outcome, `exitOwnerUnlock` classification driven for real, plus compile-time and AST exhaustiveness guards over the outcome union

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-13-PLAN.md — WR-02 owner gate on the venue-detail page plus a route-family guard; WR-03 a failed venues read stops inviting a permanent duplicate; WR-04 the `.env.example` rotation blast radius; phase gate closed

**Gap closure round 3 — UAT** *(from 01-UAT.md 2026-08-03: G-01-7 no route to a second venue, G-01-12 no visible Google sign-in control, G-01-6 the enrolment CTA bound to the empty state, plus the stale planning bookkeeping and the outcome roll-up. Sequential waves — every plan runs the suite against the one shared local Supabase stack, so none of them may run concurrently.)*

**Wave 1**

- [x] 01-14-PLAN.md — G-01-7: `/venues/new`, an unconditional create entry in the dashboard shell, both pathname readers taught that `new` is not a venue id, and an AST guard that fails when a create CTA acquires a conditional ancestor

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-15-PLAN.md — G-01-12: a rendered "Continue with Google" control that does not depend on the One Tap prompt appearing, offered on `/signup` as well as `/login`, with the hashed nonce, FedCM flag and consent ordering preserved

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-16-PLAN.md — G-01-6 *(flagged: beyond the enumerated gap scope — see the plan's `<scope_flag>`)*: the device-enrolment CTA leaves the empty-state branch so a revoked tablet no longer strands the owner, and the shared guard covers the second call site

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-17-PLAN.md — the evidence ledger, the stale `01-UAT.md` / `01-VERIFICATION.md` / `REQUIREMENTS.md` records corrected one cited row at a time, and UAT test 26's outcome roll-up closed

### Phase 01.1: Design System Migration (INSERTED)

**Goal**: As the Cena team, we replace the shadcn visual layer with the imported Cena design system — tokens, re-skinned Radix primitives, and a token contract that separates Cena's product brand from a themable venue brand — and re-author the surfaces the imported design got wrong, so that every phase from 2 onward designs against a system that matches what Cena actually is rather than inventing its own vocabulary.
**Mode:** mvp
**Depends on**: Phase 1 (surfaces to re-skin)
**Blocks**: Phases 2–7 (every remaining phase carries a `UI hint: yes`)
**Requirements**: Enabling phase — delivers no requirement ID directly. Hard prerequisite for THEME-01..04; supplies the design vocabulary every later phase's UI-SPEC consumes.
**Success Criteria** (what must be TRUE):

  1. Cena design tokens (colour, type, spacing, shape, motion) are the single styling source of truth in the repo, with typefaces self-hosted and subset for RO/HU diacritics — and no third-party font or asset request on any page.
  2. All 16 primitives carry the Cena visual language on top of the existing Radix behaviour, and the Phase 01 test suite passes unchanged.
  3. Every shipped Phase 01 surface — signup, login, password reset, dashboard, venue create/edit, venue switcher, staff provisioning, device enrolment — renders in the new system and is usable one-handed on a phone.
  4. The token layer separates Cena product brand from a themable venue contract, and no venue theme value can produce a text/background pair below WCAG AA 4.5:1 — proven by an automated guardrail test.
  5. The diner menu has a mobile-first design vocabulary covering the three diner-side patterns v1 depends on — last-good/offline state, language switch, and allergen and dietary display — so phases 2–7 design against it instead of inventing it; and unverified-AI-field marking is defined at the token and primitive level in the same phase as the **owner-side** pattern it actually is, because a diner never sees an unverified field — an unverified field cannot be published.

**Rationale**: The design system imported from claude.ai/design was authored from a one-sentence brief with no access to Cena's scope, and audits with 5 blockers against PROJECT.md — full report in [research/DESIGN-SYSTEM.md](../research/DESIGN-SYSTEM.md). Its foundation (tokens, contrast discipline, interaction grammar, voice register) is strong and adopted nearly intact; its three product surfaces are not. Service and The Book design deferred and unscoped tiers and are archived, not built. The diner menu — Cena's entire v1 product — was absent and must be created. This lands before Phase 2 because every remaining phase renders UI, and re-skinning after those phases ship means redoing them.
**Plans**: 14/14 plans executed

Plans:
**Wave 1**

- [x] 01.1-01-PLAN.md — D-12 design archive + the D-11/D-04/W-3 replacement text, authored in-repo *(wave 1)*
- [x] 01.1-02-PLAN.md — Pure units: WCAG contrast function and per-currency price formatter *(wave 1)*
- [x] 01.1-03-PLAN.md — Copy deck: six owed Copywriting Contract rows, standing exception cleared *(wave 1)*
- [x] 01.1-04-PLAN.md — Diner vocabulary: 14-key EU Annex II allergens + three-language diner copy *(wave 1)*

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01.1-05-PLAN.md — **TRACER**: Cena typefaces + token layer + globals + Button at the 44px floor, end-to-end, with the SC1 tripwires *(wave 2)*

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01.1-06-PLAN.md — Venue token namespace + the SC4 contrast guardrail and boundary scan *(wave 3)*
- [x] 01.1-07-PLAN.md — Nine new primitives: seven registry adds plus hand-authored Icon and Tag *(wave 3)*

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01.1-08-PLAN.md — Re-skin the ten existing primitives, completing all 19 *(wave 4)*

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 01.1-09-PLAN.md — Re-skin the auth surfaces: signup, login, password reset *(wave 5)*
- [x] 01.1-10-PLAN.md — Re-skin the dashboard, venue switcher and venue pages; wire the venue copy rows *(wave 5)*
- [x] 01.1-11-PLAN.md — Re-skin staff provisioning and device enrolment *(wave 5)*
- [x] 01.1-12-PLAN.md — Re-skin the tablet route group without moving the idle-relock timer *(wave 5)*

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 01.1-13-PLAN.md — D-13 defects: EUR venue creation and the stale venue switcher, each with a regression test *(wave 6)*

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 01.1-14-PLAN.md — SC5 closure: discipline test, design-project write-back, honest-gap record *(wave 7)*

**UI hint**: yes

### Phase 2: A Live Menu Diners Can Read

**Goal**: An owner can build a simple menu by hand and publish it, and a diner can scan a table QR to read it instantly on their phone — even when the connection drops mid-load.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: MENU-01, MENU-02, MENU-08, MENU-10, MENU-11, MENU-12, DINE-01, DINE-02, DINE-03, DINE-04, DINE-05
**Success Criteria** (what must be TRUE):

  1. An owner can create categories and items (name, description, price) across one or more menus, and control what is live via draft vs published state.
  2. An owner or staff member can toggle an item sold-out and diners see the change within seconds.
  3. An owner can generate and print a per-table QR code, and scanning it opens the correct venue's published menu in a mobile browser with nothing to install.
  4. The diner menu paints fast on a poor mobile connection, and if the network fails mid-load the diner still sees the last-good version of the menu rather than a blank screen.
  5. A diner can browse categories and open an item to see its details.

**Rationale**: The earliest end-to-end slice — an owner builds a menu and a diner reads it — delivering the core value minimally. The last-good fallback (SC4) is a release gate: connectivity is "worse than paper" if the menu shows nothing when the network fails.
**Plans**: TBD
**UI hint**: yes

### Phase 3: Rich Menu Content

**Goal**: An owner can enrich each dish with a photo, allergens, dietary tags, calories/macros, and priced variants, schedule menus by time of day, and diners can see this detail and filter by dietary need or allergen.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: MENU-03, MENU-04, MENU-05, MENU-06, MENU-07, MENU-09, DINE-06
**Success Criteria** (what must be TRUE):

  1. An owner can add a photo per item that is optimized and loads fast on mobile (photos are an upgrade, never required).
  2. An owner can mark allergens, dietary tags (vegetarian/vegan/gluten-free), calories/macros, and priced variants/modifiers on an item.
  3. An owner can schedule a menu to appear automatically by time of day.
  4. A diner viewing an item sees its photo, allergens, dietary tags, calories/macros, and variants, and can filter or identify items by dietary tag or allergen.

**Rationale**: Layers menu depth and the media/image pipeline (Supabase Storage transforms) onto the live menu from Phase 2 — a prerequisite for AI ingestion, which must have somewhere to write allergens, macros, variants, and photos.
**Plans**: TBD
**UI hint**: yes

### Phase 4: Theming & Templates

**Goal**: An owner can make the menu look deliberately designed by choosing a template and applying guardrailed brand controls, and every template looks intentional whether the venue has zero, some, or a full set of photos — without ever letting brand choices break legibility.
**Mode:** mvp
**Depends on**: Phase 2 (diner render surface); can run in PARALLEL with Phase 3
**Requirements**: THEME-01, THEME-02, THEME-03, THEME-04
**Success Criteria** (what must be TRUE):

  1. An owner can choose from a set of well-designed templates and see it applied to their live diner menu.
  2. An owner can set brand controls (colour palette, font pairing, logo, cover image) within guardrails.
  3. Every template renders as intentional and attractive, verified in zero-photo, some-photo, and full-photo states.
  4. No brand-control combination can produce an inaccessible menu — contrast and legibility stay within safe bounds.

**Rationale**: Visual quality is the differentiator. Template work builds on the Phase 2 diner render surface and can proceed in parallel with Phase 3; the zero/some/full-photo QA gate (SC3) uses the photo pipeline from Phase 3.
**Plans**: TBD
**UI hint**: yes

### Phase 5: Multilingual Menu

**Goal**: An owner authors the menu once in one language, one-button AI pre-fills the other enabled languages, and every AI translation stays editable and locked once the owner touches it — while diners get the menu in their own language automatically with a manual switcher.
**Mode:** mvp
**Depends on**: Phase 2 (content to translate); benefits from Phase 3
**Requirements**: LANG-01, LANG-02, LANG-03, LANG-04, LANG-05, LANG-06
**Success Criteria** (what must be TRUE):

  1. An owner can enable the set of languages a venue supports and author content in one primary language.
  2. An owner can trigger one-button AI translation to pre-fill all other enabled languages.
  3. An owner can edit any AI translation, and once edited or confirmed it is locked and never overwritten by a later re-translation.
  4. A diner's language is auto-detected from their browser when they open the menu, and they can manually switch it.

**Rationale**: The normalized translation layer (author language and AI languages in one structure) is the "AI drafts, owner decides" pattern applied to language, and a hard prerequisite for multilingual AI ingestion output. The owner-lock gate (SC3) prevents re-translation from silently overwriting curated culinary terms.
**Plans**: TBD
**UI hint**: yes

### Phase 6: Cookieless Analytics

**Goal**: An owner can see how diners engage with their menu — dish views, language split, and busy hours — captured without cookies or personal identifiers, so no consent banner ever stands between a diner and the menu.
**Mode:** mvp
**Depends on**: Phase 2 (diner surface to instrument)
**Requirements**: ANLY-01, ANLY-02
**Success Criteria** (what must be TRUE):

  1. Diner menu activity is recorded with no cookies, no personal identifiers, and no consent banner.
  2. An owner can view aggregate insights for a venue: dish views, language split, and busy hours.

**Rationale**: Aggregate, cookieless capture instrumented on the existing diner surface plus a simple owner dashboard. Deliberately keeps a consent wall out of the diner flow — the exact friction the product exists to remove.
**Plans**: TBD
**UI hint**: yes

### Phase 7: AI Menu Ingestion (Photo + PDF)

**Goal**: An owner can start a menu by uploading a photo or PDF of their existing menu, review and correct the AI-extracted draft in a dedicated interface, and cannot publish until every AI-filled allergen and macro field is explicitly confirmed — with manual entry always available as a full alternative.
**Mode:** mvp
**Depends on**: Phases 1, 2, 3, 5 (full menu + media + translation + publish schema); benefits from Phase 4 branding
**Requirements**: INGEST-01, INGEST-02, INGEST-03, INGEST-04, INGEST-05, INGEST-06, INGEST-07
**Success Criteria** (what must be TRUE):

  1. An owner can upload a photo or a PDF of a physical/existing menu, and the system extracts a structured draft (categories, items, prices, descriptions).
  2. Extraction runs as a resumable background job that shows progress and does not fail the whole menu on a single error.
  3. Every AI-filled field — including inferred allergens and macros — is visibly marked unverified until the owner confirms it, reviewed in a dedicated correction interface.
  4. A menu with any unverified AI-filled allergen or macro field cannot be published until the owner explicitly confirms each such field.
  5. An owner can build a full menu entirely by hand as a complete alternative to AI ingestion.

**Rationale**: This is the #1 business feature — self-serve onboarding dies when an owner faces manual entry of 100+ dishes, and ingestion is the mechanism that makes it complete. It builds LAST because it depends on the full menu, translation, media, and publish schema already existing to write validated data into; this is a sequencing constraint, not a priority demotion. The per-field allergen/macro confirmation gate (SC4) is the release gate — with EU allergen liability sitting on the restaurant, unverified AI fields must not be publishable. Correction UX and confirmation quality are the feature, not the extraction accuracy alone. Website and delivery-platform sources (INGEST-08/09/10) are a v1.1 fast-follow, not in this milestone.
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 1.1 → 2 → 3 → 4 → 5 → 6 → 7

Phase 1.1 is a hard gate on everything after it: each remaining phase renders UI, so re-skinning after they ship means redoing them.

**Parallelization opportunities** (config: parallelization enabled):

- Phase 4 (Theming) can run in parallel with Phase 3 (Rich Content) — both build on the Phase 2 diner render surface.
- Phases 5 (Multilingual) and 6 (Analytics) depend only on Phase 2 and can also run alongside Phases 3–4.
- Phase 7 (AI Ingestion) is the convergence point — it requires Phases 1, 2, 3, and 5 complete before it can begin.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Multi-Tenant Foundation | 17/17 | In Progress|  |
| 1.1 Design System Migration *(INSERTED)* | 14/14 | In Progress|  |
| 2. A Live Menu Diners Can Read | 0/TBD | Not started | - |
| 3. Rich Menu Content | 0/TBD | Not started | - |
| 4. Theming & Templates | 0/TBD | Not started | - |
| 5. Multilingual Menu | 0/TBD | Not started | - |
| 6. Cookieless Analytics | 0/TBD | Not started | - |
| 7. AI Menu Ingestion (Photo + PDF) | 0/TBD | Not started | - |

# Roadmap: Counterpoint

## Overview

Counterpoint is built in six vertical slices, and the owner can use each one on Cena. The first slice is the trust layer: a loopback console, a proven agent sandbox, a read-only view of Cena's GSD plan, and signed runway approvals that recompute themselves from git. The second proves the core value: one unattended overnight run on a Cena QR-menu phase that ends in a green PR with a preview link, driven from the CLI. The third completes the morning-after loop: console mission control, parallel builds, rebase onto the owner's pushes, and merge only by the owner's signed merge commit. Design sign-off and the visual gate come next. The council comes last, on purpose: first question cards with decision write-back and "proceed on the recommendation" semantics, then full meetings and backlog filing. The core value lives in the build lane, and the council features carry the most scope-creep risk.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Trusted Shell & Signed Runway** - Loopback Astryx console, `doctor` with a live sandbox probe, Cena's GSD phases read through the adapter, signed runway approvals that drop off when content changes
- [ ] **Phase 2: First Unattended Run** - An approved Cena phase built overnight in its own worktree, judged only by gate exit codes, ending in a green PR with a preview link or a parked item, plus a run report (CLI first)
- [ ] **Phase 3: Morning Review & Signed Merge** - Console mission control (statuses, gate rows, live log), parallel builds, rebase on conflict, merge only by the owner's signed merge commit, cleanup, honest counters
- [ ] **Phase 4: Design Drafts & Visual Gate** - Standalone drafts in the host's design system with pins, redraws, variants and "More like B"; signed-off full render joins the runway approval and drives a structural visual gate
- [ ] **Phase 5: Council Cards & Decisions** - Seats raise question cards; Pick, More like B, reframe or Later; picks committed as GSD decisions; unanswered cards proceed as "assumed" or park only irreversible work
- [ ] **Phase 6: Council Meetings & Backlog Filing** - Structured bounded meetings and async threads, minutes and transcripts, cost caps, persona pins on drafts, deduplicated backlog filing, automatic meetings alongside the work

## Phase Details

### Phase 1: Trusted Shell & Signed Runway
**Goal**: The owner can run Counterpoint against Cena, see proof that agents are boxed in, browse Cena's GSD phases, and sign phases into a runway that recomputes itself from git
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-06, ADPT-01, ADPT-02, APPR-01, APPR-02, APPR-04, MISN-01, MISN-02
**Success Criteria** (what must be TRUE):
  1. Owner runs `counterpoint` (installed from the local tarball; `npx @hkp/counterpoint` once published, PLAT-V2-02) in the Cena repo and opens the Astryx console, in light and dark themes, at a loopback-only URL. Requests with an unexpected Host or Origin, cross-site posts, and privileged calls without the owner credential are rejected.
  2. `counterpoint doctor` reports pass/fail for `claude`, `git` and `gh`, for the signing key (passphrase-protected, not loaded in ssh-agent or Keychain), and for a live probe. The probe shows that a headless `claude -p` session cannot read the signing key, `~/.ssh`, `gh` credentials or Counterpoint's state, and cannot write Cena's `.git/config`, `.git/hooks` or `.git/info`.
  3. The console lists Cena's QR-menu phases with status, plans and prerequisites (`user_setup`, non-autonomous plans), parsed natively from `.planning/` through the GSD adapter. A lint rule fails the build if core imports the adapter directly.
  4. Owner approves a phase. The console shows a one-line command that asks for the passphrase and creates a signed commit on `master` adding only `.counterpoint/approvals/<item>.json`, with uncommitted work left alone. The commit is signed and verified with `ssh-keygen -Y` against a public key kept outside the repo, and the runway headline goes up by one. Signing is refused if Cena's `.git/config` or hooks changed unexpectedly.
  5. If the approved phase's spec or gate config changes after signing, the item leaves the runway and shows in the Needs You inbox as "approved version changed".
**Plans**: 24/24 plans executed

Plans:
**Wave 1**
- [x] 01-01-PLAN.md — Owner vets packages; toolchain; core host modules (home refusal, ids, clean-env git runner, host registration with an injected framework detector) *(wave 1)*

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 01-02-PLAN.md — Walking-skeleton tracer: `counterpoint` → background daemon → SQLite host → 127.0.0.1 → Astryx page; composition root *(wave 2)*

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 01-03-PLAN.md — One-time sign-in, request guard and CSP, SSE live events, init/status/open *(wave 3)*
- [x] 01-04-PLAN.md — Sandbox spike as code: one settings builder, claude -p runner, differential probe with a mirror-confined control session *(wave 3)*
- [x] 01-06-PLAN.md — GSD adapter read side over committed `.planning/`: port, reader, fixtures, parser, `detect`, core status *(wave 3)*
- [x] 01-08-PLAN.md — Signed-approval plumbing (CAS landing, ssh-keygen sign/verify, adversarial suite) and integrity snapshot *(wave 3)*

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 01-05-PLAN.md — Probe evaluator that cannot false-pass; seven Blocked targets live *(wave 4)*
- [x] 01-07-PLAN.md — D-02 approval inputs, `cp-gsd-roadmap-section/v1` normalizer, composition root, lint-enforced boundary *(wave 4)*
- [x] 01-09-PLAN.md — Console shell: AppShell, Light/Dark/System, signed-out screens, live client *(wave 4)*

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 01-10-PLAN.md — `counterpoint doctor`, init-key / trust-key (confirmed at a terminal) / trust {host} *(wave 5)*
- [x] 01-11-PLAN.md — Phases, Phase detail and Trust in the console; base-tip watcher *(wave 5)*

**Wave 6** *(blocked on Wave 5 completion)*
- [x] 01-12-PLAN.md — Owner confirms the statement format; `counterpoint approve`; runway recomputed from git, gate-config drift included *(wave 6)*

**Wave 7** *(blocked on Wave 6 completion)*
- [x] 01-13-PLAN.md — Approve from the console; runway headline *(wave 7)*

**Wave 8** *(blocked on Wave 7 completion)*
- [x] 01-14-PLAN.md — Needs You and the change view (approved version changed, gate config included) *(wave 8)*

**Wave 9** *(blocked on Wave 8 completion)*
- [x] 01-15-PLAN.md — Mission cards, drift hints, end-to-end drift test, visual backstops *(wave 9)*

**Wave 10** *(blocked on Wave 9 completion)*
- [x] 01-17-PLAN.md — Gap (WINDOWS.md #2) 1/2: confine agent Write/Edit to the session folder in the one launch profile; probe row `Files outside the working folder` through evaluator and doctor *(wave 10)*

**Wave 11** *(blocked on Wave 10 completion)*
- [x] 01-24-PLAN.md — Gap (scrub opt-out, WINDOWS.md #3) 1/3: cherry-pick 01-21's launch work (e5e59f3: auto mode, outside-write block, control rules); `agentEnv` sets `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0` (owner decision 2026-11-10); replacement 1 `sandbox.autoAllowBashIfSandboxed: false`; live tracer proves auto mode first; deterministic-only evaluator (MATCHER_REVISION 3) *(wave 11)*

**Wave 12** *(blocked on Wave 11 completion)*
- [x] 01-25-PLAN.md — Gap (scrub opt-out) 2/3: replacement 2, doctor's `Sandbox isolation settings` check (`sandboxIsolation`, additive v1 field): doctor and its probe rows fail if any settings source turns filesystem isolation off; read-only, fail-closed reader of every source an agent session loads *(wave 12)*

**Wave 13** *(blocked on Wave 12 completion)*
- [x] 01-26-PLAN.md — Gap (scrub opt-out) 3/3: replacement 3, ninth probe row `Credentials in the shell environment` (names and value shapes, never values); one live listing first; MATCHER_REVISION 4 *(wave 13)*

**Wave 14** *(blocked on Wave 13 completion)*
- [x] 01-22-PLAN.md — doctor checks the agent session's effective permission mode (`agentMode`, additive v1 field); the Trust page shows both session checks, the eighth and ninth probe rows and the new all-pass wording; UI-SPEC E8 *(wave 14)*

**Wave 15** *(blocked on Wave 14 completion)*
- [x] 01-23-PLAN.md — One live nine-row proof in auto mode with the scrub opted out and all three replacements; refrozen fixtures; matcher version; WINDOWS.md #2 and #3 fixed *(wave 15)*

**Wave 16** *(blocked on Wave 15 completion)*
- [x] 01-19-PLAN.md — Gap (WINDOWS.md #1) 1/2: structured probe evidence; owner-recorded `gh-keychain` accepted risk (`counterpoint accept-risk` / `revoke-risk`); three-way verdict in doctor and the Trust API *(wave 16)*

**Wave 17** *(blocked on Wave 16 completion)*
- [x] 01-20-PLAN.md — Gap (WINDOWS.md #1) 2/2: the accepted risk on the Trust page and Mission card; UI contract; one live doctor proof; #1 waived *(wave 17)*

**Wave 18** *(blocked on Wave 17 completion)*
- [x] 01-16-PLAN.md — Package and install `@hkp/counterpoint` (lint on the build path); owner key + Cena Phase 2 plan; owner-run demo and first real approval on Cena (the first doctor run over the owner's real settings sources) *(wave 18)*

**UI hint**: yes
**Notes**: Start with the sandbox spike. Confirm that Claude Code's sandbox confines headless `claude -p` sessions (Bash and the Read/Edit tools) before building the trust model on it. If it does not, wrap the whole process or document a weaker boundary. Approvals live in Cena's normal history; there is no separate approvals repo. The approval statement's draft-hash slot stays empty until Phase 4 adds design sign-off.
**Retired plans**: 01-18-PLAN.md and 01-21-PLAN.md are superseded and never run. Their frontmatter `status: superseded` (GSD #2349) drops them from `phase-plan-index` and `roadmap analyze`, so they are never scheduled; 01-24's precondition and verify check that. 01-18 halted at its live tracer on claude 2.1.321, where the scrub forced dontAsk to default; the owner then chose auto mode, and its work moved to 01-21…01-23. 01-21 halted at its live tracer too, where the scrub forced auto to default (WINDOWS.md #3); the owner then chose to opt out of the scrub with three replacements, and its work moved to 01-24 (its committed launch work e5e59f3 is cherry-picked there), 01-25 and 01-26. They are listed here rather than in the Plans checklist because a non-checkbox row splits that list for `roadmap annotate-dependencies`.

### Phase 2: First Unattended Run
**Goal**: The owner can start a run on an approved Cena QR-menu phase and walk away. Counterpoint builds it overnight in its own worktree, judges it only by gate exit codes, and leaves either a green PR with a preview link or a parked item with the reason.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: BUILD-01, BUILD-02, BUILD-03, BUILD-04, BUILD-08, BUILD-10, GATE-01, GATE-03, GATE-04, PR-01, PR-02, FOUND-05, ADPT-05
**Success Criteria** (what must be TRUE):
  1. Owner starts a run choosing approved phases, stop time, model and context budget, with the budget shown as a token figure (e.g. "40% of 1M = 400k tokens"), and can stop it. Each build runs in its own worktree and branch and never touches the owner's Cena checkout.
  2. An unattended overnight run on a real Cena QR-menu phase ends in a green PR. Its body is generated from the phase artifacts and lists assumed decisions, and it has a preview link: Cena's Vercel preview when one exists, otherwise a local preview served by Counterpoint. The PR changes no `.planning/` files, and any planning bookkeeping goes through Counterpoint's single serialized write path.
  3. Sessions hand off at the context budget (finish the task, write a handoff, commit, stop) and the next fresh session picks up from the handoff. A usage limit pauses the run until reset + 2 minutes, then it resumes on its own. Auth, credit and spend-limit errors stop the run and land in Needs You. If Counterpoint is killed or the machine reboots mid-run, the run resumes from its last handoff with no orphaned processes.
  4. Gates are Counterpoint-defined commands read from the approved base and judged only by exit code. A failing gate's output goes back to the builder for a bounded number of retries; after N failed attempts the item parks in Needs You with the last failing output and its attempt history. Edits to tests, gate configs or baselines are flagged, and a test gate that ran zero tests fails.
  5. At the end of a run, the owner gets a run report listing merge-ready PRs, parked items, items waiting on the owner, and decisions the builder assumed.
**Plans**: TBD
**Notes**: Do the CLI first: prove the overnight run before spending on console run controls, which come in Phase 3. Success criterion 2 is the exit gate for everything after this phase. Every agent spawn goes through one governor from here on (usage-limit pause across lanes); Phase 5 adds builder priority and the council's capped share. Research spikes: the context-window denominator on a 1M-window model, the `rate_limit_event` shape and reset unit, process-group kill on macOS, and sandbox escape hatches for Supabase/Docker gate commands.

### Phase 3: Morning Review & Signed Merge
**Goal**: The owner can follow several features building in parallel from the console, come back to their PRs, and merge each one only with their own signed merge commit, including when `master` moved underneath
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: BUILD-06, BUILD-07, BUILD-09, GATE-02, APPR-03, APPR-05, PR-03, MISN-03, MISN-04
**Success Criteria** (what must be TRUE):
  1. Each work item in the console shows its status (queued, running, waiting on owner, parked, gates failing, ready for approval, merged) and its gate row, which lights up as gates pass; the failing gate's last lines are one click away. Owner can open a running session's live log (tool calls and progress) and stop that session.
  2. Two or more Cena phases build in parallel without colliding. Tests run under one shared lock, and each worktree gets its own ports and database, so no gate passes against another worktree's server or data.
  3. When the owner pushes to `master` and it conflicts with a build, the builder rebases, resolves, re-runs every gate, and parks the item if it can't. The owner's pushed changes are never dropped.
  4. Owner sees a summary listing every assumption the builder proceeded on, then approves the merge by signing a `--no-ff` merge commit of the exact PR head. Counterpoint pushes it, the PR shows as merged, and the item's worktree and branch are cleaned up. Approval is recomputed from git every time: a PR whose head moved after signing, or one without a verified owner signature, never merges.
  5. Beside the runway, the console shows a few honest counters (e.g. first-attempt gate pass rate, items merged without intervention), each paired with a counter-metric (e.g. gate-touch rate).
**Plans**: TBD
**UI hint**: yes
**Notes**: This is the first phase that can merge anything, so it relies on the Phase 1 trust layer. Check Cena's branch-protection settings before planning.

### Phase 4: Design Drafts & Visual Gate
**Goal**: Before a UI phase is built, the owner can review standalone drafts in Cena's own design system and steer them with pins, redraws and variants. The owner then signs off a hi-fi render as part of the runway approval, and the build is checked against it.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: DRAFT-01, DRAFT-02, DRAFT-03, DRAFT-04, DRAFT-05, DRAFT-06, DRAFT-07, DRAFT-08, DRAFT-10, GATE-05
**Success Criteria** (what must be TRUE):
  1. Owner requests drafts for a Cena QR-menu phase and gets standalone local HTML screens. They use fixture data and Cena's design system, and they are served on an origin isolated from the console API. Each draft toggles between mobile and desktop and between empty, loading, error and long-text states.
  2. Owner explores in low-fi "wire" mode (neutral palette, real layout and components), and the chosen draft is re-rendered as a hi-fi "full" render with Cena's tokens and fixtures.
  3. Owner clicks any element to pin a comment, batches several pins into one revision that changes only the targeted parts, resolves or reopens comment threads, and redraws a whole draft with a steering note. Pins stay anchored across redraws.
  4. Owner asks for 2–3 variants side by side and picks one, or says "More like B" (with an optional steering note) to get a new round anchored on B. A breadcrumb trail (A/B/C → B → B2 …) lets the owner back up.
  5. Signing off the full render becomes part of the phase's runway approval. When the built screens drift from it in landmark regions (`data-cp-id`), the visual gate fails and attaches a side-by-side image.
**Plans**: TBD
**UI hint**: yes
**Notes**: The variants / "More like B" round model is built here once, and Phase 5 reuses it for council cards. Research spikes first: rendering Cena screens in fixture mode, and keeping `data-cp-id` stable across revisions. The pixel-diff tier is deferred to v2 (GATE-V2-01). Can be planned alongside Phase 3 if useful, since it needs only the Phase 2 gate runner and the Phase 1 approvals.

### Phase 5: Council Cards & Decisions
**Goal**: Council seats raise planning questions on a phase as cards. The owner picks, steers, reframes or defers them; picks become committed GSD decisions, and unanswered cards never stop the build.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: CNCL-01, CNCL-02, CNCL-08, CARD-01, CARD-02, CARD-03, CARD-04, CARD-05, CARD-06, CARD-07, ADPT-03, ADPT-04, BUILD-05
**Success Criteria** (what must be TRUE):
  1. Seats (e.g. product, design, tech, QA, Cook) are defined in Cena's Counterpoint config. Defaults ship, and adding a seat is a config edit. For each council activity, the owner chooses router-picked relevant seats or all seats.
  2. A card shows the question, the seats that raised it, 2–4 options with trade-offs, the recommended option, a minority report and a reversibility class. Owner can Pick (written into the phase's CONTEXT decisions and committed), say "More like B →" and back up through the breadcrumb trail, choose "None fit, reframe", or choose Later (the card stays in the inbox).
  3. When the builder reaches work that depends on an unanswered reversible card, it proceeds on the recommended option. That choice is logged as "assumed" and appears in the PR and in the merge summary. If the owner later answers differently, a rework note goes to the open PR, or a backlog item is committed to Cena's backlog if the work already merged.
  4. When the builder reaches work that depends on an unanswered irreversible card (DB schema, auth, data model, public routes, privacy, pricing), only that item parks, and the run carries on with the rest of the runway.
  5. Approving, drafting and building never wait on the council. With council work running during a build, the builder keeps priority at the single quota governor and council spend stays within its capped share.
**Plans**: TBD
**UI hint**: yes
**Notes**: "More like B →" reuses the round model from Phase 4. Decision and backlog writes go through the serialized planning-write path from Phase 2. Research: GSD write formats for CONTEXT decision entries and BACKLOG items against frozen Cena fixtures.

### Phase 6: Council Meetings & Backlog Filing
**Goal**: The council meets at set lifecycle points or when the owner calls it, debates in a bounded structured protocol, and turns what it finds into cards, review notes, persona pins on drafts and deduplicated backlog items, always alongside the work
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: CNCL-03, CNCL-04, CNCL-05, CNCL-06, CNCL-07, CNCL-09, CNCL-10, DRAFT-09
**Success Criteria** (what must be TRUE):
  1. Owner calls a meeting on any topic or screen. It runs a blind pass per seat, then one anonymised critique round, then chair synthesis, in a fixed turn order with hard caps on rounds, tokens and wall time. The owner can read its minutes and full transcript.
  2. Every meeting produces discrete outputs: cards, backlog items and review notes. The owner sees token cost per seat and per meeting, and per-meeting and per-day caps are enforced.
  3. Seats clarify small points among themselves in async threads, and a thread that stalls escalates to a meeting.
  4. The council files backlog items straight into Cena's backlog, tagged "council", with evidence and severity, deduplicated against existing items and capped per meeting. Needs You shows one summary that the owner can bulk-dismiss.
  5. Relevant personas (e.g. the Cook) pin their own comments on a draft before the owner reviews it. The council also meets automatically at the configured lifecycle points without ever holding up approving, drafting or building.
**Plans**: TBD
**UI hint**: yes
**Notes**: The default set of automatic meeting points is still open in PROJECT.md; settle it in this phase's discussion. Deferred to v2: live watch and interjection, post-build persona review, full gamification.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Trusted Shell & Signed Runway | 24/24 | In Progress | - |
| 2. First Unattended Run | 0/TBD | Not started | - |
| 3. Morning Review & Signed Merge | 0/TBD | Not started | - |
| 4. Design Drafts & Visual Gate | 0/TBD | Not started | - |
| 5. Council Cards & Decisions | 0/TBD | Not started | - |
| 6. Council Meetings & Backlog Filing | 0/TBD | Not started | - |

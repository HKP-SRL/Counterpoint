# Requirements: Counterpoint

**Defined:** 2026-11-09
**Core Value:** The owner can approve work and walk away, and come back to green, reviewable per-feature PRs with preview links — plus only the questions that genuinely need them.

## v1 Requirements

Requirements for the first milestone. Each maps to roadmap phases.

### Foundations & Safety

- [ ] **FOUND-01**: Owner can start Counterpoint for a host project with one command (`npx @hkp/counterpoint`) and open its console at a loopback-only URL
- [x] **FOUND-02**: Console rejects requests from unexpected hosts/origins (Host + Origin allowlist, CSRF protection, SSE origin check), and privileged actions (start/stop a run, approvals) require an owner credential agents cannot read
- [ ] **FOUND-03**: Owner can run `counterpoint doctor` to see pass/fail for: `claude`, `git`, `gh` present; signing key passphrase-protected and not loaded in ssh-agent/Keychain; sandbox actually confining headless `claude -p` sessions
- [ ] **FOUND-04**: Agent sessions run sandboxed so they cannot read the signing key, `~/.ssh`, `gh` credentials or Counterpoint's state, and cannot write the host's shared `.git/config`, `.git/hooks` or `.git/info`
- [ ] **FOUND-05**: After a crash or reboot, Counterpoint restores its state, reconciles runs that were in progress, and resumes them from their last handoff
- [x] **FOUND-06**: Console is built on Astryx and works in light and dark themes

### Framework Adapter

- [x] **ADPT-01**: Counterpoint shows the host's GSD phases with status, plans and prerequisites (e.g. `user_setup`, non-autonomous plans) parsed from `.planning/`
- [x] **ADPT-02**: Core reaches the planning framework only through an adapter interface (boundary enforced by import rules), so a second framework can be added without core changes
- [ ] **ADPT-03**: A decision picked on a card is written into the phase's CONTEXT decisions and committed
- [ ] **ADPT-04**: A council backlog item is written into the host's backlog and committed
- [ ] **ADPT-05**: All planning writes (decisions, backlog, approvals, bookkeeping) go through one serialized path; build worktrees never write planning files

### Approvals

- [ ] **APPR-01**: Owner can approve a phase into the runway: the console prepares the approval and shows a one-line command; running it asks for the passphrase and creates a signed commit on the base branch adding `.counterpoint/approvals/<item>.json`, touching nothing else in the owner's checkout
- [ ] **APPR-02**: A runway approval binds hashes of the phase spec, its signed-off draft and the gate config; if any changes afterwards, the item leaves the runway and shows in Needs You as "approved version changed"
- [ ] **APPR-03**: Owner can approve a finished feature for merge by signing a `--no-ff` merge commit of the exact PR head; before signing they see the summary including every assumption the builder proceeded on; Counterpoint then pushes and the PR shows as merged
- [x] **APPR-04**: Signing and verification call `ssh-keygen -Y sign/verify` directly with a clean environment, against the owner's public key stored outside the repo; signing is refused if the host's `.git/config` or hooks changed unexpectedly
- [ ] **APPR-05**: Nothing merges without a verified owner-signed merge commit; approval state is recomputed from git each time, never trusted from a stored flag

### Build Lane

- [ ] **BUILD-01**: Builder takes approved phases from the runway and builds each in its own git worktree and branch, never touching the owner's checkout
- [ ] **BUILD-02**: Each build runs in fresh `claude -p` sessions; when a session's context passes the budget (default 40% of the model's window), it finishes the current task, writes a handoff, commits and stops, and the next fresh session continues from the handoff
- [ ] **BUILD-03**: Owner can start a run choosing which approved phases, stop time, model and context budget (shown with its token figure, e.g. "40% of 1M = 400k tokens"), and can stop the run
- [ ] **BUILD-04**: On a usage limit, every agent lane pauses until the reset time + 2 minutes and resumes on its own; transient API errors back off; non-retryable errors (auth, credit, spend limit) stop the run and land in Needs You
- [ ] **BUILD-05**: A single quota governor sits in front of every agent spawn: the builder has priority and council spend is capped to a share, so the council cannot starve a run
- [ ] **BUILD-06**: Parallel builds don't collide: tests run under one shared test lock, and each worktree gets its own ports and database
- [ ] **BUILD-07**: When the base branch moves and conflicts with a build, the builder rebases, resolves, re-runs all gates, and parks the item if it can't
- [ ] **BUILD-08**: After N failed attempts an item parks into Needs You with its last failing gate output and attempt history
- [ ] **BUILD-09**: Owner can watch a running session's live log (tool calls and progress) and stop that session
- [ ] **BUILD-10**: At the end of a run the owner gets a run report: merge-ready PRs, parked items, items waiting on the owner, and decisions the builder assumed

### Gates

- [ ] **GATE-01**: Gates are commands defined in Counterpoint config, read from the approved base commit (not the worktree), and judged only by exit code — an agent saying "done" never counts
- [ ] **GATE-02**: Each work item shows its gate row (e.g. typecheck · lint · unit · DB · flows · visual) lighting up as gates pass, with the failing gate's last lines one click away
- [ ] **GATE-03**: A failing gate's output is fed back to the builder for a bounded number of retries before parking
- [ ] **GATE-04**: Gate integrity: edits to tests, gate configs or visual baselines are flagged by a protected-path check, and a test gate that ran zero tests fails
- [ ] **GATE-05**: Visual gate: each built screen is checked against its signed-off draft by comparing landmark regions (`data-cp-id`); drift fails the gate with a side-by-side image attached

### Pull Requests & Previews

- [ ] **PR-01**: Each finished phase opens its own PR whose body is generated from the phase artifacts and lists the assumed decisions
- [ ] **PR-02**: Each PR has a preview link: the host's own preview deploy when one exists (e.g. Vercel), otherwise a local preview Counterpoint serves for that worktree
- [ ] **PR-03**: After the signed merge, Counterpoint cleans up the item's worktree and branch

### Design Drafts

- [ ] **DRAFT-01**: Owner can request screen drafts for a phase; drafts are standalone local HTML with fixture data, styled in the host's own design system, served on an origin isolated from the console API
- [ ] **DRAFT-02**: Drafts are explored in a low-fi "wire" mode (neutral palette, real layout and components); the chosen draft is re-rendered as a hi-fi "full" render with the host's tokens and fixtures
- [ ] **DRAFT-03**: Owner can click any element of a draft and pin a comment to it; pins stay anchored across redraws
- [ ] **DRAFT-04**: Owner can batch several pinned comments and send them as one revision; the agent revises only the targeted parts
- [ ] **DRAFT-05**: Comments are threads the owner can resolve or reopen
- [ ] **DRAFT-06**: Owner can redraw a whole draft with a steering note
- [ ] **DRAFT-07**: Owner can ask for 2–3 variants side by side, pick one, or say "More like B" (optionally with a steering note) to get a new round anchored on B; a breadcrumb trail (A/B/C → B → B2 …) shows the path and lets the owner back up
- [ ] **DRAFT-08**: Owner can toggle each draft between mobile and desktop viewports and between states (empty, loading, error, long text)
- [ ] **DRAFT-09**: Relevant council personas pin their own comments on a draft before the owner reviews it
- [ ] **DRAFT-10**: Owner signs off the full render as part of the runway approval; it becomes the visual gate's reference

### Council

- [ ] **CNCL-01**: Seats (name, role, the evidence and tools each may use) are defined in a per-host config file; sensible defaults ship, and adding a seat is a config edit
- [ ] **CNCL-02**: For each council activity the owner can choose the relevant seats (picked by a router) or all seats
- [ ] **CNCL-03**: Meetings follow a structured protocol: independent blind pass per seat → one anonymised critique round → chair synthesis; deterministic turn order; hard caps on rounds, tokens and wall time
- [ ] **CNCL-04**: Seats clarify small points among themselves in async threads; a thread that stalls escalates to a meeting
- [ ] **CNCL-05**: Owner can call a meeting on any topic or screen, and read its minutes and full transcript
- [ ] **CNCL-06**: Every meeting produces discrete outputs: cards, backlog items, review notes
- [ ] **CNCL-07**: Owner sees token cost per seat and per meeting; per-meeting and per-day caps are enforced
- [ ] **CNCL-08**: The council never blocks the owner or the build lane — approving, drafting and building never wait on a meeting
- [ ] **CNCL-09**: Council files backlog items straight into the host backlog — tagged "council", with evidence and severity, deduplicated against the existing backlog, capped per meeting — with a summary in Needs You and bulk dismiss
- [ ] **CNCL-10**: The council meets automatically at configured lifecycle points (the default set is decided during phase discussion), running alongside the work, never in front of it

### Council Cards

- [ ] **CARD-01**: A card shows the question, the seats that raised it, 2–4 options with trade-offs, the recommended option, dissenting seats' positions (minority report), and a reversibility class
- [ ] **CARD-02**: Owner can Pick an option; it becomes a decision written back through the adapter and committed
- [ ] **CARD-03**: Owner can say "More like B →" (optionally with a steering note) to get a new round anchored on B, with a breadcrumb trail they can back up through
- [ ] **CARD-04**: Owner can choose "None fit, reframe" and the council reframes the question
- [ ] **CARD-05**: Owner can choose "Later" and the card stays in the inbox
- [ ] **CARD-06**: When the builder reaches work depending on an unanswered reversible card, it proceeds on the recommended option, logged in an assumptions ledger as "assumed"; if the owner later answers differently, a rework note goes to the open PR (or a backlog item if already merged)
- [ ] **CARD-07**: When the builder reaches work depending on an unanswered irreversible card (DB schema, auth, data model, public routes, privacy, pricing), only that item parks and the builder continues with other runway

### Mission View

- [ ] **MISN-01**: Runway — approved, ready-to-build work ahead of the builder — is the headline metric on the console
- [ ] **MISN-02**: One Needs You inbox collects council cards, parked items, seat conflicts, PRs awaiting signed merge, approved items whose content changed, and council backlog-filing summaries
- [ ] **MISN-03**: Each work item shows its status (queued, running, waiting on owner, parked, gates failing, ready for approval, merged)
- [ ] **MISN-04**: Beside runway, a few honest counters (e.g. first-attempt gate pass rate, items merged without intervention), each paired with a counter-metric so it can't reward a failure mode

## v2 Requirements

Deferred to a later milestone. Tracked but not in the current roadmap.

### Council

- **CNCL-V2-01**: Owner can watch a council meeting live
- **CNCL-V2-02**: Owner can interject a note into a running meeting, picked up at the next turn
- **CNCL-V2-03**: Post-build persona review — some seats drive the running app in character (browser, screenshots), others review artifacts; findings are advisory cards with evidence, labelled synthetic

### Gates

- **GATE-V2-01**: Tolerant, masked pixel-diff tier for the visual gate, enabled once a spike shows an acceptable false-positive rate

### Build Lane

- **BUILD-V2-01**: Agent commits carry a `Counterpoint-Run:` trailer linking to the run log
- **BUILD-V2-02**: macOS notification when something lands in Needs You
- **BUILD-V2-03**: Open a work item's worktree in the owner's editor from the console

### Design Drafts

- **DRAFT-V2-01**: Full draft version history with side-by-side compare

### Mission View

- **MISN-V2-01**: Full gamification panel (runway length trend, questions resolved, rounds-to-converge, …)

### Platform

- **PLAT-V2-01**: "No framework" adapter (plain markdown/YAML list)
- **PLAT-V2-02**: Public npm release as `@hkp/counterpoint`
- **PLAT-V2-03**: Touch ID / FIDO2 signing on click
- **PLAT-V2-04**: Ingest comments left on host preview deploys

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-vendor agent runtimes | Claude Code only, by principle |
| Cloud-hosted execution | Local worktrees are the product; cloud orchestrators are a shrinking, vendor-dominated market |
| Kanban board as source of truth / second spec system | Counterpoint reads the host's plan, never owns it |
| Auto-merge when gates are green | Merges only follow the owner's signed merge commit |
| Agent self-reported "done" as a gate | Gates are judged by exit code only |
| Council blocking work or failing items on persona opinion | Council is advisory; persona findings never fail gates |
| Free-flow debate as default, LLM-chosen next speaker, majority votes | Drift to conformity, nondeterminism, false precision — structured protocol instead |
| Numeric persona usability scores | Synthetic-user validity is weak; findings stay qualitative with evidence |
| Council reordering the roadmap or editing specs | Council would become a second planner; it files backlog items and cards only |
| Visual design editor / drag-and-drop canvas | Owner reviews and steers; doesn't draw |
| Figma round-trip | Second source of design truth; revisit after v1 |
| Multi-user accounts, roles, real-time collaboration | Single owner, loopback only |
| Chat-with-agent as primary UI | Pulls the owner into babysitting |
| Built-in code editor / diff viewer | Deep-link to GitHub and the owner's editor |
| Cross-provider cost/billing dashboards | One provider; per-run tokens and budget % only |
| Separate approvals repository | Approvals live in the host repo's normal history |
| shadcn/ui, Tailwind for Counterpoint's UI | Console uses Astryx |
| Pixel-exact zero-tolerance visual gate | Constant false failures from fonts, anti-aliasing, data |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Pending |
| FOUND-02 | Phase 1 | Complete |
| FOUND-03 | Phase 1 | Pending |
| FOUND-04 | Phase 1 | Pending |
| FOUND-05 | Phase 2 | Pending |
| FOUND-06 | Phase 1 | Complete |
| ADPT-01 | Phase 1 | Complete |
| ADPT-02 | Phase 1 | Complete |
| ADPT-03 | Phase 5 | Pending |
| ADPT-04 | Phase 5 | Pending |
| ADPT-05 | Phase 2 | Pending |
| APPR-01 | Phase 1 | Pending |
| APPR-02 | Phase 1 | Pending |
| APPR-03 | Phase 3 | Pending |
| APPR-04 | Phase 1 | Complete |
| APPR-05 | Phase 3 | Pending |
| BUILD-01 | Phase 2 | Pending |
| BUILD-02 | Phase 2 | Pending |
| BUILD-03 | Phase 2 | Pending |
| BUILD-04 | Phase 2 | Pending |
| BUILD-05 | Phase 5 | Pending |
| BUILD-06 | Phase 3 | Pending |
| BUILD-07 | Phase 3 | Pending |
| BUILD-08 | Phase 2 | Pending |
| BUILD-09 | Phase 3 | Pending |
| BUILD-10 | Phase 2 | Pending |
| GATE-01 | Phase 2 | Pending |
| GATE-02 | Phase 3 | Pending |
| GATE-03 | Phase 2 | Pending |
| GATE-04 | Phase 2 | Pending |
| GATE-05 | Phase 4 | Pending |
| PR-01 | Phase 2 | Pending |
| PR-02 | Phase 2 | Pending |
| PR-03 | Phase 3 | Pending |
| DRAFT-01 | Phase 4 | Pending |
| DRAFT-02 | Phase 4 | Pending |
| DRAFT-03 | Phase 4 | Pending |
| DRAFT-04 | Phase 4 | Pending |
| DRAFT-05 | Phase 4 | Pending |
| DRAFT-06 | Phase 4 | Pending |
| DRAFT-07 | Phase 4 | Pending |
| DRAFT-08 | Phase 4 | Pending |
| DRAFT-09 | Phase 6 | Pending |
| DRAFT-10 | Phase 4 | Pending |
| CNCL-01 | Phase 5 | Pending |
| CNCL-02 | Phase 5 | Pending |
| CNCL-03 | Phase 6 | Pending |
| CNCL-04 | Phase 6 | Pending |
| CNCL-05 | Phase 6 | Pending |
| CNCL-06 | Phase 6 | Pending |
| CNCL-07 | Phase 6 | Pending |
| CNCL-08 | Phase 5 | Pending |
| CNCL-09 | Phase 6 | Pending |
| CNCL-10 | Phase 6 | Pending |
| CARD-01 | Phase 5 | Pending |
| CARD-02 | Phase 5 | Pending |
| CARD-03 | Phase 5 | Pending |
| CARD-04 | Phase 5 | Pending |
| CARD-05 | Phase 5 | Pending |
| CARD-06 | Phase 5 | Pending |
| CARD-07 | Phase 5 | Pending |
| MISN-01 | Phase 1 | Pending |
| MISN-02 | Phase 1 (partial: the inbox and "approved items whose content changed"); parked items Phase 2 (BUILD-08); PRs awaiting signed merge Phase 3 (APPR-03); council cards Phase 5; backlog-filing summaries Phase 6 (CNCL-09); seat conflicts unassigned (open roadmap gap) | Pending |
| MISN-03 | Phase 3 | Pending |
| MISN-04 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 65 total
- Mapped to phases: 65
- Unmapped: 0 ✓

---
*Requirements defined: 2026-11-09*
*Last updated: 2026-11-09 after roadmap creation (traceability mapped)*

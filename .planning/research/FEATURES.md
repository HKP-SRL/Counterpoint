# Feature Research

**Domain:** Local mission control for autonomous spec-driven development (build lane + design sign-off + advisory multi-agent council)
**Researched:** 2026-11-09
**Confidence:** MEDIUM overall. Most product facts come from vendor docs plus third-party comparison blogs (web search only; classify-confidence for `websearch` = MEDIUM). Council and fidelity conclusions rest on a handful of 2025-2026 preprints and two small fidelity studies. Items marked (unverified) must be checked before they drive a requirement.

## Scope Note: What the three clusters teach

1. **Orchestrators are commoditising fast.** In the last ten months: Terragon shut down (Jan 2026, repo snapshot notice), Bloop shut down Vibe Kanban (2026-04-10; project continues community-maintained, no new features expected), and Meta acquired Conductor (reported 2026-11-04; Conductor Cloud read-only 11-13 and off 11-20; desktop app updated only until early 2027). Google's Jules and Roo Code are also reported shut down (secondary sources, unverified). Lesson: "run N agents in worktrees with a board" is table stakes and a bad place to differentiate. Counterpoint's value is the layer nobody ships: SDD-aware runway, signed approvals, exit-code gates, visual gate against a signed draft, and an advisory council. Stay thin over `claude -p`; do not reimplement what Claude Code cloud sessions already do (teleport, auto-fix PR, routines).
2. **Element-pinned commenting is solved at the "send this element to an agent" level** (Stagewise, react-grab, Agentation, Lovable, v0). It is *not* solved at "variants side by side, steer with 'more like B', approved draft becomes a binding reference." That is the open ground.
3. **Multi-agent debate has weak evidence as an accuracy booster and good evidence as a failure generator.** The council is justified as a perspective-and-evidence-gathering device (seats that see different things), not as an ensemble that gets "more right" by talking. That drives every council feature choice below.

---

## Feature Landscape

### Table Stakes (Users Expect These)

#### Cluster 1: Build lane / mission control

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Isolated workspace per task (git worktree) | Universal across Conductor, Claude Squad, Vibe Kanban, Cursor 3 Agents Window. Owner decision already made. | MEDIUM | Needs lifecycle: create, lock, rebase, prune on merge/abandon. Disk and node_modules cost on Cena (pnpm store helps). |
| One task = one branch = one PR | Copilot coding agent, Codex cloud, Cursor cloud agents all end in a PR. | LOW | Owner rule: one GSD phase = one PR. PR body generated from phase artifacts. |
| Task/run status model (queued, running, waiting on you, parked, gates failing, ready for approval, merged) | Cursor surfaces running / waiting / complete; every board tool has columns. | LOW | Derive from run state files, not from agent output. This is the backbone of Mission view and Needs You. |
| Live session log with stop control | Copilot: "View session" streams the agent's reasoning and tool calls, with "Stop session". | MEDIUM | Tail `claude -p --output-format stream-json` into SSE. Stop = kill process group + mark run. Loopback + token only. |
| Commit-to-session traceability | Copilot adds an `Agent-Logs-Url` trailer to every agent commit (third-party report, verify against GitHub docs). | LOW | Cheap and high-trust: add a `Counterpoint-Run:` trailer linking commit to run id and log. |
| Per-item CI/gate status with failing log reachable in one click | Conductor Checks tab; Copilot/Actions; owner requirement (gate row). | MEDIUM | Gates are commands judged by exit code; store last N lines per gate. |
| Failure feedback loop: failing gate output goes back to the agent | Conductor "send failing CI logs to the AI agent"; Claude Code PR auto-fix. | MEDIUM | Bounded retries then park. Retry count visible. |
| Diff view / review surface for the finished feature | Conductor is "diff-first"; every PR tool has it. | LOW | Do not build a diff viewer. Deep-link to the GitHub PR; show summary only. |
| Preview link on every PR | Vercel bot posts the preview URL on PRs; Codex/Cursor offer screenshots/preview. | MEDIUM | Host deploy preview if present (parse Vercel bot comment or deployments API), else Counterpoint-served local preview from the worktree. Local fallback needs port allocation and lifecycle. |
| Usage-limit wait, API-error backoff, stop time, single test lock | Overnight runs die without these; speckit-auto already has `retry_wait`, locks. | MEDIUM | Port from speckit-auto rather than rewrite. |
| Needs-attention notification | Cursor users file feature requests for push when agent needs input (forum), meaning it is a felt gap even in leaders. | LOW | macOS notification + menu-bar badge via loopback server; one inbox, not many channels. |
| Resume / retry a run after crash or reboot | All long-running agent tools persist session state. | MEDIUM | Run state on disk; `claude --resume` where it applies; handoff file on context-budget stop. |
| Run report at end of run | Not universal, but owner explicitly wants it; cloud agents give a per-task summary. | LOW | Merge-ready / parked / waiting-on-you / assumed-decisions list. |

#### Cluster 2: Design sign-off

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Click-to-pin comment on a specific element | Vercel toolbar comments, Stagewise, react-grab, Agentation, Lovable select-element, v0 design mode. | MEDIUM | Anchor must survive regeneration: store CSS path + stable `data-cp-id` assigned by the draft generator + bbox + cropped screenshot. Without stable ids, pins orphan on every redraw. |
| Batch several comments, then send as one revision request | v0 batches annotations into a single prompt; Stagewise multi-select. | LOW | One revision round = N comments = one agent run. Avoids per-comment cost and thrash. |
| Comment threads with resolve/reopen | Vercel comments (resolve checkbox). | LOW | Resolved when owner marks, or when agent revision addresses it and owner confirms. |
| Agent revises only the targeted part | Lovable ("short prompt, it knows what you picked"), v0. | MEDIUM | Prompt includes element source slice, not the whole draft; diff of draft versions shown. |
| Redraw whole screen with steering note | Every generator (v0, Lovable, Claude Design chat) supports "regenerate with instruction". | LOW | New version, old version retained. |
| Draft version history with compare | Claude Design / Figma Make / v0 versions; undo expectations. | LOW | Drafts are files in git or `.counterpoint/`; history = commits or numbered folders. |
| Viewport toggle (mobile/desktop) and state toggles (empty, loading, error, long text) | Wireframing tools and Storybook habit; Cena is a QR menu, so mobile is primary. | MEDIUM | State variants drive more visual-gate baselines later; define a per-screen "states" list in the draft. |
| Mock data, no backend | Owner requirement; same as Claude Design / Uizard prototypes. | LOW | Frozen deterministic fixtures. These become the gate's test fixtures (see dependencies). |

#### Cluster 3: Council

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Named seats with role description and tool/evidence access | AutoGen (agent `description` drives selection), CrewAI (role/goal/backstory), MetaGPT/ChatDev (SOP roles). | LOW | Per-host config file. The description is read by the router, so it must be a one-line "when to involve me" sentence. |
| Chair/moderator plus agenda and bounded rounds | AutoGen SelectorGroupChat, CrewAI hierarchical manager, ChatDev phases. | MEDIUM | Chair is a role of the orchestrator, not a free-roaming agent. Hard cap on rounds and tokens per meeting. |
| Full transcript plus minutes | Standard in every transcript-based tool; owner requirement. | LOW | Store raw turns (JSONL) and a chair-written minutes file. |
| Human observes live and can interject | AutoGen human proxy / `human_input_mode`; CrewAI `human_input` on tasks. | MEDIUM | SSE stream; interjection is appended as an "Owner" turn the chair reads at the next turn boundary. Never pauses the lane. |
| Output as discrete items (decision cards, backlog items, review notes), not just chat | Karpathy llm-council ends in one synthesised answer; MetaGPT emits structured artifacts (PRD, design docs). | MEDIUM | Define a strict schema (see differentiators). Free-text minutes are secondary. |
| Cost visibility per meeting | DeliberationBench-style findings (1.5-2.5x cost for deliberation) make budgets non-optional. | LOW | Show tokens per seat per meeting; per-meeting and per-day caps. |

---

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Runway as headline metric** (approved, ready-to-build work ahead of builder; empty = starving) | Aligns the UI with "approve and walk away". No surveyed tool measures owner-independence; they measure agent activity. | MEDIUM | Needs the adapter to expose "approved and unblocked phases", plus an estimate of builder hours per phase. Low-confidence estimates are fine; show count and rough time. |
| **Signed approval gate** (prepared command, verified signature before merge) | Closes the "agents satisfy, owner approves" loop. No surveyed orchestrator has cryptographic human sign-off; they rely on PR approval clicks. | HIGH | Key separation is the hard part. Verification via `git verify-commit` against an allowed-signers file agents cannot write. Highest-risk, highest-differentiation feature. |
| **Gates by exit code only; "done" never counts** | Removes agent self-report. Devin/Factory/Codex mostly report agent-claimed completion plus CI. | LOW | Mostly discipline. Surfacing "gate row lights up" is the visible part. |
| **Context-budget handoff** (stop at 40% of window, write handoff, fresh session) | Counters context rot on long phases; no surveyed tool exposes it as a first-class, adjustable control. | MEDIUM | Port `context-budget.sh`. UI shows token figure and per-run override. |
| **Parking with attempt counter + Needs You inbox** | Most tools either loop forever or fail loudly; parking converts a failure into a bounded, resumable question. | MEDIUM | Park record must include the last failing gate output, attempts, and a suggested next question for the owner. |
| **Conflict handling: rebase onto owner's pushes, re-gate, park on failure** | Day-time runs while the owner commits to master; worktree tools mostly leave conflicts to the human. | MEDIUM | Needs fetch/rebase automation, conflict-resolution agent step, and re-run of full gate set. |
| **Visual gate against the signed-off draft** | Turns design sign-off into a binding contract. Visual regression tools (Playwright `toHaveScreenshot`, Chromatic) compare build vs previous build; comparing build vs *approved mock* is the new bit. | HIGH | See "Fidelity Recommendation" below. Drives draft requirements. |
| **Variants side by side with "More like B"** | Generators produce one result at a time; the owner's trail of "round + breadcrumb + back up" is a distinct interaction. | MEDIUM | 2-3 variants rendered in a tabbed or split compare view; "more like B" anchors a new round on B with an optional steering note; breadcrumb with back-up. Same mechanic reused for council planning cards. |
| **Persona pre-comments pinned on drafts before the owner sees them** | Owner reviews a draft that already has Cook/waiter/diner issues flagged on elements. | MEDIUM | Persona reads the rendered draft (screenshot + DOM) and pins comments via the same anchor system. Mark clearly as AI; advisory only. |
| **Council cards with recommended option; unanswered proceeds on it ("assumed", overturnable)** | The owner is never the bottleneck, but every assumption is auditable. No surveyed tool has an "assume and log" semantics. | MEDIUM | Needs the builder to read card state at dependency time, write an "assumed" decision, and support later overturn that spawns a rework item. |
| **Card actions: Pick, "More like B", "None fit, reframe", Later** | A better front-end for `discuss-phase` grey areas. | MEDIUM | Depends on adapter write-back to CONTEXT decisions. |
| **Council files backlog items directly with evidence** | Catches root issues from earlier phases without triage overhead. | MEDIUM | Must have guard rails (see Anti-Features: backlog spam). Evidence = file/line, screenshot, gate output. Tag `council`; dedupe against existing backlog. |
| **Post-build persona review by driving the running app (browser) vs reading artifacts** | UXAgent-style synthetic testing exists in research; productised per-seat split of "drives" vs "reads" is the practical part. | HIGH | Browser automation via Playwright MCP or Claude's browser tooling. Expect tidy happy-path behaviour; real users hesitate and abandon. Use for obvious breakage and clarity problems, not as usability scores. |
| **Dissent preserved in cards (minority report)** | Counters debate capture / conformity documented in 2026 papers. | LOW | Card has a "disagreement" field populated by seats that rated a different option; chair may not delete it. |
| **Independent first pass, then cross-critique** | Karpathy llm-council stage 1 (independent) and stage 2 (anonymised ranking) are the best-known defence against anchoring. | MEDIUM | Default meeting format: seats answer independently in parallel; chair shows anonymised positions; one critique round; chair synthesises. Free-flow debate is opt-in. |
| **Gamification on real quality signals** (runway length, rounds-to-converge, first-attempt gate pass rate, merged-without-intervention) | Motivates reducing owner involvement instead of agent activity. | LOW | Pure derived metrics from run history; no extra infrastructure beyond event log. |
| **Host-agnostic core with adapter (GSD first)** | Differentiates from Spec-Kit-only and board-only tools. | MEDIUM | Define adapter contract before UI; keep tiny: list phases, read context/plans/backlog, write decision, write backlog item. |

---

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Multi-vendor agent support (Vibe Kanban's 10+ CLIs, Codex, Gemini) | Looks like flexibility; every board does it. | Owner principle; and it is the very surface that collapsed (Vibe Kanban, Terragon, Conductor all sold "any agent"). Doubles test matrix. | Claude Code only; keep the runner behind a thin interface for tests, not for vendors. |
| Cloud-hosted execution, VMs, sandboxes as a service | Cursor/Codex/Claude cloud do it. | Competes with funded vendors; a local server with worktrees is the stated product. Cloud shutdowns above show the business risk. | Local worktrees; optionally let the owner run on a second machine later. |
| Kanban board as the planning source of truth | Vibe Kanban's core model; looks familiar. | Becomes a second spec system. Owner rule: read the host's plan, never own it. | Board-like *views* derived from adapter data (runway, Needs You). Read-only except decisions and approvals. |
| Auto-merge when gates are green | Faster throughput. | Violates signed approval rule; gates cannot judge product fit. | Merge-ready queue; merge only after verified signature. |
| Agent self-reported completion as a gate | Easy to implement. | Documented multi-agent failure mode: verifier/self-check agents give false confidence; MAST names task verification as a major failure category. | Exit-code commands only. |
| Council as blocking gate / persona opinions failing work items | Appears to "enforce quality". | Taste opinions from synthetic personas are low-validity; owner decision is advisory. | Cards and review notes; owner decides. |
| Free-flow multi-agent debate as default meeting mode | AutoGen group chat and "agents arguing" demos look impressive. | Unguided homogeneous debate induces conformity, tokens scale with rounds x seats, and LLM-selected speaker has parse failures. | Independent first pass, one critique round, chair synthesis, hard round/token caps; free debate only on explicit request. |
| LLM-chosen next speaker | AutoGen "auto" mode. | Nondeterministic; documented failure where selector returns several names. | Deterministic turn order from agenda; chair only synthesises and decides when to stop. |
| Majority vote / numeric consensus score | Looks decisive. | Same-model seats are correlated, so votes are not independent; false precision. | Show options with seat positions and the recommended option; owner picks. |
| Numeric persona "usability scores" or "satisfaction ratings" | Dashboards love numbers. | Synthetic user research has weak ecological validity; agents take tidy paths real users do not. | Qualitative findings with evidence (screenshot, step), each labelled "synthetic". |
| Visual drag-and-drop design editor (Onlook, Figma-style canvas) | Direct manipulation feels powerful. | Becomes a design tool product; huge scope. Owner reviews and steers, does not draw. | Pin comment, steering note, variants. |
| Figma import/export, Figma Make round-trip in v1 | Teams already use Figma. | Solo owner, mocks are local HTML; sync problems; adds a second source of design truth. | Revisit after v1; keep draft format open to screenshot export. |
| Real-time multi-user collaboration, accounts, roles | Standard SaaS expectation. | Single owner, loopback only. Auth surface contradicts the security model. | Single-user local; token for start/stop. |
| Pixel-exact (zero-tolerance) visual gate | Sounds rigorous. | Fonts, anti-aliasing, data differences cause constant false failures (flakiness is a known root problem; baselines are best generated in CI/one environment). | Tiered tolerance + masked dynamic regions; park with diff image, not hard fail forever. |
| Letting the council auto-reorder the roadmap or edit specs | Autonomy appeal. | Council would become a second planner; conflicts with "never blocks, advisory". | Backlog items and cards only; owner promotes. |
| Unlimited council backlog filing | "Catch everything". | Backlog spam destroys trust in the inbox; filing directly (owner decision) amplifies the risk. | Per-meeting cap, dedupe vs existing backlog, evidence required, severity field, bulk dismiss, "council" tag for easy filtering. |
| Chat-with-agent as primary UI | Every tool has a chat pane. | Pulls owner into babysitting; contradicts "walk away". | Structured cards and gate rows; deep link to session log for the rare dive. |
| Built-in code editor / IDE features | Completeness. | Not the job; Claude Code and the owner's editor exist. | Open worktree in the owner's editor (`code`/Cursor) by button. |
| Token/cost billing dashboards across providers | Operators like them. | One provider, subscription-based. | Show per-run token figure and context-budget %, nothing more. |

---

## Feature Dependencies

```
Adapter interface (GSD) ──requires──> read phases/CONTEXT/backlog, write decision/backlog
    ├──> Runway metric
    ├──> Council cards write-back (decisions)
    └──> Council backlog filing

Worktree manager ──requires──> Run state store (event log)
    ├──> Builder session runner (claude -p, context-budget handoff)
    │       ├──> Gate runner (exit codes) ──> Gate row UI ──> Parking ──> Needs You inbox
    │       ├──> Rebase/conflict handling ──> re-run gates
    │       ├──> Usage-limit/backoff/test lock
    │       └──> PR creation ──> Preview link (host or local) ──> Run report
    └──> Live log + Stop control (needs start/stop token)

Signed approval ──requires──> key separation + allowed-signers + verify step
    └──gates──> Merge (both approval points: runway entry, merge)

Draft generator (stable data-cp-id, mock fixtures, tokens from host) 
    ├──> Element-pinned comments ──> Batched revision round ──> Draft versions
    ├──> Redraw with steering note
    ├──> Variants + "More like B" (shared mechanic with Council cards)
    ├──> Persona pre-comments (needs Council seats + draft anchors)
    └──> Signed-off draft ──requires──> Signed approval
              └──> Visual gate (needs same fixtures + viewports/states in the built app)

Council seats config ──requires──> Meeting runner (chair, agenda, turn order, budgets)
    ├──> Live view + interject (SSE)
    ├──> Cards ("assumed" semantics needs builder to read card state at dependency time)
    ├──> Backlog filing (needs dedupe + cap)
    └──> Post-build persona review (needs running preview + browser automation)

Needs You inbox ──aggregates──> cards, parked work, seat conflicts, persona findings, PRs awaiting signature
```

### Dependency Notes

- **Visual gate requires the draft to share fixtures and tokens with the built screen.** If the mock uses invented fonts, colors or data, the gate will never be stable. Therefore the draft generator must read the host's design tokens/components (Cena: shadcn + Tailwind) and write fixtures the builder is told to use in a gate-only route or story.
- **Variants/"More like B" is one mechanic, two surfaces** (drafts and planning cards). Build it once as a "round" model: anchor, steering note, children, breadcrumb.
- **"Assumed" decisions require builder-to-card coupling.** The builder must be able to ask "is there an unanswered card blocking this task?" and record the assumption. Build this before cards are surfaced in the UI, or the "never blocks" promise is untestable.
- **Persona pre-comments require draft anchors** and the council seat system; they cannot ship before both exist. Post-build persona review additionally requires the preview link and browser tooling.
- **Signed approval conflicts with any auto-merge convenience.** Do not add a "merge now" button that bypasses verification, even for the owner.
- **Council backlog filing requires dedupe + cap before it ships.** Otherwise the first multi-seat meeting floods the host backlog.
- **Context-budget handoff enhances builder runner** and must exist before long multi-plan phases are run unattended.

---

## Fidelity Recommendation (owner's explicit research ask)

**Recommendation: sign off at high fidelity in layout and tokens, with mock data; explore at low fidelity. Same HTML artifact, two rendering modes.**

Evidence and reasoning:
- Small fidelity studies show that low-fidelity prototypes draw comments on structure, text and new ideas, while high-fidelity ones draw comments on color and imagery (UBC thesis); a Cambridge study found lower fidelity elicits more varied feedback types (children, physical toys, so weak transfer). Practitioner consensus: low-fi for flow/IA/concept, high-fi for visual detail and edge cases. No strong controlled evidence for either as "better"; treat as MEDIUM-LOW.
- The decisive factor is the **visual gate**: a wireframe cannot be a reference for comparing a built screen. Only a draft that uses the host's real tokens, spacing, components and fixtures can be compared meaningfully. A hi-fi draft built from invented styles is nearly as useless as a wireframe, because the build will use shadcn/Tailwind tokens and diverge everywhere.
- Therefore:
  1. **Explore (variants, "more like B"):** render drafts in a grayscale "wire" mode (system font, neutral palette, real layout and real components). Cheap, focused on structure; avoids color nitpicks.
  2. **Sign-off:** the picked variant is re-rendered in "full" mode with host tokens and fixtures. This is the artifact that is signed and becomes the reference.
  3. **Gate in tiers:** (a) structural: landmark/region bounding boxes, order, presence of required elements (robust, low flake); (b) pixel diff on masked regions with per-screen tolerance. Fail (a) strictly, (b) with tolerance; on repeated failure, park with the diff image.
- Implementation hint: draft = real components + fixtures, rendered through a tiny Counterpoint harness. A CSS/theme switch gives wire vs full mode without a second artifact. Complexity MEDIUM, but it avoids double work.
- Unverified: no source found for mock-versus-build comparison (only build-versus-baseline Playwright/Chromatic workflows). This is novel and needs a spike (see Open Questions).

---

## Council Format Recommendation (owner's explicit research ask)

Evidence summary:
- DeliberationBench (arXiv 2601.08835, Jan 2026, preprint): multi-LLM deliberation underperformed simply picking the best single draft at 1.5-2.5x the cost (snippets fragmentary; read the paper before citing exact figures).
- "The Cost of Consensus" (arXiv 2605.00914): unguided homogeneous debate induces conformity; isolated self-correction beat it.
- Dissent-preservation papers (AI Council, Meta Council) argue for independent evaluation plus preserved minority views; self-published, treat as LOW-MEDIUM.
- MAST (arXiv 2503.13657, NeurIPS 2025 D&B): 14 failure modes across 1,642 traces; most failures are system design and inter-agent misalignment, not model weakness; an example is a ChatDev role ending the conversation without consensus. SOP-style structure (MetaGPT) reduces design/misalignment failures but not verification failures (secondary).
- AutoGen speaker selection: LLM-chosen speaker is unreliable; deterministic callable / transition graph is the documented override.
- Karpathy `llm-council`: independent answers, anonymised cross-ranking, chairman synthesis; known verbosity bias; author calls it a weekend hack.

Therefore the default meeting is:
1. **Brief:** chair posts agenda with question and evidence bundle (diff, screenshots, gate output, relevant plan files).
2. **Independent pass (parallel):** each relevant seat answers alone, with only its own evidence; output must be structured (position, reasons, risks, confidence).
3. **Cross-critique (one round):** positions anonymised; each seat may challenge up to N points.
4. **Synthesis by chair:** produces card(s), recommended option, dissent notes, backlog candidates, minutes.
5. **Stop rule:** hard caps on rounds, tokens, and wall time; early stop if critiques add no new points.

Seat differentiation must come from **information and tools**, not persona prompts alone: Cook drives the app, tech reads diff and types, compliance reads policy docs, QA reads gate output. Same-model personas with the same context are the conformity case the papers warn about.

Router: seat descriptions select "relevant few" by default; "all seats" is an owner toggle per activity. Show estimated token cost before running.

---

## MVP Definition

### Launch With (v1)

Minimum to validate "approve and walk away, come back to green PRs":

- [ ] Adapter contract + GSD adapter read side (phases, CONTEXT, plans, backlog) — everything else depends on it
- [ ] Worktree-per-phase builder in fresh `claude -p` sessions with context-budget handoff — core value
- [ ] Gate runner (exit codes), gate row UI, failing-log drill-down — trust foundation
- [ ] Parking after N attempts + Needs You inbox (parked items first) — bounded failure
- [ ] Usage-limit wait, API backoff, stop time, test lock, start/stop token — overnight viability
- [ ] PR per phase with preview link (host preview, local fallback) — the morning-after picture
- [ ] Signed approval for merge (prepared command + verification) — owner rule; includes allowed-signers setup
- [ ] Run report + runway headline metric — the success metric
- [ ] Rebase-onto-latest-master with re-gate and park on failure — the owner works on master during the day
- [ ] Draft pipeline: standalone mock with host tokens/fixtures, element-pinned comments, redraw with steering note, version history — design sign-off MVP
- [ ] Signed-off draft recorded as reference (approval point 1) — enables the visual gate
- [ ] Council planning cards with recommended option, Pick / More like B / reframe / Later, "assumed" semantics, decision write-back — signature interaction (owner decision)

### Add After Validation (v1.x)

- [ ] Visual gate (structural tier first, pixel tier second) — after drafts and the builder run stably on real Cena screens; needs a spike first
- [ ] Variants side by side (wire mode) — once single-draft comment loop is solid
- [ ] Meetings: async threads first, then structured meetings with chair, minutes, live view and interject — after cards prove useful
- [ ] Council backlog filing with dedupe, cap and evidence — after meetings; includes bulk dismiss
- [ ] Persona pre-comments on drafts — after draft anchors and seats exist
- [ ] Post-build persona review (drive-the-app seats first: Cook, waiter, diner; artifact-reader seats: tech, compliance) — after preview links work reliably
- [ ] Preview feedback loop: ingest Vercel toolbar / PR review comments as a fix round — owner trigger, bounded
- [ ] Gamification panel — derived metrics from event log

### Future Consideration (v2+)

- [ ] No-framework adapter (plain markdown/YAML) — explicit out of v1
- [ ] Public npm release — explicit defer
- [ ] Touch ID or hardware-key signing — owner noted "could come later"
- [ ] Auto-meeting triggers (kickoff, post-build, conflict escalation) — open question; decide in discuss/planning with the rule "alongside, never in front"
- [ ] Figma/Penpot import of drafts — only if the owner starts designing outside Counterpoint
- [ ] Mobile/remote notifications

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Worktree-per-phase builder + handoff | HIGH | MEDIUM | P1 |
| Gate runner + gate row | HIGH | MEDIUM | P1 |
| Parking + Needs You inbox | HIGH | MEDIUM | P1 |
| PR + preview link | HIGH | MEDIUM | P1 |
| Signed approval + verify | HIGH | HIGH | P1 |
| Runway metric + run report | HIGH | MEDIUM | P1 |
| Usage-limit / backoff / lock / token | HIGH | MEDIUM | P1 |
| Rebase and re-gate | HIGH | MEDIUM | P1 |
| GSD adapter (read + write-back) | HIGH | MEDIUM | P1 |
| Council cards with assumed semantics | HIGH | MEDIUM | P1 |
| Draft pipeline + pinned comments + redraw | HIGH | MEDIUM | P1 |
| Commit trailer linking to run log | MEDIUM | LOW | P1 |
| Live log + stop | MEDIUM | MEDIUM | P2 |
| Visual gate | HIGH | HIGH | P2 |
| Variants + More like B on drafts | MEDIUM | MEDIUM | P2 |
| Structured meetings (chair, minutes, live, interject) | MEDIUM | HIGH | P2 |
| Council backlog filing (with dedupe/cap) | MEDIUM | MEDIUM | P2 |
| Persona pre-comments | MEDIUM | MEDIUM | P2 |
| Post-build persona review (drive the app) | MEDIUM | HIGH | P2 |
| Preview comment ingestion | LOW | MEDIUM | P3 |
| Gamification panel | LOW | LOW | P3 |
| Figma/Penpot import | LOW | HIGH | P3 |

**Priority key:** P1 must have for launch; P2 add when the P1 loop is stable; P3 future.

---

## Competitor Feature Analysis

| Feature | Competitor behaviour | Our Approach |
|---------|----------------------|--------------|
| Parallel isolated runs | Conductor, Claude Squad (tmux + worktrees), Vibe Kanban (card = worktree), Cursor 3 Agents Window | Same primitive, but keyed by GSD phase and bound to approved-runway; no board |
| Progress/attention state | Cursor shows running / waiting / complete; push notification for "needs input" still a user request on the forum | One Needs You inbox with local notification |
| Session transparency | Copilot: View session, live logs, Stop, `Agent-Logs-Url` commit trailer (third-party report) | Log tail + stop + run-id trailer on commits |
| CI feedback to agent | Conductor Checks tab (send failing CI logs to agent); Claude Code cloud PR auto-fix | Gate output fed back with bounded retries and parking |
| Where it runs | Codex cloud sandboxes, Cursor cloud VMs, Claude Code on the web | Local worktrees only |
| Preview | Vercel preview + bot comment; Codex/Cursor screenshots | Host preview or local server; PR link in inbox |
| Human approval | PR review click (GitHub) | Signed commit verified before merge (novel) |
| Element comments | Vercel toolbar comments (threads, resolve, CLI `vercel comments`); Stagewise (select, comment, send DOM + screenshot); react-grab (copy file/component/HTML context, MCP `get_element_context`); Agentation (floating toolbar annotations); Lovable select mode; v0 design mode (annotations batched into one prompt) | Own anchor system with stable ids on local drafts; batched revision rounds |
| Whole-screen regenerate | v0, Lovable, Claude Design (April 2026 research preview; sharing with comment access; handoff to Claude Code; known inline-comment bugs reported) | Redraw with steering note + version history |
| Variants / "more like this" | Not found in surveyed tools (Claude Design variants unverified) | First-class: 2-3 variants, More like B, breadcrumbs |
| Design to build contract | Claude Design hands off a spec bundle to Claude Code; none compare build to approved mock | Signed draft = reference for visual gate |
| Multi-agent meetings | AutoGen GroupChat/SelectorGroupChat, CrewAI manager, ChatDev phases, MetaGPT SOP roles, Karpathy llm-council (3-stage) | Chair-led, deterministic turns, independent first pass, dissent kept, cards as outputs |
| Synthetic users | Research systems like UXAgent; vendor "synthetic users" products; validity criticised | Seats that drive the app in character; advisory findings with evidence |

---

## Open Questions and Spikes Needed (for roadmap flags)

1. **Mock-vs-build visual comparison.** No prior art found. Needs a short spike on Cena: same fixtures, same viewport, structural tier + masked pixel tier; measure false-positive rate over 20 runs.
2. **Stable element anchors across redraws.** Decide `data-cp-id` generation contract in the draft generator and test pin survival over 5 revisions.
3. **Key separation for signing.** Verify an agent running as the same OS user cannot reach the signing key (passphrase never cached, `gpg-agent`/ssh-agent caching off); test on macOS.
4. **Preview detection.** Vercel bot comment parsing vs Deployments API; local preview port/lifecycle.
5. **Persona browser driving.** Which browser tooling is most reliable under `claude -p` (Playwright MCP vs Claude in Chrome) and token cost per screen walk.
6. **Auto-trigger rules for meetings** (open per PROJECT.md).
7. **Claude Code native features to avoid duplicating.** Re-check current Claude Code docs for cloud sessions, auto-fix PR, routines and teleport before locking scope (search returned conflicting flag names and availability).

---

## Sources

Confidence labels: M = MEDIUM (web search, third-party or mixed), L = LOW (single secondary source), H = HIGH (would require official docs; none fully read this session).

**Orchestrators**
- Conductor / orchestration tool comparisons: https://crystl.dev/blog/best-ai-agent-orchestration-tools/ (M), https://nimbalyst-website.pages.dev/blog/best-git-worktree-tools-ai-coding-2026/ (M), https://www.conductor.build/blog/checks-tab (M, vendor)
- Meta acquires Conductor: https://siliconangle.com/2026/11/04/meta-acquires-ai-coding-startup-conductor-whose-app-runs-several-coding-agents-at-once/ (M); timeline details conflict across outlets
- Vibe Kanban shutdown: https://vibekanban.com/blog/shutdown (M-H, vendor primary; fetched only via search snippets)
- Terragon shutdown: https://bra1ndump-website.pages.dev/blog/research/harness-engineering/terragon and https://jmduke.com/posts/failed-experiments/ (L; no official notice found)
- Copilot coding agent session logs: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/track-copilot-sessions (H, official) and https://dev.to/htekdev/copilot-coding-agent-gets-50-faster-full-session-visibility-34p3 (L for the trailer claim)
- Cloud/background agents compared: https://developertoolkit.ai/en/workflows/automate/background-agents/ (M), https://www.morphllm.com/cursor-background-agents (M), https://forum.cursor.com/t/push-notifications-mobile-desktop-when-agent-needs-user-input-or-approval/148230 (M)
- Claude Code on the web: https://code.claude.com/docs/en/claude-code-on-the-web (H official, only index snippets read)
- Factory / Devin: https://docs.factory.ai/user-guides/droids/understanding-droids (M); review aggregators (L)

**Design commenting and mock iteration**
- Vercel toolbar comments: https://vercel.com/docs/comments (H official), https://community.vercel.com/t/sync-vercel-preview-deployment-comments-to-github-pr-for-ai-agent-feedback-loops/31663 (M, community proposal)
- Stagewise: https://stagewise.io/docs (H-M)
- react-grab: https://www.mintlify.com/aidenybai/react-grab/introduction (M)
- Agentation: https://sourceforge.net/mirror/agentation/ (L, mirror listing)
- Lovable visual edit / preview toolbar: https://docs.lovable.dev/features/visual-edit (H official)
- v0 design mode: https://b_1eghmy2q0il.v0.build/docs/design-mode (M)
- Onlook: https://github.com/dimkaib/onlook (L, fork listing)
- Claude Design: https://support.claude.com/en/articles/14604416 (H official, not fully read), https://venturebeat.com/ai/anthropic-just-launched-claude-design-an-ai-tool-that-turns-prompts-into-prototypes-and-challenges-figma (M), https://techrepublic.com/article/news-anthropic-claude-design-overhaul-enterprise-teams (M)
- Fidelity: UBC thesis https://open.library.ubc.ca/collections/24/items/1.0437959 (M), Cambridge study https://resolve.cambridge.org/core/product/B3478512A1FF8EE2EF2B5A82D42DD86F/core-reader (M, different population), https://www.uxpin.com/studio/?p=31714 (L, vendor)
- Visual regression practice: https://www.browserstack.com/guide/playwright-snapshot-testing (M), https://argos-ci.com/blog/fix-flaky-visual-tests (M)

**Councils**
- DeliberationBench: https://arxiv.org/html/2601.08835 (M, preprint; read in snippets)
- The Cost of Consensus: https://arxiv.org/html/2605.00914 (M, preprint)
- Council Mode: https://arxiv.org/pdf/2604.02923 (M, preprint)
- Dissent preservation: https://www.themoonlight.io/review/preserving-disagreement-architectural-heterogeneity-and-coherence-validation-in-multi-agent-policy-simulation (L), https://daliu.github.io/research/meta-council-paper.pdf (L, self-published)
- MAST: https://arxiv.org/html/2503.13657v3 (M-H, peer-reviewed track; percentages cited only from secondary summaries)
- AutoGen speaker selection: https://microsoft.github.io/autogen/0.2/docs/topics/groupchat/transform_messages_speaker_selection (H official), https://github.com/microsoft/autogen/issues/2583 (M)
- Karpathy llm-council: https://github.com/karpathy/llm-council (H repo), https://www.analyticsvidhya.com/blog/2025/12/llm-council-by-andrej-karpathy/ (M)
- CrewAI hierarchical process, MetaGPT and ChatDev role mechanics: from training knowledge, not re-verified this session (L-M)
- Synthetic users validity: https://arxiv.org/pdf/2512.00461 (M), https://radar.zurb.com/article/ai-found-one-real-bug-it-also-made-up-three-that-never-happened (L), https://www.userbrain.com/blog/synthetic-users-experiment/ (L)

---
*Feature research for: local mission control for autonomous spec-driven development (Counterpoint)*
*Researched: 2026-11-09*

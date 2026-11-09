# Phase 1: Trusted Shell & Signed Runway - Context

**Gathered:** 2026-11-09
**Status:** Ready for planning

<domain>
## Phase Boundary

The owner can run Counterpoint against Cena, see proof that agents are boxed in, browse Cena's GSD phases, and sign phases into a runway that recomputes itself from git.

Delivers: the loopback Astryx console (light and dark), the owner credential flow, `counterpoint doctor` with a live sandbox probe, the GSD adapter (read-only, native `.planning/` parsing) behind a lint-enforced boundary, signed runway approvals in Cena's normal history, the runway headline, and a Needs You inbox that in this phase only receives "approved version changed" items.

Not in this phase: running builds, gates, PRs, merge approvals (Phase 2–3), drafts and the draft hash (Phase 4), council (Phase 5–6). Requirements: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-06, ADPT-01, ADPT-02, APPR-01, APPR-02, APPR-04, MISN-01, MISN-02.

</domain>

<decisions>
## Implementation Decisions

### What an approval locks
- **D-01:** A phase can be signed into the runway only after plan-phase: it must have a CONTEXT.md and at least one PLAN.md. The owner signs the exact plans the builder will run; the builder never plans a phase on its own. The console shows phases without plans as "not ready to approve" (with the reason) rather than offering the approve action.
- **D-02:** The approval's spec hash covers the phase's **inputs only**: the phase's `NN-CONTEXT.md`, every `NN-*-PLAN.md`, and the spec documents in the phase directory when present (`*-RESEARCH.md`, `*-UI-SPEC.md`, `*-SPEC.md`, `*-AI-SPEC.md`), plus **this phase's own section of `.planning/ROADMAP.md`** (its Phase Details block). Excluded: `STATE.md`, other phases' roadmap sections and directories, outputs (`*-SUMMARY.md`, `*-VERIFICATION.md`, `*-UAT.md`, reviews), `*-DISCUSSION-LOG.md`, checkpoints. Editing another phase never knocks this one off the runway. The per-file digests are recorded in the approval statement (not only one combined hash) so the change view can name which inputs changed. — **Reversibility:** costly — changing the covered set later changes every computed digest, so all existing approvals in the host's history stop matching and must be re-signed; the adapter owns the "which files are inputs" rule so core stays framework-agnostic.
- **D-03:** Approvals are recomputed against the files **as committed on the base branch tip** (Cena: `master`), which is what the builder will check out. Uncommitted edits in the owner's checkout do not invalidate an approval; the console shows a soft hint ("uncommitted edits to an approved phase") on that item.
- **D-04:** When an approved phase's inputs change, the item leaves the runway and a Needs You item "approved version changed" appears. It shows which inputs changed **and the actual diff** between what was signed (content at the approval's recorded base commit) and what is on the base branch now, plus the one-line command to re-sign. Re-signing writes a new signed commit that replaces `.counterpoint/approvals/<item>.json`.

### Starting & logging in
- **D-05:** `npx @hkp/counterpoint` starts a **background daemon** (or attaches to the one already running), prints the console URL and returns the terminal. `counterpoint stop` and `counterpoint status` control it. Crash-only: the daemon reconciles its state on every start. — **Reversibility:** costly — the CLI-to-daemon control channel and process lifecycle shape every later command (run start/stop, approve, doctor).
- **D-06:** **One daemon per machine**, serving every registered host. Running `counterpoint` inside another repo registers it as another host; the console switches between hosts. All agent spawns across hosts will go through the one quota governor (Phase 2). v1 only needs Cena, but the data model and routes are host-scoped from the start. — **Reversibility:** costly — host id is part of every stored row, path and route.
- **D-07:** Owner credential via a **one-time URL**: start (and `counterpoint open`) prints, and opens, a URL carrying a single-use code; the server exchanges it for an `HttpOnly; SameSite=Strict` session cookie and the code dies. The raw token lives in a `0600` file under the Counterpoint home, which agent sandboxes deny. Normal session length (not a weeks-long cookie); logging in from another browser = run `counterpoint open` again.
- **D-08:** Counterpoint home defaults to the platform location (`~/Library/Application Support/Counterpoint` on macOS, XDG data dir on Linux) and is overridden by `COUNTERPOINT_HOME`. On the owner's machine it is set in `~/.zshrc` to `/Volumes/Dock/Dev/Library/Application Support/Counterpoint`. If the configured home does not exist (e.g. the Dock volume is unmounted), Counterpoint **refuses to start** with a clear message instead of creating state on the internal disk. The home holds the SQLite store, token file, logs and the owner's public key / allowed-signers file. — **Reversibility:** reversible — relocation is a move plus an env change.

### Carried forward (already decided in PROJECT.md / roadmap — do not re-open)
- Agent runtime: spawn the owner's own `claude -p` with `--output-format stream-json` behind one `AgentRunner` port; Agent SDK only as a later second implementation.
- Console UI: React 19 + Astryx (`@astryxdesign/core` + a theme package), no shadcn, no Tailwind; prebuilt SPA served by the daemon; SSE for live updates.
- GSD adapter parses `.planning/` natively (frozen Cena fixtures are the contract); it does not depend on `gsd-tools` JSON verbs. `gsd-tools` may be used only as an optional cross-check in `doctor`.
- Approvals live in Cena's normal history: an owner-signed commit on the base branch adding only `.counterpoint/approvals/<item>.json`. Signing and verification call `ssh-keygen -Y sign/verify` directly with a clean environment, never git's config-driven signing or repo hooks. The owner's public key lives outside the repo. Signing is refused if `.git/config` or `.git/hooks` changed unexpectedly.
- Approval statement binds spec digests, the draft digest (slot empty until Phase 4) and the gate-config digest. Approval is recomputed, never stored as authority.
- Package name is `@hkp/counterpoint`; one package, modular monolith, core never imports the GSD adapter directly (lint rule fails the build).
- Start with the sandbox spike: confirm Claude Code's sandbox confines headless `claude -p` (Bash and the Read/Edit tools) before building the trust model on it.

### Claude's Discretion
The owner chose not to discuss these; use the defaults below unless research shows a reason not to, and flag any deviation plainly.
- **Signing key:** a new, dedicated, passphrase-only ed25519 key for Counterpoint approvals (not the owner's general `~/.ssh/id_ed25519` and not reusing the prototype's `cena_owner` key without checking it is passphrase-protected). `doctor` checks it is passphrase-protected and not listed by `ssh-add -L` nor loadable via `UseKeychain`/`AddKeysToAgent`. Generating it is an owner action guided by `doctor` / a setup command; Counterpoint never holds the passphrase.
- **Approval command shape and landing:** a one-line, ID-only command (e.g. `counterpoint approve <host> <phase>`) that re-derives and prints exactly what is being signed before asking for the passphrase. The commit is created without checking anything out (build the tree from the base tip + the approval file, sign, then compare-and-swap update of the base ref), so the owner's uncommitted work is untouched. If the owner's checkout currently has the base branch checked out, only the approval file is placed in its index/working tree so it does not appear as deleted. **Not pushed automatically** — pushing stays the owner's action in Phase 1. Exact mechanics are a research item.
- **Gate-config digest before gates exist:** keep the slot in the statement; hash the gates section of the host's Counterpoint config (a defined sentinel value when absent) so Phase 2 does not change the statement format.
- **Sandbox probe failure:** `doctor` reports it as a hard fail; the console still runs and approvals still work, but anything that spawns agents (from Phase 2 on) refuses to start while the probe fails. If the spike shows Claude Code's sandbox does not confine `claude -p`, fall back to wrapping the whole `claude` process (e.g. `srt`) or document a weaker boundary — and surface that choice to the owner before Phase 2 is planned.
- **Port:** a fixed default port on `127.0.0.1` with a clear error (not silent drift) if it is taken; configurable.
- **Prerequisites display:** phases with `user_setup` or non-autonomous plans can still be approved, but the prerequisite is shown prominently on the phase and in the approval summary.
- **Which phases are listed:** all of Cena's roadmap phases with derived status; the QR-menu phases are the focus of the demo, not a filter.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project scope and decisions
- `.planning/PROJECT.md` — requirements, constraints and the Key Decisions table (authoritative over `CLAUDE.md` where they conflict, see note below)
- `.planning/REQUIREMENTS.md` — FOUND-01..04, FOUND-06, ADPT-01..02, APPR-01, APPR-02, APPR-04, MISN-01..02
- `.planning/ROADMAP.md` §Phase 1 — goal, five success criteria, "start with the sandbox spike" note
- `.planning/STATE.md` §Blockers — sandbox-under-`claude -p` is unverified and gates the trust model
- `VISION.md` — the owner's original vision

### Research
- `.planning/research/SUMMARY.md` — D1–D9 owner decisions (D2 was rejected by the owner: approvals stay in the host repo), Critical Pitfalls 7, 8, 14, 15, 17, Gaps (sandbox coverage)
- `.planning/research/ARCHITECTURE.md` — module layout (`core/`, `adapters/gsd`, `compose.ts`), store/event pattern, security boundary. Its `approvals.git` proposal is superseded by PROJECT.md.
- `.planning/research/PITFALLS.md` — loopback guard, same-user secrets, signature verification adversarial tests, `.planning/` parsing hazards
- `.planning/research/STACK.md` — versions, loopback security recipe, local git/ssh signing experiment (git 2.50.1)

### Stale guidance to ignore
- `.claude/CLAUDE.md` "Headline Decisions" / stack tables still say Agent SDK, Tailwind + shadcn, `gsd-tools` JSON first, and `@alex-profir/counterpoint`. PROJECT.md supersedes all four: spawn `claude -p` + stream-json, Astryx, native parsing, `@hkp/counterpoint`.

### Prior art (reuse ideas and components, not the spec)
- Cena branch `ccr-61ff69b1-hgtpdm`: `lib/factory/guard.ts` (loopback Host/Origin guard and its WR-01 note that only the bind stops LAN clients), `lib/factory/signature.ts` (`%G? %GF` parsing, `log.showSignature=false`, uncommitted detection), `lib/factory/mission-theme.ts` / `use-mission-theme.ts` (light/dark console theme), `app/__mission/*` (console prototype). Read with `git -C /Volumes/Dock/Projects/HKP/Cena show ccr-61ff69b1-hgtpdm:<path>`.
- `/Volumes/Dock/Projects/HKP/CV/tools/speckit-auto/test-lock.ts` — `node:sqlite` exclusive-lock technique (store experience)

### Host fixtures
- `/Volumes/Dock/Projects/HKP/Cena/.planning/` — ROADMAP.md, phases (`01-multi-tenant-foundation` with 17 plans, `01.1-design-system-migration`), BACKLOG.md. Freeze a copy as adapter contract fixtures; read-only, never write.

### External docs (verify current behaviour)
- https://code.claude.com/docs/en/headless — `claude -p`, stream-json
- Claude Code sandboxing and settings docs — `sandbox` filesystem/network rules, `permissions.deny`, managed-settings precedence (for the spike)
- https://hono.dev/docs/helpers/streaming — `streamSSE`
- Astryx: https://github.com/meta/astryx (`@astryxdesign/core`, themes)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- No Counterpoint source code exists yet; the repo holds `.planning/`, `VISION.md` and the GSD install under `.claude/`.
- Prototype guard and signature modules in Cena's `ccr-61ff69b1-hgtpdm` branch can be ported (they are dependency-free TS with tests in that branch).

### Established Patterns
- Prototype conventions worth keeping: `execFile` with argument arrays (no shell), IDs validated against a slug regex before being used in paths, `-c log.showSignature=false` when reading signature status.

### Integration Points
- Host side: Cena repo at `/Volumes/Dock/Projects/HKP/Cena`, default branch `master`, `.planning/` written by GSD 1.20.x. Note: Cena's checkout is currently on the prototype branch, not `master` — the approval flow must not assume the owner's checkout is on the base branch.
- Owner machine: `~/.ssh` has `id_ed25519` (global git signing key) and `cena_owner`; ssh-agent currently holds no identities.

</code_context>

<specifics>
## Specific Ideas

- The re-approve view should feel like reviewing a PR: "here is what changed since you signed", then the one command.
- The install-location rule (everything on `/Volumes/Dock`) is honoured through `COUNTERPOINT_HOME`, not symlinks, and Counterpoint must fail loudly rather than fall back to the internal disk.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-trusted-shell-signed-runway*
*Context gathered: 2026-11-09*

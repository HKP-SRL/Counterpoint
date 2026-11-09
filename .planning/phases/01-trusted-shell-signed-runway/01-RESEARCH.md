# Phase 1: Trusted Shell & Signed Runway - Research

**Researched:** 2026-11-09
**Domain:** Local loopback daemon + Astryx console; Claude Code sandbox confinement; plumbing-level signed git approvals; native GSD `.planning/` parsing
**Confidence:** HIGH on the trust mechanics (sandbox, signing, verification, Astryx build: all run this session), MEDIUM on daemon/lifecycle design (design, with the lock primitive proven), LOW on a handful of items listed in the Assumptions Log

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**What an approval locks**
- **D-01:** A phase can be signed into the runway only after plan-phase: it must have a CONTEXT.md and at least one PLAN.md. The owner signs the exact plans the builder will run; the builder never plans a phase on its own. The console shows phases without plans as "not ready to approve" (with the reason) rather than offering the approve action.
- **D-02:** The approval's spec hash covers the phase's **inputs only**: the phase's `NN-CONTEXT.md`, every `NN-*-PLAN.md`, and the spec documents in the phase directory when present (`*-RESEARCH.md`, `*-UI-SPEC.md`, `*-SPEC.md`, `*-AI-SPEC.md`), plus **this phase's own section of `.planning/ROADMAP.md`** (its Phase Details block). Excluded: `STATE.md`, other phases' roadmap sections and directories, outputs (`*-SUMMARY.md`, `*-VERIFICATION.md`, `*-UAT.md`, reviews), `*-DISCUSSION-LOG.md`, checkpoints. Editing another phase never knocks this one off the runway. The per-file digests are recorded in the approval statement (not only one combined hash) so the change view can name which inputs changed. — **Reversibility:** costly — changing the covered set later changes every computed digest, so all existing approvals in the host's history stop matching and must be re-signed; the adapter owns the "which files are inputs" rule so core stays framework-agnostic.
- **D-03:** Approvals are recomputed against the files **as committed on the base branch tip** (Cena: `master`), which is what the builder will check out. Uncommitted edits in the owner's checkout do not invalidate an approval; the console shows a soft hint ("uncommitted edits to an approved phase") on that item.
- **D-04:** When an approved phase's inputs change, the item leaves the runway and a Needs You item "approved version changed" appears. It shows which inputs changed **and the actual diff** between what was signed (content at the approval's recorded base commit) and what is on the base branch now, plus the one-line command to re-sign. Re-signing writes a new signed commit that replaces `.counterpoint/approvals/<item>.json`.

**Starting & logging in**
- **D-05:** `npx @hkp/counterpoint` starts a **background daemon** (or attaches to the one already running), prints the console URL and returns the terminal. `counterpoint stop` and `counterpoint status` control it. Crash-only: the daemon reconciles its state on every start. — **Reversibility:** costly — the CLI-to-daemon control channel and process lifecycle shape every later command (run start/stop, approve, doctor).
- **D-06:** **One daemon per machine**, serving every registered host. Running `counterpoint` inside another repo registers it as another host; the console switches between hosts. All agent spawns across hosts will go through the one quota governor (Phase 2). v1 only needs Cena, but the data model and routes are host-scoped from the start. — **Reversibility:** costly — host id is part of every stored row, path and route.
- **D-07:** Owner credential via a **one-time URL**: start (and `counterpoint open`) prints, and opens, a URL carrying a single-use code; the server exchanges it for an `HttpOnly; SameSite=Strict` session cookie and the code dies. The raw token lives in a `0600` file under the Counterpoint home, which agent sandboxes deny. Normal session length (not a weeks-long cookie); logging in from another browser = run `counterpoint open` again.
- **D-08:** Counterpoint home defaults to the platform location (`~/Library/Application Support/Counterpoint` on macOS, XDG data dir on Linux) and is overridden by `COUNTERPOINT_HOME`. On the owner's machine it is set in `~/.zshrc` to `/Volumes/Dock/Dev/Library/Application Support/Counterpoint`. If the configured home does not exist (e.g. the Dock volume is unmounted), Counterpoint **refuses to start** with a clear message instead of creating state on the internal disk. The home holds the SQLite store, token file, logs and the owner's public key / allowed-signers file. — **Reversibility:** reversible — relocation is a move plus an env change.

**Carried forward (already decided in PROJECT.md / roadmap — do not re-open)**
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

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FOUND-01 | Start Counterpoint with `npx @hkp/counterpoint`, console at a loopback-only URL | Daemon lifecycle (section "Daemon lifecycle"), Hono bind recipe, `@hkp/counterpoint` is unpublished (Open Question 2) |
| FOUND-02 | Reject unexpected Host/Origin, CSRF, SSE origin; privileged actions need an owner credential agents cannot read | Loopback guard design (verified `hono/csrf` does not cover JSON), one-time URL → cookie, token file, socket |
| FOUND-03 | `counterpoint doctor`: `claude`/`git`/`gh`, signing key checks, live sandbox probe | Sandbox spike results, differential probe design, key-check recipes (header parse verified) |
| FOUND-04 | Agent sessions sandboxed: cannot read key/`~/.ssh`/`gh` creds/state, cannot write host `.git/config`, `.git/hooks`, `.git/info` | Verified settings recipe (sandbox + `permissions.deny` twins), `--setting-sources user` |
| FOUND-06 | Console on Astryx, light and dark | Astryx build verified on Vite 8.3.7 / React 19.3.1 / TS 7.0.2; Theme `mode`; CSP finding |
| ADPT-01 | Show host's GSD phases with status, plans, prerequisites parsed from `.planning/` | Native parsing recipe, Cena fixture facts, status derivation |
| ADPT-02 | Core reaches the framework only through an adapter interface; boundary enforced by import rules | Biome `noRestrictedImports` verified against five import forms |
| APPR-01 | Console prepares approval, one-line command, signed commit on base branch adding only the approval file | Plumbing commit recipe verified end to end (CAS, no checkout, index fix) |
| APPR-02 | Approval binds spec/draft/gate digests; change drops item to Needs You | Statement format, digest scheme, normalization risk, recompute-from-git rule |
| APPR-04 | `ssh-keygen -Y sign/verify` directly, clean env, owner's public key outside repo, refuse signing if `.git/config`/hooks changed | Sign/verify recipe verified, adversarial matrix, integrity-snapshot design |
| MISN-01 | Runway is the headline metric | Runway = count of verified, digest-matching approvals (derived, never stored) |
| MISN-02 | One Needs You inbox (Phase 1: "approved version changed" only) | Change detection, change-view diff via `git diff` on blobs |
</phase_requirements>

## Summary

The two things CONTEXT.md called "unproven" are now proven on this machine, and both work with the mechanisms the project already chose. (1) Claude Code's sandbox **does** apply to headless `claude -p` (claude 2.1.319, macOS Seatbelt) but only for the Bash tool; the Read, Grep and Edit/Write tools are **not** confined by `sandbox.filesystem.*`. The fix is a `permissions.deny` twin for every protected path: `Read(//abs/**)` and `Edit(//abs/**)` rules also get merged into the Bash sandbox, so one rule list covers Bash, Read, Grep and symlink traversal. A naive probe would false-pass, because out-of-cwd `Write` to `.git/*` is also denied by Claude's own mode/protected-path logic even with no deny rule; the probe must therefore distinguish the denial reason. (2) A signed approval commit can be built entirely with git plumbing (`hash-object`, `mktree`, `commit-tree`, `update-ref old-value`), signed by `ssh-keygen -Y sign -n git` reading the commit payload on stdin, with the SSH signature embedded as a `gpgsig` header; `git verify-commit` and `%G?` accept it and the owner's checkout is untouched (index fix for one path when the base branch is checked out).

The riskiest remaining items are not technical unknowns but design traps found while reading real data: **Cena `master` has no phase that can be approved today** (Phases 1 and 1.1 are fully built; Phases 2 to 7 have no phase directory), so success criterion 4 cannot be demonstrated on Cena without the owner running plan-phase first; **the ROADMAP phase section contains mutable progress bookkeeping** (checkbox ticks and `**Plans**: 17/17 plans executed`), so hashing it raw would make a legitimate execution bookkeeping commit knock approved phases off the runway; and **Astryx's `CodeBlock` and `Layer` (Dialog, Toast, DropdownMenu, Tooltip) inject `<style>` elements at runtime**, so a strict `style-src 'self'` CSP silently loses diff and bash syntax colouring.

**Primary recommendation:** Build the trust layer as two pure library modules first (agent-sandbox settings builder + differential probe; plumbing approval commit builder + signer + verifier with an adversarial test suite), both already de-risked here, then a walking skeleton (daemon + SQLite host row + one-time-URL login + Astryx shell with theme toggle + SSE dot), then the adapter/phases slice, then doctor/Trust, then approve, then change detection. Hash the ROADMAP section after a defined normalization (strip checkbox state and the `**Plans**:` line) and version it in the statement.

## Project Constraints (from `.claude/CLAUDE.md` and PROJECT.md)

Treated with the same authority as locked decisions. `.planning/PROJECT.md` supersedes the stale "Headline Decisions" tables in `.claude/CLAUDE.md`.

- Agent runtime: Claude Code only; spawn the owner's `claude -p` + `stream-json` behind one swappable `AgentRunner` port; sessions run non-`--bare` (subscription login and hooks work).
- UI: React 19 + Astryx (`@astryxdesign/core`), **no shadcn, no Tailwind**; prebuilt SPA served by the local server; SSE for live updates. Loopback-only, host-agnostic.
- Framework coupling: core never knows the SDD framework; everything framework-specific goes through an adapter; boundary enforced by import rules.
- Security: signing key and start/stop token unusable/unreadable by agents; approval key never cached.
- Isolation: builds never touch the owner's checkout (worktrees only). Context windows: no hard-coded sizes.
- Packaging: `@hkp/counterpoint`, one package, modular monolith.
- Install locations: tools, caches, app data on `/Volumes/Dock`, never the internal disk (see Environment Availability).
- Stack facts still valid from `.claude/CLAUDE.md`: Node >=24, TypeScript 7 (`tsc --noEmit`), Biome (not ESLint), Hono 4 + `@hono/node-server` 2, `node:sqlite`, execa, commander, Vitest, Vite 8, `yaml` (not gray-matter), unified/remark for markdown, argument-array process spawning (no shell strings).
- GSD workflow: file-changing work goes through a GSD entry point (`/gsd-execute-phase` etc.); this research made no repo edits other than this file.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Plan/spec truth (ROADMAP, CONTEXT, PLAN files) | Host git repo | Adapter (parse) | Counterpoint reads, never owns; read at the base tip via `git cat-file`, not the working tree (D-03) |
| Approval authority | Host git history (signed commit) | Core `approvals` (verify) | Recomputed from git each time; the DB only caches |
| Signing | Owner's terminal (`counterpoint approve` -> `ssh-keygen`) | — | Passphrase typed at a TTY; the daemon never holds key or passphrase |
| Runway, status derivation | Core (`runway`) | Adapter facts + approvals verify | Derived, never stored as authority |
| Sandbox settings and probe | Core `security` + `agent` modules | CLI `doctor` | One builder function feeds both the probe and (Phase 2) the runner, so the probe tests the production config |
| HTTP API, SSE, static SPA, cookie auth, Host/Origin guard | Daemon (Hono) | — | Thin routes; no business logic |
| CLI control (start/stop/status/open) | CLI over Unix socket | Daemon | CLI never writes the DB directly; daemon is the single SQLite writer |
| `approve` / `doctor` | CLI process (standalone, no daemon needed) | Daemon nudge via socket | Pure git + ssh + subprocess work; result file + nudge keeps the daemon authoritative for the DB |
| Persistent state (hosts, sessions, login codes, events, doctor report cache) | SQLite (`node:sqlite`) | Files in `COUNTERPOINT_HOME` | Daemon-owned; rebuildable projections |
| Console UI | Browser SPA (Astryx) | — | Snapshots over HTTP (TanStack Query), invalidated by SSE; never polls |
| Theme persistence | Browser (`localStorage`) | external `/theme-init.js` | CSP forbids inline script |

## Standard Stack

All versions checked against the npm registry on 2026-11-09 (`npm view <pkg> version`) [VERIFIED: npm registry]. Package-name provenance: every package below is named in `.planning/PROJECT.md`, `.claude/CLAUDE.md` or the approved `01-UI-SPEC.md` (authoritative project docs), so names are not web-discovered.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 24.21.0 installed (`engines >=24`) | Runtime, `node:sqlite` | `node:sqlite` ran without a warning here: `DatabaseSync`, WAL, STRICT tables, SQLite 3.53.4 [VERIFIED: local run] |
| hono | 4.13.17 | HTTP, SSE (`streamSSE`), middleware | Project stack |
| @hono/node-server | 2.1.6 | Node adapter; `serve({hostname})`, `createAdaptorServer` (Unix socket), `serveStatic` | Project stack; Unix-socket use documented [CITED: github.com/honojs/node-server] |
| react / react-dom | 19.3.1 | UI | Locked |
| @astryxdesign/core | 0.7.11 (exact pin) | Component library | Locked; build verified below |
| @astryxdesign/theme-neutral | 0.7.11 (exact pin) | Theme + icons | Approved in UI-SPEC |
| @stylexjs/stylex | 0.19.1 | Peer dependency of core (`^0.19.0`) | Required peer [VERIFIED: core package.json] |
| @fontsource/figtree | 5.3.0 (exact) | Self-hosted font | UI-SPEC; Vite copies the woff/woff2 itself (verified build output) |
| vite | 8.3.7 | SPA build | Project stack |
| @vitejs/plugin-react | 6.3.0 | React for Vite 8 | Project stack |
| @tanstack/react-query | 5.107.1 | Snapshots + SSE invalidation | Project stack |
| @tanstack/react-router | 1.170.46 | Routes; backs Astryx `LinkProvider` | UI-SPEC |
| zod | 4.6.7 | Statement/config/API schemas | Project stack |
| yaml | 2.9.1 | PLAN frontmatter | Project stack (no gray-matter) |
| unified + remark-parse + remark-frontmatter | 11.0.5 / 11.0.0 / 5.0.0 | Position-bearing mdast for ROADMAP/PLAN | Project stack |
| commander | 15.1.0 | CLI | Project stack |
| execa | 10.2.1 | git / ssh-keygen / claude subprocesses (argument arrays) | Project stack |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| typescript | 7.0.2 | `tsc --noEmit` | Verified: `tsc` 7.0.2 type-checks Astryx's published types with `skipLibCheck: false` and reports real prop errors |
| @biomejs/biome | 2.6.6 | Lint + format + the adapter boundary rule | Verified boundary rule below |
| vitest | 5.1.0 | Tests | Project stack |
| tsdown | 0.23.7 | Bundle CLI/daemon to ESM `dist/` | Project stack (0.x: pin) |
| playwright-core | 1.65.0 | Screenshot backstops, UI smoke against system Chrome | Owner has `/Volumes/Dock/Applications/Google Chrome.app`; no browser download needed |
| pnpm | 12.18.0 (via corepack) | Dev package manager | `corepack` 0.36.0 present; `pnpm` not yet enabled |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Biome `noRestrictedImports` | dependency-cruiser 18.7.2 | Needs the `typescript` JS API; behaviour on TS 7 not verified. Keep as an optional later cross-check |
| jsdiff (`diff`) for the change view | `git diff <blobA> <blobB>` with `--no-ext-diff --no-textconv` | No dependency, exact git semantics; use git |
| chokidar for ref watching | server-side poll of `git rev-parse` (2 s) + `fs.watch` nudge | Source is committed content on a ref, not the working tree; polling is robust and cheap |

**Installation (dev machine; caches already redirect to `/Volumes/Dock/Dev/npm-cache`):**
```bash
corepack enable pnpm           # corepack cache lives under /Volumes/Dock/Dev/corepack
pnpm add --save-exact hono@4.13.17 @hono/node-server@2.1.6 react@19.3.1 react-dom@19.3.1 \
  @astryxdesign/core@0.7.11 @astryxdesign/theme-neutral@0.7.11 @stylexjs/stylex@0.19.1 \
  @fontsource/figtree@5.3.0 @tanstack/react-query@5.107.1 @tanstack/react-router@1.170.46 \
  zod@4.6.7 yaml@2.9.1 unified@11.0.5 remark-parse@11.0.0 remark-frontmatter@5.0.0 \
  commander@15.1.0 execa@10.2.1
pnpm add -D --save-exact vite@8.3.7 @vitejs/plugin-react@6.3.0 typescript@7.0.2 vitest@5.1.0 \
  @biomejs/biome@2.6.6 tsdown@0.23.7 playwright-core@1.65.0 @types/node @types/react @types/react-dom
```
Install with lifecycle scripts ignored (`pnpm` default; `npm --ignore-scripts`): `@astryxdesign/core` has a benign `postinstall` hint script (reviewed in UI-SPEC Registry Safety).

**Version verification:** `npm view @hkp/counterpoint version` returns 404 (the package name is unpublished) [VERIFIED: npm registry].

## Package Legitimacy Audit

Seam run: `gsd-tools query package-legitimacy check --ecosystem npm <31 packages>` on 2026-11-09 [VERIFIED: tool output].

| Package | Registry | Age / latest publish | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|----------------------|-----------|-------------|---------|-------------|
| @fontsource/figtree | npm | 2026-07-19 | 502K/wk | github.com/fontsource/font-files | OK | Approved |
| @stylexjs/stylex | npm | 2026-09-15 | 2.09M/wk | github.com/facebook/stylex | OK | Approved |
| hono, @hono/node-server | npm | 2026-11-07, 2026-11-02 | 104M, 98M/wk | github.com/honojs | SUS (`too-new`) | Flagged — see note |
| react, react-dom | npm | 2026-10-14 | 253M, 237M/wk | github.com/react/react | SUS (`too-new`) | Flagged — see note |
| @astryxdesign/core, @astryxdesign/theme-neutral | npm | 2026-11-07 | 662K, 490K/wk | github.com/meta/astryx | SUS (`too-new`); core has `postinstall` | Flagged — reviewed in UI-SPEC, scripts ignored |
| @tanstack/react-query, @tanstack/react-router, zod | npm | 2026-10-12 to 11-06 | 24M to 454M/wk | github.com/TanStack, colinhacks | SUS (`too-new`) | Flagged — see note |
| yaml, unified, remark-parse, remark-frontmatter, remark-gfm, unist-util-visit, commander, execa, vite, @vitejs/plugin-react, vitest, @biomejs/biome, typescript, tsdown, @types/react, @types/react-dom, @types/node | npm | various | download lookup returned null | official org repos | SUS (`unknown-downloads` and/or `too-new`) | Flagged — see note |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** all rows above marked SUS. **Interpretation:** every SUS reason is `too-new` (the *latest release* is under about 30 days old, normal for fast-moving packages) or `unknown-downloads` (the downloads lookup returned null, a rate-limit artefact; none is `not-found`). All are named in the project's own authoritative docs, and the large ones have 24M to 454M weekly downloads. They are not slopsquat candidates. Rather than 30 per-package prompts, the planner should add **one** `checkpoint:human-verify` task at install time: review `pnpm-lock.yaml` for the exact-pinned set above, install with scripts ignored, and re-run the seam against the lockfile. `lucide-react` (transitive via theme-neutral, `^1.18.0`) needs a fresh review if the lockfile resolves a different version than the one vetted in UI-SPEC.

No package was added from web search. `diff`/jsdiff and `dependency-cruiser` are deliberately **not** recommended.

## Architecture Patterns

### System Architecture Diagram

```
 owner terminal                                   owner browser (Astryx SPA)
 ┌──────────────────────┐                         ┌────────────────────────────┐
 │ counterpoint (cmd)   │  one-time URL           │ TanStack Query snapshots   │
 │  start/stop/status/  │───────────────────────▶ │ SSE (Last-Event-ID) deltas │
 │  open               │                          └───────────┬────────────────┘
 │ counterpoint doctor  │                                      │ HTTP 127.0.0.1:4170
 │ counterpoint approve │                                      ▼
 └───┬───────────┬──────┘      Unix socket (0600, dir 0700)   ┌───────────────────────────────┐
     │           │ token ────────────────────────────────────▶│ DAEMON (one per machine)      │
     │           │                                            │ Hono: guard → auth → routes   │
     │           │ nudge/notify                               │ core: runway, approvals(verify)│
     │           └───────────────────────────────────────────▶│ adapter (via compose.ts only) │
     │                                                        │ SQLite (single writer)        │
     │ git plumbing (clean env, -c core.hooksPath=/dev/null,  └──────────┬────────────────────┘
     │   -c core.fsmonitor=false) + /usr/bin/ssh-keygen                  │ git cat-file / ls-tree at base tip
     ▼                                                                   ▼
 ┌──────────────────────────────────────────────┐          ┌──────────────────────────────┐
 │ HOST REPO (Cena, read-only except approval    │◀─────────│ GSD adapter: parse ROADMAP/  │
 │ ref update): refs/heads/master CAS update;    │          │ CONTEXT/PLAN → PlanSnapshot  │
 │ .counterpoint/approvals/<item>.json           │          │ + approval inputs            │
 └──────────────────────────────────────────────┘          └──────────────────────────────┘
 doctor ──▶ builds sandbox settings (same fn as Phase 2 runner) ──▶ spawns `claude -p`
            (treatment run + control run, canary files) ──▶ evaluates stream-json ──▶ report JSON
```

### Recommended Project Structure
```
src/
├── core/               # no imports from adapters/ (Biome rule)
│   ├── approvals/      # statement, canonical JSON, digests, prepare, sign, verify, integrity snapshot
│   ├── runway/         # derived status + runway
│   ├── security/       # loopback guard, token/session/login-code, env allow-list, sandbox-settings builder
│   ├── store/          # node:sqlite schema + migrations + repos (daemon only)
│   ├── git/            # clean-env git runner + file reader port (ls-tree, cat-file --batch, diff blobs)
│   └── host/           # registry, COUNTERPOINT_HOME resolution
├── adapters/
│   ├── api.ts          # FrameworkAdapter interface
│   └── gsd/            # parser, status inputs, approval-inputs rule (D-02), roadmap-section normalizer
├── agent/              # claude argv builder, stream-json evaluator, probe (doctor)
├── server/             # Hono app, SSE, static, control socket routes
├── cli/                # commander entry: (default) start, stop, status, open, doctor, approve, init
├── compose.ts          # the ONLY file that imports adapters/gsd
ui/                     # SPA source → dist/ui
test/fixtures/gsd/      # frozen Cena master .planning (ROADMAP + phases) + synthetic planned phase
```

### Pattern 1: Derive, don't store
Approval state, status and runway are computed from git at read time (`verify(item, tip)`), with SQLite holding at most a cache keyed by `(host, tip, item)`. An agent that forges a DB row gains nothing.

### Pattern 2: Adapter is pure over a git file-reader port
`snapshot(reader, ref)` and `approvalInputs(snapshot, phase)` receive `{ list(ref, prefix), read(ref, path) }` from core, never run git themselves. The adapter returns *labelled input byte-ranges* (file blobs plus the ROADMAP section as a virtual input); core owns hashing and the statement. This honours D-02's "adapter owns which files are inputs" and keeps core framework-agnostic.

### Pattern 3: One sandbox-settings builder, used by both probe and runner
`buildAgentSandboxSettings({ hostGitDir, worktree, home, signingKeyDir, ... })` returns the exact `--settings` JSON. `doctor` runs the probe with this function's output; Phase 2's runner uses the same function. A probe that tests a different config than production proves nothing.

### Pattern 4: Recompute-and-print signing (WYSIWYS)
`counterpoint approve` re-derives the statement from the base tip *at signing time*, prints per-file digests in full, then asks for the passphrase. The console shows a 12-hex statement fingerprint so the owner can eyeball that the dialog and the terminal agree.

### Walking skeleton and tracer order (for the planner)
The thinnest real end-to-end slice: `counterpoint` (start daemon) registers the cwd repo as host → writes a `hosts` row to SQLite → prints a one-time URL → browser exchanges it for the cookie → SPA (Astryx `AppShell` + `Theme` with Light/Dark/System toggle) reads `GET /api/hosts` and shows the host in the switcher → SSE connection dot turns green. That covers scaffold, routing, one real DB write and read, one real UI interaction (theme toggle; sign-in), and a runnable dev setup.

**Prove before building on them (all already de-risked in this research; port the scripts into tests first):**
1. Sandbox confinement settings (Wave 0 plan 1; results below).
2. Plumbing approval commit + sign + verify + adversarial matrix (Wave 0 plan 2).
3. Astryx on Vite 8 with CSP (done; becomes the SPA scaffold).
4. Daemon single-instance lock via `BEGIN EXCLUSIVE` (done).

**Then vertical slices:** (a) adapter + Phases list/detail from git at the base tip against frozen fixtures; (b) `doctor` + Trust page; (c) approve dialog + `counterpoint approve` + verified landing + runway; (d) change detection + Needs You + change view; (e) Mission page assembly.

### Anti-Patterns to Avoid
- **Reading the working tree for approvals** (D-03 says committed content at the base tip). `git status` is only for the soft "uncommitted edits" hint.
- **`git verify-commit` / `git log --show-signature` without `-c` overrides**, or parsing `Good ...` text instead of the exit status plus a pinned fingerprint.
- **Running any git command in the host repo without `-c core.hooksPath=/dev/null -c core.fsmonitor=false`** (both executed attacker-controlled code in tests, see Pitfall 2).
- **Hashing the raw ROADMAP phase section** (mutable bookkeeping, see Pitfall 4).
- **Trusting `tool_result.is_error` or the model's prose in the probe.**
- **Passing the token or a code in argv/env of any child**, or logging query strings on `/login`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSH signature creation/verification | Any crypto | `/usr/bin/ssh-keygen -Y sign/verify -n git` (absolute path) | Format, namespacing, hash alg all handled; git recognises the result |
| Commit object assembly | Manual SHA/zlib writing | `git hash-object -t commit -w`, `commit-tree`, `mktree` | Plumbing is stable and exact |
| Atomic ref update | Lock files | `git update-ref <ref> <new> <old>` (CAS) | Verified: second update fails with `is at ... but expected ...` |
| Blob diff for the change view | A diff algorithm | `git diff --no-ext-diff --no-textconv <oldblob> <newblob>` | Exact git output; render as plain text |
| Single-instance daemon | pid-file heuristics | `node:sqlite` `BEGIN EXCLUSIVE` on `run/daemon.lock.db` | Verified: second process gets `database is locked`; `kill -9` of holder releases it |
| Markdown frontmatter | Regex | `remark-frontmatter` + `yaml` | Fences, code blocks |
| SSE framing/reconnect | Custom protocol | Hono `streamSSE` + `Last-Event-ID` = `events.seq` | Browser reconnects for free |
| Package-level rendering of diffs/commands | Custom components | Astryx `CodeBlock` (`isDiff`, `hasCopyButton`) | In the vetted set |
| Sandbox enforcement | A custom chroot/sandbox-exec profile | Claude Code's own `sandbox` + `permissions.deny` | Verified to cover Bash, Read, Grep |
| Canonical JSON | A library | ~15-line sorted-key serializer with test vectors (strings, ints, null, arrays only; no floats) | Statement uses no floats |

**Key insight:** every security-relevant primitive here already exists (ssh-keygen, git plumbing, Seatbelt via Claude Code). The work is wiring them with a clean environment and proving denials, not building mechanisms.

## Research Item 1 — Sandbox spike (verified on `claude` 2.1.319, macOS)

**Environment checked:** `claude --version` → `2.1.319 (Claude Code)`; model `claude-haiku-5-5` for the probes; macOS 25.6 (Seatbelt) [VERIFIED: local runs]. Four `claude -p --output-format stream-json --verbose --no-session-persistence --settings '<json>' --permission-prompts none --permission-mode dontAsk --allowedTools Bash Read Write Edit Grep Glob --add-dir <main repo>` sessions in scratch fixtures: a "main" repo, a linked worktree used as cwd, canary files for a fake `~/.ssh` and a fake Counterpoint home. All canaries and nonces were created in the scratchpad; no real secret path was targeted.

| # | Config | Action | Result |
|---|--------|--------|--------|
| R1 | `sandbox.filesystem.denyRead` only | Bash `cat` canary | **Blocked**: `cat: ...: Operation not permitted`, `rc=1`, `is_error:false` |
| R1 | same | Read tool on canary | **LEAKED** (canary content returned) |
| R1 | `allowWrite=[main/.git]`, `denyWrite=[.git/config,.git/hooks,.git/info]` | Bash `: >> .git/config`, `touch .git/info/x` | **Blocked** (`operation not permitted`); control `touch .git/refs/heads/x` rc=0 |
| R1 | `allowUnsandboxedCommands:false` | Bash with `dangerouslyDisableSandbox:true` | Still blocked |
| R2 | sandbox denyRead + `Edit(//main/**)`, `Read(//S/**)` allow, no deny rules | Read, **Grep**, Read via **symlink in cwd** to canary | All three **LEAKED** |
| R2 | same | Write to `main/cp-ok.txt` (control) | Succeeded |
| R2 | same | Write to `main/.git/hooks/x`, `.git/info/x` | Denied with `...because Claude Code is running in don't ask mode` — **not** by any rule of ours (false-pass source) |
| R3 | **no** `sandbox.filesystem.denyRead`; `permissions.deny=[Read(//cphome/**), Read(//fakehome/.ssh/**), Edit(//main/.git/**)]` | Read tool | Blocked: `File is in a directory that is denied by your permission settings.` |
| R3 | same | Grep on denied dir; Read via symlink | Blocked (`Permission to read ... has been denied.`) |
| R3 | same | **Bash `cat`** of denied path | Blocked: `Operation not permitted` — i.e. `Read` deny rules are **merged into the Bash sandbox** |
| R3 | same | Write to `.git/hooks`, `.git/info` | Blocked with the deny-rule message (distinguishable from R2's mode message) |
| R3 | same | Bash `cat` of symlink to denied target | Blocked |
| R3 | | `result.permission_denials[]` | Lists each denied tool call with `tool_name`, `tool_use_id`, `tool_input` |
| R4 | deny rules on a path **containing spaces** (`Library/Application Support/Counterpoint`) | Read, Bash `cat` | Both blocked; Grep over the parent returns `No files found` (denied subtree skipped); `ls` of the parent still lists the child *name* |
| Hook test | worktree `.claude/settings.json` with a `SessionStart` command hook | default sources vs `--setting-sources user` | Hook **ran, unsandboxed**, in `-p` mode by default; with `--setting-sources user` it did **not** run |

[VERIFIED: local runs, `claude` 2.1.319]. Docs agree where they speak: "The sandbox covers shell commands only. Claude's file tools, MCP servers, and hooks run outside it" and "A `denyRead` entry doesn't stop the Read tool" [CITED: code.claude.com/docs/en/sandboxing]; `--settings` ranks above user/project/local and below managed [CITED: code.claude.com/docs/en/settings].

### Conclusion and recommended agent launch profile
Native sandbox is sufficient; **no `srt` wrapper is needed** for the v1 boundary, provided every protected path has a `permissions.deny` twin. Pass (all verified unless marked):

```
claude -p --output-format stream-json --verbose --no-session-persistence
  --model <alias> --max-turns <n> --max-budget-usd <x>
  --settings '<json below>' --setting-sources user --strict-mcp-config
  --permission-mode dontAsk --permission-prompts none
  --allowedTools <explicit list>            # stdin must be 'ignore' (claude waits 3 s for stdin otherwise)
```
```jsonc
{
  "permissions": { "deny": [
    "Read(//ABS/home/.ssh/**)",  "Edit(//ABS/home/.ssh/**)",
    "Read(//ABS/home/.config/gh/**)", "Edit(//ABS/home/.config/gh/**)",
    "Read(//ABS/COUNTERPOINT_HOME/**)", "Edit(//ABS/COUNTERPOINT_HOME/**)",
    "Read(//ABS/signing-key-dir/**)", "Edit(//ABS/signing-key-dir/**)",
    "Edit(//ABS/HOST/.git/**)"
  ] },
  "sandbox": { "enabled": true, "failIfUnavailable": true, "allowUnsandboxedCommands": false,
    "filesystem": {
      "denyRead":  ["/ABS/home/.ssh", "/ABS/home/.config/gh", "/ABS/COUNTERPOINT_HOME"],
      "allowWrite": ["/ABS/HOST/.git"],                    // Phase 2 narrows this (objects, refs/heads/<branch>, worktrees/<name>)
      "denyWrite": ["/ABS/HOST/.git/config", "/ABS/HOST/.git/hooks", "/ABS/HOST/.git/info"]
    } }
}
```
Rules for building the paths: use **absolute, `fs.realpathSync`-resolved** paths (macOS `/tmp` is `/private/tmp`), the `//abs` prefix form in permission rules, plain absolute paths in `sandbox.filesystem.*` (the two conventions differ [CITED: sandboxing doc]); the git dir comes from `git rev-parse --git-common-dir` (a linked worktree's `.git` is a file; the shared `config`/`hooks`/`info` live in the main `.git`, outside the cwd, so the sandbox's built-in protection of `.git/config` and `.git/hooks` does **not** cover them [CITED: sandboxing doc, Protected paths: "In your working directory only"]).

**Why `--setting-sources user` is mandatory:** an agent can plant `.claude/settings.json` (hooks run outside the sandbox and, as tested, in `-p` without a trust dialog) in its worktree and the *next* session would execute it with the owner's full access. Also pass `--strict-mcp-config` (only explicit `--mcp-config`). Caveat for Phase 2: confirm Cena's `.claude/commands`, `agents` and `skills` still load under `--setting-sources user` (Cena master has no committed `.claude/settings.json`) [Open Question 9].

**Residuals to document (not blockers):** WebFetch/WebSearch are not limited by sandbox network rules ("`allowedDomains` doesn't limit WebFetch" [CITED]); hooks, MCP servers and the status line from the *user* settings run outside the sandbox by design; Keychain is unreachable from sandboxed Bash on macOS (reports only [ASSUMED], see A5) which also means agents cannot use `gh` (the runner pushes/opens PRs, Phase 2); `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` strips credentials from subprocess env but "leaves GitHub tokens ... in place" [CITED: code.claude.com/docs/en/env-vars], so also pass an explicit env allow-list (`PATH`, `HOME`, `LANG`, `TMPDIR`; never `SSH_AUTH_SOCK`, `GH_TOKEN`, `GITHUB_TOKEN`, `COUNTERPOINT_*`).

### `doctor` live probe design (no false pass)
1. **Canaries, not secrets.** For each protected directory create a sibling file `.cp-canary-<nonce>` containing a random nonce (`~/.ssh`, `~/.config/gh`, `$COUNTERPOINT_HOME`, the signing-key directory, plus a control canary in an allowed temp dir). Deny rules are directory globs, so a sibling canary proves the same rule that protects the real key without the probe ever reading a real secret. For the host: attempt `: >> <gitdir>/config` (zero-byte append, content-neutral) and create nonce-named files in `<gitdir>/hooks` and `<gitdir>/info`; `doctor` deletes any it finds afterwards and reports `Reachable` if one existed.
2. **Treatment + control, differential.** Run session T with the production settings: expect every target blocked. Run session C with the same settings minus the `deny` entries for the canary targets (and with matching allow rules): expect every canary reachable. A target counts as **Blocked** only if C reached it and T did not. If C cannot reach it, the row is `Not checked` (never pass). This removes the verified R2 false pass (denial by mode, not by our rule).
3. **Evidence rules (parsed from stream-json, never from the model's prose):** the stream contains a `tool_use` for each step (model actually tried); the denial text matches the deny-rule family (`denied by your permission settings`, `Permission to read ... has been denied`, `Operation not permitted`) and **not** the mode family (`running in don't ask mode`); `result.permission_denials` lists the file-tool attempts; the canary nonce appears **nowhere** in the raw stream (a nonce in any `tool_result` = `Reachable`); the control canary's nonce **does** appear in session C. Anything unexpected = inconclusive = fail, with the raw stream saved under `$COUNTERPOINT_HOME/logs/doctor/`.
4. **Fixed, no-injection prompt** with numbered steps naming the exact tool (Bash/Read/Grep/Write), a cheap model (`haiku` alias worked), `--max-turns` and `--max-budget-usd` caps, `stdin: 'ignore'`. Retry once if the model skipped a step; then fail.
5. **Do not use the Edit tool with identical old/new text** (returns `No changes to make` before any permission check, a second false-pass trap seen in R2/R3). Use Write to a nonce sibling path for file-tool coverage under `.git/`.
6. **Version pinning:** record `claude --version` in the report; the denial-message matcher is tied to the tested version (2.1.319). A different version with unfamiliar messages yields `Not checked`, prompting an updated matcher rather than a silent pass.

**Fallback if a future version breaks coverage:** wrap the whole process with `@anthropic-ai/sandbox-runtime` (`srt` 0.0.81 on npm [VERIFIED: npm registry], not installed here). Caveat: a Seatbelt-wrapped `claude` likely cannot read the Keychain-stored subscription login (reports only, A5), forcing `CLAUDE_CODE_OAUTH_TOKEN` in its env, which Bash children could read. Treat as a documented weaker boundary and surface it to the owner.

**Test-only note:** the live probe needs a logged-in `claude` and costs tokens: gate it behind `COUNTERPOINT_LIVE_PROBE=1`; unit-test the *evaluator* with frozen stream-json fixtures (a pass, a nonce leak, a mode-denial-only, a skipped step, an unknown message).

## Research Item 2 — Approval commit mechanics (verified end to end)

Reference environment: git 2.50.1 (Apple Git-155), `OpenSSH_10.3p1`, throwaway ed25519 keys, scratch repo with `master` checked out, an uncommitted edit and an untracked file [VERIFIED: local runs]. Every git call below runs with `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_NOSYSTEM=1` and `-c core.hooksPath=/dev/null -c core.fsmonitor=false -c log.showSignature=false`. Pin `git` and `ssh-keygen` by absolute path (`/usr/bin/ssh-keygen`).

```bash
BASE=$(git rev-parse refs/heads/master)                       # tip at signing time
BLOB=$(git hash-object -w --stdin < statement.json)
ROOT=$(git rev-parse $BASE^{tree})
AP=$(printf '100644 blob %s\t%s\n' $BLOB 01.json | git mktree)
CPT=$(printf '040000 tree %s\t%s\n' $AP approvals | git mktree)
NEWROOT=$( ( git ls-tree $ROOT; printf '040000 tree %s\t.counterpoint\n' $CPT ) | git mktree )
# identity/date explicit via GIT_AUTHOR_* / GIT_COMMITTER_* env
UNSIGNED=$(printf 'counterpoint: approve phase 01\n\n...\n' | git commit-tree $NEWROOT -p $BASE)
git cat-file commit $UNSIGNED > payload.txt
ssh-keygen -Y sign -n git -f ~/.ssh/<key> < payload.txt > payload.sig     # stdin→stdout mode; passphrase from TTY
# embed: header "gpgsig " + signature lines, continuation lines prefixed by one space, inserted before the blank line
SIGNED=$(git hash-object -t commit -w --stdin < signed.txt)
git update-ref -m "counterpoint: approve 01" refs/heads/master $SIGNED $BASE   # CAS: fails if tip moved
```
Observed results:
- Tree built **without an index** (no `read-tree`, no `GIT_INDEX_FILE`): avoids every index-refresh code path. `ls-tree -r` of the new tree showed only the added path plus the originals.
- `ssh-keygen -Y sign` works in stdin→stdout mode with an unprotected key and with a passphrase-protected key (tested via `SSH_ASKPASS` only for my throwaway key; production uses the TTY prompt; **scrub `SSH_ASKPASS`, `SSH_AUTH_SOCK`** from the `approve` environment and refuse to run without a TTY).
- `git -c gpg.format=ssh -c gpg.ssh.allowedSignersFile=... verify-commit <sha>` → `Good "git" signature for owner@counterpoint with ED25519 key SHA256:...`, rc 0; `git log -1 --format='%G? %GF'` → `G SHA256:...`. Payload reconstruction (strip `gpgsig` header and its continuation lines) is **byte-identical** to the signed payload.
- CAS: first `update-ref` OK; replaying with the old value → `fatal: update_ref failed ... is at <new> but expected <old>`, rc 128.
- **Checkout side effect (the trap):** with `master` checked out, the new file shows as `D  .counterpoint/approvals/01.json` (staged deletion) while ` M README.md` and `?? untracked.txt` stay. Fix, applied only in worktrees where `git worktree list --porcelain` shows `branch refs/heads/<base>`: `git update-index --add --cacheinfo 100644,<blob>,<path>` then `git checkout-index -f -- <path>`; `git status --porcelain` afterwards showed only ` M README.md` and `?? untracked.txt`. Refuse earlier if an untracked/modified file already exists at that path. When the checkout is on another branch (Cena today: `ccr-61ff69b1-hgtpdm`) nothing else is needed.
- **Repo-controlled code execution is real** (both hit in tests): a `.git/hooks/reference-transaction` script ran on plain `git update-ref`, and did **not** run with `-c core.hooksPath=/dev/null`; a `core.fsmonitor=<command>` in `.git/config` ran on `git status` and also on `git update-index --add --cacheinfo`; `-c core.fsmonitor=false` stopped it. Hence plumbing-only + `-c` overrides + the integrity snapshot below.
- `ssh-keygen -Y check-novalidate` succeeds without consulting `allowed_signers`; never use it for authorization.

### Verification algorithm (recompute from git, fail closed)
For item `I` at base tip `T = rev-parse refs/heads/<base>`:
1. `C = git log -1 --first-parent --format=%H T -- .counterpoint/approvals/<I>.json`. Empty → not approved. (An unsigned later edit or delete becomes the "last toucher" and fails step 3; checked: an unsigned delete shows `%G?` = `N`.)
2. `git diff-tree --no-commit-id --name-status -r --root C` must equal exactly one `A`/`M` line for that path; exactly one parent.
3. Extract payload + signature from `git cat-file commit C`; run `ssh-keygen -Y verify -f <allowed_signers outside repo> -I owner@counterpoint -n git -s sig < payload` and require **exit 0 and the printed fingerprint equals the pinned fingerprint**. (Verified failures, all exit 255: wrong namespace `file`, tampered payload, wrong principal, signature checked against a different key.)
4. `git cat-file blob C:<path>` → parse with zod; `statement.item`/`host` match; `schema` known.
5. Recompute input digests from `T` and compare with `statement.inputs` → `On runway` or `Changed since signed` (with the list of changed inputs).
Cache by `(host, T, item)` in SQLite; never trust the cache for authority.

### Integrity snapshot (APPR-04 "changed unexpectedly")
Hashing the whole `.git/config` would fire constantly (`git push -u`, `git checkout --track` rewrite it) and train the owner to rubber-stamp. Snapshot only the **execution-capable surface**, read with `git config --list --local -z` (reads, does not execute): keys matching `core.fsmonitor`, `core.hooksPath`, `core.sshCommand`, `core.pager`, `core.editor`, `core.askPass`, `core.gitProxy`, `core.worktree`, `core.attributesFile`, `gpg.*`, `user.signingKey`, `commit.gpgsign`, `diff.*.command|textconv`, `filter.*`, `merge.*.driver`, `credential.*`, `alias.*`, `include.*`, `includeIf.*`, `url.*`, `remote.*.url|pushurl|receivepack|uploadpack|vcs`, `extensions.*`, `receive.*`, `uploadpack.*`; plus `<gitdir>/hooks/*` (names + sha256 of non-`.sample` files), `<gitdir>/info/*` (sha256), and `config.worktree` if present. Baseline stored at `$COUNTERPOINT_HOME/hosts/<id>/integrity.json`, established by an explicit owner command after showing the list (`counterpoint trust <host>`); `approve` and `doctor` compare and **refuse** on mismatch with the Copywriting refusal sentence. Observed in Cena today: `.git/config` already holds `user.signingkey=/Users/alexprofir/.ssh/cena_owner.pub` and `gpg.format` = `ssh` (the prototype's), and `.git/hooks` holds only `.sample` files [VERIFIED: read-only `git config --local --list`, `ls`]. This design is a recommendation (A3).

## Research Item 3 — Signing-key checks (`doctor`)

| Check | Method | Evidence |
|-------|--------|----------|
| Passphrase-protected | Parse the OpenSSH private key header (base64 body, magic `openssh-key-v1\0`, then `ciphername`, `kdfname`, kdf options): require `cipher != none`, `kdf == bcrypt`; warn if `rounds < 16`. Cross-check with `ssh-keygen -y -P '' -f <key> </dev/null`: protected key → `Load key "...": incorrect passphrase supplied to decrypt private key`; unprotected → prints the public key. Never prompts, never holds a passphrase | Throwaway keys: unprotected `{"cipher":"none","kdf":"none"}`; `-a 16` protected `{"cipher":"aes256-ctr","kdf":"bcrypt","rounds":16}` [VERIFIED: local run] |
| Not loaded in ssh-agent | `ssh-add -l` (exit 1 + "The agent has no identities." / exit 2 no agent = pass); compare listed `SHA256:` fingerprints to `ssh-keygen -lf <pub>`. Also check the launchd agent socket (`launchctl getenv SSH_AUTH_SOCK`), not only the shell env | `ssh-add -l` on this machine → `The agent has no identities.` [VERIFIED: local run] |
| Not loadable via Keychain/`AddKeysToAgent` | Parse `~/.ssh/config` and included files for `AddKeysToAgent`/`UseKeychain` entries that apply to the key (`IdentityFile`); check Keychain for a stored passphrase for the key path. The exact Keychain item shape (service `OpenSSH`, account = key path, via `security find-generic-password` without `-w`) is **[ASSUMED]**; verify with the owner as the first doctor task (A4) | — |
| Public key / allowed signers outside repo | `$COUNTERPOINT_HOME/trust/allowed_signers` with one line `owner@counterpoint namespaces="git" ssh-ed25519 AAAA...`; fingerprint pinned in `$COUNTERPOINT_HOME`; refuse a file containing more than one key or a wildcard principal | Format verified in the sign/verify runs |

Key setup (owner action, Counterpoint never sees the passphrase): `counterpoint init-key` prints `ssh-keygen -t ed25519 -a 100 -f ~/.ssh/counterpoint_approval -C counterpoint-approval`, then `counterpoint trust-key <pub>` writes allowed signers and pins the fingerprint. The prototype's `cena_owner` key was **not inspected** (a read of the real key header was correctly blocked this session); `doctor` will report its protection status if the owner chooses to reuse it.

## Research Item 4 — Approval statement and hashing

Proposed statement file (`.counterpoint/approvals/phase-<NN[.N]>.json`, pretty-printed with sorted keys; digests are computed over *inputs*, so the file's own bytes need not be canonical, but the `combined` digest uses canonical JSON). **This format is costly to change (D-02): confirm with the owner (A1).**

```json
{
  "schema": "counterpoint/approval/v1",
  "kind": "runway",
  "host": "cena",
  "item": { "type": "phase", "id": "02" },
  "base": { "branch": "master", "commit": "<40-hex tip when prepared>" },
  "inputs": {
    "algorithm": "sha256",
    "files": [
      { "path": ".planning/phases/02-<slug>/02-CONTEXT.md", "kind": "context", "digest": "sha256:<64hex>" },
      { "path": ".planning/phases/02-<slug>/02-01-PLAN.md",   "kind": "plan",    "digest": "sha256:<64hex>" },
      { "path": ".planning/ROADMAP.md#phase-02", "kind": "roadmap-section",
        "normalization": "cp-gsd-roadmap-section/v1", "digest": "sha256:<64hex>" }
    ],
    "combined": "sha256:<sha256 of canonical JSON of the files array>"
  },
  "draft": { "state": "none", "digest": null },
  "gates": { "state": "absent", "digest": null }
}
```
- **File digest** = SHA-256 of the committed blob bytes: `git cat-file blob <tip>:<path>` (no working tree, no smudge/EOL conversion, so identical across machines). Digest strings are `sha256:` + lowercase hex; the UI shows 12 hex.
- **Canonical JSON** for `combined`: keys sorted by UTF-16 code unit, no whitespace, `JSON.stringify` string escaping, only strings/integers/null/arrays/objects; ship test vectors.
- **File ordering:** sort `files` by path bytes. **Input matching (adapter-owned):** `^\d+(\.\d+)?-CONTEXT\.md$`, `^\d+(\.\d+)?-\d+-PLAN\.md$`, `^\d+(\.\d+)?-(RESEARCH|UI-SPEC|SPEC|AI-SPEC)\.md$` inside the phase directory only (anchored; Cena also holds `01-05-PERMISSION-MATRIX.md`, `*-VALIDATION.md`, `*-PATTERNS.md`, `*-COVERAGE.md` which are **not** inputs).
- **`draft` and `gates` slots:** present from day one. `gates` = SHA-256 of canonical JSON of the `gates` section of `.counterpoint/config.yaml` at the base tip, or `{ "state": "absent", "digest": null }` when the file/section is missing (the config path is an assumption, A6). Phase 4 fills `draft`, Phase 2 fills `gates`; neither changes the schema.
- **Recompute rule (D-03):** digests come from `T = rev-parse refs/heads/<base>` (local ref, as D-03 says; the owner pushes manually). `statement.base.commit` is only the *diff base* for D-04: the change view shows `git diff --no-ext-diff --no-textconv <blob-at-base.commit> <blob-at-T>` per changed input. For the ROADMAP virtual input, diff the normalized section text from both commits.
- **Item id:** `phase-<NN[.N]>` (independent of the directory slug, so renaming a slug does not orphan the approval). Host id regex `^[a-z0-9][a-z0-9-]{0,31}$`, phase id regex `^\d{2}(\.\d+)?$`, validated before any path use.

## Research Item 5 — Daemon lifecycle (D-05..D-08)

- **Spawn:** `counterpoint` (default command) resolves `COUNTERPOINT_HOME` first. Home missing → print the Copywriting message and exit non-zero, **creating nothing** (only an explicit `counterpoint init` creates the home, mode 0700; the default `~/Library/Application Support/Counterpoint` is also refused if absent). Then try the control socket: `GET /control/status` answers → "already running", mint a fresh login code, print, open. Otherwise `spawn(process.execPath, [daemonEntry], { detached: true, stdio: ['ignore', logFd, logFd] }).unref()` with an env allow-list, poll the socket for readiness (timeout, then print the log path).
- **Single instance:** the daemon opens `run/daemon.lock.db` and holds `BEGIN EXCLUSIVE` for life (busy_timeout 0). A second daemon gets `database is locked` and exits "already running"; the kernel releases the lock on any death including `kill -9` [VERIFIED: two-process test]. Liveness is decided by the socket answering, never by a pid file.
- **Control channel:** Unix socket `run/daemon.sock` (directory 0700, socket 0600) via `createAdaptorServer(app)` + `server.listen(socketPath)`, plus `Authorization: Bearer <token>` from the 0600 `token` file (defence in depth; the sandbox denies the home and does not grant `allowUnixSockets`). Routes: `/control/status`, `/control/stop`, `/control/login-code`, `/control/notify` (approval landed, doctor report written). The CLI never writes SQLite; `approve` and `doctor` run standalone (git/ssh/subprocess) and write a result file and/or call `/control/notify`.
- **Crash-only reconcile on every start:** remove a stale socket after a failed connect; run migrations; expire login codes and sessions; re-scan registered hosts (paths still exist, base ref resolves); drop cached approval verdicts; re-run doctor staleness marking. No in-flight state to resume in Phase 1.
- **Stop:** `POST /control/stop` → graceful close (SSE streams end, lock released) → exit; if the socket is dead but a process holds the lock, report it and fall back to SIGTERM from `run/daemon.json`, SIGKILL after a timeout.
- **One-time login:** `counterpoint open` → `/control/login-code` returns `http://127.0.0.1:<port>/login?code=<32-byte base64url>`; the server stores only `sha256(code)` with a 5-minute expiry and single use. `GET /login` passes the Host guard, consumes the code, creates a session row (random 32 bytes, stored hashed), `Set-Cookie: cp_session=...; HttpOnly; SameSite=Strict; Path=/; Max-Age=<12 h>` and 302s to `/h/{hostId}`; used/expired → 302 `/signed-out?reason=used`. Do not log query strings; send `Referrer-Policy: no-referrer`. **No `Secure` attribute** (Safari does not accept Secure cookies for `http://127.0.0.1`; loopback-only makes it unnecessary) and no `__Host-` prefix (requires Secure) — **[ASSUMED]** browser behaviour (A7).
- **Token file:** `$COUNTERPOINT_HOME/token` (0600, hex of 32 random bytes), daemon keeps only a hash in memory; used solely for the control socket. Never in env or argv.
- **Port:** default 4170 (UI-SPEC proposal), configurable; `EADDRINUSE` → the Copywriting message and non-zero exit, never drift.
- **Host registry (D-06):** `hosts(id, root_realpath, base_branch, adapter, created_at)`; base branch from `git symbolic-ref refs/remotes/origin/HEAD` (Cena: `origin/master`), overridable; every API route is `/api/hosts/:hostId/...`.
- **Ref watching:** per host, poll `git rev-parse refs/heads/<base>` every ~2 s (plus an `fs.watch` nudge on `<gitdir>/refs/heads` and `packed-refs`), emitting `runway`/`approval`/`needs-you` events on change; the uncommitted-edits hint uses `git status --porcelain=v1 -z --untracked-files=all -- <input paths>` with `GIT_OPTIONAL_LOCKS=0` and `-c core.fsmonitor=false`.

## Research Item 6 — Loopback guard on Hono 4

Prototype guard (`lib/factory/guard.ts` on `ccr-61ff69b1-hgtpdm`, read this session) ports almost unchanged (`isLoopbackHost`, `sameLoopbackOrigin`), with three **deliberate tightenings**: it let a missing `Origin` through on non-GET (`if (origin !== null && ...)`); it accepted `localhost`/`[::1]` hosts; and it had no auth layer. Its own WR-01 note is confirmed as design law: the Host check does not stop LAN clients, only the socket bind does.

```ts
// order: bind → Host → Origin/Fetch-Metadata (non-GET) → content-type → session cookie → route
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' });            // never 0.0.0.0/localhost
app.use('*', async (c, next) => {
  const host = c.req.header('host');
  if (host !== `127.0.0.1:${port}`) return c.json({ error: 'blocked' }, 403);   // exact allowlist
  await next();
});
app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD'].includes(c.req.method)) {
    const origin = c.req.header('origin');
    if (origin !== `http://127.0.0.1:${port}`) return c.json({ error: 'blocked' }, 403);   // missing Origin = reject
    if (c.req.header('sec-fetch-site') && c.req.header('sec-fetch-site') !== 'same-origin') return c.json({ error: 'blocked' }, 403);
    if (!c.req.header('content-type')?.startsWith('application/json')) return c.json({ error: 'blocked' }, 415);
  }
  await next();
});
// then: session-cookie auth on every /api/* (GET too) and on /api/events (SSE); 401 → SPA shows /signed-out
```
- `hono/csrf` **only** checks unsafe methods carrying form-compatible content types (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`) [CITED: hono.dev/docs/middleware/builtin/csrf], so a JSON `POST` is not covered; do not rely on it. The custom check above plus a JSON-only content-type requirement is the guard. `hono/secure-headers` adds `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`.
- SSE: `streamSSE(c, ...)` with `writeSSE({ id, event, data })`, loop on `!stream.aborted`; no Origin on an EventSource GET is normal, so SSE relies on Host + cookie (SameSite=Strict, `Sec-Fetch-Site: same-origin` when present). The docs page shows no heartbeat or `Last-Event-ID` example: implement both (comment line every ~25 s; replay `events WHERE seq > Last-Event-ID`).
- **CSP finding (verified):** Astryx injects `<style>` elements at runtime (`CodeBlock/highlightStyles.js`, `Layer/layerSlideRules.js`, `gestures/touchActionRule.js`, `theme/Theme.js` for unbuilt themes; Dialog, Toast, DropdownMenu and Tooltip use Layer). A strict `style-src 'self'` rendered the page fine but **lost CodeBlock syntax colours** (visible in the headless Chrome screenshots) and would flatten diff colouring. Use: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`. Scripts stay strict (`/theme-init.js` external). This corrects the UI-SPEC's implied blanket `default-src 'self'`.
- `serveStatic({ root })` resolves relative to `process.cwd()`; the daemon's cwd is arbitrary, so pass an absolute path to the packaged `dist/ui`. SPA fallback to `index.html` for non-`/api` GETs.

## Research Item 7 — Astryx setup (verified)

Built a probe app in `/Volumes/Dock/Dev/tmp-cp-research-astryx` (since deleted) with **Vite 8.3.7, React 19.3.1, TypeScript 7.0.2, `@astryxdesign/core` 0.7.11, `@astryxdesign/theme-neutral` 0.7.11, `@stylexjs/stylex` 0.19.1, `@fontsource/figtree` 5.3.0** [VERIFIED: local build + headless Chrome screenshots].
- `vite build` succeeded in about 0.4 s with **no StyleX plugin**: 2373 modules, one 604 kB JS chunk (192 kB gzip), 287 kB CSS (45 kB gzip). Chunk-size warning only. Plan for code-splitting later if desired.
- **Fonts:** Vite copied all four `figtree-latin-{400,500,600,700}` woff2/woff files into `dist/ui/assets`; the UI-SPEC open item "Vite config must copy the woff2 files" is **resolved without config**.
- **Theme:** `<Theme theme={neutralTheme} mode="dark">`, `mode?: ThemeMode` where `ThemeMode = 'system' | 'light' | 'dark'` [VERIFIED: `dist/theme/types.d.ts:74`]; the dark render shows correct tokens. `neutralTheme` from `@astryxdesign/theme-neutral/built`; CSS import order `reset.css`, `astryx.css`, `theme-neutral/theme.css`, then fontsource files [CITED: core README].
- **Peer deps:** `react >=19`, `react-dom >=19`, `@stylexjs/stylex ^0.19.0`; `sideEffects` lists `**/*.css`. TS 7.0.2 type-checks the published `.d.ts` files (`skipLibCheck: false`).
- **Prop spellings differ from the UI-SPEC prose; the compiler caught each** (from `dist/<C>/<C>.d.ts`): `Banner` takes `status` (not `variant`) plus `title`/`description`; `Button` requires `label: string`, uses `onClick`/`clickAction` (not `onPress`), `isLoading`, `variant`, `tooltip`; `CodeBlock` takes `code: string` (no children), `language`, `hasCopyButton`, `isDiff`, `maxHeight`, `isWrapped`; `Dialog` takes `isOpen`, `onOpenChange`, `purpose`, `width`; `AppShell` takes `topNav`, `sideNav`, `mobileNav`, `contentPadding`, `height`. Make `tsc --noEmit` a CI gate and re-check each component with `npx @astryxdesign/cli component <Name>` (UI-SPEC open item 3).

```tsx
// Source: verified probe app + @astryxdesign/core README
import './styles.css'; // the four @import lines, in order
import { Theme } from '@astryxdesign/core/theme';
import { LinkProvider } from '@astryxdesign/core/Link';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
<Theme theme={neutralTheme} mode={mode /* 'system' | 'light' | 'dark' */}>
  <LinkProvider component={RouterLink}>...</LinkProvider>
</Theme>
```

## Research Item 8 — GSD adapter parsing and the boundary lint

**Cena facts (read via `git show master:...`; Cena is read-only and was not touched):**
- Cena checkout is on `ccr-61ff69b1-hgtpdm`; `master` is `7e2e2a1`; `origin/HEAD -> origin/master`. `master` holds 148 files under `.planning/`; phase directories: `01-multi-tenant-foundation` (51 files) and `01.1-design-system-migration` (40). **There is no directory for Phases 2 to 7.**
- ROADMAP list rows (`ROADMAP.md:16-17`): `- [ ] **Phase 1: Multi-Tenant Foundation** - Auth, venues, ...` and `- [ ] **Phase 1.1: Design System Migration** *(INSERTED)* - ...`, both **unchecked even though 17/17 and 14/14 plans executed**: the checkbox is stale bookkeeping; derive status from disk. Detail headings: `### Phase 1: Multi-Tenant Foundation`, `### Phase 01.1: Design System Migration (INSERTED)`, `### Phase 2: A Live Menu Diners Can Read`; fields `**Goal**:`, `**Mode:** mvp`, `**Depends on**:`, `**Requirements**:`, `**Plans**: 17/17 plans executed` (Phase 2: `**Plans**: TBD`), `**UI hint**: yes`; plan rows `- [x] 01-01-PLAN.md — Walking Skeleton: ...`.
- PLAN frontmatter (`01-01-PLAN.md`): `phase: 01-multi-tenant-foundation`, `plan: 01`, `type: execute`, `wave: 1`, `depends_on: []`, `files_modified: [...]`, `autonomous: false`, `requirements: [ACCT-01, ...]`, and
  ```yaml
  user_setup:
    - service: docker + supabase-cli
      why: "Local Supabase stack ..."
      env_vars:
        - name: NEXT_PUBLIC_SUPABASE_URL
          source: "Output of `supabase start` (local API URL)"
  ```
  Variants observed across 31 plans: `user_setup: []` (01-05, 01-03), `user_setup:` with entries (01-02, 01-04, 01-07, 01-15), no `user_setup` key at all (most), `gap_closure: true`, `autonomous: true|false` (one `false` at 01-09 and 01-01). Directory contents also include non-plan documents (`01-05-PERMISSION-MATRIX.md`, `*-VALIDATION.md`, `*-PATTERNS.md`, `*-RECONCILIATION.md`, `*-COVERAGE.md`) and a `.gitkeep`.
- Both phases are **Built** (every PLAN has a SUMMARY), so **nothing on Cena `master` can currently be approved** (Pitfall 3).

**Parsing recipe:** `unified().use(remarkParse).use(remarkFrontmatter, ['yaml'])` → `fromMarkdown` positions; ROADMAP phase sections = top-level `heading` depth-3 nodes whose text matches `^Phase (\d+(?:\.\d+)?):\s*(.+?)(?:\s*\(INSERTED\))?$`, section range = heading start offset to the next depth-2/3 heading or EOF (code-fence aware, unlike a line regex). Normalize numbers as `[int, int?]` tuples (`1`, `01`, `1.1`, `01.1` → `[1]`, `[1,1]`; **never `parseFloat`**, `1.10 != 1.1`). PLAN frontmatter via `yaml` with a zod schema where `autonomous` defaults to `true` and `user_setup` to `[]`; a frontmatter or YAML failure marks that phase `Couldn't read` (file + reason), other phases unaffected; on a failed re-read keep the last good parse and retry after a short debounce (GSD may be mid-rewrite). Status derivation (UI-SPEC vocabulary): `Built` = every PLAN has a SUMMARY; `Not planned` = no CONTEXT or no PLAN; `Ready to approve` = CONTEXT + at least one PLAN and not Built; then core overlays `On runway` / `Changed since signed` from `verify()`.

**Fixtures:** freeze ROADMAP.md and the two phase directories from `master` (`git -C /Volumes/Dock/Projects/HKP/Cena archive master .planning/ROADMAP.md .planning/phases | tar -x -C test/fixtures/gsd/cena-master`; add `.planning/config.json`-free). Because Cena has no planned-but-unbuilt phase, add a **synthetic fixture phase** (a copy of the 01.1 plans with SUMMARY files removed) and a test helper that materializes fixtures into scratch git repos with `master` as base.

**Boundary lint (verified, Biome 2.6.6):** `style/noRestrictedImports` with `patterns` (available since Biome 2.2.0 [CITED: biomejs.dev/linter/rules/no-restricted-imports]) scoped by an `overrides[].includes: ["src/core/**"]` entry flagged **all five** violating forms in a scratch project: relative import, `import type`, dynamic `import()`, `export ... from`, and an alias (`#adapters/gsd`); `src/compose/ok.ts` importing the adapter was not flagged; `biome ci` exited 1 with violations and 0 once removed [VERIFIED: local run, Biome 2.6.6, project deleted afterwards].
```json
{ "overrides": [{ "includes": ["src/core/**"], "linter": { "rules": { "style": { "noRestrictedImports": {
  "level": "error", "options": { "patterns": [ { "group": ["**/adapters/**", "**/adapters", "#adapters/**"], "message": "core must not import adapters" } ] } } } } }] }
```
Also add a Vitest test that runs `biome lint` against a deliberately violating fixture directory and expects a non-zero exit (so the rule cannot silently stop working), and make `compose.ts` the only importer of `adapters/gsd` (a second override for everything except `src/compose.ts`).

## Research Item 9 — Validation approach

`workflow.nyquist_validation` is `false` in `.planning/config.json`, so the formal Validation Architecture section is omitted. Test strategy requested by the phase:

| Area | Test type | How |
|------|-----------|-----|
| Adapter parsing | unit | Vitest over frozen Cena fixtures + synthetic planned phase; golden `PlanSnapshot` JSON; malformed YAML and missing-file cases |
| Statement/digests | unit | canonical-JSON test vectors; digest of known blobs; normalization cases (checkbox tick, `Plans:` line change must not change the section digest; a Goal edit must) |
| Plumbing commit builder | integration | scratch git repos in `os.tmpdir()` (or Dock): base checked out vs other branch checked out, uncommitted edits preserved, CAS race (move tip between prepare and sign → refused), existing untracked file at the approval path → refused, tamper-hook/fsmonitor present in the repo → not executed |
| Signature verification (adversarial) | integration | throwaway keys: wrong key, wrong namespace, tampered payload, unsigned later edit, unsigned delete, extra file in the signed commit, merge commit as last toucher, two parents, duplicate/garbled `gpgsig`, wildcard/multi-key allowed-signers file rejected, `check-novalidate` never used, fingerprint pin mismatch, `-c` injection of `gpg.ssh.program` in repo config ignored |
| Loopback guard | integration over a real socket | start `serve()` on port 0; `node:http` requests with spoofed `Host: evil.example:PORT`, `localhost:PORT`, missing/foreign `Origin` on POST, `text/plain` POST, no cookie, `Sec-Fetch-Site: cross-site`; assert server bound only to `127.0.0.1` (connection to a LAN interface address is refused) |
| One-time login | integration | code single-use, expiry, replay → `/signed-out?reason=used`; cookie attributes; no query logging |
| Daemon lifecycle | integration | two concurrent starts → one daemon; `kill -9` then restart reconciles; missing home → exit non-zero with nothing created; port taken |
| Sandbox probe evaluator | unit over frozen stream-json fixtures | pass, nonce leak, mode-denial-only, skipped step, unknown message, control not reachable |
| Live sandbox probe | gated e2e (`COUNTERPOINT_LIVE_PROBE=1`) | real `claude -p` against canaries; not in default CI |
| Boundary rule | lint + meta-test | `biome ci`, plus violating-fixture meta-test |
| UI | `tsc --noEmit`, Vitest + Testing Library for states, Playwright (`playwright-core`, system Chrome) screenshots at 1024 and 360 px in light and dark for the UI-SPEC "backstop" rows (40 phases, 50 inbox items, 1,000-line diff) for owner review | no pixel-diff in Phase 1 |

Quick run: `pnpm vitest run --changed`; full: `pnpm vitest run && pnpm tsc --noEmit && pnpm biome ci`.

## Common Pitfalls

### Pitfall 1: The probe passes for the wrong reason
**What goes wrong:** Out-of-cwd `Write` to `.git/hooks` is denied under `dontAsk` mode even with no deny rule (R2), `Edit` with identical old/new strings fails before any permission check, and a nonexistent canary path looks like "blocked".
**How to avoid:** Differential treatment/control runs, existing nonce canaries, classify the denial text family, require `tool_use` evidence (probe design above).
**Warning signs:** All rows Blocked on first run; control session also blocked.

### Pitfall 2: Repo-controlled config executes during Counterpoint's own git calls
**What goes wrong:** Verified: `reference-transaction` hook ran on `git update-ref`; `core.fsmonitor=<cmd>` ran on `git status` and `git update-index`.
**How to avoid:** Plumbing only, `-c core.hooksPath=/dev/null -c core.fsmonitor=false`, `GIT_CONFIG_GLOBAL/SYSTEM=/dev/null`, `GIT_OPTIONAL_LOCKS=0` for status, absolute binaries, env allow-list, integrity snapshot refusal.

### Pitfall 3: Nothing on Cena `master` is approvable
**What goes wrong:** Success criterion 4 ("Owner approves a phase") cannot be shown on Cena today: Phases 1 and 1.1 are Built (all SUMMARYs present), Phases 2 to 7 have no `.planning/phases/` directory. The first real approval needs the owner to run `/gsd-discuss-phase 2` and `/gsd-plan-phase 2` in Cena and commit to `master` (or the demo uses a fixture host).
**How to avoid:** Automated tests use the synthetic fixture host; add a checkpoint plan step asking the owner to plan Cena Phase 2 on `master` before the end-of-phase demo. See Open Question 1.

### Pitfall 4: The ROADMAP section digest changes on legitimate bookkeeping
**What goes wrong:** Cena's phase section carries mutable progress state (`- [ ]` → `- [x] 01-01-PLAN.md — ...`, `**Plans**: TBD` → `**Plans**: 17/17 plans executed`). After plan-phase and during/after execution these lines change without any change to the *spec*, so a raw-section hash would produce false "approved version changed" items (and the Phase 2 builder's bookkeeping, applied on base after merge, would do it systematically).
**How to avoid:** Normalize before hashing and record the normalizer id (`cp-gsd-roadmap-section/v1`): LF endings, strip trailing whitespace, trim leading/trailing blank lines, rewrite plan-row checkboxes `- [x]`/`- [X]` to `- [ ]` on lines matching `^\s*- \[[ xX]\] \S+-PLAN\.md`, drop the `**Plans**:` line. Edits to Goal, Depends on, Requirements, Success Criteria, Rationale still change the digest. **This refines D-02 and needs owner confirmation (A2).**

### Pitfall 5: Decimal phase handling
`01.1` vs `1.1` vs `1.10`: compare as integer tuples; directory prefix is zero-padded (`01.1-`), roadmap list uses `Phase 1.1`, detail heading uses `Phase 01.1`. A `parseFloat` sort puts `1.10` before `1.9`.

### Pitfall 6: Session cookie and links on loopback
Cookie set on `127.0.0.1` is not sent to `localhost`: print and open only `127.0.0.1` URLs and reject `localhost` Host (clear `Request blocked` copy). No `Secure` flag (Safari).

### Pitfall 7: Prop spelling drift in a 0.x library
UI-SPEC prose uses `variant`/`onPress`/children where the types say `status`/`onClick`/`code`; `tsc` catches it. Exact-pin core and theme to the same version (theme declares `peer @astryxdesign/core: 0.7.11`).

### Pitfall 8: The displayed command must contain only validated IDs
The dialog command is `counterpoint approve <host-id> <phase-id>` where both match the strict regexes above; never interpolate phase titles, branch names or file paths. The CLI re-derives everything server-side-equivalent from git.

### Pitfall 9: `claude -p` stdin wait
Without `stdin: 'ignore'`, claude prints `Warning: no stdin data received in 3s` and delays 3 s (seen when piping to `head`). Always spawn with stdin ignored.

## Code Examples

### Verification skeleton (core/approvals/verify.ts)
```ts
// Source: verified shell recipe in this research; clean env wrapper omitted for brevity
export async function verifyApproval(git: Git, ssh: SshKeygen, trust: Trust, base: string, item: string) {
  const tip = await git.revParse(`refs/heads/${base}`);
  const path = `.counterpoint/approvals/${item}.json`;
  const c = await git.logFirstParentLast(tip, path);               // git log -1 --first-parent --format=%H <tip> -- <path>
  if (!c) return { state: 'none' as const };
  const changes = await git.diffTree(c);                           // --no-commit-id --name-status -r --root
  if (changes.length !== 1 || changes[0].path !== path || !['A', 'M'].includes(changes[0].status) || (await git.parents(c)).length !== 1)
    return { state: 'invalid' as const, reason: 'commit touches more than the approval file' };
  const { payload, signature } = splitGpgsig(await git.catFileCommit(c));
  const v = await ssh.verify({ allowedSigners: trust.file, principal: 'owner@counterpoint', namespace: 'git', signature, payload });
  if (v.exitCode !== 0 || v.fingerprint !== trust.pinnedFingerprint) return { state: 'invalid' as const, reason: 'signature' };
  const stmt = Statement.parse(JSON.parse(await git.catBlob(`${c}:${path}`)));
  return compareInputs(stmt, await currentInputs(tip));            // → on-runway | changed (+ which inputs)
}
```

### Control-socket server (daemon)
```ts
// Source: [CITED: github.com/honojs/node-server] createAdaptorServer for UNIX sockets
import { createAdaptorServer } from '@hono/node-server';
const control = createAdaptorServer(controlApp);
await new Promise<void>((res) => control.listen(join(home, 'run', 'daemon.sock'), res));
fs.chmodSync(join(home, 'run', 'daemon.sock'), 0o600);
```

### SQLite single-instance lock (daemon boot)
```ts
// Source: verified two-process test; same technique as CV/tools/speckit-auto/test-lock.ts
import { DatabaseSync } from 'node:sqlite';
const lock = new DatabaseSync(join(home, 'run', 'daemon.lock.db'));
lock.exec('PRAGMA busy_timeout=0');
try { lock.exec('BEGIN EXCLUSIVE'); } catch { console.error('Counterpoint is already running.'); process.exit(0); }
```

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `git commit -S` with `gpg.format=ssh` (config-driven) | `ssh-keygen -Y sign -n git` on the commit payload + `hash-object -t commit` | Immune to repo `gpg.ssh.program`, hooks, fsmonitor; verifiable by plain `git verify-commit` |
| Assume sandbox covers all tools | Sandbox = Bash only; `permissions.deny` for Read/Edit/Grep (merged back into the Bash sandbox) | One rule list, two mechanisms; verified |
| ESLint boundary rule | Biome `noRestrictedImports` `patterns` (2.2.0+) | Works with TS 7 (no TS JS API) |
| `localhost` console URL | `127.0.0.1` exact Host allowlist | Cookie scoping and rebinding defence |

**Deprecated/outdated in project docs:** `.claude/CLAUDE.md` Headline Decisions (Agent SDK, shadcn/Tailwind, gsd-tools-first, `@alex-profir/counterpoint`); ARCHITECTURE's `approvals.git` (superseded); ARCHITECTURE's open claim "doc does not state whether the sandbox applies to `claude -p`" (now verified: it does, Bash only); ARCHITECTURE's `Read(~/.ssh/**)` tilde form (not tested; this research used `//abs`); UI-SPEC's implied strict CSP and "copy woff2 files" item.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Statement field layout (`schema`, `item`, `inputs.files[]`, `combined`, `draft`/`gates` `{state,digest}`) and item id `phase-<NN[.N]>` | Item 4 | Costly: every approval must be re-signed if changed after the first real approval (D-02). Owner should confirm before plan execution |
| A2 | Normalizing the ROADMAP section (strip checkbox state and `**Plans**:` line) before hashing | Pitfall 4 / Item 4 | If the owner wants a raw hash, bookkeeping commits will drop approved phases off the runway; if normalization is too loose, a meaningful edit could be missed |
| A3 | Integrity snapshot = execution-capable config keys + hook/info hashes, with an explicit owner-accepted baseline, instead of hashing whole `.git/config` | Item 2 | Too narrow misses a hostile key; too broad causes fatigue. Needs owner agreement on the key list |
| A4 | macOS Keychain stores ssh passphrases as a generic password (service `OpenSSH`, account = key path) and `security find-generic-password` without `-w` reveals existence only | Item 3 | The "not loadable via Keychain" check could be wrong; verify with the owner on their machine (never print secrets) |
| A5 | Claude Code's macOS sandbox blocks Keychain access for sandboxed commands (based on search results/issue reports, not official docs) | Item 1 | If false, `gh` credentials in the macOS Keychain (the owner's `gh` uses `keyring`) could be reachable by agent Bash; the live probe must include a `gh auth status` style row run by the owner's `doctor`, not by this research |
| A6 | Host Counterpoint config lives at `.counterpoint/config.yaml` at the base tip, with a `gates` section | Item 4 | Path/section name changes alter only how the gates digest is derived; Phase 2 will own the real shape |
| A7 | Safari does not store `Secure` cookies for `http://127.0.0.1`; omit `Secure` | Item 5 | If wrong, adding `Secure` later is harmless; leaving it off is safe on loopback |
| A8 | Minimum versions git >= 2.34 (SSH signature support) and OpenSSH >= 8.1 for `-Y` verbs; tested here on git 2.50.1 / OpenSSH 10.3p1 | Item 2 | `doctor` might reject a working older tool or accept a broken one |
| A9 | `--verbose` is required alongside `--output-format stream-json` with `-p` | Item 1 | Harmless extra flag if not required |
| A10 | Default port 4170 does not clash with the prior-art preview range (4174 and up) | Item 5 | Port clash message handles it |
| A11 | A 12-hour session length is "normal" for D-07 | Item 5 | Owner preference only |

## Open Questions

1. **Cena has nothing approvable today (Pitfall 3).**
   - What we know: `master` has Phase 1 (17/17) and 1.1 (14/14) built; Phases 2 to 7 have no directory.
   - What's unclear: whether the demo of criterion 4 should wait for the owner to plan Phase 2 in Cena, or use a fixture host.
   - Recommendation: tests use the synthetic fixture host; add an owner checkpoint (run `/gsd-discuss-phase 2` and `/gsd-plan-phase 2` in Cena, commit to `master`) before the phase demo.
2. **`npx @hkp/counterpoint` before the package is published.**
   - What we know: `npm view @hkp/counterpoint` is 404; public release is out of scope for v1; criterion 1 says the owner runs `npx @hkp/counterpoint`.
   - Recommendation: ship `bin: { counterpoint }`, build a tarball (`pnpm pack`) and install it globally with `PNPM_HOME`/prefix on `/Volumes/Dock/Dev` (or `pnpm link --global`); confirm with the owner whether a private publish is wanted.
3. **ROADMAP-section normalization (A2) and statement format (A1)** need explicit owner confirmation because they are costly to change.
4. **Integrity baseline acceptance flow (A3):** who establishes the first baseline and how changes are accepted (`counterpoint trust <host>` after reviewing a printed list).
5. **Keychain/`gh` credential denial (A4, A5)** is unverified here because real credentials were off limits. First doctor task: the owner runs the probe including a `gh auth status`-class row and the Keychain check on their own machine.
6. **`.counterpoint/config.yaml` path (A6)** — confirm for GATE-01 in Phase 2.
7. **Author identity on the approval commit:** read `user.name`/`user.email` with a plain `git config --get` (read-only) and pass them via `GIT_AUTHOR_*`/`GIT_COMMITTER_*`; or use a fixed "Counterpoint owner" identity. Recommendation: the owner's configured identity.
8. **`cena_owner` key** passphrase status was not inspected; recommendation stands: generate a new dedicated key.
9. **Phase 2 carry-over:** does Cena's `.claude/commands`/`agents`/skills content still load under `--setting-sources user`? (Cena `master` has no `.claude/settings.json`, only agents/commands/hooks directories.)
10. **Local vs remote base tip:** D-03 is read as the local `refs/heads/master`; if the owner pushes first and a teammate-less flow means `origin/master` is ahead, confirm local is intended.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | runtime, `node:sqlite` | ✓ | 24.21.0 (nvm, on Dock) | — |
| npm | installs | ✓ | 12.2.0 (cache at `/Volumes/Dock/Dev/npm-cache`) | — |
| corepack / pnpm | dev package manager | corepack ✓ 0.36.0; pnpm ✗ not on PATH | registry latest 12.18.0 | `corepack enable pnpm` (cache `/Volumes/Dock/Dev/corepack`) or npm |
| git | all git plumbing | ✓ | 2.50.1 (Apple Git-155) | — |
| ssh-keygen / ssh | sign, verify, key checks | ✓ | OpenSSH_10.3p1 (LibreSSL 3.3.6) | — |
| ssh-add | key-in-agent check | ✓ | `The agent has no identities.` | — |
| gh | `doctor` tool check | ✓ | 2.102.0 (auth stored in macOS keyring) | — |
| claude | probe, Phase 2 runner | ✓ | 2.1.319 | — |
| macOS Seatbelt (sandbox) | agent confinement | ✓ | `sandbox-exec` at `/usr/bin/sandbox-exec`; Claude's sandbox worked | — |
| `srt` (sandbox-runtime) | fallback only | ✗ | npm 0.0.81 available | not needed unless a Claude release regresses coverage |
| Google Chrome | Playwright screenshots | ✓ | `/Volumes/Dock/Applications/Google Chrome.app` (headless screenshot worked) | Firefox also present |
| `COUNTERPOINT_HOME` | D-08 | ✗ not set in env; `/Volumes/Dock/Dev/Library/Application Support/Counterpoint` does not exist | — | Owner creates it (`counterpoint init`) and exports it in `~/.zshrc`; do not let the tool create it |

**Missing dependencies with no fallback:** none for planning. **Missing with fallback:** pnpm (enable via corepack), `COUNTERPOINT_HOME` (owner setup step, a checkpoint in the plan).

## Security Domain

`security_enforcement` is enabled (absent = enabled; `security_asvs_level: 1`).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | One-time login code (32 random bytes, hashed at rest, 5 min, single use) → session; token file 0600 for the control socket |
| V3 Session Management | yes | Random 32-byte session ids stored hashed; `HttpOnly; SameSite=Strict`; server-side expiry; invalidated on stop |
| V4 Access Control | yes | Session required on every `/api/*` (GET and SSE); control socket requires bearer token; approval authority only from verified git |
| V5 Input Validation | yes | zod on every payload; strict host/phase id regexes before any path or argv use; argument-array spawning only |
| V6 Cryptography | yes | `ssh-keygen -Y` (ed25519, sha512 namespace `git`), `crypto.randomBytes`, SHA-256; no hand-rolled crypto |
| V7 Error handling/logging | yes | No query strings or tokens in logs; probe logs stored under the 0700 home |
| V14 Configuration | yes | CSP, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`, bind `127.0.0.1` |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| CSRF / cross-site POST to loopback | Tampering | Exact Origin match (missing = reject), JSON-only content-type, `Sec-Fetch-Site`, SameSite=Strict cookie |
| DNS rebinding | Spoofing/Info disclosure | Exact `Host` allowlist `127.0.0.1:<port>`; bind `127.0.0.1` |
| LAN client with forged `Host` | Elevation | Socket bind to `127.0.0.1` (the Host check cannot stop it) |
| Agent reads signing key / token / state | Info disclosure | Sandbox + `permissions.deny` twins, `--setting-sources user`, env allow-list, differential probe |
| Agent-planted `.claude/settings.json` hooks | Elevation | `--setting-sources user`, `--strict-mcp-config`, deny `Edit(.claude/**)` |
| Repo hooks/fsmonitor/`gpg.ssh.program` executing at approval time | Elevation | Plumbing only, `-c core.hooksPath=/dev/null -c core.fsmonitor=false`, direct `ssh-keygen`, integrity snapshot |
| Forged or replayed approval | Spoofing/Repudiation | Pinned fingerprint + namespace + principal, last-toucher rule, one-file diff-tree check, digests recomputed at tip |
| Approval prompt confusion (command built from agent text) | Tampering | ID-only command with strict regexes; CLI re-derives and prints digests before the passphrase |
| ssh-agent / Keychain caching of the approval key | Elevation | `doctor` checks; scrub `SSH_AUTH_SOCK`/`SSH_ASKPASS` for `approve`; dedicated key |
| XSS from agent-authored text in the console | Tampering | React text rendering only; diffs as plain text in `CodeBlock`; CSP `script-src 'self'` |

## Sources

### Primary (HIGH confidence)
- Local runs this session: four `claude -p` sandbox sessions (claude 2.1.319) and a `--setting-sources` hook test; plumbing commit/sign/verify/CAS experiments (git 2.50.1, OpenSSH 10.3p1); two-process `BEGIN EXCLUSIVE` test; Astryx 0.7.11 + Vite 8.3.7 + TS 7.0.2 build and headless Chrome screenshots; Biome 2.6.6 boundary-rule experiment.
- `npm view` for every version listed (2026-11-09); `gsd-tools query package-legitimacy check`.
- `.planning/phases/01-trusted-shell-signed-runway/01-CONTEXT.md`, `01-UI-SPEC.md` (lines 148-157 statuses, 210-221 routes, 286-298 CLI contract), `.planning/REQUIREMENTS.md`, `.planning/PROJECT.md`, research docs.
- Cena `master` (read-only `git show`/`ls-tree`): ROADMAP.md and PLAN frontmatter; prototype `lib/factory/guard.ts`, `lib/factory/signature.ts`.
- Package contents of `@astryxdesign/core@0.7.11` / `theme-neutral@0.7.11` (`npm pack` into an isolated scratch directory, text inspection only).

### Secondary (MEDIUM confidence)
- https://code.claude.com/docs/en/sandboxing (scope: Bash only, protected paths, `failIfUnavailable`, `allowUnsandboxedCommands`, srt reference).
- https://code.claude.com/docs/en/settings (precedence: managed > `--settings` > local > project > user; `--settings` semantics).
- https://code.claude.com/docs/en/env-vars (`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`).
- https://biomejs.dev/linter/rules/no-restricted-imports/ ; https://hono.dev/docs/middleware/builtin/csrf ; https://hono.dev/docs/helpers/streaming ; https://github.com/honojs/node-server.
- https://github.com/sverweij/dependency-cruiser (rules reference; TS 7 behaviour not stated).

### Tertiary (LOW confidence)
- Web search results and issue reports on macOS Keychain/Go TLS behaviour inside Claude Code's sandbox (claudeissues.com threads: not authoritative). Used only to flag A5.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions from the registry today; Astryx/Vite/TS 7 build executed.
- Sandbox confinement: HIGH for Bash/Read/Grep/Write on macOS with the stated version; MEDIUM for Keychain/`gh` (A5) and future-version drift.
- Approval mechanics: HIGH — end-to-end experiment including adversarial cases at the ssh/git level; the integrity-snapshot key list is a recommendation (A3).
- Daemon design: MEDIUM — lock and socket primitives proven; the rest is design.
- Pitfalls: HIGH — each of 1, 2, 3, 4 and 7 was observed in this session.

**Research date:** 2026-11-09
**Valid until:** 2026-11-16 for Astryx and `claude` specifics (ships weekly); 30 days for git/ssh mechanics

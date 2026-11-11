# Design: Trusted Shell & Signed Runway

## Context

See proposal.md for the motivation. The first host is Cena (default branch `master`). Agents run as the owner's OS user and can `curl 127.0.0.1`, read the same files and run git in the same repository, so every protection below assumes an agent is actively trying to approve its own work. Prior art reused for ideas only: the CV repo's `speckit-auto` (SQLite exclusive lock, worktree helpers) and a Cena prototype branch (loopback guard, signature parsing, console theme).

## Goals / Non-Goals

**Goals:**
- Prove agent confinement live, with a probe that cannot pass for the wrong reason.
- Make approval a signed git commit the owner creates at a terminal, verified from git every time.
- Keep core independent of the host's planning framework.
- Ship a walking skeleton the owner uses on Cena: start, sign in, browse, approve, see drift.

**Non-Goals:**
- Running builds, gates, PRs, worktrees or the quota governor (`first-unattended-run`).
- Merge approval (`morning-review-signed-merge`); drafts and the draft digest (`design-drafts-visual-gate`); the council.
- Public npm release, Touch ID signing, a no-framework adapter.

## Decisions

### Process model
- **One background daemon per machine**, started (or attached to) by `counterpoint`, serving every registered host; host id is part of every row, path and route. Alternative rejected: a foreground server per repo (closing the terminal kills runs; no shared usage-limit governor).
- **Crash-only.** Single instance by holding a SQLite `BEGIN EXCLUSIVE` lock for life (the kernel drops it on any death). Liveness = the control socket answers; the CLI re-enters itself as the daemon through a hidden command.
- **Control channel** = Unix socket in a 0700 directory, plus a bearer token from a 0600 file in the home. The CLI never writes SQLite; `approve` and `doctor` run standalone and notify the daemon.
- **Home** from `COUNTERPOINT_HOME`, else the platform data folder; refuse to start and create nothing if missing (the Dock volume may be unmounted). Only `init` creates it. Rejected: always `~/.counterpoint` with a symlink.
- **Port** fixed at 4170 (clear of the 4174+ preview range), configurable, never drifting.

### Console access
- Bind `127.0.0.1` only: a Host check alone does not stop LAN clients, only the bind does. Then exact Host allowlist (DNS rebinding), then exact Origin + `Sec-Fetch-Site` + JSON-only on writes, then the session.
- **One-time URL sign-in**: 32 random bytes, stored as SHA-256, 5 minutes, single use, minted only over the token-protected socket; exchanged for an `HttpOnly; SameSite=Strict` 12-hour cookie (no `Secure`, which Safari refuses on plain-http loopback). Rejected: pasting a token; weeks-long cookies.
- **SSE, not WebSocket**: everything live is server-to-UI; event ids are the store's outbox sequence so `Last-Event-ID` replays exactly. Snapshots over HTTP (TanStack Query) invalidated by SSE event families.
- **UI**: React 19 + Astryx with the neutral theme, prebuilt CSS, self-hosted Figtree (the theme's font CSS pulls Google Fonts, which breaks offline use and the CSP). Theme applied pre-paint by an external `/theme-init.js` because the CSP blocks inline script. Astryx's `CodeBlock` and layered components inject `<style>` at runtime, so the style policy allows that.

### Agent confinement (spike result, claude 2.1.319 on macOS)
- The OS sandbox applies to headless `claude -p`, but **only to Bash**; Read, Grep, Write and Edit are not confined by `sandbox.filesystem`. Fix: a `permissions.deny` twin (`Read(//abs/**)` and `Edit(//abs/**)`) for every protected path; deny rules also merge into the Bash sandbox, covering symlinks and Grep. No outer `srt` wrapper needed.
- Protected paths are absolute, realpath-resolved; the git dir comes from the common dir so linked worktrees are covered (Claude Code's built-in `.git` protection covers only the working directory).
- **User settings only** (`--setting-sources user`) and `--strict-mcp-config`: a project hook planted in a worktree ran unsandboxed in `-p` mode by default.
- **File edits confined to the session folder** (allow-only-workdir edit grant plus `blockWritesOutsideWorkingDirectories`): live checks showed `allowWrite: []` confines only Bash, so Write/Edit could change `~/.claude/settings.json` or shell rc files.
- **Auto permission mode** (owner decision): headless default mode denies every unlisted call and stalls builders; dontAsk was not what actually ran. No deterministic guarantee may rest on the classifier.
- **Environment scrub opted out** (`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0`, owner decision): on claude 2.1.321 the scrub forced auto down to default mode. Counterpoint-owned replacements: `autoAllowBashIfSandboxed: false`; doctor fails if any settings source turns isolation off; a credential-environment probe row. Replacement 1 is suspected inert while bare `Bash` is allow-listed (review WR-01, verify in `first-unattended-run`).
- Environment is an allow-list; never `SSH_AUTH_SOCK`, askpass, GitHub tokens or `COUNTERPOINT_*`. `CLAUDE_CODE_MESSAGING_TOKEN` is denied in the profile.

### Doctor probe
- **Canaries, not secrets**: nonce files next to each protected folder prove the same rule that protects the real key.
- **Differential**: a treatment session with the production profile and a control session confined to a probe-owned mirror. Blocked only if control reached and treatment did not; otherwise Not checked.
- **Evidence from stream records only**: denial text, permission decision, `permission_denials` and `permission_denied` events must agree; any nonce in the treatment stream = Reachable. Only deny-rule, OS-sandbox or outside-write-block refusals count (mode refusals were a verified false-pass source). The matcher is pinned to a Claude Code version; unknown wording yields Not checked. Identical-text Edit returns "No changes" before any permission check, so the probe writes nonce siblings instead.
- **Accepted risks**: sandboxed Bash can read the macOS Keychain, so gh's Keychain credential is reachable. The owner records `gh-keychain` per machine at a terminal; doctor applies it only when the Keychain lookup is the sole reached gh step and prints it every run. The sandbox's own loopback proxy login (proxy URLs, `CLOUDSDK_PROXY_PASSWORD` beside a loopback `CLOUDSDK_PROXY_ADDRESS`) is the named exception `sandbox-proxy-login`; Claude Code sets these after deny entries apply.
- **Stop rule** (owner, after three re-plans): only a protected-target failure stops work; other live surprises are recorded as findings.

### Framework adapter
- Core defines the port; adapters implement it; only the composition root imports an adapter; a Biome restricted-imports rule plus a meta-test enforce it, and the package build runs lint.
- The adapter is pure over a git file-reader port that reads committed blobs at the base tip (literal pathspecs, symlinks and files over 5 MiB refused). It returns labelled inputs; core owns hashing and the statement. Native parsing (remark + `yaml` + zod), never a framework CLI's JSON output, which is not a published contract; frozen host fixtures are the adapter contract.
- **Unit of work = one OpenSpec change** (`openspec/changes/<name>/`), identified by its kebab-case name. Host detection by `openspec/config.yaml` at the base tip. Archived changes are done. Order: dependencies (`x-depends-on`), then `created`, then name.

### What an approval locks
- Ready to approve only when the change says what will be built (a proposal and tasks); the owner signs the exact work the builder will run, and the builder never plans on its own.
- Covered set = every file in the change directory, raw committed bytes, per-file digests so the change view can name what changed. `tasks.md` is normalized so checkbox ticks are not content changes (the builder's own bookkeeping must not knock approvals off the runway). Changing this rule later changes every digest and forces re-signing, so the adapter owns it and the normalization is versioned.
- Recomputed against the **base-branch tip** (what the builder checks out), never the working tree; uncommitted edits only show a soft hint.
- Draft slot present from day one (`none`) and gate-config slot hashing the gates section of the host's Counterpoint config (or `absent`), so later changes do not alter the statement format.
- Statement format `counterpoint/approval/v1`, sorted keys, no "prepared" block (owner choice): identical inputs at the same tip give identical bytes; a hand-edited statement is invalid, not misleading. Moving the unit of work to an OpenSpec change bumps it to `v2` (item type `change`, id the change name) with everything else unchanged.
- Owner steps (unchecked tasks starting `Owner:`) do not block approval but are shown prominently on the change and in the approval summary.

### Signing and landing
- **Prepare in the console, sign in the terminal** (owner decision): simplest path that keeps the key out of agents' reach; Touch ID/FIDO2 later.
- The command is ID-only, re-derives and prints everything before the passphrase prompt (what you see is what you sign); the console shows a 12-hex statement fingerprint so dialog and terminal can be compared.
- `ssh-keygen -Y sign -n git` with `/usr/bin/ssh-keygen`, fixed env, `SSH_AUTH_SOCK`/`SSH_ASKPASS` scrubbed, TTY required. Signature embedded as `gpgsig`.
- Commit built with plumbing (`hash-object`, `mktree`, `commit-tree`) without an index, landed by `update-ref` compare-and-swap; if the base branch is checked out, only the approval path is placed in the index and working tree so it does not show as deleted. Not pushed.
- **Every host git call is hardened**: absolute git, argument arrays, global/system config off, `core.hooksPath=/dev/null`, `core.fsmonitor=false` (a planted `reference-transaction` hook and an fsmonitor command both executed in research tests).
- **Verification fails closed**: last commit touching the file, one parent, only that file, `ssh-keygen -Y verify` exit 0 and the pinned fingerprint, statement parsed with zod. Never `check-novalidate`, never git's own signature text.
- **Integrity snapshot** of the execution-capable `.git` surface only (hashing the whole config would fire on every `push -u` and train rubber-stamping), baseline set by the owner with `trust {host}`.
- Rejected: a separate approvals repository; approvals live in the host's normal history.

### Code layout and tooling
- Modular monolith: `src/core/{approvals,runway,security,store,git,host,framework}`, `src/adapters/<framework>`, `src/agent`, `src/doctor`, `src/server`, `src/cli`, `src/compose.ts`; `ui/` for the SPA; `tests/` mirrors `src/` plus `boundary`, `e2e`, `helpers`, `fixtures`.
- Node 24+, ESM, TypeScript 7 with erasable syntax only, so source runs directly through Node's type stripping in dev and tests; tsdown bundles `dist/cli.mjs` for the package. Biome for lint and format (typescript-eslint cannot run on TS 7).
- Store: `node:sqlite` (WAL, STRICT tables, `user_version` migrations), the daemon is the single writer and the CLI reads only.
- Tests: Vitest projects `unit` and `e2e`; e2e drives the owner's installed Chrome through `playwright-core` (no browser download); scratch folders under the repo's `.tmp/` on the Dock volume. Live probe tests run only with `COUNTERPOINT_LIVE_PROBE=1`; the evaluator is tested against frozen live stream-json fixtures.

### Derive, don't store
Approval state, statuses and the runway are computed from git at read time; SQLite holds at most a cache keyed by host, tip and item. A forged store row gains an agent nothing. A base-tip watcher (about 2 s poll plus fs nudges) emits runway, approval and Needs You events.

## Risks / Trade-offs

- gh's Keychain credential stays reachable by agents (accepted, recorded, printed on every doctor run).
- The probe matcher is tied to one Claude Code version; an update turns rows Not checked and doctor stops passing until fixtures are refrozen.
- The code review closed open: doctor does not judge user/managed write widenings and has no Bash outside-write step (CR-01), plus warnings WR-01..WR-08. Carried into `first-unattended-run` as its first work.
- `npx @hkp/counterpoint` does not resolve an unpublished scoped package on npm 12; the installed `counterpoint` command is the start command until the public release.

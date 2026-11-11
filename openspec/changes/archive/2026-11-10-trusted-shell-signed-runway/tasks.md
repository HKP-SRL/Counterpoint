# Tasks

Groups follow the original plan numbers; execution order differed (sandbox and approval plumbing first, packaging and the owner demo last).

## 1. Toolchain and core host modules

- [x] 1.1 Owner vetted every package; pnpm 12, TypeScript 7, Biome with the adapter-boundary rule, Vitest unit and e2e projects
- [x] 1.2 Home resolution that refuses a missing home without creating anything; strict id patterns
- [x] 1.3 Clean-environment git runner proven not to run planted fsmonitor commands or hooks
- [x] 1.4 Host registration with an injected framework detector

## 2. Walking skeleton

- [x] 2.1 `counterpoint` starts one detached daemon behind a SQLite exclusive lock and registers the repository as a host
- [x] 2.2 Astryx console (Vite 8, React 19) served on 127.0.0.1 with an exact Host allowlist
- [x] 2.3 Control over an owner-only Unix socket with a bearer token; `counterpoint stop`
- [x] 2.4 Missing home, taken port and second start print the contract messages

## 3. Sign-in, request guard and live events

- [x] 3.1 Single-use 32-byte sign-in codes minted over the control socket, exchanged for a hashed 12-hour `HttpOnly; SameSite=Strict` session
- [x] 3.2 Exact-Host, exact-Origin, JSON-only and session guard on every API call; wrong Hosts refused before HTTP parsing
- [x] 3.3 SQLite events outbox feeding the SSE stream with `Last-Event-ID` replay and heartbeats
- [x] 3.4 `init`, `status` and `open` commands

## 4. Sandbox spike as code

- [x] 4.1 One sandbox-settings builder: Read/Edit deny twins, git-dir denies, no write grant
- [x] 4.2 Environment allow-list and `claude -p` argv; stream-json runner behind the AgentRunner port
- [x] 4.3 Doctor report schema
- [x] 4.4 Differential probe with a control session confined to a probe-owned mirror; live run blocked every file target and found the macOS Keychain readable from sandboxed Bash (recorded, later accepted as a risk)

## 5. Probe evaluator that cannot false-pass

- [x] 5.1 Pure stream-json evaluator: Blocked / Reachable / Not checked per target from four agreeing records; any canary in the treatment stream reads Reachable
- [x] 5.2 Matcher pinned to the tested Claude Code version; one retry when the treatment skipped a step
- [x] 5.3 Real and mutated fixtures for every known false-pass shape
- [x] 5.4 Found that Write/Edit could write outside the session folder; logged for an owner decision (fixed in group 17)

## 6. Framework adapter read side

- [x] 6.1 Core-owned adapter port and a git reader of committed blobs only (symlinks and files over 5 MiB refused, literal pathspecs)
- [x] 6.2 Adapter turning the host's committed planning files into a snapshot of work units, with per-unit unreadable reasons
- [x] 6.3 Framework-agnostic status in core; tested against a frozen Cena fixture and a synthetic fixture

## 7. Approval inputs, composition root and boundary

- [x] 7.1 Adapter answers "what does approving this unit cover" as exact committed bytes, each input naming its source file, with a versioned normalization for bookkeeping-only edits
- [x] 7.2 Composition root selects the adapter per host and detects the framework at the base tip
- [x] 7.3 Meta-test proving the Biome boundary rules and keeping framework path literals out of core

## 8. Signed-approval plumbing

- [x] 8.1 Approval commits built with git plumbing, signed by `/usr/bin/ssh-keygen -Y sign -n git` with no agent or askpass, embedded as `gpgsig`
- [x] 8.2 Compare-and-swap landing on the base branch without touching the owner's work
- [x] 8.3 Fail-closed verifier with an adversarial forgery matrix
- [x] 8.4 Integrity snapshot of the execution-capable `.git` surface with an owner baseline

## 9. Console shell

- [x] 9.1 Astryx AppShell: wordmark, host switcher with base branch, live-updates dot, Light/Dark/System menu, side navigation
- [x] 9.2 External `/theme-init.js` applying the stored theme before first paint under `script-src 'self'`
- [x] 9.3 Routes for host pages and the signed-out screen; 401 goes to signed-out, 403 to `Request blocked`
- [x] 9.4 One EventSource mapping server event families to query invalidations; paused banner

## 10. Doctor and trust commands

- [x] 10.1 `counterpoint doctor [host]`: tools, key hygiene (passphrase, ssh-agent, Keychain, OpenSSH version), integrity baseline, live probe
- [x] 10.2 Grouped report, stored per host, console nudged, exit 0 only when everything passes
- [x] 10.3 `init-key`, `trust-key` and `trust {host}`, writing only after `y` typed at a terminal

## 11. Work-unit list, detail and Trust page

- [x] 11.1 Console list of every work unit with core-derived status and approval readiness
- [x] 11.2 Detail page showing why it can or cannot be approved and the exact inputs a signature binds, with 12-hex digests
- [x] 11.3 Base-tip watcher refreshing the console within about 2 s of a commit
- [x] 11.4 Read-only Trust page showing the last doctor verdict

## 12. Approve command and recomputed runway

- [x] 12.1 Owner confirmed the `counterpoint/approval/v1` statement format (sorted keys, no prepared block)
- [x] 12.2 `counterpoint approve` re-derives the statement at the base tip, prints every digest, the gate slot and a statement fingerprint, signs at the terminal, checks the signature before landing, verifies from git and reports the runway
- [x] 12.3 Approval state and runway recomputed from git on every read, gate-config drift included

## 13. Approve from the console

- [x] 13.1 Approve dialog asks the server to recompute, shows inputs, Draft and Gates rows, fingerprint and the command
- [x] 13.2 Dialog flips to `Signed. Runway is now N.` when the landing is observed
- [x] 13.3 Mission page leads with the runway figure

## 14. Needs You and the change view

- [x] 14.1 Drifted approvals leave the runway and appear under `Approved version changed`
- [x] 14.2 Change view: changed inputs with signed and current digests, git's diff since signing, the re-sign command
- [x] 14.3 Re-signing or reverting resolves the item on its own

## 15. Mission cards, drift hints and end-to-end drift test

- [x] 15.1 Mission: changed-since-signed warning, runway, Needs You card and Trust card
- [x] 15.2 `Review changes` on drifted items; uncommitted-edits hint
- [x] 15.3 13-test browser e2e of the whole drift loop through the real CLI
- [x] 15.4 Script rendering the 20 UI backstop screenshots; owner reviewed them

## 16. Package, install and owner demo on Cena

- [x] 16.1 `@hkp/counterpoint` 0.1.0 bundled by tsdown, packed and installed globally under the Dock npm prefix; lint on the build path
- [x] 16.2 Owner key created and trusted; a Cena work unit planned and ready to approve
- [x] 16.3 Owner-run demo on Cena: start and sign-in, theme persistence, `trust`, `doctor`, browsing, first signed approval, drift into Needs You, re-sign, guard curls returning 403
- [x] 16.4 Correction: `npx @hkp/counterpoint` does not resolve before publishing; the installed `counterpoint` is the start command until the public release

## 17. Confine agent file edits to the session folder

- [x] 17.1 Launch profile grants file edits only inside the working folder; tools Bash, Read, Grep, Glob
- [x] 17.2 Eighth probe row `Files outside the working folder` through evaluator and doctor (proven with a fake claude; live proof in group 23)

## 18. Superseded: live proof under dontAsk

Superseded and never completed. It halted at its live tracer on claude 2.1.321, where the environment scrub forced dontAsk down to default mode. The owner then chose auto permission mode, and the work moved to groups 21 to 23 and then 24 to 26.

## 19. Accepted risk, CLI side

- [x] 19.1 Structured probe evidence per step
- [x] 19.2 `counterpoint accept-risk gh-keychain` / `revoke-risk`, terminal only, with a reason
- [x] 19.3 Three-way verdict in doctor and the Trust API; risk applied only when the Keychain lookup is the sole reached gh step

## 20. Accepted risk, console side

- [x] 20.1 Trust banner `Agents are boxed in, with one accepted risk`, `Accepted risk` badge on the gh row and Mission card
- [x] 20.2 Revoking restores the failing verdict at once
- [x] 20.3 One live doctor proof on claude 2.1.321; the Keychain finding waived as an accepted risk

## 21. Superseded: auto mode with the environment scrub

Superseded and never completed. It halted at its live tracer, where the scrub also forced auto mode down to default. The owner chose to opt out of the scrub with three replacements; its committed launch work was cherry-picked into group 24, and the rest moved to groups 25 and 26.

## 22. Permission-mode check and Trust page update

- [x] 22.1 Doctor records the treatment session's real permission mode from its init events and fails anything but auto
- [x] 22.2 Reports without the check never read pass
- [x] 22.3 Trust page shows both session checks, all nine probe rows and the new all-pass wording

## 23. Live nine-row proof

- [x] 23.1 One live probe in auto mode with the scrub opted out and all three replacements: eight rows Blocked by deny rule or outside-write block, gh reached only through the Keychain lookup
- [x] 23.2 Fixtures refrozen and matcher version bumped; the outside-write and scrub findings closed

## 24. Scrub opt-out, replacement 1

- [x] 24.1 Agent sessions start with `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0` and `sandbox.autoAllowBashIfSandboxed: false`
- [x] 24.2 Live tracer proved both probe sessions run in auto mode first
- [x] 24.3 Evaluator counts only deny-rule, OS-sandbox or outside-write-block refusals

## 25. Scrub opt-out, replacement 2

- [x] 25.1 Doctor reads every settings source an agent session loads (launch, user, server-managed cache, managed file and drop-ins, managed preferences)
- [x] 25.2 Fails with source, key and fix when any turns sandbox isolation off; no row stored Blocked while it fails

## 26. Scrub opt-out, replacement 3

- [x] 26.1 Ninth probe row `Credentials in the shell environment`, listing names, lengths, shapes and host classes, never values
- [x] 26.2 Launch profile denies `CLAUDE_CODE_MESSAGING_TOKEN`
- [x] 26.3 Loopback proxy logins recorded as the owner's named exception `sandbox-proxy-login`; rerun on claude 2.1.321 passed

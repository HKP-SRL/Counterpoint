---
phase: 01-trusted-shell-signed-runway
plan: 16
subsystem: packaging
tags: [tsdown, npm-pack, global-install, npx, counterpoint-home, cena, readiness, owner-demo]

# Dependency graph
requires:
  - phase: 01-15
    provides: "the `scripts` include in tsconfig.json (scripts/*.ts are type-checked) and the backstop screenshots in .tmp/backstop/"
  - phase: 01-20
    provides: "the accepted-risk console and the live doctor proof the owner's demo step 3 relies on"
  - phase: 01-23
    provides: "the live sandbox proof of Counterpoint's own launch settings (doctor's real-settings check is new in the demo)"
provides:
  - "tsdown.config.ts: src/cli/main.ts bundled to dist/cli.mjs (ESM, node24, shebang, clean:false, nothing from node_modules bundled)"
  - "package.json scripts clean, build:node, build (lint, typecheck, clean, bundle, UI) and pack:local"
  - "@hkp/counterpoint 0.1.0 installed globally from the local tarball under the Dock npm prefix; npx --no @hkp/counterpoint resolves it"
  - "COUNTERPOINT_HOME exported in ~/.zshrc, home created on /Volumes/Dock (mode 700)"
  - "scripts/host-phases.ts: read-only `{id} {status}` listing of a host's phases at its base tip"
  - "the owner's end-of-phase demo checklist, adjusted for Cena's real Phase 2"
affects: [01-verification, phase-02]

# Actuals (#2632): chars/4 over the realized diff (4,558 chars, git diff f9267b1^..9abe18c over the three plan files)
actuals:
  tokens: 1140
  tasks: 3
  commits: 1
plan_head_before: ad5792e2eafb32d95caf44224cfaa727f9189a99
plan_head_after: 9abe18cea8357e36f2704f3bf5544b4278597b12

tech-stack:
  added: []
  patterns:
    - "Read-only host scripts reuse the composition root and the clean-env git reader, so they report exactly what the console would derive from the committed base tip"

key-files:
  created:
    - tsdown.config.ts
    - scripts/host-phases.ts
  modified:
    - package.json

key-decisions:
  - "Global install from the tarball (`npm install -g --ignore-scripts`) was enough for `npx --no @hkp/counterpoint`; the `npm link` fallback was not needed"
  - "The readiness script derives status without the runway overlay (it reads no approvals), which is the pre-approval state the plan asks to confirm"

patterns-established:
  - "Executor-side checks against a real host stay read-only; every session, key, risk and approval step is listed for the owner instead"

requirements-completed: [FOUND-01, FOUND-03, APPR-01]

coverage:
  - id: D1
    description: "`pnpm build` runs lint first, then typecheck, clean, the tsdown bundle and the Vite UI; the local tarball holds only package.json and dist/ (dist/cli.mjs and dist/ui/index.html included)"
    requirement: FOUND-01
    verification:
      - kind: other
        ref: "tar -tzf .tmp/pack/hkp-counterpoint-0.1.0.tgz (checked in Task 1, commit f9267b1)"
        status: pass
    human_judgment: false
  - id: D2
    description: "`npx @hkp/counterpoint` resolves the globally installed 0.1.0 under /Volumes/Dock; COUNTERPOINT_HOME is set and exists with mode 700"
    requirement: FOUND-03
    verification:
      - kind: manual_procedural
        ref: "owner ran the global install (owner decision option A); orchestrator verified `npx --no @hkp/counterpoint -- --version` prints 0.1.0 and the home is mode 700"
        status: pass
    human_judgment: false
  - id: D3
    description: "Cena master's Phase 02 derives as ready, Phases 01 and 01.1 as built (read-only)"
    requirement: APPR-01
    verification:
      - kind: other
        ref: "node scripts/host-phases.ts /Volumes/Dock/Projects/HKP/Cena master | grep -qx '02 ready'"
        status: pass
    human_judgment: false
  - id: D4
    description: "End-to-end demo on Cena: start, sign in, theme, trust baseline, accepted risk and doctor, phases, signed approval (runway 0 to 1), drift in Needs You, guard spot-checks"
    requirement: APPR-01
    verification: []
    human_judgment: true
    rationale: "Every step starts a console session, records trust, runs the live probe in the owner's own Claude Code setup or types the approval passphrase; by design (T-01-60) only the owner may do these, at their own terminal"

# Metrics
duration: 3h55m (wall clock, including the owner's Task 2 checkpoint)
completed: 2026-11-10
status: complete
---

# Phase 01 Plan 16: Ship to the Owner's Machine and the Cena Readiness Check Summary

**@hkp/counterpoint 0.1.0 is bundled by tsdown, packed as a local tarball and installed globally under the Dock npm prefix, so `npx @hkp/counterpoint` works with no publishing. A read-only script confirms Cena master's Phase 02 is Ready to approve (01 and 01.1 Built). The signed end-to-end demo is the owner's, listed below.**

## Performance

- **Duration:** about 3h55m wall clock (Task 1 commit at 17:05 CET, Task 3 done at 21:00 CET); the owner's Task 2 checkpoint took most of it
- **Started:** 2026-11-10 (Task 1)
- **Completed:** 2026-11-10T19:59:56Z
- **Tasks:** 3 of 3 (Task 2 was the owner's checkpoint)
- **Files modified:** 3 (tsdown.config.ts, package.json, scripts/host-phases.ts)

## Accomplishments

- `pnpm build` now runs `pnpm lint` first, so the Biome boundary rule (core must not import an adapter) fails the build (ROADMAP SC3). It then runs typecheck, clean, `tsdown` to `dist/cli.mjs` and Vite to `dist/ui`.
- Local tarball `.tmp/pack/hkp-counterpoint-0.1.0.tgz` contains only `package/package.json` and `package/dist/...`, including `dist/cli.mjs` and `dist/ui/index.html`. tsdown splits the CLI into `dist/cli.mjs` plus `app-*.mjs` and `daemon-*.mjs` chunks, all under `dist/`.
- Installed on the owner's machine (owner decision "option A", run by the owner): `counterpoint` is at `/Volumes/Dock/Dev/nvm/versions/node/v24.21.0/bin/counterpoint`. `npx --no @hkp/counterpoint -- --version` prints `0.1.0`; the global install resolved, so no `npm link` was needed.
- `~/.zshrc` has exactly one line `export COUNTERPOINT_HOME="/Volumes/Dock/Dev/Library/Application Support/Counterpoint"` (backup `~/.zshrc.counterpoint-bak`). The home exists with mode 700.
- Owner's Task 2 is done (verified read-only by the orchestrator): `~/.ssh/counterpoint_approval.pub` exists, `$COUNTERPOINT_HOME/trust/key.json` exists, and Cena master has Phase 02's CONTEXT and 02-01..02-13 PLAN files.
- `scripts/host-phases.ts` against Cena master printed:

  ```
  01 built
  01.1 built
  02 ready
  03 not-planned
  04 not-planned
  05 not-planned
  06 not-planned
  07 not-planned
  08 not-planned
  ```

## Recorded facts

| Fact | Value |
|------|-------|
| Package version | `@hkp/counterpoint` 0.1.0 (`private: true`, not published) |
| Install path | `/Volumes/Dock/Dev/nvm/versions/node/v24.21.0/bin/counterpoint` (global install from the tarball, `--ignore-scripts`) |
| Counterpoint home | `/Volumes/Dock/Dev/Library/Application Support/Counterpoint` (mode 700) |
| Cena `master` after Task 2 | `71275e8` ("docs(02): create phase plan"), as recorded by the orchestrator |
| Cena checkout | on `master`, `.planning` clean (orchestrator's read-only check after Task 2) |

## Task Commits

1. **Task 1: Bundle, pack and install @hkp/counterpoint; set COUNTERPOINT_HOME.** Commit `f9267b1` (feat), merged to main as `ad5792e`. The owner ran the global install and the `~/.zshrc` edit.
2. **Task 2: Owner creates the approval key and plans Cena Phase 2 on master.** Owner checkpoint, no commit in this repo. The owner replied "done" and the orchestrator verified it read-only.
3. **Task 3: Read-only readiness check of Cena Phase 02.** Commit `9abe18c` (feat).

**Plan metadata:** this SUMMARY's docs commit. `actuals.commits` counts only `ad5792e..HEAD` (this continuation); Task 1's `f9267b1` was committed by the earlier executor and is already on main.

## Files Created/Modified

- `tsdown.config.ts`: bundles `src/cli/main.ts` (with the hidden `__daemon` re-entry) to `dist/cli.mjs` with a node shebang. `clean: false`, and nothing from node_modules is bundled.
- `package.json`: adds the `clean`, `build:node`, `build` (lint first) and `pack:local` scripts. `bin.counterpoint = dist/cli.mjs`, `files: ["dist"]`, `private: true`.
- `scripts/host-phases.ts`: `node scripts/host-phases.ts {repoRoot} {baseBranch}`.
  - Resolves `refs/heads/{baseBranch}` and picks the adapter with `detectFramework` and `adapterFor`.
  - Prints `{id} {status}` from `derivePhaseStatus`, only for ids that pass `PHASE_ID_RE`.
  - Uses git reads only, through the clean-env runner. No store, daemon, home or sign-in.

## Decisions Made

- The global tarball install was enough; the `npm link` fallback was not used.
- The readiness script reads no approvals, so it applies no on-runway or changed overlay. Before the owner signs, that is exactly the status the console shows.

## Deviations from Plan

None in code. Formatting: Biome wanted one long `fail(...)` call wrapped; it was fixed before the commit.

## Findings for the owner

1. **Cena's Phase 2 is "Owner UI on Astryx", not the QR-menu "A Live Menu Diners Can Read" the plan assumed.** The readiness check only needs Phase 02 to derive as ready, and it does. The demo below uses the real name.
2. **Cena now has phases 01 to 08, not 01 to 07.** Demo step 4 should show 03 to 08 as Not planned.
3. **Your Cena checkout is now on `master`, the base branch the approval commits to.** The plan expected you to be on `ccr-61ff69b1-hgtpdm`. `counterpoint approve` handles this (src/core/approvals/commit.ts):
   - It moves `master` by compare-and-swap.
   - It places only `.counterpoint/approvals/phase-02.json` into your checkout's index and working tree.
   - It refuses before signing if that path is already taken in your checkout.

   So after you sign, `git status` in Cena should still show only your own changes, and the approval file will be on disk in your checkout. The plan's phrase "the owner's checkout (on another branch) is untouched" does not apply as written.
4. **I could not re-check that Cena's refs are unchanged.** The worktree guard refused both commands that point git at Cena. Its exact words: "This agent is isolated in the worktree /Volumes/Dock/Projects/HKP/Counterpoint/.claude/worktrees/agent-a767817fb819ec75f, but this command points git at a directory computed at runtime (-C /Volumes/Dock/Projects/HKP/Cena), which can't be verified before it runs. Refusing to run it — a worktree-isolated agent's git operations must target its own worktree."
   - I did not work around it.
   - The readiness script ran only `rev-parse`, `ls-tree` and `cat-file`, with `GIT_OPTIONAL_LOCKS=0`.
   - Still to run outside this worktree:
     - `git -C /Volumes/Dock/Projects/HKP/Cena rev-parse --short master` should print `71275e8`.
     - `git -C /Volumes/Dock/Projects/HKP/Cena status --porcelain --untracked-files=no -- .counterpoint` should print nothing.

## Issues Encountered

- The worktree guard refused `git -C <Cena>` (see finding 4). It also refused one compound shell command that mixed git with other steps; that one was split into plain commands.

## User Setup Required

Done by the owner: the approval key, `trust-key`, and Cena Phase 2 planned on master.

## Pending owner demo (end of phase, success criteria 1-5)

Run every step in your own terminal. The executor ran none of these (T-01-60).

1. **Start and sign in.** In a new terminal, `cd /Volumes/Dock/Projects/HKP/Cena` and run `npx @hkp/counterpoint`.
   - It registers `cena` (base `master`), prints the console URL and a one-time sign-in link, and opens it.
   - Mission shows Cena with runway 0.
   - `counterpoint status` prints `cena  running on 127.0.0.1:4170`.
   - Switch Light, Dark and System and reload each time; the choice should stick.
2. **Integrity baseline.** Run `counterpoint trust cena` and review the printed git settings, hooks and info files. Answer `y` if you accept them.
   - Expected as of 2026-11-09: the settings `user.signingkey` and `remote.origin.url`, no `gpg.format`, no hooks except `.sample` files, and one info file, `exclude`.
   - Anything else listed has changed since then. Look at it before you accept.
3. **Accepted risk, then doctor.** Run `counterpoint accept-risk gh-keychain`, read what it covers, type your one-line reason and answer `y`. Then run `counterpoint doctor cena`. Expect:
   - PASS for claude, git and gh.
   - PASS for every Signing key row. The Keychain row rests on assumption A4; tell us if it looks wrong.
   - PASS for `Agent permission mode`: the probe session ran in auto mode.
   - PASS for `Sandbox isolation settings`.
     - This is the first time doctor reads your real `~/.claude/settings.json` and any managed settings.
     - If it fails, the line names the file and the key. Remove that key and run doctor again; Counterpoint does not edit your settings.
     - While it fails, measured rows read NOT CHECKED, never BLOCKED.
   - BLOCKED for all nine probe targets, including `Files outside the working folder` and `Credentials in the shell environment`.
     - If the credentials row reads REACHABLE, stop and tell us. Its evidence names the variable, never the value.
     - The one allowed exception is gh credentials, REACHABLE only through the Keychain sub-step (a temporary canary item, A5). It is followed by `Accepted risk gh-keychain, recorded {date}: {your reason}`.
   - The verdict reads `Agents are boxed in` (or `..., with one accepted risk: gh credentials in your Keychain are reachable.`), and doctor exits 0.
   - The Trust page matches: `Agents are boxed in`, or `..., with one accepted risk` with the `Accepted risk` Badge on the gh row.
   - Two gaps doctor does not report:
     - `sandbox.filesystem.allowWrite` and `allowRead` entries in your settings merge into the agent lists.
     - A secret with a harmless-looking variable name and a plain-looking value is not detected.
4. **Phases list.** It should show 01 and 01.1 Built, **02 "Owner UI on Astryx" Ready to approve**, and **03 to 08** Not planned. Phase 02's detail page shows its prerequisites, its 13 plans and the input digests.
5. **Sign Phase 02.** Click `Approve phase`, then `Copy command`, run it and type your passphrase.
   - The terminal prints `Signed and verified. Runway is now 1. Not pushed: push master when you're ready.`
   - The dialog flips to `Signed. Runway is now 1.` and Mission shows 1.
   - `git -C /Volumes/Dock/Projects/HKP/Cena log -1 --stat master` shows one signed commit that adds only `.counterpoint/approvals/phase-02.json`.
   - Because your checkout is on master, that file also appears in your working tree, and `git status` should show only your own changes.
   - Nothing is pushed.
6. **Drift.** Commit a small edit to Cena's `02-CONTEXT.md` on master.
   - Within seconds Phase 02 leaves the runway.
   - Needs You shows `Approved version changed` / `Phase 02 changed since you signed it`, with the diff.
   - Re-sign with the shown command (or revert the edit) and watch it resolve.
7. **Guard spot-checks.** Both commands should print 403:
   - `curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example:4170' http://127.0.0.1:4170/api/hosts`
   - `curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' http://127.0.0.1:4170/api/hosts/cena/phases/02/approval`
8. **Backstop screenshots.** Review the screenshots in `.tmp/backstop/` (from 01-15).

## Gate results (this continuation, worktree at 9abe18c)

- `node scripts/host-phases.ts /Volumes/Dock/Projects/HKP/Cena master | grep -qx '02 ready'`: exit 0
- `grep -nE 'openStore|controlRequest|mintLoginCode' scripts/host-phases.ts`: no output
- `pnpm typecheck`: exit 0
- `pnpm lint` (`biome ci .`, 139 files): exit 0
- `pnpm test`: 33 files passed, 4 skipped; 1093 tests passed, 5 skipped
- Cena unchanged (`rev-parse master` = 71275e8, `.counterpoint` status empty): **not run by the executor** (worktree guard refusal, finding 4)

## Next Phase Readiness

Phase 1's code is complete. Phase 1 is signed off when the owner finishes the demo above on Cena.

## Self-Check: PASSED

Files present: tsdown.config.ts, package.json, scripts/host-phases.ts, this SUMMARY. Commits on HEAD: f9267b1, 9abe18c.

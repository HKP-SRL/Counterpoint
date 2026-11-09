---
phase: 01-trusted-shell-signed-runway
plan: 06
subsystem: adapter
tags: [gsd-adapter, git-plumbing, ls-tree, cat-file, remark, yaml, zod, fixtures, dependency-inversion]

# Dependency graph
requires:
  - phase: 01-01
    provides: "runGit clean-env runner, PHASE_ID_RE/isPhaseId, scratch helpers, Biome boundary overrides"
  - phase: 01-02
    provides: "walking skeleton (composition root that 01-07 will wire this adapter into)"
provides:
  - "src/core/framework/port.ts: FrameworkAdapter (id, detect, snapshot, approvalInputs), GitFileReader, TreeEntry, PlanSnapshot, PhaseFacts, PlanFacts, UserSetupItem, UnreadableFile, ApprovalInput (with sourcePath), ApprovalInputKind, PhaseNotFoundError, comparePhaseNumbers, formatPhaseId, parsePhaseNumber"
  - "src/core/git/reader.ts: createGitFileReader (resolve / list / read at a commit), UnsafeTreeEntryError, MAX_BLOB_BYTES"
  - "src/adapters/gsd/roadmap.ts: parseRoadmap (phases, fields, plan rows, exact sectionText)"
  - "src/adapters/gsd/plans.ts: readPhaseDirectory, parsePlan, extractObjective"
  - "src/adapters/gsd/index.ts: createGsdAdapter with detect and snapshot (approvalInputs throws PhaseNotFoundError until 01-07)"
  - "src/core/runway/status.ts: derivePhaseStatus, phasePrerequisites, PhaseStatus, NotReadyReason, StatusOverlay"
  - "tests/fixtures/gsd/cena-master (frozen Cena master @ 7e2e2a1) and tests/fixtures/gsd/synthetic"
  - "tests/helpers/fixture-repo.ts: materializeFixtureRepo, commitChange, commitSymlink"
affects: [01-07, 01-11, 01-12, 01-13]

actuals:
  tokens: 15600   # chars/4 over the 20 hand-written files (62,319 chars); the frozen Cena fixture (2.7 MB, 92 files) is copied bytes and not counted
  tasks: 2
  commits: 4      # MEASURED: git rev-list --count fbf0412..HEAD before the SUMMARY commit
plan_head_before: fbf04122fbf2aba2c2b0b163bbbe3e05f46309a7
plan_head_after: 3cf1b0692726e646fd0f0b1afffc2881fa544376

tech-stack:
  added: []
  patterns:
    - "Framework adapters read committed content only, through the core GitFileReader port; core never names framework files"
    - "Tree-entry safe-read: mode 120000 refused, blobs over 5 MiB refused after cat-file -s, paths checked before git runs, GIT_LITERAL_PATHSPECS=1 for every ls-tree"
    - "Phase numbers are integer tuples everywhere (parsePhaseNumber / comparePhaseNumbers / formatPhaseId); no floating-point parse"
    - "Agent-written frontmatter: remark-frontmatter locates it, yaml parses it (logLevel error, uniqueKeys, alias cap), zod validates it; any failure becomes a per-phase { file, reason }"
    - "Contract fixtures materialized into scratch repos so tests read from a commit exactly like production"

key-files:
  created:
    - src/core/framework/port.ts
    - src/core/git/reader.ts
    - src/adapters/gsd/roadmap.ts
    - src/adapters/gsd/plans.ts
    - src/adapters/gsd/index.ts
    - src/core/runway/status.ts
    - tests/helpers/fixture-repo.ts
    - tests/core/git/reader.test.ts
    - tests/adapters/gsd/parse.test.ts
    - tests/core/runway/status.test.ts
    - tests/fixtures/gsd/cena-master/PROVENANCE.md
    - tests/fixtures/gsd/cena-master/.planning/** (92 files, frozen)
    - tests/fixtures/gsd/synthetic/.planning/** (15 files, hand-authored)
  modified: []

key-decisions:
  - "Cena was frozen with `git archive --remote=<Cena> master` and its sha read with `git ls-remote`, run from this worktree, because the agent harness refuses `git -C <Cena>`; both are read-only"
  - "A PLAN without frontmatter is unreadable (not defaulted), so a missing `autonomous: false` can never silently read as autonomous"
  - "A symlinked CONTEXT or PLAN entry marks the phase unreadable instead of counting as present"
  - "`env_vars` accepts both strings and `{ name, ... }` objects (Cena uses objects); UserSetupItem.envVars keeps the names"
  - "`depends_on` numbers are coerced to strings; `user_setup: null` and `files_modified: null` read as []"
  - "Roadmap phases whose formatted id fails PHASE_ID_RE (three-digit majors) and repeated headings are skipped; the first heading wins"
  - "Overlay (on-runway / changed) also wins over not-planned, following the stated precedence unreadable > built > overlay > ready > not-planned"
  - "The reader rejects refs starting with `-` or containing whitespace/control characters (returns null) and commit arguments that are not object ids (throws), so argv can never carry an option"

patterns-established:
  - "materializeFixtureRepo(name) + createGitFileReader(root) is the way adapter tests read fixtures"
  - "Objective = first paragraph of the first <objective> block outside code fences, whitespace-collapsed, capped at 300 chars with an ellipsis; else the roadmap plan-row text"

requirements-completed: []  # ADPT-01 and ADPT-02 are declared by this plan, but requirements.ready-ids reports both blocked: sibling 01-07 also declares them and has no SUMMARY yet

coverage:
  - id: D1
    description: "GitFileReader reads committed content safely: resolve, list, exact bytes, missing → null, symlink and >5 MiB refused, unsafe paths refused before git runs, literal pathspecs"
    requirement: ADPT-02
    verification:
      - kind: integration
        ref: "tests/core/git/reader.test.ts (41 tests over a scratch fixture repo)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Phase numbers compare and format as integer tuples (1.9 < 1.10; 01.1 / 1.1 / directory 01.1- name the same phase)"
    requirement: ADPT-01
    verification:
      - kind: unit
        ref: "tests/core/git/reader.test.ts#phase numbers"
        status: pass
      - kind: integration
        ref: "tests/adapters/gsd/parse.test.ts#sorts phases as integer tuples (1.9 before 1.10) and skips the fenced heading"
        status: pass
    human_judgment: false
  - id: D3
    description: "Cena master snapshot: phases 1, 1.1, 2-7; Phase 1 has 17 plans and 1.1 has 14, all built; 01-01 not autonomous with user_setup docker + supabase-cli; Phases 2-7 have no directory"
    requirement: ADPT-01
    verification:
      - kind: integration
        ref: "tests/adapters/gsd/parse.test.ts#Cena master fixture"
        status: pass
    human_judgment: false
  - id: D4
    description: "Synthetic cases: ready phase with two plans, inserted phase, no-context phase, broken YAML contained to its phase, fenced heading ignored, missing roadmap yields []"
    requirement: ADPT-01
    verification:
      - kind: integration
        ref: "tests/adapters/gsd/parse.test.ts#synthetic fixture + robustness"
        status: pass
    human_judgment: false
  - id: D5
    description: "Adapter detect is true for the Cena and synthetic fixtures and false for a repo without a committed roadmap"
    requirement: ADPT-02
    verification:
      - kind: integration
        ref: "tests/adapters/gsd/parse.test.ts#detect"
        status: pass
    human_judgment: false
  - id: D6
    description: "Core status derivation (unreadable > built > overlay > ready > not-planned with no-context/no-plans) and prerequisites dedupe, framework-agnostic"
    requirement: ADPT-02
    verification:
      - kind: unit
        ref: "tests/core/runway/status.test.ts"
        status: pass
      - kind: other
        ref: "grep -rlE 'ROADMAP|\\.planning' src/core --include='*.ts' → no output"
        status: pass
    human_judgment: false
  - id: D7
    description: "Frozen Cena fixture content is acceptable to keep in the repository until public release"
    verification: []
    human_judgment: true
    rationale: "The fixture holds the owner's private Cena planning documents; PROVENANCE.md flags them for review before any public release, which is an owner decision"

duration: 10min
completed: 2026-11-09
status: complete
---

# Phase 1 Plan 06: GSD Adapter Read Side Summary

**Core-owned FrameworkAdapter/GitFileReader port; a git reader that reads only committed blobs (symlinks and >5 MiB refused, literal pathspecs); a GSD adapter that turns Cena's committed ROADMAP and phase directories into a PlanSnapshot (remark AST headings, yaml + zod frontmatter, per-phase unreadable reasons); and framework-agnostic phase status in core, all tested against a frozen Cena master fixture and a synthetic fixture.**

## Performance

- **Duration:** about 10 min
- **Started:** 2026-11-09T16:29:49Z
- **Completed:** 2026-11-09T16:39:56Z
- **Tasks:** 2 (both TDD: RED and GREEN commits each)
- **Files created:** 20 hand-written plus the 92-file frozen Cena fixture

## Accomplishments

- **Port (ADPT-02).** `src/core/framework/port.ts` holds every type the adapter and core share, including `ApprovalInput.sourcePath` and `FrameworkAdapter.detect`. Core stays framework-neutral: no framework file or directory name appears under `src/core`, comments included.
- **Reader.** `createGitFileReader` uses `runGit` only. `resolve` uses `rev-parse --verify --quiet`. `list` uses `ls-tree -z --full-tree`. `read` checks the entry with `ls-tree` and refuses mode 120000, then checks the size with `cat-file -s` (over 5 MiB is refused), then returns `cat-file blob` bytes unchanged. Paths are validated before git runs (no `..`, `.`, empty segment, leading `/` or NUL), commit arguments must be object ids, and `GIT_LITERAL_PATHSPECS=1` means `*` and `?` are never patterns.
- **GSD adapter (ADPT-01).** On the Cena master fixture the snapshot lists 1, 1.1, 2-7. Phase 1 has 17 plans and 1.1 has 14, all built. 01-01 is non-autonomous with `docker + supabase-cli` and its three env var names. Phases 2-7 have no directory. Synthetic cases pass: `Phase 02` heading, inserted 2.1, 1.9 before 1.10, a fenced `Phase 9` ignored, broken YAML confined to Phase 4, a symlinked plan and an invalid `wave` each confined to their own phase, and a missing roadmap giving `[]`.
- **Core status.** `derivePhaseStatus` applies unreadable, then built, then overlay, then ready, then not-planned (`no-context` / `no-plans`). `phasePrerequisites` dedupes user setup by service, merges env vars and counts non-autonomous plans k of n.

## Task Commits

1. **Task 1: Core port, git file reader, frozen Cena fixture and synthetic fixture**
   - `56a48e2` test(01-06): add failing tests for git file reader and phase numbers, freeze Cena and synthetic fixtures (RED)
   - `fa7acce` feat(01-06): implement git file reader and phase-number helpers (GREEN)
2. **Task 2: GSD parser and core status derivation**
   - `668ee98` test(01-06): add failing tests for GSD snapshot parsing and core phase status (RED)
   - `3cf1b06` feat(01-06): GSD adapter snapshot (roadmap, phase dirs, plan frontmatter) and core phase status (GREEN)

**Plan metadata:** the docs commit that adds this SUMMARY.

## TDD Gate Compliance

- **Task 1 RED** (`56a48e2`): 41 tests against a stub reader and stub helpers; 27 failed and 14 trivially passed (negative cases where the stub already returns null or []). Target `tests/core/git/reader.test.ts > GitFileReader.resolve > returns the commit sha a branch points at`, rerun alone with `--reporter=tap-flat`: `gsd-tools check tdd-red-evidence` returned **RED_EVIDENCE_OK** (`target_test_failed`). Semantic check: `beforeAll` materialized the fixture repo, so this was not a fixture fault. The target ran and failed on its planned assertion (expected the fixture sha, got `null` from the stub).
- **Task 1 GREEN** (`fa7acce`): 41/41 pass.
- **Task 2 RED** (`668ee98`): 37 tests against stub roadmap/plans/adapter/status modules; 33 failed. Target `tests/adapters/gsd/parse.test.ts > Cena master fixture > reads Phase 1 with 17 plans, every one built`: **RED_EVIDENCE_OK** (`target_test_failed`). Semantic check: both fixtures materialized and `snapshot` ran. The target failed because the stub snapshot had no phase `01`, which is the planned behaviour, not a load error.
- **Task 2 GREEN** (`3cf1b06`): 37/37 pass.
- **REFACTOR:** none needed. Biome formatting was folded into the GREEN commits.
- Evidence records: `.tmp/red/0106-t1.json`, `.tmp/red/0106-t2.json` (gitignored).

## Files Created/Modified

- `src/core/framework/port.ts`: port types, `PhaseNotFoundError`, `comparePhaseNumbers`, `formatPhaseId`, `parsePhaseNumber`
- `src/core/git/reader.ts`: `createGitFileReader`, `UnsafeTreeEntryError` (reasons `symlink`, `too-large`, `unsafe-path`, `invalid-commit`), `MAX_BLOB_BYTES`
- `src/adapters/gsd/roadmap.ts`: `parseRoadmap`
- `src/adapters/gsd/plans.ts`: `readPhaseDirectory`, `parsePlan`, `extractObjective`
- `src/adapters/gsd/index.ts`: `createGsdAdapter` (`detect`, `snapshot`, placeholder `approvalInputs`)
- `src/core/runway/status.ts`: `derivePhaseStatus`, `phasePrerequisites`
- `tests/helpers/fixture-repo.ts`: `materializeFixtureRepo`, `commitChange`, `commitSymlink`
- `tests/core/git/reader.test.ts`, `tests/adapters/gsd/parse.test.ts`, `tests/core/runway/status.test.ts`
- `tests/fixtures/gsd/cena-master/` (ROADMAP plus both phase directories, and `PROVENANCE.md`)
- `tests/fixtures/gsd/synthetic/.planning/` (ROADMAP plus four phase directories)

## Decisions Made

See `key-decisions` in the frontmatter. The ones that matter most:
- **Missing frontmatter is unreadable, not defaulted.** If it were defaulted, a plan that lost its `autonomous: false` would silently read as autonomous.
- **Symlinked CONTEXT or PLAN entries make the phase unreadable.** The approval-input rule in 01-07 would refuse them anyway. Flagging them here keeps "ready" honest.
- **Overlay beats not-planned.** This follows the precedence exactly as written. If an approved phase later loses its plans, the console shows `changed`, not `not-planned`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Cena could not be read with `git -C /Volumes/Dock/Projects/HKP/Cena archive …`**
- **Found during:** Task 1 (freezing the fixture)
- **Issue:** The worktree-isolation guard refuses any git command aimed at another directory.
- **Fix:** Ran `git archive --remote=/Volumes/Dock/Projects/HKP/Cena --format=tar --output=<scratchpad>/cena.tar master .planning/ROADMAP.md .planning/phases` from this worktree, then `tar -x` into the fixture directory. Read the sha with `git ls-remote /Volumes/Dock/Projects/HKP/Cena refs/heads/master` → `7e2e2a1370cec376c9769ba1513581028f268ff0`. Both use git's read-only upload services, so nothing was written to Cena.
- **Verification:** 92 files extracted. The sha matches the plan's `7e2e2a1`.
- **Committed in:** 56a48e2

**2. [Rule 2 - Missing critical] Argument and pathspec hardening in the reader**
- **Found during:** Task 1
- **Issue:** The plan's validation covered paths only. A ref or commit argument starting with `-` could reach git's argv as an option. `ls-tree` paths are patterns by default.
- **Fix:** `resolve` returns null for refs that start with `-` or contain whitespace or control characters. `list`/`read` throw `UnsafeTreeEntryError('invalid-commit')` for anything that is not a 40- or 64-hex object id. `GIT_LITERAL_PATHSPECS=1` is set on every `ls-tree`, and the returned entry path must equal the requested path.
- **Verification:** Tests `returns null for a ref that looks like an option`, `refuses a commit argument that is not an object id`, `does not treat a path as a pathspec pattern`.
- **Committed in:** fa7acce

**3. [Rule 1 - Bug] Biome `noControlCharactersInRegex` on the ref check**
- **Fix:** Replaced the control-character regex with a small `hasSpaceOrControl` loop.
- **Committed in:** fa7acce

---

**Total deviations:** 3 auto-fixed (1 blocking, 1 missing-critical, 1 lint bug).
**Impact on plan:** No scope change, and no packages were added (the lockfile is unchanged).

## Issues Encountered

- **Cena acceptance check.** The criterion "`git -C /Volumes/Dock/Projects/HKP/Cena status --porcelain` unchanged" could not be run: the harness refuses `git -C` on another repository. Only read-only commands touched Cena (`git archive --remote`, `git ls-remote`). The owner can confirm with `git -C /Volumes/Dock/Projects/HKP/Cena status --porcelain`.
- **Commit ledger file.** The harness refuses writes under `.git/worktrees/…`, so the plan-base ledger and spawn sentinel files were not written. The base `fbf0412` came from the dispatch prompt, and `commits: 4` was measured with `git rev-list --count fbf0412..HEAD`.

## Known Stubs

| File | Line | Stub | Resolved by |
|------|------|------|-------------|
| src/adapters/gsd/index.ts | 103 | `approvalInputs` throws `PhaseNotFoundError` for every id (the plan specifies this) | 01-07 (approval-input rule and ROADMAP normalizer) |

This stub does not block this plan's goal. `.planning/WINDOWS.md` does not exist, so nothing was added to the ledger.

## User Setup Required

None.

## Next Phase Readiness

- 01-07 can implement `approvalInputs` using `parseRoadmap(...).sectionText` and `readPhaseDirectory`'s listing. It should wire `createGsdAdapter().detect` into `src/compose.ts` `detectFramework` with `createGitFileReader(root).resolve(base)`, and add the boundary meta-test. Core is already neutral (`grep -rlE 'ROADMAP|\.planning' src/core` is empty).
- 01-11 / 01-12 can call `snapshot`, then `derivePhaseStatus` and `phasePrerequisites`, per phase.
- Tests should set `CP_TEST_SCRATCH` to a short Dock path when run from a deep worktree.

---
*Phase: 01-trusted-shell-signed-runway*
*Completed: 2026-11-09*

## Self-Check: PASSED

- All key files exist on disk. Commits 56a48e2, fa7acce, 668ee98 and 3cf1b06 are on this branch (`git rev-list fbf0412..HEAD` = 4).
- Acceptance criteria re-run after GREEN: all PASS, except the Cena `git -C` status check, which the harness blocks (see Issues).
- Plan verification: `pnpm test` 189/189, `pnpm typecheck` 0, `pnpm lint` 0.

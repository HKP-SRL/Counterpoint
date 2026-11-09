---
phase: 01-trusted-shell-signed-runway
plan: 07
subsystem: adapter
tags: [gsd-adapter, approval-inputs, normalizer, composition-root, biome, boundary-lint]

# Dependency graph
requires:
  - phase: 01-06
    provides: "FrameworkAdapter port with ApprovalInput.sourcePath, createGitFileReader + UnsafeTreeEntryError, createGsdAdapter (detect, snapshot), parseRoadmap sectionText, materializeFixtureRepo/commitChange/commitSymlink"
  - phase: 01-02
    provides: "src/compose.ts detectFramework(root, baseBranch) already wired into registerHost"
  - phase: 01-01
    provides: "assertPhaseId, both Biome noRestrictedImports overrides in biome.json"
provides:
  - "src/adapters/gsd/normalize.ts: ROADMAP_SECTION_NORMALIZER = 'cp-gsd-roadmap-section/v1', normalizeRoadmapSection"
  - "src/adapters/gsd/inputs.ts: approvalInputs (the D-02 rule), wired into createGsdAdapter().approvalInputs"
  - "src/adapters/gsd/layout.ts: ROADMAP_PATH / PHASES_DIR / listPhaseDirs, shared by snapshot and inputs"
  - "src/compose.ts: FRAMEWORK_ADAPTERS, adapterFor, detectFramework (real detection), NO_FRAMEWORK"
  - "tests/boundary/boundary.test.ts: boundary meta-test (Biome import rules + no framework path literals in src/core)"
affects: [01-11, 01-12, 01-13, 01-14]

actuals:
  tokens: 8600    # chars/4 over the added lines of the realized diff (34,226 chars)
  tasks: 2
  commits: 4      # MEASURED: git rev-list --count 2ef6dac..HEAD before the SUMMARY commit
plan_head_before: 2ef6dac0da7d2eace1c7fcec4f3f64544b0ebe83
plan_head_after: 3844b01f2d229a50e86291e1b887c005bc82d848

tech-stack:
  added: []
  patterns:
    - "Derived approval inputs carry a versioned normalizer id; any rule change means a new id (v2), never an edit to v1"
    - "Approval inputs refuse unsafe entries (symlink, >5 MiB) by throwing, never by skipping, so an approval cannot cover less than it claims"
    - "Composition root picks adapters by id (adapterFor) and detects by asking each adapter's detect at the committed base tip"
    - "Boundary rules are proven by a meta-test that lints a scratch project with the repo's real biome.json and Biome binary"

key-files:
  created:
    - src/adapters/gsd/normalize.ts
    - src/adapters/gsd/inputs.ts
    - src/adapters/gsd/layout.ts
    - tests/adapters/gsd/inputs.test.ts
    - tests/compose.test.ts
    - tests/boundary/boundary.test.ts
  modified:
    - src/adapters/gsd/index.ts
    - src/compose.ts
    - tests/adapters/gsd/parse.test.ts
    - .planning/REQUIREMENTS.md

key-decisions:
  - "The ROADMAP section input is listed first after sorting: '.planning/ROADMAP.md#phase-NN' sorts before '.planning/phases/...' by bytes ('R' 0x52 < 'p' 0x70); the order is by path bytes exactly as specified"
  - "A roadmap phase with no directory yet has exactly one input, its ROADMAP section"
  - "Only blob entries of the phase directory are candidates; symlinks are blobs with mode 120000 and are refused by reader.read (UnsafeTreeEntryError), sub-directories are never descended"
  - "A missing ROADMAP at the commit raises PhaseNotFoundError; an undecodable ROADMAP propagates the decode error (approval must not proceed on unreadable truth)"
  - "detectFramework does not swallow git errors: registerHost has already checked that the base branch exists, so an unexpected failure surfaces instead of registering a GSD host as `none`"
  - "Roadmap/phase-directory locations moved to a small layout.ts so snapshot and inputs find phases identically (inputs.ts could not import them from index.ts without a cycle)"

patterns-established:
  - "approvalInputs(reader, commit, phaseId) is the only way core learns which files an approval covers; core maps each input to a real file through sourcePath"
  - "Boundary meta-test pattern: copy biome.json + .gitignore into a scratch project, plant violators, run node_modules/.bin/biome lint with --config-path, parse `path:line:col lint/... ` + `× message`"

requirements-completed: [ADPT-02]  # ADPT-01 is also declared by 01-11, which has no SUMMARY yet; requirements.ready-ids reports it blocked, so only ADPT-02 was marked

coverage:
  - id: D1
    description: "D-02 approval inputs: CONTEXT, every PLAN, RESEARCH / UI-SPEC / SPEC / AI-SPEC from the phase directory listing plus the normalized ROADMAP section; never SUMMARY, VERIFICATION, UAT, DISCUSSION-LOG, PATTERNS, VALIDATION, COVERAGE, PERMISSION-MATRIX; sorted by path bytes; sourcePath on every input"
    requirement: ADPT-01
    verification:
      - kind: integration
        ref: "tests/adapters/gsd/inputs.test.ts#approval inputs (D-02) on the synthetic fixture"
        status: pass
      - kind: integration
        ref: "tests/adapters/gsd/inputs.test.ts#approval inputs (D-02) on the Cena master fixture"
        status: pass
    human_judgment: false
  - id: D2
    description: "Unsafe inputs refused: symlinked PLAN and a >5 MiB blob raise UnsafeTreeEntryError; unknown phase raises PhaseNotFoundError; malformed id raises InvalidIdError"
    requirement: ADPT-01
    verification:
      - kind: integration
        ref: "tests/adapters/gsd/inputs.test.ts#approval inputs refuse unsafe tree entries"
        status: pass
    human_judgment: false
  - id: D3
    description: "Normalizer cp-gsd-roadmap-section/v1: checkbox ticks, Plans line (both spellings), CRLF/CR and trailing whitespace are neutral; Goal, Depends on, Requirements and Success Criteria edits change the bytes; also end-to-end through approvalInputs on a committed roadmap edit"
    requirement: ADPT-01
    verification:
      - kind: unit
        ref: "tests/adapters/gsd/inputs.test.ts#normalizeRoadmapSection (cp-gsd-roadmap-section/v1)"
        status: pass
      - kind: integration
        ref: "tests/adapters/gsd/inputs.test.ts#ROADMAP section through approvalInputs is digest-stable under bookkeeping"
        status: pass
    human_judgment: false
  - id: D4
    description: "Composition root: adapterFor selects the GSD adapter by id (null for none); detectFramework returns gsd for a committed roadmap at the base tip, none without one, none for an unresolved base, and ignores other-branch or uncommitted roadmaps"
    requirement: ADPT-02
    verification:
      - kind: integration
        ref: "tests/compose.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "Boundary meta-test: all five core->adapters import forms and a non-compose importer are reported by the real biome.json with the right messages and a non-zero exit; the allowed tree lints clean; no framework path literal in src/core, and the scan names file and line when one is planted"
    requirement: ADPT-02
    verification:
      - kind: integration
        ref: "tests/boundary/boundary.test.ts"
        status: pass
      - kind: other
        ref: "grep -rlE 'ROADMAP|\\.planning' src/core --include='*.ts' -> no output; grep -rln 'adapters/gsd' src --include='*.ts' -> src/compose.ts only"
        status: pass
    human_judgment: false

duration: 16min
completed: 2026-11-09
status: complete
---

# Phase 1 Plan 07: Approval Inputs, ROADMAP Normalizer and Composition Root Summary

**The GSD adapter now answers "what does approving phase NN cover": the D-02 file set read as exact committed bytes, plus the phase's ROADMAP section normalized by the owner-locked `cp-gsd-roadmap-section/v1`, each input naming its source file. `src/compose.ts` composes the adapter, selects it per host and detects GSD hosts at the base tip. A meta-test proves the Biome boundary rules and keeps framework path literals out of core.**

## Performance

- **Duration:** about 16 min
- **Started:** about 2026-11-09T16:45Z
- **Completed:** 2026-11-09T17:01Z
- **Tasks:** 2 (both TDD, with RED and GREEN commits)
- **Files:** 6 created, 4 modified (including REQUIREMENTS.md)

## Accomplishments

- **Normalizer.** `normalizeRoadmapSection` applies exactly the five owner-specified rules: LF endings, trailing whitespace stripped, plan-row boxes reset to `- [ ]`, the `**Plans**:` / `**Plans:**` line dropped, blank lines trimmed at both ends with a single closing LF. Goal, Depends on, Requirements and Success Criteria edits still change the output. The header comment records that a rule change requires a new id.
- **Approval inputs (D-02).** For synthetic phase 02 the inputs are, in byte order: `.planning/ROADMAP.md#phase-02`, `02-01-PLAN.md`, `02-02-PLAN.md`, `02-CONTEXT.md`, `02-RESEARCH.md`, `02-UI-SPEC.md`. DISCUSSION-LOG, PATTERNS and PERMISSION-MATRIX are excluded. For Cena phase 01 the inputs are the section, the 17 PLANs, CONTEXT, RESEARCH and UI-SPEC. The 30 other files (SUMMARY, VALIDATION, PATTERNS, COVERAGE, PERMISSION-MATRIX, VERIFICATION, UAT, …) are excluded. File inputs have `sourcePath === path`. The section's `sourcePath` is `.planning/ROADMAP.md`, its label is `ROADMAP.md · Phase 02 section` and its normalization id is `cp-gsd-roadmap-section/v1`.
- **Refusals.** A symlinked PLAN or a blob over 5 MiB throws `UnsafeTreeEntryError`, an unknown phase throws `PhaseNotFoundError`, and a malformed id throws `InvalidIdError` before anything is read.
- **Composition root.** `FRAMEWORK_ADAPTERS = [createGsdAdapter()]`. `adapterFor({ adapter })` selects by id and returns null for `none`. `detectFramework` keeps the 01-02 signature, so `registerHost` is unchanged. It now resolves `refs/heads/{base}` and asks each adapter's `detect` at that committed tip.
- **Boundary meta-test (ADPT-02, T-01-23).** The repo's own `biome.json` and Biome binary must flag all five forms: relative import, `import type`, dynamic `import()`, `export * from` and the `#adapters/gsd` alias. Each must carry `core must not import adapters`, and `src/server/x.ts` must carry `only src/compose.ts may import the GSD adapter`. Lint must exit non-zero, and it must exit 0 once the violators are removed. A second check scans `src/core/**/*.ts` for `ROADMAP` / `.planning`. It passes on the real tree and reports `file:line` for a literal planted in a scratch tree.

## Task Commits

1. **Task 1: Approval-inputs rule and the ROADMAP-section normalizer**
   - `62aaebf` test(01-07): add failing tests for D-02 approval inputs and the ROADMAP-section normalizer (RED)
   - `9379942` feat(01-07): D-02 approval inputs and the cp-gsd-roadmap-section/v1 normalizer (GREEN)
2. **Task 2: Composition root and the boundary meta-test**
   - `09847b9` test(01-07): add failing compose tests and the core/adapter boundary meta-test (RED)
   - `3844b01` feat(01-07): compose the GSD adapter; adapter selection and framework detection (GREEN)

**Plan metadata:** the docs commit that adds this SUMMARY and the REQUIREMENTS.md update.

## TDD Gate Compliance

- **Task 1 RED** (`62aaebf`): 21 tests against stub `normalize.ts` (identity) and `inputs.ts` (always `PhaseNotFoundError`); 17 failed and 4 passed trivially (the negative cases the stub already satisfies). Phase 02 inputs are computed lazily inside the tests so that a stub throw cannot abort `beforeAll`. A first attempt computed them in `beforeAll`, which skipped every test and would have been INVALID_RED. Target `tests/adapters/gsd/inputs.test.ts > approval inputs refuse unsafe tree entries > throws UnsafeTreeEntryError for a symlinked PLAN in the phase directory`, run alone with `--reporter=tap-flat`, returned **RED_EVIDENCE_OK** (`target_test_failed`). A normalizer target was tried first and its TAP was classified `invalid_record` (malformed TAP: the multi-line string diff broke the YAML block), so it was not used. Semantic check: the scratch repo and the symlink commit were created without error, and the test failed on its `toBeInstanceOf` assertion (got `PhaseNotFoundError`) because the stub never reads the directory.
- **Task 1 GREEN** (`9379942`): 45/45 adapter tests pass (inputs plus parse).
- **Task 2 RED** (`09847b9`): compose stubs (`FRAMEWORK_ADAPTERS = []`, `adapterFor` → null, `detectFramework` → `none`); 4 compose tests failed. Target `tests/compose.test.ts > detectFramework > returns gsd for a repository whose base tip has a GSD roadmap`: **RED_EVIDENCE_OK** (`target_test_failed`, `expected 'none' to be 'gsd'`). Semantic check: `beforeAll` materialized the fixture, so the target failed on its planned assertion. The boundary meta-test passed already in RED. That is expected, because it tests the 01-01 lint configuration rather than new behavior.
- **Task 2 GREEN** (`3844b01`): 11/11 pass.
- **REFACTOR:** none needed. Biome formatting was folded into each commit.
- Evidence records: `.tmp/red/0107-t1.json`, `.tmp/red/0107-t2.json` (gitignored).

## Files Created/Modified

- `src/adapters/gsd/normalize.ts`: `ROADMAP_SECTION_NORMALIZER`, `normalizeRoadmapSection`
- `src/adapters/gsd/inputs.ts`: `approvalInputs` (the D-02 rule)
- `src/adapters/gsd/layout.ts`: `PLANNING_DIR`, `ROADMAP_NAME`, `ROADMAP_PATH`, `PHASES_DIR`, `listPhaseDirs`
- `src/adapters/gsd/index.ts`: uses `layout.ts` and wires `approvalInputs` (placeholder removed)
- `src/compose.ts`: `NO_FRAMEWORK`, `FRAMEWORK_ADAPTERS`, `adapterFor`, `detectFramework`
- `tests/adapters/gsd/inputs.test.ts`: 21 tests (synthetic, Cena, refusals, bookkeeping stability, normalizer)
- `tests/compose.test.ts`: 7 tests
- `tests/boundary/boundary.test.ts`: 4 tests (import rules violated and clean; literal scan real and planted)
- `tests/adapters/gsd/parse.test.ts`: the 01-06 placeholder test asserted that `approvalInputs` always throws. It now asserts the unknown-phase case.
- `.planning/REQUIREMENTS.md`: ADPT-02 marked complete

## Decisions Made

See `key-decisions` in the frontmatter. The ones that matter most:
- **Byte order puts the ROADMAP section first.** The behavior bullet lists the section last, but it also says "sorted by path bytes", and bytewise `.planning/ROADMAP.md#…` comes before `.planning/phases/…`. The test asserts the true byte order.
- **Refuse, never skip.** A symlinked or oversized input aborts the whole input set. Silently dropping it would let an approval cover less than the phase's real inputs.
- **No error swallowing in `detectFramework`.** Only "base does not resolve" maps to `none`. Any other git failure surfaces.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Shared layout module `src/adapters/gsd/layout.ts` (not in files_modified)**
- **Found during:** Task 1
- **Issue:** `inputs.ts` needs the same ROADMAP path and phase-directory lookup as the snapshot in `index.ts`. `index.ts` imports `inputs.ts`, so importing those constants back from `index.ts` would create a cycle, and duplicating them could let the two drift apart.
- **Fix:** Moved `PLANNING_DIR`, `ROADMAP_NAME`, `ROADMAP_PATH`, `PHASES_DIR` and `listPhaseDirs` into `layout.ts`. Both `index.ts` and `inputs.ts` use it. Snapshot behavior is unchanged (parse tests pass).
- **Files modified:** src/adapters/gsd/layout.ts, src/adapters/gsd/index.ts, src/adapters/gsd/inputs.ts
- **Committed in:** 9379942

**2. [Rule 1 - Bug] Obsolete 01-06 placeholder test**
- **Found during:** Task 1 GREEN
- **Issue:** `tests/adapters/gsd/parse.test.ts` asserted that `approvalInputs('02')` throws `PhaseNotFoundError`, which was 01-06's intentional stub behavior. It fails once the rule is real.
- **Fix:** It now asserts `PhaseNotFoundError` for a phase the roadmap does not have (`09`). The full rule is covered in `inputs.test.ts`.
- **Committed in:** 9379942

**3. [Rule 3 - Blocking] The boundary meta-test copies `.gitignore` as well as `biome.json`**
- **Found during:** Task 2
- **Issue:** The real config sets `vcs.useIgnoreFile: true`. Without an ignore file, Biome refuses to run (`couldn't find an ignore file`), so the scratch lint would exit 1 for the wrong reason.
- **Fix:** The scratch project gets the repo's `.gitignore` too, and the test asserts the specific diagnostics, not just the exit code. Verified with `CP_TEST_SCRATCH` set and with the default `.tmp` scratch root.
- **Committed in:** 09847b9

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 bug).
**Impact on plan:** No scope change, no new packages, lockfile unchanged.

## Issues Encountered

- **ADPT-01 not marked complete.** `requirements.ready-ids` reports it blocked because sibling plan 01-11 also declares it and has no SUMMARY yet. It will be marked when 01-11 finishes.
- **Commit ledger file.** As in 01-06, the plan base `2ef6dac` came from the dispatch prompt. `commits: 4` was measured with `git rev-list --count 2ef6dac..HEAD`.

## Known Stubs

None. The 01-06 stub (`approvalInputs` always throwing) is resolved by this plan.

## Threat Flags

None. No new network, auth or file-access surface. Input reads go through the existing safe reader.

## User Setup Required

None.

## Next Phase Readiness

- 01-12 (approval statement) can call `adapterFor(host)?.approvalInputs(reader, tip, phaseId)` and hash `bytes`. It should record `normalization` for the section input and use `sourcePath` to map inputs to files. 01-14 (change detection) can diff normalized section text across two commits by calling `approvalInputs` at each.
- Hosts registered before this plan still have `adapter = none` until `counterpoint` next starts inside them, because registration upserts.
- Run tests with `CP_TEST_SCRATCH` set to a short Dock path from deep worktrees. The full unit suite passed: 459, with 1 skipped.

---
*Phase: 01-trusted-shell-signed-runway*
*Completed: 2026-11-09*

## Self-Check: PASSED

- All created files exist. Commits 62aaebf, 9379942, 09847b9 and 3844b01 are on this branch (`git rev-list --count 2ef6dac..HEAD` = 4).
- Acceptance criteria re-run: all PASS (normalizer id present; inputs.ts contains the doc-kind alternation, `Buffer.compare` and `sourcePath`; `adapters/gsd` imported only by src/compose.ts; no `ROADMAP` / `.planning` under src/core; both boundary messages in the meta-test).
- Plan verification: `pnpm test` 459 passed, 1 skipped; `pnpm typecheck` 0; `pnpm lint` 0.

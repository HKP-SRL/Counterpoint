---
phase: 01-trusted-shell-signed-runway
plan: 12
subsystem: approvals
tags: [approval-statement, canonical-json, sha256, zod, yaml, ssh-keygen, runway, commander, tdd]

# Dependency graph
requires:
  - phase: 01-06
    provides: "derivePhaseStatus / phasePrerequisites, FrameworkAdapter snapshot"
  - phase: 01-07
    provides: "approvalInputs (D-02 inputs + cp-gsd-roadmap-section/v1), adapterFor, createGitFileReader"
  - phase: 01-08
    provides: "signAndLand, signPayload, verifySignature, verifyApprovalCommit, readTrust, checkIntegrity, INTEGRITY_REFUSAL, sha256Digest"
  - phase: 01-10
    provides: "printable, describeChange (now exported), NO_TRUSTED_KEY_FIX, CLI exit-code pattern"
provides:
  - "src/core/approvals/canonical.ts: canonicalJson, prettyCanonicalJson, CanonicalJsonError"
  - "src/core/approvals/statement.ts: APPROVAL_SCHEMA, ApprovalStatement (strict zod), buildStatement, serializeStatement, statementFingerprint, statementFiles, combinedDigest, approvalPath, APPROVALS_DIR, GATES_ABSENT"
  - "src/core/approvals/gates.ts: COUNTERPOINT_CONFIG_PATH, gatesDigest, GatesConfigError"
  - "src/core/approvals/prepare.ts: prepareApproval, PrepareRefusal, PreparedApproval"
  - "src/core/runway/runway.ts: compareInputs, approvalState, computeRunway (on-runway / changed / invalid)"
  - "src/cli/approve.ts: approveCommand, notifyApproval"
  - "CLI: counterpoint approve <host> <phase>"
  - "Host repo format: .counterpoint/approvals/phase-{NN}.json, schema counterpoint/approval/v1"
affects: [01-13, 01-14, 01-16, phase-02-gates, phase-04-drafts]

actuals:
  tokens: 22600   # chars/4 over the realized diff: 10 new/changed files (89,343 chars) + ~1,200 chars added to main.ts, trust.ts, commit.ts
  tasks: 2        # Tasks 2 and 3 in this run; Task 1 was the owner's decision checkpoint (no commit)
  commits: 4      # MEASURED: git rev-list --count de9fe48..HEAD before the SUMMARY commit
plan_head_before: de9fe48461f59cbee59be6c5f203a0c95282edb7
plan_head_after: 36de6bf458fb650278bc0300008a8b8926ac54cf

tech-stack:
  added: []
  patterns:
    - "Approval truth is recomputed from git on every read: verify the signed commit, parse the statement strictly, recompute inputs and the gate slot at the tip, compare; no stored verdict"
    - "Canonical JSON (sorted keys by UTF-16 code unit, safe integers only) is the single source for combined digests, fingerprints and the pretty on-disk form"
    - "The signature is checked against the trusted key before anything lands; the base ref moves only by compare-and-swap from the exact tip the statement was prepared at"

key-files:
  created:
    - src/core/approvals/canonical.ts
    - src/core/approvals/statement.ts
    - src/core/approvals/gates.ts
    - src/core/approvals/prepare.ts
    - src/core/runway/runway.ts
    - src/cli/approve.ts
    - tests/core/approvals/statement.test.ts
    - tests/core/runway/runway.test.ts
    - tests/cli/approve.test.ts
  modified:
    - src/cli/main.ts
    - src/cli/trust.ts
    - src/core/approvals/commit.ts
    - .planning/REQUIREMENTS.md

key-decisions:
  - "Owner chose option item4 at the Task 1 checkpoint: RESEARCH Item 4 exactly (schema counterpoint/approval/v1, kind runway, host, item {type: phase, id}, base {branch, commit}, inputs {algorithm sha256, files [{path, kind, digest, normalization?}], combined}, draft {state none, digest null}, gates {state absent|present, digest}); file .counterpoint/approvals/phase-{NN}.json, item id phase-{NN}, pretty-printed with sorted keys; NO prepared block"
  - "Statement item.id is the phase id (02); the approval item id phase-02 names the file and is independent of the directory slug"
  - "The strict schema also checks that files are sorted by path bytes without duplicates and that combined equals the recomputed digest, so a hand-edited statement is invalid rather than misleading"
  - "Any non-null value under the gates key is digested (canonical JSON); a missing file, empty file or missing/null gates key is the absent sentinel; an unparseable config or a float refuses preparation and makes an approved item changed (gatesChange unreadable), never on-runway"
  - "approve checks the ssh-keygen signature against the trusted allowed-signers file and pinned fingerprint before landing, so a wrong-key signature writes nothing"
  - "signAndLand takes expectedTip so a base that moved between preparation and signing is refused before the passphrase prompt"
  - "approval invalid reasons add no-trusted-key, bad-statement, host-mismatch and item-mismatch to the 01-08 verifier reasons; anything unexpected is invalid (error)"
  - "Approvals of Built phases may verify but never count toward the runway"
  - "APPR-01, APPR-02 and MISN-01 are not marked complete here: requirements.ready-ids blocks them on sibling plans still in flight; APPR-04 was marked"

patterns-established:
  - "CLI commands that sign take an injectable sign seam and notify seam; tests drive them with throwaway unprotected keys trusted through the library"

requirements-completed: [APPR-04]  # plan declares APPR-01, APPR-02, APPR-04, MISN-01; the other three are blocked by sibling plans (requirements.ready-ids)

coverage:
  - id: D1
    description: "Canonical JSON with test vectors: UTF-16 key order, JSON.stringify escaping, no whitespace, floats/NaN/Infinity/unsafe ints/undefined/functions/bigints refused with the key path"
    requirement: APPR-02
    verification:
      - kind: unit
        ref: "tests/core/approvals/statement.test.ts#canonicalJson (12 cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Owner-approved item4 statement for synthetic phase 02: six inputs sorted by path bytes with sha256 digests of committed bytes, ROADMAP section with its normalizer id, combined digest, draft none, gates absent; deterministic bytes and fingerprint under shuffled inputs; strict schema rejections"
    requirement: APPR-02
    verification:
      - kind: unit
        ref: "tests/core/approvals/statement.test.ts#buildStatement (5 cases)"
        status: pass
      - kind: unit
        ref: "tests/core/approvals/statement.test.ts#ApprovalStatement schema (7 cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Gate-config digest from .counterpoint/config.yaml at the tip: absent sentinel, present digest of the gates value, non-gates edits ignored, float and invalid YAML refused"
    requirement: APPR-02
    verification:
      - kind: integration
        ref: "tests/core/approvals/statement.test.ts#gatesDigest (7 cases)"
        status: pass
    human_judgment: false
  - id: D4
    description: "prepareApproval at local refs/heads/{base}: phase 02 prepared (itemId, itemPath, 12-hex fingerprint, labels, prerequisites); not-ready (no-context, no-plans), built, unreadable, not-found, no-base and invalid ids refused"
    requirement: APPR-01
    verification:
      - kind: integration
        ref: "tests/core/approvals/statement.test.ts#prepareApproval (9 cases)"
        status: pass
    human_judgment: false
  - id: D5
    description: "approvalState recomputed from git: on-runway after landing; changed on modified/added/removed inputs (sorted by path) and back to on-runway on revert; invalid on host/item mismatch, non-statement file and no trusted key"
    requirement: MISN-01
    verification:
      - kind: integration
        ref: "tests/core/runway/runway.test.ts#approvalState: inputs / statement cross-checks"
        status: pass
    human_judgment: false
  - id: D6
    description: "Gate-config drift (ROADMAP SC5): gates added, modified and removed each take an approved item off the runway with no input change; deleting the gates key again or editing only a non-gates key keeps it on the runway"
    requirement: MISN-01
    verification:
      - kind: integration
        ref: "tests/core/runway/runway.test.ts#approvalState: gate config (ROADMAP SC5)"
        status: pass
    human_judgment: false
  - id: D7
    description: "computeRunway counts on-runway approvals of non-built phases (with plan count), lists changed and invalid ones, is 0 with all invalid when no key is trusted, and skips file names failing the phase regex"
    requirement: MISN-01
    verification:
      - kind: integration
        ref: "tests/core/runway/runway.test.ts#computeRunway (3 cases)"
        status: pass
    human_judgment: false
  - id: D8
    description: "counterpoint approve: You are signing block with every full digest, lands one commit adding only the approval file, owner's uncommitted work untouched, success line with runway, notify family approval; re-sign replaces the file (M) and is on-runway"
    requirement: APPR-01
    verification:
      - kind: integration
        ref: "tests/cli/approve.test.ts#approveCommand: success (2 cases)"
        status: pass
      - kind: manual_procedural
        ref: "COUNTERPOINT_HOME=<scratch> script -q /dev/null node src/cli/main.ts approve synthetic 02 (pseudo-terminal, throwaway key, scratch copy of the synthetic host)"
        status: pass
    human_judgment: false
  - id: D9
    description: "Every refusal is specific, exits non-zero and leaves master unchanged: bad ids, unknown project, no trusted key, no baseline, integrity changed (with change list), not-ready/built/unreadable/not-found phases, no TTY, occupied path, base moved during signing, wrong-key signature, signing failure"
    requirement: APPR-04
    verification:
      - kind: integration
        ref: "tests/cli/approve.test.ts#approveCommand: refusals before anything is signed / at signing time (15 cases)"
        status: pass
    human_judgment: false
  - id: D10
    description: "A real approval on Cena with the owner's dedicated, passphrase-protected key typed at the owner's terminal"
    requirement: APPR-01
    verification: []
    human_judgment: true
    rationale: "Needs the owner's real key and passphrase and the real Cena repository; this is the owner's manual step in 01-16. Nothing on Cena master is currently approvable (both phases are Built)."

duration: 14min
completed: 2026-11-09
status: complete
---

# Phase 1 Plan 12: Approval Statement and `counterpoint approve` Summary

**`counterpoint approve {host} {phase}` re-derives the owner-approved `counterpoint/approval/v1` statement at the local base tip, prints every full input digest, the gate slot and a 12-hex statement fingerprint, signs with the trusted key via ssh-keygen at the terminal, checks the signature before landing the one-file commit by compare-and-swap, verifies it from git and reports the runway. Approval state and the runway are recomputed from git on every read, including gate-config drift.**

## Owner decision (Task 1 checkpoint)

The owner answered **"item4"**: RESEARCH Item 4 exactly as proposed. The fields are `schema: counterpoint/approval/v1`, `kind: runway`, `host`, `item { type: phase, id }`, `base { branch, commit }`, `inputs { algorithm: sha256, files: [{ path, kind, digest, normalization? }], combined }`, `draft { state: none, digest: null }` and `gates { state: absent | present, digest }`. The file is `.counterpoint/approvals/phase-{NN}.json` with item id `phase-{NN}`, pretty-printed with sorted keys. There is **no `prepared` block**, so identical inputs at the same tip always give byte-identical files and the same fingerprint. This plan implements exactly that format, and it is now frozen.

## Performance

- **Duration:** about 14 min (this continuation run)
- **Started:** 2026-11-09T17:51:07Z
- **Completed:** 2026-11-09T18:05:00Z
- **Tasks:** 3 (Task 1 was the owner's decision; Tasks 2 and 3 TDD)
- **Files:** 9 created, 4 modified (including REQUIREMENTS.md)

## Accomplishments

- **Canonical JSON** (`canonical.ts`):
  - Keys are sorted by UTF-16 code unit. Test vector: U+1F600 sorts before U+FF61.
  - Strings are escaped exactly as `JSON.stringify` does, with no whitespace.
  - Only strings, safe integers, booleans, null, arrays and plain objects are allowed. Anything else throws `CanonicalJsonError`, naming the key path (for example `gates.lint.timeout`).
  - The same renderer writes the pretty on-disk form.
- **Statement** (`statement.ts`):
  - `buildStatement` digests each input's committed bytes and sorts the files by path bytes. It refuses duplicate paths and sets `combined` to the sha256 of the canonical JSON of the files.
  - The result is validated with the same strict schema the verifier uses. That schema rejects unknown keys, a wrong schema string, malformed digests, a bad host or phase id, unsorted files and a mismatched `combined`.
  - `serializeStatement` writes sorted-key, 2-space JSON with a final LF. `statementFingerprint` is the first 12 hex of sha256(canonical statement).
- **Gate slot** (`gates.ts`): reads `.counterpoint/config.yaml` from the tip with `yaml`'s core schema, which refuses duplicate keys. It digests only the `gates` value, so comments, other keys and formatting do not count. A missing or empty file, or a missing or null `gates` key, gives `{ state: 'absent', digest: null }`.
- **Preparation** (`prepare.ts`):
  - Works from the local `refs/heads/{base}` (D-03) and only for a Ready phase (D-01).
  - Refusals: `not-ready` (with `no-context` / `no-plans`), `built`, `unreadable` (file and reason), `not-found`, `no-base` and `gates-config`.
  - Returns the statement, its bytes, the fingerprint, `phase-{NN}`, the item path, the tip, the phase facts, the prerequisites and the labelled inputs.
- **Approval state and runway** (`runway.ts`):
  - `approvalState` calls `verifyApprovalCommit`, then parses the statement strictly. It cross-checks `host` and `item.id`, then recomputes the inputs and the gate slot at the tip.
  - Result is `on-runway`, `changed` (sorted input changes plus `gatesChange` added/modified/removed/unreadable), or `invalid`.
  - Reverting an edit returns an item to `on-runway` with no re-sign. With no trusted key, everything is invalid.
  - `computeRunway` lists `.counterpoint/approvals/` at the tip. It counts on-runway approvals of phases that are not Built and returns plan counts plus the changed and invalid lists.
- **`counterpoint approve`** (`approve.ts`, registered in `main.ts`):
  - Order of checks: ids, then the read-only host lookup, the trusted key, the integrity baseline and its comparison (refusal sentence plus the change list), preparation, and the TTY. Each check has its own message.
  - It then prints the `You are signing` block, signs, and checks the signature against the pinned key.
  - It lands with `expectedTip` and CAS and reports `base-moved`, `occupied` or `unsafe-path` if landing fails. If a checkout's file could not be placed (`unplaced`), it tells the owner how to restore it.
  - It re-verifies from git, prints `Signed and verified. Runway is now {N}. Not pushed: push {base} when you're ready.` and nudges a running daemon (`family: 'approval'`).
- **Real-terminal check:** on a scratch copy of the synthetic host with a throwaway key, `script -q /dev/null node src/cli/main.ts approve synthetic 02` printed the full block (six input digests, combined digest, `Gates: none yet`, `Statement f8613cc31cd8`, prerequisites, signer) and then `Signed and verified. Runway is now 1. Not pushed: push master when you're ready.` Without a TTY the same command printed the terminal refusal and exited 1.

## Task Commits

1. **Task 1: Owner confirms the approval statement format.** Decision checkpoint, no commit; the owner chose `item4`.
2. **Task 2: Statement, canonical JSON, gate-config digest and prepare**
   - `620fc44` test(01-12): add failing tests for approval statement, canonical JSON, gates digest and prepare (RED)
   - `506f930` feat(01-12): approval statement v1, canonical JSON, gates digest and prepare (GREEN)
3. **Task 3: Approval state, runway computation and `counterpoint approve`**
   - `2c64329` test(01-12): add failing tests for approval state, runway and counterpoint approve (RED)
   - `36de6bf` feat(01-12): approval state, runway and counterpoint approve (GREEN)

**Plan metadata:** the docs commit that adds this SUMMARY.

## TDD Gate Compliance

- **Task 2 RED** (`620fc44`): the target was `tests/core/approvals/statement.test.ts > canonicalJson > sorts object keys and keeps array order`, run alone with `-t` and the `tap-flat` reporter. `gsd-tools check tdd-red-evidence` returned **RED_EVIDENCE_OK** (`target_test_failed`).
  - Semantic check: the target ran and failed on its planned assertion (`expected '{"b":1,"a":[…]}' to be '{"a":[…],"b":1}'`), because the stub kept insertion order. There was no load or fixture fault. 35 of 40 tests failed against the API stubs.
  - Record: `.tmp/red/0112-t2.json` (gitignored).
- **Task 3 RED** (`2c64329`): the target was `tests/core/runway/runway.test.ts > approvalState: inputs > is on-runway right after a landed approval`. Result: **RED_EVIDENCE_OK**.
  - Semantic check: a real signed approval landed in the test body, and the target failed on `expected 'none' to be 'on-runway'` because the stub always returned none. 34 of 36 tests failed. The two that passed are negative controls: `none` before approval, and identical inputs compare equal.
  - Record: `.tmp/red/0112-t3.json`.
- **GREEN:** each `feat(01-12)` commit descends from its `test(01-12)` commit. 40/40 and 36/36 pass. **REFACTOR:** none was needed beyond Biome formatting inside the GREEN commits.

## Files Created/Modified

- `src/core/approvals/canonical.ts`: canonical and pretty canonical JSON with key-path errors.
- `src/core/approvals/statement.ts`: the v1 format, strict schema, builder, serializer, fingerprint and approval path.
- `src/core/approvals/gates.ts`: the gate-config digest slot.
- `src/core/approvals/prepare.ts`: recompute-and-print preparation at the base tip.
- `src/core/runway/runway.ts`: input/gate comparison, approval state, runway.
- `src/cli/approve.ts`: the `approve` command.
- `src/cli/main.ts`: registers `approve <host> <phase>` and passes the TTY flag from stdin and stdout.
- `src/cli/trust.ts`: `describeChange` is exported, used for approve's integrity refusal list.
- `src/core/approvals/commit.ts`: `signAndLand` accepts an optional `expectedTip`.
- `tests/core/approvals/statement.test.ts` (40), `tests/core/runway/runway.test.ts` (20), `tests/cli/approve.test.ts` (16).
- `.planning/REQUIREMENTS.md`: APPR-04 marked complete.

## Decisions Made

See `key-decisions` in the frontmatter. The format decision is the owner's (item4). The rest are implementation choices inside the plan's stated behaviour.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] The signature is checked before anything lands**
- **Found during:** Task 3
- **Issue:** One must-have says approve refuses, with nothing written, when "the signature does not verify". `signAndLand` lands whatever the signer returns, so a wrong-key signature would have moved the base ref before the post-landing verification noticed.
- **Fix:** approve's sign wrapper runs `verifySignature` against the trusted allowed-signers file and compares the pinned fingerprint before returning the signature. A rejected signature aborts with `The signature did not verify against your trusted key. Nothing was changed.` The post-landing `approvalState` check is still there.
- **Files modified:** src/cli/approve.ts
- **Verification:** `tests/cli/approve.test.ts#refuses a signature that does not verify against the trusted key and lands nothing`
- **Committed in:** 36de6bf

**2. [Rule 2 - Missing critical] Base moved between preparation and signing**
- **Found during:** Task 3
- **Issue:** `signAndLand` resolved the tip itself. If the base moved after `prepareApproval`, it would have signed a statement whose `base.commit` and inputs described a different tip.
- **Fix:** an optional `expectedTip` on `signAndLand` refuses `base-moved` before the owner is asked to sign. A move during signing is still caught by the existing compare-and-swap.
- **Files modified:** src/core/approvals/commit.ts (not in files_modified)
- **Verification:** 01-08's commit tests still pass. The race test covers a move during signing.
- **Committed in:** 36de6bf

**3. [Rule 2 - Missing critical] Extra fail-closed refusals and reasons**
- **Found during:** Tasks 2 and 3
- **Issue:** The plan did not say what happens when the base branch does not resolve, or when the gate config cannot be parsed or holds a float.
- **Fix:** `prepareApproval` refuses `no-base` and `gates-config`. `approvalState` reports such a config as `changed` with `gatesChange.change = 'unreadable'`, never on-runway. Invalid reasons gained `no-trusted-key`, `bad-statement`, `host-mismatch` and `item-mismatch`.
- **Committed in:** 506f930, 36de6bf

**4. [Rule 3 - Interface] Reused 01-10 text and helpers**
- `describeChange` is now exported from `src/cli/trust.ts`. The no-trusted-key refusal reuses doctor's `NO_TRUSTED_KEY_FIX` (`… trust-key ~/.ssh/counterpoint_approval.pub`) instead of the plan's `{path}.pub` placeholder, so doctor and approve give the same fix.
- The not-found copy (`Phase {NN} is not in {host}'s planning on {base}.`) and the no-framework copy are new; UI-SPEC defines neither.
- Exit code 2 is used for a malformed id or unknown project and 1 for every other refusal, following the 01-10 convention.

---

**Total deviations:** 4 (3 missing-critical, 1 interface).
**Impact on plan:** Each one tightens a must-have or a threat-register mitigation (T-01-42, T-01-44, T-01-46, T-01-63). No new packages, and the lockfile is unchanged.

## Issues Encountered

- A test helper first read committed files through `git show`, and execa strips the final newline. A "revert" commit therefore was not byte-identical, so the revert-to-runway cases failed. The fix reads exact bytes through the `GitFileReader`, and the fix was made before the GREEN commit. Product code was not affected.
- The worktree guard refuses shell git outside the worktree, so the real-terminal check built its scratch host with the test suite's own helpers (`materializeFixtureRepo`, `makeThrowawayKey`) under `CP_TEST_SCRATCH`. The scratch directories were removed afterwards.

## Known Stubs

None. The RED-step stubs were all replaced in the GREEN commits.

## Threat Flags

None. No new network endpoint or auth path. The only new file write is the approval file through the existing `signAndLand` path. Reading the signer identity runs `git config --get` with hooks and fsmonitor disabled, and the global config is read, as the plan allows.

## User Setup Required

None for this plan. A **real approval on Cena** is the owner's manual step in 01-16. It needs the dedicated, passphrase-protected key (`counterpoint init-key`, `trust-key`), a baseline (`counterpoint trust cena`), and a Ready phase on Cena `master` (both current phases are Built). No real key, ssh-agent, Keychain, global git config, real Counterpoint home or Cena repository was touched.

## Next Phase Readiness

- **01-13 (console approval dialog):** it can call `prepareApproval` for the preview and watch for the commit `approve` lands. Use `approvalState` / `computeRunway` for the landed state and the runway figure. The printed command is `counterpoint approve {host} {phase}`.
- **01-14 (change view):** use `approvalState(...).changes` / `gatesChange` with `statement.base.commit` as the diff base.
- **Phase 2:** fills the `gates` section of `.counterpoint/config.yaml`; the slot already exists, so the schema does not change. **Phase 4:** fills `draft` the same way.

---
*Phase: 01-trusted-shell-signed-runway*
*Completed: 2026-11-09*

## Self-Check: PASSED

- All 9 created files exist on disk. Commits 620fc44, 506f930, 2c64329 and 36de6bf are on this branch (`git rev-list --count de9fe48..HEAD` = 4).
- Acceptance criteria re-run, all PASS:
  - statement.ts contains `counterpoint/approval/v1` and `combined`; gates.ts contains `.counterpoint/config.yaml` and `absent`; prepare.ts contains `refs/heads/` and `approvalInputs`.
  - approve.ts contains `You are signing`, `Signed and verified. Runway is now`, `Not pushed: push` and `needs a terminal`; runway.ts contains `verifyApprovalCommit`, `removed` and `gatesChange`; the runway test contains `gatesChange` and `.counterpoint/config.yaml`; main.ts contains `approve`.
  - No `ROADMAP` / `.planning` literal appears under src/core.
- Plan verification: `pnpm test` gives 678 passed and 1 skipped, `pnpm typecheck` exits 0, `pnpm lint` exits 0, and the real-terminal approve on a scratch synthetic host passed.

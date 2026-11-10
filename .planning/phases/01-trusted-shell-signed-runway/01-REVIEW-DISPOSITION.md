---
phase: 01
review: 01-REVIEW.md
titles: json
findings:
  - id: CR-01
    severity: critical
    disposition: open
    title: "Doctor can pass while sandboxed Bash writes outside the working folder (user/managed `allowWrite`, `additionalDirectories` not judged; no Bash outside-write probe step)"
  - id: WR-01
    severity: warning
    disposition: open
    title: "Replacement 1 for the scrub is inert: the bare `Bash` in `--allowedTools` rule-accepts every command"
  - id: WR-02
    severity: warning
    disposition: open
    title: "`trust-key` confirms one fingerprint but then trusts whatever key file is there"
  - id: WR-03
    severity: warning
    disposition: open
    title: "Duplicate phase directories and repeated roadmap headings sit outside the signature (first match wins silently)"
  - id: WR-04
    severity: warning
    disposition: open
    title: "The input reader follows replace refs while the verifier refuses them"
  - id: WR-05
    severity: warning
    disposition: open
    title: "The integrity baseline misses execution-capable keys and per-worktree config"
  - id: WR-06
    severity: warning
    disposition: open
    title: "Needs You runs `git status` in the owner's checkout without the filter guard that commit.ts applies"
  - id: WR-07
    severity: warning
    disposition: open
    title: "The runway cache pins a transient verification error until the base tip moves"
  - id: WR-08
    severity: warning
    disposition: open
    title: "`stop` can signal an unrelated process from a stale `daemon.json`"
  - id: IN-01
    severity: info
    disposition: open
    title: "Atomic writers use flag `w` on a predictable temp name"
  - id: IN-02
    severity: info
    disposition: open
    title: "`readDoctorReport` opens without O_NONBLOCK"
  - id: IN-03
    severity: info
    disposition: open
    title: "The one-time sign-in code briefly appears in a process argv"
  - id: IN-04
    severity: info
    disposition: open
    title: "`init` does not tighten an existing home to 0700"
  - id: IN-05
    severity: info
    disposition: open
    title: "`fileEditGrants` is test-only code in a production module"
open: 14
total: 14
recorded: 2026-11-10T20:42:42.280Z
---

# Phase 01: Code Review Disposition

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| CR-01 | critical | open | - |
| WR-01 | warning | open | - |
| WR-02 | warning | open | - |
| WR-03 | warning | open | - |
| WR-04 | warning | open | - |
| WR-05 | warning | open | - |
| WR-06 | warning | open | - |
| WR-07 | warning | open | - |
| WR-08 | warning | open | - |
| IN-01 | info | open | - |
| IN-02 | info | open | - |
| IN-03 | info | open | - |
| IN-04 | info | open | - |
| IN-05 | info | open | - |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved. A `|` in the reason is kept as prose and escaped on the next run.
Re-running the gate keeps every row it can. A row the current review no longer reports is kept and its Source cell flagged, so a finding does not leave this record silently. ONE exception: when a finding id is REUSED by a different finding, the earlier decision cannot keep a row — the id is taken — and it is dropped. A RECORDED decision (anything but `open`) is named on the console when that happens; a row still at `open` is replaced silently, because `open` records no decision to lose.

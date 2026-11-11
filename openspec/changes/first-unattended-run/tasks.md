# Tasks

The first two groups come from the trusted-shell review and must be done before any unattended builder runs. The build-lane groups get detailed after the research spikes in group 3.

## 1. Trust fixes before any unattended run

- [x] 1.1 CR-01: judge user/managed `sandbox.filesystem.allowWrite` and `allowRead`, `permissions.additionalDirectories` and unix-socket allowances in the isolation check (launch source exempt only for the builder's own grant)
- [x] 1.2 CR-01: add a Bash outside-write step to the files-outside-the-working-folder probe row (treatment and control), with leftovers check and cleanup; refreeze fixtures
- [x] 1.3 WR-02: `trust-key` pins exactly the confirmed key bytes, opens without following symlinks, refuses on mismatch
- [x] 1.4 WR-04: one hardened git helper for the input reader and the verifier (no replace objects, no grafts)
- [x] 1.5 WR-05: add the missing execution-capable keys, snapshot every worktree config, digest include targets
- [x] 1.6 WR-06: the uncommitted-edits hint runs no repository filter (filter check first, or direct byte comparison)
- [x] 1.7 WR-01: verify live whether `autoAllowBashIfSandboxed: false` has any effect with bare `Bash` allow-listed; drop bare `Bash` or correct the record in code and `docs/decisions.md`
- [x] 1.8 Live doctor proof on the owner's machine after 1.1 to 1.7

## 2. Review backlog

- [x] 2.1 WR-03: confirm the OpenSpec adapter fails closed on ambiguous change names (active and archived, or two archive folders)
- [x] 2.2 WR-07: never cache runway or Needs You results that contain transient `error` verdicts
- [x] 2.3 WR-08: clear the run record at daemon start; confirm the process before any pid-based stop
- [x] 2.4 IN-01: remove-then-exclusive-create for every atomic writer
- [x] 2.5 IN-02: open the stored doctor report with `O_NONBLOCK`
- [ ] 2.6 IN-03: decide on the sign-in code in the opener's argv; resolve `xdg-open` by absolute path
- [x] 2.7 IN-04: tighten or warn about an existing home that is not 0700
- [x] 2.8 IN-05: use the file-edit grant parser in doctor or move it to test helpers

## 3. Research spikes

- [ ] 3.1 Context-window denominator on a 1M-window model, from live usage and the reported window
- [ ] 3.2 `rate_limit_event` shape and reset-time unit; API retry and error result subtypes
- [ ] 3.3 Process-group kill on macOS for gates that start dev servers
- [ ] 3.4 Which Cena gate commands need sandbox escape hatches (Supabase, Docker) and how narrow they can be
- [ ] 3.5 Host `.claude` commands, agents and skills under user-only setting sources
- [ ] 3.6 Builder write grant into the common git dir (objects, own branch ref, own worktree entry) and its doctor row

## 4. Build lane

- [ ] 4.1 Design the build lane in this file's design.md from the spike results
- [ ] 4.2 Detail the build-lane tasks here (worktrees, sessions and handoff, governor, gates, PRs, planning-write queue, crash recovery, run report)
- [ ] 4.3 Owner: approve a real Cena change for the first overnight run
- [ ] 4.4 One unattended overnight run on Cena ending in a green PR with a preview link, or a parked change with its reason

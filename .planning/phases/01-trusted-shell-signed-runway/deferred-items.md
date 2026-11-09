# Phase 01 Deferred Items

Out-of-scope discoveries logged during plan execution (not fixed by the discovering plan).

## From 01-05

### Agent file tools can write outside the session directory (security, owner decision)

- **Found:** 2026-11-09, while checking which denial texts claude 2.1.319 prints when the permission mode is forced to `default` (`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`).
- **Setup:** the production argv (`buildClaudeArgv`), sandbox enabled with `allowWrite: []`, Read/Edit deny rules on one protected dir P, cwd W, and an unprotected dir U outside W. All paths were scratch dirs under `/Volumes/Dock/Dev/Caches/cp-test-0105/`.
- **Observed:**
  - Bash `cat`, Read and Write tools on U all succeeded. So did Edit, which changed an existing file in U.
  - Bash `touch` in U failed with `Operation not permitted`, because the Seatbelt sandbox confines Bash only.
  - P was denied for every tool, by rule (`permission_decision.reason_type` `rule` or `subcommandResults`).
  - No mode denial appeared for any out-of-cwd path.
- **Meaning:** `allowWrite: []` confines only Bash. The Write and Edit tools can modify any user-writable file not covered by an `Edit(...)` deny rule. That includes `~/.claude/settings.json`, which `--setting-sources user` loads into every later session, and shell rc files.
- **Why deferred:** the fix changes the agent permission model (for example, an `Edit(//**)` deny with a narrow workdir exception, or an allow-only-workdir rule set) and affects Phase 2's builder grant. That is a Rule 4 decision for the owner.
- **Recorded in:** `.planning/WINDOWS.md` entry 2.

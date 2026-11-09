---
schema_version: 1
open_count: 2
waived_count: 0
fixed_count: 0
total_count: 2
last_updated: 2026-11-09T17:06:48.604Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | unmet-truth | src/agent/probe.ts |  | Live probe on claude 2.1.319/macOS: a temporary Keychain canary item was readable from sandboxed agent Bash (RESEARCH A5 false); gh keyring credentials are reachable by agents until the owner chooses a remediation | open |  | 2026-11-09T16:49:49.183Z |  |
| 2 | 01 | unmet-truth | src/core/security/sandbox-settings.ts |  | Live check on claude 2.1.319 (01-05): agent Write and Edit tools succeeded on an unprotected path outside the session cwd (allowWrite: [] confines only Bash). Any user-writable file not under a deny rule (for example ~/.claude/settings.json, shell rc files) is writable by agents; owner decision needed (Edit deny or allow-only-workdir rules) | open |  | 2026-11-09T17:06:48.604Z |  |

````json
[
  {
    "id": 1,
    "kind": "unmet-truth",
    "phase": "01",
    "file": "src/agent/probe.ts",
    "line": null,
    "description": "Live probe on claude 2.1.319/macOS: a temporary Keychain canary item was readable from sandboxed agent Bash (RESEARCH A5 false); gh keyring credentials are reachable by agents until the owner chooses a remediation",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-11-09T16:49:49.183Z",
    "resolved_at": null,
    "milestone": null
  },
  {
    "id": 2,
    "kind": "unmet-truth",
    "phase": "01",
    "file": "src/core/security/sandbox-settings.ts",
    "line": null,
    "description": "Live check on claude 2.1.319 (01-05): agent Write and Edit tools succeeded on an unprotected path outside the session cwd (allowWrite: [] confines only Bash). Any user-writable file not under a deny rule (for example ~/.claude/settings.json, shell rc files) is writable by agents; owner decision needed (Edit deny or allow-only-workdir rules)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-11-09T17:06:48.604Z",
    "resolved_at": null,
    "milestone": null
  }
]
````

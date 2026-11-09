---
schema_version: 1
open_count: 1
waived_count: 0
fixed_count: 0
total_count: 1
last_updated: 2026-11-09T16:49:49.183Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | unmet-truth | src/agent/probe.ts |  | Live probe on claude 2.1.319/macOS: a temporary Keychain canary item was readable from sandboxed agent Bash (RESEARCH A5 false); gh keyring credentials are reachable by agents until the owner chooses a remediation | open |  | 2026-11-09T16:49:49.183Z |  |

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
  }
]
````

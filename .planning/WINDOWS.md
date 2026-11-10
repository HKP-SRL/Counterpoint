---
schema_version: 1
open_count: 1
waived_count: 1
fixed_count: 2
total_count: 4
last_updated: 2026-11-10T15:06:05.465Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | unmet-truth | src/agent/probe.ts |  | Live probe on claude 2.1.319/macOS: a temporary Keychain canary item was readable from sandboxed agent Bash (RESEARCH A5 false); gh keyring credentials are reachable by agents until the owner chooses a remediation | open |  | 2026-11-09T16:49:49.183Z |  |
| 2 | 01 | unmet-truth | src/core/security/sandbox-settings.ts |  | Live check on claude 2.1.319 (01-05): agent Write and Edit tools succeeded on an unprotected path outside the session cwd (allowWrite: [] confines only Bash). Any user-writable file not under a deny rule (for example ~/.claude/settings.json, shell rc files) is writable by agents; owner decision needed (Edit deny or allow-only-workdir rules) | fixed |  | 2026-11-09T17:06:48.604Z | 2026-11-10T15:06:05.214Z |
| 3 | 01 | unmet-truth | src/core/security/agent-env.ts |  | claude 2.1.321: CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1 forces --permission-mode auto down to default; agent sessions do not run in the owner's chosen auto mode (01-21 evidence) | fixed |  | 2026-11-10T09:56:10.770Z | 2026-11-10T15:06:05.465Z |
| 4 | 01 | unmet-truth | src/agent/env-listing.ts |  | claude 2.1.321: sandboxed Bash commands see 12 sandbox proxy variables (HTTP_PROXY, HTTPS_PROXY, ALL_PROXY and others) whose values hold a user:password login for a loopback host, likely the sandbox network proxy's own per-session login, and the gcloud proxy password CLOUDSDK_PROXY_PASSWORD beside a loopback CLOUDSDK_PROXY_ADDRESS, which Claude Code sets after the launch profile's deny entries apply (01-26 listings; names and shapes only) | waived | Owner accepted it, per the STATE.md [Owner] decisions 'Credential-env row scoped to the real requirement' and 'CLOUDSDK_PROXY_PASSWORD joins the sandbox-proxy-login exception' (both 2026-11-10): the proxy URLs' host and CLOUDSDK_PROXY_ADDRESS are loopback addresses, so they are recorded as the named exception sandbox-proxy-login ('the sandbox's own proxy login, local only', like the Keychain one). The credential-env row applies it only to the twelve proxy URL names with url-userinfo shape and a loopback host, and to CLOUDSDK_PROXY_PASSWORD only beside a loopback CLOUDSDK_PROXY_ADDRESS; it names the exception in its evidence and the report's exceptions field on every run, and fails on a non-loopback proxy host or address (01-26). | 2026-11-10T14:26:25.539Z | 2026-11-10T14:26:33.990Z |

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
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-11-09T17:06:48.604Z",
    "resolved_at": "2026-11-10T15:06:05.214Z",
    "milestone": null
  },
  {
    "id": 3,
    "kind": "unmet-truth",
    "phase": "01",
    "file": "src/core/security/agent-env.ts",
    "line": null,
    "description": "claude 2.1.321: CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1 forces --permission-mode auto down to default; agent sessions do not run in the owner's chosen auto mode (01-21 evidence)",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-11-10T09:56:10.770Z",
    "resolved_at": "2026-11-10T15:06:05.465Z",
    "milestone": null
  },
  {
    "id": 4,
    "kind": "unmet-truth",
    "phase": "01",
    "file": "src/agent/env-listing.ts",
    "line": null,
    "description": "claude 2.1.321: sandboxed Bash commands see 12 sandbox proxy variables (HTTP_PROXY, HTTPS_PROXY, ALL_PROXY and others) whose values hold a user:password login for a loopback host, likely the sandbox network proxy's own per-session login, and the gcloud proxy password CLOUDSDK_PROXY_PASSWORD beside a loopback CLOUDSDK_PROXY_ADDRESS, which Claude Code sets after the launch profile's deny entries apply (01-26 listings; names and shapes only)",
    "status": "waived",
    "reason": "Owner accepted it, per the STATE.md [Owner] decisions 'Credential-env row scoped to the real requirement' and 'CLOUDSDK_PROXY_PASSWORD joins the sandbox-proxy-login exception' (both 2026-11-10): the proxy URLs' host and CLOUDSDK_PROXY_ADDRESS are loopback addresses, so they are recorded as the named exception sandbox-proxy-login ('the sandbox's own proxy login, local only', like the Keychain one). The credential-env row applies it only to the twelve proxy URL names with url-userinfo shape and a loopback host, and to CLOUDSDK_PROXY_PASSWORD only beside a loopback CLOUDSDK_PROXY_ADDRESS; it names the exception in its evidence and the report's exceptions field on every run, and fails on a non-loopback proxy host or address (01-26).",
    "recorded_at": "2026-11-10T14:26:25.539Z",
    "resolved_at": "2026-11-10T14:26:33.990Z",
    "milestone": null
  }
]
````

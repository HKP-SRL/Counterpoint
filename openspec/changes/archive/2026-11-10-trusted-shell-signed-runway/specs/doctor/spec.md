# doctor Spec Delta

## Purpose
`counterpoint doctor` gives the owner pass/fail evidence that the tools are present, the approval key is safe, the host's git surface is as trusted, and a live headless agent session is actually boxed in; the console's Trust page shows the same verdict.

## ADDED Requirements

### Requirement: Grouped report with a strict exit code
`counterpoint doctor [host]` SHALL print grouped Tools, Signing key and Sandbox probe sections, one line per check with PASS/FAIL or BLOCKED/REACHABLE/NOT CHECKED, a detail, and a `Fix:` line on failure. It SHALL exit 0 only when every check passes or the only exception is a risk the owner has recorded as accepted.

#### Scenario: Everything passes
- **WHEN** all tools are present, the key is safe and every probe row is Blocked
- **THEN** doctor prints the verdict that agents are boxed in and exits 0

#### Scenario: One row reachable
- **WHEN** one probe target is Reachable and no accepted risk covers it
- **THEN** doctor prints that the agent sandbox is not confining sessions and exits non-zero

### Requirement: Tool checks
Doctor SHALL check that `claude`, `git` and `gh` are installed and report each version.

#### Scenario: gh missing
- **WHEN** `gh` is not on the PATH
- **THEN** the gh row reads FAIL with a fix hint

### Requirement: Approval key hygiene
Doctor SHALL check that the trusted approval key is passphrase-protected, is not loaded in any ssh-agent (including the launchd agent), and is not loadable through ssh config `AddKeysToAgent`/`UseKeychain` or a Keychain-stored passphrase. Doctor SHALL never prompt for or hold the passphrase.

#### Scenario: Key loaded in ssh-agent
- **WHEN** the approval key's fingerprint is listed by the ssh-agent
- **THEN** the key row reads FAIL with how to remove it from the agent

#### Scenario: Unprotected key
- **WHEN** the trusted private key has no passphrase
- **THEN** the key row reads FAIL

### Requirement: Differential live probe
Doctor SHALL run a live probe: a treatment session with the production launch profile tries to read nonce canaries next to each protected folder and to write the host's shared git files; a control session with the denies lifted tries the same against a probe-owned mirror. A target SHALL count as Blocked only when the control reached it and the treatment did not.

#### Scenario: Control cannot reach a target
- **WHEN** the control session fails to reach a canary
- **THEN** that row reads Not checked, never Blocked

#### Scenario: Canary nonce leaks
- **WHEN** a canary nonce appears anywhere in the treatment session's stream
- **THEN** that row reads Reachable

### Requirement: Probe rows
The probe SHALL report nine targets: signing key, `~/.ssh`, gh credentials, Counterpoint state, `.git/config`, `.git/hooks`, `.git/info`, files outside the working folder, and credentials in the shell environment. The probe SHALL use canary files, never read a real secret, and SHALL remove anything it created.

#### Scenario: Leftover probe file
- **WHEN** a probe write into `.git/hooks` succeeded
- **THEN** doctor deletes the file and reports the row Reachable

### Requirement: No false pass
The probe verdict SHALL come only from the session's stream records, never from the model's prose. A row SHALL read Blocked only for a refusal by a deny rule, the OS sandbox or the outside-folder write block. An unrecognised refusal message, a skipped step after one retry, or a Claude Code version whose messages are unknown SHALL read Not checked.

#### Scenario: Refusal by permission mode only
- **WHEN** a write is refused only because of the permission mode
- **THEN** the row reads Not checked

#### Scenario: New Claude Code wording
- **WHEN** a Claude Code update changes a denial message the matcher does not know
- **THEN** the affected rows read Not checked and doctor does not pass

### Requirement: Session mode and isolation-settings checks
Doctor SHALL record the permission mode the treatment session really ran in and fail anything but auto. Doctor SHALL read every settings source an agent session loads (launch, user, managed and its drop-ins, managed preferences) and fail, naming the source and key, when any turns sandbox isolation off; while that fails no probe row SHALL read Blocked.

#### Scenario: User settings disable the sandbox
- **WHEN** `~/.claude/settings.json` sets the sandbox filesystem isolation off
- **THEN** the isolation check fails naming that file and key, and no probe row reads Blocked

### Requirement: Credentials-in-environment row
The probe SHALL list a sandboxed Bash command's environment by variable name, length, shape and host class, never by value, and read Reachable when any credential-shaped variable is present outside a named exception. The sandbox's own loopback proxy login SHALL be the named exception `sandbox-proxy-login`, applied only when its host is a loopback address.

#### Scenario: Proxy login on a remote host
- **WHEN** a proxy URL with a user:password login points to a non-loopback host
- **THEN** the credentials row reads Reachable

### Requirement: Owner-recorded accepted risk
The owner SHALL be able to record the `gh-keychain` risk only at a terminal with `counterpoint accept-risk gh-keychain`, a reason and a typed confirmation, and withdraw it with `counterpoint revoke-risk gh-keychain`. Doctor SHALL apply it only when the Keychain lookup is the sole gh step reached, and SHALL print it on every run.

#### Scenario: Accepted Keychain risk
- **WHEN** gh credentials are reached only through the Keychain lookup and the risk is recorded
- **THEN** the gh row still reads REACHABLE, doctor names the accepted risk, the verdict reads "boxed in, with one accepted risk", and doctor exits 0

#### Scenario: Risk revoked
- **WHEN** the owner runs `counterpoint revoke-risk gh-keychain`
- **THEN** doctor and the Trust page fail again at once, without a rerun

#### Scenario: No terminal
- **WHEN** `counterpoint accept-risk gh-keychain` runs without a terminal
- **THEN** it saves nothing and exits 1

### Requirement: Trust page
The console's Trust page SHALL show the last stored doctor report: the verdict, tools, key checks, the session checks and every probe row with its evidence, plus any accepted risk with its reason, date and revoke command. The page SHALL be read-only; re-running doctor SHALL be a terminal action.

#### Scenario: New report written
- **WHEN** the owner runs `counterpoint doctor` while the Trust page is open
- **THEN** the page updates to the new verdict without a reload

#### Scenario: Old report without newer checks
- **WHEN** the stored report lacks the session-mode or isolation-settings check
- **THEN** the verdict does not read pass

# doctor Spec Delta

## REMOVED Requirements

### Requirement: Grouped report with a strict exit code
**Reason**: There is no sandbox or signing key left to report on.
**Migration**: The `counterpoint doctor` command is removed. A run checks its tools itself before its first session.

### Requirement: Tool checks
**Reason**: Moved, not dropped.
**Migration**: `build-runs`, "A run ends only when it cannot go on": a run that cannot find `claude`, `git` or `gh` ends before any session and names the program.

### Requirement: Approval key hygiene
**Reason**: There is no approval key.
**Migration**: None. The owner may delete the old key file.

### Requirement: Differential live probe
**Reason**: There is no confinement to probe.
**Migration**: None.

### Requirement: Probe rows
**Reason**: There is no confinement to probe.
**Migration**: None.

### Requirement: No false pass
**Reason**: There is no probe verdict.
**Migration**: None.

### Requirement: Session mode and isolation-settings checks
**Reason**: Sessions no longer depend on isolation settings.
**Migration**: None.

### Requirement: Credentials-in-environment row
**Reason**: Sessions get the owner's whole environment on purpose.
**Migration**: `owner-identity`, "The owner's login environment, read at each run start".

### Requirement: Owner-recorded accepted risk
**Reason**: With no probe there are no risks to accept one by one.
**Migration**: The `accept-risk` command and the recorded risks are removed. The one standing risk is stated in `docs/decisions.md`.

### Requirement: Trust page
**Reason**: It showed the doctor verdict and the pinned key, both gone.
**Migration**: The page is removed from the console; see `local-console`, "Host-scoped navigation".

### Requirement: Write widenings are judged
**Reason**: Sessions may write wherever the owner may.
**Migration**: None.

### Requirement: Bash outside-write probe step
**Reason**: There is no probe.
**Migration**: None.

### Requirement: Build-lane probe rows
**Reason**: There is no probe.
**Migration**: None.

### Requirement: Doctor and risk withdrawal from the console
**Reason**: There is no doctor run and no accepted risk.
**Migration**: None.

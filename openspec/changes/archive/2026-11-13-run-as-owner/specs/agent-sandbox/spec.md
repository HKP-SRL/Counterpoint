# agent-sandbox Spec Delta

## REMOVED Requirements

### Requirement: One launch profile for every agent session
**Reason**: There is no confinement left to keep identical between a probe and a builder.
**Migration**: Sessions launch as described in `owner-identity`, "Sessions run as the owner".

### Requirement: Protected paths are unreadable
**Reason**: The signing key is gone, and the owner chose to run sessions with their own rights.
**Migration**: None. Sessions can read what the owner can read.

### Requirement: Shared git configuration is not writable
**Reason**: It protected the signature check, which is removed.
**Migration**: None. Builders are still told to leave git state to Counterpoint.

### Requirement: File edits confined to the session folder
**Reason**: The confinement stopped builds from installing packages and starting services.
**Migration**: Sessions start in the change's worktree and work there by instruction, not by a wall.

### Requirement: Host-repo settings are not loaded
**Reason**: Sessions act as the owner in the host repository, so they load what the owner's own sessions load.
**Migration**: None.

### Requirement: Environment allow-list
**Reason**: The short list stranded runs three times (`USER`, `PATH`, `COREPACK_HOME`).
**Migration**: `owner-identity`, "The owner's login environment, read at each run start".

### Requirement: Auto permission mode without trusting the classifier
**Reason**: No deterministic guarantee is left to keep apart from the classifier.
**Migration**: Sessions stay in auto permission mode; see `owner-identity`, "Sessions run as the owner".

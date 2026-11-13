# key-trust Spec Delta

## REMOVED Requirements

### Requirement: Dedicated approval key setup
**Reason**: Approving is one click in the console; nothing is signed.
**Migration**: The `init-key` command is removed. The owner may delete the old key file.

### Requirement: Key pinned only after terminal confirmation
**Reason**: There is no key to pin.
**Migration**: The `trust-key` command and the pinned-key record are removed.

### Requirement: Host integrity baseline
**Reason**: It guarded the signature check and the sandboxed sessions, both removed. Accepting a new baseline at a terminal was a recurring owner step.
**Migration**: The `counterpoint trust` command and the stored baselines are removed.

### Requirement: Unexpected git changes block signing
**Reason**: Nothing is signed.
**Migration**: None.

### Requirement: Trust-key pins exactly the confirmed key
**Reason**: There is no key to pin.
**Migration**: None.

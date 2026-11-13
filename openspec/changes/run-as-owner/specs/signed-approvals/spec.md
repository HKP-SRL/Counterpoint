# signed-approvals Spec Delta

## REMOVED Requirements

### Requirement: Console prepares, terminal signs
**Reason**: Switching to a terminal for every approval was friction the owner rejected.
**Migration**: `approvals`, "Approve in one click".

### Requirement: What an approval covers
**Reason**: An approval now belongs to the change, not to a set of file digests.
**Migration**: `approvals`, "Approval stays with the change".

### Requirement: Statement format
**Reason**: There is no signed statement.
**Migration**: None.

### Requirement: Approve command shows what is signed
**Reason**: The `counterpoint approve` command is removed.
**Migration**: Approve in the console.

### Requirement: Signing at a terminal with a clean environment
**Reason**: Nothing is signed.
**Migration**: None.

### Requirement: One-file signed commit on the base branch
**Reason**: Approvals no longer add commits to the host repository.
**Migration**: `approvals`, "Earlier approvals carry over" reads the files earlier versions committed, once.

### Requirement: Verification from git, failing closed
**Reason**: There is no signature to verify.
**Migration**: `runway`, "Runway is the approved work not yet built".

### Requirement: Re-signing replaces the approval
**Reason**: An approval survives edits to the change, so there is nothing to sign again.
**Migration**: `approvals`, "Approval stays with the change".

### Requirement: Dialog sees the landing
**Reason**: The approval dialog waited for a signed commit to land; an approval now takes effect at once.
**Migration**: `approvals`, "Approve in one click".

### Requirement: Recomputation ignores replace refs and grafts
**Reason**: Nothing is recomputed from signed content.
**Migration**: None.

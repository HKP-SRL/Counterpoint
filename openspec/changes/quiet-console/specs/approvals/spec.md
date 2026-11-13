# approvals Spec Delta

## MODIFIED Requirements

### Requirement: Approve in one click
The console SHALL offer Approve on every Ready to approve change, and one action that approves every ready change together. An approval SHALL take effect at once, with no terminal step, key or passphrase. It SHALL record the change, the time and the base-branch commit it was given at.

#### Scenario: Approve one change
- **WHEN** the owner clicks Approve on a Ready to approve change that nothing holds
- **THEN** the change shows On runway and the home's run row counts one more change that can build now, without a reload

#### Scenario: Approve all
- **WHEN** three changes are Ready to approve and the owner clicks Approve all
- **THEN** all three are on the runway

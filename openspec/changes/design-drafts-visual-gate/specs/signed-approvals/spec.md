# signed-approvals Spec Delta

## MODIFIED Requirements

### Requirement: Statement format
The approval SHALL be stored at `.counterpoint/approvals/<change-name>.json` in the `counterpoint/approval/v2` format with sorted keys: host, item (type change, id the change name), base branch and commit, per-file sha256 digests with a combined digest, a draft slot (the digest of the signed-off full render, or none when the change has no drafts) and a gate-config slot (digest of the host's gate config, or absent). Identical inputs at the same tip SHALL give identical bytes.

#### Scenario: Gate config present
- **WHEN** the host's Counterpoint config has a gates section at the base tip
- **THEN** the statement records its digest with state present

#### Scenario: No gate config
- **WHEN** the host has no gate config
- **THEN** the statement records gates as absent

#### Scenario: Signed-off render
- **WHEN** the owner approves a change with a chosen full render
- **THEN** the statement's draft slot records that render's digest, and changing the render later takes the change off the runway

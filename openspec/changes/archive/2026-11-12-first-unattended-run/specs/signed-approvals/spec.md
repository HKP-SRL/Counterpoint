# signed-approvals Spec Delta

## ADDED Requirements

### Requirement: Recomputation ignores replace refs and grafts
Every git read used to compute approval inputs, the gate-config digest and the approval-file listing SHALL ignore `refs/replace/` objects and graft files, exactly as signature verification does.

#### Scenario: Replace ref hides an edit
- **WHEN** a replace ref maps an edited proposal blob to the signed one
- **THEN** the recomputed digest still reflects the edited content and the change leaves the runway

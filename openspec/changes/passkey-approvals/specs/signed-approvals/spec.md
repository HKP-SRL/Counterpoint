# signed-approvals Spec Delta

## ADDED Requirements

### Requirement: Approve with a passkey
On a Ready to approve change the console SHALL recompute the statement at the base-branch tip, show every covered file with a 12-hex digest, the draft and gate-config slots and the statement fingerprint, and approve it with the owner's pinned passkey, user verification required. The passkey challenge SHALL be the hash of the statement shown. Counterpoint SHALL hold no key that can sign an approval.

#### Scenario: Touch ID approves
- **WHEN** the owner clicks `Approve change` and confirms with Touch ID
- **THEN** the approval lands and the console shows `Signed and verified. Runway is now {N}.`

#### Scenario: Owner cancels
- **WHEN** the owner dismisses the passkey prompt
- **THEN** nothing lands and the change stays Ready to approve

#### Scenario: Change edited while the prompt is open
- **WHEN** a commit changes the change's files between showing the statement and the touch
- **THEN** nothing lands and the console shows the freshly recomputed statement

### Requirement: Several approvals with one touch
The owner SHALL be able to select several Ready to approve changes and approve them with one passkey touch over the list of their statements. Each change SHALL land as its own one-file commit, and each approval file SHALL verify on its own.

#### Scenario: Batch of three
- **WHEN** the owner approves three changes with one touch
- **THEN** three one-file approval commits land and all three changes are on the runway

### Requirement: Passkey signature bound to the console and the statement
A passkey signature SHALL count only when it verifies with the pinned credential's public key, its origin is the console's pinned origin, it is an assertion (`webauthn.get`) with user presence and user verification set, and its challenge is the statement's hash or the hash of a batch list containing the statement's digest.

#### Scenario: Signature from another localhost page
- **WHEN** an assertion was made on a page served from another `localhost` port
- **THEN** it does not count, because its origin is not the console's

#### Scenario: Statement swapped
- **WHEN** an approval file pairs a valid signature with a different statement
- **THEN** the approval is invalid

## MODIFIED Requirements

### Requirement: Statement format
The approval SHALL be stored at `.counterpoint/approvals/<change-name>.json` in the `counterpoint/approval/v3` format with sorted keys: the statement (host, item with type change and id the change name, base branch and commit, per-file sha256 digests with a combined digest, the draft slot and the gate-config slot), the owner's passkey signature, and for a batch the statement digests it covers. Identical inputs at the same tip SHALL give an identical statement.

#### Scenario: Gate config present
- **WHEN** the host's Counterpoint config has a gates section at the base tip
- **THEN** the statement records its digest with state present

#### Scenario: No gate config
- **WHEN** the host has no gate config
- **THEN** the statement records gates as absent

### Requirement: One-file signed commit on the base branch
After the owner's touch, Counterpoint SHALL create a commit with one parent on the base branch that adds or replaces only the approval file, built without checking anything out, and land it only if the base tip has not moved. The owner's uncommitted work SHALL stay untouched, and the commit SHALL NOT be pushed.

#### Scenario: Owner has uncommitted edits
- **WHEN** the owner's checkout has modified and untracked files and is on the base branch
- **THEN** after approval those files are unchanged and the approval file does not show as deleted

#### Scenario: Base moved during signing
- **WHEN** another commit lands on the base branch while the passkey prompt is open
- **THEN** nothing lands and the console asks the owner to approve again

#### Scenario: Approval path occupied
- **WHEN** an uncommitted file already exists at the approval file's path
- **THEN** approving is refused before the passkey prompt

#### Scenario: Success
- **WHEN** the touch and landing succeed
- **THEN** the console shows `Signed and verified. Runway is now {N}.` and that the commit is not pushed yet

### Requirement: Verification from git, failing closed
An approval SHALL be valid only when the last commit touching the approval file on the base branch has one parent, changes only that file, and holds a `v3` approval for this host and change whose passkey signature counts for its statement. Anything else, including an SSH-signed `v2` approval, SHALL be invalid.

#### Scenario: Unsigned edit of the approval file
- **WHEN** someone commits an edit to an approval file without a fresh passkey signature
- **THEN** that change is not on the runway

#### Scenario: Signed by another key
- **WHEN** an approval carries a signature from a credential other than the pinned one
- **THEN** it is invalid

#### Scenario: Old SSH approval
- **WHEN** a change's approval file is still an SSH-signed `v2` approval
- **THEN** the change is not on the runway until the owner re-approves it with the passkey

### Requirement: Re-signing replaces the approval
Re-approving a change SHALL write a new commit that replaces its approval file with a fresh passkey approval, and the change SHALL return to the runway once the new statement matches.

#### Scenario: Re-sign after a change
- **WHEN** the owner re-approves a change that was Changed since signed
- **THEN** it is back On runway

## REMOVED Requirements

### Requirement: Console prepares, terminal signs
**Reason**: Signing moves into the console with the owner's passkey.
**Migration**: See "Approve with a passkey".

### Requirement: Approve command shows what is signed
**Reason**: There is no approve command; the console shows the statement right before the passkey prompt.
**Migration**: See "Approve with a passkey".

### Requirement: Signing at a terminal with a clean environment
**Reason**: SSH approval signing is removed; only the owner's passkey signs.
**Migration**: See "Approve with a passkey" and "Passkey signature bound to the console and the statement".

### Requirement: Dialog sees the landing
**Reason**: The dialog now asks for the passkey itself and shows the result directly.
**Migration**: See "Approve with a passkey".

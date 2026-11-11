# signed-approvals Spec Delta

## Purpose
How the owner signs a host change into the runway: a one-file commit on the base branch, signed at a terminal with a key agents cannot use, whose statement binds the exact bytes of the change so any later edit is detected.

## ADDED Requirements

### Requirement: Console prepares, terminal signs
On a Ready to approve change the console SHALL ask the server to recompute the approval statement at the base-branch tip, show every covered file with a 12-hex digest, the draft and gate-config slots, a statement fingerprint and the one-line command `counterpoint approve {host} {change}`. The console SHALL never sign.

#### Scenario: Open the approval dialog
- **WHEN** the owner clicks `Approve change`
- **THEN** the dialog shows the recomputed inputs, the fingerprint and the command with a copy button

#### Scenario: Reopen after an edit
- **WHEN** the owner closes the dialog, a new commit changes the change, and the owner reopens it
- **THEN** the dialog shows a freshly recomputed statement

### Requirement: What an approval covers
An approval of a change SHALL cover the raw committed bytes of every file in its change directory, except that `tasks.md` SHALL be normalized so ticking or unticking checkboxes is not a content change. Each file SHALL be recorded with its own digest so changes can be named file by file.

#### Scenario: Task ticked
- **WHEN** a task checkbox in an approved change's tasks.md is ticked on the base branch
- **THEN** the approval still matches

#### Scenario: Spec delta edited
- **WHEN** a file under the approved change's `specs/` folder is edited on the base branch
- **THEN** the approval no longer matches and names that file

#### Scenario: File added
- **WHEN** a new file is committed into the approved change's directory
- **THEN** the approval no longer matches and names the added file

### Requirement: Statement format
The approval SHALL be stored at `.counterpoint/approvals/<change-name>.json` in the `counterpoint/approval/v2` format with sorted keys: host, item (type change, id the change name), base branch and commit, per-file sha256 digests with a combined digest, a draft slot (none until design drafts exist) and a gate-config slot (digest of the host's gate config, or absent). Identical inputs at the same tip SHALL give identical bytes.

#### Scenario: Gate config present
- **WHEN** the host's Counterpoint config has a gates section at the base tip
- **THEN** the statement records its digest with state present

#### Scenario: No gate config
- **WHEN** the host has no gate config
- **THEN** the statement records gates as absent

### Requirement: Approve command shows what is signed
`counterpoint approve {host} {change}` SHALL re-derive the statement at the base-branch tip at signing time and print the change, base branch and tip, every full digest, the draft and gate-config slots, any owner steps and the statement fingerprint before asking for the passphrase.

#### Scenario: Fingerprints agree
- **WHEN** the owner runs the command copied from the dialog with no commits in between
- **THEN** the terminal shows the same statement fingerprint as the dialog

### Requirement: Signing at a terminal with a clean environment
Signing SHALL call `ssh-keygen -Y sign` directly with the trusted key and a fixed environment, never git's config-driven signing, an ssh-agent, an askpass helper or repo hooks. Approve SHALL refuse without a terminal, without a trusted key, or without a matching integrity baseline.

#### Scenario: No terminal
- **WHEN** an agent runs `counterpoint approve` with no terminal attached
- **THEN** it refuses and nothing is signed

#### Scenario: Wrong passphrase
- **WHEN** the owner enters a wrong passphrase
- **THEN** no commit is created

### Requirement: One-file signed commit on the base branch
Approve SHALL create a commit with one parent on the base branch that adds or replaces only the approval file, built without checking anything out, and land it only if the base tip has not moved. The owner's uncommitted work SHALL stay untouched, and the commit SHALL NOT be pushed.

#### Scenario: Owner has uncommitted edits
- **WHEN** the owner's checkout has modified and untracked files and is on the base branch
- **THEN** after approval those files are unchanged and the approval file does not show as deleted

#### Scenario: Base moved during signing
- **WHEN** another commit lands on the base branch while the owner types the passphrase
- **THEN** approve refuses to land and asks the owner to run it again

#### Scenario: Approval path occupied
- **WHEN** an uncommitted file already exists at the approval file's path
- **THEN** approve refuses before signing

#### Scenario: Success
- **WHEN** signing and landing succeed
- **THEN** the terminal prints `Signed and verified. Runway is now {N}. Not pushed: push {base} when you're ready.`

### Requirement: Verification from git, failing closed
An approval SHALL be valid only when the last commit touching the approval file on the base branch has one parent, changes only that file, carries a signature that `ssh-keygen -Y verify` accepts for the pinned fingerprint and git namespace, and holds a statement for this host and change. Anything else SHALL be invalid.

#### Scenario: Unsigned edit of the approval file
- **WHEN** someone commits an unsigned edit to an approval file
- **THEN** that change is not on the runway

#### Scenario: Signed by another key
- **WHEN** an approval commit is signed by a key other than the pinned one
- **THEN** it is invalid

### Requirement: Re-signing replaces the approval
Re-signing a change SHALL write a new signed commit that replaces its approval file, and the change SHALL return to the runway once the new statement matches.

#### Scenario: Re-sign after a change
- **WHEN** the owner re-signs a change that was Changed since signed
- **THEN** it is back On runway

### Requirement: Dialog sees the landing
While the approval dialog is open, the console SHALL detect the verified approval commit and switch to `Signed. Runway is now {N}.`

#### Scenario: Owner signs in the terminal
- **WHEN** the owner runs the approve command while the dialog is open
- **THEN** the dialog flips to the landed state within seconds

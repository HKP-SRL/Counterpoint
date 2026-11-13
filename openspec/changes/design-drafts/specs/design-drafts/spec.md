# design-drafts Spec Delta

## Purpose
Screen drafts the owner reviews before a change is built: fast low-fi rounds to settle a direction, one hi-fi draft in the host's own design system to refine it, and a sign-off that becomes the builder's reference.

## ADDED Requirements

### Requirement: Drafts per screen
The owner SHALL be able to start drafts for a change. Counterpoint SHALL list the screens the change needs from its planning, and the owner SHALL be able to add or drop a screen before the first round.

#### Scenario: Start drafts
- **WHEN** the owner starts drafts for a change whose plan describes two screens
- **THEN** both screens are listed, and the owner can add a third or drop one before the first round

### Requirement: Static drafts
Every draft SHALL be a static HTML page: no scripts run in it, and nothing in it moves or responds to input. Each state of a screen SHALL be its own page. Drafts SHALL be served on a loopback origin separate from the console API.

#### Scenario: A draft runs no scripts
- **WHEN** a generated draft contains a script
- **THEN** the script does not run when the draft is shown

#### Scenario: States are pages
- **WHEN** a hi-fi screen has an empty state and an error state
- **THEN** each state is its own static page

### Requirement: Low-fi rounds
A low-fi round SHALL bring 3 drafts of a screen side by side, in a neutral low-fi style with real layout and real text. Each draft SHALL show as soon as it is ready, without waiting for the others. A low-fi round SHALL NOT build or run the host application.

#### Scenario: First round
- **WHEN** the owner starts drafts for a screen
- **THEN** 3 low-fi drafts appear side by side, each as soon as it is ready

### Requirement: Select and comment parts
On a low-fi draft, the owner SHALL be able to select a part as the direction to keep, or comment on a part to change it, on any of the round's drafts. Selections and comments SHALL collect until the owner asks for the next round, which brings 3 new drafts built from them.

#### Scenario: Mix two drafts
- **WHEN** the owner selects the header of draft A and the list of draft C and asks for the next round
- **THEN** the 3 new drafts each keep A's header and C's list

### Requirement: Lock a direction
The owner SHALL be able to lock one low-fi draft as the screen's direction, which ends the low-fi rounds and starts the hi-fi draft. The owner SHALL be able to unlock, returning to low-fi rounds that start from the locked draft.

#### Scenario: Lock
- **WHEN** the owner locks draft B
- **THEN** low-fi rounds end and a hi-fi draft of B is made

#### Scenario: Unlock
- **WHEN** the owner unlocks a locked screen
- **THEN** the next low-fi round starts from the locked draft

### Requirement: Hi-fi refinement
The hi-fi draft SHALL follow the locked direction and use the host's own components, styles and sample data, with one page for each state the screen needs. The owner SHALL be able to comment on parts of it; comments SHALL collect until the owner sends them, and the revised draft SHALL change only the parts commented on. A comment SHALL show as addressed once a revision has handled it, and as detached, not removed, when the part it was on can no longer be found.

#### Scenario: Two comments in one revision
- **WHEN** the owner comments on two parts of a hi-fi draft and sends them
- **THEN** the revised draft changes only those two parts, and both comments show as addressed

#### Scenario: Part gone
- **WHEN** a revision removes the part a comment was on
- **THEN** the comment shows as detached

### Requirement: Full-screen review
The owner SHALL be able to open any draft full-screen at phone or desktop width, and select and comment there as in the side-by-side view.

#### Scenario: Comment full-screen
- **WHEN** the owner opens a hi-fi draft full-screen at phone width and comments on a part
- **THEN** the comment is collected with the others for the next revision

### Requirement: Sign-off guides the build
The owner SHALL be able to sign off a screen's hi-fi pages in one click. The signed-off pages SHALL land in the change's folder on the base branch through a planning write, and the builder SHALL get them as the reference for that screen. Low-fi rounds and earlier hi-fi versions SHALL stay in Counterpoint and SHALL NOT be written to the host's repository.

#### Scenario: Build a signed-off screen
- **WHEN** the owner signs off a screen and the change is built
- **THEN** the builder's session gets the signed-off pages as the reference for that screen

#### Scenario: Rounds stay out of git
- **WHEN** a screen went through four low-fi rounds before sign-off
- **THEN** only the signed-off hi-fi pages are in the change's folder

### Requirement: Drafts hold the build
A change whose drafts were started SHALL NOT start building until every one of its screens is signed off and the signed-off pages are on the base branch. A run SHALL skip a held change, and Needs You SHALL show a card that names the screens still waiting and links to the change's drafts. The change SHALL show as waiting for sign-off wherever it is listed. The owner SHALL be able to drop a change's drafts, which ends the hold. A change whose drafts were never started SHALL build as before.

#### Scenario: Run skips a held change
- **WHEN** a run starts with an approved change whose Home screen is still in low-fi
- **THEN** the run does not build that change, and Needs You shows a card naming Home with a link to its drafts

#### Scenario: One click leaves a held change out
- **WHEN** the owner clicks Run while an approved change waits for sign-off
- **THEN** the run does not include that change and it does not count as ready to build; picked in the run form, it is skipped with the card

#### Scenario: Sign-off not landed yet
- **WHEN** the owner has signed off every screen but the planning write with the pages has not merged
- **THEN** the change is still held

#### Scenario: Signed off and landed
- **WHEN** every screen is signed off and the pages are on the base branch
- **THEN** the next run builds the change with the signed-off pages as its reference

#### Scenario: Drop drafts
- **WHEN** the owner drops a held change's drafts
- **THEN** the change is no longer held and builds without drafts

### Requirement: Design rules
Each host SHALL be able to have a design-rules file of layout and density rules. Every draft and every builder session SHALL be given the host's design rules.

#### Scenario: Rules reach the builder
- **WHEN** a host's design rules say forms group related fields
- **THEN** low-fi drafts, hi-fi drafts and builder sessions for that host all get that rule

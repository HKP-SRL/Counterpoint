# design-drafts Spec Delta

## MODIFIED Requirements

### Requirement: Static drafts
Every draft SHALL be a static HTML page: no scripts run in it, and nothing in it moves or responds to input. Each state of a screen SHALL be its own page. Drafts SHALL be served on a loopback origin separate from the console API. The console SHALL be the only page allowed to show a draft in a frame.

#### Scenario: A draft runs no scripts
- **WHEN** a generated draft contains a script
- **THEN** the script does not run when the draft is shown

#### Scenario: States are pages
- **WHEN** a hi-fi screen has an empty state and an error state
- **THEN** each state is its own static page

#### Scenario: Drafts show in the console
- **WHEN** the owner opens a change's Drafts page
- **THEN** each draft shows inside the console, side by side and full-screen

#### Scenario: Another page frames a draft
- **WHEN** a page that is not the console tries to show a draft in a frame
- **THEN** the browser refuses to show it

### Requirement: Sign-off guides the build
The owner SHALL be able to sign off a screen's hi-fi pages in one click. The signed-off pages SHALL land in the change's folder on the base branch through a planning write, and the builder SHALL get them as the reference for that screen. Each screen's sign-off SHALL land on its own: signing off one screen SHALL NOT block or change another screen's pages, and signing off a screen again after Unlock SHALL replace its earlier pages. Low-fi rounds and earlier hi-fi versions SHALL stay in Counterpoint and SHALL NOT be written to the host's repository. The builder's reference SHALL NOT be committed to the change's branch.

#### Scenario: Build a signed-off screen
- **WHEN** the owner signs off a screen and the change is built
- **THEN** the builder's session gets the signed-off pages as the reference for that screen

#### Scenario: Rounds stay out of git
- **WHEN** a screen went through four low-fi rounds before sign-off
- **THEN** only the signed-off hi-fi pages are in the change's folder

#### Scenario: Two screens signed off
- **WHEN** the owner signs off Home and then Settings of the same change
- **THEN** both screens' pages land on the base branch, and Home's pages are unchanged by Settings' sign-off

#### Scenario: Signed off again
- **WHEN** the owner unlocks a screen whose pages already landed, revises it and signs it off again
- **THEN** the new pages replace the earlier ones on the base branch

#### Scenario: Reference stays out of the PR
- **WHEN** a change with signed-off screens is built
- **THEN** its pull request holds no reference screenshots

### Requirement: Drafts hold the build
A change SHALL NOT start building until every screen its plan names as needing drafts, and every screen whose drafts were started, is signed off and has its signed-off pages on the base branch. A run SHALL skip a held change. Needs You SHALL show one card per held change that names the screens still waiting and offers Open drafts and Drop drafts. When a screen's sign-off cannot land, that card SHALL name the screen, say why in one line, and offer Retry and Cancel. The change SHALL show as waiting for sign-off wherever it is listed. The owner SHALL be able to drop a change's drafts, which ends the hold, also for screens the plan names. A change whose plan names no screens and whose drafts were never started SHALL build as before.

#### Scenario: Run skips a held change
- **WHEN** a run starts with an approved change whose Home screen is still in low-fi
- **THEN** the run does not build that change, and Needs You shows a card naming Home with Open drafts and Drop drafts

#### Scenario: Screen named in the plan
- **WHEN** an approved change's plan names a Home screen that needs drafts, and nobody has started drafts for it
- **THEN** a run does not build the change, and Needs You shows a card naming Home with Open drafts

#### Scenario: Start drafts from the plan
- **WHEN** the owner opens Drafts for a change whose plan names a Home screen
- **THEN** Home is in the screen list before the first round

#### Scenario: Sign-off not landed yet
- **WHEN** the owner has signed off every screen but the planning write with the pages has not merged
- **THEN** the change is still held

#### Scenario: Sign-off blocked
- **WHEN** GitHub refuses to merge the planning write with Home's signed-off pages because a review is needed
- **THEN** the change's card names Home, says a review is needed, and offers Retry and Cancel

#### Scenario: Cancel a blocked sign-off
- **WHEN** the owner picks Cancel on a blocked sign-off of Home
- **THEN** its pull request is closed, the base branch is unchanged, and Home is back in hi-fi, ready to sign off again

#### Scenario: Signed off and landed
- **WHEN** every screen is signed off and the pages are on the base branch
- **THEN** the next run builds the change with the signed-off pages as its reference

#### Scenario: Drop drafts
- **WHEN** the owner drops a held change's drafts, including a screen its plan names
- **THEN** the change is no longer held and builds without drafts

## ADDED Requirements

### Requirement: A missing browser can be fixed from its card
When Counterpoint finds no browser to measure drafts with, Needs You SHALL show a card that offers to install a browser for Counterpoint and to look again. Picking either SHALL measure the waiting drafts with no further step.

#### Scenario: No browser installed
- **WHEN** a low-fi round finishes on a machine with neither Playwright's Chromium nor Google Chrome
- **THEN** a card says the drafts cannot be shown yet and recommends installing a browser, and picking it installs the browser and the drafts show

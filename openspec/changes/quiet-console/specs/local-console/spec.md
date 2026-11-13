# local-console Spec Delta

## MODIFIED Requirements

### Requirement: Host-scoped navigation
The console SHALL show a host switcher with each host's name and base branch, and pages for Home (with a count of waiting items, hidden at zero), Changes and Settings. Browser Back SHALL always work.

#### Scenario: One host
- **WHEN** only one host is registered and the owner opens `/`
- **THEN** the console redirects to that host's Home page

#### Scenario: No Trust page
- **WHEN** the owner opens the console after the upgrade
- **THEN** the navigation has no Trust entry, and an old Trust link leads to the Home page

#### Scenario: Old Mission and Needs You links
- **WHEN** the owner opens a saved link to the Mission page or the Needs You page
- **THEN** the console shows the Home page

## ADDED Requirements

### Requirement: Changes in one line each
The Changes page SHALL show each change on one line: its title, its status and at most one action (Approve, Withdraw or Open drafts). Everything else about a change, such as its artifacts, task progress, dependencies and owner steps, SHALL be on the change's own page.

#### Scenario: Ready to approve
- **WHEN** a change is ready to approve
- **THEN** its line on Changes shows its title, "Ready to approve" and Approve, and nothing else

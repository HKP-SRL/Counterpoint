# local-console Spec Delta

## MODIFIED Requirements

### Requirement: Host-scoped navigation
The console SHALL show a host switcher with each host's name and base branch, and pages for Mission, Changes, Needs You (with a count badge hidden at zero) and Settings. Browser Back SHALL always work.

#### Scenario: One host
- **WHEN** only one host is registered and the owner opens `/`
- **THEN** the console redirects to that host's Mission page

#### Scenario: No Trust page
- **WHEN** the owner opens the console after the upgrade
- **THEN** the navigation has no Trust entry, and an old Trust link leads to the Mission page

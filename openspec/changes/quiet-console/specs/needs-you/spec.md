# needs-you Spec Delta

## MODIFIED Requirements

### Requirement: One inbox
The console SHALL keep one inbox of question cards, shown on the host's Home page in the order the home sets (cards that block work before other questions), each with an icon, a title and a detail line. The number of waiting items SHALL be shown on Home in the navigation and in the browser tab title. Items SHALL resolve themselves when their cause goes away; there is no manual dismiss for recomputed items. There SHALL be no separate Needs You page.

#### Scenario: Count badge
- **WHEN** two items are waiting
- **THEN** the navigation shows 2 on Home and the tab title starts with `(2)`

#### Scenario: Blocking card first
- **WHEN** a parked change's card and a newer reversible question are both open
- **THEN** the parked change's card comes first on the Home page

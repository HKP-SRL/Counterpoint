# needs-you Spec Delta

## MODIFIED Requirements

### Requirement: One inbox
The console SHALL keep one inbox of question cards, shown on the host's Home page in the order the home sets (cards that block work before other questions), each with an icon, a title and a detail line. The number of waiting items, in every project whichever project is open, SHALL be shown on Home in the navigation and in the browser tab title. When other projects have items waiting, the home SHALL say so with a link to each. Items SHALL resolve themselves when their cause goes away; there is no manual dismiss for recomputed items. There SHALL be no separate Needs You page.

#### Scenario: Count badge
- **WHEN** two items are waiting
- **THEN** the navigation shows 2 on Home and the tab title starts with `(2)`

#### Scenario: Items in another project
- **WHEN** the owner has Counterpoint open, nothing waits there, and Cena has two cards waiting
- **THEN** the navigation shows 2, and the home says two items wait in Cena with a link to Cena's home

#### Scenario: Blocking card first
- **WHEN** a parked change's card and a newer reversible question are both open
- **THEN** the parked change's card comes first on the Home page

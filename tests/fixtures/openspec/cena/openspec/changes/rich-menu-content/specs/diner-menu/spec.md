## ADDED Requirements

### Requirement: Rich item detail for diners
A diner viewing an item SHALL see its photo (when present), allergens, dietary tags, calories/macros and variants with their prices.

#### Scenario: Diner opens a rich item
- **WHEN** a diner opens an item that has a photo, two allergens, a vegan tag, nutrition and two sizes
- **THEN** all of these are shown, with variant prices formatted in the venue currency

### Requirement: Filter and identify by dietary tag or allergen
A diner SHALL be able to filter the menu by dietary tag and identify items containing a given allergen.

#### Scenario: Vegan filter
- **WHEN** a diner applies the vegan filter
- **THEN** only vegan items are listed, with a count and a way to clear the filter

#### Scenario: Allergens visible without filtering
- **WHEN** a diner browses a category
- **THEN** each item's allergens are identifiable from the list

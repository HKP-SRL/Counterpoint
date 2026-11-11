## ADDED Requirements

### Requirement: Item photo optimised for mobile
The system SHALL let an owner upload one photo per item and SHALL serve it in sizes optimised for fast mobile delivery; an item without a photo SHALL remain fully valid.

#### Scenario: Owner adds a photo
- **WHEN** an owner uploads a large photo for an item
- **THEN** diners on a phone receive a resized, compressed version appropriate to their screen

#### Scenario: No photo required
- **WHEN** an owner publishes items without photos
- **THEN** the menu publishes and renders without empty image slots

### Requirement: Allergen markers
The system SHALL let an owner mark on an item any of the 14 EU Annex II allergens.

#### Scenario: Owner marks allergens
- **WHEN** an owner marks an item as containing gluten and milk
- **THEN** the item records exactly those two allergens

### Requirement: Dietary tags
The system SHALL let an owner tag an item as vegetarian, vegan or gluten-free.

#### Scenario: Owner tags a vegan dish
- **WHEN** an owner tags an item vegan
- **THEN** the item carries the vegan tag

### Requirement: Calories and macros
The system SHALL let an owner record calories and macronutrients for an item.

#### Scenario: Owner records nutrition
- **WHEN** an owner enters calories, protein, carbohydrates and fat for an item
- **THEN** those values are saved on the item

### Requirement: Variants and modifiers with price differences
The system SHALL let an owner define variants and modifiers on an item, each with a price difference in the venue currency.

#### Scenario: Sizes with different prices
- **WHEN** an owner defines "Small" at the base price and "Large" at +800 HUF for a dish
- **THEN** both variants are saved with their price differences

### Requirement: Time-of-day menu scheduling
The system SHALL let an owner schedule a menu to be shown automatically during configured times of day.

#### Scenario: Lunch menu shows only at lunchtime
- **WHEN** a lunch menu is scheduled for 11:30–15:00 venue time
- **THEN** diners see it during that window and not outside it

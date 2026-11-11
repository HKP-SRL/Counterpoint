## ADDED Requirements

### Requirement: Owner manages menu categories
The system SHALL let an owner or manager create, rename, reorder and delete the categories of a menu in a venue they manage.

#### Scenario: Owner builds and reorders categories
- **WHEN** an owner creates the categories "Starters" and "Mains" and moves "Mains" above "Starters"
- **THEN** the menu lists "Mains" before "Starters" in both the editor and the published menu after publishing

#### Scenario: Owner deletes a category
- **WHEN** an owner deletes a category
- **THEN** the category no longer appears in the editor or, after publishing, on the diner menu

### Requirement: Owner manages menu items
The system SHALL let an owner or manager create, edit, reorder and delete items with a name, description and price expressed in the venue's currency.

#### Scenario: Owner adds a priced item
- **WHEN** an owner of a HUF venue adds the item "Gulyás" with a description and a price of 3200
- **THEN** the item is saved in its category and shown with the price formatted in HUF

#### Scenario: Owner reorders items
- **WHEN** an owner moves an item to the top of its category
- **THEN** the item appears first in that category

### Requirement: Multiple menus per venue
The system SHALL let an owner create more than one menu per venue (for example lunch, dinner and drinks), each with its own categories and items.

#### Scenario: Venue with lunch and drinks menus
- **WHEN** an owner creates a "Lunch" menu and a "Drinks" menu for one venue
- **THEN** both menus exist independently and each can be edited and published on its own

### Requirement: Draft and published states
The system SHALL keep owner edits in a draft that diners never see until the owner publishes it.

#### Scenario: Edit does not leak before publish
- **WHEN** an owner changes an item's price in a published menu but does not publish
- **THEN** diners still see the previously published price

### Requirement: Publishing makes a menu live
The system SHALL let an owner or manager publish a menu, making its current draft the version diners see.

#### Scenario: Owner publishes
- **WHEN** an owner publishes a menu with pending edits
- **THEN** a diner opening the venue's menu sees the edits

### Requirement: Availability toggle reflects quickly
The system SHALL let an owner, manager or staff member mark an item sold-out or available, and diners SHALL see the change within seconds without the menu being republished.

#### Scenario: Staff marks an item sold out mid-service
- **WHEN** a staff member marks an item sold-out from a phone
- **THEN** a diner viewing the menu sees the item marked sold-out within seconds

### Requirement: Staff cannot change prices or content
The system SHALL prevent a staff member from editing prices, item or category content, menus or venue settings, while still allowing the availability toggle.

#### Scenario: Staff has only the toggle
- **WHEN** a staff member opens the menu on the owner-side app
- **THEN** they can toggle availability, and no control to edit a price, name, description, category or setting is offered

#### Scenario: Direct write attempt is denied
- **WHEN** a staff member's session attempts to update an item's price through the API
- **THEN** the write is denied by the database

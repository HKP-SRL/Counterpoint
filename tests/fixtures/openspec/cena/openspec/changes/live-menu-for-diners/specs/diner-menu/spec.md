## ADDED Requirements

### Requirement: Fast first paint on poor mobile data
The diner menu SHALL render usable content on first response without client-side data fetching, and SHALL paint fast on a throttled poor mobile connection.

#### Scenario: Throttled connection
- **WHEN** a diner opens a published menu on a connection throttled to a poor mobile profile
- **THEN** the categories and items are readable from the first server response, within the agreed performance budget

### Requirement: Last-good fallback on network failure
If the network or backend fails while the menu loads, the diner SHALL see the last-good published version of the menu rather than a blank page or an error.

#### Scenario: Backend unreachable
- **WHEN** the backend is unreachable while a diner opens the menu
- **THEN** the last successfully published menu is shown, with the saved-menu notice from the diner design vocabulary

#### Scenario: Connection drops mid-load after a previous visit
- **WHEN** a diner who loaded the menu earlier loses the connection and reloads it
- **THEN** the previously loaded menu is shown instead of nothing

### Requirement: Browse categories and item detail
A diner SHALL be able to browse a menu's categories and open an item to see its details.

#### Scenario: Diner opens an item
- **WHEN** a diner taps an item in a category
- **THEN** the item's name, description and price (in the venue currency) are shown

#### Scenario: Sold-out item stays listed
- **WHEN** an item is marked sold-out
- **THEN** the diner still sees it listed, clearly marked sold-out

### Requirement: Diner menu ships no owner design-system code
The diner menu SHALL load no Astryx CSS or JavaScript.

#### Scenario: Build-output guard
- **WHEN** the production build is scanned for the diner routes' assets
- **THEN** no Astryx stylesheet or script is referenced

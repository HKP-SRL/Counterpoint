# diner-design-vocabulary Specification

## Purpose
The diner-facing vocabulary every menu surface renders against: the full EU allergen set, the diner copy deck in Hungarian, English and Romanian, and per-currency price display, defined before any diner screen is built.

## Requirements

### Requirement: Full EU allergen vocabulary
The system SHALL define exactly the 14 allergen categories of Regulation (EU) No 1169/2011 Annex II — gluten, crustaceans, eggs, fish, peanuts, soybeans, milk, nuts, celery, mustard, sesame, sulphites, lupin and molluscs — in the regulation's order, with peanuts and tree nuts as separate categories.

#### Scenario: The vocabulary is complete
- **WHEN** the allergen vocabulary is enumerated
- **THEN** it holds exactly 14 categories, and the check's failure message cites Annex II

#### Scenario: Peanuts are not tree nuts
- **WHEN** a dish is tagged with tree nuts
- **THEN** it is not thereby tagged with peanuts, because the two are distinct keys

### Requirement: Allergen labels in all three diner languages
The system SHALL label every allergen category in Hungarian, English and Romanian, with no label empty and the peanut label different from the tree-nut label in each language.

#### Scenario: A label is missing
- **WHEN** an allergen category lacks a non-empty label in hu, en or ro
- **THEN** the allergen vocabulary check fails and names the category and the language

### Requirement: Diner copy is complete in three languages
The system SHALL hold every diner-facing string of the diner copy deck in Hungarian, English and Romanian; only groups explicitly listed as owner-side — in v1 the unverified-field marker alone — are exempt.

#### Scenario: A diner string forgets a language
- **WHEN** a diner copy entry is added without one of hu, en or ro
- **THEN** the diner copy check fails and names the key and the missing language

### Requirement: Timestamped last-good menu notice
The system SHALL word the stale-menu notice in all three diner languages as a timestamped statement — in English "Saved menu from {HH:mm}. Prices and sold-out dishes may have changed." — that carries a time placeholder, warns that prices and sold-out dishes may have changed, and promises nothing about reconnecting or coming back online.

#### Scenario: The notice is specific
- **WHEN** the last-good notice is read in hu, en or ro
- **THEN** it contains the `{HH:mm}` placeholder

#### Scenario: No reconnect promise
- **WHEN** the last-good notice is read in any diner language
- **THEN** it contains no wording about being back online or reconnecting

### Requirement: Allergen disclaimer and empty state
The system SHALL provide, in all three diner languages, an allergen disclaimer that places the allergen declaration with the kitchen and asks the diner to tell their server about an allergy, and an explicit empty-allergen state ("No allergens marked.") instead of a blank.

#### Scenario: Disclaimer and empty state exist
- **WHEN** the diner copy deck is read in hu, en or ro
- **THEN** both the allergen disclaimer and the empty-allergen state are present and non-empty

### Requirement: Language-detection disclosure
The system SHALL provide, in all three diner languages, a disclosure telling the diner that the menu language was set from their phone's language and that they can change it whenever they like.

#### Scenario: Disclosure exists
- **WHEN** the diner copy deck is read in hu, en or ro
- **THEN** the language-detection disclosure is present and non-empty

### Requirement: Per-currency price display
The system SHALL format prices by the venue's currency — HUF with no decimals ("148 500 Ft", and "7900 Ft" ungrouped at four digits), RON with the narrow symbol ("1.903,85 lei"), EUR with a decimal comma and trailing sign ("20,26 €") — and SHALL refuse any other currency code instead of rendering a fallback.

#### Scenario: Forint has no decimals
- **WHEN** 148500 is formatted in HUF
- **THEN** the result is "148 500 Ft" with no decimal separator

#### Scenario: Leu uses the narrow symbol
- **WHEN** 1903.85 is formatted in RON
- **THEN** the result is "1.903,85 lei", not a string containing "RON"

#### Scenario: Unsupported currency
- **WHEN** a price is formatted in a currency other than RON, HUF or EUR
- **THEN** formatting throws instead of rendering a value

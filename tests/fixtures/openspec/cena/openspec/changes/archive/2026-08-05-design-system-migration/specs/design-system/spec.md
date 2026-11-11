## Purpose
Cena's product-brand design system: one token source, self-hosted typefaces, accessible primitives on Radix behaviour, a venue-themable token contract held to WCAG AA, and the copy discipline every owner surface follows.

## ADDED Requirements

### Requirement: Cena tokens are the single styling source
The system SHALL resolve every semantic colour role the UI uses (background, foreground, primary, muted, border, ring, destructive and the rest) to a Cena product-brand token, and SHALL render no page, layout or component with a raw hex colour or a stock Tailwind palette class.

#### Scenario: Semantic roles point at brand tokens
- **WHEN** the stylesheet entry point is read
- **THEN** every semantic colour role is mapped to a `--cena-*` token
- **AND** the entry point declares no colour value of its own

#### Scenario: Surfaces carry no raw colour
- **WHEN** every page, layout and component file is scanned
- **THEN** none contains a raw hex colour or a stock palette class such as `bg-zinc-*` or `text-green-*`

### Requirement: Raw ramp names stay in the brand token file
The system SHALL name raw Cena ramp steps (`szeged-`, `napfeny-`, `paprika-` or `tisza-` followed by a step number) only in the product-brand token file `app/tokens/cena.css`; every other source file SHALL use semantic token names, so any colour can later be re-mapped by a theme.

#### Scenario: A surface names a ramp step
- **WHEN** a source file other than the product-brand token file references a ramp step such as `tisza-100`
- **THEN** the design-system discipline check fails and names the file

### Requirement: Self-hosted typefaces with Romanian and Hungarian coverage
The system SHALL set type in Newsreader (headings and display), Instrument Sans (body and labels) and IBM Plex Mono (prices and machine-like strings), self-hosted from the app's own origin with the latin and latin-ext subsets so every Romanian (ă â î ș ț) and Hungarian (ő ű) diacritic has a glyph, and SHALL ship roman styles only.

#### Scenario: Fonts are served locally
- **WHEN** the production build's compiled CSS is inspected
- **THEN** every font `url()` resolves to a local `.woff2` file

#### Scenario: Diacritic subsets are requested
- **WHEN** the font configuration is read
- **THEN** all three families request both the latin and latin-ext subsets

### Requirement: No third-party font or asset request
The system SHALL request no font, stylesheet, image or script from a third-party origin on any page, except the Google Identity Services client script that Google sign-in needs, which is the single allow-listed origin.

#### Scenario: A new external origin appears in source
- **WHEN** source code introduces an asset URL on any origin other than the allow-listed one
- **THEN** the asset-privacy check fails until the origin is added to the allow-list with a written reason

#### Scenario: Compiled CSS contains no absolute URL
- **WHEN** the production build's compiled CSS is scanned
- **THEN** it contains no absolute URL
- **AND** the check fails rather than skips when no build exists

### Requirement: Utility CSS compiles only from policed source
The build SHALL generate utility CSS only from the application source directories (`app`, `components`, `lib`, `actions`), with automatic source detection off, and that set SHALL equal the set the design-system checks scan, so text in documentation or other non-source files can never emit CSS into the app.

#### Scenario: A document contains utility-like text
- **WHEN** a markdown document in the repository contains a bracketed utility-like string
- **THEN** the compiled stylesheet contains no rule generated from it
- **AND** the build reports no CSS warning

#### Scenario: Compiled and scanned sets drift apart
- **WHEN** the stylesheet's declared source directories differ from the directories the design-system checks scan
- **THEN** the discipline check fails

### Requirement: 44px touch floor
The system SHALL give every interactive control on every surface — buttons, checkboxes, radio items, switches, tabs, select triggers and menu rows — a hit area of at least 44 by 44 CSS pixels, by painted size or by a hit-area expander; display-only elements such as status badges and PIN dots are exempt.

#### Scenario: A primitive falls under the floor
- **WHEN** a primitive's base size or its hit-area expander arithmetic yields less than 44px
- **THEN** the touch-target check fails and names the primitive and the measured size

### Requirement: Primitives carry the Cena language on Radix behaviour
The system SHALL provide nineteen primitives — alert, avatar, badge, button, card, checkbox, dialog, dropdown menu, field, input, label, radio group, select, separator, switch, tabs, tag, toast and tooltip — styled with Cena tokens while focus management, keyboard navigation and ARIA semantics come from Radix unchanged.

#### Scenario: Behaviour survives the re-skin
- **WHEN** the test suite that predates the re-skin runs against the re-skinned primitives
- **THEN** it passes with no pre-existing assertion added, removed or reworded

### Requirement: Glyphs draw at a 1.75 stroke through one wrapper
The system SHALL draw every icon glyph through a single icon wrapper that pins the Lucide stroke width to 1.75, and no source file SHALL render a Lucide glyph as a bare element.

#### Scenario: A bare glyph is rendered
- **WHEN** a source file renders an imported Lucide glyph directly instead of through the wrapper
- **THEN** the design-system discipline check fails and names the file and the glyph

### Requirement: Venue-themable token contract
The system SHALL keep a venue-themable token namespace (`--venue-*`) separate from Cena's fixed product-brand tokens; every venue token SHALL hold a six-digit hex value and SHALL reference no Cena ramp identifier. In v1 no surface consumes the venue namespace.

#### Scenario: A brand ramp leaks into the venue namespace
- **WHEN** a venue token references a Cena ramp name such as `--szeged-700`
- **THEN** the token-boundary check fails

#### Scenario: A venue token uses another notation
- **WHEN** a venue token is declared with three-digit shorthand or a non-hex colour notation
- **THEN** the token-boundary check fails

### Requirement: Theme colours are held to WCAG AA
The system SHALL hold every real text/background pair of the curated theme set — in v1 only Cena's own palette — to at least 4.5:1, and control boundaries, focus rings and status rules to at least 3:1, measured on every test run from the token values in the stylesheet, and SHALL refuse any pair below its threshold.

#### Scenario: A palette value is degraded
- **WHEN** a product-brand token value is edited so a measured pair drops below its threshold
- **THEN** the contrast sweep fails and names the pair, the measured ratio and the threshold

#### Scenario: A near-miss pair is refused
- **WHEN** `#777777` text on `#FFFFFF` (4.478:1) is checked against the text threshold
- **THEN** it is refused

### Requirement: WCAG contrast is computed exactly
The system SHALL compute contrast ratios with the WCAG 2.1 relative-luminance formula applied to all three colour channels, and SHALL reject a malformed colour — three-digit shorthand, a missing `#`, or non-hex characters — with an error naming the value instead of coercing it.

#### Scenario: Known reference ratios
- **WHEN** black on white, `#767676` on white and `#777777` on white are measured
- **THEN** the ratios are 21.00, 4.542 and 4.478 respectively

#### Scenario: Shorthand hex is rejected
- **WHEN** `#fff` is passed as a colour
- **THEN** the computation throws an error that names `#fff`

### Requirement: The UI ignores the device dark-mode preference
The system SHALL render every surface in the light palette regardless of the device's colour-scheme preference: dark styling is reachable only through an explicit class, no `prefers-color-scheme` rule reaches a venue token, and toasts are pinned to the light theme.

#### Scenario: A device prefers dark
- **WHEN** a page or a toast renders on a device whose colour-scheme preference is dark
- **THEN** it renders in the light palette

### Requirement: Animated primitives honour reduced motion
The system SHALL stop primitive animations and transitions when the user prefers reduced motion, and animated primitives SHALL take their durations from the motion tokens rather than from hard-coded values.

#### Scenario: Reduced motion is requested
- **WHEN** the user's system requests reduced motion and a select, tooltip, dialog or dropdown menu opens
- **THEN** it appears without animation

#### Scenario: A hard-coded duration is introduced
- **WHEN** an animated primitive declares a numeric duration instead of a motion token
- **THEN** the design-system discipline check fails

### Requirement: Unverified AI-filled field marker
The system SHALL define an owner-side "Unverified" marker for AI-filled fields as a tag in the napfeny warning style — warning-soft fill, warning-border rule, warning-ink label text at 9.71:1 — with English owner copy: the tag "Unverified", the helper "Filled by AI. Check it before you publish.", a publish-blocked message carrying the field count, and a past-tense "Confirmed".

#### Scenario: The marker is owner-side only
- **WHEN** the diner copy deck is checked for three-language completeness
- **THEN** the unverified-marker copy is the only group exempted, and it stays English-only

#### Scenario: Marker contrast
- **WHEN** the warning-ink on warning-soft pair is measured
- **THEN** it clears the 4.5:1 text threshold

### Requirement: Every owner copy string has a contract row
The system SHALL draw every user-visible string in the owner copy deck from a row in the copywriting contract of a UI contract under `docs/design/`, and SHALL keep the shared sign-up and sign-in failure message one ambiguous string that does not reveal whether an account exists.

#### Scenario: A string ships without a row
- **WHEN** a string is added to the owner copy deck without a matching copywriting-contract row
- **THEN** the copy-contract check fails and names the key

#### Scenario: Sign-in failure stays ambiguous
- **WHEN** sign-up or sign-in fails for any credential reason
- **THEN** the message shown is "That email or password isn't right. Check and try again, or reset your password."

### Requirement: Owner copy uses menu-tier vocabulary
The system SHALL keep the restaurant-service lexicon that belongs to tiers Cena does not build — covers, turns, the pass, fired, 86'd, the book, walk-in, close out — out of every user-visible string in the owner copy deck.

#### Scenario: A service-tier word reaches the deck
- **WHEN** a user-visible owner string contains one of the dropped terms
- **THEN** the copy-contract check fails and names the key and the term

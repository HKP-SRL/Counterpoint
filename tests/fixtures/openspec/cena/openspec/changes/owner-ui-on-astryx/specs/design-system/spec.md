## MODIFIED Requirements

### Requirement: Self-hosted typefaces with Romanian and Hungarian coverage
The system SHALL set type in Newsreader (diner headings and display, and on owner screens only the wordmark and the page's level-1 title), Instrument Sans (body, labels and every other owner heading) and IBM Plex Mono (prices and machine-like strings), self-hosted from the app's own origin with the latin and latin-ext subsets so every Romanian (ă â î ș ț) and Hungarian (ő ű) diacritic has a glyph, and SHALL ship roman styles only.

#### Scenario: Fonts are served locally
- **WHEN** the production build's compiled CSS is inspected
- **THEN** every font `url()` resolves to a local `.woff2` file

#### Scenario: Diacritic subsets are requested
- **WHEN** the font configuration is read
- **THEN** all three families request both the latin and latin-ext subsets

#### Scenario: Owner section heading
- **WHEN** an owner page renders a level-2 heading
- **THEN** it is set in Instrument Sans while the page's level-1 title stays in Newsreader

### Requirement: 44px touch floor
The system SHALL give every interactive control on diner surfaces, and every owner control under a coarse pointer, a hit area of at least 44 by 44 CSS pixels, with owner controls visibly 44px tall on phones and tablets through theme size tokens; owner controls under a fine pointer use 32 or 36px heights; tablet name tiles stay at least 96px and PIN keys at least 64px; display-only elements such as status badges and PIN dots are exempt.

#### Scenario: A primitive falls under the floor
- **WHEN** a diner primitive's base size or its hit-area expander arithmetic yields less than 44px
- **THEN** the touch-target check fails and names the primitive and the measured size

#### Scenario: Coarse-pointer owner controls fall under the floor
- **WHEN** the built owner theme's coarse-pointer block sets a control size token below 44px
- **THEN** the touch-target check fails and names the token and the measured size

#### Scenario: Kiosk scale shrinks
- **WHEN** a tablet name tile falls below 96px or a PIN key below 64px
- **THEN** the touch-target check fails

### Requirement: Glyphs draw at a 1.75 stroke through one wrapper
The system SHALL draw every Cena-authored icon glyph through a single icon wrapper that pins the Lucide stroke width to 1.75, SHALL draw every icon a library component renders through the owner theme's icon registry at the same 1.75 stroke, and no other source file SHALL render a Lucide glyph as a bare element.

#### Scenario: A bare glyph is rendered
- **WHEN** a source file renders an imported Lucide glyph directly instead of through the wrapper
- **THEN** the design-system discipline check fails and names the file and the glyph

#### Scenario: A registry entry drifts
- **WHEN** an entry of the owner theme's icon registry is drawn at a stroke other than 1.75 or a semantic icon name is missing
- **THEN** the design-system discipline check fails

### Requirement: The UI ignores the device dark-mode preference
The system SHALL render every surface in the light palette regardless of the device's colour-scheme preference: dark styling is reachable only through an explicit class, no `prefers-color-scheme` rule reaches a venue token, and the owner Astryx theme is pinned to light mode.

#### Scenario: A device prefers dark
- **WHEN** a diner or owner page renders on a device whose colour-scheme preference is dark
- **THEN** it renders in the light palette

### Requirement: Animated primitives honour reduced motion
The system SHALL stop animations and transitions when the user prefers reduced motion, and animated components SHALL take their durations from the motion tokens rather than from hard-coded values, with no owner transition longer than 240ms.

#### Scenario: Reduced motion is requested
- **WHEN** the user's system requests reduced motion and an owner menu, side sheet or dialog opens
- **THEN** it appears without animation

#### Scenario: A hard-coded duration is introduced
- **WHEN** an animated component declares a numeric duration instead of a motion token
- **THEN** the design-system discipline check fails

## REMOVED Requirements

### Requirement: Primitives carry the Cena language on Radix behaviour
**Reason**: `owner-ui-on-astryx` moves every owner surface onto Astryx components wearing one built Cena theme and deletes the shadcn/Radix kit (`components/ui/*`, `radix-ui`, `shadcn`, `sonner`, `tw-animate-css`); no surface consumes those primitives any more.
**Migration**: Owner surfaces use Astryx plus the Cena owner kit (see the `owner-ui` capability: one built Cena theme, no shadcn or Radix primitives). The diner keeps its tag primitive, moved verbatim to `components/diner/tag.tsx`; a future diner dialog uses the native `<dialog>` element.

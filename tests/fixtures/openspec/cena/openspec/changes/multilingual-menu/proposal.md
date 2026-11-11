## Why

Cena's markets are multilingual (Hungarian, Romanian, English, plus tourists). An owner should author the menu once, have AI pre-fill every other enabled language with one button, and keep the final word: every AI translation stays editable, and once the owner edits or confirms it, it is locked and never overwritten by a later re-translation — curated culinary terms are the edge, live machine translation on render is out of scope. Diners get the menu in their own language automatically, with a manual switcher. This is "AI drafts, the restaurant decides" applied to language, and a prerequisite for multilingual AI ingestion output.

## What Changes

- Owners enable the set of languages a venue supports and author content in one primary language.
- One-button AI translation pre-fills all other enabled languages.
- Owners edit any AI translation; edited or confirmed translations are locked from re-translation.
- Diner language auto-detected from the browser on first open, with a manual switcher that overrides it for the visit.

## Capabilities

### New Capabilities

- `menu-translation`: venue languages, primary-language authoring, AI pre-fill and owner-locked translations (LANG-01, LANG-02, LANG-03, LANG-04).

### Modified Capabilities

- `diner-menu`: diner language detection and manual switching (LANG-05, LANG-06).

## Impact

- Depends on `live-menu-for-diners` (content to translate); benefits from `rich-menu-content`.
- Normalised translations table with per-field status (machine draft / human edited / confirmed) and source (manual / AI ingestion / AI translation), per docs/research/ARCHITECTURE.md; covered by the isolation suite.
- Server-side LLM call for translation (see docs/research/STACK.md); diner language switcher pattern and three-language diner copy from `design-system-migration`.
- Astryx built-in component strings are English only — see the backlog item on Romanian and Hungarian strings if the owner UI is localised in this change.

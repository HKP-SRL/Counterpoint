## Why

Self-serve onboarding dies when an owner faces typing in 100+ dishes; AI ingestion is the mechanism that makes it complete, and the #1 business feature. Venues on paper menus already have the whole menu laid out and priced: photograph it and Cena has it. It builds last only because it must write validated data into the full menu, media, translation and publish schema — a sequencing constraint, not a priority demotion. With EU allergen liability sitting on the restaurant, AI-filled allergen and macro fields must never reach diners unconfirmed: correction UX and confirmation quality are the feature, not extraction accuracy alone.

## What Changes

- Owners upload a photo or a PDF of an existing menu and get a structured draft (categories, items, prices, descriptions).
- Extraction runs as a resumable background job with visible progress; a single failure does not fail the whole menu.
- The AI attempts allergens and macros where inferable; every AI-filled field is visibly marked unverified until the owner confirms it.
- A dedicated correction interface for reviewing and fixing the draft before anything is published.
- Publishing is blocked while any AI-filled allergen or macro field is unconfirmed; each must be confirmed explicitly, field by field.
- Manual entry remains a complete alternative to ingestion.
- Website and delivery-platform sources (INGEST-08/09/10, with owner attestation of rights) are a v1.1 fast-follow and out of scope here (see docs/backlog.md).

## Capabilities

### New Capabilities

- `menu-ingestion`: photo/PDF ingestion, background extraction jobs, unverified-field marking, the correction interface and the per-field confirmation publish gate (INGEST-01 … INGEST-07).

### Modified Capabilities

- `menu-management`: publishing gains the unverified-AI-field gate (INGEST-06).

## Impact

- Depends on `live-menu-for-diners`, `rich-menu-content` and `multilingual-menu` (full menu, media and translation schema); benefits from `menu-theming-and-templates`.
- `ingestion_jobs` queue with step-based resumability and a scheduled retry poller (docs/research/ARCHITECTURE.md); vision LLM with structured outputs (docs/research/STACK.md); drafts written with `source = ai` on allergens/macros and machine-draft translations.
- Uses the owner-side unverified-AI-field marking defined by `design-system-migration`; correction UI built on Astryx.
- Release gate: an automated test proves a menu with any unconfirmed AI-filled allergen or macro field cannot be published.
- Pitfalls to design against: correction-UI abandonment and blind rubber-stamping of allergens (docs/research/PITFALLS.md).

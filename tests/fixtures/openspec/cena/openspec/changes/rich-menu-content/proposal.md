## Why

A bare list of names and prices is barely better than a PDF. Owners need to enrich each dish with a photo, allergens, dietary tags, calories/macros and priced variants, and to schedule menus by time of day; diners need to see that detail and to filter by dietary need or allergen. This depth — and the media pipeline behind it — is also a prerequisite for AI ingestion, which needs somewhere to write allergens, macros, variants and photos.

## What Changes

- Photo per item, optimised (responsive transforms) so it loads fast on mobile; photos are an upgrade, never required.
- Allergen markers (the 14 EU Annex II allergens from the diner design vocabulary) and dietary tags (vegetarian, vegan, gluten-free) per item.
- Calories and macros per item.
- Variants and modifiers with price differences (sizes, portions, extras).
- Time-of-day scheduling so a menu appears automatically during its service hours.
- Diner item detail shows photo, allergens, dietary tags, calories/macros and variants; diners can filter or identify items by dietary tag or allergen.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `menu-management`: adds photos, allergens, dietary tags, calories/macros, variants/modifiers and scheduling (MENU-03, MENU-04, MENU-05, MENU-06, MENU-07, MENU-09). Added on top of the requirements introduced by `live-menu-for-diners`.
- `diner-menu`: adds rich item detail and dietary/allergen filtering (DINE-05 detail fields, DINE-06).

## Impact

- Depends on `live-menu-for-diners`.
- Supabase Storage + image transforms for item photos; new columns/tables for allergens, dietary tags, nutrition, variants/modifiers and menu schedules, each covered by the role x venue isolation suite.
- Uses the allergen/dietary display patterns and the 14-key allergen vocabulary from `design-system-migration`.
- Allergen and macro fields carry a source (manual vs AI) from the start so `ai-menu-ingestion` can gate publishing on unverified AI values (see docs/research/ARCHITECTURE.md).

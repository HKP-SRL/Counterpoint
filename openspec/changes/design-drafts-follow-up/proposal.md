# Design Drafts Follow-up

## Why

`design-drafts` is being built from its plan as it stood when the build started. A review against the code found gaps that would stop drafts from working end to end: the console's security headers block the draft frames, signing off a second screen blocks forever, nothing holds a change whose drafts were never started, and the cards it needs cannot be built from the card catalog. This change carries those fixes, so the plan being built stays as it is.

## What Changes

- **Drafts show in the console.** The console allows frames from the draft server only, and the draft server lets only the console frame it.
- **Each screen signs off alone.** A screen's sign-off writes only its own folder, styles included. Signing off two screens, or the same screen again after Unlock, never blocks.
- **A blocked sign-off shows.** The change's hold card names the screen whose sign-off cannot land, says why, and offers Retry and Cancel.
- **The plan can name its screens.** A change whose plan names the screens that need drafts is held until those screens are signed off and on the base branch, even before anyone starts drafts. Starting drafts begins from those screens.
- **Cards that can be answered.** The hold card offers Open drafts and Drop drafts. The no-browser card offers to install a browser or look again.
- **The builder's reference stays out of the worktree.** Reference screenshots are made in the run's folder under the Counterpoint home, and the builder gets their full paths.
- **The render command uses pinned tools only.**

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `design-drafts` (added by `design-drafts`): drafts are framed by the console only; screens sign off independently; a screen the plan names holds the build; the hold card and the no-browser card can be answered.
- `local-console`: the console's security policy allows frames from the draft server and nothing else.

## Impact

- **Depends on** `design-drafts`: built after it merges, archived after it.
- **Server:** the console's security headers and the draft server's headers.
- **Drafts:** the sign-off write, the hold check and its card, the reference screenshots.
- **Adapter:** reads `x-drafts` from a change's `.openspec.yaml`. Older daemons ignore the key, as they ignore every unknown key there.
- **Cards:** new actions in the fixed catalog.
- **Spike outputs:** timings and render notes live in `docs/research/drafts-render.md`; Cena's render script is Cena work.

# design-drafts Spec Delta

## Purpose
Standalone screen drafts the owner can review and steer before a change is built: rendered in the host's own design system with fixture data, commented on element by element, revised, varied and finally signed off.

## ADDED Requirements

### Requirement: Drafts for a change
The owner SHALL be able to request screen drafts for a change. Drafts SHALL be standalone local HTML with fixture data, styled in the host's own design system, and served from an origin isolated from the console API so draft scripts cannot reach console cookies.

#### Scenario: Request drafts
- **WHEN** the owner requests drafts for a change with two screens
- **THEN** two standalone HTML drafts are served on the draft origin, not the console origin

### Requirement: Viewport and state toggles
Each draft SHALL toggle between mobile and desktop viewports and between empty, loading, error and long-text states.

#### Scenario: Long-text state
- **WHEN** the owner switches a draft to the long-text state
- **THEN** the draft renders with long fixture text

### Requirement: Wire then full render
Drafts SHALL be explored in a low-fi wire mode (neutral palette, real layout and components); the chosen draft SHALL be re-rendered as a hi-fi full render with the host's tokens and fixtures.

#### Scenario: Promote a wire draft
- **WHEN** the owner chooses a wire draft
- **THEN** a full render of it is produced with the host's tokens

### Requirement: Element-pinned comments
The owner SHALL be able to click any element of a draft and pin a comment to it. Pins SHALL stay anchored across redraws through stable element ids, falling back to text matching, and SHALL show as detached rather than disappear when no anchor is found. The draft file on disk SHALL stay unmodified by the overlay.

#### Scenario: Pin survives a redraw
- **WHEN** a draft is redrawn and the pinned element keeps its id
- **THEN** the pin is still attached to that element

### Requirement: Batched revisions
The owner SHALL be able to batch several pins and send them as one revision; the agent SHALL change only the targeted parts.

#### Scenario: Two pins in one revision
- **WHEN** the owner sends two pins as one revision
- **THEN** the revised draft changes only those two regions

### Requirement: Comment threads
Comments SHALL be threads the owner can resolve or reopen.

#### Scenario: Resolve a thread
- **WHEN** the owner resolves a pin's thread
- **THEN** it shows as resolved and can be reopened

### Requirement: Redraw with a steering note
The owner SHALL be able to redraw a whole draft with a steering note.

#### Scenario: Redraw
- **WHEN** the owner asks for a redraw with the note "denser, fewer cards"
- **THEN** a new version of the draft is produced following the note

### Requirement: Variants and More like B
The owner SHALL be able to ask for 2-3 variants side by side, pick one, or say "More like B" (optionally with a steering note) to get a new round anchored on B. A breadcrumb trail (A/B/C, then B, then B2) SHALL show the path and let the owner back up.

#### Scenario: Back up the trail
- **WHEN** the owner is on round B2 and clicks B in the breadcrumb
- **THEN** round B is shown again and a new round can start from it

### Requirement: Sign-off joins the runway approval
The owner SHALL sign off the full render as part of the change's runway approval; the signed render becomes the visual gate's reference.

#### Scenario: Approve with a draft
- **WHEN** the owner approves a change that has a chosen full render
- **THEN** the approval summary includes the render and the statement binds it

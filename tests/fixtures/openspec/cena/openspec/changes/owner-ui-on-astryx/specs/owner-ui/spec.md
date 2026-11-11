## ADDED Requirements

### Requirement: Diner routes ship zero Astryx bytes
The system SHALL ship no Astryx CSS and no Astryx JS on any route outside the owner route groups (auth, dashboard, tablet), and SHALL prove it with an automated guard over the production build output that also checks an owner route as a positive control.

#### Scenario: Non-owner route is clean
- **WHEN** the production build is scanned for Astryx layer blocks, Astryx or StyleX package strings and harvested Astryx class names
- **THEN** every non-owner page route, including `/_not-found` and any future diner route, is reported clean

#### Scenario: Owner positive control
- **WHEN** the same scan inspects `/login`
- **THEN** it reports Astryx present, and every owner page route carries the Astryx stylesheet

#### Scenario: A diner route gains Astryx
- **WHEN** a change makes a non-owner route reference an Astryx stylesheet or script
- **THEN** the build-output guard fails and names the route

### Requirement: The build-output guard fails rather than skips
The system SHALL make the route-isolation guard fail, never skip, when there is no build to inspect, when fewer than 100 Astryx class names can be harvested from the installed stylesheet, or when a non-owner page route has no prerendered HTML to inspect.

#### Scenario: No build present
- **WHEN** the guard runs without a production build
- **THEN** it fails with a diagnosis saying a build is missing

#### Scenario: Unscannable non-owner route
- **WHEN** a non-owner page route has no prerendered HTML in the build output
- **THEN** the guard fails and names the route

### Requirement: Astryx enters only through owner route-group layouts
The system SHALL load Astryx CSS and its theme provider only through the auth, dashboard and tablet route-group layouts; the root layout, the global stylesheet, shared libraries and Server Actions SHALL import nothing from Astryx, and no source file SHALL import the Astryx root barrel.

#### Scenario: Root layout imports Astryx
- **WHEN** the root layout, `lib/` or `actions/` imports an Astryx module, the owner stylesheet or the owner providers
- **THEN** the static import-boundary check fails and names the file

#### Scenario: Global stylesheet stays package-free
- **WHEN** the global stylesheet is read
- **THEN** its only Astryx-related content is the cascade-layer order line placed above the Tailwind import

### Requirement: Exactly one built Cena Astryx theme
The system SHALL render every owner surface with one Cena Astryx theme in light mode, built ahead of time with its generated output committed and checked for drift on every CI run; no stock Astryx theme, runtime-defined theme or Astryx stylesheet bridge SHALL ship.

#### Scenario: Built output drifts from source
- **WHEN** the committed theme output no longer matches what the theme source builds
- **THEN** the theme drift check fails

#### Scenario: Stock theme imported
- **WHEN** a file imports the stock neutral theme stylesheet, its font stylesheet or the Astryx Tailwind bridge
- **THEN** the static import-boundary check fails

### Requirement: Theme colours reference Cena tokens only
The system SHALL derive every colour role the owner UI renders from the Cena token ramp by reference or by a colour-mix of a Cena reference, never from a copied or inherited hex value; hue, data and syntax roles that no owner surface renders MAY stay unmapped only while no owner file requests a hued variant.

#### Scenario: Leak of an inherited hex
- **WHEN** the built theme declares a colour role whose value is a hex or anything other than a Cena reference, a colour-mix of one, or an allowlisted unrendered role
- **THEN** the theme-output check fails and names the role

#### Scenario: Hued variant requested
- **WHEN** an owner file passes a hued variant or colour to a badge, token, text, heading or clickable card
- **THEN** the static usage check fails

### Requirement: Every rendered Astryx colour pair meets WCAG AA
The system SHALL measure every Astryx text/background, control-boundary and focus pair the owner side renders, resolved through the real Cena token values and over the backdrop each translucent overlay renders on, at 4.5:1 for text and 3:1 for non-text, with zero failures and without weakening a threshold.

#### Scenario: Full sweep passes
- **WHEN** the Astryx contrast sweep evaluates its 39 measurements
- **THEN** every measurement meets its threshold, and decorative dividers and disabled text are listed as named WCAG exemptions

#### Scenario: A mapping degrades a pair
- **WHEN** a theme mapping makes a rendered pair fall below its threshold
- **THEN** the sweep fails and names the pair, both resolved colours and the ratio

### Requirement: Owner typography uses four sizes and two weights
The system SHALL render owner text only at 14, 16, 20 and 28 pixels and only at weights 400 and 600, mapping every Astryx text role, font-size step and weight token onto those values in every media state, with body and heading families set to Instrument Sans and code to IBM Plex Mono.

#### Scenario: An off-scale size appears
- **WHEN** any media block of the built theme declares a text or font size outside 14, 16, 20 and 28 pixels or a weight other than 400 or 600
- **THEN** the theme-output check fails

### Requirement: Serif is reserved for the wordmark and the page title
The system SHALL set Newsreader on owner screens only for the wordmark and each page's single level-1 heading, render every other owner heading in Instrument Sans, and leave diner heading rendering unchanged.

#### Scenario: Owner section heading
- **WHEN** an owner page renders a level-2 heading
- **THEN** it is set in Instrument Sans

#### Scenario: Diner headings untouched
- **WHEN** a non-owner page renders headings level 2 to 6
- **THEN** they keep the serif face from the global stylesheet

#### Scenario: Library level-1 heading used
- **WHEN** an owner file renders the library heading component at level 1
- **THEN** the static usage check fails

### Requirement: Control size adapts to the pointer
The system SHALL render owner controls at the library's 32 or 36 pixel heights under a fine pointer and visibly at 44 pixels under a coarse pointer on phones and tablets, through theme size tokens, and SHALL never author the 28 pixel small size on an owner surface.

#### Scenario: Coarse pointer
- **WHEN** an owner surface renders on a device whose primary pointer is coarse
- **THEN** small, medium and large controls are each at least 44 pixels tall

#### Scenario: Fine pointer
- **WHEN** an owner surface renders with a mouse or trackpad
- **THEN** controls use the 32 and 36 pixel heights and no 44 pixel override applies

#### Scenario: Small size authored
- **WHEN** an owner file sets a control to the small size
- **THEN** the static usage check fails

### Requirement: The shared tablet keeps its kiosk scale
The system SHALL render tablet name tiles at least 96 pixels tall and 128 pixels wide and PIN keys at least 64 pixels square, sized through tokens scoped to their containers rather than padding.

#### Scenario: Kiosk minimums
- **WHEN** the tablet name grid and PIN pad source are checked
- **THEN** tiles are at least 96 by 128 pixels, keys at least 64 pixels, and no tile or key is sized by a padding utility

### Requirement: Owner motion is capped and honours reduced motion
The system SHALL transition every owner state change — hover, press, focus, menus, sheets, dialogs, list rows — within 240ms, SHALL run no decorative, page-level, shimmer or celebratory motion, and SHALL zero every transition when the user prefers reduced motion, keeping shared duration tokens equal-valued with Cena's in both states.

#### Scenario: Duration cap
- **WHEN** the built theme is read in every media state
- **THEN** no duration token exceeds 240ms

#### Scenario: Reduced motion
- **WHEN** the user's system requests reduced motion and a sheet, menu or dialog opens
- **THEN** it appears without animation, and the slow duration token is 0ms on both the Cena and the Astryx side

### Requirement: One icon language at a 1.75 stroke
The system SHALL draw every owner icon, including every icon a library component draws for itself, as a Lucide glyph at a 1.75 stroke, by overriding all semantic icon slots of the theme and routing Cena-authored glyphs through one owner glyph wrapper.

#### Scenario: Theme slots overridden
- **WHEN** the theme icon registry is checked against the base theme's semantic icon names
- **THEN** all 29 names are present and every entry uses the 1.75 stroke

#### Scenario: Raw glyph in a library prop
- **WHEN** an owner file renders a Lucide glyph outside the wrapper or the registry
- **THEN** the design-system discipline check fails

### Requirement: Astryx packages are exact-pinned and release-aged
The system SHALL depend on the Astryx core, base theme and CLI packages at one exact version with no range operator, installed only after that version has cleared the package manager's 24-hour minimum release age with no exclusion entry, and SHALL invoke the CLI only through local package scripts.

#### Scenario: Manifest pins
- **WHEN** the package manifest and workspace config are read
- **THEN** the Astryx core, base theme and CLI packages name one identical exact version with no range operator, and no release-age exclusion entry exists

#### Scenario: Unscoped CLI invocation
- **WHEN** a package script runs the CLI through an unscoped package runner, the CLI's init command or the shadcn add command
- **THEN** the static usage check fails

### Requirement: No owner surface uses shadcn or Radix primitives
The system SHALL render every owner surface on Astryx components and Cena owner-kit parts only, with no file importing the former shadcn primitives or Radix, while the diner keeps its own tag primitive free of Astryx.

#### Scenario: Retired kit imported
- **WHEN** any source or test file imports from the former primitives directory, the field-error helper or Radix
- **THEN** the static import-boundary check fails

#### Scenario: Diner tag survives
- **WHEN** the diner tag primitive is checked
- **THEN** it exists in the diner component folder and imports nothing from Astryx

### Requirement: Owner links never client-navigate into diner routes
The system SHALL link from owner surfaces to any diner route only with a full document load, never through client-side navigation, so the owner stylesheet cannot be carried into a diner page.

#### Scenario: Client link to a diner path
- **WHEN** an owner file passes a diner path to a client-navigating link or a library button or link
- **THEN** the static usage check fails

### Requirement: Dashboard shell with a slim sidebar and phone drawer
The system SHALL frame every dashboard page in one shell with a 240 pixel sunken sidebar holding the wordmark, the venue menu, grouped navigation and a disabled Settings item, and below 768 pixels SHALL replace the sidebar with a drawer opened from a 56 pixel top bar showing the active venue name.

#### Scenario: Desktop shell
- **WHEN** an owner opens a venue page on a wide screen
- **THEN** the sidebar shows the wordmark, the venue menu, Overview, a "Team" group with Staff and Devices, and a disabled Settings item

#### Scenario: Phone shell
- **WHEN** the same page opens below 768 pixels wide
- **THEN** a top bar shows a 44 pixel menu toggle and the active venue name, and the toggle opens a drawer with the same navigation

### Requirement: Venue menu with "Create venue" at every venue count
The system SHALL render the venue name at the top of the sidebar as a menu at zero, one and many venues and when the venue list cannot be read, listing each owned venue with its currency and ending with an unconditional "Create venue" item.

#### Scenario: Zero venues or read error
- **WHEN** the owner has no venues or the venue list read fails
- **THEN** the menu heading reads "Venues" and the menu holds only "Create venue"

#### Scenario: One venue
- **WHEN** the owner has exactly one venue
- **THEN** the menu lists that venue and then "Create venue"

#### Scenario: Many venues
- **WHEN** the owner has two venues and is on one of them
- **THEN** the menu lists both as "name · currency", marks the current one, and ends with "Create venue"

#### Scenario: Conditional wrapper introduced
- **WHEN** a change places "Create venue" under a conditional ancestor
- **THEN** the unconditional-CTA guard fails

### Requirement: Navigation sections follow the venue path
The system SHALL render navigation sections only when the path carries a real venue id, SHALL render a group heading only when it holds at least one shipped item, and SHALL mark the selected item for assistive technology and with a visible accent bar.

#### Scenario: Venue create path
- **WHEN** the owner is on the venues landing or the new-venue page
- **THEN** no navigation section items render while the venue menu still does

#### Scenario: Selected item
- **WHEN** the owner is on the Staff page
- **THEN** the Staff item carries `aria-current="page"` and shows a 2 pixel accent bar on its leading edge

### Requirement: One page grammar for dashboard pages
The system SHALL compose every dashboard page as a left-aligned column of at most 960 pixels with a page header — one serif level-1 title, one context line and at most one primary action — followed by full-width sections divided by rules, and SHALL use no card, elevation or rounded container in the dashboard.

#### Scenario: Header action on a phone
- **WHEN** a page header with a primary action renders below 640 pixels wide
- **THEN** the action sits under the context line at full width

#### Scenario: Page body
- **WHEN** any dashboard page renders
- **THEN** its content sits in full-width sections divided by rules, with no card, elevation or rounded container

### Requirement: A dashboard page has exactly one main landmark
The system SHALL let the dashboard shell own the only main landmark on dashboard pages, while auth and tablet pages, which have no shell, keep their own.

#### Scenario: Page renders its own main
- **WHEN** a file under the dashboard route group renders a main element
- **THEN** the static usage check fails

### Requirement: Dashboard gates are unchanged under the new shell
The system SHALL keep the dashboard layout's access behaviour identical under the new shell: an account read fault produces a server error, a staff or device principal is redirected to the tablet root, a half-provisioned owner keeps the shell, and an enrolled tablet mounts the idle relock; venue data reaches client components only as serializable props.

#### Scenario: Staff principal opens the dashboard
- **WHEN** a staff or device session requests a dashboard route
- **THEN** it is redirected to `/`

#### Scenario: Account read fault
- **WHEN** the account read fails in the dashboard layout
- **THEN** the request ends in the error boundary rather than a rendered shell

### Requirement: Dashboard error boundary offers a retry
The system SHALL render dashboard read failures as a page with the read-failed heading and body, a single primary "Try again" action that retries the render, and, when the error carries a digest, a wrapping "Reference: {digest}" line in monospace.

#### Scenario: Error with digest
- **WHEN** a dashboard page throws an error that carries a digest
- **THEN** the page shows "Try again" and a "Reference:" line with the digest

### Requirement: Auth screens use a top-anchored paper column
The system SHALL render signup, login and password reset on one paper layout with a wordmark band and a 400 pixel column that is horizontally centred and top-anchored, with no card, border, shadow or grey field, so the whole form stays reachable by scrolling at 320 by 568 pixels.

#### Scenario: Small phone
- **WHEN** the login page renders at 320 by 568 pixels
- **THEN** the title sits at the top of the column and every control is reachable by scrolling, with nothing clipped

### Requirement: Credential failures show one form-level message
The system SHALL report any sign-in or sign-up credential failure only as a single form-level alert carrying the shared ambiguous message, never as a status on the email or password field, and SHALL use field status only for validation errors.

#### Scenario: Wrong password
- **WHEN** a login attempt fails on credentials
- **THEN** an alert shows "That email or password isn't right. Check and try again, or reset your password." and neither field is marked invalid

### Requirement: Secret fields are never echoed
The system SHALL clear every password and PIN field after every form response, success or error, and SHALL never seed a secret field from server state, while non-secret fields are re-filled from the submitted values after an error and cleared after a success.

#### Scenario: Wrong submission on the shared tablet
- **WHEN** a staff provisioning or login submission returns an error
- **THEN** the PIN or password field is empty and the name or email field shows what was submitted

#### Scenario: Successful submission
- **WHEN** a form submission succeeds and the form stays on screen
- **THEN** every field is empty

### Requirement: Consent precedes every way to create an account
The system SHALL place the Terms agreement before the signup submit and before the Google option, SHALL keep the submit unavailable and refuse implicit Enter submission until the agreement is ticked, SHALL open the legal documents in a new tab, and SHALL keep the server-side agreement check authoritative.

#### Scenario: Enter pressed before consent
- **WHEN** an owner types an email and password and presses Enter without ticking the agreement
- **THEN** no signup request is made

#### Scenario: Legal links keep the form
- **WHEN** the owner opens the Terms of Service or Privacy Policy link
- **THEN** it opens in a new tab and the half-filled form remains

### Requirement: Google section is consent-gated and layout-stable
The system SHALL render the Google section only when a Google client is configured, together with its leading divider, and SHALL hold the Google button's slot with an unavailable "Continue with Google" button described by the gate reason until consent is given and the Google button loads.

#### Scenario: No client configured
- **WHEN** no Google client id is configured
- **THEN** neither the Google section nor its divider renders

#### Scenario: Gated control pressed
- **WHEN** the owner presses the gated Google control before ticking consent
- **THEN** sign-in does not start and the control is marked unavailable with the gate reason

### Requirement: Password-reset confirmation does not reveal accounts
The system SHALL replace the reset-request form with the same neutral information notice whether or not the submitted address belongs to an account.

#### Scenario: Reset requested
- **WHEN** an owner requests a reset link for any address
- **THEN** the form is replaced by the same sent notice and no email field remains

### Requirement: Venue details read as settings rows
The system SHALL show a venue's currency, default language, menu languages, country and timezone on its overview page as read-only two-column rows under a "Venue details" section, with menu languages as endonyms in deck order and a dash for any missing value.

#### Scenario: Missing country
- **WHEN** a venue has no country or timezone recorded
- **THEN** the corresponding row shows "—" rather than an empty cell

### Requirement: Venue creation uses settings rows and native selects
The system SHALL present venue creation as two-column settings rows with help text in the dashboard and as stacked fields in signup, with currency and default language as native select controls so phones open the system picker, and SHALL submit exactly the enabled language set.

#### Scenario: EUR venue languages
- **WHEN** an owner creates a EUR venue without touching the languages
- **THEN** the submitted enabled languages are exactly `["en"]`

#### Scenario: RON venue languages
- **WHEN** an owner creates a RON venue with the default languages
- **THEN** the submitted enabled languages are exactly `["ro","en"]`

#### Scenario: Last language refused
- **WHEN** only one language remains and the owner clicks its checkbox
- **THEN** it stays checked, is marked unavailable, and its help text says to keep at least one

### Requirement: Create forms open in a side sheet from the page header
The system SHALL open the add-staff and enrol-device forms in a 400 pixel side sheet launched from the page-header action; Escape SHALL close the sheet and a backdrop click SHALL not, and while the form is submitting neither SHALL close it.

#### Scenario: Pending submission
- **WHEN** the owner presses Escape while an add-staff submission is pending
- **THEN** the sheet stays open

#### Scenario: Sheet opens on the first field
- **WHEN** the owner presses "Add staff member"
- **THEN** a sheet opens with the Name field focused

### Requirement: Adding staff keeps the sheet open and settles on the button
The system SHALL, on a successful add-staff submission, keep the sheet open, clear both fields, return focus to Name, animate the new row into the roster, and show "Added" on the submit button for 1500ms before restoring its label, including under reduced motion; no toast SHALL appear.

#### Scenario: Two staff in a row
- **WHEN** the owner adds one staff member successfully
- **THEN** the button reads "Added" for 1500ms, the fields are empty, Name is focused and the sheet is still open for the next person

### Requirement: Primary page actions are unconditional
The system SHALL render the staff page's "Add staff member" action and the devices page's "Enable staff mode" action in the page header regardless of roster or registry contents, and empty lists SHALL carry no button of their own.

#### Scenario: Only revoked devices
- **WHEN** a venue's device registry holds only revoked tablets
- **THEN** the "Enable staff mode" header action is shown

#### Scenario: Empty roster
- **WHEN** a venue has no staff
- **THEN** the empty state shows "No staff yet" with no button and the header action remains

#### Scenario: Conditional wrapper on the enrol action
- **WHEN** a change places the element marked `data-cta="enrol-device"` under a conditional ancestor or removes it
- **THEN** the unconditional-CTA guard fails

### Requirement: Destructive confirmations keep a fixed order
The system SHALL confirm staff deactivation and device revocation in a dialog that shows a wrapping title naming the subject, a body, the device label where one exists, an inline alert when the action fails, and Cancel before the destructive action in the same order at every width, with Cancel focused and dismissal refused while pending.

#### Scenario: Narrow screen order
- **WHEN** the deactivate dialog opens at 320 pixels wide
- **THEN** Cancel precedes "Deactivate" in both DOM and visual order and Cancel has focus

#### Scenario: Failed revoke
- **WHEN** a device revocation fails
- **THEN** an alert appears inside the dialog and the dialog stays open

### Requirement: Retired rows stay listed and change in place
The system SHALL keep deactivated staff and revoked devices in their lists with a muted name, a neutral "Deactivated" or "Revoked" badge and no action, showing ordinary active rows as plain "Active" text, and SHALL animate a row's change to retired in place within 160ms.

#### Scenario: Staff deactivated
- **WHEN** the owner confirms deactivation of a staff member
- **THEN** the row stays in the roster with a "Deactivated" badge and no Deactivate control

### Requirement: Enrolling from the devices page targets the current venue
The system SHALL submit the current venue from the devices-page enrolment sheet without showing a venue choice, warning in the page context and sheet description that the device in use becomes a staff tablet, while the standalone enable-staff-mode page shows a venue choice only when the owner has two or more venues.

#### Scenario: Sheet on the devices page
- **WHEN** the owner opens the enrolment sheet on a venue's devices page
- **THEN** the form carries that venue's id as a hidden value and shows no venue select

#### Scenario: Standalone page with several venues
- **WHEN** an owner with two venues opens `/enable-staff-mode`
- **THEN** a native venue select with a disabled "Choose a venue" placeholder is shown

### Requirement: Tablet utility screens are safe-centred
The system SHALL render the tablet's empty-roster, load-failure, enable-staff-mode and owner-unlock screens in a 480 pixel column centred on both axes that falls back to top-anchored scrolling when taller than the viewport, so no content is clipped above the fold.

#### Scenario: Locked unlock screen on a small phone
- **WHEN** the locked `/unlock` screen renders at 320 by 568 pixels
- **THEN** its title is at the top of the viewport and the login form and un-enrol control are reachable by scrolling

### Requirement: PIN entry keeps its feedback and press-and-hold
The system SHALL let staff reveal a truncated name by pressing and holding its tile, SHALL prompt for the PIN in a sans level-2 heading, and SHALL announce wrong-PIN and lockout messages through a polite live region in a reserved line that does not shift the keypad.

#### Scenario: Wrong PIN
- **WHEN** a staff member enters a wrong PIN
- **THEN** the wrong-PIN message is announced politely in the reserved line above the keypad

#### Scenario: Long name
- **WHEN** a staff member presses and holds a tile whose name is truncated
- **THEN** the full name is revealed

### Requirement: Owner strings come from the contract-backed copy deck
The system SHALL draw every owner string introduced or moved by this change from the copy deck, and SHALL check the deck against the copywriting contracts of both `docs/design/ui-contract-multi-tenant-foundation.md` and `docs/design/ui-contract-owner-ui-on-astryx.md` without relaxing the match rule.

#### Scenario: New string without a row
- **WHEN** a string is added to the copy deck with no row in either contract
- **THEN** the copy-contract check fails and names the key

### Requirement: Guards run in CI without secrets
The system SHALL run the theme drift check, the build-output guard and the static design guards on every push and pull request in a CI workflow that holds no secrets and only read permission, and that needs no database or environment file.

#### Scenario: Push with a diner leak
- **WHEN** a commit that leaks Astryx into a non-owner route is pushed
- **THEN** the CI workflow fails

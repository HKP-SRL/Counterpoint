# local-console Specification

## Purpose
The owner's browser console: reachable only from this machine, guarded against other origins and unauthenticated callers, kept live over a server-sent event stream, and usable in light and dark themes.

## Requirements

### Requirement: Loopback-only bind
The console server SHALL bind only to `127.0.0.1`, never to `0.0.0.0`, `localhost` or `::1`, so no other machine on the network can reach it.

#### Scenario: LAN client
- **WHEN** a client on another machine connects to the owner's LAN address on the console port
- **THEN** the connection is refused because nothing listens on that interface

### Requirement: Exact Host allowlist
Every request SHALL carry the exact Host `127.0.0.1:{port}`. Any other Host, including `localhost` or a rebinding domain, SHALL be refused before any route runs.

#### Scenario: DNS rebinding
- **WHEN** a request arrives with Host `evil.example:4170`
- **THEN** the server answers 403 and runs no route

### Requirement: Origin and content checks on writes
Every non-GET request SHALL carry the exact console Origin, a same-origin fetch-metadata header and a JSON body. A cross-site or form-encoded post SHALL be refused.

#### Scenario: Cross-site post
- **WHEN** a page on another origin posts to a console API route
- **THEN** the server answers 403 and the console shows `Request blocked`

### Requirement: One-time sign-in
The owner SHALL sign in only through a link carrying a single-use code that expires within 5 minutes. The server SHALL exchange the code for an `HttpOnly; SameSite=Strict` session cookie that lasts at most 12 hours and SHALL store codes and sessions only as hashes. `counterpoint open` SHALL print a fresh link.

#### Scenario: Link used twice
- **WHEN** the owner opens a sign-in link that was already used
- **THEN** the browser lands on the signed-out screen with the reason that the link was used

#### Scenario: Sign in from another browser
- **WHEN** the owner runs `counterpoint open` and opens the new link in another browser
- **THEN** that browser gets its own session

### Requirement: Session required for the API
Every console API request and the live event stream SHALL require a valid session. Without one the server SHALL answer 401 and the console SHALL show the signed-out screen.

#### Scenario: Expired session
- **WHEN** the owner's session has expired and the console fetches data
- **THEN** the console shows the not-signed-in screen with how to get a new link

### Requirement: Strict content security policy
The console SHALL be served with a content security policy that allows scripts only from its own origin, and SHALL render all host-supplied text (file contents, diffs, logs) as plain text, never as HTML.

#### Scenario: Diff containing markup
- **WHEN** a changed file in a diff contains `<script>` text
- **THEN** the console shows it as text and runs nothing

### Requirement: Live updates over one event stream
The console SHALL receive server changes over one server-sent event stream whose event ids allow a reconnecting client to replay everything it missed. The server SHALL send heartbeats, and the console SHALL show whether live updates are connected or reconnecting. The console SHALL NOT poll.

#### Scenario: Reconnect after a drop
- **WHEN** the event stream drops and reconnects with the last seen event id
- **THEN** the server replays the events after that id and the console catches up without a reload

#### Scenario: Daemon stopped
- **WHEN** the daemon stops while the console is open
- **THEN** the console shows that live updates are paused

### Requirement: Light, dark and system themes
The console SHALL offer Light, Dark and System themes with identical layout, persist the choice in the browser, and apply it before first paint so the page does not flash.

#### Scenario: Theme persists
- **WHEN** the owner picks Dark and reloads the console
- **THEN** the console opens in Dark with no light flash

### Requirement: Host-scoped navigation
The console SHALL show a host switcher with each host's name and base branch, and pages for Mission, Changes, Needs You (with a count badge hidden at zero) and Settings. Browser Back SHALL always work.

#### Scenario: One host
- **WHEN** only one host is registered and the owner opens `/`
- **THEN** the console redirects to that host's Mission page

#### Scenario: No Trust page
- **WHEN** the owner opens the console after the upgrade
- **THEN** the navigation has no Trust entry, and an old Trust link leads to the Mission page

# local-console Spec Delta

## MODIFIED Requirements

### Requirement: Exact Host allowlist
Every request SHALL carry the exact Host `localhost:{port}`. Any other Host, including `127.0.0.1:{port}` or a rebinding domain, SHALL be refused before any route runs.

#### Scenario: DNS rebinding
- **WHEN** a request arrives with Host `evil.example:4170`
- **THEN** the server answers 403 and runs no route

#### Scenario: Opened by IP address
- **WHEN** the browser opens the console at `127.0.0.1:{port}`
- **THEN** the server answers 403, runs no route, and names the `localhost` address to use

### Requirement: One-time sign-in
The owner SHALL sign in only through a link at `http://localhost:{port}` carrying a single-use code that expires within 5 minutes. The server SHALL exchange the code for an `HttpOnly; SameSite=Strict` session cookie that lasts at most 12 hours and a session token kept in the console origin's own storage, and SHALL store codes, sessions and tokens only as hashes. `counterpoint open` SHALL print a fresh link.

#### Scenario: Link used twice
- **WHEN** the owner opens a sign-in link that was already used
- **THEN** the browser lands on the signed-out screen with the reason that the link was used

#### Scenario: Sign in from another browser
- **WHEN** the owner runs `counterpoint open` and opens the new link in another browser
- **THEN** that browser gets its own session

### Requirement: Session required for the API
Every console API request and the live event stream SHALL require a valid session: the session cookie together with its session token, sent from the console's own origin. Without both the server SHALL answer 401 and the console SHALL show the signed-out screen.

#### Scenario: Expired session
- **WHEN** the owner's session has expired and the console fetches data
- **THEN** the console shows the not-signed-in screen with how to get a new link

#### Scenario: Cookie without its token
- **WHEN** a request carries the console's session cookie but not its session token, as when another local server on `localhost` replays the cookie
- **THEN** the server answers 401 and runs no route

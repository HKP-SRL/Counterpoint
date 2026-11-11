# Passkey Approvals

## Why

The owner controls Counterpoint from the web. Today every approval means copying a command from the console into a terminal and typing a passphrase, and morning review would add the same step for every merge. The terminal proves one thing: the owner signed, not an agent. A passkey proves the same with one touch. It needs Touch ID (or a security-key touch) on every use, its private key never leaves the device, and the browser binds each signature to the console and to the exact statement on screen.

This comes before `morning-review-signed-merge`, so merge signing is built once, on the passkey.

## What Changes

- **Approve in the console with Touch ID.** The console shows the recomputed statement (every covered file and digest, the draft and gate-config slots, the fingerprint) and asks for the passkey. The challenge is the statement's hash, so the touch signs exactly what was shown. User verification is required on every use.
- **Several changes with one touch.** The owner selects several Ready to approve changes and approves them together. Each still lands as its own one-file commit, and each approval file verifies on its own.
- **Approval file v3.** `counterpoint/approval/v3` holds the statement, the owner's passkey signature and, for a batch, the statement digests the signature covers. The commit around it is plain; the proof is in the file. Verification still recomputes everything from git and fails closed, and now checks the pinned credential, the console's exact origin and the statement's hash.
- **SSH approval signing is removed.** `init-key`, `trust-key`, `counterpoint approve` and the passphrase prompt go away; two signing paths would double the trust surface. After registering the passkey, the owner re-approves the current runway with one batch touch.
- **Registration is the one terminal step.** `counterpoint passkey register` prints a one-time console link. The owner creates the passkey in the browser, and the terminal shows its fingerprint and pins it only after the owner types `y`. An agent driving a headless browser can create a virtual authenticator, so registration must never be web-only.
- **The console moves to `http://localhost:{port}`.** Passkeys need a domain, not an IP address. The server still binds only `127.0.0.1`. Previews and drafts stay on `127.0.0.1`, so the agent-written code they run cannot ask for the passkey and no longer receives the console's cookie.
- **The session is bound to the console's origin.** Cookies ignore ports, so on `localhost` the owner's own dev servers (agent-written code, outside any sandbox) would receive the console's cookie. The session therefore also requires a token held in the console origin's own storage and sent with each request; the cookie alone is useless.
- **The integrity check still runs before landing.** A refused approval shows in the console with the `counterpoint trust {host}` step.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `signed-approvals`: passkey approval in the console, batch approval, approval file v3 and passkey verification; terminal signing removed.
- `key-trust`: passkey registration confirmed at a terminal replaces the SSH key setup; the integrity check runs before landing.
- `local-console`: the console is served at `localhost`, and the session is bound to the console's origin.

## Impact

- Reworks shipped trusted-shell code: approval signing and verification, `init-key` and `trust-key`, doctor's key rows, and the approval dialog. Cena's current approvals are re-approved once.
- `morning-review-signed-merge` builds on it: a merge is approved with the passkey over a merge statement naming the base tip and the exact PR head.
- Spikes first: passkeys on `http://localhost` with Touch ID in Chrome and Safari (Chrome is known to work, Safari is unverified); iCloud Keychain, browser-profile and security-key passkeys; ES256 verification with `node:crypto`; the browser reaching `localhost` while the server binds only `127.0.0.1`.
- Open for design:
  - What happens when the console port changes, since the origin is pinned at registration.
  - Whether the console offers a push for approval commits, so the owner never needs a terminal to push the base branch.
  - A backup credential (for example a security key) in case the Mac is lost.

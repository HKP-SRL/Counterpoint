# Phase 1: Multi-Tenant Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-24
**Phase:** 1-Multi-Tenant Foundation
**Areas discussed:** Owner auth method, Staff account model, Role model, Venue onboarding, Tablet enrollment & loss, PIN security rules, Staff turnover, GDPR/terms at signup

---

## Owner auth method

| Option | Description | Selected |
|--------|-------------|----------|
| Email + password, + Google | Familiar to non-technical owners, instant mid-service re-login, Google one-tap fast path | ✓ |
| Magic link only | Passwordless; but mid-service re-login means leaving app to check email | |
| Google / social only | One tap; assumes every owner has Google | |
| Email + password only | Simplest, no third-party dep, no fast path | |

**User's choice:** Email + password, + Google
**Notes:** Password-reset flow taken as a given.

### Follow-ups
| Question | Options | Selected |
|----------|---------|----------|
| Email verification gate | Let them in immediately ✓ / Verify before venue creation / Verify before invite+publish | Let them in immediately (soft nudge) |
| Session length | Long-lived stay-signed-in ✓ / Standard with periodic re-login | Long-lived, for mobile floor use |

---

## Staff account model

| Option | Description | Selected |
|--------|-------------|----------|
| Owner provisions the account | Owner sets name + temp password, hands over | (superseded) |
| Email invite link | Staff self-onboard via email | |
| Phone number + PIN | SMS OTP + PIN, no email | |

**User's choice:** *Clarified before answering* — rejected the email-centric framing entirely.
**Notes:** User's actual model: staff should NOT handle extra emails/logins. A shared in-restaurant **tablet**, with a **classic PIN per staff member**, all set up by the owner from their dashboard. Questions were reshaped around this.

### Reshaped follow-ups (PIN + tablet model)
| Question | Options | Selected |
|----------|---------|----------|
| Tablet auth model | Device holds a staff session (PIN = app identity) / Each PIN = a real account | User: each PIN should carry its **own identifier** (for "which staff handles which table"/analytics), but not necessarily a full account → resolved as device-holds-staff-session + distinct per-staff PIN profile stamped on actions |
| Record who acted | Record who did it ✓ / PIN is just a lock | Record who did it (attribution) |
| Owner on the tablet | Owner can log in on tablet too ✓ / Tablet staff-only | Owner/manager can log in on the tablet for full edits |

---

## Role model

| Option | Description | Selected |
|--------|-------------|----------|
| Three: owner / manager / staff | Matches written requirements; enum makes it cheap | |
| Two: owner / staff | Defer manager until needed | ✓ |

**User's choice:** Two roles — owner + staff. *Clarified before answering:* "I don't see what a manager does… but I would see a staff member being able to easily move things into 86 on the fly."
**Notes:** Manager dropped for v1 (no demonstrated need). Staff's essential capability = 86 (availability toggle) on the fly. Extensible enum + `get_venue_role()` helper keep manager a cheap future add. Identity split by tier (owner = real login, staff = PIN) taken as settled by the staff discussion rather than re-asked.

---

## Venue onboarding

| Question | Options | Selected |
|----------|---------|----------|
| Signup → venue flow | Combined onboarding ✓ / Account first then create venue | Combined, land straight in dashboard |
| Fields at venue creation | Capture country + timezone now ✓ / Keep minimal | Capture country + timezone now (auto-derive, override) for later scheduling/analytics/fiscal |
| Multi-venue in v1 | Schema full, UI minimal ✓ / Single venue in UI / Full multi-venue UI | Schema full (accounts→venues), UI centers on one with lightweight switcher |

---

## Tablet enrollment & loss

| Question | Options | Selected |
|----------|---------|----------|
| Enrollment | Owner logs in, enables staff mode ✓ / Pairing code from dashboard | Owner logs in once → "switch to staff mode"; device holds venue-scoped staff session |
| Loss / revoke | Remote revoke from dashboard ✓ / PIN gate + rotate only | Device registry; owner can remotely revoke a lost/retired tablet's session |

---

## PIN security rules

| Question | Options | Selected |
|----------|---------|----------|
| PIN length | 4 digits ✓ / 6 digits | 4 digits (speed; throttle handles brute force; low blast radius) |
| Wrong-entry handling | Lock after a few tries / Timed backoff ✓ / No lockout | Timed/exponential backoff (no owner reset needed) |
| Identification | Pick your name then PIN ✓ / PIN only | Name-grid-then-PIN (POS-style); PINs need not be unique |

**Notes:** PINs hashed at rest taken as non-negotiable.

---

## Staff turnover

| Option | Description | Selected |
|--------|-------------|----------|
| Deactivate, keep history | PIN dies immediately, profile + attribution preserved | ✓ |
| Hard delete | Removes person entirely; history orphaned | |

---

## GDPR / terms at signup

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit checkbox + record | Store accepted version + timestamp | ✓ |
| Implicit notice | "By signing up you agree" link only | |
| Defer to a later phase | Add before non-pilot customers | |

**Notes:** Owner-facing consent only; cookieless diner analytics is a separate Phase 6 concern.

---

## Claude's Discretion

- Supabase Auth config specifics (token TTLs, provider setup, redirect URLs).
- Migration file organization; RLS test-suite framework/harness (research names the client-SDK-across-role×venue approach; concrete tooling is the planner's call).
- Exact backoff curve; device-registry schema shape.

## Deferred Ideas

- Table-level staff attribution ("which staff handles which table") → deferred table-management/ordering tier; per-staff PIN identity is the seam.
- "Manager" role → re-add later as one enum value when a second full-access non-owner person is needed.
- Full multi-venue management UI → schema ready now, rich UI deferred.
- Subscription billing / tier enforcement → `accounts.plan_tier` reserved, unused in v1.
- Fiscal / net-vs-gross tax convention → `venues.country_code` captured; convention deferred to payments/fiscal milestone.
- Diner-side cookieless consent → Phase 6.

# HTTP Security Posture Tier — Specification

> New capability introduced by change `testing-refoundation` (WU-6.S1–6.S2). A standalone security
> suite whose 65 skips all read "service unavailable" — because it registers users through a route
> that does not exist — is replaced by a live-tier suite carrying only the cases that have a real
> surface.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Tags: **[static]** decidable by
> inspecting tracked files; **[runtime]** needs the started stack. A scenario named **Red — …** is the
> demonstrated failure path (P4).
>
> Neighbouring capabilities: `multi-tenant-isolation` and `client-ip-rate-limit` own their own
> invariants; this capability adds HTTP-posture coverage and MUST NOT restate or weaken theirs.

---

## Purpose

A security suite that reports "skipped" when the application is not reachable proves nothing and reads
as coverage. The cases worth keeping are the ones with a live surface — and one of them is expected to
come back RED.

---

## Requirements

### Requirement: The salvageable cases become one live-tier suite, measured before it is written

Exactly one suite in the live tier MUST carry the cases that have a real surface: tampered and
malformed bearer tokens rejected; prototype-pollution keys on a write route rejected or stripped
without leakage; server-side request forgery rejected on the outbound-sink URL fields; the response
hardening headers the existing suite does not already assert; no stack or internal detail in error
responses; the login response carrying no hash, secret or factor material and never echoing the
password; unknown-origin cross-origin requests neither reflected with credentials nor preflight-approved;
a query-operator payload in the login body answered with a client error rather than a server error;
an oversized body rejected with the payload-too-large status; a dangerous file type rejected on the
real upload route; and external-entity expansion refused on the assertion-consuming callback route.
Each case MUST be MEASURED first; a case whose surface does not exist MUST NOT be written.

#### Scenario: Every written case has a live surface and a definite expected status [runtime]

- **GIVEN** the new live-tier suite
- **WHEN** it runs against the started stack
- **THEN** each case addresses a route the application serves and asserts a definite status and body
  shape — never a disjunction of an allowed and a denied outcome

#### Scenario: The permissive existing case is tightened rather than duplicated [runtime]

- **GIVEN** the pre-existing endpoint case that accepts an oversized body
- **WHEN** the new suite lands
- **THEN** that case is rewritten to assert the rejection, and the assertion is not duplicated across
  two suites

---

### Requirement: A case that comes back red opens an owned finding, and is never committed skipped

A case whose measurement is RED MUST be recorded as a finding with an owner in the backlog and the
tracker, and MUST NOT be committed skipped, weakened, or deleted to make the suite green. The
forgery case is PRE-AUTHORISED as an expected red: the outbound sink validation accepts any secure
scheme and blocks loopback only by substring, so private and link-local addresses are expected to pass
validation today.

#### Scenario: The expected forgery red becomes an owned finding [runtime]

- **GIVEN** loopback, link-local, private-range and bracketed-loopback URLs submitted to the outbound
  sink fields
- **WHEN** the case runs
- **THEN** any accepted address fails the case, and the failure is recorded as a security finding with
  an owner rather than skipped or relaxed

#### Scenario: Red — a skipped or weakened security case is rejected [static]

- **GIVEN** in turn: one case committed as skipped; one case rewritten to accept either outcome
- **WHEN** the skip detector and review run
- **THEN** the skip exits non-zero, and the either-outcome assertion is rejected as decorative under
  criterion (d)

---

### Requirement: The old suite is deleted, and each case's destination is named

The standalone suite, its helpers and its non-`docs/` readme MUST be deleted, together with any root
script that invoked it. The tracking entry MUST close by naming WHERE each case went: folded into the
live-tier suite, already covered elsewhere, or discarded for want of a surface. The discarded classes
MUST be enumerated — injection against a parameterised data layer, reflected markup, directory
traversal, response splitting, "rapid requests", weak-password and reset-token cases, and the
duplicate payload-validation cases — so the deletion is auditable rather than a silent shrink.

#### Scenario: The deletion is backed by an approved ledger row and a destination per case [static]

- **GIVEN** the deletion slice
- **WHEN** the tracking entry and the ledger row are read
- **THEN** every case is accounted for as folded, already covered, or discarded with a reason, and the
  whole-file deletion cites its approved ledger row

#### Scenario: Nothing outside `docs/` documents the removed suite [static]

- **GIVEN** the repository after deletion
- **WHEN** it is searched
- **THEN** no readme remains outside the documentation tree, and no script or workflow references the
  removed suite

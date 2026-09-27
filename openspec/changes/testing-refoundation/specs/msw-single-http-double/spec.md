# Single HTTP Double — Specification

> New capability introduced by change `testing-refoundation` (WU-6.M1–6.M9). One request-interception
> library becomes the ONLY way a test replaces an HTTP call; 44 ad-hoc fetch stubs and six per-file
> server lifecycles are removed.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Tags: **[static]** decidable by
> inspecting tracked files or a deterministic CLI gate; **[runtime]** needs a test run.
> A scenario named **Red — …** is the gate's demonstrated failure path (P4).

---

## Purpose

Two mechanisms for one defect class means one is redundant. A hand-written fetch stub asserts the call
shape the author remembered; a typed handler asserts the contract the server publishes.

---

## Requirements

### Requirement: Network isolation is the default, and an unhandled request is an error

Every test environment MUST start the interception server from a shared setup file with unhandled
requests configured to ERROR — not warn, not bypass. A test that reaches a real network endpoint MUST
fail naming the request. No test file MAY opt into bypassing unhandled requests; a case that needs a
response MUST add a handler.

#### Scenario: Red — a real outbound request fails naming the request [runtime]

- **GIVEN** an absolute outbound request planted in any test
- **WHEN** the suite runs
- **THEN** it fails naming the method and URL of the unhandled request, and the tree restores
  byte-exact

#### Scenario: No suite opts out of isolation [static]

- **GIVEN** every test setup and every per-file server construction
- **WHEN** they are inspected
- **THEN** none configures bypass, and the one previous bypass case now carries a handler

---

### Requirement: The lifecycle lives in setup, not in each file, and both frameworks are served

Server start, per-test handler reset and teardown MUST be owned by the shared setup for every
application and package, so a file cannot forget the reset — the tier's one existing server has no
reset today. A first-class helper MUST exist for the tier framework's lifecycle, and that helper MUST
have its own test because its lifecycle mapping is inferred rather than documented. The shared core
MUST re-export the request and response primitives so no consumer imports them from two places, and
the previous provider-local helper MUST move into the shared core and its subpath and optional peer
be removed.

#### Scenario: Handlers do not leak between tests in either framework [runtime]

- **GIVEN** a test that registers a handler and a following test that does not
- **WHEN** both run, in the unit framework and in the tier framework
- **THEN** the second test does not observe the first's handler, in both frameworks

#### Scenario: The tier-framework helper has its own test [static]

- **GIVEN** the tier lifecycle helper
- **WHEN** the shared package's tests run
- **THEN** the helper's start, reset and teardown mapping is asserted by a test of its own

---

### Requirement: The application handlers are typed by the published contract

Handlers for the application's own endpoints MUST be typed from the generated contract types, so a
contract change breaks the TYPECHECK rather than producing a silently-stale double. They MUST live in
the shared wire package as the single copy. The limit MUST be stated: typed handlers catch type drift,
not behavioural drift — behaviour is the integration and end-to-end tiers' subject.

#### Scenario: Red — a contract change breaks the typecheck [static]

- **GIVEN** a response field renamed in the generated contract types
- **WHEN** the typecheck runs
- **THEN** it fails on the handler that still returns the old shape

---

### Requirement: Every provider has handlers for its public write endpoints, and its write methods are tested through them

For each outbound provider integration there MUST be one handler module in the shared wire package
covering every PUBLIC WRITE endpoint, and one test per write method exercised through those handlers.
Tests of the client layer MUST go through interception; tests of the adapter layer over a fake client
MAY stay, because that IS the adapter's boundary. Each provider's definition of done MUST be: a
handler per public write endpoint, a test per write method, zero stubs.

#### Scenario: Each provider meets its definition of done [static]

- **GIVEN** each provider family after its migration
- **WHEN** its handler module and tests are inspected
- **THEN** every public write endpoint has a handler, every write method has a test through
  interception, and the provider contributes zero fetch stubs

---

### Requirement: A hand-written HTTP stub is a lint error, and the baseline reaches zero

A lint rule MUST forbid, in test globs, stubbing the global fetch, assigning to it, and spying on it.
Existing occurrences MUST be captured as a suppression baseline that only shrinks, each migration MUST
prune its own suppressions, and a fitness pin MUST keep the rule at `error`. The rule MUST close at
hard zero with an empty suppression set.

#### Scenario: Red — a planted fetch stub exits non-zero [static]

- **GIVEN** a global fetch stub planted in a test file
- **WHEN** the complete lint step runs
- **THEN** it exits non-zero naming the file and the construct, and the tree restores byte-exact

#### Scenario: The baseline only falls and finishes empty [static]

- **GIVEN** the suppression counts on base and head
- **WHEN** each migration slice lands
- **THEN** the count strictly falls, no suppression is added, and the closing slice leaves the set
  empty with the rule pinned at `error`

#### Scenario: A duplicated client test pair is consolidated rather than both kept [static]

- **GIVEN** two test files covering the same HTTP client
- **WHEN** the migration lands
- **THEN** one consolidated suite remains, covering the timeout and transport-error cases through
  interception primitives

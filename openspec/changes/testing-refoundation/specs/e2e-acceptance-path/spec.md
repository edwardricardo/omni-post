# End-to-End Acceptance Path — Specification

> New capability introduced by change `testing-refoundation` (WU-6.E1–6.E10). It replaces an
> end-to-end suite that has never run in CI — page objects addressing 207 selectors the source does
> not contain, a fake token written into browser storage for an application that authenticates by
> cookie, and a seeding call to a route that does not exist — with a small path that can actually
> fail.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Tags: **[static]** decidable by
> inspecting tracked files; **[runtime]** needs the stack and a browser run; **[ci]** observable only
> on a CI run and evidenced by a run id.
>
> A scenario named **Red — …** is the demonstrated failure path (P4). The single PRODUCTION change in
> this capability is the outbound provider base-URL seam, and it is refused under a production
> environment.

---

## Purpose

An end-to-end test earns its cost only by crossing process boundaries for real. Six specs that can
fail are worth more than thirty-seven that cannot run.

---

## Requirements

### Requirement: The fiction is demolished before anything is rebuilt

Page objects addressing selectors absent from the source, authentication fixtures containing a
fabricated token, helper modules whose imports are commented out in every consumer, visual snapshots
for an unrunnable suite, the call to a non-existent seeding route, and browser/device projects whose
match patterns select nothing MUST all be deleted. Only genuinely-referenced helpers MUST survive.
The demolition MUST leave a suite that passes.

#### Scenario: What remains is referenced and green [runtime]

- **GIVEN** the demolition slice
- **WHEN** the surviving suite runs in the single gated browser
- **THEN** it passes, every surviving helper has a real importer, and no project's match pattern
  selects an empty set

#### Scenario: Red — a reintroduced fabricated-token fixture is rejected [static]

- **GIVEN** an authentication fixture writing a fabricated token into browser storage
- **WHEN** the reach and lint gates run
- **THEN** the fixture is rejected as unreferenced fiction rather than kept as scaffolding

---

### Requirement: Selectors are role- and label-based, never a mass-instrumented attribute

Locators MUST address elements by accessible role, label or name, so the selector also asserts the
accessible name. Mass instrumentation of the source with test attributes MUST NOT be used — the
previous suite referenced 207 such attributes of which the source contained none. Localised names
MUST be read from the application's own message catalogue rather than hard-coded.

#### Scenario: Every locator is role- or label-based, and names come from the catalogue [static]

- **GIVEN** the rebuilt specs
- **WHEN** their locators are read
- **THEN** each addresses a role, label or accessible name, and each visible string is resolved
  through the message catalogue

---

### Requirement: Seeding is idempotent, through the owner connection, and never a route in the production binary

End-to-end data MUST be seeded by a dedicated seed entrypoint over the OWNER connection, failing
non-zero when that connection is absent, with idempotent upserts covering the customer, its account
and project, an encrypted provider channel, the administrative identities and the load-test users.
A test-only seeding or cleanup route inside the production binary MUST NOT exist — it is attack
surface. Test credentials MUST come from the environment the environment contract synthesises.

#### Scenario: Re-running the seed changes nothing and needs no test route [runtime]

- **GIVEN** a seeded database
- **WHEN** the seed entrypoint runs again
- **THEN** it completes without duplicating any row, and no test-only route exists in the
  application's route table

#### Scenario: Red — the seed without the owner connection exits non-zero [runtime]

- **GIVEN** the owner connection variable unset
- **WHEN** the seed runs
- **THEN** it exits non-zero naming the variable, and writes nothing

---

### Requirement: The provider base-URL seam is injected and REFUSED under a production environment

The outbound provider client MUST accept its base URL through construction, defaulting to the real
provider host, and the composition roots MUST pass the configured value. The environment schema MUST
REFUSE to validate an override when the runtime environment is production — without the seam the
publish path cannot be observed, and without the refusal the seam becomes a production redirection
primitive. The adapter MUST NOT read the environment itself (the existing adapter-environment gate
stays satisfied).

#### Scenario: Red — a production environment with an override refuses to boot [runtime]

- **GIVEN** the production environment value together with a base-URL override
- **WHEN** the boot-time schema validates
- **THEN** it refuses, naming the override, and the boot test asserting this is RED before the
  refinement exists and GREEN after

#### Scenario: The default is the real provider host, and no adapter reads the environment [static]

- **GIVEN** the client and its adapter
- **WHEN** they are inspected
- **THEN** the default base URL is the real provider host, the value arrives by construction, and the
  adapter contains no environment read

---

### Requirement: The fake-provider sidecar replays the recorded contract, and the call is asserted

A sidecar HTTP server MUST answer provider requests from the SAME shared handlers the unit layer
uses, and MUST expose a call log and a reset endpoint. The publish spec MUST assert EXACTLY ONE
outbound call with the expected body. The sidecar reproduces the RECORDED contract, not the provider;
real provider sandboxes remain a declared gap.

#### Scenario: The publish spec asserts exactly one outbound call [runtime]

- **GIVEN** a seeded draft and the sidecar running with a clean call log
- **WHEN** the spec publishes immediately
- **THEN** the interface shows the published state and the call log contains exactly one send with
  the expected body

#### Scenario: Red — a failing sidecar makes the publish spec red [runtime]

- **GIVEN** the sidecar answering with a server error
- **WHEN** the publish spec runs
- **THEN** it fails, proving the spec observes the publish path rather than the interface alone
- **AND** the tree restores byte-exact

---

### Requirement: The browser configuration cannot pass by retrying, and cannot skip

The gated configuration MUST use ONE browser as the merge gate, MUST derive its authenticated state
from a setup project that logs in through the interface, MUST forbid focused tests in CI, MUST allow
at most one retry AND MUST fail the run when a test only passed on a retry, and MUST take its servers
from the environment script. Committed skips are forbidden by the repository-wide skip detector, which
applies to specs as well.

#### Scenario: A flaky pass is a failure [ci]

- **GIVEN** a spec that fails once and passes on its retry
- **WHEN** the job runs
- **THEN** the run fails on the flaky-test policy rather than reporting success

#### Scenario: Red — a focused or skipped spec fails the run [static]

- **GIVEN** in turn: a focused test; a committed skip in a spec
- **WHEN** the run and the skip detector execute
- **THEN** each exits non-zero naming the construct

---

### Requirement: The first green specs prove both directions over the real journeys

The rebuilt suite MUST cover, as a minimum: authentication (valid login reaching the dashboard,
wrong password surfacing a localised alert, logout clearing the session), draft creation through the
editor and its appearance in the list, immediate publication asserted end to end including the
outbound call, and accessibility over the authenticated dashboard with zero serious or critical
violations. Each spec MUST be demonstrated to fail when its subject is broken.

#### Scenario: Each spec fails when its subject is broken [runtime]

- **GIVEN** each rebuilt spec
- **WHEN** its subject is broken in turn (wrong credentials accepted, the draft not persisted, the
  outbound call suppressed, a contrast regression reintroduced)
- **THEN** the corresponding spec fails, and passes again once restored

#### Scenario: An accessibility failure is a product finding, not a test defect [runtime]

- **GIVEN** a serious or critical accessibility violation on an authenticated page
- **WHEN** the accessibility spec runs
- **THEN** it fails, and the failure is recorded as a component finding with an owner rather than
  relaxed in the spec

---

### Requirement: The administrative suite is re-measured, and every remaining failure is classified

The administrative end-to-end suite MUST gain its own script and a configuration with the same setup
and server delegation, MUST replace error assertions on absent test attributes with role-based
assertions, and MUST make its login helper THROW instead of returning a falsy value. After seeding,
the previously-failing cases MUST be re-measured and EVERY remaining failure classified as a product
finding, a test defect, or decorative — none left unexplained.

#### Scenario: The re-measurement leaves no unclassified failure [runtime]

- **GIVEN** the administrative suite against the seeded environment
- **WHEN** it runs
- **THEN** the seed-caused failures are gone and each remaining failure carries a classification and
  a destination

#### Scenario: Red — the login helper throws rather than returning false [runtime]

- **GIVEN** invalid administrative credentials
- **WHEN** the helper runs
- **THEN** it throws naming the failure, so no spec can proceed on a falsy login

---

### Requirement: The end-to-end job is required, and the rebuilt tree is typechecked

The gated browser job MUST cache the browser binaries by version, install them, build both portals,
start the stack through the environment script, run both suites, upload its report and results
unconditionally, and stay inside its time budget. It MUST become a REQUIRED context through the
composed merge gate. The rebuilt end-to-end tree MUST sit inside a typecheck scope — the tests
typecheck programme — as its own acceptance item; it MUST NOT enter any application build graph.

#### Scenario: Red — a planted always-false assertion fails the job [ci]

- **GIVEN** an assertion that can never hold planted in one spec
- **WHEN** the job runs
- **THEN** the job exits non-zero, the report and results are still uploaded, and the tree restores
  byte-exact

#### Scenario: The rebuilt tree is typechecked and stays out of the build graph [static]

- **GIVEN** the rebuilt end-to-end files
- **WHEN** the typecheck programme and the portal builds run
- **THEN** every file is inside the tests typecheck scope with a baseline key, and none appears in a
  portal's build graph

---

### Requirement: The scheduled-publication journey is a declared gap, never a skipped spec

The "scheduled post is published by the worker" journey MUST NOT be written here: it is red today for
a product reason owned by another change, and a red owned elsewhere MUST be a DECLARED GAP with an
owner rather than a committed skip. It MUST be written red-first inside the change that owns the
promotion path.

#### Scenario: The gap is listed with its owner and no spec is skipped [static]

- **GIVEN** the tracker's declared-gaps table and the spec directory
- **WHEN** both are inspected
- **THEN** the journey is listed with its owning change, and no spec covering it exists in any skipped
  form

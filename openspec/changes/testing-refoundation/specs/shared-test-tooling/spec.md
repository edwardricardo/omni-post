# Shared Test Tooling — Specification

> New capability introduced by change `testing-refoundation` (WU-S.1–S.8). It fixes the fourth
> contract: all five test layers speak about the SAME aggregates through one tooling layer, so a
> double cannot quietly disagree with the domain it stands for.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Tags: **[static]** decidable by
> inspecting tracked files or a deterministic CLI gate; **[runtime]** needs a test run.
> A scenario named **Red — …** is the gate's demonstrated failure path (P4).

---

## Purpose

186 local factory definitions, 28 hand-rolled app builders, 7 Redis doubles and a Prisma double
whose raw SQL can never fail are not tooling — they are 186 opinions. This capability makes one
opinion per concern, and gates the rest out.

---

## Requirements

### Requirement: The tooling is three packages, not one, and production never imports them

The shared tooling MUST be THREE workspace packages — domain builders, wire (HTTP) doubles, and
persistence doubles — never one. A single package would put the Prisma client (and its generate
step) into the build graph of every core and provider package, which today depends on none of it.
Each package MUST be `@layer infrastructure`, export from source with no build step, and appear
only in `devDependencies`. Nothing under any `src/**` MAY import them, and the domain, shared-types
and Prisma packages MUST NOT depend on them (that edge would be a build cycle).

#### Scenario: The three packages exist with source exports and no build [static]

- **GIVEN** the three packages after the skeleton slice
- **WHEN** their manifests and tsconfigs are read
- **THEN** each exports from source, declares no build script (or a verdict-only one), and is
  referenced only from `devDependencies`

#### Scenario: Red — a production file importing test tooling fails the boundary gate [static]

- **GIVEN** a domain package source file importing a builder from the domain tooling package
- **WHEN** the complete dependency-boundary step runs
- **THEN** it exits non-zero naming the forbidden edge, and the tree restores byte-exact

---

### Requirement: Canonical builders construct aggregates through the domain's own factory

Every canonical builder MUST construct its aggregate through the aggregate's `create()` and MUST
throw a named fixture error when the result is not ok — a builder that fabricates an aggregate by
object literal can encode a state the domain forbids, and then the test proves nothing.
`reconstitute()` MAY be used ONLY for states `create()` cannot reach (published, failed,
soft-deleted). Identifiers MUST be deterministic (a counter) and the clock MUST be fixed; random
data generators MUST NOT be used. The wire package MUST expose the matching DTO builders so an
HTTP double and a domain test describe the same entity.

#### Scenario: Every builder yields an aggregate whose invariants hold [runtime]

- **GIVEN** each canonical builder
- **WHEN** the tooling package's own tests run
- **THEN** each builder returns an aggregate constructed through `create()`, with deterministic
  ids and the fixed clock

#### Scenario: Red — a builder whose inputs violate an invariant throws by name [runtime]

- **GIVEN** a builder invoked with an override that breaks a domain invariant
- **WHEN** it runs
- **THEN** it throws a fixture error naming the aggregate and the failed creation, rather than
  returning a half-valid object

---

### Requirement: One Prisma double, and its raw SQL throws

There MUST be exactly one Prisma double. Its raw-query methods MUST **throw** a message directing
the caller to the integration tier — today they answer with an empty array, so every raw-SQL path
passes by construction. Transaction support MUST cover both the callback and the array forms. All
casting to the client type MUST go through ONE named helper so the cast has a single site, and the
module factory MUST be the single way a test replaces the Prisma module. Any test that turns red
because the raw path now throws was asserting nothing about that path and MUST be recorded in the
ledger — deleted or moved to the tier, never re-stubbed.

#### Scenario: A raw-SQL call through the double throws with a directive message [runtime]

- **GIVEN** a unit test whose subject issues a raw query through the double
- **WHEN** it runs
- **THEN** the double throws naming raw SQL as unsimulated and pointing at the integration tier

#### Scenario: Red — a second Prisma double or a direct cast fails the gates [static]

- **GIVEN** in turn: a new local Prisma double; a direct `as unknown as` client cast outside the
  persistence package
- **WHEN** the builder-name and cast gates run
- **THEN** each exits non-zero naming the file, and the tree restores byte-exact

---

### Requirement: One Redis double, and an unsupported command throws

There MUST be exactly one Redis double, typed as a narrow pick of the real client, covering the
union of commands the replaced copies used, with a virtual clock for expiry. An unsupported
command MUST throw rather than return a plausible default. Behaviour the double cannot honestly
emulate (real expiry semantics, scripting, the queue library) MUST stay in the integration tier
rather than being approximated.

#### Scenario: An unsupported command throws instead of answering [runtime]

- **GIVEN** a test calling a command the double does not implement
- **WHEN** it runs
- **THEN** the double throws naming the command
- **AND** no code path receives a fabricated default

---

### Requirement: One route-app builder, in the API app's own test support, using the production error plugin

The Fastify route-test app builder MUST live in the API application's test support directory, not
in a shared package — Fastify is used by that app alone and the builder needs the app's own error
plugin, container setup and schema compilers. It MUST register the PRODUCTION error plugin, so a
route test observes the real domain-error-to-HTTP mapping. Route tests MUST exercise the real route
through injection; capturing a handler from a fake app and calling it directly MUST NOT be used.
Production code MUST NOT retain a container factory that exists only for tests.

#### Scenario: A route test observes the production error mapping through injection [runtime]

- **GIVEN** a route test built with the shared builder
- **WHEN** a domain error is raised by the use case
- **THEN** the response status and body are those the production error plugin produces

#### Scenario: Red — a hand-rolled app builder in a test fails the name gate [static]

- **GIVEN** a new local app-builder function in a test file
- **WHEN** the builder-name gate runs
- **THEN** it exits non-zero naming the function and pointing at the shared builder

---

### Requirement: Seeds are canonical, and cleanup is scoped to the tenant it seeded

The owner-connection client, the tenant seeder and the tenant cleanup MUST live in the persistence
tooling package as the single copy. Cleanup MUST delete only rows belonging to the tenant the
seeder created — today it deletes outbox rows by aggregate type with no tenant scope, which is safe
only because the tier is serial. Both protections MUST hold: the serial invariant
(`test-reach-contract`) AND the tenant scoping here. Suites needing extra fixtures MUST compose
named extensions over the canonical seed rather than copying it.

#### Scenario: Cleanup leaves another tenant's rows untouched [runtime]

- **GIVEN** two seeded tenants with outbox rows of the same aggregate type
- **WHEN** cleanup runs for the first tenant
- **THEN** only the first tenant's rows are deleted and the second tenant's rows remain

#### Scenario: Red — an inline seed copy fails the name gate [static]

- **GIVEN** a test declaring its own tenant seeder
- **WHEN** the gate runs
- **THEN** it exits non-zero naming the symbol and the canonical replacement

---

### Requirement: The name and cast gates end at zero, and every migration prunes its own suppressions

The builder-name gate MUST forbid locally-defined canonical builder names in test globs outside the
tooling packages, and the cast gate MUST forbid the double client cast outside the persistence
package. Both MUST start from a measured suppression baseline that only shrinks, and each migration
slice MUST prune the suppressions for the files it migrates in the same slice. Both gates MUST end
at hard zero with no remaining suppressions.

#### Scenario: Red — a planted local builder or cast exits non-zero [static]

- **GIVEN** in turn: a local canonical-builder declaration in a package test; a double client cast
- **WHEN** the complete lint step runs
- **THEN** each exits non-zero naming the construct, and the tree restores byte-exact

#### Scenario: The baseline only falls, and closes at zero [static]

- **GIVEN** the suppression counts for both gates on base and head
- **WHEN** a migration slice lands
- **THEN** the head count is strictly lower, no new suppression is added, and the final slice
  leaves both at zero

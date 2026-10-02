# Test Environment Contract — Specification

> New capability introduced by change `testing-refoundation` (WU-4b.1–4b.8). It fixes the
> **environment** contract: one script owns everything from "the services are reachable" onward, and
> the same command runs locally and in CI.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Tags: **[static]** decidable by
> inspecting tracked files or a deterministic CLI gate; **[runtime]** needs the services or a test
> run; **[ci]** observable only on a CI run.
>
> A scenario named **Red — …** is the gate's demonstrated failure path (P4). Three of this
> capability's refusals are SAFETY properties, not conveniences: a test run must never touch the
> development database, never share the development queues, and never talk to a running development
> server.

---

## Purpose

Four Postgres identities, six hand-written setup blocks, a database name a runner can guess from the
repository `.env`, and no script that boots the application at all. One script, one identity, one
readiness definition — and a refusal wherever a default used to hide a defect (P3).

---

## Requirements

### Requirement: One script owns the environment, and it starts no datastore

A single script MUST own environment materialisation, database preparation, process start/stop,
readiness, liveness and the wrapped run. It MUST NOT start Postgres or Redis anywhere: in CI the
workflow's service containers own them, and locally the infrastructure host does. The contract is
over WHAT is running — image major, required extension, database name, roles, ports, processes and
readiness — verified by a preflight; who started the containers is irrelevant. The previous CI
setup script MUST be absorbed and deleted, and no workflow MAY retain a hand-written setup
sequence.

#### Scenario: Every workflow and the local run use the same entrypoint [static]

- **GIVEN** the workflows after adoption
- **WHEN** they are inspected
- **THEN** no reference to the absorbed setup script remains, no workflow boots an application
  process inline, and each database-touching job reaches the datastore through the one script

#### Scenario: The wrapped run is the local entrypoint too [runtime]

- **GIVEN** the wrapped run form with the processes it needs
- **WHEN** it is invoked on a developer host
- **THEN** it materialises the environment, prepares the database, starts the processes, runs the
  command, checks liveness and tears down through a trap — the same sequence CI executes

---

### Requirement: One Postgres identity, and any database name but the test database is refused

There MUST be exactly ONE Postgres identity across all workflows and local runs: one image
(carrying the required vector extension), one database name reserved for tests, one owner role and
one application role. The preflight MUST reach and authenticate BOTH roles, MUST assert the server
major and the availability of the required extension, and MUST REFUSE any database name other than
the test database. This refusal is the data-loss protection: a test tier's destructive fixtures
must be unable to reach the development database.

#### Scenario: The preflight passes on the canonical identity [runtime]

- **GIVEN** the canonical image, database, owner and application role
- **WHEN** the preflight runs
- **THEN** both roles authenticate, the server major matches, the extension is available, and the
  database name is the test database

#### Scenario: Red — a foreign database name, a missing extension, or a login-less role each refuse [runtime]

- **GIVEN** in turn: the development database name supplied; an image without the vector extension;
  the application role altered to forbid login after migration
- **WHEN** the preflight runs
- **THEN** each exits non-zero naming the database, the extension, or the role respectively

---

### Requirement: Test queues and test ports cannot collide with a running development stack

Redis MUST use a fixed logical database reserved for tests, so a local test run cannot consume a
development worker's queues. Test ports MUST be the development ports plus ten, and the script MUST
REFUSE to start a process whose port is already bound, so a test can never talk to a development
server that happens to be up. The test port set is fixed on purpose: an override would reopen the very collision this requirement closes, so the recovery path is stopping the foreign listener the refusal names.

#### Scenario: Red — an already-bound port is refused [runtime]

- **GIVEN** a process already listening on the test API port
- **WHEN** the script is asked to start the API
- **THEN** it exits non-zero naming the port and, where the platform exposes it, the listening process, and starts nothing

#### Scenario: The reserved logical database is fixed, not derived [static]

- **GIVEN** the script's constants
- **WHEN** they are read
- **THEN** the Redis logical database for tests is a fixed reserved index, and no caller can
  override it into the development index

---

### Requirement: Migration state is verified, and a contaminated database is named rather than used

The database step MUST detect contamination — recorded migrations with no corresponding migration
directory in the tree — and MUST report that a reset is required rather than proceeding against a
schema nobody can reproduce. A reset mode MUST drop and recreate the database, then migrate as the
owner, enable the application role's login, and seed as the owner.

#### Scenario: Red — a recorded migration with no directory reports "reset required" [runtime]

- **GIVEN** a migration row in the database with no matching directory in the tree
- **WHEN** the database step runs without a reset
- **THEN** it exits non-zero naming the orphan migration and the reset mode

---

### Requirement: Readiness is probed, and liveness is a verdict

Process start MUST be followed by a bounded readiness probe per process, and a worker MUST be
considered ready only when its consuming registration is observable — not merely when its port
answers. A liveness check MUST be available as its own verdict so a run that ends with a dead
process fails, and the tier's per-file probe (`test-reach-contract`) MUST read the same variables
the script exports. Process identifiers and logs MUST be written to a run directory the CI runner
and the local host each provide.

#### Scenario: Red — a broken boot, a dead process, or an unset base URL each fail by name [runtime]

- **GIVEN** in turn: the API's environment broken so it exits during boot; the workers killed
  mid-run; the API base URL unset
- **WHEN** start, liveness and the live tier run respectively
- **THEN** the first exits non-zero inside its readiness window naming the boot failure, the second
  exits non-zero, and the third fails naming the missing variable rather than defaulting to a
  development address

---

### Requirement: The test-environment loader fails closed with an actionable message

The loader MUST locate the repository root programmatically (never by counting parent directories),
load the generated environment file, and THROW naming the command that regenerates it when the file
is absent. A missing environment MUST NOT surface as a schema-validation error from an unrelated
module, and MUST NOT fall back to any ambient value.

#### Scenario: Red — a missing environment file names the regenerating command [runtime]

- **GIVEN** the generated environment file moved away
- **WHEN** any package's suite runs
- **THEN** it exits non-zero with a message naming the environment command, not a schema error

---

### Requirement: The hermetic profile makes an accidental service dependency fail fast

The hermetic profile MUST point every datastore URL at an unreachable address rather than leaving it
unset, so a unit test that secretly needs a service fails in seconds with a connection refusal
instead of hanging or silently reaching a real service. The canonical hermetic URL MUST have ONE
definition, read by the workflows rather than retyped.

#### Scenario: Red — a unit test that opens a connection fails fast under hermetic [runtime]

- **GIVEN** a package test that connects to Postgres, run under the hermetic profile
- **WHEN** it runs
- **THEN** it fails within a few seconds with a connection refusal naming the unreachable address

#### Scenario: The sharded unit lane runs hermetic once measured [ci]

- **GIVEN** the unit shards measured under the hermetic profile
- **WHEN** the failures are zero
- **THEN** the service containers and database steps are removed from that job
- **AND** if failures are non-zero, those files are recorded as mis-tiered in the ledger and the
  removal waits

---

### Requirement: Environment identity is gated, not conventional (#47)

A fitness check MUST assert the identity: every Postgres service block uses the canonical image,
database and owner; every Redis service block uses the canonical image; every datastore URL literal
in a workflow is the canonical hermetic URL read from the script rather than retyped; no workflow
boots an application process inline; and the example environment file's keys equal the script's
required input set. The check MUST fail closed when it parses nothing.

#### Scenario: Red — each identity violation exits 1 [static]

- **GIVEN** in turn: a non-canonical Postgres image; a retyped datastore URL literal; an inline
  application boot; a key removed from the example environment file
- **WHEN** the complete step runs
- **THEN** each exits 1 naming the workflow and the violation, and the tree restores byte-exact

---

### Requirement: The browser runner's servers come from the same script

The end-to-end configurations MUST delegate their server startup to the environment script — the
same command locally and in CI — and MUST NOT reuse an already-running server. Base URLs MUST read
dedicated per-portal variables rather than one overloaded variable.

#### Scenario: Red — a broken API environment fails at server startup, before any test [runtime]

- **GIVEN** the API's environment broken
- **WHEN** the browser runner starts
- **THEN** it fails during server startup, before any test executes

#### Scenario: Collection is unchanged by the delegation [static]

- **GIVEN** the configurations before and after
- **WHEN** the runner lists its tests
- **THEN** the collected set is identical

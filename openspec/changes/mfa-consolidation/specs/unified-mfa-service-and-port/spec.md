# Unified MFA Service and Port — Delta Spec (N-SEC-5 / Cluster B)

> Delta spec for change `mfa-consolidation`. Capability: **one MFA service,
> reached only through a technology-free port + DI, serves BOTH admin and
> customer subjects with identical capabilities** — setup (secret + backup
> codes), verify (TOTP AND single-use backup-code login), regenerate backup
> codes, force-disable (self + admin-over-subject), and status.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Every
> requirement carries Given/When/Then scenarios written to be turned directly
> into a FAILING test (RED) that the implementer then makes GREEN. Scenarios
> anchored to a concrete confirmed gap in the incomplete new service are marked
> **[anchor]**. Requirements whose failure is an auth-correctness, disclosure,
> or feature-parity regression are marked **[MERGE-BLOCKING]** — they gate the PR.
>
> Behavior-first: these requirements state WHAT must be guaranteed, not the port
> method shape, whether one subject-typed MFA-user adapter or two adapters sit
> behind the port, or the code storage encoding — those are design-phase choices.

---

## ADDED Requirements

### Requirement: One MFA capability serves both subjects via a port **[MERGE-BLOCKING]**

A SINGLE MFA capability MUST serve both the admin subject and the customer
subject with an identical set of operations (setup, verify, regenerate,
force-disable, status). The capability MUST be reached only through a
technology-free MFA port resolved from the composition root via DI. The service
MUST NOT import a Prisma singleton, MUST NOT `new` an adapter inline, and MUST
receive its collaborators by constructor injection (fitness #21). All hashing of
backup codes and secrets MUST go through the canonical `passwordHashing.ts`
helper (fitness #18). No second, parallel MFA service may remain.

#### Scenario: Admin subject runs the full MFA lifecycle

- GIVEN the MFA service resolved from DI for an admin subject
- WHEN the caller invokes setup, verify, regenerate, force-disable, and status in turn
- THEN each operation succeeds for the admin subject with no missing capability

#### Scenario: Customer subject runs the identical lifecycle **[anchor]**

- GIVEN the MFA service resolved from DI for a customer subject
- WHEN the caller invokes the same five operations for the customer subject
- THEN each operation behaves identically to the admin subject (full parity, no capability the new service previously lacked)

#### Scenario: Service is wired only through the composition root

- GIVEN the MFA service and its adapter
- WHEN the DI graph is assembled
- THEN the service receives its port by injection, imports no Prisma singleton, and uses no inline `new` (fitness #21 stays hard-zero)

---

### Requirement: Setup issues a secret and backup codes for either subject **[MERGE-BLOCKING]**

MFA setup MUST issue a TOTP secret AND a set of single-use backup codes for
either subject type. Backup codes MUST be persisted only in hashed form via the
canonical hasher; the plaintext codes MUST be returned to the caller exactly
once at setup and never re-derivable from storage.

#### Scenario: Admin setup issues secret plus backup codes

- GIVEN an admin subject with no MFA enrolled
- WHEN setup runs
- THEN a TOTP secret and a fresh set of backup codes are issued
- AND the stored codes are hashed via the canonical helper, not plaintext

#### Scenario: Customer setup issues secret plus backup codes (parity)

- GIVEN a customer subject with no MFA enrolled
- WHEN setup runs
- THEN a TOTP secret and a fresh set of backup codes are issued (identical shape to admin)

---

### Requirement: Backup-code login parity **[MERGE-BLOCKING]**

Given a subject (admin OR customer) enrolled with backup codes, when they verify
with a valid unused backup code, then login MUST succeed AND that code MUST be
marked single-use so it cannot be reused. This is the capability the incomplete
new service LACKED.

#### Scenario: Valid unused backup code logs in an admin **[anchor]**

- GIVEN an enrolled admin subject with unused backup codes
- WHEN they verify with a valid unused backup code
- THEN login succeeds
- AND that code is marked used and cannot be presented again

#### Scenario: Valid unused backup code logs in a customer (parity)

- GIVEN an enrolled customer subject with unused backup codes
- WHEN they verify with a valid unused backup code
- THEN login succeeds and the code is marked single-use

#### Scenario: A used backup code is rejected

- GIVEN a backup code already consumed by an earlier successful verify
- WHEN the same code is presented again
- THEN verification fails and no login is granted

#### Scenario: An unknown backup code is rejected

- GIVEN a code that was never issued to the subject
- WHEN it is presented
- THEN verification fails

---

### Requirement: Regenerate backup codes **[MERGE-BLOCKING]**

Given an enrolled subject, when backup codes are regenerated, then the old codes
MUST stop working and a fresh set MUST be issued.

#### Scenario: Old codes stop working after regeneration

- GIVEN an enrolled subject holding a previously issued backup code
- WHEN backup codes are regenerated
- THEN presenting an old (pre-regeneration) code fails verification

#### Scenario: Fresh codes work after regeneration

- GIVEN a subject who just regenerated backup codes
- WHEN they verify with one of the newly issued codes
- THEN verification succeeds and that code becomes single-use

---

### Requirement: TOTP verification (algorithm unchanged)

A valid current TOTP for an enrolled subject MUST verify; an invalid or expired
TOTP MUST fail. The TOTP algorithm and library MUST NOT change (do-not-regress —
out of scope per the proposal).

#### Scenario: Valid current TOTP verifies

- GIVEN an enrolled subject and a TOTP valid for the current time step
- WHEN it is presented to verify
- THEN verification succeeds

#### Scenario: Invalid TOTP fails

- GIVEN an enrolled subject and a TOTP outside the accepted window
- WHEN it is presented
- THEN verification fails

---

### Requirement: adminForceDisable over both subjects **[MERGE-BLOCKING]**

Given an admin actor, when they force-disable MFA for an admin OR a customer
subject, then that subject's MFA MUST be disabled AND an audit event MUST be
recorded. This supports the locked-out-customer support workflow. The audit
event MUST identify actor and subject and MUST carry no secret material.

#### Scenario: Admin force-disables an admin subject

- GIVEN an admin actor and an enrolled admin subject
- WHEN the actor force-disables the subject's MFA
- THEN the subject's MFA is disabled AND an audit event is recorded

#### Scenario: Admin force-disables a customer subject **[anchor]**

- GIVEN an admin actor and an enrolled customer subject (locked-out support case)
- WHEN the actor force-disables the customer's MFA
- THEN the customer's MFA is disabled AND an audit event is recorded

#### Scenario: The audit event carries identity but no secret material

- GIVEN a force-disable that produced an audit event
- WHEN the event payload is inspected
- THEN it names the actor and the subject
- AND it contains no TOTP secret and no backup-code material

---

### Requirement: Status reports enrollment without disclosing secrets

Status MUST report whether MFA is enabled for a subject and how many backup codes
remain unused, for either subject type. Status MUST NOT return the raw TOTP secret
or any backup-code value.

#### Scenario: Status reports enabled state and remaining code count

- GIVEN an enrolled subject with some unused backup codes
- WHEN status is requested
- THEN it reports MFA enabled and the count of remaining unused codes

#### Scenario: Status never returns secret or code material

- GIVEN any subject
- WHEN status is requested
- THEN the response contains no raw secret and no backup-code value

---

## Verification note (strict TDD — RED→GREEN)

Backend unit scenarios are **vitest** in `apps/api/tests/unit/` with mock adapters
behind the MFA port. Backup-code login, regenerate, and adminForceDisable are the
three RED anchors: against the incomplete new service they FAIL (no backup-code
verify, no `regenerateBackupCodes`, no `adminForceDisable`), and go GREEN once the
ported capabilities land behind the DI-resolved port. Subject-parity scenarios run
once per subject type. DI-wiring and fitness (#18 hasher, #21 injection) are
asserted by the existing fitness greps staying hard-zero. Any scenario needing a
real store is a **node:test** integration test requiring DB + Redis via
`pnpm db:up`. LXC: run a single test file, heap-capped (`--max-old-space-size`),
under a `timeout` wrapper — never the full suite at once. New production/helper
code carries tests + JSDoc `@file/@description/@layer` per canon.

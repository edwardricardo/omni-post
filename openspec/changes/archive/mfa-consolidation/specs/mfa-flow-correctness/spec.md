# MFA Flow Correctness — Delta Spec (N-SEC-5 / Cluster B)

> Delta spec for change `mfa-consolidation`. Capability: **each subject's MFA
> routes operate on the correct table, no subject can touch another
> subject-type's MFA state, no secret material is ever logged, and the legacy
> service is retired with zero remaining references**.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Every requirement
> carries Given/When/Then scenarios written to be turned directly into a FAILING
> test (RED) then made GREEN. Scenarios anchored to a concrete confirmed bug are
> marked **[anchor]**. Requirements whose failure is an auth-correctness,
> cross-subject, or disclosure regression are marked **[MERGE-BLOCKING]**.
>
> Behavior-first: these requirements state WHAT correctness the flows guarantee,
> not the route handler wiring or field-mapping code — those are implementation.

---

## ADDED Requirements

### Requirement: MFA routes target the correct subject table **[MERGE-BLOCKING]**

Customer MFA routes MUST operate on `CustomerUser`, and admin MFA routes MUST
operate on `AdminUser`. The confirmed identity mismatch — customer routes reading
`request.customerUser?.id` while the legacy service wrote the `AdminUser` table —
MUST be fixed, and the `userEmail = customerUser?.id` bug (an id assigned where an
email belongs) MUST be corrected. A subject MUST NOT be able to read or write
another subject-type's MFA state.

#### Scenario: Customer route reads and writes the CustomerUser record **[anchor]**

- GIVEN an authenticated customer invoking a customer MFA route
- WHEN the route performs an MFA operation
- THEN it reads and writes that customer's `CustomerUser` MFA state, never an `AdminUser` row

#### Scenario: userEmail is the email, not the id **[anchor]**

- GIVEN a customer MFA operation that records or uses `userEmail`
- WHEN the value is populated
- THEN it is the customer's email address, not the customer's id

#### Scenario: Admin route operates on the AdminUser record

- GIVEN an authenticated admin invoking an admin MFA route
- WHEN the route performs an MFA operation
- THEN it reads and writes that admin's `AdminUser` MFA state

#### Scenario: No cross-subject MFA mutation

- GIVEN a customer request and an admin subject with enrolled MFA (and the mirror case)
- WHEN the customer flow executes
- THEN no `AdminUser` MFA state is read or mutated by the customer flow, and vice versa

---

### Requirement: No secret material is logged and audit events carry none **[MERGE-BLOCKING]**

No TOTP secret, backup code, or setup secret may ever be written to logs; the
flows MUST rely on `REDACT_PATHS` for defence-in-depth. Audit events emitted by MFA
operations MUST carry no secret material.

#### Scenario: Logs during MFA operations contain no secret material

- GIVEN setup, verify, regenerate, and force-disable running for a subject
- WHEN log output is captured
- THEN it contains no TOTP secret and no backup-code value (redacted or never logged)

#### Scenario: Audit event payload carries identity but no secret

- GIVEN an MFA operation that emits an audit event
- WHEN the event payload is inspected
- THEN it carries the subject and actor identity but no secret or code material

---

### Requirement: Legacy MFA service is retired with zero references

The legacy `apps/api/src/auth/mfaService.ts` MUST be deleted and MUST have zero
remaining references (imports and DI wiring). The TOTP algorithm MUST remain
unchanged after retirement (do-not-regress).
(Reason: two coexisting MFA services risk divergent, incomplete behavior.)
(Migration: all callers resolve the unified port-based service via DI.)

#### Scenario: Legacy module no longer exists

- GIVEN the change is applied
- WHEN the source tree is inspected
- THEN `apps/api/src/auth/mfaService.ts` does not exist

#### Scenario: No remaining references to the legacy module

- GIVEN the change is applied
- WHEN the source tree is searched for imports of or DI wiring for the legacy service
- THEN zero references remain

#### Scenario: TOTP behavior is unchanged after retirement

- GIVEN a subject enrolled before the retirement
- WHEN they verify with a valid current TOTP after the unified service is in place
- THEN verification succeeds using the same TOTP algorithm as before

---

## Verification note (strict TDD — RED→GREEN)

Subject-targeting scenarios are the RED anchors: against today's code the customer
route resolves against `AdminUser` and `userEmail` is assigned the id, so the
CustomerUser-targeting and userEmail tests FAIL; they go GREEN once the routes are
repointed and the field mapping is corrected. Route-level correctness is a
**node:test** integration test requiring DB + Redis via `pnpm db:up`; the
no-secret-logging assertions can run as **vitest** unit tests capturing a logger
spy in `apps/api/tests/unit/`. Legacy-retirement scenarios are asserted by a
grep/existence check (zero references, file absent). LXC: run a single test file,
heap-capped (`--max-old-space-size`), under a `timeout` wrapper — never the full
suite at once. New/changed code carries tests + JSDoc `@file/@description/@layer`
per canon.

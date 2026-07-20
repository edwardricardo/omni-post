# MFA Flow Correctness — Specification

> Living specification for the **mfa-flow-correctness** capability: each subject's
> MFA routes operate on the correct table, no subject can touch another
> subject-type's MFA state, no secret material is ever logged, and the legacy
> dual-service duality has been retired with zero remaining references.
>
> Source of truth: change `mfa-consolidation` (N-SEC-5, Cluster B), PR1/PR2 (route
> subject-targeting fix) and PR3 (`d2bd7b40`/`7f95bf2e`, legacy service deletion).
> Design detail: `openspec/changes/archive/mfa-consolidation/design.md`
> (Decisions 4 and 6).
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Each requirement
> carries Given/When/Then acceptance scenarios. Scenarios anchored to a concrete
> confirmed bug are marked **[anchor]**. Requirements whose failure is an
> auth-correctness, cross-subject, or disclosure regression are marked
> **[MERGE-BLOCKING]**.

---

## Requirements

### Requirement: MFA routes target the correct subject table **[MERGE-BLOCKING]**

Customer MFA routes operate on `CustomerUser`, and admin MFA routes operate on
`AdminUser`. A subject MUST NOT be able to read or write another subject-type's
MFA state.

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

#### Scenario: A customer cannot reach another customer's MFA state via a mismatched account claim

- GIVEN a customer's authenticated request whose token account claim does not match the resolved subject's real account
- WHEN an MFA self-service route is invoked
- THEN the request is rejected (not fulfilled against a different customer's row)

---

### Requirement: No secret material is logged and audit events carry none **[MERGE-BLOCKING]**

No TOTP secret, backup code, or setup secret may ever be written to logs; the
flows rely on `REDACT_PATHS` for defence-in-depth. Audit events emitted by MFA
operations carry no secret material.

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

The legacy `apps/api/src/auth/mfaService.ts` is deleted and has zero remaining
references (imports and DI wiring). The TOTP algorithm remains unchanged after
retirement (do-not-regress).
(Reason: two coexisting MFA services risked divergent, incomplete behavior — one
storing backup codes in the wrong column, the other missing backup-code login,
regenerate, and force-disable.)
(Migration: all callers resolve the unified port-based service via DI.)

#### Scenario: Legacy module no longer exists

- GIVEN the change is applied
- WHEN the source tree is inspected
- THEN `apps/api/src/auth/mfaService.ts` does not exist

#### Scenario: No remaining references to the legacy module

- GIVEN the change is applied
- WHEN the source tree is searched for imports of or DI wiring for the legacy service
- THEN zero references remain (excluding historical "why" prose comments that do not import the module)

#### Scenario: TOTP behavior is unchanged after retirement

- GIVEN a subject enrolled before the retirement
- WHEN they verify with a valid current TOTP after the unified service is in place
- THEN verification succeeds using the same TOTP algorithm as before

---

## How to extend

1. **New MFA-adjacent route** — derive the subject strictly from the authenticated
   request context (JWT subject / session), never from a caller-supplied id
   parameter, so cross-subject and cross-account isolation hold by construction.
2. **New logged/audited MFA field** — run it past `REDACT_PATHS` and the audit
   payload shape before adding it; secret material is never an acceptable payload
   field, redacted or not.
3. **Amending a MERGE-BLOCKING requirement** — requires an ADR; these are the
   acceptance criteria that closed N-SEC-5 and must not silently regress.

Companion capability: `customer-login-mfa-challenge` retires a separate orphan
route (`POST /auth/mfa/verify`, the login-time verify endpoint) as part of
introducing the real customer login MFA gate — see that capability's spec.
Companion audit trail: `openspec/changes/archive/mfa-consolidation/design.md`
(Decisions 4, 6), `verify-report.md` (PR1, PR2, PR3 sections).

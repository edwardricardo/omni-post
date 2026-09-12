# Unified MFA Service and Port — Specification

> Living specification for the **unified-mfa-service-and-port** capability: a SINGLE
> MFA service, reached only through a technology-free `MfaUserRepositoryPort` + DI,
> serves both the admin subject and the customer subject with an identical set of
> operations (setup, verify — TOTP and single-use backup-code login, regenerate,
> force-disable, status), and TOTP verification is single-use for both subjects.
>
> Source of truth: change `mfa-consolidation` (N-SEC-5, Cluster B). PR1 (`005b7252`)
> completed the service and its DI wiring; PR2b-1 (`da8ef686`) closed a TOTP-replay
> gap discovered during the login-challenge exploration (NIST SP 800-63B §5.1.5.2).
> Design detail: `openspec/changes/archive/mfa-consolidation/design.md`
> (Decisions 1–2) and `design-pr2b.md` (Decision 2).
>
> Change `mfa-backup-code-single-use` (PR #246, `fdda5d25`) strengthened "Backup-code
> login parity" from a mark that two staggered concurrent verifications could both
> complete to the observable single-use guarantee, and added the used-index-filter-is-
> cost-not-control requirement. The claim contract itself (at most one claim per
> `(userId, codeIndex)`, immutable winner timestamp, the conformance suite, the
> reachable alarm) lives in the companion `mfa-backup-code-claim` capability. Design
> detail: `openspec/changes/archive/mfa-backup-code-single-use/design.md` (Decisions
> D1–D7).
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Each requirement
> carries Given/When/Then acceptance scenarios. Requirements marked
> **[MERGE-BLOCKING]** are the acceptance criteria that gated the closing change(s) —
> their failure is an auth-correctness, disclosure, or feature-parity regression and
> must never regress. Scenarios marked **[anchor]** carry a concrete confirmed gap
> reproduced during remediation.

---

## Requirements

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
- THEN each operation behaves identically to the admin subject (full parity, no capability the pre-consolidation service lacked)

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

Given a subject (admin OR customer) enrolled with backup codes, when they verify with a
valid unused backup code, then login MUST succeed AND that code MUST be CLAIMED: consumed at
most once across every sequential and concurrent presentation, INCLUDING the interleaving in
which a second verification's deciding read is taken after the first verification's claim has
committed. One backup code MUST mint at most one session.

The adapter claim MUST be the SOLE authority for whether THIS caller consumed the code. No
service-level read of a pre-verification snapshot may stand in for it, and a refused claim
MUST reject the verification with an invalid-token verdict — never a success, never an opaque
database error — and MUST NOT grant a session.

Any remaining-code count reported or audited alongside a successful claim MUST reflect state
read AFTER the claim committed. Deriving it from the pre-verification snapshot reports a
count that was already stale when the argon2 loop began, and reports it as fact in the audit
trail. The port method signature MUST remain byte-identical while this holds.

#### Scenario: Valid unused backup code logs in an admin **[anchor]**

- GIVEN an enrolled admin subject with unused backup codes
- WHEN they verify with a valid unused backup code
- THEN login succeeds
- AND that code is claimed and cannot be presented again

#### Scenario: Valid unused backup code logs in a customer (parity)

- GIVEN an enrolled customer subject with unused backup codes
- WHEN they verify with a valid unused backup code
- THEN login succeeds and the code is claimed

#### Scenario: A used backup code is rejected

- GIVEN a backup code already consumed by an earlier successful verify
- WHEN the same code is presented again
- THEN verification fails, no login is granted, and the refusal is the claim's verdict — not the outcome of a snapshot filter that decided before any claim was attempted

#### Scenario: An unknown backup code is rejected

- GIVEN a code that was never issued to the subject
- WHEN it is presented
- THEN verification fails

#### Scenario: One code, two staggered logins, one session [integration]

- GIVEN an enrolled subject and two logins presenting the SAME backup code, ordered so the second's deciding read happens deterministically after the first's claim has committed
- WHEN both run against the real database
- THEN exactly ONE login succeeds, the other is rejected as an invalid token, and exactly one session exists

#### Scenario: A refused claim never reports verified [unit]

- GIVEN a verification whose claim is refused with `ALREADY_USED`
- WHEN the service returns
- THEN it returns the invalid-token verdict; it never returns `verified`, and it never surfaces a database error for this case

#### Scenario: The audited remaining count reflects post-claim state [unit]

- GIVEN a successful backup-code verification for a subject whose used-map changed between the deciding read and the claim
- WHEN the consumption audit event is inspected
- THEN its remaining-code count matches the state persisted by the claim, not the count derivable from the pre-verification snapshot

---

### Requirement: The service-level used-index filter is a cost optimisation, not a security control **[MERGE-BLOCKING]**

The service MAY skip verifying a code whose index its own snapshot already shows consumed,
SOLELY to avoid argon2 work (up to 8 serial verifies at m=64MiB, t=3, p=4). That filter
SHALL NOT be relied on for single-use: it reads a snapshot taken before a several-hundred-
millisecond hashing window, so under the attack interleaving it is stale exactly when it
would matter. Removing it SHALL change cost and nothing else.

Its presence SHALL be documented as an optimisation where it is written, so the next reader
does not mistake it for the control.

#### Scenario: the guarantee survives the filter being removed [unit]

- GIVEN the verification path with the used-index filter mutated away in the harness
- WHEN an already-claimed code is presented, and when the staggered pair is replayed
- THEN the single-use verdicts are unchanged: the already-claimed code is rejected, and exactly one of the staggered pair succeeds

#### Scenario: the filter is documented as cost, not control [static]

- GIVEN the change is applied
- WHEN the used-index filter's comment is read
- THEN it names itself an argon2-cost optimisation and points at the adapter claim as the authority; it does not describe itself as preventing reuse

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
TOTP MUST fail. The TOTP algorithm and library MUST NOT change (do-not-regress).

#### Scenario: Valid current TOTP verifies

- GIVEN an enrolled subject and a TOTP valid for the current time step
- WHEN it is presented to verify
- THEN verification succeeds

#### Scenario: Invalid TOTP fails

- GIVEN an enrolled subject and a TOTP outside the accepted window
- WHEN it is presented
- THEN verification fails

---

### Requirement: TOTP verification is single-use for both subjects **[MERGE-BLOCKING]**

A given TOTP code MUST verify successfully at most once per subject, for BOTH the
admin and the customer subject. The service MUST track the last accepted TOTP
time step per subject and reject any code whose step is not strictly greater than
the last accepted step. Rejection MUST NOT lock the subject out of the next valid
30-second step. A replay attempt MUST be audited as a HIGH-severity event without
leaking secret material. (Reason: NIST SP 800-63B §5.1.5.2 requires verifiers to
accept a given time-based OTP only once during its validity period; the pre-fix
TOTP window of ±2 steps allowed a ~150s replay for both subjects.)

#### Scenario: A TOTP is accepted once, then rejected on replay — either subject **[anchor]**

- GIVEN an enrolled subject (admin or customer) and a TOTP valid for the current time step
- WHEN the same TOTP is presented a first time, then presented again
- THEN the first presentation verifies successfully
- AND the second presentation of the identical code is rejected as invalid

#### Scenario: The next 30-second step is still accepted (no lockout)

- GIVEN a subject whose current TOTP step has just been claimed
- WHEN the wall clock advances to the next 30-second step and a fresh TOTP is presented
- THEN verification succeeds (claiming a step never blocks a later, higher step)

#### Scenario: A replayed TOTP is audited without secret material

- GIVEN a rejected TOTP replay for either subject
- WHEN the audit trail is inspected
- THEN a HIGH-severity replay event is recorded
- AND the event carries no TOTP secret and no backup-code value

#### Scenario: Reusing a just-verified TOTP for a different mutating MFA operation is rejected

- GIVEN a subject who just logged in with a TOTP
- WHEN the same TOTP is immediately presented to regenerate backup codes or disable MFA
- THEN that presentation is rejected (single-use spans every MFA operation that accepts a TOTP, not just login)

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

#### Scenario: The audit event attributes the acting admin, not the disabled subject

- GIVEN an admin actor force-disabling a CUSTOMER subject's MFA
- WHEN the audit event is inspected
- THEN the acting admin is identifiable as the actor of the event, distinct from the disabled customer subject

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

## How to extend

1. **New subject type** (e.g. a third principal type) — add it to the `MfaSubject`
   const-object union and a corresponding Prisma adapter implementing
   `MfaUserRepositoryPort`; the service dispatches by `subject.type`, never by
   inline conditionals scattered across call sites.
2. **New MFA operation** — add it to the port + both adapters + the service; every
   operation MUST work identically for both subjects (parity is the contract, not
   an implementation detail).
3. **Amending a MERGE-BLOCKING requirement** — requires an ADR; these are the
   acceptance criteria that closed N-SEC-5 and must not silently regress.

Companion capability: `customer-login-mfa-challenge` (the customer login second-factor
gate) depends on this capability's TOTP/backup-code verification and single-use
guarantee via `MfaVerificationPort`. Companion capability: `mfa-backup-code-claim` (the
claim contract that this capability's backup-code parity requirement now defers to —
at most one claim per `(userId, codeIndex)`, immutable winner timestamp, the
port-conformance suite, the reachable reuse alarm). Archived change artifacts:
`openspec/changes/archive/mfa-consolidation/design.md` (Decisions 1–3),
`design-pr2b.md` (Decision 2), `verify-report.md` (PR1, PR2b-1 sections);
`openspec/changes/archive/mfa-backup-code-single-use/design.md` (Decisions D1–D7),
`archive-report.md` (defect disposition, the §6.1 SQL-capture corroboration).

# Unified MFA Service and Port — Delta Spec (mfa-backup-code-single-use)

> **MODIFIED capability** `unified-mfa-service-and-port` for change
> `mfa-backup-code-single-use`. Delta: **"Backup-code login parity" strengthens from "the
> code is marked single-use" to the observable single-use GUARANTEE under the staggered
> interleaving; the adapter claim becomes the SOLE authority for whether this caller consumed
> the code; and any count reported alongside a success is read back from post-claim state
> instead of computed from the pre-verification snapshot.**
>
> **This delta closes a live gap in the capability's own MERGE-BLOCKING requirement.** The
> requirement says a valid unused backup code logs in AND "that code MUST be marked
> single-use so it cannot be reused". It is satisfiable — and is satisfied today — by a mark
> that two concurrent verifications can both complete: the second verification's snapshot,
> taken after the first commits, matches the compare-and-swap comparand, so both are marked
> and both mint a session inside the hundreds-of-milliseconds argon2 window. NIST SP
> 800-63B-4 §3.1.2.2: a look-up secret SHALL be used successfully only once.
>
> The claim contract itself — at most one `ok` per `(userId, codeIndex)`, an immutable
> winner timestamp, `ALREADY_USED` meaning claimed, the conformance suite, the alarm, and the
> wiring — lives in the NEW `mfa-backup-code-claim` capability. This delta is the MFA
> service's acceptance of it. Nothing in the TOTP, setup, regenerate, force-disable, or
> status requirements moves.
>
> RFC 2119 keywords are normative; tags follow the living spec (`[unit]`, `[integration]`,
> `[static]`, `[anchor]`).

---

## MODIFIED Requirements

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

(Previously: the requirement said only that a used code "is marked single-use so it cannot be
reused" — a wording satisfied by the current mark, which two racers can both complete; the
service additionally skipped indexes found used in its own pre-verification snapshot and
computed the audited remaining count from that same snapshot.)

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

## ADDED Requirements

### Requirement: The service-level used-index filter is a cost optimisation, not a security control **[MERGE-BLOCKING]**

The service MAY skip verifying a code whose index its own snapshot already shows consumed,
SOLELY to avoid argon2 work (up to 8 serial verifies at m=64MiB, t=3, p=4). That filter
SHALL NOT be relied on for single-use: it reads a snapshot taken before a several-hundred-
millisecond hashing window, so under the attack interleaving it is stale exactly when it
would matter. Removing it SHALL change cost and nothing else.

Its presence SHALL be documented as an optimisation where it is written, so the next reader
does not mistake it for the control — the mistake this capability exists to retire.

#### Scenario: the guarantee survives the filter being removed [unit]

- GIVEN the verification path with the used-index filter mutated away in the harness
- WHEN an already-claimed code is presented, and when the staggered pair is replayed
- THEN the single-use verdicts are unchanged: the already-claimed code is rejected, and exactly one of the staggered pair succeeds

#### Scenario: the filter is documented as cost, not control [static]

- GIVEN the change is applied
- WHEN the used-index filter's comment is read
- THEN it names itself an argon2-cost optimisation and points at the adapter claim as the authority; it does not describe itself as preventing reuse

---

## Verification note

The staggered integration scenario is this delta's acceptance and is RED today by SUCCEEDING
TWICE — a green-looking red, so it is asserted against the stored row and the session count,
never against which repository methods a double recorded. The service runs against
`InMemoryMfaUserRepository`, which already refuses an already-claimed index, so a green
service-level suite proves nothing about production: the adapter and conformance evidence in
the `mfa-backup-code-claim` capability carries that weight. The TOTP single-use requirement
and `claimTotpStep` are NOT modified by this delta — that claim is the reference
implementation this one converges toward.

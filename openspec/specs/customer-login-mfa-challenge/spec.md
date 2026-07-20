# Customer Login MFA Challenge — Specification

> Living specification for the **customer-login-mfa-challenge** capability: a
> customer whose account has MFA enabled MUST complete a second factor before a
> session is minted at login — a short-lived, single-use, fail-closed challenge
> gate, not a password re-transmission — and the legacy orphan login-verify route
> is retired now that a real gate exists.
>
> Source of truth: change `mfa-consolidation` (N-SEC-5, Cluster B), PR2b (3 chained
> sub-slices: PR2b-1 `da8ef686`, PR2b-2 `eb84ee28`, PR2b-3 `806eaf60` + `e9a75e8a`).
> This capability was NOT part of the original `mfa-consolidation` proposal — it was
> added mid-change after `sdd-explore` (`exploration-pr2b.md`) found that customer
> login never challenged MFA at all (`LoginCustomerUseCase` never read
> `mfaEnabled`), a gap distinct from the persistence/routing work PR1–PR3 closed.
> Full architecture: `openspec/changes/archive/mfa-consolidation/design-pr2b.md`.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Each requirement
> carries Given/When/Then acceptance scenarios. Requirements marked
> **[MERGE-BLOCKING]** are the acceptance criteria that gated PR2b-3 (the highest-risk
> slice — the authentication gate itself) — their failure is a fail-open bypass, a
> session-fixation/replay hole, or an authentication oracle, and must never regress.
> This capability depends on `unified-mfa-service-and-port` for TOTP/backup-code
> verification and its single-use guarantee (`MfaVerificationPort`).

---

## Requirements

### Requirement: No session is minted before the second factor completes **[MERGE-BLOCKING]**

When a customer with `mfaEnabled` authenticates with a correct password, the
login step MUST NOT mint an access/refresh token pair, record a successful
brute-force attempt, or persist a login record. It MUST instead issue a
short-lived, single-use challenge and return it to the caller. A session is
minted only after the second factor is verified in a separate completion step.

#### Scenario: Password-correct login with MFA enabled returns a challenge, not tokens

- GIVEN a customer with `mfaEnabled = true` and a correct password
- WHEN they submit login
- THEN the response carries a challenge (not an access/refresh token pair)
- AND no login is recorded and no brute-force success is recorded yet

#### Scenario: A customer without MFA enabled is unaffected

- GIVEN a customer with `mfaEnabled = false` and a correct password
- WHEN they submit login
- THEN a session is minted immediately, exactly as before this capability existed

---

### Requirement: The challenge is single-use, enforced atomically server-side **[MERGE-BLOCKING]**

The challenge MUST be consumable exactly once. Single-use enforcement MUST be
atomic against concurrent completion attempts for the same challenge — the
challenge artifact (e.g. a signed token) is never trusted alone for replay
protection; a server-side atomic consume is authoritative.

#### Scenario: Two concurrent completions of the same challenge yield exactly one success

- GIVEN a valid, unexpired challenge and its correct second-factor code
- WHEN two completion requests race to consume the same challenge concurrently
- THEN exactly one of them succeeds and mints a session
- AND the other is rejected as an invalid/expired challenge

#### Scenario: A second, sequential completion of an already-consumed challenge fails

- GIVEN a challenge that has already been successfully consumed
- WHEN it is presented again
- THEN the completion is rejected

---

### Requirement: The challenge store fails closed, never open **[MERGE-BLOCKING]**

If the server-side store backing challenge issuance or consumption is
unavailable, the login MUST NOT fall back to minting a session without the
second factor. A store failure at issuance MUST prevent the challenge from being
usable; a store failure at completion MUST prevent a session from being minted.
The gate's fail-closed posture is a deliberate contrast to availability controls
(e.g. the HTTP rate limiter) that fail open — an authentication control failing
open would silently bypass the second factor.

#### Scenario: Store failure at challenge issuance never grants a session

- GIVEN the challenge store is unavailable when a customer with MFA enabled logs in
- WHEN login is attempted
- THEN no session is minted and no usable challenge is issued
- AND the caller is told the second factor is temporarily unavailable, not that login failed for a normal reason

#### Scenario: Store failure at challenge completion never grants a session

- GIVEN a valid challenge and a correct code, but the store is unavailable at completion time
- WHEN completion is attempted
- THEN no session is minted

---

### Requirement: A wrong code does not burn the challenge **[MERGE-BLOCKING]**

Presenting an incorrect second-factor code against a valid, unconsumed challenge
MUST NOT consume the challenge. The customer MAY retry with a correct code until
the challenge expires. Each failed attempt MUST be recorded as a distinct
brute-force failure reason so repeated MFA guesses are throttled per account.

#### Scenario: A wrong code keeps the challenge usable for retry

- GIVEN a valid, unconsumed challenge
- WHEN an incorrect code is presented
- THEN the challenge remains usable
- AND a subsequent correct code, presented before expiry, succeeds

#### Scenario: Repeated wrong codes are throttled per account

- GIVEN repeated incorrect-code attempts against the same customer's login
- WHEN the attempts accumulate
- THEN the account-level brute-force protection engages, independent of the per-IP HTTP rate limit

---

### Requirement: Challenge failure responses are indistinguishable (anti-oracle) **[MERGE-BLOCKING]**

An expired challenge, an already-consumed challenge, a challenge for a different
account, a challenge whose subject no longer qualifies (inactive or MFA since
disabled), and a challenge whose IP/user-agent binding does not match MUST all
produce the same client-visible failure response. Distinguishing detail (which
sub-case occurred) MUST be observable only in server-side logs/telemetry, never
in the response body.

#### Scenario: Every invalid-challenge sub-case returns a byte-identical response

- GIVEN each of: an expired challenge, a consumed challenge, a foreign-account challenge, and a binding-mismatched challenge
- WHEN each is presented for completion
- THEN every one produces the same response body and status code
- AND no response reveals which sub-case occurred

---

### Requirement: The challenge is bound to its issuing context and rejected on mismatch

The challenge MUST bind to the client IP and user-agent observed at issuance
(via hashed claims, never raw values in a client-visible artifact). Completion
MUST reject the challenge if the observed IP or user-agent at completion time
does not match the bound values.

#### Scenario: A challenge replayed from a different network context is rejected

- GIVEN a challenge issued for one client IP/user-agent context
- WHEN completion is attempted from a materially different IP or user-agent
- THEN the challenge is rejected (folded into the same indistinguishable failure response above)

---

### Requirement: The challenge cannot be used as, or accept, a different token kind **[MERGE-BLOCKING]**

The challenge artifact MUST be a distinct token kind from access and refresh
tokens. An access or refresh token MUST NOT be accepted where a challenge is
required, and a challenge MUST NOT be accepted where an access or refresh token
is required.

#### Scenario: A challenge is rejected by access/refresh verification

- GIVEN a valid challenge artifact
- WHEN it is presented to an endpoint expecting an access or refresh token
- THEN it is rejected

#### Scenario: An access or refresh token is rejected as a challenge

- GIVEN a valid access or refresh token
- WHEN it is presented to the challenge-completion endpoint in place of a challenge
- THEN it is rejected

---

### Requirement: The completed login is bound to the challenge's real tenant/account

The account identity carried by the challenge MUST be verified against the
account actually resolved during completion, not merely carried as an unchecked
claim. A mismatch MUST be treated as an invalid challenge (folded into the
anti-oracle response above) and MUST NOT consume the challenge.

#### Scenario: A challenge whose carried account does not match the resolved account is rejected

- GIVEN a challenge whose account claim does not match the account of the user it resolves to
- WHEN completion is attempted
- THEN the challenge is rejected as invalid, and it is NOT consumed by the mismatched attempt

---

### Requirement: The legacy login-time verify route is retired with zero references

The orphan, unauthenticated, admin-hardcoded login-verify route that predates
this capability MUST be removed once the real customer login MFA gate exists,
with zero remaining references (route registration, handler, request schema).

#### Scenario: The orphan route no longer exists

- GIVEN the change is applied
- WHEN the orphan login-time verify route is invoked
- THEN it responds not-found

#### Scenario: The distinct authenticated admin MFA-verify route is unaffected

- GIVEN the separate, authenticated admin MFA-verify route (a different endpoint from the retired orphan)
- WHEN it is invoked by an authenticated admin
- THEN it continues to function unchanged

---

## How to extend

1. **Admin login migration to the same challenge shape** — tracked as backlog, not
   yet done: today's admin login re-transmits the password on the MFA step and the
   admin frontend plumbs a `mfaSessionToken` the backend never issues. The
   `CompleteCustomerMfaLoginUseCase` introduced by this capability is the template
   for that future migration; when undertaken, the requirements above (no
   pre-MFA session, atomic single-use, fail-closed, anti-oracle, binding) apply
   equally to the admin flow.
2. **New second-factor method** (e.g. WebAuthn) — the challenge/completion split
   and its single-use/fail-closed/anti-oracle guarantees are method-agnostic; a
   new method plugs into the same `MfaVerificationPort` completion step.
3. **Amending a MERGE-BLOCKING requirement** — requires an ADR; these are the
   acceptance criteria that gated PR2b-3 and must not silently regress.

Known accepted non-goals (recorded, not defects): the customer refresh token
does not yet pin issuer/audience (RFC 8725 §3.8/§3.9 gap, pre-existing,
retrofit needs a forced-logout rollout plan); a full booted-stack
enroll→login→challenge→complete smoke/e2e run is a merge-readiness checklist
item, not a code gap (every individual link is proven at its own layer — unit,
real-Redis integration, and route level).

Companion audit trail: `openspec/changes/archive/mfa-consolidation/design-pr2b.md`
(Decisions 1–10), `exploration-pr2b.md`, `verify-report.md` (PR2b-1, PR2b-2, PR2b-3
sections, including the post-verify remediation that closed the tenant-binding gap).

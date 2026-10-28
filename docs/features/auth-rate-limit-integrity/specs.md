# `auth-rate-limit-integrity` — Delta Specs

> **Change:** `auth-rate-limit-integrity` · **Repo:** `/root/omni-post` · **Branch:** `workstream/auth-rate-limit-integrity`
> **Inputs:** [explore.md](./explore.md) (diagnosis, adversarially verified) · [proposal.md](./proposal.md) (decision, W1–W9)
>
> Behaviour only. Every requirement below states what MUST be observably true of the running system or of the
> repository as a whole; none names a file, a symbol, a library, or a data shape. RFC 2119 keywords are normative.
> **[MERGE-BLOCKING]** marks requirements whose failure is an authentication-bypass or a self-inflicted denial of
> service; they MUST be green before merge.
>
> Every requirement carries a **Falsifiable by** line naming the _tier_ of proof (unit-level, end-to-end against a
> running instance, or repo-wide static check) — never a file. Tasks reference requirements and scenarios by ID
> (`R3`, `R3.2`).
>
> **Vocabulary used throughout.**
>
> - **Perimeter limiter** — the rate-limit layer that decides before any request reaches business logic, keyed by
>   caller network identity.
> - **Account layer** — the second, independent layer keyed by the account/email being authenticated (R8).
> - **Bucket** — one allowance with one capacity and one window. Two requests "share a bucket" when consuming the
>   allowance for one reduces the allowance for the other.
> - **Route identity** — the identity of the endpoint as the system registered it, i.e. the part of the request
>   target that the caller cannot vary while still reaching the same handler.
> - **Credential surface** — every endpoint that accepts, verifies, issues, rotates, resets, or revokes an
>   authentication credential or a second factor, on the customer side and the admin side alike, plus API-key and
>   invitation issuance.
> - **General default** — the allowance applied to a route for which no policy was declared.

---

## Capability `http-rate-limit-integrity` — ADDED Requirements

---

### R1 — A bucket is identified by caller network identity, route identity, and method — nothing the caller can vary **[MERGE-BLOCKING]**

The perimeter limiter MUST derive a request's bucket from exactly three things: the caller's resolved network
identity, the identity of the route the request was matched to, and the HTTP method. No part of the request target
that a caller may vary while still reaching the same handler MAY influence which bucket is consumed. Consequently,
a caller MUST NOT be able to obtain additional allowance by varying anything they control in the request.

**Falsifiable by:** unit-level assertions on the derived bucket identity for crafted requests; plus R7 end-to-end.

#### R1.1 — Query strings do not mint allowance

- **Given** the perimeter limiter is active and a client has a fixed network identity
- **And** a route whose declared allowance is _N_ requests per window
- **When** the client issues _N + 1_ requests to that route, each with a different query string
- **Then** the _(N + 1)_-th request is denied by the limiter
- **And** all _N + 1_ requests consumed one and the same bucket

#### R1.2 — Path parameters do not mint allowance

- **Given** a route that carries one or more caller-supplied path segments (e.g. a resource identifier)
- **And** its declared allowance is _N_ requests per window
- **When** one client issues _N + 1_ requests to that route, each with a **different** value in the caller-supplied
  segment
- **Then** the _(N + 1)_-th request is denied
- **And** all _N + 1_ requests consumed one and the same bucket

#### R1.3 — The number of buckets a caller can create is bounded by the route inventory

- **Given** one client and one route
- **When** the client issues many requests varying only caller-controlled parts of the request target (query string,
  path parameter values, or both together)
- **Then** the number of distinct buckets brought into existence is exactly one
- **And** it remains one regardless of how many distinct values the client supplies

#### R1.4 — Methods on the same route are independent

- **Given** a route pattern that is registered for more than one HTTP method
- **When** one client exhausts the allowance for one method on that route
- **Then** a request from the same client to the same route using a different method is not denied by the limiter

#### R1.5 — Distinct callers remain independent (do-not-regress)

- **Given** two callers with distinct resolved network identities
- **When** the first exhausts its allowance on a route
- **Then** the second's request to the same route is not denied
- **And** this holds for every route on the credential surface

#### R1.6 — Unmatched requests are limited under one dedicated identity that cannot starve real traffic

- **Given** requests that match no registered route
- **When** such requests arrive from one caller
- **Then** they are limited under a single dedicated identity distinct from every registered route's identity
- **And** exhausting that identity's allowance MUST NOT cause any request to a registered route to be denied
- **And** unmatched requests MUST NOT be treated as one global allowance shared across all callers

#### R1.7 — The collapse of per-resource-instance buckets is intended, not incidental

- **Given** a route carrying a caller-supplied resource identifier and a declared allowance of _N_ per window
- **When** a legitimate client iterates over _M > 1_ distinct resource identifiers on that route
- **Then** those requests share one allowance of _N_, not _N_ per identifier
- **And** no route retains per-resource-instance bucketing anywhere in the system

---

### R2 — One enforcement authority; a denied request has one shape **[MERGE-BLOCKING]**

Rate limiting at the HTTP perimeter MUST be decided by exactly one authority. No request MAY be evaluated against two
independent allowances, and no two denials MAY differ in their observable shape depending on which route was hit.
A rate-limit decision MUST be shared across every process instance serving the application — an allowance held only
within one instance is not an allowance.

**Falsifiable by:** unit-level assertions over the resolved policy for every credential-surface route; repo-wide
static check for the absence of any second declaration surface (see R4); end-to-end for the denial shape.

#### R2.1 — No route is subject to two allowances

- **Given** any route on the credential surface
- **When** its enforced policy is resolved
- **Then** exactly one allowance governs it
- **And** there is no route for which exhausting one allowance leaves a second, differently-sized allowance still
  permitting requests

#### R2.2 — Denials are uniform

- **Given** any two routes that both deny a request for exceeding their allowance
- **When** each denial is observed by the caller
- **Then** both carry the same status, the same response body shape, and the same set of rate-limit headers
- **And** neither carries an alternative shape produced by a different limiter

#### R2.3 — Allowances are shared across instances

- **Given** more than one application instance serving the same route
- **When** a caller's requests are distributed across those instances
- **Then** the caller's consumption accumulates against one allowance
- **And** no allowance exists that is private to a single instance

---

### R3 — The credential surface cannot fall through to the general default, on either side **[MERGE-BLOCKING]**

Every route on the credential surface MUST resolve to an explicitly declared allowance that is stricter than the
general default. This MUST hold for the customer side and the admin side symmetrically. A credential route added in
the future without an explicit allowance MUST cause a detectable, automatic failure rather than silently inheriting
the general default. The inventory against which coverage is checked MUST be derived from the routes the system
actually registers, never from a hand-maintained list.

**Falsifiable by:** unit-level coverage assertion that enumerates registered routes at registration time and resolves
each one's policy.

#### R3.1 — Full coverage today

- **Given** the set of routes the system registers on the credential surface
- **When** each route's enforced allowance is resolved
- **Then** every one of them resolves to an explicitly declared allowance
- **And** none of them resolves to the general default

#### R3.2 — A new credential route cannot inherit the default silently

- **Given** the coverage check as shipped
- **When** a new route on the credential surface is registered with no explicit allowance declared for it
- **Then** the coverage check fails
- **And** it fails because the route was discovered from the registered inventory, not because someone remembered to
  list it

#### R3.3 — Coverage is derived, not transcribed

- **Given** a credential route that exists in the registered inventory but is absent from any hand-written enumeration
- **When** the coverage check runs
- **Then** the route is still evaluated
- **And** removing a route from any hand-written enumeration does not reduce what the check evaluates

#### R3.4 — Admin↔customer parity of enforced allowance

- **Given** an authentication capability offered on both the customer side and the admin side (credential login,
  session refresh, session logout, password-reset request, password-reset confirmation, password change or
  validation, second-factor enrolment, second-factor verification, second-factor removal, backup-code
  regeneration, session listing and revocation)
- **When** the enforced allowances for the customer route and the admin route of that capability are compared
- **Then** neither side is more permissive than the other for the same capability
- **And** where a capability exists on only one side, that asymmetry is one of the essential asymmetries recorded in
  the proposal, not an omission

#### R3.5 — No enforced allowance becomes more permissive than what shipped before

- **Given** the allowance each credential-surface route enforced before this change
- **When** the allowance it enforces after this change is compared against it
- **Then** the post-change allowance is equal to or stricter than the pre-change allowance for every such route
- **And** any route whose allowance would be raised is treated as a defect in the change, not as a passing result

#### R3.6 — Allowances do not vary by environment

- **Given** any route on the credential surface
- **When** its enforced allowance is resolved under a test configuration and under a production configuration
- **Then** the two allowances are identical
- **And** there is no route whose allowance is relaxed because the system believes it is under test

---

### R4 — A declared cap that enforces nothing, or that contradicts what is enforced, is not representable **[MERGE-BLOCKING]**

The system MUST NOT admit a declaration of a rate limit that no component consumes, and MUST NOT admit two
declarations of a rate limit for the same route that disagree. There MUST be exactly one place in which an allowance
for a route can be declared, and that declaration MUST be the allowance that is enforced. The prohibition MUST be
total over the repository — it MUST hold for declarations in code paths that no test registers.

**Falsifiable by:** repo-wide static check (total over the tree, including unregistered code paths), plus a
unit-level runtime companion over the credential-surface route registrations.

#### R4.1 — Inert declarations are absent and cannot return

- **Given** the repository at any commit after this change
- **When** it is searched for route-level rate-limit declarations belonging to a declaration surface that nothing
  consumes
- **Then** none are found
- **And** the check that establishes this is conditional on the consuming component genuinely being absent, so it
  cannot be satisfied by simply installing the consumer and leaving the declarations inert

#### R4.2 — A contradicting declaration cannot exist

- **Given** any route
- **When** all declarations of an allowance applying to it are collected
- **Then** there is at most one
- **And** there is no route for which a declared number differs from the number actually enforced

#### R4.3 — The runtime confirms what the static check asserts

- **Given** the route registrations that make up the credential surface
- **When** they are registered and the options the system actually received are inspected
- **Then** none of them carries a rate-limit declaration from a second declaration surface
- **And** this holds independently of whether the static check passed

#### R4.4 — Declared intent survives the deletion

- **Given** each allowance that was declared inertly before this change
- **When** the enforced allowance for that same route is resolved after this change
- **Then** an allowance for that route exists and is explicit
- **And** where the previously declared number was more permissive than what was already enforced, the stricter of
  the two is the one enforced (per R3.5)

---

### R5 — The system emits exactly the rate-limit headers it documents, and documents exactly the ones it emits

Every rate-limit response header the system's documentation claims MUST be emitted by the running system, and every
rate-limit header the running system emits MUST be documented. A header that advertises an allowance MUST be emitted
only by the component that actually enforces that allowance; no response MAY advertise a cap that no bucket backs.

**Falsifiable by:** unit-level assertions on the response headers for an allowed and for a denied request, compared
against the documented set; end-to-end confirmation on a credential route.

#### R5.1 — Documented set equals emitted set

- **Given** the set of rate-limit headers named in the system's own documentation
- **When** a request to a rate-limited route is served
- **Then** every documented header is present on the response
- **And** no rate-limit header is present that the documentation does not name

#### R5.2 — Headers are present on both outcomes

- **Given** a rate-limited route
- **When** a request is allowed, and separately when a request is denied for exceeding the allowance
- **Then** both responses carry the full documented header set
- **And** the denied response conveys when the caller may retry

#### R5.3 — No advertised cap without a bucket behind it

- **Given** any response the system produces
- **When** it carries a header advertising a request cap
- **Then** that cap is the cap of the allowance that was actually consumed for this request
- **And** there exists no code path that emits such a header without consuming an allowance

---

### R6 — The limiter fails open when its backing store is unavailable, and the failure is observable **[MERGE-BLOCKING]**

When the store backing the perimeter limiter is unavailable, requests MUST be allowed through — the limiter MUST NOT
become an availability failure. The fail-open MUST be observable as structured telemetry classified as a rate-limit
fail-open event, and that telemetry MUST NOT carry the caller's network identity or the full request target. A
failure anywhere else inside the limiter — resolving the caller's identity, or writing the response — MUST likewise
result in the request proceeding, never in a server error.

**Falsifiable by:** unit-level tests driving a failing store and a failing identity resolution, asserting both the
allow decision and the emitted telemetry (including the absence of the sensitive fields).

#### R6.1 — Store outage allows the request

- **Given** the store backing the perimeter limiter is unavailable
- **When** a request arrives at a rate-limited route
- **Then** the request is allowed to proceed to its handler
- **And** it is not answered with a server error

#### R6.2 — The fail-open is loud

- **Given** the same store outage
- **When** the request is allowed through
- **Then** structured telemetry is emitted classified as an HTTP rate-limit fail-open event
- **And** the telemetry is attributed to the HTTP perimeter, not to an unrelated subsystem

#### R6.3 — The telemetry does not leak the caller or the target

- **Given** the fail-open telemetry from R6.2
- **When** its fields are inspected
- **Then** it contains neither the caller's network identity nor the full request target including its query string
- **And** it still contains enough to identify which route class failed and why

#### R6.4 — A non-store failure inside the limiter does not become a server error

- **Given** a failure inside the limiter that is not a store outage — for example, resolving the caller's network
  identity throws, or writing the rate-limit response fails
- **When** a request arrives
- **Then** the request proceeds rather than being answered with a server error
- **And** the limiter's fail-open posture holds for every internal failure, not only for store outages

---

### R7 — Enforcement is proven end-to-end against a running system, and the proof cannot pass vacuously **[MERGE-BLOCKING]**

At least one proof MUST exercise the perimeter limiter through the real request path of a running system against a
credential route — not through the limiter's internals. That proof MUST be executed by the project's automated
suites (not merely present on disk), and it MUST fail rather than pass when enforcement is inactive in the
environment it runs in.

**Falsifiable by:** end-to-end run against a live instance with its real backing store, executed by an automated
batch.

#### R7.1 — A burst against a credential route is denied

- **Given** a running system with enforcement active and a credential route whose allowance is _N_ per window
- **When** one caller issues _N + 1_ requests to that route within the window
- **Then** the _(N + 1)_-th is denied by the limiter

#### R7.2 — Varying the request target does not rescue the burst

- **Given** the same conditions as R7.1
- **When** the caller issues the _N + 1_ requests each with a different query string, and separately each with a
  different caller-supplied path segment where the route has one
- **Then** the _(N + 1)_-th is denied in both cases

#### R7.3 — The proof fails when enforcement is off

- **Given** an environment in which HTTP rate-limit enforcement is inactive
- **When** the end-to-end proof runs
- **Then** it fails
- **And** it does not report success on the grounds that no request was denied

#### R7.4 — The proof actually runs

- **Given** the project's automated test execution as configured
- **When** the suites run
- **Then** the end-to-end proof is among the suites executed
- **And** it is not merely present on disk while belonging to no executed batch

---

### R8 — The account-keyed second layer is separate, stays, and covers every credential login

The account-keyed brute-force layer is an independent control from the perimeter limiter and MUST remain. It MUST
gate every endpoint that verifies a credential against an account — including the admin-credential login door that
has no such gate today — so that no login endpoint's only protection is a network-identity allowance. The two layers
MUST remain independent: neither one's exhaustion MAY consume the other's budget. The caller network identity used
by the account layer for its blocking decisions MUST be derived by the same canonical resolution the perimeter uses.

**Falsifiable by:** unit-level tests of the login flows on both sides; unit-level assertion that a perimeter denial
records no failed-attempt against the account.

#### R8.1 — Every credential login is account-gated

- **Given** each endpoint that verifies a submitted credential against a stored account credential, on both the
  customer side and the admin side
- **When** repeated failed attempts are made against one account
- **Then** the account-keyed layer blocks further attempts against that account
- **And** there is no such endpoint whose only protection is the perimeter allowance

#### R8.2 — The account counter cannot be evaded by network-identity or URL rotation

- **Given** an account under repeated failed authentication
- **When** the attempts arrive from different network identities, or with different query strings, or with different
  caller-supplied path segments
- **Then** the account-keyed counter still accumulates across all of them
- **And** the account is blocked at the same threshold

#### R8.3 — A perimeter denial is not a failed authentication attempt

- **Given** a caller that has exhausted the perimeter allowance for a login route
- **When** the caller issues a further request
- **Then** the request is denied at the perimeter without reaching credential verification
- **And** no failed-attempt is recorded against any account as a result

#### R8.4 — Both layers resolve the caller identity the same way

- **Given** a request carrying forwarding headers whose leftmost entry is caller-controlled
- **When** the account layer records or blocks by caller network identity
- **Then** the identity it uses is the same one the perimeter derives
- **And** a caller cannot influence which network identity gets blocked by varying that header

#### R8.5 — Attempt tracking that is never read is not protection

- **Given** any record the system writes for the purpose of throttling authentication
- **When** the system's decision paths are examined
- **Then** every such record has a consumer that reads it and can deny on it
- **And** no record is written under a claim of rate limiting while having no reader

---

### R9 — Whether enforcement is active is observable

Whether HTTP rate-limit enforcement is active MUST be observable from outside the limiter, in every environment in
which the system boots. A configuration in which enforcement is inactive MUST be distinguishable from one in which
it is active by something other than the absence of denials, so that a silent disablement cannot masquerade as
compliant behaviour.

**Falsifiable by:** unit-level assertion over the boot decision; consumed by R7.3.

#### R9.1 — The active/inactive state is externally observable

- **Given** the system booting with enforcement active, and separately with it inactive
- **When** the two boots are compared from outside the limiter
- **Then** the two states are distinguishable
- **And** the distinction does not depend on issuing traffic and observing whether it is denied

#### R9.2 — Inactive enforcement is not a silent state

- **Given** a configuration in which enforcement is inactive
- **When** the system boots
- **Then** the inactive state is reported as such
- **And** any proof that depends on enforcement being active can consult that report and fail (per R7.3)

---

### R10 — Per-principal keying is a bounded non-requirement of this change

This change does **not** deliver rate-limit buckets keyed by the authenticated principal. The perimeter limiter keys
by caller network identity, route identity, and method (R1), and this is a deliberate stage-one boundary, not an
oversight: at the point the perimeter decision is made, no authenticated principal exists. Accordingly:

- The system MUST NOT offer a way to declare that a route is limited per authenticated principal, because such a
  declaration could not be honoured. A knob that promises a guarantee the system cannot deliver is itself the defect.
- The documentation MUST state per-principal keying as **intent**, naming its owning work, and MUST NOT state it as
  a property the system has.
- **Owner:** the per-route authority declaration being built by the `principal-derived-authority` change. Per-principal
  keying hangs off that declaration; it is not re-litigated here.

**Falsifiable by:** repo-wide static check over documentation claims; unit-level assertion over the policy
declaration surface.

#### R10.1 — No unhonourable knob exists

- **Given** the surface on which a route's allowance is declared
- **When** its expressible dimensions are enumerated
- **Then** none of them expresses keying by authenticated principal
- **And** no declaration exists anywhere that requests per-principal keying

#### R10.2 — Documentation states intent, not a guarantee

- **Given** the project's security documentation and API reference
- **When** they are searched for claims about rate-limit keying
- **Then** no claim asserts that the system limits by authenticated principal
- **And** wherever the preference for principal-keyed limiting is expressed, it is expressed as intent with its
  owning work named

#### R10.3 — The gap is stated, not hidden

- **Given** the documented description of the perimeter limiter's keying
- **When** it is read
- **Then** it states that buckets are keyed by caller network identity, route identity and method
- **And** it states plainly that authenticated principals do not currently receive their own buckets

---

### R11 — Documented rate-limit values are the enforced values

Every rate-limit figure the project's documentation states MUST equal the figure the system enforces for that route.
Documentation MUST NOT carry figures transcribed from declarations that enforce nothing, and MUST NOT describe an
enforcement mechanism the system does not use. Every route on the credential surface that is documented at all MUST
be documented with its enforced allowance; a documented credential route with no stated allowance is a defect.

**Falsifiable by:** unit-level table comparison of the documented figures against the resolved enforced allowances.

#### R11.1 — Documented figures match enforced figures

- **Given** each rate-limit figure stated in the API reference and the security documentation
- **When** it is compared to the allowance the system enforces for that route
- **Then** the two are equal
- **And** no documented figure originates from a declaration that enforces nothing

#### R11.2 — The described mechanism is the real one

- **Given** each documented statement about how rate limiting is applied
- **When** it is compared to how the system applies it
- **Then** the statement is true
- **And** no statement attributes enforcement to a component the system does not use

#### R11.3 — Documented credential routes carry their allowance

- **Given** the credential-surface routes that the documentation covers
- **When** each entry is inspected
- **Then** it states the enforced allowance
- **And** the admin credential surface is documented, not only the customer one

---

## Capability `client-ip-rate-limit` — MODIFIED Requirements

The existing living spec for `client-ip-rate-limit` stays in force in full. Two of its requirements are amended.

---

### R12 — MODIFIES _"AUTH policy and fail-open posture are unchanged (do-not-regress)"_

The prior requirement forbade introducing a _second_ HTTP limiter. It is strengthened: the system MUST converge on
exactly **one** HTTP enforcement authority, and the mechanisms that exist today solely to compensate for the primary
one's keying defect MUST cease to exist rather than continue alongside it. The prohibition on a route-level
declaration surface that nothing consumes is retained and made total (R4). The fail-open posture is retained
unchanged and made observable (R6). Policy figures for existing capped routes are retained or tightened, never
loosened (R3.5).

**Falsifiable by:** repo-wide static check for surviving compensating mechanisms; unit-level resolution of the
one-authority property; the R6 fail-open tests.

#### R12.1 — The workarounds are gone, not kept alongside

- **Given** the mechanisms that exist today only because the primary limiter's bucket identity is caller-controlled
- **When** the system is examined after this change
- **Then** none of them remains
- **And** the behaviour each of them provided is provided by the single remaining authority

#### R12.2 — A mechanism that enforces nothing does not survive

- **Given** any component that emits rate-limit signalling without consuming an allowance
- **When** the system is examined after this change
- **Then** no such component remains
- **And** no test keeps such a component alive by exercising it

#### R12.3 — Fail-open posture preserved

- **Given** the store outage scenario
- **When** a request arrives at a rate-limited route
- **Then** it is allowed through, exactly as before this change
- **And** the posture has not been flipped to fail-closed

---

### R13 — MODIFIES _"The AUTH rate-limit bucket is keyed by the real client IP"_

The prior requirement fixed the **network-identity half** of the bucket identity and left the **scope half** free. It
is amended: both halves MUST be beyond caller control. The canonical network-identity resolution is unchanged and
untouched by this change; the scope half is now governed by R1. In addition, the canonical resolution MUST be the
sole source of caller network identity for **every** security decision that keys on it — including the account layer's
blocking decisions (R8.4) — so that the documented single-resolver rule is true rather than aspirational, and stays
true under a repo-wide check.

**Falsifiable by:** the R1 unit-level assertions; a repo-wide static check that no security decision path reads a
caller network identity other than through the canonical resolution.

#### R13.1 — Both halves of the bucket identity are beyond caller control

- **Given** a request whose forwarding headers and whose request target are both entirely caller-supplied
- **When** the bucket identity is derived
- **Then** neither the network-identity half nor the scope half takes any value the caller supplied
- **And** the caller cannot obtain a fresh bucket by varying either

#### R13.2 — One resolver for every security decision that keys on caller IP

- **Given** every decision path that keys on caller network identity — perimeter limiting, allowlisting, and the
  account layer's blocking and auditing
- **When** the source of that identity is examined
- **Then** all of them obtain it from the canonical resolution
- **And** a repo-wide check fails if any of them obtains it another way

#### R13.3 — The single-resolver claim in the canon is true

- **Given** the project's security canon statement that all caller-IP derivation for security decisions goes through
  one canonical resolver
- **When** it is checked against the system
- **Then** it holds for every decision path it names, brute-force throttling included
- **And** the check that establishes this covers the ways of obtaining a caller identity that the existing checks miss

---

## Traceability

| Requirement     | Closes / carries                                                      | Work item           |
| --------------- | --------------------------------------------------------------------- | ------------------- |
| R1 (all), R13.1 | D1 — caller-controlled bucket identity, both instances                | W1                  |
| R1.6            | The 404-bucket hazard introduced _by_ the fix                         | W1                  |
| R2              | The five-mechanism split                                              | W2                  |
| R3.1–R3.3       | D2, D4 — structural close                                             | W5, W6              |
| R3.4            | Standing admin↔customer parity rule                                   | W5                  |
| R3.5            | Any green that raises a cap is a regression                           | W4, W5              |
| R3.6            | The environment-dependent cap removed with the compensating mechanism | W2                  |
| R4              | D3 — declared-but-inert and declared-but-contradicting                | W3                  |
| R5              | The advertised header with no bucket behind it                        | W2, W8              |
| R6              | Fail-open observability and its redaction                             | W9                  |
| R7              | The absence of any honest end-to-end enforcement proof                | W6 (proof tier)     |
| R8              | The second layer; the one login door lacking it                       | W7                  |
| R9              | Whether the kill switch survives, either answer                       | W7 (design fork F5) |
| R10             | The owner's ruling: stage-two keying is not built here                | W8 (intent wording) |
| R11             | Documentation transcribed from inert declarations                     | W8                  |
| R12             | Amends `client-ip-rate-limit` — one authority                         | W2, W3              |
| R13             | Amends `client-ip-rate-limit` — both halves; single resolver          | W1, W7              |

**Open design forks that these specs deliberately do not decide** (they constrain the answer, not the choice):
F1 (gate the redundant admin-credential door vs. delete it) is constrained by R8.1 — either answer satisfies it.
F3 (the admin login figure) is constrained by R3.4 and R3.6, not fixed to a number. F4 (SSO and invite figures) is
constrained by R3.1. F5 is constrained by R9. F2 is settled by R10.

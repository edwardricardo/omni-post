# Circuit-Breaker Tenant Isolation — Specification

> Living specification for the **circuit-breaker-isolation** capability: the shared
> external-API circuit breaker (`packages/adapters/external-apis/src/circuitBreaker.ts`)
> MUST never serve one tenant's cached payload, one tenant's circuit STATE, or one
> tenant's bound closure result to a different tenant — across every layer the breaker
> touches (L1 in-process cache, L2 Redis fallback store, and the breaker's dispatch
> action) — while keeping the legitimate same-tenant cache, the correctly-uncached
> operations, and the write-path fail-fast invariant intact.
>
> Source of truth: `docs/audits/FULL_REPO_ASSESSMENT_2026-06-29.md §3.1` (the original
> finding), closed by change `cross-tenant-criticals` (N-SEC-1 + N-SEC-1b), commits
> `98627f8c` (C1a mechanism) and `c1688d23` (C1b migration + Fix B/D8 closure).
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Each requirement
> carries Given/When/Then acceptance scenarios. Requirements marked
> **[MERGE-BLOCKING]** are the acceptance criteria that gated the closing change — their
> failure is a cross-tenant disclosure or an availability DoS and must never regress.
> Scenarios marked **[anchor]** carry a concrete confirmed leak reproduced during
> remediation.

---

## Requirements

### Requirement: Circuit-breaker cache entries are tenant/credential-scoped **[MERGE-BLOCKING]**

For every operation invoked through the shared external-API circuit breaker with
`cacheEnabled: true`, a cached response produced for one caller MUST NOT be served to
a different tenant/credential context. The cache result a caller receives MUST be
derived from that caller's own credentials and request parameters, never from another
account's previously cached response, for the entire TTL window. This guarantee holds
across ALL `cacheEnabled` operations, regardless of whether the cached payload is
classified secret, PII, or benign.

#### Scenario: No cross-tenant disclosure of a Facebook Page access_token **[anchor]**

- **Given** account A invokes the `facebook validate-credentials` operation (a `cacheEnabled: true` op) with account A's credentials
- **And** the breaker caches a response containing account A's Page `access_token` within the 5-minute TTL window
- **When** account B invokes the same `facebook validate-credentials` operation with account B's own credentials inside that TTL window
- **Then** account B receives a response derived from account B's credentials
- **And** the response account B receives does NOT contain account A's cached `access_token`
- **And** no value from account A's cached payload is observable to account B

#### Scenario: Same-account cache still serves within TTL (no perf regression)

- **Given** account A invokes a `cacheEnabled: true` operation once, populating the cache with account A's data
- **When** account A invokes the same operation a second time within TTL, with the same credentials and parameters
- **Then** the second call is served from cache (caching is NOT disabled for the legitimate same-tenant hit — it is correctly scoped)
- **And** the served payload is account A's own data

#### Scenario: General cross-tenant isolation invariant across all cacheEnabled sites

- **Given** any operation `O` invoked through the breaker with `cacheEnabled: true`, cached by tenant A
- **When** tenant B invokes `O` with tenant B's credentials while tenant A's entry is still within TTL
- **Then** tenant B is never served tenant A's cached payload for `O`
- **And** this holds for a payload classified as secret, PII, or benign alike (the isolation guarantee is uniform, independent of the sensitivity classification)

---

### Requirement: The breaker runs the caller's own closure — no bound-closure cross-tenant disclosure **[MERGE-BLOCKING]**

For every operation invoked through the shared external-API circuit breaker, the function
executed MUST be the CURRENT caller's own function — never a function bound to the breaker by an
earlier caller. When two tenants invoke the same `service:operation` (and therefore may resolve
to the same process-shared breaker instance), each invocation MUST run its OWN closure and
return a result derived from its OWN credentials and parameters. This guarantee is INDEPENDENT of
`cacheEnabled` (it holds for uncached reads AND writes) and INDEPENDENT of whether a
`cacheKeyDiscriminant` is supplied — a discriminant-less call MUST still run the caller's own
closure. This is the THIRD cross-tenant disclosure vector — the breaker's bound closure —
distinct from the L1 cache and the L2 fallback store below: the closure vector leaks even when
both cache layers are skipped.

A missing or blank discriminant MAY degrade the call to shared circuit STATE (an
availability/noisy-neighbor concern) and to a cache skip (the fail-safe defaults below), but it
MUST NOT cause the breaker to run another tenant's closure. The discriminant governs only cache
keying (L1/L2) and STATE partitioning — it is NOT the disclosure boundary. Implementation
mechanism: the breaker's action is a caller-independent generic dispatcher
(`(fn, ...args) => fn(...args)`); `call()` fires `breaker.fire(apiCall, ...args)`, passing the
CURRENT call's own closure per invocation.

#### Scenario: A discriminant-less, uncached op runs tenant B's own closure, never tenant A's **[anchor]**

- **Given** an operation invoked through the breaker with `cacheEnabled: false` and NO `cacheKeyDiscriminant` (so tenant A and tenant B share the same `service:operation` breaker key)
- **And** tenant A invokes it first with a closure that would return tenant A's data, creating the shared breaker
- **When** tenant B invokes the same operation with tenant B's OWN closure (returning tenant B's data)
- **Then** tenant B receives tenant B's own result (tenant B's closure is the one executed)
- **And** tenant B never receives a value derived from tenant A's closure — the shared breaker does not re-run tenant A's bound function

#### Scenario: A shared discriminant-less write op partitions no payload but still runs each caller's own closure

- **Given** a write operation invoked with `cacheEnabled: false` and no discriminant by tenant A then tenant B (shared breaker key)
- **When** each tenant's call is executed through the breaker
- **Then** each tenant's own write closure runs against the provider (no cross-tenant closure execution)
- **And** nothing is cached (the write stays uncached), and the only shared state is the circuit STATE (an availability concern, not disclosure)

---

### Requirement: Cache is fail-safe when no discriminant is supplied **[MERGE-BLOCKING]**

When an operation with `cacheEnabled: true` is invoked through the shared external-API
circuit breaker WITHOUT a caller-supplied credential/tenant discriminant, the breaker MUST
NOT serve or store a shared cache entry for it: the read MUST be treated as a cache miss and
fetched fresh, and nothing derived from that read may be stored under a key a different tenant
could hit. Only invocations that supply a discriminant participate in L1 caching, keyed by
that discriminant. This default is the isolation guarantee's floor — it holds the general
cross-tenant isolation invariant above for EVERY `cacheEnabled` site, including un-migrated or
future-added call sites that omit a discriminant, because a discriminant-less site simply stops
caching rather than sharing an entry. A site that omits the discriminant therefore fails SAFE
(no cache, correct isolation) rather than failing OPEN (shared cache, cross-tenant leak).

#### Scenario: Discriminant-less cacheEnabled op never shares a payload across tenants

- **Given** an operation with `cacheEnabled: true` invoked through the breaker with NO `cacheKeyDiscriminant`
- **And** tenant A invokes it with tenant A's credentials, populating whatever the breaker would cache
- **When** tenant B invokes the same operation with tenant B's credentials within the TTL window
- **Then** tenant B is never served tenant A's payload — because nothing shared was cached, tenant B fetches fresh from the provider
- **And** the breaker stores no cache entry that a different tenant's later call could hit for that discriminant-less invocation

#### Scenario: Supplying a discriminant re-enables same-tenant caching

- **Given** the same `cacheEnabled: true` operation invoked WITH a `cacheKeyDiscriminant` derived from the caller's credentials
- **When** the same tenant invokes it twice within TTL with identical credentials and parameters
- **Then** the second call is served from cache, keyed by that discriminant
- **And** a different tenant, carrying a different discriminant, is served its own fresh payload and never the first tenant's entry

---

### Requirement: Fallback (L2) cache is tenant-scoped and fail-safe **[MERGE-BLOCKING]**

The shared external-API circuit breaker has **two** cache layers: the in-process L1 cache
(covered above) AND the L2 Redis **fallback store** used by `fallbackEnabled: true`
operations (`ANALYTICS_CB_OPTIONS` / `METADATA_CB_OPTIONS`), which persists each successful
response and, on a later provider failure, serves the most-recent cached response back. The
tenant-isolation guarantee spans BOTH layers. A response stored in the fallback store for one
tenant/credential context MUST NOT be served to a different tenant on the fallback path. The
fallback entry MUST be keyed by the caller's credential/tenant discriminant, and a call
WITHOUT a discriminant MUST NOT write or read a shared fallback entry — it stores nothing and
reads as a miss, fetching fresh — mirroring the L1 fail-safe default.

#### Scenario: Tenant B is never served tenant A's fallback-cached payload **[anchor]**

- **Given** account A invokes a `fallbackEnabled: true` read (e.g. `x-api get-analytics`) that succeeds, so the breaker stores account A's response in the L2 fallback store keyed by account A's discriminant
- **And** the provider then fails for account B on the same operation
- **When** account B's call falls back to the L2 store carrying account B's own discriminant
- **Then** account B is never served account A's fallback-cached payload
- **And** account B fetches fresh / receives only its own fallback entry, never a value derived from account A's stored response

#### Scenario: Discriminant-less fallback op writes and reads nothing shared

- **Given** a `fallbackEnabled: true` operation invoked through the breaker with NO discriminant
- **And** account A's successful response would otherwise populate the fallback store
- **When** account B later triggers the fallback for the same operation with no discriminant
- **Then** nothing shared was written for account A, so account B's fallback read is a miss and account B fetches fresh
- **And** the store holds no `fallback:service:operation` entry that a different tenant's later call could hit

---

### Requirement: Every `cacheEnabled` site is audited, classified, and covered

The completeness of the isolation guarantee above is evidenced by an audit that enumerates
every operation configured `cacheEnabled: true`, classifies each as `secret` / `PII` /
`benign`, and confirms each is covered by the tenant-scoping guarantee. Every site classified
`secret` or `PII` MUST have a cross-account isolation test anchoring it.

#### Scenario: Classification table enumerates every cacheEnabled operation

- **Given** the set of operations invoked through the breaker with `cacheEnabled: true`
- **When** the audit deliverable is produced
- **Then** each such operation appears in a classification table with exactly one of `secret` / `PII` / `benign`
- **And** no `cacheEnabled: true` operation is absent from the table (a missed site is a leak that escapes the guarantee)

#### Scenario: Secret and PII sites are anchored by an isolation test

- **Given** an operation classified `secret` or `PII` in the audit table
- **When** the isolation test suite runs
- **Then** a cross-account test exists proving tenant B never receives tenant A's cached payload for that operation

---

### Requirement: Correctly-uncached operations MUST NOT regress to cached

Operations that are correctly configured `cacheEnabled: false` because they carry
per-call secrets or are writes MUST remain uncached. Specifically the tiktok
authService token / refresh operations, the snapchat refresh-token operation, and the
facebook `validate-credentials` / `upload-media` / `post-to-page` operations MUST stay
`cacheEnabled: false`. Re-enabling caching on any of these reintroduces a leak on the
most sensitive paths.

#### Scenario: Token / refresh / secret / write ops remain uncached

- **Given** the operations tiktok authService token/refresh, snapchat refresh-token, facebook `validate-credentials`, facebook `upload-media`, and facebook `post-to-page`
- **When** the system is inspected
- **Then** each remains configured `cacheEnabled: false`
- **And** none of them is served from the breaker cache under any tenant

---

### Requirement: Circuit-breaker STATE is partitioned per account **[MERGE-BLOCKING]**

Circuit STATE (open/closed/half-open, failure counters) MUST be partitioned per
account so that one tenant's provider failures do not open the circuit for other
tenants on the same operation. A tenant whose calls are failing MUST NOT be able to
short-circuit a different, healthy tenant's calls to the same operation. This applies
to BOTH reads and writes: write operations (`cacheEnabled: false`) also partition
their circuit STATE by discriminant even though no cache entry is ever created.

#### Scenario: A failing tenant does not open the circuit for another tenant

- **Given** account A's calls to operation `O` fail enough times to trip A's circuit for `O` OPEN
- **When** account B calls the same operation `O`
- **Then** account B's circuit for `O` is CLOSED
- **And** account B's call is attempted against the provider (not short-circuited by account A's failures)

#### Scenario: A tenant's own circuit still opens on its own failures (do-not-regress)

- **Given** account A's calls to operation `O` fail enough to trip A's circuit OPEN
- **When** account A calls operation `O` again while A's circuit is OPEN
- **Then** account A's call is short-circuited (the breaker still protects the failing tenant against its own failing provider)

#### Scenario: Write operations partition circuit STATE per account

- **Given** a WRITE operation `W` configured `cacheEnabled: false` that supplies a per-tenant discriminant
- **And** account A's calls to `W` fail enough times to trip A's circuit for `W` OPEN
- **When** account B calls the same write operation `W` with account B's own discriminant
- **Then** account B's circuit for `W` is CLOSED and B's call is attempted against the provider
- **And** no response payload is cached for `W` (it stays `cacheEnabled: false` — only the circuit STATE is partitioned, not a cache entry)

---

### Requirement: Breaker admin controls are partition-aware **[MERGE-BLOCKING]**

Because circuit STATE is partitioned per account, the operator/admin controls that address a
breaker by `service:operation` — `getStatus`, `forceOpen`, `forceClose`, and the provider
`forceCircuitBreakerClose(operation)` wrappers that delegate to them — MUST continue to reach
the partitioned breakers. `forceOpen` and `forceClose` MUST apply to every breaker
partition whose key is `service:operation` OR `service:operation:<discriminant>`, and MUST
report success when at least one partition matched. `getStatus` MUST aggregate across the same
partition set (worst-of state) rather than resolving only the exact two-part key. A control
addressed by the generic operation MUST NOT silently no-op against partitioned breakers.

#### Scenario: forceClose reaches a partitioned breaker

- **Given** operation `O` has a per-tenant breaker partition `service:operation:<disc>` that is OPEN
- **When** an operator calls `forceCircuitBreakerClose("O")` (which delegates to `forceClose("service", "O")`)
- **Then** the partitioned breaker for `O` is closed
- **And** the call reports success (it did not silently no-op)

#### Scenario: getStatus aggregates across partitions

- **Given** operation `O` has one tenant partition OPEN and another CLOSED
- **When** `getStatus("service", "O")` is called
- **Then** it returns a non-null status reflecting that at least one partition is OPEN (worst-of aggregation), not null

---

### Requirement: An empty or whitespace discriminant is treated as absent (fail-safe) **[MERGE-BLOCKING]**

A `cacheKeyDiscriminant` (L1/STATE) or `FallbackContext.discriminant` (L2) that is an empty
string or whitespace-only MUST be treated exactly as if no discriminant were supplied: the L1
cache is skipped (fail-safe miss), the STATE key is NOT partitioned by the blank value (it does
not collapse to a shared `service:operation:` key that a blank-discriminant call from another
tenant could also hit), and the L2 fallback store neither writes nor reads under it. A blank
discriminant MUST NOT reopen the cross-tenant sharing that the fail-safe default closes.

#### Scenario: Empty-string discriminant never shares a cache entry across tenants

- **Given** a `cacheEnabled: true` operation invoked through the breaker with `cacheKeyDiscriminant: ""`
- **And** tenant A invokes it, then tenant B invokes the same operation with `cacheKeyDiscriminant: ""`
- **Then** tenant B fetches fresh (the empty discriminant is treated as absent — L1 is skipped)
- **And** the breaker stores no shared cache entry that tenant B's later call could hit

#### Scenario: Whitespace discriminant is a fail-safe miss on the fallback store

- **Given** a `fallbackEnabled: true` operation whose `FallbackContext.discriminant` is `"   "`
- **When** the successful-response write and the later fallback read run
- **Then** nothing is written to the L2 store and the fallback read is a miss (fetch fresh)

---

### Requirement: Write-path fail-fast invariant (Fitness #25) is preserved

The cache/state guarantees above MUST NOT alter the circuit-breaker's fail-fast-for-writes
posture. `DEFAULT_EXTERNAL_API_OPTIONS.fallbackEnabled` MUST stay `false`, and no
write-verb operation may opt into `fallbackEnabled: true`. Fitness check #25 (both
Part A and Part B) MUST remain hard-zero.

#### Scenario: Default fallback stays disabled and no write op opts in

- **Given** the breaker's `DEFAULT_EXTERNAL_API_OPTIONS` block
- **When** the system is inspected
- **Then** `fallbackEnabled` remains `false` in that block
- **And** no write-verb operation name in providers/adapters/apps sets `fallbackEnabled: true`
- **And** fitness check #25 Part A and Part B both report count `0`

---

## How to extend

1. **New provider/adapter breaker call site** — supply a `cacheKeyDiscriminant` computed via
   `hashCallScope(credential, ...publicParams)`. A discriminant-less call still fails safe
   (cache skip + shared STATE) but never discloses another tenant's closure result (D8
   dispatcher guarantee) — treat a missed discriminant as an availability/perf gap, not a
   security incident, and migrate it in the next touch.
2. **New cache-bearing operation** — classify it `secret` / `PII` / `benign` and add a
   cross-account isolation test before enabling `cacheEnabled: true`.
3. **Amending a MERGE-BLOCKING requirement** — requires an ADR; these are the acceptance
   criteria that closed N-SEC-1 / N-SEC-1b and must not silently regress.

Companion audit trail: `openspec/changes/archive/cross-tenant-criticals/audit-cache-sites.md`
(the full 60-site classification table) and `openspec/changes/archive/cross-tenant-criticals/design.md`
(architecture decisions D1–D8).

# Circuit-Breaker Tenant Isolation — Living Spec

> Living specification for the **circuit-breaker-isolation** capability: the shared,
> process-singleton external-API circuit breaker MUST never serve one tenant's cached
> payload, one tenant's circuit STATE, or one tenant's bound closure to a different
> tenant — while keeping the legitimate same-tenant cache, the correctly-uncached
> operations, and the write-path fail-fast invariant intact.
>
> Established by change `cross-tenant-criticals` (Cluster A / Nivelación, slice C1),
> archived 2026-07-19, merged via **PR #124** (N-SEC-1 breaker cache + N-SEC-1b circuit
> STATE partition + the generic-dispatcher closure fix, design D8). Companion capability:
> `client-ip-rate-limit` (slice C2, PR #125). Source of truth: the breaker lives in
> `packages/adapters/external-apis/` and the L2 fallback store in
> `packages/adapters/fallback-strategies/`.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Requirements marked
> **[MERGE-BLOCKING]** MUST be proven green before merge — their failure is a cross-tenant
> disclosure or a denial of service. Scenarios marked `[anchor]` carry a concrete confirmed
> leak reproduced RED→GREEN.
>
> Behavior-first: these requirements state WHAT must be guaranteed, not the key format, the
> discriminant mechanism, or whether L1 is disabled vs. re-keyed. The shipped design closes
> disclosure structurally via a generic dispatcher action (the breaker always runs the
> caller's OWN closure), so a missing/blank discriminant degrades only to shared cache-skip +
> shared circuit STATE (availability / noisy-neighbor), never to running another tenant's
> closure.
>
> Verification method: the MERGE-BLOCKING requirements are proven by **vitest** package tests
> in `packages/adapters/external-apis/tests/` (breaker-level generic-dispatcher + fail-safe
> cache-skip + STATE partition), `packages/adapters/fallback-strategies/tests/` (L2 isolation),
> and per-provider end-to-end anchors (facebook, snapchat, telegram, tiktok, youtube). Each
> executed scenario is LXC-safe: single test file, heap-capped, under a `timeout` wrapper.

---

## Requirements

### Requirement: Circuit-breaker cache entries are tenant/credential-scoped [MERGE-BLOCKING]

For every operation invoked through the shared external-API circuit breaker with
`cacheEnabled: true`, a cached response produced for one caller MUST NOT be served to
a different tenant/credential context. The cache result a caller receives MUST be
derived from that caller's own credentials and request parameters, never from another
account's previously cached response, for the entire TTL window. This guarantee holds
across ALL `cacheEnabled` operations (the audit in the requirement below enumerates
them), regardless of whether the cached payload is classified secret, PII, or benign.

#### Scenario: No cross-tenant disclosure of a Facebook Page access_token [anchor]

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

### Requirement: The breaker runs the caller's own closure — no bound-closure cross-tenant disclosure [MERGE-BLOCKING]

For every operation invoked through the shared external-API circuit breaker, the function
executed MUST be the CURRENT caller's own function — never a function bound to the breaker by an
earlier caller. When two tenants invoke the same `service:operation` (and therefore may resolve
to the same process-shared breaker instance), each invocation MUST run its OWN closure and
return a result derived from its OWN credentials and parameters. This guarantee is INDEPENDENT of
`cacheEnabled` (it holds for uncached reads AND writes) and INDEPENDENT of whether a
`cacheKeyDiscriminant` is supplied — a discriminant-less call MUST still run the caller's own
closure. This closes the third cross-tenant disclosure vector (the breaker's bound closure), which
is distinct from the L1 cache (above) and the L2 fallback store (below): the closure vector leaks
even when both cache layers are skipped.

A missing or blank discriminant MAY degrade the call to shared circuit STATE (an
availability/noisy-neighbor concern) and to a cache skip (the fail-safe defaults below), but it
MUST NOT cause the breaker to run another tenant's closure. The discriminant governs only cache
keying (L1/L2) and STATE partitioning — it is NOT the disclosure boundary.

#### Scenario: A discriminant-less, uncached op runs tenant B's own closure, never tenant A's [anchor]

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

### Requirement: Cache is fail-safe when no discriminant is supplied [MERGE-BLOCKING]

When an operation with `cacheEnabled: true` is invoked through the shared external-API
circuit breaker WITHOUT a caller-supplied credential/tenant discriminant, the breaker MUST
NOT serve or store a shared cache entry for it: the read MUST be treated as a cache miss and
fetched fresh, and nothing derived from that read may be stored under a key a different tenant
could hit. Only invocations that supply a discriminant participate in L1 caching, keyed by
that discriminant. This default is the isolation guarantee's floor — it holds the general
cross-tenant isolation invariant above for EVERY `cacheEnabled` site, including un-migrated or
future-added call sites that omit a discriminant, because a discriminant-less site simply stops
caching rather than sharing an entry. A site that omits the discriminant therefore fails SAFE
(no cache, correct isolation) rather than failing OPEN (shared cache, cross-tenant leak). The
temporary cost is a read-cache miss on un-migrated sites; correctness and tenant isolation take
precedence over cache hit-rate until each site supplies its discriminant.

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

### Requirement: Fallback (L2) cache is tenant-scoped and fail-safe [MERGE-BLOCKING]

The shared external-API circuit breaker has **two** cache layers: the in-process L1 cache
(covered by the requirements above) AND the L2 Redis **fallback store** used by
`fallbackEnabled: true` operations (`ANALYTICS_CB_OPTIONS` / `METADATA_CB_OPTIONS`), which
persists each successful response and, on a later provider failure, serves the most-recent
cached response back. The tenant-isolation guarantee MUST span BOTH layers. A response stored
in the fallback store for one tenant/credential context MUST NOT be served to a different
tenant on the fallback path. The fallback entry MUST be keyed by the caller's credential/tenant
discriminant, and a call WITHOUT a discriminant MUST NOT write or read a shared fallback
entry — it stores nothing and reads as a miss, fetching fresh — mirroring the L1 fail-safe
default. This closes the second cross-tenant disclosure vector (the L2 fallback store) on the
same `cacheEnabled: true` PII reads that opt into fallback.

#### Scenario: Tenant B is never served tenant A's fallback-cached payload [anchor]

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

### Requirement: Every `cacheEnabled` site is audited, classified, and covered [MERGE-BLOCKING]

The completeness of the isolation guarantee above MUST be evidenced by an audit that
enumerates every operation configured `cacheEnabled: true` (the shipped audit reconciled to
60 production sites post-C1a), classifies each as `secret` / `PII` / `benign`, and confirms
each is covered by the tenant-scoping guarantee. Coverage is proven by the shipped
defense-in-depth strategy, NOT by a separate per-operation isolation test on every site:

- **(a) Breaker-level mechanism proof is the primary disclosure proof.** The cross-tenant
  disclosure invariant is proven once, for ANY operation, by the breaker-level tests: the
  generic-dispatcher test (every call runs its OWN closure regardless of the breaker key) and
  the fail-safe cache-skip test (a discriminant-less `cacheEnabled` call caches nothing). These
  hold uniformly across all sites, so a per-site disclosure test is not required for coverage.
- **(b) Representative same-tenant fetch-count anchors on secret/PII provider sites.** Each
  highest-value secret/PII provider surface MUST additionally carry an end-to-end anchor that
  includes a same-tenant fetch-count assertion — proving the underlying network call is made
  exactly ONCE across two identical reads, i.e. the cache actually keys and hits — as
  belt-and-suspenders over the breaker-level proof, NOT a per-operation obligation.
- **(c) Every `cacheEnabled` discriminant MUST be scoped by a per-tenant SECRET, never a public
  identifier.** A discriminant derived only from public data (e.g. a `channelId`) is forgeable
  and is not a tenant boundary. The audit MUST confirm each `cacheEnabled` site folds a
  per-tenant secret (credential / refresh token) into its discriminant. The YouTube submodule
  reads that keyed on the public `channelId` were closed by folding the per-tenant OAuth refresh
  token. The tiktok `videoProcessor.analyze-video` site holds NO per-tenant credential (the
  processor only knows a local file path); rather than key its cache on a public file path, it
  was set `cacheEnabled:false`/`fallbackEnabled:false` — local ffprobe metadata is cheap and
  deterministic, so it is intentionally uncached and has no cross-tenant cache surface.

The LinkedIn write-operation caching
(`packages/providers/linkedin/src/apiClient.ts:107,245,321`) MUST be flagged in the
audit as an additional correctness defect (caching a write op), with an explicit
fix-here-or-defer decision recorded. (Recorded outcome: reclassified as READS —
`get-profile`/`get-comments`/`get-analytics` — and fixed in place, no defer.)

#### Scenario: Classification table enumerates every cacheEnabled operation

- **Given** the set of operations invoked through the breaker with `cacheEnabled: true`
- **When** the audit deliverable is produced
- **Then** each such operation appears in a classification table with exactly one of `secret` / `PII` / `benign`
- **And** no `cacheEnabled: true` operation is absent from the table (a missed site is a leak that escapes the guarantee)

#### Scenario: Disclosure is proven at the breaker level and anchored on representative secret/PII sites

- **Given** the set of operations classified `secret` or `PII` in the audit table
- **When** the isolation test suite runs
- **Then** the breaker-level generic-dispatcher and fail-safe cache-skip tests prove no cross-tenant disclosure for ANY operation, independent of per-site coverage
- **And** each highest-value secret/PII provider surface carries a representative end-to-end anchor, including a same-tenant fetch-count assertion that the underlying network call is invoked exactly once across two identical reads (proving the cache actually keys and hits)
- **And** every `cacheEnabled` discriminant is scoped by a per-tenant secret, never a public identifier

#### Scenario: LinkedIn write-op caching is flagged with a recorded decision

- **Given** LinkedIn caches WRITE operations at `apiClient.ts:107,245,321`
- **When** the audit is produced
- **Then** those write-op cache sites are flagged as a correctness defect
- **And** the audit records an explicit fix-here-or-defer decision for them

---

### Requirement: Correctly-uncached operations MUST NOT regress to cached

Operations that are correctly configured `cacheEnabled: false` because they carry
per-call secrets or are writes MUST remain uncached. Specifically the tiktok
authService token / refresh operations, the snapchat refresh-token operation, and the
facebook `upload-media` / `post-to-page` operations MUST stay `cacheEnabled: false`.
Re-enabling caching on any of these reintroduces the leak on the most sensitive paths.

#### Scenario: Token / refresh / write ops remain uncached

- **Given** the operations tiktok authService token/refresh, snapchat refresh-token, facebook `upload-media`, and facebook `post-to-page`
- **When** the change is applied
- **Then** each remains configured `cacheEnabled: false`
- **And** none of them is served from the breaker cache under any tenant

---

### Requirement: Circuit-breaker STATE is partitioned per account [MERGE-BLOCKING]

Circuit STATE (open/closed/half-open, failure counters) MUST be partitioned per
account so that one tenant's provider failures do not open the circuit for other
tenants on the same operation. A tenant whose calls are failing MUST NOT be able to
short-circuit a different, healthy tenant's calls to the same operation.

#### Scenario: A failing tenant does not open the circuit for another tenant

- **Given** account A's calls to operation `O` fail enough times to trip A's circuit for `O` OPEN
- **When** account B calls the same operation `O`
- **Then** account B's circuit for `O` is CLOSED
- **And** account B's call is attempted against the provider (not short-circuited by account A's failures)

#### Scenario: A tenant's own circuit still opens on its own failures (do-not-regress)

- **Given** account A's calls to operation `O` fail enough to trip A's circuit OPEN
- **When** account A calls operation `O` again while A's circuit is OPEN
- **Then** account A's call is short-circuited (the breaker still protects the failing tenant against its own failing provider)

#### Scenario: Write operations partition circuit STATE per account (W-1)

- **Given** a WRITE operation `W` configured `cacheEnabled: false` that supplies a per-tenant discriminant
- **And** account A's calls to `W` fail enough times to trip A's circuit for `W` OPEN
- **When** account B calls the same write operation `W` with account B's own discriminant
- **Then** account B's circuit for `W` is CLOSED and B's call is attempted against the provider
- **And** no response payload is cached for `W` (it stays `cacheEnabled: false` — only the circuit STATE is partitioned, not a cache entry)

---

### Requirement: Breaker admin controls are partition-aware [MERGE-BLOCKING]

Once circuit STATE is partitioned per account, the operator/admin controls that address a
breaker by `service:operation` — `getStatus`, `forceOpen`, `forceClose`, and the provider
`forceCircuitBreakerClose(operation)` wrappers that delegate to them — MUST continue to reach
the now-partitioned breakers. `forceOpen` and `forceClose` MUST apply to every breaker
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

### Requirement: An empty or whitespace discriminant is treated as absent (fail-safe) [MERGE-BLOCKING]

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

The cache/state changes MUST NOT alter the circuit-breaker's fail-fast-for-writes
posture. `DEFAULT_EXTERNAL_API_OPTIONS.fallbackEnabled` MUST stay `false`, and no
write-verb operation may opt into `fallbackEnabled: true`. Fitness check #25 (both
Part A and Part B) MUST remain hard-zero.

#### Scenario: Default fallback stays disabled and no write op opts in

- **Given** the breaker's `DEFAULT_EXTERNAL_API_OPTIONS` block
- **When** the change is applied
- **Then** `fallbackEnabled` remains `false` in that block
- **And** no write-verb operation name in providers/adapters/apps sets `fallbackEnabled: true`
- **And** fitness check #25 Part A and Part B both report count `0`

# Circuit-Breaker Tenant Isolation — Delta Spec (C1 / N-SEC-1 + N-SEC-1b)

> Delta spec for change `cross-tenant-criticals`. Capability: **the shared
> external-API circuit breaker must never serve one tenant's cached payload — or
> one tenant's circuit STATE — to a different tenant**, while keeping the legitimate
> same-tenant cache, the correctly-uncached operations, and the write-path fail-fast
> invariant intact.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Each requirement
> carries Given/When/Then acceptance scenarios written to be turned directly into a
> FAILING test (RED) that the implementer then makes GREEN. Scenarios that carry a
> concrete confirmed leak are marked **[anchor]**. Requirements whose failure is a
> cross-tenant disclosure or DoS are marked **[MERGE-BLOCKING]** — they gate the PR.
>
> Behavior-first: these requirements state WHAT must be guaranteed, not the key
> format, the discriminant mechanism, or whether L1 is disabled vs. re-keyed — those
> are design-phase decisions.

---

## ADDED Requirements

### Requirement: Circuit-breaker cache entries are tenant/credential-scoped **[MERGE-BLOCKING]**

For every operation invoked through the shared external-API circuit breaker with
`cacheEnabled: true`, a cached response produced for one caller MUST NOT be served to
a different tenant/credential context. The cache result a caller receives MUST be
derived from that caller's own credentials and request parameters, never from another
account's previously cached response, for the entire TTL window. This guarantee holds
across ALL `cacheEnabled` operations (the audit in the requirement below enumerates
them), regardless of whether the cached payload is classified secret, PII, or benign.

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

### Requirement: Fallback (L2) cache is tenant-scoped and fail-safe **[MERGE-BLOCKING]**

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

The completeness of the isolation guarantee above MUST be evidenced by an audit that
enumerates every operation configured `cacheEnabled: true` (approximately 64 sites),
classifies each as `secret` / `PII` / `benign`, and confirms each is covered by the
tenant-scoping guarantee. Every site classified `secret` or `PII` MUST have a
cross-account isolation test anchoring it. The LinkedIn write-operation caching
(`packages/providers/linkedin/src/apiClient.ts:107,245,321`) MUST be flagged in the
audit as an additional correctness defect (caching a write op), with an explicit
fix-here-or-defer decision recorded.

#### Scenario: Classification table enumerates every cacheEnabled operation

- **Given** the set of operations invoked through the breaker with `cacheEnabled: true`
- **When** the audit deliverable is produced
- **Then** each such operation appears in a classification table with exactly one of `secret` / `PII` / `benign`
- **And** no `cacheEnabled: true` operation is absent from the table (a missed site is a leak that escapes the guarantee)

#### Scenario: Secret and PII sites are anchored by an isolation test

- **Given** an operation classified `secret` or `PII` in the audit table
- **When** the isolation test suite runs
- **Then** a cross-account test exists proving tenant B never receives tenant A's cached payload for that operation

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

### Requirement: Circuit-breaker STATE is partitioned per account **[MERGE-BLOCKING]**

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

---

## Verification note (strict TDD — package + adapter change)

The breaker lives in `packages/adapters/external-apis/` and the confirmed leak lives in
`packages/providers/facebook/`, so the isolation scenarios are **vitest** package tests.
Drive each MERGE-BLOCKING scenario RED→GREEN:

- **RED**: with today's constant cache key (`service:operation:W10=`) and the process
  singleton `Map`, the anchor test observes tenant A's `access_token` served to tenant B, the
  fail-safe-default test observes a discriminant-less op serving A's payload to B, and the
  state test observes A's OPEN circuit short-circuiting B — all FAIL.
- **GREEN**: after the design's fail-safe default (no discriminant ⇒ cache skip), tenant/
  credential scoping (cache), and per-account state partition, a discriminant-less call skips
  L1 (B fetches fresh), a discriminant-carrying call serves only its own tenant, and tenant B
  gets its own CLOSED circuit — all PASS, while the same-account cache-hit and same-account
  circuit-open scenarios still hold.

LXC constraints apply to any executed scenario: run a single test file, heap-capped
(`--max-old-space-size`), under a `timeout` wrapper; never run the full suite at once. Any
production/helper code introduced carries tests + JSDoc `@file/@description/@layer` per canon.

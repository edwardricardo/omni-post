# Design: Close the CRITICAL cross-tenant and auth-DoS findings (Cluster A)

## Technical Approach

Two independent, chained slices off one proposal. **C1** makes the process-singleton
external-API circuit breaker tenant-safe on **three axes** — (1) cache-entry keying across
**both cache layers** (the L1 in-process `Map` AND the L2 Redis fallback store, N-SEC-1),
(2) circuit-STATE partitioning (N-SEC-1b), and (3) the breaker's **bound closure**, closed
structurally by a **generic dispatcher action** (D8) so the breaker always runs the caller's
OWN closure. Axes (1) and (2) are scoped by a **credential-derived discriminant** the breaker
treats as opaque (no `apps/api` tenant context crosses the `packages/adapters` boundary); axis
(3) — the disclosure guarantee — holds for **every** call regardless of discriminant, so a
missing/blank discriminant degrades only to shared cache-skip + shared STATE (availability),
never to running another tenant's closure. **C2** stops the Next portals from _dropping_
`X-Forwarded-For`/`X-Real-IP`, restoring the backend's already-tested trusted-hop IP
selection so the per-IP AUTH bucket is per-user again. No new limiter, no policy change,
no `fallbackEnabled` change (Fitness #25/#28 stay hard-zero).

The design is **behavior-first per the specs**: the breaker never learns "account"; it
learns a stable opaque string the call site computes from `this.credentials`.

---

## Architecture Decisions

### D1 — C1 cache keying mechanism (N-SEC-1)

**Choice:** Add an explicit optional `cacheKeyDiscriminant?: string` to `circuitBreaker.call(...)`
options; the call site computes it from a new exported helper
`hashCallScope(credential, ...publicParams)` → `sha256` hex, first 16 chars.
`generateCacheKey` becomes `service:operation:<discriminant>` (the discriminant replaces
the useless `base64(W10=)` segment). **When no `cacheKeyDiscriminant` is supplied, the breaker
skips L1 entirely rather than emitting a shared key — the fail-safe default of D1b.** For the **secret-payload class** (a response that
embeds a credential — the `facebook validate-credentials` family) ALSO set
`cacheEnabled: false` as defense-in-depth, removing the secret from process memory entirely.

| Option                                                       | Verdict                              | Why                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) push real params/creds through typed `args`              | **Rejected**                         | Changes ~60 `apiCall` signatures AND routes raw secrets into `breaker.fire(...args)` and into the DLQ payload `addFailedOperation(service,op,args,…)` (`circuitBreaker.ts:545`) — converts a cache-key fix into a **secret-into-DLQ leak**.              |
| (b) explicit `cacheKeyDiscriminant` option + credential HASH | **Chosen**                           | Surgical; breaker stays tenant-agnostic (no cross-package import); a **hash** keeps raw tokens out of the Map key (keys are enumerable via `getCacheStats`); `clearCache(service,op)` prefix purge stays intact (`service:operation:` prefix unchanged). |
| (c) disable L1 for credential-scoped reads                   | **Chosen for the secret class only** | No perf case for caching a credential validation; eliminates the secret from memory. Applied _in addition to_ (b), not instead of it.                                                                                                                    |

Raw secrets are **never** the key input — `hashCallScope` folds the credential through
`createHash` (pattern already in `tiktok/authService`, `facebook/media`, `videoProcessor`).
**Public-reference reads** (e.g. YouTube public metadata by `videoId`) MUST NOT keep a
shared key: today's constant key already corrupts them (video X served for video Y). They
pass the **public resource id** as `...publicParams`; the credential hash is still folded in
by default so a site author cannot accidentally leave an entry tenant-shared. Even if that
fold were omitted, the fail-safe default (D1b) prevents a discriminant-less call from sharing
an entry at all.

### D1b — Fail-safe cache default (no discriminant ⇒ cache skip)

**Choice:** When a `cacheEnabled: true` operation is invoked WITHOUT a `cacheKeyDiscriminant`
(an un-migrated call site, or a future site whose author forgets it), the breaker MUST NOT
serve or store a shared cache entry — it treats the read as a cache MISS and fetches fresh.
Only calls that supply a `cacheKeyDiscriminant` participate in L1 caching, keyed by that
discriminant. There is **no constant-key fallback**.

**Rationale:**

1. **Defense-in-depth.** A site that forgets the discriminant fails SAFE (no cache, correct
   isolation) rather than failing OPEN (shared `service:operation:W10=` key, cross-tenant
   leak). Correctness/isolation cannot depend on every one of ~61 call sites remembering a
   parameter.
2. **Decouples leak-closure from per-site perf.** The instant the breaker change lands
   (slice C1a), the cross-tenant disclosure leak is closed for ALL ~61 sites at once —
   un-migrated sites simply stop caching. Slice C1b (adding per-site discriminants) then
   becomes a pure PERFORMANCE restoration: no security urgency, no cross-tenant window.
3. **Makes the stacked-PR split SAFE.** Because C1a closes the leak globally, C1a and C1b can
   ship as two stacked PRs (C1a → C1b) with no partial-security-fix window in `main`.

**Cost (accepted):** a temporary read-cache perf/provider-quota regression on un-migrated
sites between C1a and C1b — no correctness or isolation cost, only a colder cache. Correctness
and tenant isolation take precedence over hit-rate, temporarily.

| Option                                                                   | Verdict      | Why                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No discriminant ⇒ keep the constant `service:operation:W10=` key (today) | **Rejected** | Un-migrated / future-forgetful sites keep serving one tenant's payload to another → the leak persists; a C1a-only merge would ship an incompletely-closed MERGE-BLOCKING requirement → the stacked split would be UNSAFE. |
| No discriminant ⇒ **skip L1 (miss + fetch fresh)**                       | **Chosen**   | Fails safe; closes the leak for every site at C1a; turns C1b into perf-only; enables a safe two-PR stack. Cost is a temporary cache-miss on un-migrated sites.                                                            |

### D1c — L2 fallback store is tenant-scoped and fail-safe (C-1 remediation)

**Context correction:** the breaker has **two** cache layers, not one. Besides the in-process
L1 `Map` (D1/D1b), the `fallbackEnabled: true` presets (`ANALYTICS_CB_OPTIONS`,
`METADATA_CB_OPTIONS`) persist each successful response to an **L2 Redis fallback store**
(`FallbackManager.cacheSuccessfulResponse` → key `fallback:service:operation`) and, on a later
provider failure, serve "the most-recent cached response" back via
`FallbackManager.getCachedResponse`. The earlier D1 text implied L1 was the only cache; it is
not. That L2 key carried **no tenant discriminant**, so tenant A's cached PII response — ~40
`cacheEnabled:true` reads opt into fallback via the two presets — was served to tenant B on
B's provider failure. This is a SECOND cross-tenant disclosure vector on the same reads
(finding **C-1**), squarely inside the MERGE-BLOCKING isolation invariant, distinct from the L1
`Map` the original 61-site audit threat-modelled.

**Choice:** thread the SAME opaque `cacheKeyDiscriminant` already flowing through `call()`
(D1) into BOTH the fallback write (`cacheSuccessfulResponse`) and the fallback read path
(`executeFallback` → `getCachedResponse`, carried on `FallbackContext.discriminant`). The L2
key becomes `fallback:service:operation:<discriminant>`. The `fallback:` prefix is preserved so
the existing `redis.keys("fallback:*")` enumeration and clear continue to work unchanged.

**Fail-safe symmetry with D1b:** a call WITHOUT a discriminant MUST NOT write or read the L2
store — `cacheSuccessfulResponse` stores nothing and `getCachedResponse` returns a miss (no
shared/legacy-key read, no shared write). A discriminant-less op therefore fails SAFE (no
fallback entry, correct isolation) exactly as it fails safe on L1. There is **no constant-key
`fallback:service:operation` fallback**.

**Migration:** none. The old un-scoped `fallback:service:operation` entries simply expire by
their own TTL (≤ 1 h); no backfill and no delete sweep are required. Until C1b supplies each
read site's discriminant, those reads skip the L2 fallback (cold, but isolated) — the same
correctness-over-hit-rate tradeoff already accepted in D1b for L1.

| Option                                           | Verdict      | Why                                                                                                                                                                                                                           |
| ------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Leave the L2 fallback key un-discriminated       | **Rejected** | Leaves the C-1 cross-tenant disclosure open on ~40 fallback-enabled PII reads — the fallback path serves the most-recent tenant's payload to any other tenant on failure; a C1-R1 that closes only L1 is incompletely closed. |
| Discriminate + fail-safe the L2 key (mirror D1b) | **Chosen**   | Closes C-1 with the same opaque discriminant already threaded for L1/STATE; fail-safe default means un-migrated sites skip the fallback rather than share it; no migration (old keys TTL out).                                |

### D2 — Per-account breaker STATE partition (N-SEC-1b)

**Choice:** Key the `breakers` map by `service:operation:<discriminant>` (same opaque
value as D1) → one opossum instance per (operation, credential-scope). Bound growth with a
**size-capped LRU** (insertion-ordered `Map`, evict least-recently-used on overflow, no
timer). Apply the same LRU cap to the `cache` map.

**Alternatives considered:** global state (today — rejected, is the bug); per-account with a
`setInterval` TTL sweep (**rejected** — Fitness #11 forbids raw `setInterval` in `packages/`
and a timer is unnecessary). **Rationale:** LRU size-cap bounds memory deterministically
with zero timers; an _actively failing_ tenant is continuously touched so it stays resident
(its OPEN circuit keeps protecting it — do-not-regress scenario holds); only _idle_ tenants
are evicted, and eviction merely resets a stale CLOSED breaker. A failing tenant A gets its
own instance; tenant B gets a distinct CLOSED instance → B is never short-circuited by A.

### D2b — C1b write-STATE partition (W-1 closure)

**Context (W-1, deferred from C1a):** the C1a verify gate confirmed the STATE-partition
_mechanism_ is correct but that, in C1a, only `facebook validate-credentials` supplied a
discriminant. Every other read AND **every write** call still shared the legacy two-part
`service:operation` breaker STATE — a noisy-neighbour availability risk (tenant A's credential
failures on a write op could trip the shared circuit OPEN and short-circuit tenant B's writes
to the same op). This is an **availability** concern, not a disclosure one (writes are
`cacheEnabled: false`, so no payload is ever cached or shared).

**Choice:** in C1b, **every** breaker call site — reads AND writes — passes
`cacheKeyDiscriminant: hashCallScope(this.credentials, …)`. For write ops `cacheEnabled` stays
`false` (no cache is created — the fail-fast write posture and Fitness #25 are untouched), but
the discriminant now flows into the breaker STATE key, so each tenant accumulates its own
failure counter and opens its own circuit independently.

**Tradeoff (documented, chosen deliberately):** per-tenant write STATE buys **tenant isolation**
— tenant A's credential/provider failures no longer open the circuit for tenant B's writes to
the same operation — at the cost of slightly **slower COLLECTIVE provider-outage protection**:
with shared STATE, N failures across all tenants trip one circuit that then protects everyone;
with per-tenant STATE, each tenant independently accumulates its own N failures before its own
circuit opens, so a total-provider outage is absorbed a little later per tenant. This cost is
**bounded** (each tenant's threshold is small and its own retry budget still applies) and
**acceptable**: cross-tenant availability coupling (a shared-fate DoS where one tenant's bad
credentials degrade every tenant) is the worse failure mode for a multi-tenant platform. A
future **provider-wide outage detector** (aggregate failure signal across partitions, opening a
service-level circuit) could complement per-tenant STATE to recover the collective-protection
speed without reintroducing the cross-tenant coupling; it is out of scope here and tracked as a
follow-up, not a blocker.

### D3 — C2 forwarding helper + hop topology

**Choice — RELAY, do not append.** One small **per-app** helper
(`apps/{client,admin}/lib/http/forwardedFor.ts`, identical, extensionless `bundler`
imports — Fitness #26 safe) reads the inbound request headers (`x-forwarded-for`, else
`x-real-ip`) via `NextRequest.headers` in route handlers and `next/headers` `headers()` in
server actions, and **copies** them onto the outbound `fetch` headers. Next's server-side
`fetch` **does not append** its own address, so **no XFF hop is added** and the backend's
existing `resolveClientIp` (`httpRateLimitPreHandler.ts:159`) selects `chain[len − hops]`
unchanged.

| Where it lives              | Verdict      | Why                                                                                                                             |
| --------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| new shared `packages/*`     | **Rejected** | Reopens the `exports→dist` / `.js`-on-`.ts` resolution wound (ADR-0017, Fitness #26/#27, prior `next-dev-resolution` incident). |
| per-app util ×2 (identical) | **Chosen**   | ~15-line pure fn; zero new-package resolution tax; DRY cost is negligible and each copy is unit-tested.                         |

**Hop topology (explicit, env-driven via existing `TRUSTED_PROXY_HOP_COUNT`,
`env.ts:250`, min 1 / default 1):** because we **relay not append**, the count equals the
number of trusted proxies **in front of the Next server** — it does NOT increase.

| Deployment shape                                             | Chain the backend sees   | `TRUSTED_PROXY_HOP_COUNT`                                              |
| ------------------------------------------------------------ | ------------------------ | ---------------------------------------------------------------------- |
| Homelab/dev direct (browser→Next→api)                        | `[relayedClient]`        | `1` (spoofable — no trusted edge; dev only, acceptable)                |
| Single trusted edge (CDN/LB→Next→api) **[recommended prod]** | `[spoof?, realClient]`   | `1` (edge-appended `realClient` at `len−1`; attacker leftmost ignored) |
| Edge + LB between Next and api                               | `[…, realClient, lbHop]` | `2`                                                                    |

**Precondition (documented, not code):** an internet-facing deployment MUST place ≥1
trusted proxy in front of Next; otherwise inbound XFF is client-forgeable one tier up. An
**append** model was rejected precisely because it would force a `+1` re-count and add a
variable hop.

### D4 — LinkedIn "write-op caching" (proposal claim corrected)

**Choice:** No write-op cache fix — because **there is no write-op cache**. Evidence:
`apiClient.ts:99` `getProfile` (GET), `:228` `getComments` (GET), `:292` `getPostAnalytics`
(GET) hold the three `cacheEnabled:true` sites; the real write `postComment` (`:258`) is
correctly `cacheEnabled:false` (`:282`). The proposal's "writes at 107/245/321" is a
**misclassification** — they are reads. **Recorded decision (satisfies the spec's
flag-and-decide scenario):** reclassify as reads and cover them under D1 — `getProfile` →
PII/identity, `getComments`/`getPostAnalytics` → PII + resource-scoped (fold `postUrn` into
`publicParams`). No defer, no separate fix; the constant-key leak on these reads is closed
by the N-SEC-1 discriminant like every other read.

### D5 — `getStatus` / `forceOpen` / `forceClose` become PREFIX-AWARE (W-2 closure)

**Context (W-2, deferred from C1a):** `getStatus(service, operation)`, `forceOpen`, and
`forceClose` resolve a breaker by the exact two-part key `service:operation`. Once STATE is
partitioned (`service:operation:<discriminant>`), those two-part lookups miss every partitioned
breaker. The provider admin controls (`forceCircuitBreakerClose(operation)` wrappers on
facebook, x, telegram, snapchat, linkedin, youtube, tiktok, pinterest, instagram) all call
`forceClose("<svc>-api", operation)` with the generic two-part operation — after C1b they would
silently NO-OP against the now-partitioned breakers instead of closing them.

**Choice — operate over ALL partitions matching the prefix.** `forceOpen` and `forceClose`
apply to the exact `service:operation` key **and** every partition key of the form
`service:operation:<*>` (the discriminant partitions). They return `true` if at least one
breaker matched. `getStatus` becomes an **aggregate over the same prefix set**: it returns the
**worst-of** snapshot (OPEN ≻ HALF_OPEN ≻ CLOSED; failures/successes summed) so an operator
polling `getStatus("x-api", "get-timeline")` sees "is ANY tenant's circuit for this op open?"
rather than null. The exact two-part breaker (the legacy shared-STATE one used by
not-yet-migrated sites) is included in the same match set, so callers keep working through the
migration. `getAllStatuses` (already per-key) is unchanged.

| Option                                                              | Verdict      | Why                                                                                                                                                            |
| ------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep two-part exact lookup                                          | **Rejected** | After partitioning, every `forceCircuitBreakerClose` becomes a silent no-op and `getStatus` returns null for a partitioned op — a real operability regression. |
| Prefix-aware match over `service:operation` + `service:operation:*` | **Chosen**   | Existing generic-operation callers keep reaching the breakers; `getStatus` aggregates worst-of across tenant partitions; no caller signature changes.          |

**Match boundary (precise):** the prefix set is the exact key `service:operation` PLUS keys
that start with `service:operation:` (the trailing colon prevents `get-post` from matching
`get-post-comments`). This is a substring/prefix check over the in-process `breakers` Map keys,
timer-free, no new state.

### D6 — Empty/whitespace discriminant is treated as ABSENT (S-2 hardening)

**Context (S-2):** the C1a gate rated an empty-string discriminant "not reachable" because
`hashCallScope` always returns 16 hex chars. That is true for today's call sites, but the
public `cacheKeyDiscriminant?: string` option and `FallbackContext.discriminant?: string` are
part of the contract; a future caller (or a bug folding an empty credential) could pass `""` or
`"   "`. An empty discriminant would collapse the cache/STATE key back to a shared
`service:operation:` — reopening the very leak D1b closes.

**Choice — harden the boundary on BOTH layers.** Treat a discriminant that is empty or
whitespace-only as **absent**: the breaker skips L1 (fail-safe miss, D1b), does NOT fold it
into the STATE key (falls back to the legacy shared key — same as no discriminant), and the L2
fallback store neither writes nor reads under it (fail-safe miss, D1c). Concretely, both the
circuit breaker and the fallback manager normalise the discriminant through a single guard
(`isPresentDiscriminant(d) = typeof d === "string" && d.trim().length > 0`) at the boundary,
so `undefined`, `""`, and `"   "` are indistinguishable to the keying logic. This is
defence-in-depth: the fail-safe default already prevents a shared entry; S-2 makes the
degenerate non-empty-but-blank input fail safe too instead of silently sharing.

### D7 — Remove the dormant `FallbackConfig.cacheKey` read escape hatch (S-3)

**Context (S-3):** `FallbackConfig.cacheKey` and the `config.cacheKey ?? …` read in
`getCachedResponse` are a **dormant** override: no production `FallbackConfig`
(`ANALYTICS_FALLBACK`, `METADATA_FALLBACK`, `UPLOAD_FALLBACK`) sets it, and no call site passes
it. It is a latent bypass — a future `FallbackConfig` that set a constant `cacheKey` would read
one shared, un-discriminated L2 entry across tenants, silently defeating D1c.

**Choice — delete it.** Remove the `cacheKey?: string` field from `FallbackConfig` and the
`config.cacheKey ??` branch in `getCachedResponse`, so the L2 read key is derived **only** from
the tenant discriminant (present ⇒ `fallback:service:operation:<discriminant>`; absent ⇒
fail-safe miss). Confirmed unused first (repo-wide grep: the only other `cacheKey` occurrences
are the unrelated CQRS query cache in `packages/shared/src/cqrs.ts` and `apps/api/src/cqrs/`).
No behaviour change today (dormant), a smaller attack surface tomorrow.

### D8 — Fix B: generic dispatcher action supersedes disclosure-via-key

**Context (the third vector, caught by the full C1b re-verify):** the breaker has a
THIRD cross-tenant vector the original 61-site cache audit never modelled — the **bound
closure**. `getOrCreateBreaker` constructed `new CircuitBreaker(apiCall, opts)` binding the
**first** caller's `apiCall` to the breaker instance, then returned that cached instance for
every later caller of the same `service:operation[:discriminant]` key and IGNORED the
newly-passed `apiCall`; `breaker.fire(...args)` (args `[]`, real params in the closure) then
re-ran the FIRST caller's closure. So any breaker key shared across tenants ran tenant A's
closure for tenant B — a cross-tenant disclosure **independent of `cacheEnabled`** and of both
cache layers. The re-verify found this OPEN at 10 discriminant-less call sites across three
files the cache audit's `packages/`-scoped grep never covered (`instagram/schedulingService.ts`,
`instagram/mediaProcessor.ts`, `apps/api/src/trends/trendAnalysisService.ts`), six of them
binding real per-tenant credentials/content.

**Two candidate fixes.** _Fix A_ (as originally implemented) makes the discriminant BE the
breaker key, so correctness depends on (i) EVERY call site supplying a discriminant AND (ii) each
discriminant UNIQUELY identifying its closure. The re-verify falsified both (10 missed sites +
the media-upload byteLength collision). _Fix B_ makes the breaker's ACTION a **generic
dispatcher** so the closure-binding footgun is removed structurally.

**Choice — Fix B (generic dispatcher).** `getOrCreateBreaker` now constructs
`new CircuitBreaker(dispatcher, opts)` where `dispatcher = (fn, ...args) => fn(...args)`
(the single static action shared by every breaker instance), and `call()` does
`breaker.fire(apiCall, ...args)` — passing THIS call's own closure as fire's first argument.
Opossum invokes the breaker's action with the fire arguments, so the dispatcher runs the
caller's own `apiCall`. **Cross-tenant disclosure is now closed for EVERY call regardless of
discriminant** — the breaker always runs the caller's own closure, so a shared key can never
re-run another tenant's closure.

**The discriminant is retained ONLY** to scope (a) the L1 cache key (D1/D1b), (b) the L2
fallback key (D1c), and (c) the per-tenant breaker STATE partition (D2/D2b). A **missing or
blank** discriminant now degrades to **SHARED circuit STATE** (an availability / noisy-neighbor
concern — tenant A's failures can trip a circuit that also short-circuits tenant B on that
exact op) and to a **cache skip** (D1b/D1c fail-safe) — but **never** to running another
tenant's closure (disclosure). This is a strictly weaker, benign failure mode.

**This supersedes the earlier "discriminant IS the disclosure boundary" framing of D1/D2.**
D1/D1b/D1c/D6 still hold as the CACHE-scoping and cache-fail-safe rules, and D2/D2b still hold
as the STATE-partition rules; but the _disclosure_ guarantee no longer rests on every site
supplying a unique discriminant — it rests on the dispatcher. The 10 previously-missed sites
and the `_template` are still migrated in this slice (so each distinct query/tenant gets its own
cache entry and STATE partition — a performance/availability restoration), but a future missed
site is no longer a disclosure emergency.

**W-A (media-upload byteLength collision) under D8:** downgraded from a correctness defect to a
benign availability nuance. Two same-type/same-size uploads by one tenant collide on one breaker
key, but the dispatcher runs each call's OWN closure, so the collision only SHARES a STATE
partition — it never returns the first upload's media URL for the second. A per-upload content
digest is deliberately NOT folded in (hashing multi-MB buffers on every upload is unjustified for
a benign STATE collision now that D8 closes the wrong-media vector).

**W-B (blank-discriminant STATE asymmetry) under D8:** the S-2 guard maps `""`/`"   "` to
absent; for L1/L2 that fails SAFE (skip), for the STATE key it falls back to the shared
`service:operation` key. Pre-D8 that shared key ALSO shared the bound closure (a latent
disclosure asymmetry). Under D8 the shared STATE key shares only circuit STATE (availability) —
the closure is always the caller's own — so the asymmetry is now benign.

| Option                                                        | Verdict      | Why                                                                                                                                                                                                                                          |
| ------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fix A — discriminant IS the breaker key (bind caller closure) | **Rejected** | Correctness needs every site to supply a UNIQUE-per-closure discriminant; the re-verify falsified both invariants (10 misses + byteLength collision). Easy-to-forget footgun.                                                                |
| Fix B — generic dispatcher action, caller fn as fire arg      | **Chosen**   | Closes disclosure structurally for EVERY call regardless of discriminant; discriminant retained only for cache/STATE scoping; a missed discriminant degrades to shared STATE (availability), never disclosure. Materially safer and simpler. |

**Recommended follow-up (NOT implemented in this slice) — Fitness #29 idea:** an
`apps/`-scoped completeness guard "no discriminant-less breaker call in `apps/`". Under Fix B a
discriminant-less `apps/api` breaker call is no longer a disclosure hazard, only an availability
(shared-STATE) one, so this is a hygiene/noisy-neighbor guard rather than a security gate — hence
it is documented here as a recommended follow-up (feed cluster G / N-CI-1) rather than shipped as
a new CI fitness function in this remediation. The cache audit's `packages/`-scoped grep is
structurally blind to `apps/`, which is why the four `trendAnalysisService` sites escaped the
original enumeration; the guard would close that blind spot.

---

## Data Flow

```
C1  call site ──hashCallScope(this.credentials, …params)──▶ discriminant (opaque, optional)
        │
        ▼
  circuitBreaker.call(svc, op, fn, [], {cacheKeyDiscriminant?})
        │
        │  DISCLOSURE always closed (D8): the breaker action is a generic
        │  dispatcher `(f, ...a) => f(...a)`; call() does breaker.fire(fn, ...a),
        │  so EVERY call runs its OWN closure — a shared key never re-runs
        │  another tenant's closure, discriminant present or not.
        │
        ├─ discriminant PRESENT ▶ cache key svc:op:<disc> (LRU-capped, tenant-scoped read+write)
        │                         breaker key svc:op:<disc> (LRU-capped, per-tenant STATE)
        │
        └─ discriminant ABSENT  ▶ cache SKIP (fail-safe D1b/D1c) + SHARED breaker STATE
                                   svc:op (availability / noisy-neighbor only — NOT disclosure,
                                   because the dispatcher still runs the caller's own closure)

C2  browser ▶ [trusted edge] ▶ Next egress ──relay XFF/X-Real-IP──▶ backend
                                                                      │
                              resolveClientIp: chain[len − HOP_COUNT] ▶ real client bucket
```

---

## File Changes

| File                                                                                                                                                                                                                      | Action            | Description                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/adapters/external-apis/src/circuitBreaker.ts`                                                                                                                                                                   | Modify            | Add `cacheKeyDiscriminant` option; fold into `generateCacheKey` + `getOrCreateBreaker` key; LRU-cap `cache` and `breakers`; export `hashCallScope`. **C-1:** pass `cacheKeyDiscriminant` into `cacheSuccessfulResponse` (write) and the fallback `executeFallback` context (read) so the L2 store is tenant-scoped too. |
| `packages/adapters/fallback-strategies/src/index.ts`                                                                                                                                                                      | Modify            | **C-1 (D1c):** thread `discriminant?` through `cacheSuccessfulResponse`, `getCachedResponse`, and the private `getCacheKey` builder → key `fallback:service:operation:<discriminant>`; fail-safe symmetry — no discriminant ⇒ no write and read-miss; add `discriminant?` to `FallbackContext`.                         |
| `packages/adapters/external-apis/src/index.ts`                                                                                                                                                                            | Modify            | Re-export `hashCallScope`.                                                                                                                                                                                                                                                                                              |
| `packages/providers/*/src/*.ts` (~59–64 sites)                                                                                                                                                                            | Modify            | **C1b (perf restoration):** add `cacheKeyDiscriminant` per `cacheEnabled:true` call to re-enable each site's L1 cache; the secret-payload flip (fb `validate-credentials` family → `cacheEnabled:false`) lands in C1a. Until a site is migrated, D1b's fail-safe default already keeps it isolated (cache skipped).     |
| `apps/client/lib/http/forwardedFor.ts`, `apps/admin/lib/http/forwardedFor.ts`                                                                                                                                             | Create            | Pure inbound→outbound XFF relay helper (+ JSDoc `@layer infrastructure`).                                                                                                                                                                                                                                               |
| `apps/client/app/api/backend/[...path]/route.ts`, `apps/admin/app/api/backend/[...path]/route.ts`, `apps/admin/app/api/auth/refresh/route.ts`, `apps/client/app/actions/auth.ts`, `apps/admin/lib/auth/backend-client.ts` | Modify            | Apply the relay helper to the outbound `fetch` headers (4 egress surfaces).                                                                                                                                                                                                                                             |
| `apps/api/src/config/env.ts`                                                                                                                                                                                              | Modify (doc only) | Clarify `TRUSTED_PROXY_HOP_COUNT` = trusted proxies in front of Next (relay model, no +1).                                                                                                                                                                                                                              |

## Interfaces / Contracts

```typescript
// packages/adapters/external-apis
export function hashCallScope(credential: unknown, ...publicParams: unknown[]): string;
// circuitBreaker.call options gains:
//   cacheKeyDiscriminant?: string   // opaque; present ⇒ folded into cache AND breaker keys;
//                                    // absent ⇒ L1 cache skipped (fail-safe default, D1b)

// apps/{client,admin}/lib/http
export function forwardedForHeaders(inbound: Headers): Record<string, string>;
//   copies x-forwarded-for (else x-real-ip); returns {} when neither present (no regression)
```

## The 64-site audit approach

- **Enumerate:** `rg "cacheEnabled:\s*true" packages/providers packages/adapters --type ts -g '!**/tests/**'` (grep counts 62 incl. tests → ~59–64 prod sites).
- **Classify** each into exactly one bucket:
  - `secret` — response embeds a credential/token (fb `validate-credentials`) → `cacheEnabled:false` **+** discriminant, isolation test anchor.
  - `PII` — account/user-scoped data (profiles, comments, analytics) → keep cache **+** discriminant, isolation test anchor.
  - `benign` — public resource by id (public metadata) → keep cache, discriminant = credential hash **+** resource id.
- **Central vs per-site:** helper + option are central; each site takes a **one-line** `cacheKeyDiscriminant` edit (per-site, mechanically identical); only the small `secret` set additionally flips the boolean.
- Confirm the do-not-regress `cacheEnabled:false` ops (tiktok authService token/refresh, snapchat refresh-token, fb `upload-media`/`post-to-page`) stay `false`.

## Testing Strategy (strict TDD, RED→GREEN; LXC: single file, heap-capped, `timeout`)

| Layer                                | What                                                                        | Location / framework                                            |
| ------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------- |
| C1 isolation (MERGE-BLOCKING anchor) | Tenant B never receives tenant A's cached `access_token`                    | `packages/providers/facebook/tests/*.test.ts` — vitest          |
| C1 state (MERGE-BLOCKING)            | A's OPEN circuit does not short-circuit B; A still short-circuits itself    | `packages/adapters/external-apis/tests/*.test.ts` — vitest      |
| C1 same-tenant                       | same creds+params still hit cache within TTL                                | vitest (external-apis)                                          |
| C2 keying (MERGE-BLOCKING)           | distinct IPs → distinct buckets; spoofed leftmost XFF ignored at `len−hops` | `apps/api/tests/unit/` — vitest on `resolveClientIp`            |
| C2 egress                            | each of 4 egress points forwards inbound IP; per-user refresh               | per-app helper vitest + `apps/api/tests/integration/` node:test |
| Do-not-regress                       | Fitness #25 A/B = 0, #28 = 0, AUTH stays 5/15min, fail-open WARN            | assertion tests                                                 |

## Migration / Rollout

No data migration. **Delivery — three stacked PRs, `stacked-to-main` (C1a → C1b → C2), each
≤ ~400 lines, no `size:exception` needed.** The fail-safe cache default (D1b) is what makes the
C1 split SAFE:

- **PR#1a (C1a)** lands the breaker mechanism — `cacheKeyDiscriminant` option, `hashCallScope`,
  LRU caps, STATE partition, the fail-safe default, and the one secret-class flip — plus the
  MERGE-BLOCKING anchors. **The moment C1a merges, the cross-tenant cache-disclosure leak is
  closed for ALL ~61 sites at once**: any site that has not yet supplied a discriminant simply
  stops caching (fail-safe skip) instead of serving a shared entry. There is no cross-tenant
  window between C1a and C1b.
- **PR#1b (C1b)** is a pure PERFORMANCE restoration: the ~59 one-line per-site
  `cacheKeyDiscriminant` edits re-enable each site's L1 cache, keyed per tenant, plus the full
  61-site audit table and per-provider isolation tests. It carries no security urgency because
  C1a already closed the leak.
- **PR#2 (C2)** is header-only (client-IP relay), independent of C1.

**Blast radius:** C1 is a hot path for _every_ provider read. Between C1a and C1b, un-migrated
sites take a temporary read-cache miss (perf/provider-quota cost only — never a correctness or
tenant-isolation cost); C1b restores hit-rate. A wrong discriminant only reduces hit-rate, never
crosses tenants. **Rollback of C1a = restore the constant-key behavior, which REVERTS TO THE
LEAK** — treat a C1a rollback as a security regression, not a neutral revert; prefer rolling
forward with a fix. Rollback of C1b only re-cools the cache (sites fall back to the fail-safe
skip — still isolated). C2 is header-only; rollback = drop the relay (reverts to today's
collapsed bucket). Neither touches persistence or the write path.

## Open Questions

- [ ] Exact LRU cap value(s) for `cache`/`breakers` (const vs env) — resolve in tasks.
- [ ] Whether any non-provider `cacheEnabled:true` site exists in `packages/adapters` (audit confirms the final N).

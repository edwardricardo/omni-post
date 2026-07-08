# Design: Close the CRITICAL cross-tenant and auth-DoS findings (Cluster A)

## Technical Approach

Two independent, chained slices off one proposal. **C1** makes the process-singleton
external-API circuit breaker tenant-safe on **two axes** — cache-entry keying across
**both cache layers** (the L1 in-process `Map` AND the L2 Redis fallback store, N-SEC-1)
and circuit-STATE partitioning (N-SEC-1b) — by threading a **credential-derived
discriminant** that the breaker treats as opaque, so no `apps/api` tenant context
crosses the `packages/adapters` boundary. **C2** stops the Next portals from _dropping_
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

---

## Data Flow

```
C1  call site ──hashCallScope(this.credentials, …params)──▶ discriminant (opaque, optional)
        │
        ▼
  circuitBreaker.call(svc, op, fn, [], {cacheKeyDiscriminant?})
        │
        ├─ discriminant PRESENT ▶ cache key svc:op:<disc> (LRU-capped, tenant-scoped read+write)
        │                         breaker key svc:op:<disc> (LRU-capped, per-tenant STATE)
        │
        └─ discriminant ABSENT  ▶ cache SKIP — miss + fetch fresh, store nothing shared
                                   (fail-safe default D1b; closes the leak for un-migrated sites)

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

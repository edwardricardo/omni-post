# Verify Report — cross-tenant-criticals, SLICE C1a (N-SEC-1 + N-SEC-1b) — RE-RUN after C-1 remediation

- Change: `cross-tenant-criticals` · Slice: **C1a only** · Store: openspec (mirrored to engram `sdd/cross-tenant-criticals/verify-report`)
- Role: adversarial security gate, RE-RUN to confirm the prior CRITICAL **C-1** (L2 fallback store cross-tenant leak) is CLOSED across BOTH cache layers. LXC forbids parallel judgment-day; adversarial verification done here.
- Verdict: **PASS-WITH-WARNINGS** — the prior blocking CRITICAL **C-1 is CLOSED**. The cross-tenant **disclosure** invariant (C1-R1) now holds across BOTH the L1 in-process cache AND the L2 Redis fallback store, symmetric fail-safe on read and write. Two AVAILABILITY warnings (W-1, W-2) remain, correctly deferred to C1b; they are not disclosure blockers and do not block committing C1a as PR#1a.

## Executive summary

**0 CRITICAL, 2 WARNING (W-1, W-2 — availability, deferred to C1b), 3 SUGGESTION.** C-1 remediation is sound and non-regressive: the L2 fallback store is now keyed `fallback:service:operation:<discriminant>` with symmetric fail-safe (a discriminant-less op writes NOTHING and reads a MISS on both layers). All 7 required test files GREEN (101 tests total across the set); tsc 0/0 on both adapter packages; eslint --max-warnings 0 clean on changed files; fitness #25A/#25B/#11/#9 all = 0; DEFAULT `fallbackEnabled` still false; no write-op fallback added.

## C1-R1 across both layers: **CLOSED**

A `cacheEnabled` op invoked WITHOUT a discriminant touches NEITHER cache layer — L1 read/write skipped (D1b), L2 write skipped + L2 read a fail-safe miss (D1c). An op WITH a discriminant reads/writes only its own tenant-scoped key on both layers. No other fallback strategy or breaker path serves dynamic tenant response data cross-tenant. The disclosure axis of the isolation invariant is closed for EVERY `cacheEnabled` site, including un-migrated ones, via the fail-safe default.

---

## Adversarial findings

### CRITICAL

None. (Prior C-1 is now CLOSED — see below.)

### C-1 (prior CRITICAL) — **CLOSED / VERIFIED**

- Was: `fallbackManager` L2 Redis store keyed `fallback:service:operation` (no discriminant) → tenant B served tenant A's most-recent cached PII payload on provider failure across ~40 `fallbackEnabled` reads.
- Fix landed and verified:
  - **Write (fail-safe):** `fallback-strategies/src/index.ts:143-167` `cacheSuccessfulResponse(service, operation, response, ttl, discriminant?)` returns early `if (discriminant === undefined)` (line 151) → NOTHING stored; with a discriminant, key = `fallback:${service}:${operation}:${discriminant}` (`getCacheKey`, :361-363).
  - **Read (fail-safe, symmetric):** `getCachedResponse` (:169-214) computes `key = config.cacheKey ?? (context.discriminant !== undefined ? getCacheKey(...) : undefined)`; `key === undefined` → `err("FALLBACK_FAILED")` MISS (:188-193). A stale pre-fix un-scoped key is never read.
  - **Discriminant reaches the read path (not dropped by the conditional-spread):** `circuitBreaker.ts:649-660` builds `FallbackContext` and spreads `discriminant` ONLY when `options.cacheKeyDiscriminant !== undefined` (:657-659); `getCachedResponse` keys off `context.discriminant`. Traced end-to-end: present ⇒ own-tenant key; absent ⇒ miss.
  - **Write path threading:** `circuitBreaker.ts:603-611` passes `options.cacheKeyDiscriminant` as the 5th arg to `cacheSuccessfulResponse`.
- Bypass surface checked: the `config.cacheKey ??` branch could bypass the discriminant, BUT the only two `fallbackEnabled` presets (`ANALYTICS_CB_OPTIONS` :120-124, `METADATA_CB_OPTIONS` :132-136) and `CommonFallbackStrategies.ANALYTICS_FALLBACK`/`METADATA_FALLBACK` (`fallback-strategies/src/index.ts:437-451`) do NOT set `cacheKey`. Grep confirmed no production `FallbackConfig` hardcodes a shared `cacheKey`. The read escape hatch is dormant (see S-3).
- RED/GREEN: `fallbackTenantIsolation.test.ts` GREEN 6/6. RED-without-fix is structurally guaranteed — the key-shape assertions (:155-160) require distinct `fallback:x-api:get-analytics:disc-A` / `:disc-B` keys AND absence of the un-scoped `fallback:x-api:get-analytics` key, which is impossible under the pre-fix constant key where both writes collide on `fallback:x-api:get-analytics`.

### Third-cache hunt (thorough) — no additional leak

Enumerated EVERY place a provider response or tenant-derived datum is stored and later served:

1. **L1 `cache` Map** (`circuitBreaker.ts:160`) — discriminant-scoped + fail-safe. CLOSED.
2. **L2 fallback `CACHED_RESPONSE` store** — discriminant-scoped + fail-safe. CLOSED (C-1).
3. **STATIC_RESPONSE** (`staticResponses` Map :50 + `config.staticResponse`) — serves ADMIN-REGISTERED static values keyed `service:operation`, never a captured tenant payload. No dynamic tenant data. SAFE.
4. **DEGRADED_SERVICE** (`createDegradedResponse` :294-348) — hardcoded degraded shapes (empty arrays / zeros). No tenant data. SAFE.
5. **FAIL_GRACEFULLY** (:247-265) / **RETRY_ALTERNATIVE** (:267-292) — constructed envelope / stub placeholder. No tenant data. SAFE.
6. **`breakers` Map** — circuit STATE, not a payload (availability axis → W-1).
7. **DLQ** (`addFailedOperation(service, operation, args, lastError, …)` `circuitBreaker.ts:690`) — stores FAILED-op metadata (`args`=`[]` at all sites, + error) for retry; does not serve one tenant's response to another. SAFE.
8. **Prometheus metrics** — labels `service`/`operation`/`state`/`status` only; no payload, no discriminant echoed. SAFE.
   No third cross-tenant disclosure vector.

---

### WARNING (availability — deferred to C1b, NOT disclosure blockers)

#### W-1 — STATE partition is mechanism-only in C1a; noisy-neighbor DoS persists for un-migrated ops

- `breakerKey` (`circuitBreaker.ts:288-293`) returns the legacy 2-part key when no discriminant. Grep confirms exactly ONE production call site supplies `cacheKeyDiscriminant` in C1a: `facebook/src/apiClient.ts:364` (`validate-credentials`). The other ~60 `cacheEnabled` reads + ALL write ops keep a shared 2-part breaker key.
- Effect: a failing tenant can still open the SHARED circuit for other tenants on those ops (cross-tenant availability DoS). Write-op STATE stays globally shared (writes never receive a discriminant in either slice).
- Not a regression (pre-fix ALL ops shared STATE; C1a strictly improves the one partitioned op and is neutral for the rest). This is availability, not disclosure — correctly deferred to C1b. The spec's STATE-partition requirement is mechanism-in-place; full per-site rollout is a C1b deliverable, required before the CHANGE archives, not before PR#1a.

#### W-2 — `getStatus` / `forceOpen` / `forceClose` are blind to 3-part partitioned keys

- `getStatus` (:806-809), `forceOpen` (:827-837), `forceClose` (:842-852) resolve only 2-part `service:operation` keys.
- Adversarial caller enumeration: NO caller breaks in C1a. Every `forceOpen`/`forceClose` caller is a provider admin control passing a generic `operation` with no discriminant (targets 2-part keys); the only partitioned op is `facebook:validate-credentials:<hash>` (3-part), so a force on it would be a harmless no-op (returns false), never a crash or cross-tenant issue. The breaker's 2-arg `getStatus` has ZERO production callers (the `getStatus` grep hits are unrelated saga/RBAC methods). `getAllStatuses` (:815-822) correctly enumerates all breakers under their real keys, so monitoring visibility is preserved.
- Latent for C1b: once read ops partition, make force\*/getStatus discriminant-aware or document observation via `getAllStatuses`.

---

### SUGGESTION

- **S-1** — 16-hex (64-bit) discriminant: accidental birthday bound ~2^32; a targeted cross-tenant collision needs ~2^64 work. Adequate at expected scale; revisit at multi-million-tenant scale. (`hashCallScope` :898-901.)
- **S-2** — Empty-string discriminant (`cacheKeyDiscriminant: ""`) is treated as PRESENT (`!== undefined`), so two sites both passing `""` would collide on both layers. Not reachable today — `hashCallScope` always returns a 16-char hex, never `""`. Harden by asserting a non-empty discriminant (treat `""` as absent) to keep the fail-safe airtight for future call sites.
- **S-3** — The `config.cacheKey ??` branch in `getCachedResponse` (:182-186) is an un-discriminated read escape hatch. Dormant (no production `FallbackConfig` sets `cacheKey`), but a future author who sets a constant `config.cacheKey` would bypass the discriminant scoping. Consider removing `cacheKey` from the fallback-read path or requiring it be discriminant-derived.

---

## Commands run + results (LXC-safe: single file, heap-capped, timeout)

Tests (all GREEN):

- `@adapters/fallback-strategies exec vitest run tests/fallbackTenantIsolation.test.ts` → **6/6** (C-1 anchor)
- `@adapters/fallback-strategies exec vitest run tests/index.test.ts` → **28/28**
- `@adapters/external-apis exec vitest run tests/unit/circuitBreaker.fallback.test.ts` → **18/18** (incl. 3 new C-1 threading tests)
- `@adapters/external-apis exec vitest run tests/circuitBreakerTenantIsolation.test.ts` → **7/7**
- `@adapters/external-apis exec vitest run tests/circuitBreaker.test.ts` → **37/37**
- `@providers/facebook exec vitest run tests/FacebookApiClient.cacheIsolation.test.ts` → **2/2**
- `@providers/facebook exec vitest run tests/FacebookApiClient.writeFailFast.test.ts` → **3/3**

Gates (all clean):

- `tsc --noEmit` @adapters/fallback-strategies → exit 0
- `tsc --noEmit` @adapters/external-apis → exit 0
- `eslint --max-warnings 0` on 4 source + 3 test files → exit 0
- Fitness #25 Part A → 0 · #25 Part B → 0 · #11 → 0 · #9 → 0
- `DEFAULT_EXTERNAL_API_OPTIONS.fallbackEnabled` = `false` (`circuitBreaker.ts:109`); only READ presets carry `fallbackEnabled: true` (:121, :133) — no write-op fallback
- `any` / `@ts-ignore` in changed source → NONE

---

## Routing

- `next_recommended`: **commit C1a as PR#1a** (disclosure invariant CLOSED across both layers; strict improvement, no regression).
- The CHANGE is not yet archive-ready: W-1 (per-site STATE partition, incl. write-op decision) + W-2 (status/force key-awareness) must close in C1b before archive.

## Risks

- W-1 availability DoS window persists for un-migrated read ops between C1a and C1b, and indefinitely for write ops absent a decision — track explicitly; not a disclosure risk.
- Rollback of C1a REVERTS TO THE LEAK (both layers) — treat as a security regression, prefer roll-forward.

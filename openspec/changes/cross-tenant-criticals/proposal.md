# Proposal — Close the CRITICAL cross-tenant and auth-DoS findings (Cluster A)

Close the two confirmed CRITICAL defects from the Nivelación phase: a process-wide
circuit-breaker cache that leaks tenant-scoped data (including a Facebook Page
`access_token`) across accounts, and a Next proxy layer that erases the real client
IP so the per-IP AUTH rate limiter collapses to a portal-wide lockout. Both are
security regressions with cross-tenant blast radius; this proposal frames the problem
and scope only — the concrete architecture is deferred to the design phase.

- **Change name:** `cross-tenant-criticals`
- **Cluster:** A (Nivelación) — `docs/product/MASTER_PLAN_ES.md §1`
- **Evidence base:** `docs/audits/FULL_REPO_ASSESSMENT_2026-06-29.md §3.1` (adversarially verified)
- **Tasks covered:** N-SEC-1, N-SEC-1b, N-SEC-2
- **Branch tip verified:** `workstream/impl-revalidation @ 9479c6a`

---

## Problem statement

### Security impact — cross-tenant secret and PII disclosure (C1)

The shared external-API circuit breaker caches responses under a key that does not
include the caller's identity or real request parameters. `generateCacheKey()`
(`packages/adapters/external-apis/src/circuitBreaker.ts:318`) builds the key from
`service:operation:base64(JSON.stringify(args))`, but all 64 call sites invoke the
breaker with `args = []` — the real params (credentials, ids) live inside the
`apiCall` closure and never reach the key. For any `cacheEnabled: true` operation the
key collapses to a constant (`service:operation:W10=`). Because the breaker is a
process singleton with a plain in-process `Map`
(`packages/adapters/external-apis/src/index.ts:20`, `circuitBreaker.ts:125`), the
first tenant's cached response is served to every other tenant in the process for the
TTL window.

Confirmed leak: `facebook validate-credentials`
(`packages/providers/facebook/src/apiClient.ts:347`) caches a payload containing the
Page `access_token` for 5 minutes; a second account validating within that window
receives the first account's token. This is cross-tenant secret disclosure — a direct
violation of the multi-tenant isolation canon (`SECURITY_CANON §Multi-Tenant
Isolation`).

A related noisy-neighbor defect (N-SEC-1b, `cb-shared-breaker-xtenant-02`): the shared
breaker also shares circuit _state_, so one tenant's provider failures open the circuit
for every tenant on the same operation.

### Security impact — portal-wide authentication DoS (C2)

The Next portals proxy backend calls but rebuild request headers from scratch and never
forward `X-Forwarded-For` / `X-Real-IP`. The backend's `resolveClientIp`
(`apps/api/src/security/httpRateLimitPreHandler.ts:159`) then falls back to
`socket.remoteAddress`, which is the Next server's IP for every request. The AUTH
limiter (`RateLimitConfigs.AUTH` = 5 requests / 15 min per IP) therefore buckets the
entire portal under one key: 5 anonymous login attempts lock out every user, and
because the auth context refreshes roughly every 12 minutes and forces logout on any
refresh error, more than four active users can randomly de-authenticate each other.
This is a denial-of-service on the login and session-refresh paths.

### Business impact

- **Trust and compliance:** cross-tenant disclosure of a provider access token is a
  reportable data-isolation breach; it undermines the core tenant-isolation guarantee
  the platform sells.
- **Availability:** the auth-DoS makes the product unusable under normal concurrency —
  a handful of users or a single abusive client can lock out an entire portal.
- **Latent regression surface:** LinkedIn currently caches WRITE operations
  (`packages/providers/linkedin/src/apiClient.ts:107,245,321`), compounding the cache
  correctness problem beyond reads.

---

## Scope

### In scope

| Item                         | Detail                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| C1 breaker cache correctness | Make cached reads tenant/credential-safe across the 64 `cacheEnabled` operations (N-SEC-1).                                        |
| C1 breaker state isolation   | Partition breaker STATE per account so one failing tenant does not open the circuit for others (N-SEC-1b).                         |
| C1 call-site audit           | Classify the ~64 `cacheEnabled` sites as secret / PII / benign; flag the LinkedIn write-op caching.                                |
| C2 IP forwarding             | Forward the real inbound client IP at the 4 Next egress points and re-align `TRUSTED_PROXY_HOP_COUNT` for the added hop (N-SEC-2). |
| Isolation tests              | Cross-account cache-isolation test (C1) and distinct per-IP-bucket test (C2).                                                      |

### Out of scope

| Item                                                                                         | Reason                                                                                                                       |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Detailed target architecture (key discriminant vs. option flag; per-account keying strategy) | Design-phase decision — see "deferred" below.                                                                                |
| Other Nivelación clusters (B, C, …)                                                          | Separate changes; this is Cluster A only.                                                                                    |
| Re-enabling caching on ops that are correctly `cacheEnabled: false`                          | Token/refresh/write ops (tiktok authService, snapchat refresh-token, facebook upload-media / post-to-page) MUST NOT regress. |
| A second HTTP rate limiter, or changing the AUTH policy numbers                              | The limiter's fail-open posture and the 5/15min policy stay as-is (`SECURITY_CANON §Rate Limiting`).                         |
| Replacing the in-process breaker `Map` with a distributed store                              | Not required to close the finding; may be raised as a design option but is not committed here.                               |

---

## Capabilities

### C1 — Tenant-safe circuit-breaker cache and state (N-SEC-1 + N-SEC-1b)

Eliminate cross-tenant data served from the breaker cache, and stop one tenant's
failures from opening the circuit for others. Includes the full audit and
classification of the ~64 `cacheEnabled` operations and the cross-account isolation
test. The confirmed secret leak (fb `access_token`) is the acceptance anchor.

### C2 — Real client IP forwarding through the Next proxy (N-SEC-2)

Forward the true inbound client IP from every Next egress point to the backend so the
per-IP AUTH bucket is per-user again, and keep `TRUSTED_PROXY_HOP_COUNT` correct for
the added hop. Replicated across both admin and client portals, with a test proving
distinct per-IP buckets.

---

## High-level approach (candidate directions only — architecture deferred to design)

> The design phase owns the final decision. The items below are seams already present
> in the code, listed so design has a starting map. Do NOT read them as commitments.

### C1 candidate directions

- Thread a tenant/credential discriminant through the existing typed `args` of
  `circuitBreaker.call<T, R>` (currently always `[]`), OR add an explicit
  `cacheKeyDiscriminant` option, so the cache key reflects the caller.
- `clearCache(service, op)` purges by prefix and stays compatible if a discriminant is
  appended to the key.
- `this.credentials` is available at each call site; `createHash` is already used in
  tiktok/authService, facebook/media, and videoProcessor — a hashing pattern exists.
- For credential-scoped reads (e.g. `validate-credentials`), a candidate is to disable
  the L1 cache entirely rather than key it — to be weighed in design.
- Per-account breaker STATE isolation (N-SEC-1b) is a distinct axis from cache keying;
  design must address both, not conflate them.

### C2 candidate directions

- Read the inbound IP with `next/headers` `headers()` /
  `req.headers.get("x-forwarded-for")` in the route handlers and append it to the
  outbound `X-Forwarded-For`.
- Introduce a single shared forwarding helper (none exists today) used by all 4 egress
  points: `apps/client/app/api/backend/[...path]/route.ts:68`,
  `apps/admin/app/api/backend/[...path]/route.ts:70`,
  `apps/admin/app/api/auth/refresh/route.ts`, and the auth server actions
  (`apps/client/app/actions/auth.ts`, `apps/admin/lib/auth/backend-client.ts`).
- Re-count and adjust `TRUSTED_PROXY_HOP_COUNT` (`apps/api/src/config/env.ts:250`,
  min 1, default 1) so `resolveClientIp` still selects the trusted hop after the added
  entry.

---

## Risks

| Risk                                     | Why it matters                                                                                                                                                   | Mitigation direction                                                                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 64-site audit surface                    | Every `cacheEnabled` site must be classified; a missed site can keep leaking or silently regress a cache.                                                        | Treat the audit as a first-class deliverable with an explicit classification table; make the secret/PII sites the test anchors. |
| Fitness #25 must not regress             | The circuit-breaker fail-fast-for-writes invariant is CI-enforced (hard-zero); cache changes must not flip `fallbackEnabled` or re-enable fallback on write ops. | Keep `DEFAULT_EXTERNAL_API_OPTIONS.fallbackEnabled: false`; do not touch write-op fallback flags.                               |
| Do-not-regress `cacheEnabled: false` ops | Re-enabling caching on token/refresh/write ops would reintroduce the leak on the most sensitive paths.                                                           | Explicit out-of-scope; audit must confirm these stay `false`.                                                                   |
| Hop-count miscount (C2)                  | An off-by-one in `TRUSTED_PROXY_HOP_COUNT` after adding a hop re-opens spoofing (leftmost XFF is attacker-controlled) or re-collapses the bucket.                | Design must state the exact hop topology; the per-IP-bucket test must cover a spoofed leftmost XFF entry.                       |
| LinkedIn write-op caching (latent)       | Caching write ops is a correctness bug beyond the reported finding.                                                                                              | Flag in the audit; decide fix-here vs. defer in design/spec.                                                                    |
| Cross-account state coupling (N-SEC-1b)  | Partitioning breaker state changes failure semantics under load.                                                                                                 | Design must define the keying and any memory-growth bound for per-account breakers.                                             |

---

## Delivery note

This change will very likely exceed 400 changed lines and touches security-sensitive
paths (`**/security/**`, auth egress, provider adapters), which triggers the pre-PR 4R
review fan-out. Plan for **chained PRs, C1 then C2**, as two independently reviewable
and shippable slices:

1. **PR #1 — C1** (breaker cache + state isolation + 64-site audit + isolation test).
2. **PR #2 — C2** (Next IP forwarding helper across 4 egress points + hop-count +
   per-IP-bucket test).

The final split, chain strategy, and `size:exception` decision are resolved at the
tasks/apply phases, not here.

---

## Definition of Done

Framing only — no builds or tests run in this phase. This workstream closes at
**0 error / 0 warning** per the standing obligation.

- [ ] N-SEC-1: cache key includes a credential/tenant discriminant + real params (or L1
      disabled for credential-scoped reads); the ~64 `cacheEnabled` sites audited and
      classified (secret / PII / benign); cross-account isolation test passes.
- [ ] N-SEC-1b: breaker state partitioned per account (a failing tenant does not open
      the circuit for others).
- [ ] N-SEC-2: real inbound IP appended to `X-Forwarded-For` at all 4 egress points via
      a shared helper; `TRUSTED_PROXY_HOP_COUNT` adjusted for the added hop; replicated
      in admin; test proves distinct per-IP buckets.
- [ ] Correctly `cacheEnabled: false` token/refresh/write ops NOT regressed.
- [ ] Fitness #25 (write-path fail-fast) still hard-zero.
- [ ] Full gate green: `lint --max-warnings 0`, `tsc`, all 24 fitness checks, tests.

---

## Next step

Proceed to `sdd-spec` to turn C1 and C2 into testable requirement scenarios, then
`sdd-design` for the breaker-keying and IP-forwarding architecture (spec and design may
run in parallel off this proposal).

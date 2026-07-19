# Verify Report — cross-tenant-criticals · FULL C1b RE-CERTIFICATION (post Fix B / D8)

> Adversarial RE-VERIFY of the entire C1 slice (N-SEC-1 + N-SEC-1b) after the **Fix B (generic
> dispatcher, design D8)** remediation. The prior verify (report #204) returned **FAIL** on the
> breaker bound-closure vector — 10 discriminant-less `circuitBreaker.call` sites across three
> files the cache audit never covered. This run re-derives every claim from code, re-runs a broad
> regression battery (the dispatcher changed the execution path of EVERY breaker call), and hunts
> for a Fix-B-induced regression. Apply self-report (#203) was NOT trusted.

## Status: **PASS**

The bound-closure FAIL is **RESOLVED — structurally, for every call regardless of discriminant.**
The breaker's action is now a single caller-independent generic dispatcher; the caller's own
closure is passed per-invocation to `breaker.fire(...)`, so a process-shared breaker can never
re-run the first caller's closure. The dispatcher refactor introduced **no regression** across a
broad adapter + multi-provider + apps/api test sample (237 tests GREEN, 0 failed). All 0-defect
gates hold. One documented latent WARNING (C-4 trend discriminants not yet tenant-scoped — benign
today because the closures are empty stubs and D8 closes the closure vector).

---

## Verdicts

- **Cross-tenant disclosure (L1 + L2 + breaker-closure via D8 dispatcher): CLOSED.**
  - **L1 in-process cache — CLOSED.** Fail-safe default (D1b): a `cacheEnabled` call with no /
    blank discriminant skips L1 entirely (`circuitBreaker.ts:621` gates the cache read on
    `discriminant !== undefined`). Proven: `circuitBreakerTenantIsolation` fail-safe-default test
    - cross-tenant discriminant test GREEN.
  - **L2 Redis fallback store — CLOSED.** Key is `fallback:service:operation:<discriminant>`
    (`fallback-strategies/src/index.ts:377`); `cacheSuccessfulResponse` and `getCachedResponse`
    both fail-safe on absent/blank discriminant (`:167`, `:200-209`); the dormant
    `FallbackConfig.cacheKey` escape hatch (S-3) is removed. Proven: `fallbackTenantIsolation`
    8/8 + `index` 28/28 GREEN.
  - **Breaker bound-closure (THE #204 FAIL) — CLOSED for EVERY call.** `getOrCreateBreaker`
    constructs `new CircuitBreaker(ExternalApiCircuitBreaker.dispatch, …)` (`circuitBreaker.ts:385`)
    — the static dispatcher `(apiCall, ...callArgs) => apiCall(...callArgs)` (`:358`) is
    caller-independent and captures no closure. `call()` fires
    `breaker.fire(apiCall as unknown as BreakerApiCall, ...args)` (`:688`), passing THIS call's
    own closure. Opossum invokes the breaker action with the fire arguments, so the dispatcher
    runs the current caller's `apiCall` — regardless of which tenant created the breaker, whether
    the key is shared (`service:operation`) or partitioned (`service:operation:<disc>`), and
    whether a discriminant is present. Proven: `circuitBreakerTenantIsolation` → "shared breaker
    runs the caller's own closure (D8)" GREEN (discriminant-less, `cacheEnabled:false`, shared key
    → tenant B receives `{tenant:"B"}`, never A's). The 10 previously-missed sites (instagram
    `schedulingService` ×1, `mediaProcessor` ×5, apps/api `trendAnalysisService` ×4) + `_template`
    ×2 are now non-leaking on BOTH counts: (i) the dispatcher closes disclosure structurally, and
    (ii) each now carries a `cacheKeyDiscriminant` for cache/STATE scoping.

- **Within-tenant cross-resource: SAFE.**
  - **W-A instagram `media-upload:upload` (`apiClient.ts:538`) — SAFE.** Re-examined: the op is
    **NOT `cacheEnabled`** (no `cacheEnabled` key in the options block ⇒ default `false` ⇒ no L1
    serving). The `hashCallScope(this.credentials, mediaType, mediaBuffer.byteLength)` discriminant
    scopes only circuit STATE. Under D8 two same-type/same-size uploads by one tenant that collide
    on this key merely SHARE a STATE partition (availability nuance) — the dispatcher runs each
    call's OWN `mediaCall` closure, so upload Y never receives upload X's media URL. The #204
    wrong-media concern is structurally closed. Not folding a multi-MB content digest is the
    correct call.
  - **Resource-specific reads fold their resource id (spot-checked):** fb `get-page-insights`
    `hashCallScope(this.credentials, since?.getTime(), until?.getTime())` (`facebook/apiClient.ts:607`;
    pageId is credential-derived); youtube `get-video-details`
    `hashCallScope(this.credentials, videoId)` (`youtube/apiClient.ts:333`, X≠Y anchor GREEN);
    telegram `get-chat-member` `hashCallScope(this.botToken, this.chatId, botUserId)`
    (`telegram/apiClient.ts:257`). Cached-read within-tenant resource isolation holds.

- **Boundary-cast soundness: SOUND (type-erasure only, no behavior change, no masked mismatch).**
  `apiCall as unknown as BreakerApiCall` (`:689`) and the `as R` on the fire result (`:691`) erase
  the caller's `<T, R>` generics at the single dispatcher boundary because ONE stored breaker must
  serve callers of every shape (`StoredBreaker = CircuitBreaker<BreakerDispatchArgs, unknown>`).
  The runtime value flows through unchanged — the same function reference is passed to `fire`, the
  dispatcher calls it, and its own promise is returned; the cast neither converts a value nor
  suppresses a real incompatibility (the dispatcher genuinely accepts any function + args and
  returns whatever it returns). The `<T, R>` generics on `call()` remain the real caller contract.
  The opossum `fallback` wrapper (`:647-649`) strips the dispatcher's leading fn arg and forwards
  the caller's args + opossum's appended error, reproducing the pre-D8 fallback contract. **Zero
  `any`** in the changed source (the only `any` tokens are the word "any" in JSDoc prose).

---

## Findings

### CRITICAL — none

The three #204 CRITICALs are all resolved:

- **C-2** (instagram `schedulingService.ts:155`) — closure disclosure closed by D8; now also carries
  `hashCallScope(credentials, job.accountId, job.projectId, job.queueId)` for STATE.
- **C-3** (instagram `mediaProcessor.ts` ×5) — closure disclosure closed by D8; each site folds its
  `videoUrl`(+opts) discriminant. `mediaProcessor.test.ts` 11/11 GREEN.
- **C-4** (apps/api `trendAnalysisService.ts` ×4) — closure disclosure closed by D8; see WARNING-1
  for the residual cache-scoping caveat. `trendAnalysisService.test.ts` 45/45 GREEN.

### WARNING

- **WARNING-1 (latent, documented) — C-4 trend discriminants are NOT tenant-scoped.**
  `trendAnalysisService.ts:112/185/306/421` fold a constant `"trend-analysis-global"` + request
  scope (region/timeframe/contentId/category), NOT a per-tenant credential. **Benign today**: the
  four closures are empty stubs (`return []` / `// TODO: Integrate with real … APIs`), so no
  per-tenant data exists and sharing a global trend cache entry across tenants is correct; and D8
  closes the closure vector regardless. **Residual hazard**: D8 closes the _closure_ vector but NOT
  the _L1/L2 cache_ vector — the cache serves by key. If these are wired to real per-tenant
  provider/`prisma` calls WITHOUT first extending the discriminant with the tenant scope, tenant
  A's cached trend payload would be served to tenant B (a cache disclosure). The requirement is
  documented in a code WHY-comment at each site and in `audit-cache-sites.md`; track via the
  recommended `apps/`-scoped completeness guard (design D8 "Fitness #29 idea", feed cluster G /
  N-CI-1). Not merge-blocking for THIS slice (stub state + documented).

### SUGGESTIONS

- **S-1 — per-call `options.fallback` on a shared breaker is last-writer-wins (latent).** The
  `breaker.fallback(...)` wrapper captures the current call's `options.fallback` on a possibly
  shared breaker instance; the dispatcher (fire path) is caller-safe, but the opossum _fallback_
  path is a separate mechanism it does not cover. NOT reachable today: every real call site carries
  a discriminant, so every breaker that a `fallback`-passing read uses (e.g. fb `get-page-insights`)
  is PARTITIONED per tenant — no two tenants share the instance. If a future discriminant-less site
  ever passes `options.fallback`, add a guard. Analogous in spirit to the (now-benign) W-B STATE
  asymmetry.
- **S-2 — enumeration nuance.** The completeness sweep returns 136 `circuitBreaker.call(` textual
  matches, but **2 of them are JSDoc examples** in `circuitBreaker.ts:118/130`
  (`Call-site: circuitBreaker.call(...)`), not real call sites (the implementation uses
  `breaker.fire`). The apply's "136 sites" is imprecise; the substantive claim holds — **134 real
  call sites, every one carrying a discriminant, zero discriminant-less** (see table below).
- **S-3 — `_template/src/apiClient.ts`** now models the discriminant pattern (2 sites migrated);
  copy-paste no longer seeds discriminant-less sites. Good.

---

## Commands + results (LXC-safe: single file, `--max-old-space-size`, `timeout`)

### Regression battery — the biggest risk (dispatcher changed EVERY breaker call path)

| Test file                                                                         | Result                                    |
| --------------------------------------------------------------------------------- | ----------------------------------------- |
| external-apis `circuitBreakerTenantIsolation.test.ts` (incl. **D8** closure test) | **8/8 PASS**                              |
| external-apis `circuitBreaker.test.ts` (core breaker path)                        | **37/37 PASS**                            |
| external-apis `circuitBreakerC1bHardening.test.ts` (write-STATE / S-2 / W-2)      | **7/7 PASS**                              |
| external-apis `unit/circuitBreaker.fallback.test.ts`                              | **18/18 PASS**                            |
| fallback-strategies `fallbackTenantIsolation.test.ts` (L2 iso + fail-safe)        | **8/8 PASS**                              |
| fallback-strategies `index.test.ts`                                               | **28/28 PASS**                            |
| facebook `FacebookApiClient.cacheIsolation.test.ts`                               | **2/2 PASS**                              |
| facebook `FacebookApiClient.writeFailFast.test.ts`                                | **3/3 PASS**                              |
| youtube `YouTubeApiClient.cacheIsolation.test.ts` (X≠Y + A≠B)                     | **3/3 PASS**                              |
| tiktok `TikTokAuthService.cacheIsolation.test.ts`                                 | **2/2 PASS**                              |
| tiktok `apiClient.test.ts`                                                        | **51/51 PASS**                            |
| telegram `TelegramApiClient.cacheIsolation.test.ts`                               | **3/3 PASS**                              |
| telegram `TelegramApiClient.writeFailFast.test.ts`                                | **6/6 PASS**                              |
| instagram `InstagramApiClient.writeFailFast.test.ts`                              | **3/3 PASS**                              |
| instagram `index.test.ts`                                                         | **22/22 PASS**                            |
| instagram `mediaProcessor.test.ts` (C-3 file)                                     | **11/11 PASS**                            |
| instagram `schedulingService.scheduling.test.ts` (C-2 file)                       | **16/16 PASS**                            |
| apps/api `trendAnalysisService.test.ts` (C-4 file)                                | **45/45 PASS**                            |
| **TOTAL**                                                                         | **237 / 237 PASS, 0 failed, 0 cancelled** |

### Gates (0-defect)

| Check                                                  | Command                              | Result                     |
| ------------------------------------------------------ | ------------------------------------ | -------------------------- |
| tsc `@adapters/external-apis`                          | `tsc --noEmit`                       | exit 0                     |
| tsc `@adapters/fallback-strategies`                    | `tsc --noEmit`                       | exit 0                     |
| tsc `@providers/instagram`                             | `tsc --noEmit`                       | exit 0                     |
| tsc `@providers/_template`                             | `tsc --noEmit`                       | exit 0                     |
| tsc `@apps/api` (largest)                              | `tsc --noEmit`                       | exit 0                     |
| eslint changed src + tests                             | `eslint --max-warnings 0` (10 files) | exit 0                     |
| Fitness #25 Part A (default `fallbackEnabled:true`)    | grep                                 | **0**                      |
| Fitness #25 Part B (write-verb `fallbackEnabled:true`) | grep                                 | **0**                      |
| Fitness #11 (raw `setInterval` in packages)            | grep                                 | **0**                      |
| Fitness #9 (missing `@file`, repo-wide)                | grep                                 | **0**                      |
| Fitness #8 (sprint/phase refs, repo-wide)              | grep                                 | **0**                      |
| `any` / `@ts-ignore` in changed source                 | grep                                 | **0**                      |
| Do-not-regress uncached ops                            | grep                                 | all `cacheEnabled:false` ✓ |

Do-not-regress confirmed `cacheEnabled:false`: tiktok authService `exchange-code-for-token`/
`refresh-access-token`/`revoke-token`; snapchat `refresh-token`; facebook `validate-credentials`
(C1a secret-flip) / `upload-media` / `post-to-page`.

### Completeness sweep — `rg "circuitBreaker\.call(" apps packages -g '!**/tests/**'`

Per-file `circuitBreaker.call(` count **equals** `cacheKeyDiscriminant` count for EVERY file across
apps/ AND packages/ (27 files). 136 textual matches − 2 JSDoc examples in `circuitBreaker.ts` =
**134 real call sites, all carrying a discriminant, ZERO discriminant-less.** No exception.
Spot-checked the 10 #204-missed sites + `_template` ×2 individually: each discriminant is bound to
its own call's options block.

---

## Regression check (dispatcher / cast introduced no regression)

The three cache vectors (L1 fail-safe D1b, L2 fail-safe D1c, STATE partition D2/D2b), the S-2 blank
guard, the W-2 prefix-aware admin controls, and the LRU caps all still hold (anchors + hardening
GREEN, tsc/eslint clean). The generic-dispatcher refactor is orthogonal to the discriminant
migration: the discriminants added across C1b are retained for cache/STATE scoping, and the
disclosure guarantee no longer depends on them. No behavior change from the boundary casts.

---

## Tasks ↔ code state

All C1 tasks (`PR#1a` C1a + `PR#1b` C1b b1/b2 + `C1b-v1..v4` Fix B) are `[x]` and match the working
tree (Fix B central refactor + 10 migrated sites + contract updates present). C2 tasks
(`C2-1..C2-9`, PR#2 client-IP forwarding) remain `[ ]` — correctly, that slice is not started.

---

## Full-slice PR-split recommendation (`stacked-to-main`, each ≤ ~400 lines where feasible)

The C1 slice is one logical security change delivered as a stack. Recommended review slicing:

1. **PR#1a — C1a central mechanism (ALREADY COMMITTED `98627f8c`).** `cacheKeyDiscriminant` option
   - `hashCallScope`, fail-safe L1 default (D1b), L2 tenant-scoping + S-3 removal (D1c/D7), LRU caps,
     STATE partition (D2), S-2 blank guard (D6), W-2 prefix-aware admin controls (D5), fb
     `validate-credentials` secret-flip, MERGE-BLOCKING anchors.
2. **PR#1b — C1b per-site discriminant migration (working tree, ~1.7k lines → MUST sub-split).**
   Pure cache/STATE-scoping restoration. Split by provider family so each sub-PR is ≤ ~400 and
   reviewable in isolation:
   - **1b-i** facebook + x + snapchat + linkedin + storage-s3 + storage-cloudinary
   - **1b-ii** tiktok family (7 files)
   - **1b-iii** youtube family (6 files)
   - **1b-iv** pinterest + instagram/apiClient (+ media-upload STATE discriminant)
3. **PR#1b-v — Fix B / D8 (working tree; the FAIL-closer — review as its OWN focused PR).** The
   `circuitBreaker.ts` dispatcher refactor (static `dispatch`, `getOrCreateBreaker` wrapping it,
   `call()` firing `breaker.fire(apiCall, ...args)`, the `BreakerApiCall`/`BreakerDispatchArgs`/
   `StoredBreaker` types, the fallback-strip wrapper) + the 10 previously-missed sites
   (instagram `schedulingService`/`mediaProcessor`, apps/api `trendAnalysisService`) + `_template`
   ×2 + the D8 test + design/spec/audit doc updates. **This is the security-critical structural
   change** and should carry the D8 anchor test as its proof; keep it small and reviewed on its own.
   - **Reviewer note:** because `98627f8c` (C1a) landed the discriminant mechanism BEFORE the
     dispatcher, treat the disclosure guarantee as fully closed only once PR#1b-v merges. Under
     Fix B a missed discriminant is an availability (shared-STATE) concern, not a disclosure one —
     so 1b sub-PRs may merge in any order relative to each other, but **1b-v is the one that closes
     the #204 FAIL.** Recommend adding the `review-risk`/`review-resilience` fan-out on 1b-v
     (security path) and a `judgment-day` pass, per the trigger rules.
4. **PR#2 — C2 client-IP forwarding (NOT started).** Header-only relay; independent of C1.

---

## next_recommended: **commit** (the C1b + C1b-v working-tree changes, per the PR-split above),

then proceed to C2 (PR#2). **Cluster-A archive waits until C2 lands** — C1 alone is PASS but the
cluster is not complete.

## Risks

- **No unresolved CRITICAL — nothing blocks committing the C1 slice.**
- **WARNING-1 (tracked, non-blocking):** the four apps/api trend sites must gain a tenant-scoped
  discriminant BEFORE their stub closures are wired to real per-tenant data, else a future L1/L2
  cache disclosure reopens (D8 does not cover the cache vector). Land the recommended `apps/`-scoped
  completeness guard (Fitness #29 idea) in cluster G / N-CI-1 to enforce this structurally.
- **Rollback posture (unchanged):** rolling back C1a reverts to the constant-key LEAK — treat any
  C1 rollback as a security regression, roll forward instead.

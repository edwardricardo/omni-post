# Tasks: Close the CRITICAL cross-tenant and auth-DoS findings (Cluster A)

> Change: `cross-tenant-criticals` · Artifact store: openspec · Strict TDD: ACTIVE
> Inputs: `design.md`, `specs/circuit-breaker-isolation/spec.md`, `specs/client-ip-rate-limit/spec.md`
> Delivery: `delivery_strategy = ask-on-risk`, `chain_strategy = stacked-to-main`
>
> **Chained PRs (RESOLVED): PR#1a = C1a, PR#1b = C1b, PR#2 = C2 — `stacked-to-main`
> (C1a → C1b → C2), each ≤ ~400 lines, NO `size:exception`.** The fail-safe cache default
> (Design D1b) makes the C1 split SAFE: **C1a** (breaker mechanism + fail-safe default +
> secret-class flip + MERGE-BLOCKING anchors) closes the cross-tenant disclosure leak for ALL
> ~61 sites the instant it merges — un-migrated sites simply skip their cache. **C1b** (the ~59
> mechanical per-site `cacheKeyDiscriminant` edits + full audit) is pure PERFORMANCE restoration
> with no security window. The delivery decision is RESOLVED (two stacked C1 PRs, no exception)
> — **apply may proceed**; no ask-on-risk stop remains.
>
> **Strict TDD order:** every MERGE-BLOCKING scenario gets a FAILING test task (RED) BEFORE
> the implementation task that turns it GREEN. Test tasks and their impl tasks share a work
> unit (kept in the same commit per `work-unit-commits`).
>
> **LXC test constraint (applies to EVERY executed test task):** run ONE test file at a time,
> heap-capped (`node --max-old-space-size=<cap>` via the package runner), under a `timeout`
> wrapper. NEVER run the full suite at once. Command shapes:
>
> - C1 package tests: `pnpm --filter @packages/adapters-external-apis test <file>` and
>   `pnpm --filter @providers/facebook test <file>` (vitest, single file).
> - C2 unit: `pnpm --filter @apps/api test <file>` (vitest); C2 integration: node:test single file.
>
> **Canon (every new/modified file):** JSDoc `@file/@description/@layer` header + `@method`
> on new public methods; `@layer infrastructure` for adapters/helpers/routes/tests;
> zero `any` (use `unknown` + guards); no raw `setInterval`/timers (Fitness #11);
> no new HTTP limiter / no `config:{rateLimit}` (Fitness #28); no `fallbackEnabled:true` on
> write ops (Fitness #25 A/B).
>
> Legend: `[P]` = parallelizable with its siblings in the same slice · `[SEQ]` = must follow
> the task(s) named in its note · `[MB]` = closes a MERGE-BLOCKING requirement.

---

## PR#1a + PR#1b — C1: Circuit-breaker tenant isolation (N-SEC-1 + N-SEC-1b)

> C1 ships as two stacked PRs: **PR#1a = Slice C1a** (leak-closure via the fail-safe default),
> then **PR#1b = Slice C1b** (per-site perf restoration, targets the C1a branch).

### Slice C1a — mechanism + secret class + MERGE-BLOCKING anchors

Reviewable core. Adds the central helper/option, the **fail-safe cache default** (no
discriminant ⇒ skip L1), the LRU caps, the STATE partition, flips the one confirmed secret
site, and lands the MERGE-BLOCKING anchor tests + the fail-safe-default test + the same-tenant
do-not-regress tests. **After C1a the cross-tenant disclosure leak is CLOSED for ALL ~61 sites
at once** — every un-migrated `cacheEnabled:true` site fails safe (skips its cache) until C1b
supplies its discriminant. C1b restores per-site cache perf, not security.

- [x] **C1a-1 [P]** Decide + document the LRU cap values as named consts in
      `packages/adapters/external-apis/src/circuitBreaker.ts` (resolves design Open Question):
      `CACHE_MAX_ENTRIES = 5000`, `BREAKERS_MAX_ENTRIES = 2000`, each with a JSDoc rationale
      comment (const, NOT env — internal memory-safety bound, not an ops knob; promote to env via
      ADR only if real scale demands). No timers. _(Spec C1-R4 growth-bounding.)_

- [x] **C1a-2 [P]** RED — write the STATE-partition failing test in
      `packages/adapters/external-apis/tests/*.test.ts` (vitest): tenant A trips operation `O`
      OPEN; tenant B (distinct discriminant) calls `O` and is short-circuited by A's failures →
      test FAILS on today's single global breaker. Also assert the do-not-regress case: A's own
      next call while A is OPEN is short-circuited. _(Spec C1-R4, `[MB]`.)_
      LXC: single file, heap-capped, `timeout`.

- [x] **C1a-3 [SEQ after C1a-1, C1a-2] [MB]** GREEN — implement the STATE partition in
      `circuitBreaker.ts`: key the `breakers` Map (L124) by `service:operation:<discriminant>`
      inside `getOrCreateBreaker` (L239) and `call` (L418); add the insertion-ordered LRU
      eviction on `breakers` bounded by `BREAKERS_MAX_ENTRIES` (evict oldest on overflow; on hit,
      refresh recency by re-insert). Make C1a-2 pass while keeping the failing-tenant-still-opens
      case green. _(Spec C1-R4.)_ Same commit as C1a-2.

- [x] **C1a-4 [P]** RED — write the cache-isolation anchor test in
      `packages/providers/facebook/tests/*.test.ts` (vitest): account A calls
      `facebook validate-credentials` (currently `cacheEnabled:true`, returns A's Page
      `access_token`); account B calls the same op within TTL with B's own credentials; assert B's
      response is derived from B and does NOT contain A's `access_token` → FAILS today (constant
      key `service:operation:W10=` serves A's payload to B). _(Spec C1-R1 anchor, `[MB]`.)_
      LXC: single file, heap-capped, `timeout`.

- [x] **C1a-4b [P]** RED — fail-safe-default cache test in
      `packages/adapters/external-apis/tests/*.test.ts` (vitest): a `cacheEnabled:true` op invoked
      through the breaker with **NO** `cacheKeyDiscriminant`; tenant A calls it (populates cache
      today), then tenant B calls the same op within TTL with a different credential context and no
      discriminant; assert (a) the underlying fn IS invoked for B (B fetches fresh, not
      short-circuited from A's cache) and (b) the breaker stored no shared entry a later
      different-tenant call could hit. FAILS today (constant key `service:operation:W10=` serves A's
      payload to B). _(Spec C1-R1b fail-safe default, `[MB]`.)_ LXC: single file, heap-capped,
      `timeout`.

- [x] **C1a-5 [SEQ after C1a-4, C1a-4b] [MB]** GREEN (mechanism half) — implement in `circuitBreaker.ts`:
      (a) export `hashCallScope(credential: unknown, ...publicParams: unknown[]): string`
      (`createHash('sha256')` → hex, first 16 chars; folds the credential + public params; raw
      secret NEVER used directly as a key); (b) add optional `cacheKeyDiscriminant?: string` to
      the `call(...)` options type; (c) **fail-safe default (Design D1b):** when
      `cacheKeyDiscriminant` is PRESENT, fold it into `generateCacheKey` (L318) → produce
      `service:operation:<discriminant>` (replacing the useless `base64([])` segment; keep the
      `service:operation:` prefix so `clearCache` (L704) prefix-purge and `getCacheStats` (L720)
      stay intact); when it is ABSENT, the breaker MUST NOT read or write L1 for that call — treat
      it as a cache miss, invoke the underlying fn, and store nothing shared (NO constant-key
      fallback). This is what closes the disclosure leak for every un-migrated site at once; (d) add
      the insertion-ordered LRU eviction on the `cache` Map (L125) bounded by `CACHE_MAX_ENTRIES`,
      no timer. Makes both C1a-4 and C1a-4b pass. _(Spec C1-R1 + C1-R1b.)_

- [x] **C1a-6 [SEQ after C1a-5] [MB]** GREEN (secret half) — in
      `packages/providers/facebook/src/apiClient.ts` flip `validate-credentials`
      (L347-356) to `cacheEnabled: false` (defense-in-depth: removes the token from process
      memory entirely) AND pass a `cacheKeyDiscriminant` computed via `hashCallScope(this.credentials)`
      for consistency. Make C1a-4 pass. _(Spec C1-R1 anchor + C1-R2 `secret` bucket.)_ Same commit
      as C1a-4.

- [x] **C1a-7 [P]** Same-tenant no-perf-regression test in
      `packages/adapters/external-apis/tests/*.test.ts` (vitest): account A calls a
      `cacheEnabled:true` op twice with identical creds+params within TTL → 2nd call served from
      cache; served payload is A's own. GREEN after C1a-5. _(Spec C1-R1 same-account scenario.)_

- [x] **C1a-8 [P]** LRU-eviction unit tests in
      `packages/adapters/external-apis/tests/*.test.ts` (vitest): (a) inserting > cap evicts the
      least-recently-used entry for both `cache` and `breakers`; (b) an actively-touched (failing)
      tenant's breaker is NOT evicted while idle tenants are; (c) no timer / no `setInterval`
      introduced (assert Fitness #11 stays clean). _(Design D2 rationale.)_

- [x] **C1a-9 [SEQ after C1a-5]** Re-export `hashCallScope` from
      `packages/adapters/external-apis/src/index.ts` (barrel; add/keep `@file` JSDoc). _(Design
      File Changes.)_

- [x] **C1a-10 [P]** Do-not-regress: write-path fail-fast assertion test proving
      `DEFAULT_EXTERNAL_API_OPTIONS.fallbackEnabled` stays `false` (L59 block) and no write-verb
      op sets `fallbackEnabled:true` → Fitness #25 Part A and Part B both `0`. _(Spec C1-R5, `[MB]`.)_

- [x] **C1a-11 [P]** JSDoc pass on every file touched in C1a (`circuitBreaker.ts`, `index.ts`,
      `facebook/apiClient.ts`, new test files): `@file/@description/@layer infrastructure`,
      `@method`/`@param`/`@returns` on `hashCallScope` and any new method. Zero `any`.

#### C1a — C-1 remediation: L2 fallback store tenant-scoping (Design D1c)

Closes the SECOND cross-tenant cache vector caught by the adversarial verify gate: the
`fallbackEnabled: true` L2 Redis fallback store keyed `fallback:service:operation` with NO
tenant discriminant, so on a provider failure tenant A's cached PII payload was served to
tenant B (~40 `cacheEnabled:true` reads opt in via `ANALYTICS_CB_OPTIONS` / `METADATA_CB_OPTIONS`).
Threads the SAME opaque `cacheKeyDiscriminant` already flowing through `call()` into both the L2
write and read paths, with fail-safe symmetry (no discriminant ⇒ no write, read-miss).

- [x] **C1a-12 [MB]** Amend the contract: add design **D1c** (L2 fallback store is tenant-scoped
      and fail-safe; old un-scoped entries expire by TTL, no migration) and a spec ADDED requirement
      **"Fallback (L2) cache is tenant-scoped and fail-safe" [MERGE-BLOCKING]** with the tenant-B and
      discriminant-less Given/When/Then scenarios. Correct the earlier text implying L1 was the only
      cache. _(design.md, specs/circuit-breaker-isolation/spec.md.)_

- [x] **C1a-13 [MB]** RED — fallback-store isolation tests in
      `packages/adapters/fallback-strategies/tests/fallbackTenantIsolation.test.ts` (vitest, in-memory
      Redis double): (a) tenant B never served tenant A's fallback payload when each carries its own
      discriminant; (b) discriminant-less write stores nothing shared and discriminant-less read is a
      miss even when a legacy un-scoped key exists; (c) same-tenant hit preserved; (d) `fallback:`
      prefix retained for enumeration/clear. FAILS on the un-scoped `fallback:service:operation` key.
      LXC: single file, heap-capped, `timeout`.

- [x] **C1a-14 [SEQ after C1a-13] [MB]** GREEN — in
      `packages/adapters/fallback-strategies/src/index.ts`: thread `discriminant?: string` through
      `cacheSuccessfulResponse`, `getCachedResponse`, and the private `getCacheKey` builder → key
      `fallback:${service}:${operation}:${discriminant}` (keep the `fallback:` prefix); add
      `discriminant?` to `FallbackContext`. Fail-safe symmetry: no discriminant ⇒ `cacheSuccessfulResponse`
      does NOT write and `getCachedResponse` returns a miss (no shared/legacy-key read). Makes C1a-13
      GREEN. _(Design D1c.)_

- [x] **C1a-15 [SEQ after C1a-14] [MB]** GREEN — in
      `packages/adapters/external-apis/src/circuitBreaker.ts`: pass `options.cacheKeyDiscriminant`
      into `cacheSuccessfulResponse` (~:601, write) and onto the `executeFallback` `FallbackContext`
      (~:645, read, conditional spread for `exactOptionalPropertyTypes`). Reuse the SAME discriminant
      already threaded for L1 + STATE. Add breaker-level wiring tests in
      `tests/unit/circuitBreaker.fallback.test.ts` (discriminant → 5th arg of `cacheSuccessfulResponse`;
      discriminant → `context.discriminant`; no discriminant ⇒ 5th arg undefined). _(Design D1c.)_

- [x] **C1a-16 [P]** Align the two existing `fallback-strategies/tests/index.test.ts` CACHED_RESPONSE
      tests to the new canonical contract (supply a discriminant on write + read) — contract alignment,
      not a mask. JSDoc/`@layer` intact; zero `any`; Fitness #25 A/B, #11, #9 stay 0.

### Slice C1b — the ~59 per-site discriminant edits + full audit table

**Performance restoration + audit — NOT leak-closure.** The cross-tenant disclosure leak is
ALREADY closed by C1a's fail-safe default; until a site is migrated here it simply skips its
cache (correct but cold). These mechanical one-line-per-site edits supply each remaining
`cacheEnabled:true` operation's `cacheKeyDiscriminant`, RE-ENABLING its L1 cache keyed per
tenant, and produce the full audit table (Spec C1-R2). The per-provider isolation tests here are
belt-and-suspenders confirmation that the re-enabled per-site cache stays tenant-scoped (Spec
C1-R1 scenario 3 + C1-R2). Grouped by provider so each group is a work-unit commit.

- [ ] **C1b-1** Produce the **61-site audit classification table** deliverable (Spec C1-R2).
      Confirm the enumeration below with
      `rg "cacheEnabled:\s*true" packages/providers packages/adapters --type ts -g '!**/tests/**'`
      (expected N = **61**: 59 provider + 2 adapter). Classify each into exactly one of
      `secret` / `PII` / `benign`. Every `secret`/`PII` site must be linked to an isolation test
      (the anchors in C1a cover the demonstrated cases; representative per-provider isolation
      tests below cover the rest). Table skeleton (apply confirms/adjusts each bucket):

  | File                                           | Lines                   | Op family                                   | Bucket (preliminary)              |
  | ---------------------------------------------- | ----------------------- | ------------------------------------------- | --------------------------------- |
  | providers/facebook/src/apiClient.ts            | 355                     | validate-credentials                        | **secret** (flipped false in C1a) |
  | providers/facebook/src/apiClient.ts            | 591                     | page insights/analytics                     | PII                               |
  | providers/x/src/apiClient.ts                   | 142,306,392,468         | profile/timeline/tweet reads                | PII                               |
  | providers/youtube/src/apiClient.ts             | 138,256,317,383,535,632 | channel/video reads                         | PII + benign (public by id)       |
  | providers/youtube/src/communityFeatures.ts     | 180,214,484             | community reads                             | PII                               |
  | providers/youtube/src/liveStreaming.ts         | 580,639                 | broadcast reads                             | PII                               |
  | providers/youtube/src/shorts.ts                | 228,311,389,458         | shorts reads                                | PII                               |
  | providers/youtube/src/analytics.ts             | 196,270,332,388         | analytics reads                             | PII                               |
  | providers/youtube/src/playlistManager.ts       | 233,270,436             | playlist reads                              | PII                               |
  | providers/tiktok/src/apiClient.ts              | 232,442                 | profile/video reads                         | PII                               |
  | providers/tiktok/src/researchApiClient.ts      | 185,255,325,389,455,540 | research reads                              | PII/benign                        |
  | providers/tiktok/src/hashtagManager.ts         | 123,184,292,387         | hashtag reads                               | benign (public by id)             |
  | providers/tiktok/src/videoProcessor.ts         | 134                     | video meta read                             | PII                               |
  | providers/tiktok/src/authService.ts            | 343                     | user-info read (NOT token/refresh)          | **PII — verify not a secret**     |
  | providers/tiktok/src/marketingApiClient.ts     | 204,278,386,505,589     | marketing reads                             | PII                               |
  | providers/tiktok/src/contentAnalyticsClient.ts | 333,448,541,630         | content analytics                           | PII                               |
  | providers/telegram/src/apiClient.ts            | 219,246,629             | chat/message reads                          | PII                               |
  | providers/snapchat/src/apiClient.ts            | 83,264                  | profile/insight reads                       | PII                               |
  | providers/linkedin/src/apiClient.ts            | 107,245,321             | getProfile / getComments / getPostAnalytics | PII (see C1b-9)                   |
  | adapters/storage-s3/src/index.ts               | 201                     | object-metadata read                        | PII (credential-scoped)           |
  | adapters/storage-cloudinary/src/index.ts       | 192                     | asset-metadata read                         | PII (credential-scoped)           |

- [ ] **C1b-2 [P]** facebook — add `cacheKeyDiscriminant` to the remaining `cacheEnabled:true`
      site (591 page-insights, fold `hashCallScope(this.credentials)`; add resource id to
      `publicParams` if the op is resource-scoped). _(Spec C1-R1.)_

- [ ] **C1b-3 [P]** x — 4 sites (142,306,392,468): each gets
      `cacheKeyDiscriminant: hashCallScope(this.credentials, ...resourceIds)`. _(Spec C1-R1.)_

- [ ] **C1b-4 [P]** youtube — 22 sites across apiClient/communityFeatures/liveStreaming/
      shorts/analytics/playlistManager. Public-metadata-by-id reads MUST pass the public
      resource id in `...publicParams` (today's constant key corrupts them — video X served for
      video Y); credential hash still folded by default so no site is accidentally tenant-shared.
      _(Spec C1-R1 + Design D1 public-reference note.)_

- [ ] **C1b-5 [P]** tiktok — 23 sites across apiClient/researchApiClient/hashtagManager/
      videoProcessor/authService/marketingApiClient/contentAnalyticsClient. **Verify
      `authService.ts:343` is a user-info READ, not token/refresh** (token/refresh stay
      `cacheEnabled:false` — do-not-regress). `videoProcessor` already uses the `createHash`
      pattern — reuse it. _(Spec C1-R1 + C1-R3.)_

- [ ] **C1b-6 [P]** telegram — 3 sites (219,246,629). _(Spec C1-R1.)_

- [ ] **C1b-7 [P]** snapchat — 2 sites (83,264). Do-not-regress: snapchat refresh-token op
      stays `cacheEnabled:false`. _(Spec C1-R1 + C1-R3.)_

- [ ] **C1b-8 [P]** adapters — storage-s3 (201) + storage-cloudinary (192): fold the storage
      credential + object/asset key into the discriminant (these are credential-scoped metadata
      reads, not public). _(Spec C1-R1; resolves Design Open Question — 2 non-provider sites exist.)_

- [ ] **C1b-9 [P]** linkedin — 3 sites (107,245,321). **Record the D4 decision in the audit
      (Spec C1-R2 flag-and-decide scenario):** the proposal's "write-op caching at
      107/245/321" is a MISCLASSIFICATION — they are reads (`getProfile` GET, `getComments` GET,
      `getPostAnalytics` GET); the real write `postComment` (:258) is correctly
      `cacheEnabled:false` (:282). Decision = fix-here-as-reads (no defer): apply the discriminant
      (`getProfile` → identity/PII; `getComments`/`getPostAnalytics` → PII + fold `postUrn` into
      `publicParams`). _(Spec C1-R2.)_

- [ ] **C1b-10 [P]** Representative per-provider cross-account isolation tests for the
      `secret`/`PII` buckets not already anchored in C1a (Spec C1-R2 "secret and PII sites are
      anchored"): at minimum one isolation test per provider proving tenant B never receives
      tenant A's cached payload. vitest package tests, LXC single-file/heap-capped/`timeout`.

- [ ] **C1b-11 [P]** Do-not-regress assertions that the correctly-uncached ops STAY
      `cacheEnabled:false`: tiktok authService token/refresh, snapchat refresh-token, facebook
      `upload-media` (L425) and `post-to-page` (L505). _(Spec C1-R3.)_

- [ ] **C1b-12 [SEQ after C1b-2..C1b-9]** Re-run the enumeration grep and confirm the final
      count of `cacheEnabled:true` sites now each carry a `cacheKeyDiscriminant` (or are flipped
      to `false`); zero site left on the constant key. JSDoc/`@layer` intact on every edited file;
      zero `any`.

---

## PR#2 — C2: Client-IP forwarding & rate-limit keying (N-SEC-2)

Independent of C1 (header-only; no shared file). Ships after PR#1b in the stack (C1a → C1b → C2).

- [ ] **C2-1 [MB]** RED — `resolveClientIp` distinct-bucket + spoof-resistance unit tests in
      `apps/api/tests/unit/*.test.ts` (vitest) against crafted `X-Forwarded-For` chains:
      (a) two distinct real client IPs → two distinct bucket keys; (b) attacker-controlled
      leftmost XFF entry is IGNORED — key is taken from `chain[len − TRUSTED_PROXY_HOP_COUNT]`;
      (c) rotating the leftmost entry does NOT yield fresh buckets. With the current keying these
      assertions on the crafted chains must be RED where they encode the post-relay topology.
      _(Spec C2-R1 + C2-R2, `[MB]`.)_ LXC: single file, heap-capped, `timeout`.

- [ ] **C2-2 [P]** RED — per-app `forwardedForHeaders` helper unit tests in
      `apps/client/lib/http/*.test.ts` and `apps/admin/lib/http/*.test.ts` (vitest): given inbound
      `Headers`, returns `{ 'x-forwarded-for': <value> }` from `x-forwarded-for`, else falls back
      to `x-real-ip`, else returns `{}` (no header → no regression). FAILS before the helper exists.
      _(Spec C2-R3, contract in Design Interfaces.)_

- [ ] **C2-3 [SEQ after C2-2]** GREEN — create the identical pure helper at
      `apps/client/lib/http/forwardedFor.ts` and `apps/admin/lib/http/forwardedFor.ts`:
      `export function forwardedForHeaders(inbound: Headers): Record<string, string>`. RELAY (copy
      inbound `x-forwarded-for`/`x-real-ip`), do NOT append. Extensionless `bundler` imports only
      (Fitness #26 — NO `.js` on `.ts` in Next dirs). JSDoc `@file/@description/@layer infrastructure`.
      Zero `any`. Makes C2-2 pass. _(Spec C2-R3 + Design D3.)_

- [ ] **C2-4 [SEQ after C2-3] [MB]** GREEN — wire the helper into the 4 egress surfaces (5 files),
      copying its result onto the outbound `fetch` headers:
      `apps/client/app/api/backend/[...path]/route.ts`,
      `apps/admin/app/api/backend/[...path]/route.ts`,
      `apps/admin/app/api/auth/refresh/route.ts`,
      `apps/client/app/actions/auth.ts`,
      `apps/admin/lib/auth/backend-client.ts`. Route handlers read `NextRequest.headers`; server
      actions read `next/headers` `headers()`. _(Spec C2-R1 + C2-R3.)_

- [ ] **C2-5 [SEQ after C2-1]** GREEN — align keying/topology so
      `resolveClientIp` (`apps/api/src/security/httpRateLimitPreHandler.ts:159`) selects
      `chain[len − TRUSTED_PROXY_HOP_COUNT]` for the relayed chain and NOT the Next
      `socket.remoteAddress`. Because C2 RELAYS (does not append), the hop count does NOT increase —
      verify no code change to the selection is needed beyond the crafted-chain tests passing; if a
      fix is required, keep it within `resolveClientIp`. Makes C2-1 GREEN. _(Spec C2-R1 + C2-R2.)_

- [ ] **C2-6 [SEQ after C2-4]** Cross-egress + per-user-refresh integration test in
      `apps/api/tests/integration/*.test.ts` (node:test): each of the 4 egress points forwards the
      inbound IP; >4 concurrent users through the admin refresh route are bucketed per-IP and one
      user exhausting the limit does NOT log another user out. _(Spec C2-R3 session-refresh scenario.)_
      LXC: single file, `timeout`.

- [ ] **C2-7 [P]** Doc-only clarification in `apps/api/src/config/env.ts` at
      `TRUSTED_PROXY_HOP_COUNT` (L250): document = number of trusted proxies IN FRONT OF Next
      (relay model, no `+1`); reference the Design D3 hop-topology table (direct dev = 1,
      single trusted edge = 1, edge+LB = 2). No schema/value change (`min(1)`, default `1`). _(Spec C2-R2.)_

- [ ] **C2-8 [P] [MB]** Do-not-regress assertions: `RateLimitConfigs.AUTH` stays 5 req / 15 min;
      no second HTTP limiter / no `config:{rateLimit}` route-config introduced (Fitness #28 = 0);
      limiter stays fail-open with the `threat_type: "http_rate_limit_failopen"` WARN preserved.
      _(Spec C2-R4.)_

- [ ] **C2-9 [P]** JSDoc/`@layer` pass on every C2 file (2 helpers + 5 egress + env doc + tests);
      zero `any`; Fitness #26 clean (no `.js`-on-`.ts` in Next dirs).

---

## Resolved design open questions

1. **LRU cap value(s) (`cache`/`breakers`) — const vs env, starting number.**
   RECOMMENDATION: named **consts** in `circuitBreaker.ts` — `CACHE_MAX_ENTRIES = 5000`,
   `BREAKERS_MAX_ENTRIES = 2000`. Rationale: these are internal memory-safety bounds, not
   per-deploy ops knobs; adding env vars would touch `env.ts` (Zod) surface for no operational
   benefit. Cache entries are small/medium JSON payloads with a 5-min TTL (self-expiring), so
   5000 bounds the worst-case burst of distinct (op, tenant) keys; opossum breaker instances
   are heavier (event emitters + rolling stats windows), so a lower 2000 cap is deliberate.
   Idle-tenant eviction is harmless (a re-created breaker starts CLOSED); an actively-failing
   tenant is continuously touched and stays resident via LRU recency. Promote to env only via
   an ADR if real multi-thousand-tenant scale demands tuning.

2. **Final N of `cacheEnabled:true` sites / non-provider adapter sites.**
   Enumeration confirms **N = 61 production sites** = **59 provider + 2 adapter**. The 2
   adapter sites (`storage-s3/src/index.ts:201`, `storage-cloudinary/src/index.ts:192`) answer
   the open question: YES, non-provider `packages/adapters` sites exist and are folded into the
   audit + C1b-8. (Grep also matches 9 test occurrences → 70 total; production-only = 61.)

---

## Review Workload Forecast (MANDATORY — read by the Review Workload Guard)

| Slice           | Scope                                                                                                                                                                                                                               | Est. changed lines | Independently shippable                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------- |
| **C1a (PR#1a)** | breaker core (helper + option + fail-safe skip in `generateCacheKey` + `getOrCreateBreaker` STATE key + 2 LRU caps) + `index.ts` + fb secret flip + 6 test files (STATE, fb anchor, fail-safe default, same-tenant, LRU, fail-fast) | **~300–390**       | **Yes — closes the cross-tenant disclosure leak for ALL ~61 sites via the fail-safe default** |
| **C1b (PR#1b)** | ~59 one-line per-site `cacheKeyDiscriminant` edits across ~20 files + 61-site audit table + per-provider isolation tests                                                                                                            | **~260–360**       | Yes — perf restoration on top of C1a (targets the C1a branch)                                 |
| **C2 (PR#2)**   | 2 helpers + 5 egress files + env doc + 3 test files                                                                                                                                                                                 | **~180–260**       | Yes — header-only (targets the C1b branch)                                                    |

- **Chained PRs recommended: Yes** — `stacked-to-main`, three PRs: **C1a → C1b → C2** (PR#1b
  targets the C1a branch, PR#2 the C1b branch).
- **400-line budget risk: Low** — each PR is ≤ ~400: C1a ~300–390, C1b ~260–360, C2 ~180–260.
  If C1a's test files push it toward the ceiling, the LRU-eviction tests (C1a-8) may move to C1b
  without weakening the security posture (the leak is closed by the fail-safe default in C1a-5
  regardless).
- **Decision needed before apply: No.** RESOLVED: split C1 into two stacked PRs (C1a → C1b),
  enabled by the fail-safe cache default (Design D1b) — un-migrated sites fail safe, so C1a
  closes the leak with no cross-tenant window and no `size:exception` is required. `chain_strategy`
  stays `stacked-to-main`. Pass to `sdd-apply`: implement C1a first (leak-closure slice), then C1b
  (perf restoration), then C2; each a separate stacked PR, no exception.
- **Why the split is now SAFE (supersedes the earlier single-PR recommendation):** the earlier
  forecast recommended one atomic C1 PR with `size:exception` because a C1a-only merge would
  leave ~58 sites cross-tenant leaking until C1b. The fail-safe default removes that CON entirely
  — a discriminant-less site stops caching rather than sharing, so C1a fully satisfies the
  MERGE-BLOCKING isolation invariant (Spec C1-R1 + C1-R1b) for every site the instant it merges;
  C1b then only restores performance. No security window exists between the stacked PRs.
- **Per-PR review budget (`additions + deletions`):** all three within the 400 budget (C1a
  ~300–390, C1b ~260–360, C2 ~180–260); no `size:exception` needed on any PR. Each keeps tests
  with the code they verify.
- **Verification per PR:** C1a — vitest package tests single-file/heap-capped/`timeout` (STATE,
  fb anchor, and fail-safe-default tests all GREEN) + Fitness #11/#25 = 0. C1b — per-provider
  isolation vitest + the enumeration grep confirms every site migrated + Fitness #25 = 0. C2 —
  vitest unit + node:test integration single-file/`timeout` + Fitness #26/#28 = 0, AUTH 5/15min,
  fail-open WARN preserved.

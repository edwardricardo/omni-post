# C1b Audit — every `cacheEnabled: true` circuit-breaker site

> Change: `cross-tenant-criticals` · Slice C1b · Spec requirement **"Every `cacheEnabled`
> site is audited, classified, and covered"**.
>
> **Enumeration:** `rg "cacheEnabled:\s*true" packages/providers packages/adapters --type ts -g '!**/tests/**'`
> → **60 production sites** (59 provider + 1 adapter-family × 2 = 2 adapter... see reconciliation).
> Grep also matches test occurrences, excluded here.
>
> **Reconciliation with the tasks.md N = 61.** The tasks forecast counted **61** (59 provider +
> 2 adapter) BEFORE slice C1a. C1a flipped `facebook validate-credentials` from `cacheEnabled:true`
> to `cacheEnabled:false` (secret-payload class — the response embeds the Page `access_token`), so
> it is no longer a `cacheEnabled:true` site. **61 − 1 = 60** remaining `cacheEnabled:true` reads.
> `facebook validate-credentials` still carries a `cacheKeyDiscriminant` (for STATE) and appears in
> the "secret / do-not-regress" section below, not in the read table.
>
> **Classification buckets** (exactly one per site):
>
> - `secret` — response embeds a credential/token → must be `cacheEnabled:false` **+** discriminant.
> - `PII` — account/user-scoped data (profiles, comments, analytics, private metadata) → cache **+**
>   credential-scoped discriminant.
> - `benign` — public resource by id (public metadata/search) → cache **+** credential hash AND the
>   public resource id folded into `publicParams` so distinct resources never collide.
>
> **Status legend:** `migrated (C1b-b1)` = discriminant applied in batch 1, typechecked ·
> `migrated (C1b-b2)` = discriminant applied in batch 2 (this batch), typechecked + tests GREEN ·
> `secret-flipped (C1a)` = flipped to `cacheEnabled:false` in C1a.
>
> **Batch-2 closure (this batch):** all 48 previously-pending sites now carry a
> `cacheKeyDiscriminant`. **Every one of the 60 `cacheEnabled:true` read sites is migrated** and
> every provider write op additionally carries a STATE-only discriminant (W-1/D2b). A latent
> correctness hazard was confirmed and closed during batch 2: because the process-singleton breaker
> binds the FIRST caller's closure per `service:operation` key (args are `[]`, real params live in
> the closure), ANY discriminant-less op shared across tenants ran the first caller's closure —
> so tenant B received tenant A's payload even where L1 was skipped. Folding the discriminant gives
> each (tenant, resource) its own breaker instance, closing this on reads AND writes AND token ops.
>
> **Isolation-test coverage.** The MERGE-BLOCKING cross-tenant isolation invariant is proven at the
> breaker level for ANY provider by `circuitBreakerTenantIsolation.test.ts` (cross-tenant cache
> isolation + fail-safe default) and `circuitBreakerC1bHardening.test.ts` (write-STATE, S-2, W-2),
> plus two end-to-end provider anchors: `FacebookApiClient.cacheIsolation.test.ts` (C1a, secret
> class) and `SnapchatApiClient.cacheIsolation.test.ts` (C1b, PII read). Additional per-provider
> end-to-end anchors for x / linkedin / telegram / tiktok / youtube are scheduled in batch 2
> (C1b-10); they are belt-and-suspenders over the breaker-level proof, not new requirements.

---

## Read sites (60) — `cacheEnabled: true`

### Migrated in this batch (C1b batch 1) — 12 sites

| #   | File                                     | Operation              | Bucket                                 | Discriminant                                                                                                                   | Status            | Test                                                |
| --- | ---------------------------------------- | ---------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------- | --------------------------------------------------- |
| 1   | providers/facebook/src/apiClient.ts      | `get-page-insights`    | PII                                    | `hashCallScope(this.credentials, since?.getTime(), until?.getTime())` — folds the time window so distinct ranges never collide | migrated (C1b-b1) | breaker-level iso                                   |
| 2   | providers/x/src/apiClient.ts             | `validate-credentials` | PII                                    | `hashCallScope(this.credentials)`                                                                                              | migrated (C1b-b1) | breaker-level iso                                   |
| 3   | providers/x/src/apiClient.ts             | `get-analytics`        | PII                                    | `hashCallScope(this.credentials, tweetIds)`                                                                                    | migrated (C1b-b1) | breaker-level iso                                   |
| 4   | providers/x/src/apiClient.ts             | `search-replies`       | benign (by tweetId)                    | `hashCallScope(this.credentials, tweetId)`                                                                                     | migrated (C1b-b1) | breaker-level iso                                   |
| 5   | providers/x/src/apiClient.ts             | `search-mentions`      | benign (by terms)                      | `hashCallScope(this.credentials, terms)`                                                                                       | migrated (C1b-b1) | breaker-level iso                                   |
| 6   | providers/snapchat/src/apiClient.ts      | `validate-credentials` | PII                                    | `hashCallScope(this.credentials)`                                                                                              | migrated (C1b-b1) | `SnapchatApiClient.cacheIsolation.test.ts` (anchor) |
| 7   | providers/snapchat/src/apiClient.ts      | `get-analytics`        | PII (by creativeId)                    | `hashCallScope(this.credentials, creativeId)`                                                                                  | migrated (C1b-b1) | breaker-level iso                                   |
| 8   | providers/linkedin/src/apiClient.ts      | `get-profile`          | PII (D4)                               | `hashCallScope(this.credentials)`                                                                                              | migrated (C1b-b1) | breaker-level iso                                   |
| 9   | providers/linkedin/src/apiClient.ts      | `get-comments`         | PII (by postUrn, D4)                   | `hashCallScope(this.credentials, postUrn)`                                                                                     | migrated (C1b-b1) | breaker-level iso                                   |
| 10  | providers/linkedin/src/apiClient.ts      | `get-analytics`        | PII (by postUrn, D4)                   | `hashCallScope(this.credentials, postUrn)`                                                                                     | migrated (C1b-b1) | breaker-level iso                                   |
| 11  | adapters/storage-s3/src/index.ts         | `get-metadata`         | PII (credential-scoped, by object key) | `hashCallScope(config, key)`                                                                                                   | migrated (C1b-b1) | breaker-level iso                                   |
| 12  | adapters/storage-cloudinary/src/index.ts | `get-metadata`         | PII (credential-scoped, by publicId)   | `hashCallScope(config, publicId)`                                                                                              | migrated (C1b-b1) | breaker-level iso                                   |

### Migrated in batch 2 (C1b-b2) — 48 sites

> All migrated + typechecked; anchored end-to-end for the highest-value PII sites (telegram
> validate/get-chat-member, tiktok get-user-profile, youtube get-video-details X≠Y AND A≠B) and
> covered breaker-level for the rest. Sub-service reads (youtube community/live/shorts/analytics/
> playlists) scope by `this.channelId` (the per-tenant identifier retained by those services) plus
> the public resource id; the apiClient's own reads scope by the full `this.credentials`.

**telegram** (`providers/telegram/src/apiClient.ts`):

| #   | Operation                      | Bucket             | Discriminant                                           | Status            | Test                                                |
| --- | ------------------------------ | ------------------ | ------------------------------------------------------ | ----------------- | --------------------------------------------------- |
| 13  | `validate-credentials` (getMe) | PII                | `hashCallScope(this.botToken)`                         | migrated (C1b-b2) | `TelegramApiClient.cacheIsolation.test.ts` (anchor) |
| 14  | `get-chat-member`              | PII (by botUserId) | `hashCallScope(this.botToken, this.chatId, botUserId)` | migrated (C1b-b2) | `TelegramApiClient.cacheIsolation.test.ts` (anchor) |
| 15  | `get-chat-member-count`        | PII                | `hashCallScope(this.botToken, this.chatId)`            | migrated (C1b-b2) | breaker-level iso                                   |

**tiktok** — read scope `hashCallScope(this.credentials|accessToken, …)`:

| #     | File                      | Operation                        | Bucket                                            | Discriminant                                                                            | Status                                                                |
| ----- | ------------------------- | -------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------- | ----------------- |
| 16    | apiClient.ts              | `validate-credentials` (profile) | PII                                               | `hashCallScope(this.credentials)`                                                       | migrated (C1b-b2)                                                     |
| 17    | apiClient.ts              | `get-user-videos`                | PII (paged)                                       | `hashCallScope(this.credentials, cursor, maxCount)`                                     | migrated (C1b-b2)                                                     |
| 18    | authService.ts            | `get-user-profile`               | **PII — VERIFIED user-info read, NOT a token op** | `hashCallScope(accessToken, includeStats, includeBusiness)`                             | migrated (C1b-b2) · anchor `TikTokAuthService.cacheIsolation.test.ts` |
| 19–24 | researchApiClient.ts      | 6 research reads                 | PII/benign                                        | `hashCallScope(this.credentials, [keywords,] options)`                                  | migrated (C1b-b2)                                                     |
| 25–28 | hashtagManager.ts         | 4 hashtag reads                  | benign (public)                                   | `hashCallScope(researchClient.getCredentialScope(), <resource/options>)` (NEW accessor) | migrated (C1b-b2)                                                     |
| 29    | videoProcessor.ts         | `analyze-video`                  | resource (by file path)                           | `hashCallScope(filePath)` — closes the "video X analysed as Y" closure bug              | migrated (C1b-b2)                                                     |
| 30–34 | marketingApiClient.ts     | 5 marketing reads                | PII                                               | `hashCallScope(this.credentials, [filtering                                             | options])`                                                            | migrated (C1b-b2)    |
| 35–38 | contentAnalyticsClient.ts | 4 content-analytics reads        | PII                                               | `hashCallScope(this.credentials, <videoId                                               | competitors                                                           | hashtags>, options)` | migrated (C1b-b2) |

**youtube** — apiClient reads scope by `this.credentials`; sub-services by `this.channelId`. PUBLIC-by-id reads fold the resource id (closes the constant-key "video X served for video Y" bug):

| #     | File                 | Operations                                                                                                           | Bucket                      | Discriminant                                             | Status            |
| ----- | -------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------- | ----------------- | ----------------- | ------------- | -------------------------------------------------------------------------------- |
| 39–44 | apiClient.ts         | validate-credentials, get-channel-analytics, get-video-details, search-videos, get-channel-stats, get-video-comments | PII + benign (public by id) | `hashCallScope(this.credentials, <videoId                | query             | window            | …>)`          | migrated (C1b-b2) · anchor `YouTubeApiClient.cacheIsolation.test.ts` (X≠Y + A≠B) |
| 45–47 | communityFeatures.ts | get-video-comments, get-channel-comments, get-metrics                                                                | PII                         | `hashCallScope(this.channelId, <videoId                  | params>)`         | migrated (C1b-b2) |
| 48–49 | liveStreaming.ts     | get-stream-analytics, list-streams                                                                                   | PII                         | `hashCallScope(this.channelId, <streamId                 | status>)`         | migrated (C1b-b2) |
| 50–53 | shorts.ts            | get-analytics, get-optimization-suggestions, get-trending, get-channel-shorts                                        | PII/benign                  | `hashCallScope(this.channelId, <videoId                  | inputs            | region            | maxResults>)` | migrated (C1b-b2)                                                                |
| 54–57 | analytics.ts         | get-video-metrics, get-audience-insights, get-optimization-suggestions, get-performance-insights                     | PII                         | `hashCallScope(this.channelId, <videoId,>window/inputs)` | migrated (C1b-b2) |
| 58–60 | playlistManager.ts   | get-channel-playlists, get-playlist, get-playlist-items                                                              | PII + benign (public by id) | `hashCallScope(this.channelId, <playlistId,>maxResults)` | migrated (C1b-b2) |

**pinterest / instagram** — single generic `makeRequest(operation, url, …)` wrapper; the discriminant
folds `hashCallScope(this.credentials, operation, url)` at that one site, so the credential + op +
resource-bearing URL scope EVERY pinterest/instagram op (reads `get-user-account` / `validate-token`
stay per-tenant cached; all writes get STATE-only partition). Instagram's separate `media-upload:upload`
S3 call folds `hashCallScope(this.credentials, mediaType, byteLength)`. These use computed
`cacheEnabled: operation === …` so they are NOT part of the 60 literal `cacheEnabled:true` count, but
are migrated for the closure/STATE isolation. Migrated (C1b-b2).

---

## Write / secret sites — `cacheEnabled: false` (must NOT regress to cached)

These stay `cacheEnabled: false`. In C1b they receive a `cacheKeyDiscriminant` **only to partition
circuit STATE per tenant (W-1)** — no cache entry is ever created (Fitness #25 posture intact).

### Migrated write-STATE in this batch (C1b batch 1)

| File                                     | Operation(s)                                                                                                           | Class                                                                  | STATE discriminant                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------- |
| providers/facebook/src/apiClient.ts      | `validate-credentials`                                                                                                 | **secret** (flipped false in C1a; response embeds Page `access_token`) | `hashCallScope(this.credentials)` |
| providers/facebook/src/apiClient.ts      | `upload-media`, `post-to-page`                                                                                         | write (do-not-regress)                                                 | `hashCallScope(this.credentials)` |
| providers/x/src/apiClient.ts             | `post-tweet`, `upload-media`, `delete-tweet`                                                                           | write                                                                  | `hashCallScope(this.credentials)` |
| providers/snapchat/src/apiClient.ts      | `upload-media`, `create-story`                                                                                         | write                                                                  | `hashCallScope(this.credentials)` |
| providers/snapchat/src/apiClient.ts      | `refresh-token`                                                                                                        | **secret/token (do-not-regress)** — stays uncached                     | `hashCallScope(this.credentials)` |
| providers/linkedin/src/apiClient.ts      | `create-post`, `post-comment`, `upload-media-binary`, `init-image-upload`, `init-video-upload`, `init-document-upload` | write                                                                  | `hashCallScope(this.credentials)` |
| adapters/storage-s3/src/index.ts         | `generate-upload-signature`                                                                                            | write                                                                  | `hashCallScope(config)`           |
| adapters/storage-cloudinary/src/index.ts | `generate-upload-signature`                                                                                            | write                                                                  | `hashCallScope(config)`           |

### Do-not-regress uncached ops — confirmed still `cacheEnabled: false` (Spec C1-R3)

- **tiktok** authService `exchange-code-for-token`, `refresh-access-token`, `revoke-token` — token ops,
  **RE-CONFIRMED uncached after batch-2 edits** (each stays `cacheEnabled: false`; a STATE-only
  discriminant `hashCallScope(this.config.clientKey[, refreshToken|accessToken])` was added so the
  shared-closure hazard is closed without ever caching a token). tiktok `authService.test.ts` 124/124 GREEN.
- **snapchat** `refresh-token` — uncached (discriminant added for STATE only, batch 1). ✔
- **facebook** `upload-media`, `post-to-page` — uncached writes (batch 1). ✔
- **tiktok** apiClient `upload-video`, `publish-photo-post`; videoProcessor `process-video`; hashtagManager
  `create-hashtag-challenge` — uncached writes, STATE-only discriminant added this batch. ✔
- **telegram / youtube** send/edit/delete/pin/create/update/upload writes — uncached, STATE-only
  discriminant added this batch. ✔ (writeFailFast suites GREEN: telegram 6/6, youtube adapter 80/80,
  pinterest 42/42, instagram 25/25).

---

## D4 — LinkedIn "write-op caching" flag (Spec C1-R2 flag-and-decide)

The proposal flagged `linkedin/apiClient.ts:107,245,321` as **write-op caching** (a correctness
defect). **Corrected classification (recorded decision):** those three sites are **READS** —
`get-profile` (GET `/rest/userinfo`), `get-comments` (GET `/rest/socialActions/{urn}/comments`),
`get-post-analytics` (GET `/rest/organizationalEntityShareStatistics`). The real write,
`post-comment` (POST), is correctly `cacheEnabled:false`. **Decision = fix-here-as-reads, no
defer:** the three reads received a credential-scoped discriminant in this batch (`get-profile` →
PII/identity; `get-comments` / `get-analytics` → PII + `postUrn` folded into `publicParams`). The
constant-key leak on these reads is closed exactly like every other read.

---

## Open questions resolved

- **Non-provider `packages/adapters` `cacheEnabled:true` sites exist?** YES — `storage-s3` and
  `storage-cloudinary` `get-metadata` (both migrated in batch 1). Confirms the design Open Question.
- **Final N of `cacheEnabled:true` sites:** **60** (post-C1a), reconciled from the pre-C1a 61.
  **All 60 now carry a `cacheKeyDiscriminant`** (12 in batch 1 + 48 in batch 2). Verified by
  `rg "cacheEnabled:\s*true" packages/providers packages/adapters --type ts -g '!**/tests/**' | wc -l`
  → 60, and every one of those files uses `hashCallScope`, with a `cacheKeyDiscriminant` present in
  each `cacheEnabled: true` options block (checked mechanically, zero misses). pinterest/instagram use
  computed `cacheEnabled` (outside the literal count) and are also migrated.

## Batch-2 discovery (recorded for verify)

The process-singleton breaker binds the FIRST caller's closure per two-part `service:operation` key
(`getOrCreateBreaker` returns the cached instance and ignores the newly-passed `apiCall`; call sites
pass `args: []` with real params captured in the closure). Consequence pre-migration: for ANY
discriminant-less op shared across tenants/resources, `breaker.fire()` executed the first-registered
closure — so tenant B received tenant A's payload/result **even on `cacheEnabled:false` writes and even
where L1 was correctly skipped**. This is a correctness/cross-tenant hazard broader than the L1/L2 cache
vectors the original audit modelled, and it is the reason C1b folds a discriminant into EVERY call site
(reads, writes, token ops, and the instagram `media-upload` S3 call), not only the cacheable reads.
Empirically demonstrated RED→GREEN by `TelegramApiClient.cacheIsolation.test.ts` (getMe/get-chat-member),
`TikTokAuthService.cacheIsolation.test.ts` (get-user-profile), and `YouTubeApiClient.cacheIsolation.test.ts`
(get-video-details X≠Y and A≠B).

---

## C1b-v remediation — Fix B (D8) + the 10 previously-missed breaker call sites

> The full C1b re-verify (verify-report) confirmed the bound-closure vector was still OPEN at
> **10 discriminant-less `circuitBreaker.call` sites across three files the cache audit's
> `packages/`-scoped grep never covered**, six of them binding real per-tenant credentials/content.
> The completeness enumeration above (`rg cacheEnabled:true packages/…`) is structurally blind to
> (a) `apps/api` and (b) provider files that call the breaker with tenant closures but do NOT
> literally contain `cacheEnabled:true` (`schedulingService`, `mediaProcessor`). The real
> inventory is `rg "circuitBreaker\.call" apps packages -g '!**/tests/**'`.

**The disclosure guarantee is now KEY-INDEPENDENT (Fix B / design D8).** The breaker's action is a
generic dispatcher (`(fn, ...a) => fn(...a)`) and `call()` fires `breaker.fire(apiCall, ...args)`,
so EVERY call runs its OWN closure regardless of the `service:operation[:discriminant]` key. A
missing/blank discriminant now degrades only to shared cache-skip + shared circuit STATE
(availability), never to running another tenant's closure. The discriminants below are therefore a
**cache/STATE scoping** restoration (per-query cache + per-tenant STATE), no longer the disclosure
boundary. Proven by `circuitBreakerTenantIsolation.test.ts` → "shared breaker runs the caller's own
closure (D8)" (RED with the raw opossum bind pattern → GREEN with the dispatcher).

### The 10 sites (+ `_template` ×2) — now migrated

| #   | File                                              | Operation(s)                                              | Prior risk (Fix A)                                                                           | Discriminant added                                                                              | Notes                                                                                            |
| --- | ------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| C-2 | providers/instagram/src/schedulingService.ts      | `schedule-post:schedule`                                  | closure bound A's credentials + `job.content`/`accountId`/`projectId`; B re-enqueued A's job | `hashCallScope(credentials, job.accountId, job.projectId, job.queueId)`                         | uncached write-style op; STATE-only                                                              |
| C-3 | providers/instagram/src/mediaProcessor.ts `:97`   | `media-analysis:get-metadata`                             | closure bound a tenant `videoUrl` (ffprobe)                                                  | `hashCallScope(videoUrl)`                                                                       | mirrors tiktok videoProcessor precedent                                                          |
| C-3 | mediaProcessor.ts `:172`                          | `video-splitting:split-video`                             | closure bound `videoUrl` + split opts                                                        | `hashCallScope(videoUrl, segmentLength, maxSegments, aspectRatio, quality)`                     |                                                                                                  |
| C-3 | mediaProcessor.ts `:302`                          | `segment-processing:process-segment`                      | closure bound source video + S3 upload                                                       | `hashCallScope(originalVideoUrl, segmentId, startTime, duration)`                               |                                                                                                  |
| C-3 | mediaProcessor.ts `:419`                          | `reel-optimization:optimize-reel`                         | closure bound `videoUrl` + S3 upload                                                         | `hashCallScope(videoUrl)`                                                                       |                                                                                                  |
| C-3 | mediaProcessor.ts `:514`                          | `thumbnail-creation:create-thumbnail`                     | closure bound `videoUrl` + S3 upload                                                         | `hashCallScope(videoUrl, timeOffset)`                                                           |                                                                                                  |
| C-4 | apps/api/src/trends/trendAnalysisService.ts `:85` | `trend-analysis-service:get-trending-content`             | `cacheEnabled:true` + `ANALYTICS_CB_OPTIONS`; closures are stubs (real leak once wired)      | `hashCallScope("trend-analysis-global", options.region, options.timeframe)`                     | pre-fetch scope only (type/category/limit filtered AFTER the breaker, must not fragment the key) |
| C-4 | trendAnalysisService.ts `:150`                    | `generate-trend-predictions`                              | same                                                                                         | `hashCallScope("trend-analysis-global", region, category, timeHorizon)`                         |                                                                                                  |
| C-4 | trendAnalysisService.ts `:266`                    | `analyze-viral-content`                                   | same                                                                                         | `hashCallScope("trend-analysis-global", contentId)`                                             | folds the analysed content id                                                                    |
| C-4 | trendAnalysisService.ts `:372`                    | `discover-content-opportunities`                          | same                                                                                         | `hashCallScope("trend-analysis-global", region, category)`                                      |                                                                                                  |
| S-B | providers/\_template/src/apiClient.ts (×2)        | `provider-api:<op>` (makeRequest), `media-fetch:download` | scaffolding — copy-paste would seed new discriminant-less sites                              | `hashCallScope(this.credentials, operation, url)` / `hashCallScope(this.credentials, mediaUrl)` | template now models the correct pattern                                                          |

> **C-4 honesty note.** The four `trendAnalysisService` closures are platform-global TikTok-trend
> stubs with NO per-tenant credential today, so the discriminant folds the request scope (region /
> timeframe / contentId / category) to key each distinct query's L1/L2 cache + STATE partition. When
> these are wired to real per-tenant provider/`prisma` calls, the discriminant must be extended with
> the tenant scope (accountId/credential) sourced from the request context — but even un-extended,
> Fix B (D8) means a future omission is an availability, not a disclosure, concern. The
> `apps/`-scoped completeness guard (Fitness #29 idea, design D8) is recommended as the follow-up
> that closes the audit's `apps/` blind spot; it is NOT shipped in this remediation.

### W-A — instagram `media-upload:upload` byteLength collision (design D8 decision)

`instagram/src/apiClient.ts:547` keys on `hashCallScope(this.credentials, mediaType, mediaBuffer.byteLength)`.
Under Fix A the re-verify flagged that two same-type/same-size uploads by one tenant collide on one
breaker key and (pre-D8) the bound closure returned the first upload's media URL for the second
(wrong-media). **Under Fix B this is DOWNGRADED to a benign availability nuance:** the dispatcher runs
each call's OWN closure, so the collision only SHARES a circuit STATE partition — it never returns the
first upload's URL. **Decision (recorded): keep the credential+type+size discriminant for STATE; do
NOT fold a per-upload content digest** — hashing multi-MB buffers on every upload is unjustified for a
benign STATE collision now that D8 structurally closes the wrong-media (bound-closure) vector. The op
remains uncached (`cacheEnabled` unset → false); Fitness #25 posture intact.

### Full breaker call-site inventory — completeness re-check

`rg "circuitBreaker\.call" apps packages -g '!**/tests/**'` now shows **every** call site carrying a
`cacheKeyDiscriminant` except intentional exclusions: none remain discriminant-less in `apps/` or in
migrated provider files. (The prior "all 60 migrated, zero misses" was true for the `cacheEnabled:true`
enumeration but blind to these 10 breaker call sites — corrected here.)

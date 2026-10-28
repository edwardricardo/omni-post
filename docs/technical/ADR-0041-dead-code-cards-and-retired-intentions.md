# ADR-0041: Dead-code decision cards — what each card retires, where each retired intention lives, and the product questions the mapping raised

- **Status**: Accepted
- **Date**: 2026-10-05 (cards C1 to C7 and C10, and the condition every deletion meets); 2026-10-06
  (the product questions PREG-1 to PREG-11)
- **Decision-makers**: Product Owner and Maintainer, held by one person ([GOVERNANCE.md](../GOVERNANCE.md)): the
  Maintainer for what each card retires, the Product Owner for the condition that keeps each
  intention, for card C10 and for the product questions
- **Consulted**: —
- **Informed**: —
- **Supersedes**: —
- **Superseded by**: —
- **Related**: [UNUSED_CODE_INVENTORY.md](../reports/UNUSED_CODE_INVENTORY.md) (the inventory the
  cards decide on); [Master Plan](../product/MASTER_PLAN.md) §5.13 (the deletion units DC-1 to
  DC-14 that carry these decisions out); [ADR-0034](ADR-0034-credential-model.md) decision 11 (the
  customer `ApiKey` slice, deleted by DC-13); [ADR-0029](ADR-0029-media-upload-limits.md) (type, size,
  format and duration of uploads; no ADR named malware scanning before PREG-7)

## Context

1. **Twelve cards on one inventory.** On 2026-10-05 the Product Owner and the Maintainer reviewed
   twelve decision cards on `docs/reports/UNUSED_CODE_INVENTORY.md`, re-measured that day on `main`
   `f47f9670`. The Maintainer decided C1 to C7 and the Product Owner C10 that day; C8, C9, C11 and
   C12 had their intention mapped and wait for the confirmation of both roles.
2. **The mapping.** Two read-only mappings extracted the intentions from the code itself (headers,
   exported types, Prisma fields) and crossed them with the Master Plan, `FEATURE_TRACE_MATRIX.md`,
   `ADMIN_CUSTOMER_PARITY.md`, the normalization roadmap ([its last version](https://github.com/edwardricardo/omni-post/blob/3758be3ee3d4274bcc01582b437080732f50d11d/docs/architecture/NORMALIZATION_ROADMAP.md), folded into Master
   Plan §5.2 on 2026-10-28) and the ADRs: 178 capabilities. Of the 54 of
   C8 to C10, 17 already had a row, 14 had a nearby row that did not name them, 3 fall under "Never"
   and 20 had no row. Of the 124 of C1 to C7, C11 and C12, 53 are already met by live code, 17 had a
   row, 22 a partial row, 5 are declined by the canon and 27 had no row (14 with a drafted row and 13
   waiting for a product question).
3. **The state of the engine, measured in execution on 2026-10-05.** Until `8710327d` no channel
   published, because the workers did not decrypt the credentials the API writes (DEF-29; its PR 1
   merged that day as #429). Since that merge only Bluesky publishes, because the OAuth flow stores
   three generic fields and each adapter requires fields of its own network (DEF-36, whose redesign
   the Product Owner placed on 2026-10-05 as slice 1 of Master Plan §2F, CRED-14 of §5.14). Analytics
   ingestion persists nothing for any network (DEF-32). The provider code card C8 retires was never
   part of that engine: it is its unbuilt second half (deep analytics, in-network moderation, direct
   messages, stories, media processing, trends).
4. **The only live code that goes**, measured: the mislabelled HTTP series of `PerformanceMonitor`
   and its Redis write per request, which the metrics plugin replaces in the same change (DC-1); the
   Redis list of `recordLoginAttempt`, which nobody reads (DC-2); and the Redis `KEYS` over the whole
   keyspace on every post command, against a cache that is switched off (DC-5). In C8, the edit of
   `TikTokAdapter.ts` removes a hashtag path that does nothing as deployed and a promoted-content stub
   that only throws `NOT_IMPLEMENTED`: no behaviour change.
5. **Findings.** Crossing the cards and checking their leads found DEF-30 to DEF-38, defects of the
   code that runs, recorded in Master Plan §5.11. F5 and F6 (DEF-34 and DEF-35) amend the premise of
   C6 that ApiMetrics is a fed source; that is why §4.2.b (Master Plan §5.2) adds OBS-1 to OBS-4.
6. **The credential model.** On 2026-10-06, with the credential model (ADR-0034, Master Plan §5.14),
   the Maintainer also decided to delete the customer `ApiKey` slice, which adds the unit DC-13.

## Decision

1. **The condition before any deletion** (Product Owner, 2026-10-05). Every intention of the code is
   crossed with the Master Plan, so the idea is safe and only its correct, up-to-date implementation
   is left to do. In the Product Owner's words: "What I want to keep is the essence of what was being
   attempted." The mapping, with the rows it added to the rest of the Master Plan, completes the
   cross: each intention is served by cited live code, by a Master Plan row or by an open question,
   which is never decided by omission.
2. **The cards.** Under the taxonomy of Master Plan §0.3, C1 to C7 are DEAD_CODE, confirmed by the
   Maintainer; C8, C9, C11 and C12 have their intention mapped and wait for the confirmation of the
   Product Owner and the Maintainer; C10 is PLANNED and is finished as BILL-30 (Master Plan §5.9). No
   deletion unit starts before these decisions are on `main`, and the units of C8, C9, C11 and C12
   also wait for that explicit approval, given on Master Plan §5.13. Line counts are source / test,
   as the cards measured them; § numbers and row IDs refer to the Master Plan.

   | Card                                                    | What is retired                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Decision                                                                                                                                               | Where each intention lives                                                                                                                                                                                                                                                                                                                                                                                                         |
   | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | C1 — `PerformanceMonitor` and hooks that never run      | `apps/api/src/monitoring/performanceMonitor.ts` (532) and its two root hooks in `index.ts`; the metrics plugin is wrapped with `fastify-plugin` in the same change; ~550 / 752                                                                                                                                                                                                                                                                                                                                                                                                                                                        | A, 2026-10-05                                                                                                                                          | HTTP series of the metrics plugin (same change); OBS-1, OBS-2, OBS-3; §4.2.c; DEF-30 (the audit half); DEF-34                                                                                                                                                                                                                                                                                                                      |
   | C2 — security theatre on the request path               | in `auth/rbacMiddleware.ts`, `roleBasedRateLimit`, `auditPermissionAccess`, `debugPermissions` and `requireContextPermission`; `recordLoginAttempt` with its prefix and its two calls; the OpenAPI scheme `X-API-Key`; ~150 / ~225. Staying: `requirePermission` (live), `requireAllPermissions` and `requireOwnershipOrPermission` (for N-AUTH-3), and the 7 `config.rateLimit` blocks with `@fastify/rate-limit` and their test (atomic in AUTH-RL-1)                                                                                                                                                                               | A, 2026-10-05                                                                                                                                          | AUTH-RL-1 (closes L-26); DEF-30; N-AUTH-3, N-SEC-3.b; AUTH-AUDIT-1; live code: `GET /auth/permissions`, `RedisBruteForceAdapter` and `AuditLog`; PREG-1                                                                                                                                                                                                                                                                            |
   | C3 — security configuration declared and never applied  | the 6 non-password keys of `adminAuthConfig` that nothing reads, with their types; `OAUTH_ENCRYPTION_KEY` (schema, examples, catalogue, fixtures and its seeded row, by data migration); `BCRYPT_ROUNDS`, `ADMIN_EMAIL` and `REDIS_POOL_SIZE`; `validation/secureSchemas.ts` except `SecurityValidatedSchemas.password`. Staying: the 7 `passwordPolicy.*` keys and `PasswordSchema`, which N-SEC-6 decides                                                                                                                                                                                                                           | A′, 2026-10-05                                                                                                                                         | N-SEC-5.b; SEC-KEK-1; SEC-SSRF-1; N-SEC-6; AUTH-RL-1; live code: `RedisBruteForceAdapter`, `AdminUser.maxConcurrentSessions`, Argon2id, `security/inputValidation.ts` and API-TYPES-1                                                                                                                                                                                                                                              |
   | C4 — dead modules presented as the live defence         | `security/enhancedValidator.ts` (584), `security/credentialManager.ts` (450), `security/auditLogger.ts` (710), `monitoring/rateLimitingDashboard.ts` (550), `middleware/correlationMiddleware.ts` (128) and `packages/observability/opentelemetry/src/correlationTracking.ts` (521); 2943 / ~4140. `security/fileUploadValidator.ts` (653) stays for STOR-9                                                                                                                                                                                                                                                                           | A, 2026-10-05                                                                                                                                          | AUTH-OBS-1; AUTH-RL-1 (closes FN-010/FN-027); OBS-2, OBS-3; OBS-6; STOR-8, STOR-9; GDPR-3; live code: `security/inputValidation.ts`, `audit/auditService.ts` with its retention, and `request.id` (ADR-0013); PUBAPI-1 (PREG-1), PREG-5, PREG-7, PREG-8                                                                                                                                                                            |
   | C5 — parallel event and query infrastructure            | `apps/api/src/infrastructure/integration-events/` (10 files, 1027) with its tokens; the query half of the CQRS bus (`PostQueryGetList.ts`, `PostQuerySearchAnalytics.ts`, `PostQueryHandlers.ts`) and its cache; both `withCacheKey`, `generateCacheKey`, `invalidateQueryCache` and the 5 `invalidateCaches`; ~1780 / ~3330                                                                                                                                                                                                                                                                                                          | A, 2026-10-05                                                                                                                                          | N-COR-13 (made precise); live code: the outbox relay and `IntegrationEventDeliveryHandler`, the routes that call `@core` queries (ADR-0033) and `CachePort`                                                                                                                                                                                                                                                                        |
   | C6 — observability instruments with no data             | `@monitoring/circuit-breaker` (413) and its 3 consumers, `CircuitBreakerHealthChecker`, 8 of the 9 methods of `BusinessKPITracker` with its 12 instruments, `apps/api/src/health/healthMetrics.ts`, `AnalyticsInstrumentation`, the portals' telemetry and 3 accessors; ~1100 / ~920                                                                                                                                                                                                                                                                                                                                                  | A, 2026-10-05; amended by F5 and F6                                                                                                                    | OBS-1, OBS-4; BI-KPI-1; AUTH-OBS-1; DEF-34, DEF-35; BILL-19 (MRR); F2-API-4; FN-025; live code: the breaker of `external-apis` and Sentry in both portals; PREG-5                                                                                                                                                                                                                                                                  |
   | C7 — inert schema                                       | one migration: `AdminLoginAttempt`, `AdminUserPermission` and `AdminRoleHistory` with their inverse relations in `AdminUser`; `ContentVersion.approvedAt` with its index and its twin `approvedBy` (F7); `TemplateComponent.isReusable` with its index; `OutboxInbox`; ~80 schema lines and 17 indexes. `ConsentRecord` stays: LEGAL-1 decides it                                                                                                                                                                                                                                                                                     | A, 2026-10-05                                                                                                                                          | AUTH-AUDIT-1; LEGAL-1 (made precise); live code: `AuditLog` (`LOGIN_FAILURE`, `USER_LOGIN`, `USER_ROLE_UPDATED`), the approval aggregate, `TemplateComponentUsage` and the idempotent consumers; PREG-2, PREG-3, PREG-4, PREG-6                                                                                                                                                                                                    |
   | C8 — provider and media features never published        | six groups of `packages/providers/facebook/src` (5654, no tests); 4108 lines of TikTok in 12 files, with edits in `TikTokAdapter.ts` and `apiClient.ts`; the Instagram UI (3373) with the tables `InstagramStoryProject` and `InstagramStory`; `apps/api/src/video/` (2287) with the tables `VideoProcessingJob` and `VideoSegment`; 15 422 source and 194 schema / 10 406 test                                                                                                                                                                                                                                                       | intention mapped; waits for the approval of the Product Owner and the Maintainer (recommendation: B, delete everything that never ran)                 | F2-API-12 to F2-API-17, F2-WRK-4, F2-WRK-5, F2-CLI-6 to F2-CLI-8 and the amendment of F2-WRK-3 (§3); F3-API-10 to F3-API-12, F3-WRK-4, F3-CLI-4 and the amendments of F3-API-7, F3-API-8, F3-WRK-2 and F1-CLI-5 (§4); "Never" (§4); STOR-6, STOR-7, STOR-9; DEF-31, DEF-33; already covered: F2-API-4, F2-API-6, STOR-8, STOR-11, `OAUTH-REFRESH-UNWIRED`; PREG-11                                                                 |
   | C9 — templates, versioning and editors                  | the twin `/dashboard/content/templates` (1318), the versioning of `packages/ui` (1995), `TipTapContentEditor` and `ValidationContentEditor` (641) and the tables `TemplateCommit` and `TemplateCollaboration`; `/dashboard/templates` stays and enters the menu; 3954 source and 40 schema (93 if A/B is retired), no tests                                                                                                                                                                                                                                                                                                           | intention mapped; waits for the approval of the Product Owner and the Maintainer (recommendation: A, with the A/B decision inside TEMPLATE-AB-MEASURE) | CONTENT-VERSION-UI and TEMPLATE-AB-MEASURE (§5.3); TEMPLATE-COLLAB (§5.8); the amendment of F2-API-3 (§3); live code: `/dashboard/templates`, `VariableInserter.tsx`, `TemplateVersion`, `TipTapEditor.tsx` and `ClientContentEditor.tsx`                                                                                                                                                                                          |
   | C10 — referral program                                  | nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | A (finish it), 2026-10-05                                                                                                                              | BILL-30 (§5.9), after the payment decisions; its deletion inventory is void                                                                                                                                                                                                                                                                                                                                                        |
   | C11 — backend and packages with no consumer nor promise | `posts/optimizedPostsRoutes.ts`, `analytics/engagementPredictor*.ts` (4), `infrastructure/billing/paymentAdapterFactory.ts` (already decided by BILL-5), `content/SyncScheduler.ts`, `packages/adapters/db-prisma/src/cached.ts`, `providers/instagram/src/schedulingService.ts`, `providerConstraintValidator.ts`, `providerCapabilityManager.ts`, 10 of the 12 exports of `packages/api-common/src/schemas.ts` (`IdSchema` stays), 4 of the 7 helpers of `providers/shared/src/helpers.ts`, `playlistAnalyticsHelpers.ts` and the 6 events of `Campaign.ts`; `InMemoryTokenBucketRateLimiter` moves to the tests; ~4650 / ~3150     | intention mapped; waits for the approval of the Product Owner and the Maintainer (recommendation: A)                                                   | PROVIDER-CAPS-DRIFT (SMELL-23); BILL-5; N-COR-13 (campaign events); ARCH-20; FN-009, FN-023, FN-025; the canon declines the per-network scheduler and the accessors (§0.4; ARCHITECTURE_CANON §Dependency Injection); live code: `postRoutes` with `autoCachePlugin`, `PredictOptimalTimingUseCase`, `SyncEngineBase`, `CachePort`, the saga with `publishWorker`, the client's per-network limits and `providerConfig.ts`; PREG-9 |
   | C12 — frontend and configuration leftovers              | in `apps/client`, `analyticsClient.ts` and 5 facade methods, `addPostMedia`, `createPostThread` and `getPostThread`, `useSagaStatus` and `useStartPostPublishingSaga`, and the menu link to `/dashboard/queue`; in `apps/admin`, `assignPermission` and `revokePermission` of `rbacClient`, `authClient.ts`, `healthClient.ts`, `getAccountProjects`, the RBAC read trio, `notificationStore.ts`, `useContentLibrary.ts` and the page `/security/rbac`; the job `cleanup-preview-environments`, `.markdownlint.json`, `zod-to-json-schema` (`@fastify/websocket` already left, see DC-12); ~550 + ~70 of configuration + 1 dependency | intention mapped; waits for the approval of the Product Owner and the Maintainer (recommendation: A)                                                   | FE-BE-CONTRACT-BREAKS; SMELL-45/46; F2-CLI-3; F2-CLI-5; SETTINGS-HUB (§5.3), which the settings link points to instead of being deleted; N-AUTH-1; §6.2 (§5.2); live code: `setRolePermissions`, the login Server Action, `/health/*`, `/auth/permissions`, `RbacManager`, Prettier with lychee, and `fastify-type-provider-zod`; PREG-10                                                                                          |

3. **The ledger: retired code → intention → where it lives**, as the Master Plan recorded it at
   `32e38081`; "live" names code that already serves the intention.

   | Retired code (card)                                                       | Intention                                                                                                                               | Where it lives                                                                                                          |
   | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
   | `monitoring/performanceMonitor.ts` (C1)                                   | latency, errors and percentiles per endpoint; alerts; health; dashboard                                                                 | HTTP series of the metrics plugin (same change); DEF-34; OBS-1; §4.2.c; OBS-2; OBS-3                                    |
   | hook `auditPlugin` (C1; not retired, repaired separately)                 | an audit row per authenticated request                                                                                                  | DEF-30                                                                                                                  |
   | `roleBasedRateLimit` (C2)                                                 | quotas per role                                                                                                                         | AUTH-RL-1 (closes L-26)                                                                                                 |
   | `auditPermissionAccess` (C2)                                              | audit of permission checks                                                                                                              | DEF-30                                                                                                                  |
   | `requireContextPermission` (C2)                                           | permission per context or project                                                                                                       | N-AUTH-3, N-SEC-3.b, `FEATURE_TRACE_MATRIX.md`, row `Per-project members with granular roles`                           |
   | `debugPermissions` (C2)                                                   | see the effective permissions                                                                                                           | live: `GET /auth/permissions`                                                                                           |
   | `recordLoginAttempt` (C2)                                                 | record of login attempts                                                                                                                | live: `RedisBruteForceAdapter` and `AuditLog`; AUTH-AUDIT-1 (customer)                                                  |
   | OpenAPI scheme `X-API-Key` (C2)                                           | machine authentication by key                                                                                                           | PUBAPI-1 and PUBAPI-2 (PREG-1); `FEATURE_TRACE_MATRIX.md`, Level 3 row `Public API / MCP`; F2-API-9; DEF-7              |
   | 6 keys of `adminAuthConfig` (C3)                                          | lockout, login quota, sessions, MFA per role                                                                                            | live: brute force and `maxConcurrentSessions`; AUTH-RL-1; N-SEC-5.b                                                     |
   | `OAUTH_ENCRYPTION_KEY` (C3)                                               | a key-encryption key of its own for the OAuth tokens                                                                                    | SEC-KEK-1                                                                                                               |
   | `secureSchemas.ts` except the password (C3)                               | a Zod security catalogue; restricted URLs                                                                                               | live: `inputValidation.ts`; API-TYPES-1; SEC-SSRF-1                                                                     |
   | `BCRYPT_ROUNDS`, `ADMIN_EMAIL`, `REDIS_POOL_SIZE` (C3)                    | hash cost, seed admin, Redis pool                                                                                                       | live: Argon2id, `seed.ts:787` and `setupServices.ts:626-643`; L-546                                                     |
   | `security/enhancedValidator.ts` (C4)                                      | injection detection and sanitizing                                                                                                      | live: `inputValidation.ts` and `api_security_threats_total`                                                             |
   | `security/credentialManager.ts` (C4)                                      | key life cycle; scheduled rotation; grace window                                                                                        | PUBAPI-1 (PREG-1: expiry chosen at creation and a 7-day overlap on rotation)                                            |
   | `security/auditLogger.ts` (C4)                                            | audit with real-time alerts and retention                                                                                               | live: `auditService` and its retention; AUTH-OBS-1; GDPR-3                                                              |
   | `monitoring/rateLimitingDashboard.ts` (C4)                                | telemetry, alerts and dashboard of the limiter                                                                                          | AUTH-RL-1; OBS-2; §4.2.c (closes FN-010/FN-027)                                                                         |
   | `middleware/correlationMiddleware.ts`, `correlationTracking.ts` (C4)      | correlation id; tenant in the spans; user journeys                                                                                      | live: `request.id` (ADR-0013); OBS-3; PROD-ANALYTICS-1 (PREG-5)                                                         |
   | `security/fileUploadValidator.ts` (C4; not retired, moves to STOR-9)      | real signature, size, dimensions, anti-malware                                                                                          | STOR-8 (with dimensions), STOR-9, STOR-10, STOR-11; STOR-14 (PREG-7)                                                    |
   | `infrastructure/integration-events/` (C5)                                 | publishing and consuming, schema registry, upcasting                                                                                    | live: outbox and `IntegrationEventDeliveryHandler`; N-COR-13 (made precise)                                             |
   | query half of CQRS, its cache, `withCacheKey` and `generateCacheKey` (C5) | cached reads                                                                                                                            | live: routes that call `@core` (ADR-0033) and `CachePort`                                                               |
   | `@monitoring/circuit-breaker`, `CircuitBreakerHealthChecker` (C6)         | breaker state and alerts                                                                                                                | live: the breaker of `external-apis`; OBS-4                                                                             |
   | 8 methods of `BusinessKPITracker` (C6)                                    | business KPIs, sessions, quality, retention                                                                                             | BILL-19 (MRR); BI-KPI-1; AUTH-OBS-1; F2-API-4; FN-025; PROD-ANALYTICS-1 (PREG-5)                                        |
   | `health/healthMetrics.ts` (C6)                                            | system health as metrics                                                                                                                | OBS-1                                                                                                                   |
   | `AnalyticsInstrumentation` and the portals' telemetry (C6)                | product analytics; telemetry                                                                                                            | PROD-ANALYTICS-1 (PREG-5); live: Sentry                                                                                 |
   | `AdminLoginAttempt` (C7)                                                  | login forensics                                                                                                                         | live: `AuditLog` and brute force; AUTH-AUDIT-1; AUTH-RISK-1 (PREG-2)                                                    |
   | `AdminUserPermission` (C7)                                                | per-administrator permissions with expiry                                                                                               | SUPPORT-ACCESS-1, BREAKGLASS-1, ADM-JIT-1 (PREG-3)                                                                      |
   | `AdminRoleHistory` (C7)                                                   | role history                                                                                                                            | live: `USER_ROLE_UPDATED`                                                                                               |
   | `ContentVersion.approvedAt` and `approvedBy` (C7)                         | date and author of a version's approval                                                                                                 | live at post level (approvals); APPROVAL-1 (PREG-4)                                                                     |
   | `TemplateComponent.isReusable` (C7)                                       | reusable component                                                                                                                      | live: `TemplateComponentUsage`                                                                                          |
   | `OutboxInbox` (C7)                                                        | consumer idempotency                                                                                                                    | live: idempotent consumers; the canon is corrected in DC-7                                                              |
   | `facebook/src/features/community.ts` and `communityTypes.ts` (C8)         | read and answer comments; moderate in the network; direct messages; message templates; response metrics                                 | live: the adapter's comments and replies; F2-WRK-3 (amended), F2-WRK-5, F2-API-16, F2-CLI-7, F2-API-15                  |
   | `facebook/src/features/events.ts` and `eventTypes.ts` (C8)                | Facebook events                                                                                                                         | "Never" (Facebook events, §4; PREG-11)                                                                                  |
   | `facebook/src/features/shop*.ts` (C8)                                     | shop, catalogue and product tagging                                                                                                     | "Never" (shop and catalogue in the networks, §4)                                                                        |
   | `facebook/src/analytics/insights*.ts` (C8)                                | audience, performance per post and of video, peak and drop alerts, competitors                                                          | F2-API-12, F2-WRK-4, F2-API-13, F2-API-14, F2-API-6; live: best time                                                    |
   | `facebook/src/analytics/marketing*.ts` (C8)                               | ad reports, attribution and reach estimates; ad recommendations                                                                         | F3-API-7 and F3-API-8 (amended); "Never" (full ad management)                                                           |
   | `facebook/src/media/videoProcessor*.ts` (C8)                              | transcode, trim, subtitles, covers, templates per placement                                                                             | F3-WRK-4, F3-API-11, F3-API-12, F1-CLI-5 (amended)                                                                      |
   | `tiktok/src/authService.ts` (C8)                                          | Login Kit v2; revoke the token                                                                                                          | live: the OAuth of `providerOAuthConfigs.ts` and `OAUTH-REFRESH-UNWIRED` (TikTok v2); DEF-33                            |
   | `tiktok/src/videoProcessor*.ts` (C8)                                      | specification compliance, optimization and video templates                                                                              | STOR-8, STOR-11; F3-WRK-4; F1-CLI-5 (amended)                                                                           |
   | `tiktok/src/contentAnalyticsClient.ts` (C8)                               | video and profile metrics, competitors, hashtags                                                                                        | F2-API-12, F2-WRK-4, F2-API-13, F2-API-6                                                                                |
   | `tiktok/src/researchApiClient.ts` (C8)                                    | native trends, content gaps and viral patterns                                                                                          | F3-WRK-2 (amended)                                                                                                      |
   | `tiktok/src/marketingApiClient.ts` (C8)                                   | ad, audience and creative reports; promotion                                                                                            | F3-API-7 and F3-API-8 (amended)                                                                                         |
   | `tiktok/src/hashtag*.ts` (C8)                                             | hashtag strategy and recommendations; branded challenges                                                                                | F2-API-17, F2-CLI-8; "Never" (branded hashtag challenges)                                                               |
   | Instagram UI with `InstagramStoryProject` and `InstagramStory` (C8)       | story editor and scheduling, interactive elements and story metrics; validation and thumbnails on upload; video splitting               | F3-API-10, F3-CLI-4, F2-API-12, F3-WRK-4, STOR-11; DEF-31                                                               |
   | `apps/api/src/video/` with `VideoProcessingJob` and `VideoSegment` (C8)   | transcoding, resumable chunked upload, covers and cover variants                                                                        | F3-WRK-4, STOR-9 (amended), F3-API-12                                                                                   |
   | the twin `ContentTemplates.tsx` and `components/content/templates/` (C9)  | template library, variables and automations                                                                                             | live: `/dashboard/templates` and `VariableInserter.tsx`; F2-API-3 (amended)                                             |
   | versioning of `packages/ui` (C9)                                          | version history of a post                                                                                                               | CONTENT-VERSION-UI                                                                                                      |
   | `TipTapContentEditor`, `ValidationContentEditor` (C9)                     | rich text; per-network validation while writing                                                                                         | live: `TipTapEditor.tsx` and `ClientContentEditor.tsx`                                                                  |
   | `TemplateCommit` (C9)                                                     | Git-style template versions                                                                                                             | live: `TemplateVersion`                                                                                                 |
   | `TemplateCollaboration` (C9)                                              | collaborators per template                                                                                                              | TEMPLATE-COLLAB                                                                                                         |
   | `TemplateUsageEvent`, `TemplateAnalytics` (C9, only if A/B is retired)    | template usage and A/B results                                                                                                          | TEMPLATE-AB-MEASURE                                                                                                     |
   | nothing (C10 is not deleted)                                              | referral code, attribution, conversion and reward                                                                                       | BILL-30                                                                                                                 |
   | C11, if the Product Owner and the Maintainer approve the card             | fast endpoints, prediction, synchronization, repository cache, per-network scheduler, validators, helpers, playlists, campaign events   | mostly live; SMELL-23; FN-023, FN-025; N-COR-13; the canon declines the per-network scheduler and the accessors; PREG-9 |
   | C12, if the Product Owner and the Maintainer approve the card             | facade clients, saga hooks, links, loose permissions, notifications and content in Admin, preview cleanup, markdownlint, one dependency | FE-BE-CONTRACT-BREAKS; SMELL-45/46; F2-CLI-3; F2-CLI-5; SETTINGS-HUB; N-AUTH-1; §6.2; ADM-NOTIF-1 (PREG-10)             |

4. **The product questions** (Product Owner, 2026-10-06, recorded in #433): the 13 capabilities with
   no row that depended on a product decision, grouped in ten questions, plus card C8's proposal for
   the "Never" line. None was decided by omission: PREG-4 and PREG-9 were decided directly, and the
   other nine after researching what the category leaders do and what standards and regulators ask
   for (Rationale 4).
   - **PREG-1 — which credential authenticates the public API** (option A). Scoped API keys now, on
     the live `IntegrationApiKey` pattern: an expiry chosen at creation, rotation with an overlap of
     up to 7 days, and immediate revocation; and OAuth 2.1 for third-party applications once a
     consumer exists. The scheduled rotation is replaced by the expiry at creation, the grace window
     is the overlap, and the per-key limits are the quota of stage 2 of AUTH-RL-1. → PUBAPI-1 and
     PUBAPI-2 (Master Plan §3); the customer `ApiKey` slice is deleted with DC-13 (decision D4 of the
     credential model, Master Plan §5.14).
   - **PREG-2 — risk-based login** (option B). A known-device cookie, email verification of a new
     device, a notice of every new sign-in, and MFA that the account owner can require for the whole team,
     with no risk-scoring engine. → AUTH-RISK-1 (Master Plan §5.1).
   - **PREG-3 — per-administrator permissions with expiry** (option B). The roles stay, and time
     bounds apply where they protect something: a support grant to a tenant's data, and watched
     emergency accounts, with just-in-time elevation recorded for later. → SUPPORT-ACCESS-1,
     BREAKGLASS-1 and ADM-JIT-1 (Master Plan §5.1).
   - **PREG-4 — whether an edit after approval reopens the approval.** An edit after the approval
     requires a new approval; the approval is bound to the version of the content. The Product Owner
     decided it without market research (engram 1309). → APPROVAL-1 (Master Plan §5.3).
   - **PREG-5 — product analytics** (option B). Product events of our own, emitted from the server
     (feature adoption, journeys, usage retention), with no SDK in the browser, and cookieless
     analytics on the marketing site; the legal basis is set in LEGAL-1 and LEGAL-3 before the first
     event. → PROD-ANALYTICS-1 (Master Plan §5.13).
   - **PREG-6 — consent capture** (option B). Consent is decided inside the legal flow: LEGAL-1 first
     inventories the purposes and their legal bases; the acceptance of the terms, the privacy notice
     and the DPA is recorded per version as contractual evidence, not as consent; and `ConsentRecord`
     stays only if a purpose based on consent exists. → LEGAL-5 (Master Plan §5.10).
   - **PREG-7 — malware scanning and quarantine of uploads.** Option B as the default behaviour —
     ClamAV over the uploaded documents inside `verifyUpload`, and images re-encoded without
     metadata — plus a neutral scanning port with the cloud adapters written now, "the same way as the
     KMS" (decision D3 of the credential model): a switch validated at boot, ClamAV as the real
     adapter in docker-compose, and the AWS and Azure adapters written from their official
     documentation, marked uncertified until their first live run. Never the public VirusTotal API,
     whose terms forbid commercial use. → STOR-14 and STOR-15 (Master Plan §5.9).
   - **PREG-8 — an emergency mode of the limiter** (option B). There is no emergency mode of the
     limiter inside the application, which goes to the "Never" line (Master Plan §4); the answer to an
     attack is an edge runbook (WAF, or the CDN's under-attack mode, once one exists) plus the
     per-route switch and the shadow launch inside AUTH-RL-1. → AUTH-RL-1 (Master Plan §5.1) and the
     "Never" line (§4).
   - **PREG-9 — recommending networks for a piece of content, and optimizing YouTube playlists.** Yes,
     both, at low priority, in Phase 3. The Product Owner decided it without market research (engram
     1309). → F3-API-13
     and F3-API-14 (Master Plan §4).
   - **PREG-10 — Admin surfaces** (option B): a notification centre (already open as question 4 of
     `ADMIN_CUSTOMER_PARITY.md` §7) and a content library over the tenants' posts (a cross-tenant
     read through `withSystemContext` with audit, question 6 of the same section). Admin gains a
     notification centre, and there is no cross-tenant content library: staff see a tenant's content
     only with the support grant of PREG-3. → ADM-NOTIF-1 (Master Plan §5.3) and SUPPORT-ACCESS-1
     (§5.1); it closes questions 4 and 6 of `ADMIN_CUSTOMER_PARITY.md` §7.
   - **PREG-11 — card C8's "Never" proposal for Facebook events** (create, edit, cancel, invite and
     manage attendance) (option A). Facebook events go to the "Never (unless the ICP pivots)" line,
     with its review condition. → the "Never" line (Master Plan §4).

   The questions as they were asked, with the facts each one stood on:
   - PREG-1: the customer `ApiKey` slice stores per key `permissions`, `rateLimit` and a
     `rotationSchedule` in cron format (`schema.prisma:1060-1065`) that nothing applies (F9: the API
     accepts and stores `rotationSchedule`, `apiKeyRoutes.ts:39,137`); the live machine path is
     `IntegrationApiKey` (`zap_`/`mak_`) for Zapier and Make; the canon of the public API and of MCP is
     OAuth 2.1 (`FEATURE_TRACE_MATRIX.md`, row `Public API + MCP`). It asked for the credential and, with it, the
     scheduled rotation, a grace window on rotation and the per-key limits. Card C2 had already sent
     the `ApiKey` slice (~869 lines) to the product-pass gate (Master Plan §2).
   - PREG-2: risk scoring, geolocation and new-device detection; today there are counters, lockout, a
     CAPTCHA signal and audit.
   - PREG-3: time-bound elevation and emergency access beyond the roles; customers already have a
     per-project permission planned (`FEATURE_TRACE_MATRIX.md`, row `Per-project members with granular roles`), administrators only roles.
   - PREG-4: an approval bound to a version; `ContentVersion.approvedBy` is inert too (F7).
   - PREG-5: feature adoption, user journeys and usage retention, and on which legal basis or consent;
     it relates to LEGAL-1 and LEGAL-3 (a new SDK and new cookies).
   - PREG-6: `ConsentRecord` is kept; decided inside LEGAL-1.
   - PREG-7: no ADR named it; ADR-0029 covers type, size, format and duration.
   - PREG-8: global hardening under attack; low priority.
   - PREG-9: low priority.
   - PREG-11: the Meta events API is restricted (to check in the provider's documentation); the plan
     had no row for events in any direction, and `facebook/src/features/event*.ts` was the only
     intention of C8 with no owner, decided together with that card's approval.

5. **Still open outside this mapping, unchanged:** FN-023 and FN-025 (engagement prediction and the
   AI quality fields, Master Plan §5.3), the quota figures per role or plan that stage 2 of AUTH-RL-1
   needs (`docs/features/auth-rate-limit-integrity/design.md:379`), and the KPI set of BI-KPI-1.

## Rationale

1. **The essence is kept, the code is not.** The condition of decision 1 is the Product Owner's
   reason for the whole set: the idea stays safe, so only its correct, up-to-date implementation is
   left to do, and the code that attempted it can go.
2. **C8 never ran.** The provider code it retires was never part of the publishing engine: it is the
   engine's unbuilt second half, and its intention stays in the rows of Master Plan §3, §4, §5.3 and
   §5.9 (Context 3). The recommendation for C8 is to delete everything that never ran.
3. **What C6 measured was not fed.** F5 and F6 showed that ApiMetrics is not a fed source, so the
   alerts and panels of §4.2.b are built on series some source feeds (OBS-1 to OBS-4).
4. **The product questions follow the market canon and the regulators**, researched for nine of them
   (`preg-market-canon.md`):
   - PREG-1: two tiers coexist — revocable keys of the account owner for their own scripts (Buffer, Agorapulse,
     Metricool, Planable) and OAuth with an authorization code for third-party applications (Buffer,
     with PKCE required; Hootsuite; Sprout Social); no leader rotates a customer's keys on a calendar,
     and Stripe keeps a rotated key for up to 7 days (Stripe's API key documentation).
   - PREG-2: Buffer, Hootsuite and Later verify an unknown device or location by email and notify
     every new sign-in; Sprout Social requires two-step verification for everyone and Agorapulse lets
     the account owner require it; a numeric risk score is an enterprise add-on of identity providers (Auth0
     Adaptive MFA), and NIST SP 800-63B-4 treats risk signals as optional and notices of account
     events as mandatory (§4.6).
   - PREG-3: the cloud uses just-in-time elevation with expiry, justification, approval, MFA and
     audit (Microsoft Entra PIM, Google Privileged Access Manager, AWS; NIST SP 800-53 AC-2(2) and
     AC-6) and watched emergency accounts (Microsoft), while the category leaders only publish least
     privilege and periodic access reviews (Hootsuite).
   - PREG-5: the leaders that declare their providers use third-party client-side product analytics
     behind cookie consent (Sprout Social's subprocessor list names FullStory, Intercom, Mixpanel,
     Pendo and Segment), and the regulators place under art. 5(3) of ePrivacy the client code that
     sends data processed on the device to the server (EDPB, guidelines 2/2023, ¶53); the option
     chosen is the strictest variant, not the market median.
   - PREG-6: Hootsuite and Sprout Social incorporate their DPA into the terms by reference, and the
     GDPR asks for consent to be recorded only where it is the legal basis and never in the same
     click as the acceptance of the terms (art. 7(4); EDPB, guidelines 05/2020, ¶81 and ¶108).
   - PREG-7: upload platforms scan by default (Uploadcare with ClamAV, Filestack; an add-on in
     Cloudinary), AWS and Azure scan on upload (GuardDuty Malware Protection for S3, Defender for
     Storage), and OWASP's file upload cheat sheet asks for antivirus or CDR on documents and for
     re-encoding images, while no category leader documents it.
   - PREG-8: the attack mode lives at the edge (Cloudflare calls "I'm Under Attack" one of the last
     resorts; Sprout Social uses Cloudflare and AWS WAF), and inside the application the canon is to
     shed load by criticality with switches (Stripe, "Scaling your API with rate limiters"; Google
     SRE, "Handling Overload"), while the leaders only expose a content pause, which OmniPost already
     has as crisis mode.
   - PREG-10: operator consoles have an alert centre (Google Workspace) and per-user notice
     preferences (Stripe), and no reference platform gives staff permanent access to customer content
     (Microsoft Customer Lockbox, approved, 4 h at most and audited; Google Access Transparency;
     Hootsuite, whose support enters only to resolve a ticket; GDPR, arts. 28, 29 and 32(4)).
   - PREG-11: in Graph API v26.0, consulted on 2026-10-06, creating, updating or deleting an event
     answers "You can't perform this operation on this endpoint", reading a page's events is reserved
     to Facebook Marketing Partners and no permission manages page events, and Buffer's list of
     Facebook post types does not include events.

## Alternatives Considered

- **Delete the inventory without crossing the intentions.** Rejected by decision 1: the essence of
  what the code attempted would be lost with it.
- **C10, delete the referral program.** Rejected: it is finished as BILL-30, and its deletion
  inventory is void.
- **C3, option A** of the card (`dead-code-decisions.md`,
  `/root/.claude/omnipost-tools/research-2026-10-05/`, outside the repository; the Master Plan records
  only the A′ decision): delete every unread declaration, the 7 `passwordPolicy.*` keys and
  `PasswordSchema` among them. Replaced by A′, which keeps those for N-SEC-6 to decide.
- **PREG-1, scheduled rotation by calendar.** Replaced by the expiry chosen at creation (Rationale 4).
- **PREG-2, a risk-scoring engine.** Rejected: notices and device verification instead.
- **PREG-5, third-party client-side product analytics behind cookie consent**, the market median.
  Rejected for the strictest variant.
- **PREG-7, the public VirusTotal API.** Never: its terms forbid commercial use.
- **PREG-8, an in-application emergency mode of the limiter.** Rejected: it goes to the "Never" line.
- **PREG-10, a cross-tenant content library in Admin.** Rejected: staff see a tenant's content only
  with the support grant of PREG-3.
- **C11, a per-network scheduler and accessors.** Declined by the canon (Master Plan §0.4;
  ARCHITECTURE_CANON §Dependency Injection).

## Consequences

**Positive**

- Each retired intention has one named home: live code, a Master Plan row or an open question.
- The deletion units of Master Plan §5.13 (DC-1 to DC-14) carry out these decisions; each updates its
  rows of `docs/reports/UNUSED_CODE_INVENTORY.md` in the same pull request.

**Negative / costs**

- Four cards (C8, C9, C11 and C12) remain undecided until their approval, and their code stays in the
  tree until then.

## Legal impact

- **Personal data**: recording these decisions changes no inventory row. DC-7 removes the models
  `AdminLoginAttempt`, `AdminUserPermission` and `AdminRoleHistory`, whose personal fields the
  `personal-data` inventory lists, in its own pull request; `ConsentRecord` stays until LEGAL-5
  decides it (PREG-6).
- **Cookies and browser storage**: none — PREG-5 chooses product events emitted from the server with
  no browser SDK, and cookieless analytics on the marketing site.
- **OAuth permissions**: none — the cards retire no connect flow, and C8's edit of `TikTokAdapter.ts`
  changes no behaviour (Context 4).
- **Recipients**: none — no recipient is added or removed by these decisions; if a cloud scanner is
  activated under PREG-7, LEGAL-1 registers it as a processor (STOR-14).
- **Retention and deletion**: none — no retention period or erasure path changes; the ledger keeps
  `audit/auditService.ts` and its retention as live code (C4).
- **Consent and acceptance evidence**: PREG-6 records the acceptance of the terms, the privacy notice
  and the DPA per version as contractual evidence, separate from any consent (LEGAL-5); PREG-5's legal
  basis is set in LEGAL-1 and LEGAL-3 before the first event.
- **Controller or processor role**: none — no processing changes hands.

The section records facts for the register; it is not legal advice.

## Support impact

`none for dead-code-cards — the register under docs/support/ holds no feature page yet, so no page
lists the paths these decisions touch`

## Deployment impact

- `docs/deployment/DEPLOYMENT_CHECKLIST.md — removed: OAUTH_ENCRYPTION_KEY`, in the pull request of
  DC-3, which deletes the variable (card C3; ADR-0034 decision 13 records the same removal).
- PREG-7: `none — this ADR records decisions already taken; the ClamAV service and its scanner switch (PREG-7) get their DEPLOYMENT_CHECKLIST rows in the unit that implements them (STOR-14), per CLAUDE.md's deployment documentation flow`

## Revisit if

- The cards C8, C9, C11 and C12 receive their approval on Master Plan §5.13, or are refused: their
  deletion units follow that decision.
- A third-party consumer of the public API exists: the OAuth 2.1 tier of PREG-1 is built then.

## Risks and Mitigations

| Risk                                        | Mitigation                                                                                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A deletion drops an intention nobody mapped | Decision 1: every intention is served by live code, a row or an open question first                                                    |
| Live behaviour changes with a deletion      | Context 4: the HTTP series are replaced, the Redis list is unread, and the Redis `KEYS` call runs against a cache that is switched off |
| An undecided card is deleted early          | Its unit waits for explicit approval on Master Plan §5.13                                                                              |
| A product question is decided by omission   | Decision 4: each question was decided explicitly, nine of them after research                                                          |

## References

- [Master Plan](../product/MASTER_PLAN.md) §5.13, where these decisions were first recorded, at
  [`32e38081`](https://github.com/edwardricardo/omni-post/blob/32e38081aaed5de2c0dc565e72c468b3bcd621ce/docs/product/MASTER_PLAN_ES.md)
- [UNUSED_CODE_INVENTORY.md](../reports/UNUSED_CODE_INVENTORY.md): the inventory the cards decide on
- The cards `dead-code-decisions.md` and the mappings `c8-c10-intent-coverage.md` and
  `c1-c7-c11-c12-intent-coverage.md` (`/root/.claude/omnipost-tools/research-2026-10-05/`, outside
  the repository; engram 1269, 1271, 1273, 1275 to 1278, 1280, 1289 to 1292, 1294 and 1295), measured
  on `main` `f47f9670`; the checks in execution on `20c4e9ea`
- The product-question research `preg-market-canon.md`
  (`/root/.claude/omnipost-tools/research-2026-10-06/`, outside the repository; engram 1309, 1314 and
  1317 to 1325)

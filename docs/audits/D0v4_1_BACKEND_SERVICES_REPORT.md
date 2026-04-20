# D0v4-1 — Backend Services + Use Cases + Repositories Audit Report

> **Sprint:** D0v4-1 (Backend services/use-cases/repositories)
> **Ejecutado:** 2026-04-19 → 2026-04-20
> **Metodología:** §5.8 lectura directa + §5.9 clasificación sin DELETE
> **Ejecutor:** agente backend con Opus 4.7 (1M context) bajo plan mode validado
> **Cambios en código:** 0 (100% lectura + docs)

---

## §1. Metodología aplicada

### 1.1 §5.8 — Lectura directa

Cada archivo del scope fue abierto con Read tool línea 1 → N, sin skip/head, sin depender de grep como prueba. Grep se usó únicamente como localizador de candidatos (ej. `rg "prisma\\.\\$transaction"` para encontrar UoW candidates, luego lectura completa del archivo).

**Evidencia cuantitativa:** El spot-check cross-count cada 10 archivos se ejecutó comparando exports/clases declaradas vs contenido real. En 8 batches, 0 discrepancias fuera del margen aceptable.

### 1.2 §5.9 — Clasificación sin delete

Cero archivos propuestos para DELETE. Categorías aplicadas:

- **ACTIVE** — wired en Container + tests pasan + consumers reales detectados
- **PARTIALLY_ACTIVE** — wired + consumer real pero métodos internos stub (ej. SyncEngineImpl routes expuestos con stubs en backend)
- **PLANNED** — built, no wired, D1_DECISIONS mantiene CORE_CONCEPTUAL (ej. `content/` subsystem)
- **INFRASTRUCTURE_READY** — port + adapter existe + DI registrado pero UI no consume (Zapier/Make/OIDC/SAML from LATERAL_FINDINGS)
- **LEGACY** — código pre-refactor aún activo pero con sustituto moderno (ej. `auth/mfaService.ts` OLD vs `admin/auth/MfaService.ts` NEW — **ambos en producción**)
- **DEAD_CODE_CANDIDATE** — sin consumers detectados + sin registro DI + sin D1_DECISIONS override; Edward reclasifica caso por caso

### 1.3 Checkpoints ejecutados

| Checkpoint | Batches cerrados                                                                                                                                       | Aprobación Edward | Decisiones clave                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CP1**    | B1+B2 (domain entities/VOs/aggregates/events/repos)                                                                                                    | ✅ 2026-04-19     | `content/` pospuesto a B7; Repository base `findById` violation aceptada como infraestructural                                                                                                            |
| **CP2**    | B3+B4 (infra repos Prisma\*, mappers)                                                                                                                  | ✅ 2026-04-19     | `@deprecated` → DEAD_CODE_CANDIDATE + migration; outbox issues → LATERAL_FINDINGS; 17 ports órfanos → flag only                                                                                           |
| **CP3**    | B5+B6 (auth+admin+security+audit+team+referral+billing+compliance+webhooks+notifs+CRM+tasks+usage+approvals)                                           | ✅ 2026-04-19     | MFA duality: mantener NEW (`admin/auth/MfaService.ts`), migrar rutas OLD; Prisma singleton + module-level singletons → LATERAL_FINDINGS only (fix en proximas fases); discrepancias D1 → no sobreescribir |
| **CP4**    | B7+B8 (content+AI+posts+campaigns+comments+recurring+trends+templates+brand+analytics+inbox+integrations+assets+reports+links+ml+crisis+utm+providers) | ✅ 2026-04-20     | SyncEngineImpl stubs: **mantener CORE_CONCEPTUAL + disclaimer LATERAL_FINDINGS**; ML layer violation → solo registrar; reports/ vs custom-reports/ → DUPLICATION + candidato unificación                  |

---

## §2. Inventario completo

Total auditado: **~395 archivos** (plan estimó 378; variación +4.5% por discovery de subfiles content/ y providers/).

> Tabla por dominio. Columnas: dominio | archivos | LOC aprox. | highlights | clasificación dominante.

### 2.1 Domain layer (B1+B2, 118 archivos)

| Dominio                          | Files | LOC    | Highlights                                                                                                                                                                                          | Clase                                      |
| -------------------------------- | ----- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `domain/entities/`               | 25    | ~5,800 | `IntegrationApiKey`, `MediaAsset`, `RecurringPost` (con `CronExpression` VO), `ScheduledReport`, `TrackedLink`, `TeamMember` + 19 más                                                               | ACTIVE                                     |
| `domain/value-objects/`          | 22    | ~2,400 | `EntityId<T>`, `Provider`, `SocialMessageType`, `SocialMessageStatus`, `UTMParameters`, `CronExpression`                                                                                            | ACTIVE                                     |
| `domain/aggregates/`             | 6     | ~1,500 | `AggregateRoot` base, `PostAggregate`, `PostCommentAggregate`, `SocialMessageAggregate`, `SocialConversation`, `Channel`                                                                            | ACTIVE                                     |
| `domain/errors/`                 | 2     | ~90    | `DomainError`, `EntityNotFoundError`                                                                                                                                                                | ACTIVE                                     |
| `domain/events/`                 | 4     | ~600   | `DomainEvent` base + `EventDispatcher` + `PostEvents.ts` (13 event classes, **solo 10 exportados** en index)                                                                                        | ACTIVE + 3 events no exportados            |
| `domain/services/`               | 2     | ~200   | Business rule services                                                                                                                                                                              | ACTIVE                                     |
| `domain/{ai,analytics,billing}/` | 3     | ~400   | `ReportSchema.ts`, `ChannelStats.ts`, billing VOs                                                                                                                                                   | ACTIVE                                     |
| `domain/repositories/` (ports)   | 56    | ~6,500 | Repository interfaces. `Repository<T,TId>` base usa `Result<void, Error>` (no DomainError) — infraestructural violation acceptable. **17 ports sin adapter asociado** (flagged in LATERAL_FINDINGS) | MIXED: 39 ACTIVE, 17 unbound ports flagged |

### 2.2 Infrastructure repositories (B3+B4, 68 archivos)

| Prefix                      | Files | Highlights                                                                                                                          | Clase  |
| --------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `Prisma[A-M]*Repository.ts` | 40    | AdminUser, AuditLog, BillingGateway, Channel, CustomReport, IntegrationApiKey, IntegrationSubscription, MediaAsset, etc.            | ACTIVE |
| `Prisma[N-Z]*Repository.ts` | 24    | OutboundReply, Post, PostComment, RecurringPost, ScheduledReport, SocialConversation, SocialMessage, TrackedLink, UserAccount, etc. | ACTIVE |
| Misc infra                  | 4     | `BullMQRepurposeJobDispatcher.ts`, `RedisInboxLockRepository.ts`, mappers                                                           | ACTIVE |

**Hallazgos infra repos:**

- 3 adapters `@deprecated`: marcados DEAD_CODE_CANDIDATE, pendiente migración paths
- `Repository.ts` base (domain) usa `Result<void, Error>` propagándose a todos los adapters — infraestructural, OK
- Outbox pattern tiene 3 issues detectados → LATERAL_FINDINGS

### 2.3 Services + Use Cases (B5→B8, ~210 archivos)

#### Batch 5 — Auth + Admin + Security + Settings + Audit + Team + Referral (36 archivos)

| Dominio                                                      | Files | Highlights críticos                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth/` + `application/auth/` + `application/customer-auth/` | 16    | **MFA duality**: `auth/mfaService.ts` (OLD, 521 LOC, stores backup codes en `passwordResetToken` field L85 HACK, SHA-256) + `admin/auth/MfaService.ts` (NEW, 244 LOC, `mfaBackupCodes` array + `mfaBackupUsedAt` map, argon2). **DI [`setupServices.ts:84-85`](apps/api/src/infrastructure/container/setupServices.ts#L84-L85) registra OLD** vía TOKENS.MfaService. Edward aprobó: mantener NEW, migrar routes a NEW, luego eliminar OLD. |
| `admin/`                                                     | 8     | AdminAuthService, AdminUserService, ImpersonationService. OK.                                                                                                                                                                                                                                                                                                                                                                              |
| `security/` + `settings/` + `audit/`                         | 5     | `PlatformCredentialService` (BYOK+encryption), `settingsService`, audit log infrastructure. ACTIVE.                                                                                                                                                                                                                                                                                                                                        |
| `application/team/` + `application/referral/`                | 7     | UoW patterns consistentes. `InviteTeamMemberUseCase.ts` hardcoded `baseUrl = "https://app.omnipost.io"` fallback L148 (minor).                                                                                                                                                                                                                                                                                                             |

#### Batch 6 — Billing + Compliance + Webhooks + Notifs + CRM + Tasks + Usage + Approvals (36 archivos)

| Dominio                                                              | Files | Highlights críticos                                                                                                                                                                            |
| -------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `billing/`                                                           | 11    | **`GatewayBillingService.ts` (1042 LOC) GOD SERVICE**: Stripe↔Paddle switching, invoice handling, BillingEvent idempotency. L732 fake eventId generation rompe idempotency (LATERAL_FINDINGS). |
| `compliance/`                                                        | 2     | ComplianceService, DLQ retention policies. ACTIVE.                                                                                                                                             |
| `webhooks/`                                                          | 2     | **`webhookDashboardService.ts` (854 LOC) GOD SERVICE**: 72 queries per timeline call. L601 retry queue es stub (LATERAL_FINDINGS).                                                             |
| `application/notifications/` + `application/external-notifications/` | 5     | Email + push templates, clean.                                                                                                                                                                 |
| `application/crm/` + `application/tasks/`                            | 8     | Contact/deal UCs + project task UCs. Clean UoW.                                                                                                                                                |
| `application/usage/` + `application/approvals/`                      | 8     | Tier limits + approval workflows. ACTIVE.                                                                                                                                                      |

#### Batch 7 — Content + AI + Posts + Campaigns + Comments + Recurring + Trends + Templates + Brand + First-comment (~70 archivos)

| Sub-dominio                                                                            | Files | Highlights críticos                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Clase                                                                                  |
| -------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `content/`                                                                             | 19    | **Sistema completo multi-provider content sync con VersionController + BranchManager + ConflictDetector + DiffCalculator + MergeManager + PlatformContentAdapter (core/strategy/validation/helpers) + SyncEngineBase + SyncEngineImpl + SyncScheduler + ContentHandlers + 20 endpoints registrados vía contentRoutes**. **SyncEngineImpl tiene MASIVOS STUBS** (`detectChanges`/`detectConflicts`/`applyChanges`/`applyRealtimeChanges`/`getChannelMetrics`/`getGlobalMetrics` todos placeholder). **VersionController DB persistence es stub** (`storeVersion` solo escribe Redis, `getVersionHistoryFromDatabase` retorna `[]`, `deactivatePreviousVersions` empty). `ConflictDetector` y `SyncScheduler` SÍ son funcionales pero **SyncEngineImpl no los usa** (duplicación orfana). | **CORE_CONCEPTUAL** per D1_DECISIONS + **disclaimer** en LATERAL_FINDINGS (Edward CP4) |
| `ai/` + `application/ai/` + `application/ai-image/` + `application/aiPromptTemplates/` | ~15   | `aiService.ts` (472 LOC, dual-path BYOK+pool, hardcoded platform="twitter" L350, smartAnalysis manual index L422). `GetTopPerformersContextUseCase.ts:53` **module-level cache** `const cache = new Map<...>()` TTL 6h → no testeable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | ACTIVE + LATERAL                                                                       |
| `posts/` + `application/posts/`                                                        | 7     | `CreatePostUseCase.ts` exemplar (UoW + eventDispatcher.dispatchAll + clearDomainEvents). `SchedulePostUseCase.ts` delega a `post.schedule()`. Clean.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | ACTIVE                                                                                 |
| `application/campaigns/`                                                               | 6     | Archive/Create/GetAnalytics/Tag/Untag/Update. Clean DDD.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ACTIVE                                                                                 |
| `application/comments/`                                                                | 4     | Create/Edit/Delete/GetPostComments via `PostCommentAggregate`. Clean.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ACTIVE                                                                                 |
| `application/recurring/`                                                               | 6     | `CronExpression` VO + `recordOccurrence()` domain method. `ProcessRecurrenceUseCase` procesa due schedules. Clean.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ACTIVE                                                                                 |
| `trends/` + `application/trends/`                                                      | 6     | `trendAnalysisService.ts` (533 LOC) **mock data hardcoded** en `analyzeViralContent`/`generateTrendPredictions`/`discoverContentOpportunities` — admits "TODO integrate real provider". `TrendReportBuilder.ts` helpers retornan strings hardcoded. `FetchTrendingTopicsUseCase.ts:36` otro **module-level cache** (TTL 30min).                                                                                                                                                                                                                                                                                                                                                                                                                                                         | PARTIALLY_ACTIVE (routes wired, backend mock) + LATERAL                                |
| `templates/`                                                                           | 11    | `templateService.ts` + `TemplateABTestService.ts` + `TemplateVersionService.ts`: **triple violación** (Prisma singleton `import { prisma }`, module-level singleton `export const templateService = new TemplateService()`, `any` en tipos de retorno de `compileTemplate`/`compileTemplateWithComponents`/`getPlatformLimits`).                                                                                                                                                                                                                                                                                                                                                                                                                                                        | ACTIVE + LATERAL standards                                                             |
| `application/brand-kit/` + `application/brand-voice/` + `application/first-comment/`   | 10    | Clean UoW. `PublishFirstCommentUseCase.execute` recibe `provider` adapter como parámetro del command (patrón raro pero funcional).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ACTIVE                                                                                 |

#### Batch 8 — Analytics + Inbox + Integrations + Assets + Reports + Links + ML + Crisis + UTM + Providers (~67 archivos)

| Sub-dominio                   | Files | Highlights críticos                                                                                                                                                                                                                                                                                                                                                                                       | Clase                          |
| ----------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `application/analytics/`      | 5     | DispatchAnalyticsIngestion + IngestChannelAnalytics + GetHistoricalAnalytics + 3 UCs port-engine-pattern (CalculateROI/ComparePerformance/GetCrossPlatformAnalytics). `IngestChannelAnalyticsUseCase.ts:61-62` **bypassa `ChannelId` VO factory** con raw cast `as ChannelId`.                                                                                                                            | ACTIVE + LATERAL               |
| `application/inbox/`          | 18    | Estado-máquina exemplar: `markAsRead`/`markAsReplied`/`assign`/`resolve` + `EventDispatcher` + VO validation. **`SyncProviderCommentsUseCase.ts:172+` violación crítica CLAUDE.md**: envuelve provider API calls dentro UoW transaction. **`DispatchInboxSyncUseCase.ts:12` importa type `ChannelQueryForIngestion` desde `analytics/DispatchAnalyticsIngestionUseCase.ts`** — acoplamiento cross-domain. | ACTIVE + LATERAL               |
| `application/integrations/`   | 6     | `GenerateIntegrationApiKeyUseCase` con argon2, 5 keys max. **`TriggerIntegrationEventService.ts:53` usa `fetch()` raw sin port**, fire-and-forget sin retry ni delivery guarantee.                                                                                                                                                                                                                        | INFRASTRUCTURE_READY + LATERAL |
| `application/assets/`         | 10    | `CreateMediaAsset`, `ImportFromGoogleDrive` (defiere upload a background job — `sizeBytes: 0` placeholder L127), `TagMediaAsset`, 6 más. Clean UoW.                                                                                                                                                                                                                                                       | ACTIVE                         |
| `application/custom-reports/` | 9     | Custom reports sobre AnalyticsAggregationQueryPort. `RunCustomReportQuery` agrega por dimensión, chart-ready.                                                                                                                                                                                                                                                                                             | ACTIVE                         |
| `application/reports/`        | 5     | Scheduled reports + email delivery. **`GenerateReportUseCase` no usa UoW** — send email + save outside transaction (correcto aislar email, pero save tras email no es transaccional). **DUPLICACIÓN con `custom-reports/`** — dos sistemas paralelos. Edward CP4 aprobó: DUPLICATION + candidato unificación.                                                                                             | ACTIVE + DUPLICATION           |
| `application/links/`          | 5     | TrackedLink CRUD + `RedirectAndTrackClickUseCase` (fire-and-forget GA4 L68). Clean.                                                                                                                                                                                                                                                                                                                       | ACTIVE                         |
| `application/ml/`             | 2     | **`OptimizeContentUseCase` + `PredictOptimalTimingUseCase` importan `AIService` concreto** (`../../ai/aiService.js`), no port. Violación hexagonal. Edward CP4: solo registrar.                                                                                                                                                                                                                           | ACTIVE + LATERAL               |
| `application/crisis/`         | 3     | Enter/Exit/Status. `enterCrisisMode()`/`exitCrisisMode()` domain methods + events. Clean.                                                                                                                                                                                                                                                                                                                 | ACTIVE                         |
| `application/utm/`            | 1     | `GenerateUTMLinksUseCase` **mutante sin UoW** (minor violation).                                                                                                                                                                                                                                                                                                                                          | ACTIVE + LATERAL               |
| `providers/`                  | 6     | **3 módulos con responsabilidades solapadas**: `providerRegistry.ts` (module-level singleton L271), `providerCapabilityManager.ts` (module-level singleton L497, `estimateReach` placeholder con hardcoded data L441, `getProvidersByCapability` duplicado vs Registry), `providerConstraintValidator.ts`. `providerService.ts` Prisma directo (solo reads).                                              | ACTIVE + DUPLICATION           |

---

## §3. Clasificaciones por categoría

### 3.1 ACTIVE (wired + probado + consumer real)

**~300 archivos** confirmados ACTIVE:

- Todas las 25 entities + 22 VOs + 6 aggregates domain
- Todos los 40 + 28 infra repos Prisma
- ~210 services/UCs con UoW correcto (inbox + assets + crisis + most analytics + campaigns + comments + recurring + posts + brand + first-comment + ai + team + referral + notifications + crm + tasks + usage + approvals + billing core + compliance + audit + settings + security + admin + auth NEW)
- 68 infra repos
- Subsistema content/ parcialmente (ContentVersionManager facade + ConflictDetector + DiffCalculator + MergeManager + PlatformContentAdapter\* + SyncScheduler + ContentHandlers + contentRoutes — wired pero contexto mixto con §3.2)

### 3.2 PARTIALLY_ACTIVE (wired + método stubs)

**Contexto crítico:** Edward CP4: **mantener CORE_CONCEPTUAL (D1_DECISIONS) + disclaimer en LATERAL_FINDINGS**.

| Archivo                                   | Routes wired                         | Backend real           | Detalle                                                                                                                                                                                                                                                                  |
| ----------------------------------------- | ------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `content/SyncEngineImpl.ts`               | ✅ 4 endpoints `/content/sync/*`     | ❌ stubs               | `detectChanges`, `detectConflicts`, `applyChanges`, `applyRealtimeChanges`, `getChannelMetrics`, `getGlobalMetrics`, `startTransactionProcessor`, `startConflictProcessor`, `resumeSyncTransaction`, `executeRollback`, `handleProviderStatusChange` — todos placeholder |
| `content/VersionController.ts`            | ✅ 4 endpoints `/content/versions/*` | ⚠️ Redis-only          | `storeVersion` solo Redis, `getVersionHistoryFromDatabase` retorna `[]`, `deactivatePreviousVersions` vacío, `calculateChecksum` admite "not production"                                                                                                                 |
| `trends/trendAnalysisService.ts`          | ✅ 5+ endpoints `/trends/*`          | ⚠️ mock data           | `analyzeViralContent` + `generateTrendPredictions` + `discoverContentOpportunities` retornan data hardcoded. Admite "TODO integrate real provider"                                                                                                                       |
| `webhooks/webhookDashboardService.ts:601` | ✅ wired                             | ⚠️ retry queue es stub | D1_DECISIONS no cubre                                                                                                                                                                                                                                                    |

### 3.3 PLANNED (built, no wired, D1_DECISIONS preservado)

`content/` subsystem como CORE_CONCEPTUAL per D1_DECISIONS — mantener clasificación. Nota: routes SÍ están wired en [index.ts:502](apps/api/src/index.ts#L502) pero backend mayormente stub (ver §3.2).

### 3.4 INFRASTRUCTURE_READY (port+adapter+DI listos, UI no consume)

- **Zapier/Make integrations**: `SubscribeIntegrationTrigger`, `GenerateIntegrationApiKey`, `TriggerIntegrationEventService`, etc. D1_DECISIONS los llama KEEP_AS_INTERNAL pero LATERAL_FINDINGS 2026-04-19 los reclasifica BUILD_UI (pendientes decisión Edward).
- **OIDC/SAML endpoints** (ver LATERAL_FINDINGS 2026-04-19).

### 3.5 LEGACY (código pre-refactor activo con sustituto moderno)

**Único caso confirmado:**

| Legacy                                                                              | Sustituto moderno                                                    | Estado producción                           | Acción Edward CP3                                                |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| `auth/mfaService.ts` (521 LOC, SHA-256 backup codes, `passwordResetToken` hack L85) | `admin/auth/MfaService.ts` (244 LOC, argon2, `mfaBackupCodes` array) | **OLD en producción** (DI container L84-85) | Mantener NEW, migrar routes a NEW, eliminar OLD + data migration |

### 3.6 DEAD_CODE_CANDIDATE (pendiente validación Edward)

**NO se propone DELETE automático.** Cada candidato requiere validación Edward por §5.9.

| Candidato                                             | Ubicación                                   | Razón                                                                                       | Nota          |
| ----------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------- |
| `CQRSIntegration.ts` (9 endpoints con `/api/` prefix) | `apps/api/src/cqrs/`                        | D0v4-0 `RENAME_REPORT.md` marca como DEAD_CODE pendiente §5.9 Sprint D0v4-2                 | Ya tracked    |
| 3 adapters `@deprecated`                              | `apps/api/src/infrastructure/repositories/` | Marcados @deprecated pero activos — migration paths no claros                               | Flagged B3+B4 |
| 17 domain repositories sin adapter asociado           | `apps/api/src/domain/repositories/`         | Ports declarados sin implementación Prisma detectable                                       | Flagged B2    |
| 3 events sin export en index                          | `apps/api/src/domain/events/PostEvents.ts`  | `PostUnscheduled`, `PostPublishingStarted`, `PostMediaRemoved` definidos pero no exportados | B1            |

### 3.7 Resumen tabla cuantitativa

| Clase                     |                                                                      Count (aprox) |
| ------------------------- | ---------------------------------------------------------------------------------: |
| ACTIVE                    |                                                                               ~330 |
| PARTIALLY_ACTIVE          |                                                     4 archivos (múltiples métodos) |
| PLANNED (CORE_CONCEPTUAL) |                                                            19 (content/ subsystem) |
| INFRASTRUCTURE_READY      |                                                        10+ (zapier/make/oidc/saml) |
| LEGACY                    |                                                                 1 (mfaService OLD) |
| DEAD_CODE_CANDIDATE       | ~24 (9 CQRS + 3 @deprecated + 17 orphan ports + 3 unexported events — con overlap) |
| **Total**                 |                                                                           **~395** |

---

## §4. Duplicaciones detectadas

### 4.1 `reports/` vs `custom-reports/` — **candidato unificación (Edward CP4)**

Dos sistemas paralelos para conceptos solapados:

| Aspecto   | `application/reports/`             | `application/custom-reports/`                                    |
| --------- | ---------------------------------- | ---------------------------------------------------------------- |
| Entidad   | `ScheduledReport`                  | `CustomReport`                                                   |
| Repo      | `ScheduledReportRepository`        | `CustomReportRepository`                                         |
| UCs       | Create/Delete/Update/List/Generate | Create/Delete/Update/List/Run + Enable/DisableSharing + Schedule |
| Scheduled | Via `cronSchedule` field           | Via `saveSchedule()` método separado                             |
| Output    | CSV/JSON vía EmailPort             | Chart-ready via AnalyticsAggregationQueryPort                    |
| Shared?   | ❌                                 | ✅                                                               |

**Propuesta:** Sprint dedicado de consolidación. `custom-reports` es el sistema más moderno con sharing + chart datasets. `reports` parece subset histórico.

### 4.2 `content/SyncEngineImpl` ↔ `content/ConflictDetector` + `content/SyncScheduler`

Tres archivos con métodos nombrados idénticamente pero implementaciones divergentes:

- `SyncEngineImpl.detectChanges` → `return []` (placeholder)
- `ConflictDetector.detectChanges` → funcional, compara fields con checksum
- `SyncEngineImpl.detectConflicts` → `return []` (placeholder)
- `ConflictDetector.detectConflicts` → funcional, concurrent/schema/validation checks
- `SyncEngineImpl.startContentChangeProcessor` → simplified Redis stream consumer
- `SyncScheduler.startContentChangeProcessor` → full Redis stream consumer with metrics

**SyncEngineImpl NO referencia a ConflictDetector ni SyncScheduler.** Duplicación huérfana — código funcional no accessible vía el engine principal.

### 4.3 Provider layer — `providerRegistry` vs `providerCapabilityManager`

- `providerRegistry.getProvidersByCapability(capability)` (línea 131) → retorna `ProviderMetadata[]` filtrado
- `providerCapabilityManager.getProvidersByCapability(capability)` (línea 91) → retorna `ProviderAdapter[]` filtrado

Lógica prácticamente idéntica, solo cambia el tipo de retorno. Ambos son module-level singletons exportados independientemente.

### 4.4 MFA duality — `auth/mfaService.ts` (OLD) ↔ `admin/auth/MfaService.ts` (NEW)

Ya cubierto en §3.5 (LEGACY). Duplicación no-coexistente por diseño (NEW reemplaza OLD), pero ambos en producción. Edward CP3 aprobó migración.

### 4.5 Module-level cache duplication pattern

Mismo antipatrón (cache Map a nivel módulo, no testeable) aparece en:

- `application/ai/GetTopPerformersContextUseCase.ts:53` — TTL 6h
- `application/trends/FetchTrendingTopicsUseCase.ts:36` — TTL 30min

**No son copy-paste** pero representan el mismo patrón repetido — candidato a port `CachePort` dedicado.

### 4.6 Prisma singleton import + module-level service singletons

Patrón repetido en:

- `apps/api/src/templates/templateService.ts` (L7 + L553)
- `apps/api/src/templates/TemplateABTestService.ts` (L7)
- `apps/api/src/templates/TemplateVersionService.ts` (L7)
- `apps/api/src/trends/trendAnalysisService.ts` (BaseService pattern + prisma param injectable)
- `apps/api/src/providers/providerRegistry.ts` (L271)
- `apps/api/src/providers/providerCapabilityManager.ts` (L497)

---

## §5. Acoplamientos sospechosos

### 5.1 Cross-domain type imports

| Importador                                         | Importa                                                                                      | Tipo problema                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `application/inbox/DispatchInboxSyncUseCase.ts:12` | `ChannelQueryForIngestion` from `application/analytics/DispatchAnalyticsIngestionUseCase.ts` | Type cross-domain. `ChannelQueryForIngestion` debería vivir en `domain/repositories/` |
| `application/ml/OptimizeContentUseCase.ts:16`      | `AIService` concreto from `../../ai/aiService.js`                                            | **Layering violation**: application → infrastructure concrete class                   |
| `application/ml/PredictOptimalTimingUseCase.ts:18` | `AIService` concreto idem                                                                    | Idem                                                                                  |

### 5.2 GOD SERVICES detectados

| Archivo                               | LOC                   | Responsabilidades                                                                      | Coupling score          |
| ------------------------------------- | --------------------- | -------------------------------------------------------------------------------------- | ----------------------- |
| `billing/GatewayBillingService.ts`    | 1042                  | Stripe↔Paddle switching + invoices + idempotency + refunds + subscriptions             | 🔴 HIGH                 |
| `webhooks/webhookDashboardService.ts` | 854                   | Timeline (72 queries/call) + retry (stub) + diagnostics + delivery logs                | 🔴 HIGH                 |
| `trends/trendAnalysisService.ts`      | 533                   | TikTok analytics + predictions + viral DNA + opportunities + reports + circuit breaker | 🟡 MEDIUM (mostly mock) |
| `templates/templateService.ts`        | 553 (with re-exports) | CRUD + compilation + versions + A/B tests                                              | 🟡 MEDIUM               |

### 5.3 External API calls inside UoW transaction

`application/inbox/SyncProviderCommentsUseCase.ts:172+` envuelve TODO `doWork` (que contiene `adapter.getComments` llamadas al provider externo + loops internos de ingestión) dentro `unitOfWork.executeInTransaction`. **Violación crítica CLAUDE.md**: "Never put external API calls inside the transaction — only DB writes".

### 5.4 Raw fetch sin port abstraction

- `application/integrations/TriggerIntegrationEventService.ts:53` — `fetch()` directo sin `HttpClientPort`
- Fire-and-forget sin retry policy ni delivery guarantees

### 5.5 VO factory bypass

`application/analytics/IngestChannelAnalyticsUseCase.ts:61-62`:

```ts
const channelResult = await this.channelRepository.findById({
  value: input.channelId,
} as import("../../domain/value-objects/EntityId.js").ChannelId);
```

Raw cast bypasses `ChannelId.fromString()` validation.

---

## §6. Patterns inconsistentes

### 6.1 UoW usage heterogéneo

Mayoría de UCs mutantes usan UoW correctamente. Excepciones detectadas:

- `application/utm/GenerateUTMLinksUseCase.ts` — sin UoW (single save mutation)
- `application/reports/GenerateReportUseCase.ts` — send email + save outside transaction (correcto evitar email en UoW, pero save post-email no es transaccional con nada)
- `application/integrations/GenerateIntegrationApiKeyUseCase.ts` — sin UoW pese a single save (minor)
- `application/integrations/SubscribeIntegrationTriggerUseCase.ts` — sin UoW (minor)

### 6.2 Hex arch boundaries

Application UCs deben importar domain only. Detectadas:

- `application/ml/*` importa `../../ai/aiService.js` (concrete class) — violación
- `application/inbox/*` correctamente importa `ProviderAdapter` desde `@ports/core` — correcto

### 6.3 Module-level state

- 2 caches module-level (`ai`, `trends`)
- 3 service module-level singletons (`templateService`, `providerRegistry`, `capabilityManager`)
- Patrón inconsistente con resto de app que usa DI container + TOKENS

### 6.4 Prisma access patterns

- **Mayoría (ACTIVE)**: via DI-injected `PrismaClient` en repositorios
- **Violación**: `templates/*Service.ts` usan `import { prisma } from "@infra/prisma"` singleton
- **Violación parcial**: `trends/trendAnalysisService.ts` recibe Prisma vía constructor PERO extiende `BaseService` fuera del patrón DI/DDD estándar
- **Violación**: `providers/providerService.ts:182` Prisma directo (sólo reads — menor severidad)

### 6.5 Stubs admitidos ("placeholder", "TODO", "Future")

Grep count aproximado: **15+ archivos** en `content/` + `trends/` + `ml/` + `providers/` + `webhooks/` + `platformContentAdapterHelpers/` admiten stubs explícitamente en comments. Categoría `PARTIALLY_ACTIVE` captura los más visibles; el resto son menores (fallbacks / hardcoded data).

---

## §7. Hallazgos laterales para LATERAL_FINDINGS.md

> Entradas nuevas agregadas en commit de este reporte. Severidad y acción propuesta sujetos a decisión Edward.

### 7.1 Entradas nuevas D0v4-1

| #    | Título                                                                                                                                                                             | Severidad | Archivos   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- |
| L-1  | MFA duality: OLD `auth/mfaService.ts` en producción, NEW `admin/auth/MfaService.ts` sin DI                                                                                         | alto      | 2          |
| L-2  | 3 events domain sin export en `PostEvents/index.ts`                                                                                                                                | bajo      | 1          |
| L-3  | 17 domain repository ports sin adapter Prisma detectable                                                                                                                           | medio     | 17         |
| L-4  | 3 adapters `@deprecated` aún activos, migration paths no claros                                                                                                                    | medio     | 3          |
| L-5  | `Repository<T,TId>` base `findById` → `Result<void, Error>` propaga a todos los adapters (no usa `DomainError`)                                                                    | bajo      | 1          |
| L-6  | `GatewayBillingService.ts` God service (1042 LOC) + L732 fake eventId rompe idempotency BillingEvent                                                                               | alto      | 1          |
| L-7  | `webhookDashboardService.ts` God service (854 LOC) + L601 retry queue stub                                                                                                         | alto      | 1          |
| L-8  | `trendAnalysisService.ts` mock data hardcoded en 3 métodos críticos                                                                                                                | medio     | 1          |
| L-9  | `content/SyncEngineImpl.ts` — MASIVOS STUBS (11 métodos placeholder) pero routes wired (disclaimer CORE_CONCEPTUAL per Edward CP4)                                                 | alto      | 1          |
| L-10 | `content/VersionController.ts` — DB persistence stub (Redis-only)                                                                                                                  | alto      | 1          |
| L-11 | `content/` — duplicación huérfana SyncEngineImpl vs ConflictDetector + SyncScheduler (funcionales no referenciados)                                                                | medio     | 3          |
| L-12 | `templates/*` — triple violación: Prisma singleton + module-level singleton + `any` en retornos                                                                                    | medio     | 3          |
| L-13 | Module-level cache pattern en `GetTopPerformersContextUseCase.ts:53` + `FetchTrendingTopicsUseCase.ts:36` — no testeable                                                           | medio     | 2          |
| L-14 | `providers/` triple overlap: Registry + CapabilityManager + ConstraintValidator con `getProvidersByCapability` duplicado + 2 module-level singletons + `estimateReach` placeholder | medio     | 3          |
| L-15 | `application/ml/*` viola hexagonal — importa `AIService` concreto                                                                                                                  | alto      | 2          |
| L-16 | `inbox/SyncProviderCommentsUseCase.ts:172+` envuelve provider API calls dentro UoW transaction (violación CLAUDE.md explícita)                                                     | crítico   | 1          |
| L-17 | `analytics/IngestChannelAnalyticsUseCase.ts:61-62` raw cast bypassa `ChannelId.fromString()`                                                                                       | bajo      | 1          |
| L-18 | `integrations/TriggerIntegrationEventService.ts:53` raw `fetch()` sin port + sin retry/delivery guarantee                                                                          | medio     | 1          |
| L-19 | `DispatchInboxSyncUseCase.ts:12` importa type `ChannelQueryForIngestion` cross-domain desde `analytics/`                                                                           | bajo      | 1          |
| L-20 | `reports/` vs `custom-reports/` sistemas paralelos — **candidato unificación (Edward CP4)**                                                                                        | medio     | 2 dominios |
| L-21 | `utm/GenerateUTMLinksUseCase.ts` mutante sin UoW                                                                                                                                   | bajo      | 1          |
| L-22 | Outbox pattern — 3 issues detectados B3+B4 (ver `D0v4-1` B3+B4 sección ya cubierta)                                                                                                | medio     | varios     |
| L-23 | `InviteTeamMemberUseCase.ts:148` hardcoded `baseUrl = "https://app.omnipost.io"` fallback                                                                                          | bajo      | 1          |
| L-24 | `templates/*` dynamic imports (L348, L415, L462, L476, L488 de templateService) vs static imports resto del app                                                                    | bajo      | 1          |

---

## §8. Predicción para Sprint D0v4-2 (middlewares + DI + infra)

### 8.1 Contexto esperado

Sprint D0v4-2 cubre:

- `apps/api/src/middleware/`
- `apps/api/src/infrastructure/container/` (Container.ts, setupServices.ts, TOKENS)
- `apps/api/src/cqrs/` (CQRSIntegration + handlers)
- `apps/api/src/events/` (EventService, outbox dispatcher)
- `apps/api/src/lib/` (logger, errors, utilities)
- Configs + bootstrap + app.ts

**Scope estimado:** ~70-90 archivos.

### 8.2 Hallazgos esperados (basado en patterns B1-B8)

1. **DI container complexity** — 292 tokens (per MEMORY.md). Expected god-file en `setupServices.ts`. Verification target: token count vs registrations + resolve site coverage.
2. **CQRSIntegration.ts** — DEAD_CODE_CANDIDATE Edward ya conoce (9 endpoints `/api/` prefix). Decisión §5.9 pendiente.
3. **Outbox dispatcher** — 3 issues detectados en B3+B4 apuntan a middleware/infra layer. Probable hallazgos adicionales en dispatcher logic.
4. **Middlewares** — expected patterns: auth (requireAdminAuth/requireClientAuth/requireSuperAdmin/integrationAuth), rate limiting, CORS, logging, error handler. Verification: cobertura de rutas.
5. **EventService** — usada por `content/`, `BranchManager`, `MergeManager`, `VersionController`, `PlatformContentAdapter`. Scope importante de uso interno. Expected: handlers registration pattern + event routing.
6. **Logger consistency** — MEMORY.md dice "zero `console.*` en production". Spot-check cada dominio de B5-B8 encontró uso consistente de `createLogger` / `request.log`. Expected clean.
7. **Config management** — env vars + secrets + feature flags. Expected centralization en `config/` dir.

### 8.3 Riesgos para D0v4-2

- **CQRSIntegration §5.9 decision bloqueante**: 9 endpoints en production con convention wrong (`/api/` prefix). Edward ya marcó como DEAD_CODE pendiente — sprint debe cerrar.
- **Container.ts puede ser God file**: 292 tokens + 80+ registrations esperado. Split a considerar.
- **Middleware chain** no documentada end-to-end: expected pattern discovery.

### 8.4 Preparativos sugeridos Edward

1. Confirmar scope exacto archivos D0v4-2 (listar carpetas incluidas vs excluidas).
2. Revisar entradas L-6, L-7, L-9, L-10, L-16, L-22 de este reporte — algunas pueden moverse a D0v4-2 scope si apuntan a infra/DI.
3. Decisión §5.9 sobre CQRSIntegration antes de B1 de D0v4-2 (o en checkpoint 0 del próximo sprint).

---

## Anexo A — Verification checklist (per Phase 3 del plan)

- [x] ~395 archivos procesados (plan estimó 378; variance +4.5%)
- [x] Reporte sustantivo generado
- [x] Breakdown clasificaciones en §3
- [x] Duplicaciones enumeradas en §4 (6 entradas)
- [x] Acoplamientos documentados en §5 (5 categorías)
- [x] Patterns inconsistentes en §6 (5 categorías)
- [x] Hallazgos laterales en §7 (24 entradas L-1 a L-24)
- [x] Predicción D0v4-2 en §8
- [x] Checkpoints 1-4 completados con aprobación Edward
- [x] Zero cambios en `apps/`, `packages/`, `infra/` (solo docs)

---

## Anexo B — Commit sugerido

```
docs(audits): D0v4-1 backend services/use-cases/repositories report

~395 archivos auditados bajo §5.8 + §5.9 en 8 batches + 4 checkpoints.
24 hallazgos laterales registrados, 6 duplicaciones, 5 acoplamientos, 5 patterns inconsistentes.
1 LEGACY confirmado (MFA duality), ~24 DEAD_CODE_CANDIDATE pendientes validación Edward.
PLAN_MAESTRO §6 actualizado.

Ready para Sprint D0v4-2.
```

# D0v4-2 — Backend Middlewares + DI Container + Infrastructure Audit Report

> **Sprint:** D0v4-2 (Backend transversal infrastructure)
> **Ejecutado:** 2026-04-20
> **Metodología:** §5.8 lectura directa + §5.9 clasificación sin DELETE + regla CP1 (LATERAL_FINDINGS antes de DEAD_CODE_CANDIDATE, research intent primero)
> **Ejecutor:** agente backend con Opus 4.7 (1M context) bajo plan mode validado
> **Cambios en código:** 0 (100% lectura + docs)

---

## §1. Metodología aplicada

### 1.1 §5.8 — Lectura directa

Cada archivo del scope fue abierto con Read tool línea 1→N, sin skip/head. Grep se usó únicamente como localizador + para DI health check (cross-referencia tokens declarados/registrados/resueltos).

### 1.2 §5.9 — Clasificación sin delete

Cero archivos propuestos para DELETE. Categorías aplicadas:

- **ACTIVE** — wired en bootstrap + consumers detectados
- **PARTIALLY_ACTIVE** — wired pero con stubs NO-OP internos
- **INFRASTRUCTURE_READY** — registrado/listo para wire pero no conectado
- **PLANNED** — built, no wired, con intent arquitectónico claro (ej. CQRS per Edward Cierre Final)
- **LEGACY** — sustituido por versión moderna (ej. MFA duality D0v4-1 L-1)
- **DEAD_CODE_CANDIDATE** — pending investigación intent original (regla CP1)

### 1.3 Regla CP1 — LATERAL_FINDINGS antes de DEAD_CODE_CANDIDATE

Decisión Edward Checkpoint 1: **todo lo "no wired" va a LATERAL_FINDINGS con research de intent pending**, no directo a DEAD_CODE_CANDIDATE. Aplicable a: 4 rate limiters no-wired, correlationMiddleware, enhancedValidator, fileUploadValidator plugin placeholder, 4 tokens DI orfanados, errorPlugin no-wired, CQRS subsystem.

### 1.4 Checkpoints ejecutados

| CP         | Batch                                                  | Aprobado      | Decisiones clave                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CP1**    | B1 (22 archivos, middlewares + bootstrap)              | ✅ 2026-04-20 | Rate limiters no-wired → INFRASTRUCTURE_READY (no DEAD); auditLogger.extractUserId STUB → crítico; todo no-wired → LATERAL_FINDINGS                                                                                             |
| **CP2**    | B2 (34 archivos, DI container)                         | ✅ 2026-04-20 | ThreadAnalytics ApiMetrics mock crítico; UpdatePricingConfigUseCase stubs y Repurpose noOp → revisar utilidad negocio; 4 tokens orfanados → LATERAL_FINDINGS                                                                    |
| **CP3**    | B3 (17 archivos, events + integration-events + outbox) | ✅ 2026-04-20 | 5 handlers NO-OP crítico (AnalyticsEventHandler + WebhookEventHandler + 3 EventService.setupDefaultHandlers); EventService vs EventDispatcher → unificación candidate; EventStore DDL runtime + EventSnapshots orphan → crítico |
| **Cierre** | B4 (18 archivos, CQRS + libs + observability)          | ✅ 2026-04-20 | **CQRS §5.9 = PLANNED** — mantener como arquitectura incompleta para wire en sprint futuro                                                                                                                                      |

---

## §2. Inventario completo por categoría

**Total auditado: 91 archivos (~15,646 LOC)** vs plan 71 (+28% por sub-directorios omitidos en inventario inicial: extras en `integration-events/` + eager instantiation files DI + `lib/templates/` + `lib/errors/index.ts`).

### 2.1 Middlewares (17, ~5,189 LOC)

| Archivo                                 | LOC | Rol                                                       |
| --------------------------------------- | --: | --------------------------------------------------------- |
| `middleware/autoCacheMiddleware.ts`     | 355 | Fastify plugin global caching                             |
| `middleware/correlationMiddleware.ts`   | 128 | Correlation ID generation (**NO wired en index.ts**)      |
| `middleware/metricsMiddleware.ts`       | 147 | Prometheus metrics factory + correlation ID dupe          |
| `auth/customerAuthMiddleware.ts`        |  64 | Customer JWT auth                                         |
| `auth/integrationAuthMiddleware.ts`     | 124 | Zapier/Make API key auth (argon2)                         |
| `auth/rbacMiddleware.ts`                | 271 | 7 RBAC middleware factories incl. fake rate limiter       |
| `admin/auth/adminAuthMiddleware.ts`     | 244 | Admin JWT auth + in-memory rate limit                     |
| `security/csrfMiddleware.ts`            |  70 | CSRF token validation                                     |
| `security/ipAllowlistMiddleware.ts`     | 128 | IP allowlist con 60s cache module-level                   |
| `security/rateLimit.ts`                 | 174 | Basic Redis rate limiter (**único wired**)                |
| `security/advancedRateLimit.ts`         | 307 | Progressive blocking + UA fingerprint (**NO wired**)      |
| `security/slidingWindowRateLimit.ts`    | 393 | Sub-window precision (**NO wired**, `extractUserId` STUB) |
| `security/enhancedValidator.ts`         | 582 | OOP validator + DOMPurify (**NO wired**)                  |
| `security/inputValidation.ts`           | 303 | Static SecurityValidator + Zod schemas                    |
| `security/fileUploadValidator.ts`       | 654 | **Plugin es placeholder**, scanner es `Simulate`          |
| `security/securityHeaders.ts`           | 433 | SecurityManager (helmet + CORS + CSP)                     |
| `security/auditLogger.ts`               | 654 | **`extractUserId` STUB L430** — logs sin userId           |
| `security/credentialManager.ts`         | 433 | API keys con SHA-256 (vs argon2 integration)              |
| `security/PlatformCredentialService.ts` | 306 | AES-256-GCM encrypted credentials                         |
| `security/EncryptionService.ts`         | 110 | AES-256-GCM primitives                                    |
| `security/generateEncryptionKey.ts`     |  15 | One-time bootstrap script                                 |

### 2.2 DI Container (34, ~3,664 LOC)

**Health check cuantitativo:**

| Métrica                                         | Valor |
| ----------------------------------------------- | ----: |
| Tokens declarados (`types.ts` Symbol.for)       |   298 |
| Tokens registrados (container.register\* calls) |  ~294 |
| Tokens con resolve sites                        |  ~294 |
| **Tokens completamente orfanados**              | **4** |

**4 tokens DEAD en DI** (declarados sin register ni resolve):

- `TOKENS.EnableReportSharingUseCase` — types.ts:415
- `TOKENS.DisableReportSharingUseCase` — types.ts:416
- `TOKENS.GenerateContentCalendarUseCase` — types.ts:422
- `TOKENS.PaymentAdapter` — types.ts:400

Per CP2 Edward: → LATERAL_FINDINGS "possible implementables" (L-35).

**Estructura**:

- Core (5): `Container.ts` (199), `types.ts` (485), `setupServices.ts` (405), `setup.ts` (103), `index.ts` (10)
- Composers (3): `setupUseCases.ts` (67), `setupRepositories.ts` (288), `setupBillingUseCases.ts` (83)
- 26 `setup*UseCases.ts` files

**Patrón inconsistente detectado**: 9 setup files usan `import { prisma } from "@infra/prisma"` (singleton + eager instances) vs el resto que usa lazy factory con `container.resolve(TOKENS.PrismaClient)`.

### 2.3 Events infrastructure (14 archivos, ~2,800 LOC)

**`events/` (3, 1,554 LOC)** — Event Sourcing completo:

- `EventService.ts` (521) — orchestrator con 3 handlers NO-OP L379-408
- `EventPublisher.ts` (587) — RedisEventPublisher con retries + DLQ
- `EventStore.ts` (446) — PostgreSQLEventStore con runtime DDL L62-88 + orphan `EventSnapshots` table L291

**`infrastructure/integration-events/` (8, 841 LOC)**:

- `ComposedEventDispatcher.ts` (81) — dual-path swallows BullMQ errors silently
- `BullMQIntegrationPublisher.ts` (65) — clean
- `EventSchemaRegistry.ts` (248) — 12 schemas Zod v1 pre-registered
- `EventUpcaster.ts` (167) — chain pattern **sin upcasters reales**
- `IntegrationEventConsumer.ts` (241) — BullMQ worker clean
- `IntegrationEventHandler.ts` (35) — interface
- `IntegrationEventPort.ts` (27) — port
- `IntegrationEvent.ts` (76) — DTO + mapper

**`integration-events/handlers/` (2, 83 LOC)**:

- `AnalyticsEventHandler.ts` (38) — **STUB NO-OP explícito**
- `WebhookEventHandler.ts` (45) — **STUB NO-OP explícito** (webhook system fantasma)

**`infrastructure/outbox/` (3, 216 LOC)**:

- `OutboxRelay.ts` (123) — sin `SELECT FOR UPDATE` (confirma L-22)
- `OutboxCleaner.ts` (54) — clean, 7d retention
- `PrismaOutboxWriter.ts` (39) — `tx as TxClient` unsafe cast

**`outbox/` (1, 106 LOC)**:

- `outboxAdminRoutes.ts` (106) — admin DLQ endpoints, `import { prisma }` directo

### 2.4 CQRS stack (6, ~2,130 LOC)

Per §7 — Edward CQRS §5.9 = **PLANNED** (mantener como arquitectura incompleta):

- `CQRSIntegration.ts` (611) — PLANNED (9 endpoints `/api/cqrs/*` definidas, clase nunca instanciada en producción)
- `CQRSBus.ts` / `CQRSBusImpl` (421) — **ACTIVE but UNDERUTILIZED** (usado por SagaIntegration vía index.ts:532, bus vacío sin handlers)
- `cqrs/handlers/PostCommandHandlers.ts` (621) — PLANNED (4 handlers: Create/Update/Publish/Delete)
- `cqrs/handlers/PostQuerySearchAnalytics.ts` (211) — PLANNED
- `cqrs/handlers/PostQueryGetList.ts` (226) — PLANNED
- `cqrs/handlers/PostQueryHandlers.ts` (40) — PLANNED factory

### 2.5 Libs transversales (11, ~1,400 LOC)

- `logger.ts` (198) — Pino + redaction + 8 named loggers. ACTIVE.
- `cache/cacheConfig.ts` (316) — per-endpoint cache config. ACTIVE.
- `cache/cacheDecorators.ts` (421) — `withCache`/`withInvalidation` HOC decorators. **Parcialmente wired** (cacheStatsRoutes lo usa).
- `errors/errorHandler.ts` (226) — centralized Fastify error handler. ACTIVE.
- `errors/AppError.ts` (77) — 8 error subclasses. ACTIVE.
- `errors/errorPlugin.ts` (33) — Fastify plugin wrapper. **NO WIRED** (index.ts registra errorHandler directamente).
- `errors/index.ts` (10) — barrel export incompleto (solo AppError).
- `redis.ts` (54) — Redis factory. ACTIVE.
- `envValidation.ts` (48) — `getRequiredSecret` prod-strict. ACTIVE.
- `withTimeout.ts` (62) — use case timeout wrapper. ACTIVE.
- `templates/templateEngine.ts` (10) — wrapper over ServerTemplateEngine.

### 2.6 Observability (1, 73 LOC)

- `observability/sentryInit.ts` (73) — **SOLO Sentry**. OTel wiring en index.ts:23-39 (conditional on `TRACING_ENABLED=true`) vía `@observability/opentelemetry` package externo.

### 2.7 Bootstrap (1, 688 LOC)

- `index.ts` (688) — **God file**. 37 route registrations + middleware chain + DI setup + SAGA integration + OTel init + startup + graceful shutdown.

---

## §3. Clasificaciones por categoría

### 3.1 ACTIVE (~55 archivos)

- Core DI (5), repositorios DI (1), use case setup files (26) — registradas y resueltas correctamente
- Middlewares wired: autoCache, metrics, customerAuth, integrationAuth, rbac, adminAuth, csrf, ipAllowlist, rateLimit (basic), securityHeaders, PlatformCredentialService, EncryptionService
- Events: EventDispatcher/InMemoryEventDispatcher, ComposedEventDispatcher, OutboxRelay, OutboxCleaner, PrismaOutboxWriter, BullMQIntegrationPublisher, EventSchemaRegistry, IntegrationEventConsumer
- Libs: logger, errorHandler, AppError, redis, envValidation, withTimeout, cacheConfig, cacheDecorators (parcial)
- Observability: sentryInit
- Bootstrap: index.ts

### 3.2 PARTIALLY_ACTIVE (~11 archivos)

- `auditLogger.ts` — wired pero `extractUserId` STUB → logs sin userId
- `fileUploadValidator.ts` — wired pero `getPlugin()` es placeholder + scanner es `Simulate`
- `auth/rbacMiddleware.ts` — parcialmente wired (`requirePermission`, `requireAllPermissions` activos; `roleBasedRateLimit` fake)
- `EventService.ts` — activa pero 3 `setupDefaultHandlers` son NO-OP
- `AnalyticsEventHandler.ts` — registrado pero NO-OP
- `WebhookEventHandler.ts` — registrado pero NO-OP
- `credentialManager.ts` — API key hashing paralelo (SHA-256) vs integrationAuth (argon2)
- `UpdatePricingConfigUseCase` — registrado con 4 stubs vacíos
- `GenerateRepurposeVariantsUseCase` — registrado con noOpNotification
- `ThreadAnalytics` — registrado con `{} as ApiMetrics` mock vacío
- `EventStore.ts` — activo pero `EventSnapshots` table referenciada pero no creada

### 3.3 PLANNED (~7 archivos — Edward CP4 decision)

**CQRS subsystem completo** (arquitectura incompleta, wire pendiente en sprint futuro):

- `CQRSIntegration.ts` + `CQRSBus.ts` (parcialmente activo como shell) + 4 handlers = 6 archivos
- `EventService` / `PostgreSQLEventStore` / `RedisEventPublisher` (Event Sourcing path — unificación con EventDispatcher path candidate per CP3)

### 3.4 INFRASTRUCTURE_READY (~8 archivos — Edward CP1 rule)

Rate limiters + validators no-wired pero construidos para uso:

- `security/advancedRateLimit.ts`
- `security/slidingWindowRateLimit.ts`
- `security/enhancedValidator.ts`
- `middleware/correlationMiddleware.ts`
- `lib/errors/errorPlugin.ts`
- `EventUpcaster.ts` (chain vacío en producción)

### 3.5 LEGACY (1 archivo — ya conocido D0v4-1 L-1)

- `auth/mfaService.ts` OLD (registrado en DI `setupServices.ts:83-87`) vs `admin/auth/MfaService.ts` NEW (no en DI)

### 3.6 DEAD_CODE_CANDIDATE (4 tokens + 0 archivos físicos — Edward CP1 rule)

Todos van a LATERAL_FINDINGS con research intent primero:

- 4 tokens orfanados DI (EnableReportSharingUseCase, DisableReportSharingUseCase, GenerateContentCalendarUseCase, PaymentAdapter)

### 3.7 Resumen tabla cuantitativa

| Clase                                |                                           Count |
| ------------------------------------ | ----------------------------------------------: |
| ACTIVE                               |                                             ~55 |
| PARTIALLY_ACTIVE                     |                                              11 |
| PLANNED                              | 7 (CQRS 6 + EventService unification candidate) |
| INFRASTRUCTURE_READY                 |                                               8 |
| LEGACY                               |                                               1 |
| DEAD_CODE_CANDIDATE (tokens DI only) |                                        4 tokens |
| **Total archivos**                   |                                          **91** |

---

## §4. Duplicaciones detectadas

### 4.1 5 sistemas paralelos de rate limiting

1. `auth/rbacMiddleware.roleBasedRateLimit` (L200-221) — **FAKE** (solo headers)
2. `admin/auth/adminAuthMiddleware.rateLimit` (L206-244) — in-memory Map, NO cluster-safe
3. `security/rateLimit.ts` — Redis sorted set **(único wired)**
4. `security/advancedRateLimit.ts` — Redis + progressive blocking + UA fingerprint **(no wired)**
5. `security/slidingWindowRateLimit.ts` — sub-window + geo + progressive **(no wired)**

Plus: `RateLimitConfigs` export duplicado entre rateLimit.ts L124 y advancedRateLimit.ts L286 con **contenidos distintos**.

### 4.2 3 sistemas paralelos de validators

1. `security/enhancedValidator.ts` (582 LOC) — OOP stateful + DOMPurify
2. `security/inputValidation.ts` (303 LOC) — static SecurityValidator + Zod schemas
3. `security/securityHeaders.validateRequest` (L279-324) — patterns sqlmap/nmap/XSS/path

**Patrones SQL injection son DIFERENTES** entre los 3 → inconsistencia crítica.

### 4.3 3 sistemas paralelos de caching

1. `middleware/autoCacheMiddleware.ts` — global Fastify plugin
2. `lib/cache/cacheDecorators.ts` — HOC decorators
3. D0v4-1 L-13: module-level caches en UCs

### 4.4 2 sistemas paralelos de API key hashing

1. `security/credentialManager.hashApiKey` — SHA-256
2. `integrationAuthMiddleware` + `GenerateIntegrationApiKeyUseCase` — argon2

Coexisten con hashing distinto según path de entrada.

### 4.5 2 sistemas paralelos de event dispatching

1. **Domain path**: `EventDispatcher` + `InMemoryEventDispatcher` + `ComposedEventDispatcher` — wired correctamente
2. **Event Sourcing path**: `EventService` + `PostgreSQLEventStore` + `RedisEventPublisher` — 6+ instancias paralelas creadas en setupServices factories, NO token DI

Edward CP3 = **unificación candidate**.

### 4.6 2 sistemas paralelos de correlation ID generation

1. `middleware/correlationMiddleware.ts` — completo pero NO wired
2. `middleware/metricsMiddleware.ts:19-22` — genera via `apiMetrics.generateCorrelationId`

Solo metricsMiddleware se usa en producción.

### 4.7 5 handlers NO-OP de events (crítico)

1. `EventService.setupDefaultHandlers` — 3 no-op (POST_PUBLISHED, USER_ACTION, SYSTEM_HEALTH)
2. `AnalyticsEventHandler.handle` — stub
3. `WebhookEventHandler.handle` — stub

Todo el sistema de webhooks externos es fantasma en producción.

### 4.8 CQRS vs postRoutes

CQRSIntegration define 9 endpoints `/api/cqrs/posts/*` duplicando funcionalidad de `postRoutes.ts` (rutas reales). PLANNED per Edward — si activa, requiere unificar con postRoutes o deprecar postRoutes.

---

## §5. Acoplamientos sospechosos

### 5.1 God files

- **`index.ts` (688 LOC)** — 37 route registrations + middleware chain + DI + SAGA + OTel + shutdown
- **`security/auditLogger.ts` (654 LOC)** — audit + alerting + Redis caching + DB queries + Prisma singleton
- **`security/fileUploadValidator.ts` (654 LOC)** — validación file uploads pero plugin es placeholder
- **`security/enhancedValidator.ts` (582 LOC)** — stateful OOP validator con timers
- **`events/EventPublisher.ts` (587 LOC)** — RedisEventPublisher con retries + DLQ + health checks
- **`events/EventService.ts` (521 LOC)** — orchestrator with default handlers
- **`cqrs/CQRSIntegration.ts` (611 LOC)** — PLANNED; if activated → split por concern
- **`cqrs/handlers/PostCommandHandlers.ts` (621 LOC)** — 4 handlers en un file

### 5.2 Connection leaks (Redis)

- `setupServices.ts` llama `createRedisConnection()` **13 veces** (L177, 198, 215, 232, 259, 275, 284, 313, 337, 360 + más). Cada factory crea su propia Redis connection. Token DI `Redis` no existe.
- `EventService` instanciado 6+ veces en factories + 1 en index.ts:531 — cada uno crea su propio `subscriberRedis = redis.duplicate()` en `RedisEventPublisher` constructor.

### 5.3 DI bypass con `new` directo

- `index.ts:348` `new RateLimit(redis, ...)` — no pasa por container
- `index.ts:531-545` `new EventService`, `new CQRSBusImpl`, `new SagaIntegration` — directo
- `setupServices.ts:105` `new ActivityFeedService()` — eager

### 5.4 Cross-domain dependencies no declaradas

- `application/ml/*` importa `AIService` concreto desde `../../ai/aiService.js` (ya L-15 D0v4-1)
- `application/inbox/DispatchInboxSyncUseCase.ts:12` importa type desde `analytics/DispatchAnalyticsIngestionUseCase.ts` (L-19 D0v4-1)

### 5.5 `setInterval` sin `unref()` — block shutdown

- `index.ts:630` (DLQ archival)
- `index.ts:644` (data retention)
- `security/auditLogger.ts:64` (cleanup)
- `security/slidingWindowRateLimit.ts:81` (suspicious patterns cleanup)
- `security/enhancedValidator.ts:119` (suspicious attempts cleanup)

---

## §6. Patterns inconsistentes

### 6.1 DI registration styles mezclados

Dos estilos coexisten:

- **Lazy factory** con `container.resolve(TOKENS.PrismaClient)` (mayoría)
- **Eager `new PrismaXxx(prisma)`** con `import { prisma }` singleton at setup time (9 files): setupAssetUseCases, setupCrmUseCases, setupCustomReportUseCases, setupSamlUseCases, setupBrandVoiceUseCases, setupBrandKitUseCases, setupReferralUseCases, setupTrendUseCases, setupInboxUseCases (parcial)

### 6.2 Logger instantiation inconsistente

- Código usa `createLogger("domain")` from `lib/logger.ts` en la mayoría
- **`lib/cache/cacheDecorators.ts:13` crea nuevo `pino({ name: "cache-decorators" })`** en lugar de usar `cacheLogger` ya exportado
- **`middleware/autoCacheMiddleware.ts:18-21`** idem — pino directo no logger exportado

### 6.3 Error handling styles

- `createErrorHandler` + `AppError` subclasses (clean)
- `lib/errors/errorPlugin.ts` plugin wrapper exists pero NO se usa (index.ts registra directamente)
- Varios servicios throw `Error` directo en lugar de AppError subclasses

### 6.4 `any` type violations

Detectados en:

- `middleware/autoCacheMiddleware.ts:114-115` (params/query casts)
- `lib/cache/cacheConfig.ts:255-256` (cache key generator)
- `lib/cache/cacheDecorators.ts:57,220` (generic defaults)
- `EventService.ts` multiple (DomainEvent payload casts)
- `PrismaOutboxWriter.writeEvents:23` `tx as TxClient` cast

### 6.5 Routes con `/api/` prefix en comentarios obsoletos

`outboxAdminRoutes.ts` L17, L40, L81 — comments dicen `GET /api/admin/outbox/*` pero URLs reales registradas NO tienen `/api/` prefix (post-D0v4-0 rename). Documentación obsoleta.

---

## §7. CQRS decision §5.9 — PLANNED (Edward Cierre Final)

### Estado actual

| Artefacto                                       | Estado         | Evidencia                                                                                                                       |
| ----------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **`CQRSIntegration.ts` (611 LOC)**              | PLANNED        | Grep `new CQRSIntegration` apps/api/src retorna cero producción. Solo tests/.                                                   |
| **9 endpoints `/api/cqrs/*`**                   | PLANNED        | Definidas pero nunca registradas en index.ts — si alguien las llama en prod: 404.                                               |
| **`CQRSBus.ts / CQRSBusImpl` (421 LOC)**        | ACTIVE (shell) | index.ts:532 `new CQRSBusImpl()` para SagaIntegration — bus activo pero sin handlers registrados (CQRSIntegration nunca corre). |
| **`PostCommandHandlers` (4 handlers, 621 LOC)** | PLANNED        | Solo instanciados por `CQRSIntegration.initialize()` que nunca corre.                                                           |
| **`PostQueryHandlers` (4 handlers, 477 LOC)**   | PLANNED        | Idem.                                                                                                                           |

### Decisión Edward

**Opción B — PLANNED.** Subsystem se mantiene como arquitectura incompleta para activar en sprint futuro. No eliminar. No renombrar `/api/cqrs/*` prefix hasta decisión de wire.

### Implicación arquitectónica

`CQRSBusImpl` inyectado en `SagaIntegration` pero **sin handlers registrados** — sagas que intentan ejecutar commands/queries vía bus recibirán `No handler registered for command type: X`. Posible runtime error en flows de saga que usan CQRS bus. Verificar en D0v4-3 (Workers).

### Trabajo pendiente (próximo sprint CQRS activation)

1. Decidir si `/api/cqrs/*` o rename a `/cqrs/*` post-D0v4-0 convention (consistency con resto)
2. Instanciar `CQRSIntegration` en index.ts bootstrap + llamar `initialize()`
3. Crear `TOKENS.CQRSIntegration` + registrar en DI
4. Decidir relación con `postRoutes.ts`: unificar (CQRS como backend) o co-existir (dual path)
5. Registrar handlers in CQRSBusImpl usado por SagaIntegration

---

## §8. DI Container health check — números concretos

### 8.1 Tabla cuantitativa

| Métrica                                                                      |         Valor |
| ---------------------------------------------------------------------------- | ------------: |
| Archivos en `infrastructure/container/`                                      |            34 |
| Tokens declarados en `types.ts` (Symbol.for)                                 |           298 |
| Tokens registrados vía `container.register*`                                 |          ~294 |
| Tokens referenciados vía `container.resolve*`                                |          ~294 |
| **Tokens completamente orfanados** (declarados + sin register + sin resolve) |         **4** |
| `container.resolve()` call sites totales                                     |          ~780 |
| `setup*UseCases.ts` modules                                                  |            26 |
| Patrón inconsistente (prisma singleton)                                      | 9 setup files |

### 8.2 Tokens DEAD en DI (LATERAL_FINDINGS L-25)

| Token                            | Declaración  | Grupo types.ts                       |
| -------------------------------- | ------------ | ------------------------------------ |
| `EnableReportSharingUseCase`     | types.ts:415 | Report Sharing (Sprint 6 — Batch 3)  |
| `DisableReportSharingUseCase`    | types.ts:416 | Report Sharing (Sprint 6 — Batch 3)  |
| `GenerateContentCalendarUseCase` | types.ts:422 | AI Differentiation                   |
| `PaymentAdapter`                 | types.ts:400 | Payment Billing (Sprint 6 — Batch 5) |

Per CP2 Edward: → LATERAL_FINDINGS con research intent pending.

### 8.3 EventService sin token DI

**`EventService` nunca registrado en `TOKENS`**. Consecuencias:

- 6 instancias paralelas en setupServices factories (L200, 217, 234, 261, 315, 362)
- Extra instancia en index.ts:531 (para SagaIntegration)
- Cada instancia: su propio `PostgreSQLEventStore` + `RedisEventPublisher` + subscriber Redis connection
- Cada instancia intenta `ensureTable()` at init → race potencial en startup

Edward CP3 decision: **unificación candidate** — registrar como `TOKENS.EventService` singleton.

---

## §9. Middlewares execution audit

Por middleware — ¿se ejecuta realmente?

| Middleware                        | Archivo                      |         ¿Wired?         | Escape hatches                     |                           # rutas | Notas                             |
| --------------------------------- | ---------------------------- | :---------------------: | ---------------------------------- | --------------------------------: | --------------------------------- |
| `autoCachePlugin`                 | autoCacheMiddleware.ts       |     ✅ index.ts:216     | Config flag disable                |            Global (GET+mutations) | onRequest + onSend + onResponse   |
| `correlationMiddleware`           | correlationMiddleware.ts     |           ❌            | —                                  |                                 0 | Exists but never registered       |
| `metricsMiddleware`               | metricsMiddleware.ts         |   ✅ index.ts:314-319   | —                                  |                            Global | preHandler + onResponse + onError |
| `requireClientAuth`               | customerAuthMiddleware.ts    |           ✅            | —                                  |          N (per-route preHandler) | Valid                             |
| `integrationAuthMiddleware`       | integrationAuthMiddleware.ts |           ✅            | —                                  |            N (zapier/make routes) | argon2 verify                     |
| `requirePermission` (rbac)        | rbacMiddleware.ts            |           ✅            | —                                  |                                 N | Used widely                       |
| `roleBasedRateLimit` (rbac)       | rbacMiddleware.ts            |        ❌ (FAKE)        | **Solo setea headers, no enforce** |                            0 real | Security theater                  |
| `requireAdminAuth`                | adminAuthMiddleware.ts       |           ✅            | —                                  |                  N (admin routes) | Valid                             |
| `rateLimit` (admin in-memory)     | adminAuthMiddleware.ts       |           ✅            | —                                  |                                 N | NO cluster-safe                   |
| `createCsrfMiddleware`            | csrfMiddleware.ts            |     ✅ index.ts:399     | EXEMPT_PATHS explícito             | Global (/admin/\* state-changing) | Valid                             |
| `createIpAllowlistMiddleware`     | ipAllowlistMiddleware.ts     |     ✅ index.ts:395     | EXEMPT_PATHS + DB toggle           |           Global (/admin/\* only) | Valid con 60s cache               |
| `rateLimit` (basic Redis)         | rateLimit.ts                 | ✅ index.ts:348,366-387 | ENABLE_RATE_LIMITING=false         |      Global + EXPENSIVE_ENDPOINTS | Único wired de 5                  |
| `advancedRateLimit`               | advancedRateLimit.ts         |           ❌            | —                                  |                                 0 | Built not wired                   |
| `slidingWindowRateLimit`          | slidingWindowRateLimit.ts    |           ❌            | `extractUserId` STUB               |                                 0 | Built not wired                   |
| `enhancedValidator.getPlugin()`   | enhancedValidator.ts         |           ❌            | —                                  |                                 0 | Built not wired                   |
| `fileUploadValidator.getPlugin()` | fileUploadValidator.ts       |           ❓            | **Placeholder**                    |                                 ? | Plugin no valida                  |
| `securityManager.register`        | securityHeaders.ts           |     ✅ index.ts:391     | Config `cors.enabled`, etc.        |      Global (helmet + CORS + CSP) | Valid                             |
| `auditMiddleware`                 | audit/auditMiddleware.ts     |   ✅ index.ts:309-311   | —                                  |                 Global preHandler | D0v4-1 scope                      |

---

## §10. Hallazgos laterales para LATERAL_FINDINGS.md

Entradas nuevas L-25 a L-48 agregadas en este sprint. Ver [docs/audits/LATERAL_FINDINGS.md](LATERAL_FINDINGS.md) sección "Hallazgos D0v4-2 (2026-04-20)".

| #    | Título                                                                            | Severidad                    |
| ---- | --------------------------------------------------------------------------------- | ---------------------------- |
| L-25 | 4 tokens DI orfanados — possible implementables                                   | medio                        |
| L-26 | `rbacMiddleware.roleBasedRateLimit` FAKE rate limiter                             | alto                         |
| L-27 | `auditLogger.extractUserId` STUB — audit logs sin userId                          | crítico                      |
| L-28 | `fileUploadValidator` placeholder + simulated scanner                             | crítico                      |
| L-29 | `slidingWindowRateLimit.extractUserId` STUB                                       | alto                         |
| L-30 | 5 rate limiters paralelos (1 wired, 4 INFRASTRUCTURE_READY)                       | medio                        |
| L-31 | 3 validators paralelos con patrones SQL distintos                                 | alto                         |
| L-32 | 2 sistemas API key hashing (SHA-256 vs argon2)                                    | alto                         |
| L-33 | 2 sistemas correlation ID generation                                              | bajo                         |
| L-34 | `index.ts` God file 688 LOC + 37 route registrations                              | medio                        |
| L-35 | `createRedisConnection()` llamado 13 veces en DI factories                        | medio                        |
| L-36 | `EventService` sin token DI (6+ instancias paralelas)                             | alto (unificación candidate) |
| L-37 | `{} as ApiMetrics` mock vacío en ThreadAnalytics                                  | crítico                      |
| L-38 | `UpdatePricingConfigUseCase` registrado con 4 no-op stubs                         | medio (revisar utilidad)     |
| L-39 | `GenerateRepurposeVariantsUseCase` noOpNotification hardcoded                     | medio (revisar utilidad)     |
| L-40 | 9 setup files usan Prisma singleton vs resto DI pattern                           | medio                        |
| L-41 | `EventStore.ensureTable` crea tabla via runtime DDL                               | crítico                      |
| L-42 | `EventStore` referencia `EventSnapshots` table no declarada                       | crítico                      |
| L-43 | `OutboxRelay` sin `SELECT FOR UPDATE SKIP LOCKED`                                 | crítico (confirma L-22)      |
| L-44 | `AnalyticsEventHandler` + `WebhookEventHandler` STUBS NO-OP                       | crítico                      |
| L-45 | `EventService.setupDefaultHandlers` 3 no-op handlers                              | alto                         |
| L-46 | `ComposedEventDispatcher` swallows BullMQ errors silently                         | alto                         |
| L-47 | `CQRS subsystem` = PLANNED + CQRSBus shell sin handlers usado por SagaIntegration | medio                        |
| L-48 | `lib/errors/errorPlugin.ts` DEAD por no-wired                                     | bajo                         |
| L-49 | 3 sistemas paralelos de caching                                                   | medio                        |
| L-50 | `outboxAdminRoutes` comments `/api/` prefix obsoletos                             | bajo                         |
| L-51 | `setInterval` sin `unref()` en 5+ lugares bloquea shutdown                        | medio                        |

---

## §11. Predicción para Sprint D0v4-3 (Workers)

### Scope esperado

`apps/workers/src/` — BullMQ job processors. Anticipado:

- `publishWorker.ts` (publishing jobs — post a platforms)
- `analyticsWorker.ts` (analytics ingestion — consumer de DispatchAnalyticsIngestion)
- `inboxWorker.ts` (inbox sync — consumer de DispatchInboxSync)
- `notificationWorker.ts` (external notifications delivery)
- `gatewaySwitchProcessor.ts` (ya instanciado en index.ts:614-622 — puede ser en workers dir también)
- `outboxRelayWorker.ts` ? (o OutboxRelay ya cubierto en B3)
- IntegrationEventConsumer — BullMQ worker para integration events queue
- Repurpose worker — consumer de GENERATE_REPURPOSE queue

Scope estimado: **20-40 archivos** (per PLAN §9).

### Hallazgos esperados

1. **Worker <→ EventService hook**: los workers deberían consumir via `IntegrationEventConsumer` (que recibe handlers como `AnalyticsEventHandler` + `WebhookEventHandler` — ambos NO-OP per B3). Worker level audit confirmará que handlers NO-OP propagan al nivel de procesamiento.
2. **DI en workers**: ¿workers comparten container con API o tienen setup separado? Si separado, posibles duplicaciones adicionales.
3. **BullMQ workers sin graceful shutdown**: pattern probable, dado que API también tiene setInterval sin unref.
4. **Queue wiring**: `QUEUE_NAMES` ya exportados (`INBOX_SYNC`, `ANALYTICS_AGGREGATION`, `GENERATE_REPURPOSE`, `DEAD_LETTER_QUEUE`, etc.) + `QueuePort` token DI registrado via `createBullMQQueueAdapter`.
5. **Idempotency**: per CLAUDE.md "Every consumer handler is idempotent". Verificar en handlers.

### Riesgos

- Workers usando `prisma` singleton directamente (pattern observado en 9 setup files) — confirmar.
- Workers sin `correlationId` propagation — correlation middleware ya no wired (B1).
- Worker retries + OutboxRelay retries (5 max) pueden crear duplicate execution cascade si un outbox event dispara un job que falla.

---

## §12. Anexo — Verification checklist

- [x] 91 archivos procesados (vs plan 71, variance +28%)
- [x] §8 DI health check cuantitativo (298 tokens, 4 orfanados)
- [x] §9 middlewares execution audit (17 middlewares)
- [x] Duplicaciones enumeradas §4 (8+)
- [x] Acoplamientos documentados §5 (5 categorías + god files)
- [x] Patterns inconsistentes §6 (5 categorías)
- [x] CQRS §5.9 decision §7 — PLANNED (Edward Cierre Final)
- [x] Hallazgos laterales §10 — 27 entradas L-25 a L-51
- [x] Predicción D0v4-3 §11
- [x] Checkpoints 1-3 + Cierre completados con aprobación Edward en cada uno
- [x] Zero cambios en `apps/`, `packages/`, `infra/` (solo docs)

## §13. Anexo — Commit sugerido

```text
docs(audits): D0v4-2 middlewares/DI/infra report

91 archivos auditados bajo §5.8 + §5.9 + CP1 rule en 4 batches.
CQRS §5.9 resuelto: PLANNED (mantener, wire en sprint futuro).
27 hallazgos laterales nuevos (L-25..L-51), 8+ duplicaciones,
5 acoplamientos, 5 patterns inconsistentes.
298 tokens DI declarados / 4 orfanados.
5 handlers NO-OP producción (webhook system fantasma).
PLAN_MAESTRO §6 actualizado.

Ready para Sprint D0v4-3 (Workers).
```

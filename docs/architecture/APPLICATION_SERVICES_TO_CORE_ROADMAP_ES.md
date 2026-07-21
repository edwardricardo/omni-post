# Application Services Migration Roadmap — `@layer application` fuera de `apps/api/src/application` → `@core`

> **Qué es esto:** la guía **trackeable** para la **frontera siguiente** tras cerrar el @core migration
> (`CORE_MIGRATION_ROADMAP_ES.md` — dominio, DONE; y
> `APPLICATION_MIGRATION_ROADMAP_ES.md` — `apps/api/src/application/**`, DONE; ambos roadmaps cerrados se **eliminaron** en la limpieza de la Pre-Fase).
> Aquellos roadmaps tenían **scope de directorio**: migraron lo que vivía físicamente en `apps/api/src/application/**`
> y `apps/api/src/domain/**`. Pero quedaron **25 archivos `@layer application`** repartidos en **dirs de feature**
> (`billing/`, `saga/`, `cqrs/`, `auth/`, `compliance/`, `ai/`, `settings/`, `security/`, `webhooks/`) que **nunca
> estuvieron en scope** y que **ningún boundary vigila** hoy. Este doc los enumera y traza su disposición.
>
> **Origen:** auditoría post-cierre del @core migration (grafos graphify + file-placement audit, 2026-05-26).
> **Este doc no ejecuta nada.** Cada fase se ejecuta con su **propio plan formal** + **research de canon (índice + web)**
> antes de `ExitPlanMode`, y aprobación de Edward al cierre.

## 0. Hechos verificados (estado al abrir el workstream)

- **25 archivos** (estado original al abrir el workstream) en `apps/api/src/**` declaran `@layer application` **fuera** de
  `apps/api/src/application/` (ya borrado). `@layer domain` fuera de directorio: **0**.
  **Estado tras S-Relabel + S2 (combinadas, DONE):** 10 reetiquetados a `@layer infrastructure` (Bucket B 5 +
  Bucket C 4 + Bucket D 1) → quedan **15** `@layer application` en `apps/api/src/**` (todo el Bucket A,
  pendiente de S-Spine + S3 + S4). Workers `CredentialResolver` también reetiquetado.
- **Ninguno** de los 25 es consumido por `apps/workers` → **todos api-only**. Esto es **higiene de boundary**
  (application-logic en el deployable de delivery en vez de en el core compartido), **no** una duplicación
  cross-deployable urgente (a diferencia de `autoRenewal`/FN-004 o `ChannelAuthFailureRecorder`/SMELL-44).
- Coupling a infra (verificado por grep de imports **directos** — re-verificar transitividad por fase):
  - **9** inyectan el **tipo** `PrismaClient` (`import type`, NO el singleton → fitness #21 sigue 0) y llaman `prisma.*`
    directo en vez de un repository port. Son la categoría **"blocked"** (port refactor antes de mover, igual que los 21
    bloqueados del roadmap de application).
  - El resto: acoplamiento ligero (`lib/logger`, `ioredis`) o nulo.
- **Guardrail gap:** el viejo fitness #2 ("domain framework-free") apuntaba a `apps/api/src/domain/` (ya no existe), y
  las reglas `core-*` de `dependency-cruiser` solo cubren `packages/core`. → estos 25 archivos **no los vigila nada**.
  Cerrar este workstream debe terminar con un guard que impida reintroducir `@layer application` en `apps/api/src`.

### Audit transitivo 2026-05-26 (post-S0)

El bucketing inicial (arriba) usó imports **directos**; este audit re-verificó transitividad (3 agentes Explore en
paralelo) y descubrió **5 hechos** que **invalidan** el S1 original (clean strangler de 6 archivos):

- **Inversión de capas pre-existente.** Las clases base `apps/api/src/services/{BaseService,AuditableService}.ts`
  son `@layer infrastructure` y cargan `logger` (`../lib/logger.js`). Los servicios `@layer application` del
  cluster billing/subscription + `rbacService` **heredan** de ellas → mover un file `@layer application` con
  `extends AuditableService` (infra+logger) a `@core` rompería el boundary `core-application-no-infrastructure`.
  **Blast radius global:** 18 archivos `extends BaseService` + 8 `extends AuditableService` en `apps/api/src`.
- **Pero el cluster casi no usa los métodos base.** `SubscriptionPlanService` y `SubscriptionStatsService` usan
  **CERO** métodos heredados (herencia muerta); `SubscriptionManagementService` y `BillingService` usan solo
  `this.logAccountAction` ×1 cada uno; `TrialManagementService` ×3. → Desacoplar a inyección de
  `AuditLogRepository` (port `@core/domain` ya existente) es **local y contenido**, pero es **refactor**, no un
  strangler verbatim. Y `SubscriptionService` (facade) depende por tipo de `TrialManagementService` (no estaba en
  S1) → el cluster es **indivisible**.
- **`AIProviderFactory` está mal clasificado.** Etiquetado `@layer application`, pero fabrica providers
  (`apps/api/src/ai/providers/{openai,anthropic,gemini,perplexity}.ts`) que son `@layer infrastructure` e
  instancian SDKs npm (`new OpenAI(...)`, `new Anthropic(...)`, …). Es un factory de **adapters de infra** → NO va
  a `@core`; el fix es **re-etiquetar `@layer infrastructure`**.
- **`rbacService` tiene ripple adicional.** Además de `extends AuditableService` + `authLogger`, exporta el
  `Permission` enum importado por **26 archivos** (rutas admin/auth/billing/compliance/…). Move directo sería un
  ripple masivo; mitigable con re-export de `Permission` desde un facade en `apps/api`.
- **Inconsistencia de etiquetado en el cluster billing/subscription.** 5 archivos están `@layer application`
  (`SubscriptionService`, `SubscriptionPlanService`, `SubscriptionManagementService`, `SubscriptionStatsService`,
  `BillingService`) **vs** `TrialManagementService` etiquetado `@layer infrastructure`, pese a herencia idéntica
  de `AuditableService`. Una de las dos etiquetas está mal; alinear cuando se planifique S1'.

→ **S1 original (clean+ligero a `@core`) anulado.** Re-bucketing en §2; introducción de Bucket D + nuevas fases
(S-Spine, S-Relabel) en §3; re-pick del primer slice ejecutable **diferido** a un plan posterior.

## 1. Principios (heredados del dominio + application)

- **Strangler fig:** mover a `@core` + shim re-export en la ruta vieja → consumidores compilan → repoint import-sites →
  burn-down de shims.
- **Clean-first, blocked-last:** lo que solo depende de `@core/domain`+`@shared`+`@ports` se mueve directo; lo que
  importa infra de `apps/api` se refactoriza a **ports/inyección** primero.
- **Canon sobre consistencia:** no replicar el patrón "servicio con `PrismaClient` inyectado que llama `prisma.*`"; al
  mover, convertir a **repository port** (el código viejo se migra, no se propaga).
- **Mecanismo ≠ use-case:** no todo `@layer application` debe ir a `@core`. La glue de delivery (bus CQRS, integración
  Fastify, motor de saga) es **infraestructura** → se **re-etiqueta `@layer infrastructure`**, no se mueve.
- **Una fase = uno+ commits = checkpoint de rollback.** Aprobación de Edward al cierre de cada fase.

## 2. Análisis de closure (los 25 + disposición preliminar)

> Bucketing **preliminar** por imports directos + `@description`. Cada plan de fase **regenera el grep de closure** y
> fija la lista exacta (incl. coupling transitivo), igual que el roadmap de application.

### Bucket A — Servicios de negocio → **mover a `@core/application`** (15)

> Taxonomía **post audit transitivo** (reemplaza la taxonomía clean/ligero/blocked del bucketing por imports
> directos). `AIProviderFactory` salió a Bucket D (factory de adapters de SDK).

| Archivo (`apps/api/src/…`)                              | Qué hace                                                | Coupling transitivo                                         | Sub-clase                        |
| ------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------- |
| `billing/subscription/SubscriptionService.ts`           | Facade unificado de suscripción (inyecta colaboradores) | depende del cluster (5 + `TrialManagementService`)          | **cluster-indivisible**          |
| `billing/subscription/SubscriptionPlanService.ts`       | Planes desde AccountSubscription + ProviderBundle       | `extends BaseService` (usa 0 métodos — herencia muerta)     | **inheritance-blocked**          |
| `billing/subscription/SubscriptionManagementService.ts` | Lifecycle: get/list/suspend/validate limits             | `extends AuditableService` (usa `logAccountAction` ×1)      | **inheritance-blocked**          |
| `billing/subscription/SubscriptionStatsService.ts`      | MRR, distribución, churn, growth                        | `extends BaseService` (usa 0 métodos — herencia muerta)     | **inheritance-blocked**          |
| `billing/subscription/BillingService.ts`                | Eventos de billing, detección de cambio, cálculos       | `extends AuditableService` + `lib/logger` directo           | **inheritance-blocked**          |
| `auth/rbacService.ts`                                   | RBAC: permission checks vía Role/RolePermission         | `extends AuditableService` + `authLogger`; `Permission` ×26 | **inheritance-blocked + ripple** |
| `billing/GatewayBillingService.ts`                      | Lifecycle de switch de gateway (Stripe↔Paddle)          | `PrismaClient` + `lib/logger`                               | **port-blocked**                 |
| `security/PlatformCredentialService.ts`                 | CRUD de credenciales de plataforma cifradas             | `PrismaClient`                                              | **port-blocked**                 |
| `compliance/ComplianceService.ts`                       | GDPR/LGPD/CCPA/PIPEDA, DSAR, breach reports             | `PrismaClient` + `lib/logger`                               | **port-blocked**                 |
| `compliance/DataRetentionService.ts`                    | Cleanup de retención automatizado                       | `PrismaClient` + `lib/logger`                               | **port-blocked**                 |
| `webhooks/DlqArchivalService.ts`                        | Archivado de DLQ events resueltos                       | `PrismaClient` + `lib/logger`                               | **port-blocked**                 |
| `ai/AiRequestService.ts`                                | Routing pool/BYOK + rate limiting de requests AI        | `PrismaClient` + `lib/logger`                               | **port-blocked**                 |
| `auth/roleManagementService.ts`                         | CRUD de roles RBAC configurables                        | `PrismaClient` + `lib/logger`                               | **port-blocked**                 |
| `settings/SettingsService.ts`                           | Lógica de settings: valida grupos, enmascara secrets    | `PrismaClient`                                              | **port-blocked**                 |
| `settings/credentialKeys.ts`                            | Define keys esperadas por `CredentialGroup`             | `CredentialGroup` (tipo Prisma generado)                    | **const/config**                 |

**Notas:**

- **`inheritance-blocked`** (6) requiere desacoplar de `BaseService`/`AuditableService` (composition refactor:
  inyectar `AuditLogRepository`; quitar `extends`) o esperar a S-Spine. NO es un strangler verbatim.
- **`port-blocked`** (8) requiere convertir el acceso Prisma a un repository port + adapter antes de mover. Algunos
  archivos pueden ser **también** `inheritance-blocked` (p. ej. `GatewayBillingService` si extiende
  `AuditableService` — re-verificar transitividad en su fase).
- **`cluster-indivisible`** (1): `SubscriptionService` depende por tipo de las 4 hermanas + `BillingService` +
  `TrialManagementService` (no listado en este bucket; ver §0 sobre inconsistencia de etiquetado).
- **`const/config`** (1): `credentialKeys` depende del tipo Prisma generado `CredentialGroup` → relocar exige
  resolverlo en `@core`/`@shared` o desacoplarlo (enum propio del dominio) primero.
- **`TrialManagementService.ts`** está etiquetado `@layer infrastructure` (verificado) — **fuera del conteo de
  25** pero parte del closure operativo del cluster billing/subscription. Decidir su etiqueta canónica al
  planificar S1'.

### Bucket B — Mecanismos/glue de delivery → **re-etiquetar `@layer infrastructure`** (NO mover) (5)

| Archivo                        | Qué hace                                          | Por qué es infra                      |
| ------------------------------ | ------------------------------------------------- | ------------------------------------- |
| `cqrs/CQRSBus.ts`              | Dispatch command/query + caching Redis + métricas | Mecanismo de bus (Redis), no use-case |
| `cqrs/CQRSIntegration.ts`      | Registro de endpoints CQRS en Fastify             | Importa `fastify` — delivery puro     |
| `saga/SagaManager.ts`          | Facade del saga engine                            | Motor de orquestación (infra)         |
| `saga/SagaManagerExecution.ts` | Ejecución + compensación + retry + persistencia   | Motor de orquestación (infra)         |
| `saga/SagaManagerLifecycle.ts` | Init, registro, start, health, métricas, shutdown | Motor de orquestación (infra)         |

### Bucket C — Handlers CQRS (ambiguo — decidir en closure) (4)

`cqrs/handlers/{PostCommandHandlers,PostQueryHandlers,PostQuerySearchAnalytics,PostQueryGetList}.ts`. CLAUDE.md lista
"handlers" como `@layer application`, **pero** estos delegan a use-cases de `@core` y son glue específico del bus CQRS
de apps/api (coupling: `ioredis`/`lib/logger`). Disposición a decidir por fase: **re-etiquetar `@layer infrastructure`**
(adaptadores del bus) o extraer la poca lógica que tengan. Recomendación preliminar: infra (son adaptadores bus→use-case).

### Bucket D — Mal clasificados → **re-etiquetar `@layer infrastructure`** (NO mover) (1)

| Archivo                   | Por qué es infra                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ai/AIProviderFactory.ts` | Factory de adapters de SDK (`new OpenAI()`, `new Anthropic()`, …); sus 4 providers ya son `@layer infrastructure` |

Los 4 providers (`ai/providers/{openai,anthropic,gemini,perplexity}.ts`) ya están `@layer infrastructure` — solo
`AIProviderFactory` cambia. La fase S-Relabel verifica consistencia y re-etiqueta.

### Nota fuera de apps/api

`apps/workers/src/services/CredentialResolver.ts` está `@layer application` pero la regla "workers = infrastructure" lo
hace **mislabel**. Es framework-free (solo `@shared`) y worker-only, sin overlap con `@core`. Opciones: re-etiquetar
`@layer infrastructure`, o promover a `@core` si la resolución de credenciales se quiere compartir. Item menor; se trata
en S2.

**Recuento (post audit transitivo):** Bucket A 15 + Bucket B 5 + Bucket C 4 + Bucket D 1 = **25 archivos**
`@layer application` (conteo confirmado, sin cambio neto). `TrialManagementService.ts` (`@layer infrastructure`,
parte del cluster operativo) queda fuera del conteo pero entangled — ver §0.

## 3. Fases (trackeable)

Status: `PENDING` · `IN-PROGRESS` · `DONE (<commit>)`. Conteos aproximados; cada plan de fase regenera el closure.

| Fase          | Nombre                                                      | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Complejidad | Status                  |
| ------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------- |
| **S0**        | Scaffold roadmap                                            | Este doc. Sin mover nada.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Baja        | DONE (`f8f2be2`)        |
| **S0.1**      | Corrección post-audit transitivo                            | Re-bucketing por hallazgos transitivos (§0 ampliado, Bucket A taxonomía nueva, **Bucket D nuevo**, anulación de S1 original). **Sin código**, una sola edición de doc.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Baja        | DONE (este commit)      |
| **S1'**       | Cluster billing/subscription → `@core/application/billing/` | 2 commits: (1) canon-refactor in place — `AuditEmitterPort` (port en `@core/domain`) + `AuditEmitterAdapter` (apps/api) reemplazan `AuditLogRepository` directo en los 3 cluster services; `Result<T, UseCaseError>` reemplaza string-literal codes en los 8 métodos; `createLogger` removido de Billing/Trial; handlers + integration test re-narrowan. (2) `git mv` de 6 servicios + types a `packages/core/application/src/billing/`; per-context barrel nuevo (`billing/index.js`) que también surfacea los 3 use-cases ya existentes; viejo shim `apps/api/src/billing/subscriptionService.ts` borrado (huérfano); 11 consumer paths repointed (DI + routes + handlers ×4 + scheduler + tests ×6). depcruise hard-zero post-move. | Media       | DONE (este commit)      |
| **S-Spine**   | Decouple 6 `@layer application` subclases                   | Reframeado tras audit transitivo: las base classes son load-bearing infra (20+ servicios infra las usan legítimamente, ×8-22 calls c/u); no se mueven. Se desacopla **solo las 6 application-layer subclases** vía composición: helper free-function `apps/api/src/services/audit.ts` (`emitAudit` + `logServiceError`) reemplaza `log*Action` + `createServiceError/logError`. Las 6 ya no heredan; constructores externamente idénticos (tests intactos).                                                                                                                                                                                                                                                                            | Media       | DONE (este commit)      |
| **S-Relabel** | Bucket D — re-etiquetar `@layer infrastructure`             | `AIProviderFactory` re-etiquetado a `@layer infrastructure` (factory de SDK adapters); los 4 providers ya consistentes (`@layer infrastructure`). Solo JSDoc; sin movimiento.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Baja        | DONE (combinado con S2) |
| **S2**        | Re-etiquetar mecanismos + handlers                          | Bucket B (5: CQRSBus, CQRSIntegration, SagaManager + Execution + Lifecycle) + Bucket C (4: PostCommandHandlers, PostQueryHandlers, PostQuerySearchAnalytics, PostQueryGetList) + workers `CredentialResolver` → `@layer infrastructure`. CLAUDE.md `@layer` table aclarada para distinguir bus-glue de application handlers. Solo JSDoc.                                                                                                                                                                                                                                                                                                                                                                                               | Baja        | DONE                    |
| **S3**        | Ports para los `port-blocked` (billing/cred)                | `GatewayBillingService`, `PlatformCredentialService`, `SettingsService`, `credentialKeys` → repository ports + mover. Algunos pueden ser **también** `inheritance-blocked` (re-verificar transitividad en su fase y depender de S-Spine si aplica).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Media-alta  | PENDING                 |
| **S4**        | Ports para los `port-blocked` (compliance/ai)               | `ComplianceService`, `DataRetentionService`, `DlqArchivalService`, `AiRequestService`, `roleManagementService` → ports + mover. Misma anotación de dependencia con S-Spine donde aplique.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Media-alta  | PENDING                 |
| **S5**        | Burn-down shims + guard de boundary                         | Repoint import-sites restantes; borrar shims; añadir **fitness function** que bloquee `@layer application` nuevo en `apps/api/src`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Media       | PENDING                 |

## 4. Template de plan por fase (OBLIGATORIO — anti-sorpresa)

Cada fase enumera **antes** de ejecutar: (1) lista exacta de archivos (grep de closure regenerado), (2) import-sites
afectados, (3) shims a crear, (4) ports nuevos + su adapter, (5) tests exhaustivos (no representativos), (6) gates.
Research de canon (índice + web) es **parte obligatoria** del plan antes de `ExitPlanMode`.

## 5. Gates por fase (idénticos al @core)

`tsc` 0 (paquetes tocados + `@apps/api` + `@apps/workers`) · `eslint`/`prettier` 0 · fitness #2/#3/#4/#9/#10/#21 0 ·
`dependency-cruiser` 0 (core sin infra; dirección correcta) · tests (batches 3072/maxWorkers 2 por límite de heap del LXC) ·
commit código + commit docs (marca fase DONE) · aprobación de Edward.

## 6. Gotchas

- **`PrismaClient` es `import type`, no el singleton** — fitness #21 sigue en 0; aun así es coupling application→infra
  (la capa conoce Prisma). Al mover, convertir a repository port; no propagar el patrón.
- **Mecanismo ≠ use-case** — Bucket B/C no van a `@core`; se re-etiquetan. Mover un bus/saga-engine a `@core` lo
  contaminaría con Redis/Fastify.
- **`credentialKeys` depende de un tipo Prisma generado** (`CredentialGroup`) — relocar exige resolver ese tipo en
  `@core`/`@shared` primero.
- **El guard final (S5) es no-negociable** — sin una fitness function que bloquee `@layer application` nuevo en
  `apps/api/src`, la frontera vuelve a erosionarse. Cerrar el workstream = cerrar el gap, no solo mover los 25.
- **Heap LXC:** `tsc` 5120, vitest 3072/maxWorkers 2, commit `NODE_OPTIONS=--max-old-space-size=8192`.
- **Bucketing por imports directos engaña.** Lección aprendida en S0.1: la taxonomía clean/ligero/blocked debe
  validarse con audit **transitivo** (herencia de clases base, dependencias entre archivos del cluster, ripple de
  enums exportados, consistencia de `@layer` entre hermanos), no solo el grep de imports directos. Cada plan de
  fase **debe** correr esa validación antes de `ExitPlanMode`.

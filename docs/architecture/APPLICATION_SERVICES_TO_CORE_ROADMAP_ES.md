# Application Services Migration Roadmap — `@layer application` fuera de `apps/api/src/application` → `@core`

> **Qué es esto:** la guía **trackeable** para la **frontera siguiente** tras cerrar el @core migration
> ([CORE_MIGRATION_ROADMAP_ES.md](./CORE_MIGRATION_ROADMAP_ES.md) — dominio, DONE; y
> [APPLICATION_MIGRATION_ROADMAP_ES.md](./APPLICATION_MIGRATION_ROADMAP_ES.md) — `apps/api/src/application/**`, DONE).
> Aquellos roadmaps tenían **scope de directorio**: migraron lo que vivía físicamente en `apps/api/src/application/**`
> y `apps/api/src/domain/**`. Pero quedaron **25 archivos `@layer application`** repartidos en **dirs de feature**
> (`billing/`, `saga/`, `cqrs/`, `auth/`, `compliance/`, `ai/`, `settings/`, `security/`, `webhooks/`) que **nunca
> estuvieron en scope** y que **ningún boundary vigila** hoy. Este doc los enumera y traza su disposición.
>
> **Origen:** auditoría post-cierre del @core migration (grafos graphify + file-placement audit, 2026-05-26).
> **Este doc no ejecuta nada.** Cada fase se ejecuta con su **propio plan formal** + **research de canon (índice + web)**
> antes de `ExitPlanMode`, y aprobación de Edward al cierre.

## 0. Hechos verificados (estado al abrir el workstream)

- **25 archivos** en `apps/api/src/**` declaran `@layer application` **fuera** de `apps/api/src/application/` (ya borrado).
  `@layer domain` fuera de directorio: **0**.
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

### Bucket A — Servicios de negocio → **mover a `@core/application`** (16)

| Archivo (`apps/api/src/…`)                              | Qué hace                                                | Coupling directo              | Sub-clase    |
| ------------------------------------------------------- | ------------------------------------------------------- | ----------------------------- | ------------ |
| `billing/subscription/SubscriptionService.ts`           | Facade unificado de suscripción (inyecta colaboradores) | —                             | clean        |
| `billing/subscription/SubscriptionPlanService.ts`       | Planes desde AccountSubscription + ProviderBundle       | —                             | clean        |
| `billing/subscription/SubscriptionManagementService.ts` | Lifecycle: get/list/suspend/validate limits             | —                             | clean        |
| `billing/subscription/SubscriptionStatsService.ts`      | MRR, distribución, churn, growth                        | —                             | clean        |
| `ai/AIProviderFactory.ts`                               | Factory de providers AI desde credenciales              | —                             | clean\*      |
| `billing/subscription/BillingService.ts`                | Eventos de billing, detección de cambio, cálculos       | `lib/logger`                  | ligero       |
| `auth/rbacService.ts`                                   | RBAC: permission checks vía Role/RolePermission         | `lib/logger`                  | ligero       |
| `billing/GatewayBillingService.ts`                      | Lifecycle de switch de gateway (Stripe↔Paddle)          | `PrismaClient` + `lib/logger` | **blocked**  |
| `security/PlatformCredentialService.ts`                 | CRUD de credenciales de plataforma cifradas             | `PrismaClient`                | **blocked**  |
| `compliance/ComplianceService.ts`                       | GDPR/LGPD/CCPA/PIPEDA, DSAR, breach reports             | `PrismaClient` + `lib/logger` | **blocked**  |
| `compliance/DataRetentionService.ts`                    | Cleanup de retención automatizado                       | `PrismaClient` + `lib/logger` | **blocked**  |
| `webhooks/DlqArchivalService.ts`                        | Archivado de DLQ events resueltos                       | `PrismaClient` + `lib/logger` | **blocked**  |
| `ai/AiRequestService.ts`                                | Routing pool/BYOK + rate limiting de requests AI        | `PrismaClient` + `lib/logger` | **blocked**  |
| `auth/roleManagementService.ts`                         | CRUD de roles RBAC configurables                        | `PrismaClient` + `lib/logger` | **blocked**  |
| `settings/SettingsService.ts`                           | Lógica de settings: valida grupos, enmascara secrets    | `PrismaClient`                | **blocked**  |
| `settings/credentialKeys.ts`                            | Define keys esperadas por `CredentialGroup`             | `CredentialGroup` (tipo gen.) | const/config |

\* `AIProviderFactory` se marca clean por imports directos; verificar en su fase si arrastra SDKs de provider (→ port).
`credentialKeys` depende del tipo generado `CredentialGroup` → relocar requiere ese tipo en `@core`/`@shared` o
desacoplarlo (enum propio del dominio).

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

### Nota fuera de apps/api

`apps/workers/src/services/CredentialResolver.ts` está `@layer application` pero la regla "workers = infrastructure" lo
hace **mislabel**. Es framework-free (solo `@shared`) y worker-only, sin overlap con `@core`. Opciones: re-etiquetar
`@layer infrastructure`, o promover a `@core` si la resolución de credenciales se quiere compartir. Item menor; se trata
en S2.

## 3. Fases (trackeable)

Status: `PENDING` · `IN-PROGRESS` · `DONE (<commit>)`. Conteos aproximados; cada plan de fase regenera el closure.

| Fase   | Nombre                                 | Scope                                                                                                                               | Complejidad | Status  |
| ------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------- |
| **S0** | Scaffold roadmap                       | Este doc. Sin mover nada.                                                                                                           | Baja        | DONE    |
| **S1** | Clean + ligeros → `@core` (strangler)  | Bucket A clean/ligero (6): Subscription×4, AIProviderFactory\*, BillingService, rbacService. Mover + shim + tests.                  | Baja-media  | PENDING |
| **S2** | Re-etiquetar mecanismos + handlers     | Bucket B (5) + Bucket C (4) + workers `CredentialResolver` → `@layer infrastructure` (decisión documentada c/u).                    | Baja        | PENDING |
| **S3** | Ports para los blocked (billing/cred)  | `GatewayBillingService`, `PlatformCredentialService`, `SettingsService`, `credentialKeys` → repository ports + mover.               | Media-alta  | PENDING |
| **S4** | Ports para los blocked (compliance/ai) | `ComplianceService`, `DataRetentionService`, `DlqArchivalService`, `AiRequestService`, `roleManagementService` → ports + mover.     | Media-alta  | PENDING |
| **S5** | Burn-down shims + guard de boundary    | Repoint import-sites restantes; borrar shims; añadir **fitness function** que bloquee `@layer application` nuevo en `apps/api/src`. | Media       | PENDING |

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

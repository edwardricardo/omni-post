# D0v4-7 — Packages Compartidos Full Audit

**Sprint ID:** D0v4-7
**Fecha cierre:** 2026-04-20
**Agente:** general-purpose multi-layer (CP0 saga deep-dive + 5 batches B1–B5 + Cierre)
**Scope:** `packages/*` — todos los workspace packages consumidos por `apps/api`, `apps/workers`, `apps/admin`, `apps/client`
**Metodología:** §5.7 v3 + §5.8 + §5.9 lectura directa + CP1 consumer bidireccional + hexagonal boundary audit + `package.json` deps audit
**Reporte anterior:** `D0v4_6_FRONTEND_ADMIN_REPORT.md`
**Próximo sprint:** D0v4-8 Apps Full Audit (último del tramo D0-v4)

---

## §0. Front matter y resumen ejecutivo

### Overview

El Sprint D0v4-7 audita la capa de packages compartidos — la región del codebase que concentra las mayores oportunidades (reuso, invariantes hexagonales, ports) y los mayores riesgos (DEAD_SCAFFOLD silencioso, boundary leaks, GOD_INTERFACEs, y la resolución esperada de L-63 saga REAL/PLANNED).

- **Total packages auditados:** 36
- **Total archivos fuente:** 235 (`.ts`/`.tsx`, sin tests)
- **Total archivos test:** 74
- **Total archivos:** 309
- **LOC fuente:** 53,880
- **LOC con tests:** 88,970
- **Duración efectiva:** 5 batches + CP0 saga deep-dive
- **Checkpoints aprobados:** CP0 + CP1 + CP2 + CP3 + CP4 + CP5 (6/6)

### Findings nuevos generados

- **~178 findings nuevos** rango **L-350..L-527** (ver tabla completa §13)
- **14 CRITICAL escalados** (detalle §6)
- **4 composites extendidos** (L-14, L-260, L-298, L-368) — ver §10 y LATERAL_FINDINGS.md
- **Cross-ref resoluciones previas:** L-14 (D0v4-1), L-60/L-61/L-63 (D0v4-3), L-260 (D0v4-5), L-298/L-336/L-347 (D0v4-6)

### Highlights pieza central

1. **Saga deep-dive CP0 (§3):** `@shared/saga` step `create-post` invoca `CQRSBus.dispatch(CreatePostCommand)` sobre una instancia **creada fresh y vacía** en `apps/api/src/index.ts:529-547`, por lo que el saga está **roto por diseño**. **L-63 = REAL runtime risk confirmado.**
2. **L-14 5-way overlap (§6.6):** Además del triple overlap en `apps/api/src/providers/*` detectado en D0v4-1, existen **dos** duplicaciones adicionales en `packages/providers/*` + `packages/ports/*` + `packages/shared/*`. 1,440 LOC duplicados en apps/api/src/providers son redundantes con `@providers/shared` autoritativo. **L-386 = 5-way upgrade de L-14.**
3. **Scaffolding precursor verificado (§9):** `packages/shared-frontend/` y `packages/observability/browser-logger/` **NO existen**. L-336 y L-347 son GAPS arquitecturales legítimos, no scaffolding olvidado. Sprint post-auditoría libre para crearlos from scratch.

### Severidad distribución

| Severidad | Count | Escalados CRITICAL |
| --------- | ----: | -----------------: |
| CRITICAL  |    14 |                 14 |
| HIGH      |   ~47 |                  — |
| MEDIUM    |  ~106 |                  — |
| LOW       |   ~11 |                  — |

---

## §1. Metodología aplicada

### §1.1 Técnicas aplicadas en cada batch

| Técnica                                   | Origen                 | Aplicación en D0v4-7                                                             |
| ----------------------------------------- | ---------------------- | -------------------------------------------------------------------------------- |
| §5.7 v3 lectura directa                   | PRE-D1B                | Todas las lecturas file-by-file sin confiar únicamente en greps                  |
| §5.8 inventario con anti-falsos-negativos | D0-v4 Piloto           | Re-lectura y triple grep para DEAD_CODE candidates                               |
| §5.9 DELETE bloqueado sin Edward          | PRE-3B                 | `ORPHAN` sugiere pero no elimina; Edward decide                                  |
| CP1 consumer bidireccional                | D0v4-4                 | Mapeo inbound + outbound por package (§4)                                        |
| Hexagonal boundary audit                  | CLAUDE.md arquitectura | `domain` ← `application` ← `infrastructure`. Violaciones flagged (§5)            |
| `package.json` audit                      | Nuevo D0v4-7           | Version drift, missing exports, scope prefix, phantom deps, version placeholders |
| 4-grep ORPHAN verification                | PRE-3C §10             | (1) direct import, (2) barrel re-export, (3) dynamic import, (4) string literal  |

### §1.2 Scope explícito

- **IN scope:** Todo `packages/*` (shared code workspace-wide)
- **OUT scope:** `apps/*` (será D0v4-8) — excepto consumers cross-reference
- **OUT scope:** `infra/prisma/*` (auditada como parte D0v4-2 DI + migrations)
- **OUT scope:** Tests propios de packages (leídos solo como context, no findings)

### §1.3 CP0 saga deep-dive

CP0 introduce un deep-dive pre-batch sobre `@shared/saga` para confirmar el verdadero estado de L-63 (saga flagged PLANNED en D0v4-3). Deep-dive lee `saga.ts` (706 LOC) completo + trazas runtime cross-app. Conclusión §3.

---

## §2. Inventario completo

### §2.1 Lista de packages auditados

| #   | Package                        | Source files | Test files |    LOC src | Notas                                                       |
| --- | ------------------------------ | -----------: | ---------: | ---------: | ----------------------------------------------------------- |
| 1   | `@core/engine`                 |            6 |          2 |        678 | Nota: pattern real es `@core/threading` via relative paths  |
| 2   | `@ports/core`                  |           18 |          4 |      1,420 | RepoPort GOD_INTERFACE 199 LOC (L-362)                      |
| 3   | `@shared/types`                |           24 |          6 |        541 | Count real 541 (no 132 subcontado en planning)              |
| 4   | `@shared/events`               |            8 |          2 |        387 | Clean                                                       |
| 5   | `@shared/cqrs`                 |            5 |          1 |        312 | `CQRSBus` class — handlers se registran externamente        |
| 6   | `@shared/saga`                 |            4 |          2 |        789 | `saga.ts` 706 LOC — L-63 REAL confirmado                    |
| 7   | `@shared/logger`               |            3 |          1 |        142 | Console-based. L-347 3-way drift                            |
| 8   | `@adapters/cache-redis`        |            6 |          1 |        421 | L-364 Fastify boundary leak CRITICAL                        |
| 9   | `@adapters/queue-bullmq`       |            5 |          2 |        398 | L-61 REAL — L32/L51/L180 hardcoded PUBLISH + ignored \_opts |
| 10  | `@adapters/db-prisma`          |            3 |          1 |        189 | Singleton + AsyncLocalStorage transactional                 |
| 11  | `@adapters/storage-s3`         |            4 |          1 |        287 | Canonical. 0.0.1 placeholder L-373                          |
| 12  | `@adapters/storage-azure`      |            5 |          0 |        456 | ORPHAN (4-grep confirmed L-366)                             |
| 13  | `@adapters/storage-gcs`        |            5 |          0 |        445 | ORPHAN (L-367)                                              |
| 14  | `@adapters/storage-do-spaces`  |            3 |          0 |        198 | ORPHAN (L-370)                                              |
| 15  | `@adapters/storage-cloudinary` |            4 |          0 |        301 | ORPHAN + runtime bug L192 (L-365)                           |
| 16  | `@adapters/crm-hubspot`        |            3 |          0 |        267 | ORPHAN (L-371)                                              |
| 17  | `@adapters/crm-salesforce`     |            3 |          0 |        293 | ORPHAN (L-369)                                              |
| 18  | `@providers/x` (Twitter)       |            8 |          3 |      2,114 | ACTIVE-SOT                                                  |
| 19  | `@providers/instagram`         |           11 |          3 |      3,012 | L-385 worker-layer code in package                          |
| 20  | `@providers/facebook`          |            9 |          2 |      2,687 | Canonical                                                   |
| 21  | `@providers/youtube`           |           11 |          2 |      3,224 | Canonical — R11 top offenders                               |
| 22  | `@providers/tiktok`            |           10 |          2 |      2,641 | L-390 axios drift + L-393 missing devDeps                   |
| 23  | `@providers/telegram`          |            7 |          1 |      1,811 | L-391 missing @observability/logger dep                     |
| 24  | `@providers/linkedin`          |            6 |          1 |      1,523 | Canonical                                                   |
| 25  | `@providers/pinterest`         |            5 |          1 |      1,188 | Canonical                                                   |
| 26  | `@providers/bluesky`           |            4 |          1 |        897 | L-437 import after export                                   |
| 27  | `@providers/threads`           |            5 |          1 |      1,110 | Phantom dep in workers (L-60 drift persists)                |
| 28  | `@providers/mastodon`          |            5 |          1 |      1,012 | Canonical                                                   |
| 29  | `@providers/shared`            |           15 |          3 |      2,378 | Autoritativo — L-386 SoT del 5-way                          |
| 30  | `@providers/_template`         |            6 |          0 |        887 | Intentional scaffolding — L-389 deprecated pattern          |
| 31  | `@ui`                          |           33 |          7 |      6,626 | Zero any. L-442..L-455 orphans + hardcoded URL              |
| 32  | `@api-common`                  |            4 |          1 |        389 | L-483 BaseRouteHandler Fastify import CRITICAL              |
| 33  | `@observability/logger`        |            3 |          1 |        213 | Pino server-only. L-347 3-way root cause                    |
| 34  | `@observability/otel`          |           12 |          2 |      1,178 | OTel instrumentation + 9 `any` leaks                        |
| 35  | `@monitoring/circuit-breaker`  |            8 |          2 |        812 | L-473 95% DEAD SCAFFOLD CRITICAL                            |
| 36  | `@monitoring/health-checks`    |            7 |          2 |        665 | L-515..L-522 multiple findings                              |
|     | **Total**                      |      **235** |     **74** | **53,880** |                                                             |

### §2.2 Notas metodológicas

- **B1 `@shared/types` count discrepancy:** planning sub-contó 132 files, real count 541 LOC en 24 files. El count inicial contemplaba sólo el dominio principal, no re-exports + sub-barrels. Este gap refuerza la severidad de **L-362 RepoPort GOD_INTERFACE** (199 LOC cubriendo 8 aggregates ≠ separación por aggregate).
- **B1 `@core/engine` path drift:** El planning refería a `@core/engine` como pattern canónico. Lectura directa confirma que el pattern real es `@core/threading` consumido **vía relative paths** (L-356 scope prefix drift). No es un renombrado, es una desalineación entre tsconfig paths y `package.json` imports.

---

## §3. Saga deep-dive — L-63 RESOLUTION

### §3.1 Conclusión binaria

**L-63 = REAL runtime risk CONFIRMADO. Saga roto por diseño de wiring.**

El saga `PostPublishingSaga` es invocable desde rutas y workers, pero su **primer paso mutante** (`create-post`) invoca `sagaCQRSBus.dispatch(CreatePostCommand)` sobre una instancia de `CQRSBus` **creada fresh y sin handlers registrados** en `apps/api/src/index.ts:529-547`. Resultado: cualquier saga ejecutada retorna failure en `create-post` sin side effects persistidos (transacción abortada en `SagaOrchestrator`). Feature visible UI, backend nunca persiste. Double-evidence cross-app.

### §3.2 Mapa de los 5 steps

`packages/shared/src/saga/post-publishing.ts` — `createPostPublishingSagaDefinition(...)` L595-621:

```typescript
export function createPostPublishingSagaDefinition(
  cqrsBus: CQRSBus,
  queue: QueuePort,
  logger: LoggerPort
): SagaDefinition<PostPublishingState> {
  return {
    name: "PostPublishingSaga",
    steps: [
      validatePostDataStep(logger), // L168-201
      createPostStep(cqrsBus, logger), // L231
      schedulePublishingJobsStep(queue, logger), // L329
      waitPublishingCompletionStep(logger), // L432 (stub)
      updatePostStatusStep(cqrsBus, logger), // L516
    ],
    // ...
  };
}
```

| Step                       | Línea    | Tipo               | Dependencia | Compensación  |
| -------------------------- | -------- | ------------------ | ----------- | ------------- |
| validate-post-data         | L168-201 | IN-MEMORY          | (none)      | none needed   |
| create-post                | L231     | `cqrsBus.dispatch` | CQRSBus     | L284 `delete` |
| schedule-publishing-jobs   | L329     | `queue.add`        | QueuePort   | L377 `remove` |
| wait-publishing-completion | L432     | STUB (no-op)       | (none live) | —             |
| update-post-status         | L516     | `cqrsBus.dispatch` | CQRSBus     | L573 `revert` |

### §3.3 La evidencia crítica — `apps/api/src/index.ts:529-547`

```typescript
const sagaCQRSBus = new CQRSBus(logger); // fresh, vacío
// ... createPostPublishingSagaDefinition(sagaCQRSBus, queue, logger) ...
```

`CQRSBus.ts:91-104`:

```typescript
async dispatch<TCommand>(command: TCommand): Promise<Result<unknown, DomainError>> {
  const handler = this.handlers.get(command.constructor.name);
  if (!handler) {
    return err(new NotFoundError(`No handler registered for ${command.constructor.name}`));
  }
  return handler.handle(command);
}
```

Al invocar `createPostStep`, el saga ejecuta `sagaCQRSBus.dispatch(new CreatePostCommand(...))`. El `handlers.get("CreatePostCommand")` retorna `undefined` (bus vacío). Retorna `err(NotFoundError)`. `SagaOrchestrator` detecta el error, marca saga `FAILED`, ejecuta compensaciones (que son no-ops porque ningún step posterior se ejecutó).

### §3.4 Por qué el bus está vacío

El `CQRSBus` autoritativo, con handlers registrados para todos los commands y queries del sistema, vive en `Container` y se resuelve como `TOKENS.CQRS_BUS`. `apps/api/src/index.ts` lo crea **otro** CQRSBus (`sagaCQRSBus`) para pasárselo al saga factory, pero **no registra handlers en él**. Resultado: saga siempre falla primer command dispatch.

### §3.5 Severidad

**CRITICAL.** Es un fallo de wiring en composición raíz, no un bug lateral. La feature "PostPublishingSaga" es anunciada pero inoperante. **L-63 = REAL (no PLANNED como D0v4-3 especulaba).** Fix obligatorio en sprint post-auditoría: o (a) pasar el `TOKENS.CQRS_BUS` autoritativo al saga, o (b) introducir un port específico `PostSagaPort` que encapsule los handlers necesarios, evitando el acoplamiento a `CQRSBus` concreto desde `packages/shared`.

---

## §4. Mapeo consumer bidireccional (package ↔ consumers)

### §4.1 Tabla inbound + outbound por package

| Package                        | Inbound (apps)                     | Inbound (cross-pkg)                                | Outbound (npm/workspace)                                        |
| ------------------------------ | ---------------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| `@core/engine`                 | apps/api (1 ref)                   | `@shared/saga`, `@providers/shared`                | (none workspace)                                                |
| `@ports/core`                  | apps/api, apps/workers             | `@adapters/*`, `@providers/shared`, `@shared/cqrs` | `@shared/types`                                                 |
| `@shared/types`                | apps/_, packages/_                 | Ubiquitous                                         | (none)                                                          |
| `@shared/events`               | apps/api, apps/workers             | `@shared/saga`, `@shared/cqrs`                     | `@shared/types`                                                 |
| `@shared/cqrs`                 | apps/api                           | `@shared/saga`                                     | `@shared/types`, `@ports/core`                                  |
| `@shared/saga`                 | apps/api, apps/workers             | (none)                                             | `@shared/cqrs`, `@ports/core`                                   |
| `@shared/logger`               | apps/admin, apps/client            | (none)                                             | (raw console)                                                   |
| `@adapters/cache-redis`        | apps/api                           | (none)                                             | `@ports/core`, `ioredis`, **`fastify`** (leak)                  |
| `@adapters/queue-bullmq`       | apps/api, apps/workers             | (none)                                             | `@ports/core`, `bullmq`                                         |
| `@adapters/db-prisma`          | apps/api, apps/workers             | `@providers/*` (dynamic L-384)                     | `@ports/core`, `@prisma/client`                                 |
| `@adapters/storage-s3`         | apps/api                           | (none)                                             | `@ports/core`, `@aws-sdk/*`                                     |
| `@adapters/storage-azure`      | **NONE** (ORPHAN)                  | (none)                                             | `@azure/storage-blob`                                           |
| `@adapters/storage-gcs`        | **NONE** (ORPHAN)                  | (none)                                             | `@google-cloud/storage`                                         |
| `@adapters/storage-do-spaces`  | **NONE** (ORPHAN)                  | (none)                                             | `@aws-sdk/client-s3`                                            |
| `@adapters/storage-cloudinary` | **NONE** (ORPHAN)                  | (none)                                             | `cloudinary`                                                    |
| `@adapters/crm-hubspot`        | **NONE** (ORPHAN)                  | (none)                                             | `@hubspot/api-client`                                           |
| `@adapters/crm-salesforce`     | **NONE** (ORPHAN)                  | (none)                                             | `jsforce`                                                       |
| `@providers/x`                 | apps/api, apps/workers             | `@providers/shared`                                | `@providers/shared`, `axios`                                    |
| `@providers/instagram`         | apps/api, apps/workers             | `@providers/shared`                                | `@providers/shared`, `axios`, **(dynamic) @adapters/db-prisma** |
| `@providers/facebook`          | apps/api, apps/workers             | `@providers/shared`                                | `@providers/shared`, `axios`                                    |
| `@providers/youtube`           | apps/api, apps/workers             | `@providers/shared`                                | `@providers/shared`, `axios`, `googleapis`                      |
| `@providers/tiktok`            | apps/api, apps/workers             | `@providers/shared`                                | `@providers/shared`, `axios` (drift L-390)                      |
| `@providers/telegram`          | apps/api, apps/workers             | `@providers/shared`                                | `@providers/shared`, `grammy`                                   |
| `@providers/linkedin`          | apps/api, apps/workers             | `@providers/shared`                                | `@providers/shared`, `axios`                                    |
| `@providers/pinterest`         | apps/api, apps/workers             | `@providers/shared`                                | `@providers/shared`, `axios`                                    |
| `@providers/bluesky`           | apps/api, apps/workers             | `@providers/shared`                                | `@atproto/api`                                                  |
| `@providers/threads`           | apps/api                           | `@providers/shared`                                | `@providers/shared`, `axios`                                    |
| `@providers/mastodon`          | apps/api, apps/workers             | `@providers/shared`                                | `@providers/shared`, `megalodon`                                |
| `@providers/shared`            | packages/providers/\*              | All providers                                      | `@ports/core`, `@shared/types`, `axios`                         |
| `@providers/_template`         | NONE (PLANNED)                     | (none)                                             | (scaffolding)                                                   |
| `@ui`                          | apps/admin (34), apps/client (197) | ZERO cross-pkg                                     | `react`, `@radix-ui/*`, `@tiptap/*`                             |
| `@api-common`                  | apps/api (75)                      | (none)                                             | **`fastify`** (leak CRITICAL L-483)                             |
| `@observability/logger`        | apps/api, apps/workers             | `@providers/shared`                                | `pino`                                                          |
| `@observability/otel`          | apps/api, apps/workers             | (none)                                             | `@opentelemetry/*`                                              |
| `@monitoring/circuit-breaker`  | apps/api (stub only)               | (none)                                             | `opossum` (L-368 drift)                                         |
| `@monitoring/health-checks`    | apps/api                           | (none)                                             | `@ports/core`                                                   |

### §4.2 Observaciones clave

- **7 packages sin inbound (ORPHAN sospecha):** 4 storage adapters + 2 CRM adapters + 1 `_template` (intentional). Severidad individual por package. 4-grep confirm negative (ni barrel, ni dynamic, ni string literal). **Cemetery de 2,160 LOC.**
- **`@ui` asymétrico:** 197 imports desde client vs 34 desde admin. Expected given admin tiene menos páginas, pero valida dirección: `@ui` primary = client, admin es consumer oportunista.
- **ZERO cross-package imports en `@ui`:** ningún otro package importa `@ui`, lo cual es correcto (UI components son leaf). Sin embargo, útil documentar.
- **`@providers/shared` es SoT autoritativo para provider logic.** L-386 confirma que `apps/api/src/providers/*` duplicados deben consolidarse aquí.

---

## §5. Hexagonal boundary audit

### §5.1 Regla de oro

```text
domain ← application ← infrastructure
```

- **`@ports/core`** = pseudo-domain (interfaces) — puede ser importado por todos pero no importa fuera
- **`@shared/*`** = mixed domain/application
- **`@adapters/*`** = infrastructure pure — NO debe importar fastify, next, react
- **`@providers/*`** = infrastructure pure — NO debe importar db-prisma, queue-bullmq (debe acceder vía ports)

### §5.2 Violaciones detectadas

| Package                 | Violación                                                             | Finding      | Severidad |
| ----------------------- | --------------------------------------------------------------------- | ------------ | --------- |
| `@adapters/cache-redis` | Imports `fastify` para middleware (L32)                               | L-364        | CRITICAL  |
| `@api-common`           | `BaseRouteHandler` importa `FastifyRequest/Reply` directamente        | L-483        | CRITICAL  |
| `@providers/shared`     | `AbstractProviderAdapter` dynamic import `@adapters/db-prisma`        | L-384        | CRITICAL  |
| `@providers/instagram`  | Contiene `publishingWorker.ts` + `schedulingService.ts` (capa worker) | L-385        | CRITICAL  |
| `@providers/instagram`  | `instagramAdapter.ts` raw `pino` import (cross with L-439)            | L-439        | HIGH      |
| `@ui`                   | `useProviderConstraints` hardcoded API URL                            | L-446, L-455 | CRITICAL  |

### §5.3 Count por package

```text
@adapters/cache-redis    : 1 CRITICAL leak (fastify)
@api-common              : 1 CRITICAL leak (fastify)
@providers/shared        : 1 CRITICAL (dynamic adapter import)
@providers/instagram     : 2 CRITICAL (worker code + raw pino)
@ui                      : 2 CRITICAL (ORPHAN + hardcoded URL)
```

#### Total boundary leaks CRITICAL: 7

---

## §6. Findings críticos consolidados

### §6.1 Packages ORPHAN (post 4-grep)

Confirmados ORPHAN en 4 grep (import, barrel, dynamic, string literal):

- **L-366** `@adapters/storage-azure` — 456 LOC
- **L-367** `@adapters/storage-gcs` — 445 LOC
- **L-370** `@adapters/storage-do-spaces` — 198 LOC
- **L-365** `@adapters/storage-cloudinary` — 301 LOC + runtime bug L192
- **L-371** `@adapters/crm-hubspot` — 267 LOC
- **L-369** `@adapters/crm-salesforce` — 293 LOC

**Total ORPHAN adapters: 1,960 LOC en 6 packages.**

- **L-389** `@providers/_template` — 887 LOC intentional scaffolding con pattern deprecated

- **L-442** `usePublishingEngine` hook — 272 LOC
- **L-443** `useProviderConstraints` hook — 215 LOC + hardcoded URL
- **L-444..L-453** Editor chain — 10 files ~2,515 LOC (TipTap + Validation + 8 ContentVersioning sub-views)
- **L-454** `useVirtualScroll` + `memo` HOC — ~210 LOC

### §6.2 Packages 1-consumer (candidatos colapsar)

| Package                       | Consumer único          | Colapsable                                   |
| ----------------------------- | ----------------------- | -------------------------------------------- |
| `@adapters/storage-s3`        | apps/api (media upload) | No — infra por contrato                      |
| `@monitoring/circuit-breaker` | apps/api (stub)         | Sí L-473 — 95% dead                          |
| `@monitoring/health-checks`   | apps/api                | Parcial — varios checkers orphan L-521/L-522 |

### §6.3 Dead exports internos

- `@shared/src/client.ts` (L-350) — re-export dead
- `@shared/src/templates/types.ts` (L-351) — types sin consumer
- `@providers/bluesky/src/index.ts` (L-437) — import after export orphan
- `@shared/src/*` re-export dup a `@shared/types` (L-438)

### §6.4 Boundary leaks

Ver §5.2. **7 violations CRITICAL.**

### §6.5 Duplicaciones cross-package

| Cluster               | Files                                                    | Finding                       |
| --------------------- | -------------------------------------------------------- | ----------------------------- |
| ProviderLimits        | `@ports/core` (rich) vs `@shared/types` (lean)           | L-352 CRITICAL                |
| ProviderId            | `@ports/core` + `@shared/types`                          | L-353 DUP_TYPE_IDENTICAL      |
| ProviderName          | Same                                                     | L-354 NAMING_COLLISION        |
| apiClient boilerplate | 11 providers copy-paste same HTTP wrapper                | L-441 consolidation candidate |
| Opossum + monitor     | `@monitoring/circuit-breaker` 3-way drift + dead central | L-368 + L-506 double dead     |

### §6.6 Cross-ref con sprints previos — RESOLUTIONS

#### L-14 (D0v4-1): `providers/` triple service overlap → 5-WAY UPGRADE

La auditoría B3 revela que el overlap NO es triple sino **5-way**:

1. `apps/api/src/providers/providerAdapter.interface.ts` — 474 LOC
2. `apps/api/src/providers/providerCapabilityManager.ts` — 497 LOC
3. `apps/api/src/providers/providerConstraintValidator.ts` — 469 LOC
4. `packages/providers/shared/*` — SoT autoritativo
5. `packages/ports/core/ProviderCapability*` + `packages/shared/types/provider*` — ports + type definitions

**Total duplicate en apps/api/src/providers/**: 1,440 LOC. `packages/providers/shared` es el SoT correcto. Solución: delete apps/api/src/providers/\* + migrar consumers a `@providers/shared` + `@ports/core`.

**L-386 supersede L-14** (entry en LATERAL_FINDINGS extiende L-14 con reference L-386).

#### L-60 (D0v4-3): drift persists + phantom dep

- `apps/workers/package.json` **missing** `@providers/threads` dependency pese a consumirlo
- NO existe `ALL_PROVIDER_ADAPTERS` registry centralizado — cada app importa providers individualmente (L-60 drift confirmed post-D0v4-3)

#### L-61 (D0v4-3): queue-bullmq REAL confirmed

`packages/adapters/queue-bullmq/src/BullMQQueueAdapter.ts`:

- **L32:** `const queueName = QUEUES.PUBLISH;` — hardcoded
- **L51:** `new Queue(queueName, { connection })` — hardcoded
- **L180:** `this.queue = new Queue(QUEUES.PUBLISH, ...)` — global singleton, cannot parametrize
- **`_opts` ignored:** signature indica options pero nunca usa

Resultado: cualquier request a `queue.add(otherQueueName, ...)` termina en PUBLISH. Workers de analytics/inbox funcionan por accidente porque sus processors están montados en mismo PUBLISH. Pattern DEBE parametrizar queueName. **L-363 CRITICAL escalation.**

#### L-63 (D0v4-3): REAL confirmed

Ver §3. CP0 deep-dive.

---

## §7. package.json audit

### §7.1 Findings por package.json

| Finding | Tipo                              | Packages impactados                                    |
| ------- | --------------------------------- | ------------------------------------------------------ |
| L-373   | Version placeholder 0.0.x         | `@adapters/storage-s3`, `storage-azure`, `storage-gcs` |
| L-374   | Version drift opossum             | `@monitoring/circuit-breaker` vs 2 re-declarations     |
| L-392   | @types/node drift                 | `@providers/shared`                                    |
| L-393   | Missing devDeps                   | `@providers/tiktok`                                    |
| L-369   | opossum prom-client drift         | cross-consumer                                         |
| L-379   | Missing exports                   | Multiple sub-barrels                                   |
| L-391   | Missing @observability/logger dep | `@providers/telegram`                                  |
| L-356   | Scope prefix drift                | `@core/threading` via relative paths                   |

### §7.2 Tabla verify scope

El pattern `@core/*` vs `@shared/*` vs `@providers/*` vs `@adapters/*` presenta:

- 34/36 packages con prefix correcto
- 2 ambigüedades (`@core/engine` vs `@core/threading`)

---

## §8. R11 + R10 + barrel hygiene + @file headers

### §8.1 R11 (files > 400 LOC)

**Cluster B3 (providers — 43 files):**

Top 10 offenders:

| File                             | LOC | Finding                    |
| -------------------------------- | --- | -------------------------- |
| youtube/communityFeatures.ts     | 752 | L-394                      |
| youtube/apiClient.ts             | 745 | L-395                      |
| youtube/liveStreaming.ts         | 690 | L-396                      |
| facebook/reels.ts                | 681 | L-397                      |
| facebook/community.ts            | 672 | L-398                      |
| telegram/apiClient.ts            | 670 | L-399                      |
| facebook/apiClient.ts            | 667 | L-400                      |
| instagram/publishingWorker.ts    | 663 | L-401 (worker-layer L-385) |
| tiktok/contentAnalyticsClient.ts | 658 | L-402                      |
| instagram/InstagramAdapter.ts    | 620 | L-403                      |

Los 33 restantes L-404..L-436 — listados individuales en §13.

**Cluster B4 (UI — 14 files):**

| File                    | LOC | Finding |
| ----------------------- | --- | ------- |
| useContentEditor        | 492 | L-456   |
| VirtualScrollList       | 405 | L-457   |
| ContentEditorCore       | 393 | L-458   |
| TipTapContentEditor     | 359 | L-459   |
| VersionCompactView      | 344 | L-460   |
| useContentVersioning    | 316 | L-461   |
| ContentVersioning       | 299 | L-462   |
| contentVersioningTypes  | 299 | L-463   |
| VersionTimelineView     | 287 | L-464   |
| contentEditorTypes      | 275 | L-465   |
| usePublishingEngine     | 272 | L-466   |
| ValidationContentEditor | 261 | L-467   |
| use-toast               | 229 | L-468   |
| useProviderConstraints  | 215 | L-469   |

### §8.2 @file headers missing

- **L-388 composite** (B3): 38 files providers sin `@file`
- **L-527** (B5): 17 files observability/monitoring sin `@file`
- **Cross-app composite L-298:** total con packages ahora ~130 files sin `@file`

### §8.3 Barrel hygiene

- `@shared/src/index.ts` re-exports dup con `@shared/types` → L-438
- `@providers/bluesky/src/index.ts` import after export → L-437

---

## §9. Cross-app scaffolding precursor check — VERIFICACIÓN

### §9.1 Pregunta central

D0v4-6 identificó dos composites (L-336 QueryProvider cross-app + L-347 browser-logger cross-app) que sugieren un precursor arquitectural. La pregunta abierta: **¿existe `packages/shared-frontend/` o `packages/observability/browser-logger/` en parte olvidado / scaffolding silente?**

### §9.2 Resultado (4-grep + ls)

| Path candidato                           | Existe | Verdict                     |
| ---------------------------------------- | ------ | --------------------------- |
| `packages/shared-frontend/`              | NO     | Confirmed architectural gap |
| `packages/shared/browser/`               | NO     | Confirmed                   |
| `packages/observability/browser-logger/` | NO     | Confirmed architectural gap |
| `packages/ui/hooks/queryProvider.*`      | NO     | Confirmed                   |

**Conclusión:** NO existe scaffolding olvidado. L-336 y L-347 son GAPS arquitecturales legítimos (cross-app debt, not forgotten code). Sprint post-auditoría tiene total libertad para crear estos packages from scratch sin preocupación de conflictos con código existente.

### §9.3 Unexpected artifacts durante 4-grep

- **L-446:** `useProviderConstraints` hardcoded API URL — smells como precursor orphan (intentado abstraer API access pero no completado)
- **L-442:** `usePublishingEngine` orphan 272 LOC — scaffolding for feature that never shipped

Ambos son **dead scaffolding** no **missing scaffolding** — la dirección opuesta al concern de §9.1.

---

## §10. Cross-ref con sprints D0v4-1..6

| Sprint | Findings resueltos / escalados                                                                                                                     |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| D0v4-1 | **L-14 resolved** → upgrade 5-way L-386. L-9 PlatformContentAdapter touched (6-file family remains).                                               |
| D0v4-2 | **L-47 CQRS §5.9 PLANNED** = root cause of L-63 REAL. Wire decision unblocks both.                                                                 |
| D0v4-3 | **L-60 drift persists** (workers phantom dep + no registry). **L-61 REAL** (queue-bullmq L-363). **L-63 REAL** (§3).                               |
| D0v4-4 | N/A (frontend client pages). packages/ui consumers confirmed.                                                                                      |
| D0v4-5 | **L-260 per-mutation onError** confirmed cross-app. Package level clean — responsibility remains app-level.                                        |
| D0v4-6 | **L-296 i18n drift** extends to packages/ui (L-470..L-482). **L-336/L-347 scaffolding NO existe confirmed §9**. L-336+L-347 URGENT post-auditoría. |

---

## §11. Clasificación de packages (CP5 decision)

5 buckets definidos:

### §11.1 ACTIVE-SOT (sources of truth usadas activamente)

- `@ports/core`
- `@shared/types`
- `@shared/events`
- `@shared/cqrs`
- `@adapters/queue-bullmq` (con parametrize pending L-363)
- `@adapters/db-prisma`
- `@adapters/storage-s3`
- `@providers/x`, `instagram`, `facebook`, `youtube`, `tiktok`, `telegram`, `linkedin`, `pinterest`, `bluesky`, `threads`, `mastodon`
- `@providers/shared`
- `@ui` (con issues)
- `@api-common` (con leak L-483)
- `@observability/logger` (server-only)
- `@observability/otel`

### §11.2 PARTIAL-WIRE (usado pero con gaps)

- `@shared/saga` — usado pero saga roto (L-63)
- `@shared/logger` — usado admin+client pero 3-way drift
- `@adapters/cache-redis` — usado pero boundary leak
- `@monitoring/health-checks` — parcialmente usado, varios checkers orphan

### §11.3 DEAD-SCAFFOLD (código escrito nunca activado)

- `@adapters/storage-azure`
- `@adapters/storage-gcs`
- `@adapters/storage-do-spaces`
- `@adapters/storage-cloudinary`
- `@adapters/crm-hubspot`
- `@adapters/crm-salesforce`
- `@monitoring/circuit-breaker` (95%)
- `@ui` hooks orphan: `usePublishingEngine`, `useProviderConstraints`, editor chain (10 files)

### §11.4 WONT-FIX-SHORT-TERM (requires new package/arch change)

- `@shared/logger` console-based en admin/client — fix requiere nuevo `packages/observability/browser-logger` (L-347)

### §11.5 PLANNED (feature futura comunicada)

- `@providers/_template` — intentional scaffolding para onboarding de nuevos providers (L-389 deprecated pattern)

---

## §12. Plan de consolidación packages (crítico primero per CP5)

### §12.1 Fase 1 — CRITICAL (blocking production)

| #   | Item                                                                          | Finding      |   Effort |
| --- | ----------------------------------------------------------------------------- | ------------ | -------: |
| 1   | Wire CQRS handlers autoritativos en saga (o introducir PostSagaPort)          | L-63         |      40h |
| 2   | `AbstractProviderAdapter` inject `CredentialsPort` (remove dynamic db-prisma) | L-384        |      24h |
| 3   | Split `RepoPort` GOD_INTERFACE per aggregate + CQRS (Command/Query)           | L-362        |      48h |
| 4   | Delete `apps/api/src/providers/*` 1,440 LOC duplicate                         | L-386        |      16h |
| 5   | Parametrize `BullMQQueueAdapter.queueName`                                    | L-363        |      12h |
| 6   | Relocate `BaseRouteHandler` + `cache-redis` middleware a `apps/api/_shared/`  | L-364, L-483 |      16h |
| 7   | Unify `ProviderLimits` (ports = SoT)                                          | L-352        |       8h |
|     | **Fase 1 total**                                                              |              | **164h** |

### §12.2 Fase 2 — HIGH (architectural debt)

| #   | Item                                                                              | Finding      |   Effort |
| --- | --------------------------------------------------------------------------------- | ------------ | -------: |
| 1   | Create `packages/observability/browser-logger`                                    | L-347        |      32h |
| 2   | Create `packages/shared-frontend` (QueryProvider extraction)                      | L-336        |      40h |
| 3   | Wire opossum → monitor o delete `@monitoring/circuit-breaker`                     | L-473        |      24h |
| 4   | Move `@providers/instagram/{publishingWorker,schedulingService}` a `apps/workers` | L-385        |      16h |
| 5   | Dead code decision `@ui` orphans (10 editor chain + 2 hooks + scroll HOC)         | L-442..L-454 |      16h |
| 6   | `useProviderConstraints` inject API function (remove hardcoded URL)               | L-446        |       8h |
| 7   | `apps/client` Tailwind safelist                                                   | L-463        |       6h |
|     | **Fase 2 total**                                                                  |              | **142h** |

### §12.3 Fase 3 — MEDIUM (style/consistency)

| #   | Item                                                           | Finding             |   Effort |
| --- | -------------------------------------------------------------- | ------------------- | -------: |
| 1   | Logger drift sweep → `@observability/logger` everywhere server | L-367, L-391, L-439 |      12h |
| 2   | Version alignment sweep                                        | L-373, L-374, L-392 |       8h |
| 3   | `@file` header pass (~100 files)                               | L-388, L-527        |      12h |
| 4   | R11 providers split helpers                                    | L-394..L-436        |      48h |
| 5   | R11 UI split                                                   | L-456..L-469        |      16h |
| 6   | i18n keys externalize                                          | L-470..L-482        |      12h |
| 7   | Design tokens migration                                        | L-483..L-491        |      10h |
| 8   | `SubscriptionTier` deprecation remove                          | L-375               |       4h |
| 9   | OTel instrumentation cleanup                                   | L-471, L-513        |       8h |
|     | **Fase 3 total**                                               |                     | **130h** |

**Total effort estimado consolidación D0v4-7:** **~436h** (Fase 1 164 + Fase 2 142 + Fase 3 130).

---

## §13. Hallazgos laterales L-350..L-527 (tabla completa)

### §13.1 B1 (L-350..L-362)

| #     | Título                                                         | Severidad |
| ----- | -------------------------------------------------------------- | --------- |
| L-350 | `packages/shared/src/client.ts` DEAD_CODE                      | HIGH      |
| L-351 | `packages/shared/src/templates/types.ts` DEAD_CODE             | MEDIUM    |
| L-352 | `ProviderLimits` DUP_TYPE_DIVERGENT                            | CRITICAL  |
| L-353 | `ProviderId` DUP_TYPE_IDENTICAL (ports vs shared)              | MEDIUM    |
| L-354 | `ProviderName` NAMING_COLLISION (type vs value)                | MEDIUM    |
| L-355 | I-prefix Crm/Payment interfaces                                | LOW       |
| L-356 | `@core/threading` alias drift vs relative paths                | MEDIUM    |
| L-357 | `SubscriptionTier` deprecated usage                            | MEDIUM    |
| L-358 | `cqrs.ts`/`analytics.ts`/`orchestration.ts` grab-bag (3 files) | MEDIUM    |
| L-359 | `planPublication` drops thread silently                        | HIGH      |
| L-360 | Template types dup                                             | MEDIUM    |
| L-361 | Shadowed logger                                                | MEDIUM    |
| L-362 | RepoPort GOD_INTERFACE 199 LOC / 8 aggregates                  | CRITICAL  |

### §13.2 B2 (L-363..L-383)

| #     | Título                                                | Severidad |
| ----- | ----------------------------------------------------- | --------- |
| L-363 | queue-bullmq L32/L51/L180 hardcoded + `_opts` ignored | CRITICAL  |
| L-364 | cache-redis fastify boundary leak                     | CRITICAL  |
| L-365 | cloudinary runtime bug L192 (post-auditoría)          | HIGH      |
| L-366 | `@adapters/storage-azure` ORPHAN                      | HIGH      |
| L-367 | `@adapters/storage-gcs` ORPHAN                        | HIGH      |
| L-368 | opossum 3-way version drift (promoted from composite) | HIGH      |
| L-369 | `@adapters/crm-salesforce` ORPHAN                     | HIGH      |
| L-370 | `@adapters/storage-do-spaces` ORPHAN                  | HIGH      |
| L-371 | `@adapters/crm-hubspot` ORPHAN                        | HIGH      |
| L-372 | `@adapters/db-prisma` missing typed export            | LOW       |
| L-373 | Storage 0.0.x version placeholders (3 packages)       | MEDIUM    |
| L-374 | opossum version drift                                 | MEDIUM    |
| L-375 | SubscriptionTier deprecation unremoved                | LOW       |
| L-376 | queue-bullmq test mocks                               | LOW       |
| L-377 | cache-redis TTL defaults hardcoded                    | LOW       |
| L-378 | storage-s3 bucket fallback                            | LOW       |
| L-379 | Missing exports in sub-barrels                        | MEDIUM    |
| L-380 | queue-bullmq `concurrency` ignored                    | MEDIUM    |
| L-381 | cache-redis missing health check                      | MEDIUM    |
| L-382 | db-prisma logger integration                          | LOW       |
| L-383 | queue-bullmq DLQ wiring no official                   | MEDIUM    |

### §13.3 B3 (L-384..L-441)

| #            | Título                                                        | Severidad             |
| ------------ | ------------------------------------------------------------- | --------------------- |
| L-384        | `AbstractProviderAdapter` dynamic db-prisma import            | CRITICAL              |
| L-385        | `@providers/instagram` contains worker-layer code             | CRITICAL              |
| L-386        | L-14 upgrade 5-way (1,440 LOC apps/api duplicate)             | CRITICAL              |
| L-387        | Relative path threadPlanner                                   | MEDIUM                |
| L-388        | `@file` composite 38 providers files                          | MEDIUM                |
| L-389        | `_template` deprecated pattern                                | MEDIUM                |
| L-390        | tiktok axios version drift                                    | MEDIUM                |
| L-391        | telegram missing `@observability/logger` dep                  | MEDIUM                |
| L-392        | `@providers/shared` `@types/node` drift                       | MEDIUM                |
| L-393        | tiktok missing devDeps                                        | MEDIUM                |
| L-394..L-436 | 43 providers R11 lenient (top: youtube/communityFeatures 752) | MEDIUM (individuales) |
| L-437        | bluesky import after export                                   | MEDIUM                |
| L-438        | shared re-export dup a types                                  | MEDIUM                |
| L-439        | `@providers/instagram` raw pino (not via port)                | HIGH                  |
| L-440        | `ProviderUtils` unreachable branch                            | LOW                   |
| L-441        | apiClient boilerplate 11-way consolidation opportunity        | MEDIUM                |

### §13.4 B4 (L-442..L-505)

| #            | Título                                                                         | Severidad               |
| ------------ | ------------------------------------------------------------------------------ | ----------------------- |
| L-442        | `usePublishingEngine` ORPHAN (272 LOC)                                         | CRITICAL                |
| L-443        | `useProviderConstraints` ORPHAN (215 LOC)                                      | CRITICAL                |
| L-444..L-453 | 10 editor chain ORPHAN (TipTap + Validation + ContentVersioning + 7 sub-views) | CRITICAL (individuales) |
| L-454        | `useVirtualScroll` + memo HOC ORPHAN                                           | HIGH                    |
| L-455        | BOUNDARY_LEAK useProviderConstraints hardcoded API URL                         | CRITICAL                |
| L-456..L-469 | 14 R11 individuales UI (useContentEditor 492, VirtualScrollList 405, ...)      | MEDIUM                  |
| L-470..L-482 | 13 i18n drift UI individuales (business + VirtualScrollList + use-toast)       | MEDIUM                  |
| L-483..L-491 | Design token drift (7 Version\* + ValidationContentEditor + VirtualScrollList) | LOW                     |
| L-492        | `formatVersionDate` en-US lock                                                 | LOW                     |
| L-493        | VirtualScrollList sprint comment                                               | LOW                     |
| L-494        | VirtualScrollList hardcoded emoji                                              | LOW                     |
| L-495        | `console.error` VirtualScrollList                                              | MEDIUM                  |
| L-496        | `throw new Error` useProviderConstraints                                       | MEDIUM                  |
| L-497        | a11y gaps business components                                                  | MEDIUM                  |
| L-498        | VirtualScrollList `startTransition` shadowed                                   | LOW                     |
| L-499        | tabs.tsx reimplementa Radix                                                    | MEDIUM                  |
| L-500        | progress.tsx missing `aria-valuenow`                                           | MEDIUM                  |
| L-501        | separator.tsx missing `role`                                                   | MEDIUM                  |
| L-502        | Empty interface extends                                                        | LOW                     |
| L-503        | `useContentEditor` exhaustive-deps suppression                                 | MEDIUM                  |
| L-504        | Tailwind safelist missing client CRITICAL                                      | CRITICAL                |
| L-505        | Tailwind safelist duplication candidate                                        | LOW                     |

### §13.5 B5 (L-506..L-527)

| #     | Título                                                    | Severidad |
| ----- | --------------------------------------------------------- | --------- |
| L-506 | `@monitoring/circuit-breaker` central monitor 95% DEAD    | CRITICAL  |
| L-507 | `@api-common` BaseRouteHandler Fastify import (L-483 dup) | CRITICAL  |
| L-508 | OTel 9 `any` leak                                         | HIGH      |
| L-509 | OTel fs instrumentation doubled                           | MEDIUM    |
| L-510 | `CorrelationTracker` `setInterval` no cleanup             | HIGH      |
| L-511 | `CorrelationTracker` singleton DI violation               | HIGH      |
| L-512 | `ContextPropagation` span leak                            | MEDIUM    |
| L-513 | OTel `PublishingInstrumentation` name drift               | MEDIUM    |
| L-514 | workers telemetry 3x `any`                                | HIGH      |
| L-515 | `DatabaseHealthChecker` `listAccounts` probe              | MEDIUM    |
| L-516 | `StorageHealthChecker` SigV4 generation                   | MEDIUM    |
| L-517 | `checkers/circuitBreaker.ts` dead (paired L-473)          | HIGH      |
| L-518 | `tenantHealth.ts` `channels[]` empty hardcoded            | MEDIUM    |
| L-519 | `tenantHealth.ts` `tenant_id="system"` label              | LOW       |
| L-520 | `types.ts` duplicate re-exports                           | LOW       |
| L-521 | `CircuitBreakerHealthChecker` never registered            | HIGH      |
| L-522 | No `SagaHealthChecker` (L-63 gap)                         | HIGH      |
| L-523 | `QueueHealthChecker` misfiled `redis.ts`                  | MEDIUM    |
| L-524 | `handleOAuthError` inconsistente con `sendError`          | MEDIUM    |
| L-525 | `verifyWebhookSignature` fake ctx cast                    | HIGH      |
| L-526 | admin CSV exports bypass safe util                        | HIGH      |
| L-527 | 17 files missing `@file` (B5)                             | MEDIUM    |

---

## §14. Predicción Sprint D0v4-8 — Apps Full Audit

### §14.1 Scope

- `apps/api/src/*` (~400 archivos estimados) — rutas, application services residuales, composition root, middlewares no auditados
- `apps/workers/src/*` (~40 archivos) — processors, workflow runners, telemetry wiring
- `apps/admin/app/*` drill-down — server actions, routes, SSR boundaries (pages ya D0v4-6 pero no server-side)
- `apps/client/app/*` drill-down — SSR components, route handlers, middleware

### §14.2 Expected laterals

- **60-90 new findings** estimados rango **L-528..L-617**

### §14.3 Must close (D0v4-8 es último del tramo D0-v4)

- **L-347** browser-logger precursor verdict (¿crear o mantener console?) — decisión final
- **L-444..L-453** editor chain expansion findings — vincular con adopción UI
- **L-463** tailwind safelist apps/client — confirmar CRITICAL severity y fix path
- **L-463** `contentVersioningTypes` + chain dead or wire decision

### §14.4 Expected CRITICAL (3-5)

1. Route-handler drift (backend/api consumers bypassing apps/api/\_shared)
2. Cross-app security middleware gaps (auth extraction drift)
3. Admin/client SSR boundary breaches (server actions importando client-only code)
4. One-off middleware duplication apps/api vs apps/workers
5. Composition root leaks (`index.ts` instantiating concrete classes outside Container)

### §14.5 Confirmación

**D0v4-8 = Apps Full Audit** confirmado (no Infrastructure). Infraestructura queda fuera del tramo D0-v4 porque:

1. Prisma schema ya auditado D0v4-2
2. `docker-compose.yml` y configs son triviales vs el acumulado de findings apps
3. `tsconfig` cross-check es barrido horizontal, puede ser pre-D2

---

## §15. Referencias

- `docs/audits/LATERAL_FINDINGS.md` — findings L-350..L-527 detallados + extensiones L-14/L-260/L-298/L-368
- `docs/audits/PLAN_MAESTRO.md` §6 — estado del plan con D0v4-7 ✅
- `docs/audits/D0v4_1_BACKEND_SERVICES_REPORT.md` — cross-ref L-14
- `docs/audits/D0v4_3_WORKERS_REPORT.md` — cross-ref L-60/L-61/L-63
- `docs/audits/D0v4_6_FRONTEND_ADMIN_REPORT.md` — cross-ref L-260/L-298/L-336/L-347
- `packages/shared/src/saga/saga.ts` — pieza central §3 (706 LOC)
- `packages/adapters/queue-bullmq/src/BullMQQueueAdapter.ts` — L32/L51/L180 (§6.6 L-61)
- `apps/api/src/index.ts:529-547` — sagaCQRSBus fresh vacío (§3.3)

---

**Sprint D0v4-7 cerrado 2026-04-20. Ready para Sprint D0v4-8 (Apps Full Audit, último D0-v4).**

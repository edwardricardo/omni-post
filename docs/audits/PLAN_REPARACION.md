# Plan de Reparación — Findings de ESTADO_REPO.md

**Status global**: PENDIENTE
**Audit base**: [docs/audits/ESTADO_REPO.md](ESTADO_REPO.md) (2026-05-29, 35 findings)
**Estimación total**: 8-10h en 3 sesiones
**Branch base**: `main`
**Owner**: Edward

> Plan trackeable derivado del audit. Cada sesión cierra un grupo coherente de findings con commits granulares. Sin emojis, sin prosa innecesaria — el doc existe para medir avance, no para narrar.

---

## Tabla de progreso global

| Sesión | Scope                                           | Findings cubiertos                 | Estado                                                        | Branch                           | Commit final       |
| ------ | ----------------------------------------------- | ---------------------------------- | ------------------------------------------------------------- | -------------------------------- | ------------------ |
| **S1** | Workers consistency                             | F26, F27, F28                      | DONE (2026-05-29)                                             | `workstream/workers-consistency` | `2edb7875`         |
| **S2** | 3-preguntas one-by-one (threading + 3 archivos) | F11, F12, F13, F14                 | DONE (2026-05-29) — solo docs, 0 código                       | `workstream/post-audit-cleanup`  | _(pendiente push)_ |
| **S3** | Mecánicos combinados                            | F1, F2, F3, F16, F17, F22, F30–F34 | DONE (2026-05-29) — F3 y F22 reclassified como FALSO POSITIVO | `workstream/post-audit-cleanup`  | _(pendiente push)_ |

Estados posibles: `PENDIENTE` · `EN_CURSO` · `BLOQUEADO` · `DONE` · `CANCELADO`.

**Scope re-asignado al Implementation Roadmap** (no son cleanup, son features pendientes):

| Item                                  | Origen                                | Acción esperada                                                                               | Destino                                |
| ------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------- |
| Multi-storage completion (4 adapters) | D2 + F4-F7                            | IMPLEMENT — completar Azure, Cloudinary, DO Spaces, GCS + migration tooling entre proveedores | Implementation Roadmap (sección nueva) |
| Multi-CRM completion (2 adapters)     | D3 + F8-F9                            | IMPLEMENT — completar Hubspot + Salesforce                                                    | Implementation Roadmap (sección nueva) |
| Zapier integration                    | D3 (signaled by Edward) + F36 (nuevo) | IMPLEMENT — adapter + auth flow + endpoints expuestos                                         | Implementation Roadmap (sección nueva) |

---

## Decisiones bloqueantes (Edward)

| ID     | Decisión                                    | Bloquea        | Estado                | Resolución                                                                                                                                                                                            |
| ------ | ------------------------------------------- | -------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | TS version target                           | S3.1           | RESUELTA (2026-05-29) | Versión estable más actualizada que no rompa el código. Hoy = **TS 5.9.3**. Re-evaluar cuando TS 6 GA salga.                                                                                          |
| **D2** | Multi-storage scope                         | _(redirigido)_ | RESUELTA (2026-05-29) | IMPLEMENTAR completamente. Todos los providers (Azure, Cloudinary, DO Spaces, GCS) + migration tooling entre proveedores. **→ scope movido al Implementation Roadmap.**                               |
| **D3** | Multi-CRM + Zapier scope                    | _(redirigido)_ | RESUELTA (2026-05-29) | IMPLEMENTAR completamente. Hubspot + Salesforce como features enterprise. **Zapier también** (no estaba en el audit → F36 nuevo). **→ scope movido al Implementation Roadmap.**                       |
| **D4** | `@core/threading` — aplicar 3 preguntas     | S2             | RESUELTA (2026-05-29) | GENESIS-SCAFFOLDING-HALF-WIRE. NO DELETE. Backend funcional 5/5; UI dashboard pendiente. → SMELL-45.                                                                                                  |
| **D5** | F12–F14 archivos knip — aplicar 3 preguntas | S2             | RESUELTA (2026-05-29) | F12 FORGOTTEN-FEATURE (security gap, ya SMELL-35). F13+F14 DORMANT INFRASTRUCTURE (UI saga monitoring missing, KEEP-both por semánticas distintas vs `runSagaAndAwaitTerminal`). → DUP-03 + SMELL-46. |

### Las 3 preguntas (de `~/.claude/feedback/audit-deletion.md`)

Aplicación obligatoria antes de recomendar DELETE de cualquier código:

1. **Origin + intent**: ¿cuándo, por quién, por qué se escribió? (git log + comments + design docs + roadmap)
2. **Current purpose**: ¿qué debe hacer? (read code + JSDoc + tests + context)
3. **Duplication check**: ¿algo más implementa esto? (grep cross-codebase)

Solo si las 3 convergen en "obsoleto / sin propósito / duplicado" → DELETE. Si una sugiere "valid intent pending wire" → IMPLEMENT/WIRE, no DELETE.

Categorización resultante:

- **DEAD-DUPLICATE** → DELETE safe
- **DEAD-INFRA-OPTIONAL** → DELETE post-3Q
- **FORGOTTEN-FEATURE** → NEVER DELETE sin product decision (wire o implement)
- **GENESIS-SCAFFOLDING-DEAD** → DELETE post-3Q

---

## Out of scope (deliberado)

Documentado aquí para que sepamos qué NO se toca en este plan.

| Finding                                      | Razón de exclusión                                                                                                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F10 OpenTelemetry                            | Falso positivo: 2 dynamic imports legítimos (`apps/api/src/index.ts:16`, `apps/workers/src/telemetry/initialization.ts:74`). Re-clasificado a `LEGITIMO_DYNAMIC_IMPORT`. Acción: nota en su README + comentario. |
| F18 templateEngine.ts × 3                    | Sprint I1 futuro — requiere lectura comparativa.                                                                                                                                                                 |
| F19 businessMetrics.ts × 2                   | Sprint I1 futuro.                                                                                                                                                                                                |
| F20 circuitBreaker.ts × 2                    | Sprint I1 futuro.                                                                                                                                                                                                |
| F21 videoProcessor.ts × 3                    | Sprint I1 futuro.                                                                                                                                                                                                |
| F24 40 dirs con 1 archivo en `apps/api/src/` | Sprint estructural lejano — rediseño de organización por dominio.                                                                                                                                                |
| F25, F29, F35                                | Observaciones descriptivas, no requieren acción.                                                                                                                                                                 |

Scope NO cubierto por el audit original (registrado para futuro):

- `infra/prisma/` y demás subdirs de `infra/`
- `performance/`, `quality/`, `security/` root dirs
- `scripts/` root

---

# Sesión S1 — Workers consistency

**Duración estimada**: 2h
**Pre-requisito**: ninguno (puede arrancar HOY)
**Bloqueante de**: ninguno
**Branch propuesta**: `workstream/workers-consistency`

Razón de prioridad: única deuda **multiplicable** del audit. Si entra un tercer worker sin resolver, la asimetría se duplica.

## S1.1 — Diagnóstico

- [ ] Leer `apps/workers/src/mentionIngestWorker.ts` completo
- [ ] Leer `apps/workers/src/publishWorker.ts` completo
- [ ] Mapear en tabla las 3 diferencias concretas:

| Aspecto          | publishWorker | mentionIngestWorker | Acción        |
| ---------------- | ------------- | ------------------- | ------------- |
| Logger           | _(pendiente)_ | _(pendiente)_       | _(pendiente)_ |
| /health endpoint | _(pendiente)_ | _(pendiente)_       | _(pendiente)_ |
| Dev script       | _(pendiente)_ | _(pendiente)_       | _(pendiente)_ |

**Criterio done**: tabla rellena con paths + line numbers.

## S1.2 — F26 Logger uniformity

Migrar `mentionIngestWorker` de `pino()` directo a `createLogger` de `@observability/logger`.

- [ ] Editar `apps/workers/src/mentionIngestWorker.ts`
- [ ] Verificar binding `service:` coincide con publishWorker
- [ ] Smoke: `NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @apps/workers exec tsc --noEmit`

**Criterio done**: ambos workers usan `createLogger` del package compartido. Fitness #13 sigue en 0.

## S1.3 — F27 /health endpoint

Agregar /health en `mentionIngestWorker` copiando el patrón de `publishWorker`.

- [ ] Localizar bootstrap http de publishWorker (fastify? plain http?)
- [ ] Replicar en mentionIngestWorker con mismo puerto + path
- [ ] Smoke local: arrancar worker + `curl localhost:<port>/health` → 200

**Criterio done**: ambos /health responden 200 con shape idéntico.

## S1.4 — F28 dev script

Hacer que `pnpm dev:workers` arranque ambos workers (hoy arranca solo uno).

- [ ] Identificar script actual en `apps/workers/package.json` y/o root `package.json`
- [ ] Verificar qué arranca producción (`start:workers` o similar) — esa es la referencia de simetría
- [ ] Editar `dev:workers` para que arranque ambos con `concurrently` (o el runner ya presente)
- [ ] Test: `pnpm dev:workers` arranca los 2 + Ctrl-C los baja a ambos limpiamente

**Criterio done**: simetría entre `dev:workers` y `start:workers`.

## S1.5 — Validación

- [ ] `pnpm --filter @apps/workers exec tsc --noEmit` → 0 errores
- [ ] `pnpm --filter @apps/workers lint` → 0 errores
- [ ] `pnpm --filter @apps/workers test` → green
- [ ] Fitness #11 (raw setInterval) → 0
- [ ] Fitness #13 (direct pino en apps/api) → 0 (workers excluidos del check por canon)

**Criterio done**: todos ✓.

## S1.6 — Cierre

- [ ] Commits granulares: 1 por F26/F27/F28 (3 commits) o 1 unificado según diff size
- [ ] Update tabla de progreso global (arriba)
- [ ] Update estado de S1 → DONE
- [ ] Registrar commit SHA + branch en la tabla
- [ ] Preguntar a Edward: ¿push? (default: queda local)

---

# Sesión S2 — 3-preguntas one-by-one (threading + 3 archivos)

**Duración estimada**: 1.5–2h (reducido tras D2/D3 redirigidas)
**Pre-requisito**: D4, D5 (se resuelven aplicando las 3 preguntas dentro de la sesión)
**Bloqueante de**: ninguno
**Branch propuesta**: `workstream/threequestions-cleanup`

> Tras D2 + D3 redirigidas al Implementation Roadmap, S2 se reduce a 4 items que aplican el patrón **one-by-one** (no batch-cleanup) per `feedback/audit-deletion.md §one-by-one`.

## S2.1 — `@core/threading` (F11)

Aplicar las 3 preguntas:

- [ ] **Q1 Origin**: `git log --all -- packages/core/threading/` → ¿cuándo se creó? ¿commit message?
- [ ] **Q1 Intent**: ¿hay design doc o roadmap que lo mencione? `grep -rn "threading" docs/`
- [ ] **Q2 Purpose**: leer `packages/core/threading/src/index.ts` + cualquier file dentro
- [ ] **Q3 Duplication**: `grep -rn "thread\|conversation\|reply" packages/core/inbox/ packages/core/mentions/` — ¿algo lo implementa ya?
- [ ] Mapear flow end-to-end: ¿hay producer? ¿consumer planeado? ¿UI relacionada?
- [ ] Clasificar: DEAD-DUPLICATE / DEAD-INFRA-OPTIONAL / FORGOTTEN-FEATURE / GENESIS-SCAFFOLDING-DEAD
- [ ] Decisión documentada en este doc

**Criterio done**: clasificación explícita con evidencia + decisión registrada.

## S2.2 — `bruteForceProtection.ts` (F12)

- [ ] **Q1**: `git log --all -- <path>` — origen
- [ ] **Q2**: leer el archivo + tests si existen
- [ ] **Q3**: `grep -rn "bruteForce\|rateLimit\|loginAttempt" apps/ packages/` — ¿hay otra implementación de protección contra fuerza bruta? (security crítico — sospecho FORGOTTEN-FEATURE)
- [ ] Inspeccionar flow: ¿hay endpoint de login que debería usarlo? ¿middleware existente?
- [ ] Clasificar + decidir

**Criterio done**: clasificación + decisión.

## S2.3 — `useSagaStatus.ts` (F13)

- [ ] **Q1**: git log + commit que lo creó
- [ ] **Q2**: leer hook + comentarios
- [ ] **Q3**: ¿hay SagaStatus component o página que debería consumirlo? `grep -rn "SagaStatus\|sagaStatus" apps/admin apps/client packages/ui`
- [ ] Mapear: backend ya emite saga status? (probablemente sí — saga engine está implementado). ¿Falta solo la UI?
- [ ] Clasificar + decidir

**Criterio done**: clasificación + decisión.

## S2.4 — `useStartPostPublishingSaga.ts` (F14)

- [ ] Mismo procedimiento que S2.3 — están relacionados (ambos hooks de saga).
- [ ] Cross-check: si S2.3 = FORGOTTEN-FEATURE (UI pendiente), S2.4 casi seguro también.

**Criterio done**: clasificación + decisión.

## S2.5 — Ejecución según clasificación

Para cada item, según clasificación de S2.1–S2.4:

**Path DELETE** (DEAD-DUPLICATE | DEAD-INFRA-OPTIONAL | GENESIS-SCAFFOLDING-DEAD):

- [ ] Verificación dinámica adicional: `grep -rn "import([\"']@<path>" apps/ packages/` → 0 hits
- [ ] Borrar archivo
- [ ] Si es package: remover de tsconfig.base.json + `pnpm install`
- [ ] Typecheck por filter

**Path WIRE** (FORGOTTEN-FEATURE):

- [ ] Registrar en `docs/reports/code-duplications.md` o nueva sección de "Forgotten features pending wire" si no encaja allí
- [ ] Cross-referenciar al Implementation Roadmap como item nuevo
- [ ] NO borrar, NO modificar — solo registrar para decisión de producto

## S2.6 — Cierre

- [ ] Commits granulares: 1 por item con decisión + acción
- [ ] Update este doc con la clasificación final de cada uno
- [ ] Update tabla de progreso global
- [ ] Preguntar push

---

# Sesión S3 — Mecánicos combinados

**Duración estimada**: 3–4h
**Pre-requisito**: D1 resuelta (decisión TS)
**Bloqueante de**: ninguno
**Branch propuesta**: `workstream/mechanical-cleanup`

Razón de orden: último porque son los más bajos en consecuencia y los más fáciles. Ideales para llenar una sesión cerrando ruido.

## S3.1 — F1 TypeScript version → 5.9.3

D1 resuelta: consolidar en TS 5.9.3 (versión estable más actualizada). Re-evaluar a TS 6 GA cuando salga y no rompa el código.

- [ ] Pre-check: verificar `pnpm why typescript` actual y root `package.json` para confirmar 5.9.3 como target
- [ ] Aplicar sed: `find packages/core -name package.json -exec sed -i 's/"typescript": "6.0.2"/"typescript": "5.9.3"/g' {} +`
- [ ] Verificar conteo: `grep -rln "\"typescript\": \"6.0.2\"" packages/` → 0
- [ ] `pnpm install` → no errores
- [ ] `NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @apps/api exec tsc --noEmit` → 0
- [ ] `NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @apps/admin exec tsc --noEmit` → 0
- [ ] `NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @apps/client exec tsc --noEmit` → 0
- [ ] `NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @apps/workers exec tsc --noEmit` → 0

**Criterio done**: 0 occurrences de `"6.0.2"` en packages/core/\* + todos los tsc en 0.

## S3.2 — F2 tsx version sync

- [ ] Identificar versiones de tsx en `apps/api`, `apps/workers`, root: `grep -rn "\"tsx\"" apps/*/package.json package.json`
- [ ] Pinear todas a la versión más reciente coherente con root (4.21.0 según audit)
- [ ] `pnpm install`
- [ ] Smoke: `pnpm dev:api` arranca, `pnpm dev:workers` arranca

**Criterio done**: 1 sola versión de tsx en el lockfile (`pnpm why tsx`).

## S3.3 — F3 jq devDep

Diagnóstico hipótesis: `jq@1.7.2` en npm tiene `Cannot find module 'async'`. Hay 2 caminos:

- [ ] Si la dep no se usa por nadie en root scripts: `pnpm remove jq -w`
- [ ] Si SÍ se usa: cambiar a `node-jq` (wrapper funcional) o eliminar y migrar callers a `python3 -c "import json,sys; ..."` (lo que ya hicimos durante el audit)

- [ ] Decisión registrada
- [ ] Acción ejecutada
- [ ] Verificar scripts root: `pnpm <cualquier-script-que-usaba-jq>` corre

**Criterio done**: `pnpm jq` no falla con `Cannot find module 'async'`, o jq ya no está declarado.

## S3.4 — F16 i18n/request.ts consolidación

- [ ] `diff apps/admin/i18n/request.ts apps/client/i18n/request.ts` → confirmar 2 líneas de diff cosmético
- [ ] Decisión de destino:
  - Opción A: `packages/shared/i18n/request.ts` (más fácil, sin nuevo package)
  - Opción B: nuevo `packages/i18n-shared/` (más limpio si crece la i18n shared layer)
- [ ] Mover el archivo al destino elegido
- [ ] Editar `apps/admin/i18n/request.ts` y `apps/client/i18n/request.ts` para re-export del package
- [ ] Verificar next-intl sigue funcionando: `pnpm dev:admin` + `pnpm dev:client` arrancan sin warnings de i18n

**Criterio done**: 1 sola fuente de verdad, admin y client la consumen.

## S3.5 — F17 notificationStore.ts consolidación

- [ ] `diff apps/admin/.../notificationStore.ts apps/client/.../notificationStore.ts` → confirmar 1 línea de diff
- [ ] Destino probable: `packages/shared/stores/` o `packages/ui/stores/`
- [ ] Mover + re-export
- [ ] Smoke admin y client: notificaciones siguen funcionando

**Criterio done**: 1 sola fuente.

## S3.6 — F22 Outliers Fastify `fastify.X()`

Opcional. 5 handlers usan `fastify.X()` cuando los otros 163 usan `app.X()`.

- [ ] Localizar: `grep -rnP "fastify\.(get|post|put|delete|patch)\(" apps/api/src/`
- [ ] Editar los 5 a `app.X()` para alinear con el patrón mayoritario
- [ ] Verificar typecheck

**Criterio done**: 0 hits del grep arriba.

## S3.7 — F30–F34 Knip deps unused

- [ ] `pnpm exec knip --reporter compact` (freshness — pueden haber cambiado tras S2)
- [ ] Para cada dep reportada: verificación manual (puede ser falso positivo como F10)
  - [ ] Grep dinámico `import("<dep>")` + static `from "<dep>"`
  - [ ] Si 0 hits reales → marcar para borrar
- [ ] `pnpm remove <dep>` por cada confirmada
- [ ] `pnpm install`

**Criterio done**: knip reporta el delta esperado, ningún fp borrado.

## S3.8 — Validación final

- [ ] `pnpm --filter @apps/api exec tsc --noEmit` → 0
- [ ] `pnpm --filter @apps/workers exec tsc --noEmit` → 0
- [ ] `pnpm --filter @apps/admin exec tsc --noEmit` → 0
- [ ] `pnpm --filter @apps/client exec tsc --noEmit` → 0
- [ ] `pnpm lint` → 0 errors / 0 warnings
- [ ] `pnpm --filter @apps/api test` → green
- [ ] `pnpm --filter @apps/workers test` → green
- [ ] `pnpm build` (todos) → success
- [ ] Fitness functions (#1–#24): todas en 0
- [ ] Madge `--circular`: 0

**Criterio done**: todos ✓.

## S3.9 — Cierre

- [ ] Commits granulares por sub-batch (S3.1, S3.2, ... S3.7) — 6 commits aprox
- [ ] Update tabla de progreso global
- [ ] Registrar SHA + branch
- [ ] Preguntar push

---

# Cross-cutting (no son sesiones, son recordatorios)

## Re-auditoría

- [ ] Confirmar que CI corre madge `--circular` + knip + fitness en cada PR (checkpoint mensual barato).
- [ ] Próxima MAPEO_ESTADO_REPO completo: **2026-08-29** (trimestral) — o antes si entra cambio estructural grande (otro split, otra migración).

## Hooks tripwire

- [ ] Verificar que `pre_edit_tripwire_blocker.py` cubre los nuevos patterns introducidos por este plan (no parece, los sub-batches son ediciones legítimas).
- [ ] Plan Mode obligatorio para cada sesión S1/S2/S3 (el hook `pre_edit_planmode_guard.py` lo enforza en branch `workstream/*`).

---

# Apéndice A — Findings cubiertos vs no cubiertos

| Finding                               | Severidad                       | Sesión                      | Status                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 typescript 6.0.2                   | ALTO                            | S3.1                        | DONE (`1d83c852`) — audit imprecisión: conteo real 77 packages (no 48). Mass sed → 5.9.3 + lockfile regenerado. Typecheck OK en api/admin/client/workers.                                                                                                                                                                     |
| F2 tsx version drift                  | MEDIO                           | S3.2                        | DONE (`3f6dc2b8`) — pin 4.20.5 → 4.21.0 en apps/api, apps/workers, infra/prisma.                                                                                                                                                                                                                                              |
| F3 jq devDep broken                   | MEDIO                           | S3.6                        | CANCELED — FALSO POSITIVO. `pnpm exec jq --version` OK + 28 callers reales (security-scan.sh, run-quality-checks.sh, 2 CI workflows). Audit imprecisión.                                                                                                                                                                      |
| F4 storage-azure huérfano             | MEDIO                           | _(redirigido)_              | RE-SCOPED — Implementation Roadmap (D2: IMPLEMENT)                                                                                                                                                                                                                                                                            |
| F5 storage-cloudinary huérfano        | MEDIO                           | _(redirigido)_              | RE-SCOPED — Implementation Roadmap (D2: IMPLEMENT)                                                                                                                                                                                                                                                                            |
| F6 storage-do-spaces huérfano         | MEDIO                           | _(redirigido)_              | RE-SCOPED — Implementation Roadmap (D2: IMPLEMENT)                                                                                                                                                                                                                                                                            |
| F7 storage-gcs huérfano               | MEDIO                           | _(redirigido)_              | RE-SCOPED — Implementation Roadmap (D2: IMPLEMENT)                                                                                                                                                                                                                                                                            |
| F8 crm-hubspot huérfano               | MEDIO                           | _(redirigido)_              | RE-SCOPED — Implementation Roadmap (D3: IMPLEMENT)                                                                                                                                                                                                                                                                            |
| F9 crm-salesforce huérfano            | MEDIO                           | _(redirigido)_              | RE-SCOPED — Implementation Roadmap (D3: IMPLEMENT)                                                                                                                                                                                                                                                                            |
| F10 opentelemetry "huérfano"          | MEDIO                           | —                           | DONE — falso positivo (dynamic import legítimo)                                                                                                                                                                                                                                                                               |
| F11 core/threading huérfano           | MEDIO                           | S2.1                        | DONE — GENESIS-SCAFFOLDING-HALF-WIRE. NO DELETE. Registrado SMELL-45 (backend 5/5 OK, UI dashboard pendiente). Cross-ref TARGET_ARCHITECTURE_CANON_ES L99/106/178.                                                                                                                                                            |
| F12 bruteForceProtection unused       | BAJO                            | S2.2                        | DONE — FORGOTTEN-FEATURE (security gap OWASP A07:2021). NO DELETE. Ya documentado: SMELL-35 + `docs/security/BRUTE_FORCE_HOMOLOGATION_ES.md`. Wire pendiente workstream BF-HOMOLOG dedicado.                                                                                                                                  |
| F13 useSagaStatus unused              | BAJO                            | S2.3                        | DONE — DORMANT INFRASTRUCTURE. NO DELETE. Backend completo, falta `<SagaProgress>` UI. Registrado DUP-03 + SMELL-46.                                                                                                                                                                                                          |
| F14 useStartPostPublishingSaga unused | BAJO                            | S2.4                        | DONE — DORMANT INFRASTRUCTURE. NO DELETE. Bifurcación declarativa de saga sin consumer; canónica imperativa `runSagaAndAwaitTerminal()` cubre los 6 callers reales. DUP-03 + SMELL-46.                                                                                                                                        |
| F15 _(audit)_                         | _(reservar para audit re-read)_ | —                           | —                                                                                                                                                                                                                                                                                                                             |
| F16 i18n/request.ts dup               | MEDIO                           | S3.3                        | DONE (`f861870f`) — extract `createRequestConfig` factory a `packages/shared/src/i18n/`. admin+client reducidos a 4 LOC con delegate.                                                                                                                                                                                         |
| F17 notificationStore.ts dup          | MEDIO                           | S3.4                        | DONE (`1dc014e9`) — extract Zustand store a `packages/shared/src/stores/`. admin+client reducidos a re-export wrapper.                                                                                                                                                                                                        |
| F18 templateEngine.ts × 3             | MEDIO                           | I1 (futuro)                 | OUT OF SCOPE                                                                                                                                                                                                                                                                                                                  |
| F19 businessMetrics.ts × 2            | MEDIO                           | I1 (futuro)                 | OUT OF SCOPE                                                                                                                                                                                                                                                                                                                  |
| F20 circuitBreaker.ts × 2             | MEDIO                           | I1 (futuro)                 | OUT OF SCOPE                                                                                                                                                                                                                                                                                                                  |
| F21 videoProcessor.ts × 3             | MEDIO                           | I1 (futuro)                 | OUT OF SCOPE                                                                                                                                                                                                                                                                                                                  |
| F22 fastify.X outliers (5)            | BAJO                            | S3.6                        | CANCELED — FALSO POSITIVO. Audit decía "5 outliers" pero realidad es 201 `fastify.X()` vs 163 `app.X()` (drift histórico de convención semántica, AMBOS son FastifyPluginAsync sin diferencia funcional). NO hay outliers; cada file es internamente consistente. Standardize → sprint dedicado opcional.                     |
| F23 _(audit)_                         | _(reservar)_                    | —                           | —                                                                                                                                                                                                                                                                                                                             |
| F24 40 dirs con 1 archivo             | MEDIO                           | Sprint estructural (lejano) | OUT OF SCOPE                                                                                                                                                                                                                                                                                                                  |
| F25 observación granularidad          | BAJO                            | —                           | OUT OF SCOPE (descriptivo)                                                                                                                                                                                                                                                                                                    |
| F26 mentionIngest pino directo        | MEDIO                           | S1.2                        | DONE (`5c10792b`) — reframed: el audit era impreciso, todos workers usaban pino directo. Migrados los 4 a `@observability/logger` por proceso compartido.                                                                                                                                                                     |
| F27 mentionIngest sin /health         | MEDIO                           | S1.3                        | DONE (`c82722c9`) — Opción D: bootstrap.ts levanta server unificado + HealthCheckManager + shape Zod canon + 4 endpoints. Dockerfile HEALTHCHECK migrado a fetch /health (`2edb7875`).                                                                                                                                        |
| F28 dev:workers single                | MEDIO                           | S1.4                        | DONE (`1466f9c1`) — `dev` script ahora corre `tsx src/bootstrap.ts`.                                                                                                                                                                                                                                                          |
| F29 cross-app import en test          | BAJO                            | —                           | OUT OF SCOPE (test fixture)                                                                                                                                                                                                                                                                                                   |
| F30-F34 knip deps unused              | BAJO                            | S3.5                        | DONE (`835cc386`) — TODAS FALSAS POSITIVAS. Aplicación de 3-preguntas reveló wire real para `@axe-core/playwright` (a11y tests), `@hey-api/client-fetch` (codegen), `@react-email/*` (8 templates), `csv-parse` (bulk-scheduling). Fix: knip.json config + remove csv-parse redundante de apps/api. NO DELETE de deps reales. |
| F35 graph.html skipped (>5000 nodes)  | BAJO                            | —                           | OUT OF SCOPE (limitación tool)                                                                                                                                                                                                                                                                                                |
| **F36 Zapier integration missing**    | **MEDIO (nuevo)**               | _(redirigido)_              | RE-SCOPED — Implementation Roadmap (D3: IMPLEMENT). Signaled by Edward 2026-05-29 — no detectado por audit original (busqué huérfanos existentes, no missing infrastructure).                                                                                                                                                 |

> Los F15 y F23 no aparecen en la versión actual del audit (numeración con saltos). Re-leer ESTADO_REPO.md cuando arranque cada sesión para sincronizar IDs si Edward los re-enumeró.

---

# Apéndice B — Reglas operativas (heredadas de sesiones anteriores)

1. **Plan Mode obligatorio** antes de cualquier Edit/Write en branch `workstream/*` (hook `pre_edit_planmode_guard.py` lo enforza).
2. **Commits/push solo cuando Edward lo pida**. Preguntar explícitamente al cerrar cada sesión.
3. **pnpm exclusivamente**. Nunca npm/yarn.
4. **No mass-sed sobre imports `@core/*`** (tripwire #4). Las sed de S3.1 son sobre `package.json` keys, no sobre imports — permitido.
5. **NODE_OPTIONS=--max-old-space-size=4096** en cada `tsc` por filter (LXC OOM si root tsc).
6. **Cero canon-exception markers** introducidos por este plan. Si hay que introducir uno, parar y proponer ADR.
7. **git status limpio al inicio de cada sesión**. Si hay cambios sin commitear, reportar antes de proceder.
8. **Cada sub-checkbox cierra con criterio objetivo**, no con "parece bien".

---

# Apéndice C — Métricas de cierre del plan

Al cerrar S1+S2+S3, el repo debería medir:

| Métrica                             | Baseline (2026-05-29)           | Target                        | Real (post-cierre)             |
| ----------------------------------- | ------------------------------- | ----------------------------- | ------------------------------ |
| Findings ALTO                       | 1                               | 0                             | _(pendiente)_                  |
| Findings MEDIO en plan              | 14 (excl. los 7 re-scoped a IR) | ≤4 (I1 futuros + estructural) | _(pendiente)_                  |
| Findings BAJO                       | 12                              | ≤4                            | _(pendiente)_                  |
| Packages huérfanos a tratar en plan | 1 (threading)                   | 0 ó wired/documentado         | _(pendiente)_                  |
| Packages huérfanos re-scoped a IR   | 6 (storage ×4, crm ×2)          | n/a — IMPLEMENT en IR         | _(pendiente, depende IR)_      |
| Deps unused (knip)                  | 17                              | 0 ó documentadas              | _(pendiente)_                  |
| Workers simétricos                  | 0/3                             | 3/3                           | **3/3** (S1 closed 2026-05-29) |
| Ciclos circulares (madge)           | 0                               | 0                             | _(pendiente)_                  |
| Fitness functions en 0              | 24/24                           | 24/24                         | _(pendiente)_                  |

---

# Próximo paso operativo

Arrancar **S1.1 (diagnóstico workers)** apenas Edward dé luz verde. No requiere decisiones previas y desbloquea S1 completo en una sola sesión de ~2h.

En paralelo, Edward puede resolver D1/D2/D3/D4/D5 cuando quiera — eso desbloquea S2 y S3 sin urgencia.

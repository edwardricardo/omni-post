# OmniPost — Plan Maestro Consolidado

> **Fuente única de planificación y trabajo.** Reemplaza y fusiona `IMPLEMENTATION_PLAN_ES.md` (spine de features → §2-4) + `PENDING_WORK_INVENTORY.md` (consolidación → §1/§5) — **ambos retirados 2026-06-29**. Rescata como referencia viva: `FEATURE_TRACE_MATRIX_ES.md` (catálogo + canon 2026 §9 + orden §8.4, **CONSERVADO**) + la disciplina `PLAN_MAESTRO §5.8/§5.9` (→ §0.3, retirado). Su **base de evidencia** es la valoración verificada `docs/audits/FULL_REPO_ASSESSMENT_2026-06-29.md` (**CONSERVADA**, companion vigente) — juntas son la fuente de verdad: la valoración es el registro de hallazgos verificados, este plan el spine accionable derivado.
>
> **Estado:** documento vivo. **Owner:** Platform engineering / Edward.
> **Base de código:** `workstream/impl-revalidation @ 07c1faa5` (2026-06-29).
> **Regla de oro:** no se construyen features sobre un runtime roto — la **Fase N (Nivelación)** cierra antes de retomar el producto.

---

## §0 — Metodología (rescatada, aplica a todo el plan)

### 0.1 Tracking

- Estado por tarea: `[ ]` pendiente · `[~]` en progreso · `[x]` hecho · `[!]` bloqueado.
- **ID estable** por tarea. No renumerar; tareas nuevas usan el siguiente número libre de su serie.
- **Tamaño:** `[S]` ≤1 día · `[M]` 2-3 días. No hay `[L]`: si algo es más grande, se parte.
- **Dependencias:** `🔗 dep:<ID>` (no empezar hasta que esa esté `[x]`). `⛔ bloquea:<área>` = ítem cuya demora frena a otros.
- **DoD** = criterio objetivo y verificable. Sin DoD cumplido no se marca `[x]`.
- **App tags:** API `apps/api` · WRK `apps/workers` · CLI `apps/client` · ADM `apps/admin` · PKG `packages/*` · INFRA `infra/prisma` · CI `.github/workflows`.
- **Provenance + confianza** por ítem: `verified` (cruzado vs HEAD) · `confirmed-adversarial` (verificado adversarialmente en la valoración 06-29) · `pending-review` (hallazgo de auditoría sin re-confirmar) · `stale-verify` (fuente >2 semanas, re-auditar antes de actuar).

### 0.2 Barra de re-validación (antes de marcar cualquier `[x]`)

Toda tarea con código cierra solo si pasa las tres:

1. **0-defect** — lint (`--max-warnings 0`) · tsc · las 24 (→25) fitness functions · tests, todo verde.
2. **Seguridad** — los hallazgos de la valoración para el área del ítem (§1 + `docs/audits/FULL_REPO_ASSESSMENT_2026-06-29.md`) están atendidos o explícitamente diferidos con justificación.
3. **Dependency-freshness (ADR-0018)** — cada dep compartida = su pin del catálogo (latest stable, exact); privadas freshened; `pnpm install --frozen-lockfile` + `syncpack lint` verdes.

### 0.3 Disciplina de auditoría/cambio (de PLAN_MAESTRO §5.8/§5.9 — OBLIGATORIO)

- **Lectura directa = fuente de verdad.** Los greps localizan o hacen sanity cross-check; nunca son verdad final para clasificar código, decidir si un middleware corre, o afirmar "cero X" sin haber leído los archivos.
- **Ningún DELETE sin validación explícita de Edward.** La ausencia de consumers NO prueba dead-code. Taxonomía obligatoria antes de cualquier acción destructiva:
  - **PLANNED** — construido para feature futura intencional.
  - **INFRASTRUCTURE_READY** — infra esperando integración/wire-up.
  - **LEGACY** — tuvo consumers, se removieron, queda por migración gradual.
  - **DEAD_CODE** — genuinamente sin uso ni plan, **confirmado por Edward**.
  - Excepción (marcable sin validación, aún sin auto-delete): backups `.bak/.old`, scripts debug one-off, configs superseded, bloques comentados con git history.

### 0.4 Canon 2026 por feature

Cada tarea de producto (§2-§4) referencia su **canon de implementación 2026** (enfoque canónico + mejor práctica + anti-patrón), rescatado de `FEATURE_TRACE_MATRIX_ES.md §9`. Reverificar el canon antes de arrancar cada track (modelos/APIs cambian rápido). El canon NO contradice `CLAUDE.md`: los adaptadores nuevos reutilizan inbox/outbox + UoW + scheduler, no crean caminos paralelos.

---

## §P — PRE-FASE · Adjudicación de veredictos (docs + engram)

> **🔄 Mitad docs CERRADA (este slice) · mitad engram PENDIENTE.** Los veredictos de la valoración (WF1) se **adjudicaron 2026-06-29** (cada decisión ajustó el resto del plan; regla §0.3 respetada — ningún DELETE sin OK de Edward). Las **operaciones de docs** (ELIMINAR/ARCHIVAR/RECLASIFICAR + deleciones P.F) se escribieron en `workstream/cluster-b-mfa` (commits authored 2026-07-06/07: `76e92a9b` P.A · `0c5bc998` P.B · `cdfb0f78` P.C · `3d481563`/`e7b712f1` P.F) pero **NUNCA se mergearon a `main`** hasta el slice **docs-cleanup (PR #148)**, que las aterrizó vía cherry-pick (`3d481563` quedó vacío tras el pick — su contenido de MASTER_PLAN ya estaba en `main` por la sync de docs; el resto absorbido igual). La **mitad engram** (P.D 72 ARCHIVE + P.E 8/9 UPDATE) **no se ejecutó en ningún lado** — queda **PENDIENTE como tarea out-of-band** (engram es estado fuera del repo; este slice no lo toca). Las tablas P.A-P.E abajo son el **registro de adjudicación** (histórico).

### Dashboard Pre-Fase

| Bloque                                               | Ítems          | Estado                                                                       |
| ---------------------------------------------------- | -------------- | ---------------------------------------------------------------------------- |
| P.A Docs ELIMINAR                                    | 14 (+5 `_raw`) | ✅ 18 borrados                                                               |
| P.B Docs ARCHIVAR                                    | 36             | ✅ 18 borrados · 13 gateados→P.F · 2 conservados · 4 archivados · 1 keep     |
| P.C Docs RECLASIFICAR (1) + ACTUALIZAR (75, ref)     | 1+75           | ✅ 1 (→SECURITY_TESTING_FRAMEWORK); 75 mecánico (DOCS-INDEX-REBUILD §5.5)    |
| P.D Engram ARCHIVE                                   | 72             | ⬜ PENDIENTE (out-of-band; nunca ejecutada — engram fuera del repo)          |
| P.E Engram UPDATE (8) + MERGE (1)                    | 9              | ⬜ PENDIENTE (out-of-band; nunca ejecutada)                                  |
| P.F Ejecución post-adjudicación (2 VERIFY + 2 gates) | 4              | ✅ 0 ciclos · 14 reverse-orphans · 12 gaps rescatados · 13 gateados borrados |

### P.A — Docs a ELIMINAR (14) · requieren OK explícito (§0.3)

| #      | Doc                                                                     | Razón                                                                             | Dec. |
| ------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---- |
| P.A-1  | `docs/api/cqrs.md`                                                      | Documenta una API CQRS Bus inexistente; canon vive en ARCHITECTURE_CANON §CQRS    |      |
| P.A-2  | `docs/api/integration-examples.md`                                      | Endpoints `/api/commands/*` inexistentes; cubierto por README + docs por dominio  |      |
| P.A-3  | `docs/audits/T5_T6_PARALLELIZATION_DECISION.md`                         | Depende de docs ya borrados + modelo de planificación T4/T5/T6 muerto             |      |
| P.A-4  | `docs/audits/_raw/graph-admin.md`                                       | Reemplazado por `apps/admin/graphify-out/GRAPH_REPORT.md` (auto-rebuild)          |      |
| P.A-5  | `docs/audits/_raw/graph-api.md`                                         | Reemplazado por `apps/api/graphify-out/GRAPH_REPORT.md`                           |      |
| P.A-6  | `docs/audits/_raw/graph-client.md`                                      | Reemplazado por `apps/client/graphify-out/GRAPH_REPORT.md`                        |      |
| P.A-7  | `docs/audits/_raw/graph-packages.md`                                    | Reemplazado por `packages/graphify-out/GRAPH_REPORT.md`                           |      |
| P.A-8  | `docs/audits/_raw/graph-workers.md`                                     | Reemplazado por `apps/workers/graphify-out/GRAPH_REPORT.md`                       |      |
| P.A-9  | `docs/audits/_raw/madge-all.txt`                                        | Output regenerable de madge, sin valor persistente                                |      |
| P.A-10 | `docs/audits/_raw/madge-api-circular.txt`                               | Output efímero de madge                                                           |      |
| P.A-11 | `docs/audits/_raw/madge-circular.txt`                                   | Output regenerable de madge                                                       |      |
| P.A-12 | `docs/admin/dashboard.md`                                               | Claims rotos ("auth disabled"/"React 18"); superado por AUTH.md + admin-portal.md |      |
| P.A-13 | `docs/reports/audits/status-2026-05-07.md`                              | Output efímero de script sobre artefactos ya borrados                             |      |
| P.A-14 | `docs/reports/legacy/error.txt` (+ evaluar toda `docs/reports/legacy/`) | .txt/.png del prototipo SaaS original                                             |      |

### P.B — Docs a ARCHIVAR (36) · mover a `docs/archive/` (reversible)

> ⚠️ **Rescatar-antes-de-archivar:** `PLAN_MAESTRO.md` (§5.8/§5.9 ya rescatados a §0.3 — confirmar) · `LATERAL_FINDINGS.md` (bloqueado por P.F) · `TARGET_ARCHITECTURE_CANON_ES.md` (revisar si su visión sigue pendiente antes de archivar).

- **Roadmaps de migración cerrados (3):** `APPLICATION_MIGRATION_ROADMAP_ES.md` · `CORE_MIGRATION_ROADMAP_ES.md` · `development/PRISMA_DI_MIGRATION_ES.md`
- **Cluster auditoría D0-v4 + histórico (18):** `PLAN_MAESTRO.md` · `LATERAL_FINDINGS.md` · `D0_INVENTORY.md` · `D1_DECISIONS.md` · `ENDPOINT_AUDIT.md` · `CLIENT_LIB_HOOKS_AUDIT.md` · `ESTADO_REPO.md` · `PLAN_REPARACION.md` · `PHASE_0_TOOLING.md` · `INVENTORY_SUMMARY.md` · `_AUDIT_FINDINGS.md` · `AUDIT_REVIEW_TRACKING.md` · `horizontal-v1/A1-apps-client-orphan-sweep.md` · `inventory-{admin,api,client,packages,workers}.md`
- **Arquitectura histórica (3):** `TARGET_ARCHITECTURE_CANON_ES.md` · `instagram-schema.md` · `turborepo-future-flags-evaluation.md`
- **Guías cloud especulativas (4):** `deployment/{AWS,AZURE,DIGITALOCEAN,GCP}.md` (dev real = homelab)
- **Reports stale (6):** `reports/audits/{conceptual-audit,feature-decisions,providers-gaps}.md` · `reports/mutations/stryker-expansion.md` · `reports/planning/next-sprint-backlog.md` · `reports/updates/dependency-update.md`
- **Seguridad ya implementada (2):** `security/BRUTE_FORCE_HOMOLOGATION_ES.md` (ADR-0015) · `security/T0A_SECRETS_ROTATION_RUNBOOK.md`

### P.C — Reclasificar (1) + Actualizar (75, referencia)

- **RECLASIFICAR:** `docs/security/README.md` → mover junto al código que describe + borrar referencia a `container-security.yml` inexistente.
- **ACTUALIZAR (75, mecánico, no requiere adjudicación 1-a-1):** dominante = paths rotos por `application-services-to-core` en casi todo `docs/api/` + métricas investor rotadas (11 providers, 124 modelos, 4 LLM). Se corrigen cuando el área se toca. Lista completa en la valoración WF1 (artefacto de trabajo de la branch, no conservado).

### P.D — Engram a ARCHIVE (72) · artefactos SDD de changes cerrados + session summaries

> Bajo riesgo (memorias stale de workstreams cerrados). Adjudicar **en lote** salvo excepción. Lista completa por ID en la valoración WF1 (artefacto de trabajo de la branch, no conservado). Ninguna se borra sin tu confirmación (irreversible).

### P.E — Engram a UPDATE (8) + MERGE (1) · ediciones consecuentes

| #     | Obs                                           | Acción                                                           | Dec. |
| ----- | --------------------------------------------- | ---------------------------------------------------------------- | ---- |
| P.E-1 | #1 `sdd-init/omni-post`                       | UPDATE: datos base menores obsoletos                             |      |
| P.E-2 | #2 `testing-capabilities`                     | UPDATE: Vitest 4.0.18→4.1.8, turbo→2.9.16, "24"→"25" fitness     |      |
| P.E-3 | #4 `sdd/apps-api-review/explore`              | UPDATE: mapa estructural mayormente vigente, refrescar           |      |
| P.E-4 | #48 circuit-breaker fallback OFF              | UPDATE: regla durable, quitar el sweep 'PENDING' ya hecho        |      |
| P.E-5 | #50 worker eager env throw                    | UPDATE: caso publishWorker DONE (commit aa047e6f)                |      |
| P.E-6 | #73 queue-bullmq DI hardening                 | UPDATE: ya no 'deferred', se hizo (change queue-bullmq-redis-di) |      |
| P.E-7 | #80 `sdd/queue-bullmq-redis-di/explore`       | UPDATE: core sigue verdad, refrescar estado                      |      |
| P.E-8 | #91 `sdd/queue-bullmq-redis-di/verify-report` | UPDATE: PR1 mergeado, contextualizar                             |      |
| P.E-9 | #12 → #18                                     | MERGE: forward fix-all-warnings rule (dup)                       |      |

### P.F — Ejecución inmediata post-adjudicación (continuación de la Pre-Fase)

> **Se ejecuta apenas cierra la adjudicación (P.A-P.E), ANTES de la Nivelación.** NO son backlog diferido de §5: son los rescates y gates que la propia adjudicación generó y que deben resolverse para poder borrar con seguridad los docs gateados. Bloquean el cierre de la Pre-Fase.

- [x] **P-VERIFY-1** — **CERRADO 2026-06-29: 0 ciclos** en `apps/client` (madge 8.0.0 + dependency-cruiser; el ciclo del snapshot viejo era artefacto de resolución de paths). Gotcha → **CI-CLIENT-DEPCRUISE** (§5.2).
- [x] **P-VERIFY-2** — **CERRADO 2026-06-29:** 14 reverse-orphans NUEVOS (FE→endpoint inexistente, 404 runtime) → capturados en §5.3 `FE-BE-CONTRACT-BREAKS`; ~195/495 endpoints huérfanos (baja de 300, clasificados); 3 route files inalcanzables (optimizedPostsRoutes=FN-009, rateLimitingDashboard=FN-010/027, CQRSIntegration=nuevo). Detalle: los resultados P-VERIFY de la branch (artefacto de trabajo, no conservado; evidencia base: `docs/audits/FULL_REPO_ASSESSMENT_2026-06-29.md`).
- [x] **P-GATE-1** — **CERRADO 2026-06-29:** absorción ~90% (12/14 críticos escalados resueltos en código); **7 gaps rescatados a §5.7** (L-1 MFA-duality el crítico-de-seguridad). Los 11 docs quedan borrables. Detalle: los resultados P-GATE-1 de la branch (artefacto de trabajo, no conservado; evidencia base: `docs/audits/FULL_REPO_ASSESSMENT_2026-06-29.md`). Docs gateados (borrables tras el rescate):
  - (a) `LATERAL_FINDINGS.md` (647 hallazgos; audit lineage PLAN_MAESTRO/D0-v4).
  - (b) `ESTADO_REPO.md` (1253 líneas: duplicación/huérfanos/mismatches — 2026-05-29, NO en la provenance del inventory) + su plan acoplado `PLAN_REPARACION.md` (35 findings, Status PENDIENTE — registro reparado-vs-abierto, INPUT del gate).
  - (c) **Cluster F5 (audit 2026-05-11):** `INVENTORY_SUMMARY.md` + los 5 `inventory-{api,workers,admin,client,packages}.md` (datos crudos, 1477 archivos) + `_AUDIT_FINDINGS.md` + `AUDIT_REVIEW_TRACKING.md` (hallazgos — listados como provenance del inventory → asertados absorbidos en `FN-*`, **confirmar**).
  - **DoD:** cross-referencia de los tres grupos; usar `PLAN_REPARACION` para saber qué de `ESTADO_REPO` cerró Track 2 vs qué sigue abierto; los no-absorbidos entran a §5 con su ID; recién entonces **todos** son borrables.
- [x] **P-GATE-2** — **CERRADO 2026-06-29:** 25/28 bloques ejecutados/capturados; **5 gaps rescatados** (§4: employee-advocacy F3-API-9 + full-ad-management en "Nunca"; §5.8: industry-benchmarks + marketplace + dropbox). `feature-decisions.md` + `next-sprint-backlog.md` quedan borrables. Detalle: los resultados P-GATE-2 de la branch (artefacto de trabajo, no conservado; evidencia base: `docs/audits/FULL_REPO_ASSESSMENT_2026-06-29.md`).

---

## §1 — FASE N · NIVELACIÓN (bloqueante transversal · P0)

> **Cierra antes de retomar producto.** Estos ítems corrompen datos, filtran cross-tenant, rompen el runtime de publicación (del que dependen TODAS las fases), o dejan el CI sin red de regresión. Fuente: valoración 06-29 (confirmados adversarialmente) + §2 abiertos del inventario. Orden interno: seguridad P0 → correctness del core → red de regresión → docs P1.

### Dashboard de Nivelación

| Bloque                                      | Tareas | Hechas | Estado |
| ------------------------------------------- | ------ | ------ | ------ |
| N.A Seguridad P0 (cross-tenant / DoS + MFA) | 5      | 3      | 🔄     |
| N.B Correctness del core-publishing         | 7      | 0      | ⬜     |
| N.C Red de regresión (assurance)            | 3      | 0      | ⬜     |
| N.D Docs P1                                 | 2      | 0      | ⬜     |
| **Total Nivelación**                        | **17** | **3**  | 🔄     |

> **ℹ️ COORDINACIÓN (resuelta — 2026-07-14).** Este plan vive en `main` (movido desde `workstream/cluster-b-mfa`, donde nació durante el Cluster B y drift-eaba respecto a las branches de ejecución). Ritual de actualización: el dashboard se actualiza **al cierre de cada cluster** (no de cada slice) con un micro-PR docs-only a `main`. La copia que existía en `cluster-b-mfa` fue retirada para que el PR #108 quede limpio de tracking ajeno a MFA.
>
> **ℹ️ CAMPAÑA DE MERGE 2026-07-19..21 (extracción de las mega-branches).** Las mega-branches de ejecución (#97/#107/#108/#110) se **cerraron** y su contenido aterrizó en `main` como slices de extracción revisables: **N-SEC-1/1b → PR #124**, **N-SEC-2 → PR #125**, **CWE-269 (register) → PR #126**, higiene → PR #127, purga CQRSIntegration → PR #128 (ver §5.3), **N-SEC-5 MFA → PRs #129-133**. La fundación audit-actor A1 (ADR-0020) aterrizó en **PR #130**; el read-path A2 sigue PENDING (change `audit-actor-polymorphism` vivo, fuentes en `cluster-b-mfa`). Detalle de la campaña + batch de dependencias/higiene: [`docs/reports/merge-campaign-2026-07-21.md`](../reports/merge-campaign-2026-07-21.md). Branches conservadas (mapeadas): `cluster-b-mfa` (referencia §2F v1 + fuente A2), `webhook-wiring` (blueprint WEBHOOK-INGEST), `containerization-image-hardening` (#89 en pausa, ADR de bundler primero).

### N.A — Seguridad P0 (cross-tenant / DoS)

- [x] **N-SEC-1 ✅ + N-SEC-1b ✅** `[M]` **PKG** — Cache del circuit-breaker filtra datos entre cuentas. `confirmed-adversarial` (CRÍTICO). **CERRADO** (`98627f8c` + `c1688d23`; merged a `main` vía **PR #124**, 2026-07-19): la valoración era 1 vector (cache) pero eran **3** — L1 cache + L2 fallback store + **binding del closure del breaker** (el más profundo: opossum bindea el closure del primer caller por key y lo re-corre para el resto). Cerrados: L1/L2 con discriminante `hashCallScope` + fail-safe; el binding con el **dispatcher genérico D8** (el breaker corre siempre el closure del caller). 134 call sites, STATE per-tenant con LRU sin timers, 60 sitios auditados, 237/237 tests. Detalle: `openspec/changes/archive/cross-tenant-criticals/archive-report.md`. ⛔ bloquea: toda feature multi-tenant. La cache key de `packages/adapters/external-apis/src/circuitBreaker.ts:318` = `service:operation:base64(args)` con `args=[]` (params reales en el closure) sobre un **singleton de proceso**; `facebook validate-credentials` cachea el access_token de la Page y lo sirve a otra cuenta. **DoD:** la key incluye discriminante de credencial/tenant + los params reales (o se deshabilita L1 para lecturas credential-scoped); auditados los ~20 sitios `cacheEnabled:true`; test de aislamiento cross-account. Relacionado: **N-SEC-1b** `[S]` particionar el breaker por cuenta (hoy un tenant que falla abre el circuito para todos — `cb-shared-breaker-xtenant-02`, ALTA).
- [x] **N-SEC-2 ✅** `[M]` **CLI+ADM** — Proxies Next borran la IP real → rate-limit colapsado. `confirmed-adversarial` (CRÍTICO). **CERRADO** (`95b4ec66`; merged a `main` vía **PR #125**, 2026-07-19): helper `forwardedForHeaders` **relay-not-append** en los 4 egress; `resolveClientIp` cuenta-desde-la-derecha sin cambios (canon OWASP verificado — el leftmost spoofeable se ignora); `TRUSTED_PROXY_HOP_COUNT` estable. +W-C2-1 (rutas admin `/admin/auth/{login,refresh}` a `AUTH_ROUTE_RULES`, 5/15min). 31 tests. Precondición prod: ≥1 proxy confiable delante de Next. Los proxies `[...path]/route.ts:69` (client y admin) + las server actions de auth no propagan `X-Forwarded-For`/`X-Real-IP` → el backend ve la IP del server Next para todos; 5 requests anónimos bloquean el login de todo el portal. **DoD:** append de la IP real del request entrante a `X-Forwarded-For` + ajustar `TRUSTED_PROXY_HOP_COUNT`; replicado en admin; test que verifica buckets per-IP distintos.
- [ ] **N-SEC-3** `[M]` **API+INFRA** — IDOR-TRACKEDLINK + guard para modelos `projectId`-only. `confirmed-adversarial` (ALTA) + root-cause `ARCH-PROJECT-SCOPED-GUARD-GAP`. `apps/api/src/links/linkRoutes.ts` get/stats/**delete** por `:id` sin gate de accountId; `TrackedLink` no tiene columna `accountId` → fuera del guard. **DoD:** gate de ownership en las rutas de links; y un mecanismo (guard secundario o denormalización de `accountId`) para los ~9 modelos `projectId`-only (ProjectMember, Post, **Channel** [credenciales cifradas], TrackedLink, Campaign, ScheduledReport, ExternalNotificationConfig, GeneratedImage, RecurringPost) — priorizar Channel y ExternalNotificationConfig por contener secretos descifrables. Verificar el patrón compensatorio de join documentado en `MULTI_TENANT_GUARDS.md §Transitively-scoped` está presente en cada adapter (el audit S2.1d no lo evidenció). **🔄 EN CURSO (2026-07-14)** — rollout secuencial en marcha, **Approach A** (denormalizar `accountId` + guard + RLS, por construcción; OWASP API1:2023). Clasificación de los 9 modelos hecha (`openspec/changes/project-scoped-tenant-guard/rollout-plan.md` + engram obs 260): **7 de 9 con IDOR cross-tenant VIVO**. **Cerrado hasta ahora:** (a) IDOR read/delete de TrackedLink → PRs #109/#110 (adapter-join + purga CQRS); (b) hotfix `DELETE /posts/:id` (Slice 0) → #112; (c) **reference impl** ExternalNotificationConfig al guard+RLS (Slice 1, uno de los 2 credential-bearing priorizados) → #113; (d) ScheduledReport+Campaign al guard+RLS (Slice 2) → #114 — incluye el cierre del **untag join-table IDOR** (`campaignPost` sin `accountId`: el enrolamiento no cubre mutaciones de tabla join; fix app-level con `findById` guardado) y, colateral, el arreglo del CI para branches stacked (`workstream/**` triggers) + el fix del boot de Integration Tests que estaba ROJO en todos los pushes a `main` desde 2026-06-24. Todos con full SDD (8 fases) + gate adversarial + verify PASS + CI verde. **Restante (Slices 3-8):** RecurringPost+TrackedLink (fold estructural; propose en curso) · GeneratedImage · ProjectMember · audit de callers fuera de contexto · Channel · Post. **Hallazgos de ejecución (no vistos en la valoración):** (1) el create-path de cada modelo acepta `projectId` del cliente sin ownership check (engram obs 273) → paso obligatorio de la receta; (2) el enrolamiento NO cierra rutas que mutan o atraviesan tablas join/hijas ni las que saltan el `findById` guardado — aplica a WRITEs y READs (engram obs 285) → cada slice audita la superficie completa de rutas y su suite two-tenant cubre TODAS las rutas del modelo. Backlog SMELL-54/55/56.
- [ ] **N-SEC-4** `[S]` **API** — Cache de respuestas AI omite accountId (`CACHE-XTENANT-AI`). `verified` (MEDIA). `ai/orchestrator.ts:220` key `ai:${type}:${sha256(...)}` sin accountId; mismo `CachePort` compartido BYOK y pool. **DoD:** segmento accountId (o scope byok-vs-pool) en ambas keys; corrige la contaminación + el skew de billing (`tokensUsed=0` en hits).
- [x] **N-SEC-5 ✅** `[M]` **[SECURITY, ALTA]** **API** — MFA-duality (L-1, rescatado P-GATE-1). **CERRADO** (`005b7252` PR1 → `c89b7d95` PR2 → `da8ef686`/`eb84ee28`/`806eaf60`+`e9a75e8a` PR2b → `d2bd7b40`+`7f95bf2e` PR3 → `0df5f84e` archive; merged a `main` en la campaña de extracción **PRs #129-133**, 2026-07-19..21: #129 MFA-consolidation-PR1, #130 audit-actor-foundation (ADR-0020, A1 — read-path A2 sigue PENDING en `audit-actor-polymorphism`), #131 customer-mfa-persistence, #132 customer-login-mfa-gate, #133 mfa-legacy-retirement; el legacy `auth/mfaService.ts` quedó **eliminado**, `openspec/mfa-consolidation` ARCHIVADO con delivery map). El alcance real superó al DoD original: además de unificar los dos servicios detrás de un port + DI (SMELL-37 cerrado) y migrar los backup codes a `mfaBackupCodes` (con backfill idempotente y guard fail-closed), el SDD destapó **tres agujeros vivos** que la valoración no veía: (1) los audits de sujeto customer se **perdían en silencio** (FK de `AuditLog.userId` solo a AdminUser) → resuelto en su propio change con ADR-0020 (actor polimórfico, arco exclusivo); (2) el **TOTP era replayable ~150s** (window ±2, sin marcar uso) violando NIST SP 800-63B §5.1.5.2 → single-use por compare-and-set para ambos sujetos; (3) el **login de customer nunca desafiaba MFA** → gate real con challenge token de 180s, single-use atómico, fail-closed y anti-oracle. Living specs: `openspec/specs/{unified-mfa-service-and-port,customer-mfa-persistence,mfa-flow-correctness,customer-login-mfa-challenge}/spec.md`. Detalle: `openspec/changes/archive/mfa-consolidation/archive-report.md`. **Corrección de esta ficha:** decía que el legacy hasheaba los backup codes con SHA-256 — es **falso**, siempre usó el helper canónico argon2id (verificado contra el fuente antes de borrarlo); el único hack era la **ubicación** (`passwordResetToken`), no el hasher.

### N.B — Correctness del core-publishing (pérdida de datos)

- [ ] **N-COR-1** `[M]` **PKG(saga)+API** — `UpdatePostStatusStep` es un no-op → posts publicados quedan DRAFT y la saga reporta COMPLETED. `confirmed-adversarial` (ALTA). ⛔ bloquea: toda feature de publicación. El handler `post.update` descarta `status`/`publishedAt` (`PostCommandHandlers.ts:220`); encadena con la guard "only DRAFT can be published" → permite re-publicar. **DoD:** enrutar el step a un comando que transicione estado (`POST_COMMANDS.PUBLISH_POST` ya valida) o `UpdatePostStatusUseCase` con OCC; test de integración que assertea `Post.status=PUBLISHED` + `publishedAt` tras saga publish-now.
- [ ] **N-COR-2** `[M]` **API(saga-runtime)** — Sagas in-flight mueren en deploy/restart + loop de re-fail + wait-starvation. `confirmed-adversarial` (ALTA ×3). (a) `loadActiveSagas()` en boot no reanima PENDING/RUNNING → el timeout las FAILEA sin compensar; (b) `failSaga` no hace `activeInstances.delete` + timeout checker sin filtro terminal → re-fail cada 60s para siempre (EventStore crece sin cota); (c) `WaitForPublishingCompletion` quema los 3 retries con "still pending" → publicaciones lentas/multi-canal mueren FAILED. **DoD:** reanudar PENDING/RUNNING(sin nextRetryAt) en `initialize()`; `activeInstances.delete` + guard terminal en `failSaga`/timeout; separar "waiting" de "failed" en el contrato del step (pending no consume retryCount).
- [ ] **N-COR-3** `[M]` **CLI** — Publishing del client roto (composer no publica / publish falso / endpoint admin 401 / invalidación). `confirmed-adversarial` (ALTA ×5). Composer de `/posts/new` nunca publica (`initialContent` estática); `publishPost` hace draft y toastea "published"; scheduling llama `/admin/*` con token customer → 401; `queryKeys.posts()` = `["posts",undefined]` no invalida; autosave sin flush on-unload = pérdida de datos. **DoD:** levantar el estado de contenido del composer; unificar a un solo flujo de publish (saga publish-now con channelIds + contenido vivo); endpoint customer `/posts/scheduled` (o reusar `GET /posts?status=SCHEDULED`); fix de la query key; flush de autosave en `pagehide`.
- [ ] **N-COR-4** `[S]` **API** — Billing dunning muerto (`BILLING-DUNNING-DEAD`). `verified` (ALTA). Re-deriva el `provider` del payload + `processed=true` irreversible → fallo de webhook Stripe tragado en silencio. **DoD:** pasar el `provider` del route al service en `handlePaymentFailed/Succeeded`; test de webhook fallido que verifica el dunning corre.
- [ ] **N-COR-5** `[S]` **API+INFRA** — Cascade delete no transaccional (`DELETE-CASCADE-NONTX`). `verified` (ALTA). Cascada multi-tabla fuera de tx → huérfanos en fallo parcial. **DoD:** envolver en `unitOfWork.executeInTransaction` o mover `onDelete:Cascade` al schema (PostContent/PostMedia/Post/Channel).
- [ ] **N-COR-6** `[S]` **API** — Scheduling ignora timezone/DST (`SCHED-TZ`). `verified` (ALTA). `computeNextRun` corre a la hora del server. **DoD:** `cron-parser` con opción `tz` alimentado por `entity.timezone` (zona IANA); test con cruce DST.
- [ ] **N-COR-7** `[M]` **API(saga)+INFRA** — `SagaInstance.accountId` = userId + persistencia saga bypasea el tenant guard. `confirmed-adversarial` (ALTA). Se escribe `context.userId` en la columna `accountId`; el engine usa el `prisma` crudo (no el guardeado) → capa 1 de aislamiento saltada (es lo único que impide que el mismatch explote). **DoD:** `accountId` de primera clase en `SagaContext` poblado desde `customer.accountId`; migración de backfill; pasar el cliente guardeado a `SagaIntegration` envolviendo background en `withSystemContext()`.
- **Nota `OAUTH-REFRESH-UNWIRED`** (ALTA, deferido por diseño, Slices 4-5) — no entra a Nivelación pero es **🔗 dep de F1-API-4 (Canva)**: refresh no cableado al publish, X `bearer`-vs-`access`, TikTok v2, remover `facebook` de `TOKEN_URLS`. Cerrar antes de arrancar Canva.

### N.C — Red de regresión (assurance)

- [ ] **N-CI-1** `[S]` **CI** — Fitness #2/#3/#4 grepean rutas inexistentes → el core no está enforced. `confirmed-adversarial` (ALTA). Tras `application-services-to-core`, `apps/api/src/domain|application` ya no existen; con `2>/dev/null || true` los guards pasan vacíos (hay `throw` crudos reales hoy en `GatewayBillingService`). **DoD:** reapuntar #2/#4 y la parte domain/app de #3 a `packages/core/domain/` + `packages/core/*/src`, mirror exacto en `fitness.yml`; quitar el fallback que enmascara dir inexistente.
- [ ] **N-CI-2** `[M]` **CI** — Tests que no corren en CI (regresión de los fixes de Nivelación). `verified` (MEDIA/ALTA). 8/36 integration files sin correr (incl. saga E2E); live-tier no corre en PRs; 36 route files sin ningún test (incl. billing-webhook signature); RLS isolation. **DoD:** wire de los integration files restantes + live-tier en PRs para las áreas tocadas por N.A/N.B.
- [ ] **N-CI-3** `[S]` **CLI** — Suite E2E fantasma (cobertura falsa). `confirmed-adversarial` (ALTA). ~340 `data-testid` contra una app con cero; no corre en CI; `/api/test/seed` inexistente. Explica por qué los flujos rotos de N-COR-3 llegaron a branch tip. **DoD:** decisión explícita (§0.3) — instrumentar `data-testid` + seed + rutas locale-aware + cablear a CI, **o** borrar la suite (validación Edward) para eliminar la falsa señal.

### N.D — Docs P1

- [ ] **N-DOC-1** `[S]` **DOCS** — Crear `docs/frontend/REACT_STANDARDS.md` (puntero canon roto). `verified`. Referenciado por `CODING_STANDARDS.md:263` + `CLAUDE.md:134` (ambos auto-cargados) pero inexistente → degrada cada sesión. **DoD:** doc creado con `## How to extend` + `**Owner:**`; los dos punteros resuelven.
- [ ] **N-DOC-2** `[S]` **DOCS** — Crear `docs/technical/README.md` (índice de ADRs 0001-0019). `verified`. **DoD:** índice con estado + fecha por ADR.

---

## §2 — FASE 1 · PRODUCTO — Necesarias (se pierden deals sin esto)

> Del roadmap de features. Arranca tras Nivelación. Regla §8.5: no saltar a Fase 3 con Fase 1 abierta. Cada tarea lleva su canon 2026.

- [ ] **F1-CLI-4** `[M]` **CLI** — UI de carga CSV + reporte por fila. 🔗 dep:F1-API-3. ⚠️ **BLOQUEADO por el error conceptual de bulk-schedule targeting** (targeting por-provider, no por-channel — engram `bulk_schedule_targeting_gap.md` + ADR-0016). Resolver el rediseño antes. Nota: el stack fue rediseñado a `/parse` + `/confirm` (el `/imports` del DoD viejo es 410 Gone). **Canon (§9.3):** validar CSV upfront (Zod por fila) → `addBulk`/FlowProducer con `continueParentOnFailure`; DLQ + manifiesto por fila.
- [ ] **F1-API-4** `[M]` **API** — Canva Connect OAuth backend. 🔗 dep:B3 + 🔗 dep:OAUTH-REFRESH-UNWIRED (ver Nota en §1.B). **Canon (§9.5):** OAuth 2.0 Auth Code + PKCE (S256), cliente confidencial, intercambio en backend, tokens cifrados at-rest, `state` server-side, refresh single-use con rotación.
- [ ] **F1-CLI-5** `[M]` **CLI** — Embed de Canva en el composer. 🔗 dep:F1-API-4.
- [ ] **F1-DEC-1** `[S]` — Decisión mobile: Expo (RN) vs PWA → ADR en `docs/technical/`. **Canon (§9.5):** Expo + React Native + Expo Router (iOS/Android/web), EAS + OTA; PWA como tier MVP. Candidato a diferir post-Fase 1. Es decisión, no código — puede ir en paralelo.

---

## §3 — FASE 2 · PRODUCTO — Bueno tenerla (objeciones de agencia)

> 21 tareas, todas pendientes. Varias 🔗 dep del cierre de multi-tenant guards (N-SEC-3) por crear datos tenant-scoped. Canon por track en §9.

- **Reseñas:** F2-WRK-1 `[M]` adapters GBP/Yelp/Trustpilot · F2-API-1 `[S]` modelo + alertas low-star (🔗F2-WRK-1) · F2-CLI-1 `[M]` bandeja + respuesta (🔗F2-API-1). **Canon §9.2:** adapters por fuente, polling rate-limit-aware, upsert idempotente `(source, externalReviewId)` + content hash, evento `ReviewIngested`.
- **White-label:** F2-API-2 `[M]` tenant-by-hostname + branding · F2-ADM-1 `[S]` config (🔗F2-API-2) · F2-CLI-2 `[M]` theming CSS-vars (🔗F2-API-2). **Canon §9.5:** edge middleware resuelve tenant por hostname (lookup cacheado), branding por CSS custom properties runtime, no builds por tenant.
- **Recycling/evergreen** (🔗B2): F2-API-3 `[S]` modelo recurrencia + cooldown · F2-WRK-2 `[M]` re-encolado en `completed` (🔗F2-API-3) · F2-CLI-3 `[S]` UI colas. **Canon §9.3:** re-encolar en el evento `completed` con slot recalculado, no repeatable estático; guard de tiempo mínimo.
- **Moderación:** F2-API-4 `[M]` engine cascada (reglas→LLM juez) · F2-WRK-3 `[S]` aplicar en sync inbox (🔗F2-API-4) · F2-CLI-4 `[S]` UI reglas. **Canon §9.2:** reglas deterministas rápidas → LLM policy-as-prompt solo en escalación; reglas como datos.
- **Colisión:** F2-API-5 `[M]` lease corto-TTL + OCC en el send · F2-CLI-5 `[S]` presence WebSocket (🔗F2-API-5). **Canon §9.2:** lease distribuido corto-TTL + presence + chequeo de concurrencia optimista en el send.
- **Completar-parciales:** F2-API-6 `[S]` benchmarking competidores · F2-API-7 `[S]` link-in-bio público · F2-API-8 `[M]` carruseles IA (🔗F0-API-1) · F2-API-9 `[M]` MCP server stateless (🔗B3) · F2-API-10 `[S]` Looker connector (🔗B5) · F2-API-11 `[S]` custom report builder (🔗B5). **Canon §9.4/§9.5** por ítem.

---

## §4 — FASE 3 · PRODUCTO — Diferenciación (tras cerrar Fase 1)

> 14 tareas. §8.5: no iniciar con Fase 1 abierta.

F3-API-1 `[M]` triage multi-tono + self-correction (🔗F0-API-2) · F3-WRK-1 `[M]` video IA real text-to-video (async+webhook) + F3-API-2/F3-CLI-1 · F3-API-3 `[M]` content discovery + F3-WRK-2/F3-CLI-2 · F3-WRK-3 `[M]` RSS auto-posting (🔗B2) + F3-API-4/F3-CLI-3 · F3-API-5 `[S]` image-to-caption (🔗F0-API-1) · F3-API-6 `[S]` AI alt-text (🔗F0-API-1) · F3-API-7 `[M]` analytics ads pagados (nota P-GATE-2: F3-API-8 audience-targeting captura el boost pero NO la dependencia de Meta business-verification) · F3-API-8 `[S]` audience targeting · **F3-API-9** `[S]` employee advocacy — **DEFER, solo si el ICP incluye enterprise** (matrix ⛔ + §8.4 #16; rescatado P-GATE-2).

**Canon §9.1/§9.4:** video con audio nativo + job async (NO Sora 2, API fin sep-2026); triage 1 llamada → array tono-etiquetado + self-correction; RSS con Job Scheduler + conditional GET (ETag) + dedupe por GUID; ads al mismo star schema que orgánico + persistir ventana de atribución.

**Nunca (salvo pivot de ICP):** AI voiceover · meme generator · influencer marketing · blog→video · e-commerce product→post · **full ad management** (categoría de producto aparte, out-of-scope explícito per feature-decisions D11 — rescatado P-GATE-2). Bloat confirmado — sin tareas.

---

## §5 — TRANSVERSAL / CONTINUO (deuda, forgotten-features, higiene)

> Se atiende en paralelo/background. Cada ítem cierra cuando el workstream de su área lo toca (Bucket B del inventario) o en barrido dedicado (Bucket C). Los IDs `SMELL-*`/`FN-*`/`§N.N` conservan su trazabilidad hacia el backlog + normalization roadmap.

### 5.1 Arquitectura / calidad (§3 inventario)

- **TARGET-ARCH — diseño objetivo + cumplimiento (P1)** — diseño CONSERVADO en [`docs/architecture/TARGET_ARCHITECTURE_CANON_ES.md`](../architecture/TARGET_ARCHITECTURE_CANON_ES.md): core de aplicación consumible por TODOS los deployables, apps = contenedores de despliegue, boundaries **enforced** (no por convención), un composition root por ejecutable. **Cumplimiento HOY = parcial:** el core sigue atrapado en `apps/api` (→ `ARCH-WORKERS-PRISMA` abajo) y el guard de boundary era parcial (`SMELL-40`: la regla depcruise no cubría `@packages/api-common`). **Cumplimiento FUTURO:** completar los gates de dependency-cruiser para que toda violación de boundary del core falle CI, y promover el core a `packages/@core` para que `apps/workers`/futuros lo consuman. **DoD:** (a) auditar estado actual vs el mapa objetivo; (b) reglas depcruise que enforceen los boundaries del core en CI para todo deployable; (c) el epic de promoción del core cerrado. Es el diseño de referencia de `ARCH-WORKERS-PRISMA` + `SMELL-45`.
- **ARCH-WORKERS-PRISMA** (SMELL-26/39, P1) — workers a Prisma directo, sin use-cases/UoW/outbox. 🔗 bloquea: Fase 2 recycling/moderation workers. Diseño objetivo: `TARGET-ARCH` arriba.
- **ARCH-ROUTES-PRISMA** (WF2 `routes-prisma-03`, P1) — route handlers con PrismaClient directo.
- **EVENT-DUAL-SYSTEM** (SMELL-10, P1) — outbox `EventDispatcher` vs `EventService`/Redis paralelo; el pipeline de integration-events está muerto en prod. Clasificar canon-vs-drift.
- **PROVIDER-CAPS-DRIFT** (SMELL-23/FN-042, P1) — `ProviderCapabilities` en 4 lugares + `ProviderId` `"twitter"` vs `"x"`. Unificar.
- **prov-x-media-auth-context-02** (`confirmed-adversarial`, ALTA) — `XApiClient` bearer-only ignora OAuth1.0a → todo post con media falla en upload. Alinear `REQUIRED_FIELDS`.
- **prov-classifier-403-drift-03** (`verified`, MEDIA) — fix 403→VALIDATION solo en x/telegram/snapchat; pinterest/bluesky 403 no-auth pendiente. Extraer helper compartido.
- **core-refresh-no-rotation-02** (`confirmed-adversarial`, ALTA) — refresh de token customer sin invalidación del consumido ni reuse-detection; token filtrado sobrevive logout 7d. Blacklist single-use + revoke-family.
- **SMELL-37** AdminAuthService Control Freak (audit off-spine + colaboradores inline; el colaborador **MfaService** quedó extraído tras port + DI de N-SEC-5, #129-133 — restan `PasswordService`/`SessionManager`) · **SMELL-47** 14 sitios bypass `AuditLogRepository` · **SMELL-44** ChannelAuthFailureRecorder overlap · **SMELL-28** `Account.subscription` dropped con 2 refs vivas (runtime bug, P1) · **SMELL-49** 48 packages/core noEmit → TS project references (ADR propio) · **SMELL-48** bundles admin/client sobre límite · **SMELL-50** hoisting audit · casts/type-debt (SMELL-2/5/7/8/33).
- **§2H MEDIA** (saga-double-notify, thread-correlationId-leak, workers-otel-no-flush, occ-version-hardcoded, fitness-23-evaded, struct-backoff-no-cap, struct-breaker-bypass).
- **SMELL-60-66** (logueados en la campaña MFA 2026-07-19..21, backlog `docs/reports/roadmap-detected-smells-backlog.md`): 60 MfaService tx-integrity · 61 generic-disable sin re-check de password · **62 CERRADO** (#131) · 63 force-disable dual-audit · 64 path MFA cliente duplicado + selectores form-test · 65 16× factory de test-wiring · **66 migración config `eslint-plugin-boundaries` v7** (shim de compat vigente; ver batch de deps §5.2/§5.6).

### 5.2 Normalization roadmap (§3A inventario, canon)

§6.1 Containerización (P1, PAUSADO pending bundler ADR-0017) · §3.1.b OpenAPI Zod ~342 rutas (P1, bloquea UI tipada) · §3.2.b provider contract tests MSW (P1) · §4.1.b saga+outbox chaos (P1) · §4.2.b observability ops + alerts (P1) · §2.2.b coverage+mutation gates (P1) · §4.3 GDPR/retention (P2) · §6.2 Kubernetes (P2, 🔗§6.1) · §5.2 queue triada (DEFERRED).

- **CI-CLIENT-DEPCRUISE** `[S]` **CI/P2** (P-VERIFY-1, 2026-06-29) — el CI depcruise NO escanea `apps/client`, y `apps/client/tsconfig.json` no tiene `baseUrl` → madge/tsconfig-paths skipea ~25% de módulos al resolver `@/*` (escaneo ciego). **DoD:** agregar `apps/client` al scope del depcruise de CI con el alias `@/*` resuelto (o `baseUrl` en el tsconfig), para gatear ciclos/orphans del client (hoy 0 ciclos verificado, pero sin gate).

**Gates de GO-LIVE (producción):**

- [ ] **SECRETS-ROTATION-GOLIVE** `[M]` **[SECURITY, P0-at-go-live]** — al ir a producción: (a) rotar **todos** los secrets reales (DB, API keys de providers/LLM, JWT, etc.); (b) purgar `.env` de la historia de git (`git filter-repo`/BFG) hasta que `git log --all -- .env` = 0 (hoy = 3 commits, incl. Genesis). **Contexto (decisión Edward):** los secrets actuales son **dev-only** creados para desarrollo; el `.env` estuvo trackeado en Genesis (finding L-591) y se destrackeó (`78b1055c`) pero sigue en la historia — **riesgo aceptado** mientras sean dev-only; la rotación definitiva + purga se hacen al pasar a producción. Guía: [`docs/security/T0A_SECRETS_ROTATION_RUNBOOK.md`](../security/T0A_SECRETS_ROTATION_RUNBOOK.md) (CONSERVADO). **DoD:** secrets rotados en todos los servicios externos + `git log --all -- .env` = 0 + apps redeployadas verde.

### 5.3 Forgotten-features — backend listo, UI/wire ausente (§4 inventario)

Mapean a producto — valor barato: **WEBHOOK-INGEST** (SMELL-38, pipeline HMAC completo sin cablear, P1) · **FN-024** scheduled-reports cron · **SMELL-3** repurpose approve/reject · **SMELL-13/14** inbox priority/direction · **SMELL-30** admin SSE proxy buffering · **SMELL-45/46** threading/saga UI · **SMELL-9/27/41/51** (clasificar/wire) · **FN-022/023/025** video/predictive/AI-quality (NEEDS_EDWARD). **admin-logs-gitignored-01** (`confirmed-adversarial`, ALTA): la página `/logs` está tapada por `.gitignore:51` → 404 en build limpio; anclar la regla + `git add -f`.

- **FE-BE-CONTRACT-BREAKS** `[M]` **P1** (P-VERIFY-2, 2026-06-29) — **14 reverse-orphans**: frontend llamando endpoints inexistentes/mis-prefijados → 404 en runtime. Detalle en los resultados P-VERIFY de la branch (artefacto de trabajo, no conservado; evidencia base: `docs/audits/FULL_REPO_ASSESSMENT_2026-06-29.md`). Clusters: analytics-client (4: `/analytics/posts/:id`, `/analytics/channels/:id` inexistentes + `/analytics/posts/best-times` y `/analytics/content/media-performance` con **mismatch de prefijo** — el backend las expone SIN `/analytics`); posts-client media/thread (2); scheduling rules PATCH/toggle (2); referral page (use cases existen, ruta no); template item-level `/templates/:id`; admin mfa `regenerate-backup-codes`, rbac per-permission DELETE, y **todo el CRUD de webhook-subscriptions del admin** (POST/PUT/DELETE a rutas fantasma). **DoD:** por cada uno, o crear el endpoint faltante o corregir la llamada FE (los mismatch de prefijo son fix trivial); test que ejercite el contrato.
- **CQRSIntegration dead-route** `[S]` (P-VERIFY-2 bonus) — **RESUELTO:** `apps/api/src/cqrs/CQRSIntegration.ts` se confirmó DEAD_CODE (nunca cableado en ningún composition root) y se eliminó del repo (branch `workstream/cqrs-integration-purge`; merged a `main` vía **PR #128**, 2026-07-19, +30/−2358); la clasificación pendiente queda cerrada. En el mismo PR se re-baseló el floor de cobertura `statements` 55→54 (autorizado). FN-009 (optimizedPostsRoutes) + FN-010/027 (rateLimitingDashboard) siguen abiertos, sin cambios. ⚠️ **Nota de nomenclatura:** el fact-sheet de la campaña etiquetó #128 como "N-SEC-3", pero en este plan y en los commits del repo `N-SEC-3` es el guard de modelos `projectId`-only (§1.A, **EN CURSO**), NO la purga CQRSIntegration. Son ítems distintos; no confundir.

### 5.4 Duplicación a consolidar (§5 inventario)

FN-031 sessionCookie · FN-032 LoadingSpinner · FN-033 notificationStore · FN-034/035 multi-platform-scheduling residues.

### 5.5 Higiene docs / engram (§6 inventario + valoración 06-29)

- **Docs** (verdicts WF1, revalidados 06-29 — la Pre-Fase P.A/P.B ya ejecutó ELIMINAR/ARCHIVAR/RECLASIFICAR): quedan los **75 ACTUALIZAR** (mecánico, al tocar el área: paths rotos por `application-services-to-core`; métricas investor rotadas: 11 providers, 124 modelos, 4 LLM) + **53 VIGENTE**.
- [ ] **DOCS-INDEX-REBUILD** `[S]` **DOCS** — tras la limpieza de la Pre-Fase, `docs/_DOCS_INVENTORY.md` quedó stale (referencia docs borrados/renombrados) y hay links rotos residuales. **DoD:** rebuild de `_DOCS_INVENTORY.md` contra el árbol actual + barrido de links rotos en `docs/` (repuntar o quitar).
- **Engram** (verdicts WF1, adjudicado en Pre-Fase P.D/P.E, 2026-06-29): **el build de engram NO expone `mem_delete`/archive** (solo `mem_update`/`mem_pin`) → los **72 ARCHIVE no son borrables por el agente**; se DEJAN (engram las deprioriza por recencia; borrado real vía CLI/dashboard de engram si se quiere). **8 UPDATE:** solo se actualizó **#2 `testing-capabilities`** (Vitest 4.1.8, "25" fitness, bundle sizes SMELL-48) — los otros 7 se dejaron (superados por session-summaries frescas + obs del assessment #192/#194/#195). **1 MERGE (#12→#18):** no ejecutable sin delete. **26 KEEP** intactas.

### 5.6 Dependency-freshness (ADR-0018) + backlog pequeño (§7 inventario)

Overrides con remove-when datados (esbuild, shell-quote, vite-7.3.5, eslint-9.36, storybook-10.4.6) · GHSA ignores datados (joi, request SSRF, elliptic) · CLIENT-DECIMAL-FIX (`stale-verify`, mayoría falsos positivos) · STORAGE-PROVIDERS-DI (5 violaciones S3) · **prisma-invoice-money-float** (`verified`, MEDIA: `Invoice.amountDue/amountPaid` Float, migrar a Decimal(19,4)).

> **Batch de dependencias/higiene — campaña 2026-07-20..21** (detalle en [`docs/reports/merge-campaign-2026-07-21.md`](../reports/merge-campaign-2026-07-21.md)): codeql-action v3→v4 (#134); 2 olas de CVE cerradas (#135 brace-expansion ×3 + axios 1.18.0 + js-yaml 4.3.0; #136 protobufjs 7.6.5) — pins documentados en `SECURITY_CANON §CVE-floor pins`; **#136 cerró además F-1** (homelab: `ioredis commandTimeout:0` = timer real de 0ms → helper canónico `duplicateForSubscriber`, 4 sitios subscriber). Los dependabot group PRs se superan vía catalog slices (#137 testing incl. vitest 4.1.10 + jest-dom 7; #138 code-quality incl. ts-eslint 8.65 + prettier 3.9.5; **eslint SIGUE HELD en 9** — react/jsx-a11y sin peer eslint-10 → migración config boundaries v7 = **SMELL-66**). #139 @aws-sdk S3 lockstep 3.1091.0 · #140 lucide-react 1.7.0 · #104 isomorphic-dompurify 3.19 · #141 `S3_ENDPOINT` (MinIO/LocalStack) + Sentry `disableLogger`→`webpack.treeshake.removeDebugLogging` + OTEL/S3/`TRUSTED_PROXY_HOP_COUNT` documentados en `.env.example(s)`. Deferidos con #89: docker bumps #98-101.

### 5.7 Rescatados por el gate de absorción (P-GATE-1, 2026-06-29)

> 7 hallazgos NO-absorbidos que el gate encontró en los docs de auditoría gateados (LATERAL_FINDINGS/ESTADO_REPO) antes de borrarlos — capturados acá con su ID original para no dejar letra muerta. Detalle: los resultados P-GATE-1 de la branch (artefacto de trabajo, no conservado; evidencia base: `docs/audits/FULL_REPO_ASSESSMENT_2026-06-29.md`).

- **L-1 MFA-DUALITY** → **PROMOVIDO a Nivelación `N-SEC-5` (§1.A)** por decisión de Edward (usar el MFA argon2 nuevo cableado por DI, retirar el viejo). Ver §1.A.
- **L-546 ADMIN-PASSWORD-FALLBACK** `[S]` **[SECURITY, MEDIA]** — `seed.ts:731` `process.env.ADMIN_PASSWORD ?? "Admin123!"` (fallback débil, CWE-798); su plan de fix murió con `REMEDIATION_ROADMAP.md`. **DoD:** fail-fast sin fallback (patrón env.ts Zod); + fix ref muerta de `T0A_SECRETS_ROTATION_RUNBOOK.md`. Cross-ref: `SECRETS-ROTATION-GOLIVE`.
- **L-616.4 ACTIONS-SHA-PIN** `[S]` **[SECURITY, MEDIA-ALTA]** — 27+ GitHub Actions en tag (`@v4`), 0 SHA-pinning (supply-chain). **DoD:** pinear las actions a SHA.
- **L-621 CI-PAT-SCOPE** `[S]` **[SECURITY, MEDIA]** — `DEPENDENCY_UPDATE_TOKEN` (PAT scope-repo) usado 5x en `dependency-updates.yml`. **DoD:** reducir scope / GITHUB_TOKEN / app token.
- **L-6 BILLING-EVENTID-FALLBACK** `[S]` **MEDIA** — `GatewayBillingService.ts:736` `eventId || ${provider}-${type}-${Date.now()}` rompe idempotency de webhooks sin ID nativo. **DoD:** requerir eventId nativo o dedupe determinista (cross-ref BILLING-DUNNING-DEAD N-COR-4).
- **L-26 FAKE-ROLE-RATELIMIT** `[S]` **BAJA-MEDIA** — `rbacMiddleware.ts:201` `roleBasedRateLimit()` setea headers `X-RateLimit-*` pero NO enforcea nada; huérfano (0 consumers). Código de seguridad engañoso → clasificar DEAD_CODE vs wire (canon rate-limit = ADR-0019).
- **F18-F21 DUPS-CROSS-PACKAGE** `[M]` **MEDIA** — 4 duplicaciones sin heredero en el plan fusionado: `templateEngine`×2, `businessMetrics`×2, `circuitBreaker`×2, `videoProcessor`×3. Consolidar (extiende §5.4 / `code-duplications.md`).
- **Aceptado/menor:** L-623 remainder (`password123` en CI service-containers efímeros + fixtures = docker-compose dev de CLAUDE.md) → **accepted-dev-fixture** (documentado).

### 5.8 Capacidades de producto diferidas (rescatadas P-GATE-2, 2026-06-29)

> Decisiones DEFER de `feature-decisions.md` (marzo) sin heredero en el spine vivo. Detalle: los resultados P-GATE-2 de la branch (artefacto de trabajo, no conservado; evidencia base: `docs/audits/FULL_REPO_ASSESSMENT_2026-06-29.md`).

- **INDUSTRY-BENCHMARKS** (D7) — DEFER: benchmarking contra promedio de industria; requiere base >1000 cuentas O licencia de datos. Trigger de activación, no tarea inmediata. (Distinto de F2-API-6 competitor-benchmarking, que es per-tenant.)
- **INTEGRATION-MARKETPLACE** (D13) — DEFER: marketplace de integraciones; prematuro hasta 10+ integraciones (hoy ~6). Trigger "10+ integraciones".
- **DROPBOX-IMPORT** (D9, menor) — DEFER: hoy solo Google Drive (matrix Nivel 4 🟡). Bajo esfuerzo cuando se priorice.

## §6 — Dashboard de progreso unificado

| Fase                            | Tareas            | Hechas | Estado | Nota                                                                             |
| ------------------------------- | ----------------- | ------ | ------ | -------------------------------------------------------------------------------- |
| **P — Pre-Fase adjudicación**   | 133               | ~59\*  | 🔄     | Mitad docs landed (slice docs-cleanup, PR #148); mitad engram pendiente — ver §P |
| **N — Nivelación** (bloqueante) | 17                | 3      | 🔄     | N-SEC-1/1b·2·5 cerrados (campaña 07-19..21, PRs #124/#125/#129-133); ver §1      |
| Fase 1 — Necesarias             | 4                 | 0      | ⬜     | 🔗 targeting redesign + OAuth-refresh                                            |
| Fase 2 — Bueno tenerla          | 21                | 0      | ⬜     | 🔗 N-SEC-3 (tenant guards)                                                       |
| Fase 3 — Diferenciación         | 14                | 0      | ⬜     | Gated por Fase 1 (§8.5)                                                          |
| Transversal/continuo            | ~40               | —      | 🔁     | Buckets B/C, background                                                          |
| **Producto (base ya cerrada)**  | Bloque B + Fase 0 | ✅     | ✅     | B1-B5 + repurpose/triage/trends + multi-idioma + listening + bulk-parser         |

> **\* Desglose de la fila P (post-slice docs-cleanup, PR #148):** ~59 operaciones de docs aterrizaron en `main` vía cherry-pick — **49 borrados** + **9 archivados** (4 guías cloud → `docs/archive/deployment/` + 5 diagramas del prototipo → `docs/archive/prototype-origin/`) + **1 reclasificado** (`security/README.md` → `SECURITY_TESTING_FRAMEWORK.md`), más 4 repunte-de-referencia. **Pendiente:** los **75 ACTUALIZAR** mecánicos (→ `DOCS-INDEX-REBUILD` §5.5) + la **mitad engram** (72 ARCHIVE + ~9 UPDATE, nunca ejecutada — tarea out-of-band, ver §P). El denominador 133 es el roll-up de adjudicación heredado (docs + engram).
>
> **Progreso ground-truth del producto (pre-nivelación):** 23/67 tareas cerradas (B + Fase 0 + Fase 1 parcial). La barra §0.2 exige re-confirmar cada `[x]` contra el estado actual.

---

## §7 — Trazabilidad (qué fusionó este documento)

Este plan **reemplaza** como fuente única de planificación a: `IMPLEMENTATION_PLAN_ES.md` (spine de features → §2-4), `PENDING_WORK_INVENTORY.md` (consolidación → §1/§5); y **se apoya en / deriva de** la valoración `FULL_REPO_ASSESSMENT_2026-06-29.md` (**CONSERVADA** como companion de evidencia → §1/§5). Rescata como referencia viva: `FEATURE_TRACE_MATRIX §9` (canon 2026 → §0.4/§2-4), `PLAN_MAESTRO §5.8/§5.9` (disciplina → §0.3).

**Pendiente antes de archivar los originales** (gated en confirmación de Edward): verificar que los 647 hallazgos de `LATERAL_FINDINGS.md` + reportes `D0v4_*` están absorbidos en §5 (vía los `FN-*`/`SMELL-*`), sin dejar ninguno como letra muerta.

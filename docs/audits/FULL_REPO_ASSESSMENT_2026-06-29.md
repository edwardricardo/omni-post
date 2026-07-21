# OmniPost — Valoración Completa del Repositorio (2026-06-29)

> **Estado:** informe de auditoría read-only. Junto con `docs/product/IMPLEMENTATION_PLAN_ES.md` y `docs/product/PENDING_WORK_INVENTORY.md`, es fuente de verdad para continuar el desarrollo.
> **Alcance temporal:** HEAD `workstream/impl-revalidation @ 07c1faa5` (2026-06-29).
> **Owner:** Platform engineering.

---

## 0. Nota de procedencia y método

**Modelos.** La auditoría se **configuró íntegramente en Fable 5** (orquestador + los 21 sub-agentes; verificable en el script `agent(model:'fable')`). La salvaguarda dual-use de Fable 5 reenruta automáticamente a **Opus 4.8** los turnos con contenido de ciberseguridad (IDOR/SSRF/CWE/exploit), de modo que las fases de seguridad (verificación §2 + finders de seguridad) corrieron de facto en Opus 4.8. Es una decisión del harness, no controlable desde la conversación, aceptada por el owner. Se deja constancia aquí en lugar de interrumpir el flujo por cada reenrutado.

**Método.** Auditoría fresca contra HEAD (no contra el `main @ 25744292` de la valoración pausada del 06-12). Ejecución **estrictamente secuencial** (1 agente a la vez) por el límite de RAM del LXC de desarrollo (~9 GB, heap < 5 GB), **read-only** (sin builds/tests/graphify/pnpm). Tres fases:

1. **Verificación del cluster §2** de `PENDING_WORK_INVENTORY.md` contra el código actual (convierte los leads `UNVERIFIED-prelim` en veredictos verificados) — 4 verificadores, 39 veredictos.
2. **Cobertura de los 6 targets nunca auditados** (`apps/admin`, `apps/client`, `packages/core`, `packages/providers`, `packages/adapters`, `packages/shared+ports`, `packages/ui+soporte`, `infra/prisma`) — 11 finders, 97 hallazgos.
3. **Verificación adversarial** de los hallazgos nuevos CRÍTICO/ALTO — 34 juzgados: **24 CONFIRMADOS, 10 bajados a MEDIA, 0 refutados**.

**Deduplicación.** Todo se cruzó contra `PENDING_WORK_INVENTORY.md`, los 46 SMELLs de `docs/reports/roadmap-detected-smells-backlog.md` y el `apply-progress` del Track 2, para no re-reportar lo ya conocido/arreglado.

**Qué actualiza este informe.** El §2 de este documento **reemplaza** la columna de confianza `UNVERIFIED-prelim` del inventory con veredictos verificados contra HEAD. El §3 es **material nuevo** que el inventory no tenía (los targets `admin/client/packages/infra` nunca se habían revisado). Artefactos crudos en `/root/.claude/projects/-root-omni-post/assessment-work/`.

---

## 1. Resumen ejecutivo

El repositorio está **sano en sus fundaciones** (dominio rico, hexagonal real, RLS+tenantGuard operativos, Track 2 cerró bien el grueso del cluster IDOR) pero tiene **tres frentes de riesgo material que el trabajo previo no había cubierto**, todos en zonas nunca auditadas:

| Frente                                       | Severidad        | Síntesis                                                                                                                                                                                                                          |
| -------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cache del circuit-breaker cross-tenant**   | 🔴 CRÍTICO       | El cache in-memory del breaker (singleton de proceso) se keyea con `args=[]` → filtra identidades/credenciales/analytics entre cuentas. Fuga cross-tenant real, no estaba en el inventory.                                        |
| **Rate-limit del portal colapsado**          | 🔴 CRÍTICO       | Los proxies Next (client y admin) borran la IP real → todo el portal comparte UN bucket; 5 requests anónimos bloquean el login de todos.                                                                                          |
| **Publishing del client + runtime de sagas** | 🟠 ALTO (racimo) | El composer no puede publicar / "publica" drafts falsos; el step que promueve `Post.status` es un no-op (posts publicados quedan DRAFT); las sagas in-flight mueren en cada deploy y nunca se reaniman; loop de re-fail infinito. |

**Números.** Cluster §2: **13 arreglados-verificados**, 19 abiertos-confirmados, 5 parciales, 2 refutados. Cobertura nueva: **3 CRÍTICOS + 21 ALTOS confirmados** + 10 medios (bajados de alto) + ~63 medios/bajos secundarios. Cero refutados en la verificación adversarial (finders de alta precisión). Docs: 14 ELIMINAR / 36 ARCHIVAR / 75 ACTUALIZAR / 53 VIGENTE + 1 puntero canon roto (P1). Engram: 72 ARCHIVE / 26 KEEP / 8 UPDATE / 1 MERGE.

**La calidad estructural es real.** Notas de cobertura de los finders, textuales: _"el dominio está sano (aggregates ricos con invariantes reales)"_ (core); _"la arquitectura del portal client es sólida en el eje token-exposure"_ (client:sec); _"apps/admin está muy por encima de lo que SMELL-27 sugería"_ (admin:qual); _"el saga engine es canon-by-construction en el sistema de TIPOS… pero el RUNTIME tiene los defectos"_ (saga). El problema no es la arquitectura; es que **el runtime y los caminos end-to-end nunca se ejercitaron** (la suite E2E es fantasma — ver §3.2).

---

## 2. Estado verificado del cluster §2 de seguridad (actualiza `PENDING_WORK_INVENTORY §2`)

### 2.1. ARREGLADOS — verificados contra HEAD (13)

El Track 2 (PR #97) es **sólido**. Confirmado línea a línea que están cerrados:

`IDOR-POSTS` · `IDOR-ACCOUNTS` (+ quota-tamper cerrado) · `IDOR-ANALYTICS` (commit `30fe72d2`) · `IDOR-NOTIFICATIONS` · `IDOR-RECURRING` (incl. create) · `IDOR-COMMENTS` (spoof authorId/editorId cerrado) · `CACHE-XTENANT-HTTP` (`f5470dd4`, re-verifica el bearer, fail-closed) · `AUTH-REGISTER-PRIVESC` (endpoint eliminado) · `RATELIMIT-DEAD` (limiter canónico cableado, ADR-0019) · `WRK-NO-REAUTH` (`bd968112`) · `SSE-DOS-CAP` · `CI-GAP-BULK-SCHEDULE` · `CI-GAP-RLS`.

### 2.2. ABIERTOS — confirmados contra HEAD (19)

| Lead                                   | Sev        | Evidencia / residual                                                                                                                                                                                                                                                         |
| -------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IDOR-TRACKEDLINK**                   | ALTA       | La superficie **existe** (`apps/api/src/links/linkRoutes.ts`, que el `apply-progress` decía "no encontrada"): get/stats/**delete** por `:id` sin gate de accountId; create en proyecto ajeno. `TrackedLink` no tiene columna `accountId` → estructuralmente fuera del guard. |
| **ARCH-PROJECT-SCOPED-GUARD-GAP**      | ALTA       | Root-cause abierto: no hay mecanismo de guard para modelos `projectId`-only; la cobertura depende de que cada use case recuerde el join `project.accountId`. TrackedLink es la prueba viva.                                                                                  |
| **WRK-MENTION-XTENANT**                | ALTA       | Dedup global `(provider, externalId)` sin `accountId` (`MentionRepository.ts:62`) → el primer tenant "gana" la mención pública; los demás nunca reciben su fila (data-starvation).                                                                                           |
| **CACHE-XTENANT-AI**                   | MEDIA      | `orchestrator.ts:220` la key `ai:${type}:${sha256(...)}` omite `accountId`; el mismo `CachePort` se comparte BYOK y pool → contaminación con input idéntico + skew de billing (`tokensUsed=0` en hits).                                                                      |
| **BILLING-DUNNING-DEAD**               | ALTA       | Re-deriva el `provider` del payload; combinado con `processed=true` irreversible, un fallo de webhook Stripe se traga en silencio. Fix mínimo: pasar el `provider` del route al service.                                                                                     |
| **DELETE-CASCADE-NONTX**               | ALTA       | Cascada multi-tabla fuera de transacción → huérfanos en fallo parcial. Envolver en `unitOfWork.executeInTransaction` o mover `onDelete:Cascade` al schema.                                                                                                                   |
| **SCHED-TZ**                           | ALTA       | `computeNextRun` ignora tz/DST; corre a la hora del server. Necesita `cron-parser` con `tz` alimentado por `entity.timezone`.                                                                                                                                                |
| **STRUCT-BREAKER-BYPASS**              | MEDIA      | `generateStructured` no pasa por el circuit breaker (afecta Triage/Trend/LocalizedContent).                                                                                                                                                                                  |
| **CI-GAP-LIVE-TIER / -ROUTE-COVERAGE** | MEDIA      | Tests live-API no corren en PRs; 36 route files (incl. billing-webhook signature) sin ningún test.                                                                                                                                                                           |
| **§2H (varios)**                       | MEDIA/BAJA | `SAGA-DOUBLE-NOTIFY`, `THREAD-CORRELATIONID-LEAK` (Map sin cota), `WORKERS-OTEL-NO-FLUSH`, `OCC-VERSION-HARDCODED`, `FITNESS-23-EVADED` (gate roto, sin leak hoy), `STRUCT-BACKOFF-NO-CAP`.                                                                                  |

`OAUTH-REFRESH-UNWIRED` (ALTA) sigue **deferido por diseño** (Slices 4-5): bloquea la confianza en F1-API-4 (Canva). `WRK-DOUBLE-POST` quedó **narrowed** (receipt durable, no atómico) — exactly-once requiere idempotencia provider-native (Slice 7, incl. bluesky que hoy no es idempotente).

### 2.3. Parciales (5) y Refutados (2)

- **Parciales:** `REALTIME-FULLSCAN` (perf, acotado por el SSE cap), `SAGA-NO-INFLIGHT-GUARD` (opt-in por step), `CI-GAP-INTEGRATION` (8/36 aún sin correr), y otros dos con residual documentado.
- **Refutados:** `IDOR-SCHEDULEDREPORT` (customReportRoutes threadea accountId en todos los handlers — no hay IDOR; queda solo un self-exfil por recipients elegibles) y una segunda variante menor.

---

## 3. Hallazgos NUEVOS — cobertura de targets nunca auditados

> Material que el inventory **no tenía**: `apps/admin`, `apps/client`, `packages/*`, `infra/prisma` nunca se habían revisado (el WF2 previo solo cubrió api+workers). Todos verificados adversarialmente.

### 3.1. CRÍTICOS (3 hallazgos → 2 causas raíz)

**C1 — Cache del circuit-breaker filtra datos entre cuentas** · `prov-cb-cache-xtenant-01` + `cb-cache-xaccount-01`
`packages/adapters/external-apis/src/circuitBreaker.ts:318` — `generateCacheKey()` deriva la clave de `service:operation:base64(args)`, pero **todos** los call sites pasan `args=[]` (los parámetros reales —credenciales, videoId, channelId— viven en el closure `apiCall`, invisibles a la clave). El breaker es un **singleton de proceso** compartido por todas las cuentas. Para operaciones `cacheEnabled:true` la clave es global por `service:operation`. Ejemplo confirmado: `facebook validate-credentials` cachea 5 min la respuesta que **incluye el access_token de la Page** → la cuenta B que valida dentro del TTL recibe el token de A. Igual con `x get-analytics` (TTL 30 min), `search-mentions`, `s3 get-metadata`. **Fix:** incluir discriminante de credencial/tenant + los params reales en la key (o deshabilitar L1 para lecturas credential-scoped); auditar los ~20 sitios `cacheEnabled:true`. Relacionado (ALTA): `cb-shared-breaker-xtenant-02` — el breaker compartido abre el circuito para todos los tenants cuando uno falla (noisy-neighbor).

**C2 — El proxy Next borra la IP real → rate-limit colapsado** · `client-proxy-ip-erasure-01` (+ `client-proxy-ip-collapse-01`)
`apps/client/app/api/backend/[...path]/route.ts:69` — el proxy arma headers desde cero (solo `Content-Type` + `Authorization`) y **nunca** propaga `X-Forwarded-For`/`X-Real-IP`; el mismo gap en el proxy admin y en las server actions de auth. El backend (`resolveClientIp`) cae a `socket.remoteAddress` = IP del server Next para **todos** los usuarios. El limiter AUTH (`/auth/customer/login` + `/refresh` = 5/15 min por IP) colapsa a 5 requests **totales** de todo el portal: 5 intentos anónimos bloquean el login de todos; y como `authContext` refresca cada 12 min y ante cualquier error de refresh fuerza `logout()`, con >4 usuarios activos el bucket compartido desloguea al azar. **Fix:** append de la IP real del request entrante a `X-Forwarded-For` y ajustar `TRUSTED_PROXY_HOP_COUNT` (o keyear las rutas customer por `accountId`). Replicar en admin.

### 3.2. ALTOS confirmados por área (21)

**`apps/client` — el publishing y el testing son el punto más débil del repo** (notas del finder: _"se construyó pantalla-por-pantalla contra contratos ASUMIDOS y nunca se ejercitó end-to-end"_):

- **`client-composer-publish-dead-02`** — el composer de `/posts/new` **nunca puede publicar/agendar**: `initialContent` es prop estática vacía y de ahí salen los `disabled` de Publish/Schedule y el payload. El único camino que "funciona" es el autosave silencioso que crea un DRAFT.
- **`client-fake-publish-07`** — `publishPost` de `usePostDraft` **no publica**: hace create/update de draft, sin `channelIds` ni saga publish-now, y toastea "Post Published!". En la página de edición convive con el Publish real → dos CTAs con semántica distinta.
- **`client-admin-endpoint-401-05`** — el scheduling dashboard llama `/admin/posts/scheduled` (requiere `requireAdminAuth`) con token de customer → **401 permanente** + repolling cada 30 s a un endpoint muerto. No existe endpoint customer de scheduled-posts.
- **`client-posts-invalidation-06`** — `queryKeys.posts()` produce `["posts", undefined]` que no matchea las listas parametrizadas → delete/archive/duplicate/update dejan la UI **stale**.
- **`client-autosave-debounce-04`** — autosave es debounce puro sin `maxWait` ni flush on-unload (y el JSDoc miente sobre localStorage) → tipeo continuo + cerrar pestaña = **pérdida total**. Cero handlers `beforeunload/pagehide` en todo `apps/client`.
- **`client-perf-provider-blank-01`** — `ProjectProvider` deriva su `isLoading` bloqueante de `isFetching` → cualquier refetch de fondo (refocus tras 5 min) **desmonta todo el dashboard** (pierde filtros, selección, scroll, modales).
- **`client-nav-dead-routes-01`** — nav primaria con **2 destinos 404**: `/dashboard/queue` (sidebar) y `/dashboard/settings` (user-menu + quick action, sin `page.tsx` índice).
- **`client-e2e-phantom-01` / `-08`** — la suite Playwright E2E es **fantasma**: ~340 `data-testid` contra una app que tiene **cero**; `global-setup` postea a `/api/test/seed` inexistente; `waitForURL("/dashboard")` ignora el `[locale]` obligatorio; y **ningún workflow de CI la corre**. Explica por qué los flujos rotos de arriba llegaron a branch tip sin detectarse.
- **`client-test-core-pages-01`** — los 3 god-nodes (Publishing/Analytics/Dashboard, 98/90/70 edges) + el editor: **cero tests reales**; el "money path" solo lo "cubre" la suite fantasma.

**`packages/shared` — el saga engine es canon en tipos pero el runtime tiene defectos graves** (5 confirmados):

- **`saga-update-noop-01`** — `UpdatePostStatusStep` emite `post.update` con `status/publishedAt`, pero `UpdatePostCommandHandler` **descarta `status`** (WARN "not supported") y nunca lee `publishedAt`. El step "exitoso" → saga **COMPLETED** mientras el post publicado **queda DRAFT**. Encadena con la guard "only DRAFT can be published" → permite **re-publicar**.
- **`saga-restart-inflight-02`** — `shutdown()` pasa RUNNING→PENDING pero `loadActiveSagas()` en boot **nunca reanima** (no llama `executeSagaAsync`); el recovery checker solo mira `RUNNING AND nextRetryAt not null`. Cada deploy graceful abandona sagas que a los 30 min el timeout **FAILEA sin compensar** (post huérfano en DRAFT).
- **`saga-refail-loop-03`** — `failSaga` no hace `activeInstances.delete` y el timeout checker no filtra estado terminal → toda saga FAILED se **re-failea cada 60 s para siempre**: crecimiento no acotado del EventStore (evento `saga.failed` duplicado sin tope) + leak del Map.
- **`saga-wait-starvation-04`** — `WaitForPublishingCompletion` modela "pending" como `success:false` → cada re-ejecución quema un retry (presupuesto ~35 s); un video/thread lento o multi-canal (4+ eventos tempranos) mata la saga en **FAILED aunque el publish progrese**.
- **`saga-accountid-userid-06`** — **verificado**: `SagaInstance.accountId` se escribe con `context.userId` (id de usuario), teniendo el `accountId` real en `metadata`. Agravante estructural: la persistencia de sagas usa el `prisma` **crudo** (no el cliente guardeado del container) → **bypasea la capa 1 del tenant guard**; es lo único que impide que el mismatch explote.

**`packages/providers`:**

- **`prov-x-media-auth-context-02`** — `XApiClient` se construye solo con `bearerToken` e **ignora** las credenciales OAuth 1.0a; `uploadMedia` (v1.1) requiere user-context → **todo post con media falla** en el upload. `REQUIRED_FIELDS` está desalineado con lo que realmente se usa.

**`packages/core`:**

- **`core-fitness-dead-guard-01`** — tras `application-services-to-core`, las fitness **#2/#4** (y la parte domain/app de **#3**) siguen grepeando `apps/api/src/domain/` y `.../application/` que **ya no existen**; con `2>/dev/null || true` **pasan vacías**. Las tres capas más internas del hexágono quedaron **sin guardia automática** (hay `throw` crudos reales hoy en `GatewayBillingService` que #4 atraparía).
- **`core-refresh-no-rotation-02`** — el refresh de token de customer genera sessionId nuevo pero **nunca blacklistea el consumido** ni detecta reuso; un refresh token filtrado sobrevive rotaciones y logout hasta su expiry de 7 días. Rompe el contrato de logout que el equipo construyó explícitamente.

**`apps/admin`:**

- **`admin-logs-gitignored-01`** — la página `/logs` (audit logs, 410 líneas) está **tapada por `.gitignore:51`** (`logs/` sin anclar): existe solo en el working tree, **404 en todo build/clone limpio**, y un `git clean -fdx` la borra sin recuperación. Explica el falso "pages missing" de SMELL-51.

### 3.3. Bajados a MEDIA en verificación adversarial (10 — reales, menor severidad)

Todos confirmados como defectos reales, con la severidad corregida por contexto:

- **`admin-analytics-fabricated-01` / `admin-compliance-green-01`** — KPIs admin fabricados: `systemUptime:100` hardcodeado, `securityScore = engagementRate`, "GDPR Compliance" hardcodeada a `compliant/100`. Baja a MEDIA porque es dashboard interno sin impacto de escritura/billing y la verdad está "a un tab de distancia".
- **`admin-csrf-01`** — el proxy inyecta `X-CSRF-Token` desde la cookie httpOnly → el double-submit queda **tautológico**; baja a MEDIA porque `SameSite=Lax` bloquea la explotación real (pérdida de defense-in-depth).
- **`admin-accounts-silent-fail-01`** — el PUT de trial/autoRenewal ignora `res.ok` → fallo silencioso con toast de éxito; MEDIA porque el `refetch` repinta el estado real.
- **`prov-classifier-403-drift-03`** — el fix 403→VALIDATION solo se aplicó a x/telegram/snapchat; 5 providers siguen 403→AUTH. MEDIA porque para linkedin/tiktok/threads un 403 insufficient-scope **sí** se remedia con re-OAuth; el gap real es pinterest/bluesky (prompt de reconexión recuperable). Es un residual del workstream §2F en curso.
- **`saga-inflight-race-05`** — doble ejecución del engine (recovery tick re-dispara antes de limpiar `nextRetryAt`); MEDIA porque el pivot está protegido por `jobId=dedupeKey` en BullMQ y el deploy es single-pod hoy. **Precaución:** agravante para multi-pod.
- **`tenant-health-idor-01`** — `GET /health/tenant/:id/project/:id` sin auth; MEDIA porque las métricas expuestas son mayormente stubs/globales (el leak real es `getIntegrationHealth`: últimos 100 PublishLog globales — channelIds/providers de todos los tenants, sin secretos) y explotar requiere adivinar 2 UUIDs.
- **`prisma-guard-project-scoped-blastradius`** — 9 modelos `projectId`-only + ~18 hijos fuera de guard+RLS (incl. `Channel` con credenciales cifradas). Baja a MEDIA porque `MULTI_TENANT_GUARDS.md §Transitively-scoped` los documenta como **diseño deliberado** con join compensatorio obligatorio, y los adapters reales lo implementan. **Residual válido:** el audit S2.1d no evidenció haber revisado cada adapter transitivo — hace falta esa verificación.
- **`prisma-invoice-money-float`** — `Invoice.amountDue/amountPaid` en Float (viola el canon `Decimal(19,4)` del resto del schema). MEDIA porque la tabla es un **mirror de display** del gateway (que decide el cobro en céntimos enteros); deuda de canon, no bug financiero activo.
- **`client-editor-content-reset-03`** — `setContent(initialContent)` pisa keystrokes en una ventana subsegundo tras el autosave; MEDIA (no "en cada ciclo" como afirmaba — el debounce de 15 s lo acota).

Hay además **~63 hallazgos MEDIA/BAJA secundarios** (perf, testing, DX, dead-code) en `assessment-work/secondary-findings.json`, no promovidos a este resumen.

---

## 4. Auditoría de documentación

> Verdicts de la auditoría WF1 (2026-06-12, 21 agentes, 179 docs) **revalidados vs HEAD** — el corpus apenas cambió (solo 4 docs nuevos), así que los verdicts siguen vigentes. Consolidado también en `PENDING_WORK_INVENTORY §6`.

**P1 — Puntero canon roto (confirmado que persiste HOY):** `docs/frontend/REACT_STANDARDS.md` es referenciado por `CODING_STANDARDS.md:263` **y** `CLAUDE.md:134` (ambos auto-cargados en cada sesión) pero **no existe**. Los 4 canon-children se cargan por `@`-import; este puntero roto degrada silenciosamente cada sesión. **Crear el doc.**

- **ELIMINAR (14):** `docs/api/cqrs.md` + `docs/api/integration-examples.md` (documentan una API CQRS Bus/event-sourcing **inexistente**), 8 `docs/audits/_raw/graph-*`+`madge-*` (stale + duplican lo que graphify genera), `docs/audits/T5_T6_PARALLELIZATION_DECISION.md`, `docs/admin/dashboard.md` (afirma "auth disabled"/"React 18" falsos), 2 reports stale.
- **ARCHIVAR (36):** los 3 roadmaps de migración cerrados (`APPLICATION_MIGRATION`, `CORE_MIGRATION`, `PRISMA_DI_MIGRATION`), el cluster `docs/audits/*` de auditorías históricas completadas, `BRUTE_FORCE_HOMOLOGATION_ES` (ya implementado, ADR-0015), las 4 guías cloud (`AWS/AZURE/GCP/DIGITALOCEAN` — scaffolding especulativo nunca usado; el dev real es homelab).
- **ACTUALIZAR (75):** dominante — `application-services-to-core` movió los use cases a `packages/core/*/src`, rompiendo paths en casi todo `docs/api/`. Además métricas de `INVESTOR/MARKETING` rotadas (ver abajo).
- **VIGENTE (53):** los 4 canon-children, `PENDING_WORK_INVENTORY.md`, `roadmap-detected-smells-backlog.md`, los 19 ADRs (incl. los 3 nuevos 0017/0018/0019, verificados sustanciales), `MULTILINGUAL_SCOPE_ES.md`.

**Docs faltantes prioritarios a crear:** `docs/frontend/REACT_STANDARDS.md` (P1, puntero roto), `docs/technical/README.md` (índice de ADRs 0001-0019, sigue ausente), `docs/architecture/PROVIDER_OAUTH_FLOW.md`, `docs/architecture/WORKERS.md`, `docs/development/onboarding.md` (day-1 homelab).

**Conflicto de doble verdad en `docs/product` (persiste):** `FEATURE_TRACE_MATRIX_ES.md` (2026-05-17) describe el estado pre-Fase-0; `IMPLEMENTATION_PLAN_ES.md` fue **reseteado a 0/67** el 2026-06-19 (re-validación deliberada). Métricas de inversores desactualizadas: providers **11** (dicen 10), modelos Prisma **124** (dicen 97/98 — 3-way, presentar como WF1-vs-INVESTOR, no como settled), LLM providers **4** (dicen 3), modelo de imagen "DALL-E 3" (stale). Reconciliar como tarea P2 de docs.

---

## 5. Auditoría de memorias engram

Verdicts WF1 sobre las observaciones del proyecto (revalidados; consolidado en `PENDING_WORK_INVENTORY §6`):

- **72 ARCHIVE** — artefactos SDD de changes cerrados + session-summaries históricas (ruido, no aportan a futuro).
- **26 KEEP** — decisiones/convenciones/patterns durables.
- **8 UPDATE** — `sdd-init/omni-post` + `testing-capabilities` (turbo 2.8.21→2.9.16, vitest 4.0.18→4.1.8, "24"→"25" fitness), y #48/#50/#73/#80/#91 (ya DONE/merged).
- **1 MERGE** — #12 → #18.

Requiere confirmación del owner antes de aplicar (borrado/merge de memorias es irreversible).

---

## 6. Reconciliación con el inventory y secuenciación recomendada

Este informe **cierra el §8 de `PENDING_WORK_INVENTORY`** ("finish the paused assessment"): la fase de verificación adversarial —que nunca había corrido— ahora está hecha, y los targets nunca auditados están cubiertos. Ajustes recomendados al inventory:

1. **Promover a §2 (P0 nuevo):** los 2 CRÍTICOS de cache-breaker cross-tenant (`cb-cache-xaccount` / `prov-cb-cache-xtenant`) y el rate-limit colapsado del proxy (`client-proxy-ip-erasure`). No estaban en el inventory y son cross-tenant/DoS reales.
2. **Promover el racimo de saga-runtime** (`saga-update-noop`, `saga-restart-inflight`, `saga-refail-loop`, `saga-wait-starvation`) a §2F como bloqueante de la confianza en publishing — el `UpdatePostStatusStep` no-op significa que **los posts publicados quedan DRAFT hoy**.
3. **Promover el racimo de publishing del client** (`composer-publish-dead`, `fake-publish`, `admin-endpoint-401`) — bloquea el flujo core del portal antes de retomar Fase 1.
4. **Registrar como SMELLs nuevos** en el backlog: `core-fitness-dead-guard` (los guards del core no enforcen — meta-riesgo de CI), `admin-logs-gitignored`, `client-e2e-phantom` (cobertura fantasma), `IDOR-TRACKEDLINK` (root-cause aún abierto).

**Secuencia sugerida (respeta el §8.5 del plan: Fase 3 no arranca hasta cerrar Fase 1):**

1. **P0 cross-tenant/DoS nuevos:** cache-breaker key + IP-forwarding en ambos proxies. Baratos y de alto impacto.
2. **Saga runtime:** enrutar `UpdatePostStatusStep` a un comando que transicione estado + reanimar sagas en boot + fix del re-fail loop + claim atómico. Sin esto el publishing "funciona a medias".
3. **Publishing del client:** levantar el estado de contenido del composer, unificar el flujo de publish, endpoint customer de scheduled-posts. Instrumentar `data-testid` + cablear E2E a CI (o borrar la suite fantasma).
4. **Cerrar §2 abiertos:** IDOR-TRACKEDLINK + guard para modelos `projectId`-only, billing-dunning, delete-cascade-tx, sched-tz.
5. **Fundaciones de CI:** reapuntar las fitness #2/#3/#4 a `packages/core` (hoy pasan vacías), wire de los integration files restantes.
6. **Docs P1:** crear `REACT_STANDARDS.md` (puntero roto) + índice de ADRs; luego el barrido de DELETE/ARCHIVE.
7. **Retomar la SPINE (Fase 1):** resolver el error conceptual de bulk-schedule targeting (bloquea F1-CLI-4), Canva sobre substrato OAuth-refresh verificado.

---

## Apéndice — Artefactos

- `assessment-work/wf-fresh-result.json` — resultado completo (39 cluster verdicts + 97 findings + 34 adv verdicts).
- `assessment-work/verified-findings.json` — 34 hallazgos verificados con detalle (file:línea, fix, note adversarial).
- `assessment-work/secondary-findings.json` — 63 MEDIA/BAJA secundarios.
- `assessment-work/cluster-verdicts.json` — estado §2 verificado.
- `assessment-work/wf1-result.json` — auditoría docs+engram (WF1, 2026-06-12).
- Grafos graphify por target (`<target>/graphify-out/GRAPH_REPORT.md`) — frescos a `eb295f40`.

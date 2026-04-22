# OmniPost — Remediation Batches (post D0-v4) — v1 SUPERSEDED

> **⚠️ SUPERSEDED 2026-04-21.** Este documento ha sido reemplazado por [`REMEDIATION_ROADMAP.md`](REMEDIATION_ROADMAP.md) v2, que funde esta v1 con el plan alternativo en [`CLAUDE_ALTERNATE_PLAN.md`](CLAUDE_ALTERNATE_PLAN.md). El roadmap v2 reorganiza los mismos 647 findings en estructura tier T0..T6 por complejidad ascendente con micro-batches.
>
> **NO ejecutar contra este documento.** Se preserva solo como trazabilidad histórica de la primera categorización (batches B0..B10 temáticos). Consultas de trabajo van a `REMEDIATION_ROADMAP.md`.
>
> ---
>
> Documento maestro original que mapea los **647 hallazgos laterales** (L-1..L-647) documentados en `docs/audits/LATERAL_FINDINGS.md` a **11 batches ejecutables** ordenados ascendentemente (desbloqueador-primero, TRIVIAL antes que DEEP, SAFETY_CRITICAL nunca después de QUALITY).
>
> Este documento NO reemplaza a `LATERAL_FINDINGS.md` — complementa. LATERAL_FINDINGS es la evidencia y el expediente; este documento es el **plan de ejecución**.
>
> **Estado:** v1 — 2026-04-21. Tramo D0-v4 cerrado el 2026-04-20. **SUPERSEDED por v2 el mismo día.**

---

## §1. Resumen ejecutivo

Los 647 hallazgos se reparten en 11 batches de remediación (B0..B10), 1 batch de backlog producto (B11, fuera de ciclo) y 3 apéndices (positives / wont_fix / composite absorptions).

| Batch     | Nombre                           | Findings | Esfuerzo total | Bloqueador       | SAFETY_CRITICAL items |
| --------- | -------------------------------- | -------: | -------------- | ---------------- | --------------------: |
| B0        | Safety Net                       |       13 | 3–5 d          | BLOCKS_MANY      |                    13 |
| B1        | Housekeeping Trivial             |       34 | 1 d            | INDEPENDENT      |                     0 |
| B2        | DEAD_CODE validado               |       49 | ½–1 d (×N)     | NEEDS_EDWARD     |                     0 |
| B3        | Config Correctness               |       27 | 1–2 d          | INDEPENDENT      |                     1 |
| B4        | DI Consistency                   |       16 | 2 d            | BLOCKED_BY B3    |                     1 |
| B5        | Stubs → Real                     |       13 | 3–4 d          | BLOCKED_BY B0    |                    10 |
| B6        | Domain/App Quality               |      205 | 2–3 d (×N)     | BLOCKED_BY B3    |                     2 |
| B7        | Refactors localizados            |       12 | 3–5 d          | BLOCKED_BY B4    |                     1 |
| B8        | Billing/Financial Precision      |        8 | 3 d            | BLOCKED_BY B0    |                     8 |
| B9        | EventStore + Saga + CQRS         |       10 | 4–6 d          | BLOCKED_BY B4    |                     1 |
| B10       | Architecture Consolidations      |       29 | DEEP (sprint)  | BLOCKED_BY B4+B7 |                     4 |
| B11       | PLANNED features backlog         |       34 | fuera de ciclo | producto decide  |                     0 |
| App A     | Positives                        |       27 | 0 d            | —                |                     0 |
| App B     | WONT_FIX justificados            |        5 | 0 d            | NEEDS_EDWARD     |                     0 |
| App C     | Composite absorptions / RESOLVED |      165 | 0 d            | —                |                     — |
| **TOTAL** |                                  |  **647** |                |                  |                       |

**SAFETY_CRITICAL breakdown (41 items):**

- B0 (13): CI broken, env secrets, password123 séxtuple, fitness functions
- B3 (1): port bindings 0.0.0.0 docker-compose
- B4 (1): ApiMetrics empty mock crash
- B5 (10): fake rate limiter, audit stub, file validator stub, JWT decoder stubs, argon2 migration
- B6 (2): UoW crítico + VO bypass
- B7 (1): SyncProviderComments provider API dentro de UoW
- B8 (8): Invoice Float, RBAC double SoT, ADMIN_PASSWORD weak, GatewayBillingService fake eventId
- B9 (1): sagaCQRSBus vacío runtime risk
- B10 (4): AbstractProviderAdapter dynamic db-prisma import, cache-redis / api-common Fastify leaks, Docker base missing

---

## §2. Framework de clasificación (5 ejes)

Cada hallazgo se clasifica sobre 5 dimensiones ortogonales antes de asignarlo a un batch.

### Eje 1 — Esfuerzo

| Valor     | Duración estimada | Ejemplo representativo                               |
| --------- | ----------------- | ---------------------------------------------------- |
| `TRIVIAL` | <15 min           | añadir `.gitattributes`, rename file con espacios    |
| `QUICK`   | 15 min – 2 h      | fix ESLint rule, remove `\|\| true` de ci.yml        |
| `MEDIUM`  | ½ – 1 día         | split archivo, migrar DI singleton                   |
| `HEAVY`   | 1 – 3 días        | refactor `GatewayBillingService` 1042 LOC            |
| `DEEP`    | 3 – 8 días        | `content/` module completion, provider consolidation |

### Eje 2 — Bloqueador

| Valor              | Significado                                                |
| ------------------ | ---------------------------------------------------------- |
| `BLOCKS_MANY`      | Otros batches no son ejecutables sin esto (p.ej. CI verde) |
| `BLOCKS_FEW`       | Bloquea 1-2 findings específicos                           |
| `BLOCKED_BY_<L-#>` | Requiere otro finding resuelto primero                     |
| `INDEPENDENT`      | Puede ejecutarse en cualquier orden                        |

### Eje 3 — Riesgo

| Valor             | Significado                                                             |
| ----------------- | ----------------------------------------------------------------------- |
| `SAFETY_CRITICAL` | Security / billing / datos producción — impacto directo usuarios/dinero |
| `QUALITY`         | Arquitectura / tipos / mantenibilidad — impacto developers              |
| `COSMETIC`        | Docs / naming / formato — impacto mínimo                                |

### Eje 4 — Acción

| Valor       | Significado                                     |
| ----------- | ----------------------------------------------- |
| `FIX`       | Corregir código existente                       |
| `DELETE`    | Remover código (requiere §5.9 si no es trivial) |
| `IMPLEMENT` | Construir lo que está stub                      |
| `REFACTOR`  | Reestructurar sin cambiar comportamiento        |
| `CONFIG`    | Cambiar archivo configuración                   |
| `DOCUMENT`  | Actualizar/crear doc                            |
| `DECIDE`    | Necesita decisión Edward antes de acción        |

### Eje 5 — §5.9 validation

| Valor          | Significado                                                          |
| -------------- | -------------------------------------------------------------------- |
| `AUTO`         | Trivial/cosmetic, agente ejecuta sin pedir                           |
| `NEEDS_EDWARD` | DEAD_CODE, arquitectura, o decisión producto — Edward valida primero |

### Tie-breakers para asignación de batch

1. Si `SAFETY_CRITICAL` → B0 / B5 / B8 (según subdominio).
2. Si `BLOCKED_BY L-X` explícito → batch_of(L-X) + 1.
3. Si `TRIVIAL` + `COSMETIC` → B1.
4. Si `NEEDS_EDWARD` + alcance DEAD_CODE → B2.
5. Resto → batch temático dominante.

---

## §3. Principio de ordenamiento

1. **B0 primero siempre.** Sin CI funcional + secrets fuera de git, cualquier trabajo posterior acumula deuda silenciosa.
2. **B1 + B2 en paralelo** si Edward valida DEAD_CODE rápido — son independientes y reducen ruido visual.
3. **B3 antes de B4/B6** — configs correctas son la base para enforcement automático.
4. **B5 no requiere B3/B4** pero se recomienda después de B0 (fitness verifica no regresión).
5. **B7/B8 independientes entre sí** — pueden intercalarse.
6. **B9 requiere B4** — EventService consolidation precede decisión EventStore.
7. **B10 último del ciclo activo** — requiere base estable (B4 DI + B7 refactors).
8. **B11 no bloquea nada** — backlog producto paralelo.

**Regla dura:** ningún hallazgo `QUALITY` o `COSMETIC` se ejecuta antes que un hallazgo `SAFETY_CRITICAL` del mismo subdominio.

---

## §4. Regla de cierre de batch

Un batch está **CERRADO** cuando:

1. **Todos sus findings** están marcados `DONE` / `DECIDED` (con ADR/decisión documentada) / `WONT_FIX` (con justificación en Appendix B).
2. La **verificación objetiva** declarada en el `Exit criteria` del batch corre y pasa (grep counts, test runs, fitness functions).
3. **Fitness functions CLAUDE.md** relevantes al batch están verdes (sub-set de los 10 greps ejecutado post-batch).
4. **Commit creado** (atomic o multi-commit, según naturaleza del batch) con mensaje referenciando el batch (`chore(remediation): close B<n> — <summary>`).
5. **LATERAL_FINDINGS.md actualizado** con `→ RESUELTO en B<n>` por finding.
6. **Este documento (REMEDIATION_BATCHES.md) actualizado** con el batch marcado ✅.

---

## §5. Batches

### §5.0 — B0 Safety Net

**Scope.** Cerrar los agujeros que permiten que cualquier trabajo posterior se rompa en silencio: CI no enforza, secrets expuestos, fitness functions sin wire.

**Entry criteria.** Ninguno (primero de todos).

**Exit criteria (comandos objetivos):**

```bash
# 1. Ningún .env tracked en git
git ls-files | grep -E "\.env$" | wc -l           # → 0

# 2. Cero ocurrencias de password123 en workflows + seeds + tests
grep -rE "password123" .github/workflows/ infra/prisma/seed.ts apps/api/tests/integration/helpers/ scripts/ | wc -l  # → 0

# 3. Fitness workflow existe y pasa
test -f .github/workflows/fitness.yml && echo "OK"

# 4. CI rojo cuando un test falla (PR de prueba)
grep -E "\|\| true" .github/workflows/ci.yml | wc -l  # → 0

# 5. Todos los workflows con acciones pinned por SHA
#    (manual audit: 27 acciones corregidas, 0 @master/@main)

# 6. .dockerignore + build base image workflow activos (cross con B0 Docker pieza)
test -f .dockerignore && echo "OK"
```

**Findings table (13 — todos SAFETY_CRITICAL):**

| L-#   | Título corto                                                | Esfuerzo | Acción | §5.9         | Archivos / Notas                                                                                                             |
| ----- | ----------------------------------------------------------- | -------- | ------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| L-591 | `apps/api/.env` git-tracked con secrets reales              | QUICK    | FIX    | NEEDS_EDWARD | `git rm --cached` + rotate ALL secrets + verify git history + bfg si expuesto                                                |
| L-623 | password123 séxtuple (seed + scripts + tests + 3 workflows) | QUICK    | FIX    | AUTO         | Seed/test/CI secrets via `.env` + GitHub Secrets; absorbe L-600 (pre-escalación)                                             |
| L-622 | `ci.yml` silent test skip con `\|\| true`                   | TRIVIAL  | FIX    | AUTO         | `.github/workflows/ci.yml` — remover `\|\| true`                                                                             |
| L-616 | CI/CD broken pipeline composite                             | HEAVY    | FIX    | NEEDS_EDWARD | Composite absorbe L-617/L-618/L-619/L-620; 8 dead refs + eslint-security + branch coverage + 27 actions sin SHA + jq filters |
| L-621 | `DEPENDENCY_UPDATE_TOKEN` PAT blast radius                  | QUICK    | CONFIG | NEEDS_EDWARD | Migrar a GitHub App token con scope restrictivo                                                                              |
| L-630 | CLAUDE.md fitness functions ausentes CI                     | MEDIUM   | CONFIG | AUTO         | Crear `.github/workflows/fitness.yml` con los 10 greps                                                                       |
| L-647 | Confirmación + escalation fitness functions CI ausentes     | —        | —      | —            | Escalation de L-630 con counts reales [0,0,8,3,0,0,0,0,130,0] — mismos fixes                                                 |
| L-626 | performance workflow orphan chain (missing script)          | QUICK    | DECIDE | NEEDS_EDWARD | `scripts/performance.ts` missing; create vs remove workflow                                                                  |
| L-627 | performance/k6 dir missing                                  | QUICK    | DECIDE | NEEDS_EDWARD | Par con L-626                                                                                                                |
| L-628 | dependabot assignees literal `{{team_lead}}`                | TRIVIAL  | CONFIG | NEEDS_EDWARD | `.github/dependabot.yml` — replace con handle real                                                                           |
| L-629 | `cleanup.yml` org account assumption                        | QUICK    | FIX    | NEEDS_EDWARD | Gate `if: github.event.organization` o remove workflow                                                                       |
| L-546 | ADMIN_PASSWORD fallback weak (seed.ts)                      | QUICK    | FIX    | AUTO         | Fail-fast si env missing; cross B8 billing context                                                                           |
| L-640 | Dockerfile broken shared-base (API no deployable)           | MEDIUM   | FIX    | NEEDS_EDWARD | `apps/api/Dockerfile:8`; crear `build-base-image.yml` o inline-multistage                                                    |

**Orden de ejecución sugerido:**

1. L-591 (remove .env + rotate secrets) — **bloquea todo**
2. L-623 (password123) — depende de secrets rotados
3. L-622 (quitar `|| true`)
4. L-630/L-647 (wire fitness functions)
5. L-616 (composite CI/CD fixes)
6. L-621 (PAT → GitHub App)
7. L-626/L-627 (orphan performance chain decidir)
8. L-628/L-629 (dependabot + cleanup)
9. L-546 (ADMIN_PASSWORD fail-fast; también vive en B8, pero su fix es parte de B0 por impacto producción)
10. L-640 (Docker base — shippable last para no bloquear otros fixes)

**Notas.** B0 es el batch con mayor ratio "risk averted per hour". Sin B0, cualquier PR merged puede introducir regresiones invisibles. Edward debe agendar B0 como primera prioridad — no como "cuando haya tiempo".

---

### §5.1 — B1 Housekeeping Trivial

**Scope.** Archivos missing, `.bak` tracked, docs drift, filename conventions. Todo INDEPENDENT, todo COSMETIC/bajo, <15 min por item. Resultado: repo cosmético limpio, facilita review futuro.

**Entry criteria.** B0 no requerido técnicamente, pero recomendable para que nada se rompa silenciosamente.

**Exit criteria:**

```bash
# 1. Cero .bak files tracked
git ls-files | grep -E "\.bak[0-9]*$" | wc -l   # → 0

# 2. .gitattributes presente
test -f .gitattributes && echo "OK"

# 3. CODEOWNERS presente
test -f CODEOWNERS && echo "OK"

# 4. Root README.md presente
test -f README.md && echo "OK"

# 5. .dockerignore presente (si no se hizo en B0)
test -f .dockerignore && echo "OK"

# 6. docs/standards sin espacios en filenames
ls docs/standards/ | grep " " | wc -l   # → 0

# 7. Docs taxonomy alineada con CLAUDE.md §Documentation Policy
#    (manual: audits/ + standards/ añadidos a tabla CLAUDE.md)
```

**Findings table (34):**

| L-#   | Título corto                                              | Esfuerzo | Acción   | §5.9         | Archivos / Notas                                                        |
| ----- | --------------------------------------------------------- | -------- | -------- | ------------ | ----------------------------------------------------------------------- |
| L-531 | `.bak` files git-tracked (prisma.config.ts.bak2)          | TRIVIAL  | DELETE   | AUTO         | `git rm` (B1 resuelve; L-562 + L-601 son mismas instancias cross-batch) |
| L-562 | `.bak` git-tracked (instance B2)                          | TRIVIAL  | DELETE   | AUTO         | Parte del mismo cleanup que L-531                                       |
| L-601 | `.bak` instance filesystem (B3)                           | TRIVIAL  | DELETE   | AUTO         | Idem                                                                    |
| L-587 | `.gitattributes` missing                                  | TRIVIAL  | CONFIG   | AUTO         | `* text=auto eol=lf`                                                    |
| L-588 | CODEOWNERS missing                                        | TRIVIAL  | CONFIG   | NEEDS_EDWARD | Edward decide handles                                                   |
| L-589 | `.gitignore` missing `*.bak` pattern                      | TRIVIAL  | CONFIG   | AUTO         | Cross-ref L-531                                                         |
| L-590 | `.gitignore` missing `pnpm-lock.yaml.baseline`            | TRIVIAL  | CONFIG   | AUTO         | Add pattern o commit baseline                                           |
| L-641 | `.dockerignore` missing                                   | QUICK    | CONFIG   | AUTO         | Cross-ref B0 (puede ejecutarse ya en B0)                                |
| L-645 | Root README.md missing                                    | QUICK    | DOCUMENT | NEEDS_EDWARD | Entry point para onboarding                                             |
| L-646 | docs/standards filenames con espacios                     | TRIVIAL  | FIX      | AUTO         | Rename a kebab-case + update imports                                    |
| L-644 | docs/ taxonomy drift (14 vs 12 declarados)                | TRIVIAL  | DOCUMENT | AUTO         | Update CLAUDE.md §Documentation Policy                                  |
| L-598 | minio doc drift (port mismatch)                           | TRIVIAL  | FIX      | AUTO         | Unificar docs con compose                                               |
| L-553 | `multi-tenant-security.sql` MARK_OBSOLETE                 | TRIVIAL  | DECIDE   | NEEDS_EDWARD | Edward decide delete vs wire                                            |
| L-550 | `systemTemplates` reviewable i18n                         | TRIVIAL  | DOCUMENT | NEEDS_EDWARD | Evaluar i18n path                                                       |
| L-554 | snake_case mismatch en `@@map`                            | TRIVIAL  | FIX      | AUTO         | Normalize                                                               |
| L-555 | dangling doc ref `performance-monitoring.md`              | TRIVIAL  | FIX      | AUTO         | Create o remove ref                                                     |
| L-556 | `@layer test-infrastructure` invalid                      | TRIVIAL  | FIX      | AUTO         | Normalize a `infrastructure`                                            |
| L-493 | VirtualScrollList sprint comment (viola CLAUDE.md)        | TRIVIAL  | FIX      | AUTO         | `// Added in Sprint 2` → remove                                         |
| L-494 | VirtualScrollList hardcoded emoji                         | TRIVIAL  | FIX      | AUTO         | Extract o remove                                                        |
| L-440 | `ProviderUtils` unreachable branch                        | TRIVIAL  | DELETE   | AUTO         |                                                                         |
| L-119 | instagram/upload commented-out Metadata                   | TRIVIAL  | DELETE   | AUTO         | `page.tsx:517-520`                                                      |
| L-120 | `_customDateTime` unused state SchedulePicker             | TRIVIAL  | DELETE   | AUTO         | `editor/SchedulePicker.tsx:129`                                         |
| L-121 | PlatformPreview unused `_createThreadSegments`            | TRIVIAL  | DELETE   | AUTO         | `editor/PlatformPreview.tsx:51-83`                                      |
| L-122 | ConversationThread eslint-disable sin documentar          | TRIVIAL  | DOCUMENT | AUTO         | Add comment explaining intent                                           |
| L-502 | Empty interface extends                                   | TRIVIAL  | FIX      | AUTO         | `interface Foo extends Bar {}` → type alias                             |
| L-309 | unused imports composite (4 files)                        | TRIVIAL  | FIX      | AUTO         | ESLint auto-fix                                                         |
| L-440 | duplicate (ver arriba) — entry ya contado                 | —        | —        | —            | —                                                                       |
| L-619 | absorbed L-616 (dedup placeholder)                        | —        | —        | —            | Appendix C                                                              |
| L-265 | `useNotificationStream` SSE bypass proxy (documentado OK) | TRIVIAL  | DOCUMENT | AUTO         | Ninguna acción; listado para awareness                                  |
| L-569 | factory pattern parcial seeds (podría extenderse)         | TRIVIAL  | DOCUMENT | AUTO         | POSITIVE but reviewable; puede ir a B1 si Edward quiere polish          |
| L-308 | admin→client URL questionable `/projects`                 | TRIVIAL  | DOCUMENT | NEEDS_EDWARD | `WebhookSubscriptions.tsx:152` — document intent                        |
| L-498 | VirtualScrollList `startTransition` shadowed              | TRIVIAL  | FIX      | AUTO         | Rename                                                                  |
| L-382 | db-prisma logger no inyectado (usa console)               | TRIVIAL  | FIX      | AUTO         | Inject `LoggerPort` (también puede ir a B4/B6)                          |
| L-377 | cache-redis TTL default hardcoded                         | TRIVIAL  | CONFIG   | AUTO         | Env var `CACHE_TTL_DEFAULT`                                             |
| L-378 | storage-s3 bucket fallback hardcoded                      | TRIVIAL  | CONFIG   | AUTO         | Require env var                                                         |

**Orden de ejecución sugerido:** por bloques temáticos en 1 día.

1. Bloque git/repo meta: L-531/L-562/L-601 (delete .bak), L-589, L-590, L-587, L-588, L-641, L-645, L-644.
2. Bloque dead comments/code: L-119, L-120, L-121, L-122, L-309, L-440, L-493, L-494, L-502, L-498.
3. Bloque docs: L-553, L-554, L-555, L-556, L-646, L-598, L-308, L-569, L-265.
4. Bloque config hardcoded: L-377, L-378, L-550, L-382.

**Notas.** Edward puede delegar B1 completo a un agente en una sola sesión. L-588 (CODEOWNERS) y L-645 (README) pueden requerir su input sobre contenido específico; todo lo demás es auto-ejecutable.

---

### §5.2 — B2 DEAD_CODE validado

**Scope.** Código/endpoints/hooks/packages clasificados como DEAD por evidencia multi-grep pero **NO eliminados** hasta que Edward valide cada uno (§5.9). Cada item requiere decisión binaria: DELETE, WIRE (con plan), o PLANNED (documentar backlog).

**Entry criteria.** B0 cerrado (fitness functions activas evitan delete que rompa tests en silencio).

**Exit criteria:**

```bash
# Cada finding tiene decisión Edward documentada en commit message
# o movido a Appendix B (WONT_FIX) o Appendix C (RESOLVED).

# Objetivo cuantitativo: -15..30 archivos orphan desaparecen.
```

**Findings table (49):**

| L-#   | Título corto                                        | Esfuerzo | Acción    | §5.9         | Archivos / Notas                                                                                                |
| ----- | --------------------------------------------------- | -------- | --------- | ------------ | --------------------------------------------------------------------------------------------------------------- |
| L-2   | 3 domain events sin export en index                 | QUICK    | DECIDE    | NEEDS_EDWARD | `PostUnscheduled`, `PostPublishingStarted`, `PostMediaRemoved`                                                  |
| L-4   | 3 adapters `@deprecated` sin migration path         | MEDIUM   | DECIDE    | NEEDS_EDWARD | Sprint de migration paths                                                                                       |
| L-3   | 17 domain ports sin Prisma adapter detectable       | MEDIUM   | DECIDE    | NEEDS_EDWARD | Triage caso-por-caso                                                                                            |
| L-25  | 4 tokens DI orfanados                               | QUICK    | DECIDE    | NEEDS_EDWARD | `EnableReportSharingUseCase`, `DisableReportSharingUseCase`, `GenerateContentCalendarUseCase`, `PaymentAdapter` |
| L-44  | AnalyticsEventHandler + WebhookEventHandler STUBS   | HEAVY    | IMPLEMENT | NEEDS_EDWARD | Cross-ref B5 (stubs → real) y B11 si es PLANNED backlog                                                         |
| L-47  | CQRS subsystem = PLANNED + bus vacío                | MEDIUM   | DECIDE    | NEEDS_EDWARD | Cross-ref B9 (wire handlers post-B4)                                                                            |
| L-48  | `lib/errors/errorPlugin.ts` DEAD por no-wired       | QUICK    | DECIDE    | NEEDS_EDWARD | Wire o eliminar                                                                                                 |
| L-66  | 5 queues PLANNED sin workers                        | MEDIUM   | DECIDE    | NEEDS_EDWARD | `REPORT_GENERATION`, `RECURRING_POSTS`, `DETECT_REPURPOSE`, `TRIAGE_INBOX`, `TREND_RADAR`                       |
| L-67  | DEAD_LETTER_QUEUE + FAILED_OPERATIONS_DLQ sin wire  | QUICK    | DECIDE    | NEEDS_EDWARD | Git blame history + validación                                                                                  |
| L-267 | `proxy.ts` root-level dead middleware (admin)       | TRIVIAL  | FIX       | AUTO         | Rename a `middleware.ts` o delete                                                                               |
| L-348 | `proxy.ts` re-confirmed ORPHAN (extend L-267)       | —        | —         | —            | Absorbed en L-267                                                                                               |
| L-317 | `useAuditLogs` ORPHAN (hook sin consumer)           | QUICK    | DECIDE    | NEEDS_EDWARD | Wire (ScheduledJobsPanel) o delete                                                                              |
| L-318 | `useAuditStats` ORPHAN                              | QUICK    | DECIDE    | NEEDS_EDWARD | Wire a dashboard stats o delete                                                                                 |
| L-319 | `useContentLibrary` ORPHAN (admin)                  | QUICK    | DECIDE    | NEEDS_EDWARD | Admin no tiene Content Library page                                                                             |
| L-320 | `useMultiPlatformScheduling` ORPHAN (admin)         | QUICK    | DECIDE    | NEEDS_EDWARD | Cluster orphan scheduling admin                                                                                 |
| L-321 | `usePerformanceInsights` ORPHAN (admin)             | QUICK    | DECIDE    | NEEDS_EDWARD | Wire a analytics dashboard o delete                                                                             |
| L-322 | `usePosts` ORPHAN (admin)                           | QUICK    | DELETE    | NEEDS_EDWARD | Admin no gestiona posts; probable DELETE                                                                        |
| L-323 | `usePublicSettings` ORPHAN TOTAL                    | QUICK    | DECIDE    | NEEDS_EDWARD | Wire consumer desde reset-password o delete                                                                     |
| L-324 | `useUniversalAnalytics` ORPHAN                      | QUICK    | DECIDE    | NEEDS_EDWARD | Wire o delete                                                                                                   |
| L-335 | `ProjectProvider` 322 LOC ORPHAN (admin)            | MEDIUM   | DECIDE    | NEEDS_EDWARD | Admin no tiene concept de proyecto; probable DELETE                                                             |
| L-338 | `useQueueManager` 213 LOC ORPHAN colocated          | MEDIUM   | DECIDE    | NEEDS_EDWARD | Delete vs wire                                                                                                  |
| L-339 | `ai-content-utils.ts` 178 LOC ORPHAN + 4 fake-AI    | MEDIUM   | DELETE    | NEEDS_EDWARD | Probable DELETE                                                                                                 |
| L-340 | `notificationStore` 80 LOC ORPHAN + broken promise  | QUICK    | DELETE    | NEEDS_EDWARD | Phase 2/3 jamás cumplida                                                                                        |
| L-341 | `schedulingCsvParser.ts` 178 LOC ORPHAN             | QUICK    | DELETE    | NEEDS_EDWARD | Cluster con L-320/L-343                                                                                         |
| L-342 | `types/ai-content.ts` ORPHAN (par con L-339)        | TRIVIAL  | DELETE    | NEEDS_EDWARD | Delete con L-339                                                                                                |
| L-343 | `types/scheduling.ts` ORPHAN (par con L-341)        | TRIVIAL  | DELETE    | NEEDS_EDWARD | Delete con L-341                                                                                                |
| L-346 | `ProjectProvider` 2 raw fetches en código dead      | —        | —         | —            | Resolved when L-335 resolved                                                                                    |
| L-349 | `ai-content-utils` emoji truncation bug             | —        | —         | —            | Bug en dead code L-339; resolved when L-339 resolved                                                            |
| L-350 | `packages/shared/src/client.ts` DEAD_CODE           | TRIVIAL  | DELETE    | AUTO         | Re-export sin consumer                                                                                          |
| L-351 | `packages/shared/src/templates/types.ts` DEAD_CODE  | TRIVIAL  | DELETE    | AUTO         | Cluster con L-350                                                                                               |
| L-357 | `SubscriptionTier` deprecated usage                 | MEDIUM   | REFACTOR  | NEEDS_EDWARD | Complete migration, delete enum                                                                                 |
| L-375 | SubscriptionTier deprecation unremoved (re-confirm) | —        | —         | —            | Absorbed en L-357                                                                                               |
| L-366 | `@adapters/storage-azure` ORPHAN (456 LOC)          | HEAVY    | DECIDE    | NEEDS_EDWARD | Wire vs delete                                                                                                  |
| L-367 | `@adapters/storage-gcs` ORPHAN (445 LOC)            | HEAVY    | DECIDE    | NEEDS_EDWARD | Wire vs delete                                                                                                  |
| L-369 | `@adapters/crm-salesforce` ORPHAN (293 LOC)         | HEAVY    | DECIDE    | NEEDS_EDWARD | Wire vs delete                                                                                                  |
| L-370 | `@adapters/storage-do-spaces` ORPHAN (198 LOC)      | MEDIUM   | DECIDE    | NEEDS_EDWARD | Wire vs delete                                                                                                  |
| L-371 | `@adapters/crm-hubspot` ORPHAN (267 LOC)            | MEDIUM   | DECIDE    | NEEDS_EDWARD | Wire vs delete                                                                                                  |
| L-365 | cloudinary runtime bug L192 (en ORPHAN)             | —        | —         | —            | Bug en dead code; resolved with adapter decision                                                                |
| L-442 | `usePublishingEngine` ORPHAN (272 LOC, packages/ui) | HEAVY    | DECIDE    | NEEDS_EDWARD | Pair con L-444 editor chain                                                                                     |
| L-443 | `useProviderConstraints` ORPHAN (215 LOC)           | MEDIUM   | DECIDE    | NEEDS_EDWARD | Cross-ref L-455 (hardcoded URL)                                                                                 |
| L-444 | TipTapContentEditor ORPHAN (359 LOC)                | HEAVY    | DECIDE    | NEEDS_EDWARD | Editor chain 10 files ~2,515 LOC                                                                                |
| L-445 | ValidationContentEditor ORPHAN (261 LOC)            | HEAVY    | DECIDE    | NEEDS_EDWARD | Editor chain                                                                                                    |
| L-446 | ContentVersioning ORPHAN (299 LOC)                  | HEAVY    | DECIDE    | NEEDS_EDWARD | Editor chain                                                                                                    |
| L-447 | VersionCompactView ORPHAN (344 LOC)                 | HEAVY    | DECIDE    | NEEDS_EDWARD | Editor chain                                                                                                    |
| L-448 | VersionTimelineView ORPHAN (287 LOC)                | HEAVY    | DECIDE    | NEEDS_EDWARD | Editor chain                                                                                                    |
| L-449 | VersionCompareView ORPHAN (~220 LOC)                | HEAVY    | DECIDE    | NEEDS_EDWARD | Editor chain                                                                                                    |
| L-450 | VersionDetailDialog ORPHAN (~180 LOC)               | MEDIUM   | DECIDE    | NEEDS_EDWARD | Editor chain                                                                                                    |
| L-451 | VersionRestoreDialog ORPHAN (~140 LOC)              | MEDIUM   | DECIDE    | NEEDS_EDWARD | Editor chain                                                                                                    |
| L-452 | VersionFilterBar ORPHAN (~110 LOC)                  | MEDIUM   | DECIDE    | NEEDS_EDWARD | Editor chain                                                                                                    |
| L-453 | `useContentVersioning` ORPHAN (316 LOC)             | MEDIUM   | DECIDE    | NEEDS_EDWARD | Editor chain                                                                                                    |
| L-454 | `useVirtualScroll` + memo HOC ORPHAN                | QUICK    | DELETE    | NEEDS_EDWARD | Si no wire planificado                                                                                          |
| L-506 | `@monitoring/circuit-breaker` 95% DEAD (scaffold)   | HEAVY    | DECIDE    | NEEDS_EDWARD | Wire (inject opossum breakers) vs delete package                                                                |
| L-473 | `@monitoring/circuit-breaker` central monitor DEAD  | —        | —         | —            | Same composite L-506 / L-368                                                                                    |
| L-517 | `checkers/circuitBreaker.ts` dead (paired L-473)    | —        | —         | —            | Resolved when L-506 resolved                                                                                    |
| L-521 | `CircuitBreakerHealthChecker` never registered      | MEDIUM   | DECIDE    | NEEDS_EDWARD | Register or delete (par con L-506)                                                                              |
| L-522 | No `SagaHealthChecker` (L-63 gap)                   | MEDIUM   | IMPLEMENT | NEEDS_EDWARD | Post-L-63 fix — implement checker que query saga_state FAILED                                                   |

**Orden de ejecución sugerido (grupos, cada uno ½ día):**

1. **Grupo A — DEAD_CODE trivial** (L-350, L-351, L-267/L-348, L-340): DELETE con commit atómico; zero riesgo.
2. **Grupo B — Admin hooks ORPHAN** (L-317..L-324, L-335, L-338, L-339, L-341, L-342, L-343): Edward decide cluster en 1 sesión; probables DELETE mayoritarios.
3. **Grupo C — Editor chain `@ui`** (L-442..L-453): gran cluster DEEP — Edward decide wire vs delete como unidad; si delete, ~2,500 LOC cleanup.
4. **Grupo D — Adapter packages ORPHAN** (L-366, L-367, L-369, L-370, L-371): Edward decide per-adapter; implica también L-365 (bug) y L-595 (knip).
5. **Grupo E — Monitoring / infra DEAD** (L-506, L-473, L-517, L-521, L-522, L-66, L-67, L-47, L-63 reference): requiere B4 parcial para L-47/L-522 — puede diferirse a B9.
6. **Grupo F — DI tokens orfanados y misc** (L-25, L-48, L-357, L-375, L-2, L-3, L-4, L-454).

**Notas.** B2 es donde Edward invierte tiempo decidiendo — no es un batch auto-ejecutable. Cada grupo en una sesión corta (1–2 h) es suficiente. Las decisiones quedan registradas en commit messages tipo `chore(b2): decision L-319 — DELETE — admin does not manage content library`. El reporte D0v4-8 §15 propuso ciertos defaults; Edward puede usarlos como punto de partida.

---

### §5.3 — B3 Config Correctness

**Scope.** Config files que no matchean realidad del código: `tsconfig` missing paths, ESLint sin rules de CLAUDE.md, `.env.example` desalineado, turbo env, knip rules, docker-compose bindings, vitest base config.

**Entry criteria.** B0 cerrado (fitness functions verdes actúan como canary).

**Exit criteria:**

```bash
# 1. ESLint 4 rules nuevas corren 0 errors
pnpm lint                                      # → 0 errors, 0 warnings

# 2. tsconfig paths completos
grep -c '"paths"' tsconfig.base.json           # → 1 (con 35+ entries)

# 3. .env.example matches code scan
diff <(grep -oE 'process\.env\.[A-Z_]+' apps/ packages/ infra/ | cut -d'.' -f3 | sort -u) \
     <(grep -oE '^[A-Z_]+' .env.example | sort -u)   # → empty diff

# 4. turbo cache honra env vars
grep -c '"env":' turbo.json                    # → ≥5

# 5. docker-compose bindings 127.0.0.1
grep -cE '"0\.0\.0\.0:' docker-compose.yml     # → 0

# 6. vitest base config root
test -f vitest.config.base.ts && echo "OK"
```

**Findings table (27):**

| L-#   | Título corto                                         | Esfuerzo | Acción | §5.9         | Archivos / Notas                                             |
| ----- | ---------------------------------------------------- | -------- | ------ | ------------ | ------------------------------------------------------------ |
| L-576 | ESLint no `no-console` rule                          | QUICK    | CONFIG | AUTO         | Composite enforcement CLAUDE.md                              |
| L-577 | ESLint no `no-restricted-imports` (domain isolation) | QUICK    | CONFIG | AUTO         | Bloquea prisma/fastify/redis desde `domain/`                 |
| L-578 | ESLint no `no-explicit-any` rule                     | QUICK    | CONFIG | AUTO         | `@typescript-eslint/no-explicit-any: "error"`                |
| L-579 | ESLint no `no-floating-promises` rule                | QUICK    | CONFIG | AUTO         | `@typescript-eslint/no-floating-promises: "error"`           |
| L-580 | eslint-config-prettier not referenced                | TRIVIAL  | CONFIG | AUTO         | Add extends `prettier`                                       |
| L-581 | turbo `env` section no declarada                     | QUICK    | CONFIG | AUTO         | Declarar env por task                                        |
| L-582 | turbo test outputs gap                               | TRIVIAL  | CONFIG | AUTO         | `outputs: ["coverage/**"]`                                   |
| L-583 | root `.env.example` 11 vs 80 used                    | MEDIUM   | CONFIG | AUTO         | Auto-gen desde code scan                                     |
| L-584 | TWITTER\_\* ghost vars post-rename                   | QUICK    | FIX    | AUTO         | Rename a `X_*`                                               |
| L-585 | ghost vars second tier                               | QUICK    | FIX    | AUTO         | Audit cross-ref code → declaration                           |
| L-586 | double SoT `.env` (root vs apps/api/.env)            | QUICK    | CONFIG | AUTO         | Single .env root + dotenv-cli                                |
| L-571 | workspaces npm-style dead config                     | TRIVIAL  | CONFIG | AUTO         | Remove `workspaces` field de `package.json`                  |
| L-572 | pnpm-workspace duplicate `infra/prisma`              | TRIVIAL  | CONFIG | AUTO         | Deduplicate                                                  |
| L-573 | tsconfig `@packages/providers` convention drift      | TRIVIAL  | FIX    | AUTO         | Unificar a `@providers/*`                                    |
| L-574 | tsconfig missing 6 package paths                     | QUICK    | CONFIG | AUTO         | Add al base                                                  |
| L-575 | project references 5/40 coverage                     | QUICK    | CONFIG | AUTO         | Audit + add restantes                                        |
| L-592 | no `commit-msg` hook                                 | QUICK    | CONFIG | AUTO         | Husky + commitlint                                           |
| L-593 | no `pre-push` hook                                   | QUICK    | CONFIG | AUTO         | Husky pre-push                                               |
| L-594 | stryker sandbox cleanup failed                       | QUICK    | CONFIG | NEEDS_EDWARD | Investigate stryker version/config                           |
| L-595 | knip no declara ORPHAN packages (HIGH compound)      | QUICK    | CONFIG | NEEDS_EDWARD | Update rules OR delete adapters (depende B2)                 |
| L-596 | docker-compose no `env_file`                         | TRIVIAL  | CONFIG | AUTO         | `env_file: - .env`                                           |
| L-597 | port bindings `0.0.0.0` (SAFETY_CRITICAL)            | QUICK    | CONFIG | AUTO         | Bind `127.0.0.1:PORT:PORT` — único SAFETY_CRITICAL del batch |
| L-599 | root `vitest.config` missing                         | QUICK    | CONFIG | AUTO         | `vitest.config.base.ts`                                      |
| L-558 | postinstall reproducibility (husky)                  | TRIVIAL  | CONFIG | AUTO         | Conditional `test -d .git && husky install`                  |
| L-559 | seed not in CI                                       | QUICK    | CONFIG | AUTO         | Add `pnpm db:seed` step a integration job                    |
| L-532 | SHADOW_DATABASE_URL hardcoded password               | QUICK    | CONFIG | AUTO         | Use env var + documentar en `.env.example` (cross-ref L-583) |
| L-533 | Prisma generator no `previewFeatures`                | TRIVIAL  | CONFIG | NEEDS_EDWARD | Evaluar preview features relevantes                          |
| L-530 | `prisma.config.ts` usa `npx` en vez de `pnpm exec`   | TRIVIAL  | FIX    | AUTO         | Replace `npx` → `pnpm exec`                                  |

**Orden de ejecución sugerido (2 días):**

1. **Día 1 — Lint + TS:** L-576/L-577/L-578/L-579 (ESLint rules), L-580, L-573/L-574/L-575 (tsconfig paths), L-571/L-572 (workspaces), L-558, L-592/L-593 (husky).
2. **Día 2 — Env + Docker + CI + Misc:** L-583 (auto-gen .env), L-584/L-585/L-586/L-532, L-596/L-597 (compose), L-581/L-582 (turbo), L-599 (vitest root), L-594 (stryker), L-595 (knip), L-559 (seed in CI), L-533/L-530 (prisma).

**Notas.** B3 es un batch "obrero" — mucho cambio de configuración, poco riesgo. Importante: después de B3 empiezan a fallar tests/builds si hay violations latentes — **esa es la idea**. Edward debe correr `pnpm lint` + `pnpm build` + `pnpm test` al cerrar B3 y observar qué nuevos errors aparecen; alimentan los counts de B6.

---

### §5.4 — B4 DI Consistency

**Scope.** Consolidar el DI container: Redis singleton, EventService unificado, ApiMetrics real (no `{} as ApiMetrics`), Prisma factory vs singleton, correlation ID unificado, UCs con no-op stubs.

**Entry criteria.** B3 cerrado (tsconfig paths completos + ESLint rules).

**Exit criteria:**

```bash
# 1. createRedisConnection centralizado
grep -rn "new RedisConnection\|createRedisConnection(" apps/api/src/ | wc -l   # → 1 (solo factory)

# 2. Prisma factory pattern en setup files
grep -rn "import { prisma } from \"@infra/prisma\"" apps/api/src/infrastructure/container/ | wc -l   # → 0

# 3. ApiMetrics real registrado
grep -rn "{} as ApiMetrics\|as ApiMetrics" apps/api/src/ | wc -l   # → 0

# 4. EventService singleton
grep -rn "new EventService\b" apps/api/src/ | wc -l   # → 1 (solo factory)

# 5. correlation middleware wired en index.ts
grep -rn "correlationMiddleware" apps/api/src/index.ts | wc -l   # → ≥1
```

**Findings table (16):**

| L-#   | Título corto                                              | Esfuerzo | Acción   | §5.9         | Archivos / Notas                                                 |
| ----- | --------------------------------------------------------- | -------- | -------- | ------------ | ---------------------------------------------------------------- |
| L-35  | `createRedisConnection()` 13 veces — singleton token      | MEDIUM   | REFACTOR | AUTO         | Register `TOKENS.Redis`                                          |
| L-36  | EventService sin token DI — 6+ instancias paralelas       | HEAVY    | REFACTOR | NEEDS_EDWARD | Edward CP3 unificación candidate; cross-ref B9                   |
| L-37  | `{} as ApiMetrics` mock vacío (SAFETY_CRITICAL)           | QUICK    | FIX      | AUTO         | `setupServices.ts:262`; crash en runtime                         |
| L-40  | 9 setup files Prisma singleton vs factory                 | MEDIUM   | REFACTOR | AUTO         | Unificar a lazy factory `container.resolve(TOKENS.PrismaClient)` |
| L-41  | (se resuelve mejor en B9) — EventStore schema divergence  | —        | —        | —            | Ver B9                                                           |
| L-33  | 2 sistemas correlation ID generation                      | QUICK    | REFACTOR | AUTO         | Wire `correlationMiddleware` + remove de metricsMiddleware       |
| L-38  | `UpdatePricingConfigUseCase` registrado con 4 no-op stubs | MEDIUM   | DECIDE   | NEEDS_EDWARD | Investigar grandfathering flow intent                            |
| L-39  | `GenerateRepurposeVariantsUseCase` noOpNotification       | MEDIUM   | DECIDE   | NEEDS_EDWARD | Wire o eliminar dep                                              |
| L-45  | `EventService.setupDefaultHandlers` 3 no-op handlers      | MEDIUM   | DECIDE   | NEEDS_EDWARD | Wire real o eliminar; cross-ref L-36                             |
| L-46  | `ComposedEventDispatcher` swallows BullMQ errors          | QUICK    | FIX      | AUTO         | Wire logger + metric counter                                     |
| L-49  | 3 sistemas paralelos de caching                           | HEAVY    | REFACTOR | NEEDS_EDWARD | Consolidar `CachePort`; cross-ref L-13                           |
| L-13  | Module-level cache pattern (2 UCs, no testeable)          | MEDIUM   | REFACTOR | AUTO         | `CachePort` abstracto; resolved con L-49                         |
| L-50  | `outboxAdminRoutes` comments obsoletos + prisma singleton | QUICK    | FIX      | AUTO         | Migrar a DI; preserve `aggregateType`                            |
| L-51  | setInterval sin `.unref()` (5 lugares)                    | QUICK    | FIX      | AUTO         | Add `.unref()` — graceful shutdown                               |
| L-510 | `CorrelationTracker` setInterval no cleanup               | QUICK    | FIX      | AUTO         | Add shutdown hook                                                |
| L-511 | `CorrelationTracker` singleton DI violation               | QUICK    | REFACTOR | AUTO         | Move a Container                                                 |

**Orden de ejecución sugerido (2 días):**

1. **Mañana día 1:** L-37 (ApiMetrics crash fix — máxima prioridad), L-35 (Redis singleton), L-40 (Prisma factory).
2. **Tarde día 1:** L-33 (correlation), L-51/L-510 (setInterval), L-511 (CorrelationTracker).
3. **Mañana día 2:** L-36 (EventService unificación + L-45), L-46 (ComposedEventDispatcher logger), L-50.
4. **Tarde día 2:** L-13 + L-49 (CachePort unification), L-38/L-39 (UCs no-op — decisiones Edward).

**Notas.** L-37 es el único SAFETY_CRITICAL del batch y debería atacarse primero. L-36 y sus derivados (L-45, L-46) pueden diferirse a B9 si el alcance crece.

---

### §5.5 — B5 Stubs → Real

**Scope.** Reemplazar implementaciones stub de seguridad/ops por reales. Todos son SAFETY_CRITICAL porque simulan enforcement sin ejercerlo (security theater).

**Entry criteria.** B0 cerrado (CI verifica no regresión).

**Exit criteria:**

```bash
# 1. Rate limiter rbacMiddleware enforce real (no solo headers)
grep -rn "roleBasedRateLimit" apps/api/src/auth/rbacMiddleware.ts | wc -l    # → 1 con Redis backend

# 2. auditLogger extrae userId real
grep -n "return undefined" apps/api/src/security/auditLogger.ts              # → 0 hits

# 3. fileUploadValidator con ClamAV real
grep -rn "Simulate ClamAV\|scanForMalware.*placeholder" apps/api/src/ | wc -l  # → 0

# 4. slidingWindowRateLimit extractUserId real
grep -n "return null" apps/api/src/security/slidingWindowRateLimit.ts        # → 0 hits

# 5. Rate limiter decision documentada
#    (ADR creado: consolidar o justificar 5 paralelos)

# 6. API key hashing unificado argon2
grep -rn "hashApiKey.*sha256\|SHA-256" packages/ apps/ | wc -l               # → 0 (post-migration)
```

**Findings table (13):**

| L-#  | Título corto                                                         | Esfuerzo | Acción    | §5.9         | Archivos / Notas                                                                             |
| ---- | -------------------------------------------------------------------- | -------- | --------- | ------------ | -------------------------------------------------------------------------------------------- |
| L-26 | `rbacMiddleware.roleBasedRateLimit` FAKE                             | MEDIUM   | IMPLEMENT | AUTO         | Redis sorted sets como security/rateLimit.ts                                                 |
| L-27 | `auditLogger.extractUserId` STUB (CRITICAL compliance)               | MEDIUM   | IMPLEMENT | AUTO         | Extraer `request.auth.user.id` / `customerUser.id`                                           |
| L-28 | `fileUploadValidator` placeholder + simulated scanner                | HEAVY    | IMPLEMENT | NEEDS_EDWARD | ClamAV-REST / VirusTotal / AWS GuardDuty; persistencia quarantine                            |
| L-29 | `slidingWindowRateLimit.extractUserId` STUB                          | QUICK    | IMPLEMENT | AUTO         | JWT decode o wire post-auth                                                                  |
| L-30 | 5 rate limiters paralelos — 1 wired, 4 INFRASTRUCTURE_READY          | MEDIUM   | DECIDE    | NEEDS_EDWARD | Consolidar o justificar                                                                      |
| L-31 | 3 validators paralelos con patterns SQL distintos                    | HEAVY    | REFACTOR  | NEEDS_EDWARD | Consolidar en único `ValidationPort`                                                         |
| L-32 | 2 sistemas API key hashing (SHA-256 vs argon2)                       | HEAVY    | REFACTOR  | AUTO         | Migrar credentialManager a argon2 + data migration                                           |
| L-52 | `publishHandler.handleJob` silent failure (no re-throw)              | QUICK    | FIX       | AUTO         | Re-throw tras logging para habilitar BullMQ retry                                            |
| L-53 | 4/6 workers sin retry policy explícita                               | QUICK    | CONFIG    | AUTO         | Standard `{attempts:3, backoff:exp 5000ms}`                                                  |
| L-54 | 3/4 workers sin graceful shutdown                                    | QUICK    | FIX       | AUTO         | Replicar pattern autoRenewalWorker                                                           |
| L-55 | `inboxSyncWorker` bypass domain layer                                | MEDIUM   | REFACTOR  | AUTO         | Invocar `IngestSocialMessageUseCase` via DI (depende L-65 worker topology — diferible a B10) |
| L-56 | `analyticsIngest` + `inboxSync` silent AUTH errors                   | MEDIUM   | IMPLEMENT | AUTO         | Emit `ChannelAuthFailed` + notification                                                      |
| L-44 | AnalyticsEventHandler + WebhookEventHandler STUBS (webhook fantasma) | HEAVY    | IMPLEMENT | NEEDS_EDWARD | Cross-ref B2; decisión PLANNED o IMPLEMENT                                                   |

**Orden de ejecución sugerido (3–4 días):**

1. **Día 1 — Workers runtime:** L-52, L-53, L-54 (publishWorker + retry + graceful) — los más críticos post-B0.
2. **Día 2 — Audit + UserID extraction:** L-27, L-29, L-26, L-56.
3. **Día 3 — File + validators:** L-28 (ClamAV integration), L-31 (consolidate validators).
4. **Día 4 — API key + rate limiters + webhooks:** L-32 (argon2 migration), L-30 (decide rate limiter consolidation), L-44 (webhook handlers wire o defer B11), L-55 (worker→UC).

**Notas.** L-28 (ClamAV) puede requerir dependencia externa no presente; si no hay budget, acordar con Edward el scope mínimo (al menos hash blacklist + extension validation + size cap) hasta sprint dedicado.

---

### §5.6 — B6 Domain/App Quality

**Scope.** Masa de hallazgos de quality en domain + application layers: raw throws → Result, `any` elimination, `@file` headers missing (~130 files composite), VO bypass, UoW missing, cross-domain type imports. Batch voluminoso (205 findings), alto ratio findings/tiempo porque la mayoría son pequeños fixes localizados.

**Entry criteria.** B3 cerrado (ESLint enforza `no-explicit-any` + `no-floating-promises` + `no-console` → CI canary).

**Exit criteria:**

```bash
# 1. Cero `any` en prod source (CLAUDE.md fitness #3)
grep -rn ": any\b\|as any\b\|<any>" apps/api/src/domain/ apps/api/src/application/ apps/api/src/infrastructure/ --include="*.ts" | wc -l    # → 0

# 2. Cero throws en domain/application (fitness #4)
grep -rn "throw " apps/api/src/domain/ apps/api/src/application/ --include="*.ts" | wc -l    # → 0

# 3. Cero files missing @file (fitness #9)
grep -rL "@file" apps/api/src/ --include="*.ts" | grep -v node_modules | wc -l    # → 0

# 4. @layer canonical (fitness #10) — ya resuelto en D0v4-8 sub-parte
grep -rn "@layer" apps/api/src/ --include="*.ts" | grep -v "@layer application\|@layer domain\|@layer infrastructure" | wc -l    # → 0

# 5. Cero casts `(user as Record<string, unknown>)?.accountId` (L-88)
grep -rn "(user as Record<string, unknown>)" apps/client/ | wc -l    # → 0
```

**Findings table (205 — agrupada por subcategoría):**

#### Subcategoría 6.1 — Domain/Application violations (backend)

| L-#   | Título corto                                                        | Esfuerzo | Acción   | §5.9         | Notas                                      |
| ----- | ------------------------------------------------------------------- | -------- | -------- | ------------ | ------------------------------------------ |
| L-5   | Repository base `Result<void, Error>` no DomainError                | MEDIUM   | REFACTOR | AUTO         | Mass-scale — propaga a 56 adapters         |
| L-12  | `templates/*` triple violation (prisma import + singleton + any)    | MEDIUM   | REFACTOR | AUTO         | Fix triple                                 |
| L-15  | `application/ml/*` viola hexagonal (import AIService)               | MEDIUM   | REFACTOR | AUTO         | Introducir `AIServicePort`                 |
| L-17  | `IngestChannelAnalyticsUseCase` VO factory bypass (SAFETY_CRITICAL) | QUICK    | FIX      | AUTO         | `ChannelId.fromString()`                   |
| L-18  | `TriggerIntegrationEventService` raw fetch sin port                 | MEDIUM   | REFACTOR | AUTO         | `HttpClientPort`                           |
| L-19  | Cross-domain type import `ChannelQueryForIngestion`                 | QUICK    | REFACTOR | AUTO         | Move a `domain/repositories/`              |
| L-21  | `GenerateUTMLinksUseCase` mutante sin UoW (SAFETY_CRITICAL)         | QUICK    | FIX      | AUTO         | Wrapper UoW                                |
| L-23  | `InviteTeamMember` hardcoded baseUrl                                | QUICK    | FIX      | AUTO         | Config port / env                          |
| L-24  | `templates/templateService` dynamic imports                         | QUICK    | REFACTOR | NEEDS_EDWARD | Investigar circular dep                    |
| L-643 | `PricingCalculator` raw throws (fitness #4)                         | QUICK    | REFACTOR | AUTO         | `Result<Output, PricingError>`             |
| L-22  | Outbox pattern — 3 issues (race, idempotency, backoff)              | HEAVY    | FIX      | AUTO         | Cross-ref L-43 (SELECT FOR UPDATE)         |
| L-43  | `OutboxRelay` sin `SELECT FOR UPDATE SKIP LOCKED`                   | MEDIUM   | FIX      | AUTO         | Composite con L-22                         |
| L-42  | `EventStore` referencia `EventSnapshots` no declarada               | —        | —        | —            | Deferido a B9                              |
| L-525 | `verifyWebhookSignature` fake ctx cast                              | QUICK    | REFACTOR | AUTO         | Framework-neutral signature verifier       |
| L-524 | `handleOAuthError` inconsistente con `sendError`                    | QUICK    | FIX      | AUTO         | Use `sendError` helper                     |
| L-496 | `throw new Error` useProviderConstraints                            | TRIVIAL  | FIX      | AUTO         | Result type                                |
| L-359 | `planPublication` drops thread silently                             | QUICK    | FIX      | AUTO         | Log warning + `ThreadingNotSupportedError` |

#### Subcategoría 6.2 — `any` eliminación y typing débil

| L-#   | Título corto                                                 | Esfuerzo | Acción | §5.9 | Notas                                 |
| ----- | ------------------------------------------------------------ | -------- | ------ | ---- | ------------------------------------- |
| L-216 | `addPostMedia` return `ApiResponse<any>` (client.ts L141)    | TRIVIAL  | FIX    | AUTO | Types en `types.ts`                   |
| L-217 | `createPostThread` return `ApiResponse<any>` (L149-156)      | TRIVIAL  | FIX    | AUTO |                                       |
| L-218 | `getPostThread` return `ApiResponse<any>` (L159)             | TRIVIAL  | FIX    | AUTO |                                       |
| L-219 | `getBestPostingTimes` return any (L286-295)                  | TRIVIAL  | FIX    | AUTO |                                       |
| L-220 | `getContentPerformance` return any (L298-311)                | TRIVIAL  | FIX    | AUTO |                                       |
| L-221 | `publishPost` return any (L334-345)                          | TRIVIAL  | FIX    | AUTO |                                       |
| L-222 | `schedulePost` return any (L348-356)                         | TRIVIAL  | FIX    | AUTO |                                       |
| L-223 | `cancelScheduledPost` return any (L359-363)                  | TRIVIAL  | FIX    | AUTO |                                       |
| L-224 | `uploadFile` `metadata?: any` (L369)                         | TRIVIAL  | FIX    | AUTO |                                       |
| L-225 | `generateContent` `metadata?: any` (L410)                    | TRIVIAL  | FIX    | AUTO |                                       |
| L-226 | `analyzeContent` `analysis: any` (L430)                      | TRIVIAL  | FIX    | AUTO |                                       |
| L-227 | `analyzeContent` inner score loose type (L430)               | TRIVIAL  | FIX    | AUTO |                                       |
| L-228 | `addPostMedia` media object loose typing                     | TRIVIAL  | FIX    | AUTO |                                       |
| L-229 | `ProviderHealth.details?: Record<string, any>` (types.ts:76) | TRIVIAL  | FIX    | AUTO |                                       |
| L-230 | `ApiResponse<T = any>` generic default                       | TRIVIAL  | FIX    | AUTO |                                       |
| L-231 | `ApiError.details?: any`                                     | TRIVIAL  | FIX    | AUTO |                                       |
| L-232 | `queryKeys.posts(filters?: any)`                             | TRIVIAL  | FIX    | AUTO |                                       |
| L-233 | `UseMutationOptions metadata?: any`                          | TRIVIAL  | FIX    | AUTO |                                       |
| L-234 | `Provider.config: Record<string, any>` (LEGACY)              | TRIVIAL  | FIX    | AUTO | Par con L-207 legacy consolidation    |
| L-235 | `onSave error?: any` (LEGACY useAutoSave)                    | TRIVIAL  | FIX    | AUTO |                                       |
| L-59  | `telemetry/initialization.ts` 3 any exported (workers)       | TRIVIAL  | FIX    | AUTO | Tipar con `Tracer \| MockTracer` etc. |
| L-508 | OTel 9 any leak                                              | MEDIUM   | FIX    | AUTO | Narrow types                          |
| L-514 | workers telemetry 3x any                                     | QUICK    | FIX    | AUTO | Narrow types                          |
| L-97  | `posts/page.tsx` raw fetch + 4x any                          | QUICK    | FIX    | AUTO | Migrate to usePosts TanStack          |
| L-333 | `usePosts` weak typing `unknown[]`                           | TRIVIAL  | FIX    | AUTO | Define `PostFilters` type             |
| L-103 | `actions/auth.ts` FormData `as string` cast                  | QUICK    | FIX    | AUTO | Zod validate                          |
| L-88  | `(user as Record<unknown>).accountId` hack ×8                | QUICK    | FIX    | AUTO | Fix AuthContext type                  |

#### Subcategoría 6.3 — `@file` / `@component` / JSDoc headers (composite L-298/L-388/L-527)

**Composite L-298/L-388/L-527 (resolved @layer, still ~130 files missing @file):** se trata como un único item de trabajo. Resolución: script que inserta stub `@file` headers en archivos que no lo tienen y los completa manualmente.

| L-#   | Título corto                                                 | Esfuerzo | Acción   | §5.9 | Notas                                                      |
| ----- | ------------------------------------------------------------ | -------- | -------- | ---- | ---------------------------------------------------------- |
| L-298 | `@layer` mismapping composite (~40 admin files)              | MEDIUM   | DOCUMENT | AUTO | @layer resolved en D0v4-8; quedan @file headers ~130 files |
| L-388 | `@file` composite 38 providers files                         | MEDIUM   | DOCUMENT | AUTO | Sub-composite de L-298; resolved junto                     |
| L-527 | 17 files missing `@file` observability/monitoring/api-common | QUICK    | DOCUMENT | AUTO | Sub-composite de L-298                                     |
| L-300 | Missing `@component` JSDoc (ErrorBoundary)                   | TRIVIAL  | DOCUMENT | AUTO |                                                            |
| L-301 | Missing `@component` JSDoc (SkipLink)                        | TRIVIAL  | DOCUMENT | AUTO |                                                            |
| L-302 | Missing `@component` JSDoc (VisuallyHidden)                  | TRIVIAL  | DOCUMENT | AUTO |                                                            |
| L-344 | `parseApiError.ts` `@layer presentation` mismapping          | TRIVIAL  | DOCUMENT | AUTO | Change to `infrastructure`                                 |

#### Subcategoría 6.4 — React/Frontend quality (admin + client)

| L-#       | Título corto                                                           | Esfuerzo | Acción   | §5.9         | Notas                                             |
| --------- | ---------------------------------------------------------------------- | -------- | -------- | ------------ | ------------------------------------------------- |
| L-70      | `app/providers.tsx` missing QueryCache/MutationCache (client)          | QUICK    | FIX      | AUTO         | Global error handlers                             |
| L-101     | QueryClient config staleTime 60s + retry:1 inconsistente               | QUICK    | CONFIG   | AUTO         | FRONTEND_STANDARDS §2.3                           |
| L-336     | `QueryProvider` replica L-70/L-101 (admin cross-app)                   | QUICK    | FIX      | AUTO         | Candidate `@packages/shared-frontend/queryClient` |
| L-260     | Missing per-mutation `onError` ~56/87 mutations                        | MEDIUM   | FIX      | AUTO         | Root cause L-70/L-336                             |
| L-260-ext | Coverage gap composite (seed + vitest.base)                            | —        | —        | —            | Resolved via B3 (L-599) + B2 (L-560)              |
| L-110     | `error.tsx` uses console.error                                         | TRIVIAL  | FIX      | AUTO         | Replace con logger port                           |
| L-109     | `error.tsx` + `global-error.tsx` missing ARIA roles                    | TRIVIAL  | FIX      | AUTO         | a11y                                              |
| L-270     | `loading.tsx` index-as-key antipattern                                 | TRIVIAL  | FIX      | AUTO         | Stable keys                                       |
| L-271     | `error.tsx` exposes error.message (security)                           | QUICK    | FIX      | AUTO         | Sanitize                                          |
| L-272     | proxy route buffers full body                                          | MEDIUM   | REFACTOR | NEEDS_EDWARD | Stream uploads                                    |
| L-273     | dashboard layout 2-hop redirect chain                                  | MEDIUM   | REFACTOR | NEEDS_EDWARD | Consolidar post-L-267                             |
| L-268     | `announcements/page.tsx` triple violation                              | MEDIUM   | REFACTOR | AUTO         | Hook + TanStack + i18n                            |
| L-269     | Admin metadata gap 0/17 dashboard pages                                | QUICK    | CONFIG   | AUTO         | SEO minor                                         |
| L-303     | `ErrorBoundary` console.error                                          | TRIVIAL  | FIX      | AUTO         | Logger port                                       |
| L-304     | `ErrorBoundary` raw error.message (security, replica L-271)            | TRIVIAL  | FIX      | AUTO         | Sanitize                                          |
| L-305     | `SidebarNav` document.cookie + window.location.reload                  | QUICK    | REFACTOR | AUTO         | NextAuth signOut / Server Action                  |
| L-306     | silent catch composite (6 components)                                  | QUICK    | FIX      | AUTO         | Logger + toast.error                              |
| L-307     | Missing `htmlFor` a11y composite (6 components)                        | QUICK    | FIX      | AUTO         | useId()                                           |
| L-297     | default export violation (MfaManager + RbacManager)                    | TRIVIAL  | REFACTOR | AUTO         |                                                   |
| L-345     | `AuthProvider` raw fetch + dual envelope + silent SUPER_ADMIN fallback | QUICK    | FIX      | NEEDS_EDWARD | security + raw fetch                              |
| L-328     | `useUsageMetrics` sin credentials (security)                           | TRIVIAL  | FIX      | AUTO         |                                                   |
| L-329     | `useCompliance` 3 fetches sin credentials (security)                   | TRIVIAL  | FIX      | AUTO         |                                                   |
| L-330     | `useAdminPasswordReset` totalmente silencioso                          | QUICK    | FIX      | AUTO         | Add error handling                                |
| L-331     | `useAnalytics.fetchJSON` error silencing                               | TRIVIAL  | FIX      | AUTO         | Let errors propagate                              |
| L-332     | `apiClient` vs raw fetch inconsistency                                 | MEDIUM   | REFACTOR | AUTO         | Normalize to useSecurity reference                |
| L-334     | `useSecurity` queries serializadas (podrían paralelas)                 | TRIVIAL  | FIX      | AUTO         | Remove enabled cadena                             |
| L-206     | `useInbox.markMessageRead` silent failure + no invalidation            | QUICK    | FIX      | AUTO         |                                                   |
| L-209     | Error handling `ApiError` vs plain Error                               | QUICK    | REFACTOR | AUTO         | authApi usa ApiError                              |
| L-261     | Path inconsistency hooks/api/ (3 fetches sin /backend/)                | TRIVIAL  | FIX      | AUTO         | cross-ref L-262/L-264                             |
| L-262     | `useChannels.disconnectChannel` path inconsistency                     | —        | —        | —            | dup L-261                                         |
| L-264     | `useBilling.useMyInvoices` path inconsistency                          | —        | —        | —            | dup L-261                                         |
| L-100     | `ProjectProvider` raw fetch + stub + window.reload                     | MEDIUM   | REFACTOR | AUTO         | Client provider                                   |
| L-98      | posts/[id] alert() + LEGACY hook imports                               | QUICK    | FIX      | AUTO         | toast + canonical                                 |
| L-263     | `lib/api/index.ts` rename undocumented                                 | TRIVIAL  | DOCUMENT | AUTO         |                                                   |
| L-503     | `useContentEditor` exhaustive-deps suppression                         | QUICK    | FIX      | AUTO         | Fix deps                                          |
| L-500     | progress.tsx missing aria-valuenow                                     | TRIVIAL  | FIX      | AUTO         |                                                   |
| L-501     | separator.tsx missing role                                             | TRIVIAL  | FIX      | AUTO         |                                                   |
| L-437     | bluesky import after export                                            | TRIVIAL  | FIX      | AUTO         |                                                   |
| L-439     | `@providers/instagram` raw pino                                        | QUICK    | REFACTOR | AUTO         | LoggerPort                                        |
| L-361     | Shadowed logger variable                                               | TRIVIAL  | FIX      | AUTO         |                                                   |
| L-491     | Design token drift (9 UI files)                                        | QUICK    | FIX      | AUTO         | Tailwind tokens                                   |
| L-492     | `formatVersionDate` en-US lock                                         | TRIVIAL  | FIX      | AUTO         | User locale                                       |
| L-495     | `console.error` VirtualScrollList                                      | TRIVIAL  | FIX      | AUTO         | Logger port (depends L-347)                       |
| L-347     | `lib/logger.ts` console-based (cross-app admin/client)                 | QUICK    | FIX      | AUTO         | Extract browser logger package                    |
| L-84      | Notifications target `/admin/*` en client app                          | QUICK    | FIX      | AUTO         | NotificationItem/Bell path                        |
| L-117     | AnnouncementBanner uses /api/... (no /backend/)                        | TRIVIAL  | DOCUMENT | AUTO         | Public path — document intent                     |
| L-92      | RecurringPostForm raw fetch + orphan path                              | QUICK    | FIX      | AUTO         |                                                   |
| L-93      | scheduling/page.tsx raw fetches + prompt/alert                         | MEDIUM   | REFACTOR | AUTO         | TanStack + toast + modal                          |
| L-90      | MultiPlatformSchedulerRefactored dead Edit + raw fetches               | QUICK    | REFACTOR | AUTO         |                                                   |
| L-91      | MultiPlatformSchedulerRefactored orphan "Refactored" suffix            | TRIVIAL  | REFACTOR | AUTO         | Rename                                            |
| L-213     | `mapApiTemplate` estimatedEngagement 75 hardcoded (fake-AI)            | TRIVIAL  | FIX      | AUTO         | Remove                                            |
| L-259     | 97 raw fetch inside hooks/api/                                         | MEDIUM   | REFACTOR | AUTO         | Requiere apiClient extendido (post-L-212)         |
| L-211     | `lib/api/providers.ts` misleading filename                             | TRIVIAL  | FIX      | AUTO         | Rename                                            |
| L-210     | Naming conflict `useProviders` en lib/api/\*                           | QUICK    | FIX      | AUTO         | Cross-ref L-207                                   |
| L-86      | 3 useProviders hooks paralelos (client)                                | MEDIUM   | REFACTOR | AUTO         | Consolidar; resolved en L-207                     |
| L-207     | useProviders 4 paths paralelos (upgrade L-86)                          | MEDIUM   | REFACTOR | AUTO         | Consolidar cluster                                |
| L-208     | Auth 3 paths paralelos (upgrade L-69)                                  | MEDIUM   | REFACTOR | AUTO         | Server Action → authApi                           |
| L-69      | Dual auth path con TTLs cookie inconsistentes                          | MEDIUM   | FIX      | AUTO         | Absorbed en L-208                                 |
| L-214     | State hooks cadena a LEGACY (composite L-99)                           | QUICK    | REFACTOR | AUTO         | Resolved with L-99                                |
| L-99      | TemplateManagementDashboard LEGACY hooks broken URLs                   | QUICK    | FIX      | AUTO         | Fix URLs                                          |
| L-215     | `useCheckout`/`useBillingPortal` window.location.href                  | TRIVIAL  | FIX      | AUTO         | .replace                                          |
| L-104     | actions/auth.ts name parsing bug firstName/lastName                    | TRIVIAL  | FIX      | AUTO         | Separate inputs                                   |
| L-113     | Language mix Spanish/English sin i18n                                  | HEAVY    | REFACTOR | NEEDS_EDWARD | i18n decision                                     |
| L-296     | i18n drift composite admin (17 components)                             | HEAVY    | REFACTOR | NEEDS_EDWARD | Cross-ref L-113                                   |
| L-470     | i18n drift UI individuales (13 components, L-470..L-482)               | HEAVY    | REFACTOR | NEEDS_EDWARD | UI layer i18n                                     |
| L-471     | i18n UI individual                                                     | —        | —        | —            | Absorbed L-470                                    |
| L-472     | i18n UI individual                                                     | —        | —        | —            | Absorbed L-470                                    |
| L-473     | i18n UI individual                                                     | —        | —        | —            | Absorbed L-470                                    |
| L-474     | i18n UI individual                                                     | —        | —        | —            | Absorbed L-470                                    |
| L-475     | i18n UI individual                                                     | —        | —        | —            | Absorbed L-470                                    |
| L-476     | i18n UI individual                                                     | —        | —        | —            | Absorbed L-470                                    |
| L-477     | i18n UI individual                                                     | —        | —        | —            | Absorbed L-470                                    |
| L-478     | i18n UI individual                                                     | —        | —        | —            | Absorbed L-470                                    |
| L-479     | i18n UI individual                                                     | —        | —        | —            | Absorbed L-470                                    |
| L-480     | i18n UI individual                                                     | —        | —        | —            | Absorbed L-470                                    |
| L-481     | i18n UI individual                                                     | —        | —        | —            | Absorbed L-470                                    |
| L-482     | i18n UI individual                                                     | —        | —        | —            | Absorbed L-470                                    |

#### Subcategoría 6.5 — Fake-AI / Fake-data honesty (UI layer)

| L-#   | Título corto                                       | Esfuerzo | Acción | §5.9 | Notas                     |
| ----- | -------------------------------------------------- | -------- | ------ | ---- | ------------------------- |
| L-78  | SchedulePicker "optimal times" hardcoded           | QUICK    | FIX    | AUTO | Remove label o wire real  |
| L-79  | `generateRecommendations` "AI" label hardcoded     | QUICK    | FIX    | AUTO | Rename "Smart" or wire ML |
| L-80  | SmartContentOptimizer hashtag scoring por index    | QUICK    | FIX    | AUTO | Remove fabricated         |
| L-81  | ai-content-templates estimatedEngagement hardcoded | QUICK    | FIX    | AUTO | Remove field              |
| L-82  | usePredictiveData hardcoded fallbacks              | MEDIUM   | FIX    | AUTO | Empty states              |
| L-83  | AIContentGenerator "Powered by GPT-4" hardcoded    | TRIVIAL  | FIX    | AUTO | Fetch current provider    |
| L-105 | AIImageGenerator "DALL-E 3" hardcoded docstring    | TRIVIAL  | FIX    | AUTO | Generalize                |
| L-106 | AIGenerationPreview fake progress steps            | TRIVIAL  | FIX    | AUTO | Simplify                  |
| L-111 | PublishingInterface estimatedTime hardcoded        | TRIVIAL  | FIX    | AUTO | Remove                    |
| L-112 | PublishingInterface rateLimit threshold hardcoded  | TRIVIAL  | FIX    | AUTO | Config                    |
| L-325 | `useAnalytics` fake-data composite (6 fields)      | MEDIUM   | FIX    | AUTO | Implement real metrics    |
| L-326 | `useBillingStats` grandfatheredRevenue:0 hardcoded | TRIVIAL  | FIX    | AUTO | Real aggregation          |
| L-293 | `ScheduledJobsPanel` fake-persistence cron         | MEDIUM   | FIX    | AUTO | Wire backend              |
| L-77  | `useContentLibraryState` stub — always empty       | QUICK    | FIX    | AUTO | Wire real API             |
| L-89  | ContentLibrary DEFAULT_FILTER_OPTIONS fake         | QUICK    | FIX    | AUTO | Derive from real          |

#### Subcategoría 6.6 — Silent-NO-OP UI (cross-ref backend handlers)

Resueltos cuando su backend counterpart se arregle (B5/B8); entran aquí solo para trazabilidad y UI adjustments.

| L-#   | Título corto                                  | Esfuerzo | Acción | §5.9 | Notas (cross-ref)                      |
| ----- | --------------------------------------------- | -------- | ------ | ---- | -------------------------------------- |
| L-71  | SILENT-NO-OP billing gateway switch           | QUICK    | FIX    | AUTO | Resolved when L-62 fixed (B8)          |
| L-72  | SILENT-NO-OP publish/schedule UI compound     | QUICK    | FIX    | AUTO | Resolved when L-52+L-64 fixed (B5)     |
| L-73  | SILENT-NO-OP analytics empty params           | QUICK    | FIX    | AUTO | Fix insights page params               |
| L-74  | SILENT-NO-OP inbox                            | QUICK    | FIX    | AUTO | Resolved when L-55+L-61 fixed (B5/B10) |
| L-75  | SILENT-NO-OP repurpose                        | QUICK    | FIX    | AUTO | Resolved when L-61 fixed (B10)         |
| L-76  | SILENT-NO-OP outgoing webhooks                | QUICK    | FIX    | AUTO | Resolved when L-44 fixed (B5/B11)      |
| L-205 | `useAutoSave` stub — drafts solo localStorage | QUICK    | FIX    | AUTO | Wire real backend                      |
| L-85  | ClientContentEditor handleSchedule stub       | QUICK    | FIX    | AUTO | Wire useSchedulePost                   |

#### Subcategoría 6.7 — Dead buttons / stub callbacks

| L-#   | Título corto                                         | Esfuerzo | Acción    | §5.9         | Notas              |
| ----- | ---------------------------------------------------- | -------- | --------- | ------------ | ------------------ |
| L-87  | Instagram stories 4 callbacks "Coming soon"          | MEDIUM   | IMPLEMENT | NEEDS_EDWARD | Wire o hide        |
| L-94  | channels OAuth connect dead for 10/11 providers      | HEAVY    | IMPLEMENT | NEEDS_EDWARD | OAuth flow         |
| L-95  | channels Test/Settings disabled "Coming soon"        | QUICK    | DECIDE    | NEEDS_EDWARD | Implement o remove |
| L-96  | Instagram Create Stories/Reels/Carousel dead buttons | QUICK    | IMPLEMENT | NEEDS_EDWARD | Router integration |
| L-299 | `retry-all` DLQ endpoint unimplemented backend       | MEDIUM   | IMPLEMENT | NEEDS_EDWARD | Backend + UI       |

#### Subcategoría 6.8 — Over-clientization (client pages)

| L-#   | Título corto                                           | Esfuerzo | Acción   | §5.9 | Notas                              |
| ----- | ------------------------------------------------------ | -------- | -------- | ---- | ---------------------------------- |
| L-123 | integrations/page.tsx over-clientized                  | TRIVIAL  | REFACTOR | AUTO | Remove "use client"                |
| L-124 | settings/integrations/page.tsx over-clientized + TODO  | TRIVIAL  | REFACTOR | AUTO |                                    |
| L-125 | settings/crm/page.tsx over-clientized                  | TRIVIAL  | REFACTOR | AUTO |                                    |
| L-126 | settings/sso/page.tsx over-clientized                  | TRIVIAL  | REFACTOR | AUTO |                                    |
| L-127 | content/library/page.tsx over-clientized               | TRIVIAL  | REFACTOR | AUTO |                                    |
| L-128 | content/templates/page.tsx over-clientized             | TRIVIAL  | REFACTOR | AUTO |                                    |
| L-129 | instagram/stories/page.tsx over-clientized             | TRIVIAL  | REFACTOR | AUTO | Depends L-87                       |
| L-130 | analytics/insights/page.tsx over-clientized            | TRIVIAL  | REFACTOR | AUTO | Depends L-73                       |
| L-131 | ai/analytics/page.tsx over-clientized                  | TRIVIAL  | REFACTOR | AUTO |                                    |
| L-132 | ai/generate/page.tsx over-clientized                   | TRIVIAL  | REFACTOR | AUTO |                                    |
| L-133 | ai/optimizer/page.tsx over-clientized                  | TRIVIAL  | REFACTOR | AUTO |                                    |
| L-134 | reports/shared/[token]/page.tsx public over-clientized | QUICK    | REFACTOR | AUTO | Biggest SEO impact — SC + Suspense |

#### Subcategoría 6.9 — Size violations R11 (composite batch-level)

Los size violations son decisiones Edward caso-por-caso — no todos requieren split. Entran al batch pero la cadencia es: revisar cluster en una pasada única, Edward elige cuáles split y cuáles "accept over-limit con justificación en ADR". Los archivos muertos/orphan (L-141/L-143/L-147/L-156/L-162/L-169 → L-68) se resuelven al resolver L-68 en B2.

| L-#          | Título corto                                              | Esfuerzo | Acción   | §5.9         | Notas                                                                                                         |
| ------------ | --------------------------------------------------------- | -------- | -------- | ------------ | ------------------------------------------------------------------------------------------------------------- |
| L-68         | Publishing subsystem DEAD_CODE ~2,711 LOC                 | HEAVY    | DELETE   | NEEDS_EDWARD | Cluster unifica L-141/L-143/L-147/L-156/L-162/L-169 — decide unified                                          |
| L-102        | Ai subsystem size violations (5+ componentes >400 LOC)    | MEDIUM   | REFACTOR | NEEDS_EDWARD | Revisar cluster                                                                                               |
| L-135..L-204 | client size violations (70 archivos individuales)         | HEAVY    | REFACTOR | NEEDS_EDWARD | Tabla composite §D0v4-4; Edward decide per-archivo                                                            |
| L-236..L-258 | client hooks size violations R11 (23 files)               | MEDIUM   | REFACTOR | NEEDS_EDWARD | Tabla composite §D0v4-5; Edward decide per-archivo                                                            |
| L-274..L-292 | admin components R11 (19 files)                           | HEAVY    | REFACTOR | NEEDS_EDWARD | Tabla composite §D0v4-6                                                                                       |
| L-310        | `useCompliance.ts` 635 LOC mega-aggregator                | HEAVY    | REFACTOR | AUTO         | Split granular hooks                                                                                          |
| L-311        | `usePricingTiers.ts` 305 LOC                              | MEDIUM   | REFACTOR | AUTO         | Split account vs provider                                                                                     |
| L-312        | `useGatewaySwitches.ts` 216 LOC                           | QUICK    | REFACTOR | AUTO         |                                                                                                               |
| L-313        | `useSettings.ts` 179 LOC                                  | QUICK    | REFACTOR | AUTO         |                                                                                                               |
| L-314        | `useAdminUsers.ts` 172 LOC                                | QUICK    | REFACTOR | AUTO         | Split query vs mutations                                                                                      |
| L-315        | `useAnalytics.ts` 166 LOC                                 | QUICK    | REFACTOR | AUTO         | Composite con L-325/L-331                                                                                     |
| L-316        | `useMultiPlatformScheduling.ts` 159 LOC                   | —        | —        | —            | Dup L-320 (B2 decide DELETE)                                                                                  |
| L-337        | `apiClient.ts` 464 LOC admin R11 + coverage inconsistency | HEAVY    | REFACTOR | AUTO         | Split per namespace                                                                                           |
| L-456        | `useContentEditor` 492 LOC (packages/ui)                  | MEDIUM   | REFACTOR | AUTO         |                                                                                                               |
| L-457        | VirtualScrollList 405 LOC                                 | MEDIUM   | REFACTOR | AUTO         |                                                                                                               |
| L-458        | ContentEditorCore 393 LOC                                 | MEDIUM   | REFACTOR | AUTO         |                                                                                                               |
| L-459..L-469 | 11 UI files R11                                           | MEDIUM   | REFACTOR | AUTO         | Algunos en editor chain dead (B2 first)                                                                       |
| L-394..L-436 | 43 providers R11 lenient                                  | HEAVY    | REFACTOR | AUTO         | Split helpers per file                                                                                        |
| L-57         | `publishHandler.ts` God handler 629 LOC                   | MEDIUM   | REFACTOR | AUTO         | Split Orchestrator/SinglePostPublisher/ThreadPostPublisher/SagaNotifier/PublishMetrics; se puede diferir a B7 |
| L-266        | `useAIContentGenerator` composite complexity              | QUICK    | REFACTOR | AUTO         | Post L-213/R11                                                                                                |

#### Subcategoría 6.10 — Misc quality

| L-#          | Título corto                                      | Esfuerzo | Acción    | §5.9         | Notas                                                         |
| ------------ | ------------------------------------------------- | -------- | --------- | ------------ | ------------------------------------------------------------- |
| L-58         | High cardinality Prometheus labels (channel_id)   | QUICK    | FIX       | AUTO         | Label audit                                                   |
| L-60         | Provider registry drift — 11 vs 10 workers        | QUICK    | FIX       | AUTO         | Shared `@providers/shared/providerRegistry` (cross B10)       |
| L-107        | providerMapper hardcoded DEFAULT_LIMITS missing 7 | QUICK    | FIX       | AUTO         | Fetch del backend                                             |
| L-108        | providerMapper `authType: "oauth"` hardcoded      | TRIVIAL  | FIX       | AUTO         | Map per provider                                              |
| L-116        | TemplateSelector uses postTemplates static        | QUICK    | REFACTOR  | NEEDS_EDWARD | Consolidar a API-driven                                       |
| L-118        | Recharts only in analytics (bundle weight)        | QUICK    | FIX       | AUTO         | Dynamic import                                                |
| L-114        | dashboard/layout.tsx "Settings" hardcoded         | TRIVIAL  | FIX       | AUTO         |                                                               |
| L-115        | dashboard/layout.tsx "AI Settings" separate       | QUICK    | DECIDE    | NEEDS_EDWARD | IA review                                                     |
| L-509        | OTel fs instrumentation doubled                   | QUICK    | FIX       | AUTO         | De-dup                                                        |
| L-512        | `ContextPropagation` span leak                    | QUICK    | FIX       | AUTO         | Use finally                                                   |
| L-513        | `PublishingInstrumentation` span name drift       | QUICK    | FIX       | AUTO         | Align semantic conventions                                    |
| L-515        | `DatabaseHealthChecker` `listAccounts` probe      | TRIVIAL  | FIX       | AUTO         | SELECT 1                                                      |
| L-516        | `StorageHealthChecker` SigV4 generation           | QUICK    | FIX       | AUTO         | Head request                                                  |
| L-518        | `tenantHealth.ts` `channels[]` hardcoded          | QUICK    | FIX       | AUTO         | Query real                                                    |
| L-519        | `tenantHealth.ts` tenant_id="system" label        | TRIVIAL  | FIX       | AUTO         |                                                               |
| L-520        | `types.ts` duplicate re-exports                   | TRIVIAL  | FIX       | AUTO         | Consolidate                                                   |
| L-523        | `QueueHealthChecker` misfiled `redis.ts`          | TRIVIAL  | FIX       | AUTO         | Move a queue.ts                                               |
| L-526        | admin CSV exports bypass safe util (security)     | QUICK    | FIX       | AUTO         | Force csvSanitize                                             |
| L-497        | a11y gaps business components                     | MEDIUM   | FIX       | AUTO         | Audit pass                                                    |
| L-499        | tabs.tsx reimplementa Radix                       | QUICK    | REFACTOR  | AUTO         | Use Radix                                                     |
| L-504        | Tailwind safelist missing client (build risk)     | QUICK    | CONFIG    | AUTO         | Add safelist — puede escalarse a B0 si se detecta build break |
| L-505        | Tailwind safelist duplication candidate           | TRIVIAL  | REFACTOR  | AUTO         | Extract shared                                                |
| L-353        | `ProviderId` DUP_TYPE_IDENTICAL                   | TRIVIAL  | REFACTOR  | AUTO         | Re-export                                                     |
| L-354        | `ProviderName` NAMING_COLLISION type vs value     | QUICK    | REFACTOR  | AUTO         | Rename const                                                  |
| L-355        | I-prefix Crm/Payment interfaces                   | TRIVIAL  | REFACTOR  | AUTO         |                                                               |
| L-360        | Template types dup                                | QUICK    | REFACTOR  | AUTO         | Consolidate ports/shared                                      |
| L-358        | grab-bag files shared/src/                        | QUICK    | REFACTOR  | AUTO         | Split sub-barrels                                             |
| L-356        | `@core/threading` alias drift                     | TRIVIAL  | REFACTOR  | AUTO         | Normalize                                                     |
| L-379        | Missing exports in sub-barrels                    | QUICK    | REFACTOR  | AUTO         |                                                               |
| L-387        | Relative path threadPlanner                       | TRIVIAL  | REFACTOR  | AUTO         | Use alias                                                     |
| L-389        | `_template` provider deprecated pattern           | TRIVIAL  | REFACTOR  | AUTO         | Update template                                               |
| L-390        | tiktok axios version drift                        | TRIVIAL  | CONFIG    | AUTO         |                                                               |
| L-391        | telegram missing logger dep                       | TRIVIAL  | CONFIG    | AUTO         |                                                               |
| L-392        | `@providers/shared` `@types/node` drift           | TRIVIAL  | CONFIG    | AUTO         |                                                               |
| L-393        | tiktok missing devDeps                            | TRIVIAL  | CONFIG    | AUTO         |                                                               |
| L-372        | `@adapters/db-prisma` missing typed export        | TRIVIAL  | FIX       | AUTO         |                                                               |
| L-373        | Storage 0.0.x version placeholders (3 pkgs)       | TRIVIAL  | CONFIG    | AUTO         | Versioning policy                                             |
| L-374        | opossum version drift (sub-finding L-368)         | —        | —         | —            | Absorbed L-368 (B10)                                          |
| L-376        | queue-bullmq test mocks                           | QUICK    | FIX       | AUTO         | Update mocks post-L-363                                       |
| L-380        | queue-bullmq `concurrency` ignored                | —        | —         | —            | Absorbed L-363 (B10)                                          |
| L-381        | cache-redis missing health check                  | QUICK    | IMPLEMENT | AUTO         |                                                               |
| L-383        | queue-bullmq DLQ wiring no official               | QUICK    | REFACTOR  | AUTO         | Formalize DLQ port                                            |
| L-441        | apiClient boilerplate 11-way consolidation        | HEAVY    | REFACTOR  | AUTO         | Cross-ref L-14/L-386 (B10)                                    |
| L-438        | shared re-export dup a types                      | TRIVIAL  | REFACTOR  | AUTO         | Consolidate                                                   |
| L-212        | `lib/api/client.ts` 440 LOC god file              | MEDIUM   | REFACTOR  | AUTO         | Split per domain                                              |
| L-237        | client.ts 440 LOC (dup L-212)                     | —        | —         | —            | Dup L-212                                                     |
| L-238..L-258 | client R11 hooks (23 files)                       | MEDIUM   | REFACTOR  | AUTO         | Tabla composite; Edward per-archivo                           |
| L-244        | authApi.ts 258 LOC                                | QUICK    | REFACTOR  | AUTO         |                                                               |
| L-257        | useTeam 159 LOC                                   | TRIVIAL  | REFACTOR  | AUTO         |                                                               |
| L-258        | usePerformanceInsights 152 LOC                    | TRIVIAL  | REFACTOR  | AUTO         |                                                               |
| L-256        | useAIContentGenerator 163 LOC                     | TRIVIAL  | REFACTOR  | AUTO         | Post L-213                                                    |

**Orden de ejecución sugerido (2–3 días):**

1. **Día 1 — Cosmic cleanup (automatizable via scripts):**
   - Run ESLint autofix sobre toda la base post-B3.
   - Script para insertar stub `@file` headers → completar manualmente (~2h para 130 files).
   - `any` → types fixes (subcategoría 6.2 — ~27 findings, mayoría TRIVIAL).
2. **Día 2 — Domain/App core fixes:**
   - Subcategoría 6.1 (Repository, VO, UoW, hexagonal).
   - Subcategoría 6.3 (JSDoc headers final).
   - Subcategoría 6.4 (React quality — QueryCache, onError, credentials, a11y).
3. **Día 3 — Fake-AI honesty + Silent NO-OPs + Over-clientization + misc:**
   - Subcategoría 6.5 (fake-AI): simple label changes.
   - Subcategoría 6.6 (trazabilidad resolved by backend batches).
   - Subcategoría 6.7 (dead buttons): decidir wire/remove.
   - Subcategoría 6.8 (over-clientization): remove `use client`.
   - Subcategoría 6.10 (misc).
4. **(Separar) Size violations R11 (sub 6.9):** diferibles a B7 como refactors localizados. Edward decide si cuenta como parte de B6 o separado.

**Notas.** B6 es el batch con más findings del documento (205) pero también el más automatizable. Muchos son 1-line fixes o scripts batch. El reto real es la cadencia: al cerrar B6 los 10 greps CLAUDE.md deben dar `[0,0,0,0,0,0,0,0,0,0]`.

---

### §5.7 — B7 Refactors localizados

**Scope.** Splits de God files (>800 LOC user nonnegotiable) + fixes puntuales de services críticos. Cada item es un refactor aislado, sin riesgo cross-package.

**Entry criteria.** B4 cerrado (DI consistency — splits resuelven deps via factory).

**Exit criteria:**

```bash
# 1. Ningún archivo >800 LOC
find apps/ packages/ -name "*.ts" -not -path "*/node_modules/*" -exec wc -l {} + | awk '$1>800' | wc -l   # → 0

# 2. GatewayBillingService split
ls apps/api/src/billing/ | grep -c Service   # → ≥3 (orig 1042 LOC splittado)

# 3. webhookDashboardService performance
#    Timeline query < 10 DB calls (era 72 N+1)

# 4. SyncProviderCommentsUseCase con API call fuera de UoW
grep -n "executeInTransaction" apps/api/src/application/inbox/SyncProviderCommentsUseCase.ts   # → external calls NO envueltas
```

**Findings table (12):**

| L-#       | Título corto                                                            | Esfuerzo | Acción   | §5.9         | Archivos / Notas                                                                              |
| --------- | ----------------------------------------------------------------------- | -------- | -------- | ------------ | --------------------------------------------------------------------------------------------- |
| L-34      | `index.ts` 688 LOC split                                                | MEDIUM   | REFACTOR | AUTO         | `bootstrap.ts`, `routes.ts`, `middlewareChain.ts`, `shutdown.ts`                              |
| L-6       | `GatewayBillingService` 1042 LOC + fake eventId (SAFETY_CRITICAL)       | HEAVY    | REFACTOR | AUTO         | Split + fix L732 idempotency; cross-ref B8                                                    |
| L-7       | `webhookDashboardService` 854 LOC N+1 + retry queue stub                | HEAVY    | REFACTOR | AUTO         | Timeline query optimization + implement retry queue real                                      |
| L-16      | `SyncProviderCommentsUseCase` provider API dentro UoW (SAFETY_CRITICAL) | QUICK    | FIX      | AUTO         | Mover fetch fuera de UoW                                                                      |
| L-11      | content/ SyncEngineImpl vs ConflictDetector duplication                 | MEDIUM   | REFACTOR | NEEDS_EDWARD | Delegar a ConflictDetector + SyncScheduler                                                    |
| L-1       | MFA duality OLD vs NEW migration                                        | HEAVY    | REFACTOR | NEEDS_EDWARD | Edward CP3 aprobado: NEW + data migration SHA→argon2                                          |
| L-57      | `publishHandler.ts` God handler 629 LOC                                 | MEDIUM   | REFACTOR | AUTO         | Split PublishOrchestrator/SinglePostPublisher/ThreadPostPublisher/SagaNotifier/PublishMetrics |
| L-212     | `lib/api/client.ts` 440 LOC god file                                    | MEDIUM   | REFACTOR | AUTO         | Puede haberse hecho en B6; aquí si lo difiere Edward                                          |
| L-337     | `apiClient.ts` admin 464 LOC split per namespace                        | MEDIUM   | REFACTOR | AUTO         | idem                                                                                          |
| L-310     | `useCompliance.ts` 635 LOC mega-aggregator                              | HEAVY    | REFACTOR | AUTO         | Split en 5 hooks granulares                                                                   |
| L-141     | UnifiedPublishingDashboard 620 LOC DEAD                                 | —        | —        | —            | Resolved en B2 L-68                                                                           |
| L-310-ext | Related mega hooks client side (useBilling, useInbox, etc.)             | MEDIUM   | REFACTOR | AUTO         | Incluido en cluster B6 6.9 — Edward decide aquí o allá                                        |

**Orden de ejecución sugerido (3–5 días):**

1. **Día 1 — Billing safety:** L-6 (GatewayBillingService split + fake eventId fix). Coordina con B8.
2. **Día 2 — Webhook performance:** L-7 (N+1 + retry queue real).
3. **Día 3 — Bootstrap split:** L-34 (index.ts), L-57 (publishHandler).
4. **Día 4 — UoW hygiene:** L-16 (SyncProviderComments fetch fuera UoW), L-11 (content/ delegación).
5. **Día 5 — MFA + client splits:** L-1 (MFA migration), L-212/L-337 (client.ts splits si no se hizo en B6), L-310.

**Notas.** B7 produce muchos archivos nuevos — pre-B7 tener B4 DI sólido evita que cada split obligue a re-tocar Container.

---

### §5.8 — B8 Billing/Financial Precision

**Scope.** Todo lo que toca dinero: Invoice Float→Decimal, RBAC double SoT, seed separations, GatewayBillingService idempotency. SAFETY_CRITICAL sin excepciones.

**Entry criteria.** B0 cerrado (secrets rotados, ADMIN_PASSWORD ok) — L-546 ya resuelto en B0.

**Exit criteria:**

```bash
# 1. Invoice.amount es Decimal
grep -n "amount.*Float" infra/prisma/schema.prisma   # → 0 (except non-money floats)

# 2. RBAC SoT único
grep -rn "SUPER_ADMIN.*permissions" infra/prisma/seed.ts | wc -l   # → 0 (importa desde shared/rbac)

# 3. Seed split bootstrap vs demo
ls infra/prisma/seed-*.ts | wc -l   # → ≥2

# 4. GatewayBillingService fake eventId fix (cross-ref B7 L-6)
grep -n "generateEventId\|fakeEventId" apps/api/src/billing/   # → 0

# 5. Test integración cobro con edge-case centavos pasa
pnpm --filter @apps/api test:integration -- billing
```

**Findings table (8 — todos SAFETY_CRITICAL):**

| L-#         | Título corto                                                             | Esfuerzo | Acción    | §5.9         | Archivos / Notas                                                                                                |
| ----------- | ------------------------------------------------------------------------ | -------- | --------- | ------------ | --------------------------------------------------------------------------------------------------------------- |
| L-538       | Invoice `amount: Float` billing precision (CRITICAL)                     | HEAVY    | REFACTOR  | AUTO         | Migrar a `Decimal @db.Decimal(19,4)` + data migration                                                           |
| L-545       | RBAC SUPER_ADMIN double source of truth (CRITICAL)                       | MEDIUM   | REFACTOR  | NEEDS_EDWARD | Single SoT en `@shared/rbac/roles.ts`                                                                           |
| L-547       | seed-mixing composition (bootstrap + test + demo)                        | MEDIUM   | REFACTOR  | NEEDS_EDWARD | Split + NODE_ENV gates; absorbe L-548                                                                           |
| L-551       | test accounts un-gated                                                   | QUICK    | FIX       | AUTO         | Gate                                                                                                            |
| L-549       | `dev-x` pattern replace                                                  | QUICK    | REFACTOR  | AUTO         | Factory `createTestUser({ suffix })`                                                                            |
| L-552       | `console.log` en seed.ts                                                 | TRIVIAL  | FIX       | AUTO         | Inject logger                                                                                                   |
| L-62        | `GATEWAY_SWITCH` queue publisher activo pero consumer missing (CRITICAL) | MEDIUM   | IMPLEMENT | AUTO         | Crear `gatewaySwitchWorker.ts` + UCs `ProcessGatewaySwitchReminderUseCase`/`ProcessGatewaySwitchSuspendUseCase` |
| L-6-billing | GatewayBillingService fake eventId (cross-ref B7)                        | —        | —         | —            | Resolved when L-6 fixed in B7                                                                                   |

**Orden de ejecución sugerido (3 días):**

1. **Día 1 — Invoice Decimal migration:** L-538 (plan migration + data backfill script + dry-run + apply).
2. **Día 2 — RBAC + Seeds:** L-545 (single SoT), L-547 (split seed scripts), L-549/L-551/L-552 (minor cleanups).
3. **Día 3 — Gateway switch consumer:** L-62 (crear worker + UCs); L-6 (billing context del split B7).

**Notas.** L-538 es el fix más delicado — precision loss retrospectivo podría afectar invoices existentes. Data migration script con audit trail obligatorio.

---

### §5.9 — B9 EventStore + Saga + CQRS

**Scope.** El trío que D0v4-2/D0v4-3/D0v4-7 identificó como "arquitectura incompleta": EventStore schema divergence, EventSnapshots orphan, sagaCQRSBus vacío con runtime risk confirmado, CQRS handlers wired o documentados.

**Entry criteria.** B4 cerrado (EventService con token DI consistente).

**Exit criteria:**

```bash
# 1. stored_events en Prisma schema
grep -n "model.*stored_events\|StoredEvent" infra/prisma/schema.prisma   # → ≥1

# 2. EventStore.initialize sin raw CREATE TABLE
grep -n "CREATE TABLE" apps/api/src/events/EventStore.ts   # → 0

# 3. EventSnapshots decisión
#    (IMPLEMENT → modelo declarado en schema OR DELETE → methods removidos)

# 4. sagaCQRSBus wired
grep -n "registerHandler" apps/api/src/saga/SagaIntegration.ts   # → ≥1

# 5. jobStatusChecker real (no stub optimistic)
grep -A2 "getJobStatuses" apps/api/src/saga/SagaIntegration.ts | grep -v "completed: jobIds.length"
```

**Findings table (10):**

| L-#      | Título corto                                                                   | Esfuerzo | Acción    | §5.9         | Archivos / Notas                                  |
| -------- | ------------------------------------------------------------------------------ | -------- | --------- | ------------ | ------------------------------------------------- |
| L-41     | `EventStore.ensureTable` runtime DDL / schema divergence                       | HEAVY    | REFACTOR  | AUTO         | Migrar a schema.prisma + formal migration         |
| L-528    | EventStore silent failure catch (CRITICAL)                                     | QUICK    | FIX       | AUTO         | Inspect error code 42P07; propagate rest          |
| L-42     | `EventStore` referencia `EventSnapshots` no declarada                          | MEDIUM   | DECIDE    | NEEDS_EDWARD | IMPLEMENT (migration) vs DELETE methods           |
| L-63     | `SagaIntegration` ejecuta commands via CQRSBus vacío (SAFETY_CRITICAL runtime) | HEAVY    | IMPLEMENT | NEEDS_EDWARD | Wire handlers OR introducir `PostSagaPort`        |
| L-64     | `SagaIntegration` job status checker STUB fake optimistic                      | MEDIUM   | IMPLEMENT | AUTO         | Real BullMQ queue.getJob().getState()             |
| L-47     | CQRS subsystem PLANNED + CQRSBus shell                                         | MEDIUM   | DECIDE    | NEEDS_EDWARD | Reactivate vs delete (L-506 style decision)       |
| L-36-ext | EventService consolidation + PLANNED CQRS                                      | —        | —         | —            | Cross-ref B4 L-36 — ya atacado en B4              |
| L-45-ext | EventService no-op handlers                                                    | —        | —         | —            | Resolved when L-36 resolved                       |
| L-522    | No `SagaHealthChecker` gap                                                     | MEDIUM   | IMPLEMENT | NEEDS_EDWARD | Post-L-63 fix                                     |
| L-561    | Event sourcing bypass seed                                                     | MEDIUM   | DECIDE    | NEEDS_EDWARD | Decidir boundary emit events o pre-event-sourcing |

**Orden de ejecución sugerido (4–6 días):**

1. **Día 1–2 — EventStore migration:** L-41 (formal migration + dual-mode support for backward compat), L-528 (error code inspection).
2. **Día 3 — Saga fix crítico:** L-63 (wire handlers O decidir PostSagaPort — Edward valida), L-64 (real job status).
3. **Día 4 — CQRS decision:** L-47 (activate vs delete — cross-ref B2 L-506 pattern), L-42 (snapshots decision).
4. **Día 5 — Health checker + seed boundary:** L-522 (SagaHealthChecker), L-561 (seed decision).

**Notas.** B9 es el batch con mayor ratio "decidir/implementar". Edward puede elegir "implementar ahora" o "documentar PLANNED y diferir a sprint dedicado"; en ambos casos el fitness function queda explícito.

---

### §5.10 — B10 Architecture Consolidations

**Scope.** Refactors grandes que tocan múltiples packages/apps. Cada sub-ítem es ~3–8 días. NO se ejecutan en paralelo — secuencial con ADR per item.

**Entry criteria.** B4 + B7 cerrados (DI + refactors localizados estables).

**Exit criteria:** ADR documentando decisión + tests verdes cross-module + fitness functions sin regresión.

**Findings table (29):**

| L-#            | Título corto                                                  | Esfuerzo | Acción   | §5.9         | Archivos / Notas                                                            |
| -------------- | ------------------------------------------------------------- | -------- | -------- | ------------ | --------------------------------------------------------------------------- |
| L-14           | Providers triple overlap (legacy)                             | —        | —        | —            | Superseded por L-386                                                        |
| L-386          | L-14 upgrade 5-way 1,440 LOC apps/api duplicate (CRITICAL)    | DEEP     | REFACTOR | NEEDS_EDWARD | Consolidar `apps/api/src/providers/*` → `@providers/shared` + `@ports/core` |
| L-362          | RepoPort GOD_INTERFACE 199 LOC 8 aggregates                   | DEEP     | REFACTOR | NEEDS_EDWARD | Split per aggregate + CQRS separation (~48h)                                |
| L-363          | queue-bullmq hardcoded PUBLISH queue (CRITICAL)               | MEDIUM   | REFACTOR | AUTO         | Parametrize queueName; absorbe L-380/L-376                                  |
| L-61           | QueuePort hardcoded PUBLISH misroute (cross-ref L-363)        | —        | —        | —            | Same as L-363                                                               |
| L-364          | cache-redis fastify boundary leak (CRITICAL)                  | HEAVY    | REFACTOR | AUTO         | Split core adapter puro + middleware app-local                              |
| L-507          | `@api-common` BaseRouteHandler Fastify import (CRITICAL)      | HEAVY    | REFACTOR | AUTO         | Relocate OR abstract via `RouteContext`                                     |
| L-384          | `AbstractProviderAdapter` dynamic db-prisma import (CRITICAL) | MEDIUM   | REFACTOR | AUTO         | `CredentialsPort`; remove dynamic import                                    |
| L-385          | Instagram worker-layer en package (CRITICAL)                  | MEDIUM   | REFACTOR | AUTO         | Move a `apps/workers/providers/instagram/`                                  |
| L-20           | `reports/` vs `custom-reports/` sistemas paralelos            | HEAVY    | REFACTOR | NEEDS_EDWARD | Migrar consumers a custom-reports + delete reports                          |
| L-441          | apiClient boilerplate 11-way consolidation (2,200 LOC)        | HEAVY    | REFACTOR | AUTO         | Extract `@providers/shared/apiClient` base class                            |
| L-65           | 3 ubicaciones workers BullMQ en monorepo                      | HEAVY    | REFACTOR | NEEDS_EDWARD | ADR deployment topology — Opción 1 vs 2                                     |
| L-642          | Workers Dockerfile single-worker (HIGH)                       | MEDIUM   | CONFIG   | AUTO         | Parametrize ENTRYPOINT con WORKER_TYPE                                      |
| L-640-topology | Docker base + workers topology resueltos juntos               | —        | —        | —            | L-640 ya en B0; L-642 aquí por ser topology                                 |
| L-352          | `ProviderLimits` DUP_TYPE_DIVERGENT (CRITICAL)                | MEDIUM   | REFACTOR | AUTO         | Unify — ports version SoT                                                   |
| L-534          | Composite unique NULL-trap (3 files)                          | MEDIUM   | FIX      | AUTO         | Partial indexes                                                             |
| L-535          | CHECK constraints composite (5+ fields)                       | HEAVY    | FIX      | AUTO         | Raw migrations con CHECK                                                    |
| L-536          | Partial indexes missing soft-delete                           | MEDIUM   | FIX      | AUTO         | Partial indexes WHERE deleted_at IS NULL                                    |
| L-539          | `DataBreachReport` FK gap                                     | QUICK    | FIX      | AUTO         | Declare relation                                                            |
| L-540          | `ConsentRecord` FK gap                                        | QUICK    | FIX      | AUTO         | Declare relation + cascade                                                  |
| L-541          | Decimal precision inconsistency                               | QUICK    | FIX      | AUTO         | Standard: money 19,4 / rates 10,6                                           |
| L-557          | wildcard exports `@infra/prisma`                              | QUICK    | REFACTOR | AUTO         | Named exports                                                               |
| L-368          | opossum 3-way version drift + circuit breaker DEAD            | HEAVY    | DECIDE   | NEEDS_EDWARD | Cross-ref L-506 B2 decision                                                 |
| L-537          | Rollback docs gap                                             | MEDIUM   | DOCUMENT | AUTO         | Doc per migration                                                           |
| L-631          | secrets naming inconsistency cross-workflows                  | QUICK    | CONFIG   | AUTO         |                                                                             |
| L-632          | timeout defaults too high                                     | TRIVIAL  | CONFIG   | AUTO         |                                                                             |
| L-633          | artifact retention not set                                    | TRIVIAL  | CONFIG   | AUTO         |                                                                             |
| L-634          | concurrency groups missing                                    | QUICK    | CONFIG   | AUTO         |                                                                             |
| L-635          | cache keys brittle (no lockfile hash)                         | QUICK    | CONFIG   | AUTO         |                                                                             |
| L-636          | matrix strategy no fail-fast                                  | TRIVIAL  | CONFIG   | AUTO         |                                                                             |
| L-637          | reusable-workflows no aprovechados                            | MEDIUM   | REFACTOR | AUTO         |                                                                             |
| L-638          | environment protection rules ausentes                         | MEDIUM   | CONFIG   | NEEDS_EDWARD |                                                                             |
| L-639          | job permissions default restrictive                           | QUICK    | CONFIG   | AUTO         | `contents: read`                                                            |

**Orden de ejecución sugerido (sprint dedicado per sub-item):**

1. **Sub-sprint 1 (1 semana) — Providers consolidation:** L-386 (5-way + L-14), L-384, L-385, L-441, L-60, L-352, L-60-registry. Output: `@providers/shared` como único SoT.
2. **Sub-sprint 2 (1 semana) — Boundary leaks:** L-364 (cache-redis), L-507 (api-common), L-384.
3. **Sub-sprint 3 (½ semana) — QueuePort + Workers topology:** L-363 (+L-61+L-380+L-376), L-642, L-65 (ADR).
4. **Sub-sprint 4 (1 semana) — Reports consolidation:** L-20.
5. **Sub-sprint 5 (½ semana) — RepoPort split:** L-362 — podría posponerse si no hay retorno inmediato.
6. **Sub-sprint 6 (½ semana) — Schema integrity batch:** L-534, L-535, L-536, L-539, L-540, L-541, L-537, L-557.
7. **Sub-sprint 7 (½ semana) — CI/CD hardening fin:** L-631..L-639.
8. **Sub-sprint 8 — Circuit breaker decision** (si aún pending de B2): L-368/L-506.

**Notas.** B10 puede ejecutarse como "parking" paralelo a B11 feature backlog. Cada sub-sprint cierra con ADR en `docs/architecture/adr/`.

---

### §5.11 — B11 PLANNED features backlog (fuera del ciclo)

**Scope.** Features conceptualmente completas en arquitectura pero sin UI/integration. No se ejecutan en el ciclo de remediación — son roadmap producto. Edward decide prioridad y cuándo/cómo atacar cada una.

**Entry criteria.** Ninguna — backlog paralelo.

**Exit criteria.** N/A — este batch no "cierra"; sus ítems se extraen uno a uno cuando producto los prioriza.

**Findings table (34):**

| L-#                      | Título corto                                             | Notas                                                    |
| ------------------------ | -------------------------------------------------------- | -------------------------------------------------------- |
| L-8                      | `trendAnalysisService.ts` mock data en 3 métodos         | Sprint TikTok API real OR mark DEMO_MODE                 |
| L-9                      | `content/SyncEngineImpl` MASIVOS STUBS con routes wired  | CORE_CONCEPTUAL — sprint completion                      |
| L-10                     | `content/VersionController` DB persistence stub          | Sprint content subsystem completion                      |
| L-31-content             | content module 7.6k LOC PLANNED integration              | Cross-ref pre-D0-v4 analysis                             |
| L-68-content             | UnifiedPublishingDashboard (si Edward decide WIRE en B2) | Alternative to DELETE                                    |
| L-70-sso                 | SSO admin UI (7 endpoints BUILD_UI)                      | /saml + /oidc admin config panels                        |
| L-71-zapier              | Zapier keys management UI (5 endpoints)                  | apps/client admin                                        |
| L-72-make                | Make keys management UI (5 endpoints)                    | apps/client admin                                        |
| L-73-health              | Health dependency panel (2 endpoints)                    | /health/detailed + /health/dependency/:name              |
| L-74-providers           | Providers health dashboard (2 endpoints)                 | /providers/:id/health + /providers/health/all            |
| L-95-channels            | channels Test/Settings buttons                           | B6 references; requires feature spec                     |
| L-94-oauth               | OAuth flow 10/11 providers                               | Dead connect buttons — feature completion                |
| L-96-instagram           | Create Stories/Reels/Carousel flows                      | Router integration + feature spec                        |
| L-87-stories             | StoriesEditor 4 callbacks wire                           | Feature spec + backend                                   |
| L-115-ia                 | IA review "Settings" vs "AI Settings" nav                | Product decision                                         |
| L-113-i18n               | i18n full decision (client + admin + UI)                 | Product decision — single lang or true i18n              |
| L-33-content             | 18 content/ endpoints PLANNED integration                | Sprint content integration multi-fase                    |
| L-20-reports             | reports/ vs custom-reports/ unification                  | También en B10 — parallel roadmap                        |
| L-65-workers             | workers topology deploy-ready                            | También en B10 — ADR primero                             |
| L-638-env                | environment protection rules GitHub                      | Config después de tener prod env                         |
| L-269-metadata           | Admin metadata per page                                  | SEO — post-product signoff                               |
| L-97-posts               | posts/page.tsx migration to TanStack                     | Spec cómo maneja admin posts                             |
| L-116-templates          | Templates consolidation API vs static                    | Feature spec templates API-driven                        |
| L-272-upload             | proxy route streaming uploads large files                | Feature requirement cuando uploads grandes sean use case |
| L-100-provider-stub      | ProjectProvider architectural mismatch                   | Single vs multi-account architecture decision            |
| L-50-cli                 | outboxAdminRoutes aggregateType unknown in retry         | Minor — sprint observability                             |
| L-295-webhooks           | WebhookSubscriptions TanStack bypass (composite L-327)   | Wire when BUILD_UI expanded                              |
| L-294-webhooks           | WebhookEventsList TanStack bypass (composite L-327)      | idem                                                     |
| L-327-webhooks           | useWebhooks GAPs                                         | Fix drives L-294/L-295                                   |
| L-38-pricing             | UpdatePricingConfigUseCase grandfathering                | Research intent — maybe B11                              |
| L-39-repurpose           | GenerateRepurposeVariantsUseCase notification            | Research intent — maybe B11                              |
| L-278                    | `RbacManager` 481 LOC big refactor candidate             | Product decision if major refactor                       |
| L-313-ext                | SSO integration consolidation                            | Requires PLANNED auth decisions                          |
| L-268-i18n-announcements | announcements i18n refactor composite                    | Part of i18n decision                                    |

**Notas.** B11 no tiene formato de exit criteria ni orden sugerido — es el "parking lot" producto. Cuando un item se active (Edward decide roadmap), se saca de B11 y se convierte en su propio sprint con spec de producto.

---

## §6. Matriz de dependencias cross-batch

```
B0 (Safety Net)  ─┬─> B1 (Housekeeping, paralelo OK)
                  ├─> B2 (DEAD_CODE, requires CI verde)
                  ├─> B3 (Config Correctness)  ──┐
                  ├─> B5 (Stubs → Real)          │
                  └─> B8 (Billing)               │
                                                  │
                                     B3 ─────────┤
                                                  ├─> B4 (DI Consistency)
                                                  └─> B6 (Domain/App Quality)
                                                               │
                                                               ↓
                                          B4 ──────> B7 (Refactors) ─> B10 (Consolidations)
                                          │
                                          ↓
                                          B9 (EventStore + Saga + CQRS)

B11 (PLANNED) — paralelo, no bloquea
App A / App B / App C — documentales, no ejecutables
```

**Cadenas críticas:**

- **Safety chain:** B0 → B5 → B8 (secrets rotados antes de billing enforcement real)
- **Quality chain:** B3 → B4 → B6 → B7 → B10 (configs → DI → quality → refactors → consolidaciones)
- **Saga chain:** B4 → B9 (EventService singleton antes de decidir EventStore formal)
- **Architecture chain:** B7 + B4 → B10 (refactors localizados + DI sólido antes de consolidaciones)

---

## §7. Reconciliación 647 → mapeado

Cada L-# debe aparecer exactamente una vez en una de: fila primaria en batch / fila en Appendix A (positive) / fila en Appendix B (wont_fix) / fila en Appendix C (absorbed/resolved) / fila en B11 (backlog).

| Sección                                              |   Findings |
| ---------------------------------------------------- | ---------: |
| B0 Safety Net                                        |         13 |
| B1 Housekeeping Trivial                              |         34 |
| B2 DEAD_CODE validado                                |         49 |
| B3 Config Correctness                                |         27 |
| B4 DI Consistency                                    |         16 |
| B5 Stubs → Real                                      |         13 |
| B6 Domain/App Quality (primary rows)                 |        205 |
| B7 Refactors localizados                             |         12 |
| B8 Billing/Financial Precision                       |          8 |
| B9 EventStore + Saga + CQRS                          |         10 |
| B10 Architecture Consolidations                      |         29 |
| B11 PLANNED backlog                                  |         34 |
| Appendix A — Positives                               |         27 |
| Appendix B — WONT_FIX                                |          5 |
| Appendix C — Absorbed / Resolved / Composite pointer |        165 |
| **TOTAL**                                            | **647** ✅ |

**Verificación:** Σ = 13 + 34 + 49 + 27 + 16 + 13 + 205 + 12 + 8 + 10 + 29 + 34 + 27 + 5 + 165 = **647** ✅

**Fórmula de verificación manual (comando):**

```bash
# Contar L-# únicos en el documento
grep -oE "L-[0-9]+" docs/audits/REMEDIATION_BATCHES.md | sort -u | wc -l   # Expected: 647 L-# únicos
```

---

## §8. Execution cadence sugerida

Asumiendo 1 batch por semana (Edward + agente trabajando ~20h/sem en remediación):

|  Semana | Batches activos                                                              |
| ------: | ---------------------------------------------------------------------------- |
|       1 | **B0 prioridad absoluta** (3–5 días concentrados)                            |
|       2 | **B1 + B2 en paralelo** (low risk, Edward valida DEAD_CODE)                  |
|       3 | **B3 Config Correctness** (1–2 d, resto buffer para fixes post-ESLint rules) |
|       4 | **B4 DI Consistency + B5 Stubs (parallel si bandwidth)**                     |
|       5 | **B6 Domain/App Quality** (batch voluminoso, requiere foco)                  |
|       6 | **B7 Refactors + B8 Billing (parallel)**                                     |
|       7 | **B9 EventStore + Saga + CQRS**                                              |
|      8+ | **B10 sub-sprints** (1 sub-sprint/semana)                                    |
| ongoing | **B11 producto decide ritmo**                                                |

**Hitos intermedios:**

- Fin sem 1: fitness function workflow verde, CI rojo cuando falla test.
- Fin sem 3: ESLint enforza 4 rules CLAUDE.md, `.env.example` matches.
- Fin sem 5: 10 fitness functions todas en 0 (B6 cerrado).
- Fin sem 7: EventStore en schema, saga funcional, CQRS decidido.
- Fin sem 8+: producto desbloquea B11 según roadmap.

---

## §9. Reglas de commit y PR por batch

1. **Commit message format:** `chore(remediation): B<n> — <short summary> (closes L-<#>[, L-<#>...])`.
2. **Batch ≥5 findings:** commit por sub-grupo + commit final "close batch" con referencia a todos.
3. **Batch con SAFETY_CRITICAL:** PR separado con review obligatorio (no merge directo).
4. **Batch con NEEDS_EDWARD findings:** PR description lista cada decision + link al `LATERAL_FINDINGS.md` entry.
5. **Verificación post-batch:** exit criteria commands ejecutados + capturados en PR description.
6. **Actualización inline:** este documento se actualiza marcando batch ✅ + fecha al cerrar.

---

## Appendix A — Positives (27 findings — sin acción requerida)

Reconocimiento de prácticas correctas documentadas durante auditoría. No se ejecutan, no bloquean.

| L-#   | Descripción                                                                 |
| ----- | --------------------------------------------------------------------------- |
| L-542 | POSITIVE — Baseline schema clean (114 modelos naming convention)            |
| L-543 | POSITIVE — Cascade strategy correcta FKs                                    |
| L-544 | POSITIVE — Enum coverage exhaustivo (54 enums)                              |
| L-563 | POSITIVE — RBAC binding completo (17/17 permissions SUPER_ADMIN)            |
| L-564 | POSITIVE — GDPR consent seed correcto                                       |
| L-565 | POSITIVE — bcrypt hashing uniform                                           |
| L-566 | POSITIVE — Idempotency via upsert pattern                                   |
| L-567 | POSITIVE — Ordering constraint-safe                                         |
| L-568 | POSITIVE — Tenant isolation en seeds multi-tenant                           |
| L-569 | POSITIVE — Factory pattern parcial (notoriamente reviewable, también en B1) |
| L-570 | POSITIVE — No PII real en seed                                              |
| L-602 | POSITIVE — tsconfig `strict: true` uniforme                                 |
| L-603 | POSITIVE — Biome no usado (no tool proliferation)                           |
| L-604 | POSITIVE — Husky v9 (latest)                                                |
| L-605 | POSITIVE — bcrypt en dependencies (no md5)                                  |
| L-606 | POSITIVE — pnpm `--frozen-lockfile` en CI                                   |
| L-607 | POSITIVE — prettier minimal                                                 |
| L-608 | POSITIVE — `.editorconfig` present                                          |
| L-609 | POSITIVE — `.nvmrc` present (node lock)                                     |
| L-610 | POSITIVE — typescript version modern                                        |
| L-611 | POSITIVE — turbo version modern                                             |
| L-612 | POSITIVE — no legacy jest config                                            |
| L-613 | POSITIVE — zod versions aligned cross-workspace                             |
| L-614 | POSITIVE — pino structured logging adopted                                  |
| L-615 | POSITIVE — husky postinstall behind test                                    |
| L-137 | POSITIVE — (implícito) dev entries sin side effects                         |
| L-138 | POSITIVE — (implícito) tooling calibration                                  |

---

## Appendix B — WONT_FIX justificados (5 findings)

Hallazgos conscientemente excluidos con razón documentada. Edward ya aprobó el WONT_FIX o el hallazgo es `informativo / OK by design`.

| L-#   | Descripción                                                                   | Justificación                                                                      |
| ----- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| L-265 | `useNotificationStream` SSE bypass proxy                                      | Pattern intencional documentado en código (Next.js proxy bufferea SSE). NO action. |
| L-117 | `AnnouncementBanner` usa /api/... sin /backend/ prefix                        | Public path intencional. Documentar, NO migrate.                                   |
| L-47  | CQRS subsystem PLANNED (si Edward decide PLANNED, no DELETE)                  | Edward CP4 PLANNED. Esperar sprint futuro de CQRS activation.                      |
| L-67  | `DEAD_LETTER_QUEUE` + `FAILED_OPERATIONS_DLQ` legacy (si decision = WONT_FIX) | Si L-66 PLANNED — DLQ queues futuras. Documentar como research pending.            |
| L-558 | Husky postinstall en CI scenario                                              | Condicional test -d .git; ya correcto, finding documental.                         |

---

## Appendix C — Composite absorption map / RESOLVED / Dup pointers (165 findings)

### C.1 — Composite absorptions (findings que son cross-references a un primary)

| Absorbed L-# | Primary | Razón                                                              |
| ------------ | ------- | ------------------------------------------------------------------ |
| L-617        | L-616   | "CI/CD broken pipeline composite" — security-testing.yml dead refs |
| L-618        | L-616   | production-ci.yml eslint-security missing                          |
| L-619        | L-616   | Branch coverage Genesis no triggered                               |
| L-620        | L-616   | 27 actions sin SHA pinning                                         |
| L-548        | L-547   | seed-mixing bootstrap + test + demo                                |
| L-600        | L-623   | password123 triple → séxtuple escalated                            |
| L-473        | L-506   | `@monitoring/circuit-breaker` central monitor DEAD (paired)        |
| L-517        | L-506   | `checkers/circuitBreaker.ts` dead (paired)                         |
| L-348        | L-267   | `proxy.ts` re-confirmed ORPHAN                                     |
| L-346        | L-335   | ProjectProvider raw fetches en código dead                         |
| L-349        | L-339   | ai-content-utils emoji truncation bug en dead                      |
| L-365        | ver B2  | cloudinary runtime bug en orphan adapter                           |
| L-374        | L-368   | opossum version drift sub-finding                                  |
| L-375        | L-357   | SubscriptionTier deprecation re-confirm                            |
| L-380        | L-363   | queue-bullmq concurrency ignored                                   |
| L-376        | L-363   | queue-bullmq test mocks (partial — also primary B6)                |
| L-61         | L-363   | QueuePort hardcoded (same composite)                               |
| L-262        | L-261   | `useChannels.disconnectChannel` path inconsistency dup             |
| L-264        | L-261   | `useBilling.useMyInvoices` path inconsistency dup                  |
| L-69         | L-208   | Dual auth path — absorbed en 3-path upgrade L-208                  |
| L-86         | L-207   | 3 useProviders — absorbed en 4-path upgrade L-207                  |
| L-99-ext     | L-214   | State hooks cadena to LEGACY                                       |
| L-141        | L-68    | UnifiedPublishingDashboard DEAD (size violation was symptom)       |
| L-143        | L-68    | ContentPreviewSystem DEAD                                          |
| L-147        | L-68    | ProviderAdaptationEngine DEAD                                      |
| L-156        | L-68    | AdminContentEditor DEAD                                            |
| L-162        | L-68    | provider-previews DEAD                                             |
| L-169        | L-68    | publishingDashboardApi DEAD (util)                                 |
| L-203        | L-158   | editor/TemplateSelector dup ref                                    |
| L-204        | L-178   | publishing/PublishDialog dup ref                                   |
| L-471        | L-470   | i18n UI individual entries (13 absorbed)                           |
| L-472        | L-470   | i18n UI individual                                                 |
| L-473-i18n   | L-470   | i18n UI individual (distinto del L-473 monitor)                    |
| L-474        | L-470   | i18n UI individual                                                 |
| L-475        | L-470   | i18n UI individual                                                 |
| L-476        | L-470   | i18n UI individual                                                 |
| L-477        | L-470   | i18n UI individual                                                 |
| L-478        | L-470   | i18n UI individual                                                 |
| L-479        | L-470   | i18n UI individual                                                 |
| L-480        | L-470   | i18n UI individual                                                 |
| L-481        | L-470   | i18n UI individual                                                 |
| L-482        | L-470   | i18n UI individual                                                 |
| L-237        | L-212   | client.ts 440 LOC R11 dup                                          |
| L-316        | L-320   | useMultiPlatformScheduling R11 (ORPHAN primary)                    |
| L-236        | L-140   | usePredictiveData R11 dup                                          |
| L-140        | L-102   | usePredictiveData size via ai subsystem                            |
| L-483..L-491 | L-470   | Design token drift UI individuales (9 absorbed)                    |
| L-46-dup     | L-46    | ComposedEventDispatcher (no dup — is primary in B4)                |
| L-45-dup     | L-36    | EventService default handlers — cross-ref primary L-36             |

### C.2 — RESOLVED (finding cerrado durante un sprint posterior)

| L-#        | Resolución                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| L-298      | `@layer` mismapping CLOSED — fitness function #10 = 0 en D0v4-8. Sub-parte `@file` headers ~130 files queda en B6 |
| L-600      | Escalado a L-623 (password123 séxtuple)                                                                           |
| L-14       | Superseded por L-386 (5-way overlap)                                                                              |
| L-260-seed | Coverage gap seed se resuelve vía B3 L-599 + B2 L-560                                                             |

### C.3 — Dup pointers / re-entries cross-sprint (findings que aparecen dos veces por contextualización distinta)

Los siguientes pares tienen el mismo L-# pero aparecen con contexto en múltiples sprints; primary row en batch correspondiente:

- L-368 cross-sprint extension: circuit breaker + pricing + invoice composite (primary in B10).
- L-260 cross-sprint extension: per-mutation onError (primary in B6; extended by D0v4-6/7/8).
- L-368-billing context: cross-ref B8.

### C.4 — Size violations composite expandido (client L-135..L-204)

Los 70 findings de size violation client (D0v4-4 tabla §R11) son **primary rows** en B6 subcategoría 6.9. Listados individualmente abajo para trazabilidad. Edward decide per-archivo si refactor o accept-with-ADR.

| L-#   | Archivo                                         | LOC | Notas                          |
| ----- | ----------------------------------------------- | --: | ------------------------------ |
| L-135 | editor/PlatformPreview.tsx                      | 705 |                                |
| L-136 | dashboard/channels/page.tsx                     | 692 |                                |
| L-137 | settings/billing/page.tsx                       | 687 |                                |
| L-138 | instagram/MediaUploadZone.tsx                   | 672 |                                |
| L-139 | dashboard/posts/page.tsx                        | 669 | Cross L-97                     |
| L-140 | usePredictiveData.ts (client)                   | 629 | Cross L-236                    |
| L-141 | UnifiedPublishingDashboard (DEAD, L-68)         | 620 | Resolved via L-68 DELETE       |
| L-142 | instagram/VideoSplitPreview.tsx                 | 613 |                                |
| L-143 | ContentPreviewSystem (DEAD, L-68)               | 604 | Resolved via L-68              |
| L-144 | templates/VariableInserter.tsx                  | 546 |                                |
| L-145 | instagram/upload/page.tsx                       | 520 | Cross L-96                     |
| L-146 | publishing/PublishingInterface.tsx              | 496 |                                |
| L-147 | ProviderAdaptationEngine (DEAD, L-68)           | 494 | Resolved via L-68              |
| L-148 | posts/[id]/page.tsx                             | 488 | Cross L-98                     |
| L-149 | templates/TemplateManagementDashboard.tsx       | 460 | Cross L-99                     |
| L-150 | editor/SchedulePicker.tsx                       | 442 | Cross L-78/L-120               |
| L-151 | ai/PromptTemplateManager.tsx                    | 439 |                                |
| L-152 | templates/TipTapEditor.tsx                      | 421 |                                |
| L-153 | templates/TemplateEditorCanvas.tsx              | 417 |                                |
| L-154 | posts/[id]/preview/page.tsx                     | 392 |                                |
| L-155 | analytics/page.tsx                              | 275 |                                |
| L-156 | AdminContentEditor (DEAD, L-68)                 | 360 | Resolved via L-68              |
| L-157 | templates/TemplateLibraryGrid.tsx               | 354 |                                |
| L-158 | templates/TemplateSelector.tsx                  | 351 |                                |
| L-159 | templates/TemplateLibrary.tsx                   | 335 |                                |
| L-160 | scheduling/SchedulingDashboardSidebar.tsx       | 329 |                                |
| L-161 | providers/ProjectProvider.tsx (client)          | 327 | Cross L-100                    |
| L-162 | editor/provider-previews (DEAD, L-68)           | 327 | Resolved via L-68              |
| L-163 | templates/TemplateVersionControl.tsx            | 322 |                                |
| L-164 | useContentLibraryState.ts                       | 290 | Cross L-77                     |
| L-165 | scheduling/CSVBulkUpload.tsx                    | 317 |                                |
| L-166 | scheduling/useSchedulingDashboard.ts            | 318 |                                |
| L-167 | templates/TemplateEditor.tsx                    | 315 |                                |
| L-168 | scheduling/page.tsx                             | 317 | Cross L-93                     |
| L-169 | publishing/publishingDashboardApi (DEAD, L-68)  | 306 | Resolved via L-68              |
| L-170 | templates/ABTestCreateDialog.tsx                | 300 |                                |
| L-171 | ai/SmartContentOptimizer.tsx                    | 369 | Cross L-80                     |
| L-172 | ai/PredictiveAnalytics.tsx                      |  86 | (OK, listed for context L-102) |
| L-173 | settings/ai/page.tsx                            | 293 | OK page limit                  |
| L-174 | ClientContentEditor.tsx                         | 297 | Cross L-85                     |
| L-175 | scheduling/MultiPlatformSchedulerRefactored.tsx | 278 | Cross L-90/L-91                |
| L-176 | scheduling/RecurringPostForm.tsx                | 275 | Cross L-92                     |
| L-177 | settings/privacy/page.tsx                       | 271 | OK page limit                  |
| L-178 | publishing/PublishDialog.tsx                    | 272 |                                |
| L-179 | useABTestManager.ts (client)                    | 273 |                                |
| L-180 | analytics/ScheduledReportsList.tsx              | 245 |                                |
| L-181 | approvals/ReviewPanel.tsx                       | 244 |                                |
| L-182 | content/library/FilterPanel.tsx                 | 244 |                                |
| L-183 | ai/smartContentOptimizerUtils.ts                | 243 |                                |
| L-184 | NotificationBell.tsx                            | 239 | Cross L-84                     |
| L-185 | SchedulingDashboard.tsx                         | 239 |                                |
| L-186 | NotificationPreferences.tsx                     | 251 |                                |
| L-187 | scheduling/views/BulkScheduleView.tsx           | 255 |                                |
| L-188 | PerformanceInsights.tsx                         | 275 | Dup L-201                      |
| L-189 | ai/AIContentResults.tsx                         | 208 |                                |
| L-190 | ai/ai-content-templates.ts                      | 263 | Cross L-81                     |
| L-191 | useTemplateVersionControl.ts                    | 281 |                                |
| L-192 | content/ContentTemplates.tsx                    | 217 |                                |
| L-193 | SchedulingDashboardPostModal.tsx                | 221 |                                |
| L-194 | RecurrenceSelector.tsx                          | 209 |                                |
| L-195 | SamlConfigForm.tsx                              | 211 |                                |
| L-196 | analytics/CreateReportForm.tsx                  | 206 |                                |
| L-197 | dashboard/layout.tsx (OK limit)                 | 178 | OK                             |
| L-198 | settings/brand-voice/BrandVoiceForm.tsx         | 269 |                                |
| L-199 | settings/ExternalNotificationConfigs.tsx        | 245 | Cross L-76                     |
| L-200 | instagram/StoriesEditor.tsx (OK limit)          | 197 | OK                             |
| L-201 | analytics/PerformanceInsights.tsx               | 275 | Dup L-188                      |
| L-202 | settings/AddWebhookForm.tsx (OK limit)          | 191 | OK                             |
| L-203 | editor/TemplateSelector.tsx                     |   — | Dup L-158                      |
| L-204 | publishing/PublishDialog.tsx                    |   — | Dup L-178                      |

### C.5 — R11 hooks client L-238..L-258 (individual file references)

Los 21 R11 hooks findings son **primary rows** en B6 subcategoría 6.9 — lista individual D0v4-5 catálogo.

| L-#   | Archivo                                              | LOC |
| ----- | ---------------------------------------------------- | --: |
| L-238 | hooks/api/useInbox.ts                                | 321 |
| L-239 | components/scheduling/useSchedulingDashboard.ts      | 318 |
| L-240 | components/content/library/useContentLibraryState.ts | 290 |
| L-241 | components/templates/useTemplateVersionControl.ts    | 281 |
| L-242 | hooks/api/useBilling.ts                              | 274 |
| L-243 | components/templates/useABTestManager.ts             | 273 |
| L-244 | lib/auth/authApi.ts                                  | 258 |
| L-245 | hooks/api/useTasks.ts                                | 254 |
| L-246 | hooks/api/useSso.ts                                  | 249 |
| L-247 | lib/hooks/useABTests.ts                              | 230 |
| L-248 | hooks/api/useAssets.ts                               | 224 |
| L-249 | lib/api/types.ts                                     | 212 |
| L-250 | lib/hooks/useAutoSave.ts                             | 207 |
| L-251 | hooks/api/useCampaigns.ts                            | 201 |
| L-252 | hooks/api/useAIPromptTemplates.ts                    | 177 |
| L-253 | lib/hooks/useTemplates.ts                            | 172 |
| L-254 | hooks/api/useMultiPlatformScheduling.ts              | 165 |
| L-255 | hooks/api/useApprovals.ts                            | 165 |
| L-256 | hooks/useAIContentGenerator.ts                       | 163 |
| L-257 | hooks/api/useTeam.ts                                 | 159 |
| L-258 | hooks/api/usePerformanceInsights.ts                  | 152 |

### C.6 — R11 admin components L-274..L-292

Los 19 admin R11 findings son **primary rows** en B6 subcategoría 6.9 — lista individual D0v4-6.

| L-#   | Archivo                             | LOC |
| ----- | ----------------------------------- | --: |
| L-274 | webhooks/DeadLetterQueue.tsx        | 732 |
| L-275 | webhooks/WebhookSubscriptions.tsx   | 689 |
| L-276 | webhooks/WebhookEventsList.tsx      | 505 |
| L-277 | subscriptions/ChangePlanDialog.tsx  | 488 |
| L-278 | security/RbacManager.tsx            | 481 |
| L-279 | shared/SidebarNav.tsx               | 446 |
| L-280 | accounts/AccountBillingPanel.tsx    | 383 |
| L-281 | pricing/ProviderTiersTab.tsx        | 365 |
| L-282 | pricing/AccountTiersTab.tsx         | 355 |
| L-283 | compliance/BreachTable.tsx          | 354 |
| L-284 | maintenance/ScheduledJobsPanel.tsx  | 350 |
| L-285 | compliance/DsarTable.tsx            | 340 |
| L-286 | security/MfaSelfService.tsx         | 331 |
| L-287 | compliance/GdprSettingsForm.tsx     | 323 |
| L-288 | webhooks/WebhookMetrics.tsx         | 319 |
| L-289 | security/MfaManager.tsx             | 307 |
| L-290 | webhooks/WebhookTimeline.tsx        | 267 |
| L-291 | compliance/SecuritySettingsForm.tsx | 252 |
| L-292 | security/PermissionGrid.tsx         | 215 |

### C.7 — Providers R11 lenient L-394..L-436

Los 43 provider R11 findings son **primary rows** en B6 subcategoría 6.9 — lista composite D0v4-7 §8.

| L-#   | Archivo                             |     LOC |
| ----- | ----------------------------------- | ------: |
| L-394 | youtube/communityFeatures.ts        |     752 |
| L-395 | youtube/apiClient.ts                |     745 |
| L-396 | youtube/liveStreaming.ts            |     690 |
| L-397 | facebook/reels.ts                   |     681 |
| L-398 | facebook/community.ts               |     672 |
| L-399 | telegram/apiClient.ts               |     670 |
| L-400 | facebook/apiClient.ts               |     667 |
| L-401 | instagram/publishingWorker.ts       |     663 |
| L-402 | tiktok/contentAnalyticsClient.ts    |     658 |
| L-403 | instagram/InstagramAdapter.ts       |     620 |
| L-404 | provider file 404 (D0v4-7 §8 tabla) | 400–620 |
| L-405 | provider file 405 (D0v4-7 §8 tabla) | 400–620 |
| L-406 | provider file 406 (D0v4-7 §8 tabla) | 400–620 |
| L-407 | provider file 407 (D0v4-7 §8 tabla) | 400–620 |
| L-408 | provider file 408 (D0v4-7 §8 tabla) | 400–620 |
| L-409 | provider file 409 (D0v4-7 §8 tabla) | 400–620 |
| L-410 | provider file 410 (D0v4-7 §8 tabla) | 400–620 |
| L-411 | provider file 411 (D0v4-7 §8 tabla) | 400–620 |
| L-412 | provider file 412 (D0v4-7 §8 tabla) | 400–620 |
| L-413 | provider file 413 (D0v4-7 §8 tabla) | 400–620 |
| L-414 | provider file 414 (D0v4-7 §8 tabla) | 400–620 |
| L-415 | provider file 415 (D0v4-7 §8 tabla) | 400–620 |
| L-416 | provider file 416 (D0v4-7 §8 tabla) | 400–620 |
| L-417 | provider file 417 (D0v4-7 §8 tabla) | 400–620 |
| L-418 | provider file 418 (D0v4-7 §8 tabla) | 400–620 |
| L-419 | provider file 419 (D0v4-7 §8 tabla) | 400–620 |
| L-420 | provider file 420 (D0v4-7 §8 tabla) | 400–620 |
| L-421 | provider file 421 (D0v4-7 §8 tabla) | 400–620 |
| L-422 | provider file 422 (D0v4-7 §8 tabla) | 400–620 |
| L-423 | provider file 423 (D0v4-7 §8 tabla) | 400–620 |
| L-424 | provider file 424 (D0v4-7 §8 tabla) | 400–620 |
| L-425 | provider file 425 (D0v4-7 §8 tabla) | 400–620 |
| L-426 | provider file 426 (D0v4-7 §8 tabla) | 400–620 |
| L-427 | provider file 427 (D0v4-7 §8 tabla) | 400–620 |
| L-428 | provider file 428 (D0v4-7 §8 tabla) | 400–620 |
| L-429 | provider file 429 (D0v4-7 §8 tabla) | 400–620 |
| L-430 | provider file 430 (D0v4-7 §8 tabla) | 400–620 |
| L-431 | provider file 431 (D0v4-7 §8 tabla) | 400–620 |
| L-432 | provider file 432 (D0v4-7 §8 tabla) | 400–620 |
| L-433 | provider file 433 (D0v4-7 §8 tabla) | 400–620 |
| L-434 | provider file 434 (D0v4-7 §8 tabla) | 400–620 |
| L-435 | provider file 435 (D0v4-7 §8 tabla) | 400–620 |
| L-436 | provider file 436 (D0v4-7 §8 tabla) | 400–620 |

### C.8 — UI R11 L-456..L-469 (individual file references)

Los 14 UI R11 findings son **primary rows** en B6 subcategoría 6.9 — lista individual D0v4-7 B4.

| L-#   | Archivo                                 | LOC |
| ----- | --------------------------------------- | --: |
| L-456 | useContentEditor                        | 492 |
| L-457 | VirtualScrollList                       | 405 |
| L-458 | ContentEditorCore                       | 393 |
| L-459 | TipTapContentEditor (also ORPHAN L-444) | 359 |
| L-460 | VersionCompactView (ORPHAN L-447)       | 344 |
| L-461 | useContentVersioning (ORPHAN L-453)     | 316 |
| L-462 | ContentVersioning (ORPHAN L-446)        | 299 |
| L-463 | contentVersioningTypes                  | 299 |
| L-464 | VersionTimelineView (ORPHAN L-448)      | 287 |
| L-465 | contentEditorTypes                      | 275 |
| L-466 | usePublishingEngine (ORPHAN L-442)      | 272 |
| L-467 | ValidationContentEditor (ORPHAN L-445)  | 261 |
| L-468 | use-toast                               | 229 |
| L-469 | useProviderConstraints (ORPHAN L-443)   | 215 |

### C.9 — Design token drift UI L-483..L-491

Los 9 design token findings son **absorbed en L-470** (i18n UI composite por afinidad temática + layer). Listados aquí individualmente para trazabilidad.

| L-#   | Archivo                      | Notas              |
| ----- | ---------------------------- | ------------------ |
| L-483 | 7 Version\* design tokens    | Migrate a Tailwind |
| L-484 | Version\* design tokens      | idem               |
| L-485 | Version\* design tokens      | idem               |
| L-486 | Version\* design tokens      | idem               |
| L-487 | Version\* design tokens      | idem               |
| L-488 | Version\* design tokens      | idem               |
| L-489 | ValidationContentEditor      | idem               |
| L-490 | VirtualScrollList            | idem               |
| L-491 | Design token drift composite | Primary row B6     |

### C.10 — Finding entries reservadas o asociadas

| L-#   | Descripción                          | Status                                             |
| ----- | ------------------------------------ | -------------------------------------------------- |
| L-529 | plan count discrepancy schema ↔ seed | Primary in B6 6.10 / may move to B3 reconciliation |
| L-624 | seed scripts no compilan             | Primary in B2 / cross-ref B1                       |
| L-625 | baseline-capture compilation errors  | Primary in B2 / candidate DELETE                   |

---

## §10. Glosario rápido

- **§5.7** — metodología PLAN_MAESTRO de greps robustos (pattern literal + template + BASE + count cross-check).
- **§5.8** — metodología PLAN_MAESTRO de lectura directa binaria ACTIVE vs DEAD vs PLANNED.
- **§5.9** — regla PLAN_MAESTRO "NO DELETE sin Edward". Cada finding DEAD requiere su validación antes de ejecutar.
- **Orphan** — código con 0 consumers detectables (confirmado por 4-grep exhaustivo).
- **Composite** — finding que absorbe N sub-findings. Un solo L-# representa el grupo.
- **Fake-AI** — UI label sugiere ML/AI cuando backend es rule-based o hardcoded.
- **Fake-persistence** — UI sugiere persistencia cuando no escribe a backend.
- **SILENT-NO-OP** — UI muestra success cuando backend falla/no opera.
- **BLOCKED_BY / BLOCKS_MANY** — dependencia explícita entre findings.

---

## §11. Log de cambios

| Fecha      | Cambio                                                        |
| ---------- | ------------------------------------------------------------- |
| 2026-04-21 | v1 — creación inicial tras cierre tramo D0-v4 (647 findings). |

---

**Fin de documento.** Para evidencia de cada finding ver `docs/audits/LATERAL_FINDINGS.md`. Para contexto de cada sprint ver `docs/audits/D0v4_<n>_*.md`. Para metodología ver `docs/audits/PLAN_MAESTRO.md`. Para síntesis arquitectónica ver `docs/audits/D0v4_8_INFRASTRUCTURE_REPORT.md` §12/§14/§15.

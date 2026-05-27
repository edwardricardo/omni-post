# Normalization Roadmap — Architecture & DX Improvements

> Roadmap operativo para normalizar prácticas, capturar conocimiento y endurecer las fundaciones del repo. Construido tras el cierre del workstream `application-services-to-core` (S1'→S5). Cada fase es trackeable: sub-items con estado, racional, esfuerzo, dependencias. Cada item con `OWNER` + `STATUS` se convierte en plan de implementación individual cuando se aborda.
>
> **Estados:** `PENDING` · `PLANNED` · `IN-PROGRESS` · `DONE (<commit-sha>)`
> **Esfuerzo:** `S` (½–1 día) · `M` (2–3 días) · `L` (1 semana) · `XL` (>1 semana)
> **Prioridad:** `P0` (bloqueante de features nuevos) · `P1` (alto valor, no bloqueante) · `P2` (mejora continua)

---

## 0. Tensiones reconocidas — el trade-off de nuestra arquitectura

Antes de listar los items, dejamos por escrito los costos reales de las decisiones arquitectónicas tomadas en S1'→S5 (hexagonal + DDD + CQRS + UoW + Sagas). No para revertirlas — son canon — sino para que el equipo entienda **por qué** las próximas decisiones de DX en este roadmap son necesarias.

### 0.1 Donde nuestra arquitectura sofisticada nos cuesta

- **Cognitive overhead.** Una feature trivial ("Posts") se reparte en ≥5 archivos en 4 directorios: entity (`@core/domain/entities/`), port (`@core/domain/repositories/`), use case (`@core/application/<context>/`), adapter (`apps/api/src/infrastructure/repositories/`), routes (`apps/api/src/<context>/`). El modelo modular Fastify clásico colapsa esto a 1 folder con 5 archivos juntos. Navegación y onboarding son 2-3× más lentos en nuestro modelo.
- **Velocidad de shipping.** Añadir un endpoint trivial requiere ≥4 archivos nuevos + DI wire + UoW si muta. Equipo pequeño con prioridad de feature-velocity sufre.
- **Hireability.** El TS dev promedio en 2026 conoce "Fastify modular + Next App Router + BullMQ". Conoce poco de DDD/CQRS/UoW/Sagas. Onboarding es lento por canon (NO por código sucio).
- **Lock-in arquitectónico positivo.** 30+ ports + 22 fitness functions + composition root + saga engine son deuda arquitectónica que te protege — pero también te ata. Pivots radicales cuestan.

**Compensación esperada de este roadmap:** los items de DX (Phase 1) y testing (Phase 3-4) reducen el cognitive overhead operativo. Los ADRs (Phase 1) cierran la brecha de hireability documentando los "por qué". El multi-tenant guard (Phase 2) y los chaos tests (Phase 4) hacen que la sofisticación pague — sin ellos, la sofisticación es solo overhead sin retorno.

### 0.2 Preferencias futuras sobre nuestra organización actual

Estos NO son items accionables — son notas para revisar en horizonte Q2/Q3 2026 cuando el equipo crezca o la complejidad lo justifique. Hoy NO se ejecutan.

- **Split de `@core/application/` en bounded contexts separados** (`packages/billing`, `packages/auth`, `packages/ai`, `packages/compliance`). DDD canon = un package por bounded context. Hoy todo vive en `@core/application/` para simplicidad de packaging; sacrificamos boundary enforcement DDD real por facilidad. Cuando el repo tenga 5-10 contextos maduros + 5+ developers, el split valdrá la pena.
- **Triada `packages/queue-types` + `queue-client` + `queue-worker`** vs nuestro `@adapters/queue-bullmq` que mezcla las tres responsabilidades. La separación canónica es más limpia. Hoy es over-engineering para nuestro caso; futuro cuando workers escalen sí.

> **Reglas para revisar §0.2:** trigger event = nuevo bounded context #6 (hoy tenemos billing/security/settings/compliance/webhooks/ai/auth = 7) **o** worker process #4 (hoy tenemos 1 entry apps/workers). Si llega cualquiera de los dos, abre item en Phase 5.

---

## Fase 1 — Documentación y DX (low-effort, high-foundation)

> Objetivo: capturar conocimiento mientras está fresco, reducir fricción diaria. Sin cambios de código de runtime.

### 1.1 ADRs retroactivos de las decisiones S0→S5 — `P1` · `M` · `STATUS: DONE`

**Qué:** capturar las decisiones arquitectónicas importantes ya tomadas como ADRs versionados en `docs/technical/` (alineado a `ADR-0001-agent-orchestration.md` existente, no `docs/decisions/` como inicialmente propuesto).

**ADRs creados (12 nuevos + `ADR-0001` existente):**

| #        | Título                                                                          | Fuente principal                       |
| -------- | ------------------------------------------------------------------------------- | -------------------------------------- |
| **0001** | Agent Orchestration Engine and Schema-Validated Provider Substrate              | (pre-existente, 2026-05-19)            |
| **0002** | Hexagonal Architecture (Ports & Adapters) over Modular Fastify                  | CLAUDE.md §Architecture                |
| **0003** | DDD — Entity / Value Object / Aggregate / Domain Events                         | CLAUDE.md §Domain-Driven Design        |
| **0004** | CQRS — Command vs Query separation                                              | CLAUDE.md §CQRS                        |
| **0005** | Unit of Work with `PrismaUnitOfWork` + `AsyncLocalStorage`                      | CLAUDE.md §Unit of Work                |
| **0006** | `Result<T, E>` over thrown exceptions cross-layer                               | CLAUDE.md §Result Type                 |
| **0007** | Dependency Injection — Composition Root with 130+ tokens                        | CLAUDE.md §Dependency Injection        |
| **0008** | Saga Pattern canon-aligned (Richardson + Azure §4-20)                           | CLAUDE.md §Saga Pattern                |
| **0009** | Promote `Permission` enum to `@core/domain/auth/`                               | S4.4 (`ee8d4a0`) + S5 (`1734890`)      |
| **0010** | Promote AI contracts (`AIProvider`/`AITask`/`AIResponse`) to `@core/domain/ai/` | S4.3 (`262faaf`)                       |
| **0011** | `application-services-to-core` workstream closure (S1'→S5)                      | 22 commits del workstream              |
| **0012** | 22 Fitness Functions as architecture-test layer                                 | CLAUDE.md §Automated Compliance Checks |
| **0013** | 3-logger factory model + redaction (apps/api / packages / browser)              | CLAUDE.md §Logging                     |

**Formato:** cada ADR sigue el template `ADR-0001` (Status / Date / Deciders / Supersedes / Superseded by / Context / Decision / Rationale / Alternatives Considered / Consequences / Revisit if / Risks and Mitigations / References).

**Por qué importa:** captura el "por qué" de las decisiones arquitectónicas mientras está fresco; cierra la brecha pre-acquisition due-diligence.

**Dependencias:** ninguna. Pure doc.

**Definition of done (✅):** 12 ADRs en `docs/technical/`, bullet en CLAUDE.md §Documentation Policy apuntando al pattern `docs/technical/ADR-NNNN-*.md`, formato matchea ADR-0001, numeración consecutiva sin huecos.

---

### 1.2 CLAUDE.md split en 5 documentos — `P1` · `M` · `STATUS: DONE (d3d8e24)`

**Qué:** Splitting CLAUDE.md (1100+ líneas hoy) en:

- `CLAUDE.md` → ~400 líneas: dev commands, project structure, "cómo trabajar con Claude" feedback rules, ATAJOS frecuentes
- `docs/architecture/ARCHITECTURE_CANON.md` → hexagonal, DDD, CQRS, UoW, Saga, DI (~300 líneas)
- `docs/development/CODING_STANDARDS.md` → JSDoc, naming, TypeScript strict, comments (~200 líneas)
- `docs/security/SECURITY_CANON.md` → secrets, auth, RBAC, fitness #15-17, CWE-798 (~150 líneas)
- `docs/observability/LOGGING_CANON.md` → 3-logger model, redaction, cache, scheduler (~100 líneas)

CLAUDE.md operativo queda ágil; los 4 hijos se cargan bajo demanda cuando el contexto lo requiere (Claude tools, dev consulta).

**Por qué importa:** cada sesión Claude paga el costo de cargar todo CLAUDE.md en contexto. Splitting reduce el footprint operativo. Bonus: los 4 hijos son auditables por área (security review = solo lee SECURITY_CANON.md).

**Dependencias:** ninguna. Mover contenido manualmente.

**Definition of done:** 5 archivos final, CLAUDE.md reducido ≥60%, cross-links explícitos, fitness function checks que cada hijo tiene su §"How to extend" + dueño. ✅ Closure: 4 children creados (ARCHITECTURE_CANON, CODING_STANDARDS, SECURITY_CANON, LOGGING_CANON) en sus paths canónicos, CLAUDE.md 1183→454 líneas (**62% reducción**), `@`-imports auto-cargan los 4 hijos al startup (verificado contra [Claude Code memory docs](https://code.claude.com/docs/en/memory)), fitness #24 valida existencia + §"How to extend" + `**Owner:**` con anti-borrado guardrail probado.

---

### 1.3 Sección "Cuándo NO seguir el canon" en CLAUDE.md — `P2` · `S` · `STATUS: PENDING`

**Qué:** Añadir una sección §"Pragmatic Exceptions" con escenarios donde es OK saltarse parte del canon:

- One-off migration scripts: no necesitan UoW + ports
- Prototype branches: feature flags + RFC pueden saltar TDD strict
- Bug-fix hotpatches: pueden saltar coverage gate con `// canon-exception: hotfix Pxxx` comment + ADR follow-up obligatorio
- Spike work: puede usar `any` + `// SPIKE` comment con TTL <2 semanas

Hoy CLAUDE.md es 100% prescriptivo ("DEBE", "NUNCA", "MANDATORY"). Sin escape hatch, o respetas canon (lento) o lo violas en silencio (peor).

**Por qué importa:** dar válvula de escape EXPLÍCITA elimina el incentivo de violar canon en silencio.

**Dependencias:** después de 1.2 (split), porque la sección va en CLAUDE.md operativo.

**Definition of done:** sección §"Pragmatic Exceptions" en CLAUDE.md con 4-6 escenarios documentados + ejemplo de ADR follow-up obligatorio.

---

### 1.4 Test env normalization — `P1` · `S` · `STATUS: DONE (d0961f5)`

**Qué:** Hoy `pnpm exec vitest run <single-file>` falla con env-validation errors porque vitest no carga `.env.test` cuando corres un archivo aislado. Lo vimos 3+ veces durante S3.4c/S4.1/S4.3.

**Opciones (escoger una):**

- **A)** `vitest.config.ts` con `setupFiles` global que carga `.env.test` antes de cualquier import (`import "dotenv/config"`)
- **B)** `vitest projects` con env-config por scope (unit / integration / e2e)
- **C)** Alias en `package.json`: `"test:single": "dotenv -e .env.test -- vitest run"`

**Recomendación:** A) es la más simple y resuelve 100% de casos.

**Por qué importa:** deuda chiquita pero recurrente. Costo de fricción acumulado en cada sesión.

**Dependencias:** ninguna.

**Definition of done:** `pnpm --filter @apps/api exec vitest run tests/unit/security/PlatformCredentialService.test.ts` pasa sin tocar nada más. ✅ Closure: Opción A implementada (`apps/api/tests/setup-env.ts` + `apps/workers/tests/setup-env.ts` registrados como `setupFiles`); `.env.test.example` tracked template; `test.env` workaround removed de ambos vitest configs; docs en `docs/architecture/secrets-and-env.md` §"Test environment". Full suite 498/498 archivos, 7961/7961 tests.

---

### 1.5 Mover este roadmap + referenciar desde CLAUDE.md — `P2` · `S` · `STATUS: DONE (2386f00)`

**Qué:** El propio doc que estás leyendo (`docs/architecture/NORMALIZATION_ROADMAP.md`) vive en docs/architecture/. Necesita:

- Link explícito desde CLAUDE.md §"Project Structure" → "Normalization roadmap"
- Entrada en `canon_research_index.md` o MEMORY apuntando aquí
- Entrada en `MEMORY.md` bajo Workstreams

**Por qué importa:** sin discoverability, el roadmap se olvida. Yo en sesión futura no lo encuentro = se pierde.

**Dependencias:** ninguna.

**Definition of done:** este doc existe + 2 links desde otros files + entrada en MEMORY. ✅ Closure: link añadido en `CLAUDE.md §Documentation Policy` + entrada en memoria `project_workstreams_index.md`. Links pre-existentes en `docs/product/IMPLEMENTATION_PLAN_ES.md`, ADR-0009/10/11, `docs/architecture/secrets-and-env.md`, `docs/security/MULTI_TENANT_AUDIT_2026-05-27.md`.

---

### 1.6 Auto-load feedback memories via `@`-imports en CLAUDE.local.md — `P2` · `M` · `STATUS: PENDING`

**Qué:** Replicar el approach de `@`-import (canon en §1.2) para los feedback memories de Claude (`~/.claude/projects/-root-omni-post/memory/feedback_*.md`). Hoy solo las primeras 200 líneas / 25KB de `MEMORY.md` se auto-cargan; cada `feedback_*.md` individual requiere que Claude lo lea manualmente cuando MEMORY.md lo lista como relevante. Resultado: feedback discipline depende de mi consciencia en cada turno (probadamente falible).

**Opciones:**

- **A)** Curar un subset alto-impacto de feedbacks y agregarlos como líneas `@~/.claude/projects/-root-omni-post/memory/feedback_X.md` en `CLAUDE.local.md` (gitignored, per-dev). Auto-carga garantizada.
- **B)** Crear un nuevo archivo `~/.claude/feedback_index.md` con `@`-imports a todos los feedbacks (depth 1) + agregar `@~/.claude/feedback_index.md` en CLAUDE.local.md (depth 2, dentro del límite de 4 hops).
- **C)** Mantener status quo + agregar enforcement vía hooks que recuerden leer feedbacks específicos cuando se detecte patrón asociado.

**Por qué importa:** auto-memory's first-200-lines rule es un techo bajo. Feedbacks olvidados = patterns repetidos que ya tengo documentados ("don't anchor on remediation plan", "robustez sobre velocidad", "feedback_three_questions_before_delete"). Edward los teclea repetidamente.

**Dependencias:** §1.2 (probar el `@`-import pattern primero — DONE). Empezar tras esto.

**Definition of done:** subset curado de feedbacks (5-10) auto-cargado vía `@`-imports en `CLAUDE.local.md`, verificado vía `/memory`. Re-evaluación al cierre: ¿reduce las repeticiones de Edward? Si sí, expandir el subset.

---

## Fase 2 — Seguridad fundacional (BLOQUEANTE de features nuevos)

> Objetivo: cerrar gaps de seguridad que crecen con cada feature nueva. Una vez cerrados, dejas de pagar interés sobre el technical debt.

### 2.1 Multi-tenant isolation guards — `P0` · `L` · `STATUS: DONE (S2.1a 14ccd64 · S2.1b f9b8db8 · S2.1c 4b29ac8 · S2.1d 468a608)`

**Qué:** En un SaaS multi-tenant, **un missed `where: { accountId }` = data leak entre cuentas**. Hoy depende de que cada use case lo recuerde. Necesitamos defense-in-depth.

**Implementación (3 capas, cumulative):**

1. **Prisma extension middleware** que requiere `accountId` (o `userId`) en where para tablas multi-tenant. Si no está presente, **throw** en dev + log-and-error en prod. Lista de tablas en denylist explícita (Account no necesita, Post sí necesita).
2. **PostgreSQL Row Level Security (RLS)** — habilitar RLS en las tablas multi-tenant + `app.account_id` session variable seteada en `PrismaUnitOfWork.executeInTransaction` desde el AsyncLocalStorage context. Backup line of defense vs missed middleware.
3. **Fitness function #23**: grep que detecte `prisma.<tenantTable>.findMany|findFirst|update|delete` sin `accountId` en where dentro del adapter — bloquea PRs que introduzcan violaciones.

**Por qué importa:** failure #1 que mata SaaS B2B. Prevención cuesta 10x menos que retrofit post-incidente. **Pre-acquisition diligence checker mira esto.**

**Dependencias:** ninguna técnica; sí dependencia de scoping (qué tablas son multi-tenant y cuáles globales — requiere recon de schema.prisma).

**Definition of done:**

- ✅ Lista de tablas multi-tenant en `docs/security/MULTI_TENANT_GUARDS.md`
- ✅ Prisma `$extends` guard activo + 19 unit tests
- ✅ RLS migration applied (51 policies) + 11 integration tests via non-superuser role
- ✅ Fitness #23 hard-zero en CI
- ✅ Audit retroactiva + pgvector fixes (`docs/security/MULTI_TENANT_AUDIT_2026-05-27.md`)
- ⏭ ADR 0014 (TBD) — deferred al rotation pass; el detalle vive ya en MULTI_TENANT_GUARDS.md

---

### 2.2 Coverage + mutation gates en CI — `P1` · `M` · `STATUS: PENDING`

**Qué:** CLAUDE.md declara coverage targets (90% domain, 85% app, 70% infra/routes/providers) y Stryker está configurado, pero no son gates de CI hoy.

**Implementación:**

- `vitest.config.ts` con `coverage.thresholds.global.{lines,branches,functions,statements}` por scope
- CI step que falla si coverage baja del threshold
- Stryker schedule nightly con mutation score threshold (>60% para domain)
- Sentry o GitHub Actions notify si nightly mutation cae <threshold

**Por qué importa:** **Documented-but-not-enforced** es el peor estado — todos asumen que pasa. Hoy coverage targets existen como aspiración, no como gate.

**Dependencias:** 1.4 (test env normalization, porque coverage corre tests).

**Definition of done:** PR a `main` falla si coverage < threshold. Stryker nightly publica reporte. Sentry/Slack alerta si baja.

---

## Fase 3 — Contract enforcement & external integration testing

> Objetivo: prevenir regressions silenciosas en boundaries externos (frontend↔backend) y upstream APIs (providers).

### 3.1 OpenAPI auto-gen + tipos frontend — `P1` · `M` · `STATUS: PENDING`

**Qué:** Fastify es schema-first; podemos exportar OpenAPI spec auto-generado, consumido por admin/client como **tipos generados** vía `openapi-typescript`.

**Implementación:**

- Fastify `@fastify/swagger` plugin (probablemente ya está) → expone `/openapi.json`
- Script `pnpm generate:api-types` que corre `openapi-typescript` → `packages/shared/src/api-types.generated.ts`
- Admin/client importan estos tipos en `lib/api-client.ts`
- CI step: regenera tipos + falla si difieren del committed (prevents drift)

**Por qué importa:** hoy frontend acoplado a DTOs API por convención + tests MSW. Si API renombra `email` → `emailAddress`, frontend rompe en runtime no en typecheck. Con tipos generados → rompe en typecheck. Ganas confidence cross-app sin trabajo manual.

**Dependencias:** ninguna técnica.

**Definition of done:** `packages/shared/src/api-types.generated.ts` checked in + CI gate de "no drift" + admin/client consumiendo al menos 3 endpoints con tipos generados.

---

### 3.2 Provider sandbox + contract tests — `P1` · `L` · `STATUS: PENDING`

**Qué:** 11 social providers + Stripe + Paddle. Hoy todos están unit-tested con mocks (`vi.fn()` de HTTP). **No atrapan** cambios de API upstream. Recomendación:

- **Sandbox tests scheduled (nightly)** contra Stripe test mode + Paddle sandbox + provider sandbox APIs (Meta, X, LinkedIn, TikTok, YouTube tienen test modes)
- **Contract tests** con MSW-recorded fixtures (`pollyjs` o `nock-record`) para los providers que NO tienen sandbox; refresh cuotidiano
- **DLQ + Sentry alert chain** para fallos en producción

**Por qué importa:** defense-in-depth real para una plataforma multi-provider. Sin esto, descubres breaking changes de upstream **en producción**.

**Dependencias:** Stripe test keys + Paddle sandbox account + provider sandbox apps registrados.

**Definition of done:**

- 11 providers + Stripe + Paddle con sandbox/contract tests
- Nightly job que corre estos tests
- Sentry alert si falla
- Runbook `docs/runbooks/provider-contract-failure.md`

---

## Fase 4 — Resiliencia, observabilidad operativa, chaos

> Objetivo: probar que el sistema sobrevive a fallos reales en infraestructura distribuida. Lo que las fases anteriores construyen, esta lo estresa.

### 4.1 Saga + Outbox chaos testing — `P1` · `L` · `STATUS: PENDING`

**Qué:** Tienes saga engine canon-aligned (Richardson + Azure §4-20) + outbox pattern. **Críticos** para correctness distribuida. Pero los unit tests no atrapan:

- `kill -9` en medio de un saga step → ¿el recovery scheduler lo retoma correctamente?
- Outbox relay crashea entre `SELECT FOR UPDATE` y `mark PROCESSED` → ¿se re-publica?
- BullMQ worker pierde conexión Redis a mitad de job → ¿stalled detection funciona?

**Implementación:**

- Test suite separada `apps/api/tests/chaos/` que:
  - Lanza saga real
  - Kills proceso aleatoriamente en momentos del lifecycle
  - Verifica invariantes post-recovery (idempotencia, eventually-completed)
- Schedule: cron nightly weekly (caro para CI continuo)
- Reporte en `docs/reports/chaos-<date>.md`

**Por qué importa:** los sagas + outbox son los componentes con mayor "blast radius" de un bug. Falla silenciosa = inconsistencia de estado entre tu DB y Stripe/Paddle.

**Dependencias:** test env funcionando bien (1.4) + sandbox tests funcionando (3.2).

**Definition of done:** suite chaos verde nightly + ≥3 escenarios cubiertos + runbook por escenario.

---

### 4.2 Observability operativa: dashboards + alerts + runbooks — `P1` · `L` · `STATUS: PENDING`

**Qué:** Tienes Pino + OTel + métricas Prometheus + Sentry inicializado. Pero no vi:

- Grafana dashboards versionados en repo (`docker-compose` los crea fresh, no persist)
- Alertas Prometheus declaradas como código
- SLO targets por endpoint (p99 latency, error rate)
- Runbooks por alerta

**Implementación:**

- `infra/grafana/dashboards/*.json` versionados (api-latency, worker-throughput, saga-health, outbox-lag, dlq-size, billing-events)
- `infra/prometheus/alerts/*.yml` con rules versionadas
- `docs/runbooks/<alert-name>.md` con investigación + remediation steps
- SLO targets documentados en `docs/observability/SLO.md`

**Por qué importa:** observability sin alertas + runbooks = solo logs después del incidente. No es prevención, es post-mortem.

**Dependencias:** ninguna técnica; sí coordinación con quien-sea-que-tenga-acceso a la stack Grafana/Prometheus en homelab/prod.

**Definition of done:** dashboards versionados + ≥10 alertas declaradas + runbook por cada una.

---

### 4.3 Data retention enforcement E2E + GDPR compliance verification — `P2` · `M` · `STATUS: PENDING`

**Qué:** `ComplianceService.runRetentionCleanup` existe pero:

- ¿Se ejecuta scheduled en prod? (BackgroundTaskScheduler debe tenerlo registrado)
- ¿Hay tests E2E que verifiquen que datos > retention period **realmente se borran**?
- ¿DSAR EXPORT genera dump real y `exportUrl` expira a los 7 días?
- ¿Breach notification fanout funciona end-to-end?

**Implementación:**

- E2E test que: crea audit log con `createdAt` artificial -100 días, corre `runRetentionCleanup`, verifica que se borró
- E2E test que: somete DSAR EXPORT, espera procesamiento, verifica dump + URL
- Documento `docs/compliance/RETENTION_CALENDAR.md` con qué se borra, cuándo, por jurisdicción

**Por qué importa:** GDPR/LGPD/CCPA enforcement REAL, no solo código que dice "lo hace". Esto sí se mira en compliance audit pre-acquisition.

**Dependencias:** Phase 2 (multi-tenant guards) — para asegurar que el cleanup respeta isolation.

**Definition of done:** 3 E2E tests + retention calendar + scheduled job verificado activo en prod.

---

## Fase 5 — Refactors estructurales (long-term, no urgentes)

> Objetivo: capturar mejoras estructurales mayores propuestas por el canon genérico monorepo 2026 — **no se ejecutan ahora** pero quedan registradas para revisión Q2/Q3 2026 según trigger events de §0.2.

### 5.1 Split `@core/application/` en bounded contexts separados — `P2` · `XL` · `STATUS: DEFERRED`

**Qué:** Re-organizar `@core/application/{billing,auth,ai,compliance,security,settings,webhooks}/` a paquetes top-level: `packages/billing`, `packages/auth`, `packages/ai`, etc. — un package por bounded context (DDD canon).

**Trigger event:** ver §0.2. Se abre como item live cuando:

- Bounded context #8 aparece, o
- Equipo crece a 5+ developers, o
- Aparece evidencia clara de boundary violation cross-context

**Por qué se difiere:** hoy todo en `@core/application/` es simplicidad de packaging. Beneficio del split (boundary enforcement DDD real, build paralelismo, deployment independence si llegara) no justifica el costo (32-file refactor + 130+ token reassignments) en este momento.

**Definition of done (cuando se ejecute):** un package por bounded context + depcruise rules entre packages + 0 imports cross-context fuera de ports compartidos.

---

### 5.2 Triada `queue-types` + `queue-client` + `queue-worker` separada — `P2` · `L` · `STATUS: DEFERRED`

**Qué:** Hoy `@adapters/queue-bullmq` mezcla las tres responsabilidades (tipos de jobs, enqueuer, base classes de workers). El canon separa en 3 packages.

**Trigger event:** worker process #4 (hoy hay 1 entry `apps/workers`), o equipo de workers crece a 3+ devs.

**Definition of done (cuando se ejecute):** 3 packages + apps/api consume `queue-client` + apps/workers consume `queue-worker` + `queue-types` es leaf-dep de ambos.

---

## Tracking + handoff

### Cómo trackear

Cada item arriba con `STATUS: PENDING` se convierte en un plan de implementación individual cuando se aborda. Workflow propuesto:

1. Edward selecciona item → "abre" planning session
2. Claude genera plan detallado en `/root/.claude/plans/<nombre>.md` (plan mode)
3. Edward aprueba → ejecución
4. Al cierre: actualizar `STATUS: DONE (<commit-sha>)` aquí + cross-link al ADR si aplica

### Priority queue recomendada (next 4 sprints)

1. **Sprint 1 (esta semana, BLOQUEANTE):** 2.1 Multi-tenant guards + 1.1 ADRs retroactivos.
2. **Sprint 2:** 1.4 Test env normalization + 1.2 CLAUDE.md split + 1.3 Pragmatic Exceptions + 1.5 Mover roadmap.
3. **Sprint 3:** 2.2 Coverage gates + 3.1 OpenAPI auto-gen.
4. **Sprint 4 (paralelo a features):** 3.2 Provider sandbox + 4.1 Saga chaos.

Phase 4.2 (Observability), 4.3 (GDPR E2E), y Phase 5 (refactors) se intercalan con features del implementation roadmap principal según oportunidad.

### Cómo se relaciona con el implementation roadmap principal

**Este roadmap NO reemplaza** el implementation roadmap de features (productos/funcionalidades). Lo complementa:

- **Implementation roadmap** = QUÉ build (features, productos, integraciones).
- **Normalization roadmap (este)** = CÓMO build (fundaciones, DX, seguridad, resiliencia).

Sprint 1 de este roadmap (multi-tenant guards + ADRs) se ejecuta **antes** del próximo feature del implementation roadmap. Sprint 2-4 se intercalan o corren paralelo. Phase 5 espera triggers.

---

## Changelog del propio roadmap

| Fecha      | Cambio                                                                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-27 | Documento creado tras cierre del workstream application-services-to-core. Incorpora trade-offs reconocidos + recomendaciones operativas surgidas en sesiones S1'→S5. |

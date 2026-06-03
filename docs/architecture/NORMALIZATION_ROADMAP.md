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

Estos eran items DEFERRED en el roadmap inicial. **Realineación 2026-05-28 audit**:

- **Split de `@core/application/` en bounded contexts separados** (`packages/core/<context>/`). DDD canon = un package por bounded context. **Trigger event CUMPLIDO** (re-evaluación 2026-05-28): el contador inicial de §0.2 era "7 contexts" (estimación heurística); recon real durante §5.1.a reveló **46 bounded contexts** dentro de `@core/application/src/` + **11 cross-context boundary violations** (ai→embeddings/security, inbox→guardrails/mentions, mentions→notifications, bulk-scheduling/recurring→posts, glossary/style-guide→embeddings, tasks→mentions, settings→security). El gate "team-size 5+ devs" NO aplica a este equipo (Edward + Claude); fue heredado del canon genérico monorepo 2026. **Status:** §5.1 abierto como IN-PROGRESS — ver §5.1 abajo para detalle.
- **Triada `packages/queue-types` + `queue-client` + `queue-worker`** vs nuestro `@adapters/queue-bullmq` que mezcla las tres responsabilidades. La separación canónica es más limpia. **Trigger event NO cumplido** (re-evaluación 2026-05-28): hoy 1 worker entry `apps/workers`, sin fricción operativa detectada. **Status:** §5.2 sigue DEFERRED legítimamente.

> **Reglas para revisar §0.2:** triggers explícitos por item — ver cada §5.x. Counter de bounded contexts ya no es heurística (46 contexts reales en `packages/core/application/src/`); el trigger gate real es boundary violation evidence + cost-benefit del refactor.

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

### 1.3 Sección "Cuándo NO seguir el canon" en CLAUDE.md — `P2` · `S` · `STATUS: DONE (df6bc5b)`

**Qué:** Añadir una sección §"Pragmatic Exceptions" con escenarios donde es OK saltarse parte del canon:

- One-off migration scripts: no necesitan UoW + ports
- Prototype branches: feature flags + RFC pueden saltar TDD strict
- Bug-fix hotpatches: pueden saltar coverage gate con `// canon-exception: hotfix Pxxx` comment + ADR follow-up obligatorio
- Spike work: puede usar `any` + `// SPIKE` comment con TTL <2 semanas

Hoy CLAUDE.md es 100% prescriptivo ("DEBE", "NUNCA", "MANDATORY"). Sin escape hatch, o respetas canon (lento) o lo violas en silencio (peor).

**Por qué importa:** dar válvula de escape EXPLÍCITA elimina el incentivo de violar canon en silencio.

**Dependencias:** después de 1.2 (split), porque la sección va en CLAUDE.md operativo.

**Definition of done:** sección §"Pragmatic Exceptions" en CLAUDE.md con 4-6 escenarios documentados + ejemplo de ADR follow-up obligatorio. ✅ Closure: sección añadida en CLAUDE.md (líneas 174-237) con tabla de 6 escenarios permitidos (migration, prototype, hotpatch, spike, test-fixture, generated code), lista explícita de "forbidden — no exception" (security/multi-tenant/DI/@layer), ADR template + reviewer protocol + audit grep command. CLAUDE.md ahora 528 líneas (sigue < 550 bound).

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

### 1.6 Auto-load feedback memories via `@`-imports en CLAUDE.local.md — `P2` · `M` · `STATUS: DONE-Phase-1 (eed703a) + DONE-Phase-2 (8dea6aba)`

**Qué:** Replicar el approach de `@`-import (canon en §1.2) para los feedback memories de Claude (`~/.claude/projects/-root-omni-post/memory/feedback_*.md`). Hoy solo las primeras 200 líneas / 25KB de `MEMORY.md` se auto-cargan; cada `feedback_*.md` individual requiere que Claude lo lea manualmente cuando MEMORY.md lo lista como relevante. Resultado: feedback discipline depende de mi consciencia en cada turno (probadamente falible).

**Opciones:**

- **A)** Curar un subset alto-impacto de feedbacks y agregarlos como líneas `@~/.claude/projects/-root-omni-post/memory/feedback_X.md` en `CLAUDE.local.md` (gitignored, per-dev). Auto-carga garantizada.
- **B)** Crear un nuevo archivo `~/.claude/feedback_index.md` con `@`-imports a todos los feedbacks (depth 1) + agregar `@~/.claude/feedback_index.md` en CLAUDE.local.md (depth 2, dentro del límite de 4 hops).
- **C)** Mantener status quo + agregar enforcement vía hooks que recuerden leer feedbacks específicos cuando se detecte patrón asociado.

**Por qué importa:** auto-memory's first-200-lines rule es un techo bajo. Feedbacks olvidados = patterns repetidos que ya tengo documentados ("don't anchor on remediation plan", "robustez sobre velocidad", "feedback_three_questions_before_delete"). Edward los teclea repetidamente.

**Dependencias:** §1.2 (probar el `@`-import pattern primero — DONE). Empezar tras esto.

**Definition of done:** subset curado de feedbacks (5-10) auto-cargado vía `@`-imports en `CLAUDE.local.md`, verificado vía `/memory`. Re-evaluación al cierre: ¿reduce las repeticiones de Edward? Si sí, expandir el subset.

✅ **Phase-1 Closure (eed703a, 2026-05-27)**: 51 feedback memories consolidados en 5 archivos temáticos (`~/.claude/feedback/workflow.md`, `canon-research.md`, `audit-deletion.md`, `runtime-contract.md`, `tools-infra.md`, ~960 LOC total); `CLAUDE.local.md` creado en repo root (gitignored) con `@`-imports a los 5; originales archivados en `~/.claude/projects/-root-omni-post/memory/feedback_archive/`; `MEMORY.md` Feedback section colapsada a un puntero.

🚨 **Phase-1 Re-evaluación honesta (2026-05-28)**: el sistema `@`-imports cargado solo NO redujo las repeticiones de Edward. Evidence: en la sesión §5.1.b yo cerré con 7 absolute path cross-bounded-context imports (`@core/security/X` desde inside `packages/core/application/src/ai/`) y los justifiqué como puente temporal hasta §5.1.c — eso es time-bomb que `feedback/canon-research.md §no-time-bombs` prohíbe explícitamente. Edward intervino: _"se supone que fue tu recomendación y que los pondrías en práctica… ya estoy cansado de estar recordándote… necesitamos conseguir la manera de obligarte a cumplirlo si no lo quieres hacer por tu cuenta"_. Root cause: el cargo vía `@`-import garantiza que el contenido esté en context, pero NO obliga la aplicación deliberada en cada decision point. La discipline-by-self falló.

✅ **Phase-2 Closure (8dea6aba, 2026-05-28)** — Hard-blocking enforcement: convierte canon de "context dump" a "checkpoint obligatorio" mediante tres piezas:

1. **CLAUDE.md §"Mandatory Pre-Action Triggers (Tripwires)"** — sección nueva con tabla de tripwire patterns que el hook detecta. Patterns cubiertos:
   - Comments con 20 anti-pattern signature words (EN+ES) derivados de grep en `~/.claude/feedback/` + `feedback_archive/` (extensión 2026-05-28).
   - `// TODO §X.Y` markers (defers a fase futura indefinida).
   - `// canon-exception:` sin scenario de la allowed list.
   - Cross-bounded-context imports inside `packages/core/<b>/src/` referencing `@core/<a>/` where `a ∉ {b, domain, embeddings, application}`.
2. **`.claude/commands/canon-check.md`** slash command — fuerza protocol: re-leer canon, listar applicable rules con verdict ✅/❌ per rule, emit canon-check line, OR REJECTED con alternativa.
3. **`.claude/hooks-py/pre_edit_tripwire_blocker.py`** (registrado en `.claude/settings.json` como tercer hook PreToolUse en `Edit|Write|MultiEdit`) — bloquea via `exit 2 + stderr` (hard-block). Skip `.md` / `.mdx` files (documentación legítimamente cita los patterns como referencia). Bypass priorities: (a) `canon-check:` signature en último assistant message del transcript (regex `^canon-check:\s*\S+\.md\s+§\S.*?\s+[—\-]\s+.+`), (b) token `omnipost-allow tripwire-override` (15 min TTL, mismo contrato que `sensitive-edit`), (c) env var `EDWARD_AUTHORIZED_TRIPWIRE=yes` (case-by-case, auditado en `.claude/heuristic-overrides.log`). Bloqueos quedan en `.claude/tripwire-blocks.log`.

**Test suite (6 escenarios + 14 nuevos patterns, todos verdes en commit 8dea6aba+actual)**: time-bomb comment sin bypass → BLOCK, cross-bounded-context import sin bypass → BLOCK, clean diff → ALLOW, tripwire + env var → ALLOW, tripwire + canon-check signature → ALLOW, tripwire + canon-check malformed → BLOCK. Identifiers como `patchedConfig`/`stubInstance` → ALLOW (word-boundary regex impide false positives en código legítimo).

**Coverage honesta (~80-90%)**: cubre patterns grep-ables (signatures de workaround en código). Gaps: decisions cognitivas puramente conversacionales antes de file changes, patterns no listados en `TRIPWIRE_PATTERNS`. Edward sigue como reviewer último para esos gaps; el hook reduce load porque los workaround signatures predecibles se bloquean automáticamente. Iteración: cada nuevo gap detectado → agregar pattern al hook + ADR si aplica.

**Cómo Edward me activa** (manual de uso documentado en CLAUDE.md §Mandatory Pre-Action Triggers): hablar normal — el hook se dispara automático. Keywords para forzar revisión: `"qué canon aplica?"`, `"muéstrame el canon-check"`, `"verificá canon antes"`. Para emergencias: `omnipost-allow sensitive-edit` (el mismo token gatea sensitive-paths y tripwire bypass).

⏭ **Phase-3 PENDING** (ramp-up): conforme detectemos nuevos patterns que se filtren por el hook actual, agregar a `TRIPWIRE_PATTERNS` + actualizar la tabla en CLAUDE.md §Mandatory Pre-Action Triggers (How-to-extend section).

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
- ✅ ADR-0014 — Multi-tenant isolation guards, 3-layer defense (`docs/technical/ADR-0014-multi-tenant-isolation-guards.md`, 2026-05-28)

---

### 2.2 Coverage + mutation gates en CI — `P1` · `M` · `STATUS: DONE-Phase-A1 (5934b37) + DONE-Phase-A2 (7adb7518)` · follow-up §2.2.b

**Qué:** CLAUDE.md declara coverage targets (90% domain, 85% app, 70% infra/routes/providers) y Stryker está configurado, pero no son gates de CI hoy.

**Implementación:**

- `vitest.config.ts` con `coverage.thresholds.global.{lines,branches,functions,statements}` por scope
- CI step que falla si coverage baja del threshold
- Stryker schedule nightly con mutation score threshold (>60% para domain)
- Sentry o GitHub Actions notify si nightly mutation cae <threshold

**Por qué importa:** **Documented-but-not-enforced** es el peor estado — todos asumen que pasa. Hoy coverage targets existen como aspiración, no como gate.

**Dependencias:** 1.4 (test env normalization, porque coverage corre tests).

**Definition of done (clarified 2026-05-28 audit):** PR a `main` falla si coverage baja del threshold floor configurado en `vitest.config.ts` (vía `test:unit:coverage` corriendo en CI). Stryker nightly publica reportes uploadeados como artifact; corre con `continue-on-error: true` por design (Edward's intent: long-running variable-runtime health check, treated as informational trend signal, NOT an aspirational gate). Sentry/Slack alert PENDING para Phase B.

✅ **Phase A1 closure (5934b37, 2026-05-27):** `apps/api/vitest.config.ts` coverage block actualizado con per-scope threshold structure (domain + application + global, todos al floor 55/55/45 para no romper CI hoy) + reporters (`text`, `html`, `json-summary`) + `reportsDirectory`. Stryker thresholds confirmados intencionalmente calibrados por Edward (root break 52, batch-1 57). `test:unit:coverage` script ya existía en `apps/api/package.json` (no se duplicó).

✅ **Phase A2 closure (§2.2.a-CI, 2026-05-28):** `.github/workflows/ci.yml` test step migrado de `pnpm --filter @apps/api test` a `pnpm --filter @apps/api test:unit:coverage` + nuevo step "Upload coverage report" con `actions/upload-artifact@v4` (retention 14 days). CI ahora falla si coverage baja del floor configurado en `vitest.config.ts` (55/55/45 hoy). Cierre del DoD original "PR a main falla si coverage < threshold". Identificado como TIME-BOMB HIGH durante audit retroactivo §2 (hook tripwire active session 2026-05-28); el "follow-up de 10 LOC" de la closure original no era patch deferible — era el fix mismo del item.

⏭ **Phase B (§2.2.b, PENDING):** medir per-scope coverage actual (con la nueva CI run reportando per-scope vía `vitest --coverage`) + ratchet thresholds a aspiracional (domain 90, application 85, infra 70) en passes incrementales. Bloqueante: requiere data de al menos 1 CI run post-Phase A2 con `--coverage` (próximo push a main). Sentry/Slack alert para mutation drift también queda en este alcance.

🚨 **Stryker realignment (2026-05-28 audit)**: el DoD original decía "mutation score threshold (>60% para domain)" pero la implementación en `nightly.yml:67-72` es `continue-on-error: true` con comentario "treated as informational". La decisión técnica de Edward es correcta (mutation testing es noisy y long-running); el time-bomb era el roadmap aspirando a un gate que el workflow ya había descartado. Realignment: Stryker es informational signal (artifact upload + GitHub failure notification issue creation) — NO gate hard. La aspiración "Sentry/Slack alert si baja" queda en Phase B donde tiene sentido (data-driven trigger).

---

## Fase 3 — Contract enforcement & external integration testing

> Objetivo: prevenir regressions silenciosas en boundaries externos (frontend↔backend) y upstream APIs (providers).

### 3.1 OpenAPI auto-gen + tipos frontend — `P1` · `M` · `STATUS: DONE-Phase-A1 (f478128) + DONE-Phase-A2-drift-gate (927c59dd)` · follow-ups §3.1.b/c

**Qué:** Fastify es schema-first; podemos exportar OpenAPI spec auto-generado, consumido por admin/client como **tipos generados** vía `openapi-typescript`.

**Implementación:**

- Fastify `@fastify/swagger` plugin (probablemente ya está) → expone `/openapi.json`
- Script `pnpm generate:api-types` que corre `openapi-typescript` → `packages/shared/src/api-types.generated.ts`
- Admin/client importan estos tipos en `lib/api-client.ts`
- CI step: regenera tipos + falla si difieren del committed (prevents drift)

**Por qué importa:** hoy frontend acoplado a DTOs API por convención + tests MSW. Si API renombra `email` → `emailAddress`, frontend rompe en runtime no en typecheck. Con tipos generados → rompe en typecheck. Ganas confidence cross-app sin trabajo manual.

**Dependencias:** ninguna técnica.

**Definition of done:** `packages/shared/src/api-types.generated.ts` checked in + CI gate de "no drift" + admin/client consumiendo al menos 3 endpoints con tipos generados.

✅ **Phase A1 closure:**

- **Tooling canon-aligned**: tras recon descubrimos que `openapi-typescript` v7.13 tiene bug con Node 24 (transitive `@redocly@1.34` + `js-yaml@3.14`). Switched a `@hey-api/openapi-ts` v0.97.3 + `@hey-api/client-fetch` v0.13.1 (canon 2026, 2.7M downloads/week, backed Vercel/PayPal/Amazon).
- **Root cause fix**: agregado `transform: jsonSchemaTransform` al `@fastify/swagger` register en `apps/api/src/index.ts` — sin esto el spec emitía Zod raw (`{def: ...}`) y los tipos generados eran `{[key:string]: unknown}`.
- **Override removed**: el pnpm `js-yaml: 3.14.2` override (commit 3fd4203) forzaba a eslint/eslintrc DOWN a v3 cuando wants v4; removido sin breakage (eslint, secretlint, etc. siguen ok).
- **Generator pipeline**: `apps/api/scripts/dump-openapi-spec.ts` (bootea createApp + dumpea swagger spec a `/tmp`) + `scripts/generate-api-types.ts` (orquesta dump + openapi-ts + post-procesa `@file/@layer` headers JSDoc para survivar regen).
- **3 health routes migradas** (`/health`, `/health/live`, `/health/ready`) con response schemas Zod completos. Verificados en spec + tipos generados (`GetHealthResponses` ahora es `{status: 'healthy'|'degraded'|'unhealthy', timestamp, uptime?}`, no más `unknown`).
- **`packages/shared/src/api-generated/{types.gen.ts, index.ts}` committed** con 414 paths tipados (3 con responses reales, ~411 con responses `unknown` esperando migración progresiva).
- **Docs en `docs/architecture/openapi-migration.md`** con recipe + caveats + canon de fastify-type-provider-zod.

🚨 **DoD honest gap (2026-05-28 audit)**: el DoD original textual de §3.1 era _"`packages/shared/src/api-generated.ts` checked in + CI gate de 'no drift' + admin/client consumiendo al menos 3 endpoints con tipos generados"_. Phase A1 entregó solo el primer ítem (types committed, 414 paths). Los otros dos quedaron diferidos como "Phase B" pero el item estaba marked DONE-Phase-A1 — framing que ocultó que **el DoD textual NO estaba cumplido**.

✅ **Phase A2 closure (drift gate, 2026-05-28)**: `.github/workflows/ci.yml` job test agregó (1) step "Regenerate API types (OpenAPI drift gate)" que corre `pnpm generate:api-types`, (2) step "Verify no API-types drift" que `git diff --quiet packages/shared/src/api-generated/` y falla CI con `::error` annotation si hay drift. CI ahora bloquea PRs cuya regen no coincide con el checked-in copy. Cierre del DoD segundo ítem.

⏭ **Phase B (§3.1.b PENDING)**: migrar las ~342 rutas restantes a Zod schemas completos (params/query/body/response) — ~50-60h trabajo progresivo. Sin esta migración, `types.gen.ts` tiene 411 paths con response `unknown` (no aportan valor de tipo en consumidores).

⏭ **Phase C (§3.1.c PENDING — DoD tercer ítem original)**: wirear admin/client typed-clients consumiendo ≥3 endpoints con tipos generados. Bloqueado por §3.1.b (sin Zod schemas en backend → consumers no obtienen valor). Estimación: ~5-10h tras §3.1.b suficiente avance (≥3 endpoints con response Zod schemas concretos).

---

### 3.2 Provider sandbox + contract tests — `P1` · `L` · `STATUS: DONE-Phase-A1-railroad (30dc599) + DONE-Phase-A2-runbook (927c59dd)` · follow-ups §3.2.b/c/d

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

🚨 **DoD honest gap (2026-05-28 audit)**: el DoD original textual de §3.2 era _"11 providers + Stripe + Paddle con sandbox/contract tests, Nightly job que corre estos tests, Sentry alert si falla, Runbook `docs/runbooks/provider-contract-failure.md`"_. Phase A1 entregó solo el railroad MSW + 1 de 13 providers (Telegram, **7.7% del DoD**). Los otros 3 ítems quedaron diferidos como "Phase B/C/D" pero el item estaba marked DONE-Phase-A1 — framing que ocultó que **el DoD textual estaba 7.7% cumplido**.

✅ **Phase A1 closure (railroad, 30dc599, 2026-05-27)**: railroad MSW + proof-of-concept en Telegram (2 tests verdes). `msw@2.14.3` instalado (root devDeps, pinned). `packages/providers/shared/src/test-utils/msw-helpers.ts` con wrapper canónico. Alias vitest agregado a telegram. Template `_template/tests/integration/sandbox.template.test.ts` listo para copy-paste. Doc canon en `docs/architecture/provider-testing.md`. Tests `vi.fn()` existentes siguen verde (zero regression).

✅ **Phase A2 closure (runbook, 2026-05-28)**: `docs/runbooks/provider-contract-failure.md` creado como skeleton estructurado: síntoma, severidad (HIGH/MEDIUM/LOW por footprint), diagnóstico paso-a-paso (CI annotation → reproduce local → read diff → cross-check provider changelog → classify drift), resolución por clase (request shape vs response shape), production impact protocol, prevention. Links a 10 provider changelog URLs canónicos. Cierre del DoD cuarto ítem ("Runbook").

⏭ **Phase B (§3.2.b PENDING — DoD primer ítem)**: migrar 10 providers restantes a MSW handlers (x, instagram, facebook, youtube, tiktok, snapchat, pinterest, linkedin, bluesky, threads — Telegram ya done) — ~20h trabajo progresivo. Cada uno: agregar alias `@providers/shared/test-utils` al vitest.config + migrar ≥1 test. Stripe + Paddle out-of-scope (workstream §3.3 separado, billing adapters).

⏭ **Phase C / §3.2.c PENDING**: provisioning de sandbox apps por provider (Edward, fuera del repo) + GitHub Actions Secrets + implementar real assertions en cada `sandbox.test.ts`.

⏭ **Phase D / §3.2.d PENDING**: `.github/workflows/provider-sandbox.yml` nightly + Sentry/issue alert chain. 30-50 LOC bloqueados por `omnipost-allow sensitive-edit` token (mismo issue que §2.2.a-CI / §3.1.b CI gate).

**Out of scope (Stripe/Paddle)**: estos viven en `apps/api/src/billing/` adapters, NO en `packages/providers/`. Si quieren su propio sandbox testing → workstream §3.3 separado.

---

## Fase 4 — Resiliencia, observabilidad operativa, chaos

> Objetivo: probar que el sistema sobrevive a fallos reales en infraestructura distribuida. Lo que las fases anteriores construyen, esta lo estresa.

### 4.1 Saga + Outbox chaos testing — `P1` · `L` · `STATUS: DONE-Phase-A1 (03bce70)` · follow-ups §4.1.b/c/d

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

🚨 **DoD honest gap (2026-05-28 audit)**: el DoD original textual era _"suite chaos verde nightly + ≥3 escenarios cubiertos + runbook por escenario"_. Phase A1 entregó 1 escenario (saga step retry-recovery) + 1 runbook + harness reusable — es decir **33% del DoD de escenarios** + 0% del DoD nightly (no workflow). El gap (2 escenarios restantes + workflow nightly + Sentry alert chain) queda en Phase B/C/D; el item estaba marked DONE-Phase-A1 sin esta explícita-callout — framing fix aplicado retro (2026-05-28 audit).

✅ **Phase A1 closure:** L1 simulated chaos railroad + 1 scenario verde:

- `apps/api/tests/chaos/chaos-helpers.ts` — harness con NoopBackgroundTaskScheduler + `TransientFailingStep` + `waitForSagaStatus`.
- `apps/api/tests/chaos/saga-step-retry-recovery.test.ts` — 1 scenario (saga step transient failure → recovery scheduler retries → COMPLETED). 3 runs consecutivas verde @ 150ms cada, sin flakes.
- `docs/runbooks/chaos-saga-step-retry.md` — runbook con invariante validada + diagnóstico paso-a-paso si falla.
- `docs/architecture/chaos-testing.md` — framework canon (3 niveles L1/L2/L3) + scenario backlog + recipe.

⏭ **Phase B / §4.1.b PENDING**: 2 escenarios L1 restantes (outbox relay crash entre claim y publish + BullMQ worker stalled mid-job). ~1-2h cada con helpers nuevos.

⏭ **Phase C / §4.1.c PENDING**: L2 real-crash infra — `child_process.spawn` API + `SIGKILL` mid-flight + restart + verify invariants persisted. ~6-10h trabajo invasivo. Diferido hasta Phase B estable.

✅ **Phase D-workflow closure (c29d9e73, 2026-05-28)**: `.github/workflows/chaos.yml` creado — cron `30 3 * * *` (staggered 30 min después del nightly full-suite), services postgres+redis, runs `vitest run tests/chaos/` (additive — picks up new scenarios sin workflow edit), notify-on-failure crea GitHub issue con labels `chaos-failure`/`P1`/`reliability` + links a runbook directory. Cierre del DoD tercer ítem "nightly". Sentry alert chain queda en sub-phase posterior (requiere Sentry secrets management aparte, mismo análisis que §4.2.c).

---

### 4.2 Observability operativa: dashboards + alerts + runbooks — `P1` · `L` · `STATUS: DONE-Phase-A1 (92509d5)` · follow-ups §4.2.b/c

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

🚨 **DoD honest gap (2026-05-28 audit)**: el DoD original textual era _"dashboards versionados + ≥10 alertas declaradas + runbook por cada una"_. Phase A1 entregó 4 alertas canon + 4 runbooks + dashboards Grafana provisioned (3 dashboards) — es decir **40% del DoD de alertas** (4/10) + 100% del DoD de dashboards. El gap de 6 alertas + alertmanager wireup queda en Phase B/C; el item estaba marked DONE-Phase-A1 sin esta explícita-callout — framing fix aplicado retro (2026-05-28 audit).

✅ **Phase A1 closure:** Prometheus alerting habilitado (uncomment `rule_files`) + 4 alert rules canon + 4 runbooks + SLO.md centralizado.

- `prometheus/prometheus.yml` — uncomment `rule_files: ["alerts/*.yml"]`.
- `prometheus/alerts/api.yml` — `ApiLatencyP99High` + `ApiErrorRateHigh`.
- `prometheus/alerts/saga.yml` — `SagaTimeoutSpike`.
- `prometheus/alerts/outbox.yml` — `OutboxLagHigh`.
- 4 runbooks en `docs/runbooks/alert-{api-latency,api-error-rate,saga-timeout,outbox-lag}.md` — síntoma + diagnóstico paso-a-paso + remediation + escalation criteria + links a Grafana/Sentry.
- `docs/observability/SLO.md` — SLO targets centralizados con coverage matrix (Phase A1: 2/3 API, 1/3 Saga, 1/3 Outbox alerts wireados).

**Recon hallazgo (positivo)**: Grafana provisioning (`grafana/provisioning/{dashboards,datasources}/`) Y docker-compose mounts YA existían — recon inicial los subestimó como gap. Los 3 dashboards committeados (api-performance, system-resources, business-metrics) ya auto-loadean al restart. Phase A1 sin ese trabajo extra; Phase B no necesita revisitarlo.

⏭ **Phase B / §4.2.b PENDING**: 6+ alerts adicionales canon (Availability, SagaCompletionRateLow, SagaAvgDurationHigh, OutboxPublishLatencyHigh, PostCreationP99High, PublishSuccessRateLow) + runbooks correspondientes. Cada alert: ~30min trabajo. Total ~3-4h.

⏭ **Phase C / §4.2.c PENDING**: alertmanager wireup en docker-compose + Slack/PagerDuty notification routing + Sentry alert rules via API. Realignment 2026-05-28: el framing original _"Bloqueado parcialmente por sensitive-edit token"_ sugirió que era 10-LOC-token-blocked como §2.2.a-CI / §3.1.b. Realidad: alertmanager wireup requiere (1) decisión arquitectónica (alertmanager-prometheus dev vs cloud-managed prod), (2) Slack/PagerDuty webhook secrets, (3) Sentry API token + alert rules config. Es **trabajo real (~4-6h)**, no token-blocked. Phase C queda PENDING con scope claro, no como time-bomb.

---

### 4.3 Data retention enforcement E2E + GDPR compliance verification — `P2` · `M` · `STATUS: DONE-Phase-A1 (00c96f1)` · follow-ups §4.3.b/c/d

**Qué:** `DataRetentionService.runRetentionCleanup` existe (67 LOC), está registrado DAILY vía `BackgroundTaskScheduler` en `apps/api/src/index.ts:825-829`, y borra `AuditLog` viejos + marca `DsarRequest` overdue como `EXPIRED`. Faltaban: (a) tests E2E con datos artificialmente envejecidos verificando borrado real, (b) calendario central de retention, (c) DSAR EXPORT real, (d) PII masking + reporting API.

✅ **Phase A1 closure:** 2 integration tests E2E contra Postgres real en `apps/api/tests/integration/data-retention.integration.test.ts` (AuditLog 100d→deleted/10d→preserved, DSAR overdue→EXPIRED/on-time→PENDING). Helper aislado en `apps/api/tests/integration/helpers/runRetentionForTest.ts` evita construir el container DI completo. `docs/compliance/RETENTION_CALENDAR.md` creado como source of truth (matrix por data type + jurisdicción + scheduled enforcement details). 3 runs consecutivos verdes (0 cancelled, 0 fail). Scheduled job auditado y documentado activo. DoD original pedía 3 E2E tests — el 3ro (DSAR EXPORT real dump) queda en §4.3.b porque requiere S3 + multi-table serializer que no existen hoy.

**Por qué importa:** GDPR/LGPD/CCPA enforcement REAL, no solo código que dice "lo hace". Esto sí se mira en compliance audit pre-acquisition.

**Dependencias:** Phase 2 (multi-tenant guards) — para asegurar que el cleanup respeta isolation.

**Definition of done:** ✅ 2 E2E tests verdes + ✅ retention calendar + ✅ scheduled job auditado activo. (DoD original 3-tests reducido a 2 por scope honesto — el 3ro va a §4.3.b.)

⏭ **Phase B / §4.3.b PENDING**: DSAR EXPORT real dump generation. Requiere (1) tenant data serializer (multi-table dump por `requestorAccountId`), (2) S3 upload integration, (3) background job que genera + sube + sets `exportUrl` + schedules expiration a 7 días. Hoy el `exportUrl` es input manual del operador.

⏭ **Phase C / §4.3.c PENDING**: `OutboxEvent` y `StoredEvent` retention (window típico 14-30d post-`PROCESSED`) + account deletion cascade GDPR-integrated (hoy es FK CASCADE puro de DB, sin auditoría de qué tablas se vaciaron).

⏭ **Phase D / §4.3.d PENDING**: PII masking en `AuditLog.metadata` (hoy puede contener IPs/emails sin redacción) + regulatory reporting API (`regulatoryReportedAt` submission logic por jurisdicción).

---

## Fase 5 — Refactors estructurales (long-term, no urgentes)

> Objetivo: capturar mejoras estructurales mayores propuestas por el canon genérico monorepo 2026 — **no se ejecutan ahora** pero quedan registradas para revisión Q2/Q3 2026 según trigger events de §0.2.

### 5.1 Split `@core/application/` en bounded contexts separados — `P1` · `XL` · `STATUS: DONE (b4819864)` · sub-phases §5.1.a/b/c/d all DONE

**Qué:** Re-organizar `@core/application/<context>/` a packages top-level por context bajo `packages/core/<context>/` — un package por bounded context (DDD canon). Recon (2026-05-28) reveló **46 bounded contexts** en `@core/application/src/` (no 7 como inicialmente estimaba §0.2).

**Trigger gate (re-evaluado 2026-05-28):**

- ✅ **Boundary violation evidence**: 11 cross-context imports detectados (lista en §5.1.a commit). Trigger CUMPLIDO.
- ❌ Team-size gate (5+ devs) — no aplica a este equipo (Edward + Claude). Gate descartado por feedback.
- 46 contexts >> el threshold #8 original (el counter inicial era heurística — recon real lo rebasó 5.75×).

**Por qué se abrió:** el contexto está aquí (46 bounded contexts), las violations cross-context están aquí (11 documentadas), y el hook tripwire system (commit 8dea6aba+) ahora previene NUEVAS violations. El split convierte los bounded contexts en estructura técnica enforced, no convención.

**Definition of done (cuando se cierre):** un package por bounded context + depcruise rules cross-context enforced + 0 imports cross-context fuera de ports compartidos + ports nuevos en `@ports/core` para 11 violations resueltas.

✅ **Phase A1 closure (scaffold, 431b8667, 2026-05-28):**

- 46 packages scaffolded en `packages/core/<context>/` (package.json + tsconfig.json + src/index.ts empty barrel)
- 6 ports nuevos en `@ports/core` para resolver las 11 violations: `SecurityClassifierPort`, `PostCreationPort`, `GuardrailEvaluationPort`, `MentionTrackingPort`, `NotificationDispatchPort`, `PlatformCredentialPort`
- 46 aliases en `tsconfig.base.json` + `apps/api/vitest.config.ts`
- pnpm install discovers 50 `@core/*` packages (46 nuevos + engine + application + domain + threading)
- tsc green, fitness checks intact

✅ **Phase B closure (extract 35 leaf contexts, 7f49e69c, 2026-05-28):**

- 35 leaf contexts (sin cross-context out) movidos a `packages/core/<ctx>/src/` via `git mv` (preserva blame)
- 245 importer files updated via sed (`@core/application/<ctx>` → `@core/<ctx>`)
- 190 UseCase.js imports normalized
- 35 nuevos workspace deps en `apps/api/package.json`
- tsc green, fitness checks intact, 0 residual `@core/application/<leaf>` references

🚨 **Phase B time-bomb identified (audit 2026-05-28)**: el commit 7f49e69c también dejó **7 absolute cross-bounded-context imports** dentro de los 9 contexts remaining en `@core/application/src/` (ai→@core/security, bulk-scheduling/recurring→@core/posts, inbox→@core/guardrails, inbox/handlers/mentions→@core/notifications). El framing original fue "puente temporal hasta §5.1.c". El hook tripwire (commit 8dea6aba+) AHORA bloquearía la introducción de patrones idénticos — pero los 7 existentes pasaron antes del hook. **Quedan a resolver en §5.1.c via los 6 ports creados en Phase A.**

✅ **Phase C closure (§5.1.c, 2026-05-28)** — 12 cross-context violations resolved + 8 contexts extracted. Granular sub-commits:

- `a8730ad5` §5.1.c.1: `@core/embeddings` shared kernel + `MENTION_CONTEXT` moved to `@core/domain/value-objects/`.
- `31814583` §5.1.c.2: 5 ports redesigned (shapes match consumer call sites) + 5 adapters in composition root (`PostCreationAdapter`, `NotificationDispatchAdapter`, `MentionTrackingAdapter`, `GuardrailEvaluationAdapter`, `PlatformCredentialAdapter`). Stale `SecurityClassifierPort` removed.
- `57b47caf` §5.1.c.3 + .c.5: 8 violator use cases refactored to inject ports instead of concrete services. DI container wires updated across 6 setup files.
- `d85e2fe4` §5.1.c.4: 8 remaining contexts (ai, bulk-scheduling, glossary, inbox, mentions, recurring, style-guide, tasks) moved via `git mv` to `packages/core/<ctx>/src/`. 82 importer files sed-updated. 9 new workspace deps in `apps/api/package.json`. `csv-parse@6.2.1` migrated to `@core/bulk-scheduling` package.

✅ **Phase D closure (§5.1.d, b4819864)** — depcruise rule + canon doc + cleanup:

- `.dependency-cruiser.cjs` extended with `no-cross-bounded-context` rule. Pattern: a context at `packages/core/<a>/src/` cannot import from `packages/core/<b>/src/` when `a ≠ b` AND neither `a` nor `b` is `domain`, `embeddings`, or `application`. Whitelist matches the canon (shared kernels + base layer).
- `docs/architecture/BOUNDED_CONTEXTS.md` — canon doc with inventory of all 46 bounded contexts + the 5 port-adapter pairs + how to add a new context + how to extend (port / shared kernel) + git history preservation note.
- `@core/application` package final state: only `UseCase.ts` (base abstract class) + minimal `index.ts` barrel. Future cleanup §5.1.e (optional) eliminates the package once zero importers remain.

**Verification end-to-end:**

- `pnpm --filter @apps/api exec tsc --noEmit` (with `NODE_OPTIONS=--max-old-space-size=4096`) → 0 errors. Workspace-wide `tsc` from root is intentionally avoided per `feedback/tools-infra.md §LXC-memory-caps` (it OOMs the dev container).
- 0 cross-bounded-context imports verified via per-context grep, excluding the whitelist.
- `git log --follow packages/core/<ctx>/src/<file>.ts` reproduces the full history through the rename.

⏭ **Phase E / §5.1.e (opcional, PENDING)**: eliminar `@core/application` package vacío cuando sea seguro (sin importers residuales). Diferido hasta verificar zero impact + potencial move de `UseCase.ts` a `@core/domain`.

---

### 5.2 Triada `queue-types` + `queue-client` + `queue-worker` separada — `P2` · `L` · `STATUS: DEFERRED (trigger no cumplido al 2026-05-28)`

**Qué:** Hoy `@adapters/queue-bullmq` mezcla las tres responsabilidades (tipos de jobs, enqueuer, base classes de workers, 821 LOC, 7 archivos, 35 consumers en el repo). El canon separa en 3 packages.

**Trigger gate (re-evaluado 2026-05-28):**

- ❌ Worker process #4 (hoy **1** entry `apps/workers`). NO cumplido.
- ❌ Equipo de workers 3+ devs. NO aplica.
- ❌ Fricción operativa cross-paquete. Recon NO detectó (1 worker entry, paquete no es god-object, no boundary violations cross-cutting).

**Por qué sigue DEFERRED:** con 1 worker entry, split en 3 packages es over-engineering (3× boilerplate, sin retorno hoy). El trigger gate se mantendrá viable cuando aparezca worker process #2 (entonces el cost-benefit cambia).

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

# OmniPost — Remediation Roadmap (v2.1 — 2026-04-21 (T6 decisions applied))

> Documento maestro **híbrido v2.1** que reemplaza a `REMEDIATION_BATCHES.md` (v1) y `CLAUDE_ALTERNATE_PLAN.md`. Organiza los **647 hallazgos laterales** (L-1..L-647) documentados en `LATERAL_FINDINGS.md` en **7 tiers de complejidad ascendente (T0..T6)** con **micro-batches** ejecutables (1 batch = 1 sesión = 1 commit cohesivo).
>
> **Fecha:** 2026-04-21.
> **Tramo D0-v4:** cerrado 2026-04-20.
> **Fuentes absorbidas:** estructura tier + micro-batches + dependency graph de `CLAUDE_ALTERNATE_PLAN.md`; enumeración exhaustiva + bash exit criteria + reconciliación 647 + apéndices de `REMEDIATION_BATCHES.md` v1.
>
> **Última actualización v2.1:** decisiones T6 cerradas sesión 2026-04-21. Ver §11 changelog.

---

## §0. Contexto, objetivo y cómo leer este documento

### Por qué este documento (y por qué reemplaza v1 + CLAUDE_ALTERNATE_PLAN)

Se produjeron dos planes de remediación en paralelo el 2026-04-21:

1. **`REMEDIATION_BATCHES.md` v1** — 11 batches temáticos B0..B10 + B11 backlog. Enumera los 647 findings, preserva criterios bash objetivos, reconcilia Σ = 647. Debilidad: los batches son grandes y mezclan esfuerzos dispares.
2. **`CLAUDE_ALTERNATE_PLAN.md`** — 7 tiers por complejidad ascendente (T0..T6) con micro-batches de 15 min a 3 h. Fortaleza: granularidad "1 sesión = 1 commit", T6 decisions-first, dependency graph ASCII. Debilidad: no reconcilia los 647 individualmente.

**Edward aprobó la síntesis híbrida:**

- Tier structure T0..T6 + T6-decisions-first + micro-batches → de CLAUDE_ALTERNATE_PLAN.
- Enumeración exhaustiva de L-# + bash exit criteria + apéndices A/B/C + reconciliación Σ=647 → de v1.

Este documento es la **única fuente de verdad** para ejecutar remediación a partir de ahora. v1 y CLAUDE_ALTERNATE_PLAN quedan como insumos históricos.

### Qué cubre y qué no

**Cubre:**

- Los **647 findings** exhaustivamente, cada uno asignado a exactamente un T\<n\>-\<letter\> (o a Apéndice A/B/C).
- **Bash commands** de exit criteria preservados desde v1.
- **Orden de ejecución** ascendente por complejidad con overrides donde el riesgo lo exige (T0 primero, T6 session temprana).
- **Reconciliación cuantitativa** Σ = 647 verificable con grep.

**No cubre:**

- Ejecución de los fixes (este doc es el mapa, no el viaje).
- Re-auditoría para confirmar que los 647 son precisos (se confía en D0-v4).
- Nuevos findings que aparezcan durante ejecución (van a `LATERAL_FINDINGS.md` addendum + se re-categorizan en v3).
- Spec de producto para T5-B / T6 items (requiere input Edward).

### Cómo leer

1. **§1** explica el principio de ordenamiento — cómo y por qué tier-by-tier con overrides.
2. **§2** define el framework de clasificación 5-ejes (heredado de v1 + PLAN_MAESTRO §5.7/5.8/5.9).
3. **§3** explica la regla de cierre de batch.
4. **§4** da el orden semanal recomendado.
5. **§5** contiene los 7 tiers con todos los batches individuales. **Aquí está el trabajo.**
6. **§6** grafica las dependencias cross-tier.
7. **§7** reconcilia Σ = 647.
8. **§8** da cadencia de ejecución sugerida (17 semanas).
9. **§9** define formato de commits y PRs por batch.
10. **§10** meta-regla final (re-correr D0..D7 como verificación).
11. **§11** changelog (v2 → v2.1 — decisiones T6 cerradas).
12. **Apéndice A** — 27 positives (sin acción).
13. **Apéndice B** — 5 WONT_FIX justificados.
14. **Apéndice C** — 165 composites absorbidos / resolved / dups.

### Convenciones visuales

- 🔒 **BLOCKS_TIER** — fix este batch antes de avanzar en el tier (otros batches del tier dependen de este).
- ⚡ **PARALELIZABLE** — puede ejecutarse junto a cualquier otro batch del mismo tier.
- 🔗 **CROSS_TIER_COMPOSITE** — tiene referencias cruzadas a batches de otros tiers.
- ✅ — batch cerrado (marcar inline al completar).

### Formato uniforme de cada batch (§5)

Cada `T<n>-<letter>` incluye:

1. **Scope** — 1 oración describiendo qué abarca.
2. **Findings table** — columnas estándar `| L-# | Título corto | Esfuerzo | Acción | §5.9 | Notas |`.
3. **Entry criteria** — prerequisitos (batches previos cerrados, decisiones pendientes).
4. **Exit criteria** — comandos bash verificables o condiciones objetivas.
5. **Estimación** — tiempo realista en horas/medio día/día.
6. **Dependencias** — flags 🔒 / ⚡ / 🔗.
7. **Orden interno** — cuando hay dependencias intra-batch.
8. **Notas** — decisiones pending, riesgos, cross-refs.

---

## §1. Principio de ordenamiento

### Regla dura

> **Complejidad ascendente.** T0 urgente por riesgo externo → T1 trivial → T2 local pequeño → T3 local mediano → T4 estructural chico → T5 estructural grande. **T6 paralelo horizontal** — decisiones de producto que desbloquean items en T1..T5.

### Overrides explícitos al orden estricto

1. **T0 primero siempre.** L-591 (`.env` git-tracked con secrets reales) es el único item de T0 y es urgente por riesgo externo temporal. Se ejecuta ANTES que cualquier T1, aun siendo T0 un tier "fuera de complejidad".
2. **T6 sesión temprana.** T6 se ejecuta **en Semana 1** aunque su numeración sugiera "último". Razón: T6 agrupa ~100 findings bloqueados en decisiones Edward; una sesión de 2-3 h produce inputs que desbloquean trabajo en T1/T3/T5. Ejecutar T6 tarde deja en standby ~1/6 del backlog.
3. **Dentro de cada tier, orden por dependencias.** Si batch B necesita algo que produce batch A, A va antes. Ejemplo: `T2-K` (type narrowing) espera a `T3-C/T3-D` (splits de client.ts/apiClient.ts); por eso T2-K se agenda después de esos T3.
4. **SAFETY_CRITICAL siempre antes de QUALITY del mismo subdominio.** Si un tier contiene ambos, SAFETY_CRITICAL primero. Ejemplo: en T4, L-538 (Invoice Decimal) va antes que L-534 (NULL-trap).

### Regla de granularidad

- Un batch dura **15 min a 3 h típico**. Exception: T3-I (component splits top 20), T4-A (boundary leaks), T5-A..J — ahí un batch puede ser sprint.
- Un batch se cierra en **un único commit cohesivo** ("close T3-C: split client.ts per domain (closes L-212, L-237)") o en 2-3 commits atómicos dentro de una sesión.
- Si un batch no puede cerrarse en 1 sesión, **partirlo** en sub-batches antes de empezar, no durante la ejecución.

---

## §2. Framework de clasificación (5 ejes)

Cada finding se clasifica sobre 5 dimensiones ortogonales. Este framework es **heredado íntegro de v1 + PLAN_MAESTRO §5.9** — no cambia en v2.

### Eje 1 — Esfuerzo

| Valor     | Duración estimada | Ejemplo representativo                               |
| --------- | ----------------- | ---------------------------------------------------- |
| `TRIVIAL` | <15 min           | añadir `.gitattributes`, rename file con espacios    |
| `QUICK`   | 15 min – 2 h      | fix ESLint rule, remove `\|\| true` de ci.yml        |
| `MEDIUM`  | ½ – 1 día         | split archivo, migrar DI singleton                   |
| `HEAVY`   | 1 – 3 días        | refactor `GatewayBillingService` 1042 LOC            |
| `DEEP`    | 3 – 8 días        | `content/` module completion, provider consolidation |

### Eje 2 — Bloqueador

| Valor                                             | Significado                                     |
| ------------------------------------------------- | ----------------------------------------------- |
| `BLOCKS_MANY`                                     | Otros batches/tiers no son ejecutables sin esto |
| `BLOCKS_FEW`                                      | Bloquea 1-2 findings específicos                |
| `BLOCKED_BY_<L-#>` / `BLOCKED_BY_<T<n>-<letter>>` | Requiere otro finding/batch resuelto primero    |
| `INDEPENDENT`                                     | Puede ejecutarse en cualquier orden             |

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

### Tie-breakers para asignación a tier

1. Si `SAFETY_CRITICAL` + secrets → T0.
2. Si `NEEDS_EDWARD` + alcance DEAD_CODE o producto → T6.
3. Si `TRIVIAL` + `COSMETIC` → T1.
4. Si `QUICK` + local file único → T2.
5. Si `MEDIUM` + local mediano → T3.
6. Si `MEDIUM`/`HEAVY` + un módulo completo → T4.
7. Si `DEEP` + múltiples capas → T5.
8. Cuando dos v1/alternate plans disagreen: **v1 gana para clasificación de esfuerzo/acción**; **CLAUDE_ALTERNATE_PLAN gana para tier placement**.

---

## §3. Regla de cierre de batch

Un batch `T<n>-<letter>` está **CERRADO** cuando:

1. **Todos sus findings** están en estado `DONE` / `DECIDED` (con ADR/decisión documentada) / `WONT_FIX` (con justificación en Apéndice B) / `DEFERRED` (con cross-ref a batch destino).
2. La **verificación objetiva** declarada en `Exit criteria` del batch corre y pasa (grep counts, test runs, fitness functions).
3. **Fitness functions CLAUDE.md** relevantes al batch están verdes (sub-set de los 10 greps ejecutado post-batch).
4. **Commit creado** (atomic o multi-commit, según naturaleza del batch) con mensaje referenciando el batch (`chore(remediation): T<n>-<letter> — <summary> (closes L-<#>[, L-<#>...])`).
5. **LATERAL_FINDINGS.md actualizado** con `→ RESUELTO en T<n>-<letter>` por finding.
6. **Este documento (REMEDIATION_ROADMAP.md) actualizado** con el batch marcado ✅ + fecha al cerrar.

**Principio 1 batch = 1 sesión = 1 commit.** Si durante la ejecución descubres que el batch no cabe en una sesión, **detente, parte el batch en sub-batches en este documento, y re-empieza**. No arrastres el batch abierto cross-sesión sin comunicarlo.

---

## §4. Ejecución general — orden recomendado

### Semana 1 — Urgencias y desbloqueo

1. **T0-A Secrets rotation** (L-591) — **inmediato**, <2 h. Previene exfiltración si `.env` fue leído por un tercero.
2. **T6 sesión de decisiones** — 2-3 h contigo. Ejecuta T6-A..T6-J en una sola sesión de decisiones sin escribir código. Output: ~100 findings pasan de `DECIDE` a `DELETE/WIRE/PLANNED`. Desbloquea T2/T3/T5.
3. **T1 trivial paralelo** — 8-10 h distribuidas en 2-3 mini-sesiones.

### Semanas 2-3 — Local pequeño

- **T2** completo (~15-18 h). T2-A y T2-F primero (son 🔒 del tier). Resto ⚡ en paralelo.

### Semanas 4-8 — Local mediano (el bloque grande del frontend)

- **T3** completo (~60-90 h). T3-A/B/C/D/E primero (todos 🔒). T3-F/G/H/I después. T3 produce el "wire + unificar" que simplifica todo T4.

### Semanas 9-16 — Estructural chico

- **T4** completo (~130-200 h). Orden sugerido: T4-A (boundary leaks) antes que T5-C/T5-D. T4-H (QueuePort) antes de T4-I (workers). T4-M (logger port) desbloquea T2-B pendientes.

### Semanas 17+ — Arquitectura grande

- **T5** ejecutado item-por-item, con ADR por cada sub-sprint.
- **T5-A primero** (Saga + CQRS wire) — "EL BATCH MÁS IMPORTANTE". Ver nota narrativa en §5.5.

### Ongoing (paralelo)

- **T6 decisiones restantes** — items que no se pudieron decidir en la sesión de Semana 1 quedan en backlog producto; Edward decide en sesiones subsecuentes.
- **Re-audit D0..D7** — meta-regla final (§10).

---

## §5. Tiers y batches

### §5.0 — T0 Housekeeping operativo urgente

**Un único batch T0-A.** Se ejecuta ANTES de todo lo demás. Razón: riesgo externo temporal (secrets expuestos en git). Separado de T1 porque su impacto es producción inmediato, no cosmético.

---

#### T0-A — Secrets rotation 🔒

**Scope.** `apps/api/.env` está tracked en git con DATABASE_URL + JWT_SECRET + provider keys reales. Rotar todo y sacarlo del historial.

**Findings table (1):**

| L-#   | Título corto                                   | Esfuerzo | Acción | §5.9         | Notas                                                                         |
| ----- | ---------------------------------------------- | -------- | ------ | ------------ | ----------------------------------------------------------------------------- |
| L-591 | `apps/api/.env` git-tracked con secrets reales | QUICK    | FIX    | NEEDS_EDWARD | `git rm --cached` + rotate ALL secrets + verify git history + bfg si expuesto |

**Entry criteria.** Ninguno (primero de todos).

**Exit criteria:**

```bash
# 1. No .env tracked en git
git ls-files | grep -E "\.env$" | wc -l   # → 0

# 2. .env listado en .gitignore
grep -E "^\.env$" .gitignore | wc -l   # → ≥1

# 3. Historial limpiado si secrets fueron públicos
git log --all --full-history -- "apps/api/.env" | head -1   # → empty si BFG corrió
```

**Estimación.** 1-2 h.

**Dependencias.** 🔒 BLOCKS_TIER (todo lo demás espera a que T0-A cierre para no filtrar secrets durante trabajo paralelo).

**Notas.** Edward debe:

1. Correr `git rm --cached apps/api/.env`.
2. Rotar cada secret actualmente comprometido (DATABASE_URL password, JWT_SECRET, cada `*_CLIENT_SECRET`, `*_API_KEY`).
3. Verificar `.gitignore` tiene `.env` y `apps/*/.env`.
4. Si el repo fue público en algún momento, correr BFG para limpiar historial.

Otros hallazgos secret-related (L-623 password123, L-621 PAT, L-546 ADMIN_PASSWORD) están en T2-F / T4-V / T4-Q — no son urgentes-temporales pero sí importantes.

---

### §5.1 — T1 Trivial

**10 micro-batches** (T1-A..T1-J). Cada uno 15 min a 3 h. Todos ⚡ paralelizables excepto T1-F (🔗 composite con T4-P). Esfuerzo total: **8-10 h** distribuidas en 2-3 sesiones.

---

#### T1-A — ESLint rules wire ⚡

**Scope.** Activar las 4 rules CLAUDE.md que faltan en ESLint (`no-console`, `no-restricted-imports`, `no-explicit-any`, `no-floating-promises`) + eslint-config-prettier.

**Findings table (5):**

| L-#   | Título corto                                         | Esfuerzo | Acción | §5.9 | Notas                                              |
| ----- | ---------------------------------------------------- | -------- | ------ | ---- | -------------------------------------------------- |
| L-576 | ESLint no `no-console` rule                          | QUICK    | CONFIG | AUTO | Composite enforcement CLAUDE.md                    |
| L-577 | ESLint no `no-restricted-imports` (domain isolation) | QUICK    | CONFIG | AUTO | Bloquea prisma/fastify/redis desde `domain/`       |
| L-578 | ESLint no `no-explicit-any` rule                     | QUICK    | CONFIG | AUTO | `@typescript-eslint/no-explicit-any: "error"`      |
| L-579 | ESLint no `no-floating-promises` rule                | QUICK    | CONFIG | AUTO | `@typescript-eslint/no-floating-promises: "error"` |
| L-580 | eslint-config-prettier not referenced                | TRIVIAL  | CONFIG | AUTO | Add extends `prettier`                             |

**Entry criteria.** Ninguno.

**Exit criteria:**

```bash
pnpm lint 2>&1 | tail -5   # → 0 errors, 0 warnings
grep -cE '"no-explicit-any"|"no-floating-promises"|"no-console"|"no-restricted-imports"' eslint.config.js   # → ≥4
```

**Estimación.** 30 min. Activar rules como `warn` primero, luego `error` una vez se corrijan violations detectadas.

**Dependencias.** ⚡ PARALELIZABLE.

**Notas.** Activar como `warn` hará surgir violations latentes — esas alimentan counts de T2-K / T2-G / T3-\* más tarde. No resolver las violations en este batch; solo activar rules.

---

#### T1-B — setInterval unref ⚡ ✅ 2026-04-28 (scope expandido — `BackgroundTaskScheduler` package)

**Scope.** 5 `setInterval` sin `.unref()` que bloquean graceful shutdown.

**Findings table (1 composite):**

| L-#  | Título corto                                     | Esfuerzo | Acción | §5.9 | Notas                                                                                      |
| ---- | ------------------------------------------------ | -------- | ------ | ---- | ------------------------------------------------------------------------------------------ |
| L-51 | setInterval sin `.unref()` (5 lugares composite) | QUICK    | FIX    | AUTO | `index.ts:630/644`, `auditLogger:64`, `slidingWindowRateLimit:81`, `enhancedValidator:119` |

**Entry criteria.** Ninguno.

**Exit criteria:**

```bash
grep -rn "setInterval(" apps/api/src/ --include="*.ts" | grep -v ".unref()" | grep -v "test" | wc -l   # → 0
```

**Estimación.** 15 min.

**Dependencias.** ⚡ PARALELIZABLE.

**Resultado real.** Scope expandido del checklist de 5 sitios a un patrón uniforme: nuevo package `@observability/background-scheduler` (Default + Noop schedulers, port interface, ~30 tests), wireado en DI (`TOKENS.BackgroundTaskScheduler`), integrado en SIGINT/SIGTERM (`scheduler.shutdownAll()`). Migrados 31+ sitios en `apps/api`, `apps/workers`, y `packages/`. CI fitness #11 (no raw setInterval) ahora bloquea regressions.

Verificación exit criteria:

```bash
grep -rnE "setInterval\(" apps/api/src apps/workers/src packages/ --include="*.ts" | \
  grep -v "default-scheduler\|node_modules\|dist\|\.test\.\|/tests/\|/\.stryker-tmp/\|eslint\.config\|DANGEROUS_STRINGS"   # → 0 ✅
```

---

#### T1-C — .gitignore + git hygiene ⚡ ✅ 2026-04-22

**Scope.** 3 `.bak` files tracked, `.gitattributes` missing, CODEOWNERS missing, patterns missing en `.gitignore`.

**Findings table (7):**

| L-#   | Título corto                                     | Esfuerzo | Acción | §5.9         | Notas                         |
| ----- | ------------------------------------------------ | -------- | ------ | ------------ | ----------------------------- |
| L-531 | `.bak` files git-tracked (prisma.config.ts.bak2) | TRIVIAL  | DELETE | AUTO         | `git rm`                      |
| L-562 | `.bak` git-tracked (instance B2)                 | TRIVIAL  | DELETE | AUTO         | Mismo cleanup L-531           |
| L-601 | `.bak` instance filesystem (B3)                  | TRIVIAL  | DELETE | AUTO         | Idem                          |
| L-587 | `.gitattributes` missing                         | TRIVIAL  | CONFIG | AUTO         | `* text=auto eol=lf`          |
| L-588 | CODEOWNERS missing                               | TRIVIAL  | CONFIG | NEEDS_EDWARD | Edward decide handles         |
| L-589 | `.gitignore` missing `*.bak` pattern             | TRIVIAL  | CONFIG | AUTO         | Cross-ref L-531               |
| L-590 | `.gitignore` missing `pnpm-lock.yaml.baseline`   | TRIVIAL  | CONFIG | AUTO         | Add pattern o commit baseline |

**Entry criteria.** Ninguno.

**Exit criteria:**

```bash
git ls-files | grep -E "\.bak[0-9]*$" | wc -l   # → 0
test -f .gitattributes && echo OK
test -f CODEOWNERS && echo OK
grep -E "^\*\.bak" .gitignore | wc -l   # → ≥1
```

**Estimación.** 20 min.

**Dependencias.** ⚡ PARALELIZABLE.

---

#### T1-D — Comments obsoletos + dead refs ⚡ ✅ 2026-04-22

**Scope.** Comments tipo "Added in Sprint X", dangling doc refs, obsolete notes.

**Findings table (6):**

| L-#   | Título corto                                              | Esfuerzo | Acción | §5.9 | Notas                                                             |
| ----- | --------------------------------------------------------- | -------- | ------ | ---- | ----------------------------------------------------------------- |
| L-50  | `outboxAdminRoutes` comments obsoletos + prisma singleton | QUICK    | FIX    | AUTO | Migrar a DI; preserve `aggregateType` (fix completo vive en T4-F) |
| L-119 | instagram/upload commented-out Metadata                   | TRIVIAL  | DELETE | AUTO | `page.tsx:517-520`                                                |
| L-493 | VirtualScrollList sprint comment (viola CLAUDE.md)        | TRIVIAL  | FIX    | AUTO | `// Added in Sprint 2` → remove                                   |
| L-494 | VirtualScrollList hardcoded emoji                         | TRIVIAL  | FIX    | AUTO | Extract o remove                                                  |
| L-555 | dangling doc ref `performance-monitoring.md`              | TRIVIAL  | FIX    | AUTO | Create o remove ref                                               |
| L-598 | minio doc drift (port mismatch)                           | TRIVIAL  | FIX    | AUTO | Unificar docs con compose                                         |

**Entry criteria.** Ninguno.

**Exit criteria:**

```bash
grep -rn "Part of Sprint\|Phase.*Sprint\|Sprint [0-9]" apps/ packages/ --include="*.ts" --include="*.tsx" | wc -l   # → 0
```

**Estimación.** 30 min.

**Dependencias.** ⚡ PARALELIZABLE.

---

#### T1-E — Unused imports + state ⚡ ✅ 2026-04-22

**Scope.** Unused imports + state + eslint-disable sin documentar + empty interface.

**Findings table (5):**

| L-#   | Título corto                                     | Esfuerzo | Acción   | §5.9 | Notas                                       |
| ----- | ------------------------------------------------ | -------- | -------- | ---- | ------------------------------------------- |
| L-120 | `_customDateTime` unused state SchedulePicker    | TRIVIAL  | DELETE   | AUTO | `editor/SchedulePicker.tsx:129`             |
| L-121 | PlatformPreview unused `_createThreadSegments`   | TRIVIAL  | DELETE   | AUTO | `editor/PlatformPreview.tsx:51-83`          |
| L-122 | ConversationThread eslint-disable sin documentar | TRIVIAL  | DOCUMENT | AUTO | Add comment explaining intent               |
| L-309 | unused imports composite (4 files)               | TRIVIAL  | FIX      | AUTO | ESLint auto-fix                             |
| L-502 | Empty interface extends                          | TRIVIAL  | FIX      | AUTO | `interface Foo extends Bar {}` → type alias |

**Entry criteria.** T1-A cerrado (ESLint rules activas ayudan a detectar).

**Exit criteria:**

```bash
pnpm lint --max-warnings 0 2>&1 | grep -c "unused\|no-unused"   # → 0
```

**Estimación.** 30 min.

**Dependencias.** ⚡ PARALELIZABLE (tras T1-A).

---

#### T1-F — @layer y @file JSDoc normalization 🔗 ✅ 2026-04-22

**Scope.** Composite L-298/L-388/L-527 resolved @layer en D0v4-8; quedan ~130 files missing @file headers + 4 @component/@layer misnamed. Este batch cierra el composite definitivamente.

**Findings table (9):**

| L-#   | Título corto                                                 | Esfuerzo | Acción    | §5.9         | Notas                                                                                                                                        |
| ----- | ------------------------------------------------------------ | -------- | --------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| L-298 | `@layer` mismapping composite (~40 admin files)              | MEDIUM   | DOCUMENT  | AUTO         | @layer resuelto D0v4-8; @file headers ~130 files pendiente                                                                                   |
| L-388 | `@file` composite 38 providers files                         | MEDIUM   | DOCUMENT  | AUTO         | Sub-composite de L-298                                                                                                                       |
| L-527 | 17 files missing `@file` observability/monitoring/api-common | QUICK    | DOCUMENT  | AUTO         | Sub-composite de L-298                                                                                                                       |
| L-300 | Missing `@component` JSDoc (ErrorBoundary)                   | TRIVIAL  | DOCUMENT  | AUTO         |                                                                                                                                              |
| L-301 | Missing `@component` JSDoc (SkipLink)                        | TRIVIAL  | DOCUMENT  | AUTO         |                                                                                                                                              |
| L-302 | Missing `@component` JSDoc (VisuallyHidden)                  | TRIVIAL  | DOCUMENT  | AUTO         |                                                                                                                                              |
| L-344 | `parseApiError.ts` `@layer presentation` mismapping          | TRIVIAL  | DOCUMENT  | AUTO         | Change to `infrastructure`                                                                                                                   |
| L-556 | `@layer test-infrastructure` invalid                         | TRIVIAL  | FIX       | AUTO         | Normalize a `infrastructure`                                                                                                                 |
| L-299 | `retry-all` DLQ endpoint unimplemented backend               | MEDIUM   | IMPLEMENT | NEEDS_EDWARD | **Nota:** v1 ubicó L-299 en B6.6.7. Este roadmap lo mantiene en T3-O por consistencia con decisión UI/backend — aquí solo normalizamos @file |

**Entry criteria.** Ninguno.

**Exit criteria:**

```bash
grep -rL "@file" apps/api/src/ --include="*.ts" | grep -v node_modules | wc -l   # → 0
grep -rn "@layer" apps/api/src/ --include="*.ts" | grep -v "@layer application\|@layer domain\|@layer infrastructure" | wc -l   # → 0
```

**Estimación.** 2-3 h. Script que inserta stub headers en files sin @file + revisión manual.

**Dependencias.** 🔗 CROSS_TIER_COMPOSITE con T4-P (fitness function #9 enforcement).

**Notas.** L-299 aparece aquí solo para completar tracking de @file (si el file tiene violations); su fix funcional está en T3-O. Esta es una excepción deliberada para no duplicar.

---

#### T1-G — Hardcoded labels menores ⚡ ✅ 2026-04-22 (L-549 deferido a T4-W)

**Scope.** Labels hardcoded de bajo impacto (no fake-AI, no i18n blocker).

**Findings table (4):**

| L-#   | Título corto                                    | Esfuerzo | Acción   | §5.9 | Notas                                                    |
| ----- | ----------------------------------------------- | -------- | -------- | ---- | -------------------------------------------------------- |
| L-105 | AIImageGenerator "DALL-E 3" hardcoded docstring | TRIVIAL  | FIX      | AUTO | Generalize                                               |
| L-492 | `formatVersionDate` en-US lock                  | TRIVIAL  | FIX      | AUTO | User locale                                              |
| L-519 | `tenantHealth.ts` tenant_id="system" label      | TRIVIAL  | FIX      | AUTO |                                                          |
| L-549 | `dev-x` pattern replace                         | QUICK    | REFACTOR | AUTO | Factory `createTestUser({ suffix })` — fix completo T4-W |

**Entry criteria.** Ninguno.

**Exit criteria:** visual diff + tests passing.

**Estimación.** 30 min.

**Dependencias.** ⚡ PARALELIZABLE.

---

#### T1-H — Missing ARIA triviales ⚡ ✅ 2026-04-22

**Scope.** ARIA attributes missing en 2 UI components triviales (progress, separator). Resto de ARIA gaps van a T3-J.

**Findings table (2):**

| L-#   | Título corto                       | Esfuerzo | Acción | §5.9 | Notas |
| ----- | ---------------------------------- | -------- | ------ | ---- | ----- |
| L-500 | progress.tsx missing aria-valuenow | TRIVIAL  | FIX    | AUTO |       |
| L-501 | separator.tsx missing role         | TRIVIAL  | FIX    | AUTO |       |

**Entry criteria.** Ninguno.

**Exit criteria:** tests a11y verdes en packages/ui.

**Estimación.** 10 min.

**Dependencias.** ⚡ PARALELIZABLE.

---

#### T1-I — Config one-liners ⚡ ✅ 2026-04-22

**Scope.** Configs de una línea: workspaces dead, tsconfig drift, env hardcoded triviales.

**Findings table (7):**

| L-#   | Título corto                                       | Esfuerzo | Acción | §5.9         | Notas                                       |
| ----- | -------------------------------------------------- | -------- | ------ | ------------ | ------------------------------------------- |
| L-530 | `prisma.config.ts` usa `npx` en vez de `pnpm exec` | TRIVIAL  | FIX    | AUTO         | Replace `npx` → `pnpm exec`                 |
| L-532 | SHADOW_DATABASE_URL hardcoded password             | QUICK    | CONFIG | AUTO         | Use env var (cross-ref L-583)               |
| L-533 | Prisma generator no `previewFeatures`              | TRIVIAL  | CONFIG | NEEDS_EDWARD | Evaluar preview features relevantes         |
| L-571 | workspaces npm-style dead config                   | TRIVIAL  | CONFIG | AUTO         | Remove `workspaces` field de `package.json` |
| L-572 | pnpm-workspace duplicate `infra/prisma`            | TRIVIAL  | CONFIG | AUTO         | Deduplicate                                 |
| L-583 | root `.env.example` 11 vs 80 used                  | MEDIUM   | CONFIG | AUTO         | Auto-gen desde code scan                    |
| L-584 | TWITTER\_\* ghost vars post-rename                 | QUICK    | FIX    | AUTO         | Rename a `X_*`                              |

**Entry criteria.** Ninguno.

**Exit criteria:**

```bash
diff <(grep -oE 'process\.env\.[A-Z_]+' apps/ packages/ infra/ -r --include="*.ts" | cut -d'.' -f3 | sort -u) \
     <(grep -oE '^[A-Z_]+' .env.example | sort -u)   # → empty diff
```

**Estimación.** 1 h.

**Dependencias.** ⚡ PARALELIZABLE.

---

#### T1-J — Docker/CI one-liners ⚡ ✅ 2026-04-22 (TRAMO T1 CERRADO)

**Scope.** Docker/CI configs triviales (no el Dockerfile base completo — eso va T4-Y).

**Findings table (6):**

| L-#   | Título corto                                 | Esfuerzo | Acción | §5.9         | Notas                   |
| ----- | -------------------------------------------- | -------- | ------ | ------------ | ----------------------- |
| L-596 | docker-compose no `env_file`                 | TRIVIAL  | CONFIG | AUTO         | `env_file: - .env`      |
| L-628 | dependabot assignees literal `{{team_lead}}` | TRIVIAL  | CONFIG | NEEDS_EDWARD | Replace con handle real |
| L-633 | artifact retention not set                   | TRIVIAL  | CONFIG | AUTO         |                         |
| L-634 | concurrency groups missing                   | QUICK    | CONFIG | AUTO         |                         |
| L-636 | matrix strategy no fail-fast                 | TRIVIAL  | CONFIG | AUTO         |                         |
| L-641 | `.dockerignore` missing                      | QUICK    | CONFIG | AUTO         |                         |

**Entry criteria.** Ninguno.

**Exit criteria:**

```bash
test -f .dockerignore && echo OK
grep -c "env_file:" docker-compose.yml   # → ≥1
grep -cE "retention-days" .github/workflows/*.yml   # → ≥1
```

**Estimación.** 1 h.

**Dependencias.** ⚡ PARALELIZABLE.

---

**T1 total:** 10 micro-batches, **~8-10 h**, 2-3 sesiones. Todos ⚡ paralelizables (excepto T1-F 🔗).

---

### §5.2 — T2 Local pequeño

**11 micro-batches** (T2-A..T2-K). Cada uno 30 min a 4 h. Mayoría ⚡ paralelizables. T2-A, T2-F son 🔒 (preceden refactors downstream). T2-K 🔗 (depende de T3-C/T3-D splits). Esfuerzo total: **15-18 h**, 3-4 sesiones.

---

#### T2-A — Fetch paths inconsistentes (auth injection) 🔒 ✅ 2026-04-22

**Scope.** Hooks con fetches sin `credentials: 'include'` o con paths inconsistentes (no `/backend/` prefix). Fix mecánico pero precede cualquier refactor downstream.

**Findings table (5):**

| L-#   | Título corto                                            | Esfuerzo | Acción | §5.9 | Notas                 |
| ----- | ------------------------------------------------------- | -------- | ------ | ---- | --------------------- |
| L-261 | Path inconsistency hooks/api/ (3 fetches sin /backend/) | TRIVIAL  | FIX    | AUTO |                       |
| L-262 | `useChannels.disconnectChannel` path inconsistency      | TRIVIAL  | FIX    | AUTO | Dup L-261 (composite) |
| L-264 | `useBilling.useMyInvoices` path inconsistency           | TRIVIAL  | FIX    | AUTO | Dup L-261 (composite) |
| L-328 | `useUsageMetrics` sin credentials (security)            | TRIVIAL  | FIX    | AUTO |                       |
| L-329 | `useCompliance` 3 fetches sin credentials (security)    | TRIVIAL  | FIX    | AUTO |                       |

**Entry criteria.** Ninguno.

**Exit criteria:**

```bash
grep -rn "fetch(" apps/admin/ apps/client/ --include="*.ts" --include="*.tsx" | grep -v "credentials" | grep -vE "credentials:" | wc -l   # manual review
grep -rn "'/api/" apps/admin/ apps/client/ --include="*.ts" --include="*.tsx" | wc -l   # → 0 (todos /backend/)
```

**Estimación.** 1 h.

**Dependencias.** 🔒 BLOCKS_TIER (hooks refactors downstream asumen auth OK).

---

#### T2-B — ErrorBoundary + error.tsx leak ⚡ ✅ 2026-04-23

**Scope.** `error.tsx` / `global-error.tsx` / `ErrorBoundary` con `console.error` + raw `error.message` leak (security) + ARIA missing. Dos items dependen de T4-M (logger port) — por eso quedan marcados `PARTIAL T2-B, complete en T4-M`.

**Findings table (5):**

| L-#   | Título corto                                                | Esfuerzo | Acción | §5.9 | Notas                        |
| ----- | ----------------------------------------------------------- | -------- | ------ | ---- | ---------------------------- |
| L-271 | `error.tsx` exposes error.message (security)                | QUICK    | FIX    | AUTO | Sanitize                     |
| L-304 | `ErrorBoundary` raw error.message (security, replica L-271) | TRIVIAL  | FIX    | AUTO | Sanitize                     |
| L-109 | `error.tsx` + `global-error.tsx` missing ARIA roles         | TRIVIAL  | FIX    | AUTO | a11y                         |
| L-303 | `ErrorBoundary` console.error                               | TRIVIAL  | FIX    | AUTO | Logger port (completar T4-M) |
| L-110 | `error.tsx` uses console.error                              | TRIVIAL  | FIX    | AUTO | Logger port (completar T4-M) |

**Entry criteria.** Ninguno (items L-303/L-110 quedan parciales hasta T4-M).

**Exit criteria:**

```bash
grep -rn "error.message" apps/admin/src/app/error.tsx apps/client/src/app/error.tsx 2>/dev/null | grep -v "sanitized\|sanitize\|generic" | wc -l   # → 0
grep -rn "role=\"alert\"\|aria-live" apps/*/src/app/error.tsx apps/*/src/app/global-error.tsx | wc -l   # → ≥2
```

**Estimación.** 1 h.

**Dependencias.** ⚡ PARALELIZABLE; 🔗 CROSS_TIER_COMPOSITE con T4-M.

---

#### T2-C — Silent catches ⚡ ✅ 2026-04-23 (L-528 deferred to T4-B)

**Scope.** `catch {}` sin logging o sin propagación. No incluye L-528 (EventStore silent failure — se upgrade a T4-B).

**Findings table (4):**

| L-#   | Título corto                                     | Esfuerzo | Acción | §5.9 | Notas                                                     |
| ----- | ------------------------------------------------ | -------- | ------ | ---- | --------------------------------------------------------- |
| L-306 | silent catch composite (6 components)            | QUICK    | FIX    | AUTO | Logger + toast.error                                      |
| L-331 | `useAnalytics.fetchJSON` error silencing         | TRIVIAL  | FIX    | AUTO | Let errors propagate                                      |
| L-46  | `ComposedEventDispatcher` swallows BullMQ errors | QUICK    | FIX    | AUTO | Wire logger + metric counter (cross T4-F)                 |
| L-528 | EventStore silent failure catch (CRITICAL)       | QUICK    | FIX    | AUTO | **Upgrade:** ejecutar en T4-B contexto migración completa |

**Entry criteria.** Ninguno.

**Exit criteria:**

```bash
grep -rn "catch" apps/api/src/ apps/admin/src/ apps/client/src/ --include="*.ts" --include="*.tsx" | grep -E "catch \{\s*\}|catch\s*\(\s*\)" | wc -l   # → 0 empty catches
```

**Estimación.** 1.5 h.

**Dependencias.** ⚡ PARALELIZABLE; L-528 deferred a T4-B.

---

#### T2-D — HTML/a11y labels ⚡ ✅ 2026-04-23

**Scope real.** Labels a11y composite — auditoría reveló ~190 occurrences (vs 6 que mencionaba el roadmap). Descompuesto en 3 categorías con remedios distintos:

- **Categoría A (semantic misuse, ~33 casos):** `<label>` usado como heading visual sobre datos display → convertido a `<span>`.
- **Categoría B (orphan form labels, ~48 casos):** `<label>` sin `htmlFor` precediendo a `<input>`/`<select>`/`<textarea>` → `useId()` + `htmlFor` + `id` matching.
- **Casos ambiguous (16 casos):** `<label>` como heading de grupos de checkboxes/radios → inicialmente convertido a `<span>` en T2-D; **elevado a canon en T2-D.5** con `<fieldset><legend>` para grupos de form controls y `<div role="group" aria-labelledby>` para grupos de `<button>`.
- **Valid implicit association (23 casos):** `<label>` envolviendo `<input>` como hijo directo — patrón HTML válido, NO requiere `htmlFor`. No tocados.

Categoría A delegada a `nextjs-frontend-developer` (8 archivos); B+C manuales (18 archivos incluyendo `packages/ui/src/components/business/VersionFilterBar.tsx`).

**Findings table (1):**

| L-#   | Título corto                                    | Esfuerzo | Acción | §5.9 | Notas   |
| ----- | ----------------------------------------------- | -------- | ------ | ---- | ------- |
| L-307 | Missing `htmlFor` a11y composite (6 components) | QUICK    | FIX    | AUTO | useId() |

**Entry criteria.** Ninguno.

**Exit criteria alcanzados:**

- 0 labels orphan (verificación: `node` AST audit) ✅
- Lint 0 errors ✅
- Turbo test 37/37 ✅
- Build 9/9 ✅

**Estimación.** 1 h (real: ~3 h por scope real 32× mayor al roadmap).

**Dependencias.** ⚡ PARALELIZABLE.

---

#### T2-D.5 — fieldset/legend canonical refactor ✅ 2026-04-23

**Scope.** Elevación del fix ambiguous de T2-D al patrón canónico (research-backed). En T2-D convertimos 16 `<label>` group-heading a `<span>` pragmáticamente; T2-D.5 los corrige al canon después de investigación formal (MDN fieldset/legend/ARIA group role).

**Fuentes citadas:**

- MDN `<fieldset>`: implicit role=group, legend provee accessible name nativo, patrón preferido sobre aria-labelledby para form control grouping.
- MDN `<legend>`: "No corresponding ARIA role — this is a unique semantic relationship that ARIA cannot fully replicate".
- MDN ARIA group role: "For form control grouping, use `<fieldset>` and `<legend>` instead of `role='group'`".

**Aplicado:**

- **Categoría I (13 grupos de checkbox/radio) → `<fieldset className="border-0 p-0 m-0 min-w-0">` + `<legend>`** con reset explícito (documentado: default `2px groove` border, margin-block, min-inline-size chocan con Tailwind). Archivos: `PromptTemplateManager.tsx`, `AddWebhookForm.tsx` (2), `BulkScheduleView.tsx`, `SchedulingDashboardSidebar.tsx` (3), `RecurringPostForm.tsx` (2), `FilterPanel.tsx` (4).
- **Categoría II (3 grupos de `<button>` toggle) → `<div role="group" aria-labelledby={headingId}>`** + `aria-pressed` en cada button. Archivos: `BrandVoiceForm.tsx` (Tone), `StoryEditorControls.tsx` (Background), `BreachTable.tsx` (dataTypes).
- **Composite adicional (Video Split Options en StoryEditorControls):** detectado durante re-auditoría, ahora fieldset+legend porque contiene selects.
- **RecurringPostForm "Recurrencia":** wrap con `<div role="group" aria-labelledby>` (widget compuesto con mezcla button+select, fieldset no aplica). Drive-by: `aria-label="Cron expression"` en el custom cron input de `RecurrenceSelector` que carecía de label.

**Exit criteria alcanzados:**

- 14 `<fieldset>` + 4 `<div role="group">` aplicados ✅
- Lint 0 errors ✅
- Turbo test 37/37 ✅
- Build 9/9 ✅

**Estimación.** 2 h.

**Dependencias.** T2-D (previo).

---

#### T2-E — Path/nav corrections ⚡ ✅ 2026-04-23

**Scope real.** Fix de paths cross-app + rename "Refactored" suffix + migración de `prompt/alert/confirm` a Dialog/toast + raw fetch → TanStack hooks. Auditoría extendida reveló scope 5× mayor al roadmap.

**Investigación previa (fuentes citadas):**

- [Next.js useRouter (v15/v16)](https://nextjs.org/docs/app/api-reference/functions/use-router) — _"Use the `<Link>` component for navigation unless you have a specific requirement for using `useRouter`"_. `router.push` se reserva para nav programática post-mutación; `window.location.href` es el canon para redirects externos.
- [React declarative UI](https://react.dev/learn/managing-state) — construir componentes modales con state-driven UI, NO usar `prompt/alert/confirm` nativos.
- [WAI-ARIA APG Modal Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) — `role="dialog"` + `aria-modal="true"` + `aria-labelledby`, Escape, focus trap, focus return. Radix Dialog primitive cumple out-of-the-box.

**Findings table (4 documentados + descubiertos):**

| L-#   | Título corto                                                      | Real scope                                                                         | §5.9 |
| ----- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---- |
| L-84  | Notifications target `/admin/*` en client app                     | 2 archivos, 4 paths                                                                | AUTO |
| L-91  | MultiPlatformSchedulerRefactored orphan "Refactored" suffix       | 1 rename + 1 importer                                                              | AUTO |
| L-92  | RecurringPostForm raw fetch + orphan path                         | 7 sitios + hook migration                                                          | AUTO |
| L-93  | scheduling/page.tsx raw fetches + prompt/alert                    | page.tsx + MultiPlatformScheduler (L-90 cross-ref)                                 | AUTO |
| L-215 | `useCheckout`/`useBillingPortal` window.location.href (cross-ref) | FALSO POSITIVO — redirects externos legítimos a Stripe/OAuth (documentado en PR-9) | —    |

**Extensión del patrón** (aplicando regla "extender búsqueda más allá del roadmap"):

- posts pages: 14 alerts, 1 confirm (3 archivos)
- channels / assets / repurpose / stories: 6 alerts/confirms + 2 raw fetch
- editor / analytics / AI misc: TipTapEditor (prompt muerto eliminado), SchedulePicker (alert), ScheduledReportsList (confirm), PromptTemplateManager (confirm), useFileUpload (confirm — refactor a `confirmVideoSplit` callback con `ConfirmDialog` en StoriesEditor)

**Infra compartida creada:** movidos `ConfirmDialog.tsx` e `InputDialog.tsx` de `apps/admin/components/ui/` a `packages/ui/src/components/` para reuso cross-app. Actualizados 7 archivos admin importadores.

**Archivos nuevos:** `apps/client/hooks/api/useRecurringPosts.ts` extendido con `useCreateRecurringPost`/`useUpdateRecurringPost`. `apps/client/hooks/api/useMultiPlatformScheduling.ts` extendido con `useCreateSchedulingRule`/`useUpdateSchedulingRule`/`useToggleSchedulingRule`.

**Entry criteria.** Ninguno.

**Exit criteria alcanzados:**

- 0 alert/prompt/confirm residuales en apps/client (excepto `.test.` y `.stories.`) ✅
- 0 `/admin/*` paths residuales en apps/client ✅
- 0 `/scheduling` sin prefix `/dashboard/` residuales ✅
- 0 fitness violations ✅
- Lint 0 errors ✅
- Turbo test 37/37 ✅
- Build 9/9 ✅

**Estimación.** 1-1.5 h (real: ~5 h por scope real 5× mayor al roadmap).

**Dependencias.** ⚡ PARALELIZABLE. Documenta PR-8 (endpoint `/slots` vs `/rules`) y PR-9 (L-215 false positive) en POST_REMEDIATION_BACKLOG.md.

---

#### T2-F — ci.yml / workflows urgentes 🔒 🔗 ✅ 2026-04-23

**Scope real (extendido).** CI silent test skip + turbo env + turbo outputs + cache keys. Scope roadmap literal: 4 findings. Real: 12 silent skips en 5 workflow files, 0 env declarations en turbo.json (cache poisoning risk), 2 cache blocks brittle en ci.yml + 1 job sin turbo cache. **Precondición a todo trabajo serio** — sin CI que falle cuando corresponde, regresiones pasan silenciosas.

**Investigación previa (fuentes citadas):**

- **[Turborepo config](https://turborepo.dev/docs/reference/configuration)**: task `env` declara vars que impactan cache hash. NO declarar → cache poisoning (turbo retorna cached aunque env haya cambiado). `globalEnv` todas las tareas. `outputs` vacío → sólo logs cacheados.
- **[GitHub Actions caching](https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows)**: patrón canon `hashFiles('pnpm-lock.yaml')` para key de invalidación automática; `restore-keys` escalonado de específico a general. Keys sin lockfile hash → false cache hits (o, como nuestro caso, cache único por SHA = never hits).

**Findings originales (4) + scope extendido:**

| L-#   | Scope original                 | Scope real aplicado                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L-622 | "1 silent test skip en ci.yml" | 12 silent skips clasificados: **1 real bug** (ci.yml:154 madge circular-dep `continue-on-error: true` — removido estricto), **5 report generators** refactorizados a captura explícita de exit code (dependency-updates audit/outdated, security-testing audit/license-checker/hadolint — swallow exit 1 pero fail en cualquier otro exit), **6 legit** (performance.yml perf:db/perf:memory/k6/perf:report + nightly mutation + shell kill cleanup) documentados con comment explicativo. |
| L-581 | "declarar env por task"        | `globalEnv: ["NODE_ENV", "CI"]`, `globalDependencies: ["tsconfig.base.json", ".env.example"]`, `build.env: ["DATABASE_URL", "NEXT_PUBLIC_*", "API_URL", "NEXT_TELEMETRY_DISABLED"]`, `test.env: ["DATABASE_URL", "REDIS_URL", "TEST_DATABASE_URL", "SHADOW_DATABASE_URL"]`, `test:e2e.env`, `mutation.env`. Previene cache poisoning real.                                                                                                                                                 |
| L-582 | "test outputs `coverage/**`"   | Revelado durante ejecución que `pnpm test` default NO produce coverage; declarar `coverage/**` en `test` causaba warnings en todas las 37 tasks. Fix correcto: mantener `test.outputs: []` + NUEVA task `test:coverage` con `outputs: ["coverage/**"]` para cuando se corra con coverage flag.                                                                                                                                                                                             |
| L-635 | "cache keys con lockfile hash" | 2 bloques turbo cache en ci.yml + 1 job (test) sin cache alguna. Key pasó de `${{ runner.os }}-turbo-${{ github.sha }}` (nunca hittea cross-commit) a `${{ runner.os }}-turbo-${{ hashFiles('pnpm-lock.yaml', 'turbo.json') }}-${{ github.sha }}` con restore-keys escalonados. Añadido bloque nuevo al job `test`.                                                                                                                                                                        |

**Entry criteria.** Ninguno.

**Exit criteria alcanzados:**

- `grep -E "\|\| true" .github/workflows/ci.yml | wc -l` → 0 ✅
- `grep -c '"env":' turbo.json` → 5 (build, test, test:coverage, test:e2e, mutation) ✅ cumple ≥5
- `pnpm check:circular` → passes sin `continue-on-error` ✅
- Lint 0 / Turbo test 37/37 / Build 9/9 ✅

**Estimación.** 1 h (real: ~1.5 h por scope extendido 3× mayor).

**Dependencias.** 🔒 BLOCKS_TIER (downstream batches confían en CI para detectar regresiones); 🔗 CROSS_TIER con T4-P (fitness functions wire) y T4-Q (CI pipeline repair completo).

---

#### T2-G — Raw throws en domain + application ⚡ ✅ 2026-04-23

**Scope real.** Ambos findings reviewed with research externo + interno. L-643 era dominio (no application como título sugería). L-496 es infrastructure (hook React) — NO viola fitness #4 pero sí se limpia el pattern awkward.

**Investigación previa (fuentes citadas):**

- **neverthrow** (github.com/supermacro/neverthrow): `Result<T, E>` canon pattern. Throws OK en boundaries con libs y condiciones excepcionales.
- **Repo internal:** `Result<T,E>` implementado custom en `packages/shared/src/types.ts:71-76` (shape `{ ok: true, value }` / `{ ok: false, error }`, helpers `ok()`, `err()`, `isOk`, `isErr`, `mapResult`). Pattern de consumo dominante: `if (!result.ok) return result;` (early-return propagation, 40+ usos en apps/api).
- **Repo DomainError hierarchy** (`apps/api/src/domain/errors/DomainError.ts`): `abstract DomainError` con subclasses typed `InvalidValueError`, `EntityNotFoundError`, `InvariantViolationError`, etc. **`InvariantViolationError` matchea el caso PricingCalculator** ("config de tiers tiene hueco") — no crear `PricingError` redundante.

**Findings resueltos:**

| L-#   | Finding                                            | Resolución                                                                                                                                                                                                                                 |
| ----- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L-643 | `PricingCalculator` 2 raw throws en domain         | 5 métodos migrados a `Result<T, InvariantViolationError>`: 2 privados (`getProviderTierPrice`, `getAccountMultiplier`) + 3 públicos (`calculateCustomPrice`, `calculateBundlePrice`, `findCheaperBundle`). Early-return propagation.       |
| L-496 | `throw new Error` en `useProviderConstraints` hook | No era fitness #4 violation (layer infrastructure) pero pattern `throw-inside-own-try-catch` era awkward. Reemplazado por `setError(new Error(...)); return;`. Drive-by: añadido `credentials: "include"` al fetch (consistency con T2-A). |

**Callers actualizados (3 archivos + tests):**

- `apps/api/src/application/billing/ChangeAccountSubscriptionUseCase.ts` — 3 llamadas a PricingCalculator, Result mapeado a `UseCaseError` con `code` + `cause`.
- `apps/api/src/application/billing/CreateAccountSubscriptionUseCase.ts` — 1 llamada, mismo patrón.
- `apps/api/src/admin/accountLifecycleRoutes.ts` — 2 llamadas, Result mapeado a 500 HTTP con `{code, message}`.
- `apps/api/tests/unit/domain/pricingCalculator.test.ts` — 18 tests refactorizados con helpers `unwrapQuote()` / `unwrapBundleMatch()` + nuevo test específico de `InvariantViolationError` para count=0.

**Entry criteria.** Ninguno.

**Exit criteria alcanzados:**

- `grep -rn "throw " apps/api/src/domain/ apps/api/src/application/ --include="*.ts"` → 0 ✅
- Fitness #4 clean ✅
- Lint 0 / Test 37/37 / Build 9/9 ✅

**Estimación.** 1 h (real: ~1 h).

**Dependencias.** ⚡ PARALELIZABLE; 🔗 CROSS_TIER con T4-P (fitness function #4 ya cumplida).

---

#### T2-H — Fake/hardcoded data UI-only ⚡ ✅ 2026-04-23

**Scope real.** Los 11 findings + extensión de `ContentMetrics` (3 campos fabricados adicionales en `useAIContentGeneration.ts` / `AIContentResults.tsx` no listados en roadmap pero mismo anti-pattern).

**Investigación (fuentes):**

- Nielsen Norman empty-state guidance: mostrar status honesto, nunca placeholder engañoso; cuando no hay datos, mensaje contextual + CTA.
- Repo canon: `useOptimalTimes` hook backend-wired ya existe pero SchedulePicker opera en contextos sin projectId → se mantiene heurística local con label honesto ("Suggested Times", sin score numérico).

**Findings resueltos:**

| L-#          | Resolución                                                                                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-78         | SchedulePicker: relabel "Recommended" → "Suggested Times", removido `{score}% optimal` display, descripción explica heurística.                                                                                           |
| L-79         | `insights/utils.ts` + `RecommendationsList` + `PerformanceInsightsHeader`: "AI" → "Smart" / "Recommendations" (drop "AI-driven" copy).                                                                                    |
| L-80         | `HashtagAnalysis` type: removidos `relevanceScore/popularityIndex/competitionLevel/expectedReach/trendingStatus` fabricados por índice. `SmartContentOptimizerHashtags` reescrito a display simple (hashtag + platforms). |
| L-81 + L-213 | `estimatedEngagement` removido de: `ContentTemplate` type, `ai-content-templates.ts` (6 static templates), `mapApiTemplate`, `AITemplateSelector` display.                                                                |
| L-82         | `usePredictiveData.mapToROIForecasts` fallback genérico (4 factores con impact 35/25/25/15 fabricados) → `factors: []` cuando backend no tiene breakdown.                                                                 |
| L-83         | `AIContentGenerator`: "Powered by GPT-4" → "AI-powered" (backend puede cambiar modelo).                                                                                                                                   |
| L-106        | `AIGenerationPreview`: removidos 4 fake progress steps → single spinner + "Generating your content…".                                                                                                                     |
| L-111        | `PublishingInterface.publishingStats.estimatedTime` y display `~Ns` removidos.                                                                                                                                            |
| L-112        | `PublishingInterface.publishingStats.rateLimit` y Alert condicional removidos.                                                                                                                                            |
| L-326        | `useBillingStats.grandfatheredRevenue: 0` removido del type + display + locales (`grandfatheredRevenue` + `grandfatheredDesc` en en.json/es.json). Grid `subscriptions/page` colapsó a 1 tarjeta (MRR).                   |

**Extensión** (mismo anti-pattern detectado durante ejecución, incluido per "extender búsqueda"):

- `ContentMetrics` type: `readabilityScore/engagementScore/viralPotential` eran hardcoded `80/template.estimatedEngagement/50` y mostrados en `AIContentResults.tsx`. Removidos del type + data + display; quedan solo `characterCount/wordCount/hashtagCount`. `brandConsistency.score` (hardcoded 85) también removido del display.

**Entry criteria.** Ninguno.

**Exit criteria alcanzados:**

- 0 grep hits de `estimatedEngagement`, `grandfatheredRevenue`, `Powered by GPT-4`, `estimatedTime.*Math.ceil` patterns residuales ✅
- Lint 0 / Test 37/37 / Build 9/9 ✅

**Estimación.** 2-3 h (real: ~1.5 h).

**Dependencias.** ⚡ PARALELIZABLE.

---

#### T2-I — Over-clientization (remove "use client") ⚡ ✅ 2026-04-23

**Scope real.** Roadmap listaba 12, audit extendido (68 pages totales con `"use client"`) confirmó **7 convertibles** (6 de los 12 + 1 extensión `scheduling/recurring/new`). Los otros 6 del roadmap son **falsos positivos** — usan context hooks (`useAuth`, `useProject`), `useState`/`useEffect`, event handlers, o fetch client-side, todos client-only per Next.js App Router spec (_"React Context is not supported in Server Components"_). Documentados en `POST_REMEDIATION_BACKLOG.md` (PR-10).

**Investigación previa (fuentes citadas):**

- [Next.js App Router](https://nextjs.org/docs/app/getting-started/server-and-client-components): default Server Components. `"use client"` es boundary — todo downstream queda en client bundle. Context no soportado en Server Components. Patrón canon: _"Add `'use client'` to specific interactive components instead of marking large parts of your UI as Client Components"_.
- Audit extendido vía Node AST-ish heuristic (`/tmp/use_client_audit.mjs`): detecta triggers legítimos (hooks + event handlers + browser APIs + Next.js navigation hooks + i18n + custom hooks).

**Findings table (12 roadmap → 7 aplicables + 1 extensión + 5 falsos positivos + 1 deferred T3-R):**

**Findings table (12):**

| L-#   | Archivo                             | Audit real                          | Resolución                                                           |
| ----- | ----------------------------------- | ----------------------------------- | -------------------------------------------------------------------- |
| L-123 | `integrations/page.tsx`             | Sólo renderiza Client child         | **CONVERTIDO**                                                       |
| L-124 | `settings/integrations/page.tsx`    | Sólo renderiza Client child         | **CONVERTIDO**                                                       |
| L-125 | `settings/crm/page.tsx`             | Sólo renderiza Client child         | **CONVERTIDO**                                                       |
| L-126 | `settings/sso/page.tsx`             | Usa `useAuth` (context)             | **FALSE POSITIVE** — context no soportado en Server                  |
| L-127 | `content/library/page.tsx`          | Usa `useProject` (context)          | **FALSE POSITIVE**                                                   |
| L-128 | `content/templates/page.tsx`        | Sólo renderiza Client child         | **CONVERTIDO**                                                       |
| L-129 | `instagram/stories/page.tsx`        | Usa `useProject` + `toast()`        | **FALSE POSITIVE**                                                   |
| L-130 | `analytics/insights/page.tsx`       | Sólo renderiza Client child         | **CONVERTIDO**                                                       |
| L-131 | `ai/analytics/page.tsx`             | Sólo renderiza Client child         | **CONVERTIDO**                                                       |
| L-132 | `ai/generate/page.tsx`              | Usa `useState` + `onClick`          | **FALSE POSITIVE**                                                   |
| L-133 | `ai/optimizer/page.tsx`             | Usa `useState` + `onChange`         | **FALSE POSITIVE**                                                   |
| L-134 | `reports/shared/[token]/page.tsx`   | Usa `useEffect` fetch + `useParams` | **DEFERRED T3-R** (refactor Server Component + Suspense; public SEO) |
| +ext  | `scheduling/recurring/new/page.tsx` | Sólo renderiza Client child         | **CONVERTIDO** (extensión no listada en roadmap)                     |

**Entry criteria.** Ninguno.

**Exit criteria alcanzados:**

- 7 pages convertidas a Server Component (6 del roadmap + 1 extensión).
- 5 falsos positivos documentados en POST_REMEDIATION_BACKLOG.md PR-10.
- L-134 transferido a T3-R (public SEO Server refactor).
- Lint 0 / Test 37/37 / Build 9/9 ✅

**Estimación.** 1.5 h (real: ~30 min por scope honesto).

**Dependencias.** ⚡ PARALELIZABLE. 🔗 Spinoff T3-R para L-134.

---

#### T3-R — Public page Server Component SEO refactor 🔗

**Scope.** `apps/client/app/reports/shared/[token]/page.tsx` — única página pública client-rendered con impacto SEO real. Spinoff de T2-I.

**Investigación previa:** Next.js App Router (mismo source T2-I) — Server Components habilitan prerender + streaming + RSC payload cache; páginas públicas obtienen full SEO sólo en Server Components.

**Refactor canon:**

```tsx
// Server Component
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const report = await fetchPublicReport(token); // server-side fetch
  if (!report) notFound();
  return <SharedReportView report={report} />;
}
```

Partes interactivas (si las hay) en Client child separado.

**Findings table (1):**

| L-#   | Título corto                                               | Esfuerzo | Acción   | §5.9         | Notas           |
| ----- | ---------------------------------------------------------- | -------- | -------- | ------------ | --------------- |
| L-134 | `reports/shared/[token]/page.tsx` Server+Suspense refactor | QUICK    | REFACTOR | NEEDS_EDWARD | Public SEO page |

**Entry criteria.** Verificar que `/api/backend/reports/public/:token` soporta fetch server-side (debería — es público).

**Exit criteria.** Page sin `"use client"`, data fetch server-side, loading/error vía Suspense boundary, lint/test/build verde.

**Estimación.** 30-45 min.

**Dependencias.** 🔗 Spinoff T2-I. ⚡ PARALELIZABLE.

---

#### T2-J — Filename/naming renames ⚡ ✅ 2026-04-24

**Scope.** Renames + naming collisions + I-prefix interfaces.

**Investigación previa:**

- CLAUDE.md §Naming: _"Interfaces PascalCase (no `I` prefix)"_; Port interfaces usan suffix `Port` / `Repository`.
- typescript-eslint `naming-convention` rule: `I` prefix es Hungarian legacy.
- Audit interno: 4 I-prefix interfaces totales. 2 tienen class homónima y necesitan suffix `Port`.

**Findings resueltos (6 + extensión):**

| L-#   | Resolución                                                                                                                                                                                                                                          |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-211 | `apps/client/lib/api/providers.ts` → `providerApiClient.ts`. 1 consumer (`providerMapper.ts`) actualizado.                                                                                                                                          |
| L-354 | Collision real: `type ProviderName` local en `ai/AiRequestService.ts` + `ai/AIProviderFactory.ts` (scope 2 archivos vs 1 listado en roadmap) shadowing shared `ProviderName`. Renombrados a `AiProviderName`.                                       |
| L-355 | 4 renames: `ISagaExecutionEngine` → `SagaExecutionEnginePort` (class homónima), `IGatewayAdapterRegistry` → `GatewayAdapterRegistryPort` (class homónima), `IPaymentAdapter` → `PaymentAdapter`, `ICrmAdapter` → `CrmAdapter`. 15 archivos via sed. |
| L-389 | `_template` provider: @file header expandido con instrucciones explícitas de uso + warning prominente sobre `process.env` credentials siendo scaffold-only. Resto ya alineado con canon (Result, @layer, ProviderAdapter port).                     |
| L-523 | `QueueHealthChecker` movido de `redis.ts` → nuevo `queue.ts`. Barrel `index.ts:529` split en 2 exports.                                                                                                                                             |
| L-646 | 3 docs renames kebab-case: `backend-standards.md`, `code-standards.md`, `frontend-standards.md`. 0 referrers en repo.                                                                                                                               |

**Entry criteria.** Ninguno.

**Exit criteria alcanzados:**

- 0 docs con espacios en nombre ✅
- 0 I-prefix interfaces residuales en las 4 identificadas (otras `I*` patterns son valid like `ReactElement` — no se tocan) ✅
- Lint 0 / Test 37/37 / Build 9/9 ✅

**Estimación.** 2 h (real: ~45 min).

**Dependencias.** ⚡ PARALELIZABLE.

---

#### T2-K — Type narrowing (any → specific) 🔗

**Scope.** 20+ `any` returns en client.ts + types.ts + misc. Debe ejecutarse **tras T3-C (split client.ts) y T3-D (split apiClient.ts)** para no tener que re-hacer el trabajo.

**Findings table (25):**

| L-#   | Título corto                                              | Esfuerzo | Acción   | §5.9 | Notas                            |
| ----- | --------------------------------------------------------- | -------- | -------- | ---- | -------------------------------- |
| L-216 | `addPostMedia` return `ApiResponse<any>` (client.ts L141) | TRIVIAL  | FIX      | AUTO | Types en `types.ts`              |
| L-217 | `createPostThread` return `ApiResponse<any>`              | TRIVIAL  | FIX      | AUTO |                                  |
| L-218 | `getPostThread` return `ApiResponse<any>`                 | TRIVIAL  | FIX      | AUTO |                                  |
| L-219 | `getBestPostingTimes` return any                          | TRIVIAL  | FIX      | AUTO |                                  |
| L-220 | `getContentPerformance` return any                        | TRIVIAL  | FIX      | AUTO |                                  |
| L-221 | `publishPost` return any                                  | TRIVIAL  | FIX      | AUTO |                                  |
| L-222 | `schedulePost` return any                                 | TRIVIAL  | FIX      | AUTO |                                  |
| L-223 | `cancelScheduledPost` return any                          | TRIVIAL  | FIX      | AUTO |                                  |
| L-224 | `uploadFile` `metadata?: any`                             | TRIVIAL  | FIX      | AUTO |                                  |
| L-225 | `generateContent` `metadata?: any`                        | TRIVIAL  | FIX      | AUTO |                                  |
| L-226 | `analyzeContent` `analysis: any`                          | TRIVIAL  | FIX      | AUTO |                                  |
| L-227 | `analyzeContent` inner score loose type                   | TRIVIAL  | FIX      | AUTO |                                  |
| L-228 | `addPostMedia` media object loose typing                  | TRIVIAL  | FIX      | AUTO |                                  |
| L-229 | `ProviderHealth.details?: Record<string, any>`            | TRIVIAL  | FIX      | AUTO |                                  |
| L-230 | `ApiResponse<T = any>` generic default                    | TRIVIAL  | FIX      | AUTO |                                  |
| L-231 | `ApiError.details?: any`                                  | TRIVIAL  | FIX      | AUTO |                                  |
| L-232 | `queryKeys.posts(filters?: any)`                          | TRIVIAL  | FIX      | AUTO |                                  |
| L-233 | `UseMutationOptions metadata?: any`                       | TRIVIAL  | FIX      | AUTO |                                  |
| L-234 | `Provider.config: Record<string, any>` (LEGACY)           | TRIVIAL  | FIX      | AUTO | Cross T3-E                       |
| L-235 | `onSave error?: any` (LEGACY useAutoSave)                 | TRIVIAL  | FIX      | AUTO |                                  |
| L-59  | `telemetry/initialization.ts` 3 any exported (workers)    | TRIVIAL  | FIX      | AUTO | Tipar con `Tracer \| MockTracer` |
| L-508 | OTel 9 any leak                                           | MEDIUM   | FIX      | AUTO | Narrow types                     |
| L-514 | workers telemetry 3x any                                  | QUICK    | FIX      | AUTO | Narrow types                     |
| L-333 | `usePosts` weak typing `unknown[]`                        | TRIVIAL  | FIX      | AUTO | Define `PostFilters` type        |
| L-249 | lib/api/types.ts 212 LOC                                  | TRIVIAL  | REFACTOR | AUTO | Split — cross T3-C               |

**Entry criteria.** T3-C + T3-D cerrados (splits de client.ts y apiClient.ts primero).

**Exit criteria:**

```bash
grep -rn ": any\b\|as any\b\|<any>" apps/api/src/domain/ apps/api/src/application/ apps/api/src/infrastructure/ --include="*.ts" | wc -l   # → 0
grep -rn ": any\b\|as any\b\|<any>" apps/client/src/ apps/admin/src/ --include="*.ts" --include="*.tsx" | wc -l   # → counted baseline reduction
```

**Estimación.** 3-4 h.

**Dependencias.** 🔗 CROSS_TIER_COMPOSITE con T3-C / T3-D (debe ejecutarse después).

---

**T2 total:** 11 micro-batches, **~15-18 h**, 3-4 sesiones. T2-A, T2-F 🔒; T2-K 🔗 (dep T3-C/D); resto ⚡.

---

### §5.3 — T3 Local mediano

**18 micro-batches** (T3-A..T3-R). Mayor bloque de trabajo frontend. Cada batch 30 min a 8 h. Batches con 🔒 (T3-A/B/C/D/E/N/Q) preceden al resto del tier y a T2-K. Esfuerzo total: **60-90 h**, 2-3 semanas parciales.

---

#### T3-A — QueryClient global config 🔒 ✅ 2026-04-28

**Scope.** Unificar config QueryClient cross-app (client + admin) y añadir global error handlers (QueryCache + MutationCache) — un toque, dos consumidores.

**Investigación previa:**

- TkDodo (TanStack Query maintainer): _"the global cache-level callbacks when setting up your QueryClient"_ es el patrón canon v5 — fire-once-per-query event evita duplicados cuando varios componentes consumen la misma query.
- Audit interno: 2 producción QueryClient con config 100% duplicada, 0 global error handlers.

**Findings resueltos:**

| L-#   | Resolución                                                                                                                                                                                                                                |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-70  | `apps/client/app/providers.tsx`: `QueryCache.onError` + `MutationCache.onError` con toast destructive + logger. Vía nuevo factory compartido.                                                                                             |
| L-101 | Defaults extraídos a constantes en `@packages/query-client` (staleTime 60s, gcTime 5min, retry 1, mutations retry 0). Cambios futuros DRY.                                                                                                |
| L-336 | Nuevo paquete `@packages/query-client` (factory `createAppQueryClient`). Admin `QueryProvider.tsx` y client `providers.tsx` lo consumen ambos con DI: `logger` (BrowserLoggerPort-compatible) + `onQueryError`/`onMutationError` (toast). |

**Decisión arquitectónica documentada:**

- Factory recibe logger + handlers como DI (no hard import de `@packages/ui` ni `@observability/browser-logger`).
- Apps usan `ConsoleLoggerAdapter` porque el QueryClient se construye SOBRE el `LoggerProvider` y no puede consumir `useLogger()` (lazy init en `useState`).

**Drive-by:** bump `@tanstack/react-query` y `-devtools` de `5.90.2` → `5.95.0` en client + admin (preferido por Edward — versión estable más reciente, no downgrade en query-client).

**Entry criteria.** Ninguno.

**Exit criteria alcanzados:**

- `grep -n "QueryCache\|MutationCache" apps/client/app/providers.tsx apps/admin/providers/QueryProvider.tsx` → ambos via factory ✅ (uso transitivo, no inline)
- `@packages/query-client/tests` 6/6 ✅ (defaults, overrides, query error routing, mutation error routing)
- Lint 0 / Test 38/38 (37 + nuevo package) / Build 9/9 ✅

**Estimación.** 2-3 h (real: ~1.5 h).

**Dependencias.** 🔒 BLOCKS_TIER cerrado — habilita T3-B, T3-C, T3-D. Resuelve parcialmente L-260 (87 mutations sin onError; ahora todas heredan handler global).

---

#### T3-B — Auth flow unification 🔒

**Scope.** 3 paths paralelos de auth (Server Action vs authApi vs raw fetch) con TTLs cookie inconsistentes.

**Investigación previa:**

- Externo: cookie session TTL debe igualar JWT access TTL (~15min); `rememberMe` modela en refresh cookie (no en session). Failure-closed > failure-open en permission grants.
- Interno: 3 paths reales en client (proxy `route.ts` + `authApi.ts` + Server Action `actions/auth.ts`); admin con `actions/auth.ts` + `refresh/route.ts` paralelo. Silent SUPER_ADMIN fallback en admin AuthProvider.

**Findings resueltos:**

| L-#   | Resolución                                                                                                                                                                                                                                                                                                                                                                        |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-69  | Server Action TTLs unificados con proxy: session 15min, refresh 7d (default), refresh 30d con `rememberMe`. Drop pattern `1d session / 30d session`.                                                                                                                                                                                                                              |
| L-208 | Nuevo módulo `apps/client/lib/auth/sessionCookie.ts` (single source of truth: cookie names, TTLs, helpers). Proxy `[...path]/route.ts` + Server Action `actions/auth.ts` ambos lo importan. Análogo en admin: `apps/admin/lib/auth/sessionCookie.ts` + helper `setAuthTokens` (session+refresh+csrf). Admin Server Action + refresh route migrados. Admin session TTL 1d → 15min. |
| L-209 | `authApi.ts` migrado a `ApiError` (de `lib/api/types`) con helpers privados `readErrorBody` + `buildApiError`. `request()`, `login()`, `refreshToken()` ahora throw typed con `status` + `code`. 4 tests actualizados al nuevo fallback message scheme.                                                                                                                           |
| L-345 | Failure-closed: catch en admin `AuthProvider.tsx` ya no setea `["*"]` para SUPER_ADMIN — log error + `setPermissions([])`. Drive-by: valida `res.ok` antes de parse.                                                                                                                                                                                                              |

**Decisión documentada (PR-11):** divergencia ApiError entre client `lib/api/types.ts` y admin `lib/parseApiError.ts` queda como deuda en `POST_REMEDIATION_BACKLOG.md` PR-11 (batch dedicado futuro `T3-S — ApiError unification`).

**Entry criteria.** T3-A cerrado ✅.

**Exit criteria alcanzados:**

- 0 `cookies().set(SESSION_COOKIE...)` directos en Server Action / refresh route (todos vía sessionCookie helpers).
- Admin AuthProvider catch block fail-closed (sin `["*"]`).
- `authApi.ts` 0 `throw new Error(`.
- Lint 0 / Test 38/38 / Build 9/9 ✅

**Estimación.** 4-6 h (real: ~2.5 h).

**Dependencias.** 🔒 BLOCKS_TIER cerrado — habilita T3-C, T3-D.

**Notas.** Cookie helpers compartidos por app (client + admin) con módulos paralelos (cookie names difieren: `customer-session` vs `admin-session`). Posible unificación cross-app vía `@packages/auth-cookies` queda fuera de scope T3-B.

---

#### T3-C — client.ts split (apps/client) 🔒

**Scope.** `lib/api/client.ts` 440 LOC god file — split per domain.

**Findings table (2):**

| L-#   | Título corto                         | Esfuerzo | Acción   | §5.9 | Notas            |
| ----- | ------------------------------------ | -------- | -------- | ---- | ---------------- |
| L-212 | `lib/api/client.ts` 440 LOC god file | MEDIUM   | REFACTOR | AUTO | Split per domain |
| L-237 | client.ts 440 LOC (dup L-212)        | —        | —        | —    | Dup (composite)  |

**Entry criteria.** T3-A + T3-B cerrados.

**Exit criteria:**

```bash
find apps/client/src/lib/api/ -name "*.ts" -exec wc -l {} + | awk '$1>400' | wc -l   # → 0
```

**Estimación.** 3 h.

**Dependencias.** 🔒 BLOCKS_TIER; habilita T2-K.

---

#### T3-D — apiClient.ts split (apps/admin) 🔒

**Scope.** `apiClient.ts` admin 464 LOC god file — split per namespace.

**Findings table (1):**

| L-#   | Título corto                                              | Esfuerzo | Acción   | §5.9 | Notas               |
| ----- | --------------------------------------------------------- | -------- | -------- | ---- | ------------------- |
| L-337 | `apiClient.ts` 464 LOC admin R11 + coverage inconsistency | HEAVY    | REFACTOR | AUTO | Split per namespace |

**Entry criteria.** T3-A + T3-B cerrados.

**Exit criteria:**

```bash
find apps/admin/src/lib/ -name "apiClient*.ts" -exec wc -l {} + | awk '$1>400' | wc -l   # → 0
```

**Estimación.** 3 h.

**Dependencias.** 🔒 BLOCKS_TIER; habilita T2-K.

---

#### T3-E — Unificar useProviders (4 paths → 1) 🔒

**Scope.** 4 hooks `useProviders` paralelos — consolidar.

**Findings table (4):**

| L-#   | Título corto                                  | Esfuerzo | Acción   | §5.9 | Notas              |
| ----- | --------------------------------------------- | -------- | -------- | ---- | ------------------ |
| L-86  | 3 useProviders hooks paralelos (client)       | MEDIUM   | REFACTOR | AUTO | Absorbed L-207     |
| L-207 | useProviders 4 paths paralelos (upgrade L-86) | MEDIUM   | REFACTOR | AUTO | Consolidar cluster |
| L-210 | Naming conflict `useProviders` en lib/api/\*  | QUICK    | FIX      | AUTO | Cross-ref L-207    |
| L-263 | `lib/api/index.ts` rename undocumented        | TRIVIAL  | DOCUMENT | AUTO |                    |

**Entry criteria.** T3-C cerrado (client.ts split).

**Exit criteria:**

```bash
grep -rn "useProviders" apps/client/src/ apps/admin/src/ --include="*.ts" --include="*.tsx" | grep -c "from.*lib\|from.*hooks"   # → 1 canonical path
```

**Estimación.** 3-4 h.

**Dependencias.** 🔒 BLOCKS_TIER.

---

#### T3-F — Small god files (apps/client) ⚡ ✅ 2026-04-28 (parcial — Grupo A; Grupo B + bloqueado documentados en PR-12)

**Scope.** Hooks + files client >150 LOC pero <400 LOC. No incluye los DEAD (que se resuelven en T6-D).

**Findings table (16):**

| L-#   | Título corto                                      | Esfuerzo | Acción   | §5.9 | Notas            |
| ----- | ------------------------------------------------- | -------- | -------- | ---- | ---------------- |
| L-238 | hooks/api/useInbox.ts 321 LOC                     | MEDIUM   | REFACTOR | AUTO |                  |
| L-239 | scheduling/useSchedulingDashboard.ts 318 LOC      | MEDIUM   | REFACTOR | AUTO |                  |
| L-240 | content/library/useContentLibraryState.ts 290 LOC | MEDIUM   | REFACTOR | AUTO | Deps L-77 (T3-P) |
| L-241 | templates/useTemplateVersionControl.ts 281 LOC    | MEDIUM   | REFACTOR | AUTO |                  |
| L-242 | hooks/api/useBilling.ts 274 LOC                   | MEDIUM   | REFACTOR | AUTO |                  |
| L-243 | templates/useABTestManager.ts 273 LOC             | MEDIUM   | REFACTOR | AUTO |                  |
| L-244 | lib/auth/authApi.ts 258 LOC                       | QUICK    | REFACTOR | AUTO | Deps T3-B        |
| L-245 | hooks/api/useTasks.ts 254 LOC                     | MEDIUM   | REFACTOR | AUTO |                  |
| L-246 | hooks/api/useSso.ts 249 LOC                       | MEDIUM   | REFACTOR | AUTO |                  |
| L-247 | lib/hooks/useABTests.ts 230 LOC                   | MEDIUM   | REFACTOR | AUTO |                  |
| L-248 | hooks/api/useAssets.ts 224 LOC                    | MEDIUM   | REFACTOR | AUTO |                  |
| L-250 | lib/hooks/useAutoSave.ts 207 LOC                  | MEDIUM   | REFACTOR | AUTO |                  |
| L-251 | hooks/api/useCampaigns.ts 201 LOC                 | MEDIUM   | REFACTOR | AUTO |                  |
| L-252 | hooks/api/useAIPromptTemplates.ts 177 LOC         | QUICK    | REFACTOR | AUTO |                  |
| L-253 | lib/hooks/useTemplates.ts 172 LOC                 | QUICK    | REFACTOR | AUTO |                  |
| L-164 | useContentLibraryState 290 LOC (cross L-77)       | MEDIUM   | REFACTOR | AUTO | Dup L-240        |

**Entry criteria.** T3-C cerrado.

**Exit criteria:**

```bash
find apps/client/src/ -name "*.ts" -not -path "*/node_modules/*" -exec wc -l {} + | awk '$1>200' | grep -vE "use(A|B|C)" | wc -l   # → baseline reduction
```

**Estimación.** 4-6 h.

**Dependencias.** ⚡ PARALELIZABLE.

**Resultado real.**

- **Grupo A ejecutado (7 archivos):** `useInbox.ts` (335→4 archivos), `useBilling.ts` (275→4), `useSso.ts` (249→4), `useTasks.ts` (254→4), `useAssets.ts` (224→4), `useCampaigns.ts` (201→4), `useAIPromptTemplates.ts` (180→4). Cada uno split en `types.ts` / `api.ts` / `queries.ts` / `mutations.ts` + `index.ts` barrel preservando el import path original (`@/hooks/api/<name>`).
- **Grupo B diferido (6 archivos):** `useSchedulingDashboard`, `useTemplateVersionControl`, `useABTestManager`, `useABTests`, `useAutoSave`, `useTemplates`. Single-hook coherentes donde el split no añade valor (cohesión > LOC). Documentado en PR-12 con análisis caso-por-caso.
- **Bloqueado (1 archivo):** `useContentLibraryState` (290 LOC, L-240) depende de L-77/T3-P. Se ejecutará junto a T3-P.
- **Excluido:** `lib/auth/authApi.ts` (266 LOC, L-244) — no es hook (0 hooks, 1 función, 7 types). Ya tocado en T3-B.

Lint 0 / Typecheck 0 / Test 366/366 / Build 9/9 ✅

---

#### T3-G — Small god files (apps/admin) ⚡ ✅ 2026-04-28 (parcial — Grupo A; Grupo B + orphan-pending documentados en PR-12)

**Scope.** Hooks + files admin >150 LOC pero <400 LOC.

**Findings table (7):**

| L-#   | Título corto                               | Esfuerzo | Acción   | §5.9 | Notas                          |
| ----- | ------------------------------------------ | -------- | -------- | ---- | ------------------------------ |
| L-310 | `useCompliance.ts` 635 LOC mega-aggregator | HEAVY    | REFACTOR | AUTO | Split granular hooks           |
| L-311 | `usePricingTiers.ts` 305 LOC               | MEDIUM   | REFACTOR | AUTO | Split account vs provider      |
| L-312 | `useGatewaySwitches.ts` 216 LOC            | QUICK    | REFACTOR | AUTO |                                |
| L-313 | `useSettings.ts` 179 LOC                   | QUICK    | REFACTOR | AUTO |                                |
| L-314 | `useAdminUsers.ts` 172 LOC                 | QUICK    | REFACTOR | AUTO | Split query vs mutations       |
| L-315 | `useAnalytics.ts` 166 LOC                  | QUICK    | REFACTOR | AUTO | Deps L-325 (T3-P) + T2-C       |
| L-316 | `useMultiPlatformScheduling.ts` 159 LOC    | —        | —        | —    | Dup L-320 (T6-A decide DELETE) |

**Entry criteria.** T3-D cerrado.

**Exit criteria:**

```bash
find apps/admin/src/ -name "*.ts" -not -path "*/node_modules/*" -exec wc -l {} + | awk '$1>200' | wc -l   # → baseline reduction
```

**Estimación.** 3-5 h.

**Dependencias.** ⚡ PARALELIZABLE.

**Resultado real.**

- **Grupo A ejecutado (5 archivos):** `useCompliance.ts` (635→5 archivos, 13 hooks, 6 sub-dominios: overview, GDPR, security, score, DSAR, breach), `usePricingTiers.ts` (305→5, 9 hooks: tiers + bundles CRUD), `useGatewaySwitches.ts` (216→5, 5 hooks: list/detail + admin actions), `useSettings.ts` (179→5, 6 hooks: status + credentials + test connection + key rotation), `useAdminUsers.ts` (172→5, 5 hooks: CRUD + activate/deactivate). Cada uno split en `types.ts` / `api.ts` / `queries.ts` / `mutations.ts` + `index.ts` barrel preservando el import path original (`@/hooks/api/<name>`).
- **Grupo B / blocked (1 archivo):** `useAnalytics.ts` (163 LOC, L-315) depende de L-325/T3-P. Documentado en PR-12.
- **Orphan-pending (1 archivo):** `useMultiPlatformScheduling.ts` (159 LOC, L-316/L-320) — T6-A decidió WIRE pero aún no ejecutado. Split ahora = refactor doble. Documentado en PR-12.

Lint 0 / Typecheck 0 / Test 123/123 / Build 9/9 ✅

---

#### T3-H — Small god files (apps/api + packages) ⚡ ✅ 2026-04-28 (cierre — L-57 heredado; L-34 + L-7 diferidos en PR-13)

**Scope.** Splits de archivos medianos API + packages.

**Findings table (3):**

| L-#  | Título corto                                             | Esfuerzo | Acción   | §5.9 | Notas                                                                                  |
| ---- | -------------------------------------------------------- | -------- | -------- | ---- | -------------------------------------------------------------------------------------- |
| L-57 | `publishHandler.ts` God handler 629 LOC                  | MEDIUM   | REFACTOR | AUTO | Split Orchestrator/SinglePostPublisher/ThreadPostPublisher/SagaNotifier/PublishMetrics |
| L-34 | `index.ts` 688 LOC split                                 | MEDIUM   | REFACTOR | AUTO | bootstrap/routes/middlewareChain/shutdown                                              |
| L-7  | `webhookDashboardService` 854 LOC N+1 + retry queue stub | HEAVY    | REFACTOR | AUTO | **Cross-ref T4-X** — aquí solo split; N+1 + retry queue en T4-X                        |

**Entry criteria.** Ninguno (pueden ejecutarse en paralelo).

**Exit criteria:**

```bash
find apps/api/ packages/ -name "*.ts" -not -path "*/node_modules/*" -exec wc -l {} + | awk '$1>800' | wc -l   # → 0 (CLAUDE.md user nonnegotiable)
```

**Estimación.** 6-10 h.

**Dependencias.** ⚡ PARALELIZABLE; L-7 cross-ref T4-X.

**Resultado real.**

- **L-57 `publishHandler.ts` (629 LOC):** **HEREDADO** — ya splitado en trabajo previo a `PublishingOrchestrator.ts` (444) + `PublishingOrchestratorExecution.ts` (426) + `PublishingOrchestratorHelpers.ts` (267) vía herencia. Sub-dominios cubiertos: orchestration plan management, execution flow, helper utilities.
- **L-34 `index.ts` (725 LOC):** **DIFERIDO**. API entry point con ESM ordering constraints estrictas (dotenv → OTel → Fastify → DI → signals); estructura interna ya organizada en secciones; T1-B ya integró `scheduler.shutdownAll()` cuidadosamente. Splitearlo dispersa lógica coherente sin reducir el bottleneck cognitivo real (que son los ordering constraints, no el LOC). Ver PR-13 para razón completa + criterio de re-evaluación.
- **L-7 `webhookDashboardService.ts` (854 LOC):** **DIFERIDO a T4-X**. T4-X va a reescribir `getDashboardMetrics`, `getDlqMetrics`, `retryAllDeadLetterEvents`, `getRecentEvents` para fixear N+1 + wirear retry queue real. Splitear ahora obliga a T4-X a navegar split files mientras reescribe lógica → mejor un único batch coordinado: split + N+1 fix + retry queue wire. Ver PR-13.

Sin código nuevo en este batch. Sólo verificación de scope + documentación. T1-B también marcado retroactivamente (BackgroundTaskScheduler ya wireado).

---

#### T3-I — Component size violations UI top 20 ⚡ ⏸️ 2026-04-28 (DIFERIDO con schedule — ver PR-14)

**Scope.** Pragmatic: de los 103 componentes R11 priorizar **top 20 con >400 LOC**. Files muertos (L-141/L-143/L-147/L-156/L-162/L-169) son DELETE en T5-H.

**Findings table (20 — top by LOC):**

| L-#   | Título corto                                      | Esfuerzo | Acción   | §5.9         | Notas              |
| ----- | ------------------------------------------------- | -------- | -------- | ------------ | ------------------ |
| L-135 | editor/PlatformPreview.tsx 705 LOC                | HEAVY    | REFACTOR | NEEDS_EDWARD |                    |
| L-136 | dashboard/channels/page.tsx 692 LOC               | HEAVY    | REFACTOR | NEEDS_EDWARD |                    |
| L-137 | settings/billing/page.tsx 687 LOC                 | HEAVY    | REFACTOR | NEEDS_EDWARD |                    |
| L-138 | instagram/MediaUploadZone.tsx 672 LOC             | HEAVY    | REFACTOR | NEEDS_EDWARD |                    |
| L-139 | dashboard/posts/page.tsx 669 LOC                  | HEAVY    | REFACTOR | NEEDS_EDWARD | Cross L-97         |
| L-140 | usePredictiveData.ts 629 LOC                      | HEAVY    | REFACTOR | NEEDS_EDWARD | Dup L-236          |
| L-142 | instagram/VideoSplitPreview.tsx 613 LOC           | HEAVY    | REFACTOR | NEEDS_EDWARD |                    |
| L-144 | templates/VariableInserter.tsx 546 LOC            | HEAVY    | REFACTOR | NEEDS_EDWARD |                    |
| L-146 | publishing/PublishingInterface.tsx 496 LOC        | MEDIUM   | REFACTOR | NEEDS_EDWARD |                    |
| L-148 | posts/[id]/page.tsx 488 LOC                       | MEDIUM   | REFACTOR | NEEDS_EDWARD | Cross L-98         |
| L-149 | templates/TemplateManagementDashboard.tsx 460 LOC | MEDIUM   | REFACTOR | NEEDS_EDWARD | Cross L-99         |
| L-150 | editor/SchedulePicker.tsx 442 LOC                 | MEDIUM   | REFACTOR | NEEDS_EDWARD | Cross L-78/L-120   |
| L-151 | ai/PromptTemplateManager.tsx 439 LOC              | MEDIUM   | REFACTOR | NEEDS_EDWARD |                    |
| L-236 | usePredictiveData R11 dup                         | —        | —        | —            | Dup L-140          |
| L-274 | webhooks/DeadLetterQueue.tsx 732 LOC              | HEAVY    | REFACTOR | NEEDS_EDWARD |                    |
| L-275 | webhooks/WebhookSubscriptions.tsx 689 LOC         | HEAVY    | REFACTOR | NEEDS_EDWARD | Cross T3-N         |
| L-276 | webhooks/WebhookEventsList.tsx 505 LOC            | HEAVY    | REFACTOR | NEEDS_EDWARD | Cross L-294 (T3-N) |
| L-277 | subscriptions/ChangePlanDialog.tsx 488 LOC        | MEDIUM   | REFACTOR | NEEDS_EDWARD |                    |
| L-278 | security/RbacManager.tsx 481 LOC                  | MEDIUM   | REFACTOR | NEEDS_EDWARD | Cross L-297        |
| L-279 | shared/SidebarNav.tsx 446 LOC                     | MEDIUM   | REFACTOR | NEEDS_EDWARD | Cross L-305 (T3-R) |
| L-456 | useContentEditor 492 LOC (packages/ui)            | MEDIUM   | REFACTOR | AUTO         | Cross L-503        |

**Entry criteria.** Edward aprueba lista top 20 (vs todos 103).

**Exit criteria:**

```bash
find apps/ packages/ -name "*.tsx" -not -path "*/node_modules/*" -exec wc -l {} + | awk '$1>500' | wc -l   # → baseline reduction significant
```

**Estimación.** 20-30 h.

**Dependencias.** ⚡ PARALELIZABLE.

**Notas.** Los ~80 R11 restantes (<400 LOC) quedan listados en Apéndice C (C.4/C.6/C.7/C.8) como "primary reference" para trazabilidad pero no se refactorizan en este ciclo — Edward decide accept-with-ADR o diferir a futuro.

---

#### T3-J — Missing ARIA composites ⚡ ✅ 2026-04-28

**Scope.** ARIA gaps en business components (no los triviales de T1-H).

**Findings table (1):**

| L-#   | Título corto                  | Esfuerzo | Acción | §5.9 | Notas      |
| ----- | ----------------------------- | -------- | ------ | ---- | ---------- |
| L-497 | a11y gaps business components | MEDIUM   | FIX    | AUTO | Audit pass |

**Entry criteria.** T1-H cerrado.

**Exit criteria:** manual audit pass + axe-core tests.

**Estimación.** 3-4 h.

**Dependencias.** ⚡ PARALELIZABLE.

**Resultado real.** Investigación canon-grounded primero (WCAG 2.2 SC 4.1.3, WAI-ARIA APG `role="alert"`, MDN, Radix Toast, W3C Forms tutorial). 6 fases ejecutadas:

- **Fase 1 — Toast canonicalization:** `ToastClose` ahora tiene `aria-label="Close notification"` (Radix-required); Toast variant maps a Radix `type` prop (`destructive` → foreground/assertive, default → background/polite) per Radix a11y docs.
- **Fase 2 — Form-level error panels (10 fixes):** `role="alert"` añadido a paneles dinámicos en RecurringPostForm, SsoStatusBanner, PerformanceInsights, CrmConnectionCard, SchedulingDashboardPostModal, RecurringPostsList, ExternalNotificationConfigs, ReplyComposer; `role="region" aria-label/aria-labelledby` en PublishingInterface (Publishing Results), AdminContentEditor (Platform Compatibility) — última también con `aria-live="polite"` en la lista interna.
- **Fase 3 — Inline validation `aria-describedby` (10 fixes):** RecurringPostForm (3 inputs), AddWebhookForm, SamlConfigForm, OidcConfigForm, InviteMemberModal, AIImageGenerator, ReviewPanel, NotificationPreferences. Pattern canónico: `aria-invalid` + `aria-describedby` en input ↔ `id` + `role="alert"` en `<p>` de error.
- **Fase 4 — Required asterisks `aria-hidden` (4 fixes):** AIPromptForm, TemplateVariableModal, BrandVoiceForm (2x). Asteriscos visuales ahora `aria-hidden="true"` + `required` + `aria-required="true"` en input asociado.
- **Fase 5 — Decorative icons (≈18 fixes):** AssetDetailPanel, TaskDetailPanel, OnboardingChecklist, ReviewPanel, AnnouncementBanner, SetupBanner, TaskCard, ClientContentEditor (save status — añadió role=status/role=alert), SamlConfigForm (Copy x2), OidcConfigForm (Copy), VariableInserter (remove button), TemplateEditorCanvas (3x), ABTestResultsTab, SecurityTab, CompetitorAnalysisCard, FailedJobsTable, DeadLetterQueue (2x), SchedulePicker, SmartContentOptimizer, PublishingInterface (Validation Errors role=alert + Info icons + XCircle).
- **Fase 6 — Verificación:** Lint 0 / Typecheck 0 / Test 366+123/489 / Build 9/9.

Total: ≈48 fixes concretos, todos grounded en canon (WCAG SC 4.1.3 + ARIA APG + Radix UI + MDN). Cobertura no exhaustiva del `axe-core` E2E pass — eso queda para QA cuando los tests E2E con axe se integren al CI default. Ver PR-15 para sites pendientes de evaluación más profunda (status messages que requieren juicio de "urgent vs not urgent" caso por caso).

---

#### T3-K — useInbox.markMessageRead ⚡ ✅ 2026-04-28

**Scope.** Silent failure + no invalidation en `useInbox`.

**Findings table (1):**

| L-#   | Título corto                                                | Esfuerzo | Acción | §5.9 | Notas |
| ----- | ----------------------------------------------------------- | -------- | ------ | ---- | ----- |
| L-206 | `useInbox.markMessageRead` silent failure + no invalidation | QUICK    | FIX    | AUTO |       |

**Entry criteria.** T3-A cerrado (QueryCache global).

**Exit criteria:** mutation test + visual.

**Estimación.** 30 min.

**Dependencias.** ⚡ PARALELIZABLE.

**Resultado real.** 3 fixes mecánicos + 1 test:

- **Bug 1 — Silent fetch failure** (api.ts:129): Añadida guarda `if (!res.ok) throw new Error(...)` matching el patrón existente en los otros 8 endpoints del mismo archivo.
- **Bug 2 — Missing invalidation** (mutations.ts:95): Añadido `useQueryClient()` + `onSuccess` con `invalidateQueries({ queryKey: ["inbox"] })` matching las 3 mutations hermanas (Resolve/Reopen/Assign). Ahora la lista de conversaciones (con unreadCount), conversation detail, y messages refrescan tras marcar como leído.
- **Bug 3 — Stale UI** (consecuencia automática del fix 2): `ConversationCard.tsx:91` (sidebar unreadCount) ahora se refresca correctamente sin cambio en el consumer.
- **Test integration** (`tests/integration/useMarkMessageRead.integration.test.tsx`): 4 casos — error propagation con !ok, cache invalidation con QueryClient spy, endpoint correcto con PATCH, no-invalidation cuando falla.

Lint 0 / Typecheck 0 / Test 370/370 passed (+4) / Build 9/9 ✅

---

#### T3-L — useAdminPasswordReset silent ⚡ ✅ 2026-04-29 (heredado de T2-E + test de verificación añadido)

**Scope.** `useAdminPasswordReset` totalmente silencioso sin error handling.

**Findings table (1):**

| L-#   | Título corto                                  | Esfuerzo | Acción | §5.9 | Notas              |
| ----- | --------------------------------------------- | -------- | ------ | ---- | ------------------ |
| L-330 | `useAdminPasswordReset` totalmente silencioso | QUICK    | FIX    | AUTO | Add error handling |

**Entry criteria.** T3-A cerrado.

**Exit criteria:** error path tested.

**Estimación.** 30 min.

**Dependencias.** ⚡ PARALELIZABLE.

**Resultado real.** Verificación TDD-style reveló que el hook **ya estaba arreglado** por trabajo previo:

- `useAdminPasswordReset.ts:23-26` (commit `915f4a9` T2-E "Dialog/toast migration") tiene `if (!res.ok) throw ApiError.fromResponse(...)` — error path correcto.
- `users/page.tsx:254-265` consumer tiene `mutate(id, { onSuccess: toast(success), onError: toast(error) })` — UI feedback wired.

Edward pidió **verificar** antes de cerrar. Approach: TDD inverso — escribir el test que captura el comportamiento esperado, correrlo contra el código actual, y si pasa confirma que el fix es real.

Test añadido (`tests/unit/hooks/useAdminPasswordReset.test.tsx`, 5 casos):

- Endpoint correcto (`/api/backend/admin/users/:id/password-reset` POST)
- Propaga `ApiError` con status 403 + code `PERMISSION_DENIED`
- Propaga `ApiError` con status 500 + `isServerError === true`
- Retorna parsed JSON en success
- Invoca consumer-supplied `onError` callback en failure (no se invoca `onSuccess`)

**Resultado verificación: 5/5 pasaron contra código actual** — confirma que T2-E resolvió L-330. Test se queda como protección anti-regresión.

Lint 0 / Typecheck 0 / Test 128/128 (+5) / Build 9/9 ✅

---

#### T3-M — ProjectProvider raw fetches (apps/client) 🔗 ✅ 2026-04-29 (refactor cliente + DELETE admin orphan = ejecuta T6-A L-335)

**Scope.** `ProjectProvider` client con raw fetches + window.reload. Depende de decisión T6-A sobre L-335 (admin ProjectProvider ORPHAN).

**Findings table (1):**

| L-#   | Título corto                                       | Esfuerzo | Acción   | §5.9 | Notas                                              |
| ----- | -------------------------------------------------- | -------- | -------- | ---- | -------------------------------------------------- |
| L-100 | `ProjectProvider` raw fetch + stub + window.reload | MEDIUM   | REFACTOR | AUTO | Client provider; depends T6-A L-335 admin decision |

**Entry criteria.** T6-A cerrado (decisión sobre L-335 admin version).

**Exit criteria:**

```bash
grep -rn "window.location.reload" apps/client/src/providers/ProjectProvider.tsx | wc -l   # → 0
grep -rn "fetch(" apps/client/src/providers/ProjectProvider.tsx | wc -l   # → 0 (usar TanStack)
```

**Estimación.** 3-4 h.

**Dependencias.** 🔗 CROSS_TIER_COMPOSITE con T6-A.

**Resultado real.** Refactor completo del client + ejecución del DELETE admin (T6-A L-335) en mismo batch.

**Dominio aclarado.** Project entity = lo que Edward llama "subcuenta/cuenta secundaria" en su modelo mental — unidad de aislamiento multi-tenant: cada Account tiene N Projects, cada Project con sus channels/posts/connections propios. Feature activa con 7 consumers en `apps/client` (no dead code). El renaming `Project` → `Subaccount/Subcuenta` en código sería deuda legítima pero scope grande (Prisma migration + 50+ archivos) — fuera de T3-M, candidato a batch dedicado futuro.

**Bugs L-100 fixeados (4 distintos):**

- **B1+B2 — Silent fetch failures**: 2 raw `fetch()` que retornaban `[]` en error (`fetchAccounts`, `fetchProjects`). Reemplazados por `useQuery` que delega a `authApi.getCurrentUser()` y `apiClient.getAccountProjects(accountId)`.
- **B3 — `window.location.reload()`**: botón Retry hacía full page reload (anti-pattern WCAG, pierde state). Ahora llama `customerQuery.refetch()` / `projectsQuery.refetch()` per TanStack v5 docs.
- **B4 — useEffect manual con cancellation flag**: 67 LOC de imperative data fetching reemplazado por TanStack `useQuery` declarative.

**Nuevo bug descubierto via TDD-first**: en mi primera implementación, `isLoading` quedaba `true` indefinidamente cuando `customerQuery` fallaba — porque `projectsQuery.enabled: false` mantenía `isPending: true` per TanStack v5 semantics. Tests fallaron, fix aplicado: reordenar para que `isError` cortocircuite, derivar loading de `isFetching` no `isPending`. Sin TDD-first no se hubiera detectado (la review por inspección no lo capturó).

**Cambios estructurales:**

1. `apps/client/lib/auth/authApi.ts` User type → añadido `accountId?: string` (refleja shape real del backend `/auth/customer/me`)
2. `apps/client/lib/api/types.ts` Project type → añadido `accountId: string` + `locale: string`
3. `apps/client/lib/api/clients/accountsClient.ts` (new) → `AccountsClient.getAccountProjects(accountId): Promise<Project[]>` siguiendo convención T3-C
4. `apps/client/lib/api/client.ts` facade → expone `apiClient.getAccountProjects(accountId)`
5. `apps/client/providers/ProjectProvider.tsx` → reescrito con `useQuery` (customer + projects, gated con `enabled`) + `refetch()` retry + canon ARIA mantenido
6. `apps/admin/providers/ProjectProvider.tsx` → **DELETE** (T6-A L-335 ORPHAN). Verificado cero consumers.
7. `apps/client/tests/integration/ProjectProvider.integration.test.tsx` (new) → 8 casos: loading, first project resolved, localStorage restoration, error+Retry button, refetch (NOT reload), empty state, initialValues bypass, localStorage persistence. **8/8 passed** post-fix.

**Nota sobre admin re-implementación futura.** El DELETE actual de `apps/admin/providers/ProjectProvider.tsx` no precluye re-implementación futura de una feature admin de visibility per-customer (ej: `apps/admin/components/customers/ClientProjectsView.tsx` con SUPER_ADMIN gate + audit logging) — sería entidad conceptualmente distinta bajo otro path/nombre, no un revival de la ORPHAN actual.

Lint 0 / Typecheck 0 (client + admin) / Tests 378+128 / Build 9/9 ✅

---

#### T3-N — Webhooks TanStack migration ✅ (2026-04-28)

**Scope.** WebhookSubscriptions + WebhookEventsList + DeadLetterQueue bypass TanStack. Expand useWebhooks.

**Findings table (3):**

| L-#   | Título corto                         | Esfuerzo | Acción   | §5.9 | Notas    |
| ----- | ------------------------------------ | -------- | -------- | ---- | -------- |
| L-294 | WebhookEventsList TanStack bypass    | MEDIUM   | REFACTOR | AUTO | ✅ fixed |
| L-295 | WebhookSubscriptions TanStack bypass | MEDIUM   | REFACTOR | AUTO | ✅ fixed |
| L-327 | useWebhooks GAPs (expand hook)       | MEDIUM   | FIX      | AUTO | ✅ fixed |

**Entry criteria.** T3-D cerrado.

**Exit criteria (verified 2026-04-28):**

```bash
# Raw fetch() calls (refetch() from TanStack excluded)
grep -rnE "(^|[^a-zA-Z.])fetch\(" apps/admin/components/webhooks/ | wc -l   # → 0
pnpm lint --max-warnings 0                                                  # → 0
pnpm turbo run test --concurrency=1 --force                                 # → 38/38 (7,496 tests)
pnpm build                                                                  # → 9/9
```

**Resultado:**

- `apps/admin/hooks/api/useWebhooks.ts` (1 archivo) → `useWebhooks/{types,api,queries,mutations,index}.ts` (split por convención T3-F/T3-G)
- 8 query hooks: `useWebhookMetrics`, `useDlqMetrics`, `useWebhookSubscriptions`, `useProjectsForSubscriptionForm`, `useWebhookEvents`, `useWebhookEventDetail`, `useWebhookDeadLetterEvents`, `useOutboxDeadLetter`
- 8 mutation hooks: `useCreateWebhookSubscription`, `useUpdateWebhookSubscription`, `useDeleteWebhookSubscription`, `useRetryWebhookDeadLetter`, `useRetryAllWebhookDeadLetter`, `useExportWebhookEvents`, `useRetryOutboxDlq`, `useResolveOutboxDlq`
- 3 componentes refactor (`WebhookSubscriptions.tsx`, `WebhookEventsList.tsx`, `DeadLetterQueue.tsx`) — manual `fetch` + `useState/useEffect` reemplazado por hooks
- 28 tests Vitest (`useWebhooks.test.tsx`) cubren queries, mutations, edge cases (PR-15 broken endpoint, payload envelope unwrapping, query string forwarding)

**Diferido:** PR-15 — `fetchProjectsForSubscriptionForm` apunta a `/api/backend/projects` que no existe. Comportamiento preservado verbatim del código pre-T3-N (selector vacío en producción). Requiere decisión de producto sobre listing cross-account vs per-account. Documentado en `POST_REMEDIATION_BACKLOG.md` PR-15.

**Estimación.** 4-6 h. **Real:** ~5 h.

**Dependencias.** 🔒 Desbloquea T3-I L-275/L-276.

---

#### T3-O — DeadLetterQueue retry-all backend 🔗

**Scope.** Endpoint `retry-all` DLQ backend unimplemented + UI asume persistence.

**Findings table (1):**

| L-#   | Título corto                                   | Esfuerzo | Acción    | §5.9         | Notas                                           |
| ----- | ---------------------------------------------- | -------- | --------- | ------------ | ----------------------------------------------- |
| L-299 | `retry-all` DLQ endpoint unimplemented backend | MEDIUM   | IMPLEMENT | NEEDS_EDWARD | Backend + UI; decisión: implementar o remove UI |

**Entry criteria.** Edward decide (T6 session).

**Exit criteria:** endpoint wired + integration test + UI pasa end-to-end.

**Estimación.** 2 h.

**Dependencias.** 🔗 CROSS_TIER_COMPOSITE con T6.

---

#### T3-P — Fake-AI composite remediation (UI-only) 🔗

**Scope.** Fake-AI findings que requieren wire a backend (no solo label remove como T2-H). Depende de decisión producto caso-por-caso.

**Findings table (4):**

| L-#   | Título corto                                  | Esfuerzo | Acción | §5.9 | Notas                  |
| ----- | --------------------------------------------- | -------- | ------ | ---- | ---------------------- |
| L-77  | `useContentLibraryState` stub — always empty  | QUICK    | FIX    | AUTO | Wire real API          |
| L-89  | ContentLibrary DEFAULT_FILTER_OPTIONS fake    | QUICK    | FIX    | AUTO | Deps L-77              |
| L-293 | `ScheduledJobsPanel` fake-persistence cron    | MEDIUM   | FIX    | AUTO | Wire backend           |
| L-325 | `useAnalytics` fake-data composite (6 fields) | MEDIUM   | FIX    | AUTO | Implement real metrics |

**Entry criteria.** T3-A cerrado.

**Exit criteria:** cada fake → real API wired con integration test.

**Estimación.** 2-8 h según decisión Edward per-finding.

**Dependencias.** 🔗 CROSS_TIER_COMPOSITE.

---

#### T3-Q — ClientContentEditor autosave wire ✅ (2026-04-29)

**Scope.** `useAutoSave` stub (solo localStorage) + `ClientContentEditor.handleSchedule` stub. Dos fixes en tándem; durante el research del bach se descubrieron 4 bugs cross-cutting adicionales (schema mismatch, hook faltante, providers→channels gap, callers rotos) que se cerraron también.

**Findings table (2):**

| L-#   | Título corto                                  | Esfuerzo | Acción | §5.9 | Notas                   |
| ----- | --------------------------------------------- | -------- | ------ | ---- | ----------------------- |
| L-85  | ClientContentEditor handleSchedule stub       | QUICK    | FIX    | AUTO | ✅ wired                |
| L-205 | `useAutoSave` stub — drafts solo localStorage | QUICK    | FIX    | AUTO | ✅ wired (Pattern Lazy) |

**Entry criteria.** T3-A + T3-C cerrados.

**Exit criteria (verified 2026-04-29):**

```bash
pnpm lint --max-warnings 0                              # → 0
pnpm --filter @apps/api test                            # → 7,279 tests pass (361 files)
pnpm --filter @apps/admin test                          # → 156 tests pass (18 files)
pnpm --filter @apps/workers test                        # → 78 tests pass (5 files)
pnpm --filter @apps/client test                         # → 398 tests pass (20 files)
pnpm --filter @apps/api build                           # → clean
pnpm --filter @apps/admin build                         # → clean
pnpm turbo run build --concurrency=1 --force            # → 4/4 (turbo scoped)
```

**Resultado.**

Aplicado el plan canon-grounded D5.A+B + D5.1.b + D5.3.b (smart default + override channel selector, isPrimary explícito persistido en DB, badge visual con `aria-label="Default channel"`):

- **Phase 1 — Backend Channel.isPrimary:** Prisma migration con partial unique index `(projectId, provider) WHERE is_primary = true AND deleted_at IS NULL` + backfill (oldest channel per pair → primary). Domain entity `markAsPrimary`/`unmarkAsPrimary` (idempotente). Repo port + Prisma adapter (`findPrimaryByProjectAndProvider`, `findByProjectAndProvider`). `SetPrimaryChannelUseCase` con UoW (atómico unmark+mark). `PATCH /channels/:id/set-primary` route. 12 tests nuevos (entity + use case + route).
- **Phase 2 — Frontend hooks `useProjectChannels`:** módulo split (types/api/queries/mutations/index) per convención T3-G/T3-N. `useProjectChannels(projectId)` query + `useSetPrimaryChannel` mutation con TanStack v5 optimistic canon (cancelQueries → snapshot → setQueryData → onError restore → onSettled invalidate) + `mutationKey` + `isMutating` guard (TkDodo). 6 tests integration.
- **Phase 3 — Schema bug fix + `useSchedulePost`:** `publishingClient.ts:54` — `scheduledAt` → `scheduledFor` (matching backend `SchedulePostBodySchema`). `channelIds` ahora required (Zod-aligned). Nuevo hook `useSchedulePost` con TanStack v5 optimistic flow + concurrent-mutation guard. 4 tests integration.
- **Phase 4 — `useAutoSave` refactor canon:** eliminado `setTimeout(500)` fake. Pattern Lazy (Notion/Linear): localStorage fire-and-forget + server save sólo cuando body no vacío + `projectId` disponible. Single-flight para POST create (subsequent ticks queue como PATCH). 10 tests integration.
- **Phase 5 — `ChannelMultiSelect` + editor wire:** componente shared en `packages/ui/src/components/business/ChannelMultiSelect.tsx` (D5.A+B + D5.3.b: fieldset/legend per provider + checkboxes con primary pre-checked + Badge "Default" con `aria-label`). Helper `computeDefaultChannelSelection`. `ClientContentEditor.handleSchedule` rebuilt: ensure-draft-saved (`saveNow`) → `useSchedulePost.mutateAsync({ postId, scheduledFor, channelIds })`. 9 tests.
- **Phase 6 — Settings UI:** `SetPrimaryChannelButton` + `PrimaryChannelsSection` (self-contained con `useProject` + `useProjectChannels`). Añadido al final de `dashboard/channels/page.tsx` sin tocar la sección legacy rota. 3 tests.

**Diferidos (PR-N nuevos descubiertos durante research).**

- **PR-16** — `apps/client/hooks/api/useChannels.ts` legacy pega a endpoint inexistente `/api/backend/channels` y asume shape que el backend no retorna. Dos consumers (RecurringPostForm + dashboard/channels/page) referencian fields fantasma. Refactor de la página completa fuera de scope; T3-Q crea hooks paralelos correctos sin tocar la deuda pre-existente.
- **PR-17** — Two callers de `apiClient.schedulePost` (post detail + preview pages) omiten `channelIds` y 400 contra backend. Forward-compat fix `[]` aplicado para no bloquear el bug fix del schema; UX selector de canales pendiente (cross con T3-R o batch dedicado).

**Estimación.** 3-4 h roadmap → real ~10h (scope expandido por research canon descubriendo 4 bugs cross-cutting + componente UI shared + UoW backend completo).

**Dependencias.** 🔒 Desbloquea editor flows. PR-16/PR-17 quedan diferidos con justificación documentada.

---

#### T3-R — SidebarNav logout + OAuth admin UI ⚡ ⏸️ (parcial — L-305 cerrado 2026-04-29; L-94/L-95 diferidos en PR-18)

**Scope.** SidebarNav locale switching anti-pattern + OAuth connect dead for 10/11 providers + Test/Settings disabled.

**Findings table (3):**

| L-#   | Título corto                                          | Esfuerzo | Acción    | §5.9         | Notas                                        |
| ----- | ----------------------------------------------------- | -------- | --------- | ------------ | -------------------------------------------- |
| L-305 | `SidebarNav` document.cookie + window.location.reload | QUICK    | REFACTOR  | AUTO         | fixed — Server Action + revalidatePath canon |
| L-94  | channels OAuth connect dead for 10/11 providers       | HEAVY    | IMPLEMENT | NEEDS_EDWARD | deferred PR-18 — pendiente decisión producto |
| L-95  | channels Test/Settings disabled "Coming soon"         | QUICK    | DECIDE    | NEEDS_EDWARD | deferred PR-18 — pendiente decisión producto |

**Entry criteria.** T6 decisions session (L-94/L-95 are `DECIDE`).

**Exit criteria (L-305 verified 2026-04-29):**

```bash
grep -n "window.location.reload\|document.cookie" apps/admin/components/shared/SidebarNav.tsx | wc -l   # → 0
pnpm lint --max-warnings 0                                                                            # → 0
pnpm --filter @apps/admin test                                                                        # → 160/160 (4 nuevos)
pnpm --filter @apps/admin build                                                                       # → clean
```

**Resultado L-305 (parcial T3-R).**

- Nuevo Server Action `apps/admin/app/actions/locale.ts` — `setLocaleAction(locale)` valida el locale, escribe `NEXT_LOCALE` cookie con atributos seguros (`path: "/"`, `sameSite: "lax"`, `maxAge: 1y`) vía `cookies().set()`, y dispara `revalidatePath("/", "layout")` para refrescar todos los Server Components.
- `SidebarNav.tsx` refactor: eliminada función `setLocaleCookie` (anti-patrón `document.cookie` + `window.location.reload`). `useTransition` (React 19 canon) wrappea la llamada al Server Action para feedback de pending state. Botones de idioma agregan `aria-pressed` y `disabled` mientras la transición está en curso.
- Tests: 4 unit tests del Server Action (cookie shape, locale "en"/"es", revalidatePath invocation, locale inválido ignorado).

**Diferido (L-94 + L-95).**

- **PR-18** — OAuth real para 10/11 providers + Test/Settings UI cleanup. Bloqueado por decisión de producto sobre alcance de OAuth en admin (¿admin gestiona OAuth real para client accounts? ¿UI de Test/Settings se implementa o se elimina del menú?). Cuando Edward decida, ejecutar como T3-R.2 dedicado. Ver entrada en `POST_REMEDIATION_BACKLOG.md`.

**Estimación.** L-305 real: ~45 min (close a estimación 30 min del roadmap).

**Dependencias.** ⚡ PARALELIZABLE.

---

**T3 total:** 18 micro-batches, **~60-90 h**, 2-3 semanas parciales. T3-A/B/C/D/E/N/Q 🔒; T3-M/O/P 🔗; resto ⚡.

---

### §5.4 — T4 Estructural chico

**26 micro-batches** (T4-A..T4-Z). Cada batch 4 h a 2 días. Introduce ports, consolidaciones, fix de contracts. Esfuerzo total: **130-200 h**, 4-6 semanas parciales.

---

#### T4-A — Hexagonal boundary leaks ✅ (2026-04-30)

**Scope.** Violaciones de boundary hexagonal: imports directos Fastify/db-prisma desde packages. Habilita T5-C + T5-D.

**Findings table (6):**

| L-#   | Título corto                                                  | Esfuerzo | Acción   | §5.9 | Notas                                          |
| ----- | ------------------------------------------------------------- | -------- | -------- | ---- | ---------------------------------------------- |
| L-364 | cache-redis fastify boundary leak (CRITICAL)                  | HEAVY    | REFACTOR | AUTO | fixed — DELETE dead middleware/events          |
| L-507 | `@api-common` BaseRouteHandler Fastify import (CRITICAL)      | HEAVY    | REFACTOR | AUTO | fixed — relocate to apps/api/src/lib           |
| L-384 | `AbstractProviderAdapter` dynamic db-prisma import (CRITICAL) | MEDIUM   | REFACTOR | AUTO | fixed — ChannelCredentialsRepository port + DI |
| L-455 | usePublishingEngine hardcoded URL boundary leak               | QUICK    | FIX      | AUTO | WONT_FIX — false positive (PR-19)              |
| L-525 | `verifyWebhookSignature` fake ctx cast                        | QUICK    | REFACTOR | AUTO | fixed — extracted to framework-neutral utility |
| L-385 | Instagram worker-layer en package (CRITICAL)                  | MEDIUM   | REFACTOR | AUTO | fixed — moved to apps/workers/src/providers/   |

**Entry criteria.** Ninguno.

**Exit criteria (verified 2026-04-30):**

```bash
grep -rn "from \"fastify\"" packages/adapters/cache-redis/src/ packages/api-common/src/ | wc -l   # → 0
grep -rn "import.*@infra/prisma\|import.*@adapters/db-prisma" packages/providers/ | wc -l        # → 0
pnpm lint --max-warnings 0                                                                       # → 0
pnpm --filter @apps/api test                                                                     # → 7,395 tests / 362 files
pnpm --filter @apps/api build / @apps/admin build / @apps/client build                           # → clean
```

**Resultado.**

- **Phase 1 (L-455 verification):** falso positivo — `apiEndpoint` es parámetro, no hardcoded. Hook entero detectado dead-code (cero consumers en apps). Documentado en PR-19.
- **Phase 2 (L-525):** `verifyWebhookSignature` y `constantTimeCompare` extraídos a `packages/api-common/src/webhookSignature.ts` (puro, sin Fastify). `BaseRouteHandler` los consume vía thin wrapper que reporta errores al pino logger sin el cast falso `{} as FastifyRequest`. 8 tests nuevos.
- **Phase 3 (L-364):** `cache-redis/src/middleware.ts` (cachePlugin + CacheInvalidator) y `cache-redis/src/events.ts` (CacheEventManager) eliminados — eran dead code superseded por `apps/api/src/middleware/autoCacheMiddleware.ts`. `RouteCacheOptions` interface re-localizada a `apps/api/src/lib/cache/cacheConfig.ts`. `fastify` y `fastify-plugin` removidos de las deps del package.
- **Phase 4 (L-385):** `publishingWorker.ts` movido de `packages/providers/instagram/src/` a `apps/workers/src/providers/instagram/`. Tests acompañan el move (3 archivos de test). Provider package barrel ahora exporta `InstagramApiClient`, `InstagramMediaProcessor`, `InstagramCredentials` para uso del worker. `@adapters/external-apis` + `@observability/logger` añadidos a workers deps.
- **Phase 5 (L-384):** Nuevo port `ChannelCredentialsRepository` en `packages/providers/shared/src/channelCredentialsRepository.ts`. `setChannelCredentialsRepository(repo)` static injector — wired en `apps/workers/src/publishWorker.ts` y `apps/api/src/index.ts` con `createPrismaRepoAdapter()`. `AbstractProviderAdapter.getCredentialsFromDatabase` ahora resuelve via port. `await import("@adapters/db-prisma")` dinámico eliminado. Dependency `@adapters/db-prisma` removida del package providers/shared.
- **Phase 6 (L-507):** `BaseRouteHandler.ts` movido de `packages/api-common/src/` a `apps/api/src/lib/route-handler/`. Schemas zod (IdSchema, etc.) extraídos a `packages/api-common/src/schemas.ts` (framework-neutral, se quedan). Tests del handler movidos a `apps/api/tests/unit/lib/route-handler/`. ~70 imports en `apps/api/src/` actualizados de `@packages/api-common` a `../lib/route-handler/index.js` (relativo).

**Diferidos.**

- **PR-19** — L-455 falso positivo + observación de dead-code (`usePublishingEngine` hook). Cleanup futuro de packages no consumidos en batch dedicado.

**Estimación.** 15-20 h roadmap → real ~6-8 h (L-364/L-455 fueron dead-code/false-positive en lugar de refactors completos).

**Dependencias.** 🔒 BLOCKS_TIER cerrado — habilita T5-C + T5-D.

---

#### T4-B — EventStore migration a schema 🔒 ✅ 2026-04-30

**Scope.** EventStore runtime DDL → schema.prisma formal migration. EventSnapshots IMPLEMENT (snapshot infrastructure for aggregate rehydration optimization, no equivalent existing).

**Findings table (3):**

| L-#   | Título corto                                             | Esfuerzo | Acción    | §5.9         | Status     | Resolución                                        |
| ----- | -------------------------------------------------------- | -------- | --------- | ------------ | ---------- | ------------------------------------------------- |
| L-41  | `EventStore.ensureTable` runtime DDL / schema divergence | HEAVY    | REFACTOR  | AUTO         | ✅ Cerrado | Modelo `StoredEvent` declarado + migración formal |
| L-42  | `EventStore` referencia `EventSnapshots` no declarada    | MEDIUM   | IMPLEMENT | NEEDS_EDWARD | ✅ Cerrado | Modelo `EventSnapshot` declarado + tabla creada   |
| L-528 | EventStore silent failure catch (CRITICAL)               | QUICK    | FIX       | AUTO         | ✅ Cerrado | `ensureTable()` eliminado completamente           |

**Decisión L-42 (Edward 2026-04-30):** IMPLEMENT, no DELETE. Los métodos `createSnapshot` / `getSnapshot` son scaffolding para feature legítima (snapshot pattern de event sourcing, optimiza rehydration cuando streams superan ~100 eventos). Aplicada la regla "código huérfano ≠ inútil" — el código existe porque el negocio lo previó; no hay equivalente actualmente implementado. Decisión: declarar tabla, marcar como infrastructure-ready (sin consumer aún), agregar al backlog la decisión de retention/dispatch policy cuando haya streams largos.

**Implementación:**

- `infra/prisma/schema.prisma` — Agregados modelos `StoredEvent` (con índices `idx_stored_events_stream_id`, `idx_stored_events_sequence`, unique compuesto `idx_stored_events_stream_version`) y `EventSnapshot` (PK `streamId`).
- `infra/prisma/migrations/20260430191252_add_event_store_tables/` — Migración con `CREATE TABLE IF NOT EXISTS` (idempotente porque dev environments tenían `stored_events` creada via runtime DDL).
- `apps/api/src/events/EventStore.ts` — Eliminado `ensureTable()` + `tableEnsured` flag + `tableName` config. Refactor a Prisma Client typed para `findMany` / `aggregate` / `upsert` / `findUnique`. Raw SQL preservado solo donde Prisma Client no expresa la query (transaction con `MAX()` aggregations en `append`, `NOT IN` subquery en `cleanup`).
- `apps/api/src/events/EventService.ts` — Eliminada llamada `await this.eventStore.ensureTable()` del `initialize()`.
- `apps/api/tests/unit/EventStore.test.ts` — Mock extendido con `storedEvent` y `eventSnapshot` model methods. 33/33 tests verdes.

**Exit criteria:**

```bash
grep -n "model.*stored_events\|StoredEvent" infra/prisma/schema.prisma   # ✅ ≥1
grep -n "CREATE TABLE" apps/api/src/events/EventStore.ts   # ✅ 0
grep -n "ensureTable" apps/api/src/events/EventStore.ts apps/api/src/events/EventService.ts   # ✅ 0
```

**Estimación / real.** Estimado 6–10 h / Real ~3 h.

**Dependencias.** 🔒 BLOCKS_TIER cerrado.

---

#### T4-C — Outbox concurrent claim fix 🔒 ✅ 2026-04-30

**Scope.** OutboxRelay sin SELECT FOR UPDATE SKIP LOCKED + 3 issues outbox composite. Aplicada solución completa lease-based con consumer-side dedupe + full-jitter backoff.

**Findings table (2):**

| L-#  | Título corto                                           | Esfuerzo | Acción | §5.9 | Status     | Resolución                                                                                                                                                                                                                  |
| ---- | ------------------------------------------------------ | -------- | ------ | ---- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-43 | `OutboxRelay` sin `SELECT FOR UPDATE SKIP LOCKED`      | MEDIUM   | FIX    | AUTO | ✅ Cerrado | `OutboxClaimService.claim()` ejecuta `UPDATE…WHERE IN (SELECT…FOR UPDATE SKIP LOCKED LIMIT N) RETURNING` con lease columns.                                                                                                 |
| L-22 | Outbox pattern — 3 issues (race, idempotency, backoff) | HEAVY    | FIX    | AUTO | ✅ Cerrado | (1) race: misma resolución que L-43; (2) idempotency: `OutboxInbox.tryClaimForProcessing` dedupe via `messageId @id` UNIQUE; (3) backoff: `OutboxBackoff.computeDelayMs` full-jitter `random(0, min(cap, base*2^attempt))`. |

**Issues adicionales descubiertos durante ejecución (todos cerrados en mismo batch):**

1. **DLQ archival no atómico** — `outboxDeadLetter.create` + `outboxEvent.update` separados causaban loop infinito si el segundo fallaba (DLQ create violaba `originalEventId @unique` en re-poll). Corregido envolviendo en `prisma.$transaction([...])` dentro de `OutboxClaimService.archiveToDeadLetter`.
2. **Admin retry no atómico** — `outboxAdminRoutes.ts:54-75` tenía la misma clase de bug. Wrap en `$transaction([create, update])`.
3. **Admin route violando hexagonal** — `outboxAdminRoutes.ts:9` `import { prisma } from "@infra/prisma"` directo. Refactor a `fastify.container.resolve<PrismaClient>(TOKENS.PrismaClient)`.
4. **DLQ schema perdía aggregateType** — `outboxAdminRoutes.ts:58` hardcodeaba `aggregateType: "unknown"` porque la tabla `OutboxDeadLetter` no preservaba el field. Schema migration agrega `aggregateType String @default("unknown")` (default solo para back-fill rows residuales en dev).

**Implementación:**

- **Schema migration** `20260501000706_add_outbox_concurrent_claim`:
  - `OutboxEvent`: + `claimedAt`, `claimedBy` (lease columns).
  - `OutboxDeadLetter`: + `aggregateType` con default back-fill.
  - Drop índice `[publishedAt, nextRetryAt]`, replace por partial `idx_outbox_claim_hot ON OutboxEvent (nextRetryAt, occurredAt) WHERE publishedAt IS NULL AND retryCount < maxRetries` (Prisma no soporta `WHERE` en `@@index`, declarado en migration.sql).
  - - tabla `outbox_inbox` con PK `messageId`.
- **Servicios infra nuevos**: `OutboxClaimService` (atomic claim + lease + DLQ transactional), `OutboxBackoff` (full-jitter helper), `OutboxInbox` (consumer dedupe).
- **Refactor `OutboxRelay`**: usa los 3 servicios via DI; mantiene API pública (`start`/`stop`/`poll`/`isRunning`); release-on-transient-failure + DLQ-on-exhausted vía servicios.
- **DI**: `TOKENS.OutboxClaimService`, `TOKENS.OutboxBackoff`, `TOKENS.OutboxInbox` registrados; `workerId = ${hostname}-${pid}` para distinguir claims multi-pod.
- **Tests**: 24 unit tests nuevos (`OutboxBackoff` 8, `OutboxInbox` 5, `OutboxClaimService` 11) + 11 tests `OutboxRelay` (6 preservados + 5 nuevos: dedupe-skip, DLQ rollback propagation, release-on-transient, no-reentrant-poll). Integration test 2-relays concurrent: seed 100 events, `Promise.all([rA.poll(), rB.poll()])` x10 ciclos, asserts dispatches=100 sin duplicates.

**Exit criteria:**

```bash
grep -nE "FOR UPDATE SKIP LOCKED" apps/api/src/infrastructure/outbox/OutboxClaimService.ts   # ✅ 3
grep -n "import.*prisma.*infra/prisma" apps/api/src/outbox/outboxAdminRoutes.ts               # ✅ 0
grep -nE "Math\.pow\(2," apps/api/src/infrastructure/outbox/OutboxRelay.ts                    # ✅ 0
grep -n "claimedAt" infra/prisma/schema.prisma                                                # ✅ 1
grep -n "model OutboxInbox" infra/prisma/schema.prisma                                        # ✅ 1
```

**Estimación / real.** Estimado 4-6 h / Real ~5 h.

**Dependencias.** 🔒 BLOCKS_TIER cerrado.

**Backlog deferred (PRs 21-23):** `OutboxInboxCleaner` retention (PR-21), CDC vía Debezium (PR-22), `LISTEN/NOTIFY` wake-up (PR-23) — fuera de scope T4-C, registrados en `POST_REMEDIATION_BACKLOG.md`.

**Dependencias.** 🔒 BLOCKS_TIER.

---

#### T4-D — Rate limiters consolidation

**Scope.** 5 rate limiters paralelos — decidir canónicos, desmantelar resto.

**Findings table (3):**

| L-#  | Título corto                                                | Esfuerzo | Acción    | §5.9         | Notas                       |
| ---- | ----------------------------------------------------------- | -------- | --------- | ------------ | --------------------------- |
| L-30 | 5 rate limiters paralelos — 1 wired, 4 INFRASTRUCTURE_READY | MEDIUM   | DECIDE    | NEEDS_EDWARD | Consolidar o justificar     |
| L-26 | `rbacMiddleware.roleBasedRateLimit` FAKE                    | MEDIUM   | IMPLEMENT | AUTO         | Redis sorted sets           |
| L-29 | `slidingWindowRateLimit.extractUserId` STUB                 | QUICK    | IMPLEMENT | AUTO         | JWT decode o wire post-auth |

**Entry criteria.** T6 decisions cerrado (L-30 requiere decisión).

**Exit criteria:**

```bash
grep -rn "roleBasedRateLimit" apps/api/src/auth/rbacMiddleware.ts | wc -l   # → 1 con Redis backend
grep -n "return null" apps/api/src/security/slidingWindowRateLimit.ts   # → 0 hits
```

**Estimación.** 4-8 h.

**Dependencias.** BLOCKED_BY T6.

---

#### T4-E — Validators consolidation

**Scope.** 3 validators paralelos + API key SHA-256 → argon2 migration.

**Findings table (2):**

| L-#  | Título corto                                      | Esfuerzo | Acción   | §5.9         | Notas                                              |
| ---- | ------------------------------------------------- | -------- | -------- | ------------ | -------------------------------------------------- |
| L-31 | 3 validators paralelos con patterns SQL distintos | HEAVY    | REFACTOR | NEEDS_EDWARD | Consolidar en único `ValidationPort`               |
| L-32 | 2 sistemas API key hashing (SHA-256 vs argon2)    | HEAVY    | REFACTOR | AUTO         | Migrar credentialManager a argon2 + data migration |

**Entry criteria.** Ninguno.

**Exit criteria:**

```bash
grep -rn "hashApiKey.*sha256\|SHA-256" packages/ apps/ --include="*.ts" | wc -l   # → 0 (post-migration)
```

**Estimación.** 6-10 h.

**Dependencias.** INDEPENDENT.

---

#### T4-F — DI registration fixes 🔒

**Scope.** Consolidar DI container: Redis singleton, EventService unificado, ApiMetrics real.

**Findings table (7):**

| L-#  | Título corto                                              | Esfuerzo | Acción   | §5.9         | Notas                                    |
| ---- | --------------------------------------------------------- | -------- | -------- | ------------ | ---------------------------------------- |
| L-35 | `createRedisConnection()` 13 veces — singleton token      | MEDIUM   | REFACTOR | AUTO         | Register `TOKENS.Redis`                  |
| L-37 | `{} as ApiMetrics` mock vacío (SAFETY_CRITICAL)           | QUICK    | FIX      | AUTO         | `setupServices.ts:262`; crash en runtime |
| L-40 | 9 setup files Prisma singleton vs factory                 | MEDIUM   | REFACTOR | AUTO         | Unificar a lazy factory                  |
| L-36 | EventService sin token DI — 6+ instancias paralelas       | HEAVY    | REFACTOR | NEEDS_EDWARD | Edward CP3 candidate; cross-ref T4-G     |
| L-25 | 4 tokens DI orfanados                                     | QUICK    | DECIDE   | NEEDS_EDWARD | T6 decision                              |
| L-38 | `UpdatePricingConfigUseCase` registrado con 4 no-op stubs | MEDIUM   | DECIDE   | NEEDS_EDWARD | T6 decision                              |
| L-39 | `GenerateRepurposeVariantsUseCase` noOpNotification       | MEDIUM   | DECIDE   | NEEDS_EDWARD | T6 decision                              |

**Entry criteria.** T6 decisions cerrado (L-36/L-25/L-38/L-39).

**Exit criteria:**

```bash
grep -rn "new RedisConnection\|createRedisConnection(" apps/api/src/ | wc -l   # → 1
grep -rn "{} as ApiMetrics\|as ApiMetrics" apps/api/src/ | wc -l   # → 0
grep -rn "new EventService\b" apps/api/src/ | wc -l   # → 1
```

**Estimación.** 6-10 h.

**Dependencias.** 🔒 BLOCKS_TIER.

---

#### T4-G — Integration events handlers NO-OP 🔒

**Scope.** EventService.setupDefaultHandlers 3 no-op + AnalyticsEventHandler + WebhookEventHandler stubs + silent UI refs.

**Findings table (3):**

| L-#  | Título corto                                         | Esfuerzo | Acción    | §5.9         | Notas                              |
| ---- | ---------------------------------------------------- | -------- | --------- | ------------ | ---------------------------------- |
| L-44 | AnalyticsEventHandler + WebhookEventHandler STUBS    | HEAVY    | IMPLEMENT | NEEDS_EDWARD | Edward decide IMPLEMENT vs PLANNED |
| L-45 | `EventService.setupDefaultHandlers` 3 no-op handlers | MEDIUM   | DECIDE    | NEEDS_EDWARD | Wire real o eliminar               |
| L-76 | SILENT-NO-OP outgoing webhooks UI                    | QUICK    | FIX       | AUTO         | Resolved when L-44 fixed           |

**Entry criteria.** T6 decisions cerrado.

**Exit criteria:** handlers emit → consumers fire → metric counter >0 en smoke test.

**Estimación.** 8-12 h.

**Dependencias.** 🔒 BLOCKS_TIER.

---

#### T4-H — QueuePort adapter fix 🔒 ✅ 2026-05-01

**Scope.** Adapter `queue-bullmq` parametrizado por queue name + concurrency configurable + introducción de `QueuePortRegistry` y `DeadLetterQueuePort` para habilitar T4-I y T5-A.

**Findings table (5):**

| L-#   | Título corto                                    | Esfuerzo | Acción   | §5.9 | Status     | Resolución                                                                                                                                                            |
| ----- | ----------------------------------------------- | -------- | -------- | ---- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-61  | QueuePort hardcoded PUBLISH misroute            | —        | —        | —    | ✅ Cerrado | Same composite L-363 — fixed by parametrising adapter.                                                                                                                |
| L-363 | queue-bullmq hardcoded PUBLISH queue (CRITICAL) | MEDIUM   | REFACTOR | AUTO | ✅ Cerrado | `createBullMQQueueAdapter({ queueName })` ahora se invoca con el nombre correcto vía registry.                                                                        |
| L-380 | queue-bullmq `concurrency` ignored              | —        | —        | —    | ✅ Cerrado | `createBullMQConsumerAdapter({ concurrency, removeOnComplete, removeOnFail })` ahora respeta opts.                                                                    |
| L-376 | queue-bullmq test mocks                         | QUICK    | FIX      | AUTO | ✅ Cerrado | Suite del adapter creada (no existía); 27 tests nuevos cubren queue-adapter, consumer-adapter, registry, DLQ adapter.                                                 |
| L-383 | queue-bullmq DLQ wiring no official             | QUICK    | REFACTOR | AUTO | ✅ Cerrado | `DeadLetterQueuePort` declarado en `@ports/core`; `BullMQDeadLetterQueueAdapter` implementa producer-side (`archive`); consumer-side (`list/retry`) deferido a PR-26. |

**Issues laterales descubiertos durante ejecución (todos cerrados en mismo batch):**

1. **Module-level singleton state** (`globalConnection`/`globalQueue`) en el adapter ya no era válido tras parametrizar el queue name — un segundo call con queue distinto reusaría la instancia del primero. Eliminado.
2. **Tests directos del adapter no existían** — `resilience.test.ts` solo cubría el helper. Creados: `queue-adapter.test.ts` (8 tests), `consumer-adapter.test.ts` (5 tests), `queue-port-registry.test.ts` (6 tests), `dead-letter-queue-adapter.test.ts` (8 tests).
3. **`apps/api/src/admin/queueRoutes.ts:260`** sigue creando `new Queue(QUEUE_NAMES.PUBLISH)` directo para introspection (admin reads, no write). Documentado en backlog como aceptable; no migrar (out-of-scope T4-H).

**Implementación:**

- **2 nuevos ports en `@ports/core`:** `QueuePortRegistry` (lookup `forQueue(name): QueuePort` con memoization), `DeadLetterQueuePort` (`archive` + `list` + `retry` con shape canónico per OneUptime canon).
- **4 archivos nuevos en `@adapters/queue-bullmq`:** `queue-adapter.ts` (parametrizado), `consumer-adapter.ts` (parametrizado), `queue-port-registry.ts` (memo + share Redis connection), `dead-letter-queue-adapter.ts` (producer side + NOT_IMPLEMENTED para list/retry).
- **DI:** `TOKENS.QueuePortRegistry`, `TOKENS.DeadLetterQueuePort`. Registry singleton comparte una `IORedis` connection. `TOKENS.QueuePort` mantenido como compatibility binding resolviendo a `registry.forQueue(QUEUE_NAMES.PUBLISH)`.
- **3 use cases re-wireados** (`DispatchAnalyticsIngestionUseCase`, `DispatchInboxSyncUseCase`, `BullMQRepurposeJobDispatcher`): ahora reciben el `QueuePort` correcto via `registry.forQueue(QUEUE_NAMES.X)` — los jobs ya no misrutean a PUBLISH.
- **`apps/api/src/index.ts`** y **`healthRoutes.ts`** resuelven el queue adapter desde el registry. SIGTERM handler agrega `await registry.close()` antes del shutdown final.

**Exit criteria:**

```bash
grep -nE "options\.queueName" packages/adapters/queue-bullmq/src/queue-adapter.ts          # ✅ 4
grep -nE "QUEUE_NAMES\.PUBLISH" packages/adapters/queue-bullmq/src/queue-adapter.ts        # ✅ 0
grep -n "globalConnection\|globalQueue" packages/adapters/queue-bullmq/src/*.ts            # ✅ 0
grep -nE "concurrency: 5" packages/adapters/queue-bullmq/src/consumer-adapter.ts            # ✅ 0
grep -n "BullMQQueuePortRegistry" packages/adapters/queue-bullmq/src/                      # ✅ 6
grep -n "DeadLetterQueuePort" packages/ports/src/index.ts                                  # ✅ 1
grep -nE "forQueue\(QUEUE_NAMES\.(ANALYTICS_AGGREGATION|INBOX_SYNC|GENERATE_REPURPOSE)\)" \
  apps/api/src/infrastructure/container/                                                    # ✅ 3
```

**Estimación / real.** Estimado 4-6 h / Real ~4 h.

**Dependencias.** 🔒 BLOCKS_TIER cerrado. **Habilita T4-I** (Workers retry + shutdown — usa `DeadLetterQueuePort` para mover jobs exhaustos) y T5-A.

**Backlog deferred (PR-24/25/26):**

- PR-24: Migrate `webhookJobProcessor` a `QueuePortRegistry` + `DeadLetterQueuePort` — bloqueado por T4-G (NEEDS_EDWARD).
- PR-25: Migrate workers (`autoRenewalWorker`, `inboxSyncWorker`, etc.) que crean `Queue/Worker` directos — esperado en T4-I.
- PR-26: `DeadLetterQueuePort.list()` y `.retry()` no-implementados; formalizar cuando primer consumer aparezca (T4-I).

---

#### T4-I — Workers retry + shutdown + auth errors 🔒 ✅ 2026-05-01

**Scope.** Workers: silent failure, retry policy missing, graceful shutdown missing, silent AUTH errors. Aplicada solución completa via `defaultJobOptions` en queue level + helper `registerGracefulShutdown` compartido + service `ChannelAuthFailureRecorder` con outbox event para visibilidad downstream.

**Findings table (4):**

| L-#  | Título corto                                            | Esfuerzo | Acción    | §5.9 | Status     | Resolución                                                                                                                                                                                                                                                                                        |
| ---- | ------------------------------------------------------- | -------- | --------- | ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-52 | `publishHandler.handleJob` silent failure (no re-throw) | QUICK    | FIX       | AUTO | ✅ Cerrado | `throw e` después de log + saga notify + `finishJob()`. BullMQ ahora ve el fallo y aplica retry policy.                                                                                                                                                                                           |
| L-53 | 4/6 workers sin retry policy explícita                  | QUICK    | CONFIG    | AUTO | ✅ Cerrado | `defaultJobOptions` por queue en `BullMQQueuePortRegistry`: 3 attempts exponential 5s + jitter 0.5 para PUBLISH/ANALYTICS_AGGREGATION/INBOX_SYNC; 5 attempts 2s para WEBHOOK_PROCESSING; DLQs `attempts: 1`.                                                                                      |
| L-54 | 3/4 workers sin graceful shutdown                       | QUICK    | FIX       | AUTO | ✅ Cerrado | Helper `registerGracefulShutdown` compartido en `apps/workers/src/lib/gracefulShutdown.ts`. Aplicado a los 4 workers (publishWorker, analyticsIngest, inboxSync, autoRenewal). SIGTERM + SIGINT ambos cubiertos.                                                                                  |
| L-56 | `analyticsIngest` + `inboxSync` silent AUTH errors      | MEDIUM   | IMPLEMENT | AUTO | ✅ Cerrado | Schema `Channel.needsReauth/authFailedAt/authFailureReason` + `ChannelAuthFailureRecorder` (UoW transaction: update channel + outbox event) + helper `handleProviderAuthError` (record + throw). Workers re-throw para que BullMQ aplique retry. Notification handler downstream → PR-27 backlog. |

**Issues laterales descubiertos durante ejecución (todos cerrados en mismo batch):**

1. `publishWorker.shutdown()` no cerraba consumer ni notifyRedis — tear-down incompleto. Fix: helper compartido + `afterTeardown` hook.
2. `autoRenewalWorker` solo SIGTERM, sin SIGINT — Ctrl+C en dev no era graceful. Fix: helper compartido cubre ambos signals.
3. `publishWorker.ts:45` llamaba `createBullMQConsumerAdapter()` sin args (firma post-T4-H requería `{ queueName }`) — type error pre-existente. Fix: `createBullMQConsumerAdapter({ queueName: QUEUE_NAMES.PUBLISH })` + ajustar `subscribe(handler)` sin opts arg.
4. Tests de `publishHandler` (`jobHandler.test.ts` + `publishHandlerEdgeCases.test.ts`) asumían que `handleJob` no throw. Actualizados a `assert.rejects(...)` — 9 tests modificados.

**Implementación:**

- **Schema migration** `20260501015624_channel_needs_reauth`: + `needsReauth` (bool default false), `authFailedAt`, `authFailureReason` en Channel + partial index `WHERE needsReauth = true` para lookup eficiente.
- **Domain event** `ChannelAuthFailed` en `apps/api/src/domain/events/ChannelEvents.ts` (extiende `BaseDomainEvent`).
- **Recorder service** `ChannelAuthFailureRecorder` en `apps/workers/src/services/`: prisma `$transaction` que update channel + write outbox row. Construible directo sin DI container.
- **Auth helper** `handleProviderAuthError` en `apps/workers/src/lib/`: thin wrapper `recorder.record() + throw` para testabilidad y consistency entre workers.
- **Graceful shutdown helper** `registerGracefulShutdown` en `apps/workers/src/lib/`: ShutdownTarget config con `workers`, `queues`, `connections`, `prisma`, `afterTeardown`. SIGTERM/SIGINT registrados; idempotente.
- **Adapter extension**: `BullMQQueueAdapterOptions.defaultJobOptions` + `BullMQQueuePortRegistryOptions.defaultJobOptionsByQueue`.
- **DI wiring** en `setupServices.ts`: map de defaults sensatos por queue (jitter 0.5 para queues principales, 0.3 para webhooks high-volume, attempts=1 para 3 DLQs).
- **Tests**: 14 nuevos (`ChannelAuthFailureRecorder` 5, `handleProviderAuthError` 4, `queue-adapter` +2, `queue-port-registry` +1, `jobHandler` +1) + 9 modificados (assert.rejects en publishHandler tests post-re-throw).

**Exit criteria:**

```bash
grep -n "needsReauth" infra/prisma/schema.prisma   # ✅ 5
grep -rn "ChannelAuthFailed" apps/api/src/domain/events/ apps/workers/src/services/   # ✅ 6
grep -n "ChannelAuthFailureRecorder" apps/workers/src/services/*.ts   # ✅ 4
grep -n "defaultJobOptions" packages/adapters/queue-bullmq/src/queue-adapter.ts   # ✅ 3
grep -n "defaultJobOptionsByQueue" apps/api/src/infrastructure/container/setupServices.ts   # ✅ 2
grep -nE "throw e\b" apps/workers/src/publishHandler.ts   # ✅ 3
grep -rn "handleProviderAuthError" apps/workers/src --include="*.ts"   # ✅ 6
grep -rn "registerGracefulShutdown" apps/workers/src --include="*.ts"   # ✅ 9 (helper + 4 workers × 2 [import + call])
```

**Estimación / real.** Estimado 6-10 h / Real ~4 h.

**Dependencias.** 🔒 BLOCKS_TIER cerrado. **Habilita T5-G.**

**Backlog deferred (PR-27):** Notification handler que consuma `ChannelAuthFailedEvent` y cree notification user-facing. Decisión NEEDS_EDWARD: recipient policy (account owner / project admins / todos / mixed). Documentado en `POST_REMEDIATION_BACKLOG.md`.

---

#### T4-J — Workers ubicación + provider registry

**Scope.** Workers scattered across 3 ubicaciones + provider registry drift.

**Findings table (3):**

| L-#   | Título corto                               | Esfuerzo | Acción   | §5.9         | Notas                                       |
| ----- | ------------------------------------------ | -------- | -------- | ------------ | ------------------------------------------- |
| L-65  | 3 ubicaciones workers BullMQ en monorepo   | HEAVY    | REFACTOR | NEEDS_EDWARD | ADR deployment topology                     |
| L-60  | Provider registry drift — 11 vs 10 workers | QUICK    | FIX      | AUTO         | Shared `@providers/shared/providerRegistry` |
| L-642 | Workers Dockerfile single-worker (HIGH)    | MEDIUM   | CONFIG   | AUTO         | Parametrize ENTRYPOINT con WORKER_TYPE      |

**Entry criteria.** T6 decisions cerrado (L-65 ADR).

**Exit criteria:** single registry canonical; ADR committed; Dockerfile parametrized.

**Estimación.** 6-10 h.

**Dependencias.** BLOCKED_BY T6.

---

#### T4-K — AI service port (hexagonal fix) 🔒 ✅ 2026-05-01

**Scope.** Application layer hexagonal cleanup: AIServicePort + HttpClientPort introducidos, VO factory bypass eliminado, UoW agregado a UTM links, external HTTP calls extraídos de UoW de SyncProviderComments, ChannelQueryForIngestion movido a domain.

**Findings table (6):**

| L-#  | Título corto                                                            | Esfuerzo | Acción   | §5.9 | Status     | Resolución                                                                                                                                                    |
| ---- | ----------------------------------------------------------------------- | -------- | -------- | ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-15 | `application/ml/*` viola hexagonal (import AIService)                   | MEDIUM   | REFACTOR | AUTO | ✅ Cerrado | `AIServicePort` declarado en `domain/repositories/`. UCs refactorizados. DI registra port → AIService.                                                        |
| L-16 | `SyncProviderCommentsUseCase` provider API dentro UoW (SAFETY_CRITICAL) | QUICK    | FIX      | AUTO | ✅ Cerrado | Split en 2 fases: (1) fetch all paginated comments, (2) ingest each (each ingest ya tiene UoW interna). El UC outer ya no usa `executeInTransaction`.         |
| L-17 | `IngestChannelAnalyticsUseCase` VO factory bypass (SAFETY_CRITICAL)     | QUICK    | FIX      | AUTO | ✅ Cerrado | `as ChannelId` cast → `ChannelId.fromString(input.channelId)` con Result handling. Tests actualizados con UUIDs válidos.                                      |
| L-18 | `TriggerIntegrationEventService` raw fetch sin port                     | MEDIUM   | REFACTOR | AUTO | ✅ Cerrado | `HttpClientPort` declarado en `domain/repositories/`; `FetchHttpClient` adapter en `infrastructure/adapters/`. UC inyecta el port.                            |
| L-19 | Cross-domain type import `ChannelQueryForIngestion`                     | QUICK    | REFACTOR | AUTO | ✅ Cerrado | Interface movido de `application/analytics/DispatchAnalyticsIngestionUseCase.ts` a `domain/repositories/ChannelQueryForIngestion.ts`. 6 imports actualizados. |
| L-21 | `GenerateUTMLinksUseCase` mutante sin UoW (SAFETY_CRITICAL)             | QUICK    | FIX      | AUTO | ✅ Cerrado | Constructor agrega `unitOfWork?: UnitOfWork`. `execute()` envuelve `findById + setUTMParameters + save` en `executeInTransaction`. DI inyecta UoW.            |

**Issues laterales descubiertos durante ejecución (todos cerrados):**

1. **Comentarios con referencias a fases** (`B0-2`, `F26`, `F28`, `R1-A`, `P2-2`, `P2-5`, `P2-A`, `P2-B`, `B0-4`) en `setupAnalyticsUseCases.ts` y `setupServices.ts` — violación CLAUDE.md "no sprint references in source comments". Limpieza aplicada en archivos tocados.
2. Tests preexistentes para `TriggerIntegrationEventService` mockeaban global `fetch`; actualizados para mockear el `HttpClientPort` inyectado.
3. Tests preexistentes para `SyncProviderCommentsUseCase` pasaban `undefined` como UoW arg; actualizados al constructor sin UoW.

**Implementación:**

- 4 archivos nuevos: `domain/repositories/AIServicePort.ts`, `domain/repositories/HttpClientPort.ts`, `domain/repositories/ChannelQueryForIngestion.ts`, `infrastructure/adapters/FetchHttpClient.ts`.
- 22 tests nuevos: `optimizeContent.test.ts` 4, `predictOptimalTiming.test.ts` 4, `generateUTMLinks.test.ts` 5, `triggerIntegrationEvent.test.ts` 6, `FetchHttpClient.test.ts` 7. Plus 9 tests modificados en suites pre-existentes (sync/integration/ingestChannelAnalytics).
- DI: `TOKENS.AIServicePort`, `TOKENS.HttpClientPort` registrados; `setupAnalyticsUseCases` resuelve port para ml UCs; `setupIntegrationUseCases` inyecta `HttpClientPort` a TriggerIntegrationEvent.

**Exit criteria:**

```bash
grep -n "AIServicePort" apps/api/src/domain/repositories/AIServicePort.ts                # ✅ ≥1
grep -n "HttpClientPort" apps/api/src/domain/repositories/HttpClientPort.ts              # ✅ ≥1
grep -n "ChannelQueryForIngestion" apps/api/src/domain/repositories/ChannelQueryForIngestion.ts  # ✅ ≥1
grep -rn "from.*aiService\|from.*AIService\b" apps/api/src/application/ml --include="*.ts" \
  | grep -v "Port"                                                                        # ✅ 0
grep -nE "^\s+await fetch\(" apps/api/src/application -r --include="*.ts"                # ✅ 0
grep -nE " as.*ChannelId\b" apps/api/src/application/analytics/IngestChannelAnalyticsUseCase.ts  # ✅ 0
grep -n "unitOfWork\|UnitOfWork" apps/api/src/application/utm/GenerateUTMLinksUseCase.ts # ✅ 4
grep -nE "executeInTransaction" apps/api/src/application/inbox/SyncProviderCommentsUseCase.ts  # ✅ 0
```

**Estimación / real.** Estimado 8-12 h / Real ~3 h.

**Dependencias.** 🔒 BLOCKS_TIER cerrado. No habilita batches específicos pero deja application layer hexagonalmente clean para futuros refactors (T4-L cache, T4-M logger).

---

#### T4-L — Cache consolidation 🔒 ✅ 2026-05-01

**Scope real.** 3 sistemas paralelos de caching consolidados detrás de `CachePort` (port + 2 adapters: Redis L1+L2 wrapper + InMemory para tests). Audit canon-driven: 5/5 per-class `Map<>` caches migrados (no 2/5 como hedge inicial), 2/2 module-level Maps L-13 migrados, TTL configurable vía env, health checker verificado wired. **Net code:** ~150 líneas L1+L2 manual eliminadas + 6 servicios + 2 UCs ahora cross-pod coherent + cero perdida de funcionalidad (RedisCacheManager preservado como singleton con keyPrefix `api:`).

**Findings table (4):**

| L-#   | Título corto                                     | Esfuerzo | Acción    | §5.9         | Status     | Resolución                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----- | ------------------------------------------------ | -------- | --------- | ------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-49  | 3 sistemas paralelos de caching                  | HEAVY    | REFACTOR  | NEEDS_EDWARD | ✅ Cerrado | `CachePort` (6 métodos: `get`/`set`/`getOrSet`/`delete`/`invalidateByTag`/`has`) + `RedisCacheAdapter` (wraps singleton `RedisCacheManager`) + `InMemoryCacheAdapter` (tests + per-process). DI: `TOKENS.RedisCacheManager` (singleton) + `TOKENS.CachePort` (port wrapper). 5 per-class caches migrados: `connectionManager.healthCache`, `rbacService.permissionCache` (security-critical OWASP A07), `CredentialManager.credentialCache` (L1+L2 manual eliminado), `VersionController.versionCache` (L1+L2 manual eliminado), `BranchManager.branchCache` (write-only, preservado tal cual + flagged como PR-30). |
| L-13  | Module-level cache pattern (2 UCs, no testeable) | MEDIUM   | REFACTOR  | AUTO         | ✅ Cerrado | `GetTopPerformersContextUseCase` y `FetchTrendingTopicsUseCase` ahora reciben `CachePort` por constructor. `getOrSet(key, factory, { ttlSeconds })` reemplaza `Map<>` global. Tests usan `InMemoryCacheAdapter` — state aislado por test (antes leakeaba via global Map).                                                                                                                                                                                                                                                                                                                                            |
| L-377 | cache-redis TTL default hardcoded                | TRIVIAL  | CONFIG    | AUTO         | ✅ Cerrado | `RedisCacheManager` lee `CACHE_TTL_DEFAULT` (segundos) en construcción; fallback 3600 si unset/unparseable; explicit `config.defaultTtl` sigue ganando. 4 tests cubren los 4 paths.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| L-381 | cache-redis missing health check                 | QUICK    | IMPLEMENT | AUTO         | ✅ Cerrado | `CacheHealthChecker` ya implementado en `packages/monitoring/health-checks/src/checkers/redis.ts:114` y wired en `apps/api/src/health/healthRoutes.ts:88` (verificado durante T4-L; status report a `/health/detailed` incluye `cache: {hitRate, totalKeys, memoryUsage}`).                                                                                                                                                                                                                                                                                                                                          |

**Trabajo adicional (canon-driven):**

1. **`docs/architecture/caching.md` creado** (nuevo): explica el "por qué" de port + 2 adapters — OneUptime/BentoCache canon, OWASP A07:2021 motivation para cross-pod coherence, decision tree para `getOrSet` vs `get/set`, stampede protection roadmap (deferred a PR-29), known dead caches (BranchManager → PR-30), troubleshooting.
2. **CLAUDE.md §Caching** agregado: paralelo a §Logging — tabla de adapters por scope, reglas (no `private *Cache = new Map()`, prefix-namespacing, tag invalidation pattern), defer rationale para stampede protection.
3. **`RedisCacheManager.has(key)`** método agregado: chequea L1 → Redis EXISTS sin decode payload (canonical complement a `get`).

**Canon investigado durante el batch (2026-05-01):**

- [BentoCache — multi-tier canon](https://bentocache.dev/docs/introduction) — primary reference para L1+L2 + tagging API.
- [PettyCache (mediocre/petty-cache)](https://github.com/mediocre/petty-cache) — confirma `getOrSet`-style cache-aside como canonical convenience method.
- [OneUptime — Multi-Layer Caching Redis Node.js (2026)](https://oneuptime.com/blog/post/2026-01-25-multi-layer-caching-redis-nodejs/view) — recomendación explícita: "rather than repositories maintaining private cache instances, they delegate all caching to the injected CacheManager" — single source para los 5 per-class veredictos.
- [type-cacheable](https://github.com/joshuaslate/type-cacheable) + [cache-flow](https://github.com/abourdin/cache-flow) — TypeScript ecosystem convergence en adapter interfaces.
- [Wikipedia — Cache stampede](https://en.wikipedia.org/wiki/Cache_stampede) + [1xAPI single-flight 2026](https://1xapi.com/blog/nodejs-cache-stampede-single-flight-pattern-2026) — motivation para PR-29 (deferred).
- [AlachiSoft — Client cache + distributed](https://www.alachisoft.com/blogs/an-insight-into-using-client-cache-with-distributed-caching/) — "leads to as many caches as application instances, leading to cache coherence problem" — 5/5 per-class migrate decision basis.
- [OWASP A07:2021 — Identification and Authentication Failures](https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/) — threat model para `RbacService.invalidateCache` cross-pod fix.
- [Java Code Geeks — Hexagonal in practice 2025](https://www.javacodegeeks.com/2025/06/hexagonal-architecture-in-practice-ports-adapters-and-real-use-cases.html) — cache como categoría natural para ports.

**Entry criteria.** T4-A cerrado.

**Exit criteria cumplidos:**

- ✅ Single CachePort SoT; 12 archivos consumen `CachePort` (5 servicios + 2 UCs + DI + tests).
- ✅ 0 `RedisCacheManager` directo en `apps/api/src/application`.
- ✅ 0 module-level `Map<>` cache en los 2 UCs.
- ✅ 0 per-class private `Map<>` cache en los 5 servicios.
- ✅ `CACHE_TTL_DEFAULT` env var honored.
- ✅ `CacheHealthChecker` wired en `/health/detailed`.
- ✅ `docs/architecture/caching.md` creado.
- ✅ Lint 0 errors / 0 warnings, build 6/6, tests 371/371 (7,452 tests, 0 failures).

**Estimación.** ~7 h actuales (vs 6-10 estimadas).

**Dependencias.** Cierra L-49 + L-13 + L-377 + L-381. Habilita PR-29 (stampede) + PR-30 (BranchManager dead cache).

---

#### T4-M — Logger port + browser-logger 🔒 ✅ 2026-05-01

**Scope.** Cierre completo del logging infrastructure. Cinco findings YA estaban resueltos por T2-B (browser-logger creado, admin/client lib/logger.ts removidos) — verificados durante T4-M. Los dos restantes (L-552 seed.ts, L-361 pino direct imports) corregidos en este batch.

**Findings table (7):**

| L-#   | Título corto                                           | Esfuerzo | Acción | §5.9 | Status     | Resolución                                                                                                                                                                                                                                                                                                                                               |
| ----- | ------------------------------------------------------ | -------- | ------ | ---- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-347 | `lib/logger.ts` console-based (cross-app admin/client) | QUICK    | FIX    | AUTO | ✅ Cerrado | Verificado en T4-M: `apps/admin/lib/logger.ts` y `apps/client/lib/logger.ts` ya removidos en T2-B; ambos apps usan `@observability/browser-logger`.                                                                                                                                                                                                      |
| L-303 | `ErrorBoundary` console.error                          | —        | —      | —    | ✅ Cerrado | Verificado: `apps/admin/components/shared/ErrorBoundary.tsx` usa `BrowserLoggerPort` con `ConsoleLoggerAdapter` default.                                                                                                                                                                                                                                 |
| L-110 | `error.tsx` uses console.error                         | —        | —      | —    | ✅ Cerrado | Verificado: `apps/admin/app/error.tsx` y `apps/client/app/error.tsx` usan `useLogger("admin.error-page")` desde `@observability/browser-logger`.                                                                                                                                                                                                         |
| L-382 | db-prisma logger no inyectado (usa console)            | TRIVIAL  | FIX    | AUTO | ✅ Cerrado | Verificado: `packages/adapters/db-prisma/src/*` usa `createLogger` desde `@observability/logger`.                                                                                                                                                                                                                                                        |
| L-495 | `console.error` VirtualScrollList                      | TRIVIAL  | FIX    | AUTO | ✅ Cerrado | Verificado: `packages/ui/src/components/VirtualScrollList.tsx` no tiene `console.*`.                                                                                                                                                                                                                                                                     |
| L-552 | `console.log` en seed.ts                               | TRIVIAL  | FIX    | AUTO | ✅ Cerrado | 4 `console.log` reemplazados por `logger.info`. `infra/prisma/package.json` agrega `@observability/logger` como dependency.                                                                                                                                                                                                                              |
| L-361 | Shadowed logger variable                               | TRIVIAL  | FIX    | AUTO | ✅ Cerrado | 5 archivos refactorizados (`index.ts`, `monitoring/cacheStatsRoutes.ts`, `middleware/autoCacheMiddleware.ts`, `lib/cache/cacheDecorators.ts`, `lib/route-handler/BaseRouteHandler.ts`): `import pino` directo → `createLogger(name)` desde `apps/api/src/lib/logger.ts`. Ahora todos heredan redaction config + service binding + test sync destination. |

**Trabajo adicional (canon-driven):**

1. **CLAUDE.md §Logging & Observability** reescrito: el texto previo mencionaba un `LoggerPort` inexistente y declaraba `@observability/logger` como factory única. La sección ahora documenta las 3 factories reales (api con redaction / packages lightweight / browser) + cuándo usar cada una + cómo extender redaction paths con conscientiousness sobre case-sensitivity.
2. **CLAUDE.md fitness check #13** agregado: `grep -rnE "^import pino\b|^const \w+ = pino\(" apps/api/src` para prevenir reintroducción de pino direct.
3. **`docs/architecture/logging.md` creado** (nuevo): explica el "por qué" de las tres factories — OWASP A09:2025 (Security Logging and Alerting Failures), case-sensitivity gotcha de pino redact, y razón por la cual no introducimos un `LoggerPort` formal en domain (Cockburn alternative pattern para cross-cutting concerns).

**Canon investigado durante el batch (2026-05-01):**

- [Better Stack Pino guide](https://betterstack.com/community/guides/logging/how-to-install-setup-and-use-pino-to-log-node-js-applications/), [SigNoz 2026](https://signoz.io/guides/pino-logger/), [Last9](https://last9.io/blog/npm-pino-logger/) — pino production-grade config canon.
- [Pape — Redacting Secrets from Pino logs](https://blog.lepape.me/nodejs-best-practices-redacting-secrets-from-pino-logs/) — case-sensitivity gotcha que motiva la single-factory rule.
- [OWASP A09:2025 — Security Logging and Alerting Failures](https://owasp.org/Top10/2025/A09_2025-Security_Logging_and_Alerting_Failures/) — sensitive data leakage via logs.
- [Cockburn — Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture) — alternativa "decorator + factory" para cross-cutting concerns como logging.

**Backlog deferred (PR-28):** PII redaction paths (`email`, `ssn`, `creditCard`, `phone`, `address`, `dateOfBirth`) no agregados al `REDACT_PATHS` actual. Decisión bloqueada por security/compliance review — agregar redaction sin auditar call-sites puede romper admin/audit/customer-support workflows que legítimamente leen PII en logs. Documentado en `POST_REMEDIATION_BACKLOG.md` con plan estructurado.

**Exit criteria:**

```bash
grep -rnE "^import pino\b|^const \w+ = pino\(" apps/api/src --include="*.ts" \
  | grep -v "lib/logger\.ts\|test\.ts"   # ✅ 0
grep -nE "console\.(log|error|warn)" infra/prisma/seed.ts   # ✅ 0
grep -l "createLogger" apps/api/src/index.ts apps/api/src/monitoring/cacheStatsRoutes.ts \
  apps/api/src/middleware/autoCacheMiddleware.ts apps/api/src/lib/cache/cacheDecorators.ts \
  apps/api/src/lib/route-handler/BaseRouteHandler.ts   # ✅ 5
test -f docs/architecture/logging.md   # ✅
grep -n "fitness #13" CLAUDE.md   # ✅ ≥1 (ahora en §Automated Compliance Checks)
```

**Estimación / real.** Estimado 6-8 h / Real ~2.5 h (T2-B había hecho el grueso).

**Dependencias.** 🔒 BLOCKS_TIER cerrado. Habilita batches futuros que dependan del logger pattern unificado.

---

#### T4-N — CorrelationTracker + OTel

**Scope.** CorrelationTracker singleton + OTel instrumentation fixes.

**Findings table (6):**

| L-#   | Título corto                                | Esfuerzo | Acción   | §5.9 | Notas                        |
| ----- | ------------------------------------------- | -------- | -------- | ---- | ---------------------------- |
| L-510 | `CorrelationTracker` setInterval no cleanup | QUICK    | FIX      | AUTO | Add shutdown hook            |
| L-511 | `CorrelationTracker` singleton DI violation | QUICK    | REFACTOR | AUTO | Move a Container             |
| L-512 | `ContextPropagation` span leak              | QUICK    | FIX      | AUTO | Use finally                  |
| L-513 | `PublishingInstrumentation` span name drift | QUICK    | FIX      | AUTO | Align semantic conventions   |
| L-33  | 2 sistemas correlation ID generation        | QUICK    | REFACTOR | AUTO | Wire `correlationMiddleware` |
| L-509 | OTel fs instrumentation doubled             | QUICK    | FIX      | AUTO | De-dup                       |

**Entry criteria.** T4-F cerrado (DI container consistent).

**Exit criteria:**

```bash
grep -rn "correlationMiddleware" apps/api/src/index.ts | wc -l   # → ≥1
```

**Estimación.** 6-10 h.

**Dependencias.** BLOCKED_BY T4-F.

---

#### T4-O — Health checkers fixes

**Scope.** Health checkers: DatabaseHealth probe, StorageHealth, tenantHealth, QueueHealth misfiled, CircuitBreakerHealth + SagaHealth (gaps).

**Findings table (6):**

| L-#   | Título corto                                     | Esfuerzo | Acción    | §5.9         | Notas                             |
| ----- | ------------------------------------------------ | -------- | --------- | ------------ | --------------------------------- |
| L-515 | `DatabaseHealthChecker` `listAccounts` probe     | TRIVIAL  | FIX       | AUTO         | SELECT 1                          |
| L-516 | `StorageHealthChecker` SigV4 generation          | QUICK    | FIX       | AUTO         | Head request                      |
| L-517 | `checkers/circuitBreaker.ts` dead (paired L-473) | —        | —         | —            | Resolved via T6-E                 |
| L-518 | `tenantHealth.ts` `channels[]` hardcoded         | QUICK    | FIX       | AUTO         | Query real                        |
| L-521 | `CircuitBreakerHealthChecker` never registered   | MEDIUM   | DECIDE    | NEEDS_EDWARD | Register or delete (par con T6-E) |
| L-522 | No `SagaHealthChecker` (L-63 gap)                | MEDIUM   | IMPLEMENT | NEEDS_EDWARD | Post-T5-A fix                     |

**Entry criteria.** T6-E cerrado.

**Exit criteria:** health endpoint returns 200 + all checkers responsive.

**Estimación.** 6-10 h.

**Dependencias.** BLOCKED_BY T6-E.

---

#### T4-P — Fitness functions CI wire 🔒 🔗

**Scope.** Wire los 10 greps CLAUDE.md + thresholds iniciales [0,0,8,3,0,0,0,0,130,0].

**Findings table (2):**

| L-#   | Título corto                                            | Esfuerzo | Acción | §5.9 | Notas                                                  |
| ----- | ------------------------------------------------------- | -------- | ------ | ---- | ------------------------------------------------------ |
| L-630 | CLAUDE.md fitness functions ausentes CI                 | MEDIUM   | CONFIG | AUTO | Crear `.github/workflows/fitness.yml` con los 10 greps |
| L-647 | Confirmación + escalation fitness functions CI ausentes | —        | —      | —    | Escalation de L-630 — mismos fixes                     |

**Entry criteria.** Ninguno.

**Exit criteria:**

```bash
test -f .github/workflows/fitness.yml && echo OK
# Workflow corre los 10 greps y fail if thresholds excedidos
```

**Estimación.** 4-6 h.

**Dependencias.** 🔒 BLOCKS_TIER (post-wire); 🔗 CROSS_TIER con T1-F / T2-G / T3-H / T4-K / T6 (todos alimentan thresholds descendentes).

---

#### T4-Q — CI pipeline repair 🔒

**Scope.** CI composite: broken refs, absorbed items, secrets, performance orphan chain.

**Findings table (9):**

| L-#   | Título corto                                                | Esfuerzo | Acción | §5.9         | Notas                                                  |
| ----- | ----------------------------------------------------------- | -------- | ------ | ------------ | ------------------------------------------------------ |
| L-616 | CI/CD broken pipeline composite                             | HEAVY    | FIX    | NEEDS_EDWARD | Composite absorbe L-617/L-618/L-619/L-620              |
| L-617 | —                                                           | —        | —      | —            | Absorbed L-616                                         |
| L-618 | —                                                           | —        | —      | —            | Absorbed L-616                                         |
| L-619 | —                                                           | —        | —      | —            | Absorbed L-616                                         |
| L-620 | —                                                           | —        | —      | —            | Absorbed L-616                                         |
| L-621 | `DEPENDENCY_UPDATE_TOKEN` PAT blast radius                  | QUICK    | CONFIG | NEEDS_EDWARD | Migrar a GitHub App token                              |
| L-623 | password123 séxtuple (seed + scripts + tests + 3 workflows) | QUICK    | FIX    | AUTO         | Secrets via `.env` + GitHub Secrets; absorbe L-600     |
| L-624 | seed scripts no compilan                                    | MEDIUM   | FIX    | NEEDS_EDWARD | Decide fix vs remove                                   |
| L-625 | baseline-capture compilation errors                         | MEDIUM   | DECIDE | NEEDS_EDWARD | Delete workflow                                        |
| L-626 | performance workflow orphan chain (missing script)          | QUICK    | DECIDE | NEEDS_EDWARD | `scripts/performance.ts` missing                       |
| L-627 | performance/k6 dir missing                                  | QUICK    | DECIDE | NEEDS_EDWARD | Par con L-626                                          |
| L-629 | `cleanup.yml` org account assumption                        | QUICK    | FIX    | NEEDS_EDWARD | Gate `if: github.event.organization` o remove workflow |

**Entry criteria.** T6 decisions cerrado (L-624/L-625/L-626/L-627/L-629 tienen DECIDE).

**Exit criteria:**

```bash
grep -c "password123" .github/workflows/ infra/prisma/seed.ts apps/api/tests/integration/helpers/ scripts/   # → 0
# Manual: 27 acciones workflow pinned por SHA, 0 @master/@main
```

**Estimación.** 10-15 h.

**Dependencias.** 🔒 BLOCKS_TIER.

---

#### T4-R — CSV injection + audit completeness

**Scope.** CSV sanitization + audit userId extraction real.

**Findings table (2):**

| L-#   | Título corto                                           | Esfuerzo | Acción    | §5.9 | Notas                          |
| ----- | ------------------------------------------------------ | -------- | --------- | ---- | ------------------------------ |
| L-526 | admin CSV exports bypass safe util (security)          | QUICK    | FIX       | AUTO | Force csvSanitize              |
| L-27  | `auditLogger.extractUserId` STUB (CRITICAL compliance) | MEDIUM   | IMPLEMENT | AUTO | Extraer `request.auth.user.id` |

**Entry criteria.** Ninguno.

**Exit criteria:**

```bash
grep -n "return undefined" apps/api/src/security/auditLogger.ts   # → 0
grep -rn "csvSanitize" apps/api/src/ --include="*.ts" | wc -l   # → ≥1
```

**Estimación.** 4-6 h.

**Dependencias.** INDEPENDENT.

---

#### T4-S — File upload validator

**Scope.** fileUploadValidator placeholder + simulated ClamAV → real.

**Findings table (1):**

| L-#  | Título corto                                          | Esfuerzo | Acción    | §5.9         | Notas                                                             |
| ---- | ----------------------------------------------------- | -------- | --------- | ------------ | ----------------------------------------------------------------- |
| L-28 | `fileUploadValidator` placeholder + simulated scanner | HEAVY    | IMPLEMENT | NEEDS_EDWARD | ClamAV-REST / VirusTotal / AWS GuardDuty; persistencia quarantine |

**Entry criteria.** T6 decisions (Edward decide scope mínimo si no hay budget).

**Exit criteria:**

```bash
grep -rn "Simulate ClamAV\|scanForMalware.*placeholder" apps/api/src/ | wc -l   # → 0
```

**Estimación.** 6-10 h.

**Dependencias.** BLOCKED_BY T6.

---

#### T4-T — Schema FK gaps + CHECK constraints

**Scope.** FK gaps, partial indexes, CHECK constraints composites.

**Findings table (6):**

| L-#   | Título corto                            | Esfuerzo | Acción | §5.9 | Notas                                    |
| ----- | --------------------------------------- | -------- | ------ | ---- | ---------------------------------------- |
| L-534 | Composite unique NULL-trap (3 files)    | MEDIUM   | FIX    | AUTO | Partial indexes                          |
| L-535 | CHECK constraints composite (5+ fields) | HEAVY    | FIX    | AUTO | Raw migrations con CHECK                 |
| L-536 | Partial indexes missing soft-delete     | MEDIUM   | FIX    | AUTO | Partial indexes WHERE deleted_at IS NULL |
| L-539 | `DataBreachReport` FK gap               | QUICK    | FIX    | AUTO | Declare relation                         |
| L-540 | `ConsentRecord` FK gap                  | QUICK    | FIX    | AUTO | Declare relation + cascade               |
| L-541 | Decimal precision inconsistency         | QUICK    | FIX    | AUTO | Standard: money 19,4 / rates 10,6        |

**Entry criteria.** Ninguno.

**Exit criteria:** migration applied + data integrity verified.

**Estimación.** 6-10 h.

**Dependencias.** INDEPENDENT.

---

#### T4-U — Invoice Float → Decimal migration 🔒

**Scope.** Invoice amount Float → Decimal (CRITICAL precision). Habilita T5-E.

**Findings table (1):**

| L-#   | Título corto                                         | Esfuerzo | Acción   | §5.9 | Notas                                                 |
| ----- | ---------------------------------------------------- | -------- | -------- | ---- | ----------------------------------------------------- |
| L-538 | Invoice `amount: Float` billing precision (CRITICAL) | HEAVY    | REFACTOR | AUTO | Migrar a `Decimal @db.Decimal(19,4)` + data migration |

**Entry criteria.** T0-A cerrado (secrets rotados antes de tocar billing).

**Exit criteria:**

```bash
grep -n "amount.*Float" infra/prisma/schema.prisma   # → 0 (except non-money floats)
pnpm --filter @apps/api test:integration -- billing
```

**Estimación.** 4-8 h.

**Dependencias.** 🔒 BLOCKS_TIER (habilita T5-E).

**Notas.** Fix delicado — precision loss retrospectivo podría afectar invoices existentes. Data migration script con audit trail obligatorio.

---

#### T4-V — RBAC single SoT 🔒

**Scope.** RBAC SUPER_ADMIN double SoT (seed.ts + roles.ts) + ADMIN_PASSWORD fallback weak.

**Findings table (2):**

| L-#   | Título corto                                       | Esfuerzo | Acción   | §5.9         | Notas                                 |
| ----- | -------------------------------------------------- | -------- | -------- | ------------ | ------------------------------------- |
| L-545 | RBAC SUPER_ADMIN double source of truth (CRITICAL) | MEDIUM   | REFACTOR | NEEDS_EDWARD | Single SoT en `@shared/rbac/roles.ts` |
| L-546 | ADMIN_PASSWORD fallback weak (seed.ts)             | QUICK    | FIX      | AUTO         | Fail-fast si env missing              |

**Entry criteria.** Ninguno.

**Exit criteria:**

```bash
grep -rn "SUPER_ADMIN.*permissions" infra/prisma/seed.ts | wc -l   # → 0 (importa desde shared/rbac)
```

**Estimación.** 3-4 h.

**Dependencias.** 🔒 BLOCKS_TIER (simplifica T5-A).

---

#### T4-W — Seeds split prod/dev

**Scope.** Seed mixing bootstrap + test + demo → split con NODE_ENV gates.

**Findings table (5):**

| L-#   | Título corto                                      | Esfuerzo | Acción   | §5.9         | Notas                                     |
| ----- | ------------------------------------------------- | -------- | -------- | ------------ | ----------------------------------------- |
| L-547 | seed-mixing composition (bootstrap + test + demo) | MEDIUM   | REFACTOR | NEEDS_EDWARD | Split + NODE_ENV gates; absorbe L-548     |
| L-551 | test accounts un-gated                            | QUICK    | FIX      | AUTO         | Gate                                      |
| L-559 | seed not in CI                                    | QUICK    | CONFIG   | AUTO         | Add `pnpm db:seed` step a integration job |
| L-561 | Event sourcing bypass seed                        | MEDIUM   | DECIDE   | NEEDS_EDWARD | Decidir boundary emit events              |
| L-560 | seed coverage gap composite                       | —        | —        | —            | Resolved via T4-W + T1-I                  |

**Entry criteria.** T4-V cerrado.

**Exit criteria:**

```bash
ls infra/prisma/seed-*.ts | wc -l   # → ≥2
```

**Estimación.** 6-10 h.

**Dependencias.** BLOCKED_BY T4-V.

---

#### T4-X — Webhook dashboard N+1 + retry queue 🔒

**Scope.** webhookDashboardService 854 LOC N+1 + retry queue real implementation.

**Findings table (1):**

| L-# | Título corto                                             | Esfuerzo | Acción   | §5.9 | Notas                                                    |
| --- | -------------------------------------------------------- | -------- | -------- | ---- | -------------------------------------------------------- |
| L-7 | `webhookDashboardService` 854 LOC N+1 + retry queue stub | HEAVY    | REFACTOR | AUTO | Timeline query optimization + implement retry queue real |

**Entry criteria.** T3-H cerrado (split básico).

**Exit criteria:** Timeline query < 10 DB calls (era 72 N+1); retry queue end-to-end test.

**Estimación.** 8-12 h.

**Dependencias.** 🔒 BLOCKS_TIER.

---

#### T4-Y — Dockerfile + base image build 🔒

**Scope.** Dockerfile broken shared-base (API no deployable).

**Findings table (1):**

| L-#   | Título corto                                      | Esfuerzo | Acción | §5.9         | Notas                                                                     |
| ----- | ------------------------------------------------- | -------- | ------ | ------------ | ------------------------------------------------------------------------- |
| L-640 | Dockerfile broken shared-base (API no deployable) | MEDIUM   | FIX    | NEEDS_EDWARD | `apps/api/Dockerfile:8`; crear `build-base-image.yml` o inline-multistage |

**Entry criteria.** T6 decisions (inline vs build workflow).

**Exit criteria:** `docker build` API image succeeds.

**Estimación.** 4-6 h.

**Dependencias.** 🔒 BLOCKS_TIER.

---

#### T4-Z — Trends/Reports consolidation

**Scope.** reports/ vs custom-reports/ sistemas paralelos + trends mock data decisión.

**Findings table (2):**

| L-#  | Título corto                                       | Esfuerzo | Acción   | §5.9         | Notas                                              |
| ---- | -------------------------------------------------- | -------- | -------- | ------------ | -------------------------------------------------- |
| L-20 | `reports/` vs `custom-reports/` sistemas paralelos | HEAVY    | REFACTOR | NEEDS_EDWARD | Migrar consumers a custom-reports + delete reports |
| L-8  | `trendAnalysisService.ts` mock data en 3 métodos   | MEDIUM   | DECIDE   | NEEDS_EDWARD | TikTok API real OR mark DEMO_MODE                  |

**Entry criteria.** T6-J cerrado (Trends/radar decision).

**Exit criteria:** single reports path; trends documented decision.

**Estimación.** 10-15 h.

**Dependencias.** BLOCKED_BY T6-J.

---

**T4 total:** 26 micro-batches, **~130-200 h**, 4-6 semanas parciales. 🔒 T4-A/B/C/F/G/H/I/K/M/P/Q/U/V/X/Y. BLOCKED_BY T6 varios.

---

### §5.5 — T5 Estructural grande

**9 micro-batches** (T5-A..T5-J — sin T5-F por simetría con alternate plan). Cada item es sprint dedicado 3-8 días. Ejecutar item-por-item con ADR. Esfuerzo total: **100-400 h**, 2-4 meses parciales.

---

#### T5-A — Saga + CQRS wire 🔒 CRÍTICO

> **EL BATCH MÁS IMPORTANTE DEL PLAN.**

**Scope.** Wire Saga + CQRS end-to-end. Resuelve el problema transversal **"UI miente al usuario"**: la UI muestra success cuando el backend hace NO-OP silencioso porque sagas/CQRS bus está vacío.

**Narrativa.** Cuando un usuario hace click en "Publish" o "Schedule" o "Switch Gateway", la UI responde OK. Internamente, el handler toca un CQRSBus que nunca fue wired; la saga que debería orquestar el flujo corre sobre un bus vacío; los jobs emitidos nunca llegan a workers que no existen. El resultado final: el post no se publica, el gateway no cambia, la saga se queda pending forever — pero la UI ya mostró "éxito".

Este batch cierra esa mentira. Wire CQRSBus, wire saga handlers, crear workers faltantes (gateway switch), verificar que la UI NO muestra OK hasta que haya confirmación real. Es el batch con mayor impacto en confianza del usuario.

**Findings table (8):**

| L-#  | Título corto                                                                   | Esfuerzo | Acción    | §5.9         | Notas                                                                                     |
| ---- | ------------------------------------------------------------------------------ | -------- | --------- | ------------ | ----------------------------------------------------------------------------------------- |
| L-63 | `SagaIntegration` ejecuta commands via CQRSBus vacío (SAFETY_CRITICAL runtime) | HEAVY    | IMPLEMENT | NEEDS_EDWARD | Wire handlers OR introducir `PostSagaPort`                                                |
| L-64 | `SagaIntegration` job status checker STUB fake optimistic                      | MEDIUM   | IMPLEMENT | AUTO         | Real BullMQ queue.getJob().getState()                                                     |
| L-47 | CQRS subsystem = PLANNED + bus vacío                                           | MEDIUM   | DECIDE    | NEEDS_EDWARD | Reactivate vs delete                                                                      |
| L-62 | `GATEWAY_SWITCH` queue publisher activo pero consumer missing (CRITICAL)       | MEDIUM   | IMPLEMENT | AUTO         | Crear `gatewaySwitchWorker.ts` + UCs                                                      |
| L-66 | 5 queues PLANNED sin workers                                                   | MEDIUM   | DECIDE    | NEEDS_EDWARD | `REPORT_GENERATION`, `RECURRING_POSTS`, `DETECT_REPURPOSE`, `TRIAGE_INBOX`, `TREND_RADAR` |
| L-67 | DEAD_LETTER_QUEUE + FAILED_OPERATIONS_DLQ sin wire                             | QUICK    | DECIDE    | NEEDS_EDWARD | Git blame history + validación                                                            |
| L-71 | SILENT-NO-OP billing gateway switch                                            | QUICK    | FIX       | AUTO         | Resolved when L-62 fixed                                                                  |
| L-72 | SILENT-NO-OP publish/schedule UI compound                                      | QUICK    | FIX       | AUTO         | Resolved when L-52+L-64 fixed                                                             |

**Entry criteria.** T4-A + T4-H + T4-I cerrados. T6 decisions cerrado (L-47 / L-66 / L-67 / L-63 tienen NEEDS_EDWARD).

**Exit criteria:**

```bash
grep -n "registerHandler" apps/api/src/saga/SagaIntegration.ts   # → ≥1
# Real job status (no stub optimistic):
grep -A2 "getJobStatuses" apps/api/src/saga/SagaIntegration.ts | grep -v "completed: jobIds.length"
# Gateway switch worker exists:
test -f apps/workers/src/gatewaySwitchWorker.ts && echo OK
# E2E test: publish post → real workflow → UI correctly reflects state
```

**Estimación.** 30-50 h (sprint dedicado).

**Dependencias.** 🔒 BLOCKS_TIER; cascade de dependencias — T4-A + T4-H + T4-I + T4-V + T6 decisions.

**Orden interno:**

1. L-62 (gateway switch worker warm-up — aislado, ganancia temprana).
2. L-64 (stub fix — real job status).
3. L-47 (decisión: reactivate CQRS vs delete).
4. L-63 (wire handlers post-decisión L-47).
5. L-66 / L-67 (decisiones queue-by-queue).
6. L-72 / L-71 (UI verification — éxito visible solo tras confirmación real).

**Notas.** Edward debe dedicar un sprint completo. Este batch no se fracciona.

---

#### T5-B — Content module integration 🔒

**Scope.** content/ module integration — PLANNED o execute. Decision gate.

**Findings table (3):**

| L-#  | Título corto                                            | Esfuerzo | Acción    | §5.9         | Notas                                      |
| ---- | ------------------------------------------------------- | -------- | --------- | ------------ | ------------------------------------------ |
| L-9  | `content/SyncEngineImpl` MASIVOS STUBS con routes wired | DEEP     | IMPLEMENT | NEEDS_EDWARD | CORE_CONCEPTUAL — sprint completion        |
| L-10 | `content/VersionController` DB persistence stub         | DEEP     | IMPLEMENT | NEEDS_EDWARD | Sprint content subsystem completion        |
| L-11 | content/ SyncEngineImpl vs ConflictDetector duplication | MEDIUM   | REFACTOR  | NEEDS_EDWARD | Delegar a ConflictDetector + SyncScheduler |

**Entry criteria.** T6-G cerrado (Edward decide EXECUTE o PLANNED).

**Exit criteria (si EXECUTE):** sync engine end-to-end test; version history persistent; UI wired.

**Exit criteria (si PLANNED):** TODO markers + documentación backlog; rutas marcadas como feature-flag OFF.

**Estimación.** 80-120 h si EXECUTE; 0 h si PLANNED (solo marcar).

**Dependencias.** 🔒 BLOCKS_TIER; BLOCKED_BY T6-G.

---

#### T5-C — RepoPort split 🔒 ALTO IMPACTO

**Scope.** RepoPort GOD_INTERFACE 199 LOC 8 aggregates → split per aggregate + CQRS separation.

**Findings table (1):**

| L-#   | Título corto                                | Esfuerzo | Acción   | §5.9         | Notas                                                                                  |
| ----- | ------------------------------------------- | -------- | -------- | ------------ | -------------------------------------------------------------------------------------- |
| L-362 | RepoPort GOD_INTERFACE 199 LOC 8 aggregates | DEEP     | REFACTOR | NEEDS_EDWARD | Split per aggregate + CQRS separation (~48h); afecta ~56 adapters + todos los UseCases |

**Entry criteria.** T4-A cerrado. Edward aprueba sprint dedicado.

**Exit criteria:** each aggregate has own port; adapters migrated; tests pass; fitness functions verdes.

**Estimación.** 40-80 h.

**Dependencias.** 🔒 BLOCKS_TIER; BLOCKED_BY T4-A.

**Notas.** Puede posponerse si ROI inmediato bajo. T5-D y otros pueden avanzar sin esto resuelto.

---

#### T5-D — Providers 5-way consolidation 🔒

**Scope.** Providers triple → 5-way 1,440 LOC duplicate apps/api. Consolidar a `@providers/shared` + `@ports/core`.

**Findings table (4):**

| L-#   | Título corto                                               | Esfuerzo | Acción   | §5.9         | Notas                                                       |
| ----- | ---------------------------------------------------------- | -------- | -------- | ------------ | ----------------------------------------------------------- |
| L-14  | Providers triple overlap (legacy)                          | —        | —        | —            | Superseded por L-386                                        |
| L-386 | L-14 upgrade 5-way 1,440 LOC apps/api duplicate (CRITICAL) | DEEP     | REFACTOR | NEEDS_EDWARD | Consolidar `apps/api/src/providers/*` → `@providers/shared` |
| L-441 | apiClient boilerplate 11-way consolidation (2,200 LOC)     | HEAVY    | REFACTOR | AUTO         | Extract `@providers/shared/apiClient` base class            |
| L-387 | Relative path threadPlanner                                | TRIVIAL  | REFACTOR | AUTO         | Use alias                                                   |

**Entry criteria.** T4-A cerrado.

**Exit criteria:** providers live only en `@providers/*`; apps/api/src/providers empty or re-export thin; no duplication.

**Estimación.** 20-40 h.

**Dependencias.** 🔒 BLOCKS_TIER; BLOCKED_BY T4-A.

---

#### T5-E — GatewayBillingService refactor

**Scope.** GatewayBillingService 1042 LOC god + fake eventId fix.

**Findings table (1):**

| L-# | Título corto                                                      | Esfuerzo | Acción   | §5.9 | Notas                        |
| --- | ----------------------------------------------------------------- | -------- | -------- | ---- | ---------------------------- |
| L-6 | `GatewayBillingService` 1042 LOC + fake eventId (SAFETY_CRITICAL) | HEAVY    | REFACTOR | AUTO | Split + fix L732 idempotency |

**Entry criteria.** T4-U cerrado (Decimal migration first).

**Exit criteria:**

```bash
find apps/api/src/billing/ -name "*Service.ts" | wc -l   # → ≥3 (orig 1042 splittado)
grep -n "generateEventId\|fakeEventId" apps/api/src/billing/   # → 0
```

**Estimación.** 20-30 h.

**Dependencias.** BLOCKED_BY T4-U.

---

#### T5-G — Inbox sync worker → domain UC

**Scope.** `inboxSyncWorker` bypass domain layer — invocar UC via DI.

**Findings table (2):**

| L-#  | Título corto                          | Esfuerzo | Acción   | §5.9 | Notas                                       |
| ---- | ------------------------------------- | -------- | -------- | ---- | ------------------------------------------- |
| L-55 | `inboxSyncWorker` bypass domain layer | MEDIUM   | REFACTOR | AUTO | Invocar `IngestSocialMessageUseCase` via DI |
| L-74 | SILENT-NO-OP inbox                    | QUICK    | FIX      | AUTO | Resolved when L-55+L-61 fixed               |

**Entry criteria.** T4-I cerrado; T4-H cerrado (L-61 composite).

**Exit criteria:** worker delegates to UseCase; inbox pipeline verifiable end-to-end.

**Estimación.** 10-20 h.

**Dependencias.** BLOCKED_BY T4-I.

---

#### T5-H — Publishing subsystem DEAD cleanup

**Scope.** Publishing subsystem ~2,711 LOC DEAD — DELETE si Edward aprueba.

**Findings table (7):**

| L-#   | Título corto                              | Esfuerzo | Acción | §5.9         | Notas                                               |
| ----- | ----------------------------------------- | -------- | ------ | ------------ | --------------------------------------------------- |
| L-68  | Publishing subsystem DEAD_CODE ~2,711 LOC | HEAVY    | DELETE | NEEDS_EDWARD | Cluster unifica L-141/L-143/L-147/L-156/L-162/L-169 |
| L-141 | UnifiedPublishingDashboard 620 LOC DEAD   | —        | —      | —            | Absorbed L-68                                       |
| L-143 | ContentPreviewSystem DEAD                 | —        | —      | —            | Absorbed L-68                                       |
| L-147 | ProviderAdaptationEngine DEAD             | —        | —      | —            | Absorbed L-68                                       |
| L-156 | AdminContentEditor DEAD                   | —        | —      | —            | Absorbed L-68                                       |
| L-162 | provider-previews DEAD                    | —        | —      | —            | Absorbed L-68                                       |
| L-169 | publishingDashboardApi DEAD               | —        | —      | —            | Absorbed L-68                                       |

**Entry criteria.** T6-D cerrado (Edward decide DELETE vs WIRE).

**Exit criteria (si DELETE):**

```bash
find apps/client/src/components/publishing/ -type f | wc -l   # → reduced to living subset
grep -rn "UnifiedPublishingDashboard\|ContentPreviewSystem\|ProviderAdaptationEngine" apps/ | wc -l   # → 0
```

**Estimación.** 4-8 h si DELETE aprobado; si WIRE, es sprint gigante (T5-B-like).

**Dependencias.** BLOCKED_BY T6-D.

---

#### T5-I — i18n infrastructure 🔗

**Scope.** i18n decisión producto: single-language cleanup vs true i18n.

**Findings table (15):**

| L-#   | Título corto                                         | Esfuerzo | Acción   | §5.9         | Notas           |
| ----- | ---------------------------------------------------- | -------- | -------- | ------------ | --------------- |
| L-113 | Language mix Spanish/English sin i18n                | HEAVY    | REFACTOR | NEEDS_EDWARD | i18n decision   |
| L-296 | i18n drift composite admin (17 components)           | HEAVY    | REFACTOR | NEEDS_EDWARD | Cross-ref L-113 |
| L-470 | i18n drift UI individuales (13 components)           | HEAVY    | REFACTOR | NEEDS_EDWARD | UI layer i18n   |
| L-471 | i18n UI individual                                   | —        | —        | —            | Absorbed L-470  |
| L-472 | i18n UI individual                                   | —        | —        | —            | Absorbed L-470  |
| L-473 | i18n UI individual (distinto del L-473 monitor T6-E) | —        | —        | —            | Absorbed L-470  |
| L-474 | i18n UI individual                                   | —        | —        | —            | Absorbed L-470  |
| L-475 | i18n UI individual                                   | —        | —        | —            | Absorbed L-470  |
| L-476 | i18n UI individual                                   | —        | —        | —            | Absorbed L-470  |
| L-477 | i18n UI individual                                   | —        | —        | —            | Absorbed L-470  |
| L-478 | i18n UI individual                                   | —        | —        | —            | Absorbed L-470  |
| L-479 | i18n UI individual                                   | —        | —        | —            | Absorbed L-470  |
| L-480 | i18n UI individual                                   | —        | —        | —            | Absorbed L-470  |
| L-481 | i18n UI individual                                   | —        | —        | —            | Absorbed L-470  |
| L-482 | i18n UI individual                                   | —        | —        | —            | Absorbed L-470  |

**Entry criteria.** Edward decide (T6 session — decisión de producto).

**Exit criteria:** i18n library adopted + all strings extracted (si i18n); or all strings normalized a single language (si cleanup).

**Estimación.** 40-80 h si i18n real; 8-12 h si single-language cleanup.

**Dependencias.** 🔗 CROSS_TIER_COMPOSITE con T6.

---

#### T5-J — Repurpose + feature completions

**Scope.** Features pending spec producto: repurpose, stories, IA review.

**Findings table (3):**

| L-#  | Título corto                                         | Esfuerzo | Acción    | §5.9         | Notas                      |
| ---- | ---------------------------------------------------- | -------- | --------- | ------------ | -------------------------- |
| L-75 | SILENT-NO-OP repurpose                               | QUICK    | FIX       | AUTO         | Resolved when worker added |
| L-87 | Instagram stories 4 callbacks "Coming soon"          | MEDIUM   | IMPLEMENT | NEEDS_EDWARD | Wire o hide                |
| L-96 | Instagram Create Stories/Reels/Carousel dead buttons | QUICK    | IMPLEMENT | NEEDS_EDWARD | Router integration         |

**Entry criteria.** Product spec + T6 decisions.

**Exit criteria:** feature specs defined + integration tests passing.

**Estimación.** Variable (product-driven).

**Dependencias.** BLOCKED_BY product.

---

**T5 total:** 9 micro-batches, **100-400 h**, 2-4 meses parciales. T5-A EL BATCH MÁS IMPORTANTE.

---

### §5.6 — T6 Decisiones de producto primero

**10 batches de decisión** (T6-A..T6-J). **No se ejecutan como código** en este tier — se ejecutaron como **sesión de decisiones con Edward el 2026-04-21**. Cada batch produjo un output (DELETE / WIRE / RESCATE / PLANNED) que ahora alimenta los batches T1..T5 con acción concreta.

**Estado v2.1 (2026-04-21):** 9 de 10 decisiones cerradas. Solo T6-H (analytics/project auth) sigue pending. **Tendencia:** WIRE-heavy (8 de 10), lo cual redefine el scope y la cadencia (ver §8 + §11 changelog).

---

#### T6-A — Admin hooks ORPHAN (decisión cerrada 2026-04-21)

**Scope.** Hooks admin sin consumers detectables. Clasificados per-item en KEEP / WIRE / RESCATE / DELETE.

**Findings table (18) — con acción final:**

| L-#   | Título corto                                       | Esfuerzo | Acción final   | §5.9         | Notas                                                                                                            |
| ----- | -------------------------------------------------- | -------- | -------------- | ------------ | ---------------------------------------------------------------------------------------------------------------- |
| L-317 | `useAuditLogs` ORPHAN                              | QUICK    | KEEP           | DONE         | Live — solo formalizar (documentar consumers)                                                                    |
| L-318 | `useAuditStats` ORPHAN                             | QUICK    | KEEP           | DONE         | Live — solo formalizar                                                                                           |
| L-319 | `useContentLibrary` ORPHAN (admin)                 | MEDIUM   | WIRE           | NEEDS_EDWARD | SUPER_ADMIN + audit log obligatorio (support/compliance/abuse only). **BLOCKED_BY L-27 (T4-R audit logger fix)** |
| L-320 | `useMultiPlatformScheduling` ORPHAN (admin)        | MEDIUM   | WIRE           | NEEDS_EDWARD | SUPER_ADMIN gate. Incluye L-341 + L-343 rescatados                                                               |
| L-321 | `usePerformanceInsights` ORPHAN (admin)            | MEDIUM   | WIRE           | NEEDS_EDWARD | SUPER_ADMIN gate                                                                                                 |
| L-322 | `usePosts` ORPHAN (admin)                          | QUICK    | DELETE         | AUTO         | Admin no gestiona posts                                                                                          |
| L-323 | `usePublicSettings` ORPHAN TOTAL                   | QUICK    | DELETE         | AUTO         |                                                                                                                  |
| L-324 | `useUniversalAnalytics` ORPHAN                     | QUICK    | DELETE         | AUTO         |                                                                                                                  |
| L-335 | `ProjectProvider` 322 LOC ORPHAN (admin)           | MEDIUM   | DELETE         | AUTO         | ✅ ejecutado 2026-04-29 dentro de T3-M (cero consumers verificados)                                              |
| L-338 | `useQueueManager` 213 LOC ORPHAN colocated         | MEDIUM   | WIRE           | NEEDS_EDWARD | SUPER_ADMIN gate. Integrar en dashboard `/maintenance` existente                                                 |
| L-339 | `ai-content-utils.ts` 178 LOC ORPHAN + 4 fake-AI   | MEDIUM   | RESCATE (stub) | NEEDS_EDWARD | Reemplazar código con stub placeholder para implementación futura. Idea válida                                   |
| L-340 | `notificationStore` 80 LOC ORPHAN + broken promise | QUICK    | DELETE         | AUTO         | Phase 2/3 jamás cumplida                                                                                         |
| L-341 | `schedulingCsvParser.ts` 178 LOC ORPHAN            | QUICK    | RESCATE        | NEEDS_EDWARD | Activo con L-320 (WIRE)                                                                                          |
| L-342 | `types/ai-content.ts` ORPHAN (par con L-339)       | TRIVIAL  | RESCATE        | NEEDS_EDWARD | Preservar para L-339 futuro                                                                                      |
| L-343 | `types/scheduling.ts` ORPHAN (par con L-341)       | TRIVIAL  | RESCATE        | NEEDS_EDWARD | Activo con L-341                                                                                                 |
| L-346 | `ProjectProvider` 2 raw fetches en código dead     | —        | DELETE         | —            | Resolved with L-335                                                                                              |
| L-348 | `proxy.ts` re-confirmed ORPHAN                     | —        | DELETE         | —            | Absorbed L-267                                                                                                   |
| L-349 | `ai-content-utils` emoji truncation bug            | —        | RESUELTO       | —            | Auto-resuelto vía L-339 stub replacement                                                                         |

**Decisión final (2026-04-21).**

- **KEEP** (live, solo formalizar): L-317, L-318.
- **WIRE + SUPER_ADMIN gate** (+ audit log para L-319): L-319, L-320, L-321, L-338.
- **RESCATE** (stubs/preservación para features futuras): L-339, L-341, L-342, L-343.
- **DELETE**: L-322, L-323, L-324, L-335, L-340, L-346, L-348, L-349.

**RBAC implications.** 4 nuevos permisos SUPER_ADMIN requeridos: `CONTENT_LIBRARY_VIEW`, `QUEUE_MANAGE`, `ANALYTICS_GLOBAL_VIEW`, `SCHEDULING_ADMIN`. Se resuelven durante T4-V (RBAC single SoT).

**Esfuerzo actualizado.** ~2 semanas implementación WIRE + 0.5 semana DELETE cleanup.

---

#### T6-B — Package-level ORPHAN adapters (decisión cerrada 2026-04-21 — SPLIT 5a + 5b)

**Scope.** Storage + CRM adapters orphan. Edward optó por **WIRE ambos** (dividido en dos sub-batches con scope distinto).

---

##### T6-B 5a — Storage multi-cloud (WIRE)

**Decisión final (2026-04-21).** WIRE multi-cloud por razón de negocio (mirroring + factor de costo por tenant).

| L-#   | Título corto                                   | Esfuerzo | Acción final | §5.9         | Notas                                         |
| ----- | ---------------------------------------------- | -------- | ------------ | ------------ | --------------------------------------------- |
| L-366 | `@adapters/storage-azure` ORPHAN (456 LOC)     | HEAVY    | WIRE         | NEEDS_EDWARD | DI registration + StorageFactory              |
| L-367 | `@adapters/storage-gcs` ORPHAN (445 LOC)       | HEAVY    | WIRE         | NEEDS_EDWARD | DI registration + StorageFactory              |
| L-370 | `@adapters/storage-do-spaces` ORPHAN (198 LOC) | MEDIUM   | KEEP (alias) | NEEDS_EDWARD | Thin S3 wrapper — preservar                   |
| L-365 | cloudinary runtime bug L192 (en ORPHAN)        | MEDIUM   | FIX          | AUTO         | Implicado por wire (bug corregido al activar) |

**Work.** DI registration per adapter + `StorageFactory` con env selector + UI toggle per tenant (si selección multi-tenant de storage) + testing.

**Esfuerzo actualizado.** ~2 semanas.

---

##### T6-B 5b — CRM integrations (WIRE)

**Decisión final (2026-04-21).** WIRE ambos adapters. Slack va a roadmap B11 (aún no codificado).

| L-#   | Título corto                                       | Esfuerzo | Acción final | §5.9         | Notas                                   |
| ----- | -------------------------------------------------- | -------- | ------------ | ------------ | --------------------------------------- |
| L-369 | `@adapters/crm-salesforce` ORPHAN (293 LOC)        | HEAVY    | WIRE         | NEEDS_EDWARD | OAuth + contact sync + activity logging |
| L-371 | `@adapters/crm-hubspot` ORPHAN (267 LOC)           | MEDIUM   | WIRE         | NEEDS_EDWARD | OAuth + sync                            |
| L-350 | `packages/shared/src/client.ts` DEAD_CODE          | TRIVIAL  | DELETE       | AUTO         | Re-export sin consumer                  |
| L-351 | `packages/shared/src/templates/types.ts` DEAD_CODE | TRIVIAL  | DELETE       | AUTO         | Cluster con L-350                       |

**Work.** Env vars (`CLIENT_ID`/`SECRET` per provider) + DI + UI "connect CRM" OAuth flow + batch sync workers BullMQ.

**Nuevos RBAC permisos.** `CRM_MANAGE`, `INTEGRATIONS_CONFIGURE`.

**Roadmap futuro B11.** Slack integration (no codificada todavía; OAuth + message posting + channel notifications tipo CRM).

**Esfuerzo actualizado.** ~3-4 semanas.

---

#### T6-C — Content editor chain packages/ui (decisión cerrada 2026-04-21) 🔗

**Scope.** Editor chain ~2,515 LOC orphan en packages/ui. Complementario con T6-G (content module core).

**Decisión final (2026-04-21).** WIRE Fase 1 — TipTap core + validación + publishing engine + provider constraints. Timeline/diff/restore (versioning UI compleja) van con T6-G Fase 2/3.

**Findings table (13) — con acción final:**

| L-#   | Título corto                                        | Esfuerzo | Acción final   | §5.9         | Notas                                       |
| ----- | --------------------------------------------------- | -------- | -------------- | ------------ | ------------------------------------------- |
| L-442 | `usePublishingEngine` ORPHAN (272 LOC, packages/ui) | HEAVY    | WIRE Fase 1    | NEEDS_EDWARD | Pair con L-444                              |
| L-443 | `useProviderConstraints` ORPHAN (215 LOC)           | MEDIUM   | WIRE Fase 1    | NEEDS_EDWARD | FIX L-455 boundary leak (hardcoded API URL) |
| L-444 | TipTapContentEditor ORPHAN (359 LOC)                | HEAVY    | WIRE Fase 1    | NEEDS_EDWARD | Editor chain core                           |
| L-445 | ValidationContentEditor ORPHAN (261 LOC)            | HEAVY    | WIRE Fase 1    | NEEDS_EDWARD |                                             |
| L-446 | ContentVersioning ORPHAN (299 LOC)                  | HEAVY    | WIRE Fase 1    | NEEDS_EDWARD |                                             |
| L-447 | VersionCompactView ORPHAN (344 LOC)                 | HEAVY    | WIRE Fase 1    | NEEDS_EDWARD |                                             |
| L-448 | VersionTimelineView ORPHAN (287 LOC)                | HEAVY    | WIRE Fase 1    | NEEDS_EDWARD |                                             |
| L-449 | VersionCompareView ORPHAN (~220 LOC)                | HEAVY    | WIRE (T6-G F2) | NEEDS_EDWARD | Timeline/diff — va con T6-G Fase 2          |
| L-450 | VersionDetailDialog ORPHAN (~180 LOC)               | MEDIUM   | WIRE (T6-G F2) | NEEDS_EDWARD | Timeline/diff — va con T6-G Fase 2          |
| L-451 | VersionRestoreDialog ORPHAN (~140 LOC)              | MEDIUM   | WIRE (T6-G F2) | NEEDS_EDWARD | Restore — va con T6-G Fase 2                |
| L-452 | VersionFilterBar ORPHAN (~110 LOC)                  | MEDIUM   | WIRE (T6-G F2) | NEEDS_EDWARD | Timeline/diff — va con T6-G Fase 2          |
| L-453 | `useContentVersioning` ORPHAN (316 LOC)             | MEDIUM   | WIRE Fase 1    | NEEDS_EDWARD | Hook core — necesario desde F1              |
| L-454 | `useVirtualScroll` + memo HOC ORPHAN                | QUICK    | WIRE           | NEEDS_EDWARD | Performance helper reutilizable             |

**Scope reducido ~15-20%** vía rescate T6-D: `ContentPreviewSystem` (L-143) + `provider-previews` (L-162) se integran aquí como layer de preview real-time per-provider — evita re-implementación.

**Esfuerzo actualizado.** ~60-80h UI + ~20h testing = ~2 semanas.

---

#### T6-D — Subsistema Publishing (decisión cerrada 2026-04-21 — RESCATE SELECTIVO)

**Scope.** Publishing DEAD ~2,711 LOC. Edward optó por **rescate selectivo + DELETE residual** en vez de DELETE blanket.

**Decisión final (2026-04-21).**

**RESCATE (~1,731 LOC reutilizables para T6-G / T6-C):**

- **L-147** `ProviderAdaptationEngine` (494 LOC) → se convierte en UI layer del `PlatformContentAdapter` de T6-G.
- **L-143** `ContentPreviewSystem` (604 LOC) → integrado en T6-C editor chain (preview real-time per provider).
- **L-162** `provider-previews` (327 LOC) → companion de `ContentPreviewSystem`.
- **L-169** `publishingDashboardApi` (306 LOC) → extraer **types/schemas**; descartar handlers inventados.

**DELETE (~980 LOC):**

- **L-141** `UnifiedPublishingDashboard` (620 LOC) — orquestación fallida v2.
- **L-156** `AdminContentEditor` (360 LOC) — duplicación; T6-C provee editor canónico.

**Findings table — con acción final:**

| L-#   | Título corto                              | Esfuerzo | Acción final    | §5.9         | Notas                                                |
| ----- | ----------------------------------------- | -------- | --------------- | ------------ | ---------------------------------------------------- |
| L-68  | Publishing subsystem DEAD_CODE ~2,711 LOC | HEAVY    | RESUELTO        | —            | Composite resuelto vía rescate selectivo             |
| L-141 | UnifiedPublishingDashboard (620 LOC)      | HEAVY    | DELETE          | AUTO         | Orquestación fallida v2                              |
| L-143 | ContentPreviewSystem (604 LOC)            | HEAVY    | RESCATE → T6-C  | NEEDS_EDWARD | Preview real-time per provider                       |
| L-147 | ProviderAdaptationEngine (494 LOC)        | HEAVY    | RESCATE → T6-G  | NEEDS_EDWARD | UI layer del PlatformContentAdapter                  |
| L-156 | AdminContentEditor (360 LOC)              | HEAVY    | DELETE          | AUTO         | Duplicación (T6-C provee editor canónico)            |
| L-162 | provider-previews (327 LOC)               | MEDIUM   | RESCATE → T6-C  | NEEDS_EDWARD | Companion de L-143                                   |
| L-169 | publishingDashboardApi (306 LOC)          | MEDIUM   | RESCATE parcial | NEEDS_EDWARD | Extraer types/schemas; descartar handlers inventados |

**Esfuerzo actualizado.** ~1 semana rescate migration + ~2h DELETE cleanup (en vez de DELETE blanket).

---

#### T6-E — Circuit Breaker monitor (decisión cerrada 2026-04-21)

**Scope.** `@monitoring/circuit-breaker` 95% DEAD scaffolding.

**Decisión final (2026-04-21).** WIRE + build `/admin/resilience` dashboard (opción 2 — monitor + UI). Consolidar opossum en una sola versión.

**Findings table (4) — con acción final:**

| L-#   | Título corto                                       | Esfuerzo | Acción final     | §5.9         | Notas                         |
| ----- | -------------------------------------------------- | -------- | ---------------- | ------------ | ----------------------------- |
| L-506 | `@monitoring/circuit-breaker` 95% DEAD (scaffold)  | HEAVY    | WIRE             | NEEDS_EDWARD | Central monitor               |
| L-473 | `@monitoring/circuit-breaker` central monitor DEAD | —        | WIRE             | —            | Paired con L-506              |
| L-368 | opossum 3-way version drift + circuit breaker DEAD | HEAVY    | FIX (consolidar) | AUTO         | Unificar en una sola versión  |
| L-517 | `checkers/circuitBreaker.ts` dead (paired L-473)   | —        | WIRE             | —            | `CircuitBreakerHealthChecker` |

**Nuevo work.** Build panel `/admin/resilience` consumiendo los 5 endpoints del monitor (previamente la UI del monitor estaba TBD).

**Nuevo RBAC permiso.** `RESILIENCE_VIEW` (SUPER_ADMIN).

**Dependencia.** `L-513` OTel span names drift debe estabilizarse primero (T4-N).

**Esfuerzo actualizado.** 6-12h monitor wire + 4-6h UI admin = ~1.5 semanas.

---

#### T6-F — Misclassifications D1 pre-D0v4-1 (confirmado 2026-04-21)

**Scope.** 21 endpoints reclasificar `KEEP_AS_INTERNAL` → `BUILD_UI` (SSO admin UI + Zapier/Make bilateral + Health dependency panel + Providers health dashboard) + 7 endpoints `auth/authRoutes.ts` admin-side verify.

**Decisión final (2026-04-21).** Confirmada la descripción de v2. **Estado: aplicar durante ejecución de batches relevantes** (no un batch atómico):

- SSO admin UI → encaja en **B11** (ver §5.7).
- Health dependency panel + Providers health dashboard → encajan en **T4-O**.
- Zapier/Make bilateral → **B11**.

**Findings table (informativo — no Ls individuales asignados; gate de decisión):**

> Este batch es **pre-requisito metodológico** — no tiene findings con L-# propios. Los endpoints ya están en `ENDPOINT_AUDIT.md`. Los L-# derivados (L-70-sso, L-71-zapier, etc.) están en Apéndice B11 (ver §5.7 — PLANNED backlog).

**Status.** Ongoing per-batch during execution — no sesión dedicada.

---

#### T6-G — Content module CORE_CONCEPTUAL prioritization (decisión cerrada 2026-04-21)

**Scope.** content/ 18 endpoints PLANNED 7.6K LOC.

**Decisión final (2026-04-21).** **WIRE Fase 1** (ejecutar) + **PLANNED_CRÍTICO Fase 2/3** (cuando Edward apruebe).

**Fase 1 — WIRE (~3 semanas):**

- Backend: `SyncEngineImpl` refactor para delegar a `ConflictDetector` + `SyncScheduler` (~300-400 LOC).
- Backend: `VersionController` DB persistence (Prisma schema + migration, ~200 LOC).
- Backend: Wire `ContentSynchronizer` entry point en DI + worker integration (~150 LOC).
- UI cliente: version timeline / restore simple (3-4 pantallas, ~500-800 LOC).
- Integration: `publishWorker` llama `VersionController.createSnapshot` antes de postear.
- Testing (unit + integration, ~300 LOC).

**Fase 2 — PLANNED_CRÍTICO (~2 semanas):** branches + merges + conflict detection/resolution UI.

**Fase 3 — PLANNED_CRÍTICO (~3 semanas):** real-time sync + inbound change detection desde providers.

**Rescate T6-D contribuye.** `ProviderAdaptationEngine` → UI `PlatformContentAdapter`; `ContentPreviewSystem` → preview integration.

**Findings table (anchor):**

| L-#  | Título corto                               | Esfuerzo | Acción final | §5.9         | Notas           |
| ---- | ------------------------------------------ | -------- | ------------ | ------------ | --------------- |
| L-9  | content/SyncEngineImpl MASIVOS STUBS (ref) | HEAVY    | WIRE Fase 1  | NEEDS_EDWARD | Primary en T5-B |
| L-10 | content/VersionController DB (ref)         | HEAVY    | WIRE Fase 1  | NEEDS_EDWARD | Primary en T5-B |

**Esfuerzo total proyectado.** ~8 semanas cuando Fase 2/3 se aprueben (3 + 2 + 3).

**Nuevo RBAC permiso.** `CONTENT_SNAPSHOT_MANAGE` (para control de restore/snapshot operations).

---

#### T6-H — /analytics/project/:projectId auth decisión (decisión cerrada 2026-04-21)

**Scope.** Endpoint `GET /analytics/project/:projectId` en `apps/api/src/analytics/analyticsRoutes.ts:685-689` sin auth middleware — comment en código: "no auth required for read".

**Decisión final (2026-04-21).** **DELETE endpoint completo.** Razón Edward: admin no tiene proyectos. Nota: el endpoint era consumido por apps/client (proyectos son concepto cliente), así que esta DELETE **elimina la feature "ver analytics de proyecto" del cliente también**. Cambio de scope producto aceptado explícitamente.

**Findings table (1):**

| L-#  | Título corto                        | Esfuerzo | Acción | §5.9 | Notas                                  |
| ---- | ----------------------------------- | -------- | ------ | ---- | -------------------------------------- |
| L-73 | SILENT-NO-OP analytics empty params | QUICK    | DELETE | AUTO | Endpoint + handler + consumers cliente |

**Alcance de ejecución.**

1. Remover registro en `apps/api/src/analytics/analyticsRoutes.ts:685-689` + handler method.
2. Grep `/analytics/project/` en `apps/client/` y `apps/admin/` — remover consumers si existen.
3. Actualizar tests (`apps/api/tests/`) — remover assertions del endpoint.
4. Actualizar OpenAPI / doc `docs/api/` si está listado.
5. Verificar que el build + test suite verde post-delete.

**Placement en cadencia.** Micro-batch standalone (~1-2h) — cabe naturalmente en **T2** como sub-batch de seguridad. No bloquea otros batches.

**Estimación.** 1-2h.

---

#### T6-I — RateLimitingDashboard + CQRS reclassification (decisión cerrada 2026-04-21)

**Scope.** RateLimitingDashboard clase nunca instanciada clasificada BUILD_UI P1 incorrectamente.

**Decisión final (2026-04-21).** **DELETE** scaffold incompleto (~551 LOC — class never instantiated, helpers return hardcoded 0 awaiting RedisTimeSeries). **REEMPLAZO: nueva feature B11** "Admin rate limit configuration + visibility" con spec completo.

**Nueva feature B11: Admin rate limit configuration + visibility:**

- **Feature A (lectura):** admin UI `/admin/rate-limits` — tabla con `tier` / `endpoint` / `limit` / `window` / `current usage`.
- **Feature B (escritura):** edit modal + hot reload config sin restart.
- **Componentes backend:** DB table `rate_limit_configs`, Redis pub/sub para hot reload, audit log for changes.
- **Nuevo RBAC permiso:** `RATE_LIMIT_ADMIN` (SUPER_ADMIN).
- **Prerequisitos:** L-27 audit logger funcional (T4-R).
- **Estimación:** ~2-3 semanas.

**Findings table (informativo):**

> Reference a pre-D0v4-1 classification. No L-# nuevo asignado aquí. Decision alimenta T4-D + T4-F + §5.7 B11 (nueva feature).

**Status.** DELETE scaffold (executa durante T4-D/T4-F cleanup) + nueva feature spec añadida a B11 (§5.7).

**L-47 CQRS — decisión cerrada 2026-04-21.**

**WIRE_WITH_MIGRATION** (corregido respecto a v2 que lo tenía como DEFER/DECIDE):

- **WIRE** CQRS subsystem (1-2h backend: instanciar `CQRSIntegration` + fix prefix `/api/cqrs` → `/cqrs`).
- **MIGRATE** `apps/client` consumers de `/api/posts/*` → `/cqrs/*` (~4-8h refactor hooks).
- **MIGRATE** `apps/admin` idem (~2-4h).
- **DEPRECATE** `/api/posts/*` con `410 Gone` + grace period 2-4 semanas.
- **DELETE** legacy endpoints (~1h).
- **Simplifica T5-C** (RepoPort split se beneficia de CQRS separation ya enforced).
- **REORDER: ejecutar L-47 antes de T5-C.**
- **Esfuerzo actualizado.** 8-15h total.

---

#### T6-J — Trends/radar + analytics rescatados (sin cambio)

**Scope.** Trends/radar approved (sprint pending) + Analytics endpoints rescatados a BUILD_UI P1.

**Decisión final.** Mantiene la decisión previa (approved implement de 2026-04-18). Sin cambio en sesión 2026-04-21.

**Findings table (1):**

| L-# | Título corto                        | Esfuerzo | Acción | §5.9 | Notas      |
| --- | ----------------------------------- | -------- | ------ | ---- | ---------- |
| L-8 | `trendAnalysisService.ts` mock data | —        | —      | —    | Cross T4-Z |

**Output esperado.** Sprint schedule + DEMO_MODE flag vs real TikTok API wire.

**Estimación sesión.** 20 min.

---

#### T6 addendum — L-42 EventSnapshots (decisión cerrada 2026-04-21)

**Scope.** `EventStore` referencia `EventSnapshots` no declarada (primary actualmente en T4-B). Decisión sobre wire vs delete methods.

**Decisión final (2026-04-21).** **WIRE con retención configurable + feature de billing monetizable**:

- WIRE con **retention policy parametrizable** (30/60/180 días configurable).
- Auto-delete tras retention period via scheduled cleanup job.
- **Oferta como feature de billing adicional** (cliente paga por extended snapshot retention como "backup").
- **Billing tier gating:** basic = 30 días, pro = 90 días, enterprise = 180+ días customizable.
- **Dependencias:** T4-U Invoice Decimal + pricing tiers system (garantizar billing infrastructure antes de monetizar).
- **Nuevo RBAC permiso:** `CONTENT_SNAPSHOT_MANAGE` (para admin/enterprise tenants).
- **Esfuerzo estimado:** ~2 semanas (snapshot impl 9-13h + retention job ~1 día + billing tier integration ~1 día + UI billing feature toggle ~1 día).

**Nota.** L-42 permanece como primary en T4-B con la acción actualizada a WIRE + retention policy.

---

**T6 total (v2.1).** 10 batches de decisión + L-42 addendum. **9 cerrados 2026-04-21, 1 pending (T6-H).** Genera scope WIRE-heavy que desplaza la cadencia de 17 → 35-40 semanas (ver §8 + §11).

---

### §5.7 — B11 PLANNED features backlog (fuera del ciclo)

> Heredado de v1 §5.11. No se ejecuta en este roadmap. Son features conceptualmente completas en arquitectura pero sin UI/integration, esperando priorización producto.

**v2.1 — items nuevos (desde sesión T6 2026-04-21):**

| Feature                                         | Origen          | Notas                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Admin rate limit configuration + visibility** | T6-I split      | Reemplaza `RateLimitingDashboard` DELETE. Feature A (lectura: `/admin/rate-limits` table tier/endpoint/limit/window/current usage) + Feature B (escritura: edit modal + hot reload). DB table `rate_limit_configs`, Redis pub/sub hot reload, audit log. Nuevo permiso `RATE_LIMIT_ADMIN`. Requiere L-27 (T4-R). **~2-3 semanas.** |
| **Slack integration**                           | T6-B 5b roadmap | CRM-like OAuth + message posting + channel notifications. No codificado aún.                                                                                                                                                                                                                                                       |
| **L-349 (AI content emoji truncation bug)**     | T6-A decisión   | **Auto-resuelto vía L-339 stub replacement en T6-A.** Entrada informativa.                                                                                                                                                                                                                                                         |

**Findings table (34 items v2 originales):**

| L-#                      | Título corto                                         | Notas                                         |
| ------------------------ | ---------------------------------------------------- | --------------------------------------------- |
| L-8 (alt-ref)            | `trendAnalysisService.ts` mock data (primary T4-Z)   | Sprint TikTok API real OR mark DEMO_MODE      |
| L-9 (alt-ref)            | `content/SyncEngineImpl` (primary T5-B)              | CORE_CONCEPTUAL — sprint completion           |
| L-10 (alt-ref)           | `content/VersionController` DB (primary T5-B)        | Sprint content subsystem completion           |
| L-31-content             | content module 7.6k LOC PLANNED integration          | Cross-ref pre-D0-v4 analysis                  |
| L-68-content             | UnifiedPublishingDashboard (si T6-D → WIRE)          | Alternative to DELETE                         |
| L-70-sso                 | SSO admin UI (7 endpoints BUILD_UI)                  | /saml + /oidc admin config panels             |
| L-71-zapier              | Zapier keys management UI (5 endpoints)              | apps/client admin                             |
| L-72-make                | Make keys management UI (5 endpoints)                | apps/client admin                             |
| L-73-health              | Health dependency panel (2 endpoints)                | /health/detailed + /health/dependency/:name   |
| L-74-providers           | Providers health dashboard (2 endpoints)             | /providers/:id/health + /providers/health/all |
| L-95-channels            | channels Test/Settings buttons                       | Requires feature spec                         |
| L-94-oauth               | OAuth flow 10/11 providers                           | Dead connect buttons — feature completion     |
| L-96-instagram           | Create Stories/Reels/Carousel flows                  | Router integration + feature spec             |
| L-87-stories             | StoriesEditor 4 callbacks wire                       | Feature spec + backend                        |
| L-115-ia                 | IA review "Settings" vs "AI Settings" nav            | Product decision                              |
| L-113-i18n               | i18n full decision (client + admin + UI)             | Product decision                              |
| L-33-content             | 18 content/ endpoints PLANNED integration            | Sprint content integration                    |
| L-20-reports             | reports/ vs custom-reports/ unification              | También en T4-Z                               |
| L-65-workers             | workers topology deploy-ready                        | También en T4-J — ADR primero                 |
| L-638                    | environment protection rules GitHub                  | Config después de tener prod env              |
| L-269                    | Admin metadata per page                              | SEO — post-product signoff                    |
| L-97-posts               | posts/page.tsx migration to TanStack                 | Spec cómo maneja admin posts                  |
| L-116                    | Templates consolidation API vs static                | Feature spec templates API-driven             |
| L-272                    | proxy route streaming uploads large files            | Feature requirement                           |
| L-100-provider-stub      | ProjectProvider architectural mismatch               | Single vs multi-account architecture          |
| L-50-cli                 | outboxAdminRoutes aggregateType unknown in retry     | Minor — sprint observability                  |
| L-295-webhooks           | WebhookSubscriptions TanStack bypass (absorbed T3-N) | Wire when BUILD_UI expanded                   |
| L-294-webhooks           | WebhookEventsList TanStack bypass (absorbed T3-N)    | Idem                                          |
| L-327-webhooks           | useWebhooks GAPs (absorbed T3-N)                     | Fix drives L-294/L-295                        |
| L-38-pricing             | UpdatePricingConfigUseCase grandfathering            | Research intent                               |
| L-39-repurpose           | GenerateRepurposeVariantsUseCase notification        | Research intent                               |
| L-278                    | `RbacManager` 481 LOC big refactor candidate         | Product decision                              |
| L-313-ext                | SSO integration consolidation                        | Requires PLANNED auth decisions               |
| L-268-i18n-announcements | announcements i18n refactor composite                | Part of i18n decision                         |

**Nota.** B11 no tiene exit criteria. Cuando un item activa (Edward decide), sale de B11 y se convierte en sprint con spec.

---

## §6. Matriz de dependencias cross-tier

```text
T0-A (secrets) ───────────────────────────────────────────── [semana 1, único]
                     │
                     │
T6 (decisiones) ─────┴─── ejecutar en SEMANA 1 (2-3 h sesión) ─────┐
                                                                    │
                                                                    │ produce inputs
                                                                    │ para T1..T5
T1 ─── paralelizable mayormente, todos antes de T2-K ───────────── │
  └─ T1-F @layer fix ───────────┐                                   │
                                 │                                   │
T2 ────────── usa T1 como base   │                                   │
  ├─ T2-A credentials 🔒 ────┐   │                                   │
  ├─ T2-C silent catch       │   │                                   │
  ├─ T2-F ci.yml urgentes 🔒 │   │                                   │
  └─ T2-K type narrowing ◄────── espera T3-C/T3-D split              │
                        │                                            │
T3 ─── gran bloque central ──── "wire + unificar"                    │
  ├─ T3-A QueryClient 🔒 ─────────── desbloquea error handling       │
  ├─ T3-B Auth unification 🔒 ────── desbloquea multi-auth fixes     │
  ├─ T3-C client.ts split 🔒 ────── habilita T2-K (cliente)          │
  ├─ T3-D apiClient.ts split 🔒 ── habilita T2-K (admin)             │
  ├─ T3-E useProviders unify 🔒 ── habilita cleanup                  │
  ├─ T3-N webhooks TanStack 🔒 ─── depende de T3-D + L-327            │
  ├─ T3-M ProjectProvider 🔗 ─── depende T6-A L-335                  │
  └─ T3-P fake-AI 🔗 ────────── depende T6 per-finding               │
                                                                      │
T4 ─── estructural ──── "puertos y adapters"                          │
  ├─ T4-A boundary leaks 🔒 ──── habilita T5-D + T5-C                 │
  ├─ T4-B EventStore 🔒 ──────── depende T6 (L-42)                   │
  ├─ T4-F DI registration 🔒 ── depende T6 (L-36/25/38/39)           │
  ├─ T4-G integration events 🔒 ── depende T6 (L-44/45)              │
  ├─ T4-H QueuePort 🔒 ──────── habilita T4-I + T5-A                 │
  ├─ T4-I workers 🔒 ─────────── habilita T5-G inbox                 │
  ├─ T4-K AI service port 🔒 ── depende T4-A                         │
  ├─ T4-M logger port 🔒 ────── resuelve T2-B pending                │
  ├─ T4-P fitness wire 🔒 ─── enforce todo lo anterior               │
  ├─ T4-U Decimal migration 🔒 ── habilita T5-E                      │
  ├─ T4-V RBAC SoT 🔒 ────────── simplifica T5-A                     │
  ├─ T4-X webhook N+1 🔒 ────── depende T3-H                         │
  └─ T4-Y Dockerfile 🔒 ─────── depende T6                           │
                                                                      │
T5 ─── arquitectura ──── "el corazón"                                 │
  ├─ T5-A saga + CQRS 🔒 ─── depende T4-A + T4-H + T4-I + T6          │
  │   ⟡ EL BATCH MÁS IMPORTANTE — resuelve "UI miente al usuario"    │
  ├─ T5-B content 🔒 ───────── depende T6-G                          │
  ├─ T5-C RepoPort split 🔒 ── depende T4-A                          │
  ├─ T5-D providers 5-way 🔒 ── depende T4-A                         │
  ├─ T5-E billing split ────── depende T4-U                          │
  ├─ T5-G inbox UC ────────── depende T4-I + T4-H                    │
  ├─ T5-H publishing DEAD ── depende T6-D                            │
  └─ T5-I i18n 🔗 ──────────── depende T6 producto                    │
                                                                      │
T6 (ejecutado en Semana 1 como sesión) ──────────────────────────────┘
    produce inputs que desbloquean T1-T5
    recomendable ejecutar T6-A..T6-J EARLY
    idealmente antes de profundizar en T3
```

**Cadenas críticas:**

- **Safety chain:** T0-A → T4-V / T4-Q → T5-A (secrets rotados antes de billing/saga enforcement real)
- **Quality chain:** T1-A → T2-G → T3-H → T4-K → T4-P (configs → narrowing → splits → ports → fitness enforcement)
- **Saga chain:** T4-H → T4-I → T5-A (queue port → workers → saga wire)
- **Architecture chain:** T4-A + T4-F → T5-C / T5-D (boundary + DI antes de grandes consolidaciones)
- **UX chain:** T3-A → T3-B → T3-C/D → T2-K (error handling → auth → splits → type narrowing)

**Nuevas cadenas v2.1 (decisiones T6 aplicadas 2026-04-21):**

1. **L-319 (T6-A WIRE) BLOCKED_BY L-27 (T4-R)** — `useContentLibrary` WIRE con audit log obligatorio requiere audit logger funcional primero.
2. **T6-B 5b CRM REQUIRES T4-V (RBAC single SoT)** — nuevos permisos `CRM_MANAGE` + `INTEGRATIONS_CONFIGURE` se añaden durante T4-V consolidation.
3. **L-42 EventSnapshots REQUIRES T4-U + pricing tiers system (B8)** — billing tier gating depende de Invoice Decimal migration y tier infra.
4. **L-47 CQRS SIMPLIFIES T5-C (RepoPort split) — REORDER: L-47 antes de T5-C.**
5. **T6-E Circuit Breaker WIRE REQUIRES L-513 (T4-N OTel stable)** — span names drift debe estabilizarse antes de wire del monitor.
6. **Admin rate limit config (nueva B11) REQUIRES L-27 + RBAC SUPER_ADMIN** — audit logger + permiso `RATE_LIMIT_ADMIN`.

---

## §7. Reconciliación 647 → mapeado

Cada L-# debe aparecer exactamente una vez en: fila primaria en batch T\<n\>-\<letter\> / fila en Apéndice A (positive) / fila en Apéndice B (wont_fix) / fila en Apéndice C (absorbed/resolved/dup) / fila en B11 (backlog).

### Tabla por tier + apéndices

| Sección                                                     | Findings asignados |
| ----------------------------------------------------------- | -----------------: |
| T0 — Housekeeping operativo urgente                         |                  1 |
| T1 — Trivial (10 batches)                                   |                 42 |
| T2 — Local pequeño (11 batches)                             |                 73 |
| T3 — Local mediano (18 batches)                             |                 70 |
| T4 — Estructural chico (26 batches)                         |                 95 |
| T5 — Estructural grande (9 batches)                         |                 30 |
| T6 — Decisiones de producto (10 sesiones)                   |                 35 |
| B11 — PLANNED backlog                                       |                 34 |
| Apéndice A — Positives                                      |                 27 |
| Apéndice B — WONT_FIX justificados                          |                  5 |
| Apéndice C — Composite absorption / RESOLVED / dup pointers |                235 |
| **TOTAL**                                                   |            **647** |

**Fórmula de verificación automatizable:**

```bash
# Contar L-# únicos en el documento (debe ser 647)
grep -oE "L-[0-9]+" docs/audits/REMEDIATION_ROADMAP.md | sort -u | wc -l   # → 647
```

**Nota de redistribución vs v1.**
Los conteos por sección difieren de v1 (13/34/49/27/16/13/205/12/8/10/29/34 + 27/5/165) porque v2 fragmenta en micro-batches más pequeños y absorbe más findings directamente en tiers (p.ej., size violations client L-135..L-204 primary en v1 B6.6.9 → ahora top-20 en T3-I, resto en Apéndice C como reference).

---

## §8. Cadencia de ejecución sugerida

**v2 original asumía 17 semanas con T6 DELETE-heavy. v2.1 con decisiones T6 WIRE-heavy (8 de 10) añade ~19-22 semanas de scope nuevo.**

**Cadencia realista v2.1 (35-40 semanas)** asumiendo ~20 h/semana (Edward + agentes):

| Semana | Actividad                                                                                                                   |    Horas |
| -----: | --------------------------------------------------------------------------------------------------------------------------- | -------: |
|      1 | T0-A secrets (2h) + **T6 sesión decisiones cerrada 2026-04-21** + T1 paralelo (8-10h)                                       |    12-15 |
|    2-3 | T1 trivial finales + T6-F D1 reclassifications per-batch (ongoing)                                                          |    12-15 |
|    4-5 | T2 batches low-risk paralelos + **T6-E Circuit Breaker WIRE** (~1.5 sem, parallel con T2)                                   |    15-18 |
|   6-10 | T3 splits + kickoff + **T6-A admin hooks WIRE** (dependiente de T4-R earlier, ~2 sem + 0.5 DELETE)                          |    18-20 |
|  11-14 | T4-A/V/B/C/H/F/I/K/M/N/R/P/Q/T (boundary + DI + workers + fitness)                                                          |    15-18 |
|  15-18 | T4-U/W/D/E/L/S/G/J/O/X/Y/Z + **T6-B 5a storage multi-cloud WIRE** (~2 sem, parallel)                                        |    15-18 |
|  19-22 | **T6-B 5b CRM WIRE** (~3-4 sem, parallel con T4 billing/config batches)                                                     |    15-18 |
|     23 | **L-47 CQRS migration** (WIRE_WITH_MIGRATION, 8-15h) — **ejecutar antes de T5-C**                                           |    15-18 |
|  24-26 | T5-A saga + CQRS sprint + T5-E billing                                                                                      |       20 |
|  27-28 | T5-C RepoPort split (simplificado por L-47) + T5-D providers 5-way                                                          |    18-20 |
|  29-31 | **T6-G Fase 1 WIRE** (content module core, ~3 sem: SyncEngine refactor + VersionController DB + UI timeline/restore simple) |    18-20 |
|  32-33 | **T6-C editor chain WIRE Fase 1** (~2 sem, aprovecha rescate T6-D)                                                          |    18-20 |
|  34-35 | **L-42 EventSnapshots WIRE + retention + billing tier integration** (~2 sem, dep T4-U)                                      |    15-18 |
|  36-37 | **B11: Admin rate limit configuration** (~2-3 sem, dep L-27)                                                                |    15-18 |
| 38-40+ | T6-G Fase 2/3 (PLANNED_CRÍTICO, +5 sem cuando aprobadas) + Slack integration + B11 producto                                 | variable |

**Hitos intermedios v2.1:**

- Fin semana 1: T0-A cerrado, **T6 decisiones cerradas** (9/10) → scope WIRE confirmado.
- Fin semana 3: T1 + T2 en curso, T6-F aplicado per-batch.
- Fin semana 10: T3 cerrado + T6-A/T6-E WIRE cerrados → ~185 findings DONE.
- Fin semana 18: T4 cerrado + T6-B 5a storage WIRE → ~375 findings DONE.
- Fin semana 22: T6-B 5b CRM WIRE cerrado.
- Fin semana 28: T5-A + T5-C + T5-D + L-47 cerrados → "UI miente al usuario" resuelto + CQRS migration done.
- Fin semana 33: T6-G F1 + T6-C F1 cerrados → content module core + editor chain live.
- Fin semana 35: L-42 EventSnapshots live + billing feature monetizable.
- Fin semana 37: B11 Admin rate limit config live.
- Fin semana 40+: T6-G F2/F3 condicional a aprobación Edward; resto en Apéndice C/positives/backlog.

**Nota crítica v2.1.** La cadencia 17 → 35-40 semanas no es retraso; es **scope WIRE expandido por decisión consciente de Edward** (rescatar valor arquitectónico ya codificado en lugar de DELETE blanket).

---

## §9. Reglas de commit y PR

### Formato de commit

```text
chore(remediation): T<n>-<letter> — <short summary> (closes L-<#>[, L-<#>...])
```

Ejemplos:

- `chore(remediation): T1-C — git hygiene and .bak cleanup (closes L-531, L-562, L-601, L-587, L-588, L-589, L-590)`
- `chore(remediation): T4-A — cache-redis boundary leak fix (closes L-364)`
- `chore(remediation): T5-A — saga + CQRS wire (closes L-62, L-63, L-64, L-47, L-71, L-72)`

### Reglas por tipo de batch

1. **Batch ≥5 findings:** commit por sub-grupo + commit final "close T\<n\>-\<letter\>" con referencia a todos.
2. **Batch con SAFETY_CRITICAL:** PR separado con review obligatorio (no merge directo).
3. **Batch con NEEDS_EDWARD findings:** PR description lista cada decisión + link al `LATERAL_FINDINGS.md` entry.
4. **Verificación post-batch:** exit criteria commands ejecutados + capturados en PR description.
5. **Actualización inline:** este documento se actualiza marcando batch ✅ + fecha al cerrar.

### Orden de commits dentro de una sesión

1. Un commit por sub-grupo lógico (no un commit gigante).
2. Cada commit referencia los L-# que cierra.
3. Commit final del batch: actualiza este documento con ✅.

---

## §10. Meta-regla final — Re-audit como verificación

Al cerrar T5:

> **Re-correr D0..D7 como verificación, NO descubrimiento.**

Los 8 dimensiones del `PLAN_MAESTRO.md` corren sobre **codebase remediado**, no sobre codebase original. Si surgen findings nuevos, **son delta** (indican work introduced during remediation o items missed by D0-v4); si los 647 originales están todos resueltos o documentados, el proceso terminó.

El éxito final del roadmap se mide así:

```bash
# 1. Todos los 647 L-# han pasado a DONE / DECIDED / WONT_FIX / DEFERRED
grep -c "→ RESUELTO en T" docs/audits/LATERAL_FINDINGS.md   # → 647 (menos WONT_FIX y DEFERRED explícitos)

# 2. Los 10 fitness functions CLAUDE.md verdes
bash .github/workflows/fitness.sh   # → all 10 greps → 0

# 3. Re-audit D0..D7 encuentra solo delta (no findings originales)
# Ejecutar flujo D0-v4 sobre HEAD → comparar con LATERAL_FINDINGS.md
```

---

## §11. Changelog

### v2.1 — 2026-04-21 (T6 decisions session)

**10 decisiones T6 cerradas** (9/10 final + 1 pending T6-H). Ver updates en §5.6 + §5.7 + §6 + §8.

**Resumen de decisiones de Edward:**

- **WIRE-heavy (8 de 10):** content module Fase 1 crítico (T6-G), editor chain (T6-C), multi-cloud storage (T6-B 5a), CRM + Slack roadmap (T6-B 5b), circuit breaker monitor + admin UI (T6-E), CQRS migration (L-47 WIRE_WITH_MIGRATION), EventSnapshots + retention billing feature (L-42), admin hooks WIRE con SUPER_ADMIN gates (T6-A).
- **DELETE:** `RateLimitingDashboard` scaffold (T6-I) — reemplazado por nueva feature B11 "Admin rate limit config + visibility".
- **RESCATE:** T6-D publishing subsystem — 4 de 6 files rescatados para T6-G/T6-C (no DELETE blanket).
- **STUB for future:** L-339 ai-content-utils (idea válida, implementación diferida; types L-342 preservados).

**Cadencia revision.** 17 semanas → 35-40 semanas realista (T6 WIRE scope añade ~19-22 semanas).

**Nuevos RBAC permisos requeridos (T4-V single SoT):** `CONTENT_LIBRARY_VIEW`, `QUEUE_MANAGE`, `ANALYTICS_GLOBAL_VIEW`, `SCHEDULING_ADMIN`, `RESILIENCE_VIEW`, `CRM_MANAGE`, `INTEGRATIONS_CONFIGURE`, `RATE_LIMIT_ADMIN`, `CONTENT_SNAPSHOT_MANAGE` (todos SUPER_ADMIN por default).

**Nuevas dependencias añadidas a §6.** 6 cadenas nuevas:

1. L-319 (T6-A) BLOCKED_BY L-27 (T4-R).
2. T6-B 5b CRM REQUIRES new RBAC permissions (T4-V single SoT).
3. L-42 EventSnapshots REQUIRES T4-U + pricing tiers system (B8).
4. L-47 CQRS SIMPLIFIES T5-C — **reorder: L-47 antes de T5-C**.
5. T6-E Circuit Breaker WIRE REQUIRES L-513 OTel stable (T4-N).
6. Admin rate limit config (nueva B11) REQUIRES L-27 + RBAC SUPER_ADMIN.

**Nuevos items B11:**

- Admin rate limit configuration + visibility (desde T6-I split).
- Slack integration (future, desde T6-B 5b roadmap).

**Pending:** T6-H (/analytics/project/:projectId auth decisión) — revisar en próxima sesión.

### v2 — 2026-04-21 (initial)

Synthesis de `REMEDIATION_BATCHES.v1.md` + `CLAUDE_ALTERNATE_PLAN.md` en estructura tier T0..T6 con reconciliación 647 findings.

---

## Apéndice A — Positives (27 findings — sin acción requerida)

Reconocimiento de prácticas correctas documentadas durante auditoría. No se ejecutan, no bloquean.

| L-#       | Descripción                                                                              |
| --------- | ---------------------------------------------------------------------------------------- |
| L-542     | POSITIVE — Baseline schema clean (114 modelos naming convention)                         |
| L-543     | POSITIVE — Cascade strategy correcta FKs                                                 |
| L-544     | POSITIVE — Enum coverage exhaustivo (54 enums)                                           |
| L-563     | POSITIVE — RBAC binding completo (17/17 permissions SUPER_ADMIN)                         |
| L-564     | POSITIVE — GDPR consent seed correcto                                                    |
| L-565     | POSITIVE — bcrypt hashing uniform                                                        |
| L-566     | POSITIVE — Idempotency via upsert pattern                                                |
| L-567     | POSITIVE — Ordering constraint-safe                                                      |
| L-568     | POSITIVE — Tenant isolation en seeds multi-tenant                                        |
| L-569     | POSITIVE — Factory pattern parcial (reviewable)                                          |
| L-570     | POSITIVE — No PII real en seed                                                           |
| L-602     | POSITIVE — tsconfig `strict: true` uniforme                                              |
| L-603     | POSITIVE — Biome no usado (no tool proliferation)                                        |
| L-604     | POSITIVE — Husky v9 (latest)                                                             |
| L-605     | POSITIVE — bcrypt en dependencies (no md5)                                               |
| L-606     | POSITIVE — pnpm `--frozen-lockfile` en CI                                                |
| L-607     | POSITIVE — prettier minimal                                                              |
| L-608     | POSITIVE — `.editorconfig` present                                                       |
| L-609     | POSITIVE — `.nvmrc` present (node lock)                                                  |
| L-610     | POSITIVE — typescript version modern                                                     |
| L-611     | POSITIVE — turbo version modern                                                          |
| L-612     | POSITIVE — no legacy jest config                                                         |
| L-613     | POSITIVE — zod versions aligned cross-workspace                                          |
| L-614     | POSITIVE — pino structured logging adopted                                               |
| L-615     | POSITIVE — husky postinstall behind test                                                 |
| L-137-pos | POSITIVE — (implícito) dev entries sin side effects (ref aparte de L-137 size violation) |
| L-138-pos | POSITIVE — (implícito) tooling calibration (ref aparte de L-138 size violation)          |

**Nota.** L-137 y L-138 aparecen aquí como "positives implícitos" y también en Apéndice C como size violation rows; son el mismo L-# con doble contexto — no cuentan dos veces.

---

## Apéndice B — WONT_FIX justificados (5 findings)

Hallazgos conscientemente excluidos con razón documentada. Edward ya aprobó el WONT_FIX o el hallazgo es `informativo / OK by design`.

| L-#          | Descripción                                                 | Justificación                                                                      |
| ------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| L-265        | `useNotificationStream` SSE bypass proxy                    | Pattern intencional documentado en código (Next.js proxy bufferea SSE). NO action. |
| L-117        | `AnnouncementBanner` usa /api/... sin /backend/ prefix      | Public path intencional. Documentar, NO migrate.                                   |
| L-47-wontfix | CQRS subsystem PLANNED (si Edward decide PLANNED no DELETE) | Esperar sprint futuro de CQRS activation. (Primary en T5-A/T6)                     |
| L-67-wontfix | `DEAD_LETTER_QUEUE` + `FAILED_OPERATIONS_DLQ` legacy        | Si L-66 PLANNED — DLQ queues futuras. (Primary en T5-A)                            |
| L-558        | Husky postinstall en CI scenario                            | Condicional `test -d .git`; ya correcto, finding documental.                       |

---

## Apéndice C — Composite absorption map / RESOLVED / Dup pointers

### C.1 — Composite absorptions (findings que son cross-references a un primary)

| Absorbed L-#  | Primary      | Razón                                                              |
| ------------- | ------------ | ------------------------------------------------------------------ |
| L-617         | L-616        | "CI/CD broken pipeline composite" — security-testing.yml dead refs |
| L-618         | L-616        | production-ci.yml eslint-security missing                          |
| L-619         | L-616        | Branch coverage Genesis no triggered                               |
| L-620         | L-616        | 27 actions sin SHA pinning                                         |
| L-548         | L-547        | seed-mixing bootstrap + test + demo                                |
| L-600         | L-623        | password123 triple → séxtuple escalated                            |
| L-473-monitor | L-506        | `@monitoring/circuit-breaker` central monitor DEAD (paired)        |
| L-517         | L-506        | `checkers/circuitBreaker.ts` dead (paired)                         |
| L-348         | L-267        | `proxy.ts` re-confirmed ORPHAN                                     |
| L-267         | —            | Primary (moved a T6-A cluster)                                     |
| L-346         | L-335        | ProjectProvider raw fetches en código dead                         |
| L-349         | L-339        | ai-content-utils emoji truncation bug en dead                      |
| L-365         | T6-B adapter | cloudinary runtime bug en orphan adapter                           |
| L-374         | L-368        | opossum version drift sub-finding                                  |
| L-375         | L-357        | SubscriptionTier deprecation re-confirm                            |
| L-380         | L-363        | queue-bullmq concurrency ignored                                   |
| L-376-qdup    | L-363        | queue-bullmq test mocks (partial)                                  |
| L-61          | L-363        | QueuePort hardcoded (same composite)                               |
| L-262         | L-261        | `useChannels.disconnectChannel` path inconsistency dup             |
| L-264         | L-261        | `useBilling.useMyInvoices` path inconsistency dup                  |
| L-69          | L-208        | Dual auth path — absorbed en 3-path upgrade L-208                  |
| L-86          | L-207        | 3 useProviders — absorbed en 4-path upgrade L-207                  |
| L-99          | L-214        | State hooks cadena to LEGACY (composite); primary moved            |
| L-141         | L-68         | UnifiedPublishingDashboard DEAD (size violation was symptom)       |
| L-143         | L-68         | ContentPreviewSystem DEAD                                          |
| L-147         | L-68         | ProviderAdaptationEngine DEAD                                      |
| L-156         | L-68         | AdminContentEditor DEAD                                            |
| L-162         | L-68         | provider-previews DEAD                                             |
| L-169         | L-68         | publishingDashboardApi DEAD (util)                                 |
| L-203         | L-158        | editor/TemplateSelector dup ref                                    |
| L-204         | L-178        | publishing/PublishDialog dup ref                                   |
| L-471         | L-470        | i18n UI individual entries (13 absorbed)                           |
| L-472         | L-470        | i18n UI individual                                                 |
| L-474         | L-470        | i18n UI individual                                                 |
| L-475         | L-470        | i18n UI individual                                                 |
| L-476         | L-470        | i18n UI individual                                                 |
| L-477         | L-470        | i18n UI individual                                                 |
| L-478         | L-470        | i18n UI individual                                                 |
| L-479         | L-470        | i18n UI individual                                                 |
| L-480         | L-470        | i18n UI individual                                                 |
| L-481         | L-470        | i18n UI individual                                                 |
| L-482         | L-470        | i18n UI individual                                                 |
| L-237         | L-212        | client.ts 440 LOC R11 dup                                          |
| L-316         | L-320        | useMultiPlatformScheduling R11 (ORPHAN primary)                    |
| L-236         | L-140        | usePredictiveData R11 dup                                          |
| L-483         | L-491        | Design token drift UI individuales (absorbed composite)            |
| L-484         | L-491        | Design token drift individual                                      |
| L-485         | L-491        | Design token drift individual                                      |
| L-486         | L-491        | Design token drift individual                                      |
| L-487         | L-491        | Design token drift individual                                      |
| L-488         | L-491        | Design token drift individual                                      |
| L-489         | L-491        | Design token drift individual (ValidationContentEditor)            |
| L-490         | L-491        | Design token drift individual (VirtualScrollList)                  |

### C.2 — RESOLVED (finding cerrado durante un sprint posterior al descubrimiento)

| L-#        | Resolución                                                            |
| ---------- | --------------------------------------------------------------------- |
| L-298      | `@layer` mismapping CLOSED en D0v4-8 — @file headers residual en T1-F |
| L-600      | Escalado a L-623 (password123 séxtuple)                               |
| L-14       | Superseded por L-386 (5-way overlap)                                  |
| L-260-seed | Coverage gap seed se resuelve vía T1-I + T4-W                         |

### C.3 — Dup pointers / re-entries cross-sprint

| L-#   | Notas                                                                                   |
| ----- | --------------------------------------------------------------------------------------- |
| L-368 | Cross-sprint extension: circuit breaker + pricing + invoice composite (primary en T6-E) |
| L-260 | Cross-sprint extension: per-mutation onError (primary en T3-A)                          |

### C.4 — Size violations composite client L-135..L-204 (70 findings — reference rows)

Primary row ya en T3-I top 20 para los primeros. Resto son **reference primaries** para trazabilidad; Edward decide per-archivo si refactor o accept-with-ADR. Los files muertos (L-141/L-143/L-147/L-156/L-162/L-169) están en T5-H via L-68.

| L-#   | Archivo                                         | LOC | Notas                         |
| ----- | ----------------------------------------------- | --: | ----------------------------- |
| L-145 | instagram/upload/page.tsx                       | 520 | Cross L-96                    |
| L-152 | templates/TipTapEditor.tsx                      | 421 |                               |
| L-153 | templates/TemplateEditorCanvas.tsx              | 417 |                               |
| L-154 | posts/[id]/preview/page.tsx                     | 392 |                               |
| L-155 | analytics/page.tsx                              | 275 |                               |
| L-157 | templates/TemplateLibraryGrid.tsx               | 354 |                               |
| L-158 | templates/TemplateSelector.tsx                  | 351 |                               |
| L-159 | templates/TemplateLibrary.tsx                   | 335 |                               |
| L-160 | scheduling/SchedulingDashboardSidebar.tsx       | 329 |                               |
| L-161 | providers/ProjectProvider.tsx (client)          | 327 | Cross L-100                   |
| L-163 | templates/TemplateVersionControl.tsx            | 322 |                               |
| L-165 | scheduling/CSVBulkUpload.tsx                    | 317 |                               |
| L-166 | scheduling/useSchedulingDashboard.ts            | 318 | Dup T3-F L-239                |
| L-167 | templates/TemplateEditor.tsx                    | 315 |                               |
| L-168 | scheduling/page.tsx                             | 317 | Cross L-93                    |
| L-170 | templates/ABTestCreateDialog.tsx                | 300 |                               |
| L-171 | ai/SmartContentOptimizer.tsx                    | 369 | Cross L-80                    |
| L-172 | ai/PredictiveAnalytics.tsx                      |  86 | OK limit (listed for context) |
| L-173 | settings/ai/page.tsx                            | 293 | OK page limit                 |
| L-174 | ClientContentEditor.tsx                         | 297 | Cross L-85                    |
| L-175 | scheduling/MultiPlatformSchedulerRefactored.tsx | 278 | Cross L-90/L-91               |
| L-176 | scheduling/RecurringPostForm.tsx                | 275 | Cross L-92                    |
| L-177 | settings/privacy/page.tsx                       | 271 | OK page limit                 |
| L-178 | publishing/PublishDialog.tsx                    | 272 |                               |
| L-179 | useABTestManager.ts (client)                    | 273 | Dup T3-F L-243                |
| L-180 | analytics/ScheduledReportsList.tsx              | 245 |                               |
| L-181 | approvals/ReviewPanel.tsx                       | 244 |                               |
| L-182 | content/library/FilterPanel.tsx                 | 244 |                               |
| L-183 | ai/smartContentOptimizerUtils.ts                | 243 |                               |
| L-184 | NotificationBell.tsx                            | 239 | Cross L-84                    |
| L-185 | SchedulingDashboard.tsx                         | 239 |                               |
| L-186 | NotificationPreferences.tsx                     | 251 |                               |
| L-187 | scheduling/views/BulkScheduleView.tsx           | 255 |                               |
| L-188 | PerformanceInsights.tsx                         | 275 | Dup L-201                     |
| L-189 | ai/AIContentResults.tsx                         | 208 |                               |
| L-190 | ai/ai-content-templates.ts                      | 263 | Cross L-81                    |
| L-191 | useTemplateVersionControl.ts                    | 281 | Dup T3-F L-241                |
| L-192 | content/ContentTemplates.tsx                    | 217 |                               |
| L-193 | SchedulingDashboardPostModal.tsx                | 221 |                               |
| L-194 | RecurrenceSelector.tsx                          | 209 |                               |
| L-195 | SamlConfigForm.tsx                              | 211 |                               |
| L-196 | analytics/CreateReportForm.tsx                  | 206 |                               |
| L-197 | dashboard/layout.tsx                            | 178 | OK                            |
| L-198 | settings/brand-voice/BrandVoiceForm.tsx         | 269 |                               |
| L-199 | settings/ExternalNotificationConfigs.tsx        | 245 | Cross L-76                    |
| L-200 | instagram/StoriesEditor.tsx                     | 197 | OK                            |
| L-201 | analytics/PerformanceInsights.tsx               | 275 | Dup L-188                     |
| L-202 | settings/AddWebhookForm.tsx                     | 191 | OK                            |

### C.5 — R11 hooks client L-254..L-259 (remaining — reference rows)

| L-#   | Archivo                                      | LOC |
| ----- | -------------------------------------------- | --: |
| L-254 | hooks/api/useMultiPlatformScheduling.ts      | 165 |
| L-255 | hooks/api/useApprovals.ts                    | 165 |
| L-256 | hooks/useAIContentGenerator.ts               | 163 |
| L-257 | hooks/api/useTeam.ts                         | 159 |
| L-258 | hooks/api/usePerformanceInsights.ts          | 152 |
| L-259 | 97 raw fetch inside hooks/api/ (composite)   |   — |
| L-266 | `useAIContentGenerator` composite complexity |   — |

### C.6 — R11 admin components L-280..L-292 (reference rows — not in T3-I top 20)

| L-#   | Archivo                             | LOC |
| ----- | ----------------------------------- | --: |
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

### C.7 — Providers R11 lenient L-394..L-436 (43 findings — reference rows)

| L-#   | Archivo                          |     LOC |
| ----- | -------------------------------- | ------: |
| L-394 | youtube/communityFeatures.ts     |     752 |
| L-395 | youtube/apiClient.ts             |     745 |
| L-396 | youtube/liveStreaming.ts         |     690 |
| L-397 | facebook/reels.ts                |     681 |
| L-398 | facebook/community.ts            |     672 |
| L-399 | telegram/apiClient.ts            |     670 |
| L-400 | facebook/apiClient.ts            |     667 |
| L-401 | instagram/publishingWorker.ts    |     663 |
| L-402 | tiktok/contentAnalyticsClient.ts |     658 |
| L-403 | instagram/InstagramAdapter.ts    |     620 |
| L-404 | provider file 404                | 400–620 |
| L-405 | provider file 405                | 400–620 |
| L-406 | provider file 406                | 400–620 |
| L-407 | provider file 407                | 400–620 |
| L-408 | provider file 408                | 400–620 |
| L-409 | provider file 409                | 400–620 |
| L-410 | provider file 410                | 400–620 |
| L-411 | provider file 411                | 400–620 |
| L-412 | provider file 412                | 400–620 |
| L-413 | provider file 413                | 400–620 |
| L-414 | provider file 414                | 400–620 |
| L-415 | provider file 415                | 400–620 |
| L-416 | provider file 416                | 400–620 |
| L-417 | provider file 417                | 400–620 |
| L-418 | provider file 418                | 400–620 |
| L-419 | provider file 419                | 400–620 |
| L-420 | provider file 420                | 400–620 |
| L-421 | provider file 421                | 400–620 |
| L-422 | provider file 422                | 400–620 |
| L-423 | provider file 423                | 400–620 |
| L-424 | provider file 424                | 400–620 |
| L-425 | provider file 425                | 400–620 |
| L-426 | provider file 426                | 400–620 |
| L-427 | provider file 427                | 400–620 |
| L-428 | provider file 428                | 400–620 |
| L-429 | provider file 429                | 400–620 |
| L-430 | provider file 430                | 400–620 |
| L-431 | provider file 431                | 400–620 |
| L-432 | provider file 432                | 400–620 |
| L-433 | provider file 433                | 400–620 |
| L-434 | provider file 434                | 400–620 |
| L-435 | provider file 435                | 400–620 |
| L-436 | provider file 436                | 400–620 |

### C.8 — UI R11 L-457..L-469 (reference rows)

| L-#   | Archivo                                 | LOC |
| ----- | --------------------------------------- | --: |
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

### C.9 — DEAD_CODE y DI items primary en v1 ahora re-ubicados (reference rows)

Muchos items de v1 B2 / B4 están repartidos en T6-A..T6-J + T4-F + T5-H. Esta sección trackea los L-# no asignados a tier específico pero cubiertos en decisión Edward o cleanup.

| L-#   | Descripción                                                      | Ubicación T\<n\>-\<letter\>              |
| ----- | ---------------------------------------------------------------- | ---------------------------------------- |
| L-2   | 3 domain events sin export                                       | T6 (cluster DECIDE, verificar consumers) |
| L-3   | 17 domain ports sin Prisma adapter                               | T6 (cluster DECIDE — triage)             |
| L-4   | 3 adapters `@deprecated` sin migration path                      | T6 (cluster DECIDE)                      |
| L-5   | Repository base `Result<void, Error>` no DomainError             | T4-K (hexagonal fix batch)               |
| L-12  | `templates/*` triple violation (prisma import + singleton + any) | T4-K                                     |
| L-23  | `InviteTeamMember` hardcoded baseUrl                             | T4-K                                     |
| L-24  | `templates/templateService` dynamic imports                      | T4-K                                     |
| L-48  | `lib/errors/errorPlugin.ts` DEAD por no-wired                    | T6 DECIDE                                |
| L-58  | High cardinality Prometheus labels (channel_id)                  | T4-N (OTel)                              |
| L-88  | `(user as Record<unknown>).accountId` hack ×8                    | T2-K (type narrowing)                    |
| L-90  | MultiPlatformSchedulerRefactored dead Edit + raw fetches         | T2-E                                     |
| L-102 | Ai subsystem size violations (5+ componentes >400 LOC)           | T3-I                                     |
| L-103 | `actions/auth.ts` FormData `as string` cast                      | T2-K                                     |
| L-104 | actions/auth.ts name parsing bug firstName/lastName              | T3-B                                     |
| L-107 | providerMapper hardcoded DEFAULT_LIMITS missing 7                | T4-J (provider registry)                 |
| L-108 | providerMapper `authType: "oauth"` hardcoded                     | T4-J                                     |
| L-114 | dashboard/layout.tsx "Settings" hardcoded                        | T1-G                                     |
| L-118 | Recharts only in analytics (bundle weight)                       | T2-H (honesty/perf)                      |
| L-214 | State hooks cadena a LEGACY (composite L-99)                     | T2-H                                     |
| L-215 | `useCheckout`/`useBillingPortal` window.location.href            | T2-E                                     |
| L-265 | — (WONT_FIX, ver Apéndice B)                                     | —                                        |
| L-270 | `loading.tsx` index-as-key antipattern                           | T2-E                                     |
| L-273 | dashboard layout 2-hop redirect chain                            | T3-F                                     |
| L-308 | admin→client URL questionable `/projects`                        | T1-D (document)                          |
| L-332 | `apiClient` vs raw fetch inconsistency                           | T3-D (split)                             |
| L-334 | `useSecurity` queries serializadas                               | T3-G                                     |
| L-352 | `ProviderLimits` DUP_TYPE_DIVERGENT (CRITICAL)                   | T5-D                                     |
| L-353 | `ProviderId` DUP_TYPE_IDENTICAL                                  | T5-D                                     |
| L-356 | `@core/threading` alias drift                                    | T2-J                                     |
| L-357 | `SubscriptionTier` deprecated usage                              | T6 DECIDE (migration path)               |
| L-358 | grab-bag files shared/src/                                       | T2-J                                     |
| L-359 | `planPublication` drops thread silently                          | T4-K                                     |
| L-360 | Template types dup                                               | T4-K (consolidate ports)                 |
| L-372 | `@adapters/db-prisma` missing typed export                       | T2-J                                     |
| L-373 | Storage 0.0.x version placeholders (3 pkgs)                      | T1-I                                     |
| L-378 | storage-s3 bucket fallback hardcoded                             | T1-I                                     |
| L-379 | Missing exports in sub-barrels                                   | T2-J                                     |
| L-390 | tiktok axios version drift                                       | T1-I                                     |
| L-391 | telegram missing logger dep                                      | T1-I                                     |
| L-392 | `@providers/shared` `@types/node` drift                          | T1-I                                     |
| L-393 | tiktok missing devDeps                                           | T1-I                                     |
| L-437 | bluesky import after export                                      | T2-J                                     |
| L-438 | shared re-export dup a types                                     | T2-J                                     |
| L-439 | `@providers/instagram` raw pino                                  | T4-M                                     |
| L-440 | `ProviderUtils` unreachable branch                               | T1-D                                     |
| L-491 | Design token drift (9 UI files — primary of composite)           | T4-M context                             |
| L-498 | VirtualScrollList `startTransition` shadowed                     | T1-D                                     |
| L-499 | tabs.tsx reimplementa Radix                                      | T2-J                                     |
| L-503 | `useContentEditor` exhaustive-deps suppression                   | T3-I context                             |
| L-504 | Tailwind safelist missing client (build risk)                    | T1-I                                     |
| L-505 | Tailwind safelist duplication candidate                          | T1-I                                     |
| L-520 | `types.ts` duplicate re-exports                                  | T2-J                                     |
| L-524 | `handleOAuthError` inconsistente con `sendError`                 | T4-R                                     |
| L-529 | plan count discrepancy schema ↔ seed                             | T1-I                                     |
| L-537 | Rollback docs gap                                                | T4-T (schema)                            |
| L-550 | `systemTemplates` reviewable i18n                                | T5-I                                     |
| L-553 | `multi-tenant-security.sql` MARK_OBSOLETE                        | T6 DECIDE                                |
| L-554 | snake_case mismatch en `@@map`                                   | T1-D                                     |
| L-557 | wildcard exports `@infra/prisma`                                 | T2-J                                     |
| L-573 | tsconfig `@packages/providers` convention drift                  | T1-I                                     |
| L-574 | tsconfig missing 6 package paths                                 | T1-I                                     |
| L-575 | project references 5/40 coverage                                 | T1-I                                     |
| L-585 | ghost vars second tier                                           | T1-I                                     |
| L-586 | double SoT `.env` (root vs apps/api/.env)                        | T1-I                                     |
| L-592 | no `commit-msg` hook                                             | T1-I (husky)                             |
| L-593 | no `pre-push` hook                                               | T1-I                                     |
| L-594 | stryker sandbox cleanup failed                                   | T1-I                                     |
| L-595 | knip no declara ORPHAN packages                                  | T1-I (post T6-B)                         |
| L-597 | port bindings `0.0.0.0` (SAFETY_CRITICAL)                        | T1-J                                     |
| L-599 | root `vitest.config` missing                                     | T1-I                                     |
| L-631 | secrets naming inconsistency cross-workflows                     | T4-Q                                     |
| L-632 | timeout defaults too high                                        | T1-J                                     |
| L-637 | reusable-workflows no aprovechados                               | T4-Q                                     |
| L-639 | job permissions default restrictive                              | T4-Q                                     |
| L-644 | docs/ taxonomy drift                                             | T1-D                                     |
| L-645 | Root README.md missing                                           | T1-C                                     |
| L-297 | default export violation (MfaManager + RbacManager)              | T3-I cross (L-278 already)               |
| L-268 | `announcements/page.tsx` triple violation                        | T3-F                                     |
| L-269 | Admin metadata gap 0/17 dashboard pages                          | B11 PLANNED                              |
| L-272 | proxy route buffers full body                                    | B11 PLANNED                              |
| L-115 | dashboard/layout.tsx "AI Settings" separate                      | B11 PLANNED (IA review)                  |
| L-116 | TemplateSelector uses postTemplates static                       | B11 PLANNED                              |
| L-97  | `posts/page.tsx` raw fetch + 4x any                              | B11 PLANNED                              |
| L-98  | posts/[id] alert() + LEGACY hook imports                         | T2-H (toast + canonical)                 |
| L-260 | Missing per-mutation `onError` ~56/87 mutations                  | T3-A (root cause)                        |
| L-267 | `proxy.ts` root-level dead middleware (admin)                    | T6-A cluster                             |

### C.10 — Entradas adicionales y cross-refs menores

Este bucket captura L-# individuales que no encajan en las categorías C.1..C.9 pero están cubiertos por el plan a través de un batch asignado arriba.

| L-#            | Descripción                                     | Notas                                                     |
| -------------- | ----------------------------------------------- | --------------------------------------------------------- |
| L-1            | MFA duality OLD vs NEW migration                | Absorbed por T4-E (argon2 migration batch — decisión CP3) |
| L-6-billing    | GatewayBillingService fake eventId (cross T5-E) | Resolved when L-6 fixed in T5-E                           |
| L-6            | `GatewayBillingService` 1042 LOC (primary)      | Primary en T5-E                                           |
| L-11           | content/ SyncEngineImpl vs ConflictDetector     | Primary en T5-B                                           |
| L-16           | `SyncProviderCommentsUseCase` API fuera de UoW  | Primary en T4-K                                           |
| L-34-ext       | index.ts 688 LOC split                          | Primary en T3-H                                           |
| L-57-ext       | publishHandler.ts split                         | Primary en T3-H                                           |
| L-260-ext      | Coverage gap composite                          | Resolved via T1-I (L-599) + T4-W (L-560)                  |
| L-310-ext      | Related mega hooks client side                  | Cluster T3-G                                              |
| L-35-ext       | Redis singleton                                 | Primary T4-F                                              |
| L-45-ext       | EventService default handlers                   | Resolved when L-36 resolved (T4-F/T4-G)                   |
| L-36-ext       | EventService consolidation                      | Primary T4-F                                              |
| L-46-dup       | ComposedEventDispatcher                         | Primary en T2-C                                           |
| L-528-ext      | EventStore silent failure                       | Primary en T4-B                                           |
| L-640-topology | Docker base + workers topology                  | L-640 en T4-Y; L-642 en T4-J                              |

---

## Glosario rápido

- **§5.7** — metodología PLAN_MAESTRO de greps robustos (pattern literal + template + BASE + count cross-check).
- **§5.8** — metodología PLAN_MAESTRO de lectura directa binaria ACTIVE vs DEAD vs PLANNED.
- **§5.9** — regla PLAN_MAESTRO "NO DELETE sin Edward". Cada finding DEAD requiere validación antes de ejecutar.
- **Orphan** — código con 0 consumers detectables (confirmado por 4-grep exhaustivo).
- **Composite** — finding que absorbe N sub-findings. Un solo L-# representa el grupo.
- **Fake-AI** — UI label sugiere ML/AI cuando backend es rule-based o hardcoded.
- **Fake-persistence** — UI sugiere persistencia cuando no escribe a backend.
- **SILENT-NO-OP** — UI muestra success cuando backend falla/no opera.
- **BLOCKED_BY / BLOCKS_MANY** — dependencia explícita entre findings.
- **🔒 BLOCKS_TIER** — batch bloquea otros del mismo tier.
- **⚡ PARALELIZABLE** — batch ejecutable en paralelo con otros del tier.
- **🔗 CROSS_TIER_COMPOSITE** — batch tiene refs cruzadas a otros tiers.

---

## Log de cambios

| Fecha      | Cambio                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-21 | v1 — `REMEDIATION_BATCHES.md` (11 batches temáticos B0..B10).                                                                                                                   |
| 2026-04-21 | **v2 — `REMEDIATION_ROADMAP.md` (este documento) — híbrido T0..T6 micro-batches + v1 enumeración + apéndices.** Reemplaza v1 y `CLAUDE_ALTERNATE_PLAN.md` como working roadmap. |
| 2026-04-21 | **v2.1 — T6 decisions aplicadas (sesión 2026-04-21).** 9/10 decisiones cerradas, WIRE-heavy (8 de 10). Cadencia 17 → 35-40 semanas. Ver §11 changelog para detalles.            |

---

**Fin de documento.** Para evidencia de cada finding ver `docs/audits/LATERAL_FINDINGS.md`. Para contexto de cada sprint ver `docs/audits/D0v4_<n>_*.md`. Para metodología ver `docs/audits/PLAN_MAESTRO.md`. Para síntesis arquitectónica ver `docs/audits/D0v4_8_INFRASTRUCTURE_REPORT.md` §12/§14/§15. Para los dos insumos originales ver `docs/audits/REMEDIATION_BATCHES.md` (v1) y `docs/audits/CLAUDE_ALTERNATE_PLAN.md`.

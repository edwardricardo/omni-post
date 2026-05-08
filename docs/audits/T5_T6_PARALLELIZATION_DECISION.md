# T5/T6 Parallelization Decision

**Status**: análisis y recomendación pendiente de aprobación de Edward.
**Generado**: 2026-05-06.
**Source**: [REMEDIATION_ROADMAP.md](./REMEDIATION_ROADMAP.md) v2.1 §6 dependency graph + `canon-index.json` (126 entries; +7 entries añadidas 2026-05-06 cubriendo los gaps detectados — Saga+CQRS, i18n, custom hooks, circuit breaker).
**Phase 2** del meta-plan de process improvements post-remediation (planes locales en `~/.claude/projects/<workspace>/plans/`, fuera del repo).

## TL;DR

> **Parallel selectivo Wave 1, arrancando con T5-A, T5-C, T5-D, y T5-G** (todos con deps T4 cerradas + canon support strong tras research del 2026-05-06). T5-A (Saga+CQRS) era el único gap-crítico y ya está cubierto con 4 entries canónicas (Richardson, Microsoft, Fowler, Microsoft CQRS). T5-B/E/H/I y T6-B-5b/E esperan T4 abiertos o T6 exec. Resto T6 ejecutable en paralelo (decisiones de scope cerradas).

---

## Sección A — Dependency map (T5/T6 vs T4)

Datos del § 6 del roadmap, cruzados con `batch-status-report.py` para identificar T4 batches cerrados (✅) vs abiertos (📋).

### T5 batches (9)

| ID   | Topic              | T4 deps explícitas                     | Status deps               | T6 deps                            |
| ---- | ------------------ | -------------------------------------- | ------------------------- | ---------------------------------- |
| T5-A | Saga + CQRS        | T4-A ✅, T4-H ✅, T4-I ✅, **T4-V** 📋 | Casi ready (RBAC abierto) | Decisiones cerradas                |
| T5-B | Content module     | —                                      | n/a                       | T6-G (decisión ✅, exec pendiente) |
| T5-C | RepoPort split     | T4-A ✅                                | **READY**                 | n/a                                |
| T5-D | Providers 5-way    | T4-A ✅                                | **READY**                 | n/a                                |
| T5-E | Billing module     | **T4-U** 📋                            | Bloqueado                 | n/a                                |
| T5-G | Inbox sync UC      | T4-I ✅, T4-H ✅                       | **READY**                 | n/a                                |
| T5-H | Publishing cleanup | —                                      | n/a                       | T6-D (exec pendiente)              |
| T5-I | i18n hardening     | —                                      | n/a                       | T6 producto                        |
| T5-J | Repurpose flow     | —                                      | n/a                       | T6 spec                            |

**Conclusión sección A**: 3 batches T5 listos para arrancar (T5-C, T5-D, T5-G). 1 casi listo (T5-A) con un blocker (T4-V RBAC). 5 esperan T4-U o T6 exec.

### T6 batches (11)

| ID      | Topic                 | Decisión cerrada | Exec status                |
| ------- | --------------------- | ---------------- | -------------------------- |
| T6-A    | Admin hooks           | ✅ 2026-04-21    | Pendiente                  |
| T6-B 5a | Storage multi-cloud   | ✅               | Pendiente                  |
| T6-B 5b | CRM integrations      | ✅               | Pendiente (deps T4-V RBAC) |
| T6-C    | Editor chain          | ✅               | Pendiente                  |
| T6-D    | Publishing rescate    | ✅               | Pendiente                  |
| T6-E    | Circuit Breaker       | ✅               | Pendiente (deps T4-N OTel) |
| T6-F    | D1 reclassifications  | ✅               | Pendiente                  |
| T6-G    | Content module Fase 1 | ✅               | Pendiente                  |
| T6-H    | Analytics auth        | ⏸️ pendiente     | Bloqueado                  |
| T6-I    | RateLimitingDashboard | ✅               | Pendiente                  |
| T6-J    | Trends/radar          | ✅               | Pendiente                  |

**Conclusión sección B**: 10/11 T6 decisiones cerradas. T6-A, T6-C, T6-D, T6-F, T6-G, T6-I, T6-J ejecutables sin deps T4. T6-B 5b y T6-E tienen deps T4 abiertas.

---

## Sección B — Canon-grounded analysis

Cross-reference con `canon-index.json` (119 entries) para validar si cada batch T5/T6 tiene **soporte canónico** (research previo argumentado en el index) que respalde su ejecución.

### T5 batches — soporte canónico por nivel

| Batch                   | Canon support                         | Entries clave                                                                                                                                                                                        | Veredicto                                         |
| ----------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **T5-A** Saga+CQRS      | **STRONG** (post-research 2026-05-06) | `richardson-saga-pattern-microservicesio`, `azure-architecture-center-saga-design-pattern`, `fowler-cqrs-canonical-bliki-entry`, `azure-architecture-center-cqrs-pattern-event-sourcing-combination` | ✅ Listo (gap cerrado)                            |
| T5-B Content module     | Medio                                 | `cockburn-hexagonal`, `ford-parsons-evolutionary`                                                                                                                                                    | ✓ Suficiente para empezar; refinable durante exec |
| **T5-C** RepoPort       | **STRONG**                            | `cockburn-hexagonal`, `oneuptime-multi-layer-caching`, `type-cacheable-cache-flow`, `dependency-cruiser`                                                                                             | ✅ Listo                                          |
| **T5-D** Providers      | **STRONG**                            | `dependency-cruiser`, `eslint-9-flat-config`, `osv-scanner`, `typescript-eslint-v8`                                                                                                                  | ✅ Listo                                          |
| T5-E Billing            | Strong (específico)                   | `crunchy-data-money-precision`, `prisma-decimaljs-precision`                                                                                                                                         | ✓ Listo (pero blocked T4-U)                       |
| **T5-G** Inbox sync     | **STRONG**                            | `nodejs-timers-api-unref`, `agenda-draintimeoutms`, `dev-why-setinterval-can-break-your-app`                                                                                                         | ✅ Listo                                          |
| T5-H Publishing cleanup | Bajo                                  | Stream processing tangencial                                                                                                                                                                         | ⚠️ Blocked T6-D anyway                            |
| **T5-I** i18n           | **STRONG** (post-research 2026-05-06) | `next-intl-app-router-setup-routing-configuration`                                                                                                                                                   | ✅ Listo (gap cerrado; aún blocked T6 producto)   |
| T5-J Repurpose          | Bajo (prod spec)                      | n/a                                                                                                                                                                                                  | ⏸️ Blocked T6 spec                                |

### T6 batches — soporte canónico

| Batch                      | Canon support                         | Entries clave                                | Veredicto                                     |
| -------------------------- | ------------------------------------- | -------------------------------------------- | --------------------------------------------- |
| **T6-A** Admin hooks       | **STRONG** (post-research 2026-05-06) | `react-docs-reusing-logic-with-custom-hooks` | ✅ Listo                                      |
| T6-B 5a Storage            | Medio                                 | timestamps canon (existing)                  | ✓                                             |
| T6-B 5b CRM                | Bajo                                  | n/a (deps RBAC)                              | Blocked T4-V                                  |
| T6-C Editor chain          | Medio                                 | LLM caching (existing)                       | ✓                                             |
| T6-D Publishing rescate    | Bajo                                  | n/a                                          | ✓ (decisión scope clara)                      |
| **T6-E** Circuit Breaker   | **STRONG** (post-research 2026-05-06) | `opossum-nodejs-circuit-breaker-nodeshift`   | ✅ Listo (aún blocked T4-N OTel para metrics) |
| T6-F D1 reclass            | Mínimo                                | n/a                                          | ✓                                             |
| T6-G Content Fase 1        | Medio                                 | LLM caching (existing)                       | ✓                                             |
| T6-I RateLimitingDashboard | Mínimo                                | n/a                                          | ✓ (es DELETE + scaffold nueva)                |
| T6-J Trends                | Suficiente                            | logging/redaction (existing)                 | ✓                                             |

**Hallazgo actualizado (2026-05-06)**: los 4 GAPs detectados originalmente (T5-A, T5-I, T6-A, T6-E) están **cerrados** tras research + adición de 7 canon entries. Todos los batches ahora tienen canon support documentado. Bloqueadores actuales son SOLO de deps T4 abiertas o T6 exec pendiente, NO de canon coverage.

---

## Sección C — Tres opciones evaluadas

| Opción                    | Wait                                                       | Parallel selectivo                         | Parallel agresivo                                      |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------ |
| **Cuándo arranca T5**     | Cuando T4 100% cerrado (estimado: 6-9 meses con factor 3×) | T5-C/T5-D/T5-G ahora; resto secuenciado    | Todo T5 lo no-duro-bloqueado en paralelo               |
| **Riesgo retrabajo**      | Mínimo                                                     | Bajo (deps explícitas validadas)           | Medio-alto (T4-A puede mover puertas que afectan T5-D) |
| **Riesgo calendario**     | Alto: ~6 meses sin T5 progress                             | Bajo: 3 batches T5 arrancan ya             | Mínimo                                                 |
| **Riesgo canon-quality**  | Bajo (más tiempo para research)                            | Bajo (3 batches READY tienen canon STRONG) | Alto (T5-A sin canon ejecutándose)                     |
| **Esfuerzo coordinación** | Bajo                                                       | Medio (review deps cada cierre T4)         | Alto (cross-team sync semanal)                         |
| **Capacity requerida**    | 1 frente                                                   | 2 frentes (T4 + T5 selectivo)              | 3+ frentes (T4 + T5 + T6 exec)                         |

---

## Sección D — Recomendación canon-grounded

**Recomiendo Parallel selectivo** con la siguiente secuencia, ordenada por canon-strength + dep-readiness (actualizada 2026-05-06 tras cubrir los 4 gaps de canon):

### Wave 1 (arrancar inmediatamente, deps + canon ✅)

1. **T5-A** Saga+CQRS — canon STRONG (4 entries: Richardson, Microsoft Saga, Fowler, Microsoft CQRS — añadidas 2026-05-06). Deps T4-A ✅, T4-H ✅, T4-I ✅. Único T4 abierto: T4-V (RBAC) — pero T5-A puede arrancar con stub de RBAC e integrar al cierre de T4-V. Estimación 30-50 h. **El batch más importante** ("UI miente al usuario" según roadmap §6); ahora desbloqueable porque el gap de canon que lo bloqueaba está cerrado.
2. **T5-C** RepoPort split — canon STRONG (`cockburn-hexagonal`, `dependency-cruiser`), deps T4-A cerrada. Estimación 40-80 h. Patrón port + adapter extensamente validado en el index.
3. **T5-D** Providers 5-way unification — canon STRONG (`dependency-cruiser`, `typescript-eslint-v8`), deps T4-A cerrada. Estimación 20-40 h. Comparte canon con T5-C; paralelizable.
4. **T5-G** Inbox sync UC — canon STRONG (`nodejs-timers`, `agenda-draintimeoutms`), deps T4-H+I cerradas. Estimación 10-20 h. Más pequeño, buen candidato para una sesión enfocada — **el de menor riesgo para validar el flujo "T5 paralelo a T4 abierto"**.

### Wave 2 (post-Wave 1, decisiones T6 closed + canon ahora ✅)

5. **T6-A** Admin hooks (WIRE/RESCATE/DELETE) — canon STRONG (`react-docs-reusing-logic-with-custom-hooks` añadido 2026-05-06). Decisión scope cerrada.
6. **T6-D** Publishing rescate — decisión scope clara, scope acotado.
7. **T6-J** Trends/radar — 20 min, decisión "approved", canon de logging suficiente.
8. **T6-I** RateLimitingDashboard — DELETE + scaffold nueva.

### Wave 3 (deps T4 abiertas — esperar)

9. **T5-E** Billing — esperar T4-U (Decimal migration) cierre.
10. **T6-B 5b** CRM — esperar T4-V (RBAC SoT) cierre.
11. **T6-E** Circuit Breaker — canon STRONG (`opossum-nodejs-circuit-breaker-nodeshift` añadido 2026-05-06), pero esperar T4-N (OTel stable) para wire de metrics + dashboard.

### Wave 4 (defer hasta T6 exec o producto)

12. **T5-B** Content module — esperar T6-G exec.
13. **T5-H** Publishing cleanup — esperar T6-D exec.
14. **T5-I** i18n — canon STRONG (`next-intl-app-router-setup-routing-configuration` añadido 2026-05-06), pero esperar decisión producto sobre locales target + scope.
15. **T5-J** Repurpose — esperar producto.

### Justificación canon-driven

La regla aplicada: **un batch arquitectural no se ejecuta sin canon entry que respalde el patrón a aplicar**. Esta regla deriva de:

- `feedback_check_canon_index_first.md` (memoria de Edward) — leer canon antes de research nuevo.
- `feedback_no_patches.md` — investigación canon antes de modificar.
- `feedback_question_from_scratch.md` — diseño desde cero requiere canon como vara.

**Actualización 2026-05-06**: T5-A, T5-C, T5-D, T5-G satisfacen ahora el principio (T5-A tras research + 4 entries añadidas hoy). T5-A pasa de Wave 3 (donde estaba bloqueado por gap de canon) a Wave 1.

### Cuándo NO seguir esta secuencia

- Si Edward tiene capacity para 1 sola batch en paralelo a T4: hacer **solo T5-G** (10-20 h, riesgo mínimo, alto valor) — confirma el flujo "T5 paralelo a T4 abierto" antes de gastar capacity en T5-A.
- Si Edward tiene 3+ developers full-time: arrancar Wave 1 completo (T5-A + T5-C + T5-D + T5-G en paralelo). T5-A sigue siendo el de más esfuerzo (30-50 h) y mayor impacto.
- Si producto presiona por T5-B (Content module): forzarlo en Wave 1 aceptando el bloqueo en T6-G; tradeoff: Content puede arrancar sobre fundación incompleta y requerir refactor cuando T6-G ejecute.

---

## Acción siguiente

1. **Edward valida o desafía la secuencia revisada** (Wave 1 ahora incluye T5-A).
2. Si valida: arranca **T5-G** primero (más chico, valida el flujo de "T5 paralelo a T4 abierto" con riesgo bajo). T5-A en paralelo si capacity lo permite.
3. T5-A: ejecutable directo — el research previo está en `canon-index.json` (4 entries: Saga Richardson, Saga Microsoft, CQRS Fowler, CQRS Microsoft). Cita esas entries al iniciar el batch.
4. Re-evaluar este doc cada 4 semanas o cuando un T4 batch cierre (puede mover Wave 3 → Wave 1, especialmente T5-E al cerrarse T4-U y T6-E al cerrarse T4-N).

**Actualización del roadmap**: si esta decisión se aprueba, agregar al § changelog del `REMEDIATION_ROADMAP.md` la entry "2026-05-XX: T5/T6 parallelization decision aprobada — ver T5_T6_PARALLELIZATION_DECISION.md".

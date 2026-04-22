# OmniPost — Plan de Triage por Complejidad Ascendente (referencia)

> **Documento de referencia.** Plan producido por una herramienta alternativa el 2026-04-21 en paralelo al `REMEDIATION_BATCHES.md` v1. Preservado aquí como fuente para el `REMEDIATION_ROADMAP.md` v2 (síntesis híbrida). Este archivo no se ejecuta — es insumo histórico.

**Fecha:** 2026-04-21
**Scope:** 647 lateral findings (L-1..L-647) del tramo D0-v4
**Objetivo:** orden de ejecución desde lo más trivial hasta lo más complejo, con análisis de dependencias entre batches

---

## Cómo leer este documento

El plan está organizado en **7 tiers** de complejidad ascendente. Cada tier contiene **batches** — unidades de trabajo que se ejecutan en una sesión, agrupadas por dominio coherente para reducir context-switching.

**Tiers:**

- **T0 — Housekeeping operativo urgente** (fuera de complejidad, prioridad por riesgo externo temporal)
- **T1 — Trivial** (pocas líneas, sin dependencias, sin riesgo)
- **T2 — Local pequeño** (un archivo, cambios mecánicos)
- **T3 — Local mediano** (un archivo + consumers inmediatos, o lógica pequeña)
- **T4 — Estructural chico** (módulo completo, introducir port, fix de contract)
- **T5 — Estructural grande** (arquitectura, múltiples capas, migraciones)
- **T6 — Decisión de producto primero** (bloqueado en tu input, no en ejecución)

**Dentro de cada tier**, batches ordenados por dependencias ascendentes: si batch B necesita algo que batch A produce, A va antes.

**Convención:**

- 🔒 = bloqueante para batches posteriores (fix este antes de avanzar en el mismo tier)
- ⚡ = paralelizable (puede ejecutarse junto a cualquier otro batch del mismo tier)
- 🔗 = tiene composite con batches de otros tiers (referencias cruzadas)

---

## T0 — Housekeeping operativo urgente

### Batch T0-A — Secrets rotation 🔒

- **L-591** — `apps/api/.env` git-tracked con secrets reales (DATABASE_URL, JWT_SECRET, provider keys)

**Pasos:** git rm --cached + rotate secrets + verify .gitignore + bfg si expuesto.
**Estimación:** 1-2 horas.

---

## T1 — Trivial

### T1-A — ESLint rules wire ⚡

L-576 (no-console), L-577 (no-restricted-imports), L-578 (no-explicit-any), L-579 (no-floating-promises), L-580 (eslint-config-prettier).
30 min. Activar como `warn` primero.

### T1-B — setInterval unref ⚡

L-51 composite (5 sitios: index.ts:630/644, auditLogger:64, slidingWindowRateLimit:81, enhancedValidator:119).
15 min.

### T1-C — .gitignore + git hygiene ⚡

L-531, L-562, L-601 (3 .bak), L-589, L-590, L-587 (.gitattributes), L-588 (CODEOWNERS).
20 min.

### T1-D — Comments obsoletos + dead refs ⚡

L-50, L-119, L-493, L-494, L-555, L-598.
30 min.

### T1-E — Unused imports + state ⚡

L-309, L-120, L-121, L-122, L-502.
30 min.

### T1-F — @layer y @file JSDoc normalization 🔗

L-298, L-344, L-556, L-388, L-527, L-300, L-301, L-302, L-299.
~130 archivos. 2-3 horas.

### T1-G — Hardcoded labels menores ⚡

L-492, L-519, L-105, L-549, L-493/L-494 (cubiertos en T1-D).
30 min.

### T1-H — Missing ARIA triviales ⚡

L-500, L-501.
10 min.

### T1-I — Config one-liners ⚡

L-530, L-571, L-572, L-533, L-583, L-584, L-532.
1 hora.

### T1-J — Docker/CI one-liners ⚡

L-641, L-597, L-596, L-628, L-634, L-633.
1 hora.

**T1 total:** 8-10 horas. 2-3 sesiones.

---

## T2 — Local pequeño

### T2-A — Fetch paths inconsistentes (auth injection) 🔒

L-261, L-262, L-264, L-328, L-329.
1 hora. Precede a cualquier refactor de estos hooks.

### T2-B — ErrorBoundary + error.tsx leak ⚡

L-271, L-304, L-109, L-303, L-110 (los últimos 2 dependen de logger port T4).
1 hora.

### T2-C — Silent catches ⚡

L-306, L-331, L-46, L-528 (crítico upgrade en T4).
1.5 horas.

### T2-D — HTML/a11y labels ⚡

L-307.
1 hora.

### T2-E — Path/nav corrections ⚡

L-92, L-93, L-91, L-84.
1-1.5 horas.

### T2-F — ci.yml / workflows urgentes 🔒 🔗

L-622 (remover `|| true`), L-581, L-582, L-635.
1 hora.

### T2-G — Raw throws en application layer 🔗

L-643, L-496.
1 hora.

### T2-H — Fake/hardcoded data UI-only ⚡

L-78, L-79, L-80, L-81, L-82, L-83, L-106, L-111, L-112, L-213, L-326.
2-3 horas.

### T2-I — Over-clientization (remove "use client") ⚡

L-123, L-124, L-125, L-126, L-127, L-128, L-129 (deps L-87), L-130 (deps L-73), L-131, L-132, L-133, L-134.
1.5 horas.

### T2-J — Filename/naming renames ⚡

L-211, L-355, L-354, L-389, L-523, L-646.
2 horas.

### T2-K — Type narrowing (any → specific) 🔗

L-216..L-228, L-229..L-235, L-508, L-514, L-333, L-59.
**Después de T3-C/T3-D split client.ts.** 3-4 horas.

**T2 total:** 15-18 horas. 3-4 sesiones.

---

## T3 — Local mediano

### T3-A — QueryClient global config 🔒

L-70, L-336, L-101. Resuelve parcialmente L-260 (87 mutations sin onError).
2-3 horas.

### T3-B — Auth flow unification 🔒

L-69, L-208, L-209, L-345. Decisión arquitectónica: Server Action delega a AuthAPI class canónica.
4-6 horas.

### T3-C — client.ts split (apps/client) 🔒

L-212, L-237. Habilita T2-K.
3 horas.

### T3-D — apiClient.ts split (apps/admin) 🔒

L-337.
3 horas.

### T3-E — Unificar useProviders (4 paths → 1) 🔒

L-207, L-86, L-210, L-263.
3-4 horas.

### T3-F — Small god files (apps/client) ⚡

L-238, L-239, L-240 (deps L-77), L-241, L-242, L-243, L-244 (deps T3-B), L-245..L-258, L-164.
4-6 horas.

### T3-G — Small god files (apps/admin) ⚡

L-310, L-311, L-312, L-313, L-314, L-315 (deps L-325+T2-C), L-316 (deps T6-A).
3-5 horas.

### T3-H — Small god files (apps/api + packages) ⚡

L-57 (publishHandler split), L-34 (index.ts split), L-7 (webhookDashboard — cross T4-X).
6-10 horas.

### T3-I — Component size violations UI (top 20) ⚡

Pragmatic: priorizar >400 LOC. Top 20 listed:
L-236/L-140, L-274, L-135, L-275, L-136, L-137, L-138, L-139, L-142, L-276 (deps L-294), L-456, L-277, L-148, L-278, L-144, L-279 (deps L-305), L-146, L-149, L-150, L-151.
Los files muertos (L-141/L-143/L-147/L-156/L-162/L-169) son DELETE en T5-H.
20-30 horas.

### T3-J — Missing ARIA composites ⚡

L-497.
3-4 horas.

### T3-K — useInbox.markMessageRead ⚡

L-206.
30 min.

### T3-L — useAdminPasswordReset silent ⚡

L-330.
30 min.

### T3-M — ProjectProvider raw fetches (apps/client) 🔗

L-100 (depende T6-A decision en L-335).
3-4 horas.

### T3-N — Webhooks TanStack migration 🔒

L-327 (expand hook), L-294, L-295.
4-6 horas.

### T3-O — DeadLetterQueue retry-all backend 🔗

L-299. Decisión: implementar backend o remove UI.
2 horas.

### T3-P — Fake-AI composite remediation (UI-only) 🔗

L-77, L-89 (deps L-77), L-325 (6 fields), L-293.
2-8 horas por finding según decisión.

### T3-Q — ClientContentEditor autosave wire 🔒

L-85, L-205.
3-4 horas.

### T3-R — SidebarNav logout + OAuth admin UI ⚡

L-305, L-94 (OAuth 10/11 providers), L-95.
Variable. L-94 es 3-6 horas.

**T3 total:** 60-90 horas. 2-3 semanas parciales.

---

## T4 — Estructural chico

### T4-A — Hexagonal boundary leaks 🔒

L-364, L-507, L-384, L-455, L-525, L-385.
15-20 horas. **Habilita T5-C + T5-D.**

### T4-B — EventStore migration a schema 🔒

L-41 (formal migration), L-42 (decidir IMPLEMENT vs DELETE), L-528.
6-10 horas.

### T4-C — Outbox concurrent claim fix 🔒

L-43, L-22 (absorbido).
4-6 horas.

### T4-D — Rate limiters consolidation

L-30, L-26, L-29. Decisión: cuáles mantener canónicos.
4-8 horas.

### T4-E — Validators consolidation

L-31, L-32 (incluye data migration SHA-256→argon2).
6-10 horas.

### T4-F — DI registration fixes 🔒

L-35, L-37, L-40, L-36, L-25.
6-10 horas.

### T4-G — Integration events handlers NO-OP 🔒

L-44, L-45, L-76.
8-12 horas.

### T4-H — QueuePort adapter fix 🔒

L-61, L-363, L-380, L-376, L-383. **Resuelve L-55, L-73, L-74, L-75 downstream.**
4-6 horas.

### T4-I — Workers retry + shutdown + auth errors 🔒

L-53, L-54, L-52, L-56.
6-10 horas.

### T4-J — Workers ubicación + provider registry

L-65, L-60, L-642.
6-10 horas.

### T4-K — AI service port (hexagonal fix) 🔒

L-15, L-16, L-17, L-18, L-19, L-21.
8-12 horas.

### T4-L — Cache consolidation

L-49, L-13, L-377, L-381.
6-10 horas.

### T4-M — Logger port + browser-logger 🔒

L-347, L-303, L-110, L-382, L-495, L-552, L-361. Habilita T2-B pendientes.
6-8 horas.

### T4-N — CorrelationTracker + OTel

L-510, L-511, L-512, L-513, L-33, L-509.
6-10 horas.

### T4-O — Health checkers fixes

L-515, L-516, L-517, L-518, L-521, L-522.
6-10 horas.

### T4-P — Fitness functions CI wire 🔒 🔗

L-630, L-647. Umbrales iniciales [0,0,8,3,0,0,0,0,130,0] → descender via T1-F/T2-G/T3-H/T4-K.
4-6 horas.

### T4-Q — CI pipeline repair 🔒

L-616 (composite), L-617..L-620 (absorbed), L-621, L-623, L-629, L-624, L-625, L-626, L-627.
10-15 horas.

### T4-R — CSV injection + audit completeness

L-526, L-27 (compliance fix).
4-6 horas.

### T4-S — File upload validator

L-28.
6-10 horas.

### T4-T — Schema FK gaps + CHECK constraints

L-534, L-535, L-536, L-539, L-540, L-541.
6-10 horas.

### T4-U — Invoice Float → Decimal migration 🔒

L-538. Data migration con backup.
4-8 horas.

### T4-V — RBAC single SoT 🔒

L-545, L-546.
3-4 horas.

### T4-W — Seeds split prod/dev

L-547, L-551, L-559, L-561, L-560.
6-10 horas.

### T4-X — Webhook dashboard N+1 + retry queue 🔒

L-7.
8-12 horas.

### T4-Y — Dockerfile + base image build 🔒

L-640.
4-6 horas.

### T4-Z — Trends/Reports consolidation

L-20, L-8 (mock data decisión).
10-15 horas.

**T4 total:** 130-200 horas. 4-6 semanas parciales.

---

## T5 — Estructural grande

### T5-A — Saga + CQRS wire 🔒 CRÍTICO

**El batch más importante del plan.** Resuelve "UI miente al usuario" transversal.
L-63, L-64, L-47, L-62, L-66, L-67, L-71, L-72.
Orden: T4-A + T4-H + T4-I primero → L-62 (gateway worker warm-up) → L-64 stub fix → L-47 decision → L-63 wire → L-72 UI verification.
30-50 horas (sprint dedicado).

### T5-B — Content module integration 🔒

L-9, L-10, L-11. Decisión producto: ejecutar ahora o marcar PLANNED.
Si ejecuta: 80-120 horas. Si difiere: 0.

### T5-C — RepoPort split 🔒 ALTO IMPACTO

L-362. Afecta ~56 adapters + todos los UseCases.
40-80 horas (sprint dedicado).

### T5-D — Providers 5-way consolidation 🔒

L-386, L-14 (superseded), L-441, L-387.
20-40 horas.

### T5-E — GatewayBillingService god refactor

L-6 (split + fix fake eventId).
20-30 horas.

### T5-G — Inbox sync worker → domain UC

L-55, L-74.
10-20 horas.

### T5-H — Publishing subsystem DEAD cleanup

L-68 DEAD (~2,711 LOC), L-141/L-143/L-147/L-156/L-162/L-169 (dependent).
4-8 horas si DELETE aprobado.

### T5-I — i18n infrastructure 🔗

L-296, L-470..L-482, L-113. Decisión producto: single-language vs true i18n.
40-80h si i18n real; 8-12h si single-language cleanup.

### T5-J — Repurpose + feature completions

L-75, L-87, L-96.
Variable.

**T5 total:** 100-400 horas. 2-4 meses parciales.

---

## T6 — Decisiones de producto primero

**Los findings aquí no se ejecutan hasta que Edward decida. Sesión de 2-3 horas produce ~100 findings resueltos por decisión.**

### T6-A — Admin hooks ORPHAN (wire vs delete)

L-317, L-318, L-319, L-320, L-321, L-322, L-323, L-324, L-335, L-338, L-339, L-340, L-341, L-342, L-343, L-346, L-348.

### T6-B — Package-level ORPHAN adapters (wire vs delete)

L-350, L-351, L-366, L-367, L-369, L-370, L-371, L-365.
Pregunta: ¿storage multi-provider planeado? ¿CRM integrations planeadas?

### T6-C — Content editor chain packages/ui (wire vs delete) 🔗

L-442, L-443 (+L-455), L-444..L-453, L-454. ~2,515 LOC.
Relacionado con L-68 publishing decisión.

### T6-D — Subsistema Publishing (wire vs delete)

L-68 DEAD ~2,711 LOC. Wire: sprint gigante. Delete: T5-H ejecuta simple.

### T6-E — Circuit Breaker monitor (wire vs delete)

L-506, L-368, L-473, L-517.

### T6-F — Misclassifications D1 pre-D0v4-1

21 endpoints reclasificar KEEP_AS_INTERNAL → BUILD_UI (SSO admin, Zapier/Make bilateral, Health dependency panel, Providers health dashboard) + 7 auth/authRoutes.ts admin-side.

### T6-G — Content module CORE_CONCEPTUAL prioritization

content/ 18 endpoints PLANNED 7.6K LOC — construir ahora / diferir / marcar PLANNED con fecha target.

### T6-H — /analytics/project/:projectId auth decisión

Public intencional (documentar) vs gap auth (añadir preHandler).

### T6-I — RateLimitingDashboard + CQRS reclassification

RateLimitingDashboard clase nunca instanciada clasificada BUILD_UI P1 incorrectamente → DEAD_CODE o implementar.

### T6-J — Trends/radar + analytics rescatados

Trends/radar approved (sprint pending). Analytics endpoints rescatados a BUILD_UI P1.

**T6 total:** 2-3 horas sesión de decisiones.

---

## Dependencias críticas entre tiers

```
T0-A (secrets) ─────────────────────────────────────────── [ahora, único]

T1 ───────── paralelizable mayormente, todos antes de T2-K
  └─ T1-F @layer fix ───────────┐
                                 │
T2 ────────── usa T1 como base   │
  ├─ T2-A credentials ──┐        │
  ├─ T2-C silent catch  │        │
  └─ T2-K type narrowing ◄──── espera T3-C/T3-D split
                        │
T3 ─── gran bloque central ──── "wire + unificar"
  ├─ T3-A QueryClient ──────────── desbloquea error handling
  ├─ T3-B Auth unification ─────── desbloquea multi-auth fixes
  ├─ T3-C client.ts split ──────── habilita T2-K (cliente)
  ├─ T3-D apiClient.ts split ──── habilita T2-K (admin)
  ├─ T3-E useProviders unify ──── habilita cleanup
  └─ T3-N webhooks TanStack ───── depende de T3-D + L-327

T4 ─── estructural ──── "puertos y adapters"
  ├─ T4-A boundary leaks ──── habilita T5-D + T5-C
  ├─ T4-B EventStore ──────── habilita event sourcing path
  ├─ T4-H QueuePort ──────── habilita T4-I workers + T5-A saga
  ├─ T4-I workers ─────────── habilita T5-G inbox refactor
  ├─ T4-M logger port ────── resuelve T2-B pending items
  ├─ T4-P fitness wire ─── enforce todo lo anterior
  └─ T4-V RBAC SoT ──────── simplifica T5-A CQRS wire

T5 ─── arquitectura ──── "el corazón"
  ├─ T5-A saga + CQRS ─────── depende T4-A + T4-H + T4-I
  ├─ T5-B content (opcional) ─ decisión T6-G
  ├─ T5-C RepoPort split ──── afecta todo downstream
  ├─ T5-D providers 5-way ─── depende T4-A
  └─ T5-E billing split ────── depende T4-U Decimal

T6 ─── decisiones tuyas ─── habilitador horizontal
     produce inputs que desbloquean T1-T5
     recomendable ejecutar T6-A..T6-J EARLY
     idealmente antes de profundizar en T3
```

## Orden de ejecución recomendado

- **Semana 1:** T0-A + T6 sesión decisiones (2-3h) + T1 paralelizable.
- **Semanas 2-3:** T2 local pequeño.
- **Semanas 4-8:** T3 gran bloque refactor.
- **Semanas 9-16:** T4 estructural.
- **Semanas 17+:** T5 arquitectura.

## Meta-regla final

Correr D0..D7 al final como **verificación, no descubrimiento**.

---

**Referencia histórica. No se ejecuta — insumo para REMEDIATION_ROADMAP.md v2.**

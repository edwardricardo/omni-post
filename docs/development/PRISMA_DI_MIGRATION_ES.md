# Migración prisma→DI (Fase 2) — estado y plan

> Workstream en la rama `workstream/prisma-di-migration`. Este doc es el ancla durable
> del progreso; el detalle vivo de cada fase está en los mensajes de commit.

## Meta

Eliminar todo `import { prisma }` (y otros singletons/globals) fuera de los **composition roots**.
Cada unidad (servicios, adapters, repositorios, processors, route handlers, workers) **recibe**
sus dependencias por inyección de constructor; solo el composition root
(`apps/api/src/infrastructure/container/**` + el bootstrap `apps/api/src/index.ts`) construye
concretes. Ver §"Dependency Injection" de `CLAUDE.md`.

**Enforcement:** fitness function **#21** (no `import { prisma }` fuera de composition roots) y
**#1** (no `import { prisma }` en rutas). Definidas en `CLAUDE.md` §"Automated Compliance Checks"
y `.github/workflows/fitness.yml`. Corrieron como **ratchets** (baseline 65/4 → 0) durante la
remediación; **completada — ambas son hard-zero**.

## Hecho

| Fase         | Commit    | Resumen                                                                                                                                                                      |
| ------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F0           | `57555d2` | fitness fix #1 glob (case-insensitive) + #21 ratchet + DI canon en CLAUDE.md                                                                                                 |
| F1a          | `efdc5b0` | ctor-inject de 9 adapters Prisma ya registrados                                                                                                                              |
| F1c          | `d8cd369` | ctor-inject de ~22 servicios TYPE-A                                                                                                                                          |
| F2-A1        | `eaed5af` | admin-auth services → puertos; `AdminUser` credential-DTO split (DTO público sin secretos)                                                                                   |
| F2-A2        | `14fc69d` | cluster billing/subscription → composition root real (Seemann); `Account` aggregate enriquecido                                                                              |
| B1           | `f1651b0` | analytics services prisma-free + `ThreadReadRepository` + quitar fallback Prisma en 3 adapters                                                                               |
| B2           | `34f915e` | tabla `conversions` + `ConversionRepository` + ROI engine prisma-free. **#21: 29→28**                                                                                        |
| Homologación | `67a38b6` | 7 tests integration falsos-verdes (imports vitest bajo node:test → no ejecutaban) → 153 assertions reales en `node:test`+`assert`; arregló 4 migraciones de drift            |
| B3           | `3f63083` | Realtime de analytics por **SSE canon** (reemplaza el WebSocket nunca cableado). Plan: [docs/features/REALTIME_SSE_ES.md](../features/REALTIME_SSE_ES.md)                    |
| B4           | `479c084` | Rutas premium cableadas a use-cases: ROI, cross-platform, timing/best-times. `geographic` + `media-performance` quedan **501 documentados** (gap real de datos, fuera de DI) |
| Bloque C     | `20e33b9` | `AuditLogRepository` inyectado por ctor en `AuditableService` y subclases — **0** `new AuditLogRepository` inline fuera del composition root                                 |

## Cierre

✅ **Workstream prisma→DI COMPLETO.** **#21 = 0 y #1 = 0** (hard-zero, ratchet de #1/#21 volteado;
B8 — workers a DI vía composition root `apps/workers/src/container/`). Homologación + B3 + B4 +
Bloque C hechos (ver tabla). Único remanente **fuera de scope de DI**: las rutas analytics
`geographic` + `media-performance` siguen 501 por un **gap real de datos** (no es deuda de DI).
Duplicaciones worker↔use-case capturadas en `docs/reports/code-duplications.md` (DUP-01/02) +
SMELL-39 — resueltas por el **@core migration** (domain+application compartidos en `packages/@core`;
ver [CORE_MIGRATION_ROADMAP_ES.md](../architecture/CORE_MIGRATION_ROADMAP_ES.md) +
[APPLICATION_MIGRATION_ROADMAP_ES.md](../architecture/APPLICATION_MIGRATION_ROADMAP_ES.md)).

## Backlog de hallazgos

Smells/anti-patterns detectados durante la migración (fuera de scope inmediato) →
[docs/reports/roadmap-detected-smells-backlog.md](../reports/roadmap-detected-smells-backlog.md)
(SMELL-27 admin analytics, SMELL-28 `Account.subscription` leftover, SMELL-29 cobertura command repo,
SMELL-30 admin proxy SSE buffering).

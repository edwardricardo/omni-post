# Migración prisma→DI (Fase 2) — estado y plan

> Workstream en la rama `workstream/prisma-di-migration`. Este doc es el ancla durable
> del progreso; el detalle vivo de cada fase está en los mensajes de commit.

## Meta

Eliminar todo `import { prisma }` (y otros singletons/globals) fuera de los **composition roots**.
Cada unidad (servicios, adapters, repositorios, processors, route handlers, workers) **recibe**
sus dependencias por inyección de constructor; solo el composition root
(`apps/api/src/infrastructure/container/**` + el bootstrap `apps/api/src/index.ts`) construye
concretes. Ver §"Dependency Injection" de `CLAUDE.md`.

**Enforcement:** fitness function **#21** (ratchet, baseline 65 → 0 por fase, luego hard-zero) y
**#1** (no `import { prisma }` en rutas). Definidas en `CLAUDE.md` §"Automated Compliance Checks"
y `.github/workflows/fitness.yml`.

## Hecho

| Fase         | Commit    | Resumen                                                                                                                                                           |
| ------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F0           | `57555d2` | fitness fix #1 glob (case-insensitive) + #21 ratchet + DI canon en CLAUDE.md                                                                                      |
| F1a          | `efdc5b0` | ctor-inject de 9 adapters Prisma ya registrados                                                                                                                   |
| F1c          | `d8cd369` | ctor-inject de ~22 servicios TYPE-A                                                                                                                               |
| F2-A1        | `eaed5af` | admin-auth services → puertos; `AdminUser` credential-DTO split (DTO público sin secretos)                                                                        |
| F2-A2        | `14fc69d` | cluster billing/subscription → composition root real (Seemann); `Account` aggregate enriquecido                                                                   |
| B1           | `f1651b0` | analytics services prisma-free + `ThreadReadRepository` + quitar fallback Prisma en 3 adapters                                                                    |
| B2           | `34f915e` | tabla `conversions` + `ConversionRepository` + ROI engine prisma-free. **#21: 29→28**                                                                             |
| Homologación | `67a38b6` | 7 tests integration falsos-verdes (imports vitest bajo node:test → no ejecutaban) → 153 assertions reales en `node:test`+`assert`; arregló 4 migraciones de drift |

## Pendiente

- **B3 — Realtime.** Originalmente "cablear el WebSocket de analytics". La verificación runtime
  reveló que el realtime del repo está **roto de punta a punta** (WS nunca cableado + auth de
  dominio equivocado; proxy Next buffea SSE; cookie `SameSite=lax` cross-origin). Se rediseña a
  **SSE canon**. Plan completo: [docs/features/REALTIME_SSE_ES.md](../features/REALTIME_SSE_ES.md).
- **B4 — Rutas 501** → use cases ya listos: `GET /analytics/roi` (`CalculateROIUseCase`),
  `/analytics/cross-platform` (`GetCrossPlatformAnalyticsUseCase`), NUEVA `/analytics/performance`
  (`ComparePerformanceUseCase`), `/posts/best-times` (`PredictOptimalTimingUseCase`),
  `/engagement/trends` (`AnalyticsReadRepository.getTimeSeriesData`). `geographic` +
  `media-performance` quedan **501 documentados** (gap real de datos). Independiente de realtime.
- **Bloque C — AuditableService spine.** `AuditLogRepository` por ctor en ~11 subclases + ~50
  sitios de construcción (incl. fix del FK de audit "system" en auto-renovación de subscripciones).
- **Cierre:** #21 → 0 y flip de #1/#21 de ratchet a hard-zero.

## Backlog de hallazgos

Smells/anti-patterns detectados durante la migración (fuera de scope inmediato) →
[docs/reports/roadmap-detected-smells-backlog.md](../reports/roadmap-detected-smells-backlog.md)
(SMELL-27 admin analytics, SMELL-28 `Account.subscription` leftover, SMELL-29 cobertura command repo,
SMELL-30 admin proxy SSE buffering).

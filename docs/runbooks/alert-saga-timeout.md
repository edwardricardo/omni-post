# Runbook — `SagaTimeoutSpike`

> Alert: `prometheus/alerts/saga.yml`
> SLO: `docs/observability/SLO.md#saga`

## Síntoma

Más de 3 sagas fueron marcadas FAILED por timeout en los últimos 10min.

## Severidad: CRITICAL

Saga timeout = un saga step quedó colgado > 30min (timeout default). Si pre-pivot → compensation se ejecuta. Si post-pivot → estado inconsistente posible. Crítico.

## Qué detecta

El `SagaManagerLifecycle.startTimeoutChecker` (poll 60s) compara `Date.now() - instance.startedAt` vs `definition.timeout` y llama `executionEngine.failSaga(instance, "Saga timeout exceeded")` cuando excede.

Causas comunes:

- Step que espera HTTP a un provider down (sin circuit breaker timeout o con timeout demasiado largo).
- DB deadlock en una transacción que el step inicia.
- Recovery scheduler crasheó y los retries quedaron sin procesar.
- BullMQ jobs encolados pero no procesados (workers caídos).

## Diagnóstico paso-a-paso

1. **Identificar las sagas afectadas**: query DB:
   ```sql
   SELECT id, "definitionId", "currentStep", "errorMessage", "startedAt"
   FROM "SagaInstance"
   WHERE status = 'FAILED' AND "errorMessage" LIKE '%timeout%'
   ORDER BY "startedAt" DESC LIMIT 10;
   ```
2. **¿Todas la misma `definitionId`?** Si sí, regression en un saga específico. Si no, infra issue (DB/Redis/workers).
3. **¿Todas el mismo `currentStep`?** Identifica el step que cuelga. Inspeccionar su `execute()` source.
4. **Jaeger trace del primer saga**: buscar `saga.execute` span > 30min. ¿Qué descendiente span está corriendo cuando timeout fires? (Probablemente provider call o DB query.)
5. **BullMQ queue depths**: `pnpm --filter @apps/api exec node --eval "..." -e "console.log(await queue.getJobCounts())"` — ¿hay jobs `active` pero no se procesan? Workers caídos?
6. **Recovery scheduler health**: ¿está corriendo? `pnpm --filter @apps/api exec node` y verificar logs "Saga retry recovery scan" cada 5s.

## Remediation

- **Step que cuelga en provider call**: agregar timeout al circuit breaker del provider. Investigar root cause (provider lento? auth expired?).
- **DB deadlock**: identificar la query + agregar `SELECT FOR UPDATE NOWAIT` o reordenar locks. Si frecuente, revisar isolation level.
- **Workers caídos**: restart `apps/workers` pod. Investigar OOM/crash logs.
- **Recovery scheduler stuck**: restart `apps/api` (lifecycle se re-inicializa en init()).

## Manual saga recovery

Si las sagas FAILED son recoverable (estado consistente al momento del timeout), trigger manual:

```bash
# Identifica sagas:
psql -c "SELECT id FROM \"SagaInstance\" WHERE status = 'FAILED' AND \"errorMessage\" LIKE '%timeout%'"

# Re-trigger via HTTP admin endpoint:
curl -X POST localhost:3000/admin/saga/<sagaId>/continue
```

Si NO son recoverable (estado roto, e.g., post-pivot side effects ya ejecutados parcialmente):

- Manual cleanup según el saga: ej. `post-publishing-saga` puede requerir publicar el post manualmente vía admin UI + marcar saga COMPENSATED.

## Cuándo escalar

- 3+ sagas distintas timing out simultáneamente con misma `currentStep` → likely infra/provider issue, no saga bug.
- Si ningún saga del mismo type COMPLETÓ en últimos 30min → producto degradado, page on-call.

## Links

- Grafana: `business-metrics.json` panel "Sagas by status"
- Tabla: `SagaInstance` en Postgres
- Source: `apps/api/src/saga/SagaManagerLifecycle.ts:410-429` (timeout checker)
- Related runbook: `chaos-saga-step-retry.md` (entiende el flujo de retry/recovery)
- SLO: completion rate > 99% (`docs/observability/SLO.md#saga`)

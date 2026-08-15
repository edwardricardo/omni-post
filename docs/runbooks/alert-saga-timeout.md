# Runbook — `SagaTimeoutSpike`

> Alert: `prometheus/alerts/saga.yml`
> SLO: `docs/observability/SLO.md#saga`

## Síntoma

Más de 3 sagas fueron marcadas FAILED por timeout en los últimos 10min.

## Severidad: CRITICAL

Saga timeout = un saga step quedó colgado > 30min (timeout default). Si pre-pivot → compensation se ejecuta. Si post-pivot → estado inconsistente posible. Crítico.

## Qué detecta

El horizonte se evalúa en DOS lugares, con una sola implementación (`SagaManagerLifecycle.terminalizeIfPastHorizon`):

- el timeout checker (`saga-timeout-checker`, poll 60s) recorre las sagas que este proceso trackea;
- **y todo avanzador**: antes de mover una saga, la pasada de ejecución pregunta lo mismo. Eso cubre las filas que el proceso NUNCA trackeó (diferidas por el techo de boot, o cargadas por id), que antes dependían del presupuesto de reintentos para terminar.

Compara `Date.now() - instance.startedAt` contra `definition.timeout` y llama `failSaga(instance, "Saga timeout exceeded", "timeout")`. Las filas parked y las COMPENSATING tienen sus propios horizontes (ventana de operador y liveness del walk) y NO caen en este.

**LA CAUSA DOMINANTE CAMBIÓ.** Un step que espera trabajo externo (los jobs de publish) ya no gasta presupuesto de reintentos: responde `waiting`, se re-arma cada `SAGA_WAIT_POLL_MS` (default 30 s) y sólo termina por ESTE horizonte. Antes, "workers caídos" moría en ~35 s como `reason="step-failure"` y nunca llegaba a esta alerta; ahora es la causa más probable de un pico de timeouts, y llega media hora después del incidente real, con todo el cohorte junto.

Causas comunes, en orden de probabilidad hoy:

- **BullMQ jobs encolados pero no procesados (workers caídos o sin consumir).** Mirá primero `saga_waiting_rows` y su alerta `SagaWaitingRowsAccumulating`: si venía subiendo, el incidente empezó ahí, ~30 min antes de este pico.
- Step que espera HTTP a un provider down (sin circuit breaker timeout o con timeout demasiado largo).
- DB deadlock en una transacción que el step inicia.
- Recovery scheduler crasheó y los retries/polls quedaron sin procesar.

## La población que espera (mirá esto ANTES del pico)

```sql
-- Sagas esperando trabajo externo AHORA: RUNNING con re-entrada programada.
-- retryCount = 0 => está esperando; > 0 => está reintentando tras fallas reales.
SELECT id, "definitionId", "currentStep", "retryCount", "nextRetryAt", "startedAt"
FROM "SagaInstance"
WHERE status = 'RUNNING' AND "nextRetryAt" IS NOT NULL
ORDER BY "startedAt";
```

La misma población está en Prometheus como `saga_waiting_rows` (gauge medido en el scrape). Un nivel que sube y no drena es trabajo que se empieza y no se termina; el scan pagina 50 filas cada 5 s, así que por encima de ~300 sagas en espera la latencia del poll también empieza a crecer.

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
- **Workers caídos**: restart `apps/workers` pod. Investigar OOM/crash logs. Las sagas que estaban esperando NO se perdieron: al volver los workers, sus eventos de completado las avanzan, y las que ya no tienen evento las levanta el poll dentro de un intervalo.
- **La cola de latencia es esperable, no un bug**: cuando el evento de completado corre contra la actualización de estado de la cola, la saga espera un intervalo de poll antes de ver el desenlace. Si eso es demasiado para tu despliegue, bajá `SAGA_WAIT_POLL_MS` (mínimo 1000) — a cambio de más lecturas de la cola por saga.
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
- Source: `apps/api/src/saga/SagaManagerLifecycle.ts` — `startTimeoutChecker` (task `saga-timeout-checker`) y `terminalizeIfPastHorizon` (el mismo horizonte, preguntado por cualquier avanzador)
- Config: `SAGA_WAIT_POLL_MS` (`apps/api/src/config/env.ts`, default 30000)
- Related runbook: `chaos-saga-step-retry.md` (entiende el flujo de retry/recovery)
- SLO: completion rate > 99% (`docs/observability/SLO.md#saga`)

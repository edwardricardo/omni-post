# Runbook — `OutboxLagHigh`

> Alert: `prometheus/alerts/outbox.yml`
> SLO: `docs/observability/SLO.md#outbox`

## Síntoma

`outbox_pending_events > 100` por más de 5min sostenido.

## Qué detecta

El outbox relay debería procesar eventos en <1s en steady-state. Pending sustained > 100 indica:

1. Relay crasheado en el proceso apps/api.
2. Claim leases (5min) no se están liberando (deadlock interno).
3. Downstream consumer (BullMQ) saturado — relay claims OK pero handlers crashing.
4. Spike puntual de carga (e.g., bulk operation) — debería auto-resolverse.

## Diagnóstico paso-a-paso

1. **Conteo exacto en DB**:

   ```sql
   SELECT count(*), status FROM "OutboxEvent"
   WHERE status IN ('PENDING', 'CLAIMED') AND "createdAt" > NOW() - INTERVAL '1 hour'
   GROUP BY status;
   ```

   - Si todos `PENDING` y zero `CLAIMED`: relay no está claiming → relay process down.
   - Si muchos `CLAIMED` con `claimedAt` viejo: leases stuck. El lease expira en 5min, debería auto-recover. Si no, hay bug.

2. **Logs apps/api**: buscar `"OutboxRelay"` últimos 30min. Hay errores `"Outbox claim failed"` repetidos?

3. **Procesos vivos**: el relay corre **in-process** vía `BackgroundTaskScheduler.register("outbox-relay", ...)`. Si apps/api está running, el relay DEBERÍA estar corriendo. `curl /health/detailed` → check si el dependency check del outbox aparece.

4. **Downstream BullMQ queue depths**: si los handlers que consumen del outbox están saturados, el `messageId` unique constraint impedirá re-publish pero los items no se marcarán `PROCESSED`.

5. **Recently-released code**: ¿hay change reciente al `OutboxRelay.ts` o `OutboxClaimService.ts`? `git log apps/api/src/infrastructure/outbox/ --since="24 hours ago"`.

## Remediation

- **Relay process down**: restart `apps/api`. El `OutboxClaimService` reclaim leases automáticamente al boot.
- **Stuck CLAIMED leases**: si el restart no los limpia, manual cleanup:
  ```sql
  UPDATE "OutboxEvent" SET status = 'PENDING', "claimedAt" = NULL
  WHERE status = 'CLAIMED' AND "claimedAt" < NOW() - INTERVAL '10 minutes';
  ```
- **Downstream BullMQ saturated**: scale workers (e.g., apps/workers pod count). Investigar si algún handler tiene bug que crashea + retries acumulan.
- **Spike puntual**: monitorear 10min más. Si baja, document + close. Si no, treat como una de las causas anteriores.

## Cuándo escalar

- Pending > 1000 sostenido > 15min → page on-call (data loss risk si Postgres se queda sin storage).
- Si después de restart el lag sigue subiendo en lugar de bajar → bug en el relay, escalar a backend.

## Links

- Grafana: `business-metrics.json` panel "Outbox pending events"
- Tabla: `OutboxEvent` en Postgres
- Source: `apps/api/src/infrastructure/outbox/OutboxRelay.ts`, `OutboxClaimService.ts`
- Métrica: `outbox_pending_events` gauge
- SLO: pending < 100 steady-state, time-to-publish p99 < 30s (`docs/observability/SLO.md#outbox`)

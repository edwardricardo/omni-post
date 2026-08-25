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

## Sin consumidor en la cola `publish` (`PublishQueueUnattended`)

> Reglas: `PublishQueueUnattended` (critical) y su acompañante `PublishQueueSignalMissing` (warning), en `prometheus/alerts/saga.yml`.
> **Routing pending §4.2.b**: hoy TODAS las reglas de este repo se EVALÚAN pero no se entregan — el bloque `alertmanagers:` de `prometheus/prometheus.yml` está comentado. Nadie recibe una notificación push por esto; hay que mirarlo.

Esta es la señal temprana del pico de timeouts descrito arriba, y llega antes del daño.

**Qué dice exactamente.** Durante 5 minutos continuos hubo trabajo encolado en `publish` y el broker no reportó NI UNA VEZ un consumidor registrado para esa cola. Los dos términos son obligatorios: sólo consumidores dispararía ante un scale-to-zero deliberado con la cola vacía, y sólo profundidad de cola dispararía ante cualquier ráfaga normal.

**Ventana.** Lookback 5m + `for: 5m` = la regla se satisface a los **10 minutos**, un tercio del horizonte de 30 minutos. La latencia extremo-a-extremo es MAYOR y no es ese número: scrape y evaluación suman ~25 s, y el registro de clientes del broker puede arrastrar un proceso desaparecido hasta su reap de socket (~5 min con los defaults habituales). Peor caso medido: **~15 minutos**, todavía la mitad del horizonte.

**Qué NO prueba.** Registro no es throughput. Un consumidor trabado (loop bloqueado, lock retenido) o pausado sigue registrado, así que esta regla no lo ve. Tampoco dice nada sobre si ese consumidor logra publicar: sólo que hay algo escuchando.

**`-1` no es cero.** `publish_queue_consumers` publica `-1` cuando la cuenta NO se pudo leer (el broker rechaza `CLIENT LIST`, el puerto falló, o el proveedor no está instalado). Un gauge de Prometheus no tiene null, y la regla dispara con `== 0`: el centinela negativo falla ese predicado a propósito, para que una pregunta sin respuesta nunca pagine como una caída. Si ves `-1`, el problema es de observabilidad, no de consumo.

**Lectura para el operador — leer antes de tocar nada.** Las sagas afectadas quedan NO terminales hasta el horizonte y después terminalizan bajo `reason="timeout"`. **Un fallo terminal bajo esa razón NO prueba que no se haya publicado nada**: el pivot ya encoló los jobs, y un worker que vuelve puede haberlos drenado, o el provider puede haber recibido el post antes de que se perdiera el evento de completado. Verificá en el provider ANTES de reintentar cualquier cosa; un reintento a ciegas publica dos veces.

**Handling.**

1. `curl -s localhost:3000/health/dependency/queue | jq .details` — `consumers: 0` confirma la caída; `null` significa desconocido, no cero.
2. Verificá que el proceso de workers esté vivo y con `/health/ready` en 200 (puerto `METRICS_PORT`, default 3300). Su readiness ya exige un consumidor por cada cola del pipeline de publish, así que un 503 nombra cuál falta.
3. Si los workers están caídos: levantalos (`pnpm dev:workers`) y observá `publish_queue_waiting` drenar. Las sagas parkeadas retoman en un intervalo de poll más un tick de scan — no hace falta re-dispararlas a mano.
4. Recién después, para las sagas que YA terminalizaron bajo `reason="timeout"`, seguí el paso 1 de "Remediation" con la verificación en el provider primero.

Si la regla que falta es `PublishQueueSignalMissing`, el problema es el OBSERVADOR, no la cola: la API que publica la serie está caída o su target de scrape está mal configurado. `PublishQueueUnattended` deja de evaluarse en silencio en ese estado, que es justo el momento más cercano al incidente.

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

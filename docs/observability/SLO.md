# Service Level Objectives — OmniPost

> §4.2 Normalization Roadmap Phase A1. Targets consolidados desde
> `apps/api/src/metrics/*.ts` comentarios + `performance/config/alert-rules.json`
>
> - decisiones implícitas en `BackgroundTaskScheduler` polling intervals.

## ¿Para qué sirve este doc?

Cada SLO target acá tiene:

1. **Métrica** Prometheus que lo mide.
2. **Dashboard** Grafana que lo visualiza.
3. **Alert rule** que dispara cuando se viola.
4. **Runbook** que indica qué hacer cuando se viola.

Si algún target NO tiene los 4 ítems wireados, está incompleto.

---

## API {#api}

| SLI                | Target                            | Métrica                                                                        | Alert                                                                                 | Runbook                                                        |
| ------------------ | --------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Availability**   | 99.9% uptime mensual (~43min/mes) | `up{job="api"}`                                                                | TBD (§4.2.b)                                                                          | TBD                                                            |
| **Latency p99**    | < 1000ms (excluye 4xx)            | `histogram_quantile(0.99, rate(http_duration_bucket{job="api"}[5m]))`          | [ApiLatencyP99High](../runbooks/alert-api-latency.md) (`prometheus/alerts/api.yml`)   | [alert-api-latency.md](../runbooks/alert-api-latency.md)       |
| **Error rate 5xx** | < 1%                              | `rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])` | [ApiErrorRateHigh](../runbooks/alert-api-error-rate.md) (`prometheus/alerts/api.yml`) | [alert-api-error-rate.md](../runbooks/alert-api-error-rate.md) |
| **Dashboard**      | —                                 | —                                                                              | —                                                                                     | `grafana/dashboards/api-performance.json`                      |

**Notas:** El alert `ApiErrorRateHigh` fires en > 5% (no 1%) porque el SLO target de 1% es budget mensual — el alert es "spike detectable inmediato". 5% sostenido 5min = ~3.6 hours/mes de error budget consumido en una sola tarde.

---

## Saga {#saga}

| SLI                         | Target                                                | Métrica                                                                                                                                           | Alert                                                                                                                                                  | Runbook                                                      |
| --------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| **Completion rate**         | > 99% (COMPLETED vs FAILED \| COMPENSATED \| TIMEOUT) | `sagas_completed_total / sagas_started_total`                                                                                                     | TBD (§4.2.b) — needs `SagaCompletionRateLow`                                                                                                           | TBD                                                          |
| **Timeout spikes**          | < 3 timeouts en 10min                                 | `increase(sagas_failed_total{reason="timeout"}[10m])`                                                                                             | [SagaTimeoutSpike](../runbooks/alert-saga-timeout.md) (`prometheus/alerts/saga.yml`)                                                                   | [alert-saga-timeout.md](../runbooks/alert-saga-timeout.md)   |
| **Avg duration**            | < 30s (post-publishing saga)                          | `sagas_duration_seconds`                                                                                                                          | TBD (§4.2.b)                                                                                                                                           | TBD                                                          |
| **Recovery health**         | 0 fuera de ventana de deploy                          | `increase(saga_recovery_failures_total{stage=~"boot\|retry-scan\|timeout\|instance-load\|resume-row\|compensation\|rehydration\|mismatch"}[10m])` | [SagaRecoveryLoopFailing](../security/MULTI_TENANT_GUARDS.md), [SagaTenantMismatch](../security/MULTI_TENANT_GUARDS.md) (`prometheus/alerts/saga.yml`) | [MULTI_TENANT_GUARDS.md](../security/MULTI_TENANT_GUARDS.md) |
| **Parked backlog**          | 0 fuera de ventana de restart                         | `increase(saga_recovery_parked_total[10m])`                                                                                                       | [SagaParkedAtPivot](../security/MULTI_TENANT_GUARDS.md) (`prometheus/alerts/saga.yml`)                                                                 | [MULTI_TENANT_GUARDS.md](../security/MULTI_TENANT_GUARDS.md) |
| **Uncovered rows**          | 0 filas heredadas fuera del techo de carga            | `max(saga_recovery_deferred_rows)`                                                                                                                | [SagaBootLoadDeferred](../security/MULTI_TENANT_GUARDS.md) (`prometheus/alerts/saga.yml`)                                                              | [MULTI_TENANT_GUARDS.md](../security/MULTI_TENANT_GUARDS.md) |
| **COMPENSATING sin drenar** | 0 sostenido ~15min (walk en curso NO cuenta)          | `min_over_time(saga_compensating_orphans[10m])`                                                                                                   | [SagaCompensatingOrphans](../security/MULTI_TENANT_GUARDS.md) (`prometheus/alerts/saga.yml`)                                                           | [MULTI_TENANT_GUARDS.md](../security/MULTI_TENANT_GUARDS.md) |
| **Rollbacks sin terminar**  | 0                                                     | `increase(sagas_failed_total{reason="compensation-expired"}[10m])`                                                                                | [SagaCompensationExpired](../security/MULTI_TENANT_GUARDS.md) (`prometheus/alerts/saga.yml`)                                                           | [MULTI_TENANT_GUARDS.md](../security/MULTI_TENANT_GUARDS.md) |
| **Dashboard**               | —                                                     | —                                                                                                                                                 | —                                                                                                                                                      | `grafana/dashboards/business-metrics.json`                   |

**Notas:** La invariante crítica del saga engine se valida en `apps/api/tests/chaos/saga-step-retry-recovery.test.ts` (§4.1 Phase A1). Si esa test rompe en CI, el SLO de completion rate está en riesgo.

**Contadores vs gauges.** Los `*_total` son EVENTOS (pasó algo, una vez, y el total sólo crece). `saga_recovery_deferred_rows` y `saga_compensating_orphans` son GAUGES: son NIVELES que cada proceso vuelve a medir. Registrarlos como counter sumaría las mismas filas una vez por boot y reportaría un backlog de dos como seis después de tres restarts.

**El ciclo de vida COMPENSATING, y por qué su alerta NO usa `max()`.** El engine ahora persiste `COMPENSATING` ANTES de compensar nada, reanuda ese walk al boot (disposición `compensation-resumed`, nunca ejecución hacia adelante), guarda el progreso paso a paso en `compensationResults`, y deja la fila en `COMPENSATING` cuando el walk no pudo terminar — en vez de mentir `COMPENSATED`. Como consecuencia, un valor no-cero del gauge durante un arranque es TRABAJO EN CURSO, no un backlog atascado. Por eso el gauge se mide EN EL SCRAPE (un callback `collect` de prom-client corre el COUNT al renderizar `/metrics`): un nivel publicado sólo en el boot es ciego a las filas que aparecen ENTRE boots — que es justamente la población que crea el camino automático — y además queda enganchado en un valor viejo hasta el próximo restart. La alerta pide el PISO de la ventana (`min_over_time`), que sólo es > 0 si el nivel nunca drenó, sostenido `for: 5m`: en total dispara a los ~15 minutos de un nivel que no baja. Una fila que igual nadie avanza termina por DOS horizontes, y cualquiera de los dos alcanza: el de LIVENESS (desde su última escritura `updatedAt`, con re-lectura fresca antes de actuar) y el ABSOLUTO (desde el nacimiento del rollback — el evento durable `saga.compensation.started` —, a 3 horizontes, que es lo que impide que un crash-loop difiera la terminación reescribiendo la fila en cada arranque). Termina como `reason="compensation-expired"`, que se lee "el rollback no terminó", no "la publicación falló". Alcance: los horizontes sólo ven filas que el proceso TRACKEA; una fila COMPENSATING diferida por el techo de carga la cubren `SagaBootLoadDeferred` y el próximo boot.

**Recovery vs parked — son dos SLIs distintos a propósito.** `saga_recovery_failures_total` cuenta trabajo que el engine NO pudo completar (un loop que falló, una fila que no pudo clasificar, una cuenta que no resolvió). `saga_recovery_parked_total` cuenta DECISIONES que tomó bien: filas cortadas en el pivot que declina reanudar. Sumar las dos series reporta una decisión de diseño como una falla, que es exactamente lo que motivó separarlas.

---

## Outbox {#outbox}

| SLI                   | Target                                                              | Métrica                                                 | Alert                                                                             | Runbook                                                |
| --------------------- | ------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Pending events**    | < 100 events steady-state                                           | `outbox_pending_events`                                 | [OutboxLagHigh](../runbooks/alert-outbox-lag.md) (`prometheus/alerts/outbox.yml`) | [alert-outbox-lag.md](../runbooks/alert-outbox-lag.md) |
| **Time-to-publish**   | p99 < 30s                                                           | `outbox_publish_duration_seconds`                       | TBD (§4.2.b) — needs `OutboxPublishLatencyHigh`                                   | TBD                                                    |
| **Duplicate publish** | 0 en el camino sin fallos; raros sólo en crash-retry / lease-expiry | claim atómico + lease + predicado `publishedAt IS NULL` | — (absorbido por consumidores idempotentes)                                       | Investigación manual                                   |

**Notas:** El relay de outbox es transporte **at-least-once**. El claim atómico (`UPDATE ... FOR UPDATE SKIP LOCKED`) + el lease + el predicado `publishedAt IS NULL` impiden el doble-claim de una fila con lease vivo, y `markPublished` fija `publishedAt` **sólo después** de que `dispatch()` resuelve (nunca publica sin despachar). Un crash entre el dispatch y la marca terminal, o una expiración de lease durante un dispatch lento, puede producir una entrega duplicada; los consumidores son idempotentes (canon: _"every consumer handler is idempotent"_), así que el duplicado se absorbe aguas abajo — a cambio de eliminar la pérdida silenciosa. Ya no hay dedupe relay-side vía `OutboxInbox` (mecanismo removido; el modelo Prisma queda inerte hasta la migración de drop diferida).

---

## Business {#business}

| SLI                      | Target          | Métrica                                                | Alert        | Source                                     |
| ------------------------ | --------------- | ------------------------------------------------------ | ------------ | ------------------------------------------ |
| **Post creation p99**    | < 1000ms        | `posts_creation_duration_seconds{quantile="0.99"}`     | TBD (§4.2.b) | `apps/api/src/metrics/businessMetrics.ts`  |
| **Publish success rate** | > 99%           | `provider_publish_success_total / (success + failure)` | TBD (§4.2.b) | `apps/api/src/metrics/businessMetrics.ts`  |
| **Posts published/day**  | (informational) | `rate(posts_published_total[1d])`                      | —            | `apps/api/src/metrics/businessMetrics.ts`  |
| **Dashboard**            | —               | —                                                      | —            | `grafana/dashboards/business-metrics.json` |

---

## Coverage status

| Service  | SLI tracked | Alert wired | Runbook | Dashboard |
| -------- | ----------- | ----------- | ------- | --------- |
| API      | 3/3         | 2/3         | 2/3     | ✅        |
| Saga     | 3/3         | 1/3         | 1/3     | partial   |
| Outbox   | 3/3         | 1/3         | 1/3     | partial   |
| Business | 3/3         | 0/3         | 0/3     | ✅        |

Phase A1 cierra: 4 alerts + 4 runbooks + 1 SLO doc + Grafana provisioning.

Phase B (§4.2.b) cierra los gaps: 6+ alerts adicionales (availability, completion rate, avg duration, publish latency, post-creation p99, publish success rate) + alertmanager wireup + Slack/PagerDuty notification routing.

## Cuándo revisar este doc

- Cuando se agrega un nuevo SLI (alert nuevo, métrica nueva).
- Cuando un target cambia (negociación con product).
- Cuando un runbook se actualiza.
- En post-mortems: ¿faltó un SLO para detectar este incident?

## References

- Prometheus rules: `prometheus/alerts/`
- Grafana dashboards: `grafana/dashboards/`
- Métricas source: `apps/api/src/metrics/`
- Workstream: `docs/architecture/NORMALIZATION_ROADMAP.md §4.2`

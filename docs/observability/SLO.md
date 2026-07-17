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

| SLI                 | Target                                                | Métrica                                               | Alert                                                                                | Runbook                                                    |
| ------------------- | ----------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| **Completion rate** | > 99% (COMPLETED vs FAILED \| COMPENSATED \| TIMEOUT) | `sagas_completed_total / sagas_started_total`         | TBD (§4.2.b) — needs `SagaCompletionRateLow`                                         | TBD                                                        |
| **Timeout spikes**  | < 3 timeouts en 10min                                 | `increase(sagas_failed_total{reason="timeout"}[10m])` | [SagaTimeoutSpike](../runbooks/alert-saga-timeout.md) (`prometheus/alerts/saga.yml`) | [alert-saga-timeout.md](../runbooks/alert-saga-timeout.md) |
| **Avg duration**    | < 30s (post-publishing saga)                          | `sagas_duration_seconds`                              | TBD (§4.2.b)                                                                         | TBD                                                        |
| **Dashboard**       | —                                                     | —                                                     | —                                                                                    | `grafana/dashboards/business-metrics.json`                 |

**Notas:** La invariante crítica del saga engine se valida en `apps/api/tests/chaos/saga-step-retry-recovery.test.ts` (§4.1 Phase A1). Si esa test rompe en CI, el SLO de completion rate está en riesgo.

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
